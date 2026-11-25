/**
 * Narrative agent: the only step that uses AI, and it writes text only. It runs on behalf of the company owner
 * (their AI permission, limits and usage records apply), has no tools, and its output is checked by code
 * (checks.ts) and approved by a person before anything is final. Prompts and outputs are never logged.
 *
 * Flow: draft → check → on failed checks redraft with the failures as feedback (at most 2 regenerations) →
 * if it still fails, or the AI call itself fails, fall back to placeholders a person must replace.
 * A run therefore never fails because of AI.
 */
import type { WeeklyFlag, WeeklyNarrative, WeeklyStatement } from '../../db/schema-weekly-reports.ts';
import type { AppContext, UserActor } from '../../platform/core.ts';
import { schema } from '../../platform/core.ts';
import { DomainError } from '../../platform/errors/domain-error.ts';
import { type AiContext, sanitizeText } from '../ai/context.ts';
import { type AiMeta, runAi } from '../ai/engine.ts';
import { PROMPTS, renderUserMessage } from '../ai/prompts.ts';
import { checkNarrative, FALLBACK_TEXT, SECTIONS } from './checks.ts';

const MAX_REGENERATIONS = 2;
const RAW_TEXT_CAP = 600; // above the check limit, so over-long statements are reported rather than silently cut
const MAX_SOURCES = 10;

interface RunRef {
  id: string;
  companyId: string;
  periodStart: string;
  periodEnd: string;
}

export async function draftNarrative(
  ctx: AppContext,
  owner: UserActor,
  run: RunRef,
  facts: AiContext,
  feedback?: string[],
): Promise<{ narrative: WeeklyNarrative; meta: AiMeta }> {
  const task = {
    report: 'weekly_client_status',
    period: { start: run.periodStart, end: run.periodEnd },
    ...(feedback?.length ? { feedback } : {}),
  };
  const { data, meta } = await runAi(ctx, owner, PROMPTS.weekly_report, renderUserMessage(task, facts));
  let n = 0;
  const narrative = {} as WeeklyNarrative;
  for (const section of SECTIONS)
    narrative[section] = data[section]
      .map((s) => ({ text: sanitizeText(s.text, RAW_TEXT_CAP), sources: [...new Set(s.sources.map((x) => x.trim()).filter(Boolean))].slice(0, MAX_SOURCES) }))
      .filter((s) => s.text !== '')
      .map((s): WeeklyStatement => ({ id: `s${++n}`, text: s.text, sources: s.sources, origin: 'ai' }));
  return { narrative, meta };
}

export function fallbackNarrative(): WeeklyNarrative {
  let n = 0;
  const narrative = {} as WeeklyNarrative;
  for (const section of SECTIONS) narrative[section] = [{ id: `s${++n}`, text: FALLBACK_TEXT, sources: [], origin: 'fallback' }];
  return narrative;
}

export interface NarrativeResult {
  narrative: WeeklyNarrative;
  flags: WeeklyFlag[];
  aiFallback: boolean;
  /** Present when AI text is used: provenance for the ai_generation record. */
  meta: AiMeta | null;
}

/** Why the AI text is missing, in words for the reviewer (the report page shows it; error codes stay out of the UI). */
const FALLBACK_REASON: Record<string, string> = {
  AI_DISABLED: 'AI is switched off for weekly reports',
  AI_QUOTA_EXCEEDED: 'the AI limit for today or the monthly budget was reached',
  AI_RATE_LIMITED: 'too many AI requests were made at once',
  AI_PROVIDER_UNAVAILABLE: 'the AI service was not available',
  AI_REFUSED: 'the AI declined to write the text',
  AI_OUTPUT_INVALID: 'the AI answer could not be read',
  FORBIDDEN: 'the company owner may not use AI',
  CHECKS_FAILED: 'the AI text did not pass the checks',
};
export const fallbackMessage = (code: string) =>
  `No AI text: ${FALLBACK_REASON[code] ?? 'the AI text could not be produced'}. Write the text yourself, or regenerate.`;

export async function writeNarrative(ctx: AppContext, owner: UserActor, run: RunRef, facts: AiContext): Promise<NarrativeResult> {
  const fallback = (why: string): NarrativeResult => ({
    narrative: fallbackNarrative(),
    flags: [{ code: 'AI_FALLBACK', statementId: null, message: fallbackMessage(why) }],
    aiFallback: true,
    meta: null,
  });
  let feedback: string[] | undefined;
  for (let attempt = 0; attempt <= MAX_REGENERATIONS; attempt++) {
    let drafted: Awaited<ReturnType<typeof draftNarrative>>;
    try {
      drafted = await draftNarrative(ctx, owner, run, facts, feedback);
    } catch (error) {
      // AI switched off, limits or budget reached, provider unavailable, refusal, unusable output, no ai.use permission.
      if (error instanceof DomainError) return fallback(error.code);
      throw error;
    }
    const flags = checkNarrative(drafted.narrative, facts.facts);
    if (flags.length === 0) return { narrative: drafted.narrative, flags: [], aiFallback: false, meta: drafted.meta };
    feedback = flags.map((f) => `${f.statementId ?? 'report'}: ${f.code} - ${f.message}`).slice(0, 20);
  }
  return fallback('CHECKS_FAILED');
}

/** Records the AI narrative awaiting a person's decision. A small helper of its own: other features keep theirs. */
export async function storeWeeklyGeneration(
  ctx: AppContext,
  owner: UserActor,
  input: { runId: string; companyId: string; narrative: WeeklyNarrative; meta: AiMeta; facts: AiContext },
): Promise<string> {
  const [g] = await ctx.db
    .insert(schema.aiGeneration)
    .values({
      feature: 'weekly_report',
      requestedBy: owner.userId,
      dealId: null,
      target: { weeklyReportRunId: input.runId, companyId: input.companyId },
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
  return g!.id;
}
