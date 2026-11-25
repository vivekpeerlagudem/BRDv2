/** Weekly Sales Brief — metrics, signals and the facts pack. Pure functions, no database. */
import { describe, expect, it } from 'vitest';
import { allowedSourceIds } from '../weekly-reports/facts.ts';
import { monthAndQuarterStart, type SalesSnapshot, type SalesWindow } from './collect.ts';
import { buildSalesFacts } from './facts.ts';
import { changePct, computeSalesMetrics, metricOf } from './metrics.ts';
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
