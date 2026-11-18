/**
 * Proposal engine core (PROPOSAL-ENGINE-DESIGN.md, ADR-029): content model, placeholder resolution,
 * deterministic pre-send checks, one HTML renderer (preview = buyer view = PDF source), DOCX mapper and
 * version diff. Pure functions only — no I/O — so the server, the renderer and the browser can all use it.
 */
import type { ComputedLine, Pricing, ProposalDocument, ProposalTotals, Section } from '@crm/shared';
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';

export const PROPOSAL_SCHEMA_VERSION = 1 as const;

// ───────────── placeholders (BR-TPL-002, BR-PRP-002, BR-TPL-008) ─────────────
export type PlaceholderValues = Record<string, string | null | undefined>;
const PLACEHOLDER = /\{\{\s*([a-z_]+\.[a-z0-9_.]+)\s*\}\}/g;

export const PLACEHOLDER_CATALOGUE = [
  'deal.name',
  'deal.amount',
  'deal.close_date',
  'company.name',
  'company.domain',
  'company.industry',
  'contact.first_name',
  'contact.last_name',
  'contact.full_name',
  'contact.email',
  'contact.job_title',
  'owner.full_name',
  'owner.email',
  'organization.name',
  'proposal.title',
  'proposal.valid_until',
  'proposal.number',
] as const;

export function extractPlaceholders(doc: ProposalDocument): string[] {
  const found = new Set<string>();
  for (const s of doc.sections) for (const m of `${s.title}\n${s.body}`.matchAll(PLACEHOLDER)) found.add(m[1] as string);
  return [...found].sort();
}

export function unknownPlaceholders(doc: ProposalDocument): string[] {
  const known = new Set<string>(PLACEHOLDER_CATALOGUE);
  return extractPlaceholders(doc).filter((p) => !known.has(p));
}

/** Placeholders whose value is missing or empty — blocks sending (RULE-AIA-11 PLACEHOLDER_UNRESOLVED). */
export function missingPlaceholders(doc: ProposalDocument, values: PlaceholderValues): string[] {
  return extractPlaceholders(doc).filter((p) => !values[p]?.trim());
}

export function resolveText(text: string, values: PlaceholderValues): string {
  return text.replace(PLACEHOLDER, (whole, key: string) => values[key]?.trim() || whole);
}

/** Frozen render model: placeholders replaced, pricing computed. Stored on a sent version (immutable). */
export interface Snapshot {
  schemaVersion: 1;
  title: string;
  number: string;
  versionNumber: number;
  organizationName: string;
  primaryColor: string;
  footerText: string;
  validUntil: string | null;
  currency: string;
  sections: { id: string; title: string; kind: Section['kind']; paragraphs: string[] }[];
  pricing: Pricing;
  totals: ProposalTotals;
  signers: string[];
}

export function buildSnapshot(input: {
  doc: ProposalDocument;
  values: PlaceholderValues;
  pricing: Pricing;
  totals: ProposalTotals;
  meta: Omit<Snapshot, 'schemaVersion' | 'sections' | 'pricing' | 'totals'>;
}): Snapshot {
  return {
    schemaVersion: 1,
    ...input.meta,
    sections: input.doc.sections.map((s) => ({
      id: s.id,
      title: resolveText(s.title, input.values),
      kind: s.kind,
      paragraphs: resolveText(s.body, input.values)
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean),
    })),
    pricing: input.pricing,
    totals: input.totals,
  };
}

/** RFC 8785-style canonical JSON (sorted keys) so the snapshot hash is deterministic (BR-SIG-009). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

// ───────────── deterministic pre-send checks (BR-AIA-002, RULE-AIA-11; authoritative, run without AI) ─────────────
export interface Finding {
  code:
    | 'PLACEHOLDER_UNRESOLVED'
    | 'REQUIRED_SECTION_EMPTY'
    | 'VALIDITY_DATE_PAST'
    | 'AI_CONTENT_PENDING'
    | 'PRICING_DEAL_AMOUNT_MISMATCH'
    | 'DISCOUNT_LIMIT_EXCEEDED'
    | 'NAME_MISMATCH'
    | 'FIGURE_INCONSISTENT';
  severity: 'blocking' | 'warning';
  origin: 'deterministic' | 'llm';
  message: string;
  sectionId?: string;
}

export function presendChecks(input: {
  doc: ProposalDocument;
  values: PlaceholderValues;
  totals: ProposalTotals;
  dealAmount: string | null;
  validUntil: string | null;
  today: string;
  pendingAiSections: string[];
  maxDiscountPercent: number;
}): Finding[] {
  const findings: Finding[] = [];
  for (const p of missingPlaceholders(input.doc, input.values)) {
    findings.push({ code: 'PLACEHOLDER_UNRESOLVED', severity: 'blocking', origin: 'deterministic', message: `No value for {{${p}}}` });
  }
  for (const s of input.doc.sections) {
    if (s.required && s.kind === 'text' && !s.body.trim()) {
      findings.push({
        code: 'REQUIRED_SECTION_EMPTY',
        severity: 'blocking',
        origin: 'deterministic',
        message: `Required section "${s.title}" is empty`,
        sectionId: s.id,
      });
    }
  }
  if (input.validUntil && input.validUntil < input.today) {
    findings.push({ code: 'VALIDITY_DATE_PAST', severity: 'blocking', origin: 'deterministic', message: 'The validity date is in the past' });
  }
  for (const sectionId of input.pendingAiSections) {
    findings.push({
      code: 'AI_CONTENT_PENDING',
      severity: 'blocking',
      origin: 'deterministic',
      message: 'AI-generated content is waiting for your review',
      sectionId,
    });
  }
  if (input.dealAmount !== null && Number(input.dealAmount) !== Number(input.totals.tcvExclTax)) {
    findings.push({
      code: 'PRICING_DEAL_AMOUNT_MISMATCH',
      severity: 'warning',
      origin: 'deterministic',
      message: `Deal amount ${input.dealAmount} differs from the proposal value ${input.totals.tcvExclTax}`,
    });
  }
  if (Number(input.totals.maxLineDiscountPercent) > input.maxDiscountPercent) {
    findings.push({
      code: 'DISCOUNT_LIMIT_EXCEEDED',
      severity: 'warning',
      origin: 'deterministic',
      message: `A discount of ${input.totals.maxLineDiscountPercent}% exceeds your limit of ${input.maxDiscountPercent}%`,
    });
  }
  return findings;
}

// ───────────── HTML renderer (BR-PRP-004: preview, buyer view and PDF use this exact output) ─────────────
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
const safeColor = (c: string) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : '#1f4e79');

function pricingTableHtml(s: Snapshot): string {
  const t = pricingTableText(s);
  const rows = t.lines
    .map(({ cells, description }) => {
      const [name, ...rest] = cells;
      return `<tr><td><strong>${escapeHtml(name ?? '')}</strong>${description ? `<br><span class="muted">${escapeHtml(description)}</span>` : ''}</td>${rest.map((c) => `<td class="num">${escapeHtml(c)}</td>`).join('')}</tr>`;
    })
    .join('');
  const totals = t.totals.map(([label, v]) => `<tr class="total"><td colspan="4">${escapeHtml(label)}</td><td class="num">${escapeHtml(v)}</td></tr>`).join('');
  const head = t.head.map((h, i) => (i === 0 ? `<th>${h}</th>` : `<th class="num">${h}</th>`)).join('');
  return `<table class="pricing"><thead><tr>${head}</tr></thead><tbody>${rows}${totals}</tbody></table>`;
}

export function renderHtml(s: Snapshot): string {
  const sections = s.sections
    .map((sec) => {
      const body = sec.paragraphs.map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
      const extra =
        sec.kind === 'pricing'
          ? pricingTableHtml(s)
          : sec.kind === 'signature'
            ? `<div class="signatures">${signerNames(s)
                .map((n) => `<div class="sig"><div class="line"></div>${escapeHtml(n)}</div>`)
                .join('')}</div>`
            : '';
      return `<section data-section-id="${escapeHtml(sec.id)}"><h2>${escapeHtml(sec.title)}</h2>${body}${extra}</section>`;
    })
    .join('');
  const color = safeColor(s.primaryColor);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(s.title)}</title><style>
body{font-family:Segoe UI,Arial,sans-serif;color:#1c2430;line-height:1.5;margin:0;padding:32px;max-width:820px;margin-inline:auto}
header{border-bottom:3px solid ${color};padding-bottom:12px;margin-bottom:24px}
header .org{color:${color};font-weight:700;font-size:14px;letter-spacing:.04em;text-transform:uppercase}
h1{font-size:26px;margin:6px 0 2px}h2{font-size:18px;color:${color};margin:28px 0 8px}
.meta,.muted{color:#5b6675;font-size:13px}
table.pricing{width:100%;border-collapse:collapse;margin-top:12px;font-size:14px}
table.pricing th,table.pricing td{border-bottom:1px solid #d8dee6;padding:8px 6px;text-align:left;vertical-align:top}
.num{text-align:right;white-space:nowrap}tr.total td{font-weight:600;border-bottom:none}
.signatures{display:flex;gap:40px;flex-wrap:wrap;margin-top:36px}.sig{min-width:220px;font-size:13px}.sig .line{border-bottom:1px solid #1c2430;height:44px;margin-bottom:6px}
footer{margin-top:40px;border-top:1px solid #d8dee6;padding-top:10px;font-size:12px;color:#5b6675}
section{break-inside:avoid-page}
</style></head><body><header><div class="org">${escapeHtml(s.organizationName)}</div><h1>${escapeHtml(s.title)}</h1><div class="meta">${escapeHtml(headerMetaText(s))}</div></header>${sections}<footer>${escapeHtml(s.footerText)}</footer></body></html>`;
}

// ───────────── DOCX (BR-PRP-005; same content and order as the PDF, OD-43) ─────────────
/** The pricing table as plain text cells — the ONE source for both renderers, so PDF and DOCX can never drift apart. */
export function pricingTableText(s: Snapshot): { head: string[]; lines: { cells: string[]; description?: string }[]; totals: [string, string][] } {
  const byKey = new Map<string, ComputedLine>(s.totals.lines.map((l) => [l.lineKey, l]));
  const money = (v: string) => `${s.currency} ${v}`;
  return {
    head: ['Item', 'Quantity', 'Unit price', 'Discount', 'Amount'],
    lines: s.pricing.lines.map((l) => {
      const c = byKey.get(l.lineKey);
      const period = l.billingType === 'recurring' ? ` / ${l.billingPeriod ?? ''}` : '';
      return {
        cells: [
          l.name,
          `${l.quantity} ${l.unit}`,
          `${money(l.unitPrice)}${period}`,
          c && Number(c.discount) > 0 ? `−${money(c.discount)}` : '—',
          `${money(c?.net ?? '0.00')}${period}`,
        ],
        ...(l.description ? { description: l.description } : {}),
      };
    }),
    totals: [
      ['One-time total (incl. tax)', money(s.totals.oneTime.total)],
      ...s.totals.recurring.map((r): [string, string] => [`Recurring per ${r.period} (incl. tax)`, money(r.total)]),
      [`Total contract value over ${s.totals.termMonths} months (excl. tax)`, money(s.totals.tcvExclTax)],
    ],
  };
}
export const headerMetaText = (s: Snapshot) => `${s.number} · Version ${s.versionNumber}${s.validUntil ? ` · Valid until ${s.validUntil}` : ''}`;
const signerNames = (s: Snapshot) => (s.signers.length ? s.signers : ['Authorised signatory']);

/** A paragraph whose single line breaks are kept (the HTML renderer turns them into <br>). */
const docxParagraph = (text: string, bold = false) =>
  new Paragraph({ children: text.split('\n').map((line, i) => new TextRun({ text: line, bold, ...(i > 0 ? { break: 1 } : {}) })) });

export async function renderDocx(s: Snapshot): Promise<Uint8Array> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ children: [new TextRun({ text: s.organizationName, bold: true })] }),
    new Paragraph({ text: s.title, heading: HeadingLevel.TITLE }),
    new Paragraph({ text: headerMetaText(s) }),
  ];
  const cell = (text: string, more: Paragraph[] = [], columnSpan = 1) => new TableCell({ children: [docxParagraph(text), ...more], columnSpan });
  for (const sec of s.sections) {
    children.push(new Paragraph({ text: sec.title, heading: HeadingLevel.HEADING_2 }));
    for (const p of sec.paragraphs) children.push(docxParagraph(p));
    if (sec.kind === 'pricing') {
      const t = pricingTableText(s);
      const rows = [
        new TableRow({ children: t.head.map((h) => cell(h)) }),
        ...t.lines.map((l) => new TableRow({ children: l.cells.map((c, i) => cell(c, i === 0 && l.description ? [docxParagraph(l.description)] : [])) })),
        ...t.totals.map(([label, value]) => new TableRow({ children: [cell(label, [], 4), cell(value)] })),
      ];
      children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
    }
    if (sec.kind === 'signature')
      for (const n of signerNames(s)) {
        children.push(new Paragraph(''));
        children.push(new Paragraph('______________________________'));
        children.push(docxParagraph(n));
      }
  }
  children.push(docxParagraph(s.footerText));
  const doc = new Document({ title: s.title, creator: s.organizationName, sections: [{ children }] });
  return new Uint8Array(await Packer.toBuffer(doc));
}

// ───────────── version comparison (BR-PRP-006) ─────────────
export interface SectionDiff {
  sectionId: string;
  title: string;
  change: 'added' | 'removed' | 'changed' | 'unchanged';
  before: string;
  after: string;
}
export function diffDocuments(a: ProposalDocument, b: ProposalDocument): SectionDiff[] {
  const before = new Map(a.sections.map((s) => [s.id, s]));
  const out: SectionDiff[] = [];
  for (const s of b.sections) {
    const old = before.get(s.id);
    before.delete(s.id);
    out.push({
      sectionId: s.id,
      title: s.title,
      change: !old ? 'added' : old.body === s.body && old.title === s.title ? 'unchanged' : 'changed',
      before: old?.body ?? '',
      after: s.body,
    });
  }
  for (const s of before.values()) out.push({ sectionId: s.id, title: s.title, change: 'removed', before: s.body, after: '' });
  return out;
}
export interface PricingDiff {
  lineKey: string;
  name: string;
  change: 'added' | 'removed' | 'changed';
  fields: { field: string; from: string; to: string }[];
}
export function diffPricing(a: Pricing, b: Pricing): PricingDiff[] {
  const before = new Map(a.lines.map((l) => [l.lineKey, l]));
  const out: PricingDiff[] = [];
  for (const l of b.lines) {
    const old = before.get(l.lineKey);
    before.delete(l.lineKey);
    if (!old) {
      out.push({ lineKey: l.lineKey, name: l.name, change: 'added', fields: [] });
      continue;
    }
    const fields = (['name', 'quantity', 'unitPrice', 'discountValue', 'taxRatePercent', 'billingPeriod'] as const)
      .filter((f) => (old[f] ?? '') !== (l[f] ?? ''))
      .map((f) => ({ field: f, from: String(old[f] ?? ''), to: String(l[f] ?? '') }));
    if (fields.length) out.push({ lineKey: l.lineKey, name: l.name, change: 'changed', fields });
  }
  for (const l of before.values()) out.push({ lineKey: l.lineKey, name: l.name, change: 'removed', fields: [] });
  return out;
}
