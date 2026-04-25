import { Injectable, Inject } from '@nestjs/common';
import Database from 'better-sqlite3';
import { DB_TOKEN } from '../database/database.module';
import { generateId, nowIso } from '../common/utills/idempotency.util';

export interface BalanceRecord {
  id: string;
  employeeId: string;
  locationId: string;
  leaveType: string;
  balance: number;
  lockedDays: number;
  hcmVersion?: string;
  syncedAt: string;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class BalanceRepository {
  private readonly locks = new Map<string, Promise<any>>();

  constructor(@Inject(DB_TOKEN) private readonly db: Database.Database) {}

  private mapRow(row: any): BalanceRecord {
    return {
      id: row.id,
      employeeId: row.employee_id,
      locationId: row.location_id,
      leaveType: row.leave_type,
      balance: row.balance,
      lockedDays: row.locked_days,
      hcmVersion: row.hcm_version,
      syncedAt: row.synced_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  findOne(employeeId: string, locationId: string, leaveType: string): BalanceRecord | undefined {
    const row = this.db.prepare(`
      SELECT * FROM balance_records WHERE employee_id=? AND location_id=? AND leave_type=?
    `).get(employeeId, locationId, leaveType);
    return row ? this.mapRow(row) : undefined;
  }

  findByEmployee(employeeId: string): BalanceRecord[] {
    return this.db.prepare(`SELECT * FROM balance_records WHERE employee_id=?`).all(employeeId).map(this.mapRow);
  }

  upsert(employeeId: string, locationId: string, leaveType: string, balance: number, hcmVersion?: string): BalanceRecord {
    const existing = this.findOne(employeeId, locationId, leaveType);
    const now = nowIso();
    if (existing) {
      this.db.prepare(`
        UPDATE balance_records SET balance=?, hcm_version=?, synced_at=?, updated_at=? 
        WHERE employee_id=? AND location_id=? AND leave_type=?
      `).run(balance, hcmVersion ?? null, now, now, employeeId, locationId, leaveType);
    } else {
      const id = generateId();
      this.db.prepare(`
        INSERT INTO balance_records (id, employee_id, location_id, leave_type, balance, locked_days, hcm_version, synced_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
      `).run(id, employeeId, locationId, leaveType, balance, hcmVersion ?? null, now, now, now);
    }
    return this.findOne(employeeId, locationId, leaveType)!;
  }

  /** Advisory lock: serialize concurrent access per key (in-process) */
  async withAdvisoryLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.locks.get(lockKey) ?? Promise.resolve();
    const next = existing.then(() => fn());
    this.locks.set(lockKey, next.catch(() => {}));
    try {
      return await next;
    } finally {
      // Clean up lock entry after all pending operations settle
      if (this.locks.get(lockKey) === next.catch(() => {})) {
        this.locks.delete(lockKey);
      }
    }
  }

  lockDays(employeeId: string, locationId: string, leaveType: string, days: number): void {
    this.db.prepare(`
      UPDATE balance_records SET locked_days = locked_days + ?, updated_at=?
      WHERE employee_id=? AND location_id=? AND leave_type=?
    `).run(days, nowIso(), employeeId, locationId, leaveType);
  }

  releaseLock(employeeId: string, locationId: string, leaveType: string, days: number): void {
    this.db.prepare(`
      UPDATE balance_records SET locked_days = MAX(0, locked_days - ?), updated_at=?
      WHERE employee_id=? AND location_id=? AND leave_type=?
    `).run(days, nowIso(), employeeId, locationId, leaveType);
  }

  commitDeduction(employeeId: string, locationId: string, leaveType: string, days: number): void {
    this.db.prepare(`
      UPDATE balance_records 
      SET balance = MAX(0, balance - ?), locked_days = MAX(0, locked_days - ?), updated_at=?
      WHERE employee_id=? AND location_id=? AND leave_type=?
    `).run(days, days, nowIso(), employeeId, locationId, leaveType);
  }

  creditBack(employeeId: string, locationId: string, leaveType: string, days: number): void {
    this.db.prepare(`
      UPDATE balance_records SET balance = balance + ?, updated_at=?
      WHERE employee_id=? AND location_id=? AND leave_type=?
    `).run(days, nowIso(), employeeId, locationId, leaveType);
  }

  batchUpsert(items: { employeeId: string; locationId: string; leaveType: string; balance: number; hcmVersion?: string }[]): void {
    const txn = this.db.transaction((rows) => {
      for (const row of rows) {
        this.upsert(row.employeeId, row.locationId, row.leaveType, row.balance, row.hcmVersion);
      }
    });
    txn(items);
  }
}