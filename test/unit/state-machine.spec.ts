import { RequestStatus, canTransition, VALID_TRANSITIONS } from '../../src/requests/request.status.enum';

describe('State machine — canTransition', () => {
  describe('Valid transitions', () => {
    const valid: [RequestStatus, RequestStatus][] = [
      [RequestStatus.PENDING,  RequestStatus.APPROVED],
      [RequestStatus.PENDING,  RequestStatus.REJECTED],
      [RequestStatus.PENDING,  RequestStatus.CANCELLED],
      [RequestStatus.APPROVED, RequestStatus.SYNCING],
      [RequestStatus.APPROVED, RequestStatus.CANCELLED],
      [RequestStatus.SYNCING,  RequestStatus.APPROVED],
      [RequestStatus.SYNCING,  RequestStatus.CANCELLED],
      [RequestStatus.SYNCING,  RequestStatus.REJECTED],
    ];
    it.each(valid)('allows %s → %s', (from, to) => {
      expect(canTransition(from, to)).toBe(true);
    });
  });

  describe('Forbidden transitions', () => {
    const forbidden: [RequestStatus, RequestStatus][] = [
      [RequestStatus.APPROVED,  RequestStatus.PENDING],
      [RequestStatus.REJECTED,  RequestStatus.APPROVED],
      [RequestStatus.REJECTED,  RequestStatus.PENDING],
      [RequestStatus.REJECTED,  RequestStatus.CANCELLED],
      [RequestStatus.CANCELLED, RequestStatus.PENDING],
      [RequestStatus.CANCELLED, RequestStatus.APPROVED],
      [RequestStatus.CANCELLED, RequestStatus.SYNCING],
    ];
    it.each(forbidden)('forbids %s → %s', (from, to) => {
      expect(canTransition(from, to)).toBe(false);
    });
  });

  it('all terminal states have no outgoing transitions', () => {
    expect(VALID_TRANSITIONS[RequestStatus.REJECTED]).toHaveLength(0);
    expect(VALID_TRANSITIONS[RequestStatus.CANCELLED]).toHaveLength(0);
  });

  it('returns false for unknown status', () => {
    expect(canTransition('UNKNOWN' as any, RequestStatus.APPROVED)).toBe(false);
  });
});