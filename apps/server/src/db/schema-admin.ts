/**
 * Administration view of `lost_reason`, including the `is_active` column added by drizzle/0003_admin.sql.
 * Kept apart from schema.ts so the shared schema file stays untouched; it maps the same table.
 */
import { sql } from 'drizzle-orm';
import { boolean, pgTable, text, uuid } from 'drizzle-orm/pg-core';

export const lostReasonAdmin = pgTable('lost_reason', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  name: text('name').notNull().unique(),
  isActive: boolean('is_active').notNull().default(true),
});
