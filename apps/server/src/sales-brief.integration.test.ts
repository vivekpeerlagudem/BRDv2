/**
 * Weekly Sales Brief — integration tests: real PostgreSQL, real HTTP routes, real authorization, the mock AI.
 * The clock is fixed to Monday 23 Nov 2026 10:00 UTC (organization time zone UTC), so the brief covers
 * 16–22 Nov 2026, "last week" is 9–15 Nov, the month starts 1 Nov and the quarter 1 Oct.
 *
 * Record creation times and audit times come from the database clock, not the injected clock, so the tests set them
 * explicitly (with the migrator role, as the application role may not rewrite the append-only audit log).
 */
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildContext } from './composition.ts';
import { parseConfig } from './config/env.ts';
import { salesBriefRun } from './db/schema-sales-brief.ts';
import { createApp } from './http/app.ts';
import { bootstrap, insertUser } from './modules/identity.ts';
import { FALLBACK_TEXT } from './modules/weekly-reports/checks.ts';
import { runDueJobs, runScheduledScans } from './modules/workflow.ts';
import { storageKeys } from './platform/adapters.ts';
import { schema, sha256Hex } from './platform/core.ts';
import { DomainError } from './platform/errors/domain-error.ts';
import { MockAiProvider } from './platform/mock-ai.ts';
import { AiProviderError, type SheetTab, type SpreadsheetPublisher } from './platform/ports.ts';
import { testDbMigratorUrl, testDbUrl } from './test-db.ts';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env.local', import.meta.url)));
} catch {}
const testUrl = testDbUrl();
const PASSWORD = 'Correct-Horse-Battery-9';
const ORIGIN = 'http://localhost:5173';
const NOW = new Date('2026-11-23T10:00:00.000Z');
const WEEK = { from: '2026-11-16', to: '2026-11-22' };

describe.skipIf(!testUrl)('weekly sales brief (PostgreSQL integration)', () => {
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
  // A stand-in for the Google Sheets publisher: Google is never called. Switched on only in the publishing test.
  const sheet: { enabled: boolean; error: Error | null; published: SheetTab[][] } = { enabled: false, error: null, published: [] };
  const sheets: SpreadsheetPublisher = {
    name: 'fake-sheets',
    get enabled() {
      return sheet.enabled;
    },
    publish: async (tabs) => {
      if (sheet.error) throw sheet.error;
      sheet.published.push(tabs);
      return { url: 'https://sheets.example/brief' };
    },
    status: () => ({ provider: 'fake-sheets', configured: true, detail: 'test double' }),
  };
  const ai = new MockAiProvider();
  let clock = NOW;
  const { ctx, pool, auth } = buildContext(config, { now: () => clock, ai, sheets });
  const app = createApp(ctx, auth);
  const { aiGeneration, auditLog, notification, appUserProfile } = schema;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let raw: pg.Client;

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
  const at = async (iso: string, fn: () => Promise<unknown>) => {
    clock = new Date(iso);
    try {
      return await fn();
    } finally {
      clock = NOW;
    }
  };
  const ok = (r: { status: number; json: any }, status = 201) => {
    expect([r.status, r.json?.code]).toEqual([status, undefined]);
    return r.json;
  };
  const runs = () => ctx.db.select().from(salesBriefRun).orderBy(salesBriefRun.periodStart, salesBriefRun.attempt);
  const latest = async () => (await runs()).at(-1) as typeof salesBriefRun.$inferSelect;
  const value = (run: { metrics: { metrics: { id: string; value: string | null }[] } | null }, id: string) =>
    run.metrics?.metrics.find((m) => m.id === id)?.value;
  const brief = async (id: string) => (await call('admin', 'GET', `/api/v1/sales-briefs/${id}`)).json;
  const statements = (b: any, section: string) => b.narrative.find((s: any) => s.section === section).statements as any[];

  beforeAll(async () => {
    raw = new pg.Client({ connectionString: testDbMigratorUrl() });
    await raw.connect();
    const tables = await raw.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public' and tablename <> 'schema_migration'");
    await raw.query(`truncate ${tables.rows.map((t) => `"${t.tablename}"`).join(',')} restart identity cascade`);
    const b = await bootstrap(ctx, {
      organizationName: 'Kensium',
      currency: 'USD',
      timeZone: 'UTC',
      admin: { email: 'admin@test.example', fullName: 'Ada Admin', role: 'admin', password: PASSWORD },
    });
    ids.admin = b.adminId;
    await ctx.db.transaction(async (tx) => {
      ids.manager = await insertUser(tx, { email: 'manager@test.example', fullName: 'Mia Manager', role: 'sales_manager', password: PASSWORD }, null);
      ids.rep1 = await insertUser(tx, { email: 'rep1@test.example', fullName: 'Rae Rep', role: 'salesperson', password: PASSWORD }, null);
      ids.rep2 = await insertUser(tx, { email: 'rep2@test.example', fullName: 'Sam Second', role: 'salesperson', password: PASSWORD }, null);
    });
    for (const k of ['admin', 'manager', 'rep1', 'rep2']) {
      const r = await call(null, 'POST', '/auth/sign-in/email', { email: `${k}@test.example`, password: PASSWORD });
      expect(r.status).toBe(200);
      cookies[k] = (r.res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
    }
    const features = {
      draft_section: true,
      presend_review: true,
      deal_summary: true,
      rewrite_text: true,
      follow_up_email: true,
      weekly_report: true,
      sales_brief: true,
    };
    ok(await call('admin', 'PUT', '/api/v1/ai/settings', { enabled: true, perUserDailyCalls: 200, monthlyBudgetUsd: 50, features }), 200);

    const stage = Object.fromEntries(
      (await raw.query<{ id: string; name: string }>("select id, name from pipeline_stage where kind = 'open'")).rows.map((s) => [s.name, s.id]),
    );
    const reason = (await raw.query<{ id: string; name: string }>('select id, name from lost_reason order by name limit 1')).rows[0] as {
      id: string;
      name: string;
    };
    ids.lostReasonName = reason.name;
    const deal = async (who: string, name: string, stageName: string, amount: string, createdAt: string) => {
      const company = ok(await call(who, 'POST', '/api/v1/companies', { name: `${name} Co` }));
      const d = ok(await call(who, 'POST', '/api/v1/deals', { name, companyId: company.id, stageId: stage[stageName], amount }));
      await raw.query('update deal set created_at = $1 where id = $2', [createdAt, d.id]);
      return d.id as string;
    };
    // Opportunities. D1 won and D2 lost in the week; D3 advanced in the week; D4 new in the week.
    ids.d1 = await deal('rep1', 'Stark – ERP integration', 'Proposal sent', '20000', '2026-11-10T09:00:00Z');
    ids.d2 = await deal('rep2', 'Daily Bugle – Archive', 'Discovery', '10000', '2026-11-17T09:00:00Z');
    ids.d3 = await deal('rep1', 'S.H.I.E.L.D. – Field app', 'Qualification', '60000', '2026-10-20T09:00:00Z');
    ids.d4 = await deal('rep2', 'Wakanda – Inventory portal', 'Discovery', '15000', '2026-11-16T09:00:00Z');
    await at('2026-11-18T12:00:00Z', async () => ok(await call('rep1', 'POST', `/api/v1/deals/${ids.d1}/won`, {}), 200));
    await at('2026-11-19T12:00:00Z', async () => ok(await call('rep2', 'POST', `/api/v1/deals/${ids.d2}/lost`, { lostReasonId: reason.id }), 200));
    await at('2026-11-17T12:00:00Z', async () => {
      const d3 = (await call('rep1', 'GET', `/api/v1/deals/${ids.d3}`)).json;
      ok(await call('rep1', 'POST', `/api/v1/deals/${ids.d3}/stage`, { stageId: stage.Negotiation, rowVersion: d3.rowVersion }), 200);
    });
    await raw.query("update deal_stage_history set changed_at = '2026-11-17T12:00:00Z' where deal_id = $1 and from_stage_id is not null", [ids.d3]);

    // Leads. This week: 4 new, 2 qualified, 1 converted, 1 disqualified. Last week: 2 new, 1 qualified and converted.
    const lead = async (name: string, source: string, createdAt: string) => {
      const l = ok(await call('rep1', 'POST', '/api/v1/leads', { name, companyName: `${name} Ltd`, source }));
      await raw.query('update lead set created_at = $1 where id = $2', [createdAt, l.id]);
      return l.id as string;
    };
    const auditAt = (action: string, leadId: string, when: string) =>
      raw.query('update audit_log set occurred_at = $1 where action = $2 and target_id = $3', [when, action, leadId]);
    const convert = async (leadId: string, amount: string, when: string) => {
      const converted = (await at(when, async () => ok(await call('rep1', 'POST', `/api/v1/leads/${leadId}/convert`, { createDeal: true, amount }), 200))) as {
        dealId: string;
      };
      await raw.query('update deal set created_at = $1 where id = $2', [when, converted.dealId]);
      return converted.dealId;
    };
    const [l1, l2, l3] = [
      await lead('Peter Quill', 'referral', '2026-11-16T10:00:00Z'),
      await lead('Carol Danvers', 'referral', '2026-11-17T10:00:00Z'),
      await lead('Scott Lang', 'web form', '2026-11-18T10:00:00Z'),
    ];
    await lead('Hope Pym', 'web form', '2026-11-19T10:00:00Z');
    const l5 = await lead('Sam Wilson', 'event', '2026-11-10T10:00:00Z');
    await lead('Wanda Maximoff', 'event', '2026-11-11T10:00:00Z');
    for (const id of [l1, l2, l5]) ok(await call('rep1', 'POST', `/api/v1/leads/${id}/qualify`), 200);
    ok(await call('rep1', 'POST', `/api/v1/leads/${l3}/disqualify`, { reason: 'No budget this year' }), 200);
    await auditAt('lead.qualified', l1 as string, '2026-11-18T10:00:00Z');
    await auditAt('lead.qualified', l2 as string, '2026-11-18T11:00:00Z');
    await auditAt('lead.qualified', l5, '2026-11-11T10:00:00Z');
    await auditAt('lead.disqualified', l3 as string, '2026-11-19T10:00:00Z');
    ids.dConv = await convert(l1 as string, '5000', '2026-11-20T10:00:00Z');
    ids.dOld = await convert(l5, '8000', '2026-11-12T10:00:00Z');

    // Activity in the week: rep1 logs a call and a meeting and completes a task; rep2 logs nothing.
    for (const kind of ['call', 'meeting'])
      ok(
        await call('rep1', 'POST', '/api/v1/activities', {
          kind,
          occurredAt: '2026-11-18T15:00:00.000Z',
          outcome: 'Agreed next steps',
          relatedType: 'deal',
          relatedId: ids.d3,
        }),
      );
    const task = ok(
      await call('rep1', 'POST', '/api/v1/tasks', { title: 'Send the contract', relatedType: 'deal', relatedId: ids.d3, dueAt: '2026-11-19T12:00:00.000Z' }),
    );
    await at('2026-11-19T09:00:00Z', async () => ok(await call('rep1', 'POST', `/api/v1/tasks/${task.id}/complete`), 200));

    // Flags (normally raised by the scheduled scan): two stalled deals in one stage, one past its expected close date.
    await ctx.db.insert(schema.dealFlag).values([
      { dealId: ids.dConv as string, kind: 'stalled', raisedAt: new Date('2026-11-21T08:00:00Z') },
      { dealId: ids.dOld as string, kind: 'stalled', raisedAt: new Date('2026-11-21T08:00:00Z') },
      { dealId: ids.d4 as string, kind: 'past_close_date', raisedAt: new Date('2026-11-20T08:00:00Z') },
    ]);
  });
  afterAll(async () => {
    await raw.end();
    await pool.end();
  });

  it('is for admins only: sales managers and salespeople get 403 on every route, anonymous 401', async () => {
    const routes: [string, string, unknown?][] = [
      ['GET', '/api/v1/sales-briefs'],
      ['POST', '/api/v1/sales-briefs'],
      ['GET', '/api/v1/sales-briefs/01a2116b-0a46-7327-9e8b-68d64882560d'],
      ['PATCH', '/api/v1/sales-briefs/01a2116b-0a46-7327-9e8b-68d64882560d/narrative', { not: 'even parsed' }],
      ['POST', '/api/v1/sales-briefs/01a2116b-0a46-7327-9e8b-68d64882560d/regenerate'],
      ['POST', '/api/v1/sales-briefs/01a2116b-0a46-7327-9e8b-68d64882560d/approve', { rowVersion: 1 }],
      ['GET', '/api/v1/sales-briefs/01a2116b-0a46-7327-9e8b-68d64882560d/pptx/final'],
      ['GET', '/api/v1/sales-briefs/01a2116b-0a46-7327-9e8b-68d64882560d/xlsx/final'],
      ['GET', '/api/v1/admin/sales-brief-settings'],
      ['PUT', '/api/v1/admin/sales-brief-settings', { enabled: false, runWeekday: 1, runTime: '08:00' }],
    ];
    for (const [method, path, body] of routes) {
      for (const who of ['manager', 'rep1']) expect([who, method, path, (await call(who, method, path, body)).status]).toEqual([who, method, path, 403]);
      expect((await call(null, method, path, body)).status).toBe(401);
    }
    expect(await runs()).toHaveLength(0);
    expect((await call('admin', 'GET', '/api/v1/sales-briefs')).json).toEqual({ items: [] });
    for (const who of ['manager', 'rep1']) {
      const me = (await call(who, 'GET', '/api/v1/me')).json;
      expect(me.permissions['sales_brief.view']).toBeFalsy();
    }
    expect((await call('admin', 'GET', '/api/v1/me')).json.permissions['sales_brief.view']).toBeTruthy();
  });

  it('the Monday schedule queues exactly one brief for the last full week, at the configured time', async () => {
    const settings = (await call('admin', 'GET', '/api/v1/admin/sales-brief-settings')).json;
    expect(settings).toMatchObject({ enabled: true, runWeekday: 1, runTime: '08:00', ownerUserId: null, timeZone: 'UTC', sheet: { mode: 'fake-sheets' } });
    expect(settings.admins).toEqual([{ userId: ids.admin, name: 'Ada Admin' }]);
    clock = new Date('2026-11-23T07:59:00.000Z');
    expect((await runScheduledScans(ctx)).salesBriefs).toBe(0);
    clock = NOW;
    expect((await runScheduledScans(ctx)).salesBriefs).toBe(1);
    expect((await runScheduledScans(ctx)).salesBriefs).toBe(0); // a second scan adds nothing
    const all = await runs();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      status: 'queued',
      trigger: 'schedule',
      attempt: 1,
      periodStart: WEEK.from,
      periodEnd: WEEK.to,
      timeZone: 'UTC',
      sheetStatus: 'disabled',
    });
    ids.run = all[0]?.id as string;
  });

  it('the run computes S-01 … S-17 exactly, and the numbers equal the Reports page for the same dates', async () => {
    ai.reset();
    await runDueJobs(ctx);
    const run = await latest();
    expect(run).toMatchObject({ status: 'ready', runAsUserId: ids.admin, aiFallback: false, checkFlags: [] });
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0]?.feature).toBe('sales_brief');
    expect(Object.fromEntries((run.metrics?.metrics ?? []).map((m) => [m.id, m.value]))).toEqual({
      'S-01': '4',
      'S-02': '2',
      'S-03': '1',
      'S-04': '50.0', // 1 converted ÷ (1 converted + 1 disqualified)
      'S-05': '3', // D2, D4 and the deal from the converted lead
      'S-06': '1', // D3 moved from Qualification to Negotiation
      'S-07': '1',
      'S-08': '20000.00',
      'S-09': '1',
      'S-10': '50.0',
      'S-11': '88000.00', // 60000 + 15000 + 5000 + 8000
      'S-12': '8.0', // D1: created 10 Nov, won 18 Nov
      'S-13': '3',
      'S-14': '0',
      'S-15': '3', // 1 call + 1 meeting + 1 completed task
      'S-16': '2',
      'S-17': '5000.00', // 4 open × 20000 × 50 % ÷ 8 days
    });
    const m = (id: string) => run.metrics?.metrics.find((x) => x.id === id);
    expect(m('S-01')).toMatchObject({ lastWeek: '2', changePct: '100.0', mtd: '6', qtd: '6' });
    expect(m('S-03')).toMatchObject({ lastWeek: '1', mtd: '2', qtd: '2' });
    expect(m('S-04')).toMatchObject({ lastWeek: '100.0' });
    expect(m('S-05')).toMatchObject({ lastWeek: '2', mtd: '5', qtd: '6' }); // D3 was created in October
    expect(m('S-07')).toMatchObject({ lastWeek: '0', mtd: '1', qtd: '1' });
    expect(m('S-08')).toMatchObject({ lastWeek: '0.00', mtd: '20000.00', qtd: '20000.00' });
    expect(m('S-13')?.detail).toBe('stalled 2 · past close date 1 · proposal not viewed 0');
    expect(m('S-15')?.detail).toBe('calls 1 · meetings 1 · tasks completed 1');
    expect(run.metrics?.funnel.map((f) => [f.metricId, f.value, f.stepPct])).toEqual([
      ['S-01', 4, null],
      ['S-02', 2, '50.0'],
      ['S-03', 1, '50.0'],
      ['S-05', 3, '300.0'],
      ['S-07', 1, '33.3'],
    ]);
    expect(run.metrics?.wonDeals).toEqual([
      { dealId: ids.d1, name: 'Stark – ERP integration', owner: 'Rae Rep', ownerId: ids.rep1, amount: '20000.00', cycleDays: 8 },
    ]);
    expect(run.metrics?.lostDeals[0]).toMatchObject({ dealId: ids.d2, owner: 'Sam Second', amount: '10000.00', reason: ids.lostReasonName });
    expect(run.metrics?.leadSources).toEqual(expect.arrayContaining([{ source: 'referral', created: 2, converted: 1 }]));

    // The same figures as the Reports page (an Admin, the same dates).
    const report = (await call('admin', 'GET', `/api/v1/reports/overview?from=${WEEK.from}&to=${WEEK.to}`)).json;
    expect(Number(value(run, 'S-07'))).toBe(report.wonLost.won);
    expect(Number(value(run, 'S-09'))).toBe(report.wonLost.lost);
    expect(value(run, 'S-08')).toBe(report.wonLost.wonValue);
    expect(Number(value(run, 'S-10'))).toBe(report.wonLost.winRateCount);
    expect(value(run, 'S-11')).toBe(report.pipelineTotals.value);
    expect(run.metrics?.pipelineTotals).toEqual({
      count: report.pipelineTotals.count,
      value: report.pipelineTotals.value,
      weighted: report.pipelineTotals.weighted,
    });
    expect(run.metrics?.pipelineByStage).toEqual(
      report.pipelineByStage.map((p: any) => ({ stage: p.stage, count: p.count, value: p.value, weighted: p.weighted })),
    );
    expect(Number(value(run, 'S-14'))).toBe(report.proposals.sent);
    expect(Number(value(run, 'S-15'))).toBe(report.activity.reduce((n: number, a: any) => n + a.calls + a.meetings + a.tasksCompleted, 0));
    expect(Number(value(run, 'S-13'))).toBe(report.attention.length);
    expect(run.metrics?.reps.map((r) => [r.name, r.openDeals, r.openValue, r.won, r.wonRevenue])).toEqual(
      report.reps.map((r: any) => [r.name, r.openDeals, r.openValue, r.won, r.wonRevenue]),
    );
    const mtd = (await call('admin', 'GET', `/api/v1/reports/overview?from=2026-11-01&to=${WEEK.to}`)).json;
    expect(m('S-08')?.mtd).toBe(mtd.wonLost.wonValue);
    expect(Number(m('S-07')?.mtd)).toBe(mtd.wonLost.won);

    // The snapshot is stored write-once and fingerprinted.
    expect(sha256Hex(await ctx.storage.get(storageKeys.salesBriefSnapshot(run.id)))).toBe(run.snapshotSha256);
  });

  it('signals are computed by code with evidence; every insight and action is tied to one; evidence opens the record', async () => {
    const run = await latest();
    const find = (test: (title: string) => boolean) => run.signals.find((s) => test(s.title));
    expect(run.signals.length).toBeGreaterThanOrEqual(5);
    expect(run.signals.length).toBeLessThanOrEqual(8);
    expect(find((t) => t.includes('stalled in Qualification'))).toMatchObject({ kind: 'risk', severity: 'high', values: { deals: 2 } });
    expect(find((t) => t.startsWith('One deal, S.H.I.E.L.D. – Field app'))).toMatchObject({
      kind: 'concentration',
      severity: 'high',
      values: { sharePct: '68.2' },
    });
    expect(find((t) => t.startsWith('Rae Rep holds 83.0%'))).toMatchObject({ kind: 'concentration', recordIds: [`user:${ids.rep1}`] });
    expect(find((t) => t.startsWith('Deals past their expected close date rose from 0 to 1'))).toMatchObject({
      kind: 'risk',
      recordIds: [`deal:${ids.d4}`, `user:${ids.rep2}`],
    });
    expect(find((t) => t.startsWith('Sam Second has 1 open deal'))).toMatchObject({ kind: 'team', recordIds: [`user:${ids.rep2}`] });
    expect(run.signals[0]?.severity).toBe('high');

    const b = await brief(run.id);
    expect(b).toMatchObject({
      status: 'ready',
      periodLabel: '16–22 Nov 2026',
      runAsName: 'Ada Admin',
      editable: true,
      permissions: { canManage: true, canApprove: true },
    });
    expect(b.ai).toMatchObject({ provider: 'fake', simulated: true, promptVersion: 'sales_brief/v1', status: 'pending' });
    expect(b.kpis.map((k: any) => k.id)).toEqual(['S-01', 'S-05', 'S-08', 'S-10', 'S-11']);
    expect(statements(b, 'headline')[0].text).toBe('This week the team won 1 deal worth USD 20,000 and opened 3 new opportunities.');
    const signalIds = new Set(run.signals.map((s) => s.id));
    const insights = statements(b, 'insights');
    const actions = statements(b, 'actions');
    expect(insights.length).toBeGreaterThanOrEqual(3);
    expect(actions.length).toBeGreaterThanOrEqual(2);
    for (const s of [...insights, ...actions]) {
      expect(s.signalIds.length).toBeGreaterThanOrEqual(1);
      for (const id of s.signalIds) expect(signalIds.has(id)).toBe(true);
    }
    // Every sentence cites evidence that resolves to a readable label; deals link to their page; no raw ids are shown.
    for (const section of b.narrative)
      for (const s of section.statements) {
        expect(s.sources.length).toBeGreaterThanOrEqual(1);
        for (const src of s.sources) expect(src.label).not.toMatch(/^(deal|user|metric|signal):/);
      }
    const stalled = b.signals.find((s: any) => s.title.includes('stalled in Qualification'));
    expect(
      stalled.evidence
        .filter((e: any) => e.link)
        .map((e: any) => e.link)
        .sort(),
    ).toEqual([`/deals/${ids.dConv}`, `/deals/${ids.dOld}`].sort());
    // The model was given findings and figures, and no instruction to calculate.
    expect(ai.calls[0]?.user).toContain('"signals"');
    expect(ai.calls[0]?.system).toContain('Never calculate');
  });

  it('every active admin is notified once; draft PowerPoint and Excel are stored', async () => {
    const run = await latest();
    const notes = await ctx.db.select().from(notification).where(eq(notification.eventType, 'sales_brief_ready'));
    expect(notes.map((n) => [n.recipientUserId, n.linkPath])).toEqual([[ids.admin, `/sales-brief/${run.id}`]]);
    const pptx = await call('admin', 'GET', `/api/v1/sales-briefs/${run.id}/pptx/draft`);
    expect(pptx.status).toBe(200);
    expect(pptx.res.headers.get('content-disposition')).toContain('Kensium_Sales_Brief_2026-11-22_v1_DRAFT.pptx');
    const zip = await JSZip.loadAsync(pptx.bytes);
    const slideNames = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(slideNames).toHaveLength(9);
    for (const n of slideNames) expect(await (zip.file(n) as JSZip.JSZipObject).async('string')).toContain('DRAFT');
    const xlsx = await call('admin', 'GET', `/api/v1/sales-briefs/${run.id}/xlsx/draft`);
    expect(xlsx.res.headers.get('content-disposition')).toContain('Kensium_Sales_Brief_2026-11-22_v1_DRAFT.xlsx');
    expect((await call('admin', 'GET', `/api/v1/sales-briefs/${run.id}/pptx/final`)).status).toBe(404); // not approved yet
    expect((await call('admin', 'GET', `/api/v1/sales-briefs/${run.id}/xlsx/other`)).status).toBe(404);
  });

  it('an admin edits the text: stale saves are refused, own numbers become a warning to acknowledge', async () => {
    const run = await latest();
    const b = await brief(run.id);
    const first = statements(b, 'headline')[0];
    const stale = await call('admin', 'PATCH', `/api/v1/sales-briefs/${run.id}/narrative`, {
      statements: [{ id: first.id, text: 'x' }],
      rowVersion: b.rowVersion - 1,
    });
    expect([stale.status, stale.json.code]).toEqual([409, 'CONCURRENT_MODIFICATION']);
    const bad = await call('admin', 'PATCH', `/api/v1/sales-briefs/${run.id}/narrative`, {
      added: [{ section: 'actions', text: 'Call them.', sources: ['deal:not-in-this-brief'] }],
      rowVersion: b.rowVersion,
    });
    expect([bad.status, bad.json.code]).toEqual([422, 'UNKNOWN_SOURCE']);
    const aiActions = statements(b, 'actions');
    expect(aiActions).toHaveLength(4);
    const dropped = aiActions.at(-1);
    // A fifth action would break the limit of 4 and block approval.
    const tooMany = await call('admin', 'PATCH', `/api/v1/sales-briefs/${run.id}/narrative`, {
      added: [{ section: 'actions', text: 'One action too many.', sources: ['signal:1'] }],
      rowVersion: b.rowVersion,
    });
    expect(tooMany.json).toMatchObject({ status: 'needs_attention', flagCount: 1 });
    const extra = statements(await brief(run.id), 'actions').at(-1);
    ok(await call('admin', 'PATCH', `/api/v1/sales-briefs/${run.id}/narrative`, { removed: [extra.id], rowVersion: tooMany.json.rowVersion }), 200);
    b.rowVersion = tooMany.json.rowVersion + 1;
    const text = 'A strong week: one deal won, and we expect 12 demos next week.';
    const saved = await call('admin', 'PATCH', `/api/v1/sales-briefs/${run.id}/narrative`, {
      statements: [{ id: first.id, text }],
      added: [{ section: 'actions', text: 'Ask Rae Rep to add a second contact on the largest deal.', sources: ['signal:1', `user:${ids.rep1}`] }],
      removed: [dropped.id], // at most 4 actions: one AI action makes room for the admin's own
      rowVersion: b.rowVersion,
    });
    expect(saved.status).toBe(200);
    expect(saved.json).toMatchObject({ status: 'ready', flagCount: 0, warningCount: 1, rowVersion: b.rowVersion + 1 });
    const after = await brief(run.id);
    expect(statements(after, 'headline')[0]).toMatchObject({ text, origin: 'user' });
    expect(statements(after, 'actions').at(-1)).toMatchObject({ origin: 'user', signalIds: ['signal:1'] });
    expect(after.warnings.map((w: any) => w.code)).toEqual(['UNVERIFIED_NUMBER']);
    const audit = await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'sales_brief.edited')).orderBy(auditLog.seq);
    expect(audit.at(-1)?.changes).toEqual({ edited: 1, added: 1, removed: 1, status: 'ready' }); // counts only, never the text
    // Approval needs the acknowledgement.
    const refused = await call('admin', 'POST', `/api/v1/sales-briefs/${run.id}/approve`, { rowVersion: after.rowVersion });
    expect([refused.status, refused.json.code, refused.json.meta.needsAcknowledgement]).toEqual([422, 'SALES_BRIEF_NOT_APPROVABLE', true]);
  });

  it('approval creates the final PowerPoint and Excel (write-once, fingerprinted) and accepts the AI text', async () => {
    const run = await latest();
    const approved = await call('admin', 'POST', `/api/v1/sales-briefs/${run.id}/approve`, { rowVersion: run.rowVersion, acknowledgeWarnings: true });
    expect(approved.status).toBe(200);
    expect(approved.json).toMatchObject({ status: 'approved', sheetStatus: 'disabled' });
    const after = await latest();
    expect(after).toMatchObject({ status: 'approved', approvedBy: ids.admin, sheetStatus: 'disabled' });
    expect(after.finalPptxSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(after.xlsxSha256).toMatch(/^[0-9a-f]{64}$/);

    const pptx = await call('admin', 'GET', `/api/v1/sales-briefs/${run.id}/pptx/final`);
    expect(pptx.res.headers.get('content-disposition')).toContain('Kensium_Sales_Brief_2026-11-22_v1.pptx');
    expect(sha256Hex(pptx.bytes)).toBe(after.finalPptxSha256);
    const zip = await JSZip.loadAsync(pptx.bytes);
    const xml = await Promise.all(
      Object.keys(zip.files)
        .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort((a, b) => Number(/\d+/.exec(a)?.[0]) - Number(/\d+/.exec(b)?.[0]))
        .map((n) => (zip.file(n) as JSZip.JSZipObject).async('string')),
    );
    expect(xml).toHaveLength(9);
    expect(xml.join('\n')).not.toContain('DRAFT');
    expect(xml[1]).toContain('USD 20,000');
    expect(xml[2]).toContain('AI analysis — reviewed by Ada Admin');
    expect(xml[2]).toContain('Ask Rae Rep to add a second contact on the largest deal.');
    for (const internal of ['signal:', 'metric:', 'deal:', 'user:', ids.d3 as string, 'S-11']) expect(xml.join('\n')).not.toContain(internal);

    const xlsx = await call('admin', 'GET', `/api/v1/sales-briefs/${run.id}/xlsx/final`);
    expect(sha256Hex(xlsx.bytes)).toBe(after.xlsxSha256);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Buffer.from(xlsx.bytes) as never);
    expect(book.worksheets.map((w) => w.name)).toEqual([
      'Summary',
      'Insights',
      'Funnel',
      'Pipeline by stage',
      'Deals won',
      'Deals lost',
      'Team',
      'Attention',
      'Brief history',
    ]);
    const summary = book.getWorksheet('Summary') as ExcelJS.Worksheet;
    const cells: Record<string, unknown> = {};
    summary.eachRow((row) => {
      cells[String(row.getCell(1).value)] = row.getCell(4).value;
    });
    expect([cells['S-01'], cells['S-08'], cells['S-10'], cells['S-11']]).toEqual([4, 20000, 50, 88000]);
    const history = book.getWorksheet('Brief history') as ExcelJS.Worksheet;
    expect([history.getRow(2).getCell(2).value, history.getRow(2).getCell(3).value, history.getRow(2).getCell(8).value]).toEqual(['2026-11-16', 1, 20000]);

    const [generation] = await ctx.db
      .select()
      .from(aiGeneration)
      .where(eq(aiGeneration.id, after.aiGenerationId as string));
    expect(generation).toMatchObject({ feature: 'sales_brief', status: 'edited_accepted', decidedBy: ids.admin, requestedBy: ids.admin, dealId: null });
    const [audit] = await ctx.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'sales_brief.approved'), eq(auditLog.targetId, run.id)));
    expect(audit?.changes).toMatchObject({
      finalPptxSha256: after.finalPptxSha256,
      xlsxSha256: after.xlsxSha256,
      edited: true,
      acknowledgedWarnings: ['UNVERIFIED_NUMBER'],
    });

    // An approved brief is final.
    const b = await brief(run.id);
    expect(b).toMatchObject({ status: 'approved', editable: false, approvedByName: 'Ada Admin', hasFinal: true });
    const edit = await call('admin', 'PATCH', `/api/v1/sales-briefs/${run.id}/narrative`, {
      removed: [statements(b, 'headline')[0].id],
      rowVersion: b.rowVersion,
    });
    expect([edit.status, edit.json.code]).toEqual([422, 'SALES_BRIEF_NOT_EDITABLE']);
    expect((await call('admin', 'POST', `/api/v1/sales-briefs/${run.id}/regenerate`)).status).toBe(422);
    expect((await call('admin', 'POST', `/api/v1/sales-briefs/${run.id}/approve`, { rowVersion: b.rowVersion })).status).toBe(409);
    // The AI suggestion cannot be decided on its own: approving the brief is the decision.
    const decide = await call('admin', 'POST', `/api/v1/ai/generations/${after.aiGenerationId}/decision`, { decision: 'accept' });
    expect(decide.status).not.toBe(200);
  });

  it('"Generate now" makes a new version; a second request while one is queued is refused', async () => {
    const created = await call('admin', 'POST', '/api/v1/sales-briefs');
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ attempt: 2, periodStart: WEEK.from, status: 'queued' });
    const again = await call('admin', 'POST', '/api/v1/sales-briefs');
    expect([again.status, again.json.code]).toEqual([409, 'SALES_BRIEF_IN_PROGRESS']);
    ai.reset();
    await runDueJobs(ctx);
    const run = await latest();
    expect(run).toMatchObject({ attempt: 2, status: 'ready', trigger: 'manual' });
    expect((await call('admin', 'GET', '/api/v1/sales-briefs?status=approved')).json.items).toHaveLength(1);
    expect((await call('admin', 'GET', '/api/v1/sales-briefs')).json.items.map((i: any) => i.attempt)).toEqual([2, 1]);
  });

  it('"Regenerate" redrafts the text from the stored snapshot and replaces edits; the figures stay', async () => {
    const run = await latest();
    const b = await brief(run.id);
    const first = statements(b, 'headline')[0];
    ok(
      await call('admin', 'PATCH', `/api/v1/sales-briefs/${run.id}/narrative`, {
        statements: [{ id: first.id, text: 'Written by hand.' }],
        rowVersion: b.rowVersion,
      }),
      200,
    );
    const queued = await call('admin', 'POST', `/api/v1/sales-briefs/${run.id}/regenerate`);
    expect(queued.json).toMatchObject({ status: 'queued' });
    expect((await call('admin', 'PATCH', `/api/v1/sales-briefs/${run.id}/narrative`, { removed: [first.id], rowVersion: queued.json.rowVersion })).status).toBe(
      409,
    );
    await runDueJobs(ctx);
    const after = await latest();
    expect(after).toMatchObject({ status: 'ready', attempt: 2, snapshotSha256: run.snapshotSha256 });
    expect(after.metrics).toEqual(run.metrics);
    expect(after.narrative?.headline[0]).toMatchObject({
      origin: 'ai',
      text: 'This week the team won 1 deal worth USD 20,000 and opened 3 new opportunities.',
    });
  });

  it('AI text that fails the checks is retried twice, then replaced by placeholders a person writes', async () => {
    const invented = {
      text: JSON.stringify({
        headline: [{ text: 'Revenue will reach 999000 next month.', sources: ['metric:S-08'] }],
        insights: [],
        actions: [],
        throughput: [],
        wins: [],
        pipeline: [],
        risks: [],
        team: [],
      }),
    };
    ok(await call('admin', 'POST', '/api/v1/sales-briefs'));
    ai.reset();
    ai.enqueue(invented, invented, invented);
    await runDueJobs(ctx);
    const run = await latest();
    expect(ai.calls).toHaveLength(3); // the draft and two regenerations
    expect(ai.calls[1]?.user).toContain('"feedback"');
    expect(run).toMatchObject({ attempt: 3, status: 'needs_attention', aiFallback: true, aiGenerationId: null });
    expect(run.checkFlags.map((f) => f.code)).toEqual(['AI_FALLBACK']);
    expect(run.checkFlags[0]?.message).toBe(
      'No AI analysis: the AI text did not pass the checks. The figures and findings are complete; write the text yourself, or regenerate.',
    );
    expect(value(run, 'S-08')).toBe('20000.00'); // the figures and findings are complete without AI
    expect(run.signals.length).toBeGreaterThanOrEqual(5);
    expect(run.narrative?.headline[0]).toMatchObject({ text: FALLBACK_TEXT, origin: 'fallback' });
    const blocked = await call('admin', 'POST', `/api/v1/sales-briefs/${run.id}/approve`, { rowVersion: run.rowVersion });
    expect([blocked.status, blocked.json.code]).toEqual([422, 'SALES_BRIEF_NOT_APPROVABLE']);

    const b = await brief(run.id);
    const placeholders = b.narrative.flatMap((s: any) => s.statements);
    expect(placeholders).toHaveLength(3);
    const written = await call('admin', 'PATCH', `/api/v1/sales-briefs/${run.id}/narrative`, {
      statements: placeholders.map((s: any, i: number) => ({ id: s.id, text: `Written by the admin, sentence ${['one', 'two', 'three'][i]}.` })),
      rowVersion: b.rowVersion,
    });
    expect(written.json).toMatchObject({ status: 'ready', flagCount: 0 });
    expect((await brief(run.id)).permissions.canApprove).toBe(true);
  });

  it('a provider failure also ends in placeholders — the run never fails because of AI', async () => {
    ok(await call('admin', 'POST', '/api/v1/sales-briefs'));
    ai.reset();
    ai.enqueue(new AiProviderError('server_error', 'down'), new AiProviderError('server_error', 'down'), new AiProviderError('server_error', 'down'));
    await runDueJobs(ctx);
    const run = await latest();
    expect(run).toMatchObject({ status: 'needs_attention', aiFallback: true });
    expect(run.checkFlags[0]?.message).toContain('the AI service was not available');
    expect(run.draftPptxFileId).not.toBeNull();
    expect(run.draftXlsxFileId).not.toBeNull();
  });

  it('Google publishing (behind a switch) runs only after approval, and a failure never changes the brief', async () => {
    const approveLatest = async () => {
      const candidates = (await runs()).filter((r) => r.status === 'ready');
      const run = candidates.at(-1) as typeof salesBriefRun.$inferSelect;
      const done = await call('admin', 'POST', `/api/v1/sales-briefs/${run.id}/approve`, { rowVersion: run.rowVersion, acknowledgeWarnings: true });
      expect(done.status).toBe(200);
      return { id: run.id, json: done.json };
    };
    sheet.enabled = true;
    try {
      const first = await approveLatest();
      expect(first.json.sheetStatus).toBe('pending');
      expect(sheet.published).toHaveLength(0); // nothing is written before the job runs
      await runDueJobs(ctx);
      expect(sheet.published).toHaveLength(1);
      expect(sheet.published[0]?.map((t) => t.name)).toContain('Brief history');
      const history = sheet.published[0]?.find((t) => t.name === 'Brief history') as SheetTab;
      expect(history.rows.length).toBeGreaterThanOrEqual(2); // this brief and the one approved earlier
      expect((await brief(first.id)).sheet).toEqual({ status: 'published', mode: 'fake-sheets', enabled: true });

      // A failing publish: the brief stays approved and downloadable; only the sheet status says "failed".
      ok(await call('admin', 'POST', '/api/v1/sales-briefs'));
      ai.reset();
      await runDueJobs(ctx);
      sheet.error = new DomainError('SALES_BRIEF_SHEET_NOT_SHARED', 422, 'not shared');
      const second = await approveLatest();
      await runDueJobs(ctx);
      const after = await brief(second.id);
      expect(after).toMatchObject({ status: 'approved', sheet: { status: 'failed' } });
      expect((await call('admin', 'GET', `/api/v1/sales-briefs/${second.id}/xlsx/final`)).status).toBe(200);
      expect((await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'sales_brief.sheet_failed')))[0]?.changes).toEqual({
        reason: 'SALES_BRIEF_SHEET_NOT_SHARED',
      });
    } finally {
      sheet.enabled = false;
      sheet.error = null;
    }
  });

  it('settings: the brief can run for a chosen admin only; without an active admin a run fails with a clear reason', async () => {
    const notAdmin = await call('admin', 'PUT', '/api/v1/admin/sales-brief-settings', {
      enabled: true,
      runWeekday: 1,
      runTime: '08:00',
      ownerUserId: ids.rep1,
    });
    expect([notAdmin.status, notAdmin.json.code]).toEqual([422, 'SALES_BRIEF_OWNER_NOT_ADMIN']);
    expect((await call('admin', 'PUT', '/api/v1/admin/sales-brief-settings', { enabled: true, runWeekday: 9, runTime: '08:00' })).status).toBe(400);
    const saved = await call('admin', 'PUT', '/api/v1/admin/sales-brief-settings', { enabled: true, runWeekday: 2, runTime: '07:30', ownerUserId: ids.admin });
    expect(saved.json).toMatchObject({ enabled: true, runWeekday: 2, runTime: '07:30', ownerUserId: ids.admin });
    expect(await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'sales_brief_settings.updated'))).toHaveLength(1);
    // Next week: nothing on Monday (the run day is now Tuesday 07:30).
    clock = new Date('2026-11-30T10:00:00.000Z');
    expect((await runScheduledScans(ctx)).salesBriefs).toBe(0);
    clock = new Date('2026-12-01T07:30:00.000Z');
    expect((await runScheduledScans(ctx)).salesBriefs).toBe(1);
    // No active admin when the job runs.
    await ctx.db
      .update(appUserProfile)
      .set({ status: 'deactivated' })
      .where(eq(appUserProfile.userId, ids.admin as string));
    try {
      await runDueJobs(ctx);
      const run = await latest();
      expect(run).toMatchObject({ periodStart: '2026-11-23', status: 'failed', failureReason: 'NO_ACTIVE_ADMIN' });
    } finally {
      await ctx.db
        .update(appUserProfile)
        .set({ status: 'active' })
        .where(eq(appUserProfile.userId, ids.admin as string));
      clock = NOW;
    }
  });
});
