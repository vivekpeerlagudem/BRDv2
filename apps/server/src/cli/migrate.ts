import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/**
 * `pnpm db:migrate [--test]` — applies drizzle/*.sql in order using the MIGRATOR role (ADR-030):
 * forward-only, one transaction per file, advisory lock so two runs cannot overlap. Never drops data.
 */
const envFile = fileURLToPath(new URL('../../../../.env.local', import.meta.url));
try {
  process.loadEnvFile(envFile);
} catch {}
const isTest = process.argv.includes('--test');
// TEST_DB_NAME redirects --test to another database with the same credentials (see src/test-db.ts).
const testName = process.env.TEST_DB_NAME;
const testMigrator = process.env.TEST_DATABASE_URL_MIGRATOR;
const url = isTest ? (testMigrator && testName ? testMigrator.replace(/\/[^/?]+(\?.*)?$/, `/${testName}$1`) : testMigrator) : process.env.DATABASE_URL_MIGRATOR;
if (!url) throw new Error(`${isTest ? 'TEST_DATABASE_URL_MIGRATOR' : 'DATABASE_URL_MIGRATOR'} is not set`);

const dir = fileURLToPath(new URL('../../drizzle/', import.meta.url));
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('SELECT pg_advisory_lock(727001)');
  await client.query('CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migration')).rows.map((r) => r.name));
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = readFileSync(dir + file, 'utf8').replaceAll('--> statement-breakpoint', '');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migration (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`applied ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  console.log(`migrations up to date (${files.length} files) on ${isTest ? (testName ?? 'test') : 'dev'} database`);
} finally {
  await client.end();
}
