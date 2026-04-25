import { Injectable, Inject, Logger } from '@nestjs/common';
import Database from 'better-sqlite3';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DB_TOKEN } from '../database/database.module';
import { HcmClientService } from './hcm-client.service';
import { AuditService } from '../audit/audit.service';
import { generateId, nowIso, futureIso } from '../common/utils/idempotency.util';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SyncWorkerService {
  private readonly logger = new Logger(SyncWorkerService.name);
  private readonly verificationDelayMs: number;

  constructor(
    @Inject(DB_TOKEN) private readonly db: Database.Database,
    private readonly hcmClient: HcmClientService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService,
  ) {
    this.verificationDelayMs = config.get<number>('sync.verificationDelayMs') ?? 300000;
  }

  async enqueueApproval(requestId: string, managerId: string): Promise<void> {
    this.enqueueJob('APPROVE_REQUEST', { requestId, managerId });
  }

  async enqueueCreditBack(requestId: string): Promise<void> {
    this.enqueueJob('CREDIT_BACK', { requestId });
  }

  scheduleVerification(requestId: string, employeeId: string, locationId: string, leaveType: string): void {
    const delay = this.verificationDelayMs;
    setTimeout(() => {
      this.runPostDeductionVerification(requestId, employeeId, locationId, leaveType).catch(err => {
        this.logger.error('Post-deduction verification failed', err);
      });
    }, delay);
  }

  private async runPostDeductionVerification(
    requestId: string, employeeId: string, locationId: string, leaveType: string,
  ): Promise<void> {
    try {
      const localBalance: any = this.db.prepare(`
        SELECT balance FROM balance_records WHERE employee_id=? AND location_id=? AND leave_type=?
      `).get(employeeId, locationId, leaveType);

      const hcmBalance = await this.hcmClient.fetchBalance(employeeId, locationId, leaveType);

      const diff = Math.abs((localBalance?.balance ?? 0) - hcmBalance.balance);
      if (diff > 0.01) {
        this.auditService.log({
          type: 'BALANCE_MISMATCH',
          employeeId,
          locationId,
          leaveType,
          status: 'FAILURE',
          errorMessage: `Local: ${localBalance?.balance}, HCM: ${hcmBalance.balance}`,
          payload: { requestId, localBalance: localBalance?.balance, hcmBalance: hcmBalance.balance },
        });
        this.logger.warn(`Balance mismatch detected for ${employeeId}/${locationId}/${leaveType} after request ${requestId}`);
      } else {
        this.auditService.log({
          type: 'BALANCE_VERIFIED',
          employeeId,
          locationId,
          leaveType,
          payload: { requestId, balance: hcmBalance.balance },
        });
      }
    } catch (err) {
      this.logger.warn(`Could not verify balance for requestId ${requestId}: ${err}`);
    }
  }

  private enqueueJob(type: string, payload: any, delayMs = 0): void {
    const id = generateId();
    const now = nowIso();
    const nextRun = new Date(Date.now() + delayMs).toISOString();
    this.db.prepare(`
      INSERT INTO job_queue (id, type, payload, status, attempts, max_attempts, next_run_at, created_at, updated_at)
      VALUES (?, ?, ?, 'PENDING', 0, 5, ?, ?, ?)
    `).run(id, type, JSON.stringify(payload), nextRun, now, now);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processPendingJobs(): Promise<void> {
    const jobs: any[] = this.db.prepare(`
      SELECT * FROM job_queue
      WHERE status='PENDING' AND attempts < max_attempts AND next_run_at <= ?
      ORDER BY next_run_at ASC LIMIT 20
    `).all(nowIso());

    for (const job of jobs) {
      await this.processJob(job);
    }
  }

  private async processJob(job: any): Promise<void> {
    const payload = JSON.parse(job.payload);
    const now = nowIso();

    this.db.prepare(`UPDATE job_queue SET attempts=attempts+1, updated_at=? WHERE id=?`).run(now, job.id);

    try {
      if (job.type === 'APPROVE_REQUEST') await this.processApprovalJob(payload);
      if (job.type === 'CREDIT_BACK') await this.processCreditBackJob(payload);

      this.db.prepare(`UPDATE job_queue SET status='DONE', updated_at=? WHERE id=?`).run(now, job.id);
    } catch (err: any) {
      const delay = Math.min(1000 * Math.pow(2, job.attempts), 60000);
      const nextRun = new Date(Date.now() + delay).toISOString();
      const isDead = job.attempts + 1 >= job.max_attempts;

      this.db.prepare(`
        UPDATE job_queue SET status=?, next_run_at=?, error_message=?, updated_at=? WHERE id=?
      `).run(isDead ? 'DEAD' : 'PENDING', nextRun, String(err), now, job.id);

      if (isDead) {
        this.auditService.log({ type: 'JOB_DEAD_LETTER', status: 'FAILURE', payload: { jobId: job.id, jobType: job.type, error: String(err) } });
        this.logger.error(`Job ${job.id} (${job.type}) moved to dead letter after ${job.attempts} attempts`);
      }
    }
  }

  private async processApprovalJob(payload: { requestId: string; managerId: string }): Promise<void> {
    // Dynamically resolve to avoid circular dependency
    const request: any = this.db.prepare(`SELECT * FROM time_off_requests WHERE id=?`).get(payload.requestId);
    if (!request || request.status !== 'SYNCING') return;

    const result = await this.hcmClient.deductLeave(
      { employeeId: request.employee_id, locationId: request.location_id, leaveType: request.leave_type, days: request.days },
      { idempotencyKey: `approve:${payload.requestId}` },
    );

    this.db.prepare(`
      UPDATE balance_records SET balance=MAX(0, balance-?), locked_days=MAX(0, locked_days-?), updated_at=?
      WHERE employee_id=? AND location_id=? AND leave_type=?
    `).run(request.days, request.days, nowIso(), request.employee_id, request.location_id, request.leave_type);

    this.db.prepare(`
      UPDATE time_off_requests SET status='APPROVED', decided_by=?, decided_at=?, hcm_ref=? WHERE id=?
    `).run(payload.managerId, nowIso(), result.reference, payload.requestId);

    this.auditService.log({ type: 'REQUEST_APPROVED_ASYNC', payload: { requestId: payload.requestId, hcmRef: result.reference } });
  }

  private async processCreditBackJob(payload: { requestId: string }): Promise<void> {
    const request: any = this.db.prepare(`SELECT * FROM time_off_requests WHERE id=?`).get(payload.requestId);
    if (!request || request.status !== 'SYNCING') return;

    await this.hcmClient.creditLeave({
      employeeId: request.employee_id, locationId: request.location_id,
      leaveType: request.leave_type, days: request.days, hcmRef: request.hcm_ref,
    });

    this.db.prepare(`
      UPDATE balance_records SET balance=balance+?, updated_at=?
      WHERE employee_id=? AND location_id=? AND leave_type=?
    `).run(request.days, nowIso(), request.employee_id, request.location_id, request.leave_type);

    this.db.prepare(`UPDATE time_off_requests SET status='CANCELLED', decided_at=? WHERE id=?`).run(nowIso(), payload.requestId);
    this.auditService.log({ type: 'CREDIT_BACK_COMPLETED', payload: { requestId: payload.requestId } });
  }

  getDeadLetterJobs(): any[] {
    return this.db.prepare(`SELECT * FROM job_queue WHERE status='DEAD' ORDER BY updated_at DESC`).all();
  }
}