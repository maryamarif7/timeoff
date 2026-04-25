/**
 * CHALLENGE TEST: HCM sends a batch with a lower balance than our local value
 * because an external event decreased it (e.g. HR manual adjustment).
 * We should reconcile carefully and not invalidate pending requests.
 */
describe('Batch reconciliation', () => {
  it('applies a higher batch balance (anniversary bonus) correctly', async () => {
    // Local: 10 days. Batch says: 15 days (bonus).
    // After sync: local should be 15.
  });

  it('flags a batch balance lower than our committed balance for manual review', async () => {
    // Local: 10 days, 3 locked (pending request).
    // Batch says: 2 days — would make pending request invalid.
    // Should NOT silently overwrite. Should create BALANCE_CONFLICT SyncEvent.
  });

  it('updates balance when batch value is lower but covers all pending requests', async () => {
    // Local: 10, locked: 2. Batch says: 5. Still covers the 2 locked — safe to apply.
  });
});