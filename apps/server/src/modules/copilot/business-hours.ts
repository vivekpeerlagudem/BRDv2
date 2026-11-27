/**
 * Company business calendar for accept-and-escalate timers (pure, unit-tested; no library).
 * Working time = the configured weekdays (1 = Monday … 7 = Sunday) between `start` and `end` in the organization's
 * time zone, minus admin-set holidays (local dates). The AI never decides timing: these functions do.
 */
export interface BusinessCalendar {
  workdays: number[];
  start: string; // HH:MM
  end: string; // HH:MM
  holidays: string[]; // YYYY-MM-DD, local dates
}

const MIN = 60_000;
const minutesOf = (hhmm: string) => {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
};

/** Wall-clock parts of an instant in a time zone. */
function local(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(instant)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  const y = parts.year as number;
  const mo = parts.month as number;
  const d = parts.day as number;
  const date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const weekday = ((new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7) + 1; // 1 = Monday
  return { date, weekday, minute: (parts.hour as number) * 60 + (parts.minute as number), second: parts.second as number, y, mo, d };
}

/** The instant at a local date and minute-of-day in a time zone (handles UTC offsets and DST changes). */
function instantAt(date: string, minute: number, timeZone: string): Date {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(y, mo - 1, d, Math.floor(minute / 60), minute % 60);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const l = local(new Date(guess), timeZone);
    const shown = Date.UTC(l.y, l.mo - 1, l.d, Math.floor(l.minute / 60), l.minute % 60);
    guess += wall - shown;
  }
  return new Date(guess);
}
const nextDate = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** The working window [from, to) of one local date, or null for a day off. */
function windowOf(date: string, cal: BusinessCalendar, timeZone: string): [Date, Date] | null {
  const weekday = ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
  if (!cal.workdays.includes(weekday) || cal.holidays.includes(date)) return null;
  const s = minutesOf(cal.start);
  const e = minutesOf(cal.end);
  if (e <= s) return null;
  return [instantAt(date, s, timeZone), instantAt(date, e, timeZone)];
}

/** `from` plus `hours` of working time. Starting outside working time counts from the next opening. */
export function addBusinessHours(from: Date, hours: number, cal: BusinessCalendar, timeZone: string): Date {
  let remaining = Math.round(hours * 60) * MIN;
  let date = local(from, timeZone).date;
  for (let i = 0; i < 400; i++) {
    const w = windowOf(date, cal, timeZone);
    if (w) {
      const start = Math.max(w[0].getTime(), from.getTime());
      const left = w[1].getTime() - start;
      if (left > 0) {
        if (remaining <= left) return new Date(start + remaining);
        remaining -= left;
      }
    }
    date = nextDate(date);
  }
  throw new Error('The business calendar has no working time');
}

/** Working minutes between two instants (0 when `to` is not after `from`). */
export function businessMinutesBetween(from: Date, to: Date, cal: BusinessCalendar, timeZone: string): number {
  if (to <= from) return 0;
  let total = 0;
  let date = local(from, timeZone).date;
  const last = local(to, timeZone).date;
  for (let i = 0; i < 400; i++) {
    const w = windowOf(date, cal, timeZone);
    if (w) {
      const s = Math.max(w[0].getTime(), from.getTime());
      const e = Math.min(w[1].getTime(), to.getTime());
      if (e > s) total += e - s;
    }
    if (date >= last) break;
    date = nextDate(date);
  }
  return Math.round(total / MIN);
}
