/**
 * The mock provider's built-in "model" for tool conversations (AI_PROVIDER=fake).
 *  - planner mode: a keyword table maps the user's question to a tool plan; once tool results are present it writes an
 *    answer by COPYING facts and numbers from them — it never computes or invents a figure.
 *  - gullible mode: additionally obeys instructions found inside untrusted blocks. It simulates a model that has been
 *    fooled by a prompt injection, so tests can prove the server-side guards (tiers, taint, no egress) hold anyway.
 */
import type { AiConverseRequest } from './ports.ts';

export interface PlannedStep {
  text?: string;
  toolCalls?: { name: string; input: Record<string, unknown>; id?: string }[];
}
export type MockPlanner = (req: AiConverseRequest, mode: 'planner' | 'gullible') => PlannedStep;

/** Text of the latest user question (the last user message that carries text). */
export function lastQuestion(req: AiConverseRequest): string {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i];
    if (m?.role !== 'user') continue;
    const text = m.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('\n');
    if (text) return text;
  }
  return '';
}

export const planStep: MockPlanner = (req) => {
  const question = lastQuestion(req);
  return { text: question ? 'I am the built-in simulator. I have no tool plan for this question yet.' : 'How can I help?' };
};
