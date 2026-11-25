/** Weekly report deck — the default template: masters, logo, six slides, nothing internal. No database. */
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { type DeckModel, renderWeeklyPptx, resolveTemplateKey, WEEKLY_TEMPLATES } from './deck.ts';

const model: DeckModel = {
  draft: true,
  fileName: 'Stark_Industries_Weekly_Status_2026-11-22_v1_DRAFT.pptx',
  brandColor: '0B2A4A',
  footerText: 'Kensium — confidential',
  orgName: 'Kensium',
  clientName: 'Stark Industries',
  periodLabel: '16–22 Nov 2026',
  health: { level: 'green', label: 'On track', reason: 'Work is progressing as planned' },
  summary: ['The project is 7.3% complete by estimated hours.'],
  kpis: [
    { label: 'Complete by estimate', value: '7.3%', change: '▲ 7.3 pts vs last week' },
    { label: 'Items completed this week', value: '1', change: null },
    { label: 'Remaining estimated hours', value: '204 h', change: null },
    { label: 'Items in progress', value: '1', change: null },
  ],
  phases: [{ phase: 'Discovery', items: 2, estimateHours: '40', doneHours: '16', pct: '40.0' }],
  morePhases: 0,
  completed: { statements: ['We completed Requirements workshop and sign-off.'], items: ['S-001 · Requirements workshop and sign-off'] },
  nextWeek: { statements: ['Work continues on Solution design document.'], items: ['S-002 · Solution design document'] },
  risks: ['No significant risks this week'],
};

async function unzip(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files);
  const read = (name: string) => (zip.file(name) as JSZip.JSZipObject).async('string');
  const all = async (prefix: string) => Promise.all(names.filter((n) => n.startsWith(prefix) && n.endsWith('.xml')).map(read));
  const slides = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  return { names, slides, layouts: (await all('ppt/slideLayouts/')).join('\n'), slideXml: (await Promise.all(slides.map(read))).join('\n'), all };
}

describe('weekly report deck — default template', () => {
  it('uses the WR_TITLE and WR_CONTENT masters with the brand colour, logo, footer and slide number', async () => {
    const deck = await unzip(await renderWeeklyPptx(model, 'default'));
    expect(deck.slides).toHaveLength(6);
    expect(deck.layouts).toContain('name="WR_TITLE"');
    expect(deck.layouts).toContain('name="WR_CONTENT"');
    expect(deck.layouts).toContain('0B2A4A'); // brand colour on the masters
    expect(deck.layouts).toContain('Kensium — confidential'); // footer text lives on the master, once
    expect(deck.layouts).toContain('type="sldNum"');
    expect(deck.names.some((n) => /^ppt\/media\/.+\.png$/.test(n))).toBe(true); // the logo image
    expect(deck.layouts).toContain('<p:pic>');
    // Slide titles go into the master's title placeholder.
    for (const title of ['Summary', 'Scope progress', 'Completed this week', 'Next week', 'Risks &amp; support needed']) expect(deck.slideXml).toContain(title);
    expect(deck.slideXml).toContain('type="title"');
    expect(deck.slideXml).toContain('Stark Industries');
    expect(deck.slideXml).toContain('DRAFT');
    const everything = (await deck.all('ppt/')).join('\n');
    for (const word of ['scope:', 'task:', 'metric:', 'activity:', 'mismatch', 'unmatched', 'E-11']) expect(everything).not.toContain(word);
  });

  it('the final deck has no draft label', async () => {
    const deck = await unzip(await renderWeeklyPptx({ ...model, draft: false }));
    expect(deck.slides).toHaveLength(6);
    expect((await deck.all('ppt/')).join('\n')).not.toContain('DRAFT');
  });

  it('an unknown or missing template key falls back to the default template', () => {
    expect(Object.keys(WEEKLY_TEMPLATES)).toEqual(['default']);
    expect(resolveTemplateKey(undefined)).toBe('default');
    expect(resolveTemplateKey('acme-2027')).toBe('default');
    expect(resolveTemplateKey('toString')).toBe('default');
  });
});
