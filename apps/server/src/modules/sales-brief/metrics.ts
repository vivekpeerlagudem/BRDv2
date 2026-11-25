/**
 * Metrics of the Weekly Sales Brief (pure, decimal arithmetic). Every figure in the brief is computed here from
 * the snapshot — never by the AI model. Money is in the organization's default currency only, exactly as the
 * Reports page does it (amounts in another currency are left out, never mixed).
 *
 *   S-01 new leads · S-02 leads qualified · S-03 leads converted · S-04 lead conversion % = converted ÷ (converted +
 *   disqualified) · S-05 new opportunities · S-06 opportunities advanced · S-07 deals won · S-08 revenue won ·
 *   S-09 deals lost · S-10 win rate (Reports page definition: won ÷ closed, by count) · S-11 open pipeline (weighted
 *   in `detail`) · S-12 average sales cycle days of the week's won deals · S-13 deals needing attention ·
 *   S-14 proposals sent (viewed and signed in `detail`) · S-15 activity = calls + meetings + completed tasks ·
 *   S-16 reps in the rep table · S-17 sales velocity per day = (open deals × average won deal size × win rate) ÷
 *   average cycle days, with quarter-to-date averages; null when an input is missing.
 */
import { Decimal } from 'decimal.js';
import type { SalesFunnelStep, SalesMetric, SalesMetricsDoc, SalesRepRow, SalesUnit } from '../../db/schema-sales-brief.ts';
import type { SalesSnapshot, SalesWindow } from './collect.ts';

const num = (v: string | null): Decimal | null => (v === null ? null : new Decimal(v));
const fixed = (d: Decimal | null, places: number) => (d === null ? null : d.toFixed(places));
const pct = (part: number, whole: number) => (whole > 0 ? new Decimal(part).times(100).div(whole).toFixed(1) : null);
const average = (values: Decimal[]) => (values.length ? values.reduce((a, b) => a.plus(b), new Decimal(0)).div(values.length) : null);

/** Change against a reference in percent of the reference; null when the reference is 0 or unknown. */
export function changePct(value: string | null, reference: string | null): string | null {
  const v = num(value);
  const r = num(reference);
  if (v === null || r === null || r.isZero()) return null;
  return v.minus(r).times(100).div(r.abs()).toFixed(1);
}

export const metricOf = (doc: SalesMetricsDoc, id: string) => doc.metrics.find((m) => m.id === id);

/** `earlier`: metric documents of the briefs for the weeks before, newest first (at most 4 are used as the baseline). */
export function computeSalesMetrics(s: SalesSnapshot, earlier: SalesMetricsDoc[] = []): SalesMetricsDoc {
  const history = earlier.slice(0, 4);
  const PLACES: Record<SalesUnit, number> = { count: 1, money: 2, percent: 1, days: 1, money_per_day: 2 };
  /** Average of the earlier briefs when there are any (counts keep one decimal), otherwise last week. */
  const baselineOf = (id: string, unit: SalesUnit, lastWeek: string | null): string | null => {
    const past = history.map((d) => num(metricOf(d, id)?.value ?? null)).filter((d): d is Decimal => d !== null);
    return past.length ? (average(past) as Decimal).toFixed(PLACES[unit]) : lastWeek;
  };
  /** Figures that are "as of now" have no last-week window: the brief of the week before supplies it, when there is one. */
  const previousBrief = (id: string) => (history[0] ? (metricOf(history[0], id)?.value ?? null) : null);
  const metric = (
    id: string,
    label: string,
    unit: SalesUnit,
    value: string | null,
    lastWeek: string | null,
    extra: { mtd?: string | null; qtd?: string | null; detail?: string } = {},
  ): SalesMetric => ({ id, label, unit, value, lastWeek, changePct: changePct(value, lastWeek), baseline: baselineOf(id, unit, lastWeek), ...extra });
  const count = (id: string, label: string, pick: (w: SalesWindow) => number, toDate = false) =>
    metric(id, label, 'count', String(pick(s.week)), String(pick(s.lastWeek)), toDate ? { mtd: String(pick(s.mtd)), qtd: String(pick(s.qtd)) } : {});
  const conversion = (w: SalesWindow) => pct(w.leadsConverted, w.leadsConverted + w.leadsDisqualified);
  const rate = (w: SalesWindow) => (w.winRate === null ? null : new Decimal(w.winRate).toFixed(1));
  const activity = (w: SalesWindow) => w.calls + w.meetings + w.tasksCompleted;

  const cycles = s.wonDeals.map((d) => d.cycleDays).filter((d): d is number => d !== null);
  const cycle = fixed(average(cycles.map((d) => new Decimal(d))), 1);
  const qtdSizes = s.qtdWon.map((d) => num(d.amount)).filter((d): d is Decimal => d !== null);
  const qtdCycle = average(
    s.qtdWon
      .map((d) => d.cycleDays)
      .filter((d): d is number => d !== null)
      .map((d) => new Decimal(d)),
  );
  const avgSize = average(qtdSizes);
  const velocity =
    avgSize !== null && qtdCycle !== null && !qtdCycle.isZero() && s.qtd.winRate !== null && s.pipelineTotals.count > 0
      ? new Decimal(s.pipelineTotals.count).times(avgSize).times(s.qtd.winRate).div(100).div(qtdCycle).toFixed(2)
      : null;
  const stalled = s.attention.filter((a) => a.reasons.includes('stalled')).length;
  const overdue = s.attention.filter((a) => a.reasons.includes('overdue')).length;
  const unviewed = s.attention.filter((a) => a.reasons.includes('unviewed_proposal')).length;
  const topReasons = s.lostReasons
    .slice(0, 3)
    .map((r) => `${r.reason} ${r.count}`)
    .join(' · ');

  const reps: SalesRepRow[] = s.reps.map((r) => {
    const a = s.activity.find((x) => x.userId === r.userId);
    return {
      userId: r.userId,
      name: r.name,
      openDeals: r.openDeals,
      openValue: r.openValue,
      won: r.won,
      lost: r.lost,
      wonRevenue: r.wonRevenue,
      winRate: r.winRate,
      calls: a?.calls ?? 0,
      meetings: a?.meetings ?? 0,
      tasksCompleted: a?.tasksCompleted ?? 0,
    };
  });
  for (const a of s.activity)
    if (!reps.some((r) => r.userId === a.userId) && a.calls + a.meetings + a.tasksCompleted > 0)
      reps.push({
        userId: a.userId,
        name: a.name,
        openDeals: 0,
        openValue: '0.00',
        won: 0,
        lost: 0,
        wonRevenue: '0.00',
        winRate: null,
        calls: a.calls,
        meetings: a.meetings,
        tasksCompleted: a.tasksCompleted,
      });

  const metrics: SalesMetric[] = [
    count('S-01', 'New leads', (w) => w.leadsCreated, true),
    count('S-02', 'Leads qualified', (w) => w.leadsQualified),
    count('S-03', 'Leads converted', (w) => w.leadsConverted, true),
    metric('S-04', 'Lead conversion rate', 'percent', conversion(s.week), conversion(s.lastWeek)),
    count('S-05', 'New opportunities', (w) => w.dealsCreated, true),
    count('S-06', 'Opportunities advanced', (w) => w.dealsAdvanced),
    count('S-07', 'Deals won', (w) => w.won, true),
    metric('S-08', 'Revenue won', 'money', s.week.wonValue, s.lastWeek.wonValue, { mtd: s.mtd.wonValue, qtd: s.qtd.wonValue }),
    metric('S-09', 'Deals lost', 'count', String(s.week.lost), String(s.lastWeek.lost), topReasons ? { detail: topReasons } : {}),
    metric('S-10', 'Win rate', 'percent', rate(s.week), rate(s.lastWeek), { mtd: rate(s.mtd), qtd: rate(s.qtd) }),
    metric('S-11', 'Open pipeline', 'money', s.pipelineTotals.value, previousBrief('S-11'), {
      detail: `${s.pipelineTotals.count} open · weighted ${s.pipelineTotals.weighted}`,
    }),
    metric('S-12', 'Average sales cycle', 'days', cycle, previousBrief('S-12')),
    metric('S-13', 'Deals needing attention', 'count', String(s.attention.length), previousBrief('S-13'), {
      detail: `stalled ${stalled} · past close date ${overdue} · proposal not viewed ${unviewed}`,
    }),
    metric('S-14', 'Proposals sent', 'count', String(s.week.proposalsSent), String(s.lastWeek.proposalsSent), {
      detail: `sent ${s.week.proposalsSent} · viewed ${s.week.proposalsViewed} · signed ${s.week.proposalsSigned}`,
    }),
    metric('S-15', 'Sales activity', 'count', String(activity(s.week)), String(activity(s.lastWeek)), {
      detail: `calls ${s.week.calls} · meetings ${s.week.meetings} · tasks completed ${s.week.tasksCompleted}`,
    }),
    metric('S-16', 'Reps with deals or activity', 'count', String(reps.length), previousBrief('S-16')),
    metric('S-17', 'Sales velocity per day', 'money_per_day', velocity, previousBrief('S-17')),
  ];

  // Throughput funnel: each step as a share of the step before it.
  const steps: [string, string, (w: SalesWindow) => number][] = [
    ['S-01', 'New leads', (w) => w.leadsCreated],
    ['S-02', 'Qualified', (w) => w.leadsQualified],
    ['S-03', 'Converted', (w) => w.leadsConverted],
    ['S-05', 'New opportunities', (w) => w.dealsCreated],
    ['S-07', 'Deals won', (w) => w.won],
  ];
  const funnel: SalesFunnelStep[] = steps.map(([metricId, label, pick], i) => {
    const before = steps[i - 1]?.[2];
    const past = history
      .map((d) => d.funnel.find((f) => f.metricId === metricId)?.stepPct ?? null)
      .filter((v): v is string => v !== null)
      .map((v) => new Decimal(v));
    return {
      metricId,
      label,
      value: pick(s.week),
      stepPct: before ? pct(pick(s.week), before(s.week)) : null,
      baselineStepPct: before ? (past.length ? (average(past) as Decimal).toFixed(1) : pct(pick(s.lastWeek), before(s.lastWeek))) : null,
    };
  });

  return {
    currency: s.currency,
    periodStart: s.period.start,
    periodEnd: s.period.end,
    metrics,
    funnel,
    pipelineByStage: s.pipelineByStage,
    pipelineTotals: s.pipelineTotals,
    wonDeals: s.wonDeals,
    lostDeals: s.lostDeals,
    lostReasons: s.lostReasons,
    reps,
    attention: s.attention,
    leadSources: s.leadSources,
  };
}
