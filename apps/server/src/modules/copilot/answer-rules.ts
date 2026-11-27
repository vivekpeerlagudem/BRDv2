/**
 * Server-side rules applied to a finished Copilot answer (pure functions, no I/O):
 *  - which records are shown as source chips (the open record, every record a tool call used, every record the answer
 *    names or cites), so the user can always see what the answer is based on;
 *  - when the fixed sentence "I can't see that record." is added (a lookup that found nothing, or a capability this
 *    role does not have), so a miss is always said plainly and in the same words.
 */
import type { AliasBook, RecordRef, RefType } from './tools.ts';

export const CANT_SEE_SENTENCE = "I can't see that record.";
/** Wording that already tells the user the record is not visible (then the fixed sentence is not added again). */
const ALREADY_SAID =
  /can['’]?t see|cannot see|can not see|don['’]?t have access|no access|not able to (find|see)|unable to (find|see)|couldn['’]?t find|could not find|no (matching )?(records?|results?|matches)|not visible|doesn['’]?t exist|does not exist/i;

/** Record types that make useful chips (users, teams and ledger rows do not open a record page). */
const CHIP_TYPES: ReadonlySet<RefType> = new Set(['deal', 'lead', 'company', 'contact', 'proposal', 'task']);
const ALIAS = /\b([A-Z]\d{1,4})\b/g;

export interface Source {
  alias: string;
  type: RecordRef['type'];
  id: string;
  label: string;
}

/** Aliases a tool call's arguments refer to (e.g. get_record {ref: "D3"}, create_task {recordRef: "L2"}). */
export function aliasesInArgs(args: unknown, aliases: AliasBook): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      for (const m of v.matchAll(ALIAS)) if (aliases.get(m[1] as string)) out.push(m[1] as string);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(args);
  return out;
}

/**
 * The chips for an answer, in order: the open record, records the tools were called on, records the answer cites by
 * alias, then records whose full name appears in the answer. Only records the run itself was shown (they are in the
 * alias book), so a chip never reveals anything new.
 */
export function collectSources(input: { answer: string; aliases: AliasBook; openAlias: string | null; usedAliases: string[] }): Source[] {
  const out: Source[] = [];
  const add = (alias: string) => {
    const ref = input.aliases.get(alias);
    if (!ref || !CHIP_TYPES.has(ref.type) || out.some((s) => s.alias === alias)) return;
    out.push({ alias, type: ref.type, id: ref.id, label: ref.label });
  };
  if (input.openAlias) add(input.openAlias);
  for (const a of input.usedAliases) add(a);
  for (const m of input.answer.matchAll(/\[([A-Z]\d{1,4})\]/g)) add(m[1] as string);
  const lower = input.answer.toLowerCase();
  for (const [alias, ref] of Object.entries(input.aliases.toJSON())) {
    if (ref.label.length >= 4 && lower.includes(ref.label.toLowerCase())) add(alias);
  }
  return out.slice(0, 12);
}

/** Capabilities some roles do not have, recognised in the question, keyed by the tool that provides them. */
const RESTRICTED_TOPICS: { tool: string; re: RegExp }[] = [{ tool: 'sales_brief_latest', re: /\bsales[\s-]*brief\b/i }];

export interface LookupLog {
  /** Tools that answered not_found or unknown_tool at least once, and whether the same tool later succeeded. */
  missed: Map<string, boolean>;
  searches: number;
  emptySearches: number;
  recordsOpened: number;
}
export const newLookupLog = (): LookupLog => ({ missed: new Map(), searches: 0, emptySearches: 0, recordsOpened: 0 });

export function logLookup(log: LookupLog, name: string, outcome: string, content: string): void {
  if (outcome === 'not_found' || outcome === 'unknown_tool') {
    if (!log.missed.has(name)) log.missed.set(name, false);
    return;
  }
  if (outcome !== 'ok') return;
  if (log.missed.has(name)) log.missed.set(name, true);
  if (name === 'get_record') log.recordsOpened++;
  if (name === 'search_records') {
    log.searches++;
    if (/"matches":0\b/.test(content)) log.emptySearches++;
  }
}

/** True when the answer must say "I can't see that record." and does not say it already. */
export function needsCantSee(input: { answer: string; question: string; offeredTools: string[]; log: LookupLog }): boolean {
  if (ALREADY_SAID.test(input.answer)) return false;
  const unrecovered = [...input.log.missed.values()].some((recovered) => !recovered);
  const allSearchesEmpty = input.log.searches > 0 && input.log.emptySearches === input.log.searches && input.log.recordsOpened === 0;
  const restricted = RESTRICTED_TOPICS.some((t) => !input.offeredTools.includes(t.tool) && t.re.test(input.question));
  return unrecovered || allSearchesEmpty || restricted;
}
