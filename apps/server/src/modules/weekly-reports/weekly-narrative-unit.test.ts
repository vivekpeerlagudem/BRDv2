import { describe, expect, it } from 'vitest';
import type { WeeklyNarrative, WeeklyStatement } from '../../db/schema-weekly-reports.ts';
import { MockAiProvider } from '../../platform/mock-ai.ts';
import { jsonSchemaOf, PROMPTS, renderUserMessage, weeklyReportOutput } from '../ai/prompts.ts';
import { checkNarrative, FALLBACK_TEXT, isBlocking, MAX_STATEMENT_CHARS } from './checks.ts';
import type { WeeklySnapshot } from './collect.ts';
import { allowedSourceIds, buildWeeklyFacts } from './facts.ts';
import { matchItems } from './match.ts';
import { computeMetrics } from './metrics.ts';
import { fallbackNarrative } from './narrative.ts';

const ROW = (n: number) => `00000000-0000-7000-8000-00000000000${n}`;
const snapshot: WeeklySnapshot = {
  schema: 1,
  runId: 'run-1',
  cutoff: '2026-11-23T09:00:00.000Z',
  company: { id: '11111111-1111-7111-8111-111111111111', name: 'Stark Industries', ownerName: 'Riley Chen' },
  period: { start: '2026-11-16', end: '2026-11-22', timeZone: 'UTC', startInstant: '2026-11-16T00:00:00.000Z', endInstant: '2026-11-22T23:59:59.999Z' },
  deals: [],
  tasks: [
    { id: 't1', title: '[S-001] Run the workshop', status: 'completed', dueAt: '2026-11-18T00:00:00.000Z', completedAt: '2026-11-18T10:00:00.000Z' },
    { id: 't2', title: '[S-002] Write the design', status: 'open', dueAt: '2026-11-25T00:00:00.000Z', completedAt: null },
  ],
  activities: [{ id: 'a1', kind: 'meeting', occurredAt: '2026-11-19T15:00:00.000Z', outcome: 'Agreed the <b>design</b> approach' }],
  estimates: {
    importId: '22222222-2222-7222-8222-222222222222',
    fileName: 'estimates.csv',
    items: [
      {
        id: ROW(1),
        rowNo: 2,
        scopeId: 'S-001',
        title: 'Requirements workshop',
        phase: 'Discovery',
        estimateHours: '16',
        sheetStatus: 'done',
        pctDone: '100',
        actualHours: '16.5',
      },
      {
        id: ROW(2),
        rowNo: 3,
        scopeId: 'S-002',
        title: 'Solution design',
        phase: 'Discovery',
        estimateHours: '24',
        sheetStatus: 'done',
        pctDone: null,
        actualHours: null,
      },
      {
        id: ROW(3),
        rowNo: 4,
        scopeId: 'S-003',
        title: 'ERP connector',
        phase: 'Build',
        estimateHours: '40',
        sheetStatus: 'not_started',
        pctDone: null,
        actualHours: null,
      },
      { id: ROW(4), rowNo: 5, scopeId: null, title: 'Go-live', phase: 'Launch', estimateHours: '20', sheetStatus: null, pctDone: null, actualHours: null },
    ],
  },
};
const doc = computeMetrics({
  matched: matchItems(snapshot.estimates.items, snapshot.tasks),
  tasks: snapshot.tasks,
  activities: snapshot.activities,
  startInstant: new Date(snapshot.period.startInstant),
  endInstant: new Date(snapshot.period.endInstant),
  previous: null,
});
const context = buildWeeklyFacts(snapshot, doc, 'Kensium');
const facts = context.facts;

let n = 0;
const st = (text: string, sources: string[], origin: WeeklyStatement['origin'] = 'ai'): WeeklyStatement => ({ id: `s${++n}`, text, sources, origin });
const narrative = (o: Partial<WeeklyNarrative> = {}): WeeklyNarrative => ({
  summary: [st('We completed 1 scope item this week.', ['metric:E-06'])],
  completed: [],
  nextWeek: [],
  risks: [],
  ...o,
});
const codes = (nar: WeeklyNarrative) => checkNarrative(nar, facts).map((f) => f.code);

describe('weekly report facts pack', () => {
  it('never contains internal figures or flags', () => {
    const metricIds = (facts.metrics as { id: string }[]).map((m) => m.id);
    expect(metricIds).toContain('metric:E-05');
    expect(metricIds).not.toContain('metric:E-11');
    expect(metricIds).not.toContain('metric:E-12');
    expect(doc.items.some((i) => i.mismatch)).toBe(true); // S-002: sheet says done, the CRM task is open
    const text = JSON.stringify(facts).toLowerCase();
    for (const word of ['mismatch', 'unmatched', 'e-11', 'e-12', 'taskid']) expect(text).not.toContain(word);
  });

  it('gives every fact a unique id and sanitizes free text', () => {
    const ids: string[] = [];
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object')
        for (const [k, x] of Object.entries(v)) {
          if (k === 'id') ids.push(String(x));
          else walk(x);
        }
    };
    walk(facts);
    expect(new Set(ids).size).toBe(ids.length);
    expect(allowedSourceIds(facts)).toEqual(new Set(ids));
    expect(ids).toEqual(expect.arrayContaining([`company:${snapshot.company.id}`, 'period', 'metric:E-06', `scope:${ROW(1)}`, 'activity:a1', 'task:t2']));
    expect((facts.meetings as { outcome: string }[])[0]?.outcome).toBe('Agreed the design approach'); // markup removed
    expect(context.untrusted).toEqual([]);
    expect(context.refs).toEqual([
      { type: 'company', id: snapshot.company.id },
      { type: 'estimate_import', id: snapshot.estimates.importId },
    ]);
  });
});

describe('weekly report checks', () => {
  it('passes a sourced statement whose numbers are in the facts', () => {
    expect(codes(narrative())).toEqual([]);
  });
  it('NO_SOURCE: a statement without a source', () => {
    expect(codes(narrative({ summary: [st('We made good progress.', [])] }))).toEqual(['NO_SOURCE']);
  });
  it('UNKNOWN_SOURCE: a source id that is not in the facts', () => {
    expect(codes(narrative({ summary: [st('We made good progress.', ['metric:E-99'])] }))).toEqual(['UNKNOWN_SOURCE']);
    expect(codes(narrative({ summary: [st('We made good progress.', ['metric:E-11'])] }))).toEqual(['UNKNOWN_SOURCE']); // internal metric
  });
  it('UNVERIFIED_NUMBER: a number or amount that is not in the facts', () => {
    expect(codes(narrative({ summary: [st('We completed 9 scope items this week.', ['metric:E-06'])] }))).toEqual(['UNVERIFIED_NUMBER']);
    expect(codes(narrative({ summary: [st('This saves you $5,000 a month.', ['metric:E-06'])] }))).toEqual(['UNVERIFIED_NUMBER']);
    // Digits that only occur inside a record id are not "known numbers".
    expect(codes(narrative({ summary: [st('We held 7111 sessions.', ['metric:E-06'])] }))).toEqual(['UNVERIFIED_NUMBER']);
    // Values copied from facts are fine: estimate hours, the period label, a scope id.
    expect(codes(narrative({ summary: [st('For 16–22 Nov 2026 we finished S-001, estimated at 16 hours.', [`scope:${ROW(1)}`, 'period'])] }))).toEqual([]);
  });
  it('TOO_LONG and TOO_MANY', () => {
    expect(codes(narrative({ summary: [st(`We ${'really '.repeat(60)}progressed.`, ['period'])] }))).toEqual(['TOO_LONG']);
    expect('x'.repeat(MAX_STATEMENT_CHARS).length).toBe(320);
    const four = Array.from({ length: 4 }, () => st('We made progress.', ['period']));
    expect(codes(narrative({ summary: four }))).toEqual(['TOO_MANY']);
    const six = Array.from({ length: 6 }, () => st('We made progress.', ['period']));
    expect(codes(narrative({ completed: six }))).toEqual(['TOO_MANY']);
  });
  it('INTERNAL_TERM: internal wording', () => {
    for (const text of ['Two rows are unmatched.', 'There is a status mismatch.', 'Our tracking shows progress.', 'One item was flagged.'])
      expect(codes(narrative({ risks: [st(text, ['period'])] }))).toEqual(['INTERNAL_TERM']);
  });
  it('INTERNAL_TERM: not flagged when the word is the client wording from a scope or task title', () => {
    const withTitle = buildWeeklyFacts(
      {
        ...snapshot,
        estimates: {
          ...snapshot.estimates,
          items: [{ ...snapshot.estimates.items[2]!, title: 'Order tracking page' }, ...snapshot.estimates.items.slice(0, 2)],
        },
        tasks: [...snapshot.tasks, { id: 't5', title: 'Flag the open invoices', status: 'open', dueAt: '2026-11-24T00:00:00.000Z', completedAt: null }],
      },
      {
        ...doc,
        items: doc.items.map((i) => (i.rowId === ROW(3) ? { ...i, title: 'Order tracking page' } : i)),
        upcomingTasks: [{ id: 't5', title: 'Flag the open invoices', dueDate: '2026-11-24' }],
      },
      'Kensium',
    ).facts;
    const check = (text: string) => checkNarrative(narrative({ nextWeek: [st(text, ['period'])] }), withTitle).map((f) => f.code);
    expect(check('We plan to start the Order tracking page.')).toEqual([]);
    expect(check('We will flag the open invoices with your team.')).toEqual([]);
    expect(check('Two rows are unmatched.')).toEqual(['INTERNAL_TERM']); // still internal: not in any fact
    expect(check('The Order tracking page shows a mismatch.')).toEqual(['INTERNAL_TERM']);
    // Without that title in the facts, the same word is internal wording.
    expect(codes(narrative({ nextWeek: [st('We plan to start the Order tracking page.', ['period'])] }))).toEqual(['INTERNAL_TERM']);
  });
  it('BANNED_WORD: guarantees, promises and blame', () => {
    for (const text of ['We guarantee delivery.', 'Delivery is guaranteed.', 'We promise to finish.', 'The delay is your fault.', 'We do not blame anyone.'])
      expect(codes(narrative({ risks: [st(text, ['period'])] }))).toEqual(['BANNED_WORD']);
    expect(codes(narrative({ risks: [st('The default settings stay unchanged.', ['period'])] }))).toEqual([]); // "default" is not "fault"
  });
  it('EMPTY_SECTION: the summary must not be empty', () => {
    expect(codes(narrative({ summary: [] }))).toEqual(['EMPTY_SECTION']);
  });
  it('placeholders are not checked statement by statement, and STATUS_MISMATCH is a notice', () => {
    const fb = fallbackNarrative();
    expect(
      Object.values(fb)
        .flat()
        .every((s) => s.text === FALLBACK_TEXT && s.origin === 'fallback'),
    ).toBe(true);
    expect(checkNarrative(fb, facts)).toEqual([]);
    expect(isBlocking({ code: 'STATUS_MISMATCH', statementId: null, message: '' })).toBe(false);
    expect(isBlocking({ code: 'AI_FALLBACK', statementId: null, message: '' })).toBe(true);
  });
});

describe('weekly report simulator', () => {
  it('the mock AI answer matches the schema and passes every check', async () => {
    const prompt = PROMPTS.weekly_report;
    const ai = new MockAiProvider();
    const result = await ai.complete({
      requestId: '33333333-3333-7333-8333-333333333333',
      feature: 'weekly_report',
      model: 'x',
      effort: 'low',
      maxTokens: 100,
      timeoutMs: 1000,
      system: prompt.system,
      user: renderUserMessage({ report: 'weekly_client_status' }, context),
      jsonSchema: jsonSchemaOf(prompt.schema),
      userRef: 'u',
    });
    const data = weeklyReportOutput.parse(JSON.parse(result.text));
    let i = 0;
    const nar = Object.fromEntries(
      Object.entries(data).map(([k, list]) => [k, list.map((s) => ({ id: `m${++i}`, text: s.text, sources: s.sources, origin: 'ai' as const }))]),
    ) as WeeklyNarrative;
    expect(checkNarrative(nar, facts)).toEqual([]);
    expect(nar.summary[0]?.text).toBe('This week we completed 1 scope item for Stark Industries, and the project is now 16.0% complete by estimated hours.');
    expect(nar.completed.map((s) => s.text)).toEqual(['We completed Requirements workshop.']);
    expect(nar.nextWeek.map((s) => s.text)).toEqual([
      'We will continue work on Solution design.',
      'We plan to start ERP connector.',
      'We plan to start Go-live.',
    ]);
    expect(nar.risks).toEqual([]);
    const text = JSON.stringify(data).toLowerCase();
    for (const word of ['mismatch', 'unmatched', 'scope:', 'metric:e-1']) expect(text.replace(/"sources":\[[^\]]*\]/g, '')).not.toContain(word);
  });
});
