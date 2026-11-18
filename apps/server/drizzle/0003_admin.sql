-- Administration: lost reasons can be retired (BR-CRM-014) without touching the deals that already use them.
-- Additive only: no column or table is dropped or rewritten.
ALTER TABLE lost_reason ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
--> statement-breakpoint
-- Audit log viewer (BR-PLT-009): newest-first paging and filtering by actor.
CREATE INDEX IF NOT EXISTS audit_log_seq_idx ON audit_log (seq DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log (actor_user_id, seq DESC);
