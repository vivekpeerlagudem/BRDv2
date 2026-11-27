/**
 * Which tools and which playbook a question needs — chosen by deterministic keyword rules, not by a model.
 *
 * Why rules and not a router model: a router call (AI_MODEL_FAST) adds a full model round trip (about 0.6–1.5 s on the
 * free tier) and its own rate-limit risk before the first useful step, costs tokens, and is not reproducible in tests.
 * Keyword groups are free, instant and testable; when no group matches, the role's full tool list is offered, so a
 * miss costs tokens, never an answer. Tools are always sorted by name, so the same kind of question gets a
 * byte-identical tool list (the cached prefix stays warm per kind).
 */
import type { PlaybookName } from './playbooks.ts';
import { PLAYBOOKS } from './playbooks.ts';
import type { RefType, ToolDef } from './tools.ts';

type Group = 'deals' | 'dealChanges' | 'leads' | 'tasks' | 'notes' | 'reports' | 'proposals' | 'brief' | 'team';

/** Always offered: find and open records. */
const CORE = ['search_records', 'get_record', 'get_timeline'];
const GROUP_TOOLS: Record<Group, string[]> = {
  deals: ['list_deals'],
  dealChanges: ['move_deal_stage', 'patch_deal', 'close_deal_lost', 'reassign', 'list_users', 'draft_follow_up'],
  leads: [
    'list_leads',
    'my_lead_inbox',
    'set_lead_score',
    'update_lead',
    'qualify_lead',
    'disqualify_lead',
    'convert_lead',
    'accept_assignment',
    'reassign',
    'list_users',
  ],
  tasks: ['list_tasks', 'create_task'],
  notes: ['add_ai_note', 'log_activity'],
  reports: ['pipeline_report', 'kpis'],
  proposals: ['list_proposals', 'draft_follow_up'],
  brief: ['sales_brief_latest', 'weekly_report_status'],
  team: ['assignment_stats', 'list_users', 'pipeline_report', 'my_lead_inbox'],
};
const KEYWORDS: [Group, RegExp][] = [
  ['deals', /\bdeals?\b|stalled|stuck|close date|closing|opportunit|negotiation|discovery|won\b|lost\b|\bstage/i],
  ['dealChanges', /\bmove\b|\bstage\b|push|close date|amount|\bmark\b|\bwon\b|\blost\b|reassign|hand ?over|follow[- ]?up (e-?mail|draft|message)|\bdraft\b/i],
  ['leads', /\bleads?\b|enquir|inquir|inbox|\bscore|qualif|convert|accept|assign|escalat|triage|new (contact|prospect)/i],
  ['tasks', /\btasks?\b|to-?do|remind|follow[- ]?ups?\b|due\b|overdue|my day|today/i],
  ['notes', /\bnotes?\b|\blog\b|\bcall\b|meeting|spoke|save\b|record (a|the)/i],
  [
    'reports',
    /pipeline|forecast|revenue|win rate|figures|kpi|total|how much|report|quarter|(this|last) (week|month)|how (did|are|is) (we|it|my team|the team)|by (rep|owner|person|stage)|performance|lost reasons?/i,
  ],
  ['proposals', /proposals?|quote|sent but|viewed|send\b|e-?mail/i],
  ['brief', /brief|weekly report|why (did|are|is|were)|how did we do|(this|last) week|leadership/i],
  ['team', /\bteam\b|who\b|colleague|rep(s|resentative)?\b|response time|escalat|pick[- ]?up|\bsla\b|per person|each (person|rep)|help\b/i],
];
const OPEN_GROUPS: Partial<Record<RefType, Group[]>> = {
  deal: ['deals', 'dealChanges', 'tasks', 'notes', 'proposals'],
  lead: ['leads', 'tasks', 'notes'],
  company: ['deals', 'tasks', 'notes'],
  contact: ['tasks', 'notes'],
  proposal: ['proposals', 'tasks'],
};

export interface ToolChoice {
  tools: ToolDef[];
  groups: Group[];
  /** True when no keyword matched and the role's full list is offered. */
  fallback: boolean;
}

export function selectTools(input: { question: string; openType: RefType | null; roleTools: ToolDef[] }): ToolChoice {
  const groups = new Set<Group>();
  for (const [g, re] of KEYWORDS) if (re.test(input.question)) groups.add(g);
  const fromQuestion = groups.size;
  for (const g of (input.openType && OPEN_GROUPS[input.openType]) || []) groups.add(g);
  // get_playbook is never needed: the matching playbook is put into the session block by pickPlaybook.
  const available = input.roleTools.filter((t) => t.name !== 'get_playbook');
  if (fromQuestion === 0 && groups.size === 0) return { tools: available, groups: [], fallback: true };
  const wanted = new Set([...CORE, ...[...groups].flatMap((g) => GROUP_TOOLS[g])]);
  return { tools: available.filter((t) => wanted.has(t.name)), groups: [...groups].sort(), fallback: false };
}

const PLAYBOOK_RULES: [PlaybookName, RegExp][] = [
  ['my-day', /my day|what needs me|what should i (do|work on)|today'?s (plan|priorities)|start my day/i],
  ['team-review', /\bteam\b.*(review|doing|help|stalled|slow)|who (needs|may need) help|by (rep|person)|each (rep|person)/i],
  ['lead-triage', /\b(score|triage|qualify)\b.*\blead|\blead\b.*\b(score|triage)/i],
  ['follow-up-writer', /follow[- ]?up (e-?mail|draft|message)|draft (a|an|the) (e-?mail|follow)/i],
  ['deal-risk-next-step', /next step|\brisk|at risk|what should i do (on|with|about) this deal/i],
  ['weekly-reports', /weekly report/i],
  ['proposal-helper', /proposal (wording|section|text)|help (me )?with (the|a|my) proposal/i],
  ['pipeline-and-reports', /pipeline|forecast|win rate|revenue|key figures|kpi|report|this quarter|this month/i],
  ['customer-360', /tell me (all )?about|who is|everything (about|on)|customer (summary|overview)|360/i],
];
const ACTION = /\b(create|add|make|set up|score|save|note|log|accept|qualify|disqualify|convert|move|change|update|push|reassign|assign|mark)\b/i;

/** The one playbook whose steps go into the session block (an action request gets the "take-action" examples). */
export function pickPlaybook(question: string, openType: RefType | null): { name: PlaybookName; text: string } | null {
  for (const [name, re] of PLAYBOOK_RULES) if (re.test(question)) return { name, text: PLAYBOOKS[name].text };
  if (/\bscore\b/i.test(question) && openType === 'lead') return { name: 'lead-triage', text: PLAYBOOKS['lead-triage'].text };
  if (ACTION.test(question)) return { name: 'take-action', text: PLAYBOOKS['take-action'].text };
  return null;
}
