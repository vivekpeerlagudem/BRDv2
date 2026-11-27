/**
 * Text safety for the Copilot — pure functions, unit-tested.
 *  - `cleanUntrusted`: makes outside text (web-form messages, imported notes, buyer reasons, free-text notes) safe to
 *    show to a model: invisible characters and markup are removed, the length is capped.
 *  - `wrapUntrusted`: puts it in a nonce-tagged block the text itself cannot close.
 *  - `looksLikeInjection`: a cheap heuristic for the metrics and for a warning flag (never used as the defence).
 *  - `cleanAnswer`: the model's answer becomes plain text — no images, no links, no URLs, no HTML.
 *  - `ungroundedNumbers`: every number in an answer must come from a tool result of the same turn (principle P12).
 */
import { randomBytes } from 'node:crypto';

/** Control characters, zero-width and bidirectional marks, and the Unicode "tag" block used to hide text from people. */
const INVISIBLE_RANGES: [number, number][] = [
  [0x0000, 0x0008],
  [0x000b, 0x000c],
  [0x000e, 0x001f],
  [0x007f, 0x007f],
  [0x00ad, 0x00ad],
  [0x061c, 0x061c],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0xfeff, 0xfeff],
  [0xfff9, 0xfffb],
  [0xe0000, 0xe007f],
];
// Built from code points so this source file itself contains no invisible characters.
const BS = String.fromCharCode(92); // a backslash, written this way so no escape sequence appears in this file
const point = (n: number) => `${BS}u{${n.toString(16)}}`;
const INVISIBLE = new RegExp(`[${INVISIBLE_RANGES.map(([a, b]) => `${point(a)}-${point(b)}`).join('')}]`, 'gu');
/** True when the text contains characters a person cannot see (used by tests and metrics). */
export const hasInvisible = (text: string): boolean => new RegExp(INVISIBLE.source, 'u').test(text);

export function cleanUntrusted(text: string, max = 1200): { text: string; hiddenRemoved: number } {
  const hiddenRemoved = (text.match(INVISIBLE) ?? []).length;
  const clean = text
    .replace(INVISIBLE, '')
    .replace(/<[^>]{0,200}>/g, ' ') // markup, including fake closing tags and fake <system> blocks
    .replace(/[<>]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
  return { text: clean.length > max ? `${clean.slice(0, max)}…` : clean, hiddenRemoved };
}

const INJECTION_PATTERNS = [
  /ignore (all |your |the )?(previous|prior|above|earlier)?\s*(rules|instructions|prompt)/i,
  /(system|developer) (note|prompt|message|mode)/i,
  /you are now/i,
  /\b(instruction|note)s? (for|to) the (ai|assistant|copilot|agent|crm copilot)/i,
  /\b(ai|assistant|copilot) ?(agent)?\s*:/i,
  /do not ask for approval/i,
  /admin mode/i,
  /!\[[^\]]*\]\(/, // markdown image
];
export function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((p) => p.test(text));
}

export const newNonce = (): string => randomBytes(8).toString('hex');
/** A block the content cannot close: the tag carries a per-turn random nonce, and angle brackets were already removed. */
export function wrapUntrusted(nonce: string, source: string, text: string): string {
  return `<untrusted_document_${nonce} source="${source}">${text}</untrusted_document_${nonce}>`;
}

/** Plain text only: images, links, bare URLs, e-mail-style exfil targets and HTML never reach the screen. */
export function cleanAnswer(text: string): { text: string; removed: number } {
  let removed = 0;
  const bump = (replacement: string) => () => {
    removed++;
    return replacement;
  };
  const out = text
    .replace(INVISIBLE, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, bump(''))
    .replace(/\[([^\]]+)\]\((?:https?:|\/\/|www\.|mailto:|data:)[^)]*\)/gi, (_m, label: string) => {
      removed++;
      return label;
    })
    .replace(/<\/?[a-z][^>]{0,300}>/gi, bump(''))
    .replace(/\b(?:https?:\/\/|www\.)[^\s)>\]]+/gi, bump('[link removed]'))
    .replace(/\bdata:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, bump('[data removed]'))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text: out, removed };
}

const normalize = (raw: string): string => {
  const n = raw.replace(/,/g, '');
  const [int = '0', frac] = n.split('.');
  const i = int.replace(/^0+(?=\d)/, '');
  const f = frac?.replace(/0+$/, '');
  return f ? `${i}.${f}` : i;
};
/** Every number found in a value (string, number, array, object), normalised: no thousands separators, no trailing zeros. */
export function numbersIn(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === 'number') out.add(normalize(String(value)));
  else if (typeof value === 'string') for (const m of value.matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.add(normalize(m[0]));
  else if (Array.isArray(value)) {
    out.add(String(value.length)); // a person may say "3 deals" for a list of three rows
    for (const v of value) numbersIn(v, out);
  } else if (value && typeof value === 'object') for (const v of Object.values(value)) numbersIn(v, out);
  return out;
}

/**
 * Numbers in `answer` that appear in none of the `sources` (tool results of the turn, the question, the session
 * block). List markers ("1.", "2)") and record aliases ("[D3]") are not figures and are ignored.
 */
export function ungroundedNumbers(answer: string, sources: unknown[]): string[] {
  const known = new Set<string>();
  for (const s of sources) numbersIn(s, known);
  const text = answer
    .replace(/\[[A-Z]\d+\]/g, ' ') // record aliases
    .replace(/^\s*\d+[.)]\s+/gm, ' ') // numbered list markers
    .replace(/\b[A-Z]\d+\b/g, ' ');
  const bad = new Set<string>();
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = normalize(m[0].replace(/[.,]$/, ''));
    if (!known.has(n)) bad.add(m[0]);
  }
  return [...bad];
}
