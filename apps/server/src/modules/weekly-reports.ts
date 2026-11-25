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
import {
  scopeFor,
  type weeklyNarrativeUpdateInput,
  type weeklyReportApproveInput,
  type weeklyReportListQuery,
  type weeklyReportSettingsInput,
} from '@crm/shared';
import { and, desc, eq, exists, ilike, inArray, isNull, lt, max, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  clientEstimateSource,
  estimateImport,
  type WeeklyFlag,
  type WeeklyMetricsDoc,
  type WeeklyNarrative,
  weeklyReportRun,
} from '../db/schema-weekly-reports.ts';
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
  type Uow,
  type UserActor,
  unitOfWork,
} from '../platform/core.ts';
import { DomainError } from '../platform/errors/domain-error.ts';
import { sanitizeText } from './ai/context.ts';
import { checkNarrative, FALLBACK_TEXT, isBlocking, isWarning, SECTION_LABELS, SECTIONS } from './weekly-reports/checks.ts';
import { collect, type WeeklySnapshot } from './weekly-reports/collect.ts';
import { buildDeckModel, deckFileName, PPTX_CONTENT_TYPE, renderWeeklyPptx, resolveTemplateKey, WEEKLY_TEMPLATES } from './weekly-reports/deck.ts';
import { googleEstimatesActive, latestEstimates, linkedSheet, loadCompanyFor, syncLinkedSheet } from './weekly-reports/estimates.ts';
import { allowedSourceIds, buildWeeklyFacts } from './weekly-reports/facts.ts';
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
    .where(
      and(
        isNull(company.archivedAt),
        or(
          exists(ctx.db.select({ one: sql`1` }).from(estimateImport).where(eq(estimateImport.companyId, company.id))),
          ...(googleEstimatesActive(ctx)
            ? [exists(ctx.db.select({ one: sql`1` }).from(clientEstimateSource).where(eq(clientEstimateSource.companyId, company.id)))]
            : []),
        ),
      ),
    );
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
  const hasLinkedSheet = googleEstimatesActive(ctx) && (await linkedSheet(ctx.db, companyId)) !== null;
  if (!hasLinkedSheet && !(await latestEstimates(ctx.db, companyId))) throw rule('NO_ESTIMATES', 'Upload the estimates sheet for this company first');
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
export async function runJob(ctx: AppContext, runId: string, hooks: RunHooks = {}): Promise<void> {
  const extraFlags: WeeklyFlag[] = [];
  const [run] = await ctx.db.select().from(weeklyReportRun).where(eq(weeklyReportRun.id, runId));
  if (!run || (run.status !== 'queued' && run.status !== 'running')) return;
  await ctx.db.update(weeklyReportRun).set({ status: 'running', updatedAt: ctx.now() }).where(eq(weeklyReportRun.id, run.id));

  // The report runs on behalf of the company owner: their scope decides what may be read, and AI use is theirs.
  const owner = await buildUserActor(ctx.db, run.runAsUserId);
  if (!owner) return failRun(ctx, run, 'RUN_AS_USER_INACTIVE');

  // Estimates from Google Sheets (only when switched on and a sheet is linked): refresh before collecting.
  // A failed sync does not stop the report: the latest import is used and the reviewer is warned.
  if (googleEstimatesActive(ctx) && (await linkedSheet(ctx.db, run.companyId))) {
    try {
      await syncLinkedSheet(ctx, SYSTEM, run.companyId, run.runAsUserId);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      extraFlags.push({
        code: 'ESTIMATES_SYNC_FAILED',
        statementId: null,
        level: 'warning',
        message: `The Google Sheet could not be read (${error.code}); the latest imported estimates were used`,
      });
    }
  }

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
  await draftAndStore(ctx, run, owner, snapshot, metrics, { stored, extraFlags, hooks });
}

/**
 * Job `weekly_report.redraft` ("Regenerate"): redoes Narrative → Checks → draft deck from the STORED snapshot and
 * metrics — nothing is collected again, so the figures stay exactly as they were. All current text is replaced.
 */
export async function redraftJob(ctx: AppContext, runId: string, hooks: RunHooks = {}): Promise<void> {
  const [run] = await ctx.db.select().from(weeklyReportRun).where(eq(weeklyReportRun.id, runId));
  if (!run || (run.status !== 'queued' && run.status !== 'running')) return;
  await ctx.db.update(weeklyReportRun).set({ status: 'running', updatedAt: ctx.now() }).where(eq(weeklyReportRun.id, run.id));
  const owner = await buildUserActor(ctx.db, run.runAsUserId);
  if (!owner) return failRun(ctx, run, 'RUN_AS_USER_INACTIVE');
  const snapshot = await readSnapshot(ctx, run);
  if (!snapshot || !run.metrics) return failRun(ctx, run, 'NO_SNAPSHOT');
  await draftAndStore(ctx, run, owner, snapshot, run.metrics, {
    stored: null,
    extraFlags: run.checkFlags.filter((f) => KEPT_ON_REDRAFT.includes(f.code)),
    hooks,
  });
}

/** Called inside the final transaction of a run, so follow-up work (a notification) commits or rolls back with it. */
export interface RunHooks {
  onDraftReady?: (u: Uow, info: { run: Run; clientName: string; status: 'ready' | 'needs_attention' }) => Promise<void>;
}
/** Flags that describe the data, not the text: they survive a redraft and an edit. */
const KEPT_ON_REDRAFT = ['ESTIMATES_SYNC_FAILED'];

/** Check flags for a narrative: text checks, a placeholder marker, and the internal data notices. */
function composeFlags(
  narrative: WeeklyNarrative,
  facts: unknown,
  metrics: WeeklyMetricsDoc,
  extra: WeeklyFlag[],
  fallbackFlags: WeeklyFlag[] = [],
): WeeklyFlag[] {
  const mismatches = metrics.items.filter((i) => i.mismatch).length;
  const checks = checkNarrative(narrative, facts);
  const placeholder = hasPlaceholder(narrative) && !fallbackFlags.some((f) => f.code === 'AI_FALLBACK');
  return [
    ...fallbackFlags,
    ...checks,
    ...(placeholder ? [{ code: 'PLACEHOLDER_TEXT', statementId: null, message: 'Some text is still a placeholder: write it before sending' }] : []),
    ...extra,
    // Internal notice for the reviewer only: the sheet and the CRM disagree on some rows (the CRM was used).
    ...(mismatches
      ? [{ code: 'STATUS_MISMATCH', statementId: null, message: `${mismatches} scope row(s) differ between the sheet and the CRM; the CRM status was used` }]
      : []),
  ];
}

const orgOf = async (ctx: AppContext) => {
  const [org] = await ctx.db
    .select({ name: organizationSettings.organizationName, branding: organizationSettings.branding, weekly: organizationSettings.weeklyReportSettings })
    .from(organizationSettings);
  return {
    name: org?.name ?? '',
    branding: org?.branding ?? { primaryColor: '', footerText: '' },
    templateKey: resolveTemplateKey(org?.weekly?.templateKey),
  };
};
const draftDeck = (
  run: Run,
  snapshot: WeeklySnapshot,
  org: Awaited<ReturnType<typeof orgOf>>,
  metrics: WeeklyMetricsDoc,
  narrative: WeeklyNarrative,
  draft = true,
) =>
  renderWeeklyPptx(
    buildDeckModel({
      draft,
      attempt: run.attempt,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      clientName: snapshot.company.name,
      orgName: org.name,
      branding: org.branding,
      metrics,
      narrative,
    }),
    org.templateKey,
  );

/** Narrative (AI) → Checks → draft deck → one transaction that records everything. Shared by a run and a redraft. */
async function draftAndStore(
  ctx: AppContext,
  run: Run,
  owner: UserActor,
  snapshot: WeeklySnapshot,
  metrics: WeeklyMetricsDoc,
  opts: { stored: { key: string; bytes: Uint8Array } | null; extraFlags: WeeklyFlag[]; hooks: RunHooks },
): Promise<void> {
  // Narrative (AI, on behalf of the owner) → Checks. AI problems end in placeholders, never in a failed run.
  const org = await orgOf(ctx);
  const facts = buildWeeklyFacts(snapshot, metrics, org.name);
  const written = await writeNarrative(ctx, owner, run, facts);
  const aiGenerationId = written.meta
    ? await storeWeeklyGeneration(ctx, owner, { runId: run.id, companyId: run.companyId, narrative: written.narrative, meta: written.meta, facts })
    : null;
  const flags = composeFlags(written.narrative, facts.facts, metrics, opts.extraFlags, written.flags);

  // PPT builder: the draft deck. Written to storage BEFORE the transaction that records it (a draft may be replaced).
  const draft = await draftDeck(run, snapshot, org, metrics, written.narrative);
  const draftKey = storageKeys.weeklyReportDraftPptx(run.id);
  await ctx.storage.put(draftKey, draft, { contentType: PPTX_CONTENT_TYPE });
  const draftSha256 = sha256Hex(draft);
  const status = flags.some(isBlocking) ? 'needs_attention' : 'ready';

  await unitOfWork(ctx, SYSTEM, async (u) => {
    const snapshotFields: Partial<typeof weeklyReportRun.$inferInsert> = {};
    if (opts.stored) {
      const snapshotSha256 = sha256Hex(opts.stored.bytes);
      const [snapshotFile] = await u.tx
        .insert(fileObject)
        .values({
          storageKey: opts.stored.key,
          contentType: 'application/json',
          sizeBytes: opts.stored.bytes.length,
          sha256: snapshotSha256,
          purpose: 'weekly_report_snapshot',
          immutable: true,
        })
        .onConflictDoUpdate({ target: fileObject.storageKey, set: { purpose: 'weekly_report_snapshot' } })
        .returning({ id: fileObject.id });
      Object.assign(snapshotFields, { estimateImportId: snapshot.estimates.importId, snapshotFileId: snapshotFile!.id, snapshotSha256, metrics });
    }
    const [draftFile] = await u.tx
      .insert(fileObject)
      .values({ storageKey: draftKey, contentType: PPTX_CONTENT_TYPE, sizeBytes: draft.length, sha256: draftSha256, purpose: 'weekly_report_draft_pptx' })
      .onConflictDoUpdate({ target: fileObject.storageKey, set: { sizeBytes: draft.length, sha256: draftSha256 } })
      .returning({ id: fileObject.id });
    // A redraft replaces the earlier AI text: its undecided generation is no longer the one in use.
    if (run.aiGenerationId)
      await u.tx
        .update(schema.aiGeneration)
        .set({ status: 'discarded', decidedAt: ctx.now() })
        .where(and(eq(schema.aiGeneration.id, run.aiGenerationId), eq(schema.aiGeneration.status, 'pending')));
    await u.tx
      .update(weeklyReportRun)
      .set({
        ...snapshotFields,
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
    await opts.hooks.onDraftReady?.(u, { run, clientName: snapshot.company.name, status });
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
  if (hasPlaceholder(run.narrative) && !blockers.some((f) => f.code === 'AI_FALLBACK' || f.code === 'PLACEHOLDER_TEXT'))
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
  warningCount: run.checkFlags.filter(isWarning).length,
  noticeCount: run.checkFlags.filter((f) => !isBlocking(f) && !isWarning(f)).length,
  hasDraft: run.draftPptxFileId !== null,
  hasFinal: run.status === 'approved',
  approvable: APPROVABLE.includes(run.status) && approvalBlockers(run).length === 0,
  failureReason: run.failureReason,
  approvedAt: run.approvedAt,
  createdAt: run.createdAt,
  updatedAt: run.updatedAt,
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
        ...(q.q ? [ilike(company.name, `%${q.q.replace(/[%_]/g, '')}%`)] : []),
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
    warnings: run.checkFlags.filter(isWarning),
    /** Text can be edited or regenerated while the report is not approved and no run is in progress. */
    editable: canManage && APPROVABLE.includes(run.status),
    /** What an added sentence may cite: the facts the AI was given, with readable labels. */
    allowedSources:
      snapshot && run.metrics && canManage
        ? [...allowedSourceIds(buildWeeklyFacts(snapshot, run.metrics, '').facts)].map((sid) => ({ id: sid, label: index.get(sid)?.label ?? sid }))
        : [],
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
  // Warnings (for example a figure a person typed that is not in the report data) need an explicit acknowledgement.
  const warnings = run.checkFlags.filter(isWarning);
  if (warnings.length && input.acknowledgeWarnings !== true)
    throw rule('WEEKLY_REPORT_NOT_APPROVABLE', 'Confirm that you checked the flagged figures before approving', {
      flags: warnings,
      needsAcknowledgement: true,
    });
  const snapshot = await readSnapshot(ctx, run);
  if (!snapshot || !run.metrics || !run.narrative) throw rule('WEEKLY_REPORT_NOT_APPROVABLE', 'This report has no content to approve', { flags: [] });
  const edited = SECTIONS.some((s) => run.narrative?.[s].some((st) => st.origin === 'user'));

  const rendered = await draftDeck(run, snapshot, await orgOf(ctx), run.metrics, run.narrative, false);
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
    // The human decision on the AI text (BR-AIA-007): accepted as written, or accepted after a person edited it.
    if (locked.aiGenerationId)
      await u.tx
        .update(schema.aiGeneration)
        .set({ status: edited ? 'edited_accepted' : 'accepted', acceptedOutput: locked.narrative, decidedBy: actor.userId, decidedAt: now })
        .where(and(eq(schema.aiGeneration.id, locked.aiGenerationId), eq(schema.aiGeneration.status, 'pending')));
    await u.audit(
      'weekly_report.approved',
      { type: 'weekly_report_run', id: run.id },
      { companyId: run.companyId, periodStart: run.periodStart, finalPptxSha256: finalSha256, edited, acknowledgedWarnings: warnings.map((w) => w.code) },
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

const NOT_EDITABLE = (status: Run['status']) =>
  status === 'queued' || status === 'running'
    ? conflict('WEEKLY_REPORT_IN_PROGRESS', 'This report is being generated')
    : rule('WEEKLY_REPORT_NOT_EDITABLE', status === 'approved' ? 'An approved report can no longer be changed' : 'This report cannot be changed');

/**
 * A person edits the report text: change sentences, add sentences (citing facts of this report) or remove them.
 * Placeholders may be replaced, which is how a report that fell back from AI becomes approvable. The checks run
 * again and the draft deck is re-rendered (before the transaction) with the new text.
 */
export async function updateNarrative(ctx: AppContext, actor: UserActor, id: string, input: z.infer<typeof weeklyNarrativeUpdateInput>) {
  const { run } = await loadRunFor(ctx, actor, id, 'write');
  if (!APPROVABLE.includes(run.status)) throw NOT_EDITABLE(run.status);
  if (input.rowVersion !== run.rowVersion) throw conflict('CONCURRENT_MODIFICATION', 'This report changed since you opened it');
  const snapshot = await readSnapshot(ctx, run);
  if (!snapshot || !run.metrics || !run.narrative) throw rule('WEEKLY_REPORT_NOT_EDITABLE', 'This report has no text to edit');
  const org = await orgOf(ctx);
  const facts = buildWeeklyFacts(snapshot, run.metrics, org.name).facts;
  const allowed = allowedSourceIds(facts);

  const narrative = Object.fromEntries(SECTIONS.map((s) => [s, run.narrative![s].map((st) => ({ ...st }))])) as WeeklyNarrative;
  const all = () => SECTIONS.flatMap((s) => narrative[s]);
  const removed = new Set(input.removed ?? []);
  for (const rid of removed) if (!all().some((st) => st.id === rid)) throw rule('STATEMENT_NOT_FOUND', 'A sentence to remove is no longer in this report');
  let edited = 0;
  for (const change of input.statements ?? []) {
    const target = all().find((st) => st.id === change.id);
    if (!target) throw rule('STATEMENT_NOT_FOUND', 'A sentence to change is no longer in this report');
    const text = sanitizeText(change.text, 600);
    if (!text) throw rule('STATEMENT_EMPTY', 'A sentence cannot be empty');
    if (text === target.text) continue;
    target.text = text;
    target.origin = 'user';
    edited++;
  }
  for (const s of SECTIONS) narrative[s] = narrative[s].filter((st) => !removed.has(st.id));
  let next = Math.max(0, ...SECTIONS.flatMap((s) => run.narrative![s]).map((st) => Number(st.id.replace(/\D/g, '')) || 0));
  for (const add of input.added ?? []) {
    const text = sanitizeText(add.text, 600);
    if (!text) throw rule('STATEMENT_EMPTY', 'A sentence cannot be empty');
    const sources = [...new Set(add.sources)];
    if (sources.some((sid) => !allowed.has(sid))) throw rule('UNKNOWN_SOURCE', 'A chosen source is not part of this report');
    narrative[add.section].push({ id: `s${++next}`, text, sources, origin: 'user' });
  }

  const flags = composeFlags(
    narrative,
    facts,
    run.metrics,
    run.checkFlags.filter((f) => KEPT_ON_REDRAFT.includes(f.code)),
  );
  const status = flags.some(isBlocking) ? 'needs_attention' : 'ready';
  const draft = await draftDeck(run, snapshot, org, run.metrics, narrative);
  const draftKey = storageKeys.weeklyReportDraftPptx(run.id);
  await ctx.storage.put(draftKey, draft, { contentType: PPTX_CONTENT_TYPE });
  const draftSha256 = sha256Hex(draft);

  return unitOfWork(ctx, actor, async (u) => {
    const [locked] = await u.tx.select().from(weeklyReportRun).where(eq(weeklyReportRun.id, run.id)).for('update');
    if (!locked || !APPROVABLE.includes(locked.status)) throw NOT_EDITABLE(locked?.status ?? 'failed');
    if (locked.rowVersion !== input.rowVersion) throw conflict('CONCURRENT_MODIFICATION', 'This report changed since you opened it');
    await u.tx
      .insert(fileObject)
      .values({ storageKey: draftKey, contentType: PPTX_CONTENT_TYPE, sizeBytes: draft.length, sha256: draftSha256, purpose: 'weekly_report_draft_pptx' })
      .onConflictDoUpdate({ target: fileObject.storageKey, set: { sizeBytes: draft.length, sha256: draftSha256 } });
    await u.tx
      .update(weeklyReportRun)
      .set({ narrative, checkFlags: flags, status, updatedAt: ctx.now(), updatedBy: actor.userId, rowVersion: locked.rowVersion + 1 })
      .where(eq(weeklyReportRun.id, run.id));
    await u.audit(
      'weekly_report.edited',
      { type: 'weekly_report_run', id: run.id },
      { edited, added: input.added?.length ?? 0, removed: removed.size, status }, // counts only — never the text
    );
    return { id: run.id, status, rowVersion: locked.rowVersion + 1, flagCount: flags.filter(isBlocking).length, warningCount: flags.filter(isWarning).length };
  });
}

/**
 * "Regenerate": queue a redraft of the text from the stored snapshot. Everything currently written — including
 * a person's edits — is replaced. Only for a report that is not approved and not already being generated.
 */
export async function regenerateNarrative(ctx: AppContext, actor: UserActor, id: string) {
  const { run } = await loadRunFor(ctx, actor, id, 'write');
  return unitOfWork(ctx, actor, async (u) => {
    const [locked] = await u.tx.select().from(weeklyReportRun).where(eq(weeklyReportRun.id, run.id)).for('update');
    if (!locked || !APPROVABLE.includes(locked.status)) throw NOT_EDITABLE(locked?.status ?? 'failed');
    if (!locked.snapshotFileId) throw rule('WEEKLY_REPORT_NOT_EDITABLE', 'This report has no stored data to regenerate from');
    const now = ctx.now();
    await u.tx
      .update(weeklyReportRun)
      .set({ status: 'queued', updatedAt: now, updatedBy: actor.userId, rowVersion: locked.rowVersion + 1 })
      .where(eq(weeklyReportRun.id, run.id));
    await u.audit('weekly_report.regenerate_requested', { type: 'weekly_report_run', id: run.id });
    await u.enqueue('weekly_report.redraft', { runId: run.id });
    return { id: run.id, status: 'queued' as const, rowVersion: locked.rowVersion + 1 };
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

// ───────────── schedule settings (Admin) ─────────────
/** The template in use, for display: its key and name. */
const templateOf = (weekly: { templateKey?: string }) => {
  const templateKey = resolveTemplateKey(weekly.templateKey);
  return { templateKey, templateLabel: WEEKLY_TEMPLATES[templateKey].label };
};

export async function getWeeklyReportSettings(ctx: AppContext, actor: UserActor) {
  requirePerm(actor, 'settings.manage');
  const [row] = await ctx.db.select({ weekly: organizationSettings.weeklyReportSettings, timeZone: organizationSettings.timeZone }).from(organizationSettings);
  if (!row) throw notFound('Organization settings');
  return { ...row.weekly, ...templateOf(row.weekly), timeZone: row.timeZone };
}

export async function updateWeeklyReportSettings(ctx: AppContext, actor: UserActor, input: z.infer<typeof weeklyReportSettingsInput>) {
  requirePerm(actor, 'settings.manage');
  return unitOfWork(ctx, actor, async (u) => {
    const [row] = await u.tx.select().from(organizationSettings).for('update');
    if (!row) throw notFound('Organization settings');
    // The template is not editable yet: keep the stored key (a real company template is added later as another key).
    const after = { ...row.weeklyReportSettings, enabled: input.enabled, runWeekday: input.runWeekday, runTime: input.runTime };
    await u.tx
      .update(organizationSettings)
      .set({ weeklyReportSettings: after, updatedAt: ctx.now(), updatedBy: actor.userId })
      .where(eq(organizationSettings.id, row.id));
    await u.audit('weekly_report_settings.updated', null, { before: row.weeklyReportSettings, after });
    return { ...after, ...templateOf(after), timeZone: row.timeZone };
  });
}
