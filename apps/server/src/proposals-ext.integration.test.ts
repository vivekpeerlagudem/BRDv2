/**
 * Proposals and sharing extensions — real PostgreSQL, real HTTP routes, real authorization.
 * BR-PRP-009 validity date, BR-SHR-007 per-link expiry, BR-PRP-010 copy to another deal, BR-PRP-006 comparison.
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
const DAY = 86_400_000;

describe.skipIf(!testUrl)('proposals and sharing extensions (PostgreSQL integration)', () => {
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
  let clockOffsetMs = 0;
  const now = () => new Date(Date.now() + clockOffsetMs);
  const day = (offsetDays: number) => new Date(now().getTime() + offsetDays * DAY).toISOString().slice(0, 10);
  const { ctx, pool, auth } = buildContext(config, { now });
  const app = createApp(ctx, auth);
  const cookies: Record<string, string> = {};
  type IdKey =
    | 'admin'
    | 'manager'
    | 'rep1'
    | 'rep2'
    | 'company'
    | 'contact'
    | 'deal'
    | 'company2'
    | 'contact2'
    | 'deal2'
    | 'company3'
    | 'contact3'
    | 'deal3'
    | 'template'
    | 'proposal'
    | 'v1'
    | 'v2'
    | 'token'
    | 'buyer'
    | 'link'
    | 'copy';
  const ids = {} as Record<IdKey, string>;

  async function call(who: string | null, method: string, path: string, body?: unknown, extraCookie?: string) {
    const headers: Record<string, string> = { origin: ORIGIN, 'content-type': 'application/json' };
    const cookie = extraCookie ?? (who ? cookies[who] : undefined);
    if (cookie) headers.cookie = cookie;
    const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, res, text };
  }
  const cookieOf = (res: Response) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const proposalOf = async (who: string, id: string) => (await call(who, 'GET', `/api/v1/proposals/${id}`)).json;
  const audits = (action: string, targetId: string) =>
    ctx.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, action), eq(schema.auditLog.targetId, targetId)));

  const PRICING = {
    lines: [
      {
        lineKey: 'setup',
        name: 'Implementation',
        unit: 'project',
        quantity: '1',
        unitPrice: '10000',
        taxRatePercent: '0',
        billingType: 'one_time',
        discountType: 'percent',
        discountValue: '5',
      },
      {
        lineKey: 'sub',
        name: 'Subscription',
        unit: 'seat',
        quantity: '10',
        unitPrice: '100',
        taxRatePercent: '0',
        billingType: 'recurring',
        billingPeriod: 'month',
      },
    ],
  };
  /** Saves the current draft with the given changes; returns the HTTP result. */
  async function saveDraft(who: string, id: string, change: { scope?: string; pricing?: unknown; validUntil?: string | null } = {}) {
    const p = await proposalOf(who === 'rep2' ? 'admin' : who, id);
    const content = {
      ...p.currentVersion.content,
      sections: p.currentVersion.content.sections.map((s: any) => (s.id === 'scope' && change.scope !== undefined ? { ...s, body: change.scope } : s)),
    };
    return call(who, 'PUT', `/api/v1/proposals/${id}/draft`, {
      content,
      pricing: change.pricing ?? p.currentVersion.pricing,
      termMonths: p.currentVersion.termMonths,
      rowVersion: p.currentVersion.rowVersion,
      ...('validUntil' in change ? { validUntil: change.validUntil } : {}),
    });
  }
  /** Sends the proposal, confirming warnings (deal amount differs from proposal value). */
  async function send(who: string, id: string, extra: Record<string, unknown> = {}) {
    const first = await call(who, 'POST', `/api/v1/proposals/${id}/send`, { recipientContactIds: [ids.contact], ...extra });
    if (first.json?.code !== 'CONFIRMATION_REQUIRED') return first;
    const confirm = first.json.meta.confirmations.map((c: any) => c.code);
    return call(who, 'POST', `/api/v1/proposals/${id}/send`, { recipientContactIds: [ids.contact], confirm, ...extra });
  }
  const tokenOf = (sent: any) => new URL(sent.json.links[0].url).hash.slice(1);
  async function buyerSession(token: string) {
    const ex = await call(null, 'POST', '/public/v1/session/exchange', { token });
    return { status: ex.status, cookie: cookieOf(ex.res) };
  }
  const setCrossVisibility = (deals: 'none' | 'view_only') =>
    ctx.db.update(schema.organizationSettings).set({ salespersonCrossVisibility: { companies: deals, contacts: deals, deals } });

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
    const [team] = await ctx.db.insert(schema.team).values({ name: 'East' }).returning();
    await ctx.db.transaction(async (tx) => {
      ids.manager = await insertUser(tx, { email: 'manager@test.example', fullName: 'Mia Manager', role: 'sales_manager', password: PASSWORD }, null);
      ids.rep1 = await insertUser(tx, { email: 'rep1@test.example', fullName: 'Rae Rep', role: 'salesperson', password: PASSWORD, teamId: team!.id }, null);
      ids.rep2 = await insertUser(tx, { email: 'rep2@test.example', fullName: 'Sam Solo', role: 'salesperson', password: PASSWORD }, null);
      await tx.insert(schema.teamManager).values({ teamId: team!.id, userId: ids.manager });
    });
    for (const k of ['admin', 'manager', 'rep1', 'rep2']) {
      const r = await call(null, 'POST', '/auth/sign-in/email', { email: `${k}@test.example`, password: PASSWORD });
      expect(r.status, r.text).toBe(200);
      cookies[k] = cookieOf(r.res);
    }
    await setCrossVisibility('none');

    // rep1: Globex with two deals; rep2: Initech with one deal.
    ids.company = (await call('rep1', 'POST', '/api/v1/companies', { name: 'Globex Corporation', domain: 'globex.example' })).json.id;
    ids.contact = (
      await call('rep1', 'POST', '/api/v1/contacts', { firstName: 'Hank', lastName: 'Scorpio', email: 'hank@globex.example', companyId: ids.company })
    ).json.id;
    const d1 = await call('rep1', 'POST', '/api/v1/deals', { name: 'Globex rollout', companyId: ids.company, amount: '5000.00', contactIds: [ids.contact] });
    expect(d1.status, d1.text).toBe(201);
    ids.deal = d1.json.id;
    ids.company2 = (await call('rep1', 'POST', '/api/v1/companies', { name: 'Umbrella Works', domain: 'umbrella.example' })).json.id;
    ids.contact2 = (
      await call('rep1', 'POST', '/api/v1/contacts', { firstName: 'Alice', lastName: 'Abernathy', email: 'alice@umbrella.example', companyId: ids.company2 })
    ).json.id;
    ids.deal2 = (
      await call('rep1', 'POST', '/api/v1/deals', { name: 'Umbrella expansion', companyId: ids.company2, amount: '7000.00', contactIds: [ids.contact2] })
    ).json.id;
    ids.company3 = (await call('rep2', 'POST', '/api/v1/companies', { name: 'Initech', domain: 'initech.example' })).json.id;
    ids.contact3 = (
      await call('rep2', 'POST', '/api/v1/contacts', { firstName: 'Bill', lastName: 'Lumbergh', email: 'bill@initech.example', companyId: ids.company3 })
    ).json.id;
    ids.deal3 = (
      await call('rep2', 'POST', '/api/v1/deals', { name: 'Initech renewal', companyId: ids.company3, amount: '900.00', contactIds: [ids.contact3] })
    ).json.id;

    ids.template = (await call('admin', 'POST', '/api/v1/templates', { name: 'Standard proposal' })).json.id;
    expect((await call('admin', 'POST', `/api/v1/templates/${ids.template}/publish`)).status).toBe(200);
    const created = await call('rep1', 'POST', `/api/v1/deals/${ids.deal}/proposals`, { templateId: ids.template, signatureRequired: false });
    expect(created.status, created.text).toBe(201);
    ids.proposal = created.json.id;
    expect((await saveDraft('rep1', ids.proposal, { scope: 'We will deliver the rollout in two phases.', pricing: PRICING })).status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    await pool.end();
  });

  describe('BR-PRP-009 validity date', () => {
    it('offers the organization default and saves a chosen date with the draft', async () => {
      const p = await proposalOf('rep1', ids.proposal);
      expect(p.today).toBe(day(0));
      expect(p.defaultValidUntil).toBe(day(p.defaultValidityDays));
      expect(p.validUntil).toBe(p.defaultValidUntil); // a new proposal starts on the default

      const chosen = day(10);
      const saved = await saveDraft('rep1', ids.proposal, { validUntil: chosen });
      expect(saved.status, saved.text).toBe(200);
      expect(saved.json.validUntil).toBe(chosen);
      expect((await proposalOf('rep1', ids.proposal)).validUntil).toBe(chosen);
      expect((await audits('proposal.validity_changed', ids.proposal)).at(-1)?.changes).toMatchObject({ to: chosen });
      // Saving without the field keeps the date.
      expect((await saveDraft('rep1', ids.proposal, { scope: 'We will deliver the rollout in three phases.' })).status).toBe(200);
      expect((await proposalOf('rep1', ids.proposal)).validUntil).toBe(chosen);
    });

    it('refuses a past date, a malformed date and other owners', async () => {
      const past = await saveDraft('rep1', ids.proposal, { validUntil: day(-1) });
      expect(past.status).toBe(422);
      expect(past.json.code).toBe('VALIDITY_DATE_PAST');
      expect((await saveDraft('rep1', ids.proposal, { validUntil: 'tomorrow' })).status).toBe(400);
      expect((await saveDraft('rep1', ids.proposal, { validUntil: day(0) })).status).toBe(200); // today is allowed
      expect((await saveDraft('rep1', ids.proposal, { validUntil: day(10) })).status).toBe(200);
      // rep2 cannot see the proposal at all.
      expect((await saveDraft('rep2', ids.proposal, { validUntil: day(20) })).status).toBe(404);
      expect((await proposalOf('rep1', ids.proposal)).validUntil).toBe(day(10));
    });

    it('a view-only user gets 403 and nothing changes', async () => {
      await setCrossVisibility('view_only');
      try {
        expect((await call('rep2', 'GET', `/api/v1/proposals/${ids.proposal}`)).status).toBe(200);
        const r = await saveDraft('rep2', ids.proposal, { validUntil: day(20) });
        expect(r.status).toBe(403);
        expect((await proposalOf('rep1', ids.proposal)).validUntil).toBe(day(10));
      } finally {
        await setCrossVisibility('none');
      }
    });

    it('pre-send rules block a validity date that has passed', async () => {
      await ctx.db
        .update(schema.proposal)
        .set({ validUntil: day(-2) })
        .where(eq(schema.proposal.id, ids.proposal));
      const check = (await call('rep1', 'GET', `/api/v1/proposals/${ids.proposal}/presend-check`)).json;
      expect(check.findings.find((f: any) => f.code === 'VALIDITY_DATE_PAST')).toMatchObject({ severity: 'blocking' });
      const refused = await send('rep1', ids.proposal);
      expect(refused.status).toBe(409);
      expect(refused.json.code).toBe('PROPOSAL_NOT_SENDABLE');
      expect((await saveDraft('rep1', ids.proposal, { validUntil: day(10) })).status).toBe(200);
      const after = (await call('rep1', 'GET', `/api/v1/proposals/${ids.proposal}/presend-check`)).json;
      expect(after.findings.map((f: any) => f.code)).not.toContain('VALIDITY_DATE_PAST');
    });

    it('the preview, the frozen snapshot and the buyer page carry the validity date', async () => {
      const preview = await call('rep1', 'GET', `/api/v1/proposals/${ids.proposal}/preview`);
      expect(preview.json.html).toContain(`Valid until ${day(10)}`);
      expect(preview.json.html).toContain(`This proposal is valid until ${day(10)}.`); // {{proposal.valid_until}} in the locked terms

      const sent = await send('rep1', ids.proposal);
      expect(sent.status, sent.text).toBe(200);
      ids.v1 = sent.json.versionId;
      ids.token = tokenOf(sent);
      const [v] = await ctx.db.select().from(schema.proposalVersion).where(eq(schema.proposalVersion.id, ids.v1));
      expect((v!.frozenSnapshot as { validUntil: string }).validUntil).toBe(day(10));

      const buyer = await buyerSession(ids.token);
      ids.buyer = buyer.cookie;
      expect((await call(null, 'POST', '/public/v1/identity/continue', {}, ids.buyer)).status).toBe(200);
      const view = await call(null, 'GET', '/public/v1/proposal', undefined, ids.buyer);
      expect(view.status).toBe(200);
      expect(view.json.snapshot.validUntil).toBe(day(10));
      // A sent version has no draft: the date cannot be changed without a new version (RULE-PRP-13).
      const p = await proposalOf('rep1', ids.proposal);
      const r = await call('rep1', 'PUT', `/api/v1/proposals/${ids.proposal}/draft`, {
        content: p.currentVersion.content,
        pricing: p.currentVersion.pricing,
        termMonths: p.currentVersion.termMonths,
        rowVersion: p.currentVersion.rowVersion,
        validUntil: day(30),
      });
      expect(r.status).toBe(409);
      expect(r.json.code).toBe('VERSION_IMMUTABLE');
      expect((await proposalOf('rep1', ids.proposal)).validUntil).toBe(day(10));
    });
  });

  describe('BR-SHR-007 per-link expiry', () => {
    const expiry = (linkId: string, who: string, body: unknown) => call(who, 'PUT', `/api/v1/share-links/${linkId}/expiry`, body);
    const linkOf = async () => (await call('rep1', 'GET', `/api/v1/proposals/${ids.proposal}/links`)).json.find((l: any) => l.id === ids.link);

    it('sets, shows and validates the expiry of one link', async () => {
      const links = (await call('rep1', 'GET', `/api/v1/proposals/${ids.proposal}/links`)).json;
      expect(links).toHaveLength(1);
      ids.link = links[0].id;
      expect(links[0]).toMatchObject({ expiresAt: null, expired: false, status: 'active' });

      expect((await expiry(ids.link, 'rep1', { expiresAt: new Date(now().getTime() - 60_000).toISOString() })).json.code).toBe('LINK_EXPIRY_IN_PAST');
      expect((await expiry(ids.link, 'rep1', { expiresAt: 'next week' })).status).toBe(400);
      expect((await linkOf()).expiresAt).toBeNull();

      const at = new Date(now().getTime() + 2 * DAY).toISOString();
      const ok = await expiry(ids.link, 'rep1', { expiresAt: at });
      expect(ok.status, ok.text).toBe(200);
      expect(new Date((await linkOf()).expiresAt).toISOString()).toBe(at);
      const audit = (await audits('share_link.updated', ids.link)).at(-1);
      expect(audit?.changes).toMatchObject({ expiresAt: { from: null, to: at } });
      expect(audit?.actorUserId).toBe(ids.rep1);
    });

    it('a date after the proposal validity date needs explicit confirmation', async () => {
      const late = new Date(now().getTime() + 40 * DAY).toISOString();
      const warned = await expiry(ids.link, 'rep1', { expiresAt: late });
      expect(warned.status).toBe(409);
      expect(warned.json.code).toBe('CONFIRMATION_REQUIRED');
      expect(warned.json.meta.confirmations[0].code).toBe('LINK_EXPIRY_AFTER_VALIDITY');
      expect(new Date((await linkOf()).expiresAt).getTime()).toBeLessThan(new Date(late).getTime()); // unchanged
      expect((await expiry(ids.link, 'rep1', { expiresAt: late, confirm: ['LINK_EXPIRY_AFTER_VALIDITY'] })).status).toBe(200);
      expect(new Date((await linkOf()).expiresAt).toISOString()).toBe(late);
    });

    it('enforces record access: invisible → 404, view-only → 403, team manager → allowed', async () => {
      const at = new Date(now().getTime() + 3 * DAY).toISOString();
      expect((await expiry(ids.link, 'rep2', { expiresAt: at })).status).toBe(404);
      expect((await call('rep2', 'GET', `/api/v1/proposals/${ids.proposal}/links`)).status).toBe(404);
      await setCrossVisibility('view_only');
      try {
        expect((await call('rep2', 'GET', `/api/v1/proposals/${ids.proposal}/links`)).status).toBe(200);
        const r = await expiry(ids.link, 'rep2', { expiresAt: at });
        expect(r.status).toBe(403);
        expect(r.json.code).toBe('VIEW_ONLY');
      } finally {
        await setCrossVisibility('none');
      }
      expect(new Date((await linkOf()).expiresAt).toISOString()).not.toBe(at);
      expect((await expiry(ids.link, 'manager', { expiresAt: at })).status).toBe(200); // rep1 is in the manager's team
      expect(new Date((await linkOf()).expiresAt).toISOString()).toBe(at);
      expect((await call(null, 'PUT', `/api/v1/share-links/${ids.link}/expiry`, { expiresAt: at })).status).toBe(401);
    });

    it('the buyer side refuses an expired link at request time, for existing and new sessions', async () => {
      expect((await call(null, 'GET', '/public/v1/session', undefined, ids.buyer)).json.state).toBe('ready');
      const vs = await call(null, 'POST', '/public/v1/views/start', {}, ids.buyer);
      expect(vs.status).toBe(200);

      clockOffsetMs = 4 * DAY; // the link expired a day ago; the proposal itself is still valid (10 days)
      try {
        const state = await call(null, 'GET', '/public/v1/session', undefined, ids.buyer);
        expect(state.json).toEqual({ state: 'link_expired' }); // neutral: no recipient name, no proposal data
        const refused = await call(null, 'GET', '/public/v1/proposal', undefined, ids.buyer);
        expect(refused.status).toBe(422);
        expect(refused.json.code).toBe('PROPOSAL_NOT_AVAILABLE');
        expect(refused.text).not.toContain('Globex');
        expect((await call(null, 'GET', '/public/v1/download', undefined, ids.buyer)).status).toBe(422);
        expect((await call(null, 'POST', '/public/v1/response', { response: 'accept' }, ids.buyer)).status).toBe(422);
        expect((await call(null, 'POST', '/public/v1/views/start', {}, ids.buyer)).status).toBe(422);
        expect((await call(null, 'POST', '/public/v1/views/heartbeat', { viewSessionId: vs.json.viewSessionId, activeSeconds: 10 }, ids.buyer)).status).toBe(
          422,
        );
        // A fresh browser with the same token gets the same neutral state and cannot identify.
        const fresh = await buyerSession(ids.token);
        expect((await call(null, 'GET', '/public/v1/session', undefined, fresh.cookie)).json).toEqual({ state: 'link_expired' });
        expect((await call(null, 'POST', '/public/v1/identity/continue', {}, fresh.cookie)).status).toBe(422);
        expect((await call(null, 'POST', '/public/v1/identity', { name: 'Eve Other', email: 'eve@elsewhere.example' }, fresh.cookie)).status).toBe(422);
        expect(await ctx.db.select().from(schema.contact).where(eq(schema.contact.normalizedEmail, 'eve@elsewhere.example'))).toHaveLength(0);
        // The salesperson sees the link as expired, and no view was counted.
        const l = await linkOf();
        expect(l).toMatchObject({ expired: true, status: 'active' });
        expect(l.views).toHaveLength(0);

        // Extending the expiry makes the same link work again (SM L4).
        const extended = new Date(now().getTime() + 2 * DAY).toISOString();
        expect((await expiry(ids.link, 'rep1', { expiresAt: extended })).status).toBe(200);
        expect((await call(null, 'GET', '/public/v1/session', undefined, ids.buyer)).json.state).toBe('ready');
        expect((await call(null, 'GET', '/public/v1/proposal', undefined, ids.buyer)).status).toBe(200);
      } finally {
        clockOffsetMs = 0;
      }
    });

    it('a past expiry written straight to the database is enforced too, and clearing it restores access', async () => {
      await ctx.db
        .update(schema.shareLink)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.shareLink.id, ids.link));
      expect((await call(null, 'GET', '/public/v1/session', undefined, ids.buyer)).json.state).toBe('link_expired');
      expect((await call(null, 'GET', '/public/v1/proposal', undefined, ids.buyer)).status).toBe(422);
      expect((await linkOf()).expired).toBe(true);
      expect((await expiry(ids.link, 'rep1', { expiresAt: null })).status).toBe(200);
      expect((await linkOf()).expiresAt).toBeNull();
      expect((await call(null, 'GET', '/public/v1/proposal', undefined, ids.buyer)).status).toBe(200);
    });

    it('send can set an expiry for the new links; revoke still works and a revoked link cannot be changed', async () => {
      const created = await call('rep1', 'POST', `/api/v1/deals/${ids.deal}/proposals`, { templateId: ids.template, signatureRequired: false });
      const pid = created.json.id as string;
      expect((await saveDraft('rep1', pid, { scope: 'Short scope.' })).status).toBe(200);
      const at = new Date(now().getTime() + DAY).toISOString();
      const sent = await send('rep1', pid, { linkExpiresAt: at });
      expect(sent.status, sent.text).toBe(200);
      const [l] = (await call('rep1', 'GET', `/api/v1/proposals/${pid}/links`)).json;
      expect(new Date(l.expiresAt).toISOString()).toBe(at);

      const b = await buyerSession(tokenOf(sent));
      expect((await call(null, 'GET', '/public/v1/session', undefined, b.cookie)).json.state).toBe('needs_identity');
      expect((await call('rep2', 'POST', `/api/v1/share-links/${l.id}/revoke`)).status).toBe(404);
      expect((await call('rep1', 'POST', `/api/v1/share-links/${l.id}/revoke`)).status).toBe(200);
      expect((await call(null, 'GET', '/public/v1/session', undefined, b.cookie)).status).toBe(404);
      expect((await buyerSession(tokenOf(sent))).status).toBe(404);
      const r = await expiry(l.id, 'rep1', { expiresAt: new Date(now().getTime() + 2 * DAY).toISOString() });
      expect(r.status).toBe(409);
      expect(r.json.code).toBe('LINK_REVOKED');
      // The first proposal's link is unaffected by all of this.
      expect((await linkOf()).status).toBe('active');
    });
  });

  describe('BR-PRP-006 version comparison', () => {
    it('compares two sent versions: text, pricing lines, totals and validity', async () => {
      const nv = await call('rep1', 'POST', `/api/v1/proposals/${ids.proposal}/versions`);
      expect(nv.status, nv.text).toBe(201);
      const pricing = { lines: [{ ...PRICING.lines[0], quantity: '2' }] }; // quantity changed, subscription removed
      const saved = await saveDraft('rep1', ids.proposal, { scope: 'We will deliver the rollout in four phases.', pricing, validUntil: day(20) });
      expect(saved.status, saved.text).toBe(200);
      const sent = await send('rep1', ids.proposal);
      expect(sent.status, sent.text).toBe(200);
      ids.v2 = sent.json.versionId;

      const p = await proposalOf('rep1', ids.proposal);
      expect(p.versions.map((v: any) => [v.versionNumber, v.state])).toEqual([
        [2, 'sent'],
        [1, 'superseded'],
      ]);
      const cmp = await call('rep1', 'GET', `/api/v1/proposals/${ids.proposal}/compare?from=${ids.v1}&to=${ids.v2}`);
      expect(cmp.status, cmp.text).toBe(200);
      const scope = cmp.json.sections.find((s: any) => s.sectionId === 'scope');
      expect(scope).toMatchObject({
        change: 'changed',
        before: 'We will deliver the rollout in three phases.',
        after: 'We will deliver the rollout in four phases.',
      });
      expect(cmp.json.sections.filter((s: any) => s.change !== 'unchanged')).toHaveLength(1);
      expect(cmp.json.pricing).toEqual([
        { lineKey: 'setup', name: 'Implementation', change: 'changed', fields: [{ field: 'quantity', from: '1', to: '2' }] },
        { lineKey: 'sub', name: 'Subscription', change: 'removed', fields: [] },
      ]);
      expect(cmp.json.totals).toEqual({ from: '21500.00', to: '19000.00' });
      expect(cmp.json.validUntil).toEqual({ from: day(10), to: day(20) }); // v1 keeps its frozen date
      expect((await call('rep2', 'GET', `/api/v1/proposals/${ids.proposal}/compare?from=${ids.v1}&to=${ids.v2}`)).status).toBe(404);
      // The sent version itself is immutable in the database.
      await expect(ctx.db.update(schema.proposalVersion).set({ termMonths: 24 }).where(eq(schema.proposalVersion.id, ids.v1))).rejects.toThrow();
    });
  });

  describe('BR-PRP-010 copy to another deal', () => {
    const copy = (who: string | null, sourceId: string, body: unknown) => call(who, 'POST', `/api/v1/proposals/${sourceId}/copy`, body);

    it('lists only open deals the user may write to as targets', async () => {
      const mine = (await call('rep1', 'GET', '/api/v1/proposal-copy-targets')).json;
      expect(mine.map((d: any) => d.name).sort()).toEqual(['Globex rollout', 'Umbrella expansion']);
      expect((await call('rep1', 'GET', '/api/v1/proposal-copy-targets?q=umbr')).json.map((d: any) => d.id)).toEqual([ids.deal2]);
      await setCrossVisibility('view_only');
      try {
        // Seeing a deal read-only does not make it a target.
        expect((await call('rep1', 'GET', '/api/v1/proposal-copy-targets')).json.map((d: any) => d.id)).not.toContain(ids.deal3);
      } finally {
        await setCrossVisibility('none');
      }
      expect((await call('rep2', 'GET', '/api/v1/proposal-copy-targets')).json.map((d: any) => d.id)).toEqual([ids.deal3]);
      expect((await call('manager', 'GET', '/api/v1/proposal-copy-targets')).json.map((d: any) => d.id)).not.toContain(ids.deal3);
      expect((await call(null, 'GET', '/api/v1/proposal-copy-targets')).status).toBe(401);
    });

    it('creates a new draft on the target deal with content and pricing, re-resolved against that deal', async () => {
      const before = await proposalOf('rep1', ids.proposal);
      const r = await copy('rep1', ids.proposal, { targetDealId: ids.deal2, title: 'Umbrella proposal' });
      expect(r.status, r.text).toBe(201);
      expect(r.json).toMatchObject({ dealId: ids.deal2, dealName: 'Umbrella expansion', currencyReviewRequired: false });
      ids.copy = r.json.id;
      expect(ids.copy).not.toBe(ids.proposal);

      const c = await proposalOf('rep1', ids.copy);
      expect(c).toMatchObject({ dealId: ids.deal2, title: 'Umbrella proposal', status: 'draft', lastSentVersionId: null, signatureRequired: false });
      expect(c.validUntil).toBe(c.defaultValidUntil); // a fresh validity date, not the source's
      expect(c.versions).toHaveLength(1);
      expect(c.currentVersion).toMatchObject({ versionNumber: 1, state: 'draft', sentAt: null, pdfFileId: null });
      expect(c.currentVersion.pricing).toEqual(before.currentVersion.pricing);
      expect(c.currentVersion.totals.tcvExclTax).toBe('19000.00');
      // Placeholders stay placeholders…
      const intro = c.currentVersion.content.sections.find((s: any) => s.id === 'intro').body;
      expect(intro).toContain('{{contact.first_name}}');
      expect(intro).toContain('{{company.name}}');
      expect(c.currentVersion.content).toEqual(before.currentVersion.content);
      // …and resolve to the TARGET deal's data.
      const html = (await call('rep1', 'GET', `/api/v1/proposals/${ids.copy}/preview`)).json.html;
      expect(html).toContain('Dear Alice,');
      expect(html).toContain('Umbrella Works');
      expect(html).not.toContain('Globex');
      expect(html).not.toContain('Hank');
      // Links, views, signatures are not copied; the source is untouched.
      expect((await call('rep1', 'GET', `/api/v1/proposals/${ids.copy}/links`)).json).toEqual([]);
      expect((await call('rep1', 'GET', `/api/v1/proposals/${ids.copy}/signature-requests`)).json).toEqual([]);
      const after = await proposalOf('rep1', ids.proposal);
      expect(after.status).toBe(before.status);
      expect(after.currentVersion.id).toBe(before.currentVersion.id);
      expect((await call('rep1', 'GET', `/api/v1/proposals/${ids.proposal}/links`)).json).toHaveLength(2); // one per sent version, unchanged
      // Audit + timeline on the target deal.
      expect((await audits('proposal.copied', ids.copy)).at(-1)?.changes).toMatchObject({ sourceProposalId: ids.proposal, targetDealId: ids.deal2 });
      const listed = (await call('rep1', 'GET', `/api/v1/deals/${ids.deal2}/proposals`)).json;
      expect(listed.map((x: any) => x.id)).toContain(ids.copy);
      // The copy is an ordinary draft: it can be edited and sent to the target deal's contact.
      expect((await saveDraft('rep1', ids.copy, { scope: 'Scope for Umbrella.' })).status).toBe(200);
      const first = await call('rep1', 'POST', `/api/v1/proposals/${ids.copy}/send`, { recipientContactIds: [ids.contact] });
      expect(first.json.code).toBe('RECIPIENT_NOT_DEAL_CONTACT'); // the source deal's contact is not on the target deal
    });

    it('does not copy pending AI suggestions', async () => {
      const src = (await call('rep1', 'POST', `/api/v1/deals/${ids.deal}/proposals`, { templateId: ids.template, signatureRequired: true })).json.id as string;
      const ai = await call('rep1', 'POST', '/api/v1/ai/draft-section', { proposalId: src, sectionId: 'scope' });
      expect(ai.status, ai.text).toBe(200);
      expect((await proposalOf('rep1', src)).pendingAi).toHaveLength(1);
      const r = await copy('rep1', src, { targetDealId: ids.deal2 });
      expect(r.status, r.text).toBe(201);
      const c = await proposalOf('rep1', r.json.id);
      expect(c.pendingAi).toEqual([]);
      expect(c.signatureRequired).toBe(true);
      expect((await proposalOf('rep1', src)).title).toBe('Standard proposal — Globex rollout');
      expect(c.title).toBe('Standard proposal — Umbrella expansion'); // the default title follows the target deal
      const codes = (await call('rep1', 'GET', `/api/v1/proposals/${r.json.id}/presend-check`)).json.findings.map((f: any) => f.code);
      expect(codes).not.toContain('AI_CONTENT_PENDING');
      expect((await proposalOf('rep1', src)).pendingAi).toHaveLength(1); // still pending on the source
    });

    it('can copy without pricing', async () => {
      const r = await copy('rep1', ids.proposal, { targetDealId: ids.deal2, copyPricing: false });
      expect(r.status, r.text).toBe(201);
      const c = await proposalOf('rep1', r.json.id);
      expect(c.currentVersion.pricing).toEqual({ lines: [] });
      expect(c.currentVersion.totals.tcvExclTax).toBe('0.00');
    });

    it('enforces access on both sides: source readable, target writable', async () => {
      const count = async () => (await ctx.db.select({ id: schema.proposal.id }).from(schema.proposal)).length;
      const n = await count();
      // rep2 cannot see the source → 404, even onto their own deal.
      expect((await copy('rep2', ids.proposal, { targetDealId: ids.deal3 })).status).toBe(404);
      // rep1 cannot see rep2's deal → 404.
      expect((await copy('rep1', ids.proposal, { targetDealId: ids.deal3 })).status).toBe(404);
      // The manager manages rep1 only: rep2's deal is invisible.
      expect((await copy('manager', ids.proposal, { targetDealId: ids.deal3 })).status).toBe(404);
      expect((await copy('rep1', ids.proposal, { targetDealId: 'not-a-uuid' })).status).toBe(400);
      expect((await copy(null, ids.proposal, { targetDealId: ids.deal2 })).status).toBe(401);
      await setCrossVisibility('view_only');
      try {
        // Visible but read-only target → 403; nothing is created.
        const denied = await copy('rep1', ids.proposal, { targetDealId: ids.deal3 });
        expect(denied.status).toBe(403);
        expect(denied.json.code).toBe('VIEW_ONLY');
        expect(await count()).toBe(n);
        // A readable source may be copied onto the user's own deal.
        const ok = await copy('rep2', ids.proposal, { targetDealId: ids.deal3 });
        expect(ok.status, ok.text).toBe(201);
        const html = (await call('rep2', 'GET', `/api/v1/proposals/${ok.json.id}/preview`)).json.html;
        expect(html).toContain('Dear Bill,');
        expect(html).not.toContain('Globex');
      } finally {
        await setCrossVisibility('none');
      }
      expect(await count()).toBe(n + 1);
      expect((await copy('manager', ids.proposal, { targetDealId: ids.deal2 })).status).toBe(201); // team scope on both sides
    });

    it('refuses a closed target deal', async () => {
      const closed = (await call('rep1', 'POST', '/api/v1/deals', { name: 'Closed deal', companyId: ids.company2, contactIds: [ids.contact2] })).json.id;
      await ctx.db.update(schema.deal).set({ status: 'won', closedAt: now() }).where(eq(schema.deal.id, closed));
      const r = await copy('rep1', ids.proposal, { targetDealId: closed });
      expect(r.status).toBe(409);
      expect(r.json.code).toBe('DEAL_CLOSED');
      expect((await call('rep1', 'GET', '/api/v1/proposal-copy-targets')).json.map((d: any) => d.id)).not.toContain(closed);
    });

    it('a different target currency keeps prices and blocks sending until they are confirmed', async () => {
      const eur = (await call('rep1', 'POST', '/api/v1/deals', { name: 'Umbrella Europe', companyId: ids.company2, contactIds: [ids.contact2] })).json.id;
      await ctx.db.update(schema.deal).set({ currency: 'EUR' }).where(eq(schema.deal.id, eur));
      const r = await copy('rep1', ids.proposal, { targetDealId: eur });
      expect(r.status, r.text).toBe(201);
      expect(r.json.currencyReviewRequired).toBe(true);
      const c = await proposalOf('rep1', r.json.id);
      expect(c.currency).toBe('EUR');
      expect(c.currencyReviewFrom).toBe('USD');
      expect(c.currentVersion.pricing.lines[0].unitPrice).toBe('10000'); // unchanged, not converted
      expect(c.currentVersion.totals.currency ?? 'EUR').toBe('EUR');
      const check = (await call('rep1', 'GET', `/api/v1/proposals/${r.json.id}/presend-check`)).json;
      expect(check.findings.find((f: any) => f.code === 'CURRENCY_REVIEW_REQUIRED')).toMatchObject({ severity: 'blocking' });
      expect((await call('rep1', 'POST', `/api/v1/proposals/${r.json.id}/send`, { recipientContactIds: [ids.contact2] })).json.code).toBe(
        'PROPOSAL_NOT_SENDABLE',
      );
      expect((await call('rep2', 'POST', `/api/v1/proposals/${r.json.id}/currency-review/confirm`)).status).toBe(404);
      expect((await call('rep1', 'POST', `/api/v1/proposals/${r.json.id}/currency-review/confirm`)).status).toBe(200);
      const after = (await call('rep1', 'GET', `/api/v1/proposals/${r.json.id}/presend-check`)).json;
      expect(after.findings.map((f: any) => f.code)).not.toContain('CURRENCY_REVIEW_REQUIRED');
      expect((await audits('proposal.currency_review_confirmed', r.json.id)).length).toBe(1);
      // Without pricing lines there is nothing to review.
      const bare = await copy('rep1', ids.proposal, { targetDealId: eur, copyPricing: false });
      expect(bare.json.currencyReviewRequired).toBe(false);
    });

    it('a void proposal can still be continued by copying it', async () => {
      const src = (await call('rep1', 'POST', `/api/v1/deals/${ids.deal}/proposals`, { templateId: ids.template })).json.id as string;
      expect((await call('rep1', 'POST', `/api/v1/proposals/${src}/void`, { reason: 'Wrong deal' })).status).toBe(200);
      const r = await copy('rep1', src, { targetDealId: ids.deal });
      expect(r.status, r.text).toBe(201);
      const c = await proposalOf('rep1', r.json.id);
      expect(c.status).toBe('draft');
      expect(c.title).toBe('Standard proposal — Globex rollout'); // same deal: the title is kept
    });
  });
});
