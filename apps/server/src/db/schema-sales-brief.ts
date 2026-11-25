/**
 * Drizzle schema for the Weekly Sales Brief (drizzle/0009_sales_brief.sql): one company-wide report per week for
 * leadership. Independent of deals and clients; kept beside schema.ts like schema-weekly-reports.ts.
 */
import { sql } from 'drizzle-orm';
import { boolean, char, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { appUserProfile } from './schema.ts';
import type { WeeklyFlag, WeeklyRunStatus, WeeklyStatement } from './schema-weekly-reports.ts';

const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
const ts = (name: string) => timestamp(name, { withTimezone: true });

export type SalesUnit = 'count' | 'money' | 'percent' | 'days' | 'money_per_day';
/** One figure of the brief. Values are strings (decimal-safe) or null when they cannot be computed. */
export interface SalesMetric {
  id: string;
  label: string;
  unit: SalesUnit;
  value: string | null;
  lastWeek: string | null;
  /** Change against last week in percent of last week's value; null when last week is 0 or unknown. */
  changePct: string | null;
  /** Average of the earlier briefs (up to 4 weeks) when there are any, otherwise last week. */
  baseline: string | null;
  mtd?: string | null;
  qtd?: string | null;
  /** Extra words for composite figures, e.g. "sent 3 · viewed 2 · signed 1". */
  detail?: string;
}
export interface SalesFunnelStep {
  metricId: string;
  label: string;
  value: number;
  /** This step as a percentage of the step before it; null for the first step or when the step before is 0. */
  stepPct: string | null;
  baselineStepPct: string | null;
}
export interface SalesAttentionDeal {
  dealId: string;
  name: string;
  owner: string;
  ownerId: string;
  stage: string;
  amount: string | null;
  reasons: string[];
  daysInStage: number | null;
  stallThresholdDays: number | null;
  daysSinceActivity: number;
}
export interface SalesRepRow {
  userId: string;
  name: string;
  openDeals: number;
  openValue: string;
  won: number;
  lost: number;
  wonRevenue: string;
  winRate: number | null;
  calls: number;
  meetings: number;
  tasksCompleted: number;
}
export interface SalesMetricsDoc {
  currency: string;
  periodStart: string;
  periodEnd: string;
  metrics: SalesMetric[];
  funnel: SalesFunnelStep[];
  pipelineByStage: { stage: string; count: number; value: string; weighted: string }[];
  wonDeals: { dealId: string; name: string; owner: string; ownerId: string; amount: string | null; cycleDays: number | null }[];
  lostDeals: { dealId: string; name: string; owner: string; ownerId: string; amount: string | null; reason: string }[];
  lostReasons: { reason: string; count: number }[];
  reps: SalesRepRow[];
  attention: SalesAttentionDeal[];
  leadSources: { source: string; created: number; converted: number }[];
  unviewedProposals: { proposalId: string; title: string; dealId: string; dealName: string; owner: string; ownerId: string; daysSinceSent: number }[];
}
export type SalesSignalKind = 'trend' | 'bottleneck' | 'risk' | 'opportunity' | 'concentration' | 'team';
/** A finding computed by code (never by AI). The AI may only explain and act on these. */
export interface SalesSignal {
  id: string;
  kind: SalesSignalKind;
  severity: 'high' | 'medium' | 'low';
  /** What was found, in one plain sentence built by code from the values. */
  title: string;
  metricIds: string[];
  /** Evidence records: `deal:<id>`, `user:<id>`, `proposal:<id>`. */
  recordIds: string[];
  values: Record<string, string | number | null>;
}
export const SALES_BRIEF_SECTIONS = ['headline', 'insights', 'actions', 'throughput', 'wins', 'pipeline', 'risks', 'team'] as const;
export type SalesBriefSection = (typeof SALES_BRIEF_SECTIONS)[number];
export interface SalesBriefStatement extends WeeklyStatement {
  /** Insights and actions: the signals the sentence is about. */
  signalIds?: string[];
  kind?: SalesSignalKind;
}
export type SalesBriefNarrative = Record<SalesBriefSection, SalesBriefStatement[]>;
export type SheetPublishStatus = 'disabled' | 'pending' | 'published' | 'failed';
export interface SalesBriefSettings {
  enabled: boolean;
  /** ISO weekday the weekly run becomes due: 1 = Monday … 7 = Sunday. */
  runWeekday: number;
  /** Local time (organization time zone), "HH:MM". */
  runTime: string;
  /** The admin on whose behalf the brief runs; null = the earliest active admin. */
  ownerUserId: string | null;
}

export const salesBriefRun = pgTable(
  'sales_brief_run',
  {
    id: id(),
    runAsUserId: uuid('run_as_user_id').references(() => appUserProfile.userId),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    timeZone: text('time_zone').notNull(),
    attempt: integer('attempt').notNull().default(1),
    trigger: text('trigger').$type<'schedule' | 'manual'>().notNull(),
    status: text('status').$type<WeeklyRunStatus>().notNull().default('queued'),
    snapshotFileId: uuid('snapshot_file_id'),
    snapshotSha256: char('snapshot_sha256', { length: 64 }),
    metrics: jsonb('metrics').$type<SalesMetricsDoc>(),
    signals: jsonb('signals').$type<SalesSignal[]>().notNull().default([]),
    narrative: jsonb('narrative').$type<SalesBriefNarrative>(),
    checkFlags: jsonb('check_flags').$type<WeeklyFlag[]>().notNull().default([]),
    aiGenerationId: uuid('ai_generation_id'),
    aiFallback: boolean('ai_fallback').notNull().default(false),
    draftPptxFileId: uuid('draft_pptx_file_id'),
    draftXlsxFileId: uuid('draft_xlsx_file_id'),
    finalPptxFileId: uuid('final_pptx_file_id'),
    finalPptxSha256: char('final_pptx_sha256', { length: 64 }),
    xlsxFileId: uuid('xlsx_file_id'),
    xlsxSha256: char('xlsx_sha256', { length: 64 }),
    sheetStatus: text('sheet_status').$type<SheetPublishStatus>().notNull().default('disabled'),
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
    uniqueIndex('sales_brief_run_period_attempt_uq').on(t.periodStart, t.attempt),
    index('sales_brief_run_period_idx').on(t.periodStart, t.attempt),
    index('sales_brief_run_status_idx').on(t.status),
  ],
);
