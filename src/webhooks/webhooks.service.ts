import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { BalanceRepository } from '../balance/balance.repository';
import { AuditService } from '../audit/audit.service';
import { generateId, nowIso, futureIso } from '../common/utils/idempotency.util';
import { Inject } from '@nestjs/common';
import Database from 'better-sqlite3';
import { DB_TOKEN } from '../database/database.module';

export interface BalanceUpdateEvent {
  employeeId: string;
  locationId: string;
  leaveType: string;
  balance: number;
  hcmVersion?: string;
  reason?: string;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24h

  constructor(
    @Inject(DB_TOKEN) private readonly db: Database.Database,
    private readonly balanceRepo: BalanceRepository,
    private readonly auditService: AuditService,
  ) {}

  async handleBalanceUpdate(eventId: string, event: BalanceUpdateEvent): Promise<{ processed: boolean }> {
    // Idempotency check
    const existing = this.db.prepare(`SELECT * FROM idempotency_keys WHERE key_value=? AND expires_at > ?`).get(eventId, nowIso());
    if (existing) {
      this.logger.log(`Duplicate webhook event ${eventId} — skipping`);
      return { processed: false };
    }

    // Record idempotency key before processing
    this.db.prepare(`
      INSERT OR REPLACE INTO idempotency_keys (key_value, response_code, response_body, created_at, expires_at)
      VALUES (?, 200, ?, ?, ?)
    `).run(eventId, JSON.stringify({ processed: true }), nowIso(), futureIso(this.IDEMPOTENCY_TTL_MS));

    // Check for conflict: new balance would make pending requests unserviceable
    const existing_balance = this.balanceRepo.findOne(event.employeeId, event.locationId, event.leaveType);
    if (existing_balance && event.balance < existing_balance.lockedDays) {
      this.auditService.log({
        type: 'BALANCE_CONFLICT',
        employeeId: event.employeeId,
        locationId: event.locationId,
        leaveType: event.leaveType,
        direction: 'INBOUND',
        status: 'FAILURE',
        eventId,
        errorMessage: `Inbound balance ${event.balance} less than locked days ${existing_balance.lockedDays}`,
        payload: event,
      });
      return { processed: true };
    }

    this.balanceRepo.upsert(event.employeeId, event.locationId, event.leaveType, event.balance, event.hcmVersion);

    this.auditService.log({
      type: 'BALANCE_UPDATED_VIA_WEBHOOK',
      employeeId: event.employeeId,
      locationId: event.locationId,
      leaveType: event.leaveType,
      direction: 'INBOUND',
      eventId,
      payload: { ...event, reason: event.reason ?? 'HCM push' },
    });

    return { processed: true };
  }

  cleanExpiredIdempotencyKeys(): void {
    this.db.prepare(`DELETE FROM idempotency_keys WHERE expires_at <= ?`).run(nowIso());
  }
}