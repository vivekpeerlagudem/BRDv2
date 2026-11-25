/**
 * PPT builder. `buildDeckModel` (pure) decides every word and number on the slides; `renderWeeklyPptx` only lays
 * them out with pptxgenjs. Layout comes from a named template (WEEKLY_TEMPLATES) built on two slide masters. Slides never contain source ids or internal flags — only client-facing text.
 * A draft carries "DRAFT – not approved" on every slide; the final deck is rendered again without it at approval.
 */
import PptxGenJS from 'pptxgenjs';
import type { HealthLevel, WeeklyMetricsDoc, WeeklyNarrative, WeeklyPhaseRow } from '../../db/schema-weekly-reports.ts';
import { KENSIUM_LOGO_PNG } from './deck-logo.ts';
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

// ───────────── templates and rendering (layout only) ─────────────
const W = 13.33;
type Box = { x: number; y: number; w: number; h: number };

/**
 * A template = fonts and colours, the logo, two slide masters and the fixed position of every element.
 * The brand colour and footer text come from the organization's branding at render time.
 * A real company template is added later as another key; `weekly_report_settings.templateKey` selects it.
 */
export interface WeeklyTemplate {
  label: string;
  font: string;
  ink: string;
  muted: string;
  /** PNG data for pptxgenjs ("image/png;base64,…"), or null to write the organization name as a text logo. */
  logo: string | null;
  masters: { title: 'WR_TITLE'; content: 'WR_CONTENT' };
  headerHeight: number;
  logoOnTitle: Box;
  logoOnContent: Box;
  footer: Box;
  slideNumber: { x: number; y: number };
  draftLabel: Box;
  cover: { client: Box; heading: Box; period: Box; org: Box };
  title: Box;
  subtitle: Box;
  healthBadge: Box;
  healthReason: Box;
  summary: Box;
  kpiRow: { x: number; y: number; h: number; gap: number };
  table: { x: number; y: number; w: number; colW: number[]; rowH: number };
  chart: Box;
  statements: Box;
  sideHeading: Box;
  sideList: Box;
  wide: Box;
}
export const WEEKLY_TEMPLATES = {
  default: {
    label: 'Default (mock)',
    font: 'Inter', // PowerPoint substitutes its default sans-serif (Arial) where Inter is not installed
    ink: '1B1F22',
    muted: '5F6368',
    logo: KENSIUM_LOGO_PNG,
    masters: { title: 'WR_TITLE', content: 'WR_CONTENT' },
    headerHeight: 0.9,
    logoOnTitle: { x: 0.8, y: 0.7, w: 2.84, h: 0.74 },
    logoOnContent: { x: W - 2.2, y: 0.24, w: 1.7, h: 0.44 },
    footer: { x: 0.5, y: 7.0, w: 9, h: 0.3 },
    slideNumber: { x: W - 1.0, y: 7.0 },
    draftLabel: { x: W - 3.6, y: 1.0, w: 3.1, h: 0.3 },
    cover: {
      client: { x: 0.8, y: 2.3, w: W - 1.6, h: 1.1 },
      heading: { x: 0.8, y: 3.4, w: W - 1.6, h: 0.6 },
      period: { x: 0.8, y: 4.05, w: W - 1.6, h: 0.45 },
      org: { x: 0.8, y: 5.6, w: W - 1.6, h: 0.4 },
    },
    title: { x: 0.5, y: 0.15, w: 9, h: 0.6 },
    subtitle: { x: 0.5, y: 1.0, w: 9, h: 0.3 },
    healthBadge: { x: 0.5, y: 1.5, w: 2.4, h: 0.45 },
    healthReason: { x: 3.1, y: 1.5, w: W - 3.6, h: 0.45 },
    summary: { x: 0.5, y: 2.2, w: W - 1, h: 2.3 },
    kpiRow: { x: 0.5, y: 4.7, h: 1.9, gap: 0.3 },
    table: { x: 0.5, y: 1.6, w: 6.2, colW: [2.4, 0.8, 1.0, 0.9, 1.1], rowH: 0.36 },
    chart: { x: 7.1, y: 1.5, w: 5.7, h: 4.8 },
    statements: { x: 0.5, y: 1.6, w: 7.2, h: 5 },
    sideHeading: { x: 8.1, y: 1.6, w: 4.7, h: 0.3 },
    sideList: { x: 8.1, y: 1.95, w: 4.7, h: 4.6 },
    wide: { x: 0.5, y: 1.6, w: W - 1, h: 5 },
  },
} satisfies Record<string, WeeklyTemplate>;
export type WeeklyTemplateKey = keyof typeof WEEKLY_TEMPLATES;
export const DEFAULT_TEMPLATE_KEY: WeeklyTemplateKey = 'default';
/** The stored key when it names a template, otherwise the default (settings written before templates existed). */
export const resolveTemplateKey = (key: string | null | undefined): WeeklyTemplateKey =>
  key && Object.hasOwn(WEEKLY_TEMPLATES, key) ? (key as WeeklyTemplateKey) : DEFAULT_TEMPLATE_KEY;

export async function renderWeeklyPptx(model: DeckModel, templateKey?: string | null): Promise<Uint8Array> {
  const t: WeeklyTemplate = WEEKLY_TEMPLATES[resolveTemplateKey(templateKey)];
  const FONT = t.font;
  // The package is CommonJS: depending on the loader the class is the default export or sits under `.default`.
  const Pptx = ((PptxGenJS as unknown as { default?: PptxClass }).default ?? PptxGenJS) as PptxClass;
  const pptx = new Pptx();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = `${model.clientName} — Weekly status report ${model.periodLabel}`;
  pptx.company = model.orgName;
  pptx.theme = { headFontFace: FONT, bodyFontFace: FONT };
  type Slide = ReturnType<typeof pptx.addSlide>;

  // Slide masters: everything that is the same on every slide (brand colour, header bar, logo, footer, slide number).
  const logo = (box: Box, fontSize: number) =>
    t.logo
      ? { image: { ...box, data: t.logo } }
      : { text: { text: model.orgName, options: { ...box, fontFace: FONT, fontSize, bold: true, color: 'FFFFFF', valign: 'middle' as const } } };
  const footer = (color: string) => ({ text: { text: model.footerText, options: { ...t.footer, fontFace: FONT, fontSize: 10, color } } });
  pptx.defineSlideMaster({
    title: t.masters.title,
    background: { color: model.brandColor },
    objects: [logo(t.logoOnTitle, 24), footer('FFFFFF')],
    slideNumber: { ...t.slideNumber, fontFace: FONT, fontSize: 10, color: 'FFFFFF' },
  });
  pptx.defineSlideMaster({
    title: t.masters.content,
    background: { color: 'FFFFFF' },
    objects: [
      { rect: { x: 0, y: 0, w: W, h: t.headerHeight, fill: { color: model.brandColor } } },
      logo(t.logoOnContent, 14),
      footer(t.muted),
      {
        placeholder: {
          options: { name: 'title', type: 'title', ...t.title, fontFace: FONT, fontSize: 26, bold: true, color: 'FFFFFF', align: 'left', valign: 'middle' },
          text: '',
        },
      },
    ],
    slideNumber: { ...t.slideNumber, fontFace: FONT, fontSize: 10, color: t.muted },
  });

  /** The draft label is written on the slide itself so it is in every slide file of a draft. */
  const draftLabel = (slide: Slide, dark = false) => {
    if (model.draft)
      slide.addText(DRAFT_LABEL, { ...t.draftLabel, fontFace: FONT, fontSize: 11, bold: true, align: 'right', color: dark ? 'FFFFFF' : 'B45309' });
  };
  const titled = (title: string): Slide => {
    const slide = pptx.addSlide({ masterName: t.masters.content });
    slide.addText(title, { placeholder: 'title' });
    slide.addText(`${model.clientName} · ${model.periodLabel}`, { ...t.subtitle, fontFace: FONT, fontSize: 12, color: t.muted });
    draftLabel(slide);
    return slide;
  };
  const bullets = (slide: Slide, lines: string[], box: Box, fontSize = 15) => {
    if (!lines.length) return;
    slide.addText(
      lines.map((text) => ({ text, options: { bullet: true, breakLine: true } })),
      { ...box, fontFace: FONT, fontSize, color: t.ink, valign: 'top', paraSpaceAfter: 8 },
    );
  };
  const heading = (slide: Slide, text: string) => slide.addText(text, { ...t.sideHeading, fontFace: FONT, fontSize: 12, bold: true, color: model.brandColor });

  // 1 — Title
  const cover = pptx.addSlide({ masterName: t.masters.title });
  cover.addText(model.clientName, { ...t.cover.client, fontFace: FONT, fontSize: 44, bold: true, color: 'FFFFFF' });
  cover.addText('Weekly status report', { ...t.cover.heading, fontFace: FONT, fontSize: 26, color: 'FFFFFF' });
  cover.addText(model.periodLabel, { ...t.cover.period, fontFace: FONT, fontSize: 18, color: 'FFFFFF' });
  cover.addText(model.orgName, { ...t.cover.org, fontFace: FONT, fontSize: 16, bold: true, color: 'FFFFFF' });
  draftLabel(cover, true);

  // 2 — Summary
  const summary = titled('Summary');
  const healthColor = HEALTH_COLOR[model.health.level];
  summary.addShape(pptx.ShapeType.roundRect, { ...t.healthBadge, rectRadius: 0.08, fill: { color: healthColor }, line: { color: healthColor } });
  summary.addText(model.health.label, { ...t.healthBadge, fontFace: FONT, fontSize: 14, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle' });
  summary.addText(model.health.reason, { ...t.healthReason, fontFace: FONT, fontSize: 13, color: t.muted, valign: 'middle' });
  bullets(summary, model.summary, t.summary, 16);
  const row = t.kpiRow;
  const tileW = (W - 2 * row.x - row.gap * (model.kpis.length - 1)) / model.kpis.length;
  model.kpis.forEach((k, i) => {
    const x = row.x + i * (tileW + row.gap);
    summary.addShape(pptx.ShapeType.roundRect, { x, y: row.y, w: tileW, h: row.h, rectRadius: 0.08, fill: { color: 'F4F5F7' }, line: { color: 'E4E7EB' } });
    summary.addText(k.label, { x: x + 0.2, y: row.y + 0.1, w: tileW - 0.4, h: 0.35, fontFace: FONT, fontSize: 11, color: t.muted });
    summary.addText(k.value, { x: x + 0.2, y: row.y + 0.45, w: tileW - 0.4, h: 0.8, fontFace: FONT, fontSize: 30, bold: true, color: t.ink });
    if (k.change) summary.addText(k.change, { x: x + 0.2, y: row.y + 1.3, w: tileW - 0.4, h: 0.35, fontFace: FONT, fontSize: 11, color: t.muted });
  });

  // 3 — Scope progress
  const scope = titled('Scope progress');
  const head = (text: string) => ({ text, options: { bold: true, color: 'FFFFFF', fill: { color: model.brandColor }, fontFace: FONT, fontSize: 11 } });
  const cell = (text: string, align: 'left' | 'right' = 'left') => ({ text, options: { color: t.ink, fontFace: FONT, fontSize: 11, align } });
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
    { x: t.table.x, y: t.table.y, w: t.table.w, colW: t.table.colW, border: { type: 'solid', color: 'E4E7EB', pt: 1 }, rowH: t.table.rowH },
  );
  if (model.phases.length)
    scope.addChart(pptx.ChartType.bar, [{ name: '% complete', labels: model.phases.map((p) => p.phase), values: model.phases.map((p) => Number(p.pct)) }], {
      ...t.chart,
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
  bullets(done, model.completed.statements.length ? model.completed.statements : ['No scope items were completed this week'], t.statements);
  heading(done, 'Completed items');
  bullets(done, model.completed.items, t.sideList, 12);

  // 5 — Next week
  const next = titled('Next week');
  bullets(next, model.nextWeek.statements, t.statements);
  heading(next, 'In progress and coming up');
  bullets(next, model.nextWeek.items, t.sideList, 12);

  // 6 — Risks
  const risks = titled('Risks & support needed');
  bullets(risks, model.risks, t.wide);

  return (await pptx.write({ outputType: 'uint8array' })) as Uint8Array;
}
