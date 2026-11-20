import { fileURLToPath } from 'node:url';
import pg from 'pg';

/**
 * `pnpm db:reset:dev` — empties BUSINESS data from the dev database so you can start fresh,
 * while keeping configuration & identity (users, teams, pipeline, stages, lost reasons,
 * organization settings, catalogue, proposal templates).
 *
 * Uses the MIGRATOR role (the table owner) because the application role is deliberately
 * barred from deleting the append-only audit/timeline history (tamper-proof audit, ADR-030).
 *
 * `--demo` additionally clears the product catalogue and proposal templates (e.g. left over from e2e runs),
 * so a demo dataset such as e2e/marvel-seed.spec.ts can start from a completely clean slate.
 *
 * SAFETY: refuses to run unless the target database name ends in `_dev` (override with --force),
 * and refuses when NODE_ENV=production. It TRUNCATEs — it does not touch the schema.
 */
try {
  process.loadEnvFile(fileURLToPath(new URL('../../../../.env.local', import.meta.url)));
} catch {}

const url = process.env.DATABASE_URL_MIGRATOR;
if (!url) throw new Error('DATABASE_URL_MIGRATOR is not set (needed to clear append-only history)');
if (process.env.NODE_ENV === 'production') throw new Error('Refusing to run with NODE_ENV=production');

const dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
const force = process.argv.includes('--force');
if (!dbName.endsWith('_dev') && !force) {
  throw new Error(`Refusing to reset database "${dbName}" — name does not end in _dev. Re-run with --force if you really mean it.`);
}

// Business + transactional + append-only tables. Everything NOT listed here is kept.
const BUSINESS_TABLES = [
  'activity_log',
  'ai_generation',
  'ai_review',
  'ai_usage',
  'audit_log',
  'automation_execution',
  'buyer_response',
  'buyer_session',
  'company',
  'contact',
  'deal',
  'deal_contact',
  'deal_flag',
  'deal_stage_history',
  'download_event',
  'esign_webhook_inbox',
  'file_object',
  'import_batch',
  'import_record_link',
  'import_row',
  'job_outbox',
  'lead',
  'lead_form_submission',
  'note',
  'notification',
  'proposal',
  'proposal_version',
  'share_link',
  'signature_event',
  'signature_request',
  'signed_document',
  'signer',
  'task',
  'timeline_event',
  'timeline_event_anchor',
  'view_session',
  'viewer_identity',
];

// Content kept by default; cleared only with --demo.
const CONTENT_TABLES = ['product', 'proposal_template', 'template_version'];
const demo = process.argv.includes('--demo');
const tables = demo ? [...BUSINESS_TABLES, ...CONTENT_TABLES] : BUSINESS_TABLES;

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(`TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
  const count = async (t: string) => (await client.query(`select count(*)::int as n from "${t}"`)).rows[0].n as number;
  console.log(
    `db:reset:dev — "${dbName}" cleared${demo ? ' (demo: catalogue and templates too)' : ''}.\n` +
      `  business now: deals=${await count('deal')} companies=${await count('company')} contacts=${await count('contact')} proposals=${await count('proposal')} audit=${await count('audit_log')}\n` +
      `  kept: users=${await count('auth_user')} stages=${await count('pipeline_stage')} lost_reasons=${await count('lost_reason')} teams=${await count('team')} templates=${await count('proposal_template')}`,
  );
} finally {
  await client.end();
}
