/**
 * `pnpm weekly:demo [--company "<name>"]` — one-command demo of the weekly client report on a DEVELOPMENT database.
 *
 * For one company (default: the first non-archived company that has deals) it
 *   1. imports e2e/fixtures/estimates-sample.csv as the company owner (skipped when the latest import is identical),
 *   2. makes sure two CRM tasks exist on the company: "[S-001] …" completed inside last week and "[S-002] …" open
 *      (source "demo_weekly"; never duplicated),
 *   3. requests a weekly report as the owner and runs the jobs until the draft is ready,
 *   4. writes the draft PowerPoint to .data/weekly-demo/ and prints where to open the report.
 * Running it again creates a new version (attempt) of the report. Uses whatever AI provider is configured (the
 * built-in simulator by default). Refuses to run in production.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, asc, eq, exists, isNull, like, sql } from 'drizzle-orm';
import { buildContext } from '../composition.ts';
import { loadConfig } from '../config/env.ts';
import { weeklyReportRun } from '../db/schema-weekly-reports.ts';
import { parseCsv } from '../modules/imports/csv.ts';
import { importEstimatesCsv, latestEstimates, parseEstimateRecords } from '../modules/weekly-reports/estimates.ts';
import { metricValue } from '../modules/weekly-reports/metrics.ts';
import { lastFullWeek, periodInstants } from '../modules/weekly-reports/period.ts';
import { downloadPptx, requestWeeklyReport } from '../modules/weekly-reports.ts';
import { runDueJobs } from '../modules/workflow.ts';
import { StubPdfRenderer } from '../platform/adapters.ts';
import { buildUserActor, schema } from '../platform/core.ts';

const config = loadConfig();
if (config.NODE_ENV === 'production') throw new Error('weekly:demo creates demo records and must not run in production.');

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const FIXTURE = 'estimates-sample.csv';
const SOURCE = 'demo_weekly';
const DEMO_TASKS = [
  { tag: '[S-001]', title: '[S-001] Requirements workshop and sign-off', done: true },
  { tag: '[S-002]', title: '[S-002] Solution design document', done: false },
];
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1]?.trim() : undefined;
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const { ctx, pool } = buildContext({ ...config, LOG_LEVEL: 'warn' }, { pdf: new StubPdfRenderer() });
try {
  const { company, deal, task, organizationSettings } = schema;

  // --- Company and its owner -----------------------------------------------------------------------------------------
  const wanted = arg('--company');
  const hasDeals = exists(ctx.db.select({ one: sql`1` }).from(deal).where(eq(deal.companyId, company.id)));
  const [co] = await ctx.db
    .select({ id: company.id, name: company.name, ownerId: company.ownerId })
    .from(company)
    .where(and(isNull(company.archivedAt), wanted ? sql`lower(${company.name}) = lower(${wanted})` : hasDeals))
    .orderBy(asc(company.name))
    .limit(1);
  if (!co) throw new Error(wanted ? `No active company is named "${wanted}".` : 'No active company with deals was found. Pass --company "<name>".');
  const owner = await buildUserActor(ctx.db, co.ownerId);
  if (!owner) throw new Error(`The owner of ${co.name} is not an active user; reassign the company first.`);

  // --- Estimates sheet (skipped when the latest import already has exactly these rows) -----------------------------------
  const text = await readFile(join(root, 'e2e', 'fixtures', FIXTURE), 'utf8');
  const rowKey = (r: { scopeId: string | null; title: string; phase: string | null; estimateHours: string; sheetStatus: string | null }) =>
    [r.scopeId, r.title, r.phase, Number(r.estimateHours), r.sheetStatus].join('|');
  const fixtureRows = parseEstimateRecords(parseCsv(text, { maxRecords: 5000 })).rows.map(rowKey);
  const latest = await latestEstimates(ctx.db, co.id);
  const identical = latest !== null && latest.items.length === fixtureRows.length && latest.items.every((item, i) => rowKey(item) === fixtureRows[i]);
  if (!identical) await importEstimatesCsv(ctx, owner, co.id, { fileName: FIXTURE, text });

  // --- CRM tasks that carry the progress (created once) ----------------------------------------------------------------
  const [settings] = await ctx.db.select({ timeZone: organizationSettings.timeZone }).from(organizationSettings);
  const timeZone = settings?.timeZone ?? 'UTC';
  const now = ctx.now();
  const week = lastFullWeek(now, timeZone);
  const { startInstant } = periodInstants(week.periodStart, week.periodEnd, timeZone);
  const midWeek = new Date(startInstant.getTime() + 3 * 86_400_000); // Thursday of the reported week
  let tasksCreated = 0;
  for (const demo of DEMO_TASKS) {
    const [found] = await ctx.db
      .select({ id: task.id })
      .from(task)
      .where(and(eq(task.relatedType, 'company'), eq(task.relatedId, co.id), like(task.title, `${demo.tag}%`)))
      .limit(1);
    if (found) continue;
    await ctx.db.insert(task).values({
      title: demo.title,
      relatedType: 'company',
      relatedId: co.id,
      assigneeId: co.ownerId,
      dueAt: demo.done ? midWeek : new Date(now.getTime() + 3 * 86_400_000),
      status: demo.done ? 'completed' : 'open',
      completedAt: demo.done ? midWeek : null,
      source: SOURCE,
      createdAt: demo.done ? startInstant : now,
      createdBy: co.ownerId,
      updatedAt: demo.done ? midWeek : now,
      updatedBy: co.ownerId,
    });
    tasksCreated++;
  }

  // --- Report: request as the owner, run the jobs until the draft is there -------------------------------------------
  const requested = await requestWeeklyReport(ctx, owner, co.id);
  const current = async () => (await ctx.db.select().from(weeklyReportRun).where(eq(weeklyReportRun.id, requested.id)))[0];
  let run = await current();
  for (let i = 0; i < 60 && run && (run.status === 'queued' || run.status === 'running'); i++) {
    await runDueJobs(ctx);
    run = await current();
    if (run?.status === 'queued' || run?.status === 'running') await sleep(500); // a running dev server may have taken the job
  }
  if (!run || (run.status !== 'ready' && run.status !== 'needs_attention'))
    throw new Error(`The report did not become ready (status: ${run?.status ?? 'missing'}${run?.failureReason ? `, ${run.failureReason}` : ''}).`);

  // --- Draft PowerPoint to .data/weekly-demo/ --------------------------------------------------------------------------
  const draft = await downloadPptx(ctx, owner, run.id, 'draft');
  const outDir = join(root, '.data', 'weekly-demo');
  await mkdir(outDir, { recursive: true });
  const file = join(outDir, draft.fileName);
  await writeFile(file, draft.bytes);

  const doc = run.metrics;
  console.log(
    [
      'Weekly report demo',
      `  Company       ${co.name} (report runs as its owner)`,
      `  Week          ${run.periodStart} to ${run.periodEnd}, version ${run.attempt}`,
      `  Estimates     ${identical ? 'unchanged (latest import is identical)' : `imported ${FIXTURE} (${fixtureRows.length} rows)`}`,
      `  Demo tasks    ${tasksCreated ? `${tasksCreated} created` : 'already there'}`,
      `  Run id        ${run.id}`,
      `  Status        ${run.status}${run.aiFallback ? ' (AI fallback: placeholder text)' : ''}`,
      `  Health        ${doc?.health.level ?? 'n/a'}`,
      `  % complete    ${doc ? `${metricValue(doc, 'E-05') ?? '0.0'}%` : 'n/a'}`,
      `  Draft file    ${file}`,
      `  Report URL    ${config.APP_ORIGIN.replace(/\/$/, '')}/weekly-reports/${run.id}`,
    ].join('\n'),
  );
} finally {
  await pool.end();
}
