import { Injectable, Inject } from '@nestjs/common';
import Database from 'better-sqlite3';
import { DB_TOKEN } from '../database/database.module';
import { RequestStatus } from './entities/request-status.enum';
import { generateId, nowIso } from '../common/utils/idempotency.util';

export interface TimeOffRequest {
  id: string;
  employeeId: string;
  locationId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  status: RequestStatus;
  hcmRef?: string;
  rejectionReason?: string;
  requestedAt: string;
  decidedAt?: string;
  decidedBy?: string;
}

@Injectable()
export class RequestsRepository {
  constructor(@Inject(DB_TOKEN) private readonly db: Database.Database) {}

  private mapRow(row: any): TimeOffRequest {
    return {
      id: row.id,
      employeeId: row.employee_id,
      locationId: row.location_id,
      leaveType: row.leave_type,
      startDate: row.start_date,
      endDate: row.end_date,
      days: row.days,
      status: row.status as RequestStatus,
      hcmRef: row.hcm_ref,
      rejectionReason: row.rejection_reason,
      requestedAt: row.requested_at,
      decidedAt: row.decided_at,
      decidedBy: row.decided_by,
    };
  }

  create(data: Omit<TimeOffRequest, 'id' | 'requestedAt'>): TimeOffRequest {
    const id = generateId();
    const now = nowIso();
    this.db.prepare(`
      INSERT INTO time_off_requests
        (id, employee_id, location_id, leave_type, start_date, end_date, days, status, requested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.employeeId, data.locationId, data.leaveType, data.startDate, data.endDate, data.days, data.status, now);
    return this.findById(id)!;
  }

  findById(id: string): TimeOffRequest | undefined {
    const row = this.db.prepare(`SELECT * FROM time_off_requests WHERE id=?`).get(id);
    return row ? this.mapRow(row) : undefined;
  }

  findMany(filters: { employeeId?: string; status?: string; from?: string; to?: string } = {}): TimeOffRequest[] {
    let q = `SELECT * FROM time_off_requests WHERE 1=1`;
    const p: any[] = [];
    if (filters.employeeId) { q += ` AND employee_id=?`; p.push(filters.employeeId); }
    if (filters.status) { q += ` AND status=?`; p.push(filters.status); }
    if (filters.from) { q += ` AND start_date >= ?`; p.push(filters.from); }
    if (filters.to) { q += ` AND end_date <= ?`; p.push(filters.to); }
    q += ` ORDER BY requested_at DESC`;
    return this.db.prepare(q).all(...p).map(r => this.mapRow(r));
  }

  updateStatus(id: string, status: RequestStatus): void {
    this.db.prepare(`UPDATE time_off_requests SET status=? WHERE id=?`).run(status, id);
  }

  approve(id: string, decidedBy: string, hcmRef: string): void {
    this.db.prepare(`
      UPDATE time_off_requests SET status=?, decided_by=?, decided_at=?, hcm_ref=? WHERE id=?
    `).run(RequestStatus.APPROVED, decidedBy, nowIso(), hcmRef, id);
  }

  reject(id: string, reason: string, decidedBy: string): void {
    this.db.prepare(`
      UPDATE time_off_requests SET status=?, rejection_reason=?, decided_by=?, decided_at=? WHERE id=?
    `).run(RequestStatus.REJECTED, reason, decidedBy, nowIso(), id);
  }

  cancel(id: string): void {
    this.db.prepare(`
      UPDATE time_off_requests SET status=?, decided_at=? WHERE id=?
    `).run(RequestStatus.CANCELLED, nowIso(), id);
  }

  getPendingDays(employeeId: string, locationId: string, leaveType: string): number {
    const row: any = this.db.prepare(`
      SELECT COALESCE(SUM(days), 0) as total FROM time_off_requests
      WHERE employee_id=? AND location_id=? AND leave_type=? AND status IN ('PENDING','APPROVED','SYNCING')
    `).get(employeeId, locationId, leaveType);
    return row?.total ?? 0;
  }
}