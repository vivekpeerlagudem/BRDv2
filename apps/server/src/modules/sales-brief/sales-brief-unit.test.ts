/** Weekly Sales Brief — metrics, signals and the facts pack. Pure functions, no database. */
import { createVerify, generateKeyPairSync } from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { SalesBriefNarrative, SalesBriefStatement } from '../../db/schema-sales-brief.ts';
import { MockAiProvider } from '../../platform/mock-ai.ts';
import { FileOnlyPublisher, GoogleSheetsPublisher } from '../../platform/sales-brief-sheets.ts';
import { jsonSchemaOf, PROMPTS, renderUserMessage, salesBriefOutput } from '../ai/prompts.ts';
import { FALLBACK_TEXT } from '../weekly-reports/checks.ts';
import { allowedSourceIds } from '../weekly-reports/facts.ts';
import { BRIEF_LIMITS, checkBrief, composeBriefFlags } from './checks.ts';
import { monthAndQuarterStart, type SalesSnapshot, type SalesWindow } from './collect.ts';
import { briefFileName, buildBriefDeck, formatAmount, formatChange, formatMetric, renderBriefPptx } from './deck.ts';
import { buildSalesFacts } from './facts.ts';
import { changePct, computeSalesMetrics, metricOf } from './metrics.ts';
import { briefFallbackMessage, fallbackBrief } from './narrative.ts';
import { BRIEF_TABS, buildBriefTabs, renderBriefXlsx, safeText } from './sheet.ts';
import { computeSignals, THRESHOLDS } from './signals.ts';

const U = { cap: 'u-cap', spidey: 'u-spidey', widow: 'u-widow' };
const win = (o: Partial<SalesWindow>): SalesWindow => ({
  from: '2026-11-16',
  to: '2026-11-22',
  leadsCreated: 0,
  leadsQualified: 0,
  leadsConverted: 0,
  leadsDisqualified: 0,
  dealsCreated: 0,
  dealsAdvanced: 0,
  won: 0,
  lost: 0,
  wonValue: '0.00',
  winRate: null,
  proposalsSent: 0,
  proposalsViewed: 0,
  proposalsSigned: 0,
  calls: 0,
  meetings: 0,
  tasksCompleted: 0,
  ...o,
});
const rep = (userId: string, name: string, openDeals: number, openValue: string, won = 0, wonRevenue = '0.00') => ({
  userId,
  name,
  openDeals,
  openValue,
  won,
  lost: 0,
  wonRevenue,
  winRate: won ? 100 : null,
  avgDealSize: null,
  avgCycleDays: null,
});
const act = (userId: string, name: string, calls: number, meetings: number, tasksCompleted: number) => ({
  userId,
  name,
  calls,
  meetings,
  notes: 0,
  tasksCompleted,
});
const open = (dealId: string, name: string, ownerId: string, owner: string, stage: string, amount: string, daysInStage = 3, stallThresholdDays = 14) => ({
  dealId,
  name,
  ownerId,
  owner,
  stage,
  amount,
  daysInStage,
  stallThresholdDays,
});
const attn = (dealId: string, name: string, ownerId: string, owner: string, stage: string, reasons: string[], daysSinceActivity = 20) => ({
  dealId,
  name,
  owner,
  ownerId,
  stage,
  amount: '10000.00',
  reasons,
  daysInStage: 20,
  stallThresholdDays: 14,
  daysSinceActivity,
});

const snapshot = (o: Partial<SalesSnapshot> = {}): SalesSnapshot => ({
  schema: 1,
  runId: 'run-1',
  cutoff: '2026-11-23T13:00:00.000Z',
  orgName: 'Kensium',
  currency: 'USD',
  timeZone: 'UTC',
  followUpAfterDays: 3,
  period: { start: '2026-11-16', end: '2026-11-22' },
  week: win({
    leadsCreated: 10,
    leadsQualified: 5,
    leadsConverted: 3,
    leadsDisqualified: 1,
    dealsCreated: 6,
    dealsAdvanced: 4,
    won: 2,
    lost: 1,
    wonValue: '74000.00',
    winRate: 66.7,
    proposalsSent: 3,
    proposalsViewed: 2,
    proposalsSigned: 1,
    calls: 4,
    meetings: 3,
    tasksCompleted: 8,
  }),
  lastWeek: win({
    from: '2026-11-09',
    to: '2026-11-15',
    leadsCreated: 8,
    leadsQualified: 6,
    leadsConverted: 4,
    leadsDisqualified: 0,
    dealsCreated: 4,
    dealsAdvanced: 2,
    won: 1,
    lost: 0,
    wonValue: '30000.00',
    winRate: 100,
    proposalsSent: 2,
    proposalsViewed: 2,
    proposalsSigned: 1,
    calls: 6,
    meetings: 4,
    tasksCompleted: 10,
  }),
  mtd: win({ from: '2026-11-01', leadsCreated: 21, leadsConverted: 8, dealsCreated: 11, won: 3, wonValue: '104000.00', winRate: 75 }),
  qtd: win({ from: '2026-10-01', leadsCreated: 40, leadsConverted: 15, dealsCreated: 20, won: 5, wonValue: '180000.00', winRate: 62.5 }),
  pipelineByStage: [
    { stage: 'Qualification', count: 2, value: '30000.00', weighted: '6000.00' },
    { stage: 'Discovery', count: 3, value: '70000.00', weighted: '28000.00' },
    { stage: 'Negotiation', count: 1, value: '100000.00', weighted: '80000.00' },
  ],
  pipelineTotals: { count: 6, value: '200000.00', weighted: '114000.00' },
  pipelineByOwner: [
    { ownerId: U.cap, owner: 'Captain America', count: 2, value: '120000.00' },
    { ownerId: U.spidey, owner: 'Spider-Man', count: 3, value: '60000.00' },
    { ownerId: U.widow, owner: 'Black Widow', count: 1, value: '20000.00' },
  ],
  openDeals: [
    open('d-big', 'S.H.I.E.L.D. – Field reporting app', U.cap, 'Captain America', 'Negotiation', '100000.00'),
    open('d-old', 'Oscorp – Lab portal', U.spidey, 'Spider-Man', 'Qualification', '15000.00', 30, 14),
    open('d-s1', 'Pym – Sensor hub', U.widow, 'Black Widow', 'Discovery', '20000.00', 20, 14),
    open('d-s2', 'Hydra – Records', U.cap, 'Captain America', 'Discovery', '20000.00', 20, 14),
  ],
  reps: [
    rep(U.cap, 'Captain America', 2, '120000.00', 1, '52000.00'),
    rep(U.spidey, 'Spider-Man', 3, '60000.00', 1, '22000.00'),
    rep(U.widow, 'Black Widow', 1, '20000.00'),
  ],
  activity: [act(U.cap, 'Captain America', 2, 2, 5), act(U.spidey, 'Spider-Man', 2, 1, 3), act(U.widow, 'Black Widow', 0, 0, 0)],
  lostReasons: [{ reason: 'Price', count: 1 }],
  wonDeals: [
    { dealId: 'd-w1', name: 'Stark – ERP integration', owner: 'Captain America', ownerId: U.cap, amount: '52000.00', cycleDays: 30 },
    { dealId: 'd-w2', name: 'Wakanda – Inventory portal', owner: 'Spider-Man', ownerId: U.spidey, amount: '22000.00', cycleDays: 21 },
  ],
  lostDeals: [{ dealId: 'd-l1', name: 'Daily Bugle – Archive', owner: 'Spider-Man', ownerId: U.spidey, amount: '9000.00', reason: 'Price' }],
  qtdWon: [
    { amount: '52000.00', cycleDays: 30 },
    { amount: '22000.00', cycleDays: 21 },
    { amount: '30000.00', cycleDays: 39 },
  ],
  attention: [
    attn('d-s1', 'Pym – Sensor hub', U.widow, 'Black Widow', 'Discovery', ['stalled']),
    attn('d-s2', 'Hydra – Records', U.cap, 'Captain America', 'Discovery', ['stalled', 'overdue']),
    attn('d-p1', 'Stark – Phase 2', U.spidey, 'Spider-Man', 'Proposal sent', ['unviewed_proposal'], 6),
  ],
  pastCloseBeforeWeek: 0,
  leadSources: [
    { source: 'referral', created: 4, converted: 2 },
    { source: 'web form', created: 5, converted: 1 },
    { source: 'event', created: 1, converted: 0 },
  ],
  users: [
    { userId: U.cap, name: 'Captain America' },
    { userId: U.spidey, name: 'Spider-Man' },
    { userId: U.widow, name: 'Black Widow' },
  ],
  ...o,
});

describe('sales brief metrics', () => {
  const doc = computeSalesMetrics(snapshot());
  const value = (id: string) => metricOf(doc, id)?.value;

  it('computes S-01 … S-17 from the snapshot', () => {
    expect(Object.fromEntries(doc.metrics.map((m) => [m.id, m.value]))).toEqual({
      'S-01': '10',
      'S-02': '5',
      'S-03': '3',
      'S-04': '75.0', // 3 ÷ (3 + 1)
      'S-05': '6',
      'S-06': '4',
      'S-07': '2',
      'S-08': '74000.00',
      'S-09': '1',
      'S-10': '66.7',
      'S-11': '200000.00',
      'S-12': '25.5', // (30 + 21) ÷ 2
      'S-13': '3',
      'S-14': '3',
      'S-15': '15', // 4 + 3 + 8
      'S-16': '3',
      'S-17': '4333.33', // 6 open × 34666.67 average size × 62.5 % ÷ 30 days
    });
    expect(metricOf(doc, 'S-11')?.detail).toBe('6 open · weighted 114000.00');
    expect(metricOf(doc, 'S-13')?.detail).toBe('stalled 2 · past close date 1 · proposal not viewed 1');
    expect(metricOf(doc, 'S-14')?.detail).toBe('sent 3 · viewed 2 · signed 1');
    expect(metricOf(doc, 'S-09')?.detail).toBe('Price 1');
  });

  it('adds last week, the change, and month and quarter to date', () => {
    expect(metricOf(doc, 'S-01')).toMatchObject({ lastWeek: '8', changePct: '25.0', baseline: '8', mtd: '21', qtd: '40' });
    expect(metricOf(doc, 'S-08')).toMatchObject({ lastWeek: '30000.00', changePct: '146.7', mtd: '104000.00', qtd: '180000.00' });
    expect(metricOf(doc, 'S-10')).toMatchObject({ lastWeek: '100.0', changePct: '-33.3', mtd: '75.0', qtd: '62.5' });
    expect(metricOf(doc, 'S-04')).toMatchObject({ value: '75.0', lastWeek: '100.0' });
    expect(metricOf(doc, 'S-11')).toMatchObject({ lastWeek: null, changePct: null }); // "as of now": no earlier brief yet
    expect(changePct('5', '0')).toBeNull();
    expect(changePct(null, '4')).toBeNull();
  });

  it('builds the throughput funnel with each step as a share of the step before', () => {
    expect(doc.funnel.map((f) => [f.metricId, f.value, f.stepPct, f.baselineStepPct])).toEqual([
      ['S-01', 10, null, null],
      ['S-02', 5, '50.0', '75.0'],
      ['S-03', 3, '60.0', '66.7'],
      ['S-05', 6, '200.0', '100.0'],
      ['S-07', 2, '33.3', '25.0'],
    ]);
  });

  it('uses the average of earlier briefs as the baseline, and the brief before for "as of now" figures', () => {
    const earlier = [computeSalesMetrics(snapshot({ week: win({ leadsCreated: 6 }), pipelineTotals: { count: 4, value: '150000.00', weighted: '60000.00' } }))];
    const older = computeSalesMetrics(snapshot({ week: win({ leadsCreated: 4 }) }));
    const next = computeSalesMetrics(snapshot(), [...earlier, older]);
    expect(metricOf(next, 'S-01')).toMatchObject({ lastWeek: '8', baseline: '5.0' }); // (6 + 4) ÷ 2
    expect(metricOf(next, 'S-11')).toMatchObject({ lastWeek: '150000.00', changePct: '33.3' });
  });

  it('leaves figures empty when an input is missing, and never divides by zero', () => {
    const empty = computeSalesMetrics(snapshot({ week: win({}), wonDeals: [], qtdWon: [], qtd: win({}) }));
    expect(metricOf(empty, 'S-04')?.value).toBeNull();
    expect(metricOf(empty, 'S-10')?.value).toBeNull();
    expect(metricOf(empty, 'S-12')?.value).toBeNull();
    expect(metricOf(empty, 'S-17')?.value).toBeNull();
    expect(empty.funnel.every((f) => f.stepPct === null)).toBe(true);
    expect(value('S-17')).not.toBeNull();
  });

  it('merges activity into the rep table', () => {
    expect(doc.reps.find((r) => r.userId === U.cap)).toMatchObject({ openDeals: 2, won: 1, calls: 2, meetings: 2, tasksCompleted: 5 });
    const extra = computeSalesMetrics(snapshot({ activity: [act('u-new', 'Hawkeye', 3, 0, 0)] }));
    expect(extra.reps.find((r) => r.userId === 'u-new')).toMatchObject({ name: 'Hawkeye', openDeals: 0, calls: 3 });
  });

  it('finds the first day of the month and quarter', () => {
    expect(monthAndQuarterStart('2026-11-22')).toEqual({ month: '2026-11-01', quarter: '2026-10-01' });
    expect(monthAndQuarterStart('2027-01-03')).toEqual({ month: '2027-01-01', quarter: '2027-01-01' });
    expect(monthAndQuarterStart('2026-06-30')).toEqual({ month: '2026-06-01', quarter: '2026-04-01' });
  });
});

describe('sales brief signals', () => {
  const s = snapshot();
  const doc = computeSalesMetrics(s);
  const signals = computeSignals(s, doc);
  const find = (test: (title: string) => boolean) => signals.find((x) => test(x.title));

  it('ranks by severity, numbers the signals and keeps at most 8', () => {
    expect(signals.length).toBeLessThanOrEqual(THRESHOLDS.maxSignals);
    expect(signals.map((x) => x.id)).toEqual(signals.map((_, i) => `signal:${i + 1}`));
    const order = signals.map((x) => ({ high: 0, medium: 1, low: 2 })[x.severity]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(signals[0]).toMatchObject({ kind: 'risk', severity: 'high' });
  });

  it('risk: two or more stalled deals in one stage', () => {
    const x = find((t) => t.includes('stalled in Discovery'));
    expect(x).toMatchObject({ kind: 'risk', severity: 'high', metricIds: ['S-13'], values: { stage: 'Discovery', deals: 2 } });
    expect(x?.recordIds).toEqual(['deal:d-s1', `user:${U.widow}`, 'deal:d-s2', `user:${U.cap}`]);
    expect(
      computeSignals(snapshot({ attention: [s.attention[0] as SalesSnapshot['attention'][number]] }), doc).some((y) => y.title.includes('stalled in')),
    ).toBe(false);
  });

  it('names each piece of evidence once, even when one rep owns several of the flagged deals', () => {
    const sameOwner = snapshot({ attention: s.attention.map((a) => ({ ...a, ownerId: U.cap, owner: 'Captain America' })) });
    for (const x of computeSignals(sameOwner, computeSalesMetrics(sameOwner))) expect(new Set(x.recordIds).size).toBe(x.recordIds.length);
    const cluster = computeSignals(sameOwner, computeSalesMetrics(sameOwner)).find((x) => x.title.includes('stalled in Discovery'));
    expect(cluster?.recordIds).toEqual(['deal:d-s1', `user:${U.cap}`, 'deal:d-s2']);
  });

  it('risk: open deals over their stage time limit (not repeated when already in a stalled cluster)', () => {
    const x = find((t) => t.includes('longer than the stage time limit'));
    expect(x).toMatchObject({ kind: 'risk', severity: 'medium', values: { deals: 1 } });
    expect(x?.recordIds).toEqual(['deal:d-old', `user:${U.spidey}`]);
    expect(x?.title).toContain('Oscorp – Lab portal (Qualification, 30 days, limit 14)');
  });

  it('risk: more deals past their expected close date than before the week', () => {
    expect(find((t) => t.startsWith('Deals past their expected close date rose from 0 to 1'))).toMatchObject({
      kind: 'risk',
      recordIds: ['deal:d-s2', `user:${U.cap}`],
    });
    expect(computeSignals(snapshot({ pastCloseBeforeWeek: 1 }), doc).some((y) => y.title.startsWith('Deals past their expected close date'))).toBe(false);
  });

  it('risk: proposals sent but not viewed after the follow-up window', () => {
    expect(find((t) => t.includes('has not been viewed'))).toMatchObject({ kind: 'risk', metricIds: ['S-14'], values: { proposals: 1, followUpAfterDays: 3 } });
  });

  it('concentration: one deal over 40 % and one rep over 50 % of the open pipeline', () => {
    expect(find((t) => t.startsWith('One deal, S.H.I.E.L.D.'))).toMatchObject({
      kind: 'concentration',
      values: { sharePct: '50.0' },
      recordIds: ['deal:d-big', `user:${U.cap}`],
    });
    expect(find((t) => t.startsWith('Captain America holds 60.0%'))).toMatchObject({ kind: 'concentration', recordIds: [`user:${U.cap}`] });
    const spread = snapshot({
      openDeals: s.openDeals.map((d) => ({ ...d, amount: '50000.00' })),
      pipelineByOwner: s.pipelineByOwner.map((p) => ({ ...p, value: '66666.00' })),
    });
    expect(computeSignals(spread, computeSalesMetrics(spread)).some((y) => y.kind === 'concentration')).toBe(false);
  });

  it('team: a rep with open deals and no logged activity', () => {
    const all = computeSignals(snapshot({ attention: [], openDeals: [], leadSources: [] }), doc);
    expect(all.find((y) => y.kind === 'team')).toMatchObject({
      severity: 'medium',
      recordIds: [`user:${U.widow}`],
      values: { openDeals: 1, openValue: '20000.00' },
    });
  });

  it('bottleneck: the funnel step that fell furthest behind its baseline, else the weakest step', () => {
    const quiet = snapshot({ attention: [], openDeals: [], leadSources: [], activity: s.activity.map((a) => ({ ...a, calls: 1 })) });
    const bottleneck = computeSignals(quiet, computeSalesMetrics(quiet)).find((y) => y.kind === 'bottleneck');
    expect(bottleneck).toMatchObject({
      severity: 'high',
      metricIds: ['S-01', 'S-02'],
      values: { stepPct: '50.0', baselineStepPct: '75.0', dropPoints: '25.0' },
    });
    const noHistory = snapshot({ lastWeek: win({}), attention: [], openDeals: [], leadSources: [] });
    expect(computeSignals(noHistory, computeSalesMetrics(noHistory)).find((y) => y.kind === 'bottleneck')?.title).toBe(
      'The weakest funnel step is New opportunities to Deals won: 33.3% (2 of 6).',
    );
  });

  it('bottleneck: a step above 100 % is not a conversion step and is never reported', () => {
    // Last week 1 lead converted but 5 opportunities were opened (500 %); this week 3 converted and 6 opened (200 %).
    const calm = { attention: [], openDeals: [], leadSources: [], pipelineByOwner: [] };
    const direct = snapshot({ ...calm, lastWeek: win({ ...s.week, leadsConverted: 1, dealsCreated: 5 }) });
    const found = computeSignals(direct, computeSalesMetrics(direct)).filter((y) => y.kind === 'bottleneck');
    for (const b of found) expect(b.metricIds).not.toEqual(['S-03', 'S-05']); // "converted → new opportunities" is not a conversion step
    expect(found.some((b) => String(b.title).includes('New opportunities converted'))).toBe(false);
  });

  it('trend: a headline figure moved 20 % or more against its baseline; smaller moves are ignored; the 3 largest are kept', () => {
    const calm = { attention: [], openDeals: [], leadSources: [], pipelineByOwner: [] };
    const base = snapshot({ ...calm, lastWeek: win({ ...s.week, leadsCreated: 8, wonValue: '30000.00', winRate: 100 }) });
    const trends = computeSignals(base, computeSalesMetrics(base)).filter((y) => y.kind === 'trend');
    expect(trends.map((y) => y.metricIds[0]).sort()).toEqual(['S-01', 'S-08', 'S-10']);
    expect(trends.find((y) => y.metricIds[0] === 'S-08')).toMatchObject({
      severity: 'medium',
      values: { value: '74000.00', baseline: '30000.00', changePct: '146.7' },
    });
    expect(trends.find((y) => y.metricIds[0] === 'S-10')).toMatchObject({ severity: 'medium', values: { changePct: '-33.3' } });
    expect(trends.find((y) => y.metricIds[0] === 'S-01')).toMatchObject({ severity: 'low', values: { changePct: '25.0' } });
    expect(trends.some((y) => y.metricIds[0] === 'S-14')).toBe(false); // unchanged
    const collapse = snapshot({ ...calm, week: win({ ...s.week, won: 0, wonValue: '0.00' }) });
    expect(computeSignals(collapse, computeSalesMetrics(collapse)).find((y) => y.metricIds[0] === 'S-08')).toMatchObject({ severity: 'high' });
    const busy = snapshot(calm); // many figures moved: only the 3 largest moves remain
    expect(computeSignals(busy, computeSalesMetrics(busy)).filter((y) => y.kind === 'trend')).toHaveLength(THRESHOLDS.maxTrends);
  });

  it('opportunity: the lead source that converted best', () => {
    const quiet = snapshot({ attention: [], openDeals: [], lastWeek: s.week });
    const only = computeSignals(quiet, computeSalesMetrics(quiet)).find((y) => y.kind === 'opportunity');
    expect(only).toMatchObject({ severity: 'low', values: { source: 'referral', converted: 2, created: 4 } });
  });
});

describe('sales brief facts pack', () => {
  const s = snapshot();
  const doc = computeSalesMetrics(s);
  const signals = computeSignals(s, doc);
  const context = buildSalesFacts(s, doc, signals);

  it('gives every citable fact an id, and every record a signal names is in the facts', () => {
    const ids = allowedSourceIds(context.facts);
    for (const id of ['period', 'metric:S-01', 'metric:S-17', 'signal:1', 'deal:d-w1', 'deal:d-l1', 'deal:d-s1', `user:${U.cap}`])
      expect(ids.has(id)).toBe(true);
    for (const signal of signals) for (const record of signal.recordIds) expect(ids.has(record)).toBe(true);
    const all = [...ids];
    expect(new Set(all).size).toBe(all.length);
  });

  it('carries the reasons the AI may use to explain "why", and nothing else about how the brief is produced', () => {
    const text = JSON.stringify(context.facts);
    expect(text).toContain('"lostReason":"Price"');
    expect(text).toContain('proposal not viewed');
    expect(text).toContain('"finding"');
    expect(text).not.toContain('snapshot');
    expect(context.refs).toEqual([{ type: 'sales_brief_run', id: 'run-1' }]);
  });
});

describe('sales brief checks and simulator', () => {
  const s = snapshot();
  const doc = computeSalesMetrics(s);
  const signals = computeSignals(s, doc);
  const context = buildSalesFacts(s, doc, signals);
  let n = 0;
  const st = (text: string, sources: string[], extra: Partial<SalesBriefStatement> = {}): SalesBriefStatement => ({
    id: `t${++n}`,
    text,
    sources,
    origin: 'ai',
    ...extra,
  });
  const brief = (o: Partial<SalesBriefNarrative> = {}): SalesBriefNarrative => ({
    headline: [st('The team won 2 deals this week.', ['metric:S-07'])],
    insights: [],
    actions: [],
    throughput: [],
    wins: [],
    pipeline: [],
    risks: [],
    team: [],
    ...o,
  });
  const codes = (b: SalesBriefNarrative) => checkBrief(b, context.facts, signals).map((f) => f.code);

  it('the simulator answer matches the schema, passes every check and ties insights and actions to signals', async () => {
    const result = await new MockAiProvider().complete({
      requestId: '55555555-5555-7555-8555-555555555555',
      feature: 'sales_brief',
      model: 'x',
      effort: 'medium',
      maxTokens: 100,
      timeoutMs: 1000,
      system: PROMPTS.sales_brief.system,
      user: renderUserMessage({ report: 'weekly_sales_brief' }, context),
      jsonSchema: jsonSchemaOf(PROMPTS.sales_brief.schema),
      userRef: 'u',
    });
    const data = salesBriefOutput.parse(JSON.parse(result.text));
    let i = 0;
    const narrative = Object.fromEntries(
      Object.entries(data).map(([section, list]) => [section, list.map((x) => ({ id: `m${++i}`, origin: 'ai' as const, ...x }))]),
    ) as SalesBriefNarrative;
    expect(checkBrief(narrative, context.facts, signals)).toEqual([]);
    expect(narrative.headline[0]?.text).toBe('This week the team won 2 deals worth 74000.00 USD and opened 6 new opportunities.');
    expect(narrative.insights.length).toBeGreaterThanOrEqual(3);
    expect(narrative.insights.length).toBeLessThanOrEqual(5);
    for (const insight of narrative.insights) {
      expect(insight.signalIds).toHaveLength(1);
      expect(insight.kind).toBe(signals.find((x) => x.id === insight.signalIds?.[0])?.kind);
    }
    expect(narrative.actions.length).toBeGreaterThanOrEqual(2);
    expect(narrative.actions.length).toBeLessThanOrEqual(4);
    expect(narrative.actions[0]?.text).toBe('Review the stalled deals with their owners and agree one next step for each.');
    expect(narrative.wins.map((w) => w.text)).toContain('Captain America won Stark – ERP integration for 52000.00 USD.');
    expect(narrative.risks.map((r) => r.text)).toContain('Daily Bugle – Archive was lost; the recorded reason is Price.');
    expect(JSON.stringify(data)).not.toMatch(/will close|forecast|certainly|guarantee/i);
  });

  it('accepts a sourced statement and rejects missing or unknown evidence', () => {
    expect(codes(brief())).toEqual([]);
    expect(codes(brief({ headline: [st('The team won 2 deals this week.', [])] }))).toEqual(['NO_SOURCE']);
    expect(codes(brief({ headline: [st('The team won 2 deals this week.', ['metric:S-99'])] }))).toEqual(['UNKNOWN_SOURCE']);
    expect(codes(brief({ wins: [st('A deal was won.', ['deal:not-in-the-brief'])] }))).toEqual(['UNKNOWN_SOURCE']);
    expect(codes(brief({ headline: [] }))).toEqual(['EMPTY_SECTION']);
  });

  it('every insight and every action must name a real signal', () => {
    const ok = { signalIds: ['signal:1'], kind: 'risk' as const };
    expect(codes(brief({ insights: [st('Two deals are stalled.', ['signal:1'], ok)] }))).toEqual([]);
    expect(codes(brief({ insights: [st('Two deals are stalled.', ['signal:1'])] }))).toEqual(['NO_SIGNAL']);
    expect(codes(brief({ insights: [st('Two deals are stalled.', ['signal:1'], { signalIds: [] })] }))).toEqual(['NO_SIGNAL']);
    expect(codes(brief({ actions: [st('Review the stalled deals.', ['signal:1'], { signalIds: ['signal:99'] })] }))).toEqual(['UNKNOWN_SIGNAL']);
    expect(codes(brief({ actions: [st('Review the stalled deals.', ['signal:1', `user:${U.cap}`], { signalIds: ['signal:1'] })] }))).toEqual([]);
    expect(codes(brief({ actions: [st('Ask Hawkeye to help.', ['signal:1', 'user:someone-else'], { signalIds: ['signal:1'] })] }))).toEqual(['UNKNOWN_SOURCE']);
    // A person vouches for their own sentence: no signal needed.
    expect(codes(brief({ actions: [st('Call the client on Monday.', [], { origin: 'user' })] }))).toEqual([]);
  });

  it('numbers must be in the facts: blocking for AI text, a warning for a person', () => {
    const invented = checkBrief(brief({ headline: [st('Revenue will reach 999000 next month.', ['metric:S-08'])] }), context.facts, signals);
    expect(invented.map((f) => [f.code, f.level])).toEqual([['UNVERIFIED_NUMBER', undefined]]);
    const byHand = checkBrief(brief({ headline: [st('We expect 12 demos next week.', [], { origin: 'user' })] }), context.facts, signals);
    expect(byHand.map((f) => [f.code, f.level])).toEqual([['UNVERIFIED_NUMBER', 'warning']]);
    expect(codes(brief({ headline: [st('Revenue won was 74,000 USD, up from 30000.', ['metric:S-08'])] }))).toEqual([]);
    // Digits inside record ids never count as known numbers.
    expect(codes(brief({ headline: [st('There were 5555 calls.', ['metric:S-15'])] }))).toEqual(['UNVERIFIED_NUMBER']);
  });

  it('no forecasts, certainty or blame; limits on length and count', () => {
    for (const text of [
      'This deal will close next week.',
      'We forecast a strong month.',
      'It will certainly improve.',
      'This is the fault of the rep.',
      'We guarantee growth.',
    ])
      expect(codes(brief({ risks: [st(text, ['metric:S-13'])] }))).toEqual(['BANNED_WORD']);
    expect(codes(brief({ risks: [st('x'.repeat(321), ['metric:S-13'])] }))).toEqual(['TOO_LONG']);
    expect(codes(brief({ headline: [1, 2, 3, 4].map(() => st('The team won 2 deals this week.', ['metric:S-07'])) }))).toEqual(['TOO_MANY']);
    expect(BRIEF_LIMITS).toEqual({ headline: 3, insights: 5, actions: 4, throughput: 3, wins: 3, pipeline: 3, risks: 4, team: 3 });
  });

  it('fallback: placeholders for headline, insights and actions; one blocking flag until a person writes them', () => {
    const fallback = fallbackBrief();
    expect(Object.fromEntries(Object.entries(fallback).map(([k, v]) => [k, v.length]))).toEqual({
      headline: 1,
      insights: 1,
      actions: 1,
      throughput: 0,
      wins: 0,
      pipeline: 0,
      risks: 0,
      team: 0,
    });
    expect(fallback.headline[0]).toMatchObject({ text: FALLBACK_TEXT, origin: 'fallback', sources: [] });
    expect(checkBrief(fallback, context.facts, signals)).toEqual([]); // placeholders are not checked one by one
    expect(composeBriefFlags(fallback, context.facts, signals).map((f) => f.code)).toEqual(['PLACEHOLDER_TEXT']);
    const aiFallback = [{ code: 'AI_FALLBACK', statementId: null, message: briefFallbackMessage('AI_DISABLED') }];
    expect(composeBriefFlags(fallback, context.facts, signals, aiFallback).map((f) => f.code)).toEqual(['AI_FALLBACK']);
    expect(briefFallbackMessage('AI_DISABLED')).toBe(
      'No AI analysis: AI is switched off for the sales brief. The figures and findings are complete; write the text yourself, or regenerate.',
    );
    for (const code of ['AI_DISABLED', 'AI_QUOTA_EXCEEDED', 'AI_PROVIDER_UNAVAILABLE', 'CHECKS_FAILED', 'NEW_CODE'])
      expect(briefFallbackMessage(code)).not.toMatch(/[A-Z]{2,}_[A-Z]/);
  });
});

describe('sales brief outputs: PowerPoint, Excel and the Google Sheets publisher', () => {
  const s = snapshot({
    wonDeals: [
      {
        dealId: 'd-w1',
        name: '=HYPERLINK("http://evil.example","Stark – ERP integration")',
        owner: 'Captain America',
        ownerId: U.cap,
        amount: '52000.00',
        cycleDays: 30,
      },
      { dealId: 'd-w2', name: 'Wakanda – Inventory portal', owner: 'Spider-Man', ownerId: U.spidey, amount: '22000.00', cycleDays: 21 },
    ],
  });
  const doc = computeSalesMetrics(s);
  const signals = computeSignals(s, doc);
  const ai = (text: string, extra: Partial<SalesBriefStatement> = {}): SalesBriefStatement => ({
    id: `o${text.length}`,
    text,
    sources: ['metric:S-07'],
    origin: 'ai',
    ...extra,
  });
  const narrative: SalesBriefNarrative = {
    headline: [ai('This week the team won 2 deals worth 74000.00 USD and opened 6 new opportunities.')],
    insights: [ai('2 deals are stalled in Discovery. This puts revenue at risk if nothing changes.', { signalIds: ['signal:1'], kind: 'risk' })],
    actions: [ai('Review the stalled deals with their owners and agree one next step for each.', { signalIds: ['signal:1'] })],
    throughput: [ai('10 new leads came in, 5 were qualified and 3 converted.')],
    wins: [ai('Captain America won the largest deal of the week.')],
    pipeline: [ai('Open pipeline is 200000.00 USD.')],
    risks: [ai('3 open deals need attention.')],
    team: [ai('The team logged 15 activities.')],
  };
  const deck = (draft: boolean) =>
    buildBriefDeck({
      draft,
      attempt: 2,
      periodStart: '2026-11-16',
      periodEnd: '2026-11-22',
      orgName: 'Kensium',
      branding: { primaryColor: '#1f4e79', footerText: 'Kensium — Confidential' },
      metrics: doc,
      narrative,
      approverName: draft ? null : 'Tony Stark',
    });
  async function unzip(bytes: Uint8Array) {
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files);
    const read = (name: string) => (zip.file(name) as JSZip.JSZipObject).async('string');
    const slides = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
    const xml = await Promise.all(slides.map(read));
    const everything = (await Promise.all(names.filter((n) => n.startsWith('ppt/') && n.endsWith('.xml')).map(read))).join('\n');
    return { slides, xml, everything };
  }

  it('formats figures and file names', () => {
    expect(formatAmount('74000.00')).toBe('74,000');
    expect(formatAmount('1250.50')).toBe('1,250.50');
    expect(formatAmount(null)).toBe('–');
    expect(formatMetric({ unit: 'money', value: '200000.00' }, 'USD')).toBe('USD 200,000');
    expect(formatMetric({ unit: 'percent', value: '66.7' }, 'USD')).toBe('66.7%');
    expect(formatChange({ value: '10', lastWeek: '8', changePct: '25.0' })).toBe('▲ 25.0% vs last week');
    expect(formatChange({ value: '66.7', lastWeek: '100.0', changePct: '-33.3' })).toBe('▼ 33.3% vs last week');
    expect(formatChange({ value: '2', lastWeek: '0', changePct: null })).toBe('▲ up from 0 last week');
    expect(formatChange({ value: '5', lastWeek: null, changePct: null })).toBe('');
    expect(briefFileName('Kensium', '2026-11-22', 2, true, 'pptx')).toBe('Kensium_Sales_Brief_2026-11-22_v2_DRAFT.pptx');
    expect(briefFileName('Kensium Inc.', '2026-11-22', 1, false, 'xlsx')).toBe('Kensium_Inc_Sales_Brief_2026-11-22_v1.xlsx');
  });

  it('the deck model holds the five key figures, the analysis and the to-date table', () => {
    const model = deck(true);
    expect(model.kpis.map((k) => [k.label, k.value])).toEqual([
      ['New leads', '10'],
      ['New opportunities', '6'],
      ['Revenue won', 'USD 74,000'],
      ['Win rate', '66.7%'],
      ['Open pipeline', 'USD 200,000'],
    ]);
    expect(model.kpis[0]?.change).toBe('▲ 25.0% vs last week');
    expect(model.analysisLabel).toBe('AI analysis — draft, not yet reviewed');
    expect(deck(false).analysisLabel).toBe('AI analysis — reviewed by Tony Stark');
    expect(model.toDate[4]).toEqual(['Revenue won', 'USD 74,000', 'USD 104,000', 'USD 180,000']);
    expect(model.funnel.map((f) => f.step)).toEqual([
      '',
      '50.0% of the step before',
      '60.0% of the step before',
      '', // 200 % is not a share of the step before (reps also open opportunities directly): nothing is shown
      '33.3% of the step before',
    ]);
    expect(model.attention).toHaveLength(3);
    expect(model.footerText).toBe('Kensium — Confidential · Internal');
  });

  it('PowerPoint: 9 slides on the shared masters, no ids or codes, DRAFT only in the draft', async () => {
    const draft = await unzip(await renderBriefPptx(deck(true)));
    expect(draft.slides).toHaveLength(9);
    for (const slide of draft.xml) expect(slide).toContain('DRAFT');
    expect(draft.xml[0]).toContain('Weekly sales brief');
    expect(draft.xml[1]).toContain('USD 74,000');
    expect(draft.xml[2]).toContain('Review the stalled deals with their owners');
    expect(draft.xml[2]).toContain('AI analysis — draft, not yet reviewed');
    expect(draft.xml[6]).toContain('Captain America');
    expect(draft.xml[8]).toContain('Quarter to date');
    expect(draft.everything).toContain('name="WR_CONTENT"');
    expect(draft.everything).toContain('typeface="Arial"');
    for (const internal of ['signal:', 'metric:', 'deal:', 'user:', 'S-01', 'S-17', 'd-w1', U.cap, 'unviewed_proposal'])
      expect(draft.everything).not.toContain(internal);

    const final = await unzip(await renderBriefPptx(deck(false)));
    expect(final.slides).toHaveLength(9);
    expect(final.everything).not.toContain('DRAFT');
    expect(final.xml[2]).toContain('AI analysis — reviewed by Tony Stark');
  });

  it('Excel: nine tabs, values equal to the metrics, frozen brand header, formula-injection guard', async () => {
    const tabs = buildBriefTabs({
      metrics: doc,
      signals,
      narrative,
      history: [{ periodStart: '2026-11-16', periodEnd: '2026-11-22', attempt: 2, approvedAt: '2026-11-23T14:00:00.000Z', metrics: doc }],
    });
    expect(tabs.map((t) => t.name)).toEqual([...BRIEF_TABS]);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Buffer.from(await renderBriefXlsx(tabs, { brandColor: '1F4E79', orgName: 'Kensium', title: 'Weekly sales brief' })) as never);
    expect(book.worksheets.map((w) => w.name)).toEqual([...BRIEF_TABS]);

    const summary = book.getWorksheet('Summary') as ExcelJS.Worksheet;
    expect(summary.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect((summary.getCell('A1').fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FF1F4E79');
    const rows = new Map<string, ExcelJS.Row>();
    summary.eachRow((row, i) => {
      if (i > 1) rows.set(String(row.getCell(1).value), row);
    });
    for (const m of doc.metrics) {
      const row = rows.get(m.id) as ExcelJS.Row;
      expect(row.getCell(2).value).toBe(m.label);
      expect(row.getCell(4).value).toBe(m.value === null ? null : Number(m.value));
      expect(row.getCell(5).value).toBe(m.lastWeek === null ? null : Number(m.lastWeek));
    }
    expect(rows.get('S-08')?.getCell(7).value).toBe(104000);
    expect(rows.get('S-08')?.getCell(8).value).toBe(180000);

    const insights = book.getWorksheet('Insights') as ExcelJS.Worksheet;
    expect(insights.getCell('A2').value).toBe('2 deals are stalled in Discovery. This puts revenue at risk if nothing changes.');
    expect([insights.getCell('B2').value, insights.getCell('C2').value]).toEqual(['risk', 'high']);
    expect(String(insights.getCell('D2').value)).toContain('stalled in Discovery');
    expect(insights.getCell('E2').value).toBe('Review the stalled deals with their owners and agree one next step for each.');
    expect(insights.rowCount).toBe(1 + signals.length); // every finding appears, with or without an insight

    // A deal name that looks like a formula is stored as text with a leading apostrophe, never as a formula.
    const won = book.getWorksheet('Deals won') as ExcelJS.Worksheet;
    expect(won.getCell('A2').value).toBe('\'=HYPERLINK("http://evil.example","Stark – ERP integration")');
    expect(won.getCell('A2').type).toBe(ExcelJS.ValueType.String);
    expect(won.getCell('C2').value).toBe(52000);
    expect(safeText('+1 555 0100')).toBe("'+1 555 0100");
    expect(safeText('@handle')).toBe("'@handle");
    expect(safeText('-12.50')).toBe('-12.50');
    expect(safeText('Stark Industries')).toBe('Stark Industries');

    const history = book.getWorksheet('Brief history') as ExcelJS.Worksheet;
    expect([2, 3, 4, 5, 7, 8].map((c) => history.getRow(2).getCell(c).value)).toEqual(['2026-11-16', 2, '2026-11-23', 10, 2, 74000]);
    expect((book.getWorksheet('Team') as ExcelJS.Worksheet).rowCount).toBe(1 + doc.reps.length);
    expect((book.getWorksheet('Pipeline by stage') as ExcelJS.Worksheet).getCell('A5').value).toBe('Total');
  });

  it('Google Sheets publisher: adds missing tabs, clears and writes RAW values; errors never leak a secret; off by default', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const email = 'crm-writer@example-project.iam.gserviceaccount.com';
    const credentialsBase64 = Buffer.from(JSON.stringify({ client_email: email, private_key: pem })).toString('base64');
    const calls: { url: string; method?: string; headers: Record<string, string>; body?: string }[] = [];
    const fake =
      (sheetStatus = 200) =>
      async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
        calls.push({ url, ...(init?.method ? { method: init.method } : {}), headers: init?.headers ?? {}, ...(init?.body ? { body: init.body } : {}) });
        if (url.startsWith('https://oauth2.googleapis.com/')) return Response.json({ access_token: 'ya29.test-token', expires_in: 3600 });
        if (sheetStatus !== 200) return new Response('{}', { status: sheetStatus });
        if (url.includes('?fields=')) return Response.json({ sheets: [{ properties: { title: 'Summary' } }, { properties: { title: 'Sheet1' } }] });
        return Response.json({});
      };
    const tabs = buildBriefTabs({ metrics: doc, signals, narrative, history: [] });
    const publisher = new GoogleSheetsPublisher({
      credentialsBase64,
      spreadsheetId: 'sheet-123',
      fetch: fake(),
      now: () => Date.parse('2026-11-23T14:00:00Z'),
    });
    expect(publisher.status()).toEqual({ provider: 'google', configured: true, detail: `Writes the approved brief to a sheet shared with ${email}` });
    expect(await publisher.publish(tabs)).toEqual({ url: 'https://docs.google.com/spreadsheets/d/sheet-123' });

    expect(calls.map((c) => `${c.method} ${c.url.replace('https://sheets.googleapis.com/v4/spreadsheets/sheet-123', '')}`)).toEqual([
      'POST https://oauth2.googleapis.com/token',
      'GET ?fields=sheets.properties.title',
      'POST :batchUpdate',
      'POST /values:batchClear',
      'POST /values:batchUpdate',
    ]);
    const [header, claims, signature] = (new URLSearchParams(calls[0]?.body).get('assertion') as string).split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toMatchObject({ iss: email, scope: 'https://www.googleapis.com/auth/spreadsheets' });
    expect(createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
    const added = JSON.parse(calls[2]?.body as string).requests.map((r: { addSheet: { properties: { title: string } } }) => r.addSheet.properties.title);
    expect(added).toEqual(BRIEF_TABS.filter((t) => t !== 'Summary')); // "Summary" was already there
    const written = JSON.parse(calls[4]?.body as string);
    expect(written.valueInputOption).toBe('RAW'); // nothing is evaluated as a formula
    expect(written.data).toHaveLength(BRIEF_TABS.length);
    expect(written.data[0].range).toBe("'Summary'!A1");
    expect(written.data[0].values[0]).toEqual(['Ref', 'Metric', 'Unit', 'This week', 'Last week', 'Change %', 'Month to date', 'Quarter to date', 'Detail']);
    expect(written.data[0].values[1].slice(0, 4)).toEqual(['S-01', 'New leads', 'count', 10]);
    for (const call of calls.slice(1)) expect(call.headers.authorization).toBe('Bearer ya29.test-token');

    const failure = async (p: Promise<unknown>) =>
      p.then(
        () => null,
        (e: unknown) => e as { code: string; message: string },
      );
    const denied = await failure(new GoogleSheetsPublisher({ credentialsBase64, spreadsheetId: 'sheet-123', fetch: fake(403) }).publish(tabs));
    expect(denied?.code).toBe('SALES_BRIEF_SHEET_NOT_SHARED');
    expect(denied?.message).toContain(email);
    expect((await failure(new GoogleSheetsPublisher({ credentialsBase64, spreadsheetId: 'sheet-123', fetch: fake(404) }).publish(tabs)))?.code).toBe(
      'SALES_BRIEF_SHEET_NOT_FOUND',
    );
    for (const e of [denied]) expect(`${e?.message} ${JSON.stringify(e)}`).not.toMatch(/PRIVATE KEY|ya29/);
    const offline = new GoogleSheetsPublisher({
      credentialsBase64,
      spreadsheetId: 'sheet-123',
      fetch: async () => {
        throw new Error(`network down ${pem}`);
      },
    });
    const net = await failure(offline.publish(tabs));
    expect(net?.code).toBe('SALES_BRIEF_SHEETS_UNAVAILABLE');
    expect(net?.message).not.toContain('PRIVATE KEY');

    expect(new GoogleSheetsPublisher({ credentialsBase64 }).status().configured).toBe(false); // no sheet id
    expect(new GoogleSheetsPublisher({ spreadsheetId: 'x' }).status().configured).toBe(false); // no key
    const file = new FileOnlyPublisher();
    expect([file.enabled, file.status().provider]).toEqual([false, 'file']);
    expect((await failure(file.publish()))?.code).toBe('SALES_BRIEF_SHEETS_NOT_CONFIGURED');
  });
});
