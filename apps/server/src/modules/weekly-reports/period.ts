/**
 * Reporting period for Weekly Report Agents — pure functions, no date library (same Intl approach as reporting.ts).
 * The week is Monday 00:00 to Sunday 23:59:59.999 in the organization time zone.
 */
export interface WeeklyPeriod {
  /** Calendar dates in the organization time zone, YYYY-MM-DD. */
  periodStart: string;
  periodEnd: string;
  /** The same boundaries as instants. */
  startInstant: Date;
  endInstant: Date;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekday: number;
}
const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function localParts(at: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAYS[get('weekday')] ?? 1,
  };
}

/** Offset of the zone at an instant, in milliseconds (local wall clock minus UTC). */
function offsetMs(at: Date, timeZone: string): number {
  const p = localParts(at, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at.getTime() / 1000) * 1000;
}
/** The instant of local midnight on a calendar date (two passes, so days around a clock change are right). */
function localMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const wall = Date.UTC(year, month - 1, day);
  const first = new Date(wall - offsetMs(new Date(wall), timeZone));
  return new Date(wall - offsetMs(first, timeZone));
}
const isoDate = (utcMidnight: number) => new Date(utcMidnight).toISOString().slice(0, 10);
const DAY = 86_400_000;

/** The last complete Monday–Sunday week before `now`, in the given time zone. */
export function lastFullWeek(now: Date, timeZone: string): WeeklyPeriod {
  const p = localParts(now, timeZone);
  const thisMonday = Date.UTC(p.year, p.month - 1, p.day) - (p.weekday - 1) * DAY;
  const start = new Date(thisMonday - 7 * DAY);
  const next = new Date(thisMonday);
  return {
    periodStart: isoDate(thisMonday - 7 * DAY),
    periodEnd: isoDate(thisMonday - DAY),
    startInstant: localMidnight(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate(), timeZone),
    endInstant: new Date(localMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone).getTime() - 1),
  };
}

/** Instants for a stored period (dates are local calendar dates in `timeZone`). */
export function periodInstants(periodStart: string, periodEnd: string, timeZone: string): { startInstant: Date; endInstant: Date } {
  const [y, m, d] = periodStart.split('-').map(Number) as [number, number, number];
  const after = new Date(Date.parse(`${periodEnd}T00:00:00Z`) + DAY);
  return {
    startInstant: localMidnight(y, m, d, timeZone),
    endInstant: new Date(localMidnight(after.getUTCFullYear(), after.getUTCMonth() + 1, after.getUTCDate(), timeZone).getTime() - 1),
  };
}

/**
 * True once the weekly run time has passed in the current Monday–Sunday week: from `runWeekday` at `runTime`
 * (local) until the end of that week. The scheduler inserts at most one scheduled run per company and period,
 * so being "due" for the rest of the week also catches up after downtime.
 */
export function isDue(now: Date, timeZone: string, runWeekday: number, runTime: string): boolean {
  const p = localParts(now, timeZone);
  if (p.weekday !== runWeekday) return p.weekday > runWeekday;
  const [h, m] = runTime.split(':').map(Number);
  return p.hour * 60 + p.minute >= (h ?? 9) * 60 + (m ?? 0);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "16–22 Nov 2026", "30 Nov – 6 Dec 2026", "28 Dec 2026 – 3 Jan 2027". */
export function periodLabel(periodStart: string, periodEnd: string): string {
  const [ys, ms, ds] = periodStart.split('-').map(Number) as [number, number, number];
  const [ye, me, de] = periodEnd.split('-').map(Number) as [number, number, number];
  if (ys !== ye) return `${ds} ${MONTHS[ms - 1]} ${ys} – ${de} ${MONTHS[me - 1]} ${ye}`;
  if (ms !== me) return `${ds} ${MONTHS[ms - 1]} – ${de} ${MONTHS[me - 1]} ${ye}`;
  return `${ds}–${de} ${MONTHS[me - 1]} ${ye}`;
}
