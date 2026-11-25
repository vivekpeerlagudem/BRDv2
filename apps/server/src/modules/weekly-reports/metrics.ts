/**
 * Metrics (pure, deterministic): every figure in a weekly report is computed here by code — never by the AI model.
 * Hours and percentages use decimal arithmetic and are stored as strings; rounding happens once, here.
 *
 * "Overdue" and "due in the next 7 days" are measured from the end of the reporting week, so a report for a past
 * week always gives the same numbers whenever it is generated.
 */
import { Decimal } from 'decimal.js';
import type { HealthLevel, WeeklyItemState, WeeklyMetric, WeeklyMetricsDoc, WeeklyPhaseRow } from '../../db/schema-weekly-reports.ts';
import { type MatchedItem, normalizeTitle } from './match.ts';

export interface MetricsInput {
  matched: MatchedItem[];
  /** All CRM tasks related to the company, its contacts and its deals. */
  tasks: { id: string; title: string; status: 'open' | 'completed' | 'cancelled'; dueAt: string }[];
  /** Calls and meetings inside the period. */
  activities: { id: string }[];
  startInstant: Date;
  endInstant: Date;
  /** Metrics of the latest earlier report (approved, else ready), or null for the first report. */
  previous: WeeklyMetricsDoc | null;
}

const hours = (d: Decimal) => d.toDecimalPlaces(2).toString();
const scopeRef = (rowId: string) => `scope:${rowId}`;
const itemKey = (i: { scopeId: string | null; title: string }) => (i.scopeId ? `id:${i.scopeId.toLowerCase()}` : `title:${normalizeTitle(i.title)}`);
export const metricValue = (doc: WeeklyMetricsDoc | null, id: string): string | null => doc?.metrics.find((m) => m.id === id)?.value ?? null;

export function computeMetrics(input: MetricsInput): WeeklyMetricsDoc {
  const { matched, previous } = input;
  const start = input.startInstant.getTime();
  const end = input.endInstant.getTime();
  const previousState = new Map((previous?.items ?? []).map((i) => [itemKey(i), i.state]));

  const items: WeeklyItemState[] = matched.map((m) => {
    const doneAt = m.state === 'done' ? m.doneAt : null;
    const inPeriod = doneAt !== null && Date.parse(doneAt) >= start && Date.parse(doneAt) <= end;
    // Rows decided by the sheet alone have no completion time: they count as "this week" when the previous
    // report saw them as not done. On the first report there is nothing to compare with, so they do not count.
    const before = previousState.get(itemKey(m.item));
    const newlyDone = m.state === 'done' && doneAt === null && before !== undefined && before !== 'done';
    return {
      rowId: m.item.id,
      rowNo: m.item.rowNo,
      scopeId: m.item.scopeId,
      title: m.item.title,
      phase: m.item.phase,
      estimateHours: hours(new Decimal(m.item.estimateHours)),
      actualHours: m.item.actualHours === null ? null : hours(new Decimal(m.item.actualHours)),
      state: m.state,
      doneAt,
      doneThisWeek: inPeriod || newlyDone,
      taskId: m.taskId,
      mismatch: m.mismatch,
    };
  });

  const sum = (rows: WeeklyItemState[]) => rows.reduce((t, r) => t.plus(r.estimateHours), new Decimal(0));
  const done = items.filter((i) => i.state === 'done');
  const inProgress = items.filter((i) => i.state === 'in_progress');
  const doneThisWeek = items.filter((i) => i.doneThisWeek);
  const total = sum(items);
  const doneHours = sum(done);
  const pct = (part: Decimal, whole: Decimal) => (whole.isZero() ? '0.0' : part.div(whole).times(100).toFixed(1));

  const withActual = done.filter((i) => i.actualHours !== null);
  const actual = withActual.reduce((t, r) => t.plus(r.actualHours as string), new Decimal(0));
  const estimateOfActual = sum(withActual);
  const overrun = withActual.length && !estimateOfActual.isZero() ? actual.minus(estimateOfActual).div(estimateOfActual).times(100).toFixed(1) : null;

  const overdue = matched.filter((m) => m.openTaskDueAt !== null && Date.parse(m.openTaskDueAt) < end);
  const overdueTaskIds = [...new Set(overdue.map((m) => m.taskId as string))];
  const upcoming = input.tasks
    .filter((t) => t.status === 'open' && Date.parse(t.dueAt) > end && Date.parse(t.dueAt) <= end + 7 * 86_400_000)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id));
  const unmatched = items.filter((i) => i.taskId === null);
  const mismatched = items.filter((i) => i.mismatch);

  const refs = (rows: WeeklyItemState[]) => rows.map((r) => scopeRef(r.rowId));
  const count = (id: string, label: string, n: number, sourceIds: string[], internal = false): WeeklyMetric => ({
    id,
    label,
    value: String(n),
    unit: 'count',
    sourceIds,
    ...(internal ? { internal: true } : {}),
  });
  const metrics: WeeklyMetric[] = [
    count('E-01', 'Scope items', items.length, refs(items)),
    { id: 'E-02', label: 'Total estimated hours', value: hours(total), unit: 'hours', sourceIds: refs(items) },
    count('E-03', 'Scope items completed', done.length, refs(done)),
    { id: 'E-04', label: 'Estimated hours completed', value: hours(doneHours), unit: 'hours', sourceIds: refs(done) },
    { id: 'E-05', label: 'Complete by estimate', value: pct(doneHours, total), unit: 'percent', sourceIds: refs(done) },
    count('E-06', 'Scope items completed this week', doneThisWeek.length, refs(doneThisWeek)),
    {
      id: 'E-07',
      label: 'Remaining estimated hours',
      value: hours(total.minus(doneHours)),
      unit: 'hours',
      sourceIds: refs(items.filter((i) => i.state !== 'done')),
    },
    count('E-08', 'Scope items in progress', inProgress.length, refs(inProgress)),
    { id: 'E-09', label: 'Actual versus estimated hours on completed items', value: overrun, unit: 'percent', sourceIds: refs(withActual) },
    count(
      'E-10',
      'Overdue tasks on scope items',
      overdueTaskIds.length,
      overdueTaskIds.map((id) => `task:${id}`),
    ),
    count(
      'A-01',
      'Calls and meetings this week',
      input.activities.length,
      input.activities.map((a) => `activity:${a.id}`),
    ),
    count(
      'A-02',
      'Tasks due in the next 7 days',
      upcoming.length,
      upcoming.map((t) => `task:${t.id}`),
    ),
    count('E-11', 'Scope items without a CRM task', unmatched.length, refs(unmatched), true),
    count('E-12', 'Sheet and CRM status mismatches', mismatched.length, refs(mismatched), true),
  ];

  // Week-over-week change against the previous report; null on the first report.
  for (const id of ['E-03', 'E-05', 'E-06']) {
    const m = metrics.find((x) => x.id === id) as WeeklyMetric;
    const before = metricValue(previous, id);
    m.delta =
      before === null || m.value === null ? null : id === 'E-05' ? new Decimal(m.value).minus(before).toFixed(1) : String(Number(m.value) - Number(before));
  }

  // Health (green / amber / red) with reason codes.
  const overrunPct = overrun === null ? null : Number(overrun);
  const previousDoneThisWeek = metricValue(previous, 'E-06');
  const red: string[] = [];
  const amber: string[] = [];
  if (overdueTaskIds.length > 3) red.push('OVERDUE_TASKS');
  else if (overdueTaskIds.length >= 1) amber.push('OVERDUE_TASKS');
  if (overrunPct !== null && overrunPct > 10) red.push('OVER_ESTIMATE');
  else if (overrunPct !== null && overrunPct >= 5) amber.push('OVER_ESTIMATE');
  if (doneThisWeek.length === 0 && previousDoneThisWeek !== null && Number(previousDoneThisWeek) === 0) red.push('NO_PROGRESS_TWO_WEEKS');
  else if (doneThisWeek.length === 0) amber.push('NO_ITEMS_DONE_THIS_WEEK');
  const level: HealthLevel = red.length ? 'red' : amber.length ? 'amber' : 'green';

  // Progress by phase, in the order phases first appear in the sheet.
  const phases: WeeklyPhaseRow[] = [];
  for (const name of [...new Set(items.map((i) => i.phase ?? 'General'))]) {
    const rows = items.filter((i) => (i.phase ?? 'General') === name);
    const phaseTotal = sum(rows);
    const phaseDone = sum(rows.filter((r) => r.state === 'done'));
    phases.push({ phase: name, items: rows.length, estimateHours: hours(phaseTotal), doneHours: hours(phaseDone), pct: pct(phaseDone, phaseTotal) });
  }

  return {
    metrics,
    health: { level, reasons: red.length ? [...red, ...amber] : amber },
    phases,
    items,
    upcomingTasks: upcoming.slice(0, 20).map((t) => ({ id: t.id, title: t.title, dueDate: t.dueAt.slice(0, 10) })),
  };
}
