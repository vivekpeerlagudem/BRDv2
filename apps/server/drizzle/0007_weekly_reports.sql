-- Weekly Report Agents (prototype, part 1): a client's estimates (scope) sheet imported as CSV, and one weekly
-- status report run per company and week. Purely additive.
CREATE TABLE estimate_import (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES company(id),
  source text NOT NULL DEFAULT 'csv' CHECK (source IN ('csv','google')),
  file_name text NOT NULL,
  row_count integer NOT NULL,
  imported_by uuid NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX estimate_import_company_idx ON estimate_import(company_id, imported_at DESC);
--> statement-breakpoint
CREATE TABLE estimate_item (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  import_id uuid NOT NULL REFERENCES estimate_import(id),
  company_id uuid NOT NULL REFERENCES company(id),
  row_no integer NOT NULL,
  scope_id text,
  title text NOT NULL,
  phase text,
  estimate_hours numeric(10,2) NOT NULL CHECK (estimate_hours >= 0),
  sheet_status text CHECK (sheet_status IN ('not_started','in_progress','done')),
  pct_done numeric(5,2),
  actual_hours numeric(10,2)
);
--> statement-breakpoint
CREATE INDEX estimate_item_import_idx ON estimate_item(import_id);
--> statement-breakpoint
CREATE INDEX estimate_item_company_idx ON estimate_item(company_id);
--> statement-breakpoint
CREATE TABLE weekly_report_run (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  company_id uuid NOT NULL REFERENCES company(id),
  run_as_user_id uuid NOT NULL REFERENCES app_user_profile(user_id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  time_zone text NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  trigger text NOT NULL CHECK (trigger IN ('schedule','manual')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','ready','needs_attention','approved','failed')),
  estimate_import_id uuid,
  snapshot_file_id uuid,
  snapshot_sha256 char(64),
  metrics jsonb,
  narrative jsonb,
  check_flags jsonb NOT NULL DEFAULT '[]',
  ai_generation_id uuid,
  ai_fallback boolean NOT NULL DEFAULT false,
  draft_pptx_file_id uuid,
  final_pptx_file_id uuid,
  final_pptx_sha256 char(64),
  approved_by uuid,
  approved_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT weekly_report_run_period_attempt_uq UNIQUE (company_id, period_start, attempt),
  CONSTRAINT weekly_report_run_approved_chk CHECK (
    status <> 'approved' OR (final_pptx_file_id IS NOT NULL AND final_pptx_sha256 IS NOT NULL AND approved_at IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX weekly_report_run_company_idx ON weekly_report_run(company_id, period_start DESC);
--> statement-breakpoint
CREATE INDEX weekly_report_run_status_idx ON weekly_report_run(status);
--> statement-breakpoint
ALTER TABLE organization_settings
  ADD COLUMN weekly_report_settings jsonb NOT NULL DEFAULT '{"enabled":true,"runWeekday":1,"runTime":"09:00"}';
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON estimate_import TO crm_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON estimate_item TO crm_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON weekly_report_run TO crm_app;
