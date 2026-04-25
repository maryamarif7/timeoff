import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { BalanceRepository } from './balance.repository';
import { HcmClientService } from '../sync/hcm-client.service';
import { AuditService } from '../audit/audit.service';
import { BatchSyncDto } from './dto/balance.dto';

@Injectable()
export class BalanceService {
  private readonly logger = new Logger(BalanceService.name);

  constructor(
    private readonly balanceRepo: BalanceRepository,
    private readonly hcmClient: HcmClientService,
    private readonly auditService: AuditService,
  ) {}

  getByEmployee(employeeId: string) {
    const records = this.balanceRepo.findByEmployee(employeeId);
    return records.map(this.toResponse);
  }

  async getOne(employeeId: string, locationId: string, leaveType?: string, refresh = false) {
    if (refresh) {
      await this.refreshFromHcm(employeeId, locationId, leaveType ?? 'vacation');
    }
    if (leaveType) {
      const rec = this.balanceRepo.findOne(employeeId, locationId, leaveType);
      if (!rec) throw new NotFoundException('Balance record not found');
      return this.toResponse(rec);
    }
    return this.balanceRepo.findByEmployee(employeeId)
      .filter(r => r.locationId === locationId)
      .map(this.toResponse);
  }

  async processBatch(dto: BatchSyncDto): Promise<{ updated: number; conflicts: number }> {
    let updated = 0;
    let conflicts = 0;

    for (const item of dto.items) {
      const existing = this.balanceRepo.findOne(item.employeeId, item.locationId, item.leaveType);
      if (existing) {
        const safeToApply = item.balance >= existing.lockedDays;
        if (!safeToApply) {
          // New balance would make pending requests unserviceable
          this.auditService.log({
            type: 'BALANCE_CONFLICT',
            employeeId: item.employeeId,
            locationId: item.locationId,
            leaveType: item.leaveType,
            status: 'FAILURE',
            errorMessage: `Batch balance ${item.balance} less than locked days ${existing.lockedDays}`,
            payload: { incomingBalance: item.balance, lockedDays: existing.lockedDays },
          });
          conflicts++;
          continue;
        }
      }
      this.balanceRepo.upsert(item.employeeId, item.locationId, item.leaveType, item.balance, item.hcmVersion);
      updated++;
    }

    this.auditService.log({
      type: 'BATCH_SYNC',
      direction: 'INBOUND',
      status: conflicts > 0 ? 'PARTIAL' : 'SUCCESS',
      payload: { total: dto.items.length, updated, conflicts },
    });

    return { updated, conflicts };
  }

  async refreshFromHcm(employeeId: string, locationId: string, leaveType: string): Promise<void> {
    try {
      const result = await this.hcmClient.fetchBalance(employeeId, locationId, leaveType);
      this.balanceRepo.upsert(employeeId, locationId, leaveType, result.balance, result.version);
      this.auditService.log({
        type: 'REALTIME_FETCH',
        employeeId,
        locationId,
        leaveType,
        direction: 'INBOUND',
        payload: { balance: result.balance, version: result.version },
      });
    } catch (err) {
      this.logger.warn(`Failed to refresh balance from HCM for ${employeeId}/${locationId}/${leaveType}: ${err}`);
      throw err;
    }
  }

  private toResponse(rec: any) {
    return {
      id: rec.id,
      employeeId: rec.employeeId,
      locationId: rec.locationId,
      leaveType: rec.leaveType,
      balance: rec.balance,
      lockedDays: rec.lockedDays,
      availableBalance: rec.balance - rec.lockedDays,
      hcmVersion: rec.hcmVersion,
      syncedAt: rec.syncedAt,
    };
  }
}