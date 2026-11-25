import { describe, expect, it } from 'vitest';
import { type MatchItem, type MatchTask, matchItems } from './match.ts';
import { computeMetrics, metricValue } from './metrics.ts';
import { isDue, lastFullWeek, periodInstants, periodLabel } from './period.ts';

const at = (v: string) => new Date(v);

describe('weekly report period', () => {
  it('UTC: the last full Monday–Sunday week', () => {
    const p = lastFullWeek(at('2026-11-23T09:00:00Z'), 'UTC'); // a Monday
    expect(p.periodStart).toBe('2026-11-16');
    expect(p.periodEnd).toBe('2026-11-22');
    expect(p.startInstant.toISOString()).toBe('2026-11-16T00:00:00.000Z');
    expect(p.endInstant.toISOString()).toBe('2026-11-22T23:59:59.999Z');
    // Any day of the following week gives the same period.
    expect(lastFullWeek(at('2026-11-29T23:59:00Z'), 'UTC').periodStart).toBe('2026-11-16');
    expect(lastFullWeek(at('2026-11-30T00:00:00Z'), 'UTC').periodStart).toBe('2026-11-23');
  });

  it('Asia/Kolkata: boundaries are local midnights (+05:30)', () => {
    const p = lastFullWeek(at('2026-11-23T04:00:00Z'), 'Asia/Kolkata'); // Monday 09:30 local
    expect(p.periodStart).toBe('2026-11-16');
    expect(p.periodEnd).toBe('2026-11-22');
    expect(p.startInstant.toISOString()).toBe('2026-11-15T18:30:00.000Z');
    expect(p.endInstant.toISOString()).toBe('2026-11-22T18:29:59.999Z');
    // Sunday 22:00 UTC is already Monday in Kolkata, so the week has rolled over there.
    expect(lastFullWeek(at('2026-11-22T22:00:00Z'), 'Asia/Kolkata').periodStart).toBe('2026-11-16');
    expect(lastFullWeek(at('2026-11-22T22:00:00Z'), 'UTC').periodStart).toBe('2026-11-09');
  });

  it('America/New_York: a week containing the spring clock change is 167 hours long', () => {
    const p = lastFullWeek(at('2026-03-09T13:00:00Z'), 'America/New_York'); // Monday 09:00 EDT
    expect(p.periodStart).toBe('2026-03-02');
    expect(p.periodEnd).toBe('2026-03-08'); // clocks go forward on Sunday 8 March
    expect(p.startInstant.toISOString()).toBe('2026-03-02T05:00:00.000Z'); // EST, UTC-5
    expect(p.endInstant.toISOString()).toBe('2026-03-09T03:59:59.999Z'); // EDT, UTC-4
    expect(p.endInstant.getTime() - p.startInstant.getTime() + 1).toBe(167 * 3_600_000);
    expect(periodInstants('2026-03-02', '2026-03-08', 'America/New_York')).toEqual({ startInstant: p.startInstant, endInstant: p.endInstant });
  });

  it('isDue: from the run weekday and time until the end of that week', () => {
    expect(isDue(at('2026-11-23T08:59:00Z'), 'UTC', 1, '09:00')).toBe(false);
    expect(isDue(at('2026-11-23T09:00:00Z'), 'UTC', 1, '09:00')).toBe(true);
    expect(isDue(at('2026-11-29T12:00:00Z'), 'UTC', 1, '09:00')).toBe(true); // Sunday of the same week
    expect(isDue(at('2026-11-23T12:00:00Z'), 'UTC', 3, '09:00')).toBe(false); // Monday, run day is Wednesday
    expect(isDue(at('2026-11-25T09:00:00Z'), 'UTC', 3, '09:00')).toBe(true);
    expect(isDue(at('2026-11-23T03:29:00Z'), 'Asia/Kolkata', 1, '09:00')).toBe(false); // 08:59 local
    expect(isDue(at('2026-11-23T03:30:00Z'), 'Asia/Kolkata', 1, '09:00')).toBe(true); // 09:00 local
  });

  it('labels the period for people', () => {
    expect(periodLabel('2026-11-16', '2026-11-22')).toBe('16–22 Nov 2026');
    expect(periodLabel('2026-11-30', '2026-12-06')).toBe('30 Nov – 6 Dec 2026');
    expect(periodLabel('2026-12-28', '2027-01-03')).toBe('28 Dec 2026 – 3 Jan 2027');
  });
});

const item = (n: number, o: Partial<MatchItem> = {}): MatchItem => ({
  id: `row-${n}`,
  rowNo: n + 1,
  scopeId: `S-00${n}`,
  title: `Item ${n}`,
  phase: 'Build',
  estimateHours: '10',
  sheetStatus: null,
  pctDone: null,
  actualHours: null,
  ...o,
});
const task = (id: string, title: string, o: Partial<MatchTask> = {}): MatchTask => ({
  id,
  title,
  status: 'open',
  dueAt: '2026-11-30T00:00:00.000Z',
  completedAt: null,
  ...o,
});
const completed = (completedAt: string): Partial<MatchTask> => ({ status: 'completed', completedAt });

describe('weekly report matcher', () => {
  it('matches by "[scope id]" in the task title, case-insensitively', () => {
    const [m] = matchItems([item(1)], [task('t1', 'Kick-off [s-001] workshop', completed('2026-11-18T10:00:00.000Z'))]);
    expect(m).toMatchObject({ state: 'done', doneAt: '2026-11-18T10:00:00.000Z', taskId: 't1', mismatch: false });
  });

  it('falls back to an equal normalized title', () => {
    const [m] = matchItems([item(1, { scopeId: null, title: '  Solution   Design ' })], [task('t1', 'solution design')]);
    expect(m).toMatchObject({ state: 'in_progress', taskId: 't1', openTaskDueAt: '2026-11-30T00:00:00.000Z' });
  });

  it('an open matched task is in progress, or not started when the sheet says so', () => {
    expect(matchItems([item(1, { sheetStatus: 'in_progress' })], [task('t1', '[S-001] x')])[0]).toMatchObject({ state: 'in_progress', mismatch: false });
    expect(matchItems([item(1, { sheetStatus: 'not_started' })], [task('t1', '[S-001] x')])[0]).toMatchObject({ state: 'not_started', mismatch: false });
  });

  it('the CRM wins when sheet and CRM disagree, and the row is flagged', () => {
    const doneInCrm = matchItems([item(1, { sheetStatus: 'in_progress' })], [task('t1', '[S-001] x', completed('2026-11-18T10:00:00.000Z'))]);
    expect(doneInCrm[0]).toMatchObject({ state: 'done', mismatch: true });
    const openInCrm = matchItems([item(1, { sheetStatus: 'done' })], [task('t1', '[S-001] x')]);
    expect(openInCrm[0]).toMatchObject({ state: 'in_progress', mismatch: true });
  });

  it('unmatched rows use the sheet status, then % done, else not started', () => {
    const rows = matchItems(
      [item(1, { sheetStatus: 'done' }), item(2, { pctDone: '100' }), item(3, { pctDone: '40' }), item(4, { pctDone: '0' }), item(5)],
      [task('t9', 'Unrelated'), task('t8', '[S-005] cancelled', { status: 'cancelled' })],
    );
    expect(rows.map((r) => r.state)).toEqual(['done', 'done', 'in_progress', 'not_started', 'not_started']);
    expect(rows.every((r) => r.taskId === null && !r.mismatch)).toBe(true);
  });

  it('with several matching tasks an open one decides; otherwise the latest completion', () => {
    const tasks = [task('a', '[S-001] part 1', completed('2026-11-17T10:00:00.000Z')), task('b', '[S-001] part 2', completed('2026-11-19T10:00:00.000Z'))];
    expect(matchItems([item(1)], tasks)[0]).toMatchObject({ state: 'done', taskId: 'b', doneAt: '2026-11-19T10:00:00.000Z' });
    expect(matchItems([item(1)], [...tasks, task('c', '[S-001] part 3')])[0]).toMatchObject({ state: 'in_progress', taskId: 'c' });
  });
});

describe('weekly report metrics', () => {
  // Same shape as e2e/fixtures/estimates-sample.csv: 8 rows, 220 estimated hours.
  const sheet: MatchItem[] = [
    item(1, { title: 'Requirements workshop', phase: 'Discovery', estimateHours: '16', sheetStatus: 'done', pctDone: '100', actualHours: '16.5' }),
    item(2, { title: 'Solution design', phase: 'Discovery', estimateHours: '24', sheetStatus: 'in_progress', pctDone: '50' }),
    item(3, { title: 'ERP connector', phase: 'Build', estimateHours: '40', sheetStatus: 'in_progress', pctDone: '25' }),
    item(4, { title: 'Inventory sync', phase: 'Build', estimateHours: '32', sheetStatus: 'not_started', pctDone: '0' }),
    item(5, { title: 'Portal pages', phase: 'Build', estimateHours: '48', sheetStatus: 'not_started' }),
    item(6, { title: 'Integration tests', phase: 'Test', estimateHours: '24', sheetStatus: 'not_started' }),
    item(7, { title: 'UAT support', phase: 'Test', estimateHours: '16' }),
    item(8, { title: 'Go-live', phase: 'Launch', estimateHours: '20' }),
  ];
  const tasks: MatchTask[] = [
    task('t1', '[S-001] Run the workshop', { ...completed('2026-11-18T10:00:00.000Z'), dueAt: '2026-11-18T00:00:00.000Z' }),
    task('t2', '[S-002] Write the design', { dueAt: '2026-11-25T00:00:00.000Z' }),
    task('t3', 'Send the invoice reminder', { dueAt: '2026-12-05T00:00:00.000Z' }),
  ];
  const period = { startInstant: at('2026-11-16T00:00:00.000Z'), endInstant: at('2026-11-22T23:59:59.999Z') };
  const run = (o: Partial<Parameters<typeof computeMetrics>[0]> = {}) =>
    computeMetrics({ matched: matchItems(sheet, tasks), tasks, activities: [{ id: 'a1' }], ...period, previous: null, ...o });

  it('computes exact values on the sample sheet', () => {
    const doc = run();
    const v = (id: string) => metricValue(doc, id);
    expect(v('E-01')).toBe('8');
    expect(v('E-02')).toBe('220');
    expect(v('E-03')).toBe('1');
    expect(v('E-04')).toBe('16');
    expect(v('E-05')).toBe('7.3'); // 16 / 220
    expect(v('E-06')).toBe('1');
    expect(v('E-07')).toBe('204');
    expect(v('E-08')).toBe('2'); // S-002 (open CRM task) and S-003 (sheet says in progress)
    expect(v('E-09')).toBe('3.1'); // 16.5 actual against 16 estimated
    expect(v('E-10')).toBe('0'); // the S-002 task is due after the week ends
    expect(v('A-01')).toBe('1');
    expect(v('A-02')).toBe('1'); // t2 is due within 7 days of the week end; t3 is later
    expect(v('E-11')).toBe('6');
    expect(v('E-12')).toBe('0');
    expect(doc.metrics.filter((m) => m.internal).map((m) => m.id)).toEqual(['E-11', 'E-12']);
    expect(doc.metrics.find((m) => m.id === 'E-03')?.sourceIds).toEqual(['scope:row-1']);
    expect(doc.metrics.find((m) => m.id === 'E-05')?.delta).toBeNull(); // first report
    expect(doc.health).toEqual({ level: 'green', reasons: [] });
    expect(doc.phases).toEqual([
      { phase: 'Discovery', items: 2, estimateHours: '40', doneHours: '16', pct: '40.0' },
      { phase: 'Build', items: 3, estimateHours: '120', doneHours: '0', pct: '0.0' },
      { phase: 'Test', items: 2, estimateHours: '40', doneHours: '0', pct: '0.0' },
      { phase: 'Launch', items: 1, estimateHours: '20', doneHours: '0', pct: '0.0' },
    ]);
    expect(doc.upcomingTasks).toEqual([{ id: 't2', title: '[S-002] Write the design', dueDate: '2026-11-25' }]);
  });

  it('week-over-week deltas and sheet-only completions compare with the previous report', () => {
    const previous = run();
    const nextSheet = sheet.map((s) => (s.scopeId === 'S-004' ? { ...s, sheetStatus: 'done' as const } : s));
    const next = computeMetrics({
      matched: matchItems(nextSheet, tasks),
      tasks,
      activities: [],
      startInstant: at('2026-11-23T00:00:00.000Z'),
      endInstant: at('2026-11-29T23:59:59.999Z'),
      previous,
    });
    expect(metricValue(next, 'E-03')).toBe('2');
    expect(metricValue(next, 'E-06')).toBe('1'); // S-004 became done in the sheet; S-001 was done the week before
    expect(next.metrics.find((m) => m.id === 'E-03')?.delta).toBe('1');
    expect(next.metrics.find((m) => m.id === 'E-05')?.delta).toBe('14.5'); // 21.8 − 7.3
    expect(next.metrics.find((m) => m.id === 'E-06')?.delta).toBe('0');
    expect(metricValue(next, 'E-10')).toBe('1'); // t2 (due 25 Nov) is overdue at this week end
    expect(next.health).toEqual({ level: 'amber', reasons: ['OVERDUE_TASKS'] });
  });

  it('health: amber and red rules', () => {
    const nothingDone = run({ matched: matchItems(sheet, tasks.slice(1)) });
    expect(metricValue(nothingDone, 'E-06')).toBe('0');
    expect(nothingDone.health).toEqual({ level: 'amber', reasons: ['NO_ITEMS_DONE_THIS_WEEK'] });
    const again = run({ matched: matchItems(sheet, tasks.slice(1)), previous: nothingDone });
    expect(again.health).toEqual({ level: 'red', reasons: ['NO_PROGRESS_TWO_WEEKS'] });

    const first = sheet[0] as MatchItem;
    const overEstimate = run({ matched: matchItems([{ ...first, actualHours: '18' }, ...sheet.slice(1)], tasks) });
    expect(metricValue(overEstimate, 'E-09')).toBe('12.5');
    expect(overEstimate.health).toEqual({ level: 'red', reasons: ['OVER_ESTIMATE'] });

    const late = Array.from({ length: 4 }, (_, i) => task(`o${i}`, `[S-00${i + 3}] late`, { dueAt: '2026-11-10T00:00:00.000Z' }));
    const manyOverdue = run({ matched: matchItems(sheet, [...tasks, ...late]), tasks: [...tasks, ...late] });
    expect(metricValue(manyOverdue, 'E-10')).toBe('4');
    expect(manyOverdue.health).toEqual({ level: 'red', reasons: ['OVERDUE_TASKS'] });
  });

  it('an empty sheet does not divide by zero', () => {
    const doc = computeMetrics({ matched: [], tasks: [], activities: [], ...period, previous: null });
    expect(metricValue(doc, 'E-05')).toBe('0.0');
    expect(metricValue(doc, 'E-09')).toBeNull();
  });
});
