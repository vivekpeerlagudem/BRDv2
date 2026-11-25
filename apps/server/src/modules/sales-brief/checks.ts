/**
 * Checks of the Weekly Sales Brief (pure, deterministic). The same gate as the weekly client report — every
 * sentence cites real evidence, every number is in the facts, risky wording is rejected — built from the same
 * helpers (`numbersIn`, `unverifiedFigures`, `allowedSourceIds`), plus two rules of its own: every insight and
 * every action must name at least one signal that code computed. The AI model never checks itself.
 *
 * The brief is internal, so the "internal wording" rule of the client report does not apply here.
 */
import { SALES_BRIEF_SECTIONS, type SalesBriefNarrative, type SalesBriefSection, type SalesSignal } from '../../db/schema-sales-brief.ts';
import type { WeeklyFlag } from '../../db/schema-weekly-reports.ts';
import { numbersIn, unverifiedFigures } from '../ai.ts';
import { FALLBACK_TEXT, MAX_STATEMENT_CHARS } from '../weekly-reports/checks.ts';
import { allowedSourceIds } from '../weekly-reports/facts.ts';

export const BRIEF_SECTIONS: SalesBriefSection[] = [...SALES_BRIEF_SECTIONS];
export const BRIEF_LIMITS: Record<SalesBriefSection, number> = { headline: 3, insights: 5, actions: 4, throughput: 3, wins: 3, pipeline: 3, risks: 4, team: 3 };
export const BRIEF_LABELS: Record<SalesBriefSection, string> = {
  headline: 'Headline',
  insights: 'Key insights',
  actions: 'Recommended actions',
  throughput: 'Throughput',
  wins: 'Wins',
  pipeline: 'Pipeline',
  risks: 'Risks',
  team: 'Team',
};
/** Sections whose sentences must be tied to a signal. */
const NEEDS_SIGNAL: SalesBriefSection[] = ['insights', 'actions'];
const BANNED = /\b(guarantees?|guaranteed|promises?|promised|blame[sd]?|fault|will close|forecasts?|forecasted|certainly)\b/i;

/** Facts without their `id` fields, so digits inside record ids never count as "known numbers". */
function withoutIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutIds);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => k !== 'id' && k !== 'records' && k !== 'metrics')
        .map(([k, v]) => [k, withoutIds(v)]),
    );
  return value;
}

export function checkBrief(narrative: SalesBriefNarrative, facts: Record<string, unknown>, signals: SalesSignal[]): WeeklyFlag[] {
  const flags: WeeklyFlag[] = [];
  const allowed = allowedSourceIds(facts);
  // `metrics` at the top level is the list of figures; inside a signal it is a list of ids (dropped by withoutIds).
  const values = { ...(withoutIds({ ...facts, metrics: undefined }) as object), figures: (facts.metrics as unknown[] | undefined)?.map((m) => withoutIds(m)) };
  const known = numbersIn(values);
  const signalIds = new Set(signals.map((s) => s.id));
  if (narrative.headline.length === 0) flags.push({ code: 'EMPTY_SECTION', statementId: null, message: 'The headline is empty' });
  for (const section of BRIEF_SECTIONS) {
    const statements = narrative[section];
    if (statements.length > BRIEF_LIMITS[section])
      flags.push({ code: 'TOO_MANY', statementId: null, message: `${BRIEF_LABELS[section]} has more than ${BRIEF_LIMITS[section]} statements` });
    for (const s of statements) {
      if (s.origin === 'fallback') continue; // placeholders are reported once
      const flag = (code: string, message: string) => flags.push({ code, statementId: s.id, message });
      // A person vouches for what they write; AI sentences always need evidence.
      if (s.origin === 'ai' && s.sources.length === 0) flag('NO_SOURCE', 'The statement cites no evidence');
      if (s.sources.some((id) => !allowed.has(id))) flag('UNKNOWN_SOURCE', 'The statement cites evidence that is not in the brief data');
      if (NEEDS_SIGNAL.includes(section)) {
        const cited = s.signalIds ?? [];
        if (s.origin === 'ai' && cited.length === 0)
          flag('NO_SIGNAL', `${section === 'actions' ? 'An action' : 'An insight'} must be tied to at least one finding`);
        if (cited.some((id) => !signalIds.has(id))) flag('UNKNOWN_SIGNAL', 'The statement names a finding that is not in the brief data');
      }
      const strange = [...numbersIn(s.text)].filter((n) => !known.has(n));
      const money = unverifiedFigures(s.text, values);
      if (strange.length || money.length)
        flags.push({
          code: 'UNVERIFIED_NUMBER',
          statementId: s.id,
          message: `A number is not in the brief data: ${[...new Set([...strange, ...money])].join(', ')}`,
          // In a sentence a person wrote this is a warning to acknowledge at approval; in AI text it blocks.
          ...(s.origin === 'user' ? { level: 'warning' as const } : {}),
        });
      if (s.text.length > MAX_STATEMENT_CHARS) flag('TOO_LONG', `The statement is longer than ${MAX_STATEMENT_CHARS} characters`);
      const banned = BANNED.exec(s.text);
      if (banned) flag('BANNED_WORD', `Avoid this wording (no forecasts, certainty or blame): "${banned[0]}"`);
    }
  }
  return flags;
}

/** All flags of a brief: the checks, plus one blocking flag while a placeholder is still in the text. */
export function composeBriefFlags(
  narrative: SalesBriefNarrative,
  facts: Record<string, unknown>,
  signals: SalesSignal[],
  extra: WeeklyFlag[] = [],
): WeeklyFlag[] {
  const placeholder = BRIEF_SECTIONS.some((section) => narrative[section].some((s) => s.origin === 'fallback' || s.text === FALLBACK_TEXT));
  return [
    ...extra,
    ...checkBrief(narrative, facts, signals),
    ...(placeholder && !extra.some((f) => f.code === 'AI_FALLBACK')
      ? [{ code: 'PLACEHOLDER_TEXT', statementId: null, message: 'Some text is still a placeholder: write it before approving' }]
      : []),
  ];
}
