/** Weekly report deck — the default template: masters, logo, six slides, nothing internal. No database. */
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { WeeklyMetricsDoc } from '../../db/schema-weekly-reports.ts';
import { buildDeckModel, type DeckModel, renderWeeklyPptx, resolveTemplateKey, WEEKLY_TEMPLATES } from './deck.ts';

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

describe('weekly report deck — client wording and fonts (found in the PowerPoint preview)', () => {
  it('uses a font every PowerPoint has, never the screen font', async () => {
    const deck = await unzip(await renderWeeklyPptx(model));
    const everything = (await deck.all('ppt/')).join('\n');
    expect(everything).toContain('typeface="Arial"');
    expect(everything).not.toContain('typeface="Inter"'); // Inter is not installed on most PCs: letters came out stretched
  });

  it('lists upcoming tasks without the scope tag, with a readable date, and not twice', () => {
    const item = (rowId: string, scopeId: string, title: string, state: 'in_progress' | 'not_started', taskId: string | null) => ({
      rowId,
      rowNo: 2,
      scopeId,
      title,
      phase: 'Build',
      estimateHours: '40',
      actualHours: null,
      state,
      doneAt: null,
      doneThisWeek: false,
      taskId,
      mismatch: false,
    });
    const doc = {
      metrics: [],
      health: { level: 'green', reasons: [] },
      phases: [],
      items: [item('r3', 'S-003', 'ERP connector for orders', 'in_progress', 't3'), item('r4', 'S-004', 'Inventory sync service', 'not_started', 't4')],
      upcomingTasks: [
        { id: 't3', title: '[S-003] Build the integration', dueDate: '2026-11-27' }, // already listed as the scope item in progress
        { id: 't4', title: '[S-004] Set up test environment', dueDate: '2026-11-28' },
        { id: 't9', title: 'Send the access list', dueDate: '2026-12-01' },
      ],
    } as unknown as WeeklyMetricsDoc;
    const built = buildDeckModel({
      draft: false,
      attempt: 1,
      periodStart: '2026-11-16',
      periodEnd: '2026-11-22',
      clientName: 'Stark Industries',
      orgName: 'Kensium',
      branding: { primaryColor: '#0B2A4A', footerText: 'Kensium' },
      metrics: doc,
      narrative: { summary: [], completed: [], nextWeek: [], risks: [] },
    });
    expect(built.nextWeek.items).toEqual(['S-003 · ERP connector for orders', 'Set up test environment (due 28 Nov)', 'Send the access list (due 1 Dec)']);
    expect(built.nextWeek.items.join(' ')).not.toContain('[');
  });
});
