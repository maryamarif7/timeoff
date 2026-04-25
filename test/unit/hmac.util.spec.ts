import { computeHmac, verifyHmac } from '../../src/common/utils/hmac.util';

describe('HMAC utility', () => {
  const secret = 'test-secret';
  const payload = '{"employeeId":"emp-1","balance":10}';

  it('computeHmac returns a hex string', () => {
    const result = computeHmac(secret, payload);
    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  it('same inputs always produce the same signature', () => {
    expect(computeHmac(secret, payload)).toBe(computeHmac(secret, payload));
  });

  it('different secrets produce different signatures', () => {
    expect(computeHmac('secret1', payload)).not.toBe(computeHmac('secret2', payload));
  });

  it('different payloads produce different signatures', () => {
    expect(computeHmac(secret, 'payload1')).not.toBe(computeHmac(secret, 'payload2'));
  });

  it('verifyHmac returns true for a matching signature', () => {
    const sig = computeHmac(secret, payload);
    expect(verifyHmac(secret, payload, sig)).toBe(true);
  });

  it('verifyHmac returns false for a tampered payload', () => {
    const sig = computeHmac(secret, payload);
    expect(verifyHmac(secret, 'tampered', sig)).toBe(false);
  });

  it('verifyHmac returns false for a wrong secret', () => {
    const sig = computeHmac(secret, payload);
    expect(verifyHmac('wrong-secret', payload, sig)).toBe(false);
  });

  it('verifyHmac returns false for an empty signature', () => {
    expect(verifyHmac(secret, payload, '')).toBe(false);
  });

  it('verifyHmac returns false for a garbage signature', () => {
    expect(verifyHmac(secret, payload, 'notahexsig')).toBe(false);
  });
});