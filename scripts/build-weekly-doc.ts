/**
 * Builds deliverables/Weekly-Report-Agents-Architecture-and-Workflow.docx — the architecture and workflow document
 * for the Weekly Report Agents feature.
 *
 *   pnpm exec tsx scripts/build-weekly-doc.ts
 *
 * Uses only what the workspace already has: `docx` (as packages/proposal does) and `playwright-core` with the
 * installed Microsoft Edge to render the diagrams (inline SVG, no network) to PNG. Screenshots and slide images are
 * read from demo-preview/weekly/ (produced by e2e/weekly-workflow-preview.spec.ts and scripts/export-slides.ps1);
 * a missing image is replaced by a note, so the script also runs on a machine without them.
 * The .docx is not committed (deliverables/*.docx is ignored).
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  PageBreak,
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
const SHOTS = join(root, 'demo-preview', 'weekly');
const OUT_DIR = join(root, 'deliverables');
const OUT = join(OUT_DIR, 'Weekly-Report-Agents-Architecture-and-Workflow.docx');
const BRAND = '1F4E79';
const FONT = 'Arial';
const CONTENT_DXA = 9638; // A4 (11906) minus 2 cm margins left and right
const MAX_IMG_W = 630; // px at 96 dpi, inside the margins
const MAX_IMG_H = 600;

const git = (cmd: string) => {
  try {
    return execSync(`git ${cmd}`, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
};
const BRANCH = git('rev-parse --abbrev-ref HEAD');
const COMMIT = git('log -1 --format=%h');
const COMMIT_SUBJECT = git('log -1 --format=%s');
const TODAY = new Date().toISOString().slice(0, 10);

// ───────────────────────── diagrams (inline SVG → PNG with Edge) ─────────────────────────
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
function box(x: number, y: number, w: number, h: number, lines: string[], tone: Tone = 'white', size = 15): string {
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
function arrow(x1: number, y1: number, x2: number, y2: number, label = '', dashed = false, labelDy = -8): string {
  const mid = `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 + labelDy}" font-size="12.5" fill="#3C4650" text-anchor="middle">${esc(label)}</text>`;
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#3C4650" stroke-width="1.8" ${dashed ? 'stroke-dasharray="6 5"' : ''} marker-end="url(#a)"/>${label ? mid : ''}`;
}
const label = (x: number, y: number, text: string, size = 13, weight = 700, fill = NAVY, anchor = 'start') =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(text)}</text>`;
const frame = (x: number, y: number, w: number, h: number, title: string) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="#FAFBFC" stroke="#C5CBD3" stroke-width="1.5" stroke-dasharray="4 4"/>${label(x + 14, y + 24, title, 14)}`;
const svg = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Arial, Helvetica, sans-serif"><defs><marker id="a" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 z" fill="#3C4650"/></marker></defs><rect width="${w}" height="${h}" fill="#FFFFFF"/>${body}</svg>`;

const DIAGRAMS: Record<string, string> = {
  context: svg(
    1000,
    430,
    [
      box(30, 60, 190, 62, ['Salesperson', 'own clients'], 'light'),
      box(30, 150, 190, 62, ['Sales manager', "team's clients"], 'light'),
      box(30, 240, 190, 62, ['Admin', 'all clients, settings'], 'light'),
      box(370, 90, 260, 180, ['Sales CRM', 'CRM data + estimates', 'Weekly report agents', 'Review and approval'], 'brand', 17),
      box(770, 60, 200, 70, ['AI model', 'simulator (mock)'], 'amber'),
      box(770, 190, 200, 70, ['Google Sheets', 'read-only, optional'], 'grey'),
      box(370, 340, 260, 62, ['PowerPoint file (.pptx)', 'downloaded by a person'], 'green'),
      box(770, 340, 200, 62, ['Client', 'receives it from a person'], 'white'),
      arrow(220, 91, 368, 150, ''),
      arrow(220, 181, 368, 181, 'review, edit, approve'),
      arrow(220, 271, 368, 212, ''),
      arrow(630, 130, 768, 100, 'facts, no tools'),
      arrow(768, 225, 632, 225, 'estimates rows', true),
      arrow(500, 270, 500, 338, ''),
      arrow(630, 371, 768, 371, 'sent by hand', true),
      label(500, 30, 'Who and what is involved', 16, 700, NAVY, 'middle'),
    ].join(''),
  ),
  inside: svg(
    1000,
    560,
    [
      label(500, 28, 'Inside the CRM', 16, 700, NAVY, 'middle'),
      frame(20, 50, 300, 300, 'Data (existing CRM + new)'),
      box(40, 90, 125, 44, ['Companies'], 'light', 14),
      box(175, 90, 125, 44, ['Opportunities'], 'light', 14),
      box(40, 146, 125, 44, ['Tasks'], 'light', 14),
      box(175, 146, 125, 44, ['Calls, meetings'], 'light', 14),
      box(40, 214, 260, 50, ['Estimates sheet', 'import + rows (new)'], 'green', 14),
      box(40, 278, 260, 50, ['Weekly report runs (new)'], 'green', 14),
      frame(350, 50, 300, 300, 'Agent engine (server)'),
      box(370, 90, 260, 40, ['Orchestrator'], 'brand', 14),
      box(370, 140, 125, 40, ['Estimates reader'], 'white', 13),
      box(505, 140, 125, 40, ['Collector'], 'white', 13),
      box(370, 190, 125, 40, ['Matcher'], 'white', 13),
      box(505, 190, 125, 40, ['Metrics'], 'white', 13),
      box(370, 240, 125, 40, ['Narrative (AI)'], 'amber', 13),
      box(505, 240, 125, 40, ['Checks'], 'white', 13),
      box(370, 290, 125, 40, ['PPT builder'], 'white', 13),
      box(505, 290, 125, 40, ['Publisher'], 'white', 13),
      frame(680, 50, 300, 300, 'Report center (web app)'),
      box(700, 90, 260, 50, ['Company page card', 'upload, generate, latest'], 'light', 14),
      box(700, 152, 260, 50, ['Weekly reports list', 'status tabs, search'], 'light', 14),
      box(700, 214, 260, 50, ['Report page', 'figures, text, edit, approve'], 'light', 14),
      box(700, 276, 260, 50, ['Settings', 'schedule, template'], 'light', 14),
      frame(20, 380, 960, 160, 'Shared services (already in the CRM)'),
      box(40, 420, 145, 50, ['Job queue', 'job_outbox'], 'grey', 13),
      box(197, 420, 145, 50, ['Permissions', 'own / team / all'], 'grey', 13),
      box(354, 420, 145, 50, ['Audit + timeline'], 'grey', 13),
      box(511, 420, 145, 50, ['File storage', 'write-once, sha256'], 'grey', 13),
      box(668, 420, 145, 50, ['AI layer', 'limits, usage, mock'], 'grey', 13),
      box(825, 420, 135, 50, ['Notifications', 'in-app'], 'grey', 13),
      label(500, 516, 'Every agent step and every screen goes through these services; nothing bypasses permissions or the audit log.', 12.5, 400, '#3C4650', 'middle'),
      arrow(320, 200, 348, 200, ''),
      arrow(650, 200, 678, 200, ''),
    ].join(''),
  ),
  pipeline: svg(
    1000,
    330,
    [
      label(500, 28, 'Agent pipeline for one client and one week', 16, 700, NAVY, 'middle'),
      box(20, 60, 170, 66, ['1 Orchestrator', 'schedule or button'], 'brand', 14),
      box(220, 60, 170, 66, ['2 Estimates reader', 'CSV or Google'], 'white', 14),
      box(420, 60, 170, 66, ['3 Collector', 'CRM data, as owner'], 'white', 14),
      box(620, 60, 170, 66, ['4 Matcher', 'scope row ↔ task'], 'white', 14),
      box(820, 60, 160, 66, ['5 Metrics', 'figures + health'], 'white', 14),
      arrow(190, 93, 218, 93),
      arrow(390, 93, 418, 93),
      arrow(590, 93, 618, 93),
      arrow(790, 93, 818, 93),
      arrow(900, 126, 900, 198),
      box(820, 200, 160, 66, ['6 Narrative', 'AI text + sources'], 'amber', 14),
      box(620, 200, 170, 66, ['7 Checks', 'pass / retry / fallback'], 'white', 14),
      box(420, 200, 170, 66, ['8 PPT builder', 'draft deck'], 'white', 14),
      box(220, 200, 170, 66, ['Human review', 'edit, approve'], 'light', 14),
      box(20, 200, 170, 66, ['9 Publisher', 'final deck, download'], 'green', 14),
      arrow(818, 233, 792, 233),
      arrow(618, 233, 592, 233),
      arrow(418, 233, 392, 233),
      arrow(218, 233, 192, 233),
      label(500, 300, 'Steps 2 to 5 and 7 to 9 are plain code. Only step 6 uses AI, and its output never changes a number.', 12.5, 400, '#3C4650', 'middle'),
    ].join(''),
  ),
  sequence: svg(
    1000,
    640,
    [
      label(500, 28, 'Technical run sequence', 16, 700, NAVY, 'middle'),
      box(30, 55, 290, 56, ['1 Trigger', 'weekly schedule or "Generate now"'], 'brand', 14),
      box(30, 135, 290, 56, ['2 Run row + job', 'weekly_report_run, job_outbox'], 'white', 14),
      box(30, 215, 290, 56, ['3 Estimates', 'latest import (Google sync first)'], 'white', 14),
      box(30, 295, 290, 56, ['4 Collect', "owner's visible CRM records"], 'white', 14),
      box(30, 375, 290, 56, ['5 Snapshot file', 'write-once JSON + sha256'], 'grey', 14),
      box(30, 455, 290, 56, ['6 Match + metrics', 'figures, health, deltas'], 'white', 14),
      arrow(175, 111, 175, 133),
      arrow(175, 191, 175, 213),
      arrow(175, 271, 175, 293),
      arrow(175, 351, 175, 373),
      arrow(175, 431, 175, 453),
      arrow(320, 483, 378, 83),
      box(380, 55, 290, 56, ['7 AI narrative', 'facts pack → text with sources'], 'amber', 14),
      box(380, 135, 290, 56, ['8 Checks', 'fail → retry (max 2) → placeholders'], 'white', 14),
      box(380, 215, 290, 56, ['9 Draft PowerPoint', 'file stored, then the record'], 'grey', 14),
      box(380, 295, 290, 56, ['10 Status', 'ready or needs attention'], 'light', 14),
      box(380, 375, 290, 56, ['11 Notification', 'owner, scheduled runs only'], 'white', 14),
      arrow(525, 111, 525, 133),
      arrow(525, 191, 525, 213),
      arrow(525, 271, 525, 293),
      arrow(525, 351, 525, 373),
      arrow(670, 323, 708, 323),
      box(710, 215, 270, 56, ['Human: edit text', 'checks + draft redone'], 'light', 14),
      box(710, 295, 270, 56, ['Human: approve', 'guards: flags, warnings, version'], 'light', 14),
      box(710, 375, 270, 56, ['12 Final PowerPoint', 'write-once + sha256'], 'green', 14),
      box(710, 455, 270, 56, ['Download', 'a person sends it'], 'green', 14),
      arrow(845, 271, 845, 293),
      arrow(845, 351, 845, 373),
      arrow(845, 431, 845, 453),
      label(500, 560, 'Files are written before the database transaction that records them, so a failed transaction never leaves a', 12.5, 400, '#3C4650', 'middle'),
      label(500, 580, 'record pointing at a missing file. Any AI problem ends in placeholders, never in a failed run.', 12.5, 400, '#3C4650', 'middle'),
    ].join(''),
  ),
  lifecycle: svg(
    1000,
    380,
    [
      label(500, 28, 'Report statuses', 16, 700, NAVY, 'middle'),
      box(30, 150, 140, 56, ['queued'], 'grey', 15),
      box(230, 150, 140, 56, ['running'], 'grey', 15),
      box(460, 70, 190, 56, ['ready', 'ready for review'], 'green', 15),
      box(460, 230, 190, 56, ['needs_attention', 'blocking points open'], 'amber', 15),
      box(800, 70, 170, 56, ['approved', 'final, read-only'], 'brand', 15),
      box(230, 300, 140, 56, ['failed'], 'white', 15),
      arrow(170, 178, 228, 178),
      arrow(370, 165, 458, 105, 'checks pass'),
      arrow(370, 192, 458, 250, 'blocking flag', false, 18),
      arrow(300, 206, 300, 298, 'error / stuck 30 min', false, 0),
      arrow(535, 126, 535, 228, 'edit', false, 0),
      arrow(575, 228, 575, 128, '', false),
      arrow(650, 98, 798, 98, 'approve'),
      arrow(460, 270, 120, 208, 'regenerate', true, 18),
      label(820, 250, 'Edits move a report between', 12.5, 400, '#3C4650', 'middle'),
      label(820, 268, '"ready" and "needs attention".', 12.5, 400, '#3C4650', 'middle'),
      label(820, 296, 'Regenerate sets it back to', 12.5, 400, '#3C4650', 'middle'),
      label(820, 314, '"queued" (text only, same figures).', 12.5, 400, '#3C4650', 'middle'),
    ].join(''),
  ),
};

async function renderDiagrams(): Promise<Record<string, Buffer>> {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 2 });
    const out: Record<string, Buffer> = {};
    for (const [name, markup] of Object.entries(DIAGRAMS)) {
      await page.setContent(`<html><body style="margin:0;background:#fff">${markup}</body></html>`);
      out[name] = await page.locator('svg').screenshot({ type: 'png' });
    }
    // Screenshots and slide images: read once, cropping the tall ones to their useful top part.
    if (existsSync(SHOTS)) {
      for (const name of readdirSync(SHOTS).filter((n) => n.endsWith('.png'))) {
        const png = readFileSync(join(SHOTS, name));
        const keep = CROPS[name];
        if (!keep) {
          shots.set(name, png);
          continue;
        }
        const width = png.readUInt32BE(16);
        await page.setViewportSize({ width, height: keep });
        await page.setContent(`<html><body style="margin:0"><img src="data:image/png;base64,${png.toString('base64')}" style="display:block;width:${width}px"></body></html>`);
        shots.set(name, await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width, height: keep }, scale: 'css' }));
      }
    }
    return out;
  } finally {
    await browser.close();
  }
}

// ───────────────────────── docx helpers ─────────────────────────
type Block = Paragraph | Table;
let figureNo = 0;
let tableNo = 0;
const run = (text: string, o: { bold?: boolean; italics?: boolean; size?: number; color?: string } = {}) => new TextRun({ text, font: FONT, ...o });
/** Paragraph; `**bold**` marks bold text. */
const p = (text: string, o: { size?: number; after?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) =>
  new Paragraph({
    spacing: { after: o.after ?? 120, line: 276 },
    ...(o.align ? { alignment: o.align } : {}),
    children: text.split('**').map((part, i) => run(part, { bold: i % 2 === 1, ...(o.size ? { size: o.size } : {}) })),
  });
const bullets = (items: string[]) =>
  items.map(
    (text) =>
      new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 60, line: 276 },
        children: text.split('**').map((part, i) => run(part, { bold: i % 2 === 1 })),
      }),
  );
const steps = (items: string[]) => items.map((text, i) => p(`**${i + 1}.** ${text}`, { after: 80 }));
const h1 = (n: string, title: string) =>
  new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, spacing: { after: 160 }, children: [run(`${n}  ${title}`, { bold: true, color: BRAND, size: 32 })] });
const h2 = (title: string) =>
  new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 220, after: 100 }, keepNext: true, children: [run(title, { bold: true, color: BRAND, size: 24 })] });
const caption = (text: string) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60, after: 220 }, children: [run(text, { italics: true, size: 18, color: '4A5560' })] });

const BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'B8C0CA' };
function table(headers: string[], rows: string[][], widths: number[], title?: string): Block[] {
  const total = widths.reduce((a, b) => a + b, 0);
  const dxa = widths.map((w) => Math.round((w / total) * CONTENT_DXA));
  const cell = (text: string, i: number, head: boolean) =>
    new TableCell({
      width: { size: dxa[i] as number, type: WidthType.DXA },
      margins: { top: 60, bottom: 60, left: 90, right: 90 },
      ...(head ? { shading: { type: ShadingType.CLEAR, fill: BRAND, color: 'auto' } } : {}),
      children: text.split('\n').map(
        (line) =>
          new Paragraph({
            spacing: { after: 20 },
            children: line.split('**').map((part, k) => run(part, { size: 18, bold: head || k % 2 === 1, ...(head ? { color: 'FFFFFF' } : {}) })),
          }),
      ),
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
  return [t, caption(`Table ${tableNo}. ${title ?? headers.join(', ')}`)];
}

const pngSize = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });
function figure(png: Buffer | null, text: string, maxW = MAX_IMG_W, maxH = MAX_IMG_H): Block[] {
  figureNo += 1;
  if (!png) return [p(`[Image not available on this machine: ${text}]`), caption(`Figure ${figureNo}. ${text}`)];
  const size = pngSize(png);
  const scale = Math.min(maxW / size.width, maxH / size.height, 1);
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      keepNext: true,
      spacing: { before: 80, after: 0 },
      children: [new ImageRun({ type: 'png', data: png, transformation: { width: Math.round(size.width * scale), height: Math.round(size.height * scale) } })],
    }),
    caption(`Figure ${figureNo}. ${text}`),
  ];
}
/** Full-page screenshots are tall; only the top part matters. Height to keep, in source pixels (width 1440). */
const CROPS: Record<string, number> = {
  '05-estimates-row-errors.png': 660,
  '06-estimates-uploaded.png': 470,
  '07-company-card-report-ready.png': 520,
  '10-report-edited.png': 760,
  '12-report-approved.png': 720,
  '13-list-approved.png': 430,
  '14-settings-weekly-reports.png': 520,
  '15-salesperson-not-found.png': 240,
};
const shots = new Map<string, Buffer>();
const shot = (name: string): Buffer | null => shots.get(name) ?? null;

// ───────────────────────── content ─────────────────────────
const SECTIONS: [string, string][] = [
  ['1', 'Document control'],
  ['2', 'Executive summary'],
  ['3', 'Scope and decisions'],
  ['4', 'Architecture'],
  ['5', 'Agent catalogue'],
  ['6', 'Business workflow'],
  ['7', 'Technical run sequence'],
  ['8', 'Report lifecycle'],
  ['9', 'Data'],
  ['10', 'Metrics and health'],
  ['11', 'AI narrative and guardrails'],
  ['12', 'PowerPoint output'],
  ['13', 'API and screens'],
  ['14', 'Security and permissions'],
  ['15', 'Configuration and running it'],
  ['16', 'Testing and QA results'],
  ['17', 'Known limitations and next steps'],
  ['A', 'Appendix A: file map'],
  ['B', 'Appendix B: glossary'],
];

function build(d: Record<string, Buffer>): Block[] {
  const b: Block[] = [];
  const add = (...items: (Block | Block[])[]) => b.push(...items.flat());
  const csv = readFileSync(join(root, 'e2e', 'fixtures', 'estimates-sample.csv'), 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(','));

  // Title page
  add(
    new Paragraph({ spacing: { before: 2400, after: 200 }, children: [run('Weekly Report Agents', { bold: true, size: 56, color: BRAND })] }),
    new Paragraph({ spacing: { after: 600 }, children: [run('Architecture and workflow', { size: 36, color: '3C4650' })] }),
    p('Internal Sales CRM · Kensium', { size: 24 }),
    p(`Version 1.0 · ${TODAY} · Prototype, for review`, { size: 24 }),
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({ spacing: { after: 200 }, children: [run('Contents', { bold: true, size: 32, color: BRAND })] }),
    ...SECTIONS.map(([n, title]) => p(`${n.length === 1 && /\d/.test(n) ? ` ${n}` : n}    ${title}`, { after: 70 })),
    p('Section numbers are used instead of page numbers; every section starts on a new page.', { size: 18 }),
  );

  // 1
  add(
    h1('1', 'Document control'),
    table(
      ['Item', 'Value'],
      [
        ['Title', 'Weekly Report Agents: architecture and workflow'],
        ['Version', '1.0'],
        ['Date', TODAY],
        ['Author', '[Author name]'],
        ['Status', 'Prototype — for review'],
        ['Branch', BRANCH],
        ['Latest commit when this file was built', `${COMMIT} (${COMMIT_SUBJECT})`],
        ['Basis', 'The code on that branch, WEEKLY-REPORTS-QA.md, IMPLEMENTATION-STATUS.md, ARCHITECTURE-DECISIONS.md and KNOWN-ISSUES.md. Where a note and the code differ, the code was followed.'],
      ],
      [30, 70],
      'Document control',
    ),
    p('This document describes what was built and tested, not a plan. Everything marked "mock" or "simulator" is a stand-in and is listed again in section 17.'),
  );

  // 2
  add(
    h1('2', 'Executive summary'),
    h2('The problem'),
    p('Every week someone builds a status PowerPoint for each client by hand: they look up what was done in the CRM, compare it with the estimates (scope) sheet agreed with the client, work out percentages, write a few sentences and lay out slides. It takes time, the numbers are easy to get wrong, and each person does it differently.'),
    h2('What was built'),
    p('Inside the existing Sales CRM, a set of small programs ("agents") now prepares that report. For each client company, once a week or when someone clicks **Generate now**, the CRM:'),
    ...bullets([
      'reads the client\'s estimates sheet (uploaded as CSV; reading a linked Google Sheet is built but switched off by default);',
      'collects the CRM tasks, calls and meetings for that client, limited to what the company owner is allowed to see;',
      'matches scope rows to CRM tasks and calculates the figures (percent complete, hours remaining, health) with ordinary code;',
      'asks an AI model to write a few client-facing sentences, each tied to the facts it is based on, and checks them;',
      'builds a six-slide draft PowerPoint;',
      'waits for a person to review, edit and approve; only then is the final PowerPoint created for download.',
    ]),
    h2('The outcome'),
    p('The full flow works end to end in the browser and was tested with a realistic case (lead to approved report). In that test the report showed 18.2 % complete, 180 hours remaining and health "needs attention" because of one overdue task; all figures matched a hand calculation (section 10). The PowerPoint was opened and exported with Microsoft PowerPoint and checked slide by slide (section 12).'),
    h2('What is mocked'),
    ...bullets([
      '**AI text:** written by the built-in simulator, not a real AI model. No request has been sent to a real model, so real text quality, cost and speed are unknown.',
      '**Slide template:** a plain "Default (mock)" template with the Kensium logo, not the real company template.',
      '**Google Sheets:** the read-only reader is built and tested with a fake connection only; it has never called Google.',
      '**Sending:** by design the CRM never sends the report. A person downloads the approved file and sends it.',
    ]),
  );

  // 3
  add(
    h1('3', 'Scope and decisions'),
    table(
      ['Topic', 'Decision', 'Why'],
      [
        ['Inputs', 'Existing CRM data (companies, opportunities, tasks, calls and meetings) plus one estimates (scope) sheet per client.', 'No new business modules were needed; progress is carried by CRM tasks.'],
        ['Estimates sheet', 'CSV upload on the company page. Optional: a linked Google Sheet, read-only, behind the switch ESTIMATES_SOURCE=google.', 'CSV works everywhere; Google needs a service account that does not exist yet.'],
        ['Output', 'One weekly PowerPoint (.pptx) per client and week, for the last full week (Monday to Sunday).', 'Matches how status is reported to clients today.'],
        ['Human review', 'A person reviews, can edit every sentence, and must approve. Without approval there is no final file.', 'Client-facing text and figures need an accountable person.'],
        ['Delivery', 'Download only. The CRM never emails or shares the report.', 'A person decides when and how it goes to the client.'],
        ['Run-as user', 'Each report runs as the company owner: their visibility, their AI permission, limits and usage records.', 'A report can never contain a record its owner could not open.'],
        ['AI', 'Simulator only (AI_PROVIDER=fake). AI writes sentences; it never produces or changes a number.', 'Numbers must be reproducible and checkable.'],
        ['Out of scope', 'Project, milestone, timesheet, budget and risk modules; writing to Google Sheets; email delivery; a real AI model run; the real company slide template; per-client schedules.', 'Kept out of the prototype on purpose.'],
      ],
      [18, 47, 35],
      'Scope and decisions',
    ),
  );

  // 4
  add(
    h1('4', 'Architecture'),
    h2('4.1 Context'),
    p('Three kinds of users work in the CRM. The CRM talks to two outside systems: an AI model (today the built-in simulator) and, optionally, Google Sheets for reading. The client is outside the system: a person sends them the file.'),
    figure(d.context ?? null, 'Context: users, the CRM, the AI model (mock) and Google Sheets (read-only)'),
    h2('4.2 Inside the CRM'),
    p('The feature adds an agent engine on the server and a report center in the web app. Both sit on services the CRM already had: the job queue, permissions, audit log and timeline, file storage, the AI layer and notifications.'),
    figure(d.inside ?? null, 'Inside the CRM: data, agent engine, report center and shared services'),
    h2('4.3 Agent pipeline'),
    p('For one client and one week the agents run in a fixed order. Each agent has one job and passes a defined result to the next (section 5).'),
    figure(d.pipeline ?? null, 'Agent pipeline for one client and one week'),
    p('Technology: Node.js server (Hono, Drizzle, PostgreSQL), React web app, pptxgenjs for PowerPoint. No agent framework is used; an "agent" here is a small module with a clear input and output, run by the existing job queue.'),
  );

  // 5
  add(
    h1('5', 'Agent catalogue'),
    p('All code paths are under apps/server/src/. "Plain code" means deterministic code with tests; only the Narrative agent calls the AI layer.'),
    table(
      ['Agent', 'What it does', 'Inputs', 'Outputs', 'Code file', 'AI or code'],
      [
        ['Orchestrator', 'Starts runs: weekly schedule (once per company and week) or "Generate now"; runs the steps in order; cleans up stuck runs.', 'Schedule settings, company, clock', 'A run record and a queued job', 'modules/weekly-reports.ts, modules/workflow.ts', 'Plain code'],
        ['Collector', 'Reads the client\'s opportunities, tasks, calls and meetings with the company owner\'s visibility and stores them as a snapshot.', 'Company, week, owner', 'Snapshot file (write-once, fingerprinted)', 'modules/weekly-reports/collect.ts', 'Plain code'],
        ['Estimates reader', 'Imports the estimates sheet: CSV upload, or a linked Google Sheet (read-only). All-or-nothing with row errors.', 'CSV text or sheet rows', 'An import with its scope rows', 'modules/weekly-reports/estimates.ts, platform/google-sheets.ts', 'Plain code'],
        ['Matcher', 'Links each scope row to a CRM task and decides its state (not started, in progress, done).', 'Scope rows, tasks', 'Matched rows with state', 'modules/weekly-reports/match.ts', 'Plain code'],
        ['Metrics', 'Calculates all figures, health, week-over-week changes and progress by phase.', 'Matched rows, tasks, activities, previous report', 'Metrics document', 'modules/weekly-reports/metrics.ts', 'Plain code'],
        ['Narrative', 'Builds a facts pack and asks the AI for client-facing sentences, each citing its facts.', 'Facts pack', 'Sentences with sources', 'modules/weekly-reports/facts.ts, narrative.ts, modules/ai/prompts.ts', 'AI (simulator)'],
        ['Checks', 'Verifies every sentence; on failure asks for a rewrite (max 2), then falls back to placeholders.', 'Sentences, facts', 'Flags; pass or fallback', 'modules/weekly-reports/checks.ts', 'Plain code'],
        ['PPT builder', 'Builds the six-slide deck from figures and text using the selected template.', 'Metrics, text, branding', 'Draft or final .pptx', 'modules/weekly-reports/deck.ts', 'Plain code'],
        ['Publisher', 'Handles review: edits, regenerate, approval guards, the final write-once file and downloads.', 'Reviewer actions', 'Approved report, final .pptx', 'modules/weekly-reports.ts, http/routes/weekly-reports.ts', 'Plain code'],
      ],
      [14, 26, 14, 15, 20, 11],
      'Agent catalogue',
    ),
  );

  // 6
  add(
    h1('6', 'Business workflow'),
    p('This is the flow that was run in the browser during QA (e2e/weekly-workflow-preview.spec.ts), from a new lead to an approved report. The screenshots are from that run, on the development database with demo users.'),
    h2('Step 1 — Create the lead'),
    p('Leads → New lead: name, company, email, job title, source and notes. The lead starts as "New".'),
    figure(shot('01-new-lead.png'), 'New lead form'),
    h2('Step 2 — Qualify and convert'),
    p('Start working → Qualify → Convert. Converting creates the company, the person and (optionally) an opportunity in one step; here an opportunity of 48,000 was created.'),
    figure(shot('02-convert-lead.png'), 'Convert the qualified lead into a company, a person and an opportunity'),
    figure(shot('03-lead-converted.png'), 'The lead is converted and links to the new opportunity'),
    h2('Step 3 — Tasks with scope ids, and a meeting'),
    p('On the opportunity, tasks are created whose title starts with the scope id from the estimates sheet in square brackets, for example "[S-001] Run the discovery workshop". This is how the CRM knows which task belongs to which scope row. Two tasks were completed, one is open and one is overdue. A meeting with an outcome was logged.'),
    figure(shot('04-opportunity-tasks-meeting.png'), 'Opportunity with open tasks and the logged meeting'),
    p('Note from the test: the CRM always records "now" when a task is completed or a meeting is logged. Because a weekly report covers the previous week, the test moved those two completions and the meeting into last week with a small development-only helper. In real use the work simply happens during the week.'),
    h2('Step 4 — Upload the estimates sheet'),
    p('Company page → Weekly reports card → choose the CSV file → Upload estimates CSV. A file with mistakes is rejected completely and the card lists each problem with its row, so a report is never calculated from half a sheet.'),
    figure(shot('05-estimates-row-errors.png'), 'A broken file: nothing is imported and each row error is listed'),
    figure(shot('06-estimates-uploaded.png'), 'The correct sheet: 8 scope items, 220 hours'),
    h2('Step 5 — Generate now'),
    p('Generate now starts a run for the last full week. After a few seconds the run shows "Ready for review" (or "Needs attention" when something must be fixed first).'),
    figure(shot('07-company-card-report-ready.png'), 'Company page: the report is ready'),
    h2('Step 6 — Review on the report page'),
    p('The report page shows health with its reason, the key figures, points to review, the text in four sections and progress by phase. Under every sentence are its sources; a source that belongs to a CRM task opens the record that holds the task.'),
    figure(shot('08-report-page.png'), 'Report page: health, figures, points to review, text with sources, scope progress'),
    figure(shot('09-source-chip-target.png'), 'Clicking a source opens the opportunity that holds the task'),
    h2('Step 7 — Edit'),
    p('Edit changes a sentence, Remove deletes it, Add sentence adds one. Edited sentences are marked "Edited"; the checks run again and a new draft PowerPoint is stored.'),
    figure(shot('10-report-edited.png'), 'An edited sentence is marked "Edited"'),
    h2('Step 8 — Approve and download'),
    p('Approve asks for confirmation. If there are warnings, the approver must tick "I checked the flagged figures". After approval the report is read-only and Download final gives the PowerPoint without the draft label.'),
    figure(shot('11-approve-dialog.png'), 'Approval dialog'),
    figure(shot('12-report-approved.png'), 'Approved report: read-only, with the final download'),
    h2('Step 9 — Weekly reports list and settings'),
    p('The sidebar item Weekly reports lists all reports the user may see, with status tabs and a search by client. Admins set the weekly schedule under Settings → Weekly reports, where the template in use is also shown.'),
    figure(shot('13-list-approved.png'), 'Weekly reports list, filtered to approved reports'),
    figure(shot('14-settings-weekly-reports.png'), 'Settings: weekly schedule and template'),
    h2('Step 10 — Someone who does not own the client'),
    p('A salesperson who does not own the company gets "not found" on the report address, and the report is not in their list. The CRM does not reveal that the report exists.'),
    figure(shot('15-salesperson-not-found.png'), 'A salesperson who does not own the company cannot open the report'),
    h2('When AI is not available'),
    p('If AI is switched off or fails, the report is still produced with all figures. The sentences are placeholders that a person writes; until then the report cannot be approved.'),
    figure(shot('17-fallback-placeholders.png'), 'Without AI text: placeholders to be written by a person'),
  );

  // 7
  add(
    h1('7', 'Technical run sequence'),
    figure(d.sequence ?? null, 'Technical run sequence, from trigger to final PowerPoint', MAX_IMG_W, 430),
    ...steps([
      '**Trigger.** Every 5 minutes the scheduled scan checks whether the weekly run is due (default Monday 09:00 in the organization time zone). When due, it creates one run per company that has estimates; a unique key (company, week, version) makes sure this happens once. "Generate now" creates a run immediately as a new version for the same week.',
      '**Run and job.** A row in weekly_report_run with status "queued" and a job "weekly_report.run" in job_outbox are written in the same transaction. The worker picks the job up.',
      '**Estimates.** If Google is switched on and a sheet is linked, it is read first and stored as a new import; if that fails, the latest import is used and a warning is added. Otherwise the latest CSV import is used.',
      '**Collect.** The Collector reads the company\'s opportunities, tasks, calls and meetings with the owner\'s visibility. An inactive owner ends the run as "failed".',
      '**Snapshot.** The collected data is written as a JSON file that can never be overwritten, and its SHA-256 fingerprint is stored on the run.',
      '**Match and metrics.** Scope rows are matched to tasks; figures, health and changes against the previous report for that client are calculated.',
      '**AI narrative.** A facts pack (client-safe facts with ids) is sent to the AI layer on behalf of the owner. The answer must be JSON with sentences and their source ids.',
      '**Checks.** Each sentence is checked. On failure the AI is asked again with the failures as feedback, at most twice. After that, or on any AI error, placeholders are used and the report is marked "AI fallback".',
      '**Draft PowerPoint.** The draft deck is rendered and stored, then the run is updated.',
      '**Status.** "ready" when nothing blocks approval, otherwise "needs_attention". A timeline entry is added to the company.',
      '**Notification.** For scheduled runs the company owner gets one in-app notification with a link to the report.',
      '**Approval.** After the guards pass (section 8), the final deck is rendered without the draft label, stored write-once with its fingerprint, and the run becomes "approved".',
    ]),
  );

  // 8
  add(
    h1('8', 'Report lifecycle'),
    figure(d.lifecycle ?? null, 'Report statuses and transitions', MAX_IMG_W, 250),
    table(
      ['Status', 'Meaning', 'What can happen next'],
      [
        ['queued', 'Waiting for the worker (also while text is being regenerated).', 'running'],
        ['running', 'The pipeline is working.', 'ready, needs_attention, or failed (error, or stuck for 30 minutes)'],
        ['ready', 'Draft complete, nothing blocks approval.', 'edit, regenerate, approve'],
        ['needs_attention', 'Draft complete but at least one blocking point is open.', 'edit (may become ready), regenerate'],
        ['approved', 'Final. Text and file can no longer change.', 'download only'],
        ['failed', 'The run could not finish; a reason is shown.', '"Generate now" creates a new version'],
      ],
      [18, 42, 40],
      'Report statuses',
    ),
    h2('Rules'),
    ...bullets([
      '**Editing** is possible only in "ready" or "needs_attention". One save can change, remove and add sentences. It carries the version number of the page; if someone else changed the report meanwhile, the save is refused ("This report changed since you opened it").',
      '**Blocking points** stop approval: AI text without a source or with a number not in the facts, internal wording, placeholder text, an empty summary, too many or too long sentences.',
      '**Warnings** do not block, but the approver must tick "I checked the flagged figures": a number in a person\'s own sentence that is not in the report figures, or an estimates sheet that could not be read from Google.',
      '**Notes** are for information only: scope rows where the sheet and the CRM disagree.',
      '**Regenerate** keeps the stored snapshot, figures, week and version, and redrafts only the text. All current text, including edits, is replaced.',
      '**Generate now** is different: it collects the data again and creates a new version for the week.',
      '**Approval guards:** right status, no blocking points, warnings acknowledged, page version still current, permission on the company. The AI suggestion record is marked accepted by the approval itself.',
    ]),
  );

  // 9
  add(
    h1('9', 'Data'),
    h2('9.1 New tables'),
    table(
      ['Table (migration)', 'Purpose', 'Key columns'],
      [
        ['estimate_import (0007)', 'One uploaded or synced estimates sheet for a company. Every import is kept; reports use the latest.', 'company_id, source (csv or google), file_name, row_count, imported_by, imported_at'],
        ['estimate_item (0007)', 'One scope row of an import.', 'import_id, company_id, row_no, scope_id, title, phase, estimate_hours, sheet_status, pct_done, actual_hours'],
        ['weekly_report_run (0007)', 'One report for a company and week (a new version per "Generate now").', 'company_id, run_as_user_id, period_start, period_end, time_zone, attempt, trigger, status, estimate_import_id, snapshot file + sha256, metrics, narrative, check_flags, ai_generation_id, ai_fallback, draft and final file, final sha256, approved_by, approved_at, failure_reason, row_version'],
        ['organization_settings.weekly_report_settings (0007)', 'Organization-wide schedule and template.', 'enabled, runWeekday, runTime, templateKey (JSON)'],
        ['client_estimate_source (0008)', 'The Google Sheet linked to a company (optional).', 'company_id, google_spreadsheet_id, google_range, linked_by, linked_at'],
      ],
      [24, 34, 42],
      'New tables and columns',
    ),
    p('Files (snapshot, draft deck, final deck) are stored through the CRM\'s file storage, not in these tables; the tables hold the file reference and fingerprint.'),
    h2('9.2 Estimates sheet format'),
    p('The first row must be a header. Column names are matched without regard to case; these names are accepted:'),
    table(
      ['Column', 'Required', 'Accepted header names', 'Rules'],
      [
        ['Scope ID', 'no', 'scope id, id, task id', 'Used to match CRM tasks, e.g. S-001'],
        ['Task', 'yes', 'task, deliverable, scope item, description', 'Must not be empty'],
        ['Phase', 'no', 'phase, module, stage', 'Groups rows on the progress slide'],
        ['Estimate hours', 'yes', 'estimate hours, estimate, estimated hours, hours, effort', 'A number, 0 or more'],
        ['Status', 'no', 'status', 'Not started, In progress or Done'],
        ['% Done', 'no', '% done, progress, percent done', 'A percentage'],
        ['Actual hours', 'no', 'actual hours, actual', 'A number of hours'],
      ],
      [16, 10, 40, 34],
      'Estimates sheet columns',
    ),
    p('Sample sheet used in the tests (e2e/fixtures/estimates-sample.csv):'),
    table(csv[0] as string[], csv.slice(1), [10, 30, 12, 12, 14, 10, 12], 'Sample estimates sheet (8 rows, 220 hours)'),
    h2('9.3 Matching rule'),
    ...bullets([
      'A scope row matches a CRM task whose title contains the scope id in square brackets, for example "[S-003]". If there is none, a task with the same title (ignoring case and spacing) matches.',
      'Completed task → the row is **done**, with the task\'s completion time.',
      'Open task → the row is **in progress**, unless the sheet says "Not started"; then it stays **not started** (the task counts as planned).',
      'No task → the sheet decides: Done, In progress (or % Done above 0), otherwise not started.',
      'When the sheet and the CRM disagree, **the CRM wins** and the row is counted as a mismatch. Mismatches are shown to the reviewer as a note and never appear on slides.',
    ]),
  );

  // 10
  add(
    h1('10', 'Metrics and health'),
    p('All figures are calculated by code with decimal arithmetic (metrics.ts). "Overdue" and "due in the next 7 days" are measured from the end of the reported week, so a report for a past week gives the same result whenever it is generated.'),
    table(
      ['Id', 'Name', 'How it is calculated', 'Shown to client'],
      [
        ['E-01', 'Scope items', 'Number of rows in the estimates sheet', 'yes'],
        ['E-02', 'Total estimated hours', 'Sum of estimate hours of all rows', 'yes'],
        ['E-03', 'Scope items completed', 'Rows in state done', 'yes'],
        ['E-04', 'Estimated hours completed', 'Sum of estimate hours of done rows', 'yes'],
        ['E-05', 'Complete by estimate', 'E-04 ÷ E-02 × 100, one decimal', 'yes'],
        ['E-06', 'Scope items completed this week', 'Done rows whose task was completed inside the week (or that became done since the previous report)', 'yes'],
        ['E-07', 'Remaining estimated hours', 'E-02 − E-04', 'yes'],
        ['E-08', 'Scope items in progress', 'Rows in state in progress', 'yes'],
        ['E-09', 'Actual versus estimated hours', 'On done rows with actual hours: (actual − estimate) ÷ estimate × 100', 'yes'],
        ['E-10', 'Overdue tasks on scope items', 'Open matched tasks due before the end of the week', 'yes'],
        ['A-01', 'Calls and meetings this week', 'Logged calls and meetings inside the week', 'yes'],
        ['A-02', 'Tasks due in the next 7 days', 'Open tasks due within 7 days after the week', 'yes'],
        ['E-11', 'Scope items without a CRM task', 'Rows with no matching task', 'no (internal)'],
        ['E-12', 'Sheet and CRM mismatches', 'Rows where the sheet and the CRM disagree', 'no (internal)'],
      ],
      [8, 26, 50, 16],
      'Metrics',
    ),
    h2('Health'),
    table(
      ['Level', 'Label on slides', 'Rule (any one is enough)'],
      [
        ['Red', 'At risk', 'More than 3 overdue tasks; or completed work more than 10 % over estimate; or no scope item completed this week and none in the previous report'],
        ['Amber', 'Needs attention', '1 to 3 overdue tasks; or 5 % to 10 % over estimate; or no scope item completed this week'],
        ['Green', 'On track', 'None of the above'],
      ],
      [12, 20, 68],
      'Health rules',
    ),
    h2('Worked example from QA'),
    p('Estimates sheet: 8 rows, 16 + 24 + 40 + 32 + 48 + 24 + 16 + 20 = **220 hours**. In the CRM, S-001 and S-002 were completed in the week, S-003 has an open task, S-004 has an open task that is overdue, and one meeting was logged.'),
    table(
      ['Figure', 'Result', 'Arithmetic'],
      [
        ['Estimated hours completed', '40', '16 (S-001) + 24 (S-002)'],
        ['Complete by estimate', '18.2 %', '40 ÷ 220 = 0.1818…'],
        ['Remaining estimated hours', '180', '220 − 40'],
        ['Completed this week', '2', 'S-001, S-002'],
        ['In progress', '1', 'S-003. S-004 has an open task but the sheet says "Not started", so it counts as planned'],
        ['Actual versus estimate', '+3.1 %', 'S-001: 16.5 ÷ 16; below the 5 % threshold'],
        ['Overdue tasks', '1', 'S-004'],
        ['Health', 'Amber, "Needs attention"', '1 overdue task (1 to 3 is amber)'],
      ],
      [28, 24, 48],
      'Worked example',
    ),
    p('The same figures appeared on the report page, in the API and on slides 2 and 3.'),
  );

  // 11
  add(
    h1('11', 'AI narrative and guardrails'),
    p('The AI is used for one thing: turning figures and facts into a few readable sentences for the client. It gets no tools, cannot read the database and cannot change a number.'),
    ...bullets([
      '**Facts pack with ids.** The Narrative agent builds a list of client-safe facts: the client, the week, the client-facing metrics, completed, in-progress and upcoming scope rows, upcoming tasks and meeting outcomes. Every fact has an id. Free text typed by people (titles, meeting outcomes) is cleaned and shortened.',
      '**Every sentence cites its sources.** The AI must return, for each sentence, the ids of the facts it used. A sentence without a source is rejected.',
      '**Numbers only from the facts.** Any number or amount in an AI sentence must appear in the facts.',
      '**Internal items are excluded.** The internal figures (rows without a task, mismatches), check results and data-quality notes are never put in the facts pack or on slides.',
      '**Two rewrites, then placeholders.** If checks fail, the AI is asked again with the failures, at most twice. Then the text becomes placeholders ("[To be written before sending]") and the report needs a person. Any AI error (switched off, limits, provider down, refusal, unreadable answer) goes straight to placeholders. A run never fails because of AI.',
      '**Runs as the owner.** The AI call is made on behalf of the company owner: their permission to use AI, their daily limit and the organization budget apply, and usage is recorded against them.',
      '**Nothing is logged.** Prompts and AI answers are not written to logs. The stored AI record holds the result awaiting approval and the ids of the records used, not their content.',
      '**A person decides.** AI text is a suggestion until the report is approved.',
    ]),
    table(
      ['Check', 'What it catches', 'Effect'],
      [
        ['No source', 'An AI sentence that cites no fact', 'Blocks'],
        ['Unknown source', 'A cited id that is not in the facts', 'Blocks'],
        ['Unverified number', 'A number that is not in the facts', 'Blocks for AI text; warning for a person\'s own sentence'],
        ['Internal wording', 'Words about how the report is produced, unless the word is the client\'s own wording in a cited fact', 'Blocks'],
        ['Banned words', 'Guarantees, promises, blame, fault', 'Blocks'],
        ['Too long / too many', 'More than 320 characters; more than 3 summary, 5 completed, 5 next-week or 3 risk sentences', 'Blocks'],
        ['Empty summary', 'No summary sentence', 'Blocks'],
        ['Placeholder text', 'A placeholder is still in the text', 'Blocks'],
        ['Estimates not refreshed', 'The linked Google Sheet could not be read; the latest import was used', 'Warning'],
        ['Sheet/CRM mismatch', 'Rows where sheet and CRM disagree', 'Note only'],
      ],
      [24, 50, 26],
      'Checks on the report text',
    ),
  );

  // 12
  add(
    h1('12', 'PowerPoint output'),
    p('The deck is a standard Microsoft PowerPoint file (.pptx, widescreen) built with pptxgenjs. Layout comes from a named template, "Default (mock)":'),
    ...bullets([
      'Two slide masters: a title master and a content master. They hold the brand colour (from the organization\'s branding), a header bar, the Kensium logo, the footer text and the slide number.',
      'Fixed positions for the title, the figure tiles, the table, the chart and the text.',
      'Font Arial, because it is available in every PowerPoint. (The first version named the CRM\'s screen font, which PowerPoint does not have; letters came out stretched. Found and fixed in QA.)',
      'The template is chosen by a key in the settings, so the real company template can be added later as a second template without changing the pipeline.',
    ]),
    p('The images below are the **final** deck from the QA run, exported from Microsoft PowerPoint.'),
    figure(shot('slide-1.png'), 'Slide 1, Title: client, "Weekly status report", the week, logo, footer and slide number', 430, 250),
    figure(shot('slide-2.png'), 'Slide 2, Summary: health with its reason, summary sentences and four key figures', 430, 250),
    figure(shot('slide-3.png'), 'Slide 3, Scope progress: table by phase and a chart of percent complete', 430, 250),
    figure(shot('slide-4.png'), 'Slide 4, Completed this week: sentences and the completed scope items', 430, 250),
    figure(shot('slide-5.png'), 'Slide 5, Next week: sentences and what is in progress or coming up', 430, 250),
    figure(shot('slide-6.png'), 'Slide 6, Risks and support needed', 430, 250),
    h2('Draft and final'),
    p('A draft has "DRAFT – not approved" on every slide and is stored again after each edit. The final deck is rendered at approval without that label, stored write-once and fingerprinted; downloading it checks the fingerprint.'),
    figure(shot('draft-slide-2.png'), 'The same slide in the draft deck, with the draft label', 430, 250),
    h2('File names'),
    p('<Client>_Weekly_Status_<week end date>_v<version>.pptx for the final file, with _DRAFT before the extension for a draft. Example: Stark_Industries_Weekly_Status_2026-11-22_v1_DRAFT.pptx.'),
  );

  // 13
  add(
    h1('13', 'API and screens'),
    p('All routes are under /api/v1 and need a signed-in user. "manage" and "view" are the two weekly-report permissions (section 14).'),
    table(
      ['Method and path', 'What it does', 'Permission'],
      [
        ['POST /companies/:id/estimates', 'Upload an estimates CSV', 'manage'],
        ['GET /companies/:id/estimates', 'Latest import, totals and source mode', 'view'],
        ['PUT /companies/:id/estimate-source', 'Link a Google Sheet (only when Google is on)', 'manage'],
        ['POST /companies/:id/estimates/sync', 'Read the linked sheet now', 'manage'],
        ['POST /companies/:id/weekly-reports', 'Generate now', 'manage'],
        ['GET /weekly-reports', 'List (filters: company, status, client search)', 'view'],
        ['GET /weekly-reports/:id', 'One report with figures, text, sources and flags', 'view'],
        ['PATCH /weekly-reports/:id/narrative', 'Edit, remove and add sentences', 'manage'],
        ['POST /weekly-reports/:id/regenerate', 'Redraft the text with AI', 'manage'],
        ['POST /weekly-reports/:id/approve', 'Approve (with warning acknowledgement)', 'manage'],
        ['GET /weekly-reports/:id/pptx/draft or /final', 'Download the deck', 'view'],
        ['GET, PUT /admin/weekly-report-settings', 'Schedule and template (Admin)', 'settings'],
      ],
      [38, 42, 20],
      'API routes',
    ),
    h2('Screens'),
    table(
      ['Screen', 'Where', 'What it offers'],
      [
        ['Weekly reports card', 'Company page', 'Estimates upload with row errors, Google link and sync (when on), Generate now, latest reports with status, downloads and approve'],
        ['Weekly reports list', 'Sidebar → Weekly reports', 'All reports the user may see, status tabs, search by client'],
        ['Report page', 'Open from the card or list', 'Health, figures, points to review, text with sources, edit / remove / add, regenerate, approve dialog, downloads, scope progress, a note on how the text was produced'],
        ['Settings', 'Settings → Weekly reports (Admin)', 'Automatic run on or off, weekday, time, template in use (read-only)'],
      ],
      [22, 26, 52],
      'Screens',
    ),
  );

  // 14
  add(
    h1('14', 'Security and permissions'),
    ...bullets([
      '**Two permissions:** weekly_report.view and weekly_report.manage. Both are scoped by the company owner: a salesperson for their own companies, a sales manager for their team\'s, an admin for all.',
      '**Stricter than company visibility:** being able to see a company through cross-team visibility does not open its estimates or reports.',
      '**Not found instead of forbidden:** a report or estimates sheet outside the user\'s scope answers "not found" (404), so its existence is not revealed.',
      '**Run-as owner:** data is collected with the owner\'s visibility, so the report cannot contain what the owner could not open.',
      '**Approval rules:** only someone with manage permission on the company; correct status; no blocking points; warnings acknowledged; current page version.',
      '**Files:** the snapshot and the final deck are write-once and fingerprinted with SHA-256; the final download verifies the fingerprint. Files are written before the database transaction that records them.',
      '**Audit log:** estimates imported, sheet linked, report requested, edited (counts only, never the text), regenerate requested, approved (with the acknowledgement), settings changed.',
      '**Timeline on the company:** estimates imported, weekly report draft ready, weekly report approved.',
      '**Secrets:** the Google service-account key and access tokens never appear in logs, error messages or API answers. The Google access is read-only by its permission scope.',
      '**AI:** runs server-side only, on behalf of a user, with no tools; prompts and answers are not logged.',
    ]),
  );

  // 15
  add(
    h1('15', 'Configuration and running it'),
    table(
      ['Setting', 'Default', 'Meaning'],
      [
        ['AI_PROVIDER', 'fake', 'The built-in simulator. A real provider needs a key and the owner\'s approval; not tried.'],
        ['AI_MODEL_WEEKLY', 'claude-sonnet-5-5', 'Model name used for weekly report text when a real provider is configured.'],
        ['ESTIMATES_SOURCE', 'csv', 'csv: upload only. google: also read linked Google Sheets (read-only).'],
        ['GOOGLE_SERVICE_ACCOUNT_JSON_BASE64', '(not set)', 'The service-account key, base64-encoded. A secret. Required when ESTIMATES_SOURCE=google; the server refuses to start without it.'],
      ],
      [34, 18, 48],
      'Environment settings',
    ),
    ...bullets([
      '**Database:** pnpm db:migrate applies migrations 0007 (weekly reports) and 0008 (estimate source).',
      '**AI switch:** AI settings → AI on and "Weekly client report" on; otherwise reports use placeholders.',
      '**One-command demo:** pnpm weekly:demo (optionally --company "<name>") imports the sample sheet, creates two demo tasks, generates a report and writes the draft PowerPoint to .data/weekly-demo/. Development only; safe to repeat.',
      '**Workflow preview:** pnpm exec playwright test e2e/weekly-workflow-preview.spec.ts produces the screenshots and decks; scripts/export-slides.ps1 exports slides to images with PowerPoint.',
      '**Schedule:** Settings → Weekly reports. The jobs run in the worker, or inside the API when RUN_JOBS_IN_PROCESS=true.',
      '**Public demo link:** scripts/tunnel.ps1 shares the CRM from a PC through a temporary address; it works only while that PC and script run.',
      '**Render / Vercel:** DEPLOY.md describes hosting and has a section "Estimates from Google Sheets". Generated decks are stored on the API\'s disk like proposal PDFs.',
    ]),
  );

  // 16
  add(
    h1('16', 'Testing and QA results'),
    table(
      ['Kind', 'Count', 'What it covers'],
      [
        ['Unit: week, matcher, metrics', '15', 'Week boundaries including a clock-change week, matching, every figure, health'],
        ['Unit: facts, checks, simulator', '15', 'Facts pack content, each check, simulator output, fallback message'],
        ['Unit: deck', '5', 'Masters, logo, six slides, nothing internal, font, client wording'],
        ['Unit: Google reader', '8', 'Token exchange, read-only scope, error mapping, no secret in errors (fake connection)'],
        ['Integration (real PostgreSQL)', '16', 'Import, schedule exactly once, exact figures, deck contents, owner scoping, approval, edit, regenerate, fallback, warnings, settings, notification, Google link and sync'],
        ['Browser (Edge)', '3', 'Core flow; full workflow preview; AI-off path'],
        ['Whole project (pnpm verify)', '267 tests in 22 files', 'Typecheck, lint, all unit and integration tests, build: passed on 2026-11-25'],
      ],
      [30, 20, 50],
      'Tests',
    ),
    h2('What the workflow preview covers'),
    p('Lead → qualified → converted → tasks and a meeting → broken and correct estimates upload → Generate now → report page (figures asserted against the hand calculation) → source link → edit → draft download → approval → final download → list and settings → access check as another salesperson. Error paths: no estimates, broken CSV, second request while one is running, approval with an outdated page, AI switched off with placeholders replaced by hand.'),
    h2('Bugs found in QA and fixed'),
    table(
      ['Symptom', 'Cause', 'Fix'],
      [
        ['Sources under sentences could not be clicked; task sources opened the general task list', 'Sources had no link or a fixed one', 'Sources now open the opportunity, company or person that holds the task'],
        ['Stretched letters on slides 3 and 4 in PowerPoint', 'The deck named a font PowerPoint does not have', 'Template font changed to Arial'],
        ['Slide 5 showed a raw task title with its bracket tag and a technical date, repeating a scope item', 'Upcoming tasks were listed as stored', 'Tag removed, date written as "27 Nov", duplicates skipped'],
        ['"Ready for review" and "Needs attention" shown side by side', 'Health used the same words as the report status', 'Health labels now start with "Health:"'],
        ['Reviewer message contained an error code', 'The code was put into the message', 'Plain-word reasons'],
        ['"1 task is overdue … prioritising them", "1 scope row(s)", "4 problem(s)"', 'No singular and plural forms', 'Correct singular and plural'],
      ],
      [36, 30, 34],
      'Bugs found and fixed in QA',
    ),
    h2('Still not verified'),
    ...bullets([
      'A real AI model: text quality, cost, speed.',
      'A live read from Google Sheets.',
      'The automatic Monday run on the real clock, and the in-app notification in the browser (covered by integration tests with a controlled clock).',
      'PowerPoint on Mac, PowerPoint Online, Keynote and Google Slides; very long client names or many phases.',
      '"Regenerate" and "Add sentence" in the browser (covered by integration tests).',
      'Approval from an outdated page with two real browser tabs (tested through the API).',
      'Load, performance and an independent security review.',
    ]),
  );

  // 17
  add(
    h1('17', 'Known limitations and next steps'),
    table(
      ['Limitation', 'Next step'],
      [
        ['The slide template is a mock, not the real company template.', 'Obtain the real template and add it as a second template key.'],
        ['The Google Sheets reader has never called Google; there is no service account yet.', 'Create a service account, share one test sheet with it, run a first live read.'],
        ['AI text comes from the simulator; the prompt has never been read by a real model and there is no evaluation set.', 'With approval, run a real model on test data; build a small evaluation set; tune the prompt.'],
        ['The AI call counts against the company owner\'s daily limit; an owner with many clients can run into it on Monday and get placeholders.', 'Decide on limits for scheduled runs.'],
        ['One schedule for the whole organization; no per-client schedule or skip.', 'Decide whether per-client control is needed.'],
        ['An edited sentence keeps the sources of the sentence it replaced.', 'Let the editor change sources when editing, or clear them.'],
        ['Slides 4 to 6 look sparse when there is little content.', 'Address in the real template (layout that adapts to the amount of text).'],
        ['Scope rows without a matching task cannot be matched by hand in the UI.', 'Add a matching screen if the [S-id] convention is not enough.'],
        ['A linked Google Sheet cannot be unlinked in the UI; old imports are never cleaned up.', 'Add unlink and a retention rule.'],
        ['Completing a task or logging a meeting always records the current time; earlier work cannot be entered.', 'CRM improvement outside this feature.'],
        ['10 older browser tests expect the standard demo data and fail on the Marvel demo database (KNOWN-ISSUES K-51).', 'Run them on a freshly seeded database, or update them.'],
        ['Issues from the earlier code review outside this feature are open (for example the proposal PDF written inside its transaction, trust in the forwarded-address header, lead conversion checks).', 'Plan and fix separately.'],
      ],
      [56, 44],
      'Limitations and next steps',
    ),
  );

  // Appendix A
  add(
    h1('A', 'Appendix A: file map'),
    p('Files created (new) or modified (changed) for this feature, relative to the repository root.'),
    table(
      ['File', 'New or changed', 'Purpose'],
      (
        [
          ['apps/server/drizzle/0007_weekly_reports.sql', 'new', 'Tables for estimates and report runs; schedule settings column'],
          ['apps/server/drizzle/0008_estimate_source.sql', 'new', 'Table for the linked Google Sheet'],
          ['apps/server/src/db/schema-weekly-reports.ts', 'new', 'Table definitions and data types'],
          ['apps/server/src/db/schema.ts', 'changed', 'Schedule and template settings on the organization'],
          ['apps/server/src/modules/weekly-reports.ts', 'new', 'Orchestrator and Publisher: schedule, runs, edit, regenerate, approve, download, settings'],
          ['apps/server/src/modules/weekly-reports/period.ts', 'new', 'Week boundaries and due check'],
          ['apps/server/src/modules/weekly-reports/estimates.ts', 'new', 'Estimates import (CSV, Google), link and sync'],
          ['apps/server/src/modules/weekly-reports/collect.ts', 'new', 'Collector and snapshot'],
          ['apps/server/src/modules/weekly-reports/match.ts', 'new', 'Matcher'],
          ['apps/server/src/modules/weekly-reports/metrics.ts', 'new', 'Metrics and health'],
          ['apps/server/src/modules/weekly-reports/facts.ts', 'new', 'Facts pack for the AI'],
          ['apps/server/src/modules/weekly-reports/narrative.ts', 'new', 'Narrative agent, retries, fallback'],
          ['apps/server/src/modules/weekly-reports/checks.ts', 'new', 'Checks on the text'],
          ['apps/server/src/modules/weekly-reports/deck.ts', 'new', 'PPT builder and template'],
          ['apps/server/src/modules/weekly-reports/deck-logo.ts', 'new', 'Logo image for the slides'],
          ['apps/server/src/modules/weekly-reports/*.test.ts (3 files)', 'new', 'Unit tests'],
          ['apps/server/src/weekly-reports.integration.test.ts', 'new', 'Integration tests'],
          ['apps/server/src/platform/google-sheets.ts, google-sheets.test.ts', 'new', 'Read-only Google Sheets reader and its tests'],
          ['apps/server/src/platform/ports.ts, core.ts, adapters.ts', 'changed', 'Estimates source port, context, storage keys'],
          ['apps/server/src/platform/mock-ai.ts', 'changed', 'Simulator answer for weekly reports'],
          ['apps/server/src/composition.ts, config/env.ts', 'changed', 'Wiring and environment settings'],
          ['apps/server/src/modules/workflow.ts', 'changed', 'Scheduled scan, job handlers, notification'],
          ['apps/server/src/modules/ai.ts, ai/engine.ts, ai/prompts.ts, ai/ai-unit.test.ts', 'changed', 'New AI feature, prompt, settings merge'],
          ['apps/server/src/http/routes/weekly-reports.ts, http/app.ts', 'new / changed', 'API routes'],
          ['apps/server/src/cli/weekly-demo.ts', 'new', 'One-command demo'],
          ['apps/server/src/cli/weekly-preview-backdate.ts', 'new', 'Development helper for the workflow preview'],
          ['apps/server/src/cli/reset-dev.ts', 'changed', 'Development reset knows the new tables'],
          ['packages/shared/src/contracts.ts, permissions.ts', 'changed', 'Input rules and the two permissions'],
          ['apps/web/src/pages/weekly-reports.tsx', 'new', 'Company page card'],
          ['apps/web/src/pages/weekly-report-pages.tsx', 'new', 'Weekly reports list and report page'],
          ['apps/web/src/pages/settings.tsx, crm.tsx, ai.tsx, main.tsx', 'changed', 'Settings tab, card on the company page, AI label, navigation and routes'],
          ['e2e/weekly-reports.spec.ts, e2e/weekly-workflow-preview.spec.ts', 'new', 'Browser tests'],
          ['e2e/fixtures/estimates-sample.csv', 'new', 'Sample estimates sheet'],
          ['scripts/export-slides.ps1', 'new', 'Export slides to images with PowerPoint'],
          ['scripts/build-weekly-doc.ts', 'new', 'Builds this document'],
          ['package.json, apps/server/package.json, pnpm-lock.yaml', 'changed', 'pptxgenjs and jszip, the weekly:demo script'],
          ['.env.example, DEPLOY.md', 'changed', 'New settings and the Google Sheets section'],
          ['IMPLEMENTATION-STATUS.md, ARCHITECTURE-DECISIONS.md, KNOWN-ISSUES.md, README.md, LOCAL-SETUP.md', 'changed', 'Project records'],
          ['WEEKLY-REPORTS-QA.md', 'new', 'QA report'],
        ] as string[][]
      ).map((r) => r),
      [50, 14, 36],
      'File map',
    ),
  );

  // Appendix B
  add(
    h1('B', 'Appendix B: glossary'),
    table(
      ['Term', 'Meaning here'],
      [
        ['Agent', 'A small program with one job in the report pipeline (collect, match, calculate, write, check, build). Not an autonomous AI; only the Narrative agent uses AI.'],
        ['Run', 'One attempt to produce the report for one client and one week. "Generate now" creates a new version.'],
        ['Snapshot', 'The CRM data and estimates used for a run, stored as a file that cannot be changed, with a fingerprint.'],
        ['Estimate', 'The hours agreed for a piece of work in the client\'s scope sheet.'],
        ['Scope item', 'One row of the estimates sheet: a piece of work with its estimate, optionally an id such as S-001 and a phase.'],
        ['Health', 'Green, amber or red, decided by fixed rules from overdue tasks, hours over estimate and progress.'],
        ['Facts pack', 'The client-safe facts, each with an id, given to the AI to write from.'],
        ['Source', 'The fact a sentence is based on, shown under the sentence on the report page.'],
        ['Fallback', 'What happens when AI text cannot be used: placeholder sentences that a person writes.'],
        ['Run-as user', 'The user on whose behalf a report runs: the company owner. Their visibility and AI limits apply.'],
        ['Blocking point / warning / note', 'Three kinds of review points: must be fixed; must be acknowledged at approval; information only.'],
        ['Draft / final', 'The deck before approval (marked DRAFT) and the unchangeable deck created at approval.'],
      ],
      [26, 74],
      'Glossary',
    ),
  );
  return b;
}

// ───────────────────────── build ─────────────────────────
const diagrams = await renderDiagrams();
const doc = new Document({
  creator: '[Author name]',
  title: 'Weekly Report Agents: architecture and workflow',
  description: 'Architecture and workflow of the Weekly Report Agents feature (prototype)',
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 32, bold: true, color: BRAND } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 24, bold: true, color: BRAND } },
    ],
  },
  sections: [
    {
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                run('Weekly Report Agents: architecture and workflow · Prototype, for review · Page ', { size: 16, color: '5F6368' }),
                new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: '5F6368' }),
                run(' of ', { size: 16, color: '5F6368' }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: '5F6368' }),
              ],
            }),
          ],
        }),
      },
      children: build(diagrams),
    },
  ],
});
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, await Packer.toBuffer(doc));
const missing = ['01-new-lead.png', 'slide-1.png'].filter((f) => !existsSync(join(SHOTS, f)));
console.log(`Wrote ${OUT}`);
console.log(`Figures: ${figureNo}, tables: ${tableNo}${missing.length ? ' — some images were missing in demo-preview/weekly/' : ''}`);
