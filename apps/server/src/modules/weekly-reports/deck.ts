/**
 * PPT builder. `buildDeckModel` (pure) decides every word and number on the slides; `renderWeeklyPptx` only lays
 * them out with pptxgenjs. Slides never contain source ids or internal flags — only client-facing text.
 * A draft carries "DRAFT – not approved" on every slide; the final deck is rendered again without it at approval.
 */
import PptxGenJS from 'pptxgenjs';
import type { HealthLevel, WeeklyMetricsDoc, WeeklyNarrative, WeeklyPhaseRow } from '../../db/schema-weekly-reports.ts';
import { metricValue } from './metrics.ts';
import { periodLabel } from './period.ts';

/** The class behind the package: its typings describe the CommonJS module object, whose `default` is the class. */
type PptxClass = (typeof PptxGenJS)['default'];

export const PPTX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const DRAFT_LABEL = 'DRAFT – not approved';
const NO_RISKS = 'No significant risks this week';
const MAX_LIST = 8;
const MAX_PHASE_ROWS = 10;

export interface DeckKpi {
  label: string;
  value: string;
  /** Week-over-week change in words, or null when there is no earlier report. */
  change: string | null;
}
export interface DeckModel {
  draft: boolean;
  fileName: string;
  /** Six hex digits, no "#". */
  brandColor: string;
  footerText: string;
  orgName: string;
  clientName: string;
  periodLabel: string;
  health: { level: HealthLevel; label: string; reason: string };
  summary: string[];
  kpis: DeckKpi[];
  phases: WeeklyPhaseRow[];
  morePhases: number;
  completed: { statements: string[]; items: string[] };
  nextWeek: { statements: string[]; items: string[] };
  risks: string[];
}

const truncate = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};
const HEALTH_LABEL: Record<HealthLevel, string> = { green: 'On track', amber: 'Needs attention', red: 'At risk' };
const HEALTH_REASON: Record<string, string> = {
  OVERDUE_TASKS: 'Some tasks on scope items are overdue',
  OVER_ESTIMATE: 'Completed work took more hours than estimated',
  NO_PROGRESS_TWO_WEEKS: 'No scope items were completed in the last two weeks',
  NO_ITEMS_DONE_THIS_WEEK: 'No scope items were completed this week',
};
const HEALTH_COLOR: Record<HealthLevel, string> = { green: '2F7A4E', amber: 'B45309', red: 'C62828' };

/** `<Client>_Weekly_Status_<YYYY-MM-DD>_v<attempt>[_DRAFT].pptx`, safe on any file system. */
export function deckFileName(clientName: string, periodEnd: string, attempt: number, draft: boolean): string {
  const client =
    clientName
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'Client';
  return `${client}_Weekly_Status_${periodEnd}_v${attempt}${draft ? '_DRAFT' : ''}.pptx`;
}

function change(delta: string | null | undefined, unit: string): string | null {
  if (delta === null || delta === undefined) return null;
  const n = Number(delta);
  if (n === 0) return '● no change vs last week';
  return `${n > 0 ? '▲' : '▼'} ${delta.replace(/^-/, '')}${unit} vs last week`;
}

export function buildDeckModel(input: {
  draft: boolean;
  attempt: number;
  periodStart: string;
  periodEnd: string;
  clientName: string;
  orgName: string;
  branding: { primaryColor: string; footerText: string };
  metrics: WeeklyMetricsDoc;
  narrative: WeeklyNarrative;
}): DeckModel {
  const { metrics: doc, narrative } = input;
  const metric = (id: string) => doc.metrics.find((m) => m.id === id);
  const texts = (list: { text: string }[], max: number) => list.slice(0, max).map((s) => truncate(s.text, 320));
  const itemLabel = (i: { scopeId: string | null; title: string }) => truncate(i.scopeId ? `${i.scopeId} · ${i.title}` : i.title, 90);
  const inProgress = doc.items.filter((i) => i.state === 'in_progress').map(itemLabel);
  const upcoming = doc.upcomingTasks.map((t) => truncate(`${t.title} (due ${t.dueDate})`, 90));
  const risks = texts(narrative.risks, 3);
  return {
    draft: input.draft,
    fileName: deckFileName(input.clientName, input.periodEnd, input.attempt, input.draft),
    brandColor: /^#[0-9a-fA-F]{6}$/.test(input.branding.primaryColor) ? input.branding.primaryColor.slice(1).toUpperCase() : '3E7360',
    footerText: truncate(input.branding.footerText || input.orgName, 120),
    orgName: truncate(input.orgName, 80),
    clientName: truncate(input.clientName, 80),
    periodLabel: periodLabel(input.periodStart, input.periodEnd),
    health: {
      level: doc.health.level,
      label: HEALTH_LABEL[doc.health.level],
      reason: doc.health.reasons.length ? doc.health.reasons.map((r) => HEALTH_REASON[r] ?? r).join('. ') : 'Work is progressing as planned',
    },
    summary: texts(narrative.summary, 3),
    kpis: [
      { label: 'Complete by estimate', value: `${metricValue(doc, 'E-05') ?? '0.0'}%`, change: change(metric('E-05')?.delta, ' pts') },
      { label: 'Items completed this week', value: metricValue(doc, 'E-06') ?? '0', change: change(metric('E-06')?.delta, '') },
      { label: 'Remaining estimated hours', value: `${metricValue(doc, 'E-07') ?? '0'} h`, change: null },
      { label: 'Items in progress', value: metricValue(doc, 'E-08') ?? '0', change: null },
    ],
    phases: doc.phases.slice(0, MAX_PHASE_ROWS).map((p) => ({ ...p, phase: truncate(p.phase, 40) })),
    morePhases: Math.max(0, doc.phases.length - MAX_PHASE_ROWS),
    completed: {
      statements: texts(narrative.completed, 5),
      items: doc.items
        .filter((i) => i.doneThisWeek)
        .slice(0, MAX_LIST)
        .map(itemLabel),
    },
    nextWeek: { statements: texts(narrative.nextWeek, 5), items: [...inProgress, ...upcoming].slice(0, MAX_LIST) },
    risks: risks.length ? risks : [NO_RISKS],
  };
}

// ───────────── rendering (layout only) ─────────────
const FONT = 'Inter'; // PowerPoint substitutes its default sans-serif (Arial) where Inter is not installed
const INK = '1B1F22';
const MUTED = '5F6368';
const W = 13.33;

export async function renderWeeklyPptx(model: DeckModel): Promise<Uint8Array> {
  // The package is CommonJS: depending on the loader the class is the default export or sits under `.default`.
  const Pptx = ((PptxGenJS as unknown as { default?: PptxClass }).default ?? PptxGenJS) as PptxClass;
  const pptx = new Pptx();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = `${model.clientName} — Weekly status report ${model.periodLabel}`;
  pptx.company = model.orgName;
  pptx.theme = { headFontFace: FONT, bodyFontFace: FONT };
  type Slide = ReturnType<typeof pptx.addSlide>;

  /** Footer and (for drafts) the draft label, written on the slide itself so they are in every slide file. */
  const chrome = (slide: Slide, dark = false) => {
    slide.addText(model.footerText, { x: 0.5, y: 7.0, w: 9, h: 0.3, fontFace: FONT, fontSize: 10, color: dark ? 'FFFFFF' : MUTED });
    if (model.draft)
      slide.addText(DRAFT_LABEL, {
        x: W - 3.6,
        y: 0.2,
        w: 3.1,
        h: 0.35,
        fontFace: FONT,
        fontSize: 11,
        bold: true,
        align: 'right',
        color: dark ? 'FFFFFF' : 'B45309',
      });
  };
  const titled = (title: string): Slide => {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.12, fill: { color: model.brandColor }, line: { color: model.brandColor } });
    slide.addText(title, { x: 0.5, y: 0.35, w: 9, h: 0.6, fontFace: FONT, fontSize: 26, bold: true, color: INK });
    slide.addText(`${model.clientName} · ${model.periodLabel}`, { x: 0.5, y: 0.95, w: 9, h: 0.3, fontFace: FONT, fontSize: 12, color: MUTED });
    chrome(slide);
    return slide;
  };
  const bullets = (slide: Slide, lines: string[], box: { x: number; y: number; w: number; h: number }, fontSize = 15) => {
    if (!lines.length) return;
    slide.addText(
      lines.map((text) => ({ text, options: { bullet: true, breakLine: true } })),
      { ...box, fontFace: FONT, fontSize, color: INK, valign: 'top', paraSpaceAfter: 8 },
    );
  };
  const heading = (slide: Slide, text: string, x: number, y: number, w: number) =>
    slide.addText(text, { x, y, w, h: 0.3, fontFace: FONT, fontSize: 12, bold: true, color: model.brandColor });

  // 1 — Title
  const cover = pptx.addSlide();
  cover.background = { color: model.brandColor };
  cover.addText(model.clientName, { x: 0.8, y: 2.2, w: W - 1.6, h: 1.1, fontFace: FONT, fontSize: 44, bold: true, color: 'FFFFFF' });
  cover.addText('Weekly status report', { x: 0.8, y: 3.3, w: W - 1.6, h: 0.6, fontFace: FONT, fontSize: 26, color: 'FFFFFF' });
  cover.addText(model.periodLabel, { x: 0.8, y: 3.95, w: W - 1.6, h: 0.45, fontFace: FONT, fontSize: 18, color: 'FFFFFF' });
  cover.addText(model.orgName, { x: 0.8, y: 5.6, w: W - 1.6, h: 0.4, fontFace: FONT, fontSize: 16, bold: true, color: 'FFFFFF' });
  chrome(cover, true);

  // 2 — Summary
  const summary = titled('Summary');
  summary.addShape(pptx.ShapeType.roundRect, {
    x: 0.5,
    y: 1.5,
    w: 2.4,
    h: 0.45,
    rectRadius: 0.08,
    fill: { color: HEALTH_COLOR[model.health.level] },
    line: { color: HEALTH_COLOR[model.health.level] },
  });
  summary.addText(model.health.label, {
    x: 0.5,
    y: 1.5,
    w: 2.4,
    h: 0.45,
    fontFace: FONT,
    fontSize: 14,
    bold: true,
    color: 'FFFFFF',
    align: 'center',
    valign: 'middle',
  });
  summary.addText(model.health.reason, { x: 3.1, y: 1.5, w: W - 3.6, h: 0.45, fontFace: FONT, fontSize: 13, color: MUTED, valign: 'middle' });
  bullets(summary, model.summary, { x: 0.5, y: 2.2, w: W - 1, h: 2.3 }, 16);
  const tileW = (W - 1 - 0.3 * 3) / 4;
  model.kpis.forEach((k, i) => {
    const x = 0.5 + i * (tileW + 0.3);
    summary.addShape(pptx.ShapeType.roundRect, { x, y: 4.7, w: tileW, h: 1.9, rectRadius: 0.08, fill: { color: 'F4F5F7' }, line: { color: 'E4E7EB' } });
    summary.addText(k.label, { x: x + 0.2, y: 4.8, w: tileW - 0.4, h: 0.35, fontFace: FONT, fontSize: 11, color: MUTED });
    summary.addText(k.value, { x: x + 0.2, y: 5.15, w: tileW - 0.4, h: 0.8, fontFace: FONT, fontSize: 30, bold: true, color: INK });
    if (k.change) summary.addText(k.change, { x: x + 0.2, y: 6.0, w: tileW - 0.4, h: 0.35, fontFace: FONT, fontSize: 11, color: MUTED });
  });

  // 3 — Scope progress
  const scope = titled('Scope progress');
  const head = (text: string) => ({ text, options: { bold: true, color: 'FFFFFF', fill: { color: model.brandColor }, fontFace: FONT, fontSize: 11 } });
  const cell = (text: string, align: 'left' | 'right' = 'left') => ({ text, options: { color: INK, fontFace: FONT, fontSize: 11, align } });
  scope.addTable(
    [
      [head('Phase'), head('Items'), head('Estimate h'), head('Done h'), head('% complete')],
      ...model.phases.map((p) => [
        cell(p.phase),
        cell(String(p.items), 'right'),
        cell(p.estimateHours, 'right'),
        cell(p.doneHours, 'right'),
        cell(`${p.pct}%`, 'right'),
      ]),
      ...(model.morePhases ? [[cell(`…and ${model.morePhases} more`), cell(''), cell(''), cell(''), cell('')]] : []),
    ],
    { x: 0.5, y: 1.6, w: 6.2, colW: [2.4, 0.8, 1.0, 0.9, 1.1], border: { type: 'solid', color: 'E4E7EB', pt: 1 }, rowH: 0.36 },
  );
  if (model.phases.length)
    scope.addChart(pptx.ChartType.bar, [{ name: '% complete', labels: model.phases.map((p) => p.phase), values: model.phases.map((p) => Number(p.pct)) }], {
      x: 7.1,
      y: 1.5,
      w: 5.7,
      h: 4.8,
      barDir: 'col',
      chartColors: [model.brandColor],
      valAxisMinVal: 0,
      valAxisMaxVal: 100,
      showTitle: true,
      title: '% complete by phase',
      titleFontFace: FONT,
      titleFontSize: 12,
      catAxisLabelFontFace: FONT,
      catAxisLabelFontSize: 10,
      valAxisLabelFontFace: FONT,
      valAxisLabelFontSize: 10,
      showValue: true,
      dataLabelFormatCode: '0.0',
      dataLabelFontSize: 10,
    });

  // 4 — Completed this week
  const done = titled('Completed this week');
  bullets(done, model.completed.statements.length ? model.completed.statements : ['No scope items were completed this week'], { x: 0.5, y: 1.6, w: 7.2, h: 5 });
  heading(done, 'Completed items', 8.1, 1.6, 4.7);
  bullets(done, model.completed.items, { x: 8.1, y: 1.95, w: 4.7, h: 4.6 }, 12);

  // 5 — Next week
  const next = titled('Next week');
  bullets(next, model.nextWeek.statements, { x: 0.5, y: 1.6, w: 7.2, h: 5 });
  heading(next, 'In progress and coming up', 8.1, 1.6, 4.7);
  bullets(next, model.nextWeek.items, { x: 8.1, y: 1.95, w: 4.7, h: 4.6 }, 12);

  // 6 — Risks
  const risks = titled('Risks & support needed');
  bullets(risks, model.risks, { x: 0.5, y: 1.6, w: W - 1, h: 5 });

  return (await pptx.write({ outputType: 'uint8array' })) as Uint8Array;
}
