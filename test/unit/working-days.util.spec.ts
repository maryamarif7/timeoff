import { computeWorkingDays } from '../../src/common/utils/working-days.util';

describe('computeWorkingDays', () => {
  it('counts Mon–Fri as 5 working days', () => {
    expect(computeWorkingDays(new Date('2024-01-08'), new Date('2024-01-12'))).toBe(5);
  });

  it('counts Mon–Sun as 5 working days (excludes weekend)', () => {
    expect(computeWorkingDays(new Date('2024-01-08'), new Date('2024-01-14'))).toBe(5);
  });

  it('returns 0 for a Saturday-only range', () => {
    expect(computeWorkingDays(new Date('2024-01-06'), new Date('2024-01-06'))).toBe(0);
  });

  it('returns 0 for a weekend range', () => {
    expect(computeWorkingDays(new Date('2024-01-06'), new Date('2024-01-07'))).toBe(0);
  });

  it('counts a single weekday as 1', () => {
    expect(computeWorkingDays(new Date('2024-01-08'), new Date('2024-01-08'))).toBe(1);
  });

  it('returns 0 when end date is before start date', () => {
    expect(computeWorkingDays(new Date('2024-01-12'), new Date('2024-01-08'))).toBe(0);
  });

  it('excludes specified holiday dates', () => {
    const holiday = new Date('2024-01-08'); // Monday
    expect(computeWorkingDays(new Date('2024-01-08'), new Date('2024-01-12'), [holiday])).toBe(4);
  });

  it('excludes multiple holidays', () => {
    const holidays = [new Date('2024-01-08'), new Date('2024-01-10')];
    expect(computeWorkingDays(new Date('2024-01-08'), new Date('2024-01-12'), holidays)).toBe(3);
  });

  it('counts 2 weeks as 10 working days', () => {
    expect(computeWorkingDays(new Date('2024-01-08'), new Date('2024-01-19'))).toBe(10);
  });

  it('handles same-day Saturday correctly', () => {
    expect(computeWorkingDays(new Date('2024-01-13'), new Date('2024-01-13'))).toBe(0);
  });
});