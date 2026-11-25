/**
 * Builds deliverables/Weekly-Sales-Brief-Architecture.docx — a five-page architecture document for the Weekly Sales
 * Brief (company-wide weekly report for leadership), describing what is built on this branch.
 *
 *   pnpm exec tsx scripts/build-sales-brief-doc.ts
 *
 * Same approach as scripts/build-weekly-doc.ts: the `docx` library, diagrams as inline SVG rendered to PNG with the
 * installed Microsoft Edge (playwright-core), no network, no new dependencies. The slide thumbnails are read from
 * demo-preview/sales-brief/fresh/slide-N.png (exported with scripts/export-slides.ps1); when they are missing the
 * figure is replaced by a note. The .docx is not committed (deliverables/*.docx is ignored).
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const SLIDES = join(root, 'demo-preview', 'sales-brief', 'fresh');
const OUT_DIR = join(root, 'deliverables');
const OUT = join(OUT_DIR, 'Weekly-Sales-Brief-Architecture.docx');
const AUTHOR = 'Vivek Peeralagudem';
const TITLE = 'Weekly Sales Brief: architecture';
const BRAND = '1F4E79';
const FONT = 'Arial';
const BODY = 21; // 10.5 pt
const SMALL = 20; // 10 pt, the smallest size used anywhere
const CONTENT_DXA = 9638; // A4 (11906) minus 2 cm margins left and right
const MAX_IMG_W = 640; // px at 96 dpi, inside the margins

const git = (cmd: string) => {
  try {
    return execSync(`git ${cmd}`, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
};
const BRANCH = git('rev-parse --abbrev-ref HEAD');
const COMMIT = git('log -1 --format=%h');
const TODAY = new Date().toISOString().slice(0, 10);

// ───────────────────────── diagram (inline SVG → PNG with Edge) ─────────────────────────
const NAVY = '#1F4E79';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
type Tone = 'brand' | 'light' | 'white' | 'amber' | 'green' | 'grey';
const TONES: Record<Tone, { fill: string; stroke: string; text: string }> = {
  brand: { fill: NAVY, stroke: NAVY, text: '#FFFFFF' },
  light: { fill: '#E8F0F8', stroke: '#9DB7D5', text: '#1B1F22' },
  white: { fill: '#FFFFFF', stroke: '#9AA3AD', text: '#1B1F22' },
  amber: { fill: '#FDF1DC', stroke: '#D9A441', text: '#1B1F22' },
  green: { fill: '#E3F3E8', stroke: '#6BAF85', text: '#1B1F22' },
  grey: { fill: '#F4F5F7', stroke: '#C5CBD3', text: '#1B1F22' },
};
function box(x: number, y: number, w: number, h: number, lines: string[], tone: Tone = 'white', size = 16): string {
  const t = TONES[tone];
  const lh = size + 5;
  const top = y + h / 2 - ((lines.length - 1) * lh) / 2;
  const text = lines
    .map(
      (line, i) =>
        `<text x="${x + w / 2}" y="${top + i * lh}" font-size="${i === 0 ? size : size - 2}" font-weight="${i === 0 ? 700 : 400}" fill="${t.text}" text-anchor="middle" dominant-baseline="middle">${esc(line)}</text>`,
    )
    .join('');
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${t.fill}" stroke="${t.stroke}" stroke-width="1.5"/>${text}`;
}
const arrow = (x1: number, y1: number, x2: number, y2: number, dashed = false) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#3C4650" stroke-width="1.8" ${dashed ? 'stroke-dasharray="6 5"' : ''} marker-end="url(#a)"/>`;
const label = (x: number, y: number, text: string, size = 14, weight = 700, fill = NAVY, anchor = 'start') =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(text)}</text>`;
const frame = (x: number, y: number, w: number, h: number, title: string) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="#FAFBFC" stroke="#C5CBD3" stroke-width="1.5" stroke-dasharray="4 4"/>${label(x + 14, y + 24, title, 15)}`;
const svg = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Arial, Helvetica, sans-serif"><defs><marker id="a" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 z" fill="#3C4650"/></marker></defs><rect width="${w}" height="${h}" fill="#FFFFFF"/>${body}</svg>`;

/** One figure: CRM data + Reports module → the agents → admin review → the outputs. */
const ARCHITECTURE = svg(
  1000,
  560,
  [
    // inputs
    frame(15, 40, 200, 420, 'Inputs (existing)'),
    box(30, 80, 170, 70, ['CRM data', 'leads, deals, proposals'], 'light', 15),
    box(30, 165, 170, 70, ['Activities', 'calls, meetings, tasks'], 'light', 15),
    box(30, 250, 170, 86, ['Reports module', 'same figures as the', 'Reports page'], 'light', 15),
    box(30, 352, 170, 90, ['Settings', 'weekday, time,', 'run-as admin'], 'grey', 15),
    // agents
    frame(240, 40, 520, 420, 'Agents (server, one run = one week)'),
    box(255, 75, 490, 46, ['Orchestrator · schedule or "Generate now", steps in order'], 'brand', 15),
    box(255, 137, 155, 58, ['Collector', 'as admin, 4 windows'], 'white', 15),
    box(422, 137, 155, 58, ['Metrics', 'S-01 … S-17'], 'white', 15),
    box(589, 137, 156, 58, ['Signals', 'analysis rules'], 'white', 15),
    box(255, 212, 322, 58, ['Insights & Narrative (AI)', 'headline, insights, actions, sources'], 'amber', 15),
    box(589, 212, 156, 58, ['Checks', 'retry ×2, placeholders'], 'white', 15),
    box(255, 287, 240, 52, ['PPT builder', '9 slides'], 'white', 15),
    box(505, 287, 240, 52, ['Sheet builder', '9 Excel tabs'], 'white', 15),
    box(255, 356, 490, 46, ['Publisher · final write-once files, optional Google Sheet'], 'white', 15),
    label(500, 432, 'Snapshot, draft and final files are write-once with a SHA-256 fingerprint.', 13, 400, '#3C4650', 'middle'),
    arrow(410, 166, 420, 166),
    arrow(577, 166, 587, 166),
    arrow(667, 195, 600, 210),
    arrow(577, 241, 587, 241),
    arrow(667, 270, 625, 285),
    // review and outputs
    frame(785, 40, 200, 420, 'Review and outputs'),
    box(800, 80, 170, 92, ['Admin review', 'edit, regenerate,', 'approve'], 'light', 15),
    box(800, 205, 170, 62, ['PowerPoint', '.pptx, final'], 'green', 15),
    box(800, 282, 170, 62, ['Excel', '.xlsx, final'], 'green', 15),
    box(800, 359, 170, 72, ['Google Sheets', 'optional, off', 'by default'], 'grey', 15),
    arrow(200, 200, 253, 166),
    arrow(200, 293, 253, 170),
    arrow(200, 115, 253, 160),
    arrow(200, 397, 253, 100, true),
    arrow(745, 313, 798, 140),
    arrow(885, 172, 885, 203),
    arrow(885, 267, 885, 280),
    arrow(885, 344, 885, 357, true),
    label(500, 495, 'Every number comes from code. Only the amber agent uses AI; it explains the signals and never changes a figure.', 14, 400, '#3C4650', 'middle'),
    label(500, 520, 'Nothing is final, downloadable as final or written to Google without an admin’s approval. Nothing is emailed.', 14, 400, '#3C4650', 'middle'),
  ].join(''),
);

async function renderImages(): Promise<{ architecture: Buffer; thumbs: Buffer | null }> {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 2 });
    await page.setContent(`<html><body style="margin:0;background:#fff">${ARCHITECTURE}</body></html>`);
    const architecture = await page.locator('svg').screenshot({ type: 'png' });
    const files = Array.from({ length: 9 }, (_, i) => join(SLIDES, `slide-${i + 1}.png`));
    let thumbs: Buffer | null = null;
    if (files.every((f) => existsSync(f))) {
      const cells = files
        .map(
          (f, i) =>
            `<figure style="margin:0"><img src="data:image/png;base64,${readFileSync(f).toString('base64')}" style="display:block;width:100%;border:1px solid #C5CBD3"><figcaption style="font:600 13px Arial;color:#1F4E79;margin-top:4px">${i + 1}</figcaption></figure>`,
        )
        .join('');
      await page.setViewportSize({ width: 1000, height: 800 });
      await page.setContent(
        `<html><body style="margin:0;background:#fff"><div id="g" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px 14px;width:1000px;padding:4px;box-sizing:border-box">${cells}</div></body></html>`,
      );
      thumbs = await page.locator('#g').screenshot({ type: 'png' });
    }
    return { architecture, thumbs };
  } finally {
    await browser.close();
  }
}

// ───────────────────────── docx helpers ─────────────────────────
type Block = Paragraph | Table;
let figureNo = 0;
let tableNo = 0;
const run = (text: string, o: { bold?: boolean; italics?: boolean; size?: number; color?: string } = {}) => new TextRun({ text, font: FONT, size: BODY, ...o });
/** Rich text: `**bold**`. */
const rich = (text: string, size = BODY) => text.split('**').map((part, i) => run(part, { bold: i % 2 === 1, size }));
const p = (text: string, o: { after?: number; size?: number; italics?: boolean } = {}) =>
  new Paragraph({
    spacing: { after: o.after ?? 100, line: 264 },
    children: o.italics ? [run(text, { italics: true, size: o.size ?? BODY })] : rich(text, o.size),
  });
const bullets = (items: string[], after = 40) =>
  items.map((text) => new Paragraph({ bullet: { level: 0 }, spacing: { after, line: 252 }, children: rich(text) }));
const h1 = (n: string, title: string, first = false) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: !first,
    spacing: { before: first ? 0 : 0, after: 120 },
    children: [run(`${n}  ${title}`, { bold: true, color: BRAND, size: 30 })],
  });
const h2 = (title: string) =>
  new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 140, after: 60 }, keepNext: true, children: [run(title, { bold: true, color: BRAND, size: 23 })] });
const caption = (text: string) =>
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 40, after: 120 }, children: [run(text, { italics: true, size: SMALL, color: '4A5560' })] });

const BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'B8C0CA' };
function table(headers: string[], rows: string[][], widths: number[], title: string): Block[] {
  const total = widths.reduce((a, b) => a + b, 0);
  const dxa = widths.map((w) => Math.round((w / total) * CONTENT_DXA));
  const cell = (text: string, i: number, head: boolean) =>
    new TableCell({
      width: { size: dxa[i] as number, type: WidthType.DXA },
      margins: { top: 30, bottom: 30, left: 80, right: 80 },
      ...(head ? { shading: { type: ShadingType.CLEAR, fill: BRAND, color: 'auto' } } : {}),
      children: [
        new Paragraph({
          spacing: { after: 0, line: 240 },
          children: text.split('**').map((part, k) => run(part, { size: SMALL, bold: head || k % 2 === 1, ...(head ? { color: 'FFFFFF' } : {}) })),
        }),
      ],
    });
  const t = new Table({
    width: { size: CONTENT_DXA, type: WidthType.DXA },
    columnWidths: dxa,
    layout: TableLayoutType.FIXED,
    borders: { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER, insideHorizontal: BORDER, insideVertical: BORDER },
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: headers.map((h, i) => cell(h, i, true)) }),
      ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, i, false)) })),
    ],
  });
  tableNo += 1;
  return [t, caption(`Table ${tableNo}. ${title}`)];
}
const pngSize = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });
function figure(png: Buffer | null, text: string, maxW = MAX_IMG_W, maxH = 420): Block[] {
  figureNo += 1;
  if (!png) return [p(`[Image not available on this machine: ${text}]`), caption(`Figure ${figureNo}. ${text}`)];
  const size = pngSize(png);
  const scale = Math.min(maxW / size.width, maxH / size.height);
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      keepNext: true,
      spacing: { before: 40, after: 0 },
      children: [new ImageRun({ type: 'png', data: png, transformation: { width: Math.round(size.width * scale), height: Math.round(size.height * scale) } })],
    }),
    caption(`Figure ${figureNo}. ${text}`),
  ];
}

// ───────────────────────── content ─────────────────────────
function build(img: { architecture: Buffer; thumbs: Buffer | null }): Block[] {
  const b: Block[] = [];
  const add = (...items: (Block | Block[])[]) => b.push(...items.flat());

  // Page 1 — purpose and outcome
  add(
    new Paragraph({ spacing: { after: 40 }, children: [run('Weekly Sales Brief', { bold: true, size: 44, color: BRAND })] }),
    new Paragraph({
      spacing: { after: 200 },
      children: [run(`Architecture · Internal Sales CRM · ${AUTHOR} · ${TODAY} · branch ${BRANCH} (${COMMIT})`, { size: SMALL, color: '4A5560' })],
    }),
    h1('1', 'Purpose and outcome', true),
    h2('The requirement'),
    p('The business asked for three things, quoted:'),
    ...bullets([
      '"The PPT and Google Sheets reports are independent of deal."',
      '"This will be for admins and CEO roles to get an understanding of overall sales and throughput."',
      '"Because it’s by agents it can also do analysis and actual insights."',
    ]),
    h2('What the brief gives the CEO and admins'),
    p('Once a week the CRM prepares one company-wide brief for the last full week (Monday to Sunday) that answers four questions without opening a single record:'),
    ...bullets([
      '**How did we do?** Leads, conversions, new opportunities, deals won and lost, revenue won and win rate, each against last week, month to date and quarter to date.',
      '**How does work flow?** The throughput funnel from new lead to won deal, the open pipeline by stage and the sales velocity.',
      '**What needs attention?** Named deals that are stalled, past their expected close date or have an unviewed proposal; pipeline concentration; reps with open deals and no logged activity.',
      '**What should we do?** Short insights, each tied to its evidence, and recommended actions.',
    ]),
    h2('Two outputs, internal only'),
    ...bullets([
      '**PowerPoint (.pptx), 9 slides**, for the leadership meeting.',
      '**Excel workbook (.xlsx), 9 tabs**, with every figure and record behind the slides. Optionally the same tabs are written to one Google Sheet (switched off by default).',
      'Both are **internal**: only admins can see, generate, edit or download a brief. Nothing is sent to clients and nothing is emailed; admins get an in-app notification.',
      '**An admin approves** every brief. Before approval the files are drafts; at approval the final files are created and can no longer change.',
    ]),
    h2('The outcome'),
    p('The full flow is built and tested: schedule and "Generate now", the agents, the brief page with evidence links, editing, approval, the final PowerPoint and Excel files and the settings. On the demo data the brief’s figures equal the Reports page for the same dates (won 2, revenue USD 37,000, open pipeline USD 236,000), checked by an end-to-end browser test.'),
    p('The per-client weekly report (one PowerPoint per client, built from the estimates sheet) remains a separate feature and is unchanged.', { italics: true }),
  );

  // Page 2 — architecture
  add(
    h1('2', 'Architecture'),
    p('The brief is built inside the existing CRM. It reads the same data and uses the same Reports module as the Reports page, and runs on the CRM’s job queue, permissions, audit log, file storage, AI layer and notifications. An "agent" is a small module with one job and a defined input and output; the Orchestrator runs them in order. No agent framework is used.'),
    figure(img.architecture, 'From CRM data to the approved PowerPoint and Excel', MAX_IMG_W, 360),
    table(
      ['Agent', 'Job', 'Code file', 'Code or AI'],
      [
        ['Orchestrator', 'Starts a run on the weekly schedule or on "Generate now" (a new version); runs the steps in order; marks stuck runs as failed.', 'sales-brief.ts, workflow.ts', 'Code'],
        ['Collector', 'Reads the Reports module as the run-as admin for four windows (week, last week, month to date, quarter to date) plus open pipeline, deals needing attention and reps. Stores a write-once snapshot.', 'sales-brief/collect.ts', 'Code'],
        ['Metrics', 'Calculates S-01 to S-17, the funnel and the baselines with decimal arithmetic.', 'sales-brief/metrics.ts', 'Code'],
        ['Signals', 'The analysis: decides what is notable (trend, bottleneck, concentration, risk, team, opportunity) and names the evidence.', 'sales-brief/signals.ts', 'Code'],
        ['Insights & Narrative', 'Turns the signals and a facts pack into a headline, insights, actions and section text; every sentence cites its sources.', 'sales-brief/facts.ts, narrative.ts', 'AI (simulator)'],
        ['Checks', 'Verifies every sentence; on failure asks for a rewrite at most twice, then uses placeholders.', 'sales-brief/checks.ts', 'Code'],
        ['PPT builder', 'Builds the 9-slide deck (draft, then final) on the default template.', 'sales-brief/deck.ts', 'Code'],
        ['Sheet builder', 'Builds the 9-tab Excel workbook (draft, then final).', 'sales-brief/sheet.ts', 'Code'],
        ['Publisher', 'Approval guards, final write-once files, downloads; optionally writes the approved brief to one Google Sheet.', 'sales-brief.ts', 'Code'],
      ],
      [15, 50, 22, 13],
      'The agents (code files under apps/server/src/modules/)',
    ),
  );

  // Page 3 — numbers, analysis, insights
  const M: [string, string, string][] = [
    ['S-01', 'New leads', 'leads created in the week'],
    ['S-02', 'Leads qualified', 'leads qualified in the week'],
    ['S-03', 'Leads converted', 'leads converted in the week'],
    ['S-04', 'Lead conversion rate', 'converted ÷ (converted + disqualified)'],
    ['S-05', 'New opportunities', 'opportunities created'],
    ['S-06', 'Opportunities advanced', 'moved forward a stage'],
    ['S-07', 'Deals won', 'deals closed won'],
    ['S-08', 'Revenue won', 'sum of won amounts, org currency'],
    ['S-09', 'Deals lost', 'closed lost, top reasons'],
    ['S-10', 'Win rate', 'won ÷ closed, by count'],
    ['S-11', 'Open pipeline', 'open amounts; weighted by stage'],
    ['S-12', 'Average sales cycle', 'days, won deals of the week'],
    ['S-13', 'Deals needing attention', 'stalled + past close + unviewed'],
    ['S-14', 'Proposals sent', 'sent; viewed and signed shown'],
    ['S-15', 'Sales activity', 'calls + meetings + tasks completed'],
    ['S-16', 'Reps with deals or activity', 'rows in the team table'],
    ['S-17', 'Sales velocity per day', 'open × avg won × win rate ÷ cycle (QTD)'],
  ];
  const half = Math.ceil(M.length / 2);
  const rows = Array.from({ length: half }, (_, i) => {
    const l = M[i] as [string, string, string];
    const r = M[i + half];
    return [`**${l[0]}** ${l[1]}`, l[2], r ? `**${r[0]}** ${r[1]}` : '', r ? r[2] : ''];
  });
  add(
    h1('3', 'Numbers, analysis, insights'),
    table(['Metric', 'Formula', 'Metric', 'Formula'], rows, [23, 27, 23, 27], 'Metrics S-01 to S-17 (week, last week, month and quarter to date where they apply)'),
    p('**Throughput funnel:** New leads → Qualified → Converted → New opportunities → Deals won, each step as a share of the step before. A step above 100 % (reps also open opportunities directly) is shown as a count only and never counts as a bottleneck. **Baseline:** the average of up to four earlier briefs, otherwise last week.'),
    h2('Signal rules (code decides what is notable)'),
    ...bullets([
      '**Trend:** a headline figure moved 20 % or more against its baseline; only the 3 largest moves are kept.',
      '**Bottleneck:** the funnel step that fell 10 points or more below its baseline, else the weakest step under 50 %.',
      '**Concentration:** one deal is over 40 % of the open pipeline, or one rep holds over 50 % of it.',
      '**Risk:** 2 or more deals stalled in one stage; deals over their stage time limit; more deals past their expected close date than before the week; proposals not viewed after the follow-up window.',
      '**Team:** a rep with open deals and no calls, meetings or completed tasks in the week.',
      '**Opportunity:** the lead source that converted best. At most 8 signals are kept, ranked by severity.',
    ], 20),
    h2('Guardrails'),
    ...bullets([
      '**Numbers from code only.** The AI gets a facts pack with ids and money already written ("USD 37,000"); it never calculates.',
      '**Every insight cites evidence:** a signal, a metric or a record; on the brief page each source opens the deal or rep.',
      '**Checks** block a sentence without a source, with an unknown source or with a number that is not in the facts, plus internal wording, banned words and length limits.',
      '**2 retries, then placeholders.** Any AI error also ends in placeholders that an admin writes; a run never fails because of AI.',
      '**Admin approval** is required; warnings must be acknowledged. **The AI runs on behalf of the run-as admin** (their permission and daily limit). **Nothing is logged:** prompts and answers are not written to logs.',
    ], 20),
  );

  // Page 4 — outputs and controls
  add(
    h1('4', 'Outputs and controls'),
    figure(img.thumbs, 'The 9 slides of the approved demo brief (16–22 Nov 2026), exported from PowerPoint', MAX_IMG_W, 300),
    ...[
      '**1 Title:** company, week, "for leadership, internal use only".',
      '**2 The week in brief:** three headline sentences, five figure tiles with the change, "as of" date.',
      '**3 Key insights & recommended actions:** up to five insights and four actions, "reviewed by" the approver.',
      '**4 Throughput:** funnel chart from new lead to won deal, step shares and two sentences.',
      '**5 Open pipeline by stage:** table, value and weighted chart (axis in thousands), "as of" date.',
      '**6 Wins & losses:** won deals with owner, amount and cycle days; loss reasons chart.',
      '**7 Team:** per rep open deals, pipeline, won, revenue, win rate and activity.',
      '**8 Attention & risks:** named deals with stage, amount and why (stalled, past close, proposal not viewed).',
      '**9 Month & quarter to date:** six figures for week, month and quarter; sales velocity, a whole amount ("USD 10,162 / day", quarter-to-date averages).',
    ].map((text) => new Paragraph({ spacing: { after: 0, line: 240 }, children: rich(text, SMALL) })),
    new Paragraph({ spacing: { after: 60 }, children: [] }),
    p('**Excel tabs:** Summary · Insights · Funnel · Pipeline by stage · Deals won · Deals lost · Team · Attention · Brief history. Money is a number with en-US grouping; headers are frozen.'),
    h2('Security'),
    ...bullets([
      '**Admin only:** permissions sales_brief.view and sales_brief.manage belong to the Admin role; any other user gets 403 on every brief route and sees no menu entry or dashboard card.',
      '**Run as an admin:** the Collector reads as the run-as admin set in Settings, so totals cover the whole company exactly like the Reports page.',
      '**Write-once files with SHA-256:** the snapshot, the drafts and the final PowerPoint and Excel are stored once and never overwritten; the fingerprint is kept on the run.',
      '**Audit log:** requested, edited, regenerate requested, approved and Google Sheet outcome are recorded with the acting user.',
    ], 20),
    h2('Schedule and "Generate now"'),
    p('Settings → Sales brief: on or off, weekday and time (default Monday 08:00 in the organization time zone) and the run-as admin. A scan every 5 minutes starts one run per week (unique key: week and version). **Generate now** creates a new version for the last full week at once. A CRM with no leads or deals gets no scheduled brief.'),
  );

  // Page 5 — status and next steps
  add(
    h1('5', 'Status and next steps'),
    h2('Test results'),
    table(
      ['Test', 'Result'],
      [
        ['pnpm verify (lint, types, all unit and integration tests, builds)', '24 test files, 320 tests passed, no lint warnings; 53 of them are for the sales brief (40 unit, 13 integration)'],
        ['e2e/sales-brief-preview.spec.ts (browser, Edge)', 'Passed. On fresh demo data the figures equal the Reports page: won 2, revenue 37000.00, pipeline 236000.00. Evidence opens the deal; PowerPoint and Excel downloaded; settings saved, reloaded and restored'],
        ['e2e/weekly-reports and weekly-workflow-preview (per-client report)', '1 and 2 passed: the separate per-client feature still works'],
        ['Visual check', 'All 9 slides exported with PowerPoint and checked: no overlap or wrapping, labels present, numbers equal the brief page'],
      ],
      [42, 58],
      'Test results on this branch',
    ),
    h2('Demo in 2 minutes'),
    ...bullets([
      'Run pnpm db:seed:avengers (demo data with two weeks of sales activity and an approved brief), start the app and sign in as Tony Stark (admin).',
      'Dashboard → Weekly sales brief card → open the brief: headline, figures, insights with evidence; click an evidence chip to open the deal.',
      'Edit one sentence and save; approve; download the PowerPoint and the Excel file.',
      'Settings → Sales brief: change the weekday or click Generate now. Sign in as Spider-Man: no brief menu, 403 on the address.',
    ], 20),
    h2('What is mocked'),
    ...bullets([
      '**AI:** the built-in simulator writes the text (AI_PROVIDER=fake). No real model has been called, so insight quality, cost and speed are not yet known.',
      '**Google Sheets:** the publisher is built and tested with a fake connection only; Google is never called (SALES_BRIEF_SHEETS=file).',
      '**Template:** the "Default (mock)" slide template with the Kensium logo, not the real company template.',
    ], 20),
    h2('Next steps, in order'),
    ...bullets([
      '**1. Real AI model test on the demo data** to judge insight quality against the same checks.',
      '**2. Google service account** for writing the approved brief to one Google Sheet.',
      '**3. Real company template** for the slides (added as a second template key).',
      '**4. Production hosting** of the CRM, with backups and the scheduler running.',
    ], 20),
  );
  return b;
}

// ───────────────────────── build ─────────────────────────
const images = await renderImages();
const footerRun = (text: string) => run(text, { size: SMALL, color: '5F6368' });
const doc = new Document({
  creator: AUTHOR,
  lastModifiedBy: AUTHOR,
  title: TITLE,
  description: 'Architecture of the Weekly Sales Brief: agents, numbers, analysis, outputs, controls and status',
  styles: {
    default: { document: { run: { font: FONT, size: BODY } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 30, bold: true, color: BRAND } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 23, bold: true, color: BRAND } },
    ],
  },
  sections: [
    {
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1020, bottom: 1020, left: 1134, right: 1134, footer: 500 } } },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                footerRun(`${TITLE} · ${AUTHOR} · Page `),
                new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: SMALL, color: '5F6368' }),
                footerRun(' of '),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: SMALL, color: '5F6368' }),
              ],
            }),
          ],
        }),
      },
      children: build(images),
    },
  ],
});
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, await Packer.toBuffer(doc));
console.log(`Wrote ${OUT}`);
console.log(`Figures: ${figureNo}, tables: ${tableNo}${images.thumbs ? '' : ' — slide images missing in demo-preview/sales-brief/fresh/'}`);
