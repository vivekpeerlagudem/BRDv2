/**
 * Managed-lead lifecycle against a REAL PostgreSQL test database and the real HTTP routes — no mocks.
 * Covers create + duplicate detection, qualify / disqualify, convert → company+contact+deal, owner scoping
 * (a salesperson never sees another rep's leads), and the delete / convert guards (BR-LED).
 */
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildContext } from './composition.ts';
import { parseConfig } from './config/env.ts';
import { createApp } from './http/app.ts';
import { bootstrap, insertUser } from './modules/identity.ts';
import { schema } from './platform/core.ts';
import { testDbMigratorUrl, testDbUrl } from './test-db.ts';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env.local', import.meta.url)));
} catch {}
const testUrl = testDbUrl();
const PASSWORD = 'Correct-Horse-Battery-9';
const ORIGIN = 'http://localhost:5173';

describe.skipIf(!testUrl)('Managed leads (PostgreSQL integration)', () => {
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
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  async function call(who: string | null, method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { origin: ORIGIN, 'content-type': 'application/json' };
    if (who && cookies[who]) headers.cookie = cookies[who] as string;
    const res = await app.request(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text };
  }
  async function signIn(key: string) {
    const res = await app.request('/auth/sign-in/email', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ email: `${key}@test.example`, password: PASSWORD }),
    });
    expect(res.status).toBe(200);
    cookies[key] = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  }

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: testDbMigratorUrl() });
    await admin.connect();
    const tables = await admin.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public' and tablename <> 'schema_migration'");
    await admin.query(`truncate ${tables.rows.map((t) => `"${t.tablename}"`).join(',')} restart identity cascade`);
    await admin.end();

    const b = await bootstrap(ctx, {
      organizationName: 'Leads Test Org',
      currency: 'USD',
      timeZone: 'UTC',
      admin: { email: 'admin@test.example', fullName: 'Ada Admin', role: 'admin', password: PASSWORD },
    });
    ids.admin = b.adminId;
    const [team] = await ctx.db.insert(schema.team).values({ name: 'East' }).returning();
    await ctx.db.transaction(async (tx) => {
      ids.manager = await insertUser(tx, { email: 'manager@test.example', fullName: 'Mia Manager', role: 'sales_manager', password: PASSWORD }, null);
      ids.rep1 = await insertUser(tx, { email: 'rep1@test.example', fullName: 'Rae Rep', role: 'salesperson', password: PASSWORD, teamId: team!.id }, null);
      ids.rep2 = await insertUser(tx, { email: 'rep2@test.example', fullName: 'Sam Solo', role: 'salesperson', password: PASSWORD }, null);
      await tx.insert(schema.teamManager).values({ teamId: team!.id, userId: ids.manager });
    });
    for (const k of ['admin', 'manager', 'rep1', 'rep2']) await signIn(k);
  }, 60_000);

  afterAll(async () => {
    await pool.end();
  });

  const auditFor = (action: string, targetId: string) =>
    ctx.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, action), eq(schema.auditLog.targetId, targetId)));

  it('creates a lead, detects an email duplicate, and confirms through it', async () => {
    const created = await call('rep1', 'POST', '/leads', {
      name: 'Jordan Avery',
      companyName: 'Acme Ltd',
      email: 'jordan@acme.example',
      jobTitle: 'Head of Ops',
    });
    expect(created.status, created.text).toBe(201);
    ids.lead = created.json.id;
    expect(created.json.status).toBe('new');
    expect(created.json.ownerId).toBe(ids.rep1);
    expect(await auditFor('lead.created', ids.lead as string)).toHaveLength(1);

    const dup = await call('rep1', 'POST', '/leads', { name: 'Jordan A.', email: 'jordan@acme.example' });
    expect(dup.status, dup.text).toBe(409);
    expect(dup.json.code).toBe('CONFIRMATION_REQUIRED');

    const forced = await call('rep1', 'POST', '/leads', { name: 'Jordan A.', email: 'jordan@acme.example', confirm: ['DUPLICATE_SUSPECTED'] });
    expect(forced.status, forced.text).toBe(201);
    // clean up the forced duplicate so later list assertions stay deterministic
    await call('rep1', 'DELETE', `/leads/${forced.json.id}`);
  });

  it('hides a rep’s lead from another salesperson, but shows it to the team manager and admin', async () => {
    expect((await call('rep2', 'GET', `/leads/${ids.lead}`)).status).toBe(404);
    const rep2List = await call('rep2', 'GET', '/leads');
    expect(rep2List.json.items.find((l: { id: string }) => l.id === ids.lead)).toBeUndefined();
    expect((await call('manager', 'GET', `/leads/${ids.lead}`)).status).toBe(200);
    expect((await call('admin', 'GET', `/leads/${ids.lead}`)).status).toBe(200);
  });

  it('qualifies a lead', async () => {
    const r = await call('rep1', 'POST', `/leads/${ids.lead}/qualify`);
    expect(r.status, r.text).toBe(200);
    expect((await call('rep1', 'GET', `/leads/${ids.lead}`)).json.status).toBe('qualified');
  });

  it('converts a qualified lead into a company, contact and deal, then blocks re-conversion and deletion', async () => {
    const conv = await call('rep1', 'POST', `/leads/${ids.lead}/convert`, { amount: '18000.00' });
    expect(conv.status, conv.text).toBe(200);
    expect(conv.json.companyId).toBeTruthy();
    expect(conv.json.contactId).toBeTruthy();
    expect(conv.json.dealId).toBeTruthy();

    const lead = (await call('rep1', 'GET', `/leads/${ids.lead}`)).json;
    expect(lead.status).toBe('converted');
    expect(lead.convertedDealId).toBe(conv.json.dealId);

    const deal = (await call('rep1', 'GET', `/deals/${conv.json.dealId}`)).json;
    expect(deal.ownerId).toBe(ids.rep1);
    expect(deal.amount).toBe('18000.00');
    expect(await auditFor('lead.converted', ids.lead as string)).toHaveLength(1);

    expect((await call('rep1', 'POST', `/leads/${ids.lead}/convert`, {})).status).toBe(422); // already converted
    expect((await call('rep1', 'DELETE', `/leads/${ids.lead}`)).status).toBe(422); // converted lead cannot be deleted
  });

  it('disqualifies a lead with a required reason', async () => {
    const created = await call('rep1', 'POST', '/leads', { name: 'Pat Nope', email: 'pat@nope.example' });
    const id = created.json.id;
    expect((await call('rep1', 'POST', `/leads/${id}/disqualify`, {})).status).toBe(400); // reason required
    const r = await call('rep1', 'POST', `/leads/${id}/disqualify`, { reason: 'No budget' });
    expect(r.status, r.text).toBe(200);
    const after = (await call('rep1', 'GET', `/leads/${id}`)).json;
    expect(after.status).toBe('unqualified');
    expect(after.disqualifyReason).toBe('No budget');
  });
  it('reopens a disqualified lead and clears the old reason', async () => {
    const created = await call('rep1', 'POST', '/leads', { name: 'Sam Again', email: 'sam@again.example' });
    const id = created.json.id;
    expect((await call('rep1', 'POST', `/leads/${id}/disqualify`, { reason: 'Timing' })).status).toBe(200);
    const lost = (await call('rep1', 'GET', `/leads/${id}`)).json;
    const r = await call('rep1', 'PATCH', `/leads/${id}`, { status: 'new', rowVersion: lost.rowVersion });
    expect(r.status, r.text).toBe(200);
    const after = (await call('rep1', 'GET', `/leads/${id}`)).json;
    expect(after.status).toBe('new');
    expect(after.disqualifyReason).toBeNull();
  });

  it('links an existing company with the same name instead of creating a duplicate on conversion', async () => {
    const co = await call('rep1', 'POST', '/companies', { name: 'Globex Corporation', domain: 'globex.example' });
    expect(co.status, co.text).toBe(201);
    const created = await call('rep1', 'POST', '/leads', { name: 'Hank Scorpio', email: 'hank@globex.example', companyName: '  globex   CORPORATION ' });
    const conv = await call('rep1', 'POST', `/leads/${created.json.id}/convert`, { createDeal: false });
    expect(conv.status, conv.text).toBe(200);
    expect(conv.json.companyId).toBe(co.json.id);
    const all = (await call('rep1', 'GET', '/companies?q=globex')).json;
    expect(all.items.filter((c: { name: string }) => c.name.toLowerCase().includes('globex'))).toHaveLength(1);
  });
});
