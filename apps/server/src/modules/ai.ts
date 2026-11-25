/**
 * ai module — AI assistance with a human in control (BR-AIA-001..009; ADR-014/035/040..044).
 *
 * Pipeline for every feature:  authorize → context engine (ai/context.ts) → prompt (ai/prompts.ts) → engine
 * (ai/engine.ts: switches, budgets, provider, retry, validation, usage) → store a PENDING suggestion → the user
 * accepts, edits or rejects it → only then is anything written to a CRM record.
 *
 * BR-AIA-006 is structural, not a promise: this module does not import the sharing, e-signature or email code, the
 * provider has no tools, and the only writes it can make are (a) a section of a DRAFT proposal, (b) a note on a deal —
 * both only inside `decide`, on a human's explicit request. It cannot send, sign, reassign, re-price or close anything.
 */

import { type Finding as RuleFinding, resolveText } from '@crm/proposal';
import type { aiDecisionInput, aiDraftSectionsInput, aiFollowUpInput, aiRewriteInput, aiSettingsInput } from '@crm/shared';
import { type AiFeatureKey, AI_FEATURES as FEATURE_KEYS, type ProposalDocument } from '@crm/shared';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { type AppContext, conflict, forbidden, loadDealFor, notFound, requirePerm, rule, schema, type UserActor, unitOfWork } from '../platform/core.ts';
import { DomainError } from '../platform/errors/domain-error.ts';
import { type AiContext, buildContext, sanitizeText } from './ai/context.ts';
import { type AiMeta, type AiTrace, assertAiAllowed, loadAiSettings, resolveAiSettings, runAi } from './ai/engine.ts';
import { FOLLOW_UP_SCENARIOS, PROMPTS, REWRITE_MODES, renderUserMessage } from './ai/prompts.ts';
import { reviewInputs } from './proposals.ts';

const { aiGeneration, aiReview, aiUsage, appUserProfile, contact, dealContact, note, organizationSettings, proposal, proposalVersion, templateVersion } =
  schema;

const LABEL = 'AI-generated — review before use';
const MAX_OUTPUT_CHARS = 20_000;
/** Output sanitisation (AI-ARCHITECTURE §11.3): plain text only — markup and invisible characters are removed. */
const clean = (text: string) => sanitizeText(text.replace(/\r\n/g, '\n'), MAX_OUTPUT_CHARS).replace(/\n{3,}/g, '\n\n');
const cleanLines = (text: string) =>
  text
    .split('\n')
    .map((l) => sanitizeText(l, MAX_OUTPUT_CHARS))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
const publicMeta = (m: AiMeta) => ({
  requestId: m.requestId,
  provider: m.provider,
  model: m.model,
  simulated: m.simulated,
  promptVersion: m.promptVersion,
  inputTokens: m.inputTokens,
  outputTokens: m.outputTokens,
  costMicroUsd: m.costMicroUsd,
});

export const numbersIn = (value: unknown, out = new Set<string>()): Set<string> => {
  if (typeof value === 'string' || typeof value === 'number') {
    for (const m of String(value).matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.add(m[0].replace(/,/g, '').replace(/\.0+$/, ''));
  } else if (value && typeof value === 'object') for (const v of Object.values(value)) numbersIn(v, out);
  return out;
};
/**
 * Guardrail for "never fabricate prices": money amounts in AI text that do not appear anywhere in the CRM facts the
 * model was given. They are not removed (the user decides) but are shown as a warning next to the suggestion.
 */
export function unverifiedFigures(text: string, facts: unknown): string[] {
  const known = numbersIn(facts);
  const found = [...text.matchAll(/(?:[$£€]|\b(?:USD|EUR|GBP)\s?)\s?(\d[\d,]*(?:\.\d+)?)/g)];
  return [...new Set(found.filter((m) => !known.has((m[1] as string).replace(/,/g, '').replace(/\.0+$/, ''))).map((m) => m[0].trim()))];
}

async function insertGeneration(
  ctx: AppContext,
  actor: UserActor,
  input: { feature: AiFeatureKey; dealId: string; target: Record<string, unknown>; output: Record<string, unknown>; meta: AiMeta; context: AiContext },
) {
  const [g] = await ctx.db
    .insert(aiGeneration)
    .values({
      feature: input.feature,
      requestedBy: actor.userId,
      dealId: input.dealId,
      target: input.target,
      promptVersion: input.meta.promptVersion,
      output: input.output,
      status: 'pending',
      provider: input.meta.provider,
      model: input.meta.model,
      simulated: input.meta.simulated,
      requestId: input.meta.requestId,
      contextRefs: input.context.refs, // ids of the records used — never their content
    })
    .returning({ id: aiGeneration.id });
  return g!.id;
}

async function draftVersionFor(ctx: AppContext, actor: UserActor, proposalId: string) {
  const [p] = await ctx.db.select().from(proposal).where(eq(proposal.id, proposalId));
  if (!p) throw notFound('Proposal');
  await loadDealFor(ctx.db, actor, p.dealId, 'write', 'proposal.manage').catch((e) => {
    throw e instanceof DomainError && e.code === 'NOT_FOUND' ? notFound('Proposal') : e;
  });
  const [v] = await ctx.db
    .select()
    .from(proposalVersion)
    .where(and(eq(proposalVersion.proposalId, p.id), eq(proposalVersion.state, 'draft')));
  if (!v) throw conflict('VERSION_IMMUTABLE', 'This proposal has no draft version to work on');
  const [tv] = await ctx.db.select({ content: templateVersion.content }).from(templateVersion).where(eq(templateVersion.id, p.templateVersionId));
  const locked = new Set((tv!.content as ProposalDocument).sections.filter((s) => s.locked).map((s) => s.id));
  return { p, v, doc: v.content as ProposalDocument, locked };
}

// ───────────────────────── A. Proposal drafting (BR-AIA-001) ─────────────────────────
/** Drafts one or more proposal sections. Each becomes a separate pending suggestion; the proposal itself is not touched. */
export async function draftSections(ctx: AppContext, actor: UserActor, input: z.infer<typeof aiDraftSectionsInput>, trace: AiTrace = {}) {
  const { p, doc, locked } = await draftVersionFor(ctx, actor, input.proposalId);
  const eligible = doc.sections.filter((s) => s.kind === 'text' && s.aiDraftable && !locked.has(s.id));
  const wanted = input.sectionIds ? eligible.filter((s) => input.sectionIds!.includes(s.id)) : eligible.filter((s) => !s.body.trim());
  if (input.sectionIds && wanted.length !== input.sectionIds.length) throw rule('SECTION_LOCKED', 'One of these sections cannot be drafted with AI');
  if (wanted.length === 0) throw rule('NOTHING_TO_DRAFT', 'There is no empty section that AI may draft');

  const prompt = PROMPTS.draft_section;
  const context = await buildContext(ctx, actor, { dealId: p.dealId, proposalId: p.id, include: prompt.sources, budgetTokens: prompt.contextBudget });
  const task = {
    sections: wanted.map((s) => ({ id: s.id, title: s.title, existingText: s.body })),
    ...(input.instructions ? { instructions: input.instructions } : {}),
  };
  const { data, meta } = await runAi(ctx, actor, prompt, renderUserMessage(task, context), { ...trace, dealId: p.dealId });

  const generations: { generationId: string; sectionId: string; text: string; unverifiedFigures: string[] }[] = [];
  for (const s of wanted) {
    const text = cleanLines(data.sections.find((x) => x.sectionId === s.id)?.text ?? '');
    if (!text) continue; // the model skipped a requested section; ids it invented are ignored
    // Regenerating replaces the previous unanswered suggestion for that section.
    await ctx.db
      .update(aiGeneration)
      .set({ status: 'discarded', decidedAt: ctx.now() })
      .where(
        and(
          eq(aiGeneration.status, 'pending'),
          eq(aiGeneration.feature, 'draft_section'),
          sql`${aiGeneration.target}->>'proposalId' = ${p.id}`,
          sql`${aiGeneration.target}->>'sectionId' = ${s.id}`,
        ),
      );
    const generationId = await insertGeneration(ctx, actor, {
      feature: 'draft_section',
      dealId: p.dealId,
      target: { proposalId: p.id, sectionId: s.id },
      output: { text },
      meta,
      context,
    });
    generations.push({ generationId, sectionId: s.id, text, unverifiedFigures: unverifiedFigures(text, context.facts) });
  }
  if (generations.length === 0) throw new DomainError('AI_OUTPUT_INVALID', 502, 'The AI service returned an answer that could not be used. Please try again.');
  return { generations, label: LABEL, meta: publicMeta(meta) };
}

export async function draftSection(
  ctx: AppContext,
  actor: UserActor,
  input: { proposalId: string; sectionId: string; instructions?: string | undefined },
  trace: AiTrace = {},
) {
  const r = await draftSections(ctx, actor, { proposalId: input.proposalId, sectionIds: [input.sectionId], instructions: input.instructions }, trace);
  return { ...r.generations[0]!, label: r.label, meta: r.meta };
}

// ───────────────────────── B. Pre-send review (BR-AIA-002) ─────────────────────────
export interface ReviewFinding {
  id: string;
  source: 'rule' | 'ai';
  /** Rule findings may block sending. AI findings are always warnings and can never clear a rule finding (RULE-AIA-11). */
  severity: 'blocking' | 'warning';
  category: string;
  description: string;
  evidence: string | null;
  sectionId: string | null;
  sectionTitle: string | null;
  suggestion: string | null;
  status: 'open' | 'acknowledged' | 'dismissed';
}
const RULE_SUGGESTION: Record<RuleFinding['code'], string> = {
  PLACEHOLDER_UNRESOLVED: 'Fill in the missing CRM field, or remove the placeholder from the text.',
  REQUIRED_SECTION_EMPTY: 'Write this section before sending.',
  VALIDITY_DATE_PAST: 'Set a validity date in the future.',
  AI_CONTENT_PENDING: 'Accept or reject the pending AI suggestion.',
  PRICING_DEAL_AMOUNT_MISMATCH: 'Update the deal amount from the proposal, or correct the pricing table.',
  DISCOUNT_LIMIT_EXCEEDED: 'Reduce the discount or ask a manager to send the proposal.',
  NAME_MISMATCH: 'Correct the name.',
  FIGURE_INCONSISTENT: 'Correct the figure.',
};
const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Two layers. (1) Business rules — computed in code from the database, authoritative, run even when AI is off or
 * down. (2) AI semantic review — advisory. Each AI finding must quote text that really is in the named section,
 * otherwise it is dropped, so a hallucinated problem cannot reach the user.
 */
export async function reviewProposal(ctx: AppContext, actor: UserActor, proposalId: string, trace: AiTrace = {}) {
  const { proposal: p, version: v, ruleFindings, values } = await reviewInputs(ctx, actor, proposalId);
  if (v.state !== 'draft') throw conflict('VERSION_IMMUTABLE', 'Only a draft can be reviewed');
  const doc = v.content as ProposalDocument;
  const titleOf = (id: string | null | undefined) => doc.sections.find((s) => s.id === id)?.title ?? null;
  const findings: ReviewFinding[] = ruleFindings.map((f, i) => ({
    id: `rule-${i + 1}`,
    source: 'rule',
    severity: f.severity,
    category: f.code.toLowerCase(),
    description: f.message,
    evidence: null,
    sectionId: f.sectionId ?? null,
    sectionTitle: titleOf(f.sectionId),
    suggestion: RULE_SUGGESTION[f.code],
    status: 'open',
  }));

  let aiStatus: 'completed' | 'disabled' | 'failed' = 'completed';
  let meta: AiMeta | null = null;
  let dropped = 0;
  const prompt = PROMPTS.presend_review;
  try {
    const context = await buildContext(ctx, actor, { dealId: p.dealId, proposalId: p.id, include: prompt.sources, budgetTokens: prompt.contextBudget });
    // The reviewer sees the text as the buyer will: placeholders already replaced with CRM values.
    const resolved = new Map(doc.sections.filter((s) => s.kind !== 'signature').map((s) => [s.id, resolveText(s.body, values)]));
    const facts = context.facts as { proposal?: { sections?: { id: string; text: string }[] } };
    for (const s of facts.proposal?.sections ?? []) s.text = resolved.get(s.id) ?? s.text;
    const result = await runAi(ctx, actor, prompt, renderUserMessage({ review: 'pre-send' }, context), { ...trace, dealId: p.dealId });
    meta = result.meta;
    const seen = new Set<string>();
    for (const f of result.data.findings.slice(0, 30)) {
      const sectionText = resolved.get(f.sectionId);
      const quote = clean(f.quote).slice(0, 300);
      const key = `${f.sectionId}|${f.category}|${squash(quote)}`;
      if (!sectionText || !quote || !squash(sectionText).includes(squash(quote)) || seen.has(key)) {
        dropped++;
        continue;
      }
      seen.add(key);
      findings.push({
        id: `ai-${findings.length + 1}`,
        source: 'ai',
        severity: 'warning',
        category: f.category,
        description: clean(f.description).slice(0, 500),
        evidence: quote,
        sectionId: f.sectionId,
        sectionTitle: titleOf(f.sectionId),
        suggestion: clean(f.suggestion).slice(0, 500) || null,
        status: 'open',
      });
    }
  } catch (error) {
    // AI off, over budget or unavailable never blocks the rule checks (AI-ARCHITECTURE §8.4).
    if (!(error instanceof DomainError) || !error.code.startsWith('AI_')) throw error;
    aiStatus = error.code === 'AI_DISABLED' ? 'disabled' : 'failed';
  }
  const [row] = await ctx.db
    .insert(aiReview)
    .values({
      proposalId: p.id,
      proposalVersionId: v.id,
      versionRowVersion: v.rowVersion,
      requestedBy: actor.userId,
      aiStatus,
      findings,
      requestId: meta?.requestId ?? null,
    })
    .returning({ id: aiReview.id, createdAt: aiReview.createdAt });
  return {
    reviewId: row!.id,
    createdAt: row!.createdAt,
    aiStatus,
    stale: false,
    findings,
    blocking: findings.filter((f) => f.severity === 'blocking').length,
    droppedAiFindings: dropped,
    meta: meta ? publicMeta(meta) : null,
  };
}

export async function latestReview(ctx: AppContext, actor: UserActor, proposalId: string) {
  const [p] = await ctx.db.select().from(proposal).where(eq(proposal.id, proposalId));
  if (!p) throw notFound('Proposal');
  await loadDealFor(ctx.db, actor, p.dealId, 'read');
  const [r] = await ctx.db.select().from(aiReview).where(eq(aiReview.proposalId, proposalId)).orderBy(desc(aiReview.createdAt)).limit(1);
  if (!r) return null;
  const [v] = await ctx.db
    .select({ rowVersion: proposalVersion.rowVersion, state: proposalVersion.state })
    .from(proposalVersion)
    .where(eq(proposalVersion.id, r.proposalVersionId));
  const findings = r.findings as ReviewFinding[];
  // A review describes one saved state of the draft; after any edit it is shown as out of date.
  return {
    reviewId: r.id,
    createdAt: r.createdAt,
    aiStatus: r.aiStatus,
    stale: !v || v.rowVersion !== r.versionRowVersion || v.state !== 'draft',
    findings,
    blocking: findings.filter((f) => f.severity === 'blocking').length,
  };
}

/** The salesperson records what they did about a finding. Rule blockers cannot be dismissed — they must be fixed. */
export async function decideFinding(ctx: AppContext, actor: UserActor, reviewId: string, findingId: string, decision: 'acknowledged' | 'dismissed') {
  return unitOfWork(ctx, actor, async (u) => {
    const [r] = await u.tx.select().from(aiReview).where(eq(aiReview.id, reviewId)).for('update');
    if (!r) throw notFound('Review');
    const [p] = await u.tx.select().from(proposal).where(eq(proposal.id, r.proposalId));
    await loadDealFor(u.tx, actor, p!.dealId, 'write', 'proposal.manage').catch((e) => {
      throw e instanceof DomainError && e.code === 'NOT_FOUND' ? notFound('Review') : e;
    });
    const findings = r.findings as ReviewFinding[];
    const f = findings.find((x) => x.id === findingId);
    if (!f) throw notFound('Finding');
    if (f.severity === 'blocking') throw rule('FINDING_MUST_BE_FIXED', 'This issue must be fixed in the proposal; it cannot be dismissed');
    f.status = decision;
    await u.tx.update(aiReview).set({ findings }).where(eq(aiReview.id, reviewId));
    await u.audit(`ai.finding_${decision}`, { type: 'ai_review', id: reviewId }, { findingId, source: f.source, category: f.category });
    return { findingId, status: decision };
  });
}

// ───────────────────────── C. Deal summary (BR-AIA-003) ─────────────────────────
export async function dealSummary(ctx: AppContext, actor: UserActor, dealId: string, trace: AiTrace = {}) {
  const prompt = PROMPTS.deal_summary;
  const context = await buildContext(ctx, actor, { dealId, include: prompt.sources, budgetTokens: prompt.contextBudget }); // 404 if not visible
  const { data, meta } = await runAi(ctx, actor, prompt, renderUserMessage({ summarize: 'deal' }, context), { ...trace, dealId });
  const list = (items: string[]) =>
    items
      .map((x) => clean(x).slice(0, 400))
      .filter(Boolean)
      .slice(0, 6);
  const summary = {
    overview: clean(data.overview).slice(0, 1500),
    currentStatus: clean(data.currentStatus).slice(0, 600),
    keyPoints: list(data.keyPoints),
    risks: list(data.risks),
    nextSteps: list(data.nextSteps),
    openQuestions: list(data.openQuestions),
  };
  const generationId = await insertGeneration(ctx, actor, { feature: 'deal_summary', dealId, target: { dealId }, output: summary, meta, context });
  const count = (type: string) => context.refs.filter((r) => r.type === type).length;
  return {
    generationId,
    label: 'AI-generated summary',
    /** Recorded CRM data, shown separately from the AI text so the reader can tell fact from interpretation. */
    facts: context.facts,
    summary,
    sources: {
      notes: count('note'),
      callsAndMeetings: count('activity'),
      proposals: count('proposal'),
      contacts: count('contact'),
      tasks: count('task'),
      shareLinks: count('share_link'),
      omittedTexts: context.omittedTexts,
    },
    meta: publicMeta(meta),
  };
}

// ───────────────────────── D. Selected-text rewrite (BR-AIA-004) ─────────────────────────
export async function rewriteText(ctx: AppContext, actor: UserActor, input: z.infer<typeof aiRewriteInput>, trace: AiTrace = {}) {
  const { p, v, doc, locked } = await draftVersionFor(ctx, actor, input.proposalId);
  const section = doc.sections.find((s) => s.id === input.sectionId);
  if (section?.kind !== 'text' || locked.has(section.id)) throw rule('SECTION_LOCKED', 'This section cannot be changed');
  if (section.body.slice(input.selectionStart, input.selectionStart + input.selectedText.length) !== input.selectedText) {
    throw conflict('SELECTION_CHANGED', 'The selected text does not match the saved draft. Save the draft and select the text again.');
  }
  const prompt = PROMPTS.rewrite_text;
  const context = await buildContext(ctx, actor, { dealId: p.dealId, include: prompt.sources, budgetTokens: prompt.contextBudget });
  const end = input.selectionStart + input.selectedText.length;
  const task = {
    mode: input.mode,
    goal: REWRITE_MODES[input.mode],
    selectedText: input.selectedText,
    surroundingText: { before: section.body.slice(Math.max(0, input.selectionStart - 300), input.selectionStart), after: section.body.slice(end, end + 300) },
    ...(input.instructions ? { instructions: input.instructions } : {}),
  };
  const { data, meta } = await runAi(ctx, actor, prompt, renderUserMessage(task, context), { ...trace, dealId: p.dealId });
  const replacement = cleanLines(data.replacement);
  if (!replacement) throw new DomainError('AI_OUTPUT_INVALID', 502, 'The AI service returned an empty rewrite. Please try again.');
  const placeholders = (t: string) => [...t.matchAll(/\{\{\s*[a-z_]+\.[a-z0-9_.]+\s*\}\}/g)].map((m) => m[0].replace(/\s/g, ''));
  const kept = new Set(placeholders(replacement));
  const generationId = await insertGeneration(ctx, actor, {
    feature: 'rewrite_text',
    dealId: p.dealId,
    // The exact span is stored so acceptance can only ever replace this selection — nothing else in the proposal.
    target: {
      proposalId: p.id,
      sectionId: section.id,
      selectionStart: input.selectionStart,
      selectedText: input.selectedText,
      mode: input.mode,
      versionRowVersion: v.rowVersion,
    },
    output: { text: replacement },
    meta,
    context,
  });
  return {
    generationId,
    sectionId: section.id,
    original: input.selectedText,
    replacement,
    lostPlaceholders: [...new Set(placeholders(input.selectedText).filter((x) => !kept.has(x)))],
    unverifiedFigures: unverifiedFigures(replacement, [context.facts, input.selectedText]),
    label: LABEL,
    meta: publicMeta(meta),
  };
}

// ───────────────────────── E. Follow-up email draft (BR-AIA-005) ─────────────────────────
/** Produces a DRAFT only. There is no send function in this module or behind this endpoint. */
export async function followUpDraft(ctx: AppContext, actor: UserActor, input: z.infer<typeof aiFollowUpInput>, trace: AiTrace = {}) {
  const d = await loadDealFor(ctx.db, actor, input.dealId, 'write');
  const [recipient] = await ctx.db
    .select({ id: contact.id, firstName: contact.firstName, lastName: contact.lastName, jobTitle: contact.jobTitle, email: contact.email })
    .from(dealContact)
    .innerJoin(contact, eq(contact.id, dealContact.contactId))
    .where(and(eq(dealContact.dealId, d.id), eq(dealContact.contactId, input.contactId)));
  if (!recipient) throw rule('CONTACT_NOT_ON_DEAL', 'The recipient must be a contact on this deal');
  let proposalId = input.proposalId;
  if (proposalId) {
    const [p] = await ctx.db
      .select({ id: proposal.id })
      .from(proposal)
      .where(and(eq(proposal.id, proposalId), eq(proposal.dealId, d.id)));
    if (!p) throw notFound('Proposal');
  } else {
    const [latest] = await ctx.db
      .select({ id: proposal.id })
      .from(proposal)
      .where(and(eq(proposal.dealId, d.id), inArray(proposal.status, ['sent', 'viewed', 'accepted', 'declined'])))
      .orderBy(desc(proposal.updatedAt))
      .limit(1);
    proposalId = latest?.id;
  }
  const prompt = PROMPTS.follow_up_email;
  const context = await buildContext(ctx, actor, {
    dealId: d.id,
    ...(proposalId ? { proposalId } : {}),
    include: prompt.sources,
    budgetTokens: prompt.contextBudget,
  });
  const [sender] = await ctx.db.select({ fullName: appUserProfile.fullName }).from(appUserProfile).where(eq(appUserProfile.userId, actor.userId));
  const task = {
    scenario: input.scenario,
    scenarioGuidance: FOLLOW_UP_SCENARIOS[input.scenario],
    recipient: { firstName: recipient.firstName, fullName: [recipient.firstName, recipient.lastName].filter(Boolean).join(' '), jobTitle: recipient.jobTitle },
    senderName: sender?.fullName ?? '',
    ...(input.instructions ? { instructions: input.instructions } : {}),
  };
  const { data, meta } = await runAi(ctx, actor, prompt, renderUserMessage(task, context), { ...trace, dealId: d.id });
  const draft = { subject: clean(data.subject).replace(/\n/g, ' ').slice(0, 200), body: cleanLines(data.body).slice(0, 5000) };
  if (!draft.subject || !draft.body) throw new DomainError('AI_OUTPUT_INVALID', 502, 'The AI service returned an empty draft. Please try again.');
  const generationId = await insertGeneration(ctx, actor, {
    feature: 'follow_up_email',
    dealId: d.id,
    target: { dealId: d.id, contactId: recipient.id, proposalId: proposalId ?? null, scenario: input.scenario },
    output: draft,
    meta,
    context,
  });
  return {
    generationId,
    ...draft,
    // The address is looked up for the user's convenience; it was never sent to the AI provider.
    recipient: { contactId: recipient.id, name: task.recipient.fullName, email: recipient.email },
    unverifiedFigures: unverifiedFigures(draft.body, context.facts),
    label: 'AI-generated draft — nothing has been sent',
    meta: publicMeta(meta),
  };
}

// ───────────────────────── Human decision (BR-AIA-007) ─────────────────────────
/**
 * The only place an AI suggestion can change CRM data, and only for the user who requested it.
 *   draft_section   → replaces that one section of the DRAFT
 *   rewrite_text    → replaces exactly the stored selection inside that one section of the DRAFT
 *   deal_summary    → saved as a note on the deal, marked as an AI-assisted summary
 *   follow_up_email → marked approved and kept as a record; the CRM does not send it
 */
export async function decide(ctx: AppContext, actor: UserActor, generationId: string, input: z.infer<typeof aiDecisionInput>) {
  return unitOfWork(ctx, actor, async (u) => {
    const [g] = await u.tx.select().from(aiGeneration).where(eq(aiGeneration.id, generationId)).for('update');
    if (!g || g.requestedBy !== actor.userId) throw notFound('AI suggestion');
    // Weekly report text is decided only by approving the report (modules/weekly-reports.ts), never here.
    if (g.feature === 'weekly_report') throw rule('WEEKLY_REPORT_DECIDED_BY_APPROVAL', 'This text is accepted by approving the weekly report');
    if (g.status !== 'pending') throw conflict('INVALID_STATE_TRANSITION', 'This suggestion was already decided');
    const output = g.output as { text?: string; subject?: string; body?: string; overview?: string };
    let accepted: Record<string, unknown> | null = null;
    let edited = false;

    if (input.decision === 'accept') {
      if (g.feature === 'draft_section' || g.feature === 'rewrite_text') {
        const target = g.target as { proposalId: string; sectionId: string; selectionStart?: number; selectedText?: string };
        const [p] = await u.tx.select().from(proposal).where(eq(proposal.id, target.proposalId));
        await loadDealFor(u.tx, actor, p!.dealId, 'write', 'proposal.manage');
        const [v] = await u.tx
          .select()
          .from(proposalVersion)
          .where(and(eq(proposalVersion.proposalId, target.proposalId), eq(proposalVersion.state, 'draft')))
          .for('update');
        if (!v) throw conflict('VERSION_IMMUTABLE', 'The draft no longer exists');
        const text = cleanLines(input.editedText ?? output.text ?? '');
        if (!text) throw rule('EMPTY_TEXT', 'There is no text to insert');
        edited = input.editedText !== undefined && input.editedText !== output.text;
        const content = v.content as ProposalDocument;
        const section = content.sections.find((s) => s.id === target.sectionId);
        if (!section) throw conflict('SECTION_GONE', 'That section is no longer in the draft');
        let body = text;
        if (g.feature === 'rewrite_text') {
          const selected = target.selectedText ?? '';
          let start = target.selectionStart ?? -1;
          if (section.body.slice(start, start + selected.length) !== selected) {
            // The text moved because of other edits: accept only if the selection is still there exactly once.
            const first = section.body.indexOf(selected);
            if (first === -1 || section.body.indexOf(selected, first + 1) !== -1)
              throw conflict('SELECTION_CHANGED', 'The original text has changed since this rewrite was requested. Request a new rewrite.');
            start = first;
          }
          body = section.body.slice(0, start) + text + section.body.slice(start + selected.length);
        }
        const next: ProposalDocument = { ...content, sections: content.sections.map((s) => (s.id === target.sectionId ? { ...s, body } : s)) };
        await u.tx
          .update(proposalVersion)
          .set({ content: next, updatedAt: ctx.now(), updatedBy: actor.userId, rowVersion: sql`${proposalVersion.rowVersion} + 1` })
          .where(eq(proposalVersion.id, v.id));
        await u.timeline({
          eventType: 'ai_content_accepted',
          source: { type: 'proposal', id: target.proposalId },
          summary:
            g.feature === 'rewrite_text'
              ? 'An AI rewrite of selected proposal text was reviewed and accepted'
              : 'AI-drafted proposal content was reviewed and accepted',
          anchors: [{ type: 'deal', id: p!.dealId }],
        });
        accepted = { text };
      } else if (g.feature === 'deal_summary') {
        const dealId = (g.target as { dealId: string }).dealId;
        await loadDealFor(u.tx, actor, dealId, 'write');
        const s = g.output as { overview: string; currentStatus: string; keyPoints: string[]; risks: string[]; nextSteps: string[] };
        const composed = [
          s.overview,
          s.currentStatus,
          s.keyPoints.length ? `Key points:\n- ${s.keyPoints.join('\n- ')}` : '',
          s.risks.length ? `Risks (AI interpretation):\n- ${s.risks.join('\n- ')}` : '',
          s.nextSteps.length ? `Suggested next steps (AI interpretation):\n- ${s.nextSteps.join('\n- ')}` : '',
        ]
          .filter(Boolean)
          .join('\n\n');
        const text = cleanLines(input.editedText ?? composed);
        if (!text) throw rule('EMPTY_TEXT', 'There is no text to save');
        edited = input.editedText !== undefined && input.editedText !== composed;
        const body = `AI-assisted summary (reviewed)\n\n${text}`.slice(0, 10_000);
        const [n] = await u.tx
          .insert(note)
          .values({ body, relatedType: 'deal', relatedId: dealId, authorId: actor.userId, createdBy: actor.userId })
          .returning({ id: note.id });
        await u.timeline({
          eventType: 'note',
          source: { type: 'note', id: n!.id },
          summary: body.length > 200 ? `${body.slice(0, 200)}…` : body,
          anchors: [{ type: 'deal', id: dealId }],
        });
        accepted = { noteId: n!.id, text };
      } else if (g.feature === 'follow_up_email') {
        const t = g.target as { dealId: string };
        await loadDealFor(u.tx, actor, t.dealId, 'write');
        const subject = clean(input.editedSubject ?? output.subject ?? '')
          .replace(/\n/g, ' ')
          .slice(0, 300);
        const body = cleanLines(input.editedText ?? output.body ?? '');
        if (!subject || !body) throw rule('EMPTY_TEXT', 'The email needs a subject and a body');
        edited = body !== output.body || subject !== output.subject;
        // Approval records the reviewed text. Sending is a separate action the user performs in their own mail client.
        await u.timeline({
          eventType: 'ai_email_draft_approved',
          source: { type: 'ai_generation', id: g.id },
          summary: `Follow-up email draft approved: “${subject}” (not sent by the CRM)`,
          anchors: [{ type: 'deal', id: t.dealId }],
        });
        accepted = { subject, body };
      } else {
        throw conflict('INVALID_STATE_TRANSITION', 'This suggestion cannot be accepted');
      }
    }
    const status = input.decision === 'reject' ? 'rejected' : edited ? 'edited_accepted' : 'accepted';
    await u.tx
      .update(aiGeneration)
      .set({ status, decidedAt: ctx.now(), decidedBy: actor.userId, acceptedOutput: accepted })
      .where(eq(aiGeneration.id, generationId));
    await u.audit(
      input.decision === 'accept' ? 'ai.output_accepted' : 'ai.output_rejected',
      { type: 'ai_generation', id: generationId },
      { feature: g.feature, edited, provider: g.provider, model: g.model },
    );
    return { status, accepted };
  });
}

// ───────────────────────── Status, settings, usage (BR-AIA-007/008) ─────────────────────────
/** What the UI needs to show or hide AI controls. Never includes credentials. */
export async function status(ctx: AppContext, actor: UserActor) {
  requirePerm(actor, 'ai.use');
  const settings = await loadAiSettings(ctx);
  const provider = ctx.ai.status();
  const [today] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.userId, actor.userId),
        gte(aiUsage.occurredAt, new Date(ctx.now().toISOString().slice(0, 10))),
        sql`${aiUsage.outcome} not like 'blocked_%'`,
      ),
    );
  return {
    enabled: settings.enabled,
    features: settings.features,
    provider,
    models: Object.fromEntries(FEATURE_KEYS.map((f) => [f, provider.simulated ? 'simulator' : PROMPTS[f].model(ctx.config)])),
    myCallsToday: today?.n ?? 0,
    perUserDailyCalls: settings.perUserDailyCalls,
  };
}

export async function getSettings(ctx: AppContext, actor: UserActor) {
  requirePerm(actor, 'settings.manage');
  return {
    settings: await loadAiSettings(ctx),
    provider: ctx.ai.status(),
    prompts: FEATURE_KEYS.map((f) => ({ feature: f, version: PROMPTS[f].version, model: PROMPTS[f].model(ctx.config), effort: PROMPTS[f].effort })),
  };
}

export async function updateSettings(ctx: AppContext, actor: UserActor, input: z.infer<typeof aiSettingsInput>) {
  requirePerm(actor, 'settings.manage');
  return unitOfWork(ctx, actor, async (u) => {
    const [row] = await u.tx.select({ id: organizationSettings.id, ai: organizationSettings.aiSettings }).from(organizationSettings).for('update');
    if (!row) throw forbidden('NOT_CONFIGURED', 'Organization settings are missing');
    const before = resolveAiSettings(row.ai);
    // Feature switches are merged with the stored ones: a client that does not know a newer switch
    // (for example weekly_report) must not reset it by leaving it out.
    const sent = Object.fromEntries(Object.entries(input.features).filter(([, v]) => v !== undefined));
    const after = { ...input, features: { ...(row.ai.features ?? {}), ...sent } };
    await u.tx
      .update(organizationSettings)
      .set({ aiSettings: after, updatedAt: ctx.now(), updatedBy: actor.userId })
      .where(eq(organizationSettings.id, row.id));
    await u.audit('ai.settings_changed', null, { before, after });
    return { settings: resolveAiSettings(after) };
  });
}

const usageColumns = {
  id: aiUsage.id,
  occurredAt: aiUsage.occurredAt,
  feature: aiUsage.feature,
  provider: aiUsage.provider,
  model: aiUsage.model,
  simulated: aiUsage.simulated,
  outcome: aiUsage.outcome,
  errorCode: aiUsage.errorCode,
  inputTokens: aiUsage.inputTokens,
  outputTokens: aiUsage.outputTokens,
  costMicroUsd: aiUsage.costMicroUsd,
  latencyMs: aiUsage.latencyMs,
  attempts: aiUsage.attempts,
  requestId: aiUsage.requestId,
};

/** A user's own AI history, joined to what they decided about each suggestion. */
export async function myUsage(ctx: AppContext, actor: UserActor) {
  requirePerm(actor, 'ai.use');
  const rows = await ctx.db
    .select({ ...usageColumns, decision: aiGeneration.status })
    .from(aiUsage)
    .leftJoin(aiGeneration, eq(aiGeneration.requestId, aiUsage.requestId))
    .where(eq(aiUsage.userId, actor.userId))
    .orderBy(desc(aiUsage.occurredAt))
    .limit(100);
  // One request can create several suggestions (multi-section drafts): keep one history line per request.
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

/** Organization-wide usage for Admins (PERM-140): totals by feature, by user, this month's estimated cost, recent calls. */
export async function usageReport(ctx: AppContext, actor: UserActor) {
  requirePerm(actor, 'settings.manage');
  const now = ctx.now();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const agg = {
    calls: sql<number>`count(*)::int`,
    succeeded: sql<number>`count(*) filter (where ${aiUsage.outcome} = 'success')::int`,
    failed: sql<number>`count(*) filter (where ${aiUsage.outcome} in ('error','invalid_output','refused'))::int`,
    blocked: sql<number>`count(*) filter (where ${aiUsage.outcome} like 'blocked_%')::int`,
    inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}),0)::int`,
    outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}),0)::int`,
    costMicroUsd: sql<number>`coalesce(sum(${aiUsage.costMicroUsd}),0)::bigint`,
  };
  const byFeature = await ctx.db
    .select({ feature: aiUsage.feature, ...agg })
    .from(aiUsage)
    .where(gte(aiUsage.occurredAt, monthStart))
    .groupBy(aiUsage.feature)
    .orderBy(aiUsage.feature);
  const byUser = await ctx.db
    .select({ userId: aiUsage.userId, fullName: appUserProfile.fullName, ...agg })
    .from(aiUsage)
    .leftJoin(appUserProfile, eq(appUserProfile.userId, aiUsage.userId))
    .where(gte(aiUsage.occurredAt, monthStart))
    .groupBy(aiUsage.userId, appUserProfile.fullName)
    .orderBy(desc(sql`count(*)`));
  const decisions = await ctx.db
    .select({ feature: aiGeneration.feature, status: aiGeneration.status, n: sql<number>`count(*)::int` })
    .from(aiGeneration)
    .where(gte(aiGeneration.createdAt, monthStart))
    .groupBy(aiGeneration.feature, aiGeneration.status);
  const recent = await ctx.db
    .select({ ...usageColumns, userName: appUserProfile.fullName })
    .from(aiUsage)
    .leftJoin(appUserProfile, eq(appUserProfile.userId, aiUsage.userId))
    .orderBy(desc(aiUsage.occurredAt))
    .limit(50);
  const settings = await loadAiSettings(ctx);
  const num = <T extends { costMicroUsd: number }>(r: T) => ({ ...r, costMicroUsd: Number(r.costMicroUsd) });
  return {
    monthStart,
    monthCostMicroUsd: byFeature.reduce((s, r) => s + Number(r.costMicroUsd), 0),
    monthlyBudgetUsd: settings.monthlyBudgetUsd,
    byFeature: byFeature.map(num),
    byUser: byUser.map(num),
    decisions,
    recent,
  };
}

export { assertAiAllowed };
