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
import { scopeFor, type weeklyReportApproveInput, type weeklyReportListQuery } from '@crm/shared';
import { and, desc, eq, exists, inArray, isNull, lt, max, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { estimateImport, type WeeklyFlag, type WeeklyMetricsDoc, type WeeklyNarrative, weeklyReportRun } from '../db/schema-weekly-reports.ts';
import { storageKeys } from '../platform/adapters.ts';
import {
  type AppContext,
  buildUserActor,
  canAccessOwner,
  conflict,
  forbidden,
  notFound,
  ownerScope,
  requirePerm,
  rule,
  SYSTEM,
  schema,
  sha256Hex,
  type UserActor,
  unitOfWork,
} from '../platform/core.ts';
import { DomainError } from '../platform/errors/domain-error.ts';
import { FALLBACK_TEXT, isBlocking, SECTION_LABELS, SECTIONS } from './weekly-reports/checks.ts';
import { collect, type WeeklySnapshot } from './weekly-reports/collect.ts';
import { buildDeckModel, deckFileName, PPTX_CONTENT_TYPE, renderWeeklyPptx } from './weekly-reports/deck.ts';
import { latestEstimates, loadCompanyFor } from './weekly-reports/estimates.ts';
import { buildWeeklyFacts } from './weekly-reports/facts.ts';
import { matchItems } from './weekly-reports/match.ts';
import { computeMetrics } from './weekly-reports/metrics.ts';
import { storeWeeklyGeneration, writeNarrative } from './weekly-reports/narrative.ts';
import { isDue, lastFullWeek, periodInstants, periodLabel } from './weekly-reports/period.ts';

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
  const [org] = await ctx.db.select({ name: organizationSettings.organizationName, branding: organizationSettings.branding }).from(organizationSettings);
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

  // PPT builder: the draft deck. Written to storage BEFORE the transaction that records it (a draft may be replaced).
  const draft = await renderWeeklyPptx(
    buildDeckModel({
      draft: true,
      attempt: run.attempt,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      clientName: snapshot.company.name,
      orgName: org?.name ?? '',
      branding: org?.branding ?? { primaryColor: '', footerText: '' },
      metrics,
      narrative: written.narrative,
    }),
  );
  const draftKey = storageKeys.weeklyReportDraftPptx(run.id);
  await ctx.storage.put(draftKey, draft, { contentType: PPTX_CONTENT_TYPE });
  const draftSha256 = sha256Hex(draft);
  const status = flags.some(isBlocking) ? 'needs_attention' : 'ready';

  await unitOfWork(ctx, SYSTEM, async (u) => {
    const [snapshotFile] = await u.tx
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
    const [draftFile] = await u.tx
      .insert(fileObject)
      .values({ storageKey: draftKey, contentType: PPTX_CONTENT_TYPE, sizeBytes: draft.length, sha256: draftSha256, purpose: 'weekly_report_draft_pptx' })
      .onConflictDoUpdate({ target: fileObject.storageKey, set: { sizeBytes: draft.length, sha256: draftSha256 } })
      .returning({ id: fileObject.id });
    await u.tx
      .update(weeklyReportRun)
      .set({
        estimateImportId: snapshot.estimates.importId,
        snapshotFileId: snapshotFile!.id,
        snapshotSha256,
        metrics,
        narrative: written.narrative,
        checkFlags: flags,
        aiGenerationId,
        aiFallback: written.aiFallback,
        draftPptxFileId: draftFile!.id,
        status,
        updatedAt: ctx.now(),
        rowVersion: sql`${weeklyReportRun.rowVersion} + 1`,
      })
      .where(eq(weeklyReportRun.id, run.id));
    await u.timeline({
      eventType: 'weekly_report_draft_ready',
      source: { type: 'weekly_report_run', id: run.id },
      summary: `Weekly report draft ready for ${periodLabel(run.periodStart, run.periodEnd)}${status === 'needs_attention' ? ' — needs attention' : ''}`,
      anchors: [{ type: 'company', id: run.companyId }],
      isAutomated: true,
    });
  });
}

// ───────────── reading, approval and download (all scoped by the company owner) ─────────────
const APPROVABLE: Run['status'][] = ['ready', 'needs_attention'];

/** The run plus its company, or 404 when the actor may not see reports for that company; `write` → 403 VIEW_ONLY. */
async function loadRunFor(ctx: AppContext, actor: UserActor, id: string, access: 'read' | 'write') {
  requirePerm(actor, access === 'read' ? 'weekly_report.view' : 'weekly_report.manage');
  const [row] = await ctx.db
    .select({ run: weeklyReportRun, companyName: company.name, ownerId: company.ownerId })
    .from(weeklyReportRun)
    .innerJoin(company, eq(company.id, weeklyReportRun.companyId))
    .where(eq(weeklyReportRun.id, id));
  if (!row || !canAccessOwner(actor, row.ownerId, 'read', 'companies', 'weekly_report.view')) throw notFound('Weekly report');
  if (access === 'write' && !canAccessOwner(actor, row.ownerId, 'write', 'companies', 'weekly_report.manage'))
    throw forbidden('VIEW_ONLY', 'You can view this report but not change it');
  return row;
}

const hasPlaceholder = (n: WeeklyNarrative | null) => !n || SECTIONS.some((s) => n[s].some((st) => st.origin === 'fallback' || st.text === FALLBACK_TEXT));
/** Why a report cannot be approved yet (empty when it can). Internal notices such as STATUS_MISMATCH do not block. */
function approvalBlockers(run: Run): WeeklyFlag[] {
  const blockers = run.checkFlags.filter(isBlocking);
  if (hasPlaceholder(run.narrative) && !blockers.some((f) => f.code === 'AI_FALLBACK'))
    blockers.push({ code: 'PLACEHOLDER_TEXT', statementId: null, message: 'Some text is still a placeholder' });
  return blockers;
}

const summaryOf = (run: Run, companyName: string) => ({
  id: run.id,
  companyId: run.companyId,
  companyName,
  periodStart: run.periodStart,
  periodEnd: run.periodEnd,
  periodLabel: periodLabel(run.periodStart, run.periodEnd),
  attempt: run.attempt,
  trigger: run.trigger,
  status: run.status,
  health: run.metrics?.health ?? null,
  aiFallback: run.aiFallback,
  flagCount: run.checkFlags.filter(isBlocking).length,
  noticeCount: run.checkFlags.filter((f) => !isBlocking(f)).length,
  hasDraft: run.draftPptxFileId !== null,
  hasFinal: run.status === 'approved',
  approvable: APPROVABLE.includes(run.status) && approvalBlockers(run).length === 0,
  failureReason: run.failureReason,
  approvedAt: run.approvedAt,
  createdAt: run.createdAt,
  rowVersion: run.rowVersion,
});

export async function listWeeklyReports(ctx: AppContext, actor: UserActor, q: z.infer<typeof weeklyReportListQuery>) {
  requirePerm(actor, 'weekly_report.view');
  const rows = await ctx.db
    .select({ run: weeklyReportRun, companyName: company.name })
    .from(weeklyReportRun)
    .innerJoin(company, eq(company.id, weeklyReportRun.companyId))
    .where(
      and(
        ownerScope(actor, company.ownerId, 'companies', 'weekly_report.view'),
        ...(q.companyId ? [eq(weeklyReportRun.companyId, q.companyId)] : []),
        ...(q.status ? [eq(weeklyReportRun.status, q.status)] : []),
      ),
    )
    .orderBy(desc(weeklyReportRun.periodStart), desc(weeklyReportRun.attempt))
    .limit(100);
  return { items: rows.map((r) => summaryOf(r.run, r.companyName)) };
}

/** Labels (and CRM links) for the ids a statement cites, taken from the frozen snapshot. */
function sourceIndex(snapshot: WeeklySnapshot, doc: WeeklyMetricsDoc): Map<string, { label: string; link: string | null }> {
  const index = new Map<string, { label: string; link: string | null }>();
  index.set(`company:${snapshot.company.id}`, { label: snapshot.company.name, link: `/companies/${snapshot.company.id}` });
  index.set('period', { label: periodLabel(snapshot.period.start, snapshot.period.end), link: null });
  for (const m of doc.metrics) index.set(`metric:${m.id}`, { label: `${m.label}: ${m.value ?? 'n/a'}`, link: null });
  for (const i of snapshot.estimates.items) index.set(`scope:${i.id}`, { label: i.scopeId ? `${i.scopeId} · ${i.title}` : i.title, link: null });
  for (const t of snapshot.tasks) index.set(`task:${t.id}`, { label: `Task: ${t.title}`, link: '/tasks' });
  for (const a of snapshot.activities)
    index.set(`activity:${a.id}`, { label: `${a.kind === 'call' ? 'Call' : 'Meeting'} on ${a.occurredAt.slice(0, 10)}`, link: null });
  return index;
}

async function readSnapshot(ctx: AppContext, run: Run): Promise<WeeklySnapshot | null> {
  if (!run.snapshotFileId) return null;
  const bytes = await ctx.storage.get(storageKeys.weeklyReportSnapshot(run.id));
  if (sha256Hex(bytes) !== run.snapshotSha256) throw new DomainError('FILE_INTEGRITY_FAILED', 500, 'The stored report data does not match its fingerprint');
  return JSON.parse(new TextDecoder().decode(bytes)) as WeeklySnapshot;
}

export async function getWeeklyReport(ctx: AppContext, actor: UserActor, id: string) {
  const { run, companyName, ownerId } = await loadRunFor(ctx, actor, id, 'read');
  const snapshot = await readSnapshot(ctx, run);
  const index = snapshot && run.metrics ? sourceIndex(snapshot, run.metrics) : new Map<string, { label: string; link: string | null }>();
  const [generation] = run.aiGenerationId
    ? await ctx.db
        .select({
          id: schema.aiGeneration.id,
          provider: schema.aiGeneration.provider,
          model: schema.aiGeneration.model,
          simulated: schema.aiGeneration.simulated,
          promptVersion: schema.aiGeneration.promptVersion,
          status: schema.aiGeneration.status,
        })
        .from(schema.aiGeneration)
        .where(eq(schema.aiGeneration.id, run.aiGenerationId))
    : [];
  const [approver] = run.approvedBy
    ? await ctx.db.select({ name: schema.appUserProfile.fullName }).from(schema.appUserProfile).where(eq(schema.appUserProfile.userId, run.approvedBy))
    : [];
  const blockers = approvalBlockers(run);
  const canManage = scopeFor(actor.role, 'weekly_report.manage') !== 'none' && canAccessOwner(actor, ownerId, 'write', 'companies', 'weekly_report.manage');
  return {
    ...summaryOf(run, companyName),
    timeZone: run.timeZone,
    approvedByName: approver?.name ?? null,
    finalPptxSha256: run.finalPptxSha256,
    metrics: run.metrics?.metrics ?? [],
    phases: run.metrics?.phases ?? [],
    narrative: run.narrative
      ? SECTIONS.map((section) => ({
          section,
          label: SECTION_LABELS[section],
          statements: run.narrative![section].map((s) => ({
            id: s.id,
            text: s.text,
            origin: s.origin,
            sources: s.sources.map((sid) => ({ id: sid, label: index.get(sid)?.label ?? sid, link: index.get(sid)?.link ?? null })),
          })),
        }))
      : [],
    flags: run.checkFlags,
    blockers,
    ai: generation ?? null,
    permissions: { canManage, canApprove: canManage && APPROVABLE.includes(run.status) && blockers.length === 0 },
  };
}

/**
 * Approval: a person accepts the report. The final deck (no draft label) is rendered and stored write-once BEFORE
 * the transaction; if an earlier attempt already stored it, the stored file wins and its fingerprint is recorded.
 */
export async function approveWeeklyReport(ctx: AppContext, actor: UserActor, id: string, input: z.infer<typeof weeklyReportApproveInput>) {
  const { run } = await loadRunFor(ctx, actor, id, 'write');
  if (!APPROVABLE.includes(run.status)) throw conflict('INVALID_STATE_TRANSITION', 'Only a report that is ready or needs attention can be approved');
  if (input.rowVersion !== run.rowVersion) throw conflict('CONCURRENT_MODIFICATION', 'This report changed since you opened it');
  const blockers = approvalBlockers(run);
  if (blockers.length) throw rule('WEEKLY_REPORT_NOT_APPROVABLE', 'Fix the open points before approving this report', { flags: blockers });
  const snapshot = await readSnapshot(ctx, run);
  if (!snapshot || !run.metrics || !run.narrative) throw rule('WEEKLY_REPORT_NOT_APPROVABLE', 'This report has no content to approve', { flags: [] });
  const [org] = await ctx.db.select({ name: organizationSettings.organizationName, branding: organizationSettings.branding }).from(organizationSettings);

  const rendered = await renderWeeklyPptx(
    buildDeckModel({
      draft: false,
      attempt: run.attempt,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      clientName: snapshot.company.name,
      orgName: org?.name ?? '',
      branding: org?.branding ?? { primaryColor: '', footerText: '' },
      metrics: run.metrics,
      narrative: run.narrative,
    }),
  );
  const key = storageKeys.weeklyReportFinalPptx(run.id);
  let final = rendered;
  try {
    await ctx.storage.put(key, rendered, { contentType: PPTX_CONTENT_TYPE, immutable: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    final = await ctx.storage.get(key); // an earlier approval attempt stored it: that file is the final one
  }
  const finalSha256 = sha256Hex(final);

  return unitOfWork(ctx, actor, async (u) => {
    const [locked] = await u.tx.select().from(weeklyReportRun).where(eq(weeklyReportRun.id, run.id)).for('update');
    if (!locked || !APPROVABLE.includes(locked.status)) throw conflict('INVALID_STATE_TRANSITION', 'This report was already approved or changed');
    if (locked.rowVersion !== input.rowVersion) throw conflict('CONCURRENT_MODIFICATION', 'This report changed since you opened it');
    const now = ctx.now();
    const [file] = await u.tx
      .insert(fileObject)
      .values({
        storageKey: key,
        contentType: PPTX_CONTENT_TYPE,
        sizeBytes: final.length,
        sha256: finalSha256,
        purpose: 'weekly_report_final_pptx',
        immutable: true,
      })
      .onConflictDoUpdate({ target: fileObject.storageKey, set: { purpose: 'weekly_report_final_pptx' } })
      .returning({ id: fileObject.id });
    await u.tx
      .update(weeklyReportRun)
      .set({
        status: 'approved',
        approvedBy: actor.userId,
        approvedAt: now,
        finalPptxFileId: file!.id,
        finalPptxSha256: finalSha256,
        updatedAt: now,
        updatedBy: actor.userId,
        rowVersion: locked.rowVersion + 1,
      })
      .where(eq(weeklyReportRun.id, run.id));
    // The human decision on the AI text (BR-AIA-007): accepted as approved, by this person.
    if (locked.aiGenerationId)
      await u.tx
        .update(schema.aiGeneration)
        .set({ status: 'accepted', acceptedOutput: locked.narrative, decidedBy: actor.userId, decidedAt: now })
        .where(and(eq(schema.aiGeneration.id, locked.aiGenerationId), eq(schema.aiGeneration.status, 'pending')));
    await u.audit(
      'weekly_report.approved',
      { type: 'weekly_report_run', id: run.id },
      { companyId: run.companyId, periodStart: run.periodStart, finalPptxSha256: finalSha256 },
    );
    await u.timeline({
      eventType: 'weekly_report_approved',
      source: { type: 'weekly_report_run', id: run.id },
      summary: `Weekly report approved for ${periodLabel(run.periodStart, run.periodEnd)}`,
      anchors: [{ type: 'company', id: run.companyId }],
    });
    return { id: run.id, status: 'approved' as const, finalPptxSha256: finalSha256, rowVersion: locked.rowVersion + 1 };
  });
}

/** The draft deck (any time after the run finished) or the final deck (only after approval; fingerprint re-checked). */
export async function downloadPptx(ctx: AppContext, actor: UserActor, id: string, kind: 'draft' | 'final') {
  const { run, companyName } = await loadRunFor(ctx, actor, id, 'read');
  if (kind === 'final') {
    if (run.status !== 'approved' || !run.finalPptxSha256) throw notFound('Final report');
    const bytes = await ctx.storage.get(storageKeys.weeklyReportFinalPptx(run.id));
    if (sha256Hex(bytes) !== run.finalPptxSha256) throw new DomainError('FILE_INTEGRITY_FAILED', 500, 'The stored report does not match its fingerprint');
    return { bytes, contentType: PPTX_CONTENT_TYPE, fileName: deckFileName(companyName, run.periodEnd, run.attempt, false) };
  }
  if (!run.draftPptxFileId) throw notFound('Draft report');
  const bytes = await ctx.storage.get(storageKeys.weeklyReportDraftPptx(run.id));
  return { bytes, contentType: PPTX_CONTENT_TYPE, fileName: deckFileName(companyName, run.periodEnd, run.attempt, true) };
}
