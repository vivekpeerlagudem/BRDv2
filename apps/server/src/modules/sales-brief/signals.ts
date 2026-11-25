/**
 * Signals — the analysis layer of the Weekly Sales Brief (pure, deterministic). Code decides what is notable; the
 * AI model may only explain these findings and suggest actions for them. Each signal names the metrics and the
 * records it is based on, so every insight in the brief can be traced back to evidence.
 *
 * Rules (thresholds in THRESHOLDS):
 *   trend          a headline figure moved ≥ 20 % against its baseline (earlier briefs, else last week); only the
 *                  3 largest moves are kept, so trends never crowd out the other findings
 *   bottleneck     the funnel step that fell furthest behind its baseline (≥ 10 points), or the weakest step
 *   concentration  one deal is > 40 % of the open pipeline, or one rep holds > 50 % of it
 *   risk           ≥ 2 stalled deals in one stage · deals past their stage time limit · more deals past their
 *                  expected close date than before the week · proposals sent but not viewed
 *   team           a rep with open deals and no logged activity in the week
 *   opportunity    the lead source that converted best
 * At most 8 signals are kept, ranked by severity.
 */
import { Decimal } from 'decimal.js';
import type { SalesMetricsDoc, SalesSignal, SalesSignalKind } from '../../db/schema-sales-brief.ts';
import type { SalesSnapshot } from './collect.ts';
import { changePct, metricOf } from './metrics.ts';

export const THRESHOLDS = {
  trendPct: 20,
  strongTrendPct: 50,
  funnelDropPoints: 10,
  weakStepPct: 50,
  dealSharePct: 40,
  repSharePct: 50,
  stalledCluster: 2,
  maxSignals: 8,
  maxTrends: 3,
};
const TREND_METRICS = ['S-01', 'S-05', 'S-07', 'S-08', 'S-10', 'S-14', 'S-15', 'S-17'];
const KEY_RESULTS = ['S-07', 'S-08', 'S-10'];
const SEVERITY = { high: 0, medium: 1, low: 2 };
const KIND_ORDER: SalesSignalKind[] = ['risk', 'bottleneck', 'concentration', 'team', 'trend', 'opportunity'];
type Draft = Omit<SalesSignal, 'id'>;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const names = (list: string[], max = 3) => (list.length > max ? `${list.slice(0, max).join(', ')} and ${list.length - max} more` : list.join(', '));

export function computeSignals(s: SalesSnapshot, doc: SalesMetricsDoc): SalesSignal[] {
  const out: Draft[] = [];
  const trends: Draft[] = [];

  // ── trend: headline figures against their baseline ─────────────────────────────────────────────────────────────
  for (const id of TREND_METRICS) {
    const m = metricOf(doc, id);
    if (!m || m.value === null || m.baseline === null) continue;
    const change = changePct(m.value, m.baseline);
    const value = new Decimal(m.value);
    if (change === null) {
      if (new Decimal(m.baseline).isZero() && value.gt(0))
        trends.push({
          kind: 'trend',
          severity: 'low',
          title: `${m.label} is ${m.value}, up from 0 in the comparison period.`,
          metricIds: [id],
          recordIds: [],
          values: { value: m.value, baseline: m.baseline, changePct: null },
        });
      continue;
    }
    const size = new Decimal(change).abs();
    if (size.lt(THRESHOLDS.trendPct)) continue;
    const down = new Decimal(change).lt(0);
    const strong = size.gte(THRESHOLDS.strongTrendPct);
    trends.push({
      kind: 'trend',
      severity: down ? (strong && KEY_RESULTS.includes(id) ? 'high' : 'medium') : strong ? 'medium' : 'low',
      title: `${m.label} ${down ? 'fell' : 'rose'} ${size.toFixed(1)}% against the comparison period (${m.value} now, ${m.baseline} before).`,
      metricIds: [id],
      recordIds: [],
      values: { value: m.value, baseline: m.baseline, changePct: change },
    });
  }

  const size = (d: Draft) => Math.abs(Number(d.values.changePct ?? 0));
  out.push(...trends.sort((a, b) => size(b) - size(a)).slice(0, THRESHOLDS.maxTrends));

  // ── bottleneck: the funnel step furthest behind its baseline, else the weakest step ────────────────────────────
  // Only real conversion steps count: a step above 100 % (for example more new opportunities than converted leads,
  // because reps also open opportunities directly) is not a share of the step before and cannot be a bottleneck.
  const isShare = (v: string | null) => v === null || new Decimal(v).lte(100);
  const stepsWithPct = doc.funnel.filter((f) => f.stepPct !== null && isShare(f.stepPct) && isShare(f.baselineStepPct));
  const drops = stepsWithPct
    .filter((f) => f.baselineStepPct !== null)
    .map((f) => ({ f, drop: new Decimal(f.baselineStepPct as string).minus(f.stepPct as string) }))
    .filter((x) => x.drop.gte(THRESHOLDS.funnelDropPoints))
    .sort((a, b) => b.drop.cmp(a.drop));
  const previousStep = (metricId: string) => doc.funnel[doc.funnel.findIndex((f) => f.metricId === metricId) - 1];
  const worst = drops[0];
  if (worst) {
    const before = previousStep(worst.f.metricId);
    out.push({
      kind: 'bottleneck',
      severity: worst.drop.gte(25) ? 'high' : 'medium',
      title: `The step from ${before?.label ?? 'the step before'} to ${worst.f.label} converted ${worst.f.stepPct}% this week against ${worst.f.baselineStepPct}% before.`,
      metricIds: [before?.metricId, worst.f.metricId].filter((x): x is string => Boolean(x)),
      recordIds: [],
      values: { stepPct: worst.f.stepPct, baselineStepPct: worst.f.baselineStepPct, dropPoints: worst.drop.toFixed(1) },
    });
  } else {
    const weak = stepsWithPct
      .filter((f) => (previousStep(f.metricId)?.value ?? 0) >= 3 && new Decimal(f.stepPct as string).lt(THRESHOLDS.weakStepPct))
      .sort((a, b) => new Decimal(a.stepPct as string).cmp(b.stepPct as string))[0];
    if (weak) {
      const before = previousStep(weak.metricId);
      out.push({
        kind: 'bottleneck',
        severity: 'medium',
        title: `The weakest funnel step is ${before?.label ?? 'the step before'} to ${weak.label}: ${weak.stepPct}% (${weak.value} of ${before?.value ?? 0}).`,
        metricIds: [before?.metricId, weak.metricId].filter((x): x is string => Boolean(x)),
        recordIds: [],
        values: { stepPct: weak.stepPct, value: weak.value, before: before?.value ?? 0 },
      });
    }
  }

  // ── concentration: one deal or one rep carries too much of the open pipeline ───────────────────────────────────
  const total = new Decimal(s.pipelineTotals.value);
  if (total.gt(0)) {
    const share = (amount: string) => new Decimal(amount).times(100).div(total);
    const big = s.openDeals.find((d) => d.amount !== null && share(d.amount).gt(THRESHOLDS.dealSharePct));
    if (big?.amount)
      out.push({
        kind: 'concentration',
        severity: share(big.amount).gt(60) ? 'high' : 'medium',
        title: `One deal, ${big.name} (${big.owner}), is ${share(big.amount).toFixed(1)}% of the open pipeline (${big.amount} of ${s.pipelineTotals.value}).`,
        metricIds: ['S-11'],
        recordIds: [`deal:${big.dealId}`, `user:${big.ownerId}`],
        values: { amount: big.amount, pipeline: s.pipelineTotals.value, sharePct: share(big.amount).toFixed(1) },
      });
    const top = [...s.pipelineByOwner].sort((a, b) => new Decimal(b.value).cmp(a.value))[0];
    if (top && s.pipelineByOwner.filter((p) => p.count > 0).length > 1 && share(top.value).gt(THRESHOLDS.repSharePct))
      out.push({
        kind: 'concentration',
        severity: 'medium',
        title: `${top.owner} holds ${share(top.value).toFixed(1)}% of the open pipeline (${top.value} of ${s.pipelineTotals.value}, ${plural(top.count, 'deal')}).`,
        metricIds: ['S-11', 'S-16'],
        recordIds: [`user:${top.ownerId}`],
        values: { value: top.value, pipeline: s.pipelineTotals.value, sharePct: share(top.value).toFixed(1), deals: top.count },
      });
  }

  // ── risk: stalled clusters, deals over their stage time limit, close-date slippage, unviewed proposals ────────
  const stalled = s.attention.filter((a) => a.reasons.includes('stalled'));
  const clustered = new Set<string>();
  for (const stage of [...new Set(stalled.map((a) => a.stage))]) {
    const deals = stalled.filter((a) => a.stage === stage);
    if (deals.length < THRESHOLDS.stalledCluster) continue;
    for (const d of deals) clustered.add(d.dealId);
    out.push({
      kind: 'risk',
      severity: 'high',
      title: `${plural(deals.length, 'deal')} are stalled in ${stage}: ${names(deals.map((d) => `${d.name} (${d.owner}, ${d.daysSinceActivity} days without activity)`))}.`,
      metricIds: ['S-13'],
      recordIds: deals.flatMap((d) => [`deal:${d.dealId}`, `user:${d.ownerId}`]),
      values: { stage, deals: deals.length },
    });
  }
  const aging = s.openDeals.filter(
    (d) => d.daysInStage !== null && d.stallThresholdDays !== null && d.daysInStage > d.stallThresholdDays && !clustered.has(d.dealId),
  );
  if (aging.length)
    out.push({
      kind: 'risk',
      severity: 'medium',
      title: `${plural(aging.length, 'open deal')} ${aging.length === 1 ? 'has' : 'have'} been in the same stage longer than the stage time limit: ${names(aging.map((d) => `${d.name} (${d.stage}, ${d.daysInStage} days, limit ${d.stallThresholdDays})`))}.`,
      metricIds: ['S-13'],
      recordIds: aging.flatMap((d) => [`deal:${d.dealId}`, `user:${d.ownerId}`]),
      values: { deals: aging.length },
    });
  const pastClose = s.attention.filter((a) => a.reasons.includes('overdue'));
  if (pastClose.length > s.pastCloseBeforeWeek)
    out.push({
      kind: 'risk',
      severity: 'medium',
      title: `Deals past their expected close date rose from ${s.pastCloseBeforeWeek} to ${pastClose.length}: ${names(pastClose.map((d) => `${d.name} (${d.owner})`))}.`,
      metricIds: ['S-13'],
      recordIds: pastClose.flatMap((d) => [`deal:${d.dealId}`, `user:${d.ownerId}`]),
      values: { before: s.pastCloseBeforeWeek, now: pastClose.length },
    });
  const unviewed = s.attention.filter((a) => a.reasons.includes('unviewed_proposal'));
  if (unviewed.length)
    out.push({
      kind: 'risk',
      severity: 'medium',
      title: `${plural(unviewed.length, 'proposal')} sent more than ${s.followUpAfterDays} days ago ${unviewed.length === 1 ? 'has' : 'have'} not been viewed: ${names(unviewed.map((d) => `${d.name} (${d.owner})`))}.`,
      metricIds: ['S-14'],
      recordIds: unviewed.flatMap((d) => [`deal:${d.dealId}`, `user:${d.ownerId}`]),
      values: { proposals: unviewed.length, followUpAfterDays: s.followUpAfterDays },
    });

  // ── team: open deals but no logged activity in the week ────────────────────────────────────────────────────────
  for (const r of doc.reps.filter((x) => x.openDeals > 0 && x.calls + x.meetings + x.tasksCompleted === 0))
    out.push({
      kind: 'team',
      severity: 'medium',
      title: `${r.name} has ${plural(r.openDeals, 'open deal')} worth ${r.openValue} and logged no calls, meetings or completed tasks this week.`,
      metricIds: ['S-15', 'S-16'],
      recordIds: [`user:${r.userId}`],
      values: { openDeals: r.openDeals, openValue: r.openValue },
    });

  // ── opportunity: the lead source that converted best ───────────────────────────────────────────────────────────
  const best = [...s.leadSources].filter((x) => x.converted > 0).sort((a, b) => b.converted - a.converted || a.created - b.created)[0];
  if (best)
    out.push({
      kind: 'opportunity',
      severity: 'low',
      title: `The lead source "${best.source}" converted best this week: ${plural(best.converted, 'lead')} converted, ${best.created} new.`,
      metricIds: ['S-01', 'S-03'],
      recordIds: [],
      values: { source: best.source, converted: best.converted, created: best.created },
    });

  return out
    .map((signal, i) => ({ signal, i }))
    .sort(
      (a, b) => SEVERITY[a.signal.severity] - SEVERITY[b.signal.severity] || KIND_ORDER.indexOf(a.signal.kind) - KIND_ORDER.indexOf(b.signal.kind) || a.i - b.i,
    )
    .slice(0, THRESHOLDS.maxSignals)
    .map(({ signal }, i) => ({ id: `signal:${i + 1}`, ...signal }));
}
