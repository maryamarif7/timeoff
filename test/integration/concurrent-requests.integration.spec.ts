import { TestingModule } from '@nestjs/testing';
import { MockHcmServer } from '../mock-hcm/mock-hcm-server';
import { createTestModule } from '../test-helpers';
import { RequestsService } from '../../src/requests/requests.service';
import { BalanceRepository } from '../../src/balance/balance.repository';

/**
 * CHALLENGE TEST: Two concurrent requests that together exceed the balance.
 * Advisory lock must prevent both from succeeding.
 */
describe('Concurrent Request Guard (integration)', () => {
  let mockHcm: MockHcmServer;
  let hcmPort: number;
  let module: TestingModule;
  let requestsService: RequestsService;
  let balanceRepo: BalanceRepository;

  beforeAll(async () => {
    mockHcm = new MockHcmServer();
    hcmPort = await mockHcm.start();
    module = await createTestModule(`http://localhost:${hcmPort}`);
    requestsService = module.get(RequestsService);
    balanceRepo = module.get(BalanceRepository);
  });

  afterAll(async () => {
    await mockHcm.stop();
    await module.close();
  });

  beforeEach(() => {
    mockHcm.reset();
  });

  it('prevents double-submission that would exceed balance', async () => {
    // Balance = 3 days; two requests for 2 days each
    mockHcm.setBalance('emp-1', 'loc-1', 'vacation', 3);
    balanceRepo.upsert('emp-1', 'loc-1', 'vacation', 3);

    const [result1, result2] = await Promise.allSettled([
      requestsService.submitRequest('emp-1', {
        locationId: 'loc-1', leaveType: 'vacation',
        startDate: '2024-06-03', endDate: '2024-06-04', // 2 days
      }),
      requestsService.submitRequest('emp-1', {
        locationId: 'loc-1', leaveType: 'vacation',
        startDate: '2024-06-10', endDate: '2024-06-11', // 2 days
      }),
    ]);

    const succeeded = [result1, result2].filter(r => r.status === 'fulfilled');
    const failed = [result1, result2].filter(r => r.status === 'rejected');

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason.message).toMatch(/Insufficient/i);

    // Locked days should equal the one successful request (2 days)
    const balance = balanceRepo.findOne('emp-1', 'loc-1', 'vacation')!;
    expect(balance.lockedDays).toBe(2);
  });

  it('allows concurrent submissions for different employees', async () => {
    mockHcm.setBalance('emp-1', 'loc-1', 'vacation', 5);
    mockHcm.setBalance('emp-2', 'loc-1', 'vacation', 5);
    balanceRepo.upsert('emp-1', 'loc-1', 'vacation', 5);
    balanceRepo.upsert('emp-2', 'loc-1', 'vacation', 5);

    const [r1, r2] = await Promise.allSettled([
      requestsService.submitRequest('emp-1', {
        locationId: 'loc-1', leaveType: 'vacation',
        startDate: '2024-06-03', endDate: '2024-06-05',
      }),
      requestsService.submitRequest('emp-2', {
        locationId: 'loc-1', leaveType: 'vacation',
        startDate: '2024-06-03', endDate: '2024-06-05',
      }),
    ]);

    expect(r1.status).toBe('fulfilled');
    expect(r2.status).toBe('fulfilled');
  });

  it('allows concurrent submissions for different leaveTypes', async () => {
    mockHcm.setBalance('emp-1', 'loc-1', 'vacation', 5);
    mockHcm.setBalance('emp-1', 'loc-1', 'sick', 5);
    balanceRepo.upsert('emp-1', 'loc-1', 'vacation', 5);
    balanceRepo.upsert('emp-1', 'loc-1', 'sick', 5);

    const [r1, r2] = await Promise.allSettled([
      requestsService.submitRequest('emp-1', {
        locationId: 'loc-1', leaveType: 'vacation',
        startDate: '2024-06-03', endDate: '2024-06-05',
      }),
      requestsService.submitRequest('emp-1', {
        locationId: 'loc-1', leaveType: 'sick',
        startDate: '2024-06-03', endDate: '2024-06-05',
      }),
    ]);

    expect(r1.status).toBe('fulfilled');
    expect(r2.status).toBe('fulfilled');
  });

  it('handles 5 concurrent requests gracefully (stress)', async () => {
    // Balance = 6 days, each request = 2 days → max 3 should succeed
    mockHcm.setBalance('emp-stress', 'loc-1', 'vacation', 6);
    balanceRepo.upsert('emp-stress', 'loc-1', 'vacation', 6);

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        requestsService.submitRequest('emp-stress', {
          locationId: 'loc-1', leaveType: 'vacation',
          startDate: `2024-0${6 + i}-03`, endDate: `2024-0${6 + i}-04`,
        }),
      ),
    );

    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    expect(succeeded).toBe(3);
    expect(failed).toBe(2);

    const balance = balanceRepo.findOne('emp-stress', 'loc-1', 'vacation')!;
    expect(balance.lockedDays).toBe(6);
  });
});