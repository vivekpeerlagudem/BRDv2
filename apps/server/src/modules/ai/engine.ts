/**
 * AI call engine: every AI feature goes through `runAi`, which is the single place that enforces
 *   admin switch → feature switch → budgets and rate limit → provider call (timeout, retry) → JSON + schema validation
 *   (one repair attempt) → usage record.
 * It returns validated data plus metadata. It never writes to CRM records: persisting a suggestion and applying it
 * after a human decision is the service's job (modules/ai.ts).
 */
import { randomUUID } from 'node:crypto';
import { and, eq, gte, notInArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { type AppContext, forbidden, requirePerm, schema, sha256Hex, type UserActor } from '../../platform/core.ts';
import { DomainError } from '../../platform/errors/domain-error.ts';
import { type AiFeature, AiProviderError, type AiRequest, type AiResult } from '../../platform/ports.ts';
import { jsonSchemaOf, type PromptDef } from './prompts.ts';

const { aiUsage, organizationSettings } = schema;

export const AI_FEATURES: AiFeature[] = ['draft_section', 'presend_review', 'deal_summary', 'rewrite_text', 'follow_up_email'];
export interface ResolvedAiSettings {
  enabled: boolean;
  perUserDailyCalls: number;
  features: Record<AiFeature, boolean>;
  monthlyBudgetUsd: number;
}
/** Fills defaults for settings rows written before per-feature switches and the monthly budget existed. */
export function resolveAiSettings(raw: schema.AiSettings | undefined): ResolvedAiSettings {
  return {
    enabled: raw?.enabled ?? false,
    perUserDailyCalls: raw?.perUserDailyCalls ?? 50,
    features: Object.fromEntries(AI_FEATURES.map((f) => [f, raw?.features?.[f] ?? true])) as Record<AiFeature, boolean>,
    monthlyBudgetUsd: raw?.monthlyBudgetUsd ?? 50,
  };
}
export async function loadAiSettings(ctx: AppContext): Promise<ResolvedAiSettings> {
  const [row] = await ctx.db.select({ ai: organizationSettings.aiSettings }).from(organizationSettings);
  return resolveAiSettings(row?.ai);
}

/** USD per million tokens (Anthropic first-party list prices, cached 2026-11). Unknown models cost `null`, not zero. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
};
const CACHE_WRITE_MULTIPLIER = 1.25;
/** Estimated cost in millionths of a dollar (so it is exact integer arithmetic on per-million prices). */
export function estimateCostMicroUsd(
  model: string,
  t: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number },
): number | null {
  const p = PRICES[model];
  if (!p) return null;
  return Math.round(
    t.inputTokens * p.input + t.outputTokens * p.output + t.cacheReadTokens * p.cacheRead + t.cacheWriteTokens * p.input * CACHE_WRITE_MULTIPLIER,
  );
}

const NOT_COUNTED = ['blocked_disabled', 'blocked_budget', 'blocked_rate'];

export interface AiTrace {
  /** HTTP request id of the API call that asked for this. */
  correlationId?: string;
  dealId?: string;
}
export interface AiMeta {
  requestId: string;
  provider: string;
  model: string;
  simulated: boolean;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number | null;
  attempts: number;
  latencyMs: number;
}

async function recordBlocked(ctx: AppContext, actor: UserActor, feature: AiFeature, outcome: string, trace: AiTrace) {
  await ctx.db.insert(aiUsage).values({
    feature,
    provider: ctx.ai.name,
    model: '-',
    userId: actor.userId,
    outcome,
    requestId: randomUUID(),
    correlationId: trace.correlationId ?? null,
    dealId: trace.dealId ?? null,
    attempts: 0,
    simulated: ctx.ai.simulated,
    errorCode: outcome === 'blocked_disabled' ? 'AI_DISABLED' : outcome === 'blocked_rate' ? 'AI_RATE_LIMITED' : 'AI_QUOTA_EXCEEDED',
  });
}

/** BR-AIA-008 and ADR-043: enforced on the server for every call, whatever the UI shows. */
export async function assertAiAllowed(ctx: AppContext, actor: UserActor, feature: AiFeature, trace: AiTrace = {}): Promise<ResolvedAiSettings> {
  requirePerm(actor, 'ai.use');
  const settings = await loadAiSettings(ctx);
  if (!settings.enabled || !settings.features[feature]) {
    await recordBlocked(ctx, actor, feature, 'blocked_disabled', trace);
    throw forbidden(
      'AI_DISABLED',
      settings.enabled ? 'This AI feature is turned off for your organization' : 'AI features are turned off for your organization',
    );
  }
  const now = ctx.now();
  const counted = notInArray(aiUsage.outcome, NOT_COUNTED);
  const count = async (since: Date, mine: boolean) => {
    const [row] = await ctx.db
      .select({ n: sql<number>`count(*)::int`, cost: sql<number>`coalesce(sum(${aiUsage.costMicroUsd}),0)::bigint` })
      .from(aiUsage)
      .where(and(gte(aiUsage.occurredAt, since), counted, ...(mine ? [eq(aiUsage.userId, actor.userId)] : [])));
    return { n: row?.n ?? 0, cost: Number(row?.cost ?? 0) };
  };
  if ((await count(new Date(now.getTime() - 60_000), true)).n >= ctx.config.AI_RATE_PER_MINUTE) {
    await recordBlocked(ctx, actor, feature, 'blocked_rate', trace);
    throw new DomainError('AI_RATE_LIMITED', 429, 'Too many AI requests in a short time. Please wait a minute.', {
      meta: { scope: 'user', retryAfterSeconds: 60 },
    });
  }
  if ((await count(new Date(now.toISOString().slice(0, 10)), true)).n >= settings.perUserDailyCalls) {
    await recordBlocked(ctx, actor, feature, 'blocked_budget', trace);
    throw new DomainError('AI_QUOTA_EXCEEDED', 429, 'You have reached today’s AI usage limit', { meta: { scope: 'user' } });
  }
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if ((await count(monthStart, false)).cost >= settings.monthlyBudgetUsd * 1_000_000) {
    await recordBlocked(ctx, actor, feature, 'blocked_budget', trace);
    throw new DomainError('AI_QUOTA_EXCEEDED', 429, 'Your organization has reached this month’s AI budget', { meta: { scope: 'organization' } });
  }
  return settings;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Models occasionally wrap JSON in a code fence even when told not to; accept that, nothing else. */
function parseJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  return JSON.parse(trimmed);
}

const USER_MESSAGE: Record<string, [code: string, status: number, title: string]> = {
  refused: ['AI_REFUSED', 422, 'The AI service declined this request. You can continue without it.'],
  invalid_output: ['AI_OUTPUT_INVALID', 502, 'The AI service returned an answer that could not be used. Please try again.'],
  truncated: ['AI_OUTPUT_INVALID', 502, 'The AI answer was cut off. Try again with less text selected.'],
  timeout: ['AI_PROVIDER_UNAVAILABLE', 503, 'The AI service took too long to answer. You can continue without it.'],
};
const UNAVAILABLE: [string, number, string] = ['AI_PROVIDER_UNAVAILABLE', 503, 'The AI service is unavailable. You can continue without it.'];

/**
 * Runs one AI request end to end and returns schema-validated data.
 * `task` and `userMessage` are built by the caller from an already authorized context.
 */
export async function runAi<T>(
  ctx: AppContext,
  actor: UserActor,
  prompt: PromptDef<T>,
  userMessage: string,
  trace: AiTrace = {},
): Promise<{ data: T; meta: AiMeta }> {
  await assertAiAllowed(ctx, actor, prompt.feature, trace);
  const requestId = randomUUID();
  const base: AiRequest = {
    requestId,
    ...(trace.correlationId ? { correlationId: trace.correlationId } : {}),
    feature: prompt.feature,
    model: prompt.model(ctx.config),
    effort: prompt.effort,
    maxTokens: prompt.maxTokens,
    timeoutMs: ctx.config.AI_TIMEOUT_MS,
    system: prompt.system,
    user: userMessage,
    jsonSchema: jsonSchemaOf(prompt.schema),
    userRef: sha256Hex(`ai-user:${actor.userId}`).slice(0, 32),
  };
  const started = performance.now();
  const totals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let attempts = 0;
  let model = base.model;
  let providerRequestId: string | undefined;
  let failure: { kind: string; detail: string } | null = null;
  let data: T | undefined;
  let repaired = false;
  let request = base;

  while (attempts < ctx.config.AI_MAX_ATTEMPTS + 1) {
    attempts++;
    let result: AiResult;
    try {
      result = await ctx.ai.complete(request);
    } catch (error) {
      const e = error instanceof AiProviderError ? error : new AiProviderError('network', 'Unexpected provider failure');
      providerRequestId = e.providerRequestId ?? providerRequestId;
      failure = { kind: e.kind, detail: e.message };
      // Transient failures get further attempts (up to AI_MAX_ATTEMPTS provider calls); everything else fails now.
      if (e.retryable && attempts < ctx.config.AI_MAX_ATTEMPTS) {
        await sleep(e.retryAfterMs ?? ctx.config.AI_RETRY_DELAY_MS);
        continue;
      }
      break;
    }
    totals.inputTokens += result.inputTokens;
    totals.outputTokens += result.outputTokens;
    totals.cacheReadTokens += result.cacheReadTokens;
    totals.cacheWriteTokens += result.cacheWriteTokens;
    model = result.model;
    providerRequestId = result.providerRequestId ?? providerRequestId;
    let problem: string;
    try {
      const parsed = prompt.schema.safeParse(parseJson(result.text));
      if (parsed.success) {
        data = parsed.data;
        failure = null;
        break;
      }
      problem = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
    } catch {
      problem = 'the answer was not valid JSON';
    }
    failure = { kind: 'invalid_output', detail: problem };
    if (repaired) break;
    // One repair attempt (AI-IMPLEMENTATION-DESIGN §6): re-ask, quoting only the validation error.
    repaired = true;
    request = {
      ...base,
      user: `${base.user}\n\nYour previous answer could not be used (${problem}). Reply again with JSON that matches the required schema exactly.`,
    };
  }

  const latencyMs = Math.round(performance.now() - started);
  const costMicroUsd = estimateCostMicroUsd(model, totals);
  const outcome =
    failure === null
      ? 'success'
      : failure.kind === 'refused'
        ? 'refused'
        : failure.kind === 'invalid_output' || failure.kind === 'truncated'
          ? 'invalid_output'
          : 'error';
  // Metadata only: no prompt text and no model output is ever written to ai_usage or to the logs.
  await ctx.db.insert(aiUsage).values({
    feature: prompt.feature,
    provider: ctx.ai.name,
    model,
    userId: actor.userId,
    ...totals,
    outcome,
    requestId,
    correlationId: trace.correlationId ?? null,
    providerRequestId: providerRequestId ?? null,
    dealId: trace.dealId ?? null,
    promptVersion: prompt.version,
    latencyMs,
    attempts,
    costMicroUsd,
    errorCode: failure?.kind ?? null,
    simulated: ctx.ai.simulated,
  });
  const meta: AiMeta = {
    requestId,
    provider: ctx.ai.name,
    model,
    simulated: ctx.ai.simulated,
    promptVersion: prompt.version,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    costMicroUsd,
    attempts,
    latencyMs,
  };
  if (failure !== null || data === undefined) {
    const kind = failure?.kind ?? 'network';
    const level = kind === 'auth' || kind === 'bad_request' ? 'error' : 'warn';
    ctx.logger[level]({ requestId, correlationId: trace.correlationId, feature: prompt.feature, kind, attempts, providerRequestId }, 'ai request failed');
    const [code, status, title] = USER_MESSAGE[kind] ?? UNAVAILABLE;
    throw new DomainError(code, status, title, { meta: { requestId, retryable: kind !== 'refused' } });
  }
  ctx.logger.info(
    {
      requestId,
      correlationId: trace.correlationId,
      feature: prompt.feature,
      model,
      attempts,
      latencyMs,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
    },
    'ai request completed',
  );
  return { data, meta };
}

export type InferPrompt<P> = P extends PromptDef<infer T> ? T : never;
export type { z };
