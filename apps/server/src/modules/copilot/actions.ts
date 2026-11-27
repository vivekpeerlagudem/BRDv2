/**
 * The Copilot's write tools and the action ledger (agent_action).
 *
 * Every write the model proposes reaches `handleWrite` only after the policy engine (policy.ts) has checked the role,
 * the arguments and the call caps. Here the remaining rules apply, all in code:
 *   - AUTO (create_task, add_ai_note, set_lead_score): runs now as the user, recorded with an Undo recipe (7 days).
 *     It becomes an APPROVAL card instead when the admin switched that tool's autonomy off, or when the turn has read
 *     outside text and the write carries model-written free text (taint, principle P5′). At most 5 auto writes per
 *     chat turn and 20 per background run.
 *   - APPROVAL: a card is recorded; nothing changes until the user approves. Approve re-runs the same CRM service with
 *     the approver's own actor, so permissions are checked again at click time. Cards expire after 24 h or when the
 *     record's rowVersion changes.
 *   - DRAFT: the existing "AI suggestion a person accepts" feature (follow-up e-mail drafts). Nothing is sent.
 *   - NEVER: there is no tool for send, share, sign, close-won, delete, import, approvals of briefs/reports, settings
 *     or roles. This file must not import the sharing, e-sign or e-mail modules (dependency-rule test).
 */
import { createHash } from 'node:crypto';
import { LEAD_SCORE_TAGS, leadQualificationFields } from '@crm/shared';
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { agentAction, agentRun, recordScore, type UndoRecipe } from '../../db/schema-copilot.ts';
import { type AppContext, conflict, notFound, ownerScope, rule, schema, type Tx, type UserActor, unitOfWork } from '../../platform/core.ts';
import { DomainError } from '../../platform/errors/domain-error.ts';
import * as ai from '../ai.ts';
import * as crm from '../crm.ts';
import { reversalConflicts } from '../domain.ts';
import { type ActionEvent, CAPS, setWriteHandler } from './policy.ts';
import { SCORING_VERSION, type ScoreInput, scoreLead } from './scoring.ts';
import { loadCopilotSettings } from './settings.ts';
import { cleanAnswer, looksLikeInjection } from './text.ts';
import { ALL, notVisible, type RecordRef, refInput, registerTools, type Tier, type ToolDef, type ToolEnv } from './tools.ts';

const HOUR = 3_600_000;
const CARD_TTL_MS = 24 * HOUR;
const UNDO_MS = 7 * 24 * HOUR;
const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), 'Not a real calendar date');
/** Today in the organization's time zone (the session block tells the model the same date). */
const orgToday = (env: ToolEnv) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: env.settings.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(env.ctx.now());

type TargetType = 'deal' | 'lead' | 'company' | 'contact';
interface Prepared {
  /** Resolved, concrete arguments (real ids): what Approve will execute. Never contains aliases. */
  args: Record<string, unknown>;
  target: { type: TargetType; id: string } | null;
  /** The record's rowVersion when the card was made (approval cards expire if it changes). */
  rowVersion: number | null;
  summary: string;
  /** True when the write carries text the model wrote (titles, notes, reasons). */
  freeText: boolean;
}
interface Executed {
  result: Record<string, unknown>;
  undo?: UndoRecipe | null;
  /** What the model is told (besides the status). */
  note?: Record<string, unknown>;
}
interface WriteTool {
  def: ToolDef;
  prepare(env: ToolEnv, input: Record<string, unknown>): Promise<Prepared>;
  execute(ctx: AppContext, actor: UserActor, args: Record<string, unknown>, meta: { actionId: string; runId: string | null }): Promise<Executed>;
}
const WRITES = new Map<string, WriteTool>();
function write<S extends z.ZodObject>(
  def: Omit<ToolDef<S>, 'run'>,
  prepare: (env: ToolEnv, input: z.infer<S>) => Promise<Prepared>,
  execute: WriteTool['execute'],
): ToolDef {
  const full = {
    ...def,
    run: async () => {
      throw new Error('write tools run through the action ledger');
    },
  } as unknown as ToolDef;
  WRITES.set(def.name, { def: full, prepare: prepare as WriteTool['prepare'], execute });
  return full;
}

// ───────────────────────── helpers ─────────────────────────
const quote = (s: string) => `"${s.length > 60 ? `${s.slice(0, 60)}…` : s}"`;
/** Model-written free text: plain text only (no links, images, markup), length-capped. */
const plain = (s: string, max: number) => cleanAnswer(s).text.replace(/\s+/g, ' ').trim().slice(0, max);

/** Resolves an alias to a deal, company or person the user can see — through the scoped services. */
async function relatedRecord(env: ToolEnv, alias: string): Promise<RecordRef & { type: 'deal' | 'company' | 'contact'; rowVersion: number }> {
  const ref = env.turn.aliases.resolve(alias, 'deal', 'company', 'contact', 'lead');
  if (ref.type === 'lead') throw rule('UNSUPPORTED_TARGET', 'Tasks, notes and activities go on a deal, company or person, not on a lead.');
  const { ctx, actor } = env;
  if (ref.type === 'deal') return { ...ref, type: 'deal', rowVersion: (await crm.getDeal(ctx, actor, ref.id)).rowVersion };
  if (ref.type === 'company') return { ...ref, type: 'company', rowVersion: (await crm.getCompany(ctx, actor, ref.id)).rowVersion };
  return { ...ref, type: 'contact', rowVersion: (await crm.getContact(ctx, actor, ref.id)).rowVersion };
}
async function visibleLead(env: ToolEnv, alias: string) {
  const ref = env.turn.aliases.resolve(alias, 'lead');
  const lead = await crm.getLead(env.ctx, env.actor, ref.id);
  return { ref, lead };
}
async function visibleDeal(env: ToolEnv, alias: string) {
  const ref = env.turn.aliases.resolve(alias, 'deal');
  const deal = await crm.getDeal(env.ctx, env.actor, ref.id);
  return { ref, deal };
}
/** Current rowVersion of a record (null when it has none or is gone). Used only to compare with the card. */
async function currentVersion(ctx: AppContext, target: { type: string; id: string }): Promise<number | null> {
  const table = { deal: schema.deal, lead: schema.lead, company: schema.company, contact: schema.contact }[target.type as TargetType];
  if (!table) return null;
  const [row] = await ctx.db.select({ v: table.rowVersion }).from(table).where(eq(table.id, target.id));
  return row?.v ?? null;
}

// ───────────────────────── scoring input ─────────────────────────
/** Builds the scoring input for a lead row, or for a web-form deal (answers in the submission payload). */
export async function scoreInputFor(ctx: AppContext, actor: UserActor, target: { type: 'lead' | 'deal'; id: string }): Promise<ScoreInput> {
  const now = ctx.now().getTime();
  const daysSince = (d: Date | null | undefined) => (d ? Math.max(0, Math.floor((now - new Date(d).getTime()) / 86_400_000)) : null);
  const customer = async (companyName: string | null, companyId?: string | null) => {
    const where = companyId ? eq(schema.company.id, companyId) : companyName ? sql`lower(${schema.company.name}) = lower(${companyName})` : null;
    if (!where) return false;
    const [row] = await ctx.db
      .select({ id: schema.deal.id })
      .from(schema.deal)
      .innerJoin(schema.company, eq(schema.company.id, schema.deal.companyId))
      // Only won deals the user may see count: a hidden record must not show up even as a score factor.
      .where(and(where, eq(schema.deal.status, 'won'), ownerScope(actor, schema.deal.ownerId, 'deals')))
      .limit(1);
    return Boolean(row);
  };
  if (target.type === 'lead') {
    const [l] = await ctx.db.select().from(schema.lead).where(eq(schema.lead.id, target.id));
    if (!l) throw notVisible();
    let activity: Date | null = null;
    let viewed = false;
    if (l.convertedDealId) {
      const [d] = await ctx.db.select({ at: schema.deal.lastActivityAt }).from(schema.deal).where(eq(schema.deal.id, l.convertedDealId));
      activity = d?.at ?? null;
      viewed = await proposalViewed(ctx, l.convertedDealId);
    }
    return {
      industry: l.industry,
      currentPlatform: l.currentPlatform,
      companySizeBand: l.companySizeBand,
      serviceInterest: l.serviceInterest,
      budgetBand: l.budgetBand,
      timeline: l.timeline,
      source: l.source,
      name: l.name,
      email: l.email,
      jobTitle: l.jobTitle,
      companyIsCustomer: await customer(l.companyName),
      spam: false,
      suspectedInjection: [l.name, l.companyName, l.jobTitle, l.notes].some((t) => t && looksLikeInjection(t)),
      daysSinceActivity: daysSince(activity),
      proposalViewed: viewed,
    };
  }
  const [d] = await ctx.db.select().from(schema.deal).where(eq(schema.deal.id, target.id));
  if (!d) throw notVisible();
  const [form] = await ctx.db.select().from(schema.leadSubmission).where(eq(schema.leadSubmission.dealId, d.id)).limit(1);
  const p = (form?.payload ?? {}) as Record<string, string>;
  const [co] = d.companyId ? await ctx.db.select({ industry: schema.company.industry }).from(schema.company).where(eq(schema.company.id, d.companyId)) : [];
  const list = (v: string | undefined) => (v ? v.split(/[,;]\s*/).filter(Boolean) : null);
  return {
    industry: p.industry ?? co?.industry ?? null,
    currentPlatform: p.currentPlatform ?? null,
    companySizeBand: p.companySizeBand ?? null,
    serviceInterest: list(p.serviceInterest),
    budgetBand: p.budgetBand ?? null,
    timeline: p.timeline ?? null,
    source: form ? 'web form' : (d.source ?? null),
    name: [p.firstName, p.lastName].filter(Boolean).join(' ') || p.name || null,
    email: p.email ?? null,
    jobTitle: p.jobTitle ?? null,
    companyIsCustomer: await customer(null, d.companyId),
    spam: form ? form.spamVerdict !== 'clean' : false,
    suspectedInjection: [p.message, p.company, p.jobTitle].some((t) => t && looksLikeInjection(t)),
    daysSinceActivity: daysSince(d.lastActivityAt),
    proposalViewed: await proposalViewed(ctx, d.id),
  };
}
async function proposalViewed(ctx: AppContext, dealId: string): Promise<boolean> {
  const [p] = await ctx.db
    .select({ id: schema.proposal.id })
    .from(schema.proposal)
    .where(and(eq(schema.proposal.dealId, dealId), inArray(schema.proposal.status, ['viewed', 'accepted', 'declined'])))
    .limit(1);
  return Boolean(p);
}

/** Computes and stores the deterministic score. Returns the previous row (for Undo) and the new one. */
export async function storeScore(
  ctx: AppContext,
  actor: UserActor,
  target: { type: 'lead' | 'deal'; id: string },
  extra: { tags: string[]; reason: string | null; runId: string | null },
) {
  const settings = await loadCopilotSettings(ctx);
  const computed = scoreLead(await scoreInputFor(ctx, actor, target), settings.focusIndustries);
  return ctx.db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(recordScore)
      .where(and(eq(recordScore.recordType, target.type), eq(recordScore.recordId, target.id)))
      .for('update');
    const values = {
      recordType: target.type,
      recordId: target.id,
      score: computed.score,
      band: computed.band,
      factors: computed.factors,
      missing: computed.missing,
      tags: extra.tags,
      reason: extra.reason,
      scoringVersion: SCORING_VERSION,
      scoredByRun: extra.runId,
      scoredAt: ctx.now(),
    };
    await tx
      .insert(recordScore)
      .values(values)
      .onConflictDoUpdate({ target: [recordScore.recordType, recordScore.recordId], set: values });
    return { before: before ?? null, after: values };
  });
}

// ───────────────────────── AUTO tools ─────────────────────────
const createTask = write(
  {
    name: 'create_task',
    description:
      'Create a follow-up task for the user on a deal, company or person (AUTO: done at once, the user can undo it). Use for reminders and next steps. Due date YYYY-MM-DD.',
    tier: 'auto',
    roles: ALL,
    input: z.object({ related: refInput('the deal, company or person'), title: z.string().trim().min(3).max(120), due: isoDay }),
  },
  async (env, input) => {
    const r = await relatedRecord(env, input.related);
    const today = orgToday(env);
    if (input.due < today) throw rule('DUE_IN_PAST', 'The due date must be today or later.');
    const title = plain(input.title, 120);
    if (title.length < 3) throw rule('TITLE_EMPTY', 'The task needs a title.');
    return {
      args: { relatedType: r.type, relatedId: r.id, title, due: input.due },
      target: { type: r.type, id: r.id },
      rowVersion: r.rowVersion,
      summary: `Create task ${quote(title)} on ${r.label}, due ${input.due}`,
      freeText: true,
    };
  },
  async (ctx, actor, a) => {
    const t = await crm.createTask(ctx, actor, {
      title: a.title as string,
      description: 'Created by the Copilot',
      relatedType: a.relatedType as 'deal',
      relatedId: a.relatedId as string,
      dueAt: `${a.due as string}T09:00:00.000Z`,
    });
    await ctx.db.update(schema.task).set({ source: 'copilot' }).where(eq(schema.task.id, t.id));
    return {
      result: { taskId: t.id },
      undo: { kind: 'cancel_task', targetId: t.id, after: { status: 'open', title: t.title, dueAt: t.dueAt.toISOString() } },
    };
  },
);

const AI_NOTE_LABEL = 'AI-generated (Copilot): ';
const addAiNote = write(
  {
    name: 'add_ai_note',
    description:
      'Save a short note on a deal, company or person, labelled "AI-generated" (AUTO: done at once, the user can undo it). Plain text, at most 1,000 characters.',
    tier: 'auto',
    roles: ALL,
    input: z.object({ related: refInput('the deal, company or person'), text: z.string().trim().min(3).max(1000) }),
  },
  async (env, input) => {
    const r = await relatedRecord(env, input.related);
    const text = plain(input.text, 1000);
    if (text.length < 3) throw rule('NOTE_EMPTY', 'The note is empty.');
    return {
      args: { relatedType: r.type, relatedId: r.id, body: `${AI_NOTE_LABEL}${text}` },
      target: { type: r.type, id: r.id },
      rowVersion: r.rowVersion,
      summary: `Add an AI-generated note to ${r.label}: ${quote(text)}`,
      freeText: true,
    };
  },
  async (ctx, actor, a) => {
    const n = await crm.createNote(ctx, actor, { body: a.body as string, relatedType: a.relatedType as 'deal', relatedId: a.relatedId as string });
    return { result: { noteId: n.id }, undo: { kind: 'delete_note', targetId: n.id, after: { body: n.body } } };
  },
);

const setLeadScore = write(
  {
    name: 'set_lead_score',
    description:
      'Score a lead (or a web-form deal) with the fixed scoring rules (AUTO: the user can undo it). The score is computed by the CRM; you only choose tags from the list and write a one-line reason.',
    tier: 'auto',
    roles: ALL,
    input: z.object({
      record: refInput('the lead or web-form deal'),
      tags: z.array(z.enum(LEAD_SCORE_TAGS)).max(6).default([]),
      reason: z.string().trim().max(200).optional(),
    }),
  },
  async (env, input) => {
    const ref = env.turn.aliases.resolve(input.record, 'lead', 'deal');
    const rowVersion =
      ref.type === 'lead' ? (await crm.getLead(env.ctx, env.actor, ref.id)).rowVersion : (await crm.getDeal(env.ctx, env.actor, ref.id)).rowVersion;
    const reason = input.reason ? plain(input.reason, 200) : null;
    return {
      args: { recordType: ref.type, recordId: ref.id, tags: [...new Set(input.tags)], reason },
      target: { type: ref.type as 'lead' | 'deal', id: ref.id },
      rowVersion,
      summary: `Score ${ref.label} with the lead-scoring rules${input.tags.length ? ` and tag it ${input.tags.join(', ')}` : ''}`,
      freeText: Boolean(reason),
    };
  },
  async (ctx, actor, a, meta) => {
    // Visibility again with the executing actor (Approve may be a later click).
    if (a.recordType === 'lead') await crm.getLead(ctx, actor, a.recordId as string);
    else await crm.getDeal(ctx, actor, a.recordId as string);
    const target = { type: a.recordType as 'lead' | 'deal', id: a.recordId as string };
    const { before, after } = await storeScore(ctx, actor, target, {
      tags: a.tags as string[],
      reason: (a.reason as string | null) ?? null,
      runId: meta.runId,
    });
    return {
      result: { score: after.score, band: after.band, missing: after.missing },
      undo: {
        kind: 'restore_score',
        targetId: target.id,
        after: { recordType: target.type, score: after.score, band: after.band, scoredAt: after.scoredAt.toISOString() },
        before: before ? { ...before, scoredAt: before.scoredAt.toISOString() } : null,
      },
      note: {
        score: after.score,
        band: after.band,
        missing: after.missing,
        factors: after.factors.filter((f) => f.points !== 0).map((f) => `${f.factor} ${f.points}`),
      },
    };
  },
);

// ───────────────────────── APPROVAL tools ─────────────────────────
const updateLead = write(
  {
    name: 'update_lead',
    description: "Change a lead's qualification fields or status new/working (APPROVAL: the user approves a card first). Values only from the allowed lists.",
    tier: 'approval',
    roles: ALL,
    input: z.object({ lead: refInput('the lead'), status: z.enum(['new', 'working']).optional(), ...leadQualificationFields }),
  },
  async (env, input) => {
    const { ref, lead } = await visibleLead(env, input.lead);
    const { lead: _l, ...patch } = input;
    const keys = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined);
    if (!keys.length) throw rule('NOTHING_TO_CHANGE', 'Say which field to change.');
    const fields = Object.fromEntries(keys.map((k) => [k, (patch as Record<string, unknown>)[k]]));
    const shown = keys.map((k) => `${k} → ${Array.isArray(fields[k]) ? (fields[k] as string[]).join(', ') : (fields[k] ?? 'empty')}`).join('; ');
    return {
      args: { leadId: ref.id, fields },
      target: { type: 'lead', id: ref.id },
      rowVersion: lead.rowVersion,
      summary: `Update lead ${ref.label}: ${shown}`,
      freeText: false,
    };
  },
  async (ctx, actor, a) => {
    const lead = await crm.getLead(ctx, actor, a.leadId as string);
    await crm.updateLead(ctx, actor, a.leadId as string, { ...(a.fields as object), rowVersion: lead.rowVersion });
    return { result: { leadId: a.leadId } };
  },
);
const qualifyLead = write(
  {
    name: 'qualify_lead',
    description: 'Mark a lead as qualified (APPROVAL).',
    tier: 'approval',
    roles: ALL,
    input: z.object({ lead: refInput('the lead') }),
  },
  async (env, input) => {
    const { ref, lead } = await visibleLead(env, input.lead);
    return {
      args: { leadId: ref.id },
      target: { type: 'lead', id: ref.id },
      rowVersion: lead.rowVersion,
      summary: `Qualify lead ${ref.label}`,
      freeText: false,
    };
  },
  async (ctx, actor, a) => {
    await crm.qualifyLead(ctx, actor, a.leadId as string);
    return { result: { leadId: a.leadId } };
  },
);
const disqualifyLead = write(
  {
    name: 'disqualify_lead',
    description: 'Disqualify a lead with a short reason (APPROVAL).',
    tier: 'approval',
    roles: ALL,
    input: z.object({ lead: refInput('the lead'), reason: z.string().trim().min(2).max(300) }),
  },
  async (env, input) => {
    const { ref, lead } = await visibleLead(env, input.lead);
    const reason = plain(input.reason, 300);
    return {
      args: { leadId: ref.id, reason },
      target: { type: 'lead', id: ref.id },
      rowVersion: lead.rowVersion,
      summary: `Disqualify lead ${ref.label}: ${quote(reason)}`,
      freeText: true,
    };
  },
  async (ctx, actor, a) => {
    await crm.disqualifyLead(ctx, actor, a.leadId as string, { reason: a.reason as string });
    return { result: { leadId: a.leadId } };
  },
);
const convertLead = write(
  {
    name: 'convert_lead',
    description: 'Convert a qualified lead into a company, person and deal (APPROVAL).',
    tier: 'approval',
    roles: ALL,
    input: z.object({ lead: refInput('the lead'), dealName: z.string().trim().min(2).max(120).optional() }),
  },
  async (env, input) => {
    const { ref, lead } = await visibleLead(env, input.lead);
    const dealName = input.dealName ? plain(input.dealName, 120) : undefined;
    return {
      args: { leadId: ref.id, ...(dealName ? { dealName } : {}) },
      target: { type: 'lead', id: ref.id },
      rowVersion: lead.rowVersion,
      summary: `Convert lead ${ref.label} into a company, person and deal${dealName ? ` ${quote(dealName)}` : ''}`,
      freeText: Boolean(dealName),
    };
  },
  async (ctx, actor, a) => {
    const r = await crm.convertLead(ctx, actor, a.leadId as string, { createDeal: true, ...(a.dealName ? { dealName: a.dealName as string } : {}) });
    return { result: r as Record<string, unknown> };
  },
);
const moveDealStage = write(
  {
    name: 'move_deal_stage',
    description: 'Move an open deal to another open stage, by stage name (APPROVAL). Closing a deal is not a stage move.',
    tier: 'approval',
    roles: ALL,
    input: z.object({ deal: refInput('the deal'), stage: z.string().trim().min(2).max(60) }),
  },
  async (env, input) => {
    const { ref, deal } = await visibleDeal(env, input.deal);
    const { stages } = await crm.getPipeline(env.ctx);
    const stage = stages.find((s) => s.pipelineId === deal.pipelineId && s.kind === 'open' && s.name.toLowerCase() === input.stage.toLowerCase());
    if (!stage)
      throw rule(
        'STAGE_NOT_FOUND',
        `No open stage named ${quote(input.stage)}. Open stages: ${stages
          .filter((s) => s.pipelineId === deal.pipelineId && s.kind === 'open')
          .map((s) => s.name)
          .join(', ')}`,
      );
    return {
      args: { dealId: ref.id, stageId: stage.id, rowVersion: deal.rowVersion },
      target: { type: 'deal', id: ref.id },
      rowVersion: deal.rowVersion,
      summary: `Move ${ref.label} to ${stage.name}`,
      freeText: false,
    };
  },
  async (ctx, actor, a) => {
    await crm.moveDealStage(ctx, actor, a.dealId as string, a.stageId as string, a.rowVersion as number);
    return { result: { dealId: a.dealId } };
  },
);
const patchDeal = write(
  {
    name: 'patch_deal',
    description: "Change a deal's expected close date (YYYY-MM-DD) and/or amount (APPROVAL).",
    tier: 'approval',
    roles: ALL,
    input: z.object({
      deal: refInput('the deal'),
      closeDate: isoDay.optional(),
      amount: z
        .string()
        .regex(/^\d{1,12}(\.\d{1,2})?$/, 'A plain number like 12500 or 12500.50')
        .optional(),
    }),
  },
  async (env, input) => {
    const { ref, deal } = await visibleDeal(env, input.deal);
    if (!input.closeDate && !input.amount) throw rule('NOTHING_TO_CHANGE', 'Give a close date or an amount.');
    const parts = [input.closeDate ? `expected close date ${input.closeDate}` : null, input.amount ? `amount ${deal.currency} ${input.amount}` : null].filter(
      Boolean,
    );
    return {
      args: {
        dealId: ref.id,
        rowVersion: deal.rowVersion,
        ...(input.closeDate ? { closeDate: input.closeDate } : {}),
        ...(input.amount ? { amount: input.amount } : {}),
      },
      target: { type: 'deal', id: ref.id },
      rowVersion: deal.rowVersion,
      summary: `Set ${parts.join(' and ')} on ${ref.label}`,
      freeText: false,
    };
  },
  async (ctx, actor, a) => {
    await crm.patchDeal(ctx, actor, a.dealId as string, {
      rowVersion: a.rowVersion as number,
      ...(a.closeDate ? { closeDate: a.closeDate as string } : {}),
      ...(a.amount ? { amount: a.amount as string } : {}),
    });
    return { result: { dealId: a.dealId } };
  },
);
const closeDealLost = write(
  {
    name: 'close_deal_lost',
    description: 'Close a deal as lost with a reason (APPROVAL). Marking a deal as won is not possible through the Copilot.',
    tier: 'approval',
    roles: ALL,
    input: z.object({ deal: refInput('the deal'), reason: z.string().trim().min(2).max(300) }),
  },
  async (env, input) => {
    const { ref, deal } = await visibleDeal(env, input.deal);
    if (deal.status !== 'open') throw rule('DEAL_CLOSED', 'This deal is already closed.');
    const { lostReasons } = await crm.getPipeline(env.ctx);
    const text = plain(input.reason, 300);
    const match = lostReasons.find((r) => r.name.toLowerCase() === text.toLowerCase()) ?? lostReasons.find((r) => /other/i.test(r.name));
    if (!match) throw rule('LOST_REASON_REQUIRED', `Use one of these lost reasons: ${lostReasons.map((r) => r.name).join(', ')}`);
    const note = match.name.toLowerCase() === text.toLowerCase() ? undefined : text;
    return {
      args: { dealId: ref.id, lostReasonId: match.id, ...(note ? { note } : {}) },
      target: { type: 'deal', id: ref.id },
      rowVersion: deal.rowVersion,
      summary: `Close ${ref.label} as lost (${match.name}${note ? `: ${quote(note)}` : ''})`,
      freeText: Boolean(note),
    };
  },
  async (ctx, actor, a) => {
    // An open signature request must be voided by a person in the CRM: the Copilot never touches e-sign.
    const refuse = () => rule('OPEN_SIGNATURE_REQUEST', 'This deal has an open signature request. Close the deal in the CRM.');
    await crm.closeDealLost(
      ctx,
      actor,
      a.dealId as string,
      { lostReasonId: a.lostReasonId as string, ...(a.note ? { note: a.note as string } : {}) },
      async () => {
        throw refuse();
      },
      async (tx: Tx, dealId: string) => {
        const [open] = await tx
          .select({ id: schema.signatureRequest.id })
          .from(schema.signatureRequest)
          .where(and(eq(schema.signatureRequest.dealId, dealId), inArray(schema.signatureRequest.status, ['pending', 'sent', 'viewed'])));
        if (open) throw refuse();
        return false;
      },
    );
    return { result: { dealId: a.dealId } };
  },
);
const logActivity = write(
  {
    name: 'log_activity',
    description:
      'Log a call or meeting that took place, on a deal, company or person (APPROVAL: a person must confirm the contact happened, because it stops the first-contact clock).',
    tier: 'approval',
    roles: ALL,
    input: z.object({
      related: refInput('the deal, company or person'),
      kind: z.enum(['call', 'meeting']),
      summary: z.string().trim().min(2).max(255),
      occurredOn: isoDay.optional(),
    }),
  },
  async (env, input) => {
    const r = await relatedRecord(env, input.related);
    const today = orgToday(env);
    if (input.occurredOn && input.occurredOn > today) throw rule('IN_FUTURE', 'Only past calls and meetings can be logged.');
    const summary = plain(input.summary, 255);
    return {
      args: { relatedType: r.type, relatedId: r.id, kind: input.kind, outcome: summary, occurredOn: input.occurredOn ?? null },
      target: { type: r.type, id: r.id },
      rowVersion: r.rowVersion,
      summary: `Log a ${input.kind}${input.occurredOn ? ` on ${input.occurredOn}` : ''} with ${r.label}: ${quote(summary)}`,
      freeText: true,
    };
  },
  async (ctx, actor, a) => {
    const occurredAt = a.occurredOn ? `${a.occurredOn as string}T12:00:00.000Z` : ctx.now().toISOString();
    const row = await crm.logActivity(ctx, actor, {
      kind: a.kind as 'call',
      occurredAt,
      outcome: a.outcome as string,
      relatedType: a.relatedType as 'deal',
      relatedId: a.relatedId as string,
    });
    return { result: { activityId: row.id } };
  },
);
const reassign = write(
  {
    name: 'reassign',
    description: 'Hand a lead or deal to another active colleague (APPROVAL; managers and admins only). Use the user alias from list_users.',
    tier: 'approval',
    roles: ['admin', 'sales_manager'],
    input: z.object({ record: refInput('the lead or deal'), owner: refInput('the colleague (user)') }),
  },
  async (env, input) => {
    const ref = env.turn.aliases.resolve(input.record, 'lead', 'deal');
    const owner = env.turn.aliases.resolve(input.owner, 'user');
    if (env.actor.role !== 'admin' && !env.actor.teamScopeIds.includes(owner.id)) throw notVisible();
    const rowVersion =
      ref.type === 'lead' ? (await crm.getLead(env.ctx, env.actor, ref.id)).rowVersion : (await crm.getDeal(env.ctx, env.actor, ref.id)).rowVersion;
    return {
      args: { recordType: ref.type, recordId: ref.id, ownerId: owner.id },
      target: { type: ref.type as 'lead' | 'deal', id: ref.id },
      rowVersion,
      summary: `Reassign ${ref.type} ${ref.label} to ${owner.label}`,
      freeText: false,
    };
  },
  async (ctx, actor, a) => {
    if (a.recordType === 'lead') await crm.assignLead(ctx, actor, a.recordId as string, a.ownerId as string);
    else await crm.changeDealOwner(ctx, actor, a.recordId as string, a.ownerId as string);
    return { result: { recordId: a.recordId, ownerId: a.ownerId } };
  },
);

// ───────────────────────── DRAFT tools ─────────────────────────
const draftFollowUp = write(
  {
    name: 'draft_follow_up',
    description:
      "Prepare a follow-up e-mail DRAFT for a deal's main contact (DRAFT: saved as a suggestion the user reviews; nothing is sent, the CRM never sends it).",
    tier: 'draft',
    roles: ALL,
    input: z.object({
      deal: refInput('the deal'),
      scenario: z.enum(['initial', 'viewed', 'revisited', 'not_viewed', 'changes_requested', 'gone_quiet']).default('gone_quiet'),
    }),
  },
  async (env, input) => {
    const { ref, deal } = await visibleDeal(env, input.deal);
    const [contact] = await env.ctx.db
      .select({ id: schema.dealContact.contactId })
      .from(schema.dealContact)
      .where(eq(schema.dealContact.dealId, ref.id))
      .orderBy(desc(schema.dealContact.isPrimary))
      .limit(1);
    if (!contact) throw rule('NO_CONTACT', 'This deal has no contact to write to.');
    return {
      args: { dealId: ref.id, contactId: contact.id, scenario: input.scenario },
      target: { type: 'deal', id: ref.id },
      rowVersion: deal.rowVersion,
      summary: `Draft a follow-up e-mail for ${ref.label} (not sent)`,
      freeText: false,
    };
  },
  async (ctx, actor, a) => {
    const d = await ai.followUpDraft(ctx, actor, { dealId: a.dealId as string, contactId: a.contactId as string, scenario: a.scenario as 'gone_quiet' });
    return {
      result: { generationId: d.generationId },
      note: { draft: { subject: d.subject, body: d.body }, where: 'Saved as an AI suggestion on the deal; the user reviews it there. Nothing was sent.' },
    };
  },
);

export const WRITE_TOOLS: ToolDef[] = [
  createTask,
  addAiNote,
  setLeadScore,
  updateLead,
  qualifyLead,
  disqualifyLead,
  convertLead,
  moveDealStage,
  patchDeal,
  closeDealLost,
  logActivity,
  reassign,
  draftFollowUp,
];
/** Lets other Copilot modules (assignments) add write tools with the same ledger. */
export function addWriteTool<S extends z.ZodObject>(
  def: Omit<ToolDef<S>, 'run'>,
  prepare: (env: ToolEnv, input: z.infer<S>) => Promise<Prepared>,
  execute: WriteTool['execute'],
) {
  const t = write(def, prepare, execute);
  registerTools([t]);
  return t;
}

// ───────────────────────── the ledger ─────────────────────────
type ActionRow = typeof agentAction.$inferSelect;
const undoableNow = (ctx: AppContext, r: ActionRow) =>
  r.tier === 'auto' && r.status === 'executed' && Boolean(r.undo) && Boolean(r.undoUntil && r.undoUntil > ctx.now());
export const toEvent = (ctx: AppContext, r: ActionRow): ActionEvent => ({
  id: r.id,
  tool: r.tool,
  tier: r.tier,
  status: r.status as ActionEvent['status'],
  summary: r.summary,
  target: r.targetType && r.targetId ? { type: r.targetType, id: r.targetId } : null,
  undoable: undoableNow(ctx, r),
});
const keyOf = (prefix: string, tool: string, p: Prepared) =>
  `${prefix}:${tool}:${p.target?.id ?? '-'}:${createHash('sha256').update(JSON.stringify(p.args)).digest('hex').slice(0, 16)}`;

/** In-app notification only (the Copilot never sends e-mail). */
export async function notifyInApp(
  tx: Tx,
  n: { userId: string; eventType: string; title: string; body: string; linkPath: string; dedupeKey: string; dealId?: string | null },
) {
  const [user] = await tx.select({ status: schema.appUserProfile.status }).from(schema.appUserProfile).where(eq(schema.appUserProfile.userId, n.userId));
  if (user?.status !== 'active') return;
  await tx
    .insert(schema.notification)
    .values({
      recipientUserId: n.userId,
      eventType: n.eventType,
      dealId: n.dealId ?? null,
      title: n.title,
      body: n.body,
      linkPath: n.linkPath,
      dedupeKey: n.dedupeKey,
      emailStatus: 'not_sent',
    })
    .onConflictDoNothing();
}

async function handleWrite(env: ToolEnv, tool: ToolDef, input: Record<string, unknown>): Promise<{ content: string; action: ActionEvent }> {
  const w = WRITES.get(tool.name);
  if (!w) throw notVisible();
  const { ctx, actor, turn } = env;
  const p = await w.prepare(env, input);
  let tier: Tier = tool.tier;
  let why: string | null = null;
  if (tier === 'auto' && !env.settings.autonomy[tool.name as keyof typeof env.settings.autonomy]) {
    tier = 'approval';
    why = 'autonomy_off';
  } else if (tier === 'auto' && p.freeText && turn.tainted) {
    tier = 'approval';
    why = 'tainted';
  }
  const idempotencyKey = turn.idempotencyPrefix ? keyOf(turn.idempotencyPrefix, tool.name, p) : null;
  if (idempotencyKey) {
    const [existing] = await ctx.db.select().from(agentAction).where(eq(agentAction.idempotencyKey, idempotencyKey));
    if (existing && ['executed', 'approved', 'proposed'].includes(existing.status))
      return { content: JSON.stringify({ status: 'already_done', what: existing.summary }), action: toEvent(ctx, existing) };
    // A failed, rejected or expired earlier attempt keeps its history but frees the key, so the job can try again.
    if (existing) await ctx.db.update(agentAction).set({ idempotencyKey: null, updatedAt: ctx.now() }).where(eq(agentAction.id, existing.id));
  }
  const now = ctx.now();
  const base = {
    runId: turn.runId,
    conversationId: turn.conversationId,
    principalUserId: actor.userId,
    tool: tool.name,
    summary: p.summary,
    args: p.args,
    targetType: p.target?.type ?? null,
    targetId: p.target?.id ?? null,
    rowVersionSeen: p.rowVersion,
    tainted: turn.tainted,
    idempotencyKey,
    requestId: turn.requestId,
    createdAt: now,
    updatedAt: now,
  };

  if (tier === 'approval') {
    const [row] = await ctx.db
      .insert(agentAction)
      .values({ ...base, tier: 'approval', status: 'proposed', expiresAt: new Date(now.getTime() + CARD_TTL_MS), result: why ? { routedBecause: why } : null })
      .returning();
    turn.proposals++;
    if (turn.kind !== 'chat')
      await notifyInApp(ctx.db as unknown as Tx, {
        userId: actor.userId,
        eventType: 'copilot_approval',
        title: 'The Copilot needs your OK',
        body: p.summary,
        linkPath: '/copilot/approvals',
        dedupeKey: `copilot_approval:${row!.id}`,
      });
    return {
      content: JSON.stringify({
        status: 'waiting_for_approval',
        what: p.summary,
        note: 'Nothing has changed yet. Tell the user a card is waiting for their OK.',
      }),
      action: toEvent(ctx, row!),
    };
  }

  if (tier === 'auto') {
    const cap = turn.kind === 'chat' ? CAPS.maxAutoWritesChat : CAPS.maxAutoWritesBackground;
    if (turn.autoWrites >= cap)
      throw new DomainError('COPILOT_LIMIT', 429, `At most ${cap} automatic changes per ${turn.kind === 'chat' ? 'question' : 'run'}.`);
  }
  const [row] = await ctx.db
    .insert(agentAction)
    .values({ ...base, tier: tier as 'auto' | 'draft', status: 'proposed', expiresAt: new Date(now.getTime() + CARD_TTL_MS) }) // expires if the run dies mid-write
    .returning();
  try {
    const done = await w.execute(ctx, actor, p.args, { actionId: row!.id, runId: turn.runId });
    const [updated] = await ctx.db
      .update(agentAction)
      .set({
        status: 'executed',
        result: done.result,
        undo: tier === 'auto' ? (done.undo ?? null) : null,
        undoUntil: tier === 'auto' && done.undo ? new Date(now.getTime() + UNDO_MS) : null,
        decidedBy: actor.userId,
        decidedAt: ctx.now(),
        updatedAt: ctx.now(),
      })
      .where(eq(agentAction.id, row!.id))
      .returning();
    if (tier === 'auto') turn.autoWrites++;
    const status = tier === 'draft' ? 'draft_saved' : 'done';
    return {
      content: JSON.stringify({ status, what: p.summary, ...(done.note ?? {}), ...(tier === 'auto' ? { undo: 'The user can undo this for 7 days.' } : {}) }),
      action: toEvent(ctx, updated!),
    };
  } catch (error) {
    await ctx.db
      .update(agentAction)
      .set({ status: 'failed', errorCode: error instanceof DomainError ? error.code : 'FAILED', updatedAt: ctx.now() })
      .where(eq(agentAction.id, row!.id));
    throw error;
  }
}
setWriteHandler(handleWrite);
registerTools(WRITE_TOOLS);

// ───────────────────────── approve · reject · undo ─────────────────────────
async function ownAction(ctx: AppContext, actor: UserActor, id: string): Promise<ActionRow> {
  const [row] = await ctx.db
    .select()
    .from(agentAction)
    .where(and(eq(agentAction.id, id), eq(agentAction.principalUserId, actor.userId)));
  if (!row) throw notFound('Action');
  return row;
}
async function expire(ctx: AppContext, id: string, code: string) {
  await ctx.db.update(agentAction).set({ status: 'expired', errorCode: code, updatedAt: ctx.now() }).where(eq(agentAction.id, id));
}

export async function approveAction(ctx: AppContext, actor: UserActor, id: string) {
  const row = await ownAction(ctx, actor, id);
  if (row.status !== 'proposed' || row.tier !== 'approval') throw conflict('COPILOT_CARD_DECIDED', 'This card was already decided.');
  if (row.expiresAt && row.expiresAt <= ctx.now()) {
    await expire(ctx, id, 'EXPIRED');
    throw conflict('COPILOT_CARD_EXPIRED', 'This card expired (cards last 24 hours). Ask the Copilot again if it is still needed.');
  }
  if (row.targetType && row.targetId && row.rowVersionSeen !== null) {
    const v = await currentVersion(ctx, { type: row.targetType, id: row.targetId });
    if (v !== row.rowVersionSeen) {
      await expire(ctx, id, 'RECORD_CHANGED');
      throw conflict('COPILOT_CARD_STALE', 'The record changed after this card was made, so it expired. Ask the Copilot again if it is still needed.');
    }
  }
  const w = WRITES.get(row.tool);
  if (!w) throw notFound('Action');
  // Claim the card first, so a double click cannot run it twice.
  const claimed = await ctx.db
    .update(agentAction)
    .set({ decidedBy: actor.userId, decidedAt: ctx.now(), updatedAt: ctx.now() })
    .where(and(eq(agentAction.id, id), eq(agentAction.status, 'proposed'), isNull(agentAction.decidedAt)))
    .returning({ id: agentAction.id });
  if (!claimed.length) throw conflict('COPILOT_CARD_DECIDED', 'This card was already decided.');
  try {
    const done = await w.execute(ctx, actor, row.args, { actionId: id, runId: row.runId });
    const [updated] = await ctx.db
      .update(agentAction)
      .set({ status: 'approved', result: done.result, updatedAt: ctx.now() })
      .where(eq(agentAction.id, id))
      .returning();
    ctx.logger.info({ actionId: id, tool: row.tool, tier: 'approval', outcome: 'approved' }, 'copilot action decided');
    return toEvent(ctx, updated!);
  } catch (error) {
    await ctx.db
      .update(agentAction)
      .set({ status: 'failed', errorCode: error instanceof DomainError ? error.code : 'FAILED', updatedAt: ctx.now() })
      .where(eq(agentAction.id, id));
    throw error;
  }
}

export async function rejectAction(ctx: AppContext, actor: UserActor, id: string) {
  const row = await ownAction(ctx, actor, id);
  if (row.status !== 'proposed') throw conflict('COPILOT_CARD_DECIDED', 'This card was already decided.');
  const [updated] = await ctx.db
    .update(agentAction)
    .set({ status: 'rejected', decidedBy: actor.userId, decidedAt: ctx.now(), updatedAt: ctx.now() })
    .where(and(eq(agentAction.id, id), eq(agentAction.status, 'proposed')))
    .returning();
  if (!updated) throw conflict('COPILOT_CARD_DECIDED', 'This card was already decided.');
  ctx.logger.info({ actionId: id, tool: row.tool, outcome: 'rejected' }, 'copilot action decided');
  return toEvent(ctx, updated);
}

/** Undo an automatic action within 7 days, unless the record changed since (the reversalConflicts rule). */
export async function undoAction(ctx: AppContext, actor: UserActor, id: string) {
  const row = await ownAction(ctx, actor, id);
  if (row.tier !== 'auto' || row.status !== 'executed' || !row.undo) throw conflict('COPILOT_NOT_UNDOABLE', 'This change cannot be undone here.');
  if (!row.undoUntil || row.undoUntil <= ctx.now()) throw conflict('COPILOT_UNDO_EXPIRED', 'Undo is available for 7 days only.');
  const recipe = row.undo;
  const updated = await unitOfWork(ctx, actor, async (u) => {
    const [locked] = await u.tx.select().from(agentAction).where(eq(agentAction.id, id)).for('update');
    if (locked?.status !== 'executed') throw conflict('COPILOT_NOT_UNDOABLE', 'This change was already undone.');
    const changed = (fields: string[]) => {
      if (fields.length)
        throw conflict('UNDO_CONFLICT', 'The record changed after the Copilot made this change, so it cannot be undone automatically.', { fields });
    };
    if (recipe.kind === 'cancel_task') {
      const [t] = await u.tx.select().from(schema.task).where(eq(schema.task.id, recipe.targetId)).for('update');
      if (!t) throw conflict('UNDO_CONFLICT', 'The task no longer exists.');
      changed(reversalConflicts(recipe.after ?? {}, { status: t.status, title: t.title, dueAt: t.dueAt.toISOString() }));
      await u.tx.update(schema.task).set({ status: 'cancelled', updatedAt: ctx.now(), updatedBy: actor.userId }).where(eq(schema.task.id, t.id));
      await u.timeline({
        eventType: 'task_cancelled',
        source: { type: 'task', id: t.id },
        summary: `Task cancelled (Copilot change undone): ${t.title}`,
        anchors: anchorFor(t),
      });
    } else if (recipe.kind === 'delete_note') {
      const [n] = await u.tx.select().from(schema.note).where(eq(schema.note.id, recipe.targetId)).for('update');
      if (!n) throw conflict('UNDO_CONFLICT', 'The note no longer exists.');
      changed(reversalConflicts(recipe.after ?? {}, { body: n.body }));
      await u.tx.delete(schema.note).where(eq(schema.note.id, n.id));
      await u.timeline({
        eventType: 'note_removed',
        source: { type: 'note', id: n.id },
        summary: 'AI-generated note removed (Copilot change undone)',
        anchors: anchorFor(n),
      });
    } else {
      const after = recipe.after as { recordType: 'lead' | 'deal'; score: number; band: string; scoredAt: string };
      const [s] = await u.tx
        .select()
        .from(recordScore)
        .where(and(eq(recordScore.recordType, after.recordType), eq(recordScore.recordId, recipe.targetId)))
        .for('update');
      if (!s) throw conflict('UNDO_CONFLICT', 'The score no longer exists.');
      changed(reversalConflicts(after, { recordType: s.recordType, score: s.score, band: s.band, scoredAt: s.scoredAt.toISOString() }));
      const before = recipe.before as (typeof recordScore.$inferSelect & { scoredAt: string }) | null;
      if (before)
        await u.tx
          .update(recordScore)
          .set({ ...before, scoredAt: new Date(before.scoredAt) })
          .where(and(eq(recordScore.recordType, after.recordType), eq(recordScore.recordId, recipe.targetId)));
      else await u.tx.delete(recordScore).where(and(eq(recordScore.recordType, after.recordType), eq(recordScore.recordId, recipe.targetId)));
    }
    await u.audit('copilot.action_undone', { type: 'agent_action', id }, { tool: row.tool });
    const [done] = await u.tx
      .update(agentAction)
      .set({ status: 'undone', decidedBy: actor.userId, decidedAt: ctx.now(), updatedAt: ctx.now() })
      .where(eq(agentAction.id, id))
      .returning();
    return done!;
  });
  ctx.logger.info({ actionId: id, tool: row.tool, tier: 'auto', outcome: 'undone' }, 'copilot action decided');
  return toEvent(ctx, updated);
}
const anchorFor = (r: { relatedType: string; relatedId: string }) => [{ type: r.relatedType as 'deal' | 'company' | 'contact', id: r.relatedId }];

/** Lists the user's own cards ("pending") or automatic changes ("done", last 30 days). */
export async function listActions(ctx: AppContext, actor: UserActor, view: 'pending' | 'done') {
  const now = ctx.now();
  const where =
    view === 'pending'
      ? and(eq(agentAction.principalUserId, actor.userId), eq(agentAction.status, 'proposed'), eq(agentAction.tier, 'approval'), gt(agentAction.expiresAt, now))
      : and(
          eq(agentAction.principalUserId, actor.userId),
          or(eq(agentAction.tier, 'auto'), eq(agentAction.tier, 'draft')),
          inArray(agentAction.status, ['executed', 'undone']),
          gt(agentAction.createdAt, new Date(now.getTime() - 30 * 24 * HOUR)),
        );
  const rows = await ctx.db
    .select({ a: agentAction, kind: agentRun.kind })
    .from(agentAction)
    .leftJoin(agentRun, eq(agentRun.id, agentAction.runId))
    .where(where)
    .orderBy(desc(agentAction.createdAt))
    .limit(200);
  return {
    items: rows.map(({ a, kind }) => ({
      ...toEvent(ctx, a),
      createdAt: a.createdAt,
      decidedAt: a.decidedAt,
      expiresAt: a.expiresAt,
      undoUntil: a.undoUntil,
      runKind: kind ?? 'chat',
      reason: a.tool === 'set_lead_score' ? ((a.args.reason as string | null) ?? null) : null,
    })),
  };
}

/** Scheduled: proposed cards past their 24 h become "expired". */
export async function expireCards(ctx: AppContext): Promise<number> {
  const rows = await ctx.db
    .update(agentAction)
    .set({ status: 'expired', errorCode: 'EXPIRED', updatedAt: ctx.now() })
    .where(and(eq(agentAction.status, 'proposed'), lt(agentAction.expiresAt, ctx.now())))
    .returning({ id: agentAction.id });
  return rows.length;
}
