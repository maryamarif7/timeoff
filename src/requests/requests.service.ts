import {
  Injectable, BadRequestException, NotFoundException,
  ConflictException, Logger,
} from '@nestjs/common';
import { RequestsRepository } from './requests.repository';
import { BalanceRepository } from '../balance/balance.repository';
import { HcmClientService } from '../sync/hcm-client.service';
import { AuditService } from '../audit/audit.service';
import { SyncWorkerService } from '../sync/sync-worker.service';
import { CreateRequestDto, RejectRequestDto } from './dto/request.dto';
import { RequestStatus, canTransition } from './entities/request-status.enum';
import { computeWorkingDays } from '../common/utils/working-days.util';

@Injectable()
export class RequestsService {
  private readonly logger = new Logger(RequestsService.name);

  constructor(
    private readonly requestsRepo: RequestsRepository,
    private readonly balanceRepo: BalanceRepository,
    private readonly hcmClient: HcmClientService,
    private readonly auditService: AuditService,
    private readonly syncWorker: SyncWorkerService,
  ) {}

  async submitRequest(employeeId: string, dto: CreateRequestDto) {
    const days = computeWorkingDays(new Date(dto.startDate), new Date(dto.endDate));
    if (days <= 0) throw new BadRequestException('Date range contains no working days');
    if (new Date(dto.endDate) < new Date(dto.startDate)) {
      throw new BadRequestException('End date must be after start date');
    }

    const lockKey = `${employeeId}:${dto.locationId}:${dto.leaveType}`;

    return this.balanceRepo.withAdvisoryLock(lockKey, async () => {
      const balance = this.balanceRepo.findOne(employeeId, dto.locationId, dto.leaveType);
      if (!balance) throw new BadRequestException('No balance record found for this employee/location/leaveType');

      const available = balance.balance - balance.lockedDays;
      if (available < days) {
        throw new BadRequestException(
          `Insufficient balance. Available: ${available}, Requested: ${days}`,
        );
      }

      const request = this.requestsRepo.create({
        employeeId,
        locationId: dto.locationId,
        leaveType: dto.leaveType,
        startDate: dto.startDate,
        endDate: dto.endDate,
        days,
        status: RequestStatus.PENDING,
      });

      this.balanceRepo.lockDays(employeeId, dto.locationId, dto.leaveType, days);

      // Fire async HCM validation without blocking 202
      this.validateWithHcmAsync(request.id, employeeId, dto.locationId, dto.leaveType, days);

      this.auditService.log({ type: 'REQUEST_SUBMITTED', employeeId, locationId: dto.locationId, leaveType: dto.leaveType, payload: { requestId: request.id, days } });

      return request;
    });
  }

  private validateWithHcmAsync(
    requestId: string, employeeId: string, locationId: string, leaveType: string, days: number,
  ): void {
    this.hcmClient.validateLeave({ employeeId, locationId, leaveType, days }).then(async (result) => {
      if (!result.valid) {
        await this.rejectRequestInternal(requestId, result.reason ?? 'HCM validation failed', 'system');
      }
    }).catch((err) => {
      this.auditService.log({
        type: 'HCM_VALIDATION_FAILED',
        employeeId,
        status: 'FAILURE',
        errorMessage: String(err),
        payload: { requestId },
      });
    });
  }

  async approveRequest(requestId: string, managerId: string) {
    const request = this.requestsRepo.findById(requestId);
    if (!request) throw new NotFoundException('Request not found');
    if (!canTransition(request.status, RequestStatus.APPROVED)) {
      throw new ConflictException(`Cannot approve a request in status: ${request.status}`);
    }

    try {
      const result = await this.hcmClient.deductLeave(
        { employeeId: request.employeeId, locationId: request.locationId, leaveType: request.leaveType, days: request.days },
        { idempotencyKey: `approve:${requestId}` },
      );

      this.balanceRepo.commitDeduction(request.employeeId, request.locationId, request.leaveType, request.days);
      this.requestsRepo.approve(requestId, managerId, result.reference);

      this.auditService.log({ type: 'REQUEST_APPROVED', employeeId: request.employeeId, payload: { requestId, managerId, hcmRef: result.reference } });

      // Schedule post-deduction balance verification (defensive guard)
      this.syncWorker.scheduleVerification(requestId, request.employeeId, request.locationId, request.leaveType);

      return this.requestsRepo.findById(requestId);
    } catch (err: any) {
      if (err.isHcmBalanceError) {
        await this.rejectRequestInternal(requestId, err.message, managerId);
        throw new BadRequestException(err.message);
      }
      // Transient failure — queue for retry
      this.requestsRepo.updateStatus(requestId, RequestStatus.SYNCING);
      await this.syncWorker.enqueueApproval(requestId, managerId);
      this.auditService.log({ type: 'APPROVAL_QUEUED', status: 'PARTIAL', payload: { requestId, managerId } });
      return { ...this.requestsRepo.findById(requestId), message: 'Approval queued pending HCM availability' };
    }
  }

  async rejectRequest(requestId: string, dto: RejectRequestDto, managerId: string) {
    return this.rejectRequestInternal(requestId, dto.reason, managerId);
  }

  private async rejectRequestInternal(requestId: string, reason: string, decidedBy: string) {
    const request = this.requestsRepo.findById(requestId);
    if (!request) throw new NotFoundException('Request not found');
    if (!canTransition(request.status, RequestStatus.REJECTED)) {
      throw new ConflictException(`Cannot reject a request in status: ${request.status}`);
    }
    this.balanceRepo.releaseLock(request.employeeId, request.locationId, request.leaveType, request.days);
    this.requestsRepo.reject(requestId, reason, decidedBy);
    this.auditService.log({ type: 'REQUEST_REJECTED', employeeId: request.employeeId, payload: { requestId, reason, decidedBy } });
    return this.requestsRepo.findById(requestId);
  }

  async cancelRequest(requestId: string, employeeId: string) {
    const request = this.requestsRepo.findById(requestId);
    if (!request) throw new NotFoundException('Request not found');
    if (request.employeeId !== employeeId) throw new ConflictException('You can only cancel your own requests');
    if (!canTransition(request.status, RequestStatus.CANCELLED)) {
      throw new ConflictException(`Cannot cancel a request in status: ${request.status}`);
    }

    if (request.status === RequestStatus.APPROVED) {
      this.requestsRepo.updateStatus(requestId, RequestStatus.SYNCING);
      try {
        await this.hcmClient.creditLeave({
          employeeId, locationId: request.locationId, leaveType: request.leaveType,
          days: request.days, hcmRef: request.hcmRef,
        });
        this.balanceRepo.creditBack(employeeId, request.locationId, request.leaveType, request.days);
      } catch {
        await this.syncWorker.enqueueCreditBack(requestId);
        this.auditService.log({ type: 'CREDIT_BACK_QUEUED', status: 'PARTIAL', payload: { requestId } });
        return { ...this.requestsRepo.findById(requestId), message: 'Credit-back queued' };
      }
    } else {
      this.balanceRepo.releaseLock(employeeId, request.locationId, request.leaveType, request.days);
    }

    this.requestsRepo.cancel(requestId);
    this.auditService.log({ type: 'REQUEST_CANCELLED', employeeId, payload: { requestId } });
    return this.requestsRepo.findById(requestId);
  }

  getById(requestId: string) {
    const r = this.requestsRepo.findById(requestId);
    if (!r) throw new NotFoundException('Request not found');
    return r;
  }

  listRequests(filters: { employeeId?: string; status?: string; from?: string; to?: string }) {
    return this.requestsRepo.findMany(filters);
  }
}