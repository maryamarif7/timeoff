export function computeWorkingDays(
  startDate: Date,
  endDate: Date,
  holidays: Date[] = [],
): number {
  if (endDate < startDate) return 0;
  const holidaySet = new Set(holidays.map((d) => toIsoDate(d)));
  let count = 0;
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  while (current <= end) {
    const day = current.getDay();
    const iso = toIsoDate(current);
    if (day !== 0 && day !== 6 && !holidaySet.has(iso)) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

function toIsoDate(d: Date): string {
  return d.toISOString().split('T')[0];
}