/**
 * Sheet builder of the Weekly Sales Brief. `buildBriefTabs` (pure) decides every cell; `renderBriefXlsx` writes
 * them as an .xlsx workbook (exceljs) that opens in Excel and Google Sheets. The same tabs are what the optional
 * Google Sheets publisher writes (platform/sales-brief-sheets.ts).
 *
 * Every text cell goes through the formula-injection guard: text a spreadsheet would run as a formula (it starts
 * with = + - @, a tab or a carriage return) gets a leading apostrophe — the same rule as `csvCell` in reporting.ts.
 */
import ExcelJS from 'exceljs';
import type { SalesBriefNarrative, SalesMetricsDoc, SalesSignal } from '../../db/schema-sales-brief.ts';
import type { SheetCell, SheetTab } from '../../platform/ports.ts';
import { periodLabel } from '../weekly-reports/period.ts';
import { metricOf } from './metrics.ts';

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const BRIEF_TABS = ['Summary', 'Insights', 'Funnel', 'Pipeline by stage', 'Deals won', 'Deals lost', 'Team', 'Attention', 'Brief history'] as const;

/** Formula-injection guard for one text cell (numbers such as -12.50 typed as text are left alone). */
export function safeText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value) ? `'${value}` : value;
}
const num = (v: string | number | null | undefined): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const REASON: Record<string, string> = { stalled: 'Stalled', overdue: 'Past expected close date', unviewed_proposal: 'Proposal not viewed' };
const FORMAT = { count: '0', money: '#,##0.00', percent: '0.0"%"', days: '0.0', money_per_day: '#,##0.00' };

export interface BriefHistoryRow {
  periodStart: string;
  periodEnd: string;
  attempt: number;
  approvedAt: string | null;
  metrics: SalesMetricsDoc;
}

export function buildBriefTabs(input: {
  metrics: SalesMetricsDoc;
  signals: SalesSignal[];
  narrative: SalesBriefNarrative;
  /** Approved briefs, newest first (the brief being approved included). */
  history: BriefHistoryRow[];
}): SheetTab[] {
  const { metrics: doc, signals, narrative } = input;
  const c = doc.currency;
  const text = (v: string | null | undefined): string | null => (v === null || v === undefined || v === '' ? null : safeText(v));
  const signalOf = (id: string) => signals.find((s) => s.id === id);
  const actionsFor = (signalIds: string[]) =>
    narrative.actions
      .filter((a) => (a.signalIds ?? []).some((id) => signalIds.includes(id)))
      .map((a) => a.text)
      .join(' ');

  const covered = new Set(narrative.insights.flatMap((i) => i.signalIds ?? []));
  const insightRows: SheetCell[][] = [
    ...narrative.insights.map((i) => {
      const linked = (i.signalIds ?? []).map(signalOf).filter((s): s is SalesSignal => Boolean(s));
      return [
        text(i.text),
        text(i.kind ?? linked[0]?.kind ?? null),
        text(linked[0]?.severity ?? null),
        text(linked.map((s) => s.title).join(' ')),
        text(actionsFor(i.signalIds ?? [])),
      ];
    }),
    // Findings no insight was written about still appear, so nothing computed is hidden.
    ...signals.filter((s) => !covered.has(s.id)).map((s) => [null, text(s.kind), text(s.severity), text(s.title), text(actionsFor([s.id]))]),
  ];
  const figure = (d: SalesMetricsDoc, id: string) => num(metricOf(d, id)?.value);

  return [
    {
      name: 'Summary',
      columns: [
        { header: 'Ref', width: 8 },
        { header: 'Metric', width: 34 },
        { header: 'Unit', width: 16 },
        { header: 'This week', width: 16 },
        { header: 'Last week', width: 16 },
        { header: 'Change %', width: 12, format: FORMAT.percent },
        { header: 'Month to date', width: 16 },
        { header: 'Quarter to date', width: 16 },
        { header: 'Detail', width: 60 },
      ],
      rows: doc.metrics.map((m) => [
        m.id,
        text(m.label),
        m.unit === 'money' ? c : m.unit === 'money_per_day' ? `${c} per day` : m.unit,
        num(m.value),
        num(m.lastWeek),
        num(m.changePct),
        num(m.mtd),
        num(m.qtd),
        text(m.detail),
      ]),
    },
    {
      name: 'Insights',
      columns: [
        { header: 'Insight', width: 70 },
        { header: 'Kind', width: 16 },
        { header: 'Severity', width: 12 },
        { header: 'Evidence', width: 80 },
        { header: 'Recommended action', width: 70 },
      ],
      rows: insightRows,
    },
    {
      name: 'Funnel',
      columns: [
        { header: 'Step', width: 24 },
        { header: 'Count', width: 12, format: FORMAT.count },
        { header: '% of step before', width: 18, format: FORMAT.percent },
        { header: 'Baseline %', width: 14, format: FORMAT.percent },
      ],
      rows: doc.funnel.map((f) => [text(f.label), f.value, num(f.stepPct), num(f.baselineStepPct)]),
    },
    {
      name: 'Pipeline by stage',
      columns: [
        { header: 'Stage', width: 24 },
        { header: 'Deals', width: 10, format: FORMAT.count },
        { header: `Value (${c})`, width: 18, format: FORMAT.money },
        { header: `Weighted (${c})`, width: 18, format: FORMAT.money },
      ],
      rows: [
        ...doc.pipelineByStage.map((p): SheetCell[] => [text(p.stage), p.count, num(p.value), num(p.weighted)]),
        ['Total', doc.pipelineTotals.count, num(doc.pipelineTotals.value), num(doc.pipelineTotals.weighted)],
      ],
    },
    {
      name: 'Deals won',
      columns: [
        { header: 'Deal', width: 44 },
        { header: 'Owner', width: 24 },
        { header: `Amount (${c})`, width: 18, format: FORMAT.money },
        { header: 'Cycle days', width: 12, format: FORMAT.count },
      ],
      rows: doc.wonDeals.map((d) => [text(d.name), text(d.owner), num(d.amount), d.cycleDays]),
    },
    {
      name: 'Deals lost',
      columns: [
        { header: 'Deal', width: 44 },
        { header: 'Owner', width: 24 },
        { header: `Amount (${c})`, width: 18, format: FORMAT.money },
        { header: 'Reason', width: 36 },
      ],
      rows: doc.lostDeals.map((d) => [text(d.name), text(d.owner), num(d.amount), text(d.reason)]),
    },
    {
      name: 'Team',
      columns: [
        { header: 'Rep', width: 26 },
        { header: 'Open deals', width: 12, format: FORMAT.count },
        { header: `Pipeline (${c})`, width: 18, format: FORMAT.money },
        { header: 'Won', width: 8, format: FORMAT.count },
        { header: 'Lost', width: 8, format: FORMAT.count },
        { header: `Revenue won (${c})`, width: 20, format: FORMAT.money },
        { header: 'Win rate %', width: 12, format: FORMAT.percent },
        { header: 'Calls', width: 8, format: FORMAT.count },
        { header: 'Meetings', width: 10, format: FORMAT.count },
        { header: 'Tasks completed', width: 16, format: FORMAT.count },
      ],
      rows: doc.reps.map((r) => [
        text(r.name),
        r.openDeals,
        num(r.openValue),
        r.won,
        r.lost,
        num(r.wonRevenue),
        r.winRate,
        r.calls,
        r.meetings,
        r.tasksCompleted,
      ]),
    },
    {
      name: 'Attention',
      columns: [
        { header: 'Deal', width: 44 },
        { header: 'Owner', width: 24 },
        { header: 'Stage', width: 20 },
        { header: `Amount (${c})`, width: 18, format: FORMAT.money },
        { header: 'Why', width: 40 },
        { header: 'Days in stage', width: 14, format: FORMAT.count },
        { header: 'Days without activity', width: 20, format: FORMAT.count },
      ],
      rows: doc.attention.map((a) => [
        text(a.name),
        text(a.owner),
        text(a.stage),
        num(a.amount),
        text(a.reasons.map((r) => REASON[r] ?? r).join(', ')),
        a.daysInStage,
        a.daysSinceActivity,
      ]),
    },
    {
      name: 'Brief history', // Excel reserves the sheet name "History"
      columns: [
        { header: 'Week', width: 22 },
        { header: 'Week start', width: 12 },
        { header: 'Version', width: 9, format: FORMAT.count },
        { header: 'Approved on', width: 14 },
        { header: 'New leads', width: 12, format: FORMAT.count },
        { header: 'New opportunities', width: 18, format: FORMAT.count },
        { header: 'Deals won', width: 12, format: FORMAT.count },
        { header: `Revenue won (${c})`, width: 20, format: FORMAT.money },
        { header: 'Win rate %', width: 12, format: FORMAT.percent },
        { header: `Open pipeline (${c})`, width: 20, format: FORMAT.money },
      ],
      rows: input.history.map((h) => [
        periodLabel(h.periodStart, h.periodEnd),
        h.periodStart,
        h.attempt,
        h.approvedAt ? h.approvedAt.slice(0, 10) : null,
        figure(h.metrics, 'S-01'),
        figure(h.metrics, 'S-05'),
        figure(h.metrics, 'S-07'),
        figure(h.metrics, 'S-08'),
        figure(h.metrics, 'S-10'),
        figure(h.metrics, 'S-11'),
      ]),
    },
  ];
}

/** Writes the tabs as a workbook: brand-colour header row (frozen), number formats and column widths. */
export async function renderBriefXlsx(tabs: SheetTab[], opts: { brandColor: string; orgName: string; title: string }): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = opts.orgName;
  workbook.title = opts.title;
  workbook.created = new Date(0); // fixed, so the same brief always gives the same file content
  workbook.modified = new Date(0);
  const argb = `FF${/^[0-9a-fA-F]{6}$/.test(opts.brandColor) ? opts.brandColor.toUpperCase() : '1F4E79'}`;
  for (const tab of tabs) {
    const sheet = workbook.addWorksheet(tab.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = tab.columns.map((col) => ({ header: col.header, width: col.width, style: col.format ? { numFmt: col.format } : {} }));
    const header = sheet.getRow(1);
    header.font = { name: 'Arial', bold: true, color: { argb: 'FFFFFFFF' } };
    header.alignment = { vertical: 'middle', wrapText: true };
    header.height = 22;
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
      cell.numFmt = '@';
    });
    for (const values of tab.rows) {
      const row = sheet.addRow(values);
      row.font = { name: 'Arial', size: 10 };
      row.alignment = { vertical: 'top', wrapText: true };
    }
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
