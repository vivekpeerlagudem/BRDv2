/**
 * Reporting integration tests (BR-RPT-001..010) — real PostgreSQL, real HTTP routes, real authorization.
 * A small known dataset is created through the API (deals, closes, activities, notes, tasks, a sent + viewed proposal);
 * only timestamps are then moved to fixed dates so every figure can be asserted exactly. The one fixture written
 * straight to the database is a completed signature request (the real signing flow would also close the deal).
 * Organization time zone is UTC unless a test says otherwise; the period under test is June 2026.
 */
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildContext } from './composition.ts';
import { parseConfig } from './config/env.ts';
import { createApp } from './http/app.ts';
import { bootstrap, insertUser } from './modules/identity.ts';
import { csvCell } from './modules/reporting.ts';
import { runScheduledScans } from './modules/workflow.ts';
import { schema } from './platform/core.ts';
import { testDbMigratorUrl, testDbUrl } from './test-db.ts';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env.local', import.meta.url)));
} catch {}
const testUrl = testDbUrl();
const PASSWORD = 'Correct-Horse-Battery-9';
const ORIGIN = 'http://localhost:5173';
const JUNE = 'from=2026-06-01&to=2026-06-30';
const FORMULA_NAME = '=SUM(1,2) "Q3", deal';

describe.skipIf(!testUrl)('reports (PostgreSQL integration)', () => {
  const config = parseConfig({
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: testUrl,
    APP_ORIGIN: ORIGIN,
    BUYER_ORIGIN: 'http://proposals.localhost:5173',
    STORAGE_DIR: './.data/test-storage',
  });
  const { ctx, pool, auth } = buildContext(config);
  const app = createApp(ctx, auth);
  const { deal, note, task, proposal, proposalVersion, shareLink, viewSession, signatureRequest, pipelineStage } = schema;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const at = (v: string) => new Date(v);

  async function call(who: string | null, method: string, path: string, body?: unknown, extraCookie?: string) {
    const headers: Record<string, string> = { origin: ORIGIN, 'content-type': 'application/json' };
    const cookie = extraCookie ?? (who ? cookies[who] : undefined);
    if (cookie) headers.cookie = cookie;
    const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    // ignoreBOM keeps a leading byte-order mark in the text, so the CSV tests can assert it is really sent.
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer());
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, res, text };
  }
  const cookieOf = (res: Response) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const overview = async (who: string, qs = JUNE) => {
    const r = await call(who, 'GET', `/api/v1/reports/overview?${qs}`);
    expect(r.status, r.text).toBe(200);
    return r.json;
  };

  /** Creates a deal through the API; optional close and fixed created / closed timestamps. */
  async function makeDeal(
    key: string,
    who: string,
    o: { name: string; amount?: string; stage: 'stage0' | 'stage1'; closeDate?: string; created?: string; won?: string; lost?: string; reason?: string },
  ) {
    const companyKey = `company_${who}`;
    if (!ids[companyKey]) {
      const co = await call(who, 'POST', '/api/v1/companies', { name: `Customer of ${who}`, domain: `${who}-customer.example` });
      expect(co.status, co.text).toBe(201);
      ids[companyKey] = co.json.id;
    }
    const d = await call(who, 'POST', '/api/v1/deals', {
      name: o.name,
      companyId: ids[companyKey],
      stageId: ids[o.stage],
      ...(o.amount ? { amount: o.amount } : {}),
      ...(o.closeDate ? { closeDate: o.closeDate } : {}),
    });
    expect(d.status, d.text).toBe(201);
    const id = d.json.id as string;
    ids[key] = id;
    if (o.won) expect((await call(who, 'POST', `/api/v1/deals/${id}/won`, {})).status).toBe(200);
    if (o.lost) expect((await call(who, 'POST', `/api/v1/deals/${id}/lost`, { lostReasonId: ids[o.reason ?? 'reason0'] })).status).toBe(200);
    const closed = o.won ?? o.lost;
    if (o.created || closed)
      await ctx.db
        .update(deal)
        .set({ ...(o.created ? { createdAt: at(o.created) } : {}), ...(closed ? { closedAt: at(closed), closeDate: closed.slice(0, 10) } : {}) })
        .where(eq(deal.id, id));
    return id;
  }

  /** Drafts and sends a proposal through the API, optionally lets the buyer view it, then fixes the timestamps. */
  async function sendProposal(key: string, who: string, dealId: string, o: { sentAt: string; viewedAt?: string }) {
    const contact = await call(who, 'POST', '/api/v1/contacts', {
      firstName: 'Buyer',
      lastName: key,
      email: `buyer-${key}@customer.example`,
      companyId: ids[`company_${who}`],
    });
    expect(contact.status, contact.text).toBe(201);
    expect((await call(who, 'POST', `/api/v1/deals/${dealId}/contacts`, { contactId: contact.json.id, roles: [], isPrimary: true })).status).toBe(201);
    const created = await call(who, 'POST', `/api/v1/deals/${dealId}/proposals`, { templateId: ids.template });
    expect(created.status, created.text).toBe(201);
    const pid = created.json.id as string;
    ids[key] = pid;
    const p = (await call(who, 'GET', `/api/v1/proposals/${pid}`)).json;
    const content = {
      ...p.currentVersion.content,
      sections: p.currentVersion.content.sections.map((s: any) => (s.id === 'scope' ? { ...s, body: 'Agreed scope of work.' } : s)),
    };
    const saved = await call(who, 'PUT', `/api/v1/proposals/${pid}/draft`, {
      content,
      pricing: p.currentVersion.pricing,
      termMonths: p.currentVersion.termMonths,
      rowVersion: p.currentVersion.rowVersion,
    });
    expect(saved.status, saved.text).toBe(200);
    let sent = await call(who, 'POST', `/api/v1/proposals/${pid}/send`, { recipientContactIds: [contact.json.id] });
    if (sent.json?.code === 'CONFIRMATION_REQUIRED')
      sent = await call(who, 'POST', `/api/v1/proposals/${pid}/send`, {
        recipientContactIds: [contact.json.id],
        confirm: sent.json.meta.confirmations.map((c: any) => c.code),
      });
    expect(sent.status, sent.text).toBe(200);
    const versionId = sent.json.versionId as string;
    ids[`${key}_version`] = versionId;
    await ctx.db
      .update(proposalVersion)
      .set({ sentAt: at(o.sentAt) })
      .where(eq(proposalVersion.id, versionId));
    if (o.viewedAt) {
      const token = new URL(sent.json.links[0].url).hash.slice(1);
      const ex = await call(null, 'POST', '/public/v1/session/exchange', { token });
      expect(ex.status, ex.text).toBe(200);
      const buyer = cookieOf(ex.res);
      expect((await call(null, 'POST', '/public/v1/identity/continue', {}, buyer)).status).toBe(200);
      const vs = await call(null, 'POST', '/public/v1/views/start', {}, buyer);
      const hb = await call(null, 'POST', '/public/v1/views/heartbeat', { viewSessionId: vs.json.viewSessionId, activeSeconds: 15, sectionId: 'scope' }, buyer);
      expect(hb.json.counted, hb.text).toBe(true);
      await ctx.db
        .update(shareLink)
        .set({ firstViewedAt: at(o.viewedAt), lastViewedAt: at(o.viewedAt) })
        .where(eq(shareLink.proposalVersionId, versionId));
      await ctx.db
        .update(viewSession)
        .set({ startedAt: at(o.viewedAt) })
        .where(eq(viewSession.id, vs.json.viewSessionId));
    }
    return pid;
  }

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: testDbMigratorUrl() });
    await admin.connect();
    const tables = await admin.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public' and tablename <> 'schema_migration'");
    await admin.query(`truncate ${tables.rows.map((t) => `"${t.tablename}"`).join(',')} restart identity cascade`);
    await admin.end();

    const b = await bootstrap(ctx, {
      organizationName: 'Reports Test Org',
      currency: 'USD',
      timeZone: 'UTC',
      admin: { email: 'admin@test.example', fullName: 'Ada Admin', role: 'admin', password: PASSWORD },
    });
    ids.admin = b.adminId;
    const [east] = await ctx.db.insert(schema.team).values({ name: 'East' }).returning();
    const [west] = await ctx.db.insert(schema.team).values({ name: 'West' }).returning();
    ids.east = east!.id;
    ids.west = west!.id;
    await ctx.db.transaction(async (tx) => {
      ids.manager = await insertUser(tx, { email: 'manager@test.example', fullName: 'Mia Manager', role: 'sales_manager', password: PASSWORD }, null);
      ids.rep1 = await insertUser(tx, { email: 'rep1@test.example', fullName: 'Rae Rep', role: 'salesperson', password: PASSWORD, teamId: ids.east }, null);
      ids.rep2 = await insertUser(tx, { email: 'rep2@test.example', fullName: 'Sam Second', role: 'salesperson', password: PASSWORD, teamId: ids.east }, null);
      ids.rep3 = await insertUser(tx, { email: 'rep3@test.example', fullName: 'Tia Third', role: 'salesperson', password: PASSWORD, teamId: ids.west }, null);
      await tx.insert(schema.teamManager).values({ teamId: ids.east!, userId: ids.manager });
    });
    for (const k of ['admin', 'manager', 'rep1', 'rep2', 'rep3']) {
      const r = await call(null, 'POST', '/auth/sign-in/email', { email: `${k}@test.example`, password: PASSWORD });
      expect(r.status, r.text).toBe(200);
      cookies[k] = cookieOf(r.res);
    }

    // Known stage probabilities: first open stage 25 %, second 50 % (stall threshold 30 days on the second).
    const pl = (await call('admin', 'GET', '/api/v1/pipeline')).json;
    const open = pl.stages.filter((s: any) => s.kind === 'open');
    ids.stage0 = open[0].id;
    ids.stage1 = open[1].id;
    ids.stage0Name = open[0].name;
    ids.stage1Name = open[1].name;
    ids.reason0 = pl.lostReasons[0].id;
    ids.reason1 = pl.lostReasons[1].id;
    ids.reason0Name = pl.lostReasons[0].name;
    ids.reason1Name = pl.lostReasons[1].name;
    await ctx.db.update(pipelineStage).set({ stallThresholdDays: null });
    await ctx.db
      .update(pipelineStage)
      .set({ probability: '25' })
      .where(eq(pipelineStage.id, ids.stage0 as string));
    await ctx.db
      .update(pipelineStage)
      .set({ probability: '50', stallThresholdDays: 30 })
      .where(eq(pipelineStage.id, ids.stage1 as string));

    // ── Deals. rep1 + rep2 are in team East (managed by Mia); rep3 is outside it.
    await makeDeal('a1', 'rep1', { name: FORMULA_NAME, amount: '10000.00', stage: 'stage0', created: '2026-06-05T00:00:00Z', closeDate: '2026-06-30' });
    await makeDeal('a2', 'rep1', { name: 'A2 open old', amount: '5000.50', stage: 'stage1', created: '2026-05-01T00:00:00Z' });
    await makeDeal('a3', 'rep1', { name: 'A3 won', amount: '20000.00', stage: 'stage0', created: '2026-06-01T10:00:00Z', won: '2026-06-11T10:00:00Z' });
    await makeDeal('a4', 'rep1', {
      name: 'A4 won last second',
      amount: '4000.00',
      stage: 'stage0',
      created: '2026-06-10T12:00:00Z',
      won: '2026-06-30T23:59:59Z',
    });
    await makeDeal('a5', 'rep1', { name: 'A5 lost', amount: '6000.00', stage: 'stage0', created: '2026-06-02T00:00:00Z', lost: '2026-06-15T09:00:00Z' });
    await makeDeal('a6', 'rep1', { name: 'A6 won in July', amount: '9999.00', stage: 'stage0', created: '2026-06-03T00:00:00Z', won: '2026-07-01T00:00:00Z' });
    await makeDeal('b1', 'rep2', { name: 'B1 open', amount: '3000.00', stage: 'stage0', created: '2026-06-20T00:00:00Z' });
    await makeDeal('b2', 'rep2', {
      name: 'B2 lost first second',
      amount: '1000.00',
      stage: 'stage0',
      created: '2026-05-20T00:00:00Z',
      lost: '2026-06-01T00:00:00Z',
      reason: 'reason1',
    });
    await makeDeal('b3', 'rep2', { name: 'B3 no amount', stage: 'stage1' });
    await makeDeal('c1', 'rep3', { name: 'C1 open outside', amount: '70000.00', stage: 'stage0', created: '2026-04-01T00:00:00Z' });
    await makeDeal('c2', 'rep3', { name: 'C2 won outside', amount: '50000.00', stage: 'stage0', created: '2026-06-08T08:00:00Z', won: '2026-06-10T08:00:00Z' });
    await makeDeal('m1', 'manager', { name: 'M1 manager deal', amount: '800.00', stage: 'stage1' });

    // ── Proposals: P1 sent + viewed (6 h), P2 sent and never viewed, P3 sent, viewed (24 h) and signed (3 days).
    const t = await call('admin', 'POST', '/api/v1/templates', { name: 'Standard proposal' });
    expect(t.status, t.text).toBe(201);
    ids.template = t.json.id;
    expect((await call('admin', 'POST', `/api/v1/templates/${ids.template}/publish`)).status).toBe(200);
    await sendProposal('p1', 'rep1', ids.a1!, { sentAt: '2026-06-07T00:00:00Z', viewedAt: '2026-06-07T06:00:00Z' });
    await sendProposal('p2', 'rep2', ids.b1!, { sentAt: '2026-06-24T00:00:00Z' });
    await sendProposal('p3', 'rep3', ids.c1!, { sentAt: '2026-06-11T00:00:00Z', viewedAt: '2026-06-12T00:00:00Z' });
    await ctx.db.insert(signatureRequest).values({
      proposalId: ids.p3!,
      proposalVersionId: ids.p3_version!,
      dealId: ids.c1!,
      requestedBy: ids.rep3!,
      provider: 'fake',
      signingOrder: 'parallel',
      status: 'signed',
      documentSha256: 'a'.repeat(64),
      expiresAt: at('2026-07-11T00:00:00Z'),
      completedAt: at('2026-06-14T00:00:00Z'),
    });
    await ctx.db.update(proposal).set({ status: 'signed' }).where(eq(proposal.id, ids.p3!));

    // ── Activity: calls / meetings carry their own date; notes and completed tasks are moved to fixed dates.
    const log = async (who: string, kind: 'call' | 'meeting', occurredAt: string, dealKey: string) =>
      expect((await call(who, 'POST', '/api/v1/activities', { kind, occurredAt, relatedType: 'deal', relatedId: ids[dealKey] })).status).toBe(201);
    await log('rep1', 'call', '2026-06-10T15:00:00Z', 'a1');
    await log('rep1', 'call', '2026-06-30T23:59:59Z', 'a1');
    await log('rep1', 'meeting', '2026-06-12T09:00:00Z', 'a1');
    await log('rep1', 'call', '2026-07-01T00:00:00Z', 'a1'); // first instant after the period
    await log('rep2', 'meeting', '2026-06-02T09:00:00Z', 'b1');
    await log('rep3', 'call', '2026-06-05T09:00:00Z', 'c1');
    const addNote = async (who: string, dealKey: string, createdAt: string) => {
      const n = await call(who, 'POST', '/api/v1/notes', { body: 'Call summary', relatedType: 'deal', relatedId: ids[dealKey] });
      expect(n.status, n.text).toBe(201);
      await ctx.db
        .update(note)
        .set({ createdAt: at(createdAt) })
        .where(eq(note.id, n.json.id));
    };
    await addNote('rep1', 'a1', '2026-06-03T12:00:00Z');
    await addNote('rep1', 'a1', '2026-05-31T23:59:59Z'); // last instant before the period
    const tk = await call('rep1', 'POST', '/api/v1/tasks', { title: 'Send pricing', relatedType: 'deal', relatedId: ids.a1, dueAt: '2026-06-20T09:00:00Z' });
    expect(tk.status, tk.text).toBe(201);
    expect((await call('rep1', 'POST', `/api/v1/tasks/${tk.json.id}/complete`)).status).toBe(200);
    await ctx.db
      .update(task)
      .set({ completedAt: at('2026-06-20T10:00:00Z') })
      .where(eq(task.id, tk.json.id));
    const openTask = await call('rep1', 'POST', '/api/v1/tasks', {
      title: 'Still open',
      relatedType: 'deal',
      relatedId: ids.a1,
      dueAt: '2026-06-21T09:00:00Z',
    });
    expect(openTask.status).toBe(201);

    // ── Attention: A2 has had no activity for 40 days (stage threshold 30); A1 is past its expected close date.
    await ctx.db
      .update(deal)
      .set({ lastActivityAt: new Date(Date.now() - 40 * 86_400_000 - 3_600_000) })
      .where(eq(deal.id, ids.a2!));
    await runScheduledScans(ctx);
  }, 240_000);

  afterAll(async () => {
    await pool.end();
  });

  it('requires a signed-in user and validates the date range', async () => {
    expect((await call(null, 'GET', `/api/v1/reports/overview?${JUNE}`)).status).toBe(401);
    expect((await call(null, 'GET', '/api/v1/reports/export/activity.csv')).status).toBe(401);
    const bad = await call('admin', 'GET', '/api/v1/reports/overview?from=2026-06-30&to=2026-06-01');
    expect(bad.status).toBe(400);
    expect(bad.json.errors[0].path).toBe('to');
    expect((await call('admin', 'GET', '/api/v1/reports/overview?from=2019-01-01&to=2026-06-01')).status).toBe(400); // more than 5 years
    expect((await call('admin', 'GET', '/api/v1/reports/overview?from=2026-02-30&to=2026-03-01')).status).toBe(400);
    expect((await call('admin', 'GET', '/api/v1/reports/overview?from=junk')).status).toBe(400);
    expect((await call('admin', 'GET', '/api/v1/reports/overview?ownerId=not-a-uuid')).status).toBe(400);
    expect((await call('admin', 'GET', '/api/v1/reports/dashboard')).status).toBe(200); // the existing dashboard keeps working
  });

  it('admin sees organization-wide pipeline by stage and by owner with exact values', async () => {
    const d = await overview('admin');
    expect(d.scope).toBe('organization');
    expect(d.currency).toBe('USD');
    expect(d.filters).toEqual({ from: '2026-06-01', to: '2026-06-30', teamId: null, ownerId: null });
    const s0 = d.pipelineByStage.find((r: any) => r.stageId === ids.stage0);
    const s1 = d.pipelineByStage.find((r: any) => r.stageId === ids.stage1);
    expect(s0).toMatchObject({ count: 3, value: '83000.00', weighted: '20750.00', noAmount: 0, notConverted: 0, createdInPeriod: 2 });
    expect(s1).toMatchObject({ count: 3, value: '5800.50', weighted: '2900.25', noAmount: 1, notConverted: 0, createdInPeriod: 0 });
    expect(d.pipelineTotals).toEqual({ count: 6, value: '88800.50', weighted: '23650.25', noAmount: 1, notConverted: 0 });
    expect(d.pipelineByOwner.map((r: any) => [r.owner, r.count, r.value, r.weighted])).toEqual([
      ['Mia Manager', 1, '800.00', '400.00'],
      ['Rae Rep', 2, '15000.50', '5000.25'],
      ['Sam Second', 2, '3000.00', '750.00'],
      ['Tia Third', 1, '70000.00', '17500.00'],
    ]);
  });

  it('won / lost: counts, values, both win rates and lost reasons, with inclusive period boundaries', async () => {
    const d = await overview('admin');
    // Won in June: A3 20000 + A4 4000 (23:59:59 on the last day) + C2 50000. Lost: A5 6000 + B2 1000 (00:00:00 on the first day).
    expect(d.wonLost).toEqual({ won: 3, lost: 2, wonValue: '74000.00', lostValue: '7000.00', winRateCount: 60, winRateValue: 91.4, notConverted: 0 });
    expect(d.lostReasons).toHaveLength(2);
    expect(d.lostReasons.find((r: any) => r.reason === ids.reason0Name)).toMatchObject({ count: 1, value: '6000.00', percent: 50 });
    expect(d.lostReasons.find((r: any) => r.reason === ids.reason1Name)).toMatchObject({ count: 1, value: '1000.00', percent: 50 });

    // One day later on either side changes the result exactly as the boundary deals dictate.
    expect((await overview('admin', 'from=2026-06-02&to=2026-06-30')).wonLost).toMatchObject({ won: 3, lost: 1, lostValue: '6000.00', winRateCount: 75 });
    expect((await overview('admin', 'from=2026-06-01&to=2026-06-29')).wonLost).toMatchObject({ won: 2, lost: 2, wonValue: '70000.00', winRateCount: 50 });
    // A6 closed at 2026-07-01T00:00:00Z: outside June, alone in a one-day July range.
    expect((await overview('admin', 'from=2026-07-01&to=2026-07-01')).wonLost).toEqual({
      won: 1,
      lost: 0,
      wonValue: '9999.00',
      lostValue: '0.00',
      winRateCount: 100,
      winRateValue: 100,
      notConverted: 0,
    });
    // Empty period: rates are null (shown as "—"), never a division by zero.
    expect((await overview('admin', 'from=2025-01-01&to=2025-01-31')).wonLost).toEqual({
      won: 0,
      lost: 0,
      wonValue: '0.00',
      lostValue: '0.00',
      winRateCount: null,
      winRateValue: null,
      notConverted: 0,
    });
  });

  it('periods follow the organization time zone', async () => {
    await ctx.db.update(schema.organizationSettings).set({ timeZone: 'America/New_York' });
    try {
      // 2026-07-01T00:00Z is 30 June 20:00 in New York → A6 now belongs to June; B2 (1 June 00:00Z = 31 May 20:00) leaves it.
      expect((await overview('admin')).wonLost).toMatchObject({ won: 4, lost: 1, wonValue: '83999.00', lostValue: '6000.00' });
    } finally {
      await ctx.db.update(schema.organizationSettings).set({ timeZone: 'UTC' });
    }
  });

  it('rep performance: open deals, won revenue, win rate, average deal size and average cycle length', async () => {
    const d = await overview('admin');
    expect(d.reps).toEqual([
      {
        userId: ids.manager,
        name: 'Mia Manager',
        openDeals: 1,
        openValue: '800.00',
        won: 0,
        lost: 0,
        wonRevenue: '0.00',
        winRate: null,
        avgDealSize: null,
        avgCycleDays: null,
      },
      {
        userId: ids.rep1,
        name: 'Rae Rep',
        openDeals: 2,
        openValue: '15000.50',
        won: 2,
        lost: 1,
        wonRevenue: '24000.00',
        winRate: 66.7,
        avgDealSize: '12000.00',
        avgCycleDays: 15, // A3: 1 → 11 June = 10 days; A4: 10 → 30 June = 20 days
      },
      {
        userId: ids.rep2,
        name: 'Sam Second',
        openDeals: 2,
        openValue: '3000.00',
        won: 0,
        lost: 1,
        wonRevenue: '0.00',
        winRate: 0,
        avgDealSize: null,
        avgCycleDays: null,
      },
      {
        userId: ids.rep3,
        name: 'Tia Third',
        openDeals: 1,
        openValue: '70000.00',
        won: 1,
        lost: 0,
        wonRevenue: '50000.00',
        winRate: 100,
        avgDealSize: '50000.00',
        avgCycleDays: 2,
      },
    ]);
  });

  it('proposal metrics: sent, view rate, time to first view, time to sign, win rate, deal → first proposal', async () => {
    const d = await overview('admin');
    const { list, ...metrics } = d.proposals;
    expect(metrics).toEqual({
      sent: 3,
      versionsSent: 3,
      viewed: 2,
      won: 1,
      viewRate: 66.7,
      winRate: 33.3,
      medianHoursToFirstView: 15, // 6 h and 24 h
      avgHoursToFirstView: 15,
      medianDaysToSign: 3,
      avgDaysToSign: 3,
      dealsWithFirstProposal: 3,
      medianDaysDealToFirstProposal: 4, // 2, 4 and 71 days
      avgDaysDealToFirstProposal: 25.7,
    });
    expect(list.map((p: any) => [p.proposalId, p.owner, p.hoursToFirstView, p.daysToSign])).toEqual([
      [ids.p2, 'Sam Second', null, null],
      [ids.p3, 'Tia Third', 24, 3],
      [ids.p1, 'Rae Rep', 6, null],
    ]);
    expect(list[1]).toMatchObject({ status: 'signed', dealId: ids.c1, firstSentAt: '2026-06-11T00:00:00.000Z', signedAt: '2026-06-14T00:00:00.000Z' });
    // Cohort is by FIRST sent date: a range that starts after 7 June no longer contains P1.
    const later = (await overview('admin', 'from=2026-06-08&to=2026-06-30')).proposals;
    expect(later).toMatchObject({ sent: 2, viewed: 1, viewRate: 50, winRate: 50, medianHoursToFirstView: 24, medianDaysDealToFirstProposal: 37.5 });
    expect((await overview('admin', 'from=2026-07-01&to=2026-07-31')).proposals).toMatchObject({ sent: 0, viewRate: null, winRate: null, list: [] });
  });

  it('activity per rep counts calls, meetings, notes and completed tasks inside the period only', async () => {
    const d = await overview('admin');
    expect(d.activity).toEqual([
      { userId: ids.rep1, name: 'Rae Rep', calls: 2, meetings: 1, notes: 1, tasksCompleted: 1 },
      { userId: ids.rep2, name: 'Sam Second', calls: 0, meetings: 1, notes: 0, tasksCompleted: 0 },
      { userId: ids.rep3, name: 'Tia Third', calls: 1, meetings: 0, notes: 0, tasksCompleted: 0 },
    ]);
    // The call at 2026-07-01T00:00Z and the note at 2026-05-31T23:59:59Z sit just outside June.
    expect((await overview('admin', 'from=2026-07-01&to=2026-07-01')).activity).toEqual([
      { userId: ids.rep1, name: 'Rae Rep', calls: 1, meetings: 0, notes: 0, tasksCompleted: 0 },
    ]);
    expect((await overview('admin', 'from=2026-05-31&to=2026-05-31')).activity).toEqual([
      { userId: ids.rep1, name: 'Rae Rep', calls: 0, meetings: 0, notes: 1, tasksCompleted: 0 },
    ]);
  });

  it('deals needing attention lists the actual stalled, overdue and unviewed-proposal deals', async () => {
    const d = await overview('admin');
    expect(d.attention.map((a: any) => [a.dealId, a.reasons, a.amount, a.owner])).toEqual([
      [ids.a1, ['overdue'], '10000.00', 'Rae Rep'], // P1 on this deal was viewed, so it is NOT "unviewed"
      [ids.a2, ['stalled'], '5000.50', 'Rae Rep'],
      [ids.b1, ['unviewed_proposal'], '3000.00', 'Sam Second'],
    ]);
    expect(d.attention[1]).toMatchObject({ name: 'A2 open old', stage: ids.stage1Name, daysSinceActivity: 40, lastProposalStatus: null });
    expect(d.attention[2].lastProposalStatus).toBe('sent');
    // A buyer view on the current version removes the deal from the list without any other change.
    const [link] = await ctx.db.select().from(shareLink).where(eq(shareLink.proposalVersionId, ids.p2_version!));
    const [identity] = await ctx.db
      .insert(schema.viewerIdentity)
      .values({ shareLinkId: link!.id, name: 'Buyer p2', normalizedEmail: 'buyer-p2@customer.example', isOriginalRecipient: true })
      .returning();
    const [view] = await ctx.db
      .insert(viewSession)
      .values({ shareLinkId: link!.id, dealId: ids.b1!, viewerIdentityId: identity!.id, counted: false })
      .returning();
    expect((await overview('admin')).attention.map((a: any) => a.dealId)).toContain(ids.b1); // an uncounted view (scanner) does not count
    await ctx.db.update(viewSession).set({ counted: true }).where(eq(viewSession.id, view!.id));
    expect((await overview('admin')).attention.map((a: any) => a.dealId)).toEqual([ids.a1, ids.a2]);
    await ctx.db.update(viewSession).set({ counted: false }).where(eq(viewSession.id, view!.id));
  });

  it('a sales manager sees only their team; team and owner filters stay inside it', async () => {
    const d = await overview('manager');
    expect(d.scope).toBe('team');
    expect(d.pipelineTotals).toMatchObject({ count: 5, value: '18800.50', weighted: '6150.25' });
    expect(d.pipelineByOwner.map((r: any) => r.owner)).toEqual(['Mia Manager', 'Rae Rep', 'Sam Second']);
    expect(d.wonLost).toMatchObject({ won: 2, lost: 2, wonValue: '24000.00', lostValue: '7000.00', winRateCount: 50, winRateValue: 77.4 });
    expect(d.reps.map((r: any) => r.userId)).toEqual([ids.manager, ids.rep1, ids.rep2]);
    expect(d.proposals).toMatchObject({ sent: 2, viewed: 1, viewRate: 50, winRate: 0, medianHoursToFirstView: 6, medianDaysDealToFirstProposal: 3 });
    expect(d.activity.map((r: any) => r.userId)).toEqual([ids.rep1, ids.rep2]);
    expect(d.attention.map((a: any) => a.dealId)).toEqual([ids.a1, ids.a2, ids.b1]);
    expect(JSON.stringify(d)).not.toContain('Tia Third');
    expect(JSON.stringify(d)).not.toContain(ids.c1);

    // Team filter = current members of the team (the manager's own deal M1 is not a member's deal).
    const east = await overview('manager', `${JUNE}&teamId=${ids.east}`);
    expect(east.pipelineTotals).toMatchObject({ count: 4, value: '18000.50' });
    expect(east.reps.map((r: any) => r.userId)).toEqual([ids.rep1, ids.rep2]);
    const one = await overview('manager', `${JUNE}&ownerId=${ids.rep2}`);
    expect(one.pipelineTotals).toMatchObject({ count: 2, value: '3000.00' });
    expect(one.wonLost).toMatchObject({ won: 0, lost: 1, lostValue: '1000.00', winRateCount: 0 });
    expect(one.activity).toEqual([{ userId: ids.rep2, name: 'Sam Second', calls: 0, meetings: 1, notes: 0, tasksCompleted: 0 }]);
    expect(one.attention.map((a: any) => a.dealId)).toEqual([ids.b1]);

    // Outside the managed team: refused, not silently ignored.
    const other = await call('manager', 'GET', `/api/v1/reports/overview?${JUNE}&ownerId=${ids.rep3}`);
    expect(other.status).toBe(403);
    expect(other.json.code).toBe('REPORT_OWNER_OUT_OF_SCOPE');
    const otherTeam = await call('manager', 'GET', `/api/v1/reports/overview?${JUNE}&teamId=${ids.west}`);
    expect(otherTeam.status).toBe(403);
    expect(otherTeam.json.code).toBe('REPORT_TEAM_OUT_OF_SCOPE');
    expect((await call('manager', 'GET', `/api/v1/reports/export/rep-performance.csv?${JUNE}&ownerId=${ids.rep3}`)).status).toBe(403);
  });

  it('a salesperson sees only their own figures; other owners and any team are refused', async () => {
    const d = await overview('rep1');
    expect(d.scope).toBe('own');
    expect(d.pipelineTotals).toMatchObject({ count: 2, value: '15000.50', weighted: '5000.25' });
    expect(d.pipelineByOwner.map((r: any) => r.owner)).toEqual(['Rae Rep']);
    expect(d.wonLost).toMatchObject({ won: 2, lost: 1, wonValue: '24000.00', lostValue: '6000.00', winRateCount: 66.7, winRateValue: 80 });
    expect(d.reps.map((r: any) => r.userId)).toEqual([ids.rep1]);
    expect(d.proposals).toMatchObject({ sent: 1, viewed: 1, viewRate: 100, winRate: 0, medianHoursToFirstView: 6, medianDaysDealToFirstProposal: 2 });
    expect(d.activity.map((r: any) => r.userId)).toEqual([ids.rep1]);
    expect(d.attention.map((a: any) => a.dealId)).toEqual([ids.a1, ids.a2]);
    expect(JSON.stringify(d)).not.toContain('Sam Second');

    const r2 = await overview('rep2');
    expect(r2.pipelineTotals).toMatchObject({ count: 2, value: '3000.00', noAmount: 1 });
    expect(r2.wonLost).toMatchObject({ won: 0, lost: 1, winRateCount: 0, winRateValue: 0 });
    expect(r2.proposals).toMatchObject({ sent: 1, viewed: 0, viewRate: 0, medianHoursToFirstView: null });
    expect(r2.attention.map((a: any) => a.dealId)).toEqual([ids.b1]);
    const r3 = await overview('rep3');
    expect(r3.wonLost).toMatchObject({ won: 1, lost: 0, wonValue: '50000.00' });
    expect(r3.attention).toEqual([]);

    expect((await overview('rep1', `${JUNE}&ownerId=${ids.rep1}`)).pipelineTotals.count).toBe(2); // own id is allowed
    for (const qs of [`ownerId=${ids.rep2}`, `ownerId=${ids.manager}`, `teamId=${ids.east}`, `teamId=${ids.west}`]) {
      expect((await call('rep1', 'GET', `/api/v1/reports/overview?${JUNE}&${qs}`)).status, qs).toBe(403);
      expect((await call('rep1', 'GET', `/api/v1/reports/export/pipeline-by-owner.csv?${JUNE}&${qs}`)).status, qs).toBe(403);
    }
    // View-only cross-visibility (OD-31) lets a salesperson open other deals but does NOT widen reports (BR-RPT-008).
    await ctx.db.update(schema.organizationSettings).set({ salespersonCrossVisibility: { companies: 'none', contacts: 'none', deals: 'view_only' } });
    try {
      expect((await overview('rep1')).pipelineTotals.count).toBe(2);
      expect((await call('rep1', 'GET', `/api/v1/reports/overview?${JUNE}&ownerId=${ids.rep2}`)).status).toBe(403);
    } finally {
      await ctx.db.update(schema.organizationSettings).set({ salespersonCrossVisibility: { companies: 'none', contacts: 'none', deals: 'none' } });
    }
  });

  it('admin can filter by any team or owner; unknown ones are 404', async () => {
    const west = await overview('admin', `${JUNE}&teamId=${ids.west}`);
    expect(west.pipelineTotals).toMatchObject({ count: 1, value: '70000.00' });
    expect(west.wonLost).toMatchObject({ won: 1, lost: 0, wonValue: '50000.00' });
    expect(west.proposals).toMatchObject({ sent: 1, winRate: 100, medianDaysToSign: 3, medianDaysDealToFirstProposal: 71 });
    const mixed = await overview('admin', `${JUNE}&teamId=${ids.west}&ownerId=${ids.rep1}`); // rep1 is not in West → nothing
    expect(mixed.pipelineTotals.count).toBe(0);
    expect(mixed.reps).toEqual([]);
    const ghost = '019a0000-0000-7000-8000-000000000000';
    expect((await call('admin', 'GET', `/api/v1/reports/overview?${JUNE}&ownerId=${ghost}`)).status).toBe(404);
    expect((await call('admin', 'GET', `/api/v1/reports/overview?${JUNE}&teamId=${ghost}`)).status).toBe(404);
  });

  it('filter options are limited to what the user may report on', async () => {
    const a = (await call('admin', 'GET', '/api/v1/reports/filters')).json;
    expect(a.teams.map((t: any) => t.name)).toEqual(['East', 'West']);
    expect(a.owners.map((o: any) => o.name)).toEqual(['Ada Admin', 'Mia Manager', 'Rae Rep', 'Sam Second', 'Tia Third']);
    const m = (await call('manager', 'GET', '/api/v1/reports/filters')).json;
    expect(m.teams).toEqual([{ id: ids.east, name: 'East' }]);
    expect(m.owners.map((o: any) => o.id)).toEqual([ids.manager, ids.rep1, ids.rep2]);
    const r = (await call('rep1', 'GET', '/api/v1/reports/filters')).json;
    expect(r).toEqual({ scope: 'own', teams: [], owners: [{ id: ids.rep1, name: 'Rae Rep', teamId: ids.east }] });
  });

  it('CSV export: same scope as the screen, escaped, formula-safe and audited', async () => {
    const r = await call('manager', 'GET', `/api/v1/reports/export/rep-performance.csv?${JUNE}`);
    expect(r.status, r.text).toBe(200);
    expect(r.res.headers.get('content-type')).toContain('text/csv');
    expect(r.res.headers.get('content-disposition')).toContain('report-rep-performance-2026-06-01-to-2026-06-30.csv');
    expect(r.text).toBe(
      [
        '﻿Rep,Open deals,Open value,Won deals,Lost deals,Won revenue,Currency,Win rate %,Average deal size,Average cycle (days)',
        'Mia Manager,1,800.00,0,0,0.00,USD,,,',
        'Rae Rep,2,15000.50,2,1,24000.00,USD,66.7,12000.00,15',
        'Sam Second,2,3000.00,0,1,0.00,USD,0,,',
        '',
      ].join('\r\n'),
    );
    // A deal name that starts with "=" and contains quotes and commas: neutralised with an apostrophe and quoted.
    const att = await call('rep1', 'GET', `/api/v1/reports/export/attention.csv?${JUNE}`);
    expect(att.status).toBe(200);
    const lines = att.text.split('\r\n');
    expect(lines[0]).toBe('﻿Deal,Owner,Stage,Amount,Currency,Reasons,Days since last activity,Last proposal status');
    expect(lines[1]).toMatch(/^"'=SUM\(1,2\) ""Q3"", deal",Rae Rep,/);
    expect(lines[1]).toContain(',10000.00,USD,Past expected close date,');
    expect(lines[2]).toMatch(/^A2 open old,Rae Rep,.*,5000\.50,USD,Stalled,40,$/);
    expect(lines).toHaveLength(4); // header + 2 own deals + trailing line break; nothing from other owners
    expect(att.text).not.toContain('B1 open');

    const wl = await call('rep2', 'GET', `/api/v1/reports/export/won-lost.csv?${JUNE}`);
    expect(wl.text.split('\r\n')[1]).toBe('2026-06-01,2026-06-30,0,1,0.00,1000.00,USD,0,0,0');
    const pm = await call('admin', 'GET', `/api/v1/reports/export/proposal-metrics.csv?${JUNE}`);
    expect(pm.text).toContain('Proposals sent,3,proposals\r\nVersions sent,3,versions\r\nProposals viewed,2,proposals\r\nView rate,66.7,%');
    const act = await call('admin', 'GET', `/api/v1/reports/export/activity?${JUNE}`); // the .csv suffix is optional
    expect(act.text).toBe('﻿Rep,Calls,Meetings,Notes,Tasks completed\r\nRae Rep,2,1,1,1\r\nSam Second,0,1,0,0\r\nTia Third,1,0,0,0\r\n');
    for (const section of ['pipeline-by-stage', 'pipeline-by-owner', 'lost-reasons', 'proposals'])
      expect((await call('admin', 'GET', `/api/v1/reports/export/${section}.csv?${JUNE}`)).status, section).toBe(200);
    expect((await call('admin', 'GET', `/api/v1/reports/export/everything.csv?${JUNE}`)).status).toBe(404);

    expect(csvCell('+1 555 0100')).toBe("'+1 555 0100");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell('@import')).toBe("'@import");
    expect(csvCell('-12.50')).toBe('-12.50'); // a plain negative number is data, not a formula
    expect(csvCell(-3)).toBe('-3');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe('');

    const audits = await ctx.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, 'report.exported'), eq(schema.auditLog.actorUserId, ids.rep2!)));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.changes).toMatchObject({ section: 'won-lost', filters: { from: '2026-06-01', to: '2026-06-30' }, rows: 1 });
  });
});
