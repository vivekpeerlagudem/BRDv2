/**
 * Weekly Sales Brief — public API of the module.
 *
 * One company-wide report per week for leadership (Admin role): overall sales and throughput, the analysis of what
 * changed and what is at risk, and recommended actions. It is independent of any deal or client, and it does not
 * touch the per-client weekly report (modules/weekly-reports.ts), which stays as it is.
 *
 * One run = one week. The steps are plain functions called in order by `runJob`:
 *   Collector (collect.ts, as an Admin → same numbers as the Reports page) → snapshot file → Metrics (metrics.ts)
 *   → Signals (signals.ts, the analysis — code only) → Insights & Narrative (AI, narrative.ts) → Checks (checks.ts)
 *   → draft PowerPoint (deck.ts) and draft Excel (sheet.ts). An Admin then edits, approves and downloads the final
 *   files; optionally the approved brief is written to one Google Sheet (job `sales_brief.sheet`).
 *
 * Dependency direction: workflow.ts imports this file (schedule and jobs). This file must NOT import workflow.ts.
 */
import { canonicalJson } from '@crm/proposal';
import type { salesBriefListQuery, salesBriefNarrativeUpdateInput, salesBriefSettingsInput, weeklyReportApproveInput } from '@crm/shared';
import { and, asc, desc, eq, inArray, lt, max, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  type SalesBriefNarrative,
  type SalesBriefSettings,
  type SalesBriefStatement,
  type SalesMetricsDoc,
  type SalesSignal,
  salesBriefRun,
} from '../db/schema-sales-brief.ts';
import type { WeeklyFlag } from '../db/schema-weekly-reports.ts';
import { storageKeys } from '../platform/adapters.ts';
import {
  type AppContext,
  buildUserActor,
  conflict,
  notFound,
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
import { BRIEF_LABELS, BRIEF_SECTIONS, composeBriefFlags } from './sales-brief/checks.ts';
import { collectSalesBrief, type SalesSnapshot } from './sales-brief/collect.ts';
import { briefFileName, buildBriefDeck, PPTX_CONTENT_TYPE, renderBriefPptx } from './sales-brief/deck.ts';
import { buildSalesFacts } from './sales-brief/facts.ts';
import { computeSalesMetrics } from './sales-brief/metrics.ts';
import { storeBriefGeneration, writeBrief } from './sales-brief/narrative.ts';
import { type BriefHistoryRow, buildBriefTabs, renderBriefXlsx, XLSX_CONTENT_TYPE } from './sales-brief/sheet.ts';
import { computeSignals } from './sales-brief/signals.ts';
import { FALLBACK_TEXT, isBlocking, isWarning } from './weekly-reports/checks.ts';
import { resolveTemplateKey } from './weekly-reports/deck.ts';
import { allowedSourceIds } from './weekly-reports/facts.ts';
import { isDue, lastFullWeek, periodLabel } from './weekly-reports/period.ts';

const { organizationSettings, appUserProfile, fileObject } = schema;
const STUCK_AFTER_MS = 30 * 60_000;
const DEFAULT_SETTINGS: SalesBriefSettings = { enabled: true, runWeekday: 1, runTime: '08:00', ownerUserId: null };

type Run = typeof salesBriefRun.$inferSelect;
export interface BriefHooks {
  /** Called inside the transaction that records a finished draft (workflow.ts uses it to notify the admins). */
  onDraftReady?: (u: Uow, info: { run: Run; status: 'ready' | 'needs_attention' }) => Promise<void>;
}

const settingsOf = (raw: Partial<SalesBriefSettings> | null | undefined): SalesBriefSettings => ({ ...DEFAULT_SETTINGS, ...(raw ?? {}) });

// ───────────── Orchestrator ─────────────
/**
 * Schedule side: once the weekly run time has passed, queue the brief for the last full week. Safe to call as
 * often as you like — the unique key (week, attempt 1) stops duplicates. Also fails runs stuck for over 30 minutes.
 */
export async function scheduleSalesBrief(ctx: AppContext): Promise<number> {
  const now = ctx.now();
  await ctx.db
    .update(salesBriefRun)
    .set({ status: 'failed', failureReason: 'STUCK', updatedAt: now, rowVersion: sql`${salesBriefRun.rowVersion} + 1` })
    .where(and(eq(salesBriefRun.status, 'running'), lt(salesBriefRun.updatedAt, new Date(now.getTime() - STUCK_AFTER_MS))));
  const [org] = await ctx.db.select({ timeZone: organizationSettings.timeZone, brief: organizationSettings.salesBriefSettings }).from(organizationSettings);
  if (!org) return 0;
  const settings = settingsOf(org.brief);
  if (!settings.enabled || !isDue(now, org.timeZone, settings.runWeekday, settings.runTime)) return 0;
  // Nothing to brief on: a CRM without a single lead or opportunity gets no scheduled brief ("Generate now" still works).
  const [data] = (await ctx.db.execute(sql`select (exists (select 1 from deal) or exists (select 1 from lead)) as any`)).rows as { any: boolean }[];
  if (!data?.any) return 0;
  const period = lastFullWeek(now, org.timeZone);
  return unitOfWork(ctx, SYSTEM, async (u) => {
    const inserted = await u.tx
      .insert(salesBriefRun)
      .values({
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        timeZone: org.timeZone,
        attempt: 1,
        trigger: 'schedule',
        status: 'queued',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: salesBriefRun.id });
    if (!inserted[0]) return 0;
    await u.enqueue('sales_brief.run', { runId: inserted[0].id });
    return 1;
  });
}

/** "Generate now": a new version (attempt) of the brief for the last full week. */
export async function requestSalesBrief(ctx: AppContext, actor: UserActor) {
  requirePerm(actor, 'sales_brief.manage');
  const [org] = await ctx.db.select({ timeZone: organizationSettings.timeZone }).from(organizationSettings);
  const timeZone = org?.timeZone ?? 'UTC';
  const now = ctx.now();
  const period = lastFullWeek(now, timeZone);
  const samePeriod = eq(salesBriefRun.periodStart, period.periodStart);
  const inProgress = () => conflict('SALES_BRIEF_IN_PROGRESS', 'A sales brief for this week is already being generated');
  try {
    return await unitOfWork(ctx, actor, async (u) => {
      const [busy] = await u.tx
        .select({ id: salesBriefRun.id })
        .from(salesBriefRun)
        .where(and(samePeriod, inArray(salesBriefRun.status, ['queued', 'running'])));
      if (busy) throw inProgress();
      const [last] = await u.tx
        .select({ n: max(salesBriefRun.attempt) })
        .from(salesBriefRun)
        .where(samePeriod);
      const [run] = await u.tx
        .insert(salesBriefRun)
        .values({
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
        .returning();
      const created = run as Run;
      await u.audit('sales_brief.requested', { type: 'sales_brief_run', id: created.id }, { periodStart: period.periodStart, attempt: created.attempt });
      await u.enqueue('sales_brief.run', { runId: created.id });
      return { id: created.id, attempt: created.attempt, periodStart: period.periodStart, periodEnd: period.periodEnd, status: 'queued' as const };
    });
  } catch (error) {
    // Two admins clicking at the same moment: the unique key (week, attempt) lets only one through.
    if ((error as { code?: string }).code === '23505' || (error as { cause?: { code?: string } }).cause?.code === '23505') throw inProgress();
    throw error;
  }
}

/** The admin the brief runs for: the configured owner when they are an active admin, else the earliest active admin. */
async function resolveRunAs(ctx: AppContext): Promise<UserActor | null> {
  const [org] = await ctx.db.select({ brief: organizationSettings.salesBriefSettings }).from(organizationSettings);
  const admins = await ctx.db
    .select({ userId: appUserProfile.userId })
    .from(appUserProfile)
    .where(and(eq(appUserProfile.role, 'admin'), eq(appUserProfile.status, 'active')))
    .orderBy(asc(appUserProfile.createdAt), asc(appUserProfile.userId));
  const wanted = settingsOf(org?.brief).ownerUserId;
  const chosen = admins.find((a) => a.userId === wanted) ?? admins[0];
  return chosen ? buildUserActor(ctx.db, chosen.userId) : null;
}

async function failRun(ctx: AppContext, run: Run, reason: string): Promise<void> {
  await ctx.db
    .update(salesBriefRun)
    .set({ status: 'failed', failureReason: reason, updatedAt: ctx.now(), rowVersion: sql`${salesBriefRun.rowVersion} + 1` })
    .where(eq(salesBriefRun.id, run.id));
  ctx.logger.warn({ salesBriefRunId: run.id, reason }, 'sales brief run failed');
}

/** Metric documents of the briefs for earlier weeks, newest first, one per week (approved if there is one). */
async function earlierMetrics(ctx: AppContext, run: Run): Promise<SalesMetricsDoc[]> {
  const rows = await ctx.db
    .select({ periodStart: salesBriefRun.periodStart, status: salesBriefRun.status, metrics: salesBriefRun.metrics })
    .from(salesBriefRun)
    .where(and(lt(salesBriefRun.periodStart, run.periodStart), inArray(salesBriefRun.status, ['approved', 'ready', 'needs_attention'])))
    .orderBy(desc(salesBriefRun.periodStart), sql`(${salesBriefRun.status} = 'approved') desc`, desc(salesBriefRun.attempt));
  const perWeek = new Map<string, SalesMetricsDoc>();
  for (const r of rows) if (r.metrics && !perWeek.has(r.periodStart)) perWeek.set(r.periodStart, r.metrics);
  return [...perWeek.values()].slice(0, 4);
}

/** Writes the frozen snapshot write-once. If a retry finds one already stored, the stored one wins. */
async function storeSnapshot(ctx: AppContext, runId: string, snapshot: SalesSnapshot) {
  const key = storageKeys.salesBriefSnapshot(runId);
  const bytes = new TextEncoder().encode(canonicalJson(snapshot));
  try {
    await ctx.storage.put(key, bytes, { contentType: 'application/json', immutable: true });
    return { snapshot, bytes, key };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const stored = await ctx.storage.get(key);
    return { snapshot: JSON.parse(new TextDecoder().decode(stored)) as SalesSnapshot, bytes: stored, key };
  }
}
async function readSnapshot(ctx: AppContext, run: Run): Promise<SalesSnapshot | null> {
  if (!run.snapshotFileId) return null;
  const bytes = await ctx.storage.get(storageKeys.salesBriefSnapshot(run.id));
  if (sha256Hex(bytes) !== run.snapshotSha256) throw new DomainError('FILE_INTEGRITY_FAILED', 500, 'The stored brief data does not match its fingerprint');
  return JSON.parse(new TextDecoder().decode(bytes)) as SalesSnapshot;
}

/**
 * Job `sales_brief.run`. Idempotent: only a queued or running run is processed. Expected problems end the run as
 * `failed` with a reason; unexpected errors are rethrown so the job outbox retries with backoff.
 */
export async function runJob(ctx: AppContext, runId: string, hooks: BriefHooks = {}): Promise<void> {
  const [run] = await ctx.db.select().from(salesBriefRun).where(eq(salesBriefRun.id, runId));
  if (!run || (run.status !== 'queued' && run.status !== 'running')) return;
  // The brief runs on behalf of an Admin: their scope is the whole company, and the AI use is theirs.
  const admin = await resolveRunAs(ctx);
  if (!admin) return failRun(ctx, run, 'NO_ACTIVE_ADMIN');
  await ctx.db.update(salesBriefRun).set({ status: 'running', runAsUserId: admin.userId, updatedAt: ctx.now() }).where(eq(salesBriefRun.id, run.id));

  const stored = await storeSnapshot(ctx, run.id, await collectSalesBrief(ctx, admin, run));
  const metrics = computeSalesMetrics(stored.snapshot, await earlierMetrics(ctx, run));
  const signals = computeSignals(stored.snapshot, metrics);
  await draftAndStore(ctx, { ...run, runAsUserId: admin.userId }, admin, stored.snapshot, metrics, signals, { stored, hooks });
}

/** Job `sales_brief.redraft`: redraft the text from the stored snapshot (same figures, same findings, same version). */
export async function redraftJob(ctx: AppContext, runId: string): Promise<void> {
  const [run] = await ctx.db.select().from(salesBriefRun).where(eq(salesBriefRun.id, runId));
  if (run?.status !== 'queued' || !run.snapshotFileId) return;
  const admin = (run.runAsUserId ? await buildUserActor(ctx.db, run.runAsUserId) : null) ?? (await resolveRunAs(ctx));
  if (!admin) return failRun(ctx, run, 'NO_ACTIVE_ADMIN');
  const snapshot = await readSnapshot(ctx, run);
  if (!snapshot || !run.metrics) return failRun(ctx, run, 'NO_SNAPSHOT');
  await draftAndStore(ctx, run, admin, snapshot, run.metrics, run.signals, { stored: null, hooks: {} });
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
type Org = Awaited<ReturnType<typeof orgOf>>;
const brandHex = (org: Org) => (/^#[0-9a-fA-F]{6}$/.test(org.branding.primaryColor) ? org.branding.primaryColor.slice(1).toUpperCase() : '1F4E79');

const renderDeck = (run: Run, org: Org, metrics: SalesMetricsDoc, narrative: SalesBriefNarrative, draft: boolean, approverName: string | null) =>
  renderBriefPptx(
    buildBriefDeck({
      draft,
      attempt: run.attempt,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      orgName: org.name,
      branding: org.branding,
      metrics: { ...metrics, timeZone: metrics.timeZone ?? run.timeZone },
      narrative,
      approverName,
      asOf: metrics.asOf ?? run.createdAt.toISOString(),
    }),
    org.templateKey,
  );
const renderSheet = (run: Run, org: Org, metrics: SalesMetricsDoc, signals: SalesSignal[], narrative: SalesBriefNarrative, history: BriefHistoryRow[]) =>
  renderBriefXlsx(buildBriefTabs({ metrics, signals, narrative, history }), {
    brandColor: brandHex(org),
    orgName: org.name,
    title: `${org.name} — Weekly sales brief ${periodLabel(run.periodStart, run.periodEnd)}`,
  });

/** Approved briefs, newest first, for the "Brief history" tab. */
async function approvedHistory(ctx: AppContext): Promise<BriefHistoryRow[]> {
  const rows = await ctx.db
    .select({
      periodStart: salesBriefRun.periodStart,
      periodEnd: salesBriefRun.periodEnd,
      attempt: salesBriefRun.attempt,
      approvedAt: salesBriefRun.approvedAt,
      metrics: salesBriefRun.metrics,
    })
    .from(salesBriefRun)
    .where(eq(salesBriefRun.status, 'approved'))
    .orderBy(desc(salesBriefRun.periodStart), desc(salesBriefRun.attempt))
    .limit(104);
  return rows.flatMap((r) => (r.metrics ? [{ ...r, approvedAt: r.approvedAt?.toISOString() ?? null, metrics: r.metrics }] : []));
}

/** Stores a draft file (may be replaced) and returns what the transaction records about it. */
async function putDraft(ctx: AppContext, key: string, bytes: Uint8Array, contentType: string) {
  await ctx.storage.put(key, bytes, { contentType });
  return { storageKey: key, contentType, sizeBytes: bytes.length, sha256: sha256Hex(bytes) };
}
const recordDraft = async (u: Uow, file: Awaited<ReturnType<typeof putDraft>>, purpose: string) => {
  const [row] = await u.tx
    .insert(fileObject)
    .values({ ...file, purpose })
    .onConflictDoUpdate({ target: fileObject.storageKey, set: { sizeBytes: file.sizeBytes, sha256: file.sha256 } })
    .returning({ id: fileObject.id });
  return (row as { id: string }).id;
};

/** Insights & Narrative (AI) → Checks → draft PowerPoint and Excel → one transaction that records everything. */
async function draftAndStore(
  ctx: AppContext,
  run: Run,
  admin: UserActor,
  snapshot: SalesSnapshot,
  metrics: SalesMetricsDoc,
  signals: SalesSignal[],
  opts: { stored: { key: string; bytes: Uint8Array } | null; hooks: BriefHooks },
): Promise<void> {
  const org = await orgOf(ctx);
  const facts = buildSalesFacts(snapshot, metrics, signals);
  // AI on behalf of the admin. AI problems end in placeholders, never in a failed run.
  const written = await writeBrief(ctx, admin, run, facts, signals);
  const aiGenerationId = written.meta
    ? await storeBriefGeneration(ctx, admin, { runId: run.id, narrative: written.narrative, meta: written.meta, facts })
    : null;
  const flags = composeBriefFlags(written.narrative, facts.facts, signals, written.flags);
  const status = flags.some(isBlocking) ? 'needs_attention' : 'ready';

  // Draft files are written to storage BEFORE the transaction that records them (a draft may be replaced).
  const pptx = await putDraft(
    ctx,
    storageKeys.salesBriefDraftPptx(run.id),
    await renderDeck(run, org, metrics, written.narrative, true, null),
    PPTX_CONTENT_TYPE,
  );
  const xlsx = await putDraft(
    ctx,
    storageKeys.salesBriefDraftXlsx(run.id),
    await renderSheet(run, org, metrics, signals, written.narrative, await approvedHistory(ctx)),
    XLSX_CONTENT_TYPE,
  );

  await unitOfWork(ctx, SYSTEM, async (u) => {
    const snapshotFields: Partial<typeof salesBriefRun.$inferInsert> = {};
    if (opts.stored) {
      const snapshotSha256 = sha256Hex(opts.stored.bytes);
      const [file] = await u.tx
        .insert(fileObject)
        .values({
          storageKey: opts.stored.key,
          contentType: 'application/json',
          sizeBytes: opts.stored.bytes.length,
          sha256: snapshotSha256,
          purpose: 'sales_brief_snapshot',
          immutable: true,
        })
        .onConflictDoUpdate({ target: fileObject.storageKey, set: { purpose: 'sales_brief_snapshot' } })
        .returning({ id: fileObject.id });
      Object.assign(snapshotFields, { snapshotFileId: (file as { id: string }).id, snapshotSha256, metrics, signals });
    }
    // A redraft replaces the earlier AI text: its undecided generation is no longer the one in use.
    if (run.aiGenerationId)
      await u.tx
        .update(schema.aiGeneration)
        .set({ status: 'discarded', decidedAt: ctx.now() })
        .where(and(eq(schema.aiGeneration.id, run.aiGenerationId), eq(schema.aiGeneration.status, 'pending')));
    await u.tx
      .update(salesBriefRun)
      .set({
        ...snapshotFields,
        runAsUserId: admin.userId,
        narrative: written.narrative,
        checkFlags: flags,
        aiGenerationId,
        aiFallback: written.aiFallback,
        draftPptxFileId: await recordDraft(u, pptx, 'sales_brief_draft_pptx'),
        draftXlsxFileId: await recordDraft(u, xlsx, 'sales_brief_draft_xlsx'),
        status,
        updatedAt: ctx.now(),
        rowVersion: sql`${salesBriefRun.rowVersion} + 1`,
      })
      .where(eq(salesBriefRun.id, run.id));
    await u.audit(
      'sales_brief.draft_ready',
      { type: 'sales_brief_run', id: run.id },
      { periodStart: run.periodStart, status, signals: signals.length, aiFallback: written.aiFallback },
    );
    await opts.hooks.onDraftReady?.(u, { run, status });
  });
}

// ───────────── reading, editing, approval and download (Admins only) ─────────────
const APPROVABLE: Run['status'][] = ['ready', 'needs_attention'];
const hasPlaceholder = (n: SalesBriefNarrative | null) =>
  Boolean(n && BRIEF_SECTIONS.some((s) => n[s].some((st) => st.origin === 'fallback' || st.text === FALLBACK_TEXT)));
function approvalBlockers(run: Run): WeeklyFlag[] {
  const blockers = run.checkFlags.filter(isBlocking);
  if (hasPlaceholder(run.narrative) && !blockers.some((f) => f.code === 'AI_FALLBACK' || f.code === 'PLACEHOLDER_TEXT'))
    blockers.push({ code: 'PLACEHOLDER_TEXT', statementId: null, message: 'Some text is still a placeholder' });
  return blockers;
}
const NOT_EDITABLE = (status: Run['status']) =>
  status === 'queued' || status === 'running'
    ? conflict('SALES_BRIEF_IN_PROGRESS', 'This sales brief is being generated')
    : rule('SALES_BRIEF_NOT_EDITABLE', status === 'approved' ? 'An approved sales brief can no longer be changed' : 'This sales brief cannot be changed');

async function loadRun(ctx: AppContext, actor: UserActor, id: string, access: 'read' | 'write'): Promise<Run> {
  requirePerm(actor, access === 'read' ? 'sales_brief.view' : 'sales_brief.manage');
  const [run] = await ctx.db.select().from(salesBriefRun).where(eq(salesBriefRun.id, id));
  if (!run) throw notFound('Sales brief');
  return run;
}

const KPI_IDS = ['S-01', 'S-05', 'S-08', 'S-10', 'S-11'];
const summaryOf = (run: Run) => ({
  id: run.id,
  periodStart: run.periodStart,
  periodEnd: run.periodEnd,
  periodLabel: periodLabel(run.periodStart, run.periodEnd),
  attempt: run.attempt,
  trigger: run.trigger,
  status: run.status,
  currency: run.metrics?.currency ?? null,
  kpis: (run.metrics?.metrics ?? []).filter((m) => KPI_IDS.includes(m.id)),
  signalCount: run.signals.length,
  highSignals: run.signals.filter((s) => s.severity === 'high').length,
  headline: run.narrative?.headline.find((s) => s.origin !== 'fallback')?.text ?? null,
  aiFallback: run.aiFallback,
  flagCount: run.checkFlags.filter(isBlocking).length,
  warningCount: run.checkFlags.filter(isWarning).length,
  hasDraft: run.draftPptxFileId !== null,
  hasFinal: run.status === 'approved',
  approvable: APPROVABLE.includes(run.status) && approvalBlockers(run).length === 0,
  sheetStatus: run.sheetStatus,
  failureReason: run.failureReason,
  approvedAt: run.approvedAt,
  createdAt: run.createdAt,
  updatedAt: run.updatedAt,
  rowVersion: run.rowVersion,
});

export async function listSalesBriefs(ctx: AppContext, actor: UserActor, q: z.infer<typeof salesBriefListQuery>) {
  requirePerm(actor, 'sales_brief.view');
  const rows = await ctx.db
    .select()
    .from(salesBriefRun)
    .where(q.status ? eq(salesBriefRun.status, q.status) : undefined)
    .orderBy(desc(salesBriefRun.periodStart), desc(salesBriefRun.attempt))
    .limit(q.limit ?? 60);
  return { items: rows.map(summaryOf) };
}

/** Labels (and CRM links) for the evidence ids a statement cites, taken from the frozen snapshot and the findings. */
function evidenceIndex(snapshot: SalesSnapshot | null, doc: SalesMetricsDoc, signals: SalesSignal[]): Map<string, { label: string; link: string | null }> {
  const index = new Map<string, { label: string; link: string | null }>();
  index.set('period', { label: periodLabel(doc.periodStart, doc.periodEnd), link: null });
  for (const m of doc.metrics) index.set(`metric:${m.id}`, { label: `${m.label}: ${m.value ?? 'n/a'}`, link: null });
  for (const s of signals) index.set(s.id, { label: `Finding: ${s.title}`, link: null });
  const deal = (dealId: string, name: string) => index.set(`deal:${dealId}`, { label: name, link: `/deals/${dealId}` });
  for (const d of snapshot?.openDeals ?? []) deal(d.dealId, d.name);
  for (const d of [...doc.wonDeals, ...doc.lostDeals, ...doc.attention]) deal(d.dealId, d.name);
  for (const r of doc.reps) index.set(`user:${r.userId}`, { label: r.name, link: null });
  for (const u of snapshot?.users ?? []) if (!index.has(`user:${u.userId}`)) index.set(`user:${u.userId}`, { label: u.name, link: null });
  return index;
}

export async function getSalesBrief(ctx: AppContext, actor: UserActor, id: string) {
  const run = await loadRun(ctx, actor, id, 'read');
  const snapshot = run.metrics ? await readSnapshot(ctx, run) : null;
  const index = run.metrics ? evidenceIndex(snapshot, run.metrics, run.signals) : new Map<string, { label: string; link: string | null }>();
  const evidence = (ids: string[]) => ids.map((sid) => ({ id: sid, label: index.get(sid)?.label ?? sid, link: index.get(sid)?.link ?? null }));
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
  const people = [run.approvedBy, run.runAsUserId].filter((x): x is string => Boolean(x));
  const names = people.length
    ? await ctx.db.select({ userId: appUserProfile.userId, name: appUserProfile.fullName }).from(appUserProfile).where(inArray(appUserProfile.userId, people))
    : [];
  const nameOf = (userId: string | null) => names.find((n) => n.userId === userId)?.name ?? null;
  const canManage = actor.role === 'admin';
  const blockers = approvalBlockers(run);
  const facts = snapshot && run.metrics ? buildSalesFacts(snapshot, run.metrics, run.signals).facts : null;
  return {
    ...summaryOf(run),
    timeZone: run.timeZone,
    /** When the data was read: pipeline and attention figures are as of this instant. */
    asOf: run.metrics?.asOf ?? run.createdAt.toISOString(),
    runAsName: nameOf(run.runAsUserId),
    approvedByName: nameOf(run.approvedBy),
    finalPptxSha256: run.finalPptxSha256,
    xlsxSha256: run.xlsxSha256,
    metrics: run.metrics?.metrics ?? [],
    funnel: run.metrics?.funnel ?? [],
    pipelineByStage: run.metrics?.pipelineByStage ?? [],
    reps: run.metrics?.reps ?? [],
    attention: run.metrics?.attention ?? [],
    signals: run.signals.map((s) => ({
      id: s.id,
      kind: s.kind,
      severity: s.severity,
      title: s.title,
      evidence: evidence([...s.metricIds.map((m) => `metric:${m}`), ...s.recordIds]),
    })),
    narrative: run.narrative
      ? BRIEF_SECTIONS.map((section) => ({
          section,
          label: BRIEF_LABELS[section],
          statements: (run.narrative as SalesBriefNarrative)[section].map((s) => ({
            id: s.id,
            text: s.text,
            origin: s.origin,
            kind: s.kind ?? null,
            signalIds: s.signalIds ?? [],
            sources: evidence(s.sources),
          })),
        }))
      : [],
    flags: run.checkFlags,
    blockers,
    warnings: run.checkFlags.filter(isWarning),
    /** Text can be edited or regenerated while the brief is not approved and no run is in progress. */
    editable: canManage && APPROVABLE.includes(run.status),
    /** What an added sentence may cite: the facts the AI was given, with readable labels. */
    allowedSources: facts && canManage ? [...allowedSourceIds(facts)].map((sid) => ({ id: sid, label: index.get(sid)?.label ?? sid })) : [],
    sheet: { status: run.sheetStatus, mode: ctx.sheets.name, enabled: ctx.sheets.enabled },
    ai: generation ?? null,
    permissions: { canManage, canApprove: canManage && APPROVABLE.includes(run.status) && blockers.length === 0 },
  };
}

/** An Admin edits the brief: change, add or remove sentences. The checks run again and both draft files are redone. */
export async function updateBriefNarrative(ctx: AppContext, actor: UserActor, id: string, input: z.infer<typeof salesBriefNarrativeUpdateInput>) {
  const run = await loadRun(ctx, actor, id, 'write');
  if (!APPROVABLE.includes(run.status)) throw NOT_EDITABLE(run.status);
  if (input.rowVersion !== run.rowVersion) throw conflict('CONCURRENT_MODIFICATION', 'This sales brief changed since you opened it');
  const snapshot = await readSnapshot(ctx, run);
  if (!snapshot || !run.metrics || !run.narrative) throw rule('SALES_BRIEF_NOT_EDITABLE', 'This sales brief has no text to edit');
  const current = run.narrative;
  const org = await orgOf(ctx);
  const facts = buildSalesFacts(snapshot, run.metrics, run.signals).facts;
  const allowed = allowedSourceIds(facts);
  const signalIds = new Set(run.signals.map((s) => s.id));

  const narrative = Object.fromEntries(BRIEF_SECTIONS.map((s) => [s, current[s].map((st) => ({ ...st }))])) as SalesBriefNarrative;
  const all = () => BRIEF_SECTIONS.flatMap((s) => narrative[s]);
  const removed = new Set(input.removed ?? []);
  for (const rid of removed) if (!all().some((st) => st.id === rid)) throw rule('STATEMENT_NOT_FOUND', 'A sentence to remove is no longer in this brief');
  let edited = 0;
  for (const change of input.statements ?? []) {
    const target = all().find((st) => st.id === change.id);
    if (!target) throw rule('STATEMENT_NOT_FOUND', 'A sentence to change is no longer in this brief');
    const text = sanitizeText(change.text, 600);
    if (!text) throw rule('STATEMENT_EMPTY', 'A sentence cannot be empty');
    if (text === target.text) continue;
    target.text = text;
    target.origin = 'user';
    edited++;
  }
  for (const s of BRIEF_SECTIONS) narrative[s] = narrative[s].filter((st) => !removed.has(st.id));
  let next = Math.max(0, ...BRIEF_SECTIONS.flatMap((s) => current[s]).map((st) => Number(st.id.replace(/\D/g, '')) || 0));
  for (const add of input.added ?? []) {
    const text = sanitizeText(add.text, 600);
    if (!text) throw rule('STATEMENT_EMPTY', 'A sentence cannot be empty');
    const sources = [...new Set(add.sources)];
    if (sources.some((sid) => !allowed.has(sid))) throw rule('UNKNOWN_SOURCE', 'A chosen source is not part of this brief');
    const linked = sources.filter((sid) => signalIds.has(sid));
    const statement: SalesBriefStatement = { id: `s${++next}`, text, sources, origin: 'user' };
    if (add.section === 'insights' || add.section === 'actions') statement.signalIds = linked;
    narrative[add.section].push(statement);
  }

  const flags = composeBriefFlags(narrative, facts, run.signals);
  const status = flags.some(isBlocking) ? 'needs_attention' : 'ready';
  const pptx = await putDraft(ctx, storageKeys.salesBriefDraftPptx(run.id), await renderDeck(run, org, run.metrics, narrative, true, null), PPTX_CONTENT_TYPE);
  const xlsx = await putDraft(
    ctx,
    storageKeys.salesBriefDraftXlsx(run.id),
    await renderSheet(run, org, run.metrics, run.signals, narrative, await approvedHistory(ctx)),
    XLSX_CONTENT_TYPE,
  );

  return unitOfWork(ctx, actor, async (u) => {
    const [locked] = await u.tx.select().from(salesBriefRun).where(eq(salesBriefRun.id, run.id)).for('update');
    if (!locked || !APPROVABLE.includes(locked.status)) throw NOT_EDITABLE(locked?.status ?? 'failed');
    if (locked.rowVersion !== input.rowVersion) throw conflict('CONCURRENT_MODIFICATION', 'This sales brief changed since you opened it');
    await recordDraft(u, pptx, 'sales_brief_draft_pptx');
    await recordDraft(u, xlsx, 'sales_brief_draft_xlsx');
    await u.tx
      .update(salesBriefRun)
      .set({ narrative, checkFlags: flags, status, updatedAt: ctx.now(), updatedBy: actor.userId, rowVersion: locked.rowVersion + 1 })
      .where(eq(salesBriefRun.id, run.id));
    // Counts only — never the text.
    await u.audit('sales_brief.edited', { type: 'sales_brief_run', id: run.id }, { edited, added: input.added?.length ?? 0, removed: removed.size, status });
    return { id: run.id, status, rowVersion: locked.rowVersion + 1, flagCount: flags.filter(isBlocking).length, warningCount: flags.filter(isWarning).length };
  });
}

/** "Regenerate": queue a redraft of the text from the stored snapshot. All current text, including edits, is replaced. */
export async function regenerateBrief(ctx: AppContext, actor: UserActor, id: string) {
  const run = await loadRun(ctx, actor, id, 'write');
  return unitOfWork(ctx, actor, async (u) => {
    const [locked] = await u.tx.select().from(salesBriefRun).where(eq(salesBriefRun.id, run.id)).for('update');
    if (!locked || !APPROVABLE.includes(locked.status)) throw NOT_EDITABLE(locked?.status ?? 'failed');
    if (!locked.snapshotFileId) throw rule('SALES_BRIEF_NOT_EDITABLE', 'This sales brief has no stored data to regenerate from');
    await u.tx
      .update(salesBriefRun)
      .set({ status: 'queued', updatedAt: ctx.now(), updatedBy: actor.userId, rowVersion: locked.rowVersion + 1 })
      .where(eq(salesBriefRun.id, run.id));
    await u.audit('sales_brief.regenerate_requested', { type: 'sales_brief_run', id: run.id });
    await u.enqueue('sales_brief.redraft', { runId: run.id });
    return { id: run.id, status: 'queued' as const, rowVersion: locked.rowVersion + 1 };
  });
}

/** Stores a final file write-once; if an earlier approval attempt already stored it, that file is the final one. */
async function putFinal(ctx: AppContext, key: string, bytes: Uint8Array, contentType: string) {
  let final = bytes;
  try {
    await ctx.storage.put(key, bytes, { contentType, immutable: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    final = await ctx.storage.get(key);
  }
  return { storageKey: key, contentType, sizeBytes: final.length, sha256: sha256Hex(final) };
}

/**
 * Approval: an Admin accepts the brief. The final PowerPoint (no draft label, approver named on the analysis slide)
 * and the final Excel are rendered and stored write-once BEFORE the transaction; their fingerprints are recorded.
 * When Google publishing is switched on, a `sales_brief.sheet` job is queued; its outcome never changes the status.
 */
export async function approveSalesBrief(ctx: AppContext, actor: UserActor, id: string, input: z.infer<typeof weeklyReportApproveInput>) {
  const run = await loadRun(ctx, actor, id, 'write');
  if (!APPROVABLE.includes(run.status)) throw conflict('INVALID_STATE_TRANSITION', 'Only a sales brief that is ready or needs attention can be approved');
  if (input.rowVersion !== run.rowVersion) throw conflict('CONCURRENT_MODIFICATION', 'This sales brief changed since you opened it');
  const blockers = approvalBlockers(run);
  if (blockers.length) throw rule('SALES_BRIEF_NOT_APPROVABLE', 'Fix the open points before approving this sales brief', { flags: blockers });
  const warnings = run.checkFlags.filter(isWarning);
  if (warnings.length && input.acknowledgeWarnings !== true)
    throw rule('SALES_BRIEF_NOT_APPROVABLE', 'Confirm that you checked the flagged figures before approving', { flags: warnings, needsAcknowledgement: true });
  if (!run.metrics || !run.narrative) throw rule('SALES_BRIEF_NOT_APPROVABLE', 'This sales brief has no content to approve', { flags: [] });
  const narrative = run.narrative;
  const edited = BRIEF_SECTIONS.some((s) => narrative[s].some((st) => st.origin === 'user'));
  const org = await orgOf(ctx);
  const [approver] = await ctx.db.select({ name: appUserProfile.fullName }).from(appUserProfile).where(eq(appUserProfile.userId, actor.userId));
  const now = ctx.now();
  const history: BriefHistoryRow[] = [
    { periodStart: run.periodStart, periodEnd: run.periodEnd, attempt: run.attempt, approvedAt: now.toISOString(), metrics: run.metrics },
    ...(await approvedHistory(ctx)),
  ];

  const pptx = await putFinal(
    ctx,
    storageKeys.salesBriefFinalPptx(run.id),
    await renderDeck(run, org, run.metrics, narrative, false, approver?.name ?? null),
    PPTX_CONTENT_TYPE,
  );
  const xlsx = await putFinal(
    ctx,
    storageKeys.salesBriefFinalXlsx(run.id),
    await renderSheet(run, org, run.metrics, run.signals, narrative, history),
    XLSX_CONTENT_TYPE,
  );
  const publish = ctx.sheets.enabled;

  return unitOfWork(ctx, actor, async (u) => {
    const [locked] = await u.tx.select().from(salesBriefRun).where(eq(salesBriefRun.id, run.id)).for('update');
    if (!locked || !APPROVABLE.includes(locked.status)) throw conflict('INVALID_STATE_TRANSITION', 'This sales brief was already approved or changed');
    if (locked.rowVersion !== input.rowVersion) throw conflict('CONCURRENT_MODIFICATION', 'This sales brief changed since you opened it');
    const record = async (file: typeof pptx, purpose: string) => {
      const [row] = await u.tx
        .insert(fileObject)
        .values({ ...file, purpose, immutable: true })
        .onConflictDoUpdate({ target: fileObject.storageKey, set: { purpose } })
        .returning({ id: fileObject.id });
      return (row as { id: string }).id;
    };
    await u.tx
      .update(salesBriefRun)
      .set({
        status: 'approved',
        approvedBy: actor.userId,
        approvedAt: now,
        finalPptxFileId: await record(pptx, 'sales_brief_final_pptx'),
        finalPptxSha256: pptx.sha256,
        xlsxFileId: await record(xlsx, 'sales_brief_final_xlsx'),
        xlsxSha256: xlsx.sha256,
        sheetStatus: publish ? 'pending' : 'disabled',
        updatedAt: now,
        updatedBy: actor.userId,
        rowVersion: locked.rowVersion + 1,
      })
      .where(eq(salesBriefRun.id, run.id));
    // The human decision on the AI text (BR-AIA-007): accepted as written, or accepted after a person edited it.
    if (locked.aiGenerationId)
      await u.tx
        .update(schema.aiGeneration)
        .set({ status: edited ? 'edited_accepted' : 'accepted', acceptedOutput: locked.narrative, decidedBy: actor.userId, decidedAt: now })
        .where(and(eq(schema.aiGeneration.id, locked.aiGenerationId), eq(schema.aiGeneration.status, 'pending')));
    await u.audit(
      'sales_brief.approved',
      { type: 'sales_brief_run', id: run.id },
      { periodStart: run.periodStart, finalPptxSha256: pptx.sha256, xlsxSha256: xlsx.sha256, edited, acknowledgedWarnings: warnings.map((w) => w.code) },
    );
    if (publish) await u.enqueue('sales_brief.sheet', { runId: run.id });
    return {
      id: run.id,
      status: 'approved' as const,
      finalPptxSha256: pptx.sha256,
      xlsxSha256: xlsx.sha256,
      sheetStatus: publish ? 'pending' : 'disabled',
      rowVersion: locked.rowVersion + 1,
    };
  });
}

/**
 * Job `sales_brief.sheet`: write the approved brief to the Google Sheet. A failure is recorded on the brief
 * (`sheet_status = failed`) and never changes its status; the Excel download is unaffected.
 */
export async function publishSheetJob(ctx: AppContext, runId: string): Promise<void> {
  const [run] = await ctx.db.select().from(salesBriefRun).where(eq(salesBriefRun.id, runId));
  if (run?.status !== 'approved' || run.sheetStatus !== 'pending' || !run.metrics || !run.narrative) return;
  let outcome: 'published' | 'failed' = 'published';
  let reason: string | null = null;
  try {
    await ctx.sheets.publish(buildBriefTabs({ metrics: run.metrics, signals: run.signals, narrative: run.narrative, history: await approvedHistory(ctx) }));
  } catch (error) {
    if (!(error instanceof DomainError)) throw error; // unexpected: let the job outbox retry
    outcome = 'failed';
    reason = error.code;
  }
  await unitOfWork(ctx, SYSTEM, async (u) => {
    await u.tx.update(salesBriefRun).set({ sheetStatus: outcome, updatedAt: ctx.now() }).where(eq(salesBriefRun.id, run.id));
    await u.audit(`sales_brief.sheet_${outcome}`, { type: 'sales_brief_run', id: run.id }, reason ? { reason } : {});
  });
}

/** Draft files (any time after the run finished) or final files (only after approval; fingerprint re-checked). */
export async function downloadBriefFile(ctx: AppContext, actor: UserActor, id: string, format: 'pptx' | 'xlsx', kind: 'draft' | 'final') {
  const run = await loadRun(ctx, actor, id, 'read');
  const org = await orgOf(ctx);
  const contentType = format === 'pptx' ? PPTX_CONTENT_TYPE : XLSX_CONTENT_TYPE;
  const fileName = briefFileName(org.name, run.periodEnd, run.attempt, kind === 'draft', format);
  if (kind === 'final') {
    const expected = format === 'pptx' ? run.finalPptxSha256 : run.xlsxSha256;
    if (run.status !== 'approved' || !expected) throw notFound('Final sales brief');
    const bytes = await ctx.storage.get(format === 'pptx' ? storageKeys.salesBriefFinalPptx(run.id) : storageKeys.salesBriefFinalXlsx(run.id));
    if (sha256Hex(bytes) !== expected) throw new DomainError('FILE_INTEGRITY_FAILED', 500, 'The stored file does not match its fingerprint');
    return { bytes, contentType, fileName };
  }
  if (!(format === 'pptx' ? run.draftPptxFileId : run.draftXlsxFileId)) throw notFound('Draft sales brief');
  const bytes = await ctx.storage.get(format === 'pptx' ? storageKeys.salesBriefDraftPptx(run.id) : storageKeys.salesBriefDraftXlsx(run.id));
  return { bytes, contentType, fileName };
}

// ───────────── settings (Admin) ─────────────
async function adminChoices(ctx: AppContext) {
  return ctx.db
    .select({ userId: appUserProfile.userId, name: appUserProfile.fullName })
    .from(appUserProfile)
    .where(and(eq(appUserProfile.role, 'admin'), eq(appUserProfile.status, 'active')))
    .orderBy(asc(appUserProfile.fullName));
}

export async function getSalesBriefSettings(ctx: AppContext, actor: UserActor) {
  requirePerm(actor, 'settings.manage');
  const [row] = await ctx.db.select({ brief: organizationSettings.salesBriefSettings, timeZone: organizationSettings.timeZone }).from(organizationSettings);
  if (!row) throw notFound('Organization settings');
  return { ...settingsOf(row.brief), timeZone: row.timeZone, admins: await adminChoices(ctx), sheet: { mode: ctx.sheets.name, ...ctx.sheets.status() } };
}

export async function updateSalesBriefSettings(ctx: AppContext, actor: UserActor, input: z.infer<typeof salesBriefSettingsInput>) {
  requirePerm(actor, 'settings.manage');
  const admins = await adminChoices(ctx);
  if (input.ownerUserId && !admins.some((a) => a.userId === input.ownerUserId))
    throw rule('SALES_BRIEF_OWNER_NOT_ADMIN', 'The sales brief can only run for an active administrator');
  return unitOfWork(ctx, actor, async (u) => {
    const [row] = await u.tx.select().from(organizationSettings).for('update');
    if (!row) throw notFound('Organization settings');
    const after: SalesBriefSettings = { enabled: input.enabled, runWeekday: input.runWeekday, runTime: input.runTime, ownerUserId: input.ownerUserId ?? null };
    await u.tx
      .update(organizationSettings)
      .set({ salesBriefSettings: after, updatedAt: ctx.now(), updatedBy: actor.userId })
      .where(eq(organizationSettings.id, row.id));
    await u.audit('sales_brief_settings.updated', null, { before: row.salesBriefSettings, after });
    return { ...after, timeZone: row.timeZone, admins, sheet: { mode: ctx.sheets.name, ...ctx.sheets.status() } };
  });
}
