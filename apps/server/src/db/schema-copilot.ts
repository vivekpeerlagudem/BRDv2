/**
 * Drizzle schema for the Kensium Copilot (drizzle/0010_copilot.sql): conversations, agent runs, the action ledger,
 * lead assignments with their SLA clock, and deterministic record scores. Kept beside schema.ts like the other
 * feature schemas. The six optional lead fields and organization_settings.copilot_settings live in schema.ts.
 */
import { sql } from 'drizzle-orm';
import { bigint, boolean, char, index, integer, jsonb, pgTable, primaryKey, smallint, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { AiContentBlock } from '../platform/ports.ts';
import { appUserProfile } from './schema.ts';

const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
const ts = (name: string) => timestamp(name, { withTimezone: true });

export type CopilotRole = 'admin' | 'sales_manager' | 'salesperson';
/** What the user has open when asking: the Copilot side panel sends it with every turn. */
export interface CopilotContextRef {
  type: 'company' | 'contact' | 'deal' | 'lead' | 'proposal';
  id: string;
}
/** Admin settings; every field is optional in storage and filled with defaults by `resolveCopilotSettings`. */
export interface CopilotSettings {
  enabled?: boolean;
  roles?: Partial<Record<CopilotRole, boolean>>;
  /** Auto tools the organization lets the agent run without asking. Off → the tool becomes an approval card. */
  autonomy?: Partial<Record<'create_task' | 'add_ai_note' | 'set_lead_score', boolean>>;
  acceptSlaHours?: number;
  escalationSlaHours?: number;
  calendar?: { workdays?: number[]; start?: string; end?: string; holidays?: string[] };
  retentionDays?: number;
  models?: { main?: string | null; fast?: string | null };
  monthlyBudgetUsd?: number;
  perUserDailyTurns?: number;
  /** Industries that earn the "focus industry" fit points in lead scoring. */
  focusIndustries?: string[];
  /** Month (YYYY-MM) for which the 80 % budget alert was already sent. */
  budgetAlertMonth?: string | null;
}

export const copilotConversation = pgTable(
  'copilot_conversation',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUserProfile.userId),
    title: text('title').notNull().default('New conversation'),
    contextRef: jsonb('context_ref').$type<CopilotContextRef | null>(),
    roleAtStart: text('role_at_start').$type<CopilotRole>().notNull(),
    /** Rolling summary of turns older than the verbatim window. */
    summary: text('summary'),
    summarizedThrough: integer('summarized_through').notNull().default(0),
    /** Short record aliases the model has seen in this conversation (D1 → deal id …), so later turns can refer to them. */
    aliasMap: jsonb('alias_map').$type<Record<string, { type: string; id: string; label: string }>>().notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastAt: ts('last_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [index('copilot_conversation_user_idx').on(t.userId, t.lastAt), index('copilot_conversation_expiry_idx').on(t.expiresAt)],
);

export const copilotMessage = pgTable(
  'copilot_message',
  {
    id: id(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => copilotConversation.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    role: text('role').$type<'user' | 'assistant' | 'tool' | 'summary'>().notNull(),
    content: jsonb('content').$type<AiContentBlock[]>().notNull(),
    tainted: boolean('tainted').notNull().default(false),
    runId: uuid('run_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [unique('copilot_message_seq_uq').on(t.conversationId, t.seq)],
);

export type AgentRunKind = 'chat' | 'triage' | 'my_day' | 'digest' | 'handoff' | 'home' | 'eval';
export type AgentRunStatus = 'completed' | 'failed' | 'capped' | 'refused' | 'blocked' | 'skipped';
/** Metadata only — never prompts, answers or tool payloads. Append-only for the application role. */
export const agentRun = pgTable(
  'agent_run',
  {
    id: uuid('id').primaryKey(),
    kind: text('kind').$type<AgentRunKind>().notNull(),
    trigger: text('trigger').notNull(),
    principalUserId: uuid('principal_user_id').notNull(),
    principalRole: text('principal_role').$type<CopilotRole>().notNull(),
    conversationId: uuid('conversation_id'),
    status: text('status').$type<AgentRunStatus>().notNull(),
    steps: integer('steps').notNull().default(0),
    toolCalls: integer('tool_calls').notNull().default(0),
    autoWrites: integer('auto_writes').notNull().default(0),
    proposals: integer('proposals').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    costMicroUsd: bigint('cost_micro_usd', { mode: 'number' }),
    latencyMs: integer('latency_ms'),
    firstTokenMs: integer('first_token_ms'),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    simulated: boolean('simulated').notNull().default(false),
    tainted: boolean('tainted').notNull().default(false),
    groundingFailures: integer('grounding_failures').notNull().default(0),
    injectionFlags: integer('injection_flags').notNull().default(0),
    errorCode: text('error_code'),
    idempotencyKey: text('idempotency_key').unique(),
    requestId: text('request_id'),
    startedAt: ts('started_at').notNull(),
    finishedAt: ts('finished_at').notNull().defaultNow(),
  },
  (t) => [index('agent_run_time_idx').on(t.startedAt), index('agent_run_user_idx').on(t.principalUserId, t.startedAt)],
);

export type ActionTier = 'auto' | 'approval' | 'draft';
export type ActionStatus = 'proposed' | 'approved' | 'rejected' | 'executed' | 'undone' | 'expired' | 'failed';
/** How to reverse an executed auto action, and what the record must still look like for the reversal to be safe. */
export interface UndoRecipe {
  kind: 'cancel_task' | 'delete_note' | 'restore_score';
  targetId: string;
  /** Values written by the action; Undo refuses when the record no longer matches them. */
  after?: Record<string, unknown>;
  /** Values to put back (restore_score: the previous score row, or null when there was none). */
  before?: Record<string, unknown> | null;
}
export const agentAction = pgTable(
  'agent_action',
  {
    id: id(),
    runId: uuid('run_id'),
    conversationId: uuid('conversation_id'),
    principalUserId: uuid('principal_user_id')
      .notNull()
      .references(() => appUserProfile.userId),
    tool: text('tool').notNull(),
    tier: text('tier').$type<ActionTier>().notNull(),
    status: text('status').$type<ActionStatus>().notNull(),
    /** One plain sentence a person reads on the card ("Move Stark ERP to Negotiation"). Built by code, not the model. */
    summary: text('summary').notNull(),
    args: jsonb('args').$type<Record<string, unknown>>().notNull(),
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    result: jsonb('result').$type<Record<string, unknown> | null>(),
    undo: jsonb('undo').$type<UndoRecipe | null>(),
    rowVersionSeen: integer('row_version_seen'),
    tainted: boolean('tainted').notNull().default(false),
    decidedBy: uuid('decided_by'),
    decidedAt: ts('decided_at'),
    expiresAt: ts('expires_at'),
    undoUntil: ts('undo_until'),
    errorCode: text('error_code'),
    idempotencyKey: text('idempotency_key').unique(),
    requestId: text('request_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('agent_action_user_idx').on(t.principalUserId, t.status, t.createdAt), index('agent_action_target_idx').on(t.targetType, t.targetId)],
);

export type AssignmentStatus = 'pending' | 'accepted' | 'declined' | 'escalated_manager' | 'escalated_admin' | 'superseded';
export const workAssignment = pgTable(
  'work_assignment',
  {
    id: id(),
    recordType: text('record_type').$type<'lead' | 'deal'>().notNull(),
    recordId: uuid('record_id').notNull(),
    recordLabel: text('record_label').notNull(),
    assigneeId: uuid('assignee_id')
      .notNull()
      .references(() => appUserProfile.userId),
    assignedBy: uuid('assigned_by'),
    source: text('source').$type<'web_form' | 'manual' | 'reassignment'>().notNull(),
    assignedAt: ts('assigned_at').notNull(),
    acceptDueAt: ts('accept_due_at').notNull(),
    reminderAt: ts('reminder_at'),
    remindedAt: ts('reminded_at'),
    status: text('status').$type<AssignmentStatus>().notNull().default('pending'),
    acceptedAt: ts('accepted_at'),
    acceptedBy: uuid('accepted_by'),
    declinedAt: ts('declined_at'),
    declineReason: text('decline_reason'),
    escalationLevel: integer('escalation_level').notNull().default(0),
    escalatedTo: uuid('escalated_to'),
    escalatedAt: ts('escalated_at'),
    escalationDueAt: ts('escalation_due_at'),
    firstContactAt: ts('first_contact_at'),
    firstContactRef: uuid('first_contact_ref'),
    minutesToAccept: integer('minutes_to_accept'),
    businessMinutesToAccept: integer('business_minutes_to_accept'),
    acceptedWithinSla: boolean('accepted_within_sla'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('work_assignment_assignee_idx').on(t.assigneeId, t.status),
    index('work_assignment_due_idx').on(t.status, t.acceptDueAt),
    index('work_assignment_record_idx').on(t.recordType, t.recordId),
  ],
);

export interface ScoreFactor {
  group: 'fit' | 'intent' | 'engagement' | 'quality' | 'penalty';
  factor: string;
  field: string;
  value: string | null;
  points: number;
  max: number;
}
export const recordScore = pgTable(
  'record_score',
  {
    recordType: text('record_type').$type<'lead' | 'deal'>().notNull(),
    recordId: uuid('record_id').notNull(),
    score: smallint('score').notNull(),
    band: char('band', { length: 1 }).$type<'A' | 'B' | 'C'>().notNull(),
    factors: jsonb('factors').$type<ScoreFactor[]>().notNull(),
    missing: text('missing').array().notNull().default([]),
    tags: text('tags').array().notNull().default([]),
    reason: text('reason'),
    scoringVersion: integer('scoring_version').notNull().default(1),
    scoredByRun: uuid('scored_by_run'),
    scoredAt: ts('scored_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.recordType, t.recordId] })],
);
