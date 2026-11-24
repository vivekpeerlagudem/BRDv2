/**
 * Estimates (scope) sheet for Weekly Report Agents: the client's scope items and estimated hours, imported as CSV.
 * An import is all-or-nothing: one invalid row rejects the whole file with the row errors, so a report is never
 * computed from half a sheet. Each import is kept; reports always use the latest one.
 */
import type { estimatesUploadInput } from '@crm/shared';
import { Decimal } from 'decimal.js';
import { desc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { estimateImport, estimateItem, type SheetStatus } from '../../db/schema-weekly-reports.ts';
import {
  type AppContext,
  canAccessOwner,
  type DbOrTx,
  forbidden,
  notFound,
  requirePerm,
  rule,
  schema,
  type UserActor,
  unitOfWork,
} from '../../platform/core.ts';
import { CsvError, parseCsv } from '../imports/csv.ts';
import { IMPORT_LIMITS } from '../imports.ts';

const { company, appUserProfile } = schema;

/** Loads a company the actor may see (404 otherwise); `write` also requires edit rights (403 VIEW_ONLY). */
export async function loadCompanyFor(db: DbOrTx, actor: UserActor, companyId: string, access: 'read' | 'write') {
  const [row] = await db.select().from(company).where(eq(company.id, companyId));
  if (!row || !canAccessOwner(actor, row.ownerId, 'read', 'companies')) throw notFound('Company');
  // Weekly report data follows the weekly_report scope (own / team / all): seeing a company through
  // cross-visibility does not open its estimates or reports.
  if (!canAccessOwner(actor, row.ownerId, 'read', 'companies', 'weekly_report.view'))
    throw forbidden('VIEW_ONLY', 'You can view this company but not its weekly reports');
  if (access === 'write' && !canAccessOwner(actor, row.ownerId, 'write', 'companies'))
    throw forbidden('VIEW_ONLY', 'You can view this company but not change it');
  return row;
}

type Field = 'scopeId' | 'title' | 'phase' | 'estimateHours' | 'status' | 'pctDone' | 'actualHours';
const COLUMNS: { field: Field; label: string; required: boolean; aliases: string[] }[] = [
  { field: 'scopeId', label: 'Scope ID', required: false, aliases: ['scope id', 'id', 'task id'] },
  { field: 'title', label: 'Task', required: true, aliases: ['task', 'deliverable', 'scope item', 'description'] },
  { field: 'phase', label: 'Phase', required: false, aliases: ['phase', 'module', 'stage'] },
  { field: 'estimateHours', label: 'Estimate hours', required: true, aliases: ['estimate hours', 'estimate', 'estimated hours', 'hours', 'effort'] },
  { field: 'status', label: 'Status', required: false, aliases: ['status'] },
  { field: 'pctDone', label: '% Done', required: false, aliases: ['% done', 'progress', 'percent done'] },
  { field: 'actualHours', label: 'Actual hours', required: false, aliases: ['actual hours', 'actual'] },
];
const STATUS_WORDS: Record<string, SheetStatus> = {
  'not started': 'not_started',
  todo: 'not_started',
  'to do': 'not_started',
  'in progress': 'in_progress',
  wip: 'in_progress',
  done: 'done',
  completed: 'done',
  complete: 'done',
};
const normHeader = (h: string) => h.trim().toLowerCase().replace(/\s+/g, ' ');
const NUMBER = /^\d+(\.\d+)?$/;
const number = (raw: string) => raw.replace(/,/g, '').trim();

export interface EstimateRowError {
  row: number;
  column: string;
  message: string;
}
export interface ParsedEstimateRow {
  rowNo: number;
  scopeId: string | null;
  title: string;
  phase: string | null;
  estimateHours: string;
  sheetStatus: SheetStatus | null;
  pctDone: string | null;
  actualHours: string | null;
}

/** Pure: CSV records (header first) → rows, or the list of problems. Row numbers are the lines people see in the sheet. */
export function parseEstimateRecords(records: string[][]): { rows: ParsedEstimateRow[]; errors: EstimateRowError[]; missing: string[] } {
  const headers = (records[0] ?? []).map(normHeader);
  const index = {} as Record<Field, number>;
  for (const c of COLUMNS) index[c.field] = headers.findIndex((h) => c.aliases.includes(h));
  const missing = COLUMNS.filter((c) => c.required && index[c.field] < 0).map((c) => c.label);
  const rows: ParsedEstimateRow[] = [];
  const errors: EstimateRowError[] = [];
  if (missing.length) return { rows, errors, missing };
  const cell = (r: string[], f: Field) => (index[f] >= 0 ? (r[index[f]] ?? '').trim() : '');
  records.slice(1).forEach((r, i) => {
    const row = i + 2;
    const fail = (column: string, message: string) => errors.push({ row, column, message });
    const title = cell(r, 'title');
    if (!title) fail('Task', 'Task is required');
    else if (title.length > 500) fail('Task', 'Use at most 500 characters');
    const estimate = number(cell(r, 'estimateHours'));
    if (!estimate) fail('Estimate hours', 'Estimate hours is required');
    else if (!NUMBER.test(estimate)) fail('Estimate hours', 'Must be a number of hours, 0 or more');
    else if (Number(estimate) >= 100_000_000) fail('Estimate hours', 'The number is too large');
    const statusRaw = cell(r, 'status').toLowerCase().replace(/\s+/g, ' ');
    const sheetStatus = statusRaw ? (STATUS_WORDS[statusRaw] ?? null) : null;
    if (statusRaw && !sheetStatus) fail('Status', 'Use Not started, In progress or Done');
    const pct = number(cell(r, 'pctDone').replace(/%$/, ''));
    if (pct && (!NUMBER.test(pct) || Number(pct) > 100)) fail('% Done', 'Must be a number from 0 to 100');
    const actual = number(cell(r, 'actualHours'));
    if (actual && !NUMBER.test(actual)) fail('Actual hours', 'Must be a number of hours, 0 or more');
    else if (actual && Number(actual) >= 100_000_000) fail('Actual hours', 'The number is too large');
    rows.push({
      rowNo: row,
      scopeId: cell(r, 'scopeId').slice(0, 60) || null,
      title,
      phase: cell(r, 'phase').slice(0, 120) || null,
      estimateHours: estimate,
      sheetStatus,
      pctDone: pct || null,
      actualHours: actual || null,
    });
  });
  return { rows, errors, missing };
}

const totalHours = (items: { estimateHours: string }[]) => items.reduce((sum, i) => sum.plus(i.estimateHours), new Decimal(0));
const hoursText = (d: Decimal) => d.toDecimalPlaces(2).toString();

export async function importEstimatesCsv(ctx: AppContext, actor: UserActor, companyId: string, input: z.infer<typeof estimatesUploadInput>) {
  requirePerm(actor, 'weekly_report.manage');
  const co = await loadCompanyFor(ctx.db, actor, companyId, 'write');
  if (co.archivedAt) throw rule('RECORD_ARCHIVED', 'This company is archived');
  if (Buffer.byteLength(input.text, 'utf8') > IMPORT_LIMITS.maxFileBytes) throw rule('IMPORT_FILE_TOO_LARGE', 'The file is larger than 2 MB');
  if (input.text.includes('\u0000')) throw rule('IMPORT_FILE_TYPE', 'This is not a text CSV file. Excel files must be saved as CSV first.');
  let records: string[][];
  try {
    records = parseCsv(input.text, { maxRecords: IMPORT_LIMITS.maxRows + 1 });
  } catch (error) {
    if (error instanceof CsvError)
      throw error.tooManyRows
        ? rule('IMPORT_TOO_MANY_ROWS', `The file has more than ${IMPORT_LIMITS.maxRows} data rows. Split it into smaller files.`)
        : rule('IMPORT_FILE_INVALID', `The file is not valid CSV. ${error.message}`);
    throw error;
  }
  if (records.length < 2) throw rule('IMPORT_NO_ROWS', 'The file needs a header row and at least one scope item');
  const parsed = parseEstimateRecords(records);
  if (parsed.missing.length)
    throw rule('ESTIMATES_INVALID', `The sheet is missing required columns: ${parsed.missing.join(', ')}`, {
      missingColumns: parsed.missing,
      errors: [],
      errorCount: 0,
    });
  if (parsed.errors.length)
    throw rule('ESTIMATES_INVALID', `${parsed.errors.length} problem(s) in the sheet. Nothing was imported.`, {
      errors: parsed.errors.slice(0, 20),
      errorCount: parsed.errors.length,
    });

  const total = hoursText(totalHours(parsed.rows));
  return unitOfWork(ctx, actor, async (u) => {
    const [imp] = await u.tx
      .insert(estimateImport)
      .values({ companyId, source: 'csv', fileName: input.fileName, rowCount: parsed.rows.length, importedBy: actor.userId, importedAt: ctx.now() })
      .returning();
    for (let i = 0; i < parsed.rows.length; i += 500)
      await u.tx.insert(estimateItem).values(parsed.rows.slice(i, i + 500).map((r) => ({ ...r, importId: imp!.id, companyId })));
    await u.audit('estimates.imported', { type: 'company', id: companyId }, { importId: imp!.id, items: parsed.rows.length, estimateHours: total });
    await u.timeline({
      eventType: 'estimates_imported',
      source: { type: 'estimate_import', id: imp!.id },
      summary: `Estimates sheet imported: ${parsed.rows.length} scope items, ${total} h`,
      anchors: [{ type: 'company', id: companyId }],
    });
    return { importId: imp!.id, items: parsed.rows.length, estimateHours: total };
  });
}

/** The latest import for a company, read without an access check (callers have already authorized). */
export async function latestEstimates(db: DbOrTx, companyId: string) {
  const [imp] = await db.select().from(estimateImport).where(eq(estimateImport.companyId, companyId)).orderBy(desc(estimateImport.importedAt)).limit(1);
  if (!imp) return null;
  const items = await db.select().from(estimateItem).where(eq(estimateItem.importId, imp.id)).orderBy(estimateItem.rowNo);
  return { import: imp, items };
}

export async function getEstimates(ctx: AppContext, actor: UserActor, companyId: string) {
  requirePerm(actor, 'weekly_report.view');
  await loadCompanyFor(ctx.db, actor, companyId, 'read');
  const latest = await latestEstimates(ctx.db, companyId);
  if (!latest) return { import: null, items: [], totals: { items: 0, estimateHours: '0' } };
  const [by] = await ctx.db.select({ name: appUserProfile.fullName }).from(appUserProfile).where(eq(appUserProfile.userId, latest.import.importedBy));
  return {
    import: {
      id: latest.import.id,
      fileName: latest.import.fileName,
      rowCount: latest.import.rowCount,
      importedAt: latest.import.importedAt,
      importedByName: by?.name ?? null,
    },
    items: latest.items.map((i) => ({
      id: i.id,
      rowNo: i.rowNo,
      scopeId: i.scopeId,
      title: i.title,
      phase: i.phase,
      estimateHours: i.estimateHours,
      sheetStatus: i.sheetStatus,
      pctDone: i.pctDone,
      actualHours: i.actualHours,
    })),
    totals: { items: latest.items.length, estimateHours: hoursText(totalHours(latest.items)) },
  };
}
