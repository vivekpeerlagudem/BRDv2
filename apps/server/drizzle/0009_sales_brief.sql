-- Weekly Sales Brief: one company-wide report per week for leadership (Admin role), independent of any deal or
-- client. Mirrors weekly_report_run, plus the spreadsheet file and the code-computed signals. Purely additive.
CREATE TABLE sales_brief_run (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  run_as_user_id uuid REFERENCES app_user_profile(user_id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  time_zone text NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  trigger text NOT NULL CHECK (trigger IN ('schedule','manual')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','ready','needs_attention','approved','failed')),
  snapshot_file_id uuid,
  snapshot_sha256 char(64),
  metrics jsonb,
  signals jsonb NOT NULL DEFAULT '[]',
  narrative jsonb,
  check_flags jsonb NOT NULL DEFAULT '[]',
  ai_generation_id uuid,
  ai_fallback boolean NOT NULL DEFAULT false,
  draft_pptx_file_id uuid,
  draft_xlsx_file_id uuid,
  final_pptx_file_id uuid,
  final_pptx_sha256 char(64),
  xlsx_file_id uuid,
  xlsx_sha256 char(64),
  sheet_status text NOT NULL DEFAULT 'disabled' CHECK (sheet_status IN ('disabled','pending','published','failed')),
  approved_by uuid,
  approved_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT sales_brief_run_period_attempt_uq UNIQUE (period_start, attempt),
  CONSTRAINT sales_brief_run_approved_chk CHECK (
    status <> 'approved'
    OR (final_pptx_file_id IS NOT NULL AND final_pptx_sha256 IS NOT NULL AND xlsx_file_id IS NOT NULL AND xlsx_sha256 IS NOT NULL AND approved_at IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX sales_brief_run_period_idx ON sales_brief_run(period_start DESC, attempt DESC);
--> statement-breakpoint
CREATE INDEX sales_brief_run_status_idx ON sales_brief_run(status);
--> statement-breakpoint
ALTER TABLE organization_settings
  ADD COLUMN sales_brief_settings jsonb NOT NULL DEFAULT '{"enabled":true,"runWeekday":1,"runTime":"08:00","ownerUserId":null}';
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON sales_brief_run TO crm_app;
