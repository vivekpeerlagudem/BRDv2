/**
 * Administration integration tests — real PostgreSQL, real HTTP routes, real authorization.
 * Covers organization settings (BR-PLT-012), pipeline stages and probabilities (BR-CRM-005), lost reasons (BR-CRM-014),
 * teams and managers (BR-PLT-006) and the audit log viewer (BR-PLT-009).
 */
import { fileURLToPath } from 'node:url';
import { desc, eq } from 'drizzle-orm';
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
const V1 = '/api/v1';
const NIL = '00000000-0000-7000-8000-000000000000';

describe.skipIf(!testUrl)('Administration (PostgreSQL integration)', () => {
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
  const { ctx, pool, auth } = buildContext(config);
  const app = createApp(ctx, auth);
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  async function call(who: string | null, method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { origin: ORIGIN, 'content-type': 'application/json' };
    if (who && cookies[who]) headers.cookie = cookies[who] as string;
    const res = await app.request(V1 + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text };
  }
  const audits = (action: string) => ctx.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, action)).orderBy(desc(schema.auditLog.seq));
  const lastAudit = async (action: string) => (await audits(action))[0];
  const settings = async () => (await call('admin', 'GET', '/settings/organization')).json;
  const settingsBody = async (over: Record<string, unknown> = {}) => {
    const { updatedAt: _u, ...current } = await settings();
    return { ...current, ...over };
  };
  const stages = async (): Promise<any[]> => (await call('admin', 'GET', '/admin/pipeline/stages')).json.stages;
  const stage = async (name: string) => (await stages()).find((s) => s.name === name);
  const newDeal = async (who: string, name: string, extra: Record<string, unknown> = {}) => {
    const r = await call(who, 'POST', '/deals', { name, companyId: ids[`${who}Company`], amount: '1000.00', ...extra });
    expect(r.status, r.text).toBe(201);
    return r.json.id as string;
  };

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: testDbMigratorUrl() });
    await admin.connect();
    const tables = await admin.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public' and tablename <> 'schema_migration'");
    await admin.query(`truncate ${tables.rows.map((t) => `"${t.tablename}"`).join(',')} restart identity cascade`);
    await admin.end();

    const b = await bootstrap(ctx, {
      organizationName: 'Northwind Test',
      currency: 'USD',
      timeZone: 'UTC',
      admin: { email: 'admin@test.example', fullName: 'Ada Admin', role: 'admin', password: PASSWORD },
    });
    ids.admin = b.adminId;
    await ctx.db.transaction(async (tx) => {
      ids.mgr = await insertUser(tx, { email: 'mgr@test.example', fullName: 'Mia Manager', role: 'sales_manager', password: PASSWORD }, null);
      ids.mgr2 = await insertUser(tx, { email: 'mgr2@test.example', fullName: 'Max Manager', role: 'sales_manager', password: PASSWORD }, null);
      ids.rep1 = await insertUser(tx, { email: 'rep1@test.example', fullName: 'Rae Rep', role: 'salesperson', password: PASSWORD }, null);
      ids.rep2 = await insertUser(tx, { email: 'rep2@test.example', fullName: 'Sam Solo', role: 'salesperson', password: PASSWORD }, null);
    });
    for (const k of ['admin', 'mgr', 'mgr2', 'rep1', 'rep2']) {
      const res = await app.request('/auth/sign-in/email', {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ email: `${k}@test.example`, password: PASSWORD }),
      });
      expect(res.status).toBe(200);
      cookies[k] = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
    }
  }, 90_000);

  afterAll(async () => {
    await pool.end();
  });

  // ───────────────────────── authorization ─────────────────────────
  it('refuses every administration endpoint for salespeople and sales managers, and for anonymous callers', async () => {
    const endpoints: [string, string, unknown?][] = [
      ['GET', '/settings/organization'],
      ['PUT', '/settings/organization', {}],
      ['GET', '/admin/pipeline/stages'],
      ['POST', '/admin/pipeline/stages', { name: 'Sneaky', probability: 10 }],
      ['PUT', '/admin/pipeline/stage-order', { stageIds: [NIL] }],
      ['PATCH', `/admin/pipeline/stages/${NIL}`, { name: 'Sneaky' }],
      ['POST', `/admin/pipeline/stages/${NIL}/proposal-sent-target`, {}],
      ['DELETE', `/admin/pipeline/stages/${NIL}`],
      ['GET', '/admin/lost-reasons'],
      ['POST', '/admin/lost-reasons', { name: 'Sneaky' }],
      ['PATCH', `/admin/lost-reasons/${NIL}`, { isActive: false }],
      ['GET', '/admin/teams'],
      ['POST', '/admin/teams', { name: 'Sneaky' }],
      ['PATCH', `/admin/teams/${NIL}`, { name: 'Sneaky' }],
      ['POST', `/admin/teams/${NIL}/members`, { userId: NIL }],
      ['DELETE', `/admin/teams/${NIL}/members/${NIL}`],
      ['POST', `/admin/teams/${NIL}/managers`, { userId: NIL }],
      ['DELETE', `/admin/teams/${NIL}/managers/${NIL}`],
      ['GET', '/audit-log'],
      ['GET', '/audit-log/filters'],
      ['DELETE', `/admin/lost-reasons/${NIL}`],
      ['DELETE', `/admin/teams/${NIL}`],
    ];
    const auditCountBefore = (await ctx.db.select().from(schema.auditLog)).length;
    for (const [method, path, body] of endpoints) {
      for (const who of ['rep1', 'mgr']) {
        const r = await call(who, method, path, body);
        expect(r.status, `${who} ${method} ${path}: ${r.text}`).toBe(403);
      }
      expect((await call(null, method, path, body)).status, `anonymous ${method} ${path}`).toBe(401);
    }
    // Nothing was created or changed by the refused calls.
    expect((await ctx.db.select().from(schema.auditLog)).length).toBe(auditCountBefore);
    expect(await ctx.db.select().from(schema.team)).toHaveLength(0);
    expect((await stages()).some((s) => s.name === 'Sneaky')).toBe(false);
  });

  // ───────────────────────── organization settings ─────────────────────────
  it('returns the editable organization settings without AI settings or keys', async () => {
    const r = await call('admin', 'GET', '/settings/organization');
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      organizationName: 'Northwind Test',
      timeZone: 'UTC',
      locale: 'en-US',
      defaultCurrency: 'USD',
      branding: { primaryColor: '#1f4e79' },
      proposalDefaults: { defaultTermMonths: 12, defaultValidityDays: 30 },
      automationSettings: { followUpAfterDays: 3, aut001Enabled: true, aut002Enabled: true },
      salespersonCrossVisibility: { companies: 'none', contacts: 'none', deals: 'none' },
    });
    expect(r.json.aiSettings).toBeUndefined();
    expect(r.text).not.toMatch(/leadFormKey|aiSettings/);
  });

  it('validates organization settings field by field and changes nothing when invalid', async () => {
    const r = await call(
      'admin',
      'PUT',
      '/settings/organization',
      await settingsBody({
        organizationName: '  ',
        timeZone: 'Mars/Olympus',
        defaultCurrency: 'ZZZ',
        branding: { primaryColor: 'blue', footerText: 'x' },
        proposalDefaults: { defaultTermMonths: 0, defaultValidityDays: 30 },
        automationSettings: { followUpAfterDays: 1.5, aut001Enabled: true, aut002Enabled: true },
        salespersonCrossVisibility: { companies: 'everything', contacts: 'none', deals: 'none' },
      }),
    );
    expect(r.status).toBe(400);
    const paths = r.json.errors.map((e: any) => e.path);
    for (const p of [
      'organizationName',
      'timeZone',
      'defaultCurrency',
      'branding.primaryColor',
      'proposalDefaults.defaultTermMonths',
      'automationSettings.followUpAfterDays',
      'salespersonCrossVisibility.companies',
    ])
      expect(paths, r.text).toContain(p);
    expect((await settings()).organizationName).toBe('Northwind Test');
    expect(await audits('settings.organization_changed')).toHaveLength(0);
  });

  it('saves organization settings, audits before and after, and leaves AI settings alone', async () => {
    const [before] = await ctx.db.select().from(schema.organizationSettings);
    const r = await call(
      'admin',
      'PUT',
      '/settings/organization',
      await settingsBody({
        organizationName: 'Northwind Trading',
        timeZone: 'Europe/Berlin',
        locale: 'de-DE',
        branding: { primaryColor: '#0a7d5a', footerText: 'Northwind Trading — Confidential' },
        proposalDefaults: { defaultTermMonths: 24, defaultValidityDays: 45 },
        automationSettings: { followUpAfterDays: 5, aut001Enabled: false, aut002Enabled: true },
      }),
    );
    expect(r.status, r.text).toBe(200);
    expect(r.json.changed).toBe(true);
    const [row] = await ctx.db.select().from(schema.organizationSettings);
    expect(row).toMatchObject({
      organizationName: 'Northwind Trading',
      timeZone: 'Europe/Berlin',
      locale: 'de-DE',
      branding: { primaryColor: '#0a7d5a', footerText: 'Northwind Trading — Confidential' },
      proposalDefaults: { defaultTermMonths: 24, defaultValidityDays: 45 },
      automationSettings: { followUpAfterDays: 5, aut001Enabled: false, aut002Enabled: true },
      updatedBy: ids.admin,
    });
    expect(row!.aiSettings).toEqual(before!.aiSettings);
    expect(row!.leadFormKey).toBe(before!.leadFormKey);
    const a = await lastAudit('settings.organization_changed');
    expect(a).toMatchObject({ actorUserId: ids.admin, actorType: 'user' });
    const changes = a!.changes as any;
    expect(changes.before).toMatchObject({ organizationName: 'Northwind Test', timeZone: 'UTC', proposalDefaults: { defaultTermMonths: 12 } });
    expect(changes.after).toMatchObject({ organizationName: 'Northwind Trading', timeZone: 'Europe/Berlin', proposalDefaults: { defaultTermMonths: 24 } });
    expect(changes.before.defaultCurrency).toBeUndefined(); // unchanged fields are not listed

    // Saving the same values again is not a change and writes no audit entry.
    const again = await call('admin', 'PUT', '/settings/organization', await settingsBody());
    expect(again.json.changed).toBe(false);
    expect(await audits('settings.organization_changed')).toHaveLength(1);
    // The signed-in user's payload reflects the new name immediately.
    expect((await call('rep1', 'GET', '/me')).json.settings.organizationName).toBe('Northwind Trading');
  });

  it('allows a default-currency change while nothing is priced, and refuses it once deals use another currency', async () => {
    const toEur = await call('admin', 'PUT', '/settings/organization', await settingsBody({ defaultCurrency: 'eur' }));
    expect(toEur.status, toEur.text).toBe(200);
    expect((await settings()).defaultCurrency).toBe('EUR');
    expect((await call('admin', 'PUT', '/settings/organization', await settingsBody({ defaultCurrency: 'USD' }))).status).toBe(200);

    for (const who of ['rep1', 'rep2', 'mgr']) {
      const c = await call(who, 'POST', '/companies', { name: `${who} Company`, domain: `${who}.example` });
      expect(c.status, c.text).toBe(201);
      ids[`${who}Company`] = c.json.id;
    }
    ids.rep1Deal = await newDeal('rep1', 'Rae first deal');
    ids.rep2Deal = await newDeal('rep2', 'Sam first deal');

    const refused = await call('admin', 'PUT', '/settings/organization', await settingsBody({ defaultCurrency: 'EUR', organizationName: 'Should not save' }));
    expect(refused.status).toBe(422);
    expect(refused.json.code).toBe('CURRENCY_IN_USE');
    expect(refused.json.title).toMatch(/2 deal\(s\).*another currency/);
    const s = await settings();
    expect(s.defaultCurrency).toBe('USD');
    expect(s.organizationName).toBe('Northwind Trading'); // the whole request was rolled back
  });

  it('applies the salesperson cross-visibility setting to record access immediately', async () => {
    expect((await call('rep2', 'GET', `/deals/${ids.rep1Deal}`)).status).toBe(404);
    const on = await call(
      'admin',
      'PUT',
      '/settings/organization',
      await settingsBody({ salespersonCrossVisibility: { companies: 'none', contacts: 'none', deals: 'view_only' } }),
    );
    expect(on.status, on.text).toBe(200);
    expect((await call('rep2', 'GET', `/deals/${ids.rep1Deal}`)).status).toBe(200);
    // View only: visible, but not editable.
    expect((await call('rep2', 'PATCH', `/deals/${ids.rep1Deal}`, { name: 'Hijacked', rowVersion: 1 })).status).toBe(403);
    await call(
      'admin',
      'PUT',
      '/settings/organization',
      await settingsBody({ salespersonCrossVisibility: { companies: 'none', contacts: 'none', deals: 'none' } }),
    );
    expect((await call('rep2', 'GET', `/deals/${ids.rep1Deal}`)).status).toBe(404);
  });

  // ───────────────────────── pipeline ─────────────────────────
  it('lists stages in order with deal counts', async () => {
    const list = await stages();
    expect(list.map((s) => s.name)).toEqual(['Qualification', 'Discovery', 'Proposal sent', 'Negotiation', 'Closed Won', 'Closed Lost']);
    expect(list.map((s) => s.sortOrder)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(list[0]).toMatchObject({ kind: 'open', probability: 20, stallThresholdDays: 14, dealCount: 2, isProposalSentTarget: false });
    expect(list.filter((s) => s.isProposalSentTarget).map((s) => s.name)).toEqual(['Proposal sent']);
  });

  it('adds an open stage in front of the closed stages, with validation and unique names', async () => {
    for (const bad of [
      { name: '', probability: 10 },
      { name: 'Bad', probability: 101 },
      { name: 'Bad', probability: -1 },
      { name: 'Bad', probability: 10.5 },
      { name: 'Bad', probability: 10, stallThresholdDays: 0 },
      { name: 'Bad' },
    ])
      expect((await call('admin', 'POST', '/admin/pipeline/stages', bad)).status, JSON.stringify(bad)).toBe(400);
    const dup = await call('admin', 'POST', '/admin/pipeline/stages', { name: ' discovery ', probability: 10 });
    expect(dup.status).toBe(409);
    expect(dup.json.code).toBe('STAGE_NAME_TAKEN');

    const r = await call('admin', 'POST', '/admin/pipeline/stages', { name: 'Legal review', probability: 90, stallThresholdDays: 7 });
    expect(r.status, r.text).toBe(201);
    expect(r.json).toMatchObject({ name: 'Legal review', kind: 'open', probability: 90, stallThresholdDays: 7, sortOrder: 5, isProposalSentTarget: false });
    ids.legal = r.json.id;
    expect((await stages()).map((s) => s.name)).toEqual([
      'Qualification',
      'Discovery',
      'Proposal sent',
      'Negotiation',
      'Legal review',
      'Closed Won',
      'Closed Lost',
    ]);
    expect(await lastAudit('pipeline.stage_created')).toMatchObject({ targetType: 'pipeline_stage', targetId: ids.legal, actorUserId: ids.admin });
    // The new stage is offered to everyone who moves deals.
    expect((await call('rep1', 'GET', '/pipeline')).json.stages.map((s: any) => s.name)).toContain('Legal review');
  });

  it('renames a stage and changes probability and stall threshold; the weighted forecast follows the probability', async () => {
    const q = await stage('Qualification');
    const before = (await call('admin', 'GET', '/reports/dashboard')).json;
    expect(before.kpis.weightedForecast).toBe('400.00'); // 2 deals × 1000 × 20%

    const r = await call('admin', 'PATCH', `/admin/pipeline/stages/${q.id}`, { name: 'Qualifying', probability: 35, stallThresholdDays: null });
    expect(r.status, r.text).toBe(200);
    expect(r.json).toMatchObject({ name: 'Qualifying', probability: 35, stallThresholdDays: null });
    const after = (await call('admin', 'GET', '/reports/dashboard')).json;
    expect(after.kpis.weightedForecast).toBe('700.00');
    expect(after.pipeline.find((p: any) => p.stageId === q.id)).toMatchObject({ stage: 'Qualifying', weighted: '700.00' });
    const a = await lastAudit('pipeline.stage_updated');
    expect(a!.changes).toEqual({
      before: { name: 'Qualification', probability: 20, stallThresholdDays: 14 },
      after: { name: 'Qualifying', probability: 35, stallThresholdDays: null },
    });

    expect((await call('admin', 'PATCH', `/admin/pipeline/stages/${q.id}`, { probability: 120 })).status).toBe(400);
    expect((await call('admin', 'PATCH', `/admin/pipeline/stages/${q.id}`, {})).status).toBe(400);
    expect((await call('admin', 'PATCH', `/admin/pipeline/stages/${q.id}`, { name: 'Discovery' })).status).toBe(409);
    expect((await call('admin', 'PATCH', `/admin/pipeline/stages/${NIL}`, { name: 'Ghost' })).status).toBe(404);
    const restore = await call('admin', 'PATCH', `/admin/pipeline/stages/${q.id}`, { name: 'Qualification', probability: 20, stallThresholdDays: 14 });
    expect(restore.status).toBe(200);
  });

  it('keeps Won and Lost stages fixed: no kind change, no probability change, no removal', async () => {
    const won = await stage('Closed Won');
    const lost = await stage('Closed Lost');
    // `kind` is not an editable field: it is ignored, and the stage stays a won stage.
    const renamed = await call('admin', 'PATCH', `/admin/pipeline/stages/${won.id}`, { name: 'Won', kind: 'open' });
    expect(renamed.status, renamed.text).toBe(200);
    expect(renamed.json).toMatchObject({ name: 'Won', kind: 'won', probability: 100 });
    expect((await call('admin', 'PATCH', `/admin/pipeline/stages/${won.id}`, { name: 'Closed Won' })).status).toBe(200);
    expect((await call('admin', 'PATCH', `/admin/pipeline/stages/${won.id}`, { probability: 50 })).json.code).toBe('SYSTEM_STAGE_IMMUTABLE');
    expect((await call('admin', 'PATCH', `/admin/pipeline/stages/${lost.id}`, { stallThresholdDays: 5 })).json.code).toBe('SYSTEM_STAGE_IMMUTABLE');
    for (const s of [won, lost]) {
      const del = await call('admin', 'DELETE', `/admin/pipeline/stages/${s.id}`);
      expect(del.status).toBe(409);
      expect(del.json.code).toBe('SYSTEM_STAGE_IMMUTABLE');
      expect((await call('admin', 'POST', `/admin/pipeline/stages/${s.id}/proposal-sent-target`, {})).status).toBe(422);
    }
    expect((await stages()).filter((s) => s.kind !== 'open').map((s) => `${s.name}:${s.kind}`)).toEqual(['Closed Won:won', 'Closed Lost:lost']);
  });

  it('reorders open stages; Won and Lost stay last; incomplete or foreign lists are refused', async () => {
    const list = await stages();
    const open = list.filter((s) => s.kind === 'open');
    const won = list.find((s) => s.kind === 'won');
    const order = [open[4], open[0], open[1], open[2], open[3]].map((s) => s.id);
    const r = await call('admin', 'PUT', '/admin/pipeline/stage-order', { stageIds: order });
    expect(r.status, r.text).toBe(200);
    expect(r.json.map((s: any) => s.name)).toEqual(['Legal review', 'Qualification', 'Discovery', 'Proposal sent', 'Negotiation', 'Closed Won', 'Closed Lost']);
    expect(r.json.map((s: any) => s.sortOrder)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect((await call('rep1', 'GET', '/pipeline')).json.stages[0].name).toBe('Legal review');
    expect((await lastAudit('pipeline.stages_reordered'))!.changes).toMatchObject({
      after: ['Legal review', 'Qualification', 'Discovery', 'Proposal sent', 'Negotiation'],
    });

    for (const bad of [order.slice(1), [...order.slice(1), won.id], [...order, order[0]], [...order.slice(1), NIL]]) {
      const x = await call('admin', 'PUT', '/admin/pipeline/stage-order', { stageIds: bad });
      expect(x.status, x.text).toBe(422);
      expect(x.json.code).toBe('STAGE_ORDER_INVALID');
    }
    const back = await call('admin', 'PUT', '/admin/pipeline/stage-order', { stageIds: open.map((s) => s.id) });
    expect(back.json.map((s: any) => s.name)).toEqual([
      'Qualification',
      'Discovery',
      'Proposal sent',
      'Negotiation',
      'Legal review',
      'Closed Won',
      'Closed Lost',
    ]);
  });

  it('keeps exactly one "proposal sent" stage', async () => {
    const negotiation = await stage('Negotiation');
    const sent = await stage('Proposal sent');
    const r = await call('admin', 'POST', `/admin/pipeline/stages/${negotiation.id}/proposal-sent-target`, {});
    expect(r.status, r.text).toBe(200);
    expect((await stages()).filter((s) => s.isProposalSentTarget).map((s) => s.name)).toEqual(['Negotiation']);
    expect((await lastAudit('pipeline.proposal_sent_target_changed'))!.changes).toEqual({
      before: { stage: 'Proposal sent' },
      after: { stage: 'Negotiation' },
    });
    // The target stage cannot be removed while it is the target.
    const del = await call('admin', 'DELETE', `/admin/pipeline/stages/${negotiation.id}`);
    expect(del.status).toBe(422);
    expect(del.json.code).toBe('STAGE_IS_PROPOSAL_TARGET');
    expect((await call('admin', 'POST', `/admin/pipeline/stages/${sent.id}/proposal-sent-target`, {})).status).toBe(200);
    expect((await stages()).filter((s) => s.isProposalSentTarget).map((s) => s.name)).toEqual(['Proposal sent']);
  });

  it('refuses to delete a stage that holds deals or appears in deal history, and deletes an unused one', async () => {
    const qualification = await stage('Qualification');
    const withDeals = await call('admin', 'DELETE', `/admin/pipeline/stages/${qualification.id}`);
    expect(withDeals.status).toBe(409);
    expect(withDeals.json.code).toBe('STAGE_HAS_DEALS');
    expect(withDeals.json.title).toMatch(/2 deal\(s\)/);

    // Move a deal through "Legal review" and out again: the stage is empty but its history remains.
    const d = (await call('rep1', 'GET', `/deals/${ids.rep1Deal}`)).json;
    const into = await call('rep1', 'POST', `/deals/${ids.rep1Deal}/stage`, { stageId: ids.legal, rowVersion: d.rowVersion });
    expect(into.status, into.text).toBe(200);
    const out = await call('rep1', 'POST', `/deals/${ids.rep1Deal}/stage`, { stageId: qualification.id, rowVersion: into.json.rowVersion });
    expect(out.status, out.text).toBe(200);
    const withHistory = await call('admin', 'DELETE', `/admin/pipeline/stages/${ids.legal}`);
    expect(withHistory.status).toBe(409);
    expect(withHistory.json.code).toBe('STAGE_HAS_HISTORY');
    expect((await stages()).map((s) => s.name)).toContain('Legal review');

    const fresh = await call('admin', 'POST', '/admin/pipeline/stages', { name: 'Temporary', probability: 5 });
    expect(fresh.status).toBe(201);
    const removed = await call('admin', 'DELETE', `/admin/pipeline/stages/${fresh.json.id}`);
    expect(removed.status, removed.text).toBe(200);
    const list = await stages();
    expect(list.map((s) => s.name)).toEqual(['Qualification', 'Discovery', 'Proposal sent', 'Negotiation', 'Legal review', 'Closed Won', 'Closed Lost']);
    expect(list.map((s) => s.sortOrder)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(await lastAudit('pipeline.stage_deleted')).toMatchObject({ targetId: fresh.json.id });
    expect((await call('admin', 'DELETE', `/admin/pipeline/stages/${fresh.json.id}`)).status).toBe(404);
  });

  // ───────────────────────── lost reasons ─────────────────────────
  it('adds, renames, deactivates and reactivates lost reasons; a retired reason stays on old deals', async () => {
    const list = (await call('admin', 'GET', '/admin/lost-reasons')).json as any[];
    expect(list.map((r) => r.name)).toEqual(['Chose a competitor', 'No decision', 'Other', 'Price', 'Timing']);
    expect(list.every((r) => r.isActive && r.dealCount === 0)).toBe(true);

    expect((await call('admin', 'POST', '/admin/lost-reasons', { name: '   ' })).status).toBe(400);
    expect((await call('admin', 'POST', '/admin/lost-reasons', { name: 'PRICE' })).json.code).toBe('LOST_REASON_NAME_TAKEN');
    const created = await call('admin', 'POST', '/admin/lost-reasons', { name: 'Budget cut' });
    expect(created.status, created.text).toBe(201);
    expect(created.json).toMatchObject({ name: 'Budget cut', isActive: true, dealCount: 0 });
    const reasonId = created.json.id as string;
    expect(await lastAudit('lost_reason.created')).toMatchObject({ targetType: 'lost_reason', targetId: reasonId });

    // Used on a deal while active.
    const dealId = await newDeal('rep1', 'Deal lost to budget');
    expect((await call('rep1', 'POST', `/deals/${dealId}/lost`, { lostReasonId: reasonId })).status).toBe(200);

    const renamed = await call('admin', 'PATCH', `/admin/lost-reasons/${reasonId}`, { name: 'Budget withdrawn' });
    expect(renamed.status, renamed.text).toBe(200);
    expect((await lastAudit('lost_reason.updated'))!.changes).toEqual({
      before: { name: 'Budget cut', isActive: true },
      after: { name: 'Budget withdrawn', isActive: true },
    });
    expect((await call('admin', 'PATCH', `/admin/lost-reasons/${reasonId}`, { name: 'timing' })).status).toBe(409);
    expect((await call('admin', 'PATCH', `/admin/lost-reasons/${reasonId}`, {})).status).toBe(400);
    expect((await call('admin', 'PATCH', `/admin/lost-reasons/${NIL}`, { isActive: false })).status).toBe(404);

    const off = await call('admin', 'PATCH', `/admin/lost-reasons/${reasonId}`, { isActive: false });
    expect(off.status, off.text).toBe(200);
    expect(off.json.isActive).toBe(false);
    expect(await lastAudit('lost_reason.deactivated')).toMatchObject({ targetId: reasonId });
    const row = ((await call('admin', 'GET', '/admin/lost-reasons')).json as any[]).find((r) => r.id === reasonId);
    expect(row).toMatchObject({ name: 'Budget withdrawn', isActive: false, dealCount: 1 });
    // The old deal keeps its reason.
    const [d] = await ctx.db.select().from(schema.deal).where(eq(schema.deal.id, dealId));
    expect(d).toMatchObject({ status: 'lost', lostReasonId: reasonId });
    expect((await call('admin', 'GET', '/reports/dashboard')).json.lostReasons).toContainEqual({ reason: 'Budget withdrawn', count: 1 });

    const on = await call('admin', 'PATCH', `/admin/lost-reasons/${reasonId}`, { isActive: true });
    expect(on.json.isActive).toBe(true);
    expect(await lastAudit('lost_reason.reactivated')).toMatchObject({ targetId: reasonId });
  });

  it('keeps at least one lost reason active', async () => {
    const list = (await call('admin', 'GET', '/admin/lost-reasons')).json as any[];
    for (const r of list.slice(1)) expect((await call('admin', 'PATCH', `/admin/lost-reasons/${r.id}`, { isActive: false })).status).toBe(200);
    const last = await call('admin', 'PATCH', `/admin/lost-reasons/${list[0].id}`, { isActive: false });
    expect(last.status).toBe(422);
    expect(last.json.code).toBe('LAST_LOST_REASON');
    for (const r of list.slice(1)) expect((await call('admin', 'PATCH', `/admin/lost-reasons/${r.id}`, { isActive: true })).status).toBe(200);
  });

  // ───────────────────────── teams ─────────────────────────
  it('creates and renames teams with unique names', async () => {
    expect((await call('admin', 'POST', '/admin/teams', { name: '' })).status).toBe(400);
    const east = await call('admin', 'POST', '/admin/teams', { name: 'East' });
    expect(east.status, east.text).toBe(201);
    ids.east = east.json.id;
    const west = await call('admin', 'POST', '/admin/teams', { name: 'West', managerIds: [ids.mgr2] });
    expect(west.status, west.text).toBe(201);
    ids.west = west.json.id;
    expect((await call('admin', 'POST', '/admin/teams', { name: 'east' })).json.code).toBe('TEAM_NAME_TAKEN');
    // A salesperson cannot be made a manager at creation either.
    expect((await call('admin', 'POST', '/admin/teams', { name: 'North', managerIds: [ids.rep1] })).json.code).toBe('MANAGER_ROLE_REQUIRED');
    expect((await ctx.db.select().from(schema.team)).map((t) => t.name).sort()).toEqual(['East', 'West']);

    const renamed = await call('admin', 'PATCH', `/admin/teams/${ids.east}`, { name: 'East Coast' });
    expect(renamed.status, renamed.text).toBe(200);
    expect((await lastAudit('team.renamed'))!.changes).toEqual({ before: { name: 'East' }, after: { name: 'East Coast' } });
    expect((await call('admin', 'PATCH', `/admin/teams/${ids.east}`, { name: 'WEST' })).status).toBe(409);
    expect((await call('admin', 'PATCH', `/admin/teams/${NIL}`, { name: 'Ghost' })).status).toBe(404);

    const list = (await call('admin', 'GET', '/admin/teams')).json as any[];
    expect(list.map((t) => t.name)).toEqual(['East Coast', 'West']);
    expect(list[1].managers.map((m: any) => m.fullName)).toEqual(['Max Manager']);
    expect(list[0]).toMatchObject({ members: [], managers: [] });
  });

  it('manager team scope takes effect immediately when members and managers change', async () => {
    const seesDeal = async (who: string) => (await call(who, 'GET', `/deals/${ids.rep1Deal}`)).status;
    const listed = async (who: string) => ((await call(who, 'GET', '/deals')).json.items ?? (await call(who, 'GET', '/deals')).json).map((d: any) => d.id);
    expect(await seesDeal('mgr')).toBe(404);

    // Only managers (or admins) can manage a team.
    const notManager = await call('admin', 'POST', `/admin/teams/${ids.east}/managers`, { userId: ids.rep2 });
    expect(notManager.status).toBe(422);
    expect(notManager.json.code).toBe('MANAGER_ROLE_REQUIRED');
    expect((await call('admin', 'POST', `/admin/teams/${ids.east}/managers`, { userId: NIL })).status).toBe(404);

    const addManager = await call('admin', 'POST', `/admin/teams/${ids.east}/managers`, { userId: ids.mgr });
    expect(addManager.status, addManager.text).toBe(200);
    expect(addManager.json.changed).toBe(true);
    expect((await call('admin', 'POST', `/admin/teams/${ids.east}/managers`, { userId: ids.mgr })).json.changed).toBe(false);
    expect(await seesDeal('mgr')).toBe(404); // managing an empty team grants nothing yet

    const addMember = await call('admin', 'POST', `/admin/teams/${ids.east}/members`, { userId: ids.rep1 });
    expect(addMember.status, addMember.text).toBe(200);
    expect(await lastAudit('team.member_added')).toMatchObject({ targetType: 'team', targetId: ids.east, actorUserId: ids.admin });
    // Same session cookie, next request: the manager now sees and can edit the new member's deal.
    expect(await seesDeal('mgr')).toBe(200);
    expect(await listed('mgr')).toContain(ids.rep1Deal);
    expect(await listed('mgr')).not.toContain(ids.rep2Deal);
    expect((await call('mgr', 'GET', `/deals/${ids.rep2Deal}`)).status).toBe(404);
    expect(await seesDeal('mgr2')).toBe(404);

    const teams = (await call('admin', 'GET', '/admin/teams')).json as any[];
    expect(teams.find((t) => t.id === ids.east)).toMatchObject({
      members: [{ userId: ids.rep1, fullName: 'Rae Rep', role: 'salesperson' }],
      managers: [{ userId: ids.mgr, fullName: 'Mia Manager' }],
    });

    // A user belongs to one team: moving needs explicit confirmation.
    const clash = await call('admin', 'POST', `/admin/teams/${ids.west}/members`, { userId: ids.rep1 });
    expect(clash.status).toBe(409);
    expect(clash.json.code).toBe('TEAM_MEMBERSHIP_CONFLICT');
    expect(clash.json.meta.currentTeamName).toBe('East Coast');
    expect(await seesDeal('mgr')).toBe(200);
    const moved = await call('admin', 'POST', `/admin/teams/${ids.west}/members`, { userId: ids.rep1, move: true });
    expect(moved.status, moved.text).toBe(200);
    expect(await seesDeal('mgr')).toBe(404);
    expect(await seesDeal('mgr2')).toBe(200);

    // The last manager of a team with members cannot be removed.
    const lastManager = await call('admin', 'DELETE', `/admin/teams/${ids.west}/managers/${ids.mgr2}`);
    expect(lastManager.status).toBe(422);
    expect(lastManager.json.code).toBe('TEAM_MANAGER_REQUIRED');

    const removed = await call('admin', 'DELETE', `/admin/teams/${ids.west}/members/${ids.rep1}`);
    expect(removed.status, removed.text).toBe(200);
    expect(await seesDeal('mgr2')).toBe(404);
    expect(await lastAudit('team.member_removed')).toMatchObject({ targetId: ids.west });
    expect((await call('admin', 'DELETE', `/admin/teams/${ids.west}/members/${ids.rep1}`)).status).toBe(404);

    // Removing the manager ends the scope as well.
    expect((await call('admin', 'POST', `/admin/teams/${ids.east}/members`, { userId: ids.rep1 })).status).toBe(200);
    expect(await seesDeal('mgr')).toBe(200);
    expect((await call('admin', 'POST', `/admin/teams/${ids.east}/managers`, { userId: ids.mgr2 })).status).toBe(200);
    expect((await call('admin', 'DELETE', `/admin/teams/${ids.east}/managers/${ids.mgr}`)).status).toBe(200);
    expect(await seesDeal('mgr')).toBe(404);
    expect(await seesDeal('mgr2')).toBe(200);
    expect(await lastAudit('team.manager_removed')).toMatchObject({ targetId: ids.east });
    expect((await call('admin', 'DELETE', `/admin/teams/${ids.east}/managers/${ids.mgr}`)).status).toBe(404);
  });

  // ───────────────────────── audit log viewer ─────────────────────────
  it('lists the audit log newest first with a readable summary and cursor paging', async () => {
    const total = (await ctx.db.select().from(schema.auditLog)).length;
    expect(total).toBeGreaterThan(20);
    const first = await call('admin', 'GET', '/audit-log?limit=10');
    expect(first.status, first.text).toBe(200);
    expect(first.json.items).toHaveLength(10);
    const seqs: number[] = first.json.items.map((i: any) => i.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => b - a));
    expect(first.json.nextCursor).toBe(seqs.at(-1));
    expect(first.json.items[0]).toMatchObject({
      actorName: 'Ada Admin',
      actorType: 'user',
      action: 'team.manager_removed',
      targetType: 'team',
      targetName: 'East Coast',
    });
    expect(typeof first.json.items[0].occurredAt).toBe('string');

    // Walk every page: no overlaps, nothing missing, strictly descending.
    const seen: number[] = [...seqs];
    let cursor = first.json.nextCursor;
    while (cursor) {
      const page = await call('admin', 'GET', `/audit-log?limit=10&before=${cursor}`);
      seen.push(...page.json.items.map((i: any) => i.seq));
      cursor = page.json.nextCursor;
    }
    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
    expect(seen).toEqual([...seen].sort((a, b) => b - a));

    const renamed = (await call('admin', 'GET', '/audit-log?action=team.renamed')).json.items[0];
    expect(renamed.summary).toEqual(['name: East → East Coast']);
    const org = (await call('admin', 'GET', '/audit-log?action=settings.organization_changed')).json.items.at(-1);
    expect(org.summary).toContain('organization name: Northwind Test → Northwind Trading');
    expect(org.summary).toContain('proposal defaults · default term months: 12 → 24');
  });

  it('filters the audit log by actor, action prefix, target type and date range', async () => {
    const byActor = (await call('admin', 'GET', `/audit-log?actorUserId=${ids.rep1}&limit=200`)).json.items as any[];
    expect(byActor.length).toBeGreaterThan(0);
    expect(byActor.every((i) => i.actorUserId === ids.rep1 && i.actorName === 'Rae Rep')).toBe(true);

    const byAction = (await call('admin', 'GET', '/audit-log?action=pipeline.&limit=200')).json.items as any[];
    expect(byAction.length).toBeGreaterThanOrEqual(6);
    expect(byAction.every((i) => i.action.startsWith('pipeline.'))).toBe(true);
    // The prefix is literal: "%" and "_" are not wildcards.
    expect((await call('admin', 'GET', '/audit-log?action=pipeline_')).json.items).toHaveLength(0);
    expect((await call('admin', 'GET', '/audit-log?action=pipe%25')).status).toBe(400);

    const byType = (await call('admin', 'GET', '/audit-log?targetType=lost_reason&limit=200')).json.items as any[];
    expect(byType.length).toBeGreaterThanOrEqual(4);
    expect(byType.every((i) => i.targetType === 'lost_reason')).toBe(true);
    const both = (await call('admin', 'GET', `/audit-log?targetType=team&action=team.member&actorUserId=${ids.admin}`)).json.items as any[];
    expect(both.length).toBeGreaterThanOrEqual(3);
    expect(both.every((i) => i.targetType === 'team' && i.action.startsWith('team.member'))).toBe(true);

    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect((await call('admin', 'GET', `/audit-log?from=${encodeURIComponent(future)}`)).json.items).toHaveLength(0);
    expect((await call('admin', 'GET', `/audit-log?to=${encodeURIComponent(past)}`)).json.items).toHaveLength(0);
    expect((await call('admin', 'GET', `/audit-log?from=${encodeURIComponent(past)}&to=${encodeURIComponent(future)}&limit=5`)).json.items).toHaveLength(5);
    expect((await call('admin', 'GET', `/audit-log?from=${encodeURIComponent(future)}&to=${encodeURIComponent(past)}`)).json.code).toBe('DATE_RANGE_INVALID');
    for (const bad of ['limit=0', 'limit=1000', 'actorUserId=nope', 'from=yesterday', 'before=abc'])
      expect((await call('admin', 'GET', `/audit-log?${bad}`)).status, bad).toBe(400);

    const filters = (await call('admin', 'GET', '/audit-log/filters')).json;
    expect(filters.targetTypes).toEqual(expect.arrayContaining(['deal', 'lost_reason', 'pipeline_stage', 'team']));
    expect(filters.actors.map((a: any) => a.fullName)).toEqual(expect.arrayContaining(['Ada Admin', 'Rae Rep']));
  });

  it('never exposes secrets and offers no way to write, change or delete an entry', async () => {
    await ctx.db.insert(schema.auditLog).values({
      actorType: 'system',
      action: 'test.secret_probe',
      changes: {
        before: { password: 'hunter2-plain', nested: { apiKey: 'sk-live-123', accessToken: 'tok-abc', label: 'visible' } },
        after: { password: 'new-plain', nested: { apiKey: 'sk-live-456', accessToken: 'tok-def', label: 'still visible' } },
        tokenHash: 'deadbeef',
      },
    });
    const r = await call('admin', 'GET', '/audit-log?action=test.secret_probe');
    expect(r.status).toBe(200);
    expect(r.json.items).toHaveLength(1);
    expect(r.json.items[0].actorName).toBe('Automation');
    expect(r.text).not.toMatch(/hunter2|new-plain|sk-live|tok-abc|tok-def|deadbeef/);
    expect(r.text).toContain('still visible');
    // No password hashes, session tokens or keys anywhere in a full listing either.
    const all = await call('admin', 'GET', '/audit-log?limit=200');
    expect(all.text).not.toMatch(new RegExp(`${PASSWORD}|leadFormKey|"aiSettings"`));

    const [entry] = await ctx.db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.seq)).limit(1);
    const count = (await ctx.db.select().from(schema.auditLog)).length;
    for (const [method, path] of [
      ['POST', '/audit-log'],
      ['PUT', '/audit-log'],
      ['DELETE', '/audit-log'],
      ['DELETE', `/audit-log/${entry!.id}`],
      ['PATCH', `/audit-log/${entry!.id}`],
    ] as const) {
      const x = await call('admin', method, path, { action: 'forged' });
      expect([404, 405], `${method} ${path}`).toContain(x.status);
    }
    // Reading the log does not write to it.
    expect((await ctx.db.select().from(schema.auditLog)).length).toBe(count);
  });

  // ───────────────────────── removal of unused reasons and empty teams ─────────────────────────
  it('removes only lost reasons no deal uses and only teams that are empty', async () => {
    const reasons = (await call('admin', 'GET', '/admin/lost-reasons')).json as any[];
    const used = reasons.find((r) => r.dealCount > 0);
    const inUse = await call('admin', 'DELETE', `/admin/lost-reasons/${used.id}`);
    expect(inUse.status).toBe(409);
    expect(inUse.json.code).toBe('LOST_REASON_IN_USE');
    const spare = await call('admin', 'POST', '/admin/lost-reasons', { name: 'Spare reason' });
    const gone = await call('admin', 'DELETE', `/admin/lost-reasons/${spare.json.id}`);
    expect(gone.status, gone.text).toBe(200);
    expect(await lastAudit('lost_reason.deleted')).toMatchObject({ targetId: spare.json.id, actorUserId: ids.admin });
    const after = (await call('admin', 'GET', '/admin/lost-reasons')).json as any[];
    expect(after.map((r) => r.name)).not.toContain('Spare reason');
    expect(after.map((r) => r.id)).toContain(used.id);
    expect((await call('admin', 'DELETE', `/admin/lost-reasons/${spare.json.id}`)).status).toBe(404);

    // East Coast still has a member and a manager.
    const busy = await call('admin', 'DELETE', `/admin/teams/${ids.east}`);
    expect(busy.status).toBe(422);
    expect(busy.json.code).toBe('TEAM_NOT_EMPTY');
    const temp = await call('admin', 'POST', '/admin/teams', { name: 'Temporary team' });
    const removed = await call('admin', 'DELETE', `/admin/teams/${temp.json.id}`);
    expect(removed.status, removed.text).toBe(200);
    expect(await lastAudit('team.deleted')).toMatchObject({ targetId: temp.json.id });
    expect(((await call('admin', 'GET', '/admin/teams')).json as any[]).map((t) => t.name)).toEqual(['East Coast', 'West']);
    expect((await call('admin', 'DELETE', `/admin/teams/${temp.json.id}`)).status).toBe(404);
  });
});
