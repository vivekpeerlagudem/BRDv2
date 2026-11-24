/**
 * Weekly Report Agents — public API of the module (prototype, part 1).
 *
 * One run = one company × one week. The steps are plain functions called in order by `runJob`:
 *   Collector (collect.ts) → Matcher (match.ts) → Metrics (metrics.ts) → snapshot file → Narrative (AI, narrative.ts)
 *   → Checks (checks.ts) → draft PPTX (deck.ts). A person then approves and downloads the final PPTX.
 *
 * Dependency direction: workflow.ts imports this file (to schedule runs and to dispatch the `weekly_report.run`
 * job). This file must NOT import workflow.ts — it only needs `unitOfWork().enqueue`, which lives in platform/core.
 */
import { canonicalJson } from '@crm/proposal';
import { and, desc, eq, exists, inArray, isNull, lt, max, sql } from 'drizzle-orm';
import { estimateImport, type WeeklyMetricsDoc, weeklyReportRun } from '../db/schema-weekly-reports.ts';
import { storageKeys } from '../platform/adapters.ts';
import { type AppContext, buildUserActor, conflict, requirePerm, rule, SYSTEM, schema, sha256Hex, type UserActor, unitOfWork } from '../platform/core.ts';
import { isBlocking } from './weekly-reports/checks.ts';
import { collect, type WeeklySnapshot } from './weekly-reports/collect.ts';
import { latestEstimates, loadCompanyFor } from './weekly-reports/estimates.ts';
import { buildWeeklyFacts } from './weekly-reports/facts.ts';
import { matchItems } from './weekly-reports/match.ts';
import { computeMetrics } from './weekly-reports/metrics.ts';
import { storeWeeklyGeneration, writeNarrative } from './weekly-reports/narrative.ts';
import { isDue, lastFullWeek, periodInstants } from './weekly-reports/period.ts';

const { company, organizationSettings, fileObject } = schema;
const STUCK_AFTER_MS = 30 * 60_000;

type Run = typeof weeklyReportRun.$inferSelect;

/**
 * Orchestrator, schedule side: once the weekly run time has passed, queue one run for every company that has an
 * estimates sheet. Safe to call as often as you like — the unique key (company, week, attempt 1) stops duplicates.
 * Also marks runs that have been "running" for over 30 minutes as failed.
 */
export async function scheduleWeeklyReports(ctx: AppContext): Promise<number> {
  const now = ctx.now();
  await ctx.db
    .update(weeklyReportRun)
    .set({ status: 'failed', failureReason: 'STUCK', updatedAt: now, rowVersion: sql`${weeklyReportRun.rowVersion} + 1` })
    .where(and(eq(weeklyReportRun.status, 'running'), lt(weeklyReportRun.updatedAt, new Date(now.getTime() - STUCK_AFTER_MS))));

  const [settings] = await ctx.db
    .select({ timeZone: organizationSettings.timeZone, weekly: organizationSettings.weeklyReportSettings })
    .from(organizationSettings);
  if (!settings?.weekly.enabled || !isDue(now, settings.timeZone, settings.weekly.runWeekday, settings.weekly.runTime)) return 0;
  const period = lastFullWeek(now, settings.timeZone);
  const companies = await ctx.db
    .select({ id: company.id, ownerId: company.ownerId })
    .from(company)
    .where(and(isNull(company.archivedAt), exists(ctx.db.select({ one: sql`1` }).from(estimateImport).where(eq(estimateImport.companyId, company.id)))));
  let queued = 0;
  for (const co of companies) {
    await unitOfWork(ctx, SYSTEM, async (u) => {
      const inserted = await u.tx
        .insert(weeklyReportRun)
        .values({
          companyId: co.id,
          runAsUserId: co.ownerId,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          timeZone: settings.timeZone,
          attempt: 1,
          trigger: 'schedule',
          status: 'queued',
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: weeklyReportRun.id });
      if (!inserted.length) return;
      await u.enqueue('weekly_report.run', { runId: inserted[0]!.id });
      queued++;
    });
  }
  return queued;
}

/** Manual "Generate now": a new attempt for the last full week. The report still runs as the company owner. */
export async function requestWeeklyReport(ctx: AppContext, actor: UserActor, companyId: string) {
  requirePerm(actor, 'weekly_report.manage');
  const co = await loadCompanyFor(ctx.db, actor, companyId, 'write');
  if (co.archivedAt) throw rule('RECORD_ARCHIVED', 'This company is archived');
  if (!(await latestEstimates(ctx.db, companyId))) throw rule('NO_ESTIMATES', 'Upload the estimates sheet for this company first');
  const [settings] = await ctx.db.select({ timeZone: organizationSettings.timeZone }).from(organizationSettings);
  const timeZone = settings?.timeZone ?? 'UTC';
  const now = ctx.now();
  const period = lastFullWeek(now, timeZone);
  const samePeriod = and(eq(weeklyReportRun.companyId, companyId), eq(weeklyReportRun.periodStart, period.periodStart));
  const inProgress = () => conflict('WEEKLY_REPORT_IN_PROGRESS', 'A report for this week is already being generated');
  try {
    return await unitOfWork(ctx, actor, async (u) => {
      const [busy] = await u.tx
        .select({ id: weeklyReportRun.id })
        .from(weeklyReportRun)
        .where(and(samePeriod, inArray(weeklyReportRun.status, ['queued', 'running'])));
      if (busy) throw inProgress();
      const [last] = await u.tx
        .select({ n: max(weeklyReportRun.attempt) })
        .from(weeklyReportRun)
        .where(samePeriod);
      const [run] = await u.tx
        .insert(weeklyReportRun)
        .values({
          companyId,
          runAsUserId: co.ownerId,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          timeZone,
          attempt: (last?.n ?? 0) + 1,
          trigger: 'manual',
          status: 'queued',
          createdAt: now,
          createdBy: actor.userId,
          updatedAt: now,
          updatedBy: actor.userId,
        })
        .returning({ id: weeklyReportRun.id, attempt: weeklyReportRun.attempt });
      await u.audit('weekly_report.requested', { type: 'weekly_report_run', id: run!.id }, { companyId, periodStart: period.periodStart });
      await u.enqueue('weekly_report.run', { runId: run!.id });
      return { id: run!.id, attempt: run!.attempt, periodStart: period.periodStart, periodEnd: period.periodEnd, status: 'queued' as const };
    });
  } catch (error) {
    // Two people clicking at the same moment: the unique key (company, week, attempt) lets only one through.
    if ((error as { code?: string }).code === '23505' || (error as { cause?: { code?: string } }).cause?.code === '23505') throw inProgress();
    throw error;
  }
}

async function failRun(ctx: AppContext, run: Run, reason: string): Promise<void> {
  await ctx.db
    .update(weeklyReportRun)
    .set({ status: 'failed', failureReason: reason, updatedAt: ctx.now(), rowVersion: sql`${weeklyReportRun.rowVersion} + 1` })
    .where(eq(weeklyReportRun.id, run.id));
  ctx.logger.warn({ weeklyReportRunId: run.id, reason }, 'weekly report run failed');
}

/** The latest earlier report for the company: approved if there is one, else the latest that finished. */
async function previousMetrics(ctx: AppContext, run: Run): Promise<WeeklyMetricsDoc | null> {
  const earlier = and(eq(weeklyReportRun.companyId, run.companyId), lt(weeklyReportRun.periodStart, run.periodStart));
  const pick = async (statuses: Run['status'][]) => {
    const [row] = await ctx.db
      .select({ metrics: weeklyReportRun.metrics })
      .from(weeklyReportRun)
      .where(and(earlier, inArray(weeklyReportRun.status, statuses)))
      .orderBy(desc(weeklyReportRun.periodStart), desc(weeklyReportRun.attempt))
      .limit(1);
    return row?.metrics ?? null;
  };
  return (await pick(['approved'])) ?? (await pick(['ready', 'needs_attention']));
}

/** Writes the frozen snapshot write-once. If a retry finds one already stored, the stored one wins. */
async function storeSnapshot(ctx: AppContext, runId: string, snapshot: WeeklySnapshot): Promise<{ snapshot: WeeklySnapshot; bytes: Uint8Array; key: string }> {
  const key = storageKeys.weeklyReportSnapshot(runId);
  const bytes = new TextEncoder().encode(canonicalJson(snapshot));
  try {
    await ctx.storage.put(key, bytes, { contentType: 'application/json', immutable: true });
    return { snapshot, bytes, key };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const stored = await ctx.storage.get(key);
    return { snapshot: JSON.parse(new TextDecoder().decode(stored)) as WeeklySnapshot, bytes: stored, key };
  }
}

/**
 * Job `weekly_report.run`. Idempotent: only a queued or running run is processed, so a retried job continues
 * safely. Expected problems end the run as `failed` with a reason; unexpected errors are rethrown so the job
 * outbox retries with backoff.
 */
export async function runJob(ctx: AppContext, runId: string): Promise<void> {
  const [run] = await ctx.db.select().from(weeklyReportRun).where(eq(weeklyReportRun.id, runId));
  if (!run || (run.status !== 'queued' && run.status !== 'running')) return;
  await ctx.db.update(weeklyReportRun).set({ status: 'running', updatedAt: ctx.now() }).where(eq(weeklyReportRun.id, run.id));

  // The report runs on behalf of the company owner: their scope decides what may be read, and AI use is theirs.
  const owner = await buildUserActor(ctx.db, run.runAsUserId);
  if (!owner) return failRun(ctx, run, 'RUN_AS_USER_INACTIVE');

  // Collector
  const instants = periodInstants(run.periodStart, run.periodEnd, run.timeZone);
  const collected = await collect(ctx, owner, run, instants);
  if (!collected.ok) return failRun(ctx, run, collected.reason);
  const stored = await storeSnapshot(ctx, run.id, collected.snapshot);
  const snapshot = stored.snapshot;

  // Matcher → Metrics
  const matched = matchItems(snapshot.estimates.items, snapshot.tasks);
  const metrics = computeMetrics({
    matched,
    tasks: snapshot.tasks,
    activities: snapshot.activities,
    startInstant: new Date(snapshot.period.startInstant),
    endInstant: new Date(snapshot.period.endInstant),
    previous: await previousMetrics(ctx, run),
  });
  const snapshotSha256 = sha256Hex(stored.bytes);

  // Narrative (AI, on behalf of the owner) → Checks. AI problems end in placeholders, never in a failed run.
  const [org] = await ctx.db.select({ name: organizationSettings.organizationName }).from(organizationSettings);
  const facts = buildWeeklyFacts(snapshot, metrics, org?.name ?? '');
  const written = await writeNarrative(ctx, owner, run, facts);
  const aiGenerationId = written.meta
    ? await storeWeeklyGeneration(ctx, owner, { runId: run.id, companyId: run.companyId, narrative: written.narrative, meta: written.meta, facts })
    : null;
  const mismatches = metrics.items.filter((i) => i.mismatch).length;
  const flags = [
    ...written.flags,
    // Internal notice for the reviewer only: the sheet and the CRM disagree on some rows (the CRM was used).
    ...(mismatches
      ? [{ code: 'STATUS_MISMATCH', statementId: null, message: `${mismatches} scope row(s) differ between the sheet and the CRM; the CRM status was used` }]
      : []),
  ];

  await ctx.db.transaction(async (tx) => {
    const [file] = await tx
      .insert(fileObject)
      .values({
        storageKey: stored.key,
        contentType: 'application/json',
        sizeBytes: stored.bytes.length,
        sha256: snapshotSha256,
        purpose: 'weekly_report_snapshot',
        immutable: true,
      })
      .onConflictDoUpdate({ target: fileObject.storageKey, set: { purpose: 'weekly_report_snapshot' } })
      .returning({ id: fileObject.id });
    await tx
      .update(weeklyReportRun)
      .set({
        estimateImportId: snapshot.estimates.importId,
        snapshotFileId: file!.id,
        snapshotSha256,
        metrics,
        narrative: written.narrative,
        checkFlags: flags,
        aiGenerationId,
        aiFallback: written.aiFallback,
        status: flags.some(isBlocking) ? 'needs_attention' : 'ready',
        updatedAt: ctx.now(),
        rowVersion: sql`${weeklyReportRun.rowVersion} + 1`,
      })
      .where(eq(weeklyReportRun.id, run.id));
  });
}
