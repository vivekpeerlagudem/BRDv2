/**
 * Facts pack of the Weekly Sales Brief: the only material the AI model may write from. Every fact that may be
 * cited has an `id` (`metric:S-xx`, `signal:N`, `deal:<id>`, `user:<id>`, `period`); the checks accept no other
 * source. The brief is internal (leadership only), so rep and deal names are included. Free text typed by people
 * (deal names, lost reasons, lead sources) is sanitized and shortened.
 */
import type { SalesMetricsDoc, SalesSignal } from '../../db/schema-sales-brief.ts';
import { type AiContext, estimateTokens, sanitizeText } from '../ai/context.ts';
import { periodLabel } from '../weekly-reports/period.ts';
import type { SalesSnapshot } from './collect.ts';

const clean = (text: string) => sanitizeText(text, 120);

export function buildSalesFacts(s: SalesSnapshot, doc: SalesMetricsDoc, signals: SalesSignal[]): AiContext {
  const cited = new Set(signals.flatMap((x) => x.recordIds));
  const deals = new Map<string, Record<string, unknown>>();
  const addDeal = (dealId: string, fact: Record<string, unknown>) => {
    if (!deals.has(dealId)) deals.set(dealId, { id: `deal:${dealId}`, ...fact });
  };
  for (const d of doc.wonDeals) addDeal(d.dealId, { name: clean(d.name), owner: d.owner, status: 'won', amount: d.amount, cycleDays: d.cycleDays });
  for (const d of doc.lostDeals) addDeal(d.dealId, { name: clean(d.name), owner: d.owner, status: 'lost', amount: d.amount, lostReason: clean(d.reason) });
  for (const d of doc.attention)
    addDeal(d.dealId, {
      name: clean(d.name),
      owner: d.owner,
      status: 'open',
      stage: d.stage,
      amount: d.amount,
      needsAttention: d.reasons.map((r) => (r === 'overdue' ? 'past expected close date' : r === 'unviewed_proposal' ? 'proposal not viewed' : r)),
      daysInStage: d.daysInStage,
      daysSinceActivity: d.daysSinceActivity,
    });
  for (const d of s.openDeals)
    if (cited.has(`deal:${d.dealId}`))
      addDeal(d.dealId, { name: clean(d.name), owner: d.owner, status: 'open', stage: d.stage, amount: d.amount, daysInStage: d.daysInStage });

  const people = new Map<string, Record<string, unknown>>();
  for (const r of doc.reps)
    people.set(r.userId, {
      id: `user:${r.userId}`,
      name: r.name,
      openDeals: r.openDeals,
      openPipeline: r.openValue,
      dealsWon: r.won,
      dealsLost: r.lost,
      revenueWon: r.wonRevenue,
      winRate: r.winRate,
      calls: r.calls,
      meetings: r.meetings,
      tasksCompleted: r.tasksCompleted,
    });
  for (const u of s.users) if (cited.has(`user:${u.userId}`) && !people.has(u.userId)) people.set(u.userId, { id: `user:${u.userId}`, name: u.name });

  const facts: Record<string, unknown> = {
    organization: s.orgName,
    audience: 'company leadership (internal)',
    period: { id: 'period', start: s.period.start, end: s.period.end, label: periodLabel(s.period.start, s.period.end) },
    currency: s.currency,
    metrics: doc.metrics
      .filter((m) => m.value !== null)
      .map((m) => ({
        id: `metric:${m.id}`,
        label: m.label,
        value: m.value,
        unit: m.unit,
        lastWeek: m.lastWeek,
        changePercent: m.changePct,
        ...(m.mtd !== undefined ? { monthToDate: m.mtd } : {}),
        ...(m.qtd !== undefined ? { quarterToDate: m.qtd } : {}),
        ...(m.detail ? { detail: m.detail } : {}),
      })),
    funnel: doc.funnel.map((f) => ({ step: f.label, metric: `metric:${f.metricId}`, value: f.value, percentOfStepBefore: f.stepPct })),
    signals: signals.map((x) => ({
      id: x.id,
      kind: x.kind,
      severity: x.severity,
      finding: x.title,
      metrics: x.metricIds.map((m) => `metric:${m}`),
      records: x.recordIds,
    })),
    pipelineByStage: doc.pipelineByStage.filter((p) => p.count > 0).map((p) => ({ stage: p.stage, deals: p.count, value: p.value, weighted: p.weighted })),
    deals: [...deals.values()].slice(0, 30),
    lostReasons: doc.lostReasons.map((r) => ({ reason: clean(r.reason), deals: r.count })),
    team: [...people.values()],
    leadSources: doc.leadSources.map((x) => ({ source: clean(x.source), newLeads: x.created, converted: x.converted })),
  };
  return { facts, untrusted: [], refs: [{ type: 'sales_brief_run', id: s.runId }], estimatedTokens: estimateTokens(facts), omittedTexts: 0 };
}
