import { sql } from 'drizzle-orm';
import { buildContext } from '../composition.ts';
import { loadConfig } from '../config/env.ts';

/** `pnpm db:check` — verifies DATABASE_URL reaches PostgreSQL. Never prints the connection string. */
const { ctx, pool } = buildContext(loadConfig());
try {
  const r = await ctx.db.execute<{ server_version: string }>(sql`show server_version`);
  console.log(`PostgreSQL reachable — server version ${r.rows[0]?.server_version}`);
} catch (error) {
  console.error(`PostgreSQL NOT reachable: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
