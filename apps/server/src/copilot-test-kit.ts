/**
 * Shared set-up for the Copilot integration tests: a REAL PostgreSQL test database, the real HTTP app, the mock AI
 * provider injected at the AiProvider port, and a controllable clock. Not a test file itself.
 *
 * Users: admin · manager (manages team East) · rep1 (East) · manager2 (manages team West) · rep2 (West) · rep3 (no team).
 */
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buildContext } from './composition.ts';
import { parseConfig } from './config/env.ts';
import { createApp } from './http/app.ts';
import { bootstrap, insertUser } from './modules/identity.ts';
import { schema } from './platform/core.ts';
import { MockAiProvider } from './platform/mock-ai.ts';
import { testDbMigratorUrl, testDbUrl } from './test-db.ts';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env.local', import.meta.url)));
} catch {}

export const PASSWORD = 'Correct-Horse-Battery-9';
export const ORIGIN = 'http://localhost:5173';
export const hasTestDb = (): boolean => Boolean(testDbUrl());

export interface SseEvent {
  event: string;
  // biome-ignore lint/suspicious/noExplicitAny: test helper reads loosely-typed event payloads
  data: any;
}
export function parseSse(text: string): SseEvent[] {
  const out: SseEvent[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (!data.length) continue;
    let parsed: unknown = data.join('\n');
    try {
      parsed = JSON.parse(data.join('\n'));
    } catch {}
    out.push({ event, data: parsed });
  }
  return out;
}

export function createKit(organizationName: string, opts: { timeZone?: string } = {}) {
  const clock = { now: new Date('2026-11-18T10:00:00.000Z') }; // a Wednesday, 10:00 UTC
  const ai = new MockAiProvider();
  const config = parseConfig({
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    AI_PROVIDER: 'fake',
    DATABASE_URL: testDbUrl(),
    APP_ORIGIN: ORIGIN,
    BUYER_ORIGIN: 'http://proposals.localhost:5173',
    STORAGE_DIR: './.data/test-storage',
  });
  const { ctx, pool, auth } = buildContext(config, { ai, now: () => new Date(clock.now) });
  const app = createApp(ctx, auth);
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  async function raw(who: string | null, method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { origin: ORIGIN, 'content-type': 'application/json' };
    if (who && cookies[who]) headers.cookie = cookies[who] as string;
    return app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async function call(who: string | null, method: string, path: string, body?: unknown) {
    const res = await raw(who, method, `/api/v1${path}`, body);
    const text = await res.text();
    // biome-ignore lint/suspicious/noExplicitAny: test helper
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text, headers: res.headers };
  }
  /** POSTs and reads a text/event-stream answer to the end. */
  async function sse(who: string, path: string, body?: unknown) {
    const res = await raw(who, 'POST', `/api/v1${path}`, body);
    const text = await res.text();
    return { status: res.status, events: parseSse(text), text, contentType: res.headers.get('content-type') ?? '' };
  }
  /** Signs in and stores the session cookie under `key`. The email defaults to <key>@test.example. */
  async function signIn(key: string, email = `${key}@test.example`) {
    const res = await app.request('/auth/sign-in/email', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    if (res.status !== 200) throw new Error(`sign-in failed for ${key}: ${res.status}`);
    cookies[key] = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  }

  /** Empties the test database and creates the organization, two teams and six users. */
  async function reset() {
    const admin = new pg.Client({ connectionString: testDbMigratorUrl() });
    await admin.connect();
    const tables = await admin.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public' and tablename <> 'schema_migration'");
    await admin.query(`truncate ${tables.rows.map((t) => `"${t.tablename}"`).join(',')} restart identity cascade`);
    await admin.end();
    const b = await bootstrap(ctx, {
      organizationName,
      currency: 'USD',
      timeZone: opts.timeZone ?? 'UTC',
      admin: { email: 'admin@test.example', fullName: 'Ada Admin', role: 'admin', password: PASSWORD },
    });
    ids.admin = b.adminId;
    const [east] = await ctx.db.insert(schema.team).values({ name: 'East' }).returning();
    const [west] = await ctx.db.insert(schema.team).values({ name: 'West' }).returning();
    ids.east = east!.id;
    ids.west = west!.id;
    await ctx.db.transaction(async (tx) => {
      ids.manager = await insertUser(tx, { email: 'manager@test.example', fullName: 'Mia Manager', role: 'sales_manager', password: PASSWORD }, null);
      ids.manager2 = await insertUser(tx, { email: 'manager2@test.example', fullName: 'Wes Western', role: 'sales_manager', password: PASSWORD }, null);
      ids.rep1 = await insertUser(tx, { email: 'rep1@test.example', fullName: 'Rae Rep', role: 'salesperson', password: PASSWORD, teamId: east!.id }, null);
      ids.rep2 = await insertUser(tx, { email: 'rep2@test.example', fullName: 'Wil West', role: 'salesperson', password: PASSWORD, teamId: west!.id }, null);
      ids.rep3 = await insertUser(tx, { email: 'rep3@test.example', fullName: 'Sam Solo', role: 'salesperson', password: PASSWORD }, null);
      await tx.insert(schema.teamManager).values({ teamId: east!.id, userId: ids.manager });
      await tx.insert(schema.teamManager).values({ teamId: west!.id, userId: ids.manager2 });
    });
    for (const k of ['admin', 'manager', 'manager2', 'rep1', 'rep2', 'rep3']) await signIn(k);
  }

  return { ctx, pool, auth, app, ai, clock, ids, cookies, call, sse, raw, signIn, reset };
}
export type Kit = ReturnType<typeof createKit>;
