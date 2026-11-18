/**
 * CSV import integration tests — real PostgreSQL, real HTTP routes, real authorization.
 * Covers: Admin-only access, upload limits, column mapping, validation before saving, duplicate detection against the
 * database and within the file, all-or-nothing commit (including a forced failure mid-commit), audit, and undo.
 */
import { fileURLToPath } from 'node:url';
import { and, eq, like, sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildContext } from './composition.ts';
import { parseConfig } from './config/env.ts';
import { importBatch, importRecordLink, importRow } from './db/schema-imports.ts';
import { createApp } from './http/app.ts';
import { bootstrap, insertUser } from './modules/identity.ts';
import { parseCsv } from './modules/imports/csv.ts';
import { commitBatch, IMPORT_LIMITS } from './modules/imports.ts';
import { buildUserActor, schema } from './platform/core.ts';
import { testDbMigratorUrl, testDbUrl } from './test-db.ts';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env.local', import.meta.url)));
} catch {}
const testUrl = testDbUrl();
const PASSWORD = 'Correct-Horse-Battery-9';
const ORIGIN = 'http://localhost:5173';
const { company, contact, deal, auditLog, timelineEvent, dealStageHistory } = schema;

describe.skipIf(!testUrl)('CSV import (PostgreSQL integration)', () => {
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
    const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text, res };
  }
  const upload = (entityType: string, text: string, fileName = `${entityType}.csv`, who = 'admin') =>
    call(who, 'POST', '/api/v1/imports', { entityType, fileName, text });
  /** Upload → accept the suggested mapping → validate. Returns the validated batch. */
  async function validated(entityType: string, text: string, fileName?: string) {
    const up = await upload(entityType, text, fileName);
    expect(up.status, up.text).toBe(201);
    const map = await call('admin', 'PUT', `/api/v1/imports/${up.json.id}/mapping`, { mapping: up.json.suggestedMapping });
    expect(map.status, map.text).toBe(200);
    const pre = await call('admin', 'POST', `/api/v1/imports/${up.json.id}/preview`);
    expect(pre.status, pre.text).toBe(200);
    return pre.json;
  }
  const rowsOf = async (batchId: string, status?: string) =>
    (await call('admin', 'GET', `/api/v1/imports/${batchId}/rows?limit=200${status ? `&status=${status}` : ''}`)).json.items as any[];
  const companyCount = async () => (await ctx.db.select({ n: sql<number>`count(*)::int` }).from(company))[0]!.n;
  const contactCount = async () => (await ctx.db.select({ n: sql<number>`count(*)::int` }).from(contact))[0]!.n;
  const dealCount = async () => (await ctx.db.select({ n: sql<number>`count(*)::int` }).from(deal))[0]!.n;
  const auditCount = async (action: string) => (await ctx.db.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(eq(auditLog.action, action)))[0]!.n;
  const companyByName = async (name: string) => (await ctx.db.select().from(company).where(eq(company.name, name)))[0];
  const linksOf = (batchId: string) => ctx.db.select().from(importRecordLink).where(eq(importRecordLink.batchId, batchId));
  const batchRow = async (id: string) => (await ctx.db.select().from(importBatch).where(eq(importBatch.id, id)))[0]!;

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
      ids.rep1 = await insertUser(tx, { email: 'rep1@test.example', fullName: 'Rae Rep', role: 'salesperson', password: PASSWORD }, null);
      ids.manager = await insertUser(tx, { email: 'manager@test.example', fullName: 'Mo Manager', role: 'sales_manager', password: PASSWORD }, null);
    });
    for (const k of ['admin', 'rep1', 'manager']) {
      const r = await call(null, 'POST', '/auth/sign-in/email', { email: `${k}@test.example`, password: PASSWORD });
      expect(r.status, r.text).toBe(200);
      cookies[k] = (r.res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
    }
    // Existing CRM data the imports are checked against.
    ids.globex = (await call('rep1', 'POST', '/api/v1/companies', { name: 'Globex Corporation', domain: 'globex.example' })).json.id;
    ids.initech = (await call('rep1', 'POST', '/api/v1/companies', { name: 'Initech' })).json.id;
    ids.hank = (await call('rep1', 'POST', '/api/v1/contacts', { firstName: 'Hank', lastName: 'Scorpio', email: 'hank@globex.example' })).json.id;
    expect(ids.globex && ids.initech && ids.hank).toBeTruthy();
  });
  afterAll(async () => {
    await pool.end();
  });

  it('refuses everyone but an Admin, on every import endpoint', async () => {
    const some = '0198c0de-0000-7000-8000-000000000001';
    const endpoints: [string, string, unknown?][] = [
      ['GET', '/api/v1/imports'],
      ['POST', '/api/v1/imports', { entityType: 'companies', fileName: 'x.csv', text: 'name\nSneaky Co\n' }],
      ['GET', `/api/v1/imports/${some}`],
      ['PUT', `/api/v1/imports/${some}/mapping`, { mapping: ['name'] }],
      ['POST', `/api/v1/imports/${some}/preview`],
      ['GET', `/api/v1/imports/${some}/rows`],
      ['GET', `/api/v1/imports/${some}/error-report`],
      ['POST', `/api/v1/imports/${some}/commit`, { duplicateStrategy: 'skip' }],
      ['GET', `/api/v1/imports/${some}/undo-preview`],
      ['POST', `/api/v1/imports/${some}/undo`],
      ['DELETE', `/api/v1/imports/${some}`],
    ];
    for (const who of ['rep1', 'manager']) {
      for (const [method, path, body] of endpoints) {
        const r = await call(who, method, path, body);
        expect([r.status, r.json?.code], `${who} ${method} ${path}`).toEqual([403, 'FORBIDDEN']);
      }
    }
    expect((await call(null, 'GET', '/api/v1/imports')).status).toBe(401);
    expect(await ctx.db.select().from(importBatch)).toHaveLength(0);
    expect(await companyByName('Sneaky Co')).toBeUndefined();
    // An Admin asking for an import that does not exist gets 404.
    expect((await call('admin', 'GET', `/api/v1/imports/${some}`)).status).toBe(404);
  });

  it('rejects files that are not CSV, are malformed, empty or over the row limit', async () => {
    expect((await upload('companies', 'name\nA\n', 'book.xlsx')).status).toBe(400);
    expect((await upload('people', 'name\nA\n')).status).toBe(400);
    const malformed = await upload('companies', 'name,domain\n"Unclosed,x\n');
    expect([malformed.status, malformed.json.code]).toEqual([422, 'IMPORT_FILE_INVALID']);
    const headerOnly = await upload('companies', 'name,domain\r\n');
    expect([headerOnly.status, headerOnly.json.code]).toEqual([422, 'IMPORT_NO_ROWS']);
    const tooMany = await upload('companies', `name\n${Array.from({ length: IMPORT_LIMITS.maxRows + 1 }, (_, i) => `Bulk ${i}`).join('\n')}\n`);
    expect([tooMany.status, tooMany.json.code]).toEqual([422, 'IMPORT_TOO_MANY_ROWS']);
    const binary = await upload('companies', 'PK\u0003\u0004\u0000\u0000');
    expect([binary.status, binary.json.code]).toEqual([422, 'IMPORT_FILE_TYPE']);
    expect(await ctx.db.select().from(importBatch)).toHaveLength(0);
  });

  const COMPANIES_CSV = [
    '﻿Company Name,Domain,Industry,Phone,Owner,Notes',
    'Acme Rockets,acme-rockets.example,Aerospace,555-0101,REP1@test.example,ignored column',
    ',noname.example,,,,', // row 3: invalid — name is required
    'Globex Duplicate,https://www.globex.example/about,,,,', // row 4: duplicate of an existing company (domain)
    'initech,,,,,', // row 5: duplicate of an existing company (name) — may be created anyway
    'Acme Rockets Two,ACME-ROCKETS.example,,,,', // row 6: duplicate inside the file (domain)
    '"Quoted, Inc.",quoted.example,"Multi\nline ""industry""",,nobody@test.example,', // row 7: valid, unknown owner → warning
    `${'L'.repeat(300)},long.example,,,,`, // row 8: invalid — name too long
  ].join('\r\n');

  it('uploads, maps and validates companies without writing any CRM record', async () => {
    const before = {
      companies: await companyCount(),
      audits: await auditCount('company.created'),
      timeline: (await ctx.db.select().from(timelineEvent)).length,
    };
    const up = await upload('companies', COMPANIES_CSV, 'companies-one.csv');
    expect(up.status, up.text).toBe(201);
    ids.batch1 = up.json.id;
    expect(up.json).toMatchObject({ status: 'uploaded', rowCount: 7, entityType: 'companies', mapping: null });
    expect(up.json.headers).toEqual(['Company Name', 'Domain', 'Industry', 'Phone', 'Owner', 'Notes']);
    expect(up.json.suggestedMapping).toEqual(['name', 'domain', 'industry', 'phone', 'ownerEmail', null]);
    expect(up.json.fields.find((f: any) => f.key === 'name').required).toBe(true);

    // Validation and commit are refused until the columns are mapped.
    expect((await call('admin', 'POST', `/api/v1/imports/${ids.batch1}/preview`)).json.code).toBe('IMPORT_NOT_MAPPED');
    expect((await call('admin', 'POST', `/api/v1/imports/${ids.batch1}/commit`, { duplicateStrategy: 'skip' })).json.code).toBe('IMPORT_NOT_VALIDATED');
    // Required fields must be mapped; a field cannot be mapped twice; unknown fields are refused.
    const noName = await call('admin', 'PUT', `/api/v1/imports/${ids.batch1}/mapping`, { mapping: [null, 'domain', null, null, null, null] });
    expect([noName.status, noName.json.code]).toEqual([422, 'IMPORT_REQUIRED_FIELD_UNMAPPED']);
    const twice = await call('admin', 'PUT', `/api/v1/imports/${ids.batch1}/mapping`, { mapping: ['name', 'name', null, null, null, null] });
    expect([twice.status, twice.json.code]).toEqual([422, 'IMPORT_MAPPING_INVALID']);
    const unknown = await call('admin', 'PUT', `/api/v1/imports/${ids.batch1}/mapping`, { mapping: ['name', 'ownerId', null, null, null, null] });
    expect([unknown.status, unknown.json.code]).toEqual([422, 'IMPORT_MAPPING_INVALID']);
    const wrongLength = await call('admin', 'PUT', `/api/v1/imports/${ids.batch1}/mapping`, { mapping: ['name'] });
    expect(wrongLength.status).toBe(422);

    const map = await call('admin', 'PUT', `/api/v1/imports/${ids.batch1}/mapping`, { mapping: up.json.suggestedMapping });
    expect(map.status, map.text).toBe(200);
    const pre = await call('admin', 'POST', `/api/v1/imports/${ids.batch1}/preview`);
    expect(pre.status, pre.text).toBe(200);
    expect(pre.json.status).toBe('validated');
    expect(pre.json.counts).toMatchObject({ total: 7, valid: 2, invalid: 2, duplicate: 3, duplicateCreatable: 1, warnings: 1 });

    const rows = await rowsOf(ids.batch1!);
    const byRow = Object.fromEntries(rows.map((r) => [r.rowNumber, r]));
    expect(byRow[2]).toMatchObject({ status: 'valid', errors: [], duplicate: null });
    expect(byRow[3].status).toBe('invalid');
    expect(byRow[3].errors).toEqual([{ field: 'name', column: 'Company Name', message: 'Company name is required' }]);
    expect(byRow[4]).toMatchObject({ status: 'duplicate', duplicate: { kind: 'existing', existingId: ids.globex, canCreate: false } });
    expect(byRow[5]).toMatchObject({ status: 'duplicate', duplicate: { kind: 'existing', existingId: ids.initech, canCreate: true } });
    expect(byRow[6]).toMatchObject({ status: 'duplicate', duplicate: { kind: 'in_file', firstRowNumber: 2, canCreate: false } });
    expect(byRow[7].status).toBe('valid');
    expect(byRow[7].warnings[0]).toMatchObject({ field: 'ownerEmail', column: 'Owner' });
    expect(byRow[7].mappedData.industry).toBe('Multi\nline "industry"');
    expect(byRow[8].status).toBe('invalid');
    expect(byRow[8].errors[0]).toMatchObject({ field: 'name', column: 'Company Name' });
    expect((await rowsOf(ids.batch1!, 'invalid')).map((r) => r.rowNumber)).toEqual([3, 8]);

    // Downloadable error report: original cells plus the problems, one line per row that is not cleanly valid.
    const report = await call('admin', 'GET', `/api/v1/imports/${ids.batch1}/error-report`);
    expect(report.status).toBe(200);
    expect(report.res.headers.get('content-type')).toContain('text/csv');
    expect(report.res.headers.get('content-disposition')).toContain('companies-one-import-errors.csv');
    const lines = parseCsv(report.text);
    expect(lines[0]).toEqual(['Row', 'Result', 'Problems', 'Company Name', 'Domain', 'Industry', 'Phone', 'Owner', 'Notes']);
    expect(lines.slice(1).map((l) => [l[0], l[1]])).toEqual([
      ['3', 'Invalid'],
      ['4', 'Duplicate'],
      ['5', 'Duplicate'],
      ['6', 'Duplicate'],
      ['7', 'Valid with warnings'],
      ['8', 'Invalid'],
    ]);
    expect(lines[1]![2]).toContain('Company Name: Company name is required');
    expect(lines[2]![2]).toContain('Globex Corporation');
    expect(lines[1]![4]).toBe('noname.example');

    // Nothing has been written to CRM tables yet.
    expect(await companyCount()).toBe(before.companies);
    expect(await auditCount('company.created')).toBe(before.audits);
    expect((await ctx.db.select().from(timelineEvent)).length).toBe(before.timeline);
    expect(await linksOf(ids.batch1!)).toHaveLength(0);
  });

  it('commits valid rows only, skipping duplicates, with the same defaults and audit as manual creation', async () => {
    const before = await companyCount();
    const bad = await call('admin', 'POST', `/api/v1/imports/${ids.batch1}/commit`, { duplicateStrategy: 'merge' });
    expect(bad.status).toBe(400);
    const done = await call('admin', 'POST', `/api/v1/imports/${ids.batch1}/commit`, { duplicateStrategy: 'skip' });
    expect(done.status, done.text).toBe(200);
    expect(done.json).toMatchObject({ status: 'committed', duplicateStrategy: 'skip', counts: { created: 2, skipped: 5, invalid: 2 } });
    expect(await companyCount()).toBe(before + 2);

    const acme = (await companyByName('Acme Rockets'))!;
    expect(acme).toMatchObject({
      domain: 'acme-rockets.example',
      normalizedDomain: 'acme-rockets.example',
      normalizedName: 'acme rockets',
      industry: 'Aerospace',
      phone: '555-0101',
      ownerId: ids.rep1, // mapped owner email (case-insensitive)
      createdBy: ids.admin,
      rowVersion: 1,
      archivedAt: null,
    });
    const quoted = (await companyByName('Quoted, Inc.'))!;
    expect(quoted).toMatchObject({ ownerId: ids.admin, industry: 'Multi\nline "industry"', normalizedDomain: 'quoted.example' }); // unknown owner → importing Admin
    ids.acme = acme.id;
    ids.quoted = quoted.id;
    // Invalid and duplicate rows were never imported.
    for (const name of ['Globex Duplicate', 'initech', 'Acme Rockets Two']) expect(await companyByName(name)).toBeUndefined();
    expect(await ctx.db.select().from(company).where(eq(company.domain, 'noname.example'))).toHaveLength(0);
    expect(await ctx.db.select().from(company).where(eq(company.domain, 'long.example'))).toHaveLength(0);

    // Each record names its batch, and has an audit entry and a timeline entry.
    const links = await linksOf(ids.batch1!);
    expect(links.map((l) => l.recordId).sort()).toEqual([acme.id, quoted.id].sort());
    const audits = await ctx.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'company.created'), eq(auditLog.targetId, acme.id)));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorUserId: ids.admin, targetType: 'company', changes: { source: 'import', importBatchId: ids.batch1, row: 2 } });
    expect(await auditCount('import.committed')).toBe(1);
    const tl = await call('admin', 'GET', `/api/v1/timeline/company/${acme.id}`);
    expect(tl.status).toBe(200);
    expect(JSON.stringify(tl.json)).toContain('Company Acme Rockets imported');
    const outcomes = Object.fromEntries((await rowsOf(ids.batch1!)).map((r) => [r.rowNumber, r.outcome]));
    expect(outcomes).toEqual({ 2: 'created', 3: 'skipped', 4: 'skipped', 5: 'skipped', 6: 'skipped', 7: 'created', 8: 'skipped' });

    // The records are ordinary CRM records: the owner sees his, and the batch shows up in the history.
    expect((await call('rep1', 'GET', `/api/v1/companies/${acme.id}`)).status).toBe(200);
    expect((await call('rep1', 'GET', `/api/v1/companies/${quoted.id}`)).status).toBe(404);
    const list = await call('admin', 'GET', '/api/v1/imports');
    expect(list.json.items[0]).toMatchObject({ id: ids.batch1, status: 'committed', createdByName: 'Ada Admin', counts: { created: 2 } });

    // A committed batch cannot be committed, re-mapped, re-validated or discarded.
    expect((await call('admin', 'POST', `/api/v1/imports/${ids.batch1}/commit`, { duplicateStrategy: 'skip' })).json.code).toBe('IMPORT_ALREADY_COMMITTED');
    expect((await call('admin', 'POST', `/api/v1/imports/${ids.batch1}/preview`)).status).toBe(409);
    expect((await call('admin', 'PUT', `/api/v1/imports/${ids.batch1}/mapping`, { mapping: done.json.mapping })).status).toBe(409);
    expect((await call('admin', 'DELETE', `/api/v1/imports/${ids.batch1}`)).status).toBe(409);
    expect(await companyCount()).toBe(before + 2);
  });

  it('leaves zero partial data when the commit fails half-way, and marks the batch failed with the reason', async () => {
    const csv = 'name,domain\nRollback One,rollback-one.example\nRollback Two,rollback-two.example\nRollback Three,rollback-three.example\nInitech,\n';
    const batch = await validated('companies', csv, 'rollback.csv');
    ids.batch2 = batch.id;
    expect(batch.counts).toMatchObject({ valid: 3, duplicate: 1, duplicateCreatable: 1 });
    const before = {
      companies: await companyCount(),
      audits: await auditCount('company.created'),
      timeline: (await ctx.db.select().from(timelineEvent)).length,
      links: (await ctx.db.select().from(importRecordLink)).length,
    };
    const actor = (await buildUserActor(ctx.db, ids.admin!))!;
    let seen = 0;
    await expect(
      commitBatch(
        ctx,
        actor,
        batch.id,
        { duplicateStrategy: 'create' },
        {
          beforeRecord: () => {
            if (++seen === 3) throw new Error('disk on fire');
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'IMPORT_FAILED' });
    expect(seen).toBe(3); // two records had already been inserted inside the transaction when it failed
    expect(await companyCount()).toBe(before.companies);
    expect(await ctx.db.select().from(company).where(like(company.name, 'Rollback%'))).toHaveLength(0);
    expect(await auditCount('company.created')).toBe(before.audits);
    expect((await ctx.db.select().from(timelineEvent)).length).toBe(before.timeline);
    expect((await ctx.db.select().from(importRecordLink)).length).toBe(before.links);
    const failed = await call('admin', 'GET', `/api/v1/imports/${batch.id}`);
    expect(failed.json).toMatchObject({ status: 'failed', failureReason: 'Row 4: disk on fire' });
    expect(await auditCount('import.failed')).toBe(1);
    expect((await rowsOf(batch.id)).every((r) => r.outcome === 'pending')).toBe(true);
    // A failed batch cannot be committed until it is validated again.
    expect((await call('admin', 'POST', `/api/v1/imports/${batch.id}/commit`, { duplicateStrategy: 'create' })).json.code).toBe('IMPORT_NOT_VALIDATED');

    // After a fresh validation the same batch imports completely — including the name duplicate the Admin chose to create.
    expect((await call('admin', 'POST', `/api/v1/imports/${batch.id}/preview`)).status).toBe(200);
    const done = await call('admin', 'POST', `/api/v1/imports/${batch.id}/commit`, { duplicateStrategy: 'create' });
    expect(done.status, done.text).toBe(200);
    expect(done.json.counts).toMatchObject({ created: 4, skipped: 0 });
    expect(await companyCount()).toBe(before.companies + 4);
    expect(await ctx.db.select().from(company).where(eq(company.normalizedName, 'initech'))).toHaveLength(2);
  });

  it('refuses the commit, importing nothing, when a matching record appeared after the review', async () => {
    const batch = await validated('companies', 'name,domain\nLate Arrival,late-arrival.example\nStill Fine,still-fine.example\n', 'changed.csv');
    expect(batch.counts).toMatchObject({ valid: 2, duplicate: 0 });
    const manual = await call('rep1', 'POST', '/api/v1/companies', { name: 'Late Arrival (manual)', domain: 'late-arrival.example' });
    expect(manual.status).toBe(201);
    const before = await companyCount();
    const r = await call('admin', 'POST', `/api/v1/imports/${batch.id}/commit`, { duplicateStrategy: 'create' });
    expect([r.status, r.json.code, r.json.meta.rows]).toEqual([409, 'IMPORT_TARGET_CHANGED', [2]]);
    expect(await companyCount()).toBe(before);
    expect(await companyByName('Still Fine')).toBeUndefined();
    expect((await batchRow(batch.id)).status).toBe('validated');
    // The Admin validates again, sees the new duplicate, and can discard the batch (file rows only).
    const again = await call('admin', 'POST', `/api/v1/imports/${batch.id}/preview`);
    expect(again.json.counts).toMatchObject({ valid: 1, duplicate: 1, duplicateCreatable: 0 });
    expect((await call('admin', 'DELETE', `/api/v1/imports/${batch.id}`)).status).toBe(200);
    expect((await call('admin', 'GET', `/api/v1/imports/${batch.id}`)).status).toBe(404);
    expect(await ctx.db.select().from(importRow).where(eq(importRow.batchId, batch.id))).toHaveLength(0);
    expect(await companyCount()).toBe(before);
  });

  it('imports contacts: validates emails, resolves the company, detects duplicate emails in the database and in the file', async () => {
    const csv = [
      'First Name,Last Name,Email,Job Title,Company,Owner Email',
      'Wile,Coyote,Wile@Acme-Rockets.example,Chief Tester,acme-rockets.example,rep1@test.example', // row 2 valid (company by domain)
      'Road,Runner,road@acme-rockets.example,,Globex Corporation,', // row 3 valid (company by name)
      'Hank,Again,HANK@globex.example,,,', // row 4 duplicate of an existing contact
      'Wile,Twin,wile@acme-rockets.example,,,', // row 5 duplicate inside the file
      'Bad,Email,not-an-email,,,', // row 6 invalid
      'No,Company,nocompany@x.example,,Nonexistent Corp,', // row 7 invalid — company not found
      ',,,Just a title,,', // row 8 invalid — no name and no email
      'Twin,Company,twin@x.example,,initech,', // row 9 invalid — two companies are named Initech
      'Solo,,,,,', // row 10 valid — no email, no company
    ].join('\n');
    const before = { contacts: await contactCount(), audits: await auditCount('contact.created') };
    const batch = await validated('contacts', csv, 'contacts.csv');
    ids.batch3 = batch.id;
    expect(batch.counts).toMatchObject({ total: 9, valid: 3, invalid: 4, duplicate: 2, duplicateCreatable: 0 });
    const byRow = Object.fromEntries((await rowsOf(batch.id)).map((r) => [r.rowNumber, r]));
    expect(byRow[4].duplicate).toMatchObject({ kind: 'existing', existingId: ids.hank, canCreate: false });
    expect(byRow[5].duplicate).toMatchObject({ kind: 'in_file', firstRowNumber: 2, canCreate: false });
    expect(byRow[6].errors[0]).toMatchObject({ field: 'email', column: 'Email' });
    expect(byRow[7].errors[0]).toMatchObject({ field: 'company', column: 'Company' });
    expect(byRow[7].errors[0].message).toContain('Nonexistent Corp');
    expect(byRow[8].errors[0].message).toBe('Provide a name or an email');
    expect(byRow[9].errors[0].message).toContain('2 companies are named');
    expect(await contactCount()).toBe(before.contacts); // preview wrote nothing

    // "Create anyway" never creates a second contact with the same email (the data model forbids it).
    const done = await call('admin', 'POST', `/api/v1/imports/${batch.id}/commit`, { duplicateStrategy: 'create' });
    expect(done.status, done.text).toBe(200);
    expect(done.json.counts).toMatchObject({ created: 3, skipped: 6 });
    expect(await contactCount()).toBe(before.contacts + 3);
    expect(await auditCount('contact.created')).toBe(before.audits + 3);
    const [wile] = await ctx.db.select().from(contact).where(eq(contact.normalizedEmail, 'wile@acme-rockets.example'));
    expect(wile).toMatchObject({
      firstName: 'Wile',
      lastName: 'Coyote',
      email: 'Wile@Acme-Rockets.example',
      jobTitle: 'Chief Tester',
      companyId: ids.acme,
      ownerId: ids.rep1,
      createdBy: ids.admin,
      source: 'import',
    });
    ids.wile = wile!.id;
    const [road] = await ctx.db.select().from(contact).where(eq(contact.normalizedEmail, 'road@acme-rockets.example'));
    expect(road).toMatchObject({ companyId: ids.globex, ownerId: ids.admin });
    ids.road = road!.id;
    expect(await ctx.db.select().from(contact).where(eq(contact.normalizedEmail, 'hank@globex.example'))).toHaveLength(1);
    expect((await call('rep1', 'GET', `/api/v1/contacts/${wile!.id}`)).status).toBe(200);
  });

  it('imports deals: resolves company and stage by name, validates amount and date, uses the manual-creation defaults', async () => {
    const pipeline = (await call('admin', 'GET', '/api/v1/pipeline')).json;
    const stages: any[] = pipeline.stages ?? pipeline;
    const open = stages.filter((s) => s.kind === 'open');
    const won = stages.find((s) => s.kind === 'won');
    expect(open.length).toBeGreaterThan(1);
    const csv = [
      'Deal Name,Company,Stage,Amount,Close Date,Owner',
      `Rocket skates,Acme Rockets,${open[1].name.toUpperCase()},12500.50,2027-03-31,rep1@test.example`, // row 2 valid
      'Default stage deal,globex.example,,,,', // row 3 valid — first open stage
      'Bad amount,Acme Rockets,,"12,500",,', // row 4 invalid amount
      'Bad date,Acme Rockets,,100,31/03/2027,', // row 5 invalid date
      `Closed deal,Acme Rockets,${won.name},100,,`, // row 6 invalid — closed stage
      'No company,,,,,', // row 7 invalid — company required
      'Unknown stage,Acme Rockets,Nirvana,,,', // row 8 invalid
      'rocket  SKATES,acme-rockets.example,,,,', // row 9 duplicate inside the file (same deal name and company)
    ].join('\n');
    const before = { deals: await dealCount(), audits: await auditCount('deal.created') };
    const batch = await validated('deals', csv, 'deals.csv');
    ids.batch4 = batch.id;
    expect(batch.counts).toMatchObject({ total: 8, valid: 2, invalid: 5, duplicate: 1, duplicateCreatable: 1 });
    const byRow = Object.fromEntries((await rowsOf(batch.id)).map((r) => [r.rowNumber, r]));
    expect(byRow[4].errors[0]).toMatchObject({ field: 'amount', column: 'Amount' });
    expect(byRow[5].errors[0]).toMatchObject({ field: 'closeDate', column: 'Close Date' });
    expect(byRow[6].errors[0].message).toContain('closed stage');
    expect(byRow[7].errors.map((e: any) => e.message)).toContain('Company is required');
    expect(byRow[8].errors[0].message).toContain('Nirvana');
    expect(byRow[9].duplicate).toMatchObject({ kind: 'in_file', firstRowNumber: 2, canCreate: true });
    expect(await dealCount()).toBe(before.deals);

    const done = await call('admin', 'POST', `/api/v1/imports/${batch.id}/commit`, { duplicateStrategy: 'skip' });
    expect(done.status, done.text).toBe(200);
    expect(done.json.counts).toMatchObject({ created: 2, skipped: 6 });
    expect(await dealCount()).toBe(before.deals + 2);
    expect(await auditCount('deal.created')).toBe(before.audits + 2);
    const [skates] = await ctx.db.select().from(deal).where(eq(deal.name, 'Rocket skates'));
    expect(skates).toMatchObject({
      companyId: ids.acme,
      stageId: open[1].id,
      amount: '12500.50',
      closeDate: '2027-03-31',
      currency: 'USD',
      status: 'open',
      ownerId: ids.rep1,
      source: 'import',
      createdBy: ids.admin,
    });
    const [dflt] = await ctx.db.select().from(deal).where(eq(deal.name, 'Default stage deal'));
    expect(dflt).toMatchObject({ companyId: ids.globex, stageId: open[0].id, ownerId: ids.admin, amount: null });
    ids.skates = skates!.id;
    ids.dflt = dflt!.id;
    expect(await ctx.db.select().from(dealStageHistory).where(eq(dealStageHistory.dealId, skates!.id))).toHaveLength(1);
    expect((await call('rep1', 'GET', `/api/v1/deals/${skates!.id}`)).status).toBe(200);
  });

  it('undo removes only what the batch created, and keeps records that were edited or are now referenced', async () => {
    // batch1 created Acme Rockets (now used by an imported contact and an imported deal) and Quoted, Inc. (untouched).
    const preview = await call('admin', 'GET', `/api/v1/imports/${ids.batch1}/undo-preview`);
    expect(preview.status, preview.text).toBe(200);
    expect(preview.json).toMatchObject({ willRemove: 1, willKeep: 1 });
    const acmeItem = preview.json.items.find((i: any) => i.recordId === ids.acme);
    expect(acmeItem).toMatchObject({ outcome: 'kept_referenced', label: 'Acme Rockets' });
    expect(acmeItem.detail).toContain('1 contact');
    expect(acmeItem.detail).toContain('1 deal');
    expect(await companyByName('Quoted, Inc.')).toBeDefined(); // the preview changed nothing

    const before = await companyCount();
    const undone = await call('admin', 'POST', `/api/v1/imports/${ids.batch1}/undo`);
    expect(undone.status, undone.text).toBe(200);
    expect(undone.json).toMatchObject({ status: 'partially_undone', undoReport: { removed: 1, kept: 1 } });
    expect(await companyCount()).toBe(before - 1);
    expect(await companyByName('Quoted, Inc.')).toBeUndefined();
    expect((await call('admin', 'GET', `/api/v1/companies/${ids.quoted}`)).status).toBe(404);
    expect(await companyByName('Acme Rockets')).toBeDefined();
    // Records of other batches and pre-existing records are untouched.
    expect(await ctx.db.select().from(company).where(like(company.name, 'Rollback%'))).toHaveLength(3);
    expect(await companyByName('Globex Corporation')).toBeDefined();
    const deleted = await ctx.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'company.deleted'), eq(auditLog.targetId, ids.quoted!)));
    expect(deleted).toHaveLength(1);
    expect(deleted[0]!.changes).toMatchObject({ reason: 'import_undo', importBatchId: ids.batch1 });
    expect(await auditCount('import.undone')).toBe(1);

    // batch2 (Rollback One/Two/Three + a second Initech): edit one, attach a task to another.
    const one = (await companyByName('Rollback One'))!;
    const two = (await companyByName('Rollback Two'))!;
    const three = (await companyByName('Rollback Three'))!;
    const edit = await call('admin', 'PATCH', `/api/v1/companies/${one.id}`, {
      name: 'Rollback One',
      domain: 'rollback-one.example',
      industry: 'Edited later',
    });
    expect(edit.status, edit.text).toBe(200);
    const task = await call('admin', 'POST', '/api/v1/tasks', {
      title: 'Call them',
      relatedType: 'company',
      relatedId: two.id,
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(task.status, task.text).toBe(201);
    const p2 = await call('admin', 'GET', `/api/v1/imports/${ids.batch2}/undo-preview`);
    expect(p2.json).toMatchObject({ willRemove: 2, willKeep: 2 });
    const u2 = await call('admin', 'POST', `/api/v1/imports/${ids.batch2}/undo`);
    expect(u2.status, u2.text).toBe(200);
    const outcome = Object.fromEntries(u2.json.undoReport.items.map((i: any) => [i.recordId, i.outcome]));
    expect(outcome[one.id]).toBe('kept_modified');
    expect(outcome[two.id]).toBe('kept_referenced');
    expect(outcome[three.id]).toBe('removed');
    expect(await companyByName('Rollback One')).toBeDefined();
    expect(await companyByName('Rollback Two')).toBeDefined();
    expect(await companyByName('Rollback Three')).toBeUndefined();
    // Only the imported "Initech" was removed; the original one is still there.
    const initechs = await ctx.db.select().from(company).where(eq(company.normalizedName, 'initech'));
    expect(initechs.map((c) => c.id)).toEqual([ids.initech]);
    const links = await linksOf(ids.batch2!);
    expect(links.find((l) => l.recordId === one.id)).toMatchObject({ undoOutcome: 'kept_modified', undoDetail: 'Edited after the import' });
  });

  it('undoes deals and contacts completely, after which the company they referenced can be removed too', async () => {
    // A deal that gained a note after the import is kept; the untouched one is removed together with its stage history.
    const note = await call('admin', 'POST', '/api/v1/notes', { relatedType: 'deal', relatedId: ids.dflt, body: 'Spoke to them.' });
    expect(note.status, note.text).toBe(201);
    const ud = await call('admin', 'POST', `/api/v1/imports/${ids.batch4}/undo`);
    expect(ud.status, ud.text).toBe(200);
    expect(ud.json).toMatchObject({ status: 'partially_undone', undoReport: { removed: 1, kept: 1 } });
    expect(await ctx.db.select().from(deal).where(eq(deal.id, ids.skates!))).toHaveLength(0);
    expect(await ctx.db.select().from(dealStageHistory).where(eq(dealStageHistory.dealId, ids.skates!))).toHaveLength(0);
    expect(await ctx.db.select().from(deal).where(eq(deal.id, ids.dflt!))).toHaveLength(1);
    expect(await ctx.db.select().from(dealStageHistory).where(eq(dealStageHistory.dealId, ids.dflt!))).toHaveLength(1);
    expect((await call('admin', 'GET', `/api/v1/deals/${ids.skates}`)).status).toBe(404);

    // Contacts: all three are untouched → fully undone; a second undo is refused.
    const before = await contactCount();
    const uc = await call('admin', 'POST', `/api/v1/imports/${ids.batch3}/undo`);
    expect(uc.status, uc.text).toBe(200);
    expect(uc.json).toMatchObject({ status: 'undone', undoReport: { removed: 3, kept: 0 } });
    expect(await contactCount()).toBe(before - 3);
    expect(await ctx.db.select().from(contact).where(eq(contact.id, ids.hank!))).toHaveLength(1);
    const again = await call('admin', 'POST', `/api/v1/imports/${ids.batch3}/undo`);
    expect([again.status, again.json.code]).toEqual([409, 'IMPORT_ALREADY_UNDONE']);
    expect((await call('admin', 'GET', `/api/v1/imports/${ids.batch3}/undo-preview`)).status).toBe(409);

    // Acme Rockets is no longer referenced (its imported contact and deal are gone), so batch1 can now finish its undo.
    const fin = await call('admin', 'POST', `/api/v1/imports/${ids.batch1}/undo`);
    expect(fin.status, fin.text).toBe(200);
    expect(fin.json).toMatchObject({ status: 'undone', undoReport: { removed: 2, kept: 0 } });
    expect(await companyByName('Acme Rockets')).toBeUndefined();
    // An import that was never committed cannot be undone.
    const fresh = await upload('companies', 'name\nNever Committed\n');
    expect((await call('admin', 'POST', `/api/v1/imports/${fresh.json.id}/undo`)).json.code).toBe('IMPORT_NOT_COMMITTED');
  });
});
