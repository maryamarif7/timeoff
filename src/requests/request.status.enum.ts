export enum RequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  SYNCING = 'SYNCING',
}

export const VALID_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  [RequestStatus.PENDING]: [RequestStatus.APPROVED, RequestStatus.REJECTED, RequestStatus.CANCELLED],
  [RequestStatus.APPROVED]: [RequestStatus.SYNCING, RequestStatus.CANCELLED],
  [RequestStatus.SYNCING]: [RequestStatus.APPROVED, RequestStatus.CANCELLED, RequestStatus.REJECTED],
  [RequestStatus.REJECTED]: [],
  [RequestStatus.CANCELLED]: [],
};

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}