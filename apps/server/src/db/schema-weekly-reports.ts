/**
 * Drizzle schema for Weekly Report Agents (drizzle/0007_weekly_reports.sql): the client's estimates (scope) sheet
 * and one weekly status report run per company and week. Kept beside schema.ts like schema-imports.ts.
 */
import { sql } from 'drizzle-orm';
import { boolean, char, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { appUserProfile, company } from './schema.ts';

const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
const ts = (name: string) => timestamp(name, { withTimezone: true });

export type SheetStatus = 'not_started' | 'in_progress' | 'done';
export type WeeklyRunStatus = 'queued' | 'running' | 'ready' | 'needs_attention' | 'approved' | 'failed';
export type HealthLevel = 'green' | 'amber' | 'red';

/** One computed figure. `value` is a string (decimal-safe) or null when it cannot be computed. */
export interface WeeklyMetric {
  id: string;
  label: string;
  value: string | null;
  unit: 'count' | 'hours' | 'percent';
  /** Records the figure was computed from (e.g. `scope:<rowId>`, `task:<id>`, `activity:<id>`). */
  sourceIds: string[];
  /** Change against the previous report (same unit); null on the first report. Only set for E-03, E-05, E-06. */
  delta?: string | null;
  /** Internal figures are never shown to the client or sent to the AI model. */
  internal?: boolean;
}
export interface WeeklyItemState {
  rowId: string;
  rowNo: number;
  scopeId: string | null;
  title: string;
  phase: string | null;
  estimateHours: string;
  actualHours: string | null;
  state: SheetStatus;
  /** ISO instant the matched CRM task was completed; null for sheet-only rows. */
  doneAt: string | null;
  doneThisWeek: boolean;
  taskId: string | null;
  mismatch: boolean;
}
export interface WeeklyPhaseRow {
  phase: string;
  items: number;
  estimateHours: string;
  doneHours: string;
  pct: string;
}
export interface WeeklyMetricsDoc {
  metrics: WeeklyMetric[];
  health: { level: HealthLevel; reasons: string[] };
  phases: WeeklyPhaseRow[];
  items: WeeklyItemState[];
  upcomingTasks: { id: string; title: string; dueDate: string }[];
}
export interface WeeklyStatement {
  id: string;
  text: string;
  sources: string[];
  /** ai = written by the model · fallback = placeholder · user = written or edited by a person. */
  origin: 'ai' | 'fallback' | 'user';
}
export type WeeklySection = 'summary' | 'completed' | 'nextWeek' | 'risks';
export type WeeklyNarrative = Record<WeeklySection, WeeklyStatement[]>;
export interface WeeklyFlag {
  code: string;
  statementId: string | null;
  message: string;
  /** A warning does not block approval but must be acknowledged by the approver. Absent = blocking (or a notice). */
  level?: 'warning';
}
export interface WeeklyReportSettings {
  enabled: boolean;
  /** ISO weekday the weekly run becomes due: 1 = Monday … 7 = Sunday. */
  runWeekday: number;
  /** Local time (organization time zone), "HH:MM". */
  runTime: string;
}

export const estimateImport = pgTable(
  'estimate_import',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => company.id),
    source: text('source').$type<'csv' | 'google'>().notNull().default('csv'),
    fileName: text('file_name').notNull(),
    rowCount: integer('row_count').notNull(),
    importedBy: uuid('imported_by').notNull(),
    importedAt: ts('imported_at').notNull().defaultNow(),
  },
  (t) => [index('estimate_import_company_idx').on(t.companyId, t.importedAt)],
);

export const estimateItem = pgTable(
  'estimate_item',
  {
    id: id(),
    importId: uuid('import_id')
      .notNull()
      .references(() => estimateImport.id),
    companyId: uuid('company_id')
      .notNull()
      .references(() => company.id),
    rowNo: integer('row_no').notNull(),
    scopeId: text('scope_id'),
    title: text('title').notNull(),
    phase: text('phase'),
    estimateHours: numeric('estimate_hours', { precision: 10, scale: 2 }).notNull(),
    sheetStatus: text('sheet_status').$type<SheetStatus>(),
    pctDone: numeric('pct_done', { precision: 5, scale: 2 }),
    actualHours: numeric('actual_hours', { precision: 10, scale: 2 }),
  },
  (t) => [index('estimate_item_import_idx').on(t.importId), index('estimate_item_company_idx').on(t.companyId)],
);

export const weeklyReportRun = pgTable(
  'weekly_report_run',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => company.id),
    runAsUserId: uuid('run_as_user_id')
      .notNull()
      .references(() => appUserProfile.userId),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    timeZone: text('time_zone').notNull(),
    attempt: integer('attempt').notNull().default(1),
    trigger: text('trigger').$type<'schedule' | 'manual'>().notNull(),
    status: text('status').$type<WeeklyRunStatus>().notNull().default('queued'),
    estimateImportId: uuid('estimate_import_id'),
    snapshotFileId: uuid('snapshot_file_id'),
    snapshotSha256: char('snapshot_sha256', { length: 64 }),
    metrics: jsonb('metrics').$type<WeeklyMetricsDoc>(),
    narrative: jsonb('narrative').$type<WeeklyNarrative>(),
    checkFlags: jsonb('check_flags').$type<WeeklyFlag[]>().notNull().default([]),
    aiGenerationId: uuid('ai_generation_id'),
    aiFallback: boolean('ai_fallback').notNull().default(false),
    draftPptxFileId: uuid('draft_pptx_file_id'),
    finalPptxFileId: uuid('final_pptx_file_id'),
    finalPptxSha256: char('final_pptx_sha256', { length: 64 }),
    approvedBy: uuid('approved_by'),
    approvedAt: ts('approved_at'),
    failureReason: text('failure_reason'),
    createdAt: ts('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    updatedBy: uuid('updated_by'),
    rowVersion: integer('row_version').notNull().default(1),
  },
  (t) => [
    uniqueIndex('weekly_report_run_period_attempt_uq').on(t.companyId, t.periodStart, t.attempt),
    index('weekly_report_run_company_idx').on(t.companyId, t.periodStart),
    index('weekly_report_run_status_idx').on(t.status),
  ],
);

/** Optional link from a company to its estimates sheet in Google Sheets (read-only source, ESTIMATES_SOURCE=google). */
export const clientEstimateSource = pgTable('client_estimate_source', {
  companyId: uuid('company_id')
    .primaryKey()
    .references(() => company.id),
  googleSpreadsheetId: text('google_spreadsheet_id').notNull(),
  googleRange: text('google_range').notNull().default('A1:Z2000'),
  linkedBy: uuid('linked_by').notNull(),
  linkedAt: ts('linked_at').notNull().defaultNow(),
  createdAt: ts('created_at').notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
  rowVersion: integer('row_version').notNull().default(1),
});
