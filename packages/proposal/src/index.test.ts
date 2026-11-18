import { computeTotals, type Pricing, type ProposalDocument } from '@crm/shared';
import { describe, expect, it } from 'vitest';
import {
  buildSnapshot,
  canonicalJson,
  diffDocuments,
  diffPricing,
  missingPlaceholders,
  presendChecks,
  renderDocx,
  renderHtml,
  unknownPlaceholders,
} from './index.ts';

const doc: ProposalDocument = {
  schemaVersion: 1,
  sections: [
    {
      id: 'intro',
      title: 'Proposal for {{company.name}}',
      locked: false,
      required: true,
      aiDraftable: true,
      kind: 'text',
      body: 'Dear {{contact.first_name}},\n\nThank you.',
    },
    { id: 'price', title: 'Investment', locked: true, required: false, aiDraftable: false, kind: 'pricing', body: '' },
  ],
};
const pricing: Pricing = {
  lines: [{ lineKey: 'a', name: 'Setup <b>', unit: 'each', quantity: '1', unitPrice: '1000', taxRatePercent: '0', billingType: 'one_time' }],
};
const totals = computeTotals(pricing, 12, 'USD');
const meta = {
  title: 'Proposal',
  number: 'P-1',
  versionNumber: 1,
  organizationName: 'Acme',
  primaryColor: '#123456',
  footerText: 'Confidential',
  validUntil: null,
  currency: 'USD',
  signers: [],
};

describe('placeholders', () => {
  it('finds missing values and unknown references (BR-TPL-008)', () => {
    expect(missingPlaceholders(doc, { 'company.name': 'Globex' })).toEqual(['contact.first_name']);
    expect(unknownPlaceholders({ ...doc, sections: [{ ...doc.sections[0]!, body: '{{deal.nope}}' }] })).toEqual(['deal.nope']);
  });
});

describe('rendering', () => {
  const snapshot = buildSnapshot({ doc, values: { 'company.name': 'Globex & Co', 'contact.first_name': 'Ana' }, pricing, totals, meta });
  it('resolves placeholders and escapes all user content (XSS)', () => {
    const html = renderHtml(snapshot);
    expect(html).toContain('Proposal for Globex &amp; Co');
    expect(html).toContain('Dear Ana,');
    expect(html).toContain('Setup &lt;b&gt;');
    expect(html).not.toContain('<b>');
    expect(html).toContain('USD 1000.00');
  });
  it('produces a DOCX file (zip signature)', async () => {
    const bytes = await renderDocx(snapshot);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
  });
  it('canonical JSON is key-order independent', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 }));
  });
});

describe('presendChecks', () => {
  const base = {
    doc,
    values: { 'company.name': 'Globex', 'contact.first_name': 'Ana' },
    totals,
    dealAmount: '1000.00',
    validUntil: null,
    today: '2026-11-17',
    pendingAiSections: [],
    maxDiscountPercent: 20,
  };
  it('passes a complete proposal', () => expect(presendChecks(base)).toEqual([]));
  it('blocks on unresolved placeholders, past validity and pending AI content', () => {
    const f = presendChecks({ ...base, values: {}, validUntil: '2026-01-01', pendingAiSections: ['intro'] });
    expect(
      f
        .filter((x) => x.severity === 'blocking')
        .map((x) => x.code)
        .sort(),
    ).toEqual(['AI_CONTENT_PENDING', 'PLACEHOLDER_UNRESOLVED', 'PLACEHOLDER_UNRESOLVED', 'VALIDITY_DATE_PAST']);
  });
  it('warns when the deal amount differs', () => {
    expect(presendChecks({ ...base, dealAmount: '900.00' })[0]).toMatchObject({ code: 'PRICING_DEAL_AMOUNT_MISMATCH', severity: 'warning' });
  });
});

describe('diff', () => {
  it('reports section and pricing changes (BR-PRP-006)', () => {
    const next: ProposalDocument = { ...doc, sections: [{ ...doc.sections[0]!, body: 'New text' }] };
    expect(diffDocuments(doc, next).map((d) => d.change)).toEqual(['changed', 'removed']);
    const p2: Pricing = { lines: [{ ...pricing.lines[0]!, quantity: '2' }] };
    expect(diffPricing(pricing, p2)[0]?.fields).toEqual([{ field: 'quantity', from: '1', to: '2' }]);
  });
});
