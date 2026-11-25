/**
 * PPT builder of the Weekly Sales Brief. `buildBriefDeck` (pure) decides every word and number on the slides;
 * `renderBriefPptx` only lays them out on the shared template masters (startDeck in weekly-reports/deck.ts:
 * brand colour, header bar, Kensium logo, footer, slide number, Arial). Nine slides. Slides never contain record
 * ids or internal codes. A draft carries "DRAFT – not approved" on every slide; the final deck is rendered again
 * at approval and names the approver on the analysis slide.
 */
import type { SalesBriefNarrative, SalesMetric, SalesMetricsDoc } from '../../db/schema-sales-brief.ts';
import { type Box, DRAFT_LABEL, SLIDE_WIDTH, startDeck } from '../weekly-reports/deck.ts';
import { periodLabel } from '../weekly-reports/period.ts';
import { asOfLabel, formatAmount, formatMetric, formatMoney, VELOCITY_NOTE } from './format.ts';
import { metricOf } from './metrics.ts';

export { PPTX_CONTENT_TYPE } from '../weekly-reports/deck.ts';
export { formatAmount, formatMetric } from './format.ts';

const W = SLIDE_WIDTH;
const cut = (text: string, max: number) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};
/** Week-over-week change in words; empty when there is nothing to compare with. */
export function formatChange(m: Pick<SalesMetric, 'changePct' | 'lastWeek' | 'value'> | undefined): string {
  if (!m || m.value === null || m.lastWeek === null) return '';
  if (m.changePct === null) return Number(m.value) === Number(m.lastWeek) ? '● no change vs last week' : '▲ up from 0 last week';
  const n = Number(m.changePct);
  if (n === 0) return '● no change vs last week';
  return `${n > 0 ? '▲' : '▼'} ${m.changePct.replace('-', '')}% vs last week`;
}
/** `<Org>_Sales_Brief_<YYYY-MM-DD>_v<attempt>[_DRAFT].<ext>`, safe on any file system. */
export function briefFileName(orgName: string, periodEnd: string, attempt: number, draft: boolean, ext: 'pptx' | 'xlsx'): string {
  const org =
    orgName
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'Company';
  return `${org}_Sales_Brief_${periodEnd}_v${attempt}${draft ? '_DRAFT' : ''}.${ext}`;
}

/** A funnel step as a share of the step before. Above 100 % it is not a share (reps also open opportunities directly), so nothing is shown. */
export const shareOfStepBefore = (stepPct: string | null) => (stepPct === null || Number(stepPct) > 100 ? '' : `${stepPct}% of the step before`);
const REASON: Record<string, string> = { stalled: 'Stalled', overdue: 'Past close date', unviewed_proposal: 'Proposal not viewed' };
export interface BriefDeckModel {
  draft: boolean;
  fileName: string;
  brandColor: string;
  footerText: string;
  orgName: string;
  periodLabel: string;
  currency: string;
  headline: string[];
  kpis: { label: string; value: string; change: string }[];
  analysisLabel: string;
  insights: string[];
  actions: string[];
  funnel: { label: string; value: number; step: string }[];
  throughput: string[];
  asOfLabel: string;
  velocity: string;
  stages: { stage: string; deals: string; value: string; weighted: string; valueNumber: number; weightedNumber: number }[];
  pipeline: string[];
  won: string[][];
  wins: string[];
  lostReasons: { reason: string; count: number }[];
  lost: string[];
  reps: string[][];
  team: string[];
  attention: string[][];
  moreAttention: number;
  risks: string[];
  toDate: string[][];
}

export function buildBriefDeck(input: {
  draft: boolean;
  attempt: number;
  periodStart: string;
  periodEnd: string;
  orgName: string;
  branding: { primaryColor: string; footerText: string };
  metrics: SalesMetricsDoc;
  narrative: SalesBriefNarrative;
  approverName: string | null;
  /** When the data was read (pipeline and attention are "as of" this); defaults to the metrics document's own. */
  asOf?: string;
}): BriefDeckModel {
  const { metrics: doc, narrative } = input;
  const c = doc.currency;
  const m = (id: string) => metricOf(doc, id);
  const texts = (list: { text: string }[], max: number) => list.slice(0, max).map((s) => cut(s.text, 320));
  const tile = (id: string, label: string) => ({ label, value: formatMetric(m(id), c), change: formatChange(m(id)) });
  const byAi = Object.values(narrative).some((list) => list.some((s) => s.origin === 'ai'));
  const toDateRow = (id: string) => {
    const x = m(id);
    const unit = x?.unit ?? 'count';
    return [x?.label ?? id, formatMetric(x, c), formatMetric({ unit, value: x?.mtd ?? null }, c), formatMetric({ unit, value: x?.qtd ?? null }, c)];
  };
  return {
    draft: input.draft,
    fileName: briefFileName(input.orgName, input.periodEnd, input.attempt, input.draft, 'pptx'),
    brandColor: /^#[0-9a-fA-F]{6}$/.test(input.branding.primaryColor) ? input.branding.primaryColor.slice(1).toUpperCase() : '1F4E79',
    footerText: cut(`${input.branding.footerText || input.orgName} · Internal`, 120),
    orgName: cut(input.orgName, 80),
    periodLabel: periodLabel(input.periodStart, input.periodEnd),
    currency: c,
    headline: texts(narrative.headline, 3),
    kpis: [
      tile('S-01', 'New leads'),
      tile('S-05', 'New opportunities'),
      tile('S-08', 'Revenue won'),
      tile('S-10', 'Win rate'),
      { label: 'Open pipeline', value: formatMetric(m('S-11'), c), change: `weighted ${formatMoney(doc.pipelineTotals.weighted, c)}` },
    ],
    asOfLabel: asOfLabel(input.asOf ?? doc.asOf ?? new Date(0).toISOString(), doc.timeZone ?? 'UTC'),
    velocity: `Sales velocity per day: ${formatMetric(m('S-17'), c)} (${VELOCITY_NOTE.toLowerCase().replace('sales velocity ', '')})`,
    analysisLabel: input.draft
      ? `${byAi ? 'AI analysis' : 'Analysis'} — draft, not yet reviewed`
      : `${byAi ? 'AI analysis' : 'Analysis'} — reviewed by ${cut(input.approverName ?? 'an administrator', 60)}`,
    insights: texts(narrative.insights, 5),
    actions: texts(narrative.actions, 4),
    funnel: doc.funnel.map((f) => ({ label: f.label, value: f.value, step: shareOfStepBefore(f.stepPct) })),
    throughput: texts(narrative.throughput, 3),
    stages: doc.pipelineByStage.map((p) => ({
      stage: cut(p.stage, 30),
      deals: String(p.count),
      value: formatAmount(p.value),
      weighted: formatAmount(p.weighted),
      valueNumber: Number(p.value),
      weightedNumber: Number(p.weighted),
    })),
    pipeline: texts(narrative.pipeline, 3),
    won: doc.wonDeals.slice(0, 6).map((d) => [cut(d.name, 44), cut(d.owner, 24), formatAmount(d.amount), d.cycleDays === null ? '–' : String(d.cycleDays)]),
    wins: texts(narrative.wins, 3),
    lostReasons: doc.lostReasons.slice(0, 6).map((r) => ({ reason: cut(r.reason, 28), count: r.count })),
    lost: doc.lostDeals.slice(0, 4).map((d) => `${cut(d.name, 44)} (${cut(d.owner, 24)}): ${cut(d.reason, 40)}`),
    reps: doc.reps
      .slice(0, 10)
      .map((r) => [
        cut(r.name, 26),
        String(r.openDeals),
        formatAmount(r.openValue),
        String(r.won),
        formatAmount(r.wonRevenue),
        r.winRate === null ? '–' : `${r.winRate}%`,
        `${r.calls} / ${r.meetings} / ${r.tasksCompleted}`,
      ]),
    team: texts(narrative.team, 3),
    attention: doc.attention
      .slice(0, 8)
      .map((a) => [
        cut(a.name, 40),
        cut(a.owner, 22),
        cut(a.stage, 18),
        formatAmount(a.amount),
        a.reasons.map((r) => REASON[r] ?? r).join(', '),
        String(a.daysSinceActivity),
      ]),
    moreAttention: Math.max(0, doc.attention.length - 8),
    risks: texts(narrative.risks, 4),
    toDate: ['S-01', 'S-03', 'S-05', 'S-07', 'S-08', 'S-10'].map(toDateRow),
  };
}

// ───────────── rendering (layout only) ─────────────
export async function renderBriefPptx(model: BriefDeckModel, templateKey?: string | null): Promise<Uint8Array> {
  const { pptx, template: t } = startDeck(templateKey, {
    brandColor: model.brandColor,
    footerText: model.footerText,
    orgName: model.orgName,
    title: `${model.orgName} — Weekly sales brief ${model.periodLabel}`,
  });
  const FONT = t.font;
  type Slide = ReturnType<typeof pptx.addSlide>;
  const draftLabel = (slide: Slide, dark = false) => {
    if (model.draft)
      slide.addText(DRAFT_LABEL, { ...t.draftLabel, fontFace: FONT, fontSize: 11, bold: true, align: 'right', color: dark ? 'FFFFFF' : 'B45309' });
  };
  const titled = (title: string): Slide => {
    const slide = pptx.addSlide({ masterName: t.masters.content });
    slide.addText(title, { placeholder: 'title' });
    slide.addText(`Weekly sales brief · ${model.periodLabel}`, { ...t.subtitle, fontFace: FONT, fontSize: 12, color: t.muted });
    draftLabel(slide);
    return slide;
  };
  const bullets = (slide: Slide, lines: string[], box: Box, fontSize = 14, empty = '') => {
    const list = lines.length ? lines : empty ? [empty] : [];
    if (!list.length) return;
    slide.addText(
      list.map((text) => ({ text, options: { bullet: true, breakLine: true } })),
      { ...box, fontFace: FONT, fontSize, color: lines.length ? t.ink : t.muted, valign: 'top', paraSpaceAfter: 7 },
    );
  };
  const heading = (slide: Slide, text: string, x: number, y: number, w: number) =>
    slide.addText(text, { x, y, w, h: 0.3, fontFace: FONT, fontSize: 12, bold: true, color: model.brandColor });
  const head = (text: string, align: 'left' | 'right' = 'left') => ({
    text,
    options: { bold: true, color: 'FFFFFF', fill: { color: model.brandColor }, fontFace: FONT, fontSize: 10.5, align },
  });
  const cell = (text: string, align: 'left' | 'right' = 'left') => ({ text, options: { color: t.ink, fontFace: FONT, fontSize: 10.5, align } });
  const table = (slide: Slide, headers: [string, 'left' | 'right'][], rows: string[][], box: { x: number; y: number; w: number }, colW: number[]) => {
    slide.addTable([headers.map(([h, a]) => head(h, a)), ...rows.map((r) => r.map((v, i) => cell(v, headers[i]?.[1] ?? 'left')))], {
      ...box,
      colW,
      border: { type: 'solid', color: 'E4E7EB', pt: 1 },
      rowH: 0.34,
    });
  };
  const note = (slide: Slide, text: string, box: Box) => slide.addText(text, { ...box, fontFace: FONT, fontSize: 13, color: t.muted, valign: 'top' });
  const chartText = { catAxisLabelFontFace: FONT, catAxisLabelFontSize: 10, valAxisLabelFontFace: FONT, valAxisLabelFontSize: 10, dataLabelFontSize: 10 };

  // 1 — Title
  const cover = pptx.addSlide({ masterName: t.masters.title });
  cover.addText('Weekly sales brief', { ...t.cover.client, fontFace: FONT, fontSize: 44, bold: true, color: 'FFFFFF' });
  cover.addText(model.orgName, { ...t.cover.heading, fontFace: FONT, fontSize: 26, color: 'FFFFFF' });
  cover.addText(model.periodLabel, { ...t.cover.period, fontFace: FONT, fontSize: 18, color: 'FFFFFF' });
  cover.addText('For leadership · internal use only', { ...t.cover.org, fontFace: FONT, fontSize: 16, bold: true, color: 'FFFFFF' });
  draftLabel(cover, true);

  // 2 — Headline and five key figures
  const first = titled('The week in brief');
  bullets(first, model.headline, { x: 0.5, y: 1.5, w: W - 1, h: 2.6 }, 16, 'No headline text yet.');
  const gap = 0.25;
  const tileW = (W - 1 - gap * (model.kpis.length - 1)) / model.kpis.length;
  model.kpis.forEach((k, i) => {
    const x = 0.5 + i * (tileW + gap);
    first.addShape(pptx.ShapeType.roundRect, { x, y: 4.45, w: tileW, h: 2.0, rectRadius: 0.08, fill: { color: 'F4F5F7' }, line: { color: 'E4E7EB' } });
    first.addText(k.label, { x: x + 0.18, y: 4.55, w: tileW - 0.36, h: 0.35, fontFace: FONT, fontSize: 11, color: t.muted });
    first.addText(k.value, { x: x + 0.18, y: 4.9, w: tileW - 0.36, h: 0.85, fontFace: FONT, fontSize: k.value.length > 9 ? 18 : 24, bold: true, color: t.ink });
    if (k.change) first.addText(k.change, { x: x + 0.18, y: 5.8, w: tileW - 0.36, h: 0.5, fontFace: FONT, fontSize: 10.5, color: t.muted, valign: 'top' });
  });

  first.addText(model.asOfLabel, { x: 0.5, y: 6.55, w: W - 1, h: 0.3, fontFace: FONT, fontSize: 10.5, italic: true, color: t.muted });

  // 3 — Key insights and recommended actions (the analysis slide)
  const analysis = titled('Key insights & recommended actions');
  heading(analysis, 'What the numbers show', 0.5, 1.45, 7.0);
  bullets(analysis, model.insights, { x: 0.5, y: 1.8, w: 7.0, h: 4.6 }, 13, 'No insights were written for this week.');
  heading(analysis, 'Recommended actions', 7.9, 1.45, 4.9);
  bullets(analysis, model.actions, { x: 7.9, y: 1.8, w: 4.9, h: 4.6 }, 13, 'No actions were written for this week.');
  analysis.addText(model.analysisLabel, { x: 0.5, y: 6.5, w: W - 1, h: 0.3, fontFace: FONT, fontSize: 10.5, italic: true, color: t.muted });

  // 4 — Throughput funnel
  const funnel = titled('Throughput: from lead to won deal');
  const funnelRows = [...model.funnel].reverse(); // a horizontal bar chart draws its first category at the bottom
  funnel.addChart(pptx.ChartType.bar, [{ name: 'This week', labels: funnelRows.map((f) => f.label), values: funnelRows.map((f) => f.value) }], {
    x: 0.5,
    y: 1.5,
    w: 7.4,
    h: 4.9,
    barDir: 'bar',
    chartColors: [model.brandColor],
    valAxisMinVal: 0,
    showValue: true,
    dataLabelFormatCode: '0',
    showLegend: false,
    ...chartText,
  });
  heading(funnel, 'Step by step', 8.3, 1.5, 4.5);
  bullets(
    funnel,
    model.funnel.map((f) => `${f.label}: ${f.value}${f.step ? ` (${f.step})` : ''}`),
    { x: 8.3, y: 1.85, w: 4.5, h: 2.3 },
    12,
  );
  bullets(funnel, model.throughput, { x: 8.3, y: 4.2, w: 4.5, h: 2.3 }, 12);

  // 5 — Pipeline by stage
  const pipeline = titled('Open pipeline by stage');
  note(pipeline, model.asOfLabel, { x: 0.5, y: 6.5, w: W - 1, h: 0.3 });
  table(
    pipeline,
    [
      ['Stage', 'left'],
      ['Deals', 'right'],
      [`Value (${model.currency})`, 'right'],
      [`Weighted (${model.currency})`, 'right'],
    ],
    model.stages.map((s) => [s.stage, s.deals, s.value, s.weighted]),
    { x: 0.5, y: 1.5, w: 6.3 },
    [2.3, 0.8, 1.6, 1.6],
  );
  if (model.stages.some((s) => s.valueNumber > 0))
    pipeline.addChart(
      pptx.ChartType.bar,
      [
        { name: 'Value', labels: model.stages.map((s) => s.stage), values: model.stages.map((s) => s.valueNumber) },
        { name: 'Weighted', labels: model.stages.map((s) => s.stage), values: model.stages.map((s) => s.weightedNumber) },
      ],
      {
        x: 7.1,
        y: 1.4,
        w: 5.8,
        h: 3.6,
        barDir: 'col',
        chartColors: [model.brandColor, '9DB7D5'],
        showLegend: true,
        legendPos: 'b',
        legendFontFace: FONT,
        legendFontSize: 10,
        // Axis in thousands ("140k"): no thousands separator at all, so PowerPoint's regional grouping (1,40,000) never applies.
        valAxisLabelFormatCode: '0,"k"',
        ...chartText,
      },
    );
  bullets(pipeline, model.pipeline, { x: 7.1, y: 5.1, w: 5.7, h: 1.4 }, 12);

  // 6 — Wins and losses
  const wins = titled('Wins & losses');
  heading(wins, 'Deals won this week', 0.5, 1.45, 7.4);
  if (model.won.length)
    table(
      wins,
      [
        ['Deal', 'left'],
        ['Owner', 'left'],
        [`Amount (${model.currency})`, 'right'],
        ['Cycle days', 'right'],
      ],
      model.won,
      { x: 0.5, y: 1.8, w: 7.4 },
      [3.4, 1.8, 1.3, 0.9],
    );
  else note(wins, 'No deals were won this week.', { x: 0.5, y: 1.8, w: 7.4, h: 0.4 });
  bullets(wins, model.wins, { x: 0.5, y: 4.6, w: 7.4, h: 1.9 }, 12);
  heading(wins, 'Why deals were lost', 8.3, 1.45, 4.5);
  if (model.lostReasons.length) {
    const lostRows = [...model.lostReasons].reverse();
    wins.addChart(pptx.ChartType.bar, [{ name: 'Deals lost', labels: lostRows.map((r) => r.reason), values: lostRows.map((r) => r.count) }], {
      x: 8.3,
      y: 1.8,
      w: 4.5,
      h: 2.6,
      barDir: 'bar',
      chartColors: ['B45309'],
      valAxisMinVal: 0,
      valAxisMajorUnit: 1,
      showValue: true,
      dataLabelFormatCode: '0',
      showLegend: false,
      ...chartText,
    });
    bullets(wins, model.lost, { x: 8.3, y: 4.6, w: 4.5, h: 1.9 }, 11);
  } else note(wins, 'No deals were lost this week.', { x: 8.3, y: 1.8, w: 4.5, h: 0.4 });

  // 7 — Team
  const team = titled('Team');
  if (model.reps.length)
    table(
      team,
      [
        ['Rep', 'left'],
        ['Open deals', 'right'],
        [`Pipeline (${model.currency})`, 'right'],
        ['Won', 'right'],
        [`Revenue won (${model.currency})`, 'right'],
        ['Win rate', 'right'],
        ['Calls / meetings / tasks', 'right'],
      ],
      model.reps,
      { x: 0.5, y: 1.5, w: W - 1 },
      [2.6, 1.2, 1.9, 0.9, 2.2, 1.2, 2.33],
    );
  else note(team, 'No rep had open deals, closed deals or logged activity this week.', { x: 0.5, y: 1.5, w: W - 1, h: 0.4 });
  bullets(team, model.team, { x: 0.5, y: Math.min(5.6, 2.0 + model.reps.length * 0.36), w: W - 1, h: 1.6 }, 12);

  // 8 — Attention and risks
  const risks = titled('Attention & risks');
  note(risks, model.asOfLabel, { x: 0.5, y: 6.5, w: W - 1, h: 0.3 });
  if (model.attention.length)
    table(
      risks,
      [
        ['Deal', 'left'],
        ['Owner', 'left'],
        ['Stage', 'left'],
        [`Amount (${model.currency})`, 'right'],
        ['Why', 'left'],
        ['Days without activity', 'right'],
      ],
      model.attention,
      { x: 0.5, y: 1.5, w: W - 1 },
      [3.3, 1.9, 1.6, 1.5, 2.43, 1.6],
    );
  else note(risks, 'No open deal is stalled, past its close date or waiting on an unviewed proposal.', { x: 0.5, y: 1.5, w: W - 1, h: 0.4 });
  const below = Math.min(5.2, 2.0 + model.attention.length * 0.36);
  if (model.moreAttention) note(risks, `…and ${model.moreAttention} more in the Reports page.`, { x: 0.5, y: below, w: W - 1, h: 0.3 });
  bullets(risks, model.risks, { x: 0.5, y: below + (model.moreAttention ? 0.35 : 0), w: W - 1, h: 1.5 }, 12);

  // 9 — Month and quarter to date
  const toDate = titled('Month & quarter to date');
  table(
    toDate,
    [
      ['Figure', 'left'],
      ['This week', 'right'],
      ['Month to date', 'right'],
      ['Quarter to date', 'right'],
    ],
    model.toDate,
    { x: 0.5, y: 1.6, w: 9.0 },
    [3.3, 1.9, 1.9, 1.9],
  );
  toDate.addText(model.velocity, { x: 0.5, y: 4.2, w: 9.0, h: 0.4, fontFace: FONT, fontSize: 13, color: t.ink });
  note(toDate, `Month and quarter run to the last day of the reported week. Figures match the Reports page for the same dates. ${model.asOfLabel}.`, {
    x: 0.5,
    y: 4.8,
    w: 9.0,
    h: 0.6,
  });

  return (await pptx.write({ outputType: 'uint8array' })) as Uint8Array;
}
