/**
 * Checks (pure, deterministic): the gate between AI text and a client report. Every statement must cite a real
 * fact, every number must appear in the facts, and internal or risky wording is rejected. Code decides — the AI
 * model is never asked to check itself.
 */
import type { WeeklyFlag, WeeklyNarrative, WeeklySection } from '../../db/schema-weekly-reports.ts';
import { numbersIn, unverifiedFigures } from '../ai.ts';
import { allowedSourceIds } from './facts.ts';

export const SECTIONS: WeeklySection[] = ['summary', 'completed', 'nextWeek', 'risks'];
export const SECTION_LIMITS: Record<WeeklySection, number> = { summary: 3, completed: 5, nextWeek: 5, risks: 3 };
export const SECTION_LABELS: Record<WeeklySection, string> = {
  summary: 'Summary',
  completed: 'Completed this week',
  nextWeek: 'Next week',
  risks: 'Risks and support needed',
};
export const MAX_STATEMENT_CHARS = 320;
export const FALLBACK_TEXT = '[To be written before sending]';
/** Internal notices: shown to the reviewer, never to the client, and they do not block approval. */
export const NOTICE_CODES = ['STATUS_MISMATCH'];
export const isWarning = (flag: WeeklyFlag) => flag.level === 'warning';
export const isBlocking = (flag: WeeklyFlag) => !NOTICE_CODES.includes(flag.code) && !isWarning(flag);

const INTERNAL_TERM_ALL = /\b(unmatched|mismatch(?:es|ed)?|tracking|flag(?:s|ged)?)\b/gi;
const BANNED_WORD = /\b(guarantees?|guaranteed|promises?|promised|blame[sd]?|fault)\b/i;

/** Facts without their `id` fields, so digits inside record ids never count as "known numbers". */
function withoutIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutIds);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => k !== 'id')
        .map(([k, v]) => [k, withoutIds(v)]),
    );
  return value;
}

export function checkNarrative(narrative: WeeklyNarrative, facts: unknown): WeeklyFlag[] {
  const flags: WeeklyFlag[] = [];
  const allowed = allowedSourceIds(facts);
  const values = withoutIds(facts);
  const known = numbersIn(values);
  const factText = JSON.stringify(values).toLowerCase();
  if (narrative.summary.length === 0) flags.push({ code: 'EMPTY_SECTION', statementId: null, message: 'The summary is empty' });
  for (const section of SECTIONS) {
    const statements = narrative[section];
    if (statements.length > SECTION_LIMITS[section])
      flags.push({ code: 'TOO_MANY', statementId: null, message: `${SECTION_LABELS[section]} has more than ${SECTION_LIMITS[section]} statements` });
    for (const s of statements) {
      if (s.origin === 'fallback') continue; // placeholders are reported once, as AI_FALLBACK
      const flag = (code: string, message: string) => flags.push({ code, statementId: s.id, message });
      // A person vouches for what they write, so their sentences need no source; AI sentences always do.
      if (s.sources.length === 0 && s.origin === 'ai') flag('NO_SOURCE', 'The statement cites no source');
      const unknown = s.sources.filter((id) => !allowed.has(id));
      if (unknown.length) flag('UNKNOWN_SOURCE', 'The statement cites a source that is not in the report data');
      const strange = [...numbersIn(s.text)].filter((n) => !known.has(n));
      const money = unverifiedFigures(s.text, values);
      if (strange.length || money.length)
        flags.push({
          code: 'UNVERIFIED_NUMBER',
          statementId: s.id,
          message: `A number is not in the report data: ${[...new Set([...strange, ...money])].join(', ')}`,
          // In a sentence a person wrote this is a warning to acknowledge at approval; in AI text it blocks.
          ...(s.origin === 'user' ? { level: 'warning' as const } : {}),
        });
      if (s.text.length > MAX_STATEMENT_CHARS) flag('TOO_LONG', `The statement is longer than ${MAX_STATEMENT_CHARS} characters`);
      // Words such as "tracking" are internal only when they are not the client's own wording (a scope or task title).
      const internal = [...s.text.matchAll(INTERNAL_TERM_ALL)].find((m) => !factText.includes(m[0].toLowerCase()));
      if (internal) flag('INTERNAL_TERM', `Internal wording must not reach the client: "${internal[0]}"`);
      const banned = BANNED_WORD.exec(s.text);
      if (banned) flag('BANNED_WORD', `Avoid this word in client text: "${banned[0]}"`);
    }
  }
  return flags;
}
