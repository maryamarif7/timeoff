import { TestingModule } from '@nestjs/testing';
import { MockHcmServer } from '../../src/mock-hcm/mock-hcm-server';
import { createTestModule } from '../test-helpers';
import { RequestsService } from '../../src/requests/requests.service';
import { BalanceRepository } from '../../src/balance/balance.repository';
import { AuditService } from '../../src/audit/audit.service';
import { SyncWorkerService } from '../../src/sync/sync-worker.service';

/**
 * CHALLENGE TEST: HCM silently fails to deduct (returns 200 with reference
 * but actual HCM balance was NOT reduced). Our post-deduction verification
 * must detect this discrepancy.
 */
describe('HCM Silent Failure Detection (integration)', () => {
  let mockHcm: MockHcmServer;
  let hcmPort: number;
  let module: TestingModule;
  let requestsService: RequestsService;
  let balanceRepo: BalanceRepository;
  let auditService: AuditService;
  let syncWorker: SyncWorkerService;

  beforeAll(async () => {
    mockHcm = new MockHcmServer();
    hcmPort = await mockHcm.start();
    module = await createTestModule(`http://localhost:${hcmPort}`);
    requestsService = module.get(RequestsService);
    balanceRepo = module.get(BalanceRepository);
    auditService = module.get(AuditService);
    syncWorker = module.get(SyncWorkerService);
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

  it('detects when HCM returns success but balance was not deducted', async () => {
    // HCM will return a reference but NOT deduct the balance internally
    mockHcm.setScenario('silent_fail');

    const req = await requestsService.submitRequest('emp-1', {
      locationId: 'loc-1', leaveType: 'vacation',
      startDate: '2024-06-03', endDate: '2024-06-05', // 3 days
    });

    const approved = await requestsService.approveRequest(req.id, 'mgr-1');
    expect(approved!.status).toBe('APPROVED');

    // Our local balance was deducted (we committed it)
    const localBalance = balanceRepo.findOne('emp-1', 'loc-1', 'vacation')!;
    expect(localBalance.balance).toBe(7); // 10 - 3

    // HCM balance is still 10 (silent fail — not actually deducted)
    expect(mockHcm.getBalance('emp-1', 'loc-1', 'vacation')).toBe(10);

    // Trigger post-deduction verification immediately (test env uses 50ms delay)
    await new Promise(r => setTimeout(r, 200));

    // Should have logged a BALANCE_MISMATCH event
    const events = auditService.findAll({ type: 'BALANCE_MISMATCH' });
    expect(events.length).toBeGreaterThanOrEqual(1);
    const mismatch = events[0];
    const payload = JSON.parse(mismatch.payload);
    expect(payload.localBalance).toBe(7);
    expect(payload.hcmBalance).toBe(10);
  });

  it('logs BALANCE_VERIFIED when balances match', async () => {
    mockHcm.setScenario('normal');

    const req = await requestsService.submitRequest('emp-1', {
      locationId: 'loc-1', leaveType: 'vacation',
      startDate: '2024-06-03', endDate: '2024-06-05',
    });
    await requestsService.approveRequest(req.id, 'mgr-1');

    // HCM actually deducted, both sides match now
    await new Promise(r => setTimeout(r, 200));

    const mismatchEvents = auditService.findAll({ type: 'BALANCE_MISMATCH' });
    expect(mismatchEvents.length).toBe(0);

    const verifiedEvents = auditService.findAll({ type: 'BALANCE_VERIFIED' });
    expect(verifiedEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('does not crash when HCM fetch fails during post-deduction verification', async () => {
    const req = await requestsService.submitRequest('emp-1', {
      locationId: 'loc-1', leaveType: 'vacation',
      startDate: '2024-06-03', endDate: '2024-06-04',
    });
    await requestsService.approveRequest(req.id, 'mgr-1');

    // Make HCM return server error during verification
    mockHcm.setScenario('server_error');
    await new Promise(r => setTimeout(r, 200));
    // Should not throw — verification is best-effort
  });
});