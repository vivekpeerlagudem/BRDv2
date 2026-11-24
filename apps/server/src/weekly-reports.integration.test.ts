/**
 * Weekly Report Agents — integration tests: real PostgreSQL, real HTTP routes, real authorization, the mock AI.
 * The clock is fixed to Monday 23 Nov 2026 10:00 UTC (organization time zone UTC), so the report period is
 * 16–22 Nov 2026 and every figure can be asserted exactly.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import JSZip from 'jszip';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildContext } from './composition.ts';
import { parseConfig } from './config/env.ts';
import { estimateImport, weeklyReportRun } from './db/schema-weekly-reports.ts';
import { createApp } from './http/app.ts';
import { bootstrap, insertUser } from './modules/identity.ts';
import { FALLBACK_TEXT } from './modules/weekly-reports/checks.ts';
import { runDueJobs, runScheduledScans } from './modules/workflow.ts';
import { storageKeys } from './platform/adapters.ts';
import { schema, sha256Hex } from './platform/core.ts';
import { MockAiProvider } from './platform/mock-ai.ts';
import { AiProviderError } from './platform/ports.ts';
import { testDbMigratorUrl, testDbUrl } from './test-db.ts';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env.local', import.meta.url)));
} catch {}
const testUrl = testDbUrl();
const PASSWORD = 'Correct-Horse-Battery-9';
const ORIGIN = 'http://localhost:5173';
const SAMPLE_CSV = readFileSync(fileURLToPath(new URL('../../../e2e/fixtures/estimates-sample.csv', import.meta.url)), 'utf8');
const NOW = new Date('2026-11-23T10:00:00.000Z');

describe.skipIf(!testUrl)('weekly report agents (PostgreSQL integration)', () => {
  const config = parseConfig({
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: testUrl,
    APP_ORIGIN: ORIGIN,
    BUYER_ORIGIN: 'http://proposals.localhost:5173',
    STORAGE_DIR: './.data/test-storage',
    AI_PROVIDER: 'fake',
  });
  const ai = new MockAiProvider();
  let clock = NOW;
  const { ctx, pool, auth } = buildContext(config, { now: () => clock, ai });
  const app = createApp(ctx, auth);
  const { task, aiGeneration, auditLog, timelineEvent } = schema;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  async function call(who: string | null, method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { origin: ORIGIN, 'content-type': 'application/json' };
    if (who && cookies[who]) headers.cookie = cookies[who] as string;
    const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const bytes = new Uint8Array(await res.arrayBuffer());
    let json: any = null;
    try {
      json = JSON.parse(new TextDecoder().decode(bytes));
    } catch {}
    return { status: res.status, json, bytes, res };
  }
  /** Text of every slide (and chart) in a deck, by file name. */
  async function slides(bytes: Uint8Array) {
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(/\d+/.exec(a)?.[0]) - Number(/\d+/.exec(b)?.[0]));
    const xml = await Promise.all(names.map((n) => (zip.file(n) as JSZip.JSZipObject).async('string')));
    const everything = (
      await Promise.all(
        Object.keys(zip.files)
          .filter((n) => /\.(xml|rels)$/.test(n))
          .map((n) => (zip.file(n) as JSZip.JSZipObject).async('string')),
      )
    ).join('\n');
    return { xml, everything };
  }
  const runsOf = (companyId: string) => ctx.db.select().from(weeklyReportRun).where(eq(weeklyReportRun.companyId, companyId)).orderBy(weeklyReportRun.attempt);
  const metric = (run: { metrics: { metrics: { id: string; value: string | null }[] } | null }, id: string) =>
    run.metrics?.metrics.find((m) => m.id === id)?.value;
  /** A schema-valid AI answer whose statements cite nothing: it fails the NO_SOURCE check. */
  const unsourced = { text: JSON.stringify({ summary: [{ text: 'We made good progress this week.', sources: [] }], completed: [], nextWeek: [], risks: [] }) };

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: testDbMigratorUrl() });
    await admin.connect();
    const tables = await admin.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public' and tablename <> 'schema_migration'");
    await admin.query(`truncate ${tables.rows.map((t) => `"${t.tablename}"`).join(',')} restart identity cascade`);
    await admin.end();
    const b = await bootstrap(ctx, {
      organizationName: 'Kensium Test',
      currency: 'USD',
      timeZone: 'UTC',
      admin: { email: 'admin@test.example', fullName: 'Ada Admin', role: 'admin', password: PASSWORD },
    });
    ids.admin = b.adminId;
    await ctx.db.transaction(async (tx) => {
      ids.rep1 = await insertUser(tx, { email: 'rep1@test.example', fullName: 'Rae Rep', role: 'salesperson', password: PASSWORD }, null);
      ids.rep2 = await insertUser(tx, { email: 'rep2@test.example', fullName: 'Sam Second', role: 'salesperson', password: PASSWORD }, null);
    });
    for (const k of ['admin', 'rep1', 'rep2']) {
      const r = await call(null, 'POST', '/auth/sign-in/email', { email: `${k}@test.example`, password: PASSWORD });
      expect(r.status).toBe(200);
      cookies[k] = (r.res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
    }
    const a = await call('rep1', 'POST', '/api/v1/companies', { name: 'Stark Industries', domain: 'stark.example' });
    const c = await call('rep2', 'POST', '/api/v1/companies', { name: 'Wakanda Design Group', domain: 'wakanda.example' });
    expect([a.status, c.status]).toEqual([201, 201]);
    ids.companyA = a.json.id;
    ids.companyB = c.json.id;
  });
  afterAll(async () => {
    await pool.end();
  });

  it('imports the estimates sheet, and rejects a bad sheet with row errors and no partial import', async () => {
    const bad = await call('rep1', 'POST', `/api/v1/companies/${ids.companyA}/estimates`, {
      fileName: 'bad.csv',
      text: 'Scope ID,Task,Estimate hours,Status,% Done\nS-1,Workshop,sixteen,Done,100\nS-2,,8,Started,140\nS-3,Design,12,In progress,50\n',
    });
    expect(bad.status).toBe(422);
    expect(bad.json.code).toBe('ESTIMATES_INVALID');
    expect(bad.json.meta.errorCount).toBe(4);
    expect(bad.json.meta.errors).toEqual([
      { row: 2, column: 'Estimate hours', message: 'Must be a number of hours, 0 or more' },
      { row: 3, column: 'Task', message: 'Task is required' },
      { row: 3, column: 'Status', message: 'Use Not started, In progress or Done' },
      { row: 3, column: '% Done', message: 'Must be a number from 0 to 100' },
    ]);
    const noColumn = await call('rep1', 'POST', `/api/v1/companies/${ids.companyA}/estimates`, { fileName: 'x.csv', text: 'Task,Phase\nWorkshop,Discovery\n' });
    expect(noColumn.status).toBe(422);
    expect(noColumn.json.meta.missingColumns).toEqual(['Estimate hours']);
    expect(await ctx.db.select().from(estimateImport)).toHaveLength(0); // nothing was imported

    const ok = await call('rep1', 'POST', `/api/v1/companies/${ids.companyA}/estimates`, { fileName: 'estimates-sample.csv', text: SAMPLE_CSV });
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ items: 8, estimateHours: '220' });
    const got = await call('rep1', 'GET', `/api/v1/companies/${ids.companyA}/estimates`);
    expect(got.json.import).toMatchObject({ fileName: 'estimates-sample.csv', rowCount: 8, importedByName: 'Rae Rep' });
    expect(got.json.totals).toEqual({ items: 8, estimateHours: '220' });
    expect(got.json.items[0]).toMatchObject({
      rowNo: 2,
      scopeId: 'S-001',
      phase: 'Discovery',
      estimateHours: '16.00',
      sheetStatus: 'done',
      actualHours: '16.50',
    });
    expect(got.json.items[6]).toMatchObject({ scopeId: 'S-007', sheetStatus: null, pctDone: null });
    // Aliases: "Deliverable", "Effort", "Progress"; statuses "WIP" and "Completed".
    const alias = await call('rep1', 'POST', `/api/v1/companies/${ids.companyA}/estimates`, {
      fileName: 'alias.csv',
      text: 'ID,Deliverable,Module,Effort,Status,Progress\nA-1,First thing,Core,"1,250.5",WIP,40%\nA-2,Second thing,Core,8,Completed,\n',
    });
    expect(alias.status).toBe(201);
    expect(alias.json).toMatchObject({ items: 2, estimateHours: '1258.5' });
    // The latest import is the one in use: put the sample sheet back.
    expect((await call('rep1', 'POST', `/api/v1/companies/${ids.companyA}/estimates`, { fileName: 'estimates-sample.csv', text: SAMPLE_CSV })).status).toBe(
      201,
    );
    const [tl] = await ctx.db.select().from(timelineEvent).where(eq(timelineEvent.eventType, 'estimates_imported')).limit(1);
    expect(tl?.summary).toBe('Estimates sheet imported: 8 scope items, 220 h');

    // Another salesperson cannot see or change this company's estimates.
    expect((await call('rep2', 'POST', `/api/v1/companies/${ids.companyA}/estimates`, { fileName: 'x.csv', text: SAMPLE_CSV })).status).toBe(404);
    expect((await call('rep2', 'GET', `/api/v1/companies/${ids.companyA}/estimates`)).status).toBe(404);
    expect((await call(null, 'GET', `/api/v1/companies/${ids.companyA}/estimates`)).status).toBe(401);
  });

  it('the weekly schedule queues one run per company with estimates, exactly once', async () => {
    // CRM work for the week: S-001 finished on Wednesday, S-002 still open, one client meeting.
    const t1 = await call('rep1', 'POST', '/api/v1/tasks', {
      title: '[S-001] Run the requirements workshop',
      relatedType: 'company',
      relatedId: ids.companyA,
      dueAt: '2026-11-18T12:00:00Z',
    });
    const t2 = await call('rep1', 'POST', '/api/v1/tasks', {
      title: '[S-002] Write the solution design',
      relatedType: 'company',
      relatedId: ids.companyA,
      dueAt: '2026-11-25T12:00:00Z',
    });
    expect([t1.status, t2.status]).toEqual([201, 201]);
    expect((await call('rep1', 'POST', `/api/v1/tasks/${t1.json.id}/complete`)).status).toBe(200);
    await ctx.db
      .update(task)
      .set({ completedAt: new Date('2026-11-18T10:00:00Z') })
      .where(eq(task.id, t1.json.id));
    const meeting = await call('rep1', 'POST', '/api/v1/activities', {
      kind: 'meeting',
      occurredAt: '2026-11-19T15:00:00Z',
      outcome: 'Agreed the design approach',
      relatedType: 'company',
      relatedId: ids.companyA,
    });
    expect(meeting.status).toBe(201);

    const first = await runScheduledScans(ctx);
    expect(first.weeklyReports).toBe(1); // company B has no estimates sheet yet
    const second = await runScheduledScans(ctx);
    expect(second.weeklyReports).toBe(0);
    const runs = await runsOf(ids.companyA as string);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: 'queued',
      trigger: 'schedule',
      attempt: 1,
      periodStart: '2026-11-16',
      periodEnd: '2026-11-22',
      timeZone: 'UTC',
      runAsUserId: ids.rep1,
    });
    expect(await runsOf(ids.companyB as string)).toHaveLength(0);
    ids.runA = runs[0]!.id;
  });

  it('the run collects, matches, computes exact metrics, writes checked text and stores a draft deck', async () => {
    ai.reset();
    await runDueJobs(ctx);
    const [run] = await runsOf(ids.companyA as string);
    expect(run).toMatchObject({ status: 'ready', aiFallback: false, checkFlags: [], failureReason: null });
    const expected = { 'E-01': '8', 'E-02': '220', 'E-03': '1', 'E-04': '16', 'E-05': '7.3', 'E-06': '1', 'E-07': '204', 'E-08': '2' };
    for (const [id, value] of Object.entries(expected)) expect(metric(run!, id), id).toBe(value);
    expect(metric(run!, 'E-09')).toBe('3.1');
    expect(metric(run!, 'E-10')).toBe('0');
    expect(metric(run!, 'A-01')).toBe('1');
    expect(metric(run!, 'A-02')).toBe('1');
    expect(metric(run!, 'E-11')).toBe('6');
    expect(run!.metrics?.health).toEqual({ level: 'green', reasons: [] });
    expect(ai.calls).toHaveLength(1); // no regeneration needed
    expect(ai.calls[0]?.feature).toBe('weekly_report');
    expect(ai.calls[0]?.user).not.toMatch(/E-11|E-12|mismatch|unmatched/i); // internal figures never reach the model

    // Snapshot: stored write-once, fingerprint recorded.
    const snapshot = await ctx.storage.get(storageKeys.weeklyReportSnapshot(run!.id));
    expect(sha256Hex(snapshot)).toBe(run!.snapshotSha256);
    const frozen = JSON.parse(new TextDecoder().decode(snapshot));
    expect(frozen.company).toEqual({ id: ids.companyA, name: 'Stark Industries', ownerName: 'Rae Rep' });
    expect(frozen.tasks).toHaveLength(2);
    expect(frozen.activities).toHaveLength(1);
    expect(frozen.estimates.items).toHaveLength(8);

    // Detail: statements with their sources resolved to labels; the AI text awaits a person.
    const detail = await call('rep1', 'GET', `/api/v1/weekly-reports/${run!.id}`);
    expect(detail.status).toBe(200);
    expect(detail.json).toMatchObject({ status: 'ready', periodLabel: '16–22 Nov 2026', companyName: 'Stark Industries', flagCount: 0, approvable: true });
    expect(detail.json.permissions).toEqual({ canManage: true, canApprove: true });
    expect(detail.json.ai).toMatchObject({ provider: 'fake', simulated: true, promptVersion: 'weekly_report/v1', status: 'pending' });
    const summary = detail.json.narrative.find((s: any) => s.section === 'summary');
    expect(summary.statements[0].text).toBe(
      'This week we completed 1 scope item for Stark Industries, and the project is now 7.3% complete by estimated hours.',
    );
    expect(summary.statements[0].sources.map((s: any) => s.label)).toEqual(['Scope items completed this week: 1', 'Complete by estimate: 7.3']);
    const completed = detail.json.narrative.find((s: any) => s.section === 'completed');
    expect(completed.statements.map((s: any) => s.text)).toEqual(['We completed Requirements workshop and sign-off.']);
    expect(completed.statements[0].sources[0].label).toBe('S-001 · Requirements workshop and sign-off');

    // Draft deck: 6 slides, the client on slide 1, marked DRAFT, no source ids or internal words anywhere.
    const draft = await call('rep1', 'GET', `/api/v1/weekly-reports/${run!.id}/pptx/draft`);
    expect(draft.status).toBe(200);
    expect(draft.res.headers.get('content-type')).toContain('presentationml.presentation');
    expect(draft.res.headers.get('content-disposition')).toContain('Stark_Industries_Weekly_Status_2026-11-22_v1_DRAFT.pptx');
    expect(new TextDecoder().decode(draft.bytes.subarray(0, 2))).toBe('PK');
    const deck = await slides(draft.bytes);
    expect(deck.xml).toHaveLength(6);
    expect(deck.xml[0]).toContain('Stark Industries');
    expect(deck.xml[0]).toContain('16–22 Nov 2026');
    for (const slide of deck.xml) expect(slide).toContain('DRAFT');
    expect(deck.xml[1]).toContain('7.3%');
    expect(deck.xml[1]).toContain('On track');
    expect(deck.xml[3]).toContain('We completed Requirements workshop and sign-off.');
    expect(deck.xml[5]).toContain('No significant risks this week');
    for (const word of ['scope:', 'task:', 'metric:', 'activity:', 'mismatch', 'unmatched', 'E-11']) expect(deck.everything).not.toContain(word);
    expect((await call('rep1', 'GET', `/api/v1/weekly-reports/${run!.id}/pptx/final`)).status).toBe(404); // not approved yet
  });

  it('scopes reports to the company owner: another salesperson gets 404, the admin sees everything', async () => {
    expect((await call('rep1', 'GET', '/api/v1/weekly-reports')).json.items.map((r: any) => r.id)).toEqual([ids.runA]);
    expect((await call('rep2', 'GET', '/api/v1/weekly-reports')).json.items).toEqual([]);
    expect((await call('admin', 'GET', `/api/v1/weekly-reports?companyId=${ids.companyA}&status=ready`)).json.items).toHaveLength(1);
    expect((await call('admin', 'GET', '/api/v1/weekly-reports?status=approved')).json.items).toEqual([]);
    expect((await call('rep2', 'GET', `/api/v1/weekly-reports/${ids.runA}`)).status).toBe(404);
    expect((await call('rep2', 'GET', `/api/v1/weekly-reports/${ids.runA}/pptx/draft`)).status).toBe(404);
    expect((await call('rep2', 'POST', `/api/v1/weekly-reports/${ids.runA}/approve`, { rowVersion: 1 })).status).toBe(404);
    expect((await call('rep2', 'POST', `/api/v1/companies/${ids.companyA}/weekly-reports`)).status).toBe(404);
    expect((await call(null, 'GET', `/api/v1/weekly-reports/${ids.runA}`)).status).toBe(401);
    expect((await call('rep1', 'GET', `/api/v1/weekly-reports/${ids.runA}/pptx/other`)).status).toBe(404);
  });

  it('approval renders the final deck, records its fingerprint and accepts the AI text', async () => {
    const before = (await call('rep1', 'GET', `/api/v1/weekly-reports/${ids.runA}`)).json;
    const stale = await call('rep1', 'POST', `/api/v1/weekly-reports/${ids.runA}/approve`, { rowVersion: before.rowVersion + 5 });
    expect(stale.status).toBe(409);
    expect(stale.json.code).toBe('CONCURRENT_MODIFICATION');
    const ok = await call('rep1', 'POST', `/api/v1/weekly-reports/${ids.runA}/approve`, { rowVersion: before.rowVersion });
    expect(ok.status).toBe(200);
    expect(ok.json.status).toBe('approved');

    const [run] = await runsOf(ids.companyA as string);
    expect(run).toMatchObject({ status: 'approved', approvedBy: ids.rep1, finalPptxSha256: ok.json.finalPptxSha256 });
    expect(run!.approvedAt?.toISOString()).toBe(NOW.toISOString());
    const final = await call('rep1', 'GET', `/api/v1/weekly-reports/${ids.runA}/pptx/final`);
    expect(final.status).toBe(200);
    expect(sha256Hex(final.bytes)).toBe(run!.finalPptxSha256);
    expect(final.res.headers.get('content-disposition')).toContain('Stark_Industries_Weekly_Status_2026-11-22_v1.pptx');
    const deck = await slides(final.bytes);
    expect(deck.xml).toHaveLength(6);
    expect(deck.everything).not.toContain('DRAFT');

    const [generation] = await ctx.db
      .select()
      .from(aiGeneration)
      .where(eq(aiGeneration.id, run!.aiGenerationId as string));
    expect(generation).toMatchObject({ feature: 'weekly_report', status: 'accepted', decidedBy: ids.rep1, requestedBy: ids.rep1, dealId: null });
    expect((generation!.acceptedOutput as any).summary[0].text).toContain('7.3% complete');
    expect(generation!.target).toEqual({ weeklyReportRunId: ids.runA, companyId: ids.companyA });
    const audit = await ctx.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'weekly_report.approved'), eq(auditLog.targetId, ids.runA as string)));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorUserId).toBe(ids.rep1);

    // Approved is final: no second approval, and the scheduler does not create another run for the week.
    const again = await call('rep1', 'POST', `/api/v1/weekly-reports/${ids.runA}/approve`, { rowVersion: ok.json.rowVersion });
    expect(again.status).toBe(409);
    expect((await runScheduledScans(ctx)).weeklyReports).toBe(0);
    expect((await call('rep1', 'GET', `/api/v1/weekly-reports/${ids.runA}`)).json.permissions.canApprove).toBe(false);
  });

  it('"Generate now": needs estimates, refuses a second run while one is queued, and regenerates text that fails the checks', async () => {
    const none = await call('rep2', 'POST', `/api/v1/companies/${ids.companyB}/weekly-reports`);
    expect(none.status).toBe(422);
    expect(none.json.code).toBe('NO_ESTIMATES');
    expect((await call('rep2', 'POST', `/api/v1/companies/${ids.companyB}/estimates`, { fileName: 'estimates-sample.csv', text: SAMPLE_CSV })).status).toBe(
      201,
    );

    ai.reset();
    ai.enqueue(unsourced); // first draft fails NO_SOURCE; the second (built-in answer) passes
    const queued = await call('rep2', 'POST', `/api/v1/companies/${ids.companyB}/weekly-reports`);
    expect(queued.status).toBe(201);
    expect(queued.json).toMatchObject({ attempt: 1, status: 'queued', periodStart: '2026-11-16', periodEnd: '2026-11-22' });
    const busy = await call('rep2', 'POST', `/api/v1/companies/${ids.companyB}/weekly-reports`);
    expect(busy.status).toBe(409);
    expect(busy.json.code).toBe('WEEKLY_REPORT_IN_PROGRESS');

    await runDueJobs(ctx);
    const [run] = await runsOf(ids.companyB as string);
    expect(run).toMatchObject({ status: 'ready', trigger: 'manual', aiFallback: false, checkFlags: [], runAsUserId: ids.rep2, createdBy: ids.rep2 });
    expect(ai.calls).toHaveLength(2); // exactly one regeneration
    expect(ai.calls[0]?.user).not.toContain('"feedback"');
    expect(ai.calls[1]?.user).toContain('NO_SOURCE');
    // No CRM tasks for this company: the sheet alone decides, and nothing counts as "done this week" on a first report.
    expect(metric(run!, 'E-03')).toBe('1');
    expect(metric(run!, 'E-06')).toBe('0');
    expect(run!.metrics?.health).toEqual({ level: 'amber', reasons: ['NO_ITEMS_DONE_THIS_WEEK'] });
  });

  it('falls back to placeholders when the AI text keeps failing, and such a report cannot be approved', async () => {
    ai.reset();
    ai.enqueue(unsourced, unsourced, unsourced); // draft + 2 regenerations all fail the checks
    const queued = await call('rep2', 'POST', `/api/v1/companies/${ids.companyB}/weekly-reports`);
    expect(queued.json.attempt).toBe(2);
    await runDueJobs(ctx);
    const runs = await runsOf(ids.companyB as string);
    const run = runs[1]!;
    expect(ai.calls).toHaveLength(3);
    expect(run).toMatchObject({ status: 'needs_attention', aiFallback: true, aiGenerationId: null });
    expect(run.checkFlags.map((f) => f.code)).toEqual(['AI_FALLBACK']);
    for (const section of ['summary', 'completed', 'nextWeek', 'risks'] as const)
      expect(run.narrative?.[section]).toEqual([expect.objectContaining({ text: FALLBACK_TEXT, origin: 'fallback', sources: [] })]);
    expect(metric(run, 'E-01')).toBe('8'); // the figures are still computed: only the text is missing

    const detail = (await call('rep2', 'GET', `/api/v1/weekly-reports/${run.id}`)).json;
    expect(detail).toMatchObject({ status: 'needs_attention', aiFallback: true, approvable: false, flagCount: 1, ai: null });
    expect(detail.permissions.canApprove).toBe(false);
    const blocked = await call('rep2', 'POST', `/api/v1/weekly-reports/${run.id}/approve`, { rowVersion: detail.rowVersion });
    expect(blocked.status).toBe(422);
    expect(blocked.json.code).toBe('WEEKLY_REPORT_NOT_APPROVABLE');
    expect(blocked.json.meta.flags.map((f: any) => f.code)).toEqual(['AI_FALLBACK']);
    const draft = await call('rep2', 'GET', `/api/v1/weekly-reports/${run.id}/pptx/draft`);
    expect((await slides(draft.bytes)).xml[1]).toContain(FALLBACK_TEXT);

    // A provider failure also ends in placeholders — the run itself never fails because of AI.
    ai.reset();
    ai.enqueue(new AiProviderError('auth', 'bad key'));
    expect((await call('rep2', 'POST', `/api/v1/companies/${ids.companyB}/weekly-reports`)).json.attempt).toBe(3);
    await runDueJobs(ctx);
    const third = (await runsOf(ids.companyB as string))[2]!;
    expect(third).toMatchObject({ status: 'needs_attention', aiFallback: true, failureReason: null });
    expect(third.checkFlags[0]?.message).toContain('AI_PROVIDER_UNAVAILABLE');
  });

  it('a run whose owner is no longer active fails with a reason instead of crashing', async () => {
    await ctx.db
      .update(schema.appUserProfile)
      .set({ status: 'deactivated' })
      .where(eq(schema.appUserProfile.userId, ids.rep2 as string));
    const [row] = await ctx.db
      .insert(weeklyReportRun)
      .values({
        companyId: ids.companyB as string,
        runAsUserId: ids.rep2 as string,
        periodStart: '2026-11-09',
        periodEnd: '2026-11-15',
        timeZone: 'UTC',
        trigger: 'manual',
      })
      .returning();
    await ctx.db.insert(schema.jobOutbox).values({ queue: 'weekly_report.run', payload: { runId: row!.id }, runAfter: NOW });
    await runDueJobs(ctx);
    const [after] = await ctx.db.select().from(weeklyReportRun).where(eq(weeklyReportRun.id, row!.id));
    expect(after).toMatchObject({ status: 'failed', failureReason: 'RUN_AS_USER_INACTIVE' });
    await ctx.db
      .update(schema.appUserProfile)
      .set({ status: 'active' })
      .where(eq(schema.appUserProfile.userId, ids.rep2 as string));
  });

  it('weekly report text cannot be decided through the generic AI decision endpoint', async () => {
    ai.reset();
    expect((await call('rep1', 'POST', `/api/v1/companies/${ids.companyA}/weekly-reports`)).status).toBe(201);
    await runDueJobs(ctx);
    const run = (await runsOf(ids.companyA as string)).at(-1)!;
    expect(run.status).toBe('ready');
    ids.runA2 = run.id;
    const decided = await call('rep1', 'POST', `/api/v1/ai/generations/${run.aiGenerationId}/decision`, { decision: 'accept' });
    expect(decided.status).toBe(422);
    expect(decided.json.code).toBe('WEEKLY_REPORT_DECIDED_BY_APPROVAL');
    const [generation] = await ctx.db
      .select()
      .from(aiGeneration)
      .where(eq(aiGeneration.id, run.aiGenerationId as string));
    expect(generation?.status).toBe('pending');
    expect((await call('rep2', 'POST', `/api/v1/ai/generations/${run.aiGenerationId}/decision`, { decision: 'accept' })).status).toBe(404);
  });

  it('saving AI settings without the weekly_report switch keeps its stored value', async () => {
    const five = { draft_section: true, presend_review: true, deal_summary: true, rewrite_text: true, follow_up_email: true };
    const base = { enabled: true, perUserDailyCalls: 50, monthlyBudgetUsd: 50 };
    const off = await call('admin', 'PUT', '/api/v1/ai/settings', { ...base, features: { ...five, weekly_report: false } });
    expect(off.status).toBe(200);
    expect(off.json.settings.features.weekly_report).toBe(false);
    // A client that only knows the original five switches saves the settings.
    const old = await call('admin', 'PUT', '/api/v1/ai/settings', { ...base, perUserDailyCalls: 60, features: { ...five, rewrite_text: false } });
    expect(old.status).toBe(200);
    expect(old.json.settings).toMatchObject({ perUserDailyCalls: 60, features: { rewrite_text: false, weekly_report: false } });
    const [row] = await ctx.db.select({ ai: schema.organizationSettings.aiSettings }).from(schema.organizationSettings);
    expect(row?.ai.features?.weekly_report).toBe(false);
    // With the switch off the narrative falls back to placeholders (AI_DISABLED), and the run still completes.
    ai.reset();
    expect((await call('rep1', 'POST', `/api/v1/companies/${ids.companyA}/weekly-reports`)).status).toBe(201);
    await runDueJobs(ctx);
    const run = (await runsOf(ids.companyA as string)).at(-1)!;
    expect(run).toMatchObject({ status: 'needs_attention', aiFallback: true });
    expect(run.checkFlags[0]?.message).toContain('AI_DISABLED');
    expect(ai.calls).toHaveLength(0);
    ids.runFallbackA = run.id;
    expect(
      (await call('admin', 'PUT', '/api/v1/ai/settings', { ...base, features: { ...five, weekly_report: true } })).json.settings.features.weekly_report,
    ).toBe(true);
  });

  // ───────────── Part 2: edit, warnings, approve with edits, repair a fallback report, regenerate ─────────────
  const detailOf = async (who: string, id: string) => (await call(who, 'GET', `/api/v1/weekly-reports/${id}`)).json;
  const section = (detail: any, name: string) => detail.narrative.find((s: any) => s.section === name).statements;

  it('a person edits a sentence: the checks run again and the draft deck shows the new text', async () => {
    const before = await detailOf('rep1', ids.runA2 as string);
    expect(before.editable).toBe(true);
    expect(before.allowedSources.map((s: any) => s.id)).toEqual(expect.arrayContaining(['metric:E-05', 'period']));
    expect(before.allowedSources.some((s: any) => s.id.includes('E-11'))).toBe(false);
    const first = section(before, 'summary')[0];
    const text = 'We made steady progress with the Stark Industries team this week.';

    const stale = await call('rep1', 'PATCH', `/api/v1/weekly-reports/${ids.runA2}/narrative`, { statements: [{ id: first.id, text }], rowVersion: 999 });
    expect([stale.status, stale.json.code]).toEqual([409, 'CONCURRENT_MODIFICATION']);
    expect((await call('rep2', 'PATCH', `/api/v1/weekly-reports/${ids.runA2}/narrative`, { statements: [{ id: first.id, text }], rowVersion: 1 })).status).toBe(
      404,
    );
    expect((await call('rep1', 'PATCH', `/api/v1/weekly-reports/${ids.runA2}/narrative`, { rowVersion: before.rowVersion })).status).toBe(400);
    const missing = await call('rep1', 'PATCH', `/api/v1/weekly-reports/${ids.runA2}/narrative`, {
      statements: [{ id: 's999', text }],
      rowVersion: before.rowVersion,
    });
    expect([missing.status, missing.json.code]).toEqual([422, 'STATEMENT_NOT_FOUND']);

    const saved = await call('rep1', 'PATCH', `/api/v1/weekly-reports/${ids.runA2}/narrative`, {
      statements: [{ id: first.id, text }],
      rowVersion: before.rowVersion,
    });
    expect(saved.status).toBe(200);
    expect(saved.json).toMatchObject({ status: 'ready', flagCount: 0, warningCount: 0, rowVersion: before.rowVersion + 1 });
    const after = await detailOf('rep1', ids.runA2 as string);
    expect(section(after, 'summary')[0]).toMatchObject({ id: first.id, text, origin: 'user' });
    expect(section(after, 'summary')[1].origin).toBe('ai'); // untouched sentences stay AI text
    const deck = await slides((await call('rep1', 'GET', `/api/v1/weekly-reports/${ids.runA2}/pptx/draft`)).bytes);
    expect(deck.xml[1]).toContain(text);
    expect(deck.xml[1]).not.toContain('complete by estimated hours'); // the replaced AI sentence is gone
    const audit = await ctx.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'weekly_report.edited'), eq(auditLog.targetId, ids.runA2 as string)));
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]?.changes)).not.toContain('steady progress'); // counts only, never the text
  });

  it('a figure a person typed that is not in the data is a warning: approval needs an acknowledgement', async () => {
    const before = await detailOf('rep1', ids.runA2 as string);
    const second = section(before, 'summary')[1];
    const saved = await call('rep1', 'PATCH', `/api/v1/weekly-reports/${ids.runA2}/narrative`, {
      statements: [{ id: second.id, text: 'We saved 4321 hours of manual work.' }],
      rowVersion: before.rowVersion,
    });
    expect(saved.json).toMatchObject({ status: 'ready', flagCount: 0, warningCount: 1 }); // a warning does not block
    const detail = await detailOf('rep1', ids.runA2 as string);
    expect(detail.warnings).toEqual([expect.objectContaining({ code: 'UNVERIFIED_NUMBER', level: 'warning', statementId: second.id })]);
    expect(detail.permissions.canApprove).toBe(true);

    const refused = await call('rep1', 'POST', `/api/v1/weekly-reports/${ids.runA2}/approve`, { rowVersion: detail.rowVersion });
    expect([refused.status, refused.json.code]).toEqual([422, 'WEEKLY_REPORT_NOT_APPROVABLE']);
    expect(refused.json.meta).toMatchObject({ needsAcknowledgement: true });
    const ok = await call('rep1', 'POST', `/api/v1/weekly-reports/${ids.runA2}/approve`, { rowVersion: detail.rowVersion, acknowledgeWarnings: true });
    expect(ok.status).toBe(200);

    const run = (await runsOf(ids.companyA as string)).find((r) => r.id === ids.runA2)!;
    const [generation] = await ctx.db
      .select()
      .from(aiGeneration)
      .where(eq(aiGeneration.id, run.aiGenerationId as string));
    expect(generation).toMatchObject({ status: 'edited_accepted', decidedBy: ids.rep1 });
    expect((generation!.acceptedOutput as any).summary.map((s: any) => s.origin)).toEqual(['user', 'user']);
    const final = await slides((await call('rep1', 'GET', `/api/v1/weekly-reports/${ids.runA2}/pptx/final`)).bytes);
    expect(final.xml[1]).toContain('We saved 4321 hours of manual work.');
    expect(final.everything).not.toContain('DRAFT');

    // Approved is final: no edit, no regenerate.
    const edit = await call('rep1', 'PATCH', `/api/v1/weekly-reports/${ids.runA2}/narrative`, { removed: [second.id], rowVersion: ok.json.rowVersion });
    expect([edit.status, edit.json.code]).toEqual([422, 'WEEKLY_REPORT_NOT_EDITABLE']);
    const regen = await call('rep1', 'POST', `/api/v1/weekly-reports/${ids.runA2}/regenerate`);
    expect([regen.status, regen.json.code]).toEqual([422, 'WEEKLY_REPORT_NOT_EDITABLE']);
    expect((await detailOf('rep1', ids.runA2 as string)).editable).toBe(false);
  });

  it('a report that fell back to placeholders becomes approvable once a person writes the text', async () => {
    const before = await detailOf('rep1', ids.runFallbackA as string);
    expect(before).toMatchObject({ status: 'needs_attention', approvable: false, editable: true });
    const placeholder = (name: string) => section(before, name)[0].id;
    const badSource = await call('rep1', 'PATCH', `/api/v1/weekly-reports/${ids.runFallbackA}/narrative`, {
      added: [{ section: 'completed', text: 'We finished the workshop.', sources: ['metric:E-11'] }],
      rowVersion: before.rowVersion,
    });
    expect([badSource.status, badSource.json.code]).toEqual([422, 'UNKNOWN_SOURCE']);

    // Replace two placeholders; one is still left, so the report is not approvable yet.
    const partial = await call('rep1', 'PATCH', `/api/v1/weekly-reports/${ids.runFallbackA}/narrative`, {
      statements: [
        { id: placeholder('summary'), text: 'The project is progressing as planned.' },
        { id: placeholder('completed'), text: 'We completed the requirements workshop.' },
      ],
      removed: [placeholder('risks')],
      rowVersion: before.rowVersion,
    });
    expect(partial.json).toMatchObject({ status: 'needs_attention', flagCount: 1 });
    const mid = await detailOf('rep1', ids.runFallbackA as string);
    expect(mid.flags.map((f: any) => f.code)).toEqual(['PLACEHOLDER_TEXT']);
    expect(mid.approvable).toBe(false);

    const done = await call('rep1', 'PATCH', `/api/v1/weekly-reports/${ids.runFallbackA}/narrative`, {
      removed: [placeholder('nextWeek')],
      added: [{ section: 'nextWeek', text: 'We will continue with the solution design.', sources: ['metric:E-08'] }],
      rowVersion: mid.rowVersion,
    });
    expect(done.json).toMatchObject({ status: 'ready', flagCount: 0, warningCount: 0 });
    const after = await detailOf('rep1', ids.runFallbackA as string);
    expect(after).toMatchObject({ status: 'ready', approvable: true, aiFallback: true, ai: null });
    expect(section(after, 'nextWeek')).toEqual([expect.objectContaining({ text: 'We will continue with the solution design.', origin: 'user' })]);
    expect(section(after, 'nextWeek')[0].sources[0].label).toBe('Scope items in progress: 2');
    expect(section(after, 'risks')).toEqual([]);
    const draft = await slides((await call('rep1', 'GET', `/api/v1/weekly-reports/${ids.runFallbackA}/pptx/draft`)).bytes);
    expect(draft.everything).not.toContain(FALLBACK_TEXT);
    expect(draft.xml[5]).toContain('No significant risks this week');

    const ok = await call('rep1', 'POST', `/api/v1/weekly-reports/${ids.runFallbackA}/approve`, { rowVersion: after.rowVersion });
    expect(ok.status).toBe(200);
    expect(ok.json.status).toBe('approved');
  });

  it('"Regenerate" redrafts the text from the stored snapshot and replaces edits', async () => {
    ai.reset();
    expect((await call('rep2', 'POST', `/api/v1/companies/${ids.companyB}/weekly-reports`)).status).toBe(201);
    await runDueJobs(ctx);
    const run = (await runsOf(ids.companyB as string)).at(-1)!;
    expect(run.status).toBe('ready');
    const before = await detailOf('rep2', run.id);
    const first = section(before, 'summary')[0];
    const edited = await call('rep2', 'PATCH', `/api/v1/weekly-reports/${run.id}/narrative`, {
      statements: [{ id: first.id, text: 'An edit that will be replaced.' }],
      rowVersion: before.rowVersion,
    });
    expect(edited.status).toBe(200);

    const queued = await call('rep2', 'POST', `/api/v1/weekly-reports/${run.id}/regenerate`);
    expect(queued.status).toBe(200);
    expect(queued.json.status).toBe('queued');
    const again = await call('rep2', 'POST', `/api/v1/weekly-reports/${run.id}/regenerate`);
    expect([again.status, again.json.code]).toEqual([409, 'WEEKLY_REPORT_IN_PROGRESS']);
    const whileQueued = await call('rep2', 'PATCH', `/api/v1/weekly-reports/${run.id}/narrative`, { removed: [first.id], rowVersion: queued.json.rowVersion });
    expect(whileQueued.status).toBe(409);
    expect((await call('rep1', 'POST', `/api/v1/weekly-reports/${run.id}/regenerate`)).status).toBe(404);

    const snapshotBefore = run.snapshotSha256;
    await runDueJobs(ctx);
    const after = (await runsOf(ids.companyB as string)).at(-1)!;
    expect(after).toMatchObject({ id: run.id, status: 'ready', snapshotSha256: snapshotBefore, metrics: run.metrics }); // figures untouched
    expect(after.narrative?.summary[0]).toMatchObject({ origin: 'ai' });
    expect(after.narrative?.summary[0]?.text).not.toContain('An edit that will be replaced.');
    expect(ai.calls).toHaveLength(2); // the first draft and the redraft
    expect(after.aiGenerationId).not.toBe(run.aiGenerationId);
    const [old] = await ctx.db
      .select()
      .from(aiGeneration)
      .where(eq(aiGeneration.id, run.aiGenerationId as string));
    const [fresh] = await ctx.db
      .select()
      .from(aiGeneration)
      .where(eq(aiGeneration.id, after.aiGenerationId as string));
    expect([old?.status, fresh?.status]).toEqual(['discarded', 'pending']);
  });

  it('Admin sets the weekly schedule; a scheduled report notifies the owner once', async () => {
    expect((await call('rep1', 'GET', '/api/v1/admin/weekly-report-settings')).status).toBe(403);
    expect((await call('rep1', 'PUT', '/api/v1/admin/weekly-report-settings', { enabled: false, runWeekday: 1, runTime: '09:00' })).status).toBe(403);
    expect((await call('admin', 'GET', '/api/v1/admin/weekly-report-settings')).json).toEqual({
      enabled: true,
      runWeekday: 1,
      runTime: '09:00',
      timeZone: 'UTC',
    });
    expect((await call('admin', 'PUT', '/api/v1/admin/weekly-report-settings', { enabled: true, runWeekday: 8, runTime: '09:00' })).status).toBe(400);
    expect((await call('admin', 'PUT', '/api/v1/admin/weekly-report-settings', { enabled: true, runWeekday: 3, runTime: '9:00' })).status).toBe(400);
    const saved = await call('admin', 'PUT', '/api/v1/admin/weekly-report-settings', { enabled: true, runWeekday: 3, runTime: '14:30' });
    expect(saved.json).toEqual({ enabled: true, runWeekday: 3, runTime: '14:30', timeZone: 'UTC' });
    const audit = await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'weekly_report_settings.updated'));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.changes).toMatchObject({ before: { runWeekday: 1 }, after: { runWeekday: 3, runTime: '14:30' } });

    // The next week: nothing on Monday or before Wednesday 14:30; then one run per company with estimates.
    clock = new Date('2026-11-30T10:00:00.000Z');
    expect((await runScheduledScans(ctx)).weeklyReports).toBe(0);
    clock = new Date('2026-12-02T14:29:00.000Z');
    expect((await runScheduledScans(ctx)).weeklyReports).toBe(0);
    clock = new Date('2026-12-02T14:30:00.000Z');
    await call('admin', 'PUT', '/api/v1/admin/weekly-report-settings', { enabled: false, runWeekday: 3, runTime: '14:30' });
    expect((await runScheduledScans(ctx)).weeklyReports).toBe(0); // switched off
    await call('admin', 'PUT', '/api/v1/admin/weekly-report-settings', { enabled: true, runWeekday: 3, runTime: '14:30' });
    expect((await runScheduledScans(ctx)).weeklyReports).toBe(2);
    ai.reset();
    await runDueJobs(ctx);
    const newest = async (companyId: string) => (await runsOf(companyId)).filter((r) => r.periodStart === '2026-11-23').at(-1)!;
    const [a, b] = [await newest(ids.companyA as string), await newest(ids.companyB as string)];
    expect([a.trigger, a.status, b.trigger, b.status]).toEqual(['schedule', 'ready', 'schedule', 'ready']);
    // Week over week: the earlier approved report for company A is the baseline.
    expect(a.metrics?.metrics.find((m) => m.id === 'E-05')?.delta).toBe('0.0');

    const sent = await ctx.db.select().from(schema.notification).where(eq(schema.notification.eventType, 'weekly_report_ready'));
    const forRun = (id: string) => sent.filter((n) => n.linkPath === `/weekly-reports/${id}`);
    expect(forRun(a.id)).toEqual([expect.objectContaining({ recipientUserId: ids.rep1, title: 'Weekly report ready for Stark Industries' })]);
    expect(forRun(b.id)).toEqual([expect.objectContaining({ recipientUserId: ids.rep2, title: 'Weekly report ready for Wakanda Design Group' })]);
    expect(forRun(ids.runA as string)).toHaveLength(1); // the first scheduled run of this file
    expect(sent).toHaveLength(3); // manual "Generate now" runs and redrafts do not notify
    const bell = await call('rep1', 'GET', '/api/v1/notifications');
    expect(JSON.stringify(bell.json)).toContain('Weekly report ready for Stark Industries');
    // List search and the status filter used by the list page.
    const found = await call('admin', 'GET', '/api/v1/weekly-reports?q=wakanda&status=ready');
    expect(found.json.items.length).toBeGreaterThan(0);
    expect(found.json.items.every((r: any) => r.companyName === 'Wakanda Design Group' && r.status === 'ready')).toBe(true);
  });
});
