import { Injectable, Inject, Logger } from '@nestjs/common';
import Database from 'better-sqlite3';
import { DB_TOKEN } from '../database/database.tokens';
import { generateId, nowIso } from '../common/utills/idempotency.util';

export interface AuditLogEntry {
  type: string;
  employeeId?: string;
  locationId?: string;
  leaveType?: string;
  direction?: 'INBOUND' | 'OUTBOUND';
  payload?: any;
  status?: 'SUCCESS' | 'FAILURE' | 'PARTIAL';
  errorMessage?: string;
  eventId?: string;
  [key: string]: any;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DB_TOKEN) private readonly db: Database.Database) {}

  log(entry: AuditLogEntry): void {
    try {
      const { type, employeeId, locationId, leaveType, direction, payload, status, errorMessage, eventId, ...rest } = entry;
      const mergedPayload = { ...rest, ...payload };
      this.db.prepare(`
        INSERT INTO sync_events (id, type, employee_id, location_id, leave_type, direction, payload, status, error_message, event_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        generateId(),
        type,
        employeeId ?? null,
        locationId ?? null,
        leaveType ?? null,
        direction ?? null,
        JSON.stringify(mergedPayload),
        status ?? 'SUCCESS',
        errorMessage ?? null,
        eventId ?? null,
        nowIso(),
      );
    } catch (err) {
      this.logger.error('Failed to write audit log', err);
    }
  }

  findByEventId(eventId: string): any[] {
    return this.db.prepare(`SELECT * FROM sync_events WHERE event_id = ?`).all(eventId);
  }

  findAll(filters?: { type?: string; employeeId?: string }): any[] {
    let query = `SELECT * FROM sync_events WHERE 1=1`;
    const params: any[] = [];
    if (filters?.type) { query += ` AND type = ?`; params.push(filters.type); }
    if (filters?.employeeId) { query += ` AND employee_id = ?`; params.push(filters.employeeId); }
    query += ` ORDER BY created_at DESC LIMIT 500`;
    return this.db.prepare(query).all(...params);
  }
}