/** Drizzle definitions for the CSV import tables (drizzle/0004_imports.sql). */
import { sql } from 'drizzle-orm';
import { char, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
const ts = (name: string) => timestamp(name, { withTimezone: true });

export type ImportEntity = 'companies' | 'contacts' | 'deals';
export type ImportBatchStatus = 'uploaded' | 'validated' | 'committed' | 'failed' | 'partially_undone' | 'undone';
export type ImportRowStatus = 'pending' | 'valid' | 'invalid' | 'duplicate';
export type ImportUndoOutcome = 'removed' | 'kept_modified' | 'kept_referenced' | 'already_gone';
export interface ImportCellError {
  field: string | null;
  column: string | null;
  message: string;
}
export interface ImportDuplicate {
  kind: 'existing' | 'in_file';
  /** What matched, in words (for example "domain acme.example"). */
  matchedOn: string;
  existingId?: string;
  existingLabel?: string;
  firstRowNumber?: number;
  /** False when the data model forbids a second record (unique domain, unique email). */
  canCreate: boolean;
}
export interface ImportCounts {
  total?: number;
  valid?: number;
  invalid?: number;
  duplicate?: number;
  duplicateCreatable?: number;
  warnings?: number;
  created?: number;
  skipped?: number;
}
export interface ImportUndoItem {
  recordType: 'company' | 'contact' | 'deal';
  recordId: string;
  label: string;
  outcome: ImportUndoOutcome;
  detail: string | null;
}
export interface ImportUndoReport {
  removed: number;
  kept: number;
  items: ImportUndoItem[];
}

export const importBatch = pgTable(
  'import_batch',
  {
    id: id(),
    source: text('source').notNull().default('csv'),
    entityType: text('entity_type').$type<ImportEntity>().notNull(),
    fileName: text('file_name').notNull(),
    headers: jsonb('headers').$type<string[]>().notNull(),
    rowCount: integer('row_count').notNull(),
    mapping: jsonb('mapping').$type<(string | null)[]>(),
    duplicateStrategy: text('duplicate_strategy').$type<'skip' | 'create'>(),
    status: text('status').$type<ImportBatchStatus>().notNull().default('uploaded'),
    counts: jsonb('counts').$type<ImportCounts>().notNull().default({}),
    failureReason: text('failure_reason'),
    validatedAt: ts('validated_at'),
    committedAt: ts('committed_at'),
    undoneAt: ts('undone_at'),
    undoneBy: uuid('undone_by'),
    undoReport: jsonb('undo_report').$type<ImportUndoReport>(),
    createdAt: ts('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('import_batch_created_idx').on(t.createdAt)],
);

export const importRow = pgTable(
  'import_row',
  {
    id: id(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => importBatch.id, { onDelete: 'cascade' }),
    rowNumber: integer('row_number').notNull(),
    rawData: jsonb('raw_data').$type<string[]>().notNull(),
    mappedData: jsonb('mapped_data').$type<Record<string, string>>(),
    validationErrors: jsonb('validation_errors').$type<ImportCellError[]>().notNull().default([]),
    warnings: jsonb('warnings').$type<ImportCellError[]>().notNull().default([]),
    duplicate: jsonb('duplicate').$type<ImportDuplicate>(),
    status: text('status').$type<ImportRowStatus>().notNull().default('pending'),
    outcome: text('outcome').$type<'pending' | 'created' | 'skipped'>().notNull().default('pending'),
  },
  (t) => [uniqueIndex('import_row_batch_id_row_number_key').on(t.batchId, t.rowNumber), index('import_row_batch_status_idx').on(t.batchId, t.status)],
);

export const importRecordLink = pgTable(
  'import_record_link',
  {
    id: id(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => importBatch.id),
    rowId: uuid('row_id')
      .notNull()
      .references(() => importRow.id),
    recordType: text('record_type').$type<'company' | 'contact' | 'deal'>().notNull(),
    recordId: uuid('record_id').notNull(),
    recordLabel: text('record_label').notNull(),
    action: text('action').notNull().default('created'),
    snapshotSha256: char('snapshot_sha256', { length: 64 }).notNull(),
    undoOutcome: text('undo_outcome').$type<ImportUndoOutcome>(),
    undoDetail: text('undo_detail'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('import_record_link_batch_idx').on(t.batchId)],
);
