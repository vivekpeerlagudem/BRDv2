/**
 * The Copilot loop — hand-written, about one screen of logic, no agent framework.
 *
 *   gate (switches, rate, budget) → [ model step → policy check and tool execution → tool results ]* → answer →
 *   plain-text clean-up → number grounding check (one regeneration, then a flag) → one agent_run row (metadata only).
 *
 * The loop is the same for a chat turn and for a background job; only the principal, the model and the question
 * differ. Limits per run: 8 model steps, 12 tool calls, 60 seconds, plus token and cost caps. The model never
 * executes anything: it proposes tool calls and `policy.executeTool` decides.
 */
import { randomUUID } from 'node:crypto';
import { type AgentRunKind, type AgentRunStatus, agentRun, type CopilotContextRef } from '../../db/schema-copilot.ts';
import { type AppContext, schema, sha256Hex, type UserActor } from '../../platform/core.ts';
import { DomainError } from '../../platform/errors/domain-error.ts';
import { type AiContentBlock, type AiConverseResult, type AiMessage, AiProviderError, type CopilotFeature } from '../../platform/ports.ts';
import * as crm from '../crm.ts';
import * as proposals from '../proposals.ts';
import { assertBudget, assertCopilotAllowed, costMicroUsd } from './budget.ts';
import './actions.ts'; // registers the write tools and the action ledger with the policy engine
import { type ActionEvent, CAPS, executeTool, type ToolCall } from './policy.ts';
import { PROMPT_VERSION, sessionBlock, systemPrompt } from './prompt.ts';
import { loadCopilotSettings, modelFor } from './settings.ts';
import { cleanAnswer, newNonce, ungroundedNumbers } from './text.ts';
import { AliasBook, getTool, notVisible, type RecordRef, type RefType, type ToolDef, type ToolEnv, type TurnState, toolSpec, toolsForRole } from './tools.ts';

export type CopilotEvent =
  | { event: 'status'; data: { text: string } }
  | { event: 'delta'; data: { text: string } }
  | { event: 'reset'; data: Record<string, never> }
  | { event: 'tool'; data: { name: string; status: 'started' | 'done'; ok?: boolean } }
  | { event: 'action'; data: ActionEvent }
  | { event: 'done'; data: RunSummary }
  | { event: 'error'; data: { code: string; message: string } };

export interface RunInput {
  actor: UserActor;
  kind: AgentRunKind;
  trigger: string;
  question: string;
  /** Earlier turns (text only) and the rolling summary of what came before them. */
  history?: AiMessage[];
  summary?: string | null;
  aliases?: AliasBook;
  conversationId?: string | null;
  open?: CopilotContextRef | null;
  model?: 'main' | 'fast';
  emit?: (e: CopilotEvent) => void;
  requestId?: string | null;
  /** Background jobs: prefix of the idempotency keys of their writes, and the key of the run itself. */
  idempotencyKey?: string | null;
  /** Restricts the tool list (background jobs get a narrow one). */
  tools?: string[];
  signal?: AbortSignal;
}
export interface RunSummary {
  runId: string;
  status: AgentRunStatus;
  answer: string;
  flags: string[];
  sources: { alias: string; type: RefType; id: string; label: string }[];
  actions: ActionEvent[];
  tainted: boolean;
  simulated: boolean;
  model: string;
}
export interface RunResult extends RunSummary {
  /** Everything said in this run, for the conversation store (never for logs). */
  messages: AiMessage[];
  aliases: AliasBook;
  steps: number;
  toolCalls: number;
  toolsUsed: string[];
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number | null;
  latencyMs: number;
  firstTokenMs: number | null;
  groundingFailures: number;
  injectionFlags: number;
}

const STATUS_TEXT: Record<string, string> = {
  search_records: 'Searching the CRM…',
  get_record: 'Opening the record…',
  list_deals: 'Looking at your deals…',
  list_leads: 'Looking at your leads…',
  my_lead_inbox: 'Checking new leads…',
  list_tasks: 'Checking tasks…',
  get_timeline: 'Reading the history…',
  pipeline_report: 'Checking the pipeline…',
  kpis: 'Getting the key figures…',
  list_proposals: 'Checking proposals…',
  sales_brief_latest: 'Reading the Sales Brief…',
  weekly_report_status: 'Checking weekly reports…',
  assignment_stats: 'Checking lead response times…',
  list_users: 'Looking up colleagues…',
  get_playbook: 'Planning the steps…',
};
const FEATURE: Record<AgentRunKind, CopilotFeature> = {
  chat: 'copilot_chat',
  triage: 'copilot_triage',
  my_day: 'copilot_background',
  digest: 'copilot_background',
  handoff: 'copilot_background',
  home: 'copilot_background',
  eval: 'copilot_chat',
};

/** Resolves the record the user has open — through the scoped services, so an invisible record is simply "none". */
async function openRecord(
  ctx: AppContext,
  actor: UserActor,
  open: CopilotContextRef | null | undefined,
): Promise<{ type: RefType; id: string; label: string } | null> {
  if (!open) return null;
  try {
    if (open.type === 'deal') return { type: 'deal', id: open.id, label: (await crm.getDeal(ctx, actor, open.id)).name };
    if (open.type === 'company') return { type: 'company', id: open.id, label: (await crm.getCompany(ctx, actor, open.id)).name };
    if (open.type === 'lead') return { type: 'lead', id: open.id, label: (await crm.getLead(ctx, actor, open.id)).name };
    if (open.type === 'contact') {
      const p = await crm.getContact(ctx, actor, open.id);
      return { type: 'contact', id: open.id, label: [p.firstName, p.lastName].filter(Boolean).join(' ') || 'contact' };
    }
    return { type: 'proposal', id: open.id, label: (await proposals.getProposal(ctx, actor, open.id)).title };
  } catch {
    return null;
  }
}

export async function runAgent(ctx: AppContext, input: RunInput): Promise<RunResult> {
  const started = performance.now();
  const startedAt = ctx.now();
  const { actor } = input;
  const settings = await loadCopilotSettings(ctx);
  const feature = FEATURE[input.kind];
  const runId = randomUUID();
  const emit = input.emit ?? (() => {});
  const model = modelFor(ctx, settings, input.model ?? 'main');
  const turn: TurnState = {
    runId,
    kind: input.kind,
    conversationId: input.conversationId ?? null,
    nonce: newNonce(),
    aliases: input.aliases ?? new AliasBook(),
    tainted: false,
    injectionFlags: 0,
    hiddenTextRemoved: 0,
    toolCalls: 0,
    autoWrites: 0,
    proposals: 0,
    requestId: input.requestId ?? null,
    idempotencyPrefix: input.idempotencyKey ?? null,
  };
  const env: ToolEnv = { ctx, actor, settings, turn };
  const totals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let cost: number | null = 0;
  let steps = 0;
  let firstTokenMs: number | null = null;
  let status: AgentRunStatus = 'completed';
  let errorCode: string | null = null;
  let answer = '';
  let groundingFailures = 0;
  const flags: string[] = [];
  const actions: ActionEvent[] = [];
  const toolsUsed: string[] = [];
  const toolResults: string[] = [];
  const newMessages: AiMessage[] = [];

  const finish = async (): Promise<RunResult> => {
    const latencyMs = Math.round(performance.now() - started);
    // Sources: the record aliases the answer mentions, resolved on the server (the model never writes a link).
    const sources: RunSummary['sources'] = [];
    for (const m of answer.matchAll(/\[([A-Z]\d{1,4})\]/g)) {
      const ref = turn.aliases.get(m[1] as string) as RecordRef | undefined;
      if (ref && !sources.some((s) => s.alias === m[1])) sources.push({ alias: m[1] as string, type: ref.type, id: ref.id, label: ref.label });
    }
    answer = answer.replace(/\[([A-Z]\d{1,4})\]/g, (whole, alias: string) => (turn.aliases.get(alias) ? whole : ''));
    if (turn.injectionFlags > 0) flags.push('outside_text_looked_like_instructions');
    await ctx.db
      .insert(agentRun)
      .values({
        id: runId,
        kind: input.kind,
        trigger: input.trigger,
        principalUserId: actor.userId,
        principalRole: actor.role,
        conversationId: input.conversationId ?? null,
        status,
        steps,
        toolCalls: turn.toolCalls,
        autoWrites: turn.autoWrites,
        proposals: turn.proposals,
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        cacheReadTokens: totals.cacheReadTokens,
        costMicroUsd: cost,
        latencyMs,
        firstTokenMs,
        provider: ctx.ai.name,
        model,
        simulated: ctx.ai.simulated,
        tainted: turn.tainted,
        groundingFailures,
        injectionFlags: turn.injectionFlags,
        errorCode,
        idempotencyKey: input.idempotencyKey ?? null,
        requestId: input.requestId ?? null,
        startedAt,
      })
      .onConflictDoNothing();
    // Ids, counts and codes only — never the question, the answer or a tool payload.
    ctx.logger.info(
      {
        runId,
        requestId: input.requestId,
        kind: input.kind,
        status,
        steps,
        toolCalls: turn.toolCalls,
        autoWrites: turn.autoWrites,
        proposals: turn.proposals,
        latencyMs,
        errorCode,
      },
      'copilot run finished',
    );
    const summary: RunSummary = { runId, status, answer, flags, sources, actions, tainted: turn.tainted, simulated: ctx.ai.simulated, model };
    emit({ event: 'done', data: summary });
    return {
      ...summary,
      messages: newMessages,
      aliases: turn.aliases,
      steps,
      toolCalls: turn.toolCalls,
      toolsUsed,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      costMicroUsd: cost,
      latencyMs,
      firstTokenMs,
      groundingFailures,
      injectionFlags: turn.injectionFlags,
    };
  };
  const stop = async (s: AgentRunStatus, code: string, message: string): Promise<RunResult> => {
    status = s;
    errorCode = code;
    answer = message;
    emit({ event: 'error', data: { code, message } });
    return finish();
  };

  // ── gate ──
  try {
    await assertCopilotAllowed(ctx, actor, settings, feature);
  } catch (error) {
    if (error instanceof DomainError) return stop('blocked', error.code, error.message);
    throw error;
  }
  emit({ event: 'status', data: { text: 'Thinking…' } });

  // ── context: static system rules → role tool list → session block → history → question ──
  const offered: ToolDef[] = toolsForRole(actor.role).filter((t) => !input.tools || input.tools.includes(t.name));
  const specs = offered.map(toolSpec);
  const open = await openRecord(ctx, actor, input.open);
  const openAlias = open ? { ...open, alias: turn.aliases.alias(open.type, open.id, open.label) } : null;
  const session = sessionBlock({
    actor,
    organizationName: settings.organizationName,
    timeZone: settings.timeZone,
    currency: settings.currency,
    now: ctx.now(),
    open: openAlias,
    summary: input.summary ?? null,
  });
  const userMessage: AiMessage = { role: 'user', content: [{ type: 'text', text: input.question }] };
  newMessages.push(userMessage);
  const messages: AiMessage[] = [
    { role: 'user', content: [{ type: 'text', text: session }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Ready.' }] },
    ...(input.history ?? []),
    userMessage,
  ];
  const deadline = started + CAPS.maxSeconds * 1000;
  const userRef = sha256Hex(`ai-user:${actor.userId}`).slice(0, 32);
  let regenerated = false;

  while (true) {
    if (steps >= CAPS.maxSteps || performance.now() > deadline || totals.inputTokens > CAPS.maxInputTokens || (cost ?? 0) > CAPS.maxCostMicroUsd) {
      status = 'capped';
      errorCode = 'COPILOT_LIMIT';
      if (!answer) answer = 'I reached the limit for one question before finishing. Please ask a narrower question.';
      break;
    }
    // The last allowed step, or a run that has used up its tool calls, must answer: no tools are offered.
    const answerOnly = steps === CAPS.maxSteps - 1 || turn.toolCalls >= CAPS.maxToolCalls;
    try {
      await assertBudget(ctx, settings);
    } catch (error) {
      if (error instanceof DomainError) return stop('blocked', error.code, error.message);
      throw error;
    }
    steps++;
    let streamed = false;
    let result: AiConverseResult | null = null;
    let failure: AiProviderError | null = null;
    const stepStarted = performance.now();
    for (let attempt = 1; attempt <= 2 && !result; attempt++) {
      try {
        result = await ctx.ai.converse({
          requestId: randomUUID(),
          ...(input.requestId ? { correlationId: input.requestId } : {}),
          feature,
          model,
          effort: 'low',
          maxTokens: 2000,
          timeoutMs: Math.max(5_000, Math.min(ctx.config.AI_TIMEOUT_MS, deadline - performance.now())),
          system: systemPrompt(actor.role),
          tools: answerOnly ? [] : specs,
          messages,
          userRef,
          onTextDelta: (text) => {
            if (firstTokenMs === null) firstTokenMs = Math.round(performance.now() - started);
            streamed = true;
            emit({ event: 'delta', data: { text } });
          },
          ...(input.signal ? { signal: input.signal } : {}),
        });
      } catch (error) {
        failure = error instanceof AiProviderError ? error : new AiProviderError('network', 'Unexpected provider failure');
        // One retry on a transient failure, and only if nothing has been shown to the user in this step.
        if (!failure.retryable || streamed || attempt === 2) break;
        await new Promise((resolve) => setTimeout(resolve, Math.min(failure?.retryAfterMs ?? ctx.config.AI_RETRY_DELAY_MS, 5_000)));
      }
    }
    const stepCost = result ? costMicroUsd(ctx, result.model, result) : null;
    await ctx.db.insert(schema.aiUsage).values({
      feature,
      provider: ctx.ai.name,
      model: result?.model ?? model,
      userId: actor.userId,
      inputTokens: result?.inputTokens ?? 0,
      outputTokens: result?.outputTokens ?? 0,
      cacheReadTokens: result?.cacheReadTokens ?? 0,
      cacheWriteTokens: result?.cacheWriteTokens ?? 0,
      outcome: result ? (result.stopReason === 'refusal' ? 'refused' : 'success') : 'error',
      requestId: runId,
      correlationId: input.requestId ?? null,
      providerRequestId: result?.providerRequestId ?? failure?.providerRequestId ?? null,
      promptVersion: PROMPT_VERSION,
      latencyMs: Math.round(performance.now() - stepStarted),
      attempts: 1,
      costMicroUsd: stepCost,
      errorCode: result ? null : (failure?.kind ?? 'network'),
      simulated: ctx.ai.simulated,
    });
    if (!result) {
      ctx.logger.warn({ runId, requestId: input.requestId, kind: failure?.kind, step: steps }, 'copilot model step failed');
      return stop('failed', 'AI_PROVIDER_UNAVAILABLE', 'The AI service is unavailable right now. You can keep working in the CRM and try again later.');
    }
    totals.inputTokens += result.inputTokens;
    totals.outputTokens += result.outputTokens;
    totals.cacheReadTokens += result.cacheReadTokens;
    totals.cacheWriteTokens += result.cacheWriteTokens;
    cost = cost === null || stepCost === null ? null : cost + stepCost;

    if (result.stopReason === 'refusal') {
      status = 'refused';
      errorCode = 'AI_REFUSED';
      answer = "I can't help with that request.";
      if (streamed) emit({ event: 'reset', data: {} });
      break;
    }
    const text = result.content
      .filter((b): b is Extract<AiContentBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const calls = answerOnly ? [] : result.content.filter((b): b is Extract<AiContentBlock, { type: 'tool_call' }> => b.type === 'tool_call');
    const assistant: AiMessage = { role: 'assistant', content: answerOnly ? result.content.filter((b) => b.type === 'text') : result.content };
    if (!assistant.content.length) assistant.content = [{ type: 'text', text: '' }];
    messages.push(assistant);
    newMessages.push(assistant);

    if (calls.length) {
      // Any words before the tool calls were only a preamble: the client clears them when the answer starts.
      if (streamed) emit({ event: 'reset', data: {} });
      for (const c of calls) {
        toolsUsed.push(c.name);
        emit({ event: 'status', data: { text: STATUS_TEXT[c.name] ?? 'Working…' } });
        emit({ event: 'tool', data: { name: c.name, status: 'started' } });
      }
      const run = async (c: ToolCall) => {
        const done = await executeTool(env, c);
        emit({ event: 'tool', data: { name: c.name, status: 'done', ok: !done.isError } });
        if (done.action) {
          actions.push(done.action);
          emit({ event: 'action', data: done.action });
        }
        ctx.logger.info({ runId, requestId: input.requestId, tool: c.name, tier: done.tier, outcome: done.outcome }, 'copilot tool call');
        return done;
      };
      // Independent reads run in parallel; anything that can write runs one at a time, in the order proposed.
      const allRead = calls.every((c) => getTool(c.name)?.tier === 'read');
      const results = allRead
        ? await Promise.all(calls.map(run))
        : await calls.reduce(async (acc, c) => [...(await acc), await run(c)], Promise.resolve([] as Awaited<ReturnType<typeof run>>[]));
      const resultMessage: AiMessage = {
        role: 'user',
        content: calls.map((c, i) => ({
          type: 'tool_result',
          toolCallId: c.id,
          name: c.name,
          content: results[i]?.content ?? '{}',
          ...(results[i]?.isError ? { isError: true } : {}),
        })),
      };
      for (const r of results) toolResults.push(r.content);
      messages.push(resultMessage);
      newMessages.push(resultMessage);
      continue;
    }

    // ── a final answer: plain text, then the grounding check ──
    const cleaned = cleanAnswer(text);
    if (cleaned.removed > 0) flags.push('links_or_images_removed');
    const ungrounded = ungroundedNumbers(cleaned.text, [...toolResults, input.question, session]);
    if (ungrounded.length && !regenerated && steps < CAPS.maxSteps) {
      regenerated = true;
      groundingFailures++;
      emit({ event: 'reset', data: {} });
      emit({ event: 'status', data: { text: 'Checking the figures…' } });
      const note: AiMessage = {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Your answer contains figures that are not in the tool results of this turn: ${ungrounded.slice(0, 8).join(', ')}. Rewrite the answer using only figures copied exactly from the tool results. If you need a total, call a tool that returns it.`,
          },
        ],
      };
      messages.push(note);
      newMessages.push(note);
      continue;
    }
    answer = cleaned.text || "I don't have an answer for that.";
    if (ungrounded.length) {
      groundingFailures++;
      flags.push('unverified_figures');
      answer += `\n\nNote: I could not check these figures against CRM data: ${ungrounded.slice(0, 8).join(', ')}. Please verify them.`;
    }
    if (cleaned.removed > 0 || ungrounded.length) {
      // What was streamed differs from the checked answer: the client replaces it.
      emit({ event: 'reset', data: {} });
      emit({ event: 'delta', data: { text: answer } });
    }
    break;
  }
  // The stored final message is the checked answer, not the raw model text.
  const last = newMessages.at(-1);
  if (last?.role === 'assistant') last.content = [{ type: 'text', text: answer }];
  else newMessages.push({ role: 'assistant', content: [{ type: 'text', text: answer }] });
  return finish();
}
export { notVisible };
