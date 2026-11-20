/**
 * `pnpm --filter @crm/server bootstrap:admin` — first-time setup of a PRODUCTION database: creates the organization,
 * the default pipeline and ONE admin user, with no demo data. Refuses to run on a database that is already set up.
 *
 * Reads from the environment (never from code):
 *   ORG_NAME (default "Kensium") · ORG_CURRENCY (default USD) · ORG_TIME_ZONE (default America/New_York)
 *   ADMIN_EMAIL · ADMIN_NAME · ADMIN_PASSWORD (at least 12 characters)
 * Unset ADMIN_PASSWORD from the service after the first run.
 */
import { buildContext } from '../composition.ts';
import { loadConfig } from '../config/env.ts';
import { bootstrap } from '../modules/identity.ts';
import { StubPdfRenderer } from '../platform/adapters.ts';
import { schema } from '../platform/core.ts';

const email = process.env.ADMIN_EMAIL?.trim();
const fullName = process.env.ADMIN_NAME?.trim();
const password = process.env.ADMIN_PASSWORD;
if (!email || !fullName || !password) throw new Error('Set ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD before running bootstrap:admin');
if (password.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters');

const config = loadConfig();
const { ctx, pool } = buildContext({ ...config, LOG_LEVEL: 'warn' }, { pdf: new StubPdfRenderer() });
try {
  const [existing] = await ctx.db.select({ id: schema.organizationSettings.id }).from(schema.organizationSettings);
  if (existing) {
    console.log('Database is already set up — nothing changed.');
  } else {
    await bootstrap(ctx, {
      organizationName: process.env.ORG_NAME?.trim() || 'Kensium',
      currency: process.env.ORG_CURRENCY?.trim() || 'USD',
      timeZone: process.env.ORG_TIME_ZONE?.trim() || 'America/New_York',
      admin: { email, fullName, role: 'admin', password },
    });
    console.log(`Organization created with admin ${email}. You can now sign in; remove ADMIN_PASSWORD from the environment.`);
  }
} finally {
  await pool.end();
}
