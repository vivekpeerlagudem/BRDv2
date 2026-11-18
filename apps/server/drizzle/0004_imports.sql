-- CSV import (BR-MIG-001/003/004/005; DATABASE-DESIGN §11, simplified to one entity type per batch and CSV only).
-- Additive only: three new tables and one narrowly scoped function used by import undo.
CREATE TABLE import_batch (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  source text NOT NULL DEFAULT 'csv' CHECK (source IN ('csv')),
  entity_type text NOT NULL CHECK (entity_type IN ('companies','contacts','deals')),
  file_name text NOT NULL,
  headers jsonb NOT NULL,
  row_count integer NOT NULL,
  mapping jsonb NULL,
  duplicate_strategy text NULL CHECK (duplicate_strategy IN ('skip','create')),
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','validated','committed','failed','partially_undone','undone')),
  counts jsonb NOT NULL DEFAULT '{}',
  failure_reason text NULL,
  validated_at timestamptz NULL,
  committed_at timestamptz NULL,
  undone_at timestamptz NULL,
  undone_by uuid NULL REFERENCES app_user_profile(user_id),
  undo_report jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES app_user_profile(user_id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX import_batch_created_idx ON import_batch (created_at DESC);
--> statement-breakpoint
CREATE TABLE import_row (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  batch_id uuid NOT NULL REFERENCES import_batch(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  raw_data jsonb NOT NULL,
  mapped_data jsonb NULL,
  validation_errors jsonb NOT NULL DEFAULT '[]',
  warnings jsonb NOT NULL DEFAULT '[]',
  duplicate jsonb NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','valid','invalid','duplicate')),
  outcome text NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','created','skipped')),
  UNIQUE (batch_id, row_number)
);
--> statement-breakpoint
CREATE INDEX import_row_batch_status_idx ON import_row (batch_id, status);
--> statement-breakpoint
CREATE TABLE import_record_link (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  batch_id uuid NOT NULL REFERENCES import_batch(id),
  row_id uuid NOT NULL REFERENCES import_row(id),
  record_type text NOT NULL CHECK (record_type IN ('company','contact','deal')),
  record_id uuid NOT NULL,
  record_label text NOT NULL,
  action text NOT NULL DEFAULT 'created' CHECK (action IN ('created')),
  -- sha256 of the record exactly as the import wrote it; undo refuses a record whose current state differs.
  snapshot_sha256 char(64) NOT NULL,
  undo_outcome text NULL CHECK (undo_outcome IN ('removed','kept_modified','kept_referenced','already_gone')),
  undo_detail text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (record_type, record_id)
);
--> statement-breakpoint
CREATE INDEX import_record_link_batch_idx ON import_record_link (batch_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON import_batch TO crm_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON import_row TO crm_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON import_record_link TO crm_app;
--> statement-breakpoint
-- deal_stage_history is append-only for crm_app (0001_constraints). Import undo hard-deletes a deal that the import
-- itself created (RULE-MIG-10), which needs that deal's "created" history row removed first. This function is the only
-- way to do that, and it only works for a deal recorded in import_record_link as created by the given batch.
CREATE FUNCTION import_undo_purge_deal_history(p_batch uuid, p_deal uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM import_record_link WHERE batch_id = p_batch AND record_type = 'deal' AND record_id = p_deal AND action = 'created') THEN
    RAISE EXCEPTION 'IMPORT_UNDO_NOT_LINKED' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM deal_stage_history WHERE deal_id = p_deal;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION import_undo_purge_deal_history(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION import_undo_purge_deal_history(uuid, uuid) TO crm_app;
