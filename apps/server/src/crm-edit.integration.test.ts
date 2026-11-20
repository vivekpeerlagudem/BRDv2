/**
 * CRM record edit workflows against a REAL PostgreSQL test database and the real HTTP routes — no mocks.
 * Covers edit / archive / reassign for Admin, Sales Manager, the owning salesperson and another salesperson
 * (BR-CRM-001..004), optimistic concurrency, duplicate detection on edit, contact detail scoping and the
 * company / contact / deal timelines (BR-TIM-003).
 */
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildContext } from './composition.ts';
import { parseConfig } from './config/env.ts';
import { createApp } from './http/app.ts';
import * as crm from './modules/crm.ts';
import { bootstrap, insertUser } from './modules/identity.ts';
import { buildUserActor, schema } from './platform/core.ts';
import { testDbMigratorUrl, testDbUrl } from './test-db.ts';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env.local', import.meta.url)));
} catch {}
const testUrl = testDbUrl();
const PASSWORD = 'Correct-Horse-Battery-9';
const ORIGIN = 'http://localhost:5173';

describe.skipIf(!testUrl)('CRM record edit workflows (PostgreSQL integration)', () => {
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
  const actorOf = async (key: string) => (await buildUserActor(ctx.db, ids[key] as string))!;
  const auditFor = (action: string, targetId: string) =>
    ctx.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, action), eq(schema.auditLog.targetId, targetId)));
  const timeline = async (who: string, type: string, id: string) =>
    ((await call(who, 'GET', `/timeline/${type}/${id}`)).json as { eventType: string; summary: string; actorName: string }[]) ?? [];

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: testDbMigratorUrl() });
    await admin.connect();
    const tables = await admin.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public' and tablename <> 'schema_migration'");
    await admin.query(`truncate ${tables.rows.map((t) => `"${t.tablename}"`).join(',')} restart identity cascade`);
    await admin.end();

    const b = await bootstrap(ctx, {
      organizationName: 'Edit Test Org',
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
      ids.rep3 = await insertUser(
        tx,
        { email: 'rep3@test.example', fullName: 'Tia Teammate', role: 'salesperson', password: PASSWORD, teamId: team!.id },
        null,
      );
      await tx.insert(schema.teamManager).values({ teamId: team!.id, userId: ids.manager });
    });
    for (const k of ['admin', 'manager', 'rep1', 'rep2', 'rep3']) await signIn(k);

    // rep1 owns a company, a contact and a deal; rep2 owns an unrelated company.
    const co = await call('rep1', 'POST', '/companies', { name: 'Initech', domain: 'initech.example', industry: 'Software', phone: '555-0100' });
    expect(co.status, co.text).toBe(201);
    ids.company = co.json.id;
    const ct = await call('rep1', 'POST', '/contacts', { firstName: 'Bill', lastName: 'Lumbergh', email: 'bill@initech.example', companyId: ids.company });
    expect(ct.status, ct.text).toBe(201);
    ids.contact = ct.json.id;
    const d = await call('rep1', 'POST', '/deals', { name: 'Initech renewal', companyId: ids.company, amount: '1000.00', contactIds: [ids.contact] });
    expect(d.status, d.text).toBe(201);
    ids.deal = d.json.id;
    const other = await call('rep2', 'POST', '/companies', { name: 'Solo Industries', domain: 'solo.example' });
    ids.otherCompany = other.json.id;
  }, 60_000);

  afterAll(async () => {
    await pool.end();
  });

  describe('company edit', () => {
    it('lets the owner edit, clear a field, and records audit + timeline', async () => {
      const r = await call('rep1', 'PATCH', `/companies/${ids.company}`, { name: 'Initech  Global', domain: 'initech.example', industry: 'SaaS', phone: '' });
      expect(r.status, r.text).toBe(200);
      const after = (await call('rep1', 'GET', `/companies/${ids.company}`)).json;
      expect(after.name).toBe('Initech  Global');
      expect(after.industry).toBe('SaaS');
      expect(after.phone).toBeNull(); // blank clears
      expect(after.domain).toBe('initech.example');
      expect(after.normalizedName).toBe('initech global');
      expect(after.rowVersion).toBe(2);
      expect(after.permissions).toMatchObject({ edit: true, reassign: false });
      const audit = await auditFor('company.updated', ids.company as string);
      expect(audit).toHaveLength(1);
      expect(audit[0]!.actorUserId).toBe(ids.rep1);
      expect(audit[0]!.changes).toMatchObject({ industry: { from: 'Software', to: 'SaaS' }, phone: { from: '555-0100', to: null } });
      const tl = await timeline('rep1', 'company', ids.company as string);
      expect(tl.find((e) => e.eventType === 'company_updated')).toMatchObject({ actorName: 'Rae Rep' });
    });

    it('lets the team manager and the admin edit, and hides the record from another salesperson', async () => {
      expect((await call('manager', 'PATCH', `/companies/${ids.company}`, { name: 'Initech Global' })).status).toBe(200);
      expect((await call('admin', 'PATCH', `/companies/${ids.company}`, { name: 'Initech Global', industry: 'Software' })).status).toBe(200);
      const denied = await call('rep2', 'PATCH', `/companies/${ids.company}`, { name: 'Hijacked' });
      expect(denied.status).toBe(404);
      expect((await call('rep2', 'POST', `/companies/${ids.company}/archive`)).status).toBe(404);
      expect((await call('rep2', 'POST', `/companies/${ids.company}/owner`, { ownerId: ids.rep2 })).status).toBe(403); // role check comes first
      // The manager does not manage rep2: rep2's company is invisible to them.
      expect((await call('manager', 'PATCH', `/companies/${ids.otherCompany}`, { name: 'Nope' })).status).toBe(404);
      expect((await call('rep1', 'GET', `/companies/${ids.company}`)).json.name).toBe('Initech Global');
    });

    it('returns 403 VIEW_ONLY when the record is visible but not editable', async () => {
      await ctx.db
        .update(schema.organizationSettings)
        .set({ salespersonCrossVisibility: { companies: 'view_only', contacts: 'view_only', deals: 'view_only' } });
      try {
        const seen = await call('rep2', 'GET', `/companies/${ids.company}`);
        expect(seen.status).toBe(200);
        expect(seen.json.permissions).toMatchObject({ edit: false, reassign: false });
        for (const r of [
          await call('rep2', 'PATCH', `/companies/${ids.company}`, { name: 'Hijacked' }),
          await call('rep2', 'POST', `/companies/${ids.company}/archive`),
          await call('rep2', 'PATCH', `/contacts/${ids.contact}`, { firstName: 'Hijacked' }),
          await call('rep2', 'PATCH', `/deals/${ids.deal}`, { name: 'Hijacked', rowVersion: 1 }),
        ]) {
          expect(r.status, r.text).toBe(403);
          expect(r.json.code).toBe('VIEW_ONLY');
        }
        expect((await call('rep2', 'GET', `/contacts/${ids.contact}`)).json.permissions.edit).toBe(false);
      } finally {
        await ctx.db.update(schema.organizationSettings).set({ salespersonCrossVisibility: { companies: 'none', contacts: 'none', deals: 'none' } });
      }
      expect((await call('rep1', 'GET', `/companies/${ids.company}`)).json.name).toBe('Initech Global');
    });

    it('rejects an edit that would duplicate another company domain', async () => {
      const r = await call('rep1', 'PATCH', `/companies/${ids.company}`, { name: 'Initech Global', domain: 'https://www.solo.example/' });
      expect(r.status).toBe(409);
      expect(r.json.code).toBe('DUPLICATE_SUSPECTED');
      expect((await call('rep1', 'GET', `/companies/${ids.company}`)).json.domain).toBe('initech.example');
    });

    it('validates input', async () => {
      const r = await call('rep1', 'PATCH', `/companies/${ids.company}`, { name: '' });
      expect(r.status).toBe(400);
      expect(r.json.errors[0].path).toBe('name');
    });

    it('rejects a stale rowVersion (module contract; see report: the HTTP contract does not carry it yet)', async () => {
      const actor = await actorOf('rep1');
      const current = (await call('rep1', 'GET', `/companies/${ids.company}`)).json;
      await expect(crm.updateCompany(ctx, actor, ids.company as string, { name: 'Stale write', rowVersion: current.rowVersion - 1 })).rejects.toMatchObject({
        code: 'CONCURRENT_MODIFICATION',
        status: 409,
      });
      const ok = await crm.updateCompany(ctx, actor, ids.company as string, {
        name: 'Initech Global',
        website: 'https://initech.example',
        rowVersion: current.rowVersion,
      });
      expect(ok.rowVersion).toBe(current.rowVersion + 1);
      const contact = (await call('rep1', 'GET', `/contacts/${ids.contact}`)).json;
      await expect(crm.updateContact(ctx, actor, ids.contact as string, { firstName: 'Stale', rowVersion: contact.rowVersion + 3 })).rejects.toMatchObject({
        code: 'CONCURRENT_MODIFICATION',
      });
      expect((await call('rep1', 'GET', `/contacts/${ids.contact}`)).json.firstName).toBe('Bill');
    });
  });

  describe('company owner change', () => {
    it('refuses salespeople, limits managers to their team, and allows the admin anywhere', async () => {
      const rep = await call('rep1', 'POST', `/companies/${ids.company}/owner`, { ownerId: ids.rep3 });
      expect(rep.status).toBe(403);
      const outside = await call('manager', 'POST', `/companies/${ids.company}/owner`, { ownerId: ids.rep2 });
      expect(outside.status).toBe(403);
      expect(outside.json.code).toBe('REASSIGN_TARGET_OUT_OF_SCOPE');
      expect((await call('rep1', 'GET', `/companies/${ids.company}`)).json.ownerId).toBe(ids.rep1);

      const managerView = (await call('manager', 'GET', `/companies/${ids.company}`)).json;
      expect(managerView.permissions.reassign).toBe(true);
      expect(managerView.permissions.reassignScope.sort()).toEqual([ids.manager, ids.rep1, ids.rep3].sort());

      const inside = await call('manager', 'POST', `/companies/${ids.company}/owner`, { ownerId: ids.rep3 });
      expect(inside.status, inside.text).toBe(200);
      const moved = (await call('manager', 'GET', `/companies/${ids.company}`)).json;
      expect(moved.owner.fullName).toBe('Tia Teammate');
      // rep1 still sees the company through their own deal (R6) but may no longer edit it.
      const rep1View = await call('rep1', 'GET', `/companies/${ids.company}`);
      expect(rep1View.status).toBe(200);
      expect(rep1View.json.permissions.edit).toBe(false);
      expect((await call('rep1', 'PATCH', `/companies/${ids.company}`, { name: 'Mine again' })).json.code).toBe('VIEW_ONLY');
      const tl = await timeline('manager', 'company', ids.company as string);
      expect(tl.find((e) => e.eventType === 'owner_changed')?.summary).toBe('Company owner changed from Rae Rep to Tia Teammate');
      expect((await auditFor('company.owner_changed', ids.company as string))[0]!.changes).toEqual({ ownerId: { from: ids.rep1, to: ids.rep3 } });

      const back = await call('admin', 'POST', `/companies/${ids.company}/owner`, { ownerId: ids.rep1 });
      expect(back.status).toBe(200);
      expect((await call('admin', 'GET', `/companies/${ids.company}`)).json.permissions.reassignScope).toBeNull();
    });

    it('refuses an inactive or unknown new owner', async () => {
      const r = await call('admin', 'POST', `/companies/${ids.company}/owner`, { ownerId: '018f0000-0000-7000-8000-000000000000' });
      expect(r.status).toBe(422);
      expect(r.json.code).toBe('REASSIGNMENT_TARGET_INACTIVE');
    });
  });

  describe('contact detail and edit', () => {
    it('returns the contact with its owner, company and deals for the owner', async () => {
      const r = await call('rep1', 'GET', `/contacts/${ids.contact}`);
      expect(r.status).toBe(200);
      expect(r.json.owner.fullName).toBe('Rae Rep');
      expect(r.json.company).toEqual({ id: ids.company, name: 'Initech Global', canOpen: true });
      expect(r.json.deals.map((d: any) => d.id)).toEqual([ids.deal]);
      expect(r.json.deals[0]).toMatchObject({ name: 'Initech renewal', status: 'open', isPrimary: true });
      expect(r.json.permissions.edit).toBe(true);
    });

    it('scopes the detail: invisible to another salesperson, deals limited to what the viewer may see', async () => {
      expect((await call('rep2', 'GET', `/contacts/${ids.contact}`)).status).toBe(404);
      expect((await call('rep2', 'GET', `/timeline/contact/${ids.contact}`)).status).toBe(404);
      // rep2 gets their own contact; a deal owned by rep1 that includes it must not leak to rep2 … and vice versa.
      const own = await call('rep2', 'POST', '/contacts', { firstName: 'Olga', lastName: 'Own', email: 'olga@solo.example', companyId: ids.otherCompany });
      ids.rep2Contact = own.json.id;
      await ctx.db.insert(schema.dealContact).values({ dealId: ids.deal as string, contactId: ids.rep2Contact as string, roles: [], isPrimary: false });
      const asRep2 = (await call('rep2', 'GET', `/contacts/${ids.rep2Contact}`)).json;
      expect(asRep2.deals).toEqual([]); // rep1's deal is not visible to rep2
      // rep1 sees rep2's contact only because it is on rep1's deal; the foreign company is named but not linkable.
      const asRep1 = await call('rep1', 'GET', `/contacts/${ids.rep2Contact}`);
      expect(asRep1.status).toBe(200);
      expect(asRep1.json.deals.map((d: any) => d.id)).toEqual([ids.deal]);
      expect(asRep1.json.company).toMatchObject({ id: ids.otherCompany, canOpen: false });
      expect(asRep1.json.permissions.edit).toBe(false);
      expect((await call('rep1', 'PATCH', `/contacts/${ids.rep2Contact}`, { firstName: 'Hijack' })).json.code).toBe('VIEW_ONLY');
      expect((await call('admin', 'GET', `/contacts/${ids.rep2Contact}`)).json.deals).toHaveLength(1);
    });

    it('lets owner, manager and admin edit; keeps absent fields; clears blank ones; writes the contact timeline', async () => {
      const r = await call('rep1', 'PATCH', `/contacts/${ids.contact}`, { firstName: 'William', jobTitle: 'VP Operations', phone: '555-0199' });
      expect(r.status, r.text).toBe(200);
      let c = (await call('rep1', 'GET', `/contacts/${ids.contact}`)).json;
      expect(c).toMatchObject({ firstName: 'William', lastName: 'Lumbergh', email: 'bill@initech.example', jobTitle: 'VP Operations', phone: '555-0199' });
      expect(c.rowVersion).toBe(2);
      expect((await call('manager', 'PATCH', `/contacts/${ids.contact}`, { firstName: 'William', phone: '' })).status).toBe(200);
      expect((await call('admin', 'PATCH', `/contacts/${ids.contact}`, { firstName: 'Bill', email: 'Bill.Lumbergh@Initech.example' })).status).toBe(200);
      c = (await call('rep1', 'GET', `/contacts/${ids.contact}`)).json;
      expect(c).toMatchObject({ firstName: 'Bill', phone: null, email: 'Bill.Lumbergh@Initech.example', normalizedEmail: 'bill.lumbergh@initech.example' });
      const tl = await timeline('rep1', 'contact', ids.contact as string);
      const types = tl.map((e) => e.eventType);
      expect(types).toContain('contact_created');
      expect(types.filter((t) => t === 'contact_updated')).toHaveLength(3);
      expect(types).toContain('deal_created'); // deal events of deals the contact is on (RULE-TIM-06)
      const audit = await auditFor('contact.updated', ids.contact as string);
      expect(audit.map((a) => a.actorUserId)).toEqual(expect.arrayContaining([ids.rep1, ids.manager, ids.admin]));
    });

    it('rejects a duplicate email and a company the user cannot see', async () => {
      const dup = await call('rep1', 'PATCH', `/contacts/${ids.contact}`, { firstName: 'Bill', email: 'OLGA@solo.example' });
      expect(dup.status).toBe(409);
      expect(dup.json.code).toBe('CONTACT_EMAIL_TAKEN');
      const hidden = await call('rep3', 'POST', '/companies', { name: 'Hidden From Rep1' });
      const idor = await call('rep1', 'PATCH', `/contacts/${ids.contact}`, { firstName: 'Bill', companyId: hidden.json.id });
      expect(idor.status).toBe(404);
      const c = (await call('rep1', 'GET', `/contacts/${ids.contact}`)).json;
      expect(c.companyId).toBe(ids.company);
      expect(c.email).toBe('Bill.Lumbergh@Initech.example');
      // Unlinking the company is an explicit null.
      expect((await call('rep1', 'PATCH', `/contacts/${ids.contact}`, { firstName: 'Bill', companyId: null })).status).toBe(200);
      expect((await call('rep1', 'GET', `/contacts/${ids.contact}`)).json.company).toBeNull();
      expect((await call('rep1', 'PATCH', `/contacts/${ids.contact}`, { firstName: 'Bill', companyId: ids.company })).status).toBe(200);
    });
  });

  describe('deal edit and reassignment', () => {
    it('edits name, amount and close date with optimistic concurrency and a timeline entry', async () => {
      const before = (await call('rep1', 'GET', `/deals/${ids.deal}`)).json;
      const r = await call('rep1', 'PATCH', `/deals/${ids.deal}`, {
        name: 'Initech renewal 2027',
        amount: '2500.50',
        closeDate: '2027-03-31',
        rowVersion: before.rowVersion,
      });
      expect(r.status, r.text).toBe(200);
      const after = (await call('rep1', 'GET', `/deals/${ids.deal}`)).json;
      expect(after).toMatchObject({ name: 'Initech renewal 2027', amount: '2500.50', closeDate: '2027-03-31', rowVersion: before.rowVersion + 1 });

      const stale = await call('rep1', 'PATCH', `/deals/${ids.deal}`, { name: 'Lost update', rowVersion: before.rowVersion });
      expect(stale.status).toBe(409);
      expect(stale.json.code).toBe('CONCURRENT_MODIFICATION');
      expect((await call('rep1', 'GET', `/deals/${ids.deal}`)).json.name).toBe('Initech renewal 2027');

      const cleared = await call('manager', 'PATCH', `/deals/${ids.deal}`, { amount: null, closeDate: null, rowVersion: after.rowVersion });
      expect(cleared.status, cleared.text).toBe(200);
      expect((await call('admin', 'GET', `/deals/${ids.deal}`)).json).toMatchObject({ amount: null, closeDate: null });

      expect((await call('rep2', 'PATCH', `/deals/${ids.deal}`, { name: 'Hijack', rowVersion: after.rowVersion + 1 })).status).toBe(404);
      expect((await call('rep1', 'PATCH', `/deals/${ids.deal}`, { amount: '-5', rowVersion: after.rowVersion + 1 })).status).toBe(400);

      const tl = await timeline('rep1', 'deal', ids.deal as string);
      const updates = tl.filter((e) => e.eventType === 'deal_updated');
      expect(updates).toHaveLength(2);
      expect(updates.map((e) => e.summary)).toContain(
        'Deal updated: renamed to "Initech renewal 2027", amount set to USD 2500.50, expected close date set to 2027-03-31',
      );
      const audit = await auditFor('deal.updated', ids.deal as string);
      expect(audit).toHaveLength(2);
      expect(audit.find((a) => a.actorUserId === ids.rep1)!.changes).toMatchObject({ amount: { from: '1000.00', to: '2500.50' } });
    });

    it('reassigns by role: salesperson never, manager inside the team only, admin anywhere', async () => {
      const mine = (await call('rep1', 'GET', `/deals/${ids.deal}`)).json;
      expect(mine.permissions).toMatchObject({ edit: true, reassign: false, reassignScope: null });
      const rep = await call('rep1', 'POST', `/deals/${ids.deal}/owner`, { ownerId: ids.rep3 });
      expect(rep.status).toBe(403); // the owner can see the deal but a salesperson may never reassign (FORBIDDEN_REASSIGN)
      expect(rep.json.code).toBe('FORBIDDEN_REASSIGN');
      // Another salesperson cannot even see this deal, so reassigning it is a 404 (never leak that it exists), matching GET.
      expect((await call('rep2', 'POST', `/deals/${ids.deal}/owner`, { ownerId: ids.rep2 })).status).toBe(404);

      const outside = await call('manager', 'POST', `/deals/${ids.deal}/owner`, { ownerId: ids.rep2 });
      expect(outside.status).toBe(403);
      expect(outside.json.code).toBe('REASSIGN_TARGET_OUT_OF_SCOPE');
      expect((await call('manager', 'GET', `/deals/${ids.deal}`)).json.permissions.reassignScope.sort()).toEqual([ids.manager, ids.rep1, ids.rep3].sort());

      const inside = await call('manager', 'POST', `/deals/${ids.deal}/owner`, { ownerId: ids.rep3 });
      expect(inside.status, inside.text).toBe(200);
      expect((await call('rep3', 'GET', `/deals/${ids.deal}`)).json.owner.fullName).toBe('Tia Teammate');
      expect((await call('rep1', 'GET', `/deals/${ids.deal}`)).status).toBe(404); // no longer theirs
      const tl = await timeline('rep3', 'deal', ids.deal as string);
      expect(tl.find((e) => e.eventType === 'owner_changed')).toMatchObject({
        summary: 'Deal owner changed from Rae Rep to Tia Teammate',
        actorName: 'Mia Manager',
      });
      expect((await auditFor('deal.owner_changed', ids.deal as string))[0]!.changes).toEqual({ from: ids.rep1, to: ids.rep3 });

      // Admin can move it outside the team; the manager then loses sight of it.
      expect((await call('admin', 'POST', `/deals/${ids.deal}/owner`, { ownerId: ids.rep2 })).status).toBe(200);
      expect((await call('manager', 'GET', `/deals/${ids.deal}`)).status).toBe(404);
      expect((await call('manager', 'POST', `/deals/${ids.deal}/owner`, { ownerId: ids.rep1 })).status).toBe(404);
      expect((await call('admin', 'POST', `/deals/${ids.deal}/owner`, { ownerId: ids.rep1 })).status).toBe(200);
    });
  });

  describe('company archive', () => {
    it('blocks archiving while the company has open deals', async () => {
      const r = await call('rep1', 'POST', `/companies/${ids.company}/archive`);
      expect(r.status).toBe(409);
      expect(r.json.code).toBe('COMPANY_HAS_OPEN_DEALS');
      expect((await call('rep1', 'GET', `/companies/${ids.company}`)).json.archivedAt).toBeNull();
    });

    it('archives a company without open deals, hides it from lists and locks further changes', async () => {
      const co = await call('rep1', 'POST', '/companies', { name: 'Archive Me Ltd', domain: 'archive-me.example' });
      const id = co.json.id as string;
      expect((await call('rep3', 'POST', `/companies/${id}/archive`)).status).toBe(404); // teammate, not manager: invisible
      expect((await call('rep1', 'POST', `/companies/${id}/archive`)).status).toBe(200);
      const list = await call('rep1', 'GET', '/companies?q=Archive%20Me');
      expect(list.json.total).toBe(0);
      const detail = (await call('rep1', 'GET', `/companies/${id}`)).json;
      expect(detail.archivedAt).not.toBeNull();
      expect(detail.permissions).toMatchObject({ edit: false, reassign: false });
      for (const r of [
        await call('rep1', 'PATCH', `/companies/${id}`, { name: 'Zombie' }),
        await call('rep1', 'POST', `/companies/${id}/archive`),
        await call('admin', 'POST', `/companies/${id}/owner`, { ownerId: ids.rep3 }),
      ]) {
        expect(r.status, r.text).toBe(422);
        expect(r.json.code).toBe('RECORD_ARCHIVED');
      }
      expect(await auditFor('company.archived', id)).toHaveLength(1);
      expect((await timeline('rep1', 'company', id)).map((e) => e.eventType)).toContain('company_archived');
      // The domain is free again once the holder is archived.
      expect((await call('rep1', 'POST', '/companies', { name: 'Archive Me Reborn', domain: 'archive-me.example' })).status).toBe(201);
    });

    it('lets manager and admin archive team records', async () => {
      const a = await call('rep1', 'POST', '/companies', { name: 'Manager Archives' });
      const b = await call('rep1', 'POST', '/companies', { name: 'Admin Archives' });
      expect((await call('manager', 'POST', `/companies/${a.json.id}/archive`)).status).toBe(200);
      expect((await call('admin', 'POST', `/companies/${b.json.id}/archive`)).status).toBe(200);
    });
  });
  describe('create a person with their company in one step', () => {
    it('creates the new company, links the person, and makes the salesperson the owner of both', async () => {
      const r = await call('rep1', 'POST', '/contacts', {
        firstName: 'Peter',
        lastName: 'Gibbons',
        email: 'peter@penetrode.example',
        newCompany: { name: 'Penetrode', domain: 'penetrode.example', industry: 'Manufacturing' },
      });
      expect(r.status).toBe(201);
      expect(r.json.companyId).toBeTruthy();
      const co = (await call('rep1', 'GET', `/companies/${r.json.companyId}`)).json;
      expect(co).toMatchObject({ name: 'Penetrode', domain: 'penetrode.example', industry: 'Manufacturing' });
      expect(co.owner?.id ?? co.ownerId).toBe(ids.rep1);
      const person = (await call('rep1', 'GET', `/contacts/${r.json.id}`)).json;
      expect(person.company?.name).toBe('Penetrode');
    });

    it('refuses a new company whose domain already exists, names it, and creates nothing', async () => {
      const r = await call('rep1', 'POST', '/contacts', {
        firstName: 'Milton',
        email: 'milton@initech.example',
        newCompany: { name: 'Initech Copy', domain: 'https://www.initech.example/about' },
      });
      expect(r.status).toBe(409);
      expect(r.json.code).toBe('DUPLICATE_SUSPECTED');
      expect(r.json.meta.existingId).toBe(ids.company);
      // Same transaction: the person was not created either, so the email is still free.
      const again = await call('rep1', 'POST', '/contacts', { firstName: 'Milton', email: 'milton@initech.example', companyId: ids.company });
      expect(again.status).toBe(201);
    });

    it('rejects choosing an existing company and a new one at the same time', async () => {
      const r = await call('rep1', 'POST', '/contacts', { firstName: 'Joanna', companyId: ids.company, newCompany: { name: 'Chotchkies' } });
      expect(r.status).toBe(400);
    });
  });
});
