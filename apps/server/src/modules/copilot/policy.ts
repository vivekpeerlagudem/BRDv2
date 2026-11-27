/**
 * Policy engine — applied by the server to EVERY tool call the model proposes, before any handler runs:
 *   1. the tool exists and the user's role is offered it;
 *   2. the arguments pass strict validation (unknown keys are rejected);
 *   3. the per-run caps are not exceeded (tool calls, auto writes);
 *   4. taint: in a run that has read outside text, an auto write with free text becomes an approval card;
 *   5. tier routing: read → run · auto → run in a unit of work and record it with an Undo recipe ·
 *      approval → record a card for a person · draft → the existing "suggestion a person accepts" features.
 * The model's wording never decides any of this.
 */
import type { z } from 'zod';
import { DomainError } from '../../platform/errors/domain-error.ts';
import { getTool, renderToolOutput, type ToolDef, type ToolEnv } from './tools.ts';

export const CAPS = { maxSteps: 8, maxToolCalls: 12, maxSeconds: 60, maxAutoWritesChat: 5, maxAutoWritesBackground: 20, maxInputTokens: 250_000, maxCostMicroUsd: 500_000 };

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}
export interface ActionEvent {
  id: string;
  tool: string;
  tier: 'auto' | 'approval' | 'draft';
  status: 'executed' | 'proposed';
  summary: string;
  target: { type: string; id: string } | null;
  undoable: boolean;
}
export interface ToolExecution {
  content: string;
  isError: boolean;
  /** Outcome for logs and events: ids and codes only. */
  outcome: 'ok' | 'unknown_tool' | 'invalid_input' | 'limit' | 'not_found' | 'refused' | 'failed';
  tier: ToolDef['tier'] | null;
  action?: ActionEvent;
}
/** Write tiers are handled by the action ledger (actions.ts registers itself here, so this file stays free of writes). */
export type WriteHandler = (env: ToolEnv, tool: ToolDef, input: Record<string, unknown>) => Promise<{ content: string; action: ActionEvent }>;
let writeHandler: WriteHandler | null = null;
export function setWriteHandler(handler: WriteHandler): void {
  writeHandler = handler;
}

const err = (code: string, extra: Record<string, unknown> = {}) => JSON.stringify({ error: code, ...extra });

export async function executeTool(env: ToolEnv, call: ToolCall): Promise<ToolExecution> {
  const tool = getTool(call.name);
  // Unknown tool, or one this role is not offered: the same answer, so tool names cannot be probed.
  if (!tool?.roles.includes(env.actor.role)) return { content: err('unknown_tool'), isError: true, outcome: 'unknown_tool', tier: null };
  if (env.turn.toolCalls >= CAPS.maxToolCalls)
    return { content: err('tool_limit_reached', { note: 'Answer now with what you already have.' }), isError: true, outcome: 'limit', tier: tool.tier };
  env.turn.toolCalls++;
  const parsed = (tool.input as z.ZodObject).strict().safeParse(call.input);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 4).map((i) => `${i.path.join('.') || '(input)'}: ${i.message}`);
    return { content: err('invalid_input', { issues }), isError: true, outcome: 'invalid_input', tier: tool.tier };
  }
  try {
    if (tool.tier === 'read') {
      const out = await tool.run(env, parsed.data);
      return { content: renderToolOutput(env, out).content, isError: false, outcome: 'ok', tier: 'read' };
    }
    if (!writeHandler) return { content: err('unknown_tool'), isError: true, outcome: 'unknown_tool', tier: tool.tier };
    const { content, action } = await writeHandler(env, tool, parsed.data as Record<string, unknown>);
    return { content, isError: false, outcome: 'ok', tier: tool.tier, action };
  } catch (error) {
    if (error instanceof DomainError) {
      // Not found and not allowed look identical to the model: it must not learn that a hidden record exists.
      if (error.status === 404 || error.status === 403) return { content: err('not_found', { note: 'The user cannot see this, or it does not exist.' }), isError: true, outcome: 'not_found', tier: tool.tier };
      if (error.code === 'COPILOT_LIMIT') return { content: err('limit_reached', { note: error.message }), isError: true, outcome: 'limit', tier: tool.tier };
      return { content: err('refused', { code: error.code, note: error.message }), isError: true, outcome: 'refused', tier: tool.tier };
    }
    env.ctx.logger.warn({ runId: env.turn.runId, tool: tool.name, tier: tool.tier, outcome: 'failed' }, 'copilot tool failed');
    return { content: err('tool_failed'), isError: true, outcome: 'failed', tier: tool.tier };
  }
}
