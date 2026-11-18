/**
 * BR-PRP-005 / OD-43: the PDF (printed from renderHtml) and the DOCX must carry the same content. This test renders ONE
 * snapshot both ways, reads the text back out of the real output (HTML markup and the DOCX zip's word/document.xml) and
 * compares: section titles and order, every paragraph, every pricing line, the totals, header, signers and footer.
 */
import { inflateRawSync } from 'node:zlib';
import { computeTotals, type Pricing, type ProposalDocument } from '@crm/shared';
import { describe, expect, it } from 'vitest';
import { buildSnapshot, renderDocx, renderHtml, type Snapshot } from './index.ts';

// ───────────── reading the rendered output back ─────────────
/** Minimal ZIP reader (central directory → entry → inflate); enough for the files the docx library writes. */
function unzipEntry(zip: Uint8Array, name: string): string {
  const buf = Buffer.from(zip);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip file');
  let at = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < buf.readUInt16LE(eocd + 10); i++) {
    const method = buf.readUInt16LE(at + 10);
    const compressedSize = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    if (buf.toString('utf8', at + 46, at + 46 + nameLen) === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + compressedSize);
      return (method === 0 ? data : inflateRawSync(data)).toString('utf8');
    }
    at += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${name} not found in zip`);
}
const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');

interface Extracted {
  /** Document order: headings and paragraphs outside tables. */
  blocks: { kind: 'heading' | 'text'; text: string }[];
  /** Tables as rows of cell text (lines inside a cell joined with \n). */
  tables: string[][][];
}

function extractDocx(bytes: Uint8Array): Extracted {
  const xml = unzipEntry(bytes, 'word/document.xml');
  const paragraphText = (p: string) =>
    decode([...p.matchAll(/<w:br\s*\/>|<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => (m[0].startsWith('<w:br') ? '\n' : (m[1] ?? ''))).join(''));
  const paragraphs = (chunk: string) => [...chunk.matchAll(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g)].map((m) => m[0]);
  const tables: string[][][] = [];
  const body = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (tbl) => {
    tables.push(
      [...tbl.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((tr) =>
        [...tr[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((tc) => paragraphs(tc[0]).map(paragraphText).join('\n')),
      ),
    );
    return '';
  });
  const blocks = paragraphs(body)
    .map((p) => ({ kind: /<w:pStyle w:val="Heading2"\/>/.test(p) ? ('heading' as const) : ('text' as const), text: paragraphText(p) }))
    .filter((b) => b.text.trim() && !/^_+$/.test(b.text));
  return { blocks, tables };
}

function extractHtml(html: string): Extracted {
  const text = (fragment: string) =>
    decode(
      fragment
        .replace(/<br\s*\/?>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .trim(),
    );
  const tables: string[][][] = [];
  const bodyHtml = html.slice(html.indexOf('<body>')).replace(/<table[\s\S]*?<\/table>/g, (tbl) => {
    tables.push(
      [...tbl.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((tr) => [...(tr[1] ?? '').matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => text(c[1] ?? ''))),
    );
    return '';
  });
  const blocks = [
    ...bodyHtml
      .replaceAll('<div class="line"></div>', '')
      .matchAll(/<(h2|p|div class="org"|div class="meta"|div class="sig"|footer)>([\s\S]*?)<\/(?:h2|p|div|footer)>/g),
  ]
    .map((m) => ({ kind: m[1] === 'h2' ? ('heading' as const) : ('text' as const), text: text(m[2] ?? '') }))
    .filter((b) => b.text.trim());
  return { blocks, tables };
}

// ───────────── the snapshot under test ─────────────
const doc: ProposalDocument = {
  schemaVersion: 1,
  sections: [
    {
      id: 'intro',
      title: 'Introduction for {{company.name}}',
      locked: false,
      required: true,
      aiDraftable: true,
      kind: 'text',
      body: 'Dear {{contact.first_name}},\n\nThank you for your time.\nWe enjoyed the workshop & the "Q&A" <session>.\n\nKind regards,\n{{owner.full_name}}',
    },
    { id: 'scope', title: 'Scope of work', locked: false, required: true, aiDraftable: true, kind: 'text', body: 'Phase 1 — discovery.\n\nPhase 2 — rollout.' },
    { id: 'pricing', title: 'Investment', locked: false, required: false, aiDraftable: false, kind: 'pricing', body: 'The following pricing applies.' },
    { id: 'terms', title: 'Terms', locked: true, required: true, aiDraftable: false, kind: 'text', body: 'Valid until {{proposal.valid_until}}.' },
    { id: 'sign', title: 'Acceptance', locked: true, required: false, aiDraftable: false, kind: 'signature', body: 'Signed for {{company.name}}:' },
  ],
};
const pricing: Pricing = {
  lines: [
    {
      lineKey: 'setup',
      name: 'Implementation <fixed>',
      description: 'On-site setup & training',
      unit: 'project',
      quantity: '1',
      unitPrice: '10000',
      taxRatePercent: '10',
      billingType: 'one_time',
      discountType: 'percent',
      discountValue: '5',
    },
    {
      lineKey: 'sub',
      name: 'Subscription',
      unit: 'seat',
      quantity: '25',
      unitPrice: '99.50',
      taxRatePercent: '0',
      billingType: 'recurring',
      billingPeriod: 'month',
    },
    {
      lineKey: 'support',
      name: 'Premium support',
      unit: 'year',
      quantity: '2',
      unitPrice: '1200',
      taxRatePercent: '0',
      billingType: 'recurring',
      billingPeriod: 'year',
      discountType: 'amount',
      discountValue: '150',
    },
  ],
};
const values = {
  'company.name': 'Globex & Sons',
  'contact.first_name': 'Ana',
  'owner.full_name': "Rae O'Rep",
  'proposal.valid_until': '2027-01-31',
};
function snapshotFor(p: Pricing, signers: string[], validUntil: string | null): Snapshot {
  return buildSnapshot({
    doc,
    values,
    pricing: p,
    totals: computeTotals(p, 24, 'EUR'),
    meta: {
      title: 'Proposal for Globex & Sons',
      number: 'P-ABC123-v3',
      versionNumber: 3,
      organizationName: 'Northwind <Sales>',
      primaryColor: '#1f4e79',
      footerText: 'Northwind — Confidential & proprietary',
      validUntil,
      currency: 'EUR',
      signers,
    },
  });
}

describe('PDF (HTML) and DOCX content parity (BR-PRP-005)', () => {
  const snapshot = snapshotFor(pricing, ['Ana Alvarez', 'Bo Berg'], '2027-01-31');
  let html: Extracted;
  let docx: Extracted;
  const load = async () => {
    html ??= extractHtml(renderHtml(snapshot));
    docx ??= extractDocx(await renderDocx(snapshot));
  };

  it('both contain every section title, in the same order', async () => {
    await load();
    const titles = snapshot.sections.map((s) => s.title);
    expect(titles).toContain('Introduction for Globex & Sons');
    expect(html.blocks.filter((b) => b.kind === 'heading').map((b) => b.text)).toEqual(titles);
    expect(docx.blocks.filter((b) => b.kind === 'heading').map((b) => b.text)).toEqual(titles);
  });

  it('both contain every paragraph of body text, including line breaks and special characters', async () => {
    await load();
    const paragraphs = snapshot.sections.flatMap((s) => s.paragraphs);
    expect(paragraphs).toContain('Thank you for your time.\nWe enjoyed the workshop & the "Q&A" <session>.');
    expect(paragraphs).toContain("Kind regards,\nRae O'Rep");
    expect(paragraphs).toHaveLength(8);
    for (const p of paragraphs) {
      expect(html.blocks.map((b) => b.text)).toContain(p);
      expect(docx.blocks.map((b) => b.text)).toContain(p);
    }
  });

  it('both contain every pricing line: name, description, quantity, unit price, discount and amount', async () => {
    await load();
    expect(html.tables).toHaveLength(1);
    expect(docx.tables).toHaveLength(1);
    const expected = [
      ['Item', 'Quantity', 'Unit price', 'Discount', 'Amount'],
      ['Implementation <fixed>\nOn-site setup & training', '1 project', 'EUR 10000', '−EUR 500.00', 'EUR 9500.00'],
      ['Subscription', '25 seat', 'EUR 99.50 / month', '—', 'EUR 2487.50 / month'],
      ['Premium support', '2 year', 'EUR 1200 / year', '−EUR 150.00', 'EUR 2250.00 / year'],
    ];
    expect(html.tables[0]!.slice(0, 4)).toEqual(expected);
    expect(docx.tables[0]!.slice(0, 4)).toEqual(expected);
  });

  it('both show the same totals', async () => {
    await load();
    const t = snapshot.totals;
    const expected = [
      ['One-time total (incl. tax)', `EUR ${t.oneTime.total}`],
      ...t.recurring.map((r) => [`Recurring per ${r.period} (incl. tax)`, `EUR ${r.total}`]),
      ['Total contract value over 24 months (excl. tax)', `EUR ${t.tcvExclTax}`],
    ];
    expect(t.oneTime.total).toBe('10450.00'); // 9500 + 10% tax — the fixture really exercises tax and discount
    expect(t.recurring.map((r) => r.period).sort()).toEqual(['month', 'year']);
    expect(html.tables[0]!.slice(4)).toEqual(expected);
    expect(docx.tables[0]!.slice(4)).toEqual(expected);
  });

  it('the whole document reads the same in both formats, in the same order', async () => {
    await load();
    // Header (organization, number, version, validity date), all sections, signer names and the footer.
    expect(docx.tables).toEqual(html.tables);
    const withoutTitle = docx.blocks.filter((b) => b.text !== snapshot.title); // HTML shows the title as <h1>
    expect(withoutTitle.map((b) => b.text)).toEqual(html.blocks.map((b) => b.text));
    expect(html.blocks[0]!.text).toBe('Northwind <Sales>');
    expect(html.blocks[1]!.text).toBe('P-ABC123-v3 · Version 3 · Valid until 2027-01-31');
    expect(html.blocks.slice(-3).map((b) => b.text)).toEqual(['Ana Alvarez', 'Bo Berg', 'Northwind — Confidential & proprietary']);
    expect(docx.blocks.some((b) => b.text === snapshot.title)).toBe(true);
    expect(renderHtml(snapshot)).toContain('<h1>Proposal for Globex &amp; Sons</h1>');
  });

  it('holds without pricing lines, signers or a validity date', async () => {
    const bare = snapshotFor({ lines: [] }, [], null);
    const h = extractHtml(renderHtml(bare));
    const d = extractDocx(await renderDocx(bare));
    expect(d.tables).toEqual(h.tables);
    expect(h.tables[0]).toEqual([
      ['Item', 'Quantity', 'Unit price', 'Discount', 'Amount'],
      ['One-time total (incl. tax)', 'EUR 0.00'],
      ['Total contract value over 24 months (excl. tax)', 'EUR 0.00'],
    ]);
    expect(d.blocks.filter((b) => b.text !== bare.title).map((b) => b.text)).toEqual(h.blocks.map((b) => b.text));
    expect(h.blocks[1]!.text).toBe('P-ABC123-v3 · Version 3');
    expect(h.blocks.map((b) => b.text)).toContain('Authorised signatory');
  });
});
