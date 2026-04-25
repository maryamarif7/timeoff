/**
 * CHALLENGE TEST: HCM resends the same balance-update webhook (retry scenario).
 * We must process it exactly once.
 */
describe('Webhook idempotency', () => {
  it('processes a balance-update webhook exactly once even if sent twice', async () => {
    const eventId = 'event-uuid-123';
    await webhooksService.handleBalanceUpdate(eventId, { employeeId: 'emp-1', balance: 15, ... });
    await webhooksService.handleBalanceUpdate(eventId, { employeeId: 'emp-1', balance: 15, ... });
    // Verify: balance updated once, only one SyncEvent logged
    const events = await syncEventRepo.findByEventId(eventId);
    expect(events).toHaveLength(1);
  });
});