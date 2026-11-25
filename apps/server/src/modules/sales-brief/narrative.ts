/**
 * Insights & Narrative agent of the Weekly Sales Brief: the only step that uses AI. It runs on behalf of the
 * brief's admin owner (their AI permission, limits and usage records apply), has no tools, and writes text only —
 * what the code-computed signals mean and what to do about them. Its output is checked by code (checks.ts) and
 * approved by a person before anything is final. Prompts and outputs are never logged.
 *
 * Flow: draft → check → on failed checks redraft with the failures as feedback (at most 2 regenerations) → if it
 * still fails, or the AI call itself fails, fall back to placeholders a person must replace. A run never fails
 * because of AI.
 */
import type { SalesBriefNarrative, SalesBriefStatement, SalesSignal } from '../../db/schema-sales-brief.ts';
import type { WeeklyFlag } from '../../db/schema-weekly-reports.ts';
import type { AppContext, UserActor } from '../../platform/core.ts';
import { schema } from '../../platform/core.ts';
import { DomainError } from '../../platform/errors/domain-error.ts';
import { type AiContext, sanitizeText } from '../ai/context.ts';
import { type AiMeta, runAi } from '../ai/engine.ts';
import { PROMPTS, renderUserMessage } from '../ai/prompts.ts';
import { FALLBACK_TEXT } from '../weekly-reports/checks.ts';
import { BRIEF_SECTIONS, checkBrief } from './checks.ts';

const MAX_REGENERATIONS = 2;
const RAW_TEXT_CAP = 600; // above the check limit, so over-long statements are reported rather than silently cut
const MAX_SOURCES = 12;
/** Sections that get a placeholder when there is no AI text: enough for a person to finish the brief by hand. */
const FALLBACK_SECTIONS = ['headline', 'insights', 'actions'];

interface RunRef {
  id: string;
  periodStart: string;
  periodEnd: string;
}
const ids = (list: string[] | undefined) => [...new Set((list ?? []).map((x) => x.trim()).filter(Boolean))].slice(0, MAX_SOURCES);

export async function draftBrief(
  ctx: AppContext,
  owner: UserActor,
  run: RunRef,
  facts: AiContext,
  feedback?: string[],
): Promise<{ narrative: SalesBriefNarrative; meta: AiMeta }> {
  const task = { report: 'weekly_sales_brief', period: { start: run.periodStart, end: run.periodEnd }, ...(feedback?.length ? { feedback } : {}) };
  const { data, meta } = await runAi(ctx, owner, PROMPTS.sales_brief, renderUserMessage(task, facts));
  let n = 0;
  const narrative = {} as SalesBriefNarrative;
  for (const section of BRIEF_SECTIONS)
    narrative[section] = (data[section] as { text: string; sources: string[]; signalIds?: string[]; kind?: SalesBriefStatement['kind'] }[])
      .map((s) => ({ ...s, text: sanitizeText(s.text, RAW_TEXT_CAP) }))
      .filter((s) => s.text !== '')
      .map(
        (s): SalesBriefStatement => ({
          id: `s${++n}`,
          text: s.text,
          sources: ids(s.sources),
          origin: 'ai',
          ...(section === 'insights' || section === 'actions' ? { signalIds: ids(s.signalIds) } : {}),
          ...(section === 'insights' && s.kind ? { kind: s.kind } : {}),
        }),
      );
  return { narrative, meta };
}

export function fallbackBrief(): SalesBriefNarrative {
  let n = 0;
  const narrative = {} as SalesBriefNarrative;
  for (const section of BRIEF_SECTIONS)
    narrative[section] = FALLBACK_SECTIONS.includes(section) ? [{ id: `s${++n}`, text: FALLBACK_TEXT, sources: [], origin: 'fallback' }] : [];
  return narrative;
}

/** Why the AI text is missing, in words for the reviewer (error codes stay out of the UI). */
const FALLBACK_REASON: Record<string, string> = {
  AI_DISABLED: 'AI is switched off for the sales brief',
  AI_QUOTA_EXCEEDED: 'the AI limit for today or the monthly budget was reached',
  AI_RATE_LIMITED: 'too many AI requests were made at once',
  AI_PROVIDER_UNAVAILABLE: 'the AI service was not available',
  AI_REFUSED: 'the AI declined to write the text',
  AI_OUTPUT_INVALID: 'the AI answer could not be read',
  FORBIDDEN: 'the admin the brief runs for may not use AI',
  CHECKS_FAILED: 'the AI text did not pass the checks',
};
export const briefFallbackMessage = (code: string) =>
  `No AI analysis: ${FALLBACK_REASON[code] ?? 'the AI text could not be produced'}. The figures and findings are complete; write the text yourself, or regenerate.`;

export interface BriefNarrativeResult {
  narrative: SalesBriefNarrative;
  flags: WeeklyFlag[];
  aiFallback: boolean;
  /** Present when AI text is used: provenance for the ai_generation record. */
  meta: AiMeta | null;
}

export async function writeBrief(ctx: AppContext, owner: UserActor, run: RunRef, facts: AiContext, signals: SalesSignal[]): Promise<BriefNarrativeResult> {
  const fallback = (why: string): BriefNarrativeResult => ({
    narrative: fallbackBrief(),
    flags: [{ code: 'AI_FALLBACK', statementId: null, message: briefFallbackMessage(why) }],
    aiFallback: true,
    meta: null,
  });
  let feedback: string[] | undefined;
  for (let attempt = 0; attempt <= MAX_REGENERATIONS; attempt++) {
    let drafted: Awaited<ReturnType<typeof draftBrief>>;
    try {
      drafted = await draftBrief(ctx, owner, run, facts, feedback);
    } catch (error) {
      // AI switched off, limits or budget reached, provider unavailable, refusal, unusable output, no ai.use permission.
      if (error instanceof DomainError) return fallback(error.code);
      throw error;
    }
    const flags = checkBrief(drafted.narrative, facts.facts, signals);
    if (flags.length === 0) return { narrative: drafted.narrative, flags: [], aiFallback: false, meta: drafted.meta };
    feedback = flags.map((f) => `${f.statementId ?? 'brief'}: ${f.code} - ${f.message}`).slice(0, 20);
  }
  return fallback('CHECKS_FAILED');
}

/** Records the AI text awaiting a person's decision (the approval of the brief). */
export async function storeBriefGeneration(
  ctx: AppContext,
  owner: UserActor,
  input: { runId: string; narrative: SalesBriefNarrative; meta: AiMeta; facts: AiContext },
): Promise<string> {
  const [g] = await ctx.db
    .insert(schema.aiGeneration)
    .values({
      feature: 'sales_brief',
      requestedBy: owner.userId,
      dealId: null,
      target: { salesBriefRunId: input.runId },
      promptVersion: input.meta.promptVersion,
      output: input.narrative,
      status: 'pending',
      provider: input.meta.provider,
      model: input.meta.model,
      simulated: input.meta.simulated,
      requestId: input.meta.requestId,
      contextRefs: input.facts.refs, // ids of the records used — never their content
    })
    .returning({ id: schema.aiGeneration.id });
  return (g as { id: string }).id;
}
