import { TestingModule } from '@nestjs/testing';
import { MockHcmServer } from '../../src/mock-hcm/mock-hcm-server';
import { createTestModule } from '../test-helpers';
import { RequestsService } from '../../src/requests/requests.service';
import { BalanceRepository } from '../../src/balance/balance.repository';
import { AuditService } from '../../src/audit/audit.service';
import { RequestStatus } from '../../src/requests/entities/request-status.enum';

describe('Request Lifecycle (integration)', () => {
  let mockHcm: MockHcmServer;
  let hcmPort: number;
  let module: TestingModule;
  let requestsService: RequestsService;
  let balanceRepo: BalanceRepository;
  let auditService: AuditService;

  beforeAll(async () => {
    mockHcm = new MockHcmServer();
    hcmPort = await mockHcm.start();
    module = await createTestModule(`http://localhost:${hcmPort}`);
    requestsService = module.get(RequestsService);
    balanceRepo = module.get(BalanceRepository);
    auditService = module.get(AuditService);
  });

  afterAll(async () => {
    await mockHcm.stop();
    await module.close();
  });

  beforeEach(() => {
    mockHcm.reset();
    mockHcm.setBalance('emp-1', 'loc-1', 'vacation', 10);
    balanceRepo.upsert('emp-1', 'loc-1', 'vacation', 10);
  });

  // ── Submission ─────────────────────────────────────────────────────────

  describe('submitRequest', () => {
    it('creates a PENDING request and locks days from balance', async () => {
      const req = await requestsService.submitRequest('emp-1', {
        locationId: 'loc-1', leaveType: 'vacation',
        startDate: '2024-06-03', endDate: '2024-06-07', // 5 working days
      });
      expect(req.status).toBe(RequestStatus.PENDING);
      expect(req.days).toBe(5);
      const balance = balanceRepo.findOne('emp-1', 'loc-1', 'vacation')!;
      expect(balance.lockedDays).toBe(5);
    });

    it('returns 202 immediately (non-blocking)', async () => {
      const start = Date.now();
      await requestsService.submitRequest('emp-1', {
        locationId: 'loc-1', leaveType: 'vacation',
        startDate: '2024-06-03', endDate: '2024-06-05',
      });
      expect(Date.now() - start).toBeLessThan(500);
    });

    it('rejects if no balance record exists for this dimension', async () => {
      await expect(
        requestsService.submitRequest('emp-99', {
          locationId: 'loc-99', leaveType: 'vacation',
          startDate: '2024-06-03', endDate: '2024-06-05',
        }),
      ).rejects.toThrow('No balance record found');
    });

    it('rejects if local balance is insufficient', async () => {
      balanceRepo.upsert('emp-1', 'loc-1', 'vacation', 2);
      await expect(
        requestsService.submitRequest('emp-1', {
          locationId: 'loc-1', leaveType: 'vacation',
          startDate: '2024-06-03', endDate: '2024-06-07', // 5 days
        }),
      ).rejects.toThrow('Insufficient balance');
    });

    it('rejects if days=0 (weekend-only range)', async () => {
      await expect(
        requestsService.submitRequest('emp-1', {
          locationId: 'loc-1', leaveType: 'vacation',
          startDate: '2024-06-08', endDate: '2024-06-09', // Sat-Sun
        }),
      ).rejects.toThrow('no working days');
    });

    it('rejects PENDING → REJECTED asynchronously when HCM validation fails', async () => {
      mockHcm.setScenario('insufficient_balance');
      const req = await requestsService.submitRequest('emp-1', {
        locationId: 'loc-1', leaveType: 'vacation',
        startDate: '2024-06-03', endDate: '2024-06-05',
      });
      expect(req.status).toBe(RequestStatus.PENDING);
      // Let async HCM validation complete
      await new Promise(r => setTimeout(r, 300));
      const updated = (module.get(RequestsService) as any).requestsRepo.findById(req.id);
      expect(updated.status).toBe(RequestStatus.REJECTED);
      // Balance lock should be released
      const balance = balanceRepo.findOne('emp-1', 'loc-1', 'vacation')!;
      expect(balance.lockedDays).toBe(0);
    });
  });

  // ── Approval ───────────────────────────────────────────────────────────

  describe('approveRequest', () => {
    it('approves a PENDING request and deducts balance', async () => {
      const req = await requestsService.submitRequest('emp-1', {
        locationId: 'loc-1', leaveType: 'vacation',
        startDate: '2024-06-03', endDate: '2024-06-05', // 3 days
      });
      const approved = await requestsService.approveRequest(req.id, 'mgr-1');
      expect(approved!.status).toBe(RequestStatus.APPROVED);
      expect(approved!.hcmRef).toMatch(/hcm-ref-/);
      const balance = balanceRepo.findOne('emp-1', 'loc-1', 'vacation')!;
      expect(balance.balance).toBe(7);
      expect(balance.lockedDays).toBe(0);
    });

    it('calls HCM deduct endpoint on approval', async () => {
      const req = await requestsService.submitRequest('emp-1', {
        locationId: 'loc-1', leaveType: 'vacation',
        startDate: '2024-06-03', endDate: '2024-06-04',
      });
      await requestsService.approveRequest(req.id, 'mgr-1');
      const deductCalls = mockHcm.getCallsTo('/leave/deduct');
      expect(deductCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('sends idempotency key on HCM deduct call', async () => {
      const req = await requestsService.submitRequest('emp-1', {
        locationId: 'loc-1', leaveType: 'vacation',
        startDate: '2024-06-03', endDate: '2024-06-04',
      });
      await requestsService.approveRequest(req.id, 'mgr-1');
      const deductCalls = mockHcm.getCallsTo('/leave/deduct');
      const lastCall = deductCalls[deductCalls.length - 1];
      expect(lastCall.headers['x-idempotency-key']).toContain(req.id);
    });

    it('rejects if trying to approve a non-PENDING request', async () => {
      const req = await requestsService.submitRequest('emp-1', {
        locationId: 'loc-1', leaveType: 'vacation',
        startDate: '2024-06-03', endDate: '2024-06-04',
      });
      await requestsService.approveRequest(req.id, 'mgr-1');
      await expect(requestsService.approveRequest(req.id, 'mgr-1')).rejects.toThrow();
    });

    it('rejects the request if HCM returns a balance error during approval', async () => {
      mockHcm.setScenario('insufficient_balance');
      const req = await requestsService.submitRequest('emp-1', {
        locationId: 'loc-1', leaveType: 'vacation',
        startDate: '2024-06-03', endDate: '2024-06-05',
      });
      await expect(requestsService.approveRequest(req.id, 'mgr-1')).rejects.toThrow('Insufficient');
      const updated = (module.get(RequestsService) as any).requestsRepo.findById(req.id);
      expect(updated.status).toBe(RequestStatus.REJECTED);
    });

    it('moves to SYNCING state when HCM is unavailable during approval', async () => {
      mockHcm.setScenario('server_error');
      const req = await requestsService.submitRequest('emp-1', {
        locationId: 'loc-1', leaveType: 'vacation',
        startDate: '2024-06-03', endDate: '2024-06-05',
      });
      const result = await requestsService.approveRequest(req.id, 'mgr-1');
      expect(result!.status).toBe(RequestStatus.SYNCING);
    });
  });

  // ── Rejection ──────────────────────────────────────────────────────────

  describe('rejectRequest', () => {
    it('rejects a PENDING request and releases locked days', async () => {
      const req = await requestsService.submitRequest('emp-1', {
        locationId: 'loc-1', leaveType: 'vacation',
        startDate: '2024-06-03', endDate: '2024-06-05',
      });
      await requestsService.rejectRequest(req.id, { reason: 'Team conflict' }, 'mgr-1');
      const updated = (module.get(RequestsService) as any).requestsRepo.findById(req.id);
      expect(updated.status).toBe(RequestStatus.REJECTED);
      expect(updated.rejectionReason).toBe('Team conflict');
      const balance = balanceRepo.findOne('emp-1', 'loc-1', 'vacation')!;
      expect(balance.lockedDays).toBe(0);
    });
  });

  // ── Cancellation ───────────────────────────────────────────────────────

  describe('cancelRequest', () => {
    it('cancels a PENDING request and releases locked days', async () => {
      const req = await requestsService.submitRequest('emp-1', {
        locationId: 'loc-1', leaveType: 'vacation',
        startDate: '2024-06-03', endDate: '2024-06-05',
      });
      const cancelled = await requestsService.cancelRequest(req.id, 'emp-1');
      expect(cancelled!.status).toBe(RequestStatus.CANCELLED);
      const balance = balanceRepo.findOne('emp-1', 'loc-1', 'vacation')!;
      expect(balance.lockedDays).toBe(0);
    });

    it('credits balance back to HCM when cancelling an APPROVED request', async () => {
      const req = await requestsService.submitRequest('emp-1', {
        locationId: 'loc-1', leaveType: 'vacation',
        startDate: '2024-06-03', endDate: '2024-06-05',
      });
      await requestsService.approveRequest(req.id, 'mgr-1');
      const balanceBefore = balanceRepo.findOne('emp-1', 'loc-1', 'vacation')!.balance;
      await requestsService.cancelRequest(req.id, 'emp-1');
      const balanceAfter = balanceRepo.findOne('emp-1', 'loc-1', 'vacation')!.balance;
      expect(balanceAfter).toBeGreaterThan(balanceBefore);
      const creditCalls = mockHcm.getCallsTo('/leave/credit');
      expect(creditCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('prevents cancellation by a different employee', async () => {
      const req = await requestsService.submitRequest('emp-1', {
        locationId: 'loc-1', leaveType: 'vacation',
        startDate: '2024-06-03', endDate: '2024-06-05',
      });
      await expect(requestsService.cancelRequest(req.id, 'emp-99')).rejects.toThrow();
    });

    it('prevents cancellation of an already-cancelled request', async () => {
      const req = await requestsService.submitRequest('emp-1', {
        locationId: 'loc-1', leaveType: 'vacation',
        startDate: '2024-06-03', endDate: '2024-06-05',
      });
      await requestsService.cancelRequest(req.id, 'emp-1');
      await expect(requestsService.cancelRequest(req.id, 'emp-1')).rejects.toThrow();
    });
  });

  // ── Audit ──────────────────────────────────────────────────────────────

  describe('Audit trail', () => {
    it('logs REQUEST_SUBMITTED event on submission', async () => {
      await requestsService.submitRequest('emp-1', {
        locationId: 'loc-1', leaveType: 'vacation',
        startDate: '2024-06-03', endDate: '2024-06-04',
      });
      const events = auditService.findAll({ type: 'REQUEST_SUBMITTED', employeeId: 'emp-1' });
      expect(events.length).toBeGreaterThanOrEqual(1);
    });

    it('logs REQUEST_APPROVED event on approval', async () => {
      const req = await requestsService.submitRequest('emp-1', {
        locationId: 'loc-1', leaveType: 'vacation',
        startDate: '2024-06-03', endDate: '2024-06-04',
      });
      await requestsService.approveRequest(req.id, 'mgr-1');
      const events = auditService.findAll({ type: 'REQUEST_APPROVED', employeeId: 'emp-1' });
      expect(events.length).toBeGreaterThanOrEqual(1);
    });
  });
});