/**
 * admin module — organization settings (BR-PLT-012), pipeline stages and win probabilities (BR-CRM-005),
 * lost reasons (BR-CRM-014), teams and their managers (BR-PLT-006) and the read-only audit log viewer (BR-PLT-009).
 *
 * Everything here is Admin-only configuration (permission `settings.manage`, audit log `audit.view`). Each change
 * runs in one unit of work and writes an audit entry with the values before and after.
 */
import { and, asc, desc, eq, gte, inArray, like, lt, lte, ne, or, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { lostReasonAdmin } from '../db/schema-admin.ts';
import { type AppContext, conflict, notFound, requirePerm, rule, schema, type Tx, type UserActor, unitOfWork } from '../platform/core.ts';

const { organizationSettings, pipeline, pipelineStage, deal, dealStageHistory, proposal, team, teamMembership, teamManager, appUserProfile, auditLog } = schema;

// ───────────── input schemas ─────────────
const isTimeZone = (v: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v });
    return true;
  } catch {
    return false;
  }
};
const isLocale = (v: string) => {
  try {
    return Intl.NumberFormat.supportedLocalesOf([v]).length > 0;
  } catch {
    return false;
  }
};
const CURRENCIES = new Set(Intl.supportedValuesOf('currency'));
const visibility = z.enum(['none', 'view_only']);
const uuid = z.uuid();
const name = (max: number) => z.string().trim().min(1, 'Enter a name').max(max, `Use at most ${max} characters`);

export const organizationSettingsInput = z.object({
  organizationName: name(120),
  timeZone: z.string().trim().refine(isTimeZone, 'Choose a valid time zone, for example America/New_York'),
  locale: z.string().trim().refine(isLocale, 'Choose a valid locale, for example en-US'),
  defaultCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => CURRENCIES.has(v), 'Choose a valid three-letter currency code, for example USD'),
  branding: z.object({
    primaryColor: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #1f4e79'),
    footerText: z.string().trim().max(300, 'Use at most 300 characters'),
  }),
  proposalDefaults: z.object({
    defaultTermMonths: z.number().int('Use a whole number').min(1, 'Must be at least 1').max(120, 'Must be at most 120'),
    defaultValidityDays: z.number().int('Use a whole number').min(1, 'Must be at least 1').max(365, 'Must be at most 365'),
  }),
  automationSettings: z.object({
    followUpAfterDays: z.number().int('Use a whole number').min(1, 'Must be at least 1').max(90, 'Must be at most 90'),
    aut001Enabled: z.boolean(),
    aut002Enabled: z.boolean(),
  }),
  salespersonCrossVisibility: z.object({ companies: visibility, contacts: visibility, deals: visibility }),
});
export type OrganizationSettingsInput = z.infer<typeof organizationSettingsInput>;

const probability = z.number().int('Use a whole number from 0 to 100').min(0, 'Must be at least 0').max(100, 'Must be at most 100');
const stallDays = z.number().int('Use a whole number of days').min(1, 'Must be at least 1 day').max(365, 'Must be at most 365 days').nullable();
export const stageCreateInput = z.object({ name: name(60), probability, stallThresholdDays: stallDays.optional() });
export const stagePatchInput = z
  .object({ name: name(60).optional(), probability: probability.optional(), stallThresholdDays: stallDays.optional() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change');
export const stageOrderInput = z.object({ stageIds: z.array(uuid).min(1).max(100) });

export const lostReasonCreateInput = z.object({ name: name(80) });
export const lostReasonPatchInput = z
  .object({ name: name(80).optional(), isActive: z.boolean().optional() })
  .refine((v) => v.name !== undefined || v.isActive !== undefined, 'Nothing to change');

export const teamCreateInput = z.object({ name: name(80), managerIds: z.array(uuid).max(20).optional() });
export const teamPatchInput = z.object({ name: name(80) });
export const teamMemberInput = z.object({ userId: uuid, move: z.boolean().optional() });
export const teamManagerInput = z.object({ userId: uuid });

export const auditLogQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  actorUserId: uuid.optional(),
  action: z
    .string()
    .trim()
    .max(80)
    .regex(/^[A-Za-z0-9_.-]*$/, 'Use letters, digits, dots, dashes or underscores')
    .optional(),
  targetType: z
    .string()
    .trim()
    .max(60)
    .regex(/^[A-Za-z0-9_.-]*$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Cursor: return entries older than this sequence number (from `nextCursor` of the previous page). */
  before: z.coerce.number().int().min(1).optional(),
});

// ───────────── organization settings (BR-PLT-012) ─────────────
type SettingsRow = typeof organizationSettings.$inferSelect;
/** The editable part of the settings row. AI settings, the lead form key and lead routing belong to other screens. */
const publicSettings = (s: SettingsRow) => ({
  organizationName: s.organizationName,
  timeZone: s.timeZone,
  locale: s.locale,
  defaultCurrency: s.defaultCurrency,
  branding: { primaryColor: s.branding.primaryColor, footerText: s.branding.footerText },
  proposalDefaults: { defaultTermMonths: s.proposalDefaults.defaultTermMonths, defaultValidityDays: s.proposalDefaults.defaultValidityDays },
  automationSettings: {
    followUpAfterDays: s.automationSettings.followUpAfterDays,
    aut001Enabled: s.automationSettings.aut001Enabled,
    aut002Enabled: s.automationSettings.aut002Enabled,
  },
  salespersonCrossVisibility: {
    companies: s.salespersonCrossVisibility.companies,
    contacts: s.salespersonCrossVisibility.contacts,
    deals: s.salespersonCrossVisibility.deals,
  },
});

export async function getOrganizationSettings(ctx: AppContext, actor: UserActor) {
  requirePerm(actor, 'settings.manage');
  const [row] = await ctx.db.select().from(organizationSettings);
  if (!row) throw notFound('Organization settings');
  return { ...publicSettings(row), updatedAt: row.updatedAt };
}

export async function updateOrganizationSettings(ctx: AppContext, actor: UserActor, input: OrganizationSettingsInput) {
  requirePerm(actor, 'settings.manage');
  return unitOfWork(ctx, actor, async (u) => {
    const [row] = await u.tx.select().from(organizationSettings).for('update');
    if (!row) throw notFound('Organization settings');
    const before = publicSettings(row);

    if (input.defaultCurrency !== row.defaultCurrency) {
      // Stored amounts are never converted, so the default may only change while nothing is priced in another currency.
      const [d] = await u.tx.select({ n: sql<number>`count(*)::int` }).from(deal).where(ne(deal.currency, input.defaultCurrency));
      const [p] = await u.tx.select({ n: sql<number>`count(*)::int` }).from(proposal).where(ne(proposal.currency, input.defaultCurrency));
      const deals = d?.n ?? 0;
      const proposals = p?.n ?? 0;
      if (deals + proposals > 0)
        throw rule(
          'CURRENCY_IN_USE',
          `The default currency cannot change to ${input.defaultCurrency}: ${deals} deal(s) and ${proposals} proposal(s) already use another currency, and stored amounts are never converted.`,
          { deals, proposals, currentCurrency: row.defaultCurrency },
        );
    }

    const changedBefore: Record<string, unknown> = {};
    const changedAfter: Record<string, unknown> = {};
    for (const key of Object.keys(before) as (keyof typeof before)[]) {
      if (JSON.stringify(before[key]) !== JSON.stringify(input[key])) {
        changedBefore[key] = before[key];
        changedAfter[key] = input[key];
      }
    }
    if (Object.keys(changedAfter).length === 0) return { ...before, updatedAt: row.updatedAt, changed: false };

    const now = ctx.now();
    await u.tx
      .update(organizationSettings)
      .set({
        organizationName: input.organizationName,
        timeZone: input.timeZone,
        locale: input.locale,
        defaultCurrency: input.defaultCurrency,
        // Spread first so any other stored key survives; this screen edits only the keys it knows.
        branding: { ...row.branding, ...input.branding },
        proposalDefaults: { ...row.proposalDefaults, ...input.proposalDefaults },
        automationSettings: { ...row.automationSettings, ...input.automationSettings },
        salespersonCrossVisibility: input.salespersonCrossVisibility,
        updatedAt: now,
        updatedBy: actor.userId,
        rowVersion: row.rowVersion + 1,
      })
      .where(eq(organizationSettings.id, row.id));
    await u.audit('settings.organization_changed', null, { before: changedBefore, after: changedAfter });
    return { ...input, updatedAt: now, changed: true };
  });
}

// ───────────── pipeline stages (BR-CRM-005) ─────────────
type StageRow = typeof pipelineStage.$inferSelect;
const stageView = (s: StageRow) => ({
  id: s.id,
  name: s.name,
  kind: s.kind,
  sortOrder: s.sortOrder,
  probability: Number(s.probability),
  stallThresholdDays: s.stallThresholdDays,
  isProposalSentTarget: s.isProposalSentTarget,
});
const stageAudit = (s: StageRow) => ({ name: s.name, probability: Number(s.probability), stallThresholdDays: s.stallThresholdDays });

/** The single sales pipeline. Locking it serialises stage changes, so order numbers and the target flag stay consistent. */
async function defaultPipeline(tx: Tx) {
  const rows = await tx.select().from(pipeline).orderBy(desc(pipeline.isDefault), asc(pipeline.createdAt)).for('update');
  if (!rows[0]) throw notFound('Pipeline');
  return rows[0];
}
const stagesOf = (tx: Tx, pipelineId: string) =>
  tx.select().from(pipelineStage).where(eq(pipelineStage.pipelineId, pipelineId)).orderBy(asc(pipelineStage.sortOrder));

/** Rewrites sort_order 1..n in the given order. Goes through negative numbers first because (pipeline, order) is unique. */
async function applyOrder(tx: Tx, pipelineId: string, orderedIds: string[]) {
  await tx.execute(sql`update pipeline_stage set sort_order = -sort_order where pipeline_id = ${pipelineId} and sort_order > 0`);
  for (const [i, id] of orderedIds.entries())
    await tx
      .update(pipelineStage)
      .set({ sortOrder: i + 1 })
      .where(eq(pipelineStage.id, id));
}
/** Open stages in the given order, then Won, then Lost (system stages always come last). */
const fullOrder = (stages: StageRow[], openIds: string[]) => [
  ...openIds,
  ...stages.filter((s) => s.kind === 'won').map((s) => s.id),
  ...stages.filter((s) => s.kind === 'lost').map((s) => s.id),
];
function assertNameFree(stages: StageRow[], candidate: string, exceptId?: string) {
  if (stages.some((s) => s.id !== exceptId && s.name.trim().toLowerCase() === candidate.toLowerCase()))
    throw conflict('STAGE_NAME_TAKEN', `A stage named "${candidate}" already exists`);
}

export async function listStages(ctx: AppContext, actor: UserActor) {
  requirePerm(actor, 'settings.manage');
  const [p] = await ctx.db.select().from(pipeline).orderBy(desc(pipeline.isDefault), asc(pipeline.createdAt)).limit(1);
  if (!p) throw notFound('Pipeline');
  const stages = await ctx.db.select().from(pipelineStage).where(eq(pipelineStage.pipelineId, p.id)).orderBy(asc(pipelineStage.sortOrder));
  const counts = await ctx.db.select({ stageId: deal.stageId, n: sql<number>`count(*)::int` }).from(deal).groupBy(deal.stageId);
  const byStage = new Map(counts.map((c) => [c.stageId, c.n]));
  return { pipeline: { id: p.id, name: p.name }, stages: stages.map((s) => ({ ...stageView(s), dealCount: byStage.get(s.id) ?? 0 })) };
}

export async function createStage(ctx: AppContext, actor: UserActor, input: z.infer<typeof stageCreateInput>) {
  requirePerm(actor, 'settings.manage');
  return unitOfWork(ctx, actor, async (u) => {
    const p = await defaultPipeline(u.tx);
    const stages = await stagesOf(u.tx, p.id);
    assertNameFree(stages, input.name);
    const next = Math.max(0, ...stages.map((s) => Math.abs(s.sortOrder))) + 1;
    const [created] = await u.tx
      .insert(pipelineStage)
      .values({
        pipelineId: p.id,
        name: input.name,
        kind: 'open',
        sortOrder: next,
        probability: String(input.probability),
        stallThresholdDays: input.stallThresholdDays ?? null,
      })
      .returning();
    // A new stage becomes the last open stage, in front of Closed Won / Closed Lost.
    await applyOrder(u.tx, p.id, fullOrder(stages, [...stages.filter((s) => s.kind === 'open').map((s) => s.id), created!.id]));
    await u.audit('pipeline.stage_created', { type: 'pipeline_stage', id: created!.id }, { after: stageAudit(created!) });
    const [fresh] = await u.tx.select().from(pipelineStage).where(eq(pipelineStage.id, created!.id));
    return stageView(fresh!);
  });
}

async function loadStage(tx: Tx, stageId: string) {
  const p = await defaultPipeline(tx);
  const stages = await stagesOf(tx, p.id);
  const stage = stages.find((s) => s.id === stageId);
  if (!stage) throw notFound('Stage');
  return { p, stages, stage };
}

export async function updateStage(ctx: AppContext, actor: UserActor, stageId: string, input: z.infer<typeof stagePatchInput>) {
  requirePerm(actor, 'settings.manage');
  return unitOfWork(ctx, actor, async (u) => {
    const { stages, stage } = await loadStage(u.tx, stageId);
    if (stage.kind !== 'open') {
      if (input.probability !== undefined && input.probability !== Number(stage.probability))
        throw conflict('SYSTEM_STAGE_IMMUTABLE', 'The win probability of the Won and Lost stages is fixed (100% and 0%)');
      if (input.stallThresholdDays !== undefined && input.stallThresholdDays !== null)
        throw conflict('SYSTEM_STAGE_IMMUTABLE', 'Closed stages cannot have a stall threshold');
    }
    if (input.name !== undefined) assertNameFree(stages, input.name, stage.id);
    const [after] = await u.tx
      .update(pipelineStage)
      .set({
        name: input.name ?? stage.name,
        probability: input.probability === undefined ? stage.probability : String(input.probability),
        stallThresholdDays: input.stallThresholdDays === undefined ? stage.stallThresholdDays : input.stallThresholdDays,
      })
      .where(eq(pipelineStage.id, stage.id))
      .returning();
    await u.audit('pipeline.stage_updated', { type: 'pipeline_stage', id: stage.id }, { before: stageAudit(stage), after: stageAudit(after!) });
    return stageView(after!);
  });
}

export async function reorderStages(ctx: AppContext, actor: UserActor, stageIds: string[]) {
  requirePerm(actor, 'settings.manage');
  return unitOfWork(ctx, actor, async (u) => {
    const p = await defaultPipeline(u.tx);
    const stages = await stagesOf(u.tx, p.id);
    const open = stages.filter((s) => s.kind === 'open');
    const wanted = new Set(stageIds);
    if (wanted.size !== stageIds.length || wanted.size !== open.length || open.some((s) => !wanted.has(s.id)))
      throw rule('STAGE_ORDER_INVALID', 'The new order must list every open stage exactly once. Closed Won and Closed Lost always stay last.');
    await applyOrder(u.tx, p.id, fullOrder(stages, stageIds));
    const nameOf = new Map(stages.map((s) => [s.id, s.name]));
    await u.audit('pipeline.stages_reordered', null, { before: open.map((s) => s.name), after: stageIds.map((id) => nameOf.get(id)) });
    return (await stagesOf(u.tx, p.id)).map(stageView);
  });
}

/** Exactly one open stage is the "proposal sent" target used by automation AUT-001. */
export async function setProposalSentTarget(ctx: AppContext, actor: UserActor, stageId: string) {
  requirePerm(actor, 'settings.manage');
  return unitOfWork(ctx, actor, async (u) => {
    const { p, stages, stage } = await loadStage(u.tx, stageId);
    if (stage.kind !== 'open') throw rule('STAGE_NOT_OPEN', 'Only an open stage can be the "proposal sent" stage');
    const previous = stages.filter((s) => s.isProposalSentTarget);
    if (previous.length === 1 && previous[0]?.id === stage.id) return stageView(stage);
    await u.tx
      .update(pipelineStage)
      .set({ isProposalSentTarget: false })
      .where(and(eq(pipelineStage.pipelineId, p.id), ne(pipelineStage.id, stage.id)));
    await u.tx.update(pipelineStage).set({ isProposalSentTarget: true }).where(eq(pipelineStage.id, stage.id));
    await u.audit(
      'pipeline.proposal_sent_target_changed',
      { type: 'pipeline_stage', id: stage.id },
      { before: { stage: previous.map((s) => s.name).join(', ') || null }, after: { stage: stage.name } },
    );
    return stageView({ ...stage, isProposalSentTarget: true });
  });
}

export async function deleteStage(ctx: AppContext, actor: UserActor, stageId: string) {
  requirePerm(actor, 'settings.manage');
  return unitOfWork(ctx, actor, async (u) => {
    const { p, stages, stage } = await loadStage(u.tx, stageId);
    if (stage.kind !== 'open') throw conflict('SYSTEM_STAGE_IMMUTABLE', 'The Won and Lost stages cannot be removed');
    if (stage.isProposalSentTarget)
      throw rule('STAGE_IS_PROPOSAL_TARGET', 'This is the "proposal sent" stage. Choose another stage for that first, then remove this one.');
    const open = stages.filter((s) => s.kind === 'open');
    if (open.length <= 1) throw rule('LAST_OPEN_STAGE', 'The pipeline needs at least one open stage');
    const [d] = await u.tx.select({ n: sql<number>`count(*)::int` }).from(deal).where(eq(deal.stageId, stage.id));
    if ((d?.n ?? 0) > 0)
      throw conflict('STAGE_HAS_DEALS', `This stage cannot be removed: ${d?.n} deal(s) are in it. Move them to another stage first.`, { deals: d?.n });
    const [h] = await u.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(dealStageHistory)
      .where(or(eq(dealStageHistory.toStageId, stage.id), eq(dealStageHistory.fromStageId, stage.id)));
    if ((h?.n ?? 0) > 0)
      throw conflict(
        'STAGE_HAS_HISTORY',
        'This stage cannot be removed because deals have passed through it and their history refers to it. Rename it instead.',
        {
          historyEntries: h?.n,
        },
      );
    await u.tx.delete(pipelineStage).where(eq(pipelineStage.id, stage.id));
    await applyOrder(
      u.tx,
      p.id,
      fullOrder(
        stages.filter((s) => s.id !== stage.id),
        open.filter((s) => s.id !== stage.id).map((s) => s.id),
      ),
    );
    await u.audit('pipeline.stage_deleted', { type: 'pipeline_stage', id: stage.id }, { before: stageAudit(stage) });
    return { id: stage.id, deleted: true };
  });
}

// ───────────── lost reasons (BR-CRM-014) ─────────────
export async function listLostReasons(ctx: AppContext, actor: UserActor) {
  requirePerm(actor, 'settings.manage');
  const rows = await ctx.db.select().from(lostReasonAdmin).orderBy(asc(lostReasonAdmin.name));
  const used = await ctx.db
    .select({ id: deal.lostReasonId, n: sql<number>`count(*)::int` })
    .from(deal)
    .where(sql`${deal.lostReasonId} is not null`)
    .groupBy(deal.lostReasonId);
  const byReason = new Map(used.map((r) => [r.id, r.n]));
  return rows.map((r) => ({ ...r, dealCount: byReason.get(r.id) ?? 0 }));
}

async function assertReasonNameFree(tx: Tx, candidate: string, exceptId?: string) {
  const rows = await tx.select({ id: lostReasonAdmin.id }).from(lostReasonAdmin).where(sql`lower(${lostReasonAdmin.name}) = ${candidate.toLowerCase()}`);
  if (rows.some((r) => r.id !== exceptId)) throw conflict('LOST_REASON_NAME_TAKEN', `A lost reason named "${candidate}" already exists`);
}

export async function createLostReason(ctx: AppContext, actor: UserActor, input: z.infer<typeof lostReasonCreateInput>) {
  requirePerm(actor, 'settings.manage');
  return unitOfWork(ctx, actor, async (u) => {
    await u.tx.execute(sql`select pg_advisory_xact_lock(727014)`);
    await assertReasonNameFree(u.tx, input.name);
    const [row] = await u.tx.insert(lostReasonAdmin).values({ name: input.name }).returning();
    await u.audit('lost_reason.created', { type: 'lost_reason', id: row!.id }, { after: { name: row!.name, isActive: true } });
    return { ...row!, dealCount: 0 };
  });
}

/** Rename and/or retire. A retired reason stays on the deals that already use it; it is only withdrawn from new choices. */
export async function updateLostReason(ctx: AppContext, actor: UserActor, reasonId: string, input: z.infer<typeof lostReasonPatchInput>) {
  requirePerm(actor, 'settings.manage');
  return unitOfWork(ctx, actor, async (u) => {
    await u.tx.execute(sql`select pg_advisory_xact_lock(727014)`);
    const [row] = await u.tx.select().from(lostReasonAdmin).where(eq(lostReasonAdmin.id, reasonId));
    if (!row) throw notFound('Lost reason');
    if (input.name !== undefined && input.name !== row.name) await assertReasonNameFree(u.tx, input.name, row.id);
    if (input.isActive === false && row.isActive) {
      const [active] = await u.tx
        .select({ n: sql<number>`count(*)::int` })
        .from(lostReasonAdmin)
        .where(and(eq(lostReasonAdmin.isActive, true), ne(lostReasonAdmin.id, row.id)));
      if ((active?.n ?? 0) === 0) throw rule('LAST_LOST_REASON', 'At least one lost reason must stay active, because closing a deal as lost requires a reason');
    }
    const [after] = await u.tx
      .update(lostReasonAdmin)
      .set({ name: input.name ?? row.name, isActive: input.isActive ?? row.isActive })
      .where(eq(lostReasonAdmin.id, row.id))
      .returning();
    const action = input.isActive === undefined || input.isActive === row.isActive ? 'updated' : input.isActive ? 'reactivated' : 'deactivated';
    await u.audit(
      `lost_reason.${action}`,
      { type: 'lost_reason', id: row.id },
      { before: { name: row.name, isActive: row.isActive }, after: { name: after!.name, isActive: after!.isActive } },
    );
    return after!;
  });
}

/** Only a reason no deal has ever used can be removed; a used one is deactivated instead, so history keeps its meaning. */
export async function deleteLostReason(ctx: AppContext, actor: UserActor, reasonId: string) {
  requirePerm(actor, 'settings.manage');
  return unitOfWork(ctx, actor, async (u) => {
    await u.tx.execute(sql`select pg_advisory_xact_lock(727014)`);
    const [row] = await u.tx.select().from(lostReasonAdmin).where(eq(lostReasonAdmin.id, reasonId));
    if (!row) throw notFound('Lost reason');
    const [used] = await u.tx.select({ n: sql<number>`count(*)::int` }).from(deal).where(eq(deal.lostReasonId, row.id));
    if ((used?.n ?? 0) > 0)
      throw conflict('LOST_REASON_IN_USE', `"${row.name}" cannot be removed: ${used?.n} deal(s) were lost for this reason. Deactivate it instead.`, {
        deals: used?.n,
      });
    if (row.isActive) {
      const [active] = await u.tx
        .select({ n: sql<number>`count(*)::int` })
        .from(lostReasonAdmin)
        .where(and(eq(lostReasonAdmin.isActive, true), ne(lostReasonAdmin.id, row.id)));
      if ((active?.n ?? 0) === 0) throw rule('LAST_LOST_REASON', 'At least one lost reason must stay active, because closing a deal as lost requires a reason');
    }
    await u.tx.delete(lostReasonAdmin).where(eq(lostReasonAdmin.id, row.id));
    await u.audit('lost_reason.deleted', { type: 'lost_reason', id: row.id }, { before: { name: row.name, isActive: row.isActive } });
    return { id: row.id, deleted: true };
  });
}

// ───────────── teams and managers (BR-PLT-006) ─────────────
/** An empty team (no members, no managers) can be removed. */
export async function deleteTeam(ctx: AppContext, actor: UserActor, teamId: string) {
  requirePerm(actor, 'settings.manage');
  return unitOfWork(ctx, actor, async (u) => {
    const t = await loadTeam(u.tx, teamId);
    const members = await u.tx.select({ userId: teamMembership.userId }).from(teamMembership).where(eq(teamMembership.teamId, t.id));
    const managers = await u.tx.select({ userId: teamManager.userId }).from(teamManager).where(eq(teamManager.teamId, t.id));
    if (members.length + managers.length > 0)
      throw rule('TEAM_NOT_EMPTY', `Team "${t.name}" still has ${members.length} member(s) and ${managers.length} manager(s). Remove them first.`, {
        members: members.length,
        managers: managers.length,
      });
    await u.tx.delete(team).where(eq(team.id, t.id));
    await u.audit('team.deleted', { type: 'team', id: t.id }, { before: { name: t.name } });
    return { id: t.id, deleted: true };
  });
}

export async function listTeams(ctx: AppContext, actor: UserActor) {
  requirePerm(actor, 'settings.manage');
  const teams = await ctx.db.select({ id: team.id, name: team.name, archivedAt: team.archivedAt }).from(team).orderBy(asc(team.name));
  const person = { userId: appUserProfile.userId, fullName: appUserProfile.fullName, email: appUserProfile.email, role: appUserProfile.role };
  const members = await ctx.db
    .select({ teamId: teamMembership.teamId, ...person, status: appUserProfile.status })
    .from(teamMembership)
    .innerJoin(appUserProfile, eq(appUserProfile.userId, teamMembership.userId))
    .orderBy(asc(appUserProfile.fullName));
  const managers = await ctx.db
    .select({ teamId: teamManager.teamId, ...person, status: appUserProfile.status })
    .from(teamManager)
    .innerJoin(appUserProfile, eq(appUserProfile.userId, teamManager.userId))
    .orderBy(asc(appUserProfile.fullName));
  const strip = <T extends { teamId: string }>({ teamId: _teamId, ...rest }: T) => rest;
  return teams.map((t) => ({
    ...t,
    members: members.filter((m) => m.teamId === t.id).map(strip),
    managers: managers.filter((m) => m.teamId === t.id).map(strip),
  }));
}

async function assertTeamNameFree(tx: Tx, candidate: string, exceptId?: string) {
  const rows = await tx.select({ id: team.id }).from(team).where(sql`lower(${team.name}) = ${candidate.toLowerCase()}`);
  if (rows.some((r) => r.id !== exceptId)) throw conflict('TEAM_NAME_TAKEN', `A team named "${candidate}" already exists`);
}
async function loadTeam(tx: Tx, teamId: string) {
  const [row] = await tx.select().from(team).where(eq(team.id, teamId)).for('update');
  if (!row) throw notFound('Team');
  return row;
}
async function loadUser(tx: Tx, userId: string) {
  const [row] = await tx.select().from(appUserProfile).where(eq(appUserProfile.userId, userId));
  if (!row) throw notFound('User');
  return row;
}
/** RULE-PLT-13: only Sales Managers (or Admins) can manage a team. */
function assertCanManage(user: typeof appUserProfile.$inferSelect) {
  if (user.status === 'deactivated') throw rule('USER_INACTIVE', `${user.fullName} is deactivated and cannot manage a team`);
  if (user.role !== 'sales_manager' && user.role !== 'admin')
    throw rule('MANAGER_ROLE_REQUIRED', `${user.fullName} is a Salesperson. Change their role to Sales Manager before making them a team manager.`);
}

export async function createTeam(ctx: AppContext, actor: UserActor, input: z.infer<typeof teamCreateInput>) {
  requirePerm(actor, 'settings.manage');
  return unitOfWork(ctx, actor, async (u) => {
    await u.tx.execute(sql`select pg_advisory_xact_lock(727006)`);
    await assertTeamNameFree(u.tx, input.name);
    const managerIds = [...new Set(input.managerIds ?? [])];
    for (const id of managerIds) assertCanManage(await loadUser(u.tx, id));
    const [row] = await u.tx.insert(team).values({ name: input.name, createdBy: actor.userId, updatedBy: actor.userId }).returning();
    if (managerIds.length) await u.tx.insert(teamManager).values(managerIds.map((userId) => ({ teamId: row!.id, userId })));
    await u.audit('team.created', { type: 'team', id: row!.id }, { after: { name: row!.name, managerIds } });
    return { id: row!.id, name: row!.name };
  });
}

export async function renameTeam(ctx: AppContext, actor: UserActor, teamId: string, input: z.infer<typeof teamPatchInput>) {
  requirePerm(actor, 'settings.manage');
  return unitOfWork(ctx, actor, async (u) => {
    await u.tx.execute(sql`select pg_advisory_xact_lock(727006)`);
    const row = await loadTeam(u.tx, teamId);
    if (input.name === row.name) return { id: row.id, name: row.name };
    await assertTeamNameFree(u.tx, input.name, row.id);
    await u.tx
      .update(team)
      .set({ name: input.name, updatedAt: ctx.now(), updatedBy: actor.userId, rowVersion: row.rowVersion + 1 })
      .where(eq(team.id, row.id));
    await u.audit('team.renamed', { type: 'team', id: row.id }, { before: { name: row.name }, after: { name: input.name } });
    return { id: row.id, name: input.name };
  });
}

/** RULE-PLT-12: a user belongs to at most one team. Moving from another team needs `move: true` (the screen asks first). */
export async function addTeamMember(ctx: AppContext, actor: UserActor, teamId: string, input: z.infer<typeof teamMemberInput>) {
  requirePerm(actor, 'settings.manage');
  return unitOfWork(ctx, actor, async (u) => {
    const t = await loadTeam(u.tx, teamId);
    const user = await loadUser(u.tx, input.userId);
    if (user.status === 'deactivated') throw rule('USER_INACTIVE', `${user.fullName} is deactivated and cannot be added to a team`);
    const [current] = await u.tx.select().from(teamMembership).where(eq(teamMembership.userId, user.userId)).for('update');
    if (current?.teamId === t.id && current.isActive) return { teamId: t.id, userId: user.userId, changed: false };
    if (current && current.teamId !== t.id && !input.move) {
      const [other] = await u.tx.select({ name: team.name }).from(team).where(eq(team.id, current.teamId));
      throw conflict(
        'TEAM_MEMBERSHIP_CONFLICT',
        `${user.fullName} is already in team "${other?.name ?? 'another team'}". Confirm to move them to "${t.name}".`,
        {
          currentTeamId: current.teamId,
          currentTeamName: other?.name,
        },
      );
    }
    if (current) await u.tx.update(teamMembership).set({ teamId: t.id, isActive: true }).where(eq(teamMembership.userId, user.userId));
    else await u.tx.insert(teamMembership).values({ userId: user.userId, teamId: t.id });
    await u.audit(
      'team.member_added',
      { type: 'team', id: t.id },
      { before: { teamId: current?.teamId ?? null }, after: { teamId: t.id }, userId: user.userId, userName: user.fullName },
    );
    return { teamId: t.id, userId: user.userId, changed: true };
  });
}

export async function removeTeamMember(ctx: AppContext, actor: UserActor, teamId: string, userId: string) {
  requirePerm(actor, 'settings.manage');
  return unitOfWork(ctx, actor, async (u) => {
    const t = await loadTeam(u.tx, teamId);
    const removed = await u.tx
      .delete(teamMembership)
      .where(and(eq(teamMembership.userId, userId), eq(teamMembership.teamId, t.id)))
      .returning();
    if (!removed.length) throw notFound('Team member');
    const [user] = await u.tx.select({ fullName: appUserProfile.fullName }).from(appUserProfile).where(eq(appUserProfile.userId, userId));
    await u.audit('team.member_removed', { type: 'team', id: t.id }, { before: { teamId: t.id }, after: { teamId: null }, userId, userName: user?.fullName });
    return { teamId: t.id, userId, changed: true };
  });
}

export async function addTeamManager(ctx: AppContext, actor: UserActor, teamId: string, input: z.infer<typeof teamManagerInput>) {
  requirePerm(actor, 'settings.manage');
  return unitOfWork(ctx, actor, async (u) => {
    const t = await loadTeam(u.tx, teamId);
    const user = await loadUser(u.tx, input.userId);
    assertCanManage(user);
    const added = await u.tx.insert(teamManager).values({ teamId: t.id, userId: user.userId }).onConflictDoNothing().returning();
    if (!added.length) return { teamId: t.id, userId: user.userId, changed: false };
    await u.audit('team.manager_added', { type: 'team', id: t.id }, { userId: user.userId, userName: user.fullName });
    return { teamId: t.id, userId: user.userId, changed: true };
  });
}

export async function removeTeamManager(ctx: AppContext, actor: UserActor, teamId: string, userId: string) {
  requirePerm(actor, 'settings.manage');
  return unitOfWork(ctx, actor, async (u) => {
    const t = await loadTeam(u.tx, teamId);
    const managers = await u.tx.select().from(teamManager).where(eq(teamManager.teamId, t.id));
    if (!managers.some((m) => m.userId === userId)) throw notFound('Team manager');
    if (managers.length === 1) {
      // RULE-PLT-12: a team that still has members keeps at least one manager, so nobody's records fall out of team scope.
      const [members] = await u.tx
        .select({ n: sql<number>`count(*)::int` })
        .from(teamMembership)
        .where(and(eq(teamMembership.teamId, t.id), eq(teamMembership.isActive, true)));
      if ((members?.n ?? 0) > 0)
        throw rule('TEAM_MANAGER_REQUIRED', 'A team with members needs at least one manager. Add another manager first, or remove the members.');
    }
    await u.tx.delete(teamManager).where(and(eq(teamManager.teamId, t.id), eq(teamManager.userId, userId)));
    const [user] = await u.tx.select({ fullName: appUserProfile.fullName }).from(appUserProfile).where(eq(appUserProfile.userId, userId));
    await u.audit('team.manager_removed', { type: 'team', id: t.id }, { userId, userName: user?.fullName });
    return { teamId: t.id, userId, changed: true };
  });
}

// ───────────── audit log viewer (BR-PLT-009) — read-only ─────────────
/** Key names whose values are never shown ("tokens" as a count, e.g. AI usage, is not a secret). */
const SECRET_KEY = /password|passphrase|passwd|secret|token(?!s)|authori[sz]ation|cookie|credential|signature|hash|key$|^key/i;
const REDACTED = '[hidden]';

/** Removes anything that looks like a credential from a stored change set before it leaves the server. */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 8) return REDACTED;
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEY.test(k) && v !== null ? REDACTED : redactSecrets(v, depth + 1)]),
    );
  return value;
}

const label = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_.]/g, ' ')
    .toLowerCase();
function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'empty';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return v.map(show).join(', ') || 'none';
  if (typeof v === 'object')
    return Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${label(k)} ${show(x)}`)
      .join(', ');
  const s = String(v);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** One readable sentence per changed field, e.g. "organization name: Northwind → Northwind Ltd". */
export function summarizeChanges(changes: unknown): string[] {
  if (changes === null || changes === undefined) return [];
  if (!isRecord(changes)) return [show(changes)];
  const out: string[] = [];
  const { before, after, ...rest } = changes;
  if (before !== undefined || after !== undefined) {
    if (isRecord(before) || isRecord(after)) {
      const b = isRecord(before) ? before : {};
      const a = isRecord(after) ? after : {};
      for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
        if (JSON.stringify(b[key]) === JSON.stringify(a[key])) continue;
        if (isRecord(b[key]) && isRecord(a[key])) {
          const nb = b[key] as Record<string, unknown>;
          const na = a[key] as Record<string, unknown>;
          for (const sub of new Set([...Object.keys(nb), ...Object.keys(na)]))
            if (JSON.stringify(nb[sub]) !== JSON.stringify(na[sub])) out.push(`${label(key)} · ${label(sub)}: ${show(nb[sub])} → ${show(na[sub])}`);
        } else if (!(key in b)) out.push(`${label(key)}: ${show(a[key])}`);
        else if (!(key in a)) out.push(`${label(key)}: was ${show(b[key])}`);
        else out.push(`${label(key)}: ${show(b[key])} → ${show(a[key])}`);
      }
    } else out.push(`${show(before)} → ${show(after)}`);
  }
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) out.push(`${label(k)}: ${show(v)}`);
  return out.slice(0, 20);
}

const ACTOR_LABEL: Record<string, string> = { system: 'Automation', buyer: 'Buyer', ai: 'AI assistant', user: 'Unknown user' };

export async function listAuditLog(ctx: AppContext, actor: UserActor, q: z.infer<typeof auditLogQuery>) {
  requirePerm(actor, 'audit.view');
  if (q.from && q.to && q.from > q.to) throw rule('DATE_RANGE_INVALID', 'The start date must be before the end date');
  const where: SQL[] = [];
  if (q.from) where.push(gte(auditLog.occurredAt, q.from));
  if (q.to) where.push(lte(auditLog.occurredAt, q.to));
  if (q.actorUserId) where.push(eq(auditLog.actorUserId, q.actorUserId));
  if (q.action) where.push(like(auditLog.action, `${q.action.replace(/[\\%_]/g, '\\$&')}%`));
  if (q.targetType) where.push(eq(auditLog.targetType, q.targetType));
  if (q.before) where.push(lt(auditLog.seq, q.before));
  const rows = await ctx.db
    .select({
      id: auditLog.id,
      seq: auditLog.seq,
      occurredAt: auditLog.occurredAt,
      actorType: auditLog.actorType,
      actorUserId: auditLog.actorUserId,
      actorName: appUserProfile.fullName,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      changes: auditLog.changes,
      outcome: auditLog.outcome,
    })
    .from(auditLog)
    .leftJoin(appUserProfile, eq(appUserProfile.userId, auditLog.actorUserId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(auditLog.seq))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);

  // Friendly names for the targets on this page (only for the record types this module can name safely).
  const idsOf = (type: string) => [...new Set(page.filter((r) => r.targetType === type && r.targetId).map((r) => r.targetId as string))];
  const names = new Map<string, string>();
  const collect = (list: { id: string; name: string }[]) => {
    for (const r of list) names.set(r.id, r.name);
  };
  const userIds = idsOf('user');
  if (userIds.length)
    collect(
      await ctx.db.select({ id: appUserProfile.userId, name: appUserProfile.fullName }).from(appUserProfile).where(inArray(appUserProfile.userId, userIds)),
    );
  const teamIds = idsOf('team');
  if (teamIds.length) collect(await ctx.db.select({ id: team.id, name: team.name }).from(team).where(inArray(team.id, teamIds)));
  const stageIds = idsOf('pipeline_stage');
  if (stageIds.length)
    collect(await ctx.db.select({ id: pipelineStage.id, name: pipelineStage.name }).from(pipelineStage).where(inArray(pipelineStage.id, stageIds)));
  const reasonIds = idsOf('lost_reason');
  if (reasonIds.length)
    collect(await ctx.db.select({ id: lostReasonAdmin.id, name: lostReasonAdmin.name }).from(lostReasonAdmin).where(inArray(lostReasonAdmin.id, reasonIds)));
  const dealIds = idsOf('deal');
  if (dealIds.length) collect(await ctx.db.select({ id: deal.id, name: deal.name }).from(deal).where(inArray(deal.id, dealIds)));

  return {
    items: page.map((r) => {
      const changes = redactSecrets(r.changes);
      return {
        id: r.id,
        seq: r.seq,
        occurredAt: r.occurredAt,
        actorType: r.actorType,
        actorUserId: r.actorUserId,
        actorName: r.actorName ?? ACTOR_LABEL[r.actorType] ?? r.actorType,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        targetName: r.targetId ? (names.get(r.targetId) ?? null) : null,
        outcome: r.outcome,
        summary: summarizeChanges(changes),
        changes,
      };
    }),
    nextCursor: rows.length > q.limit ? (page.at(-1)?.seq ?? null) : null,
  };
}

/** Values for the viewer's filter lists: target types and people that actually appear in the log. */
export async function auditLogFilters(ctx: AppContext, actor: UserActor) {
  requirePerm(actor, 'audit.view');
  const types = await ctx.db
    .selectDistinct({ targetType: auditLog.targetType })
    .from(auditLog)
    .where(sql`${auditLog.targetType} is not null`)
    .orderBy(asc(auditLog.targetType));
  const actors = await ctx.db
    .selectDistinct({ userId: appUserProfile.userId, fullName: appUserProfile.fullName })
    .from(auditLog)
    .innerJoin(appUserProfile, eq(appUserProfile.userId, auditLog.actorUserId))
    .orderBy(asc(appUserProfile.fullName));
  return { targetTypes: types.map((t) => t.targetType as string), actors };
}
