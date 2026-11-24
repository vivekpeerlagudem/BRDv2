-- Weekly Report Agents: optional link from a company to the client's estimates sheet in Google Sheets (read-only).
-- Used only when ESTIMATES_SOURCE=google; CSV upload keeps working without it.
CREATE TABLE client_estimate_source (
  company_id uuid PRIMARY KEY REFERENCES company(id),
  google_spreadsheet_id text NOT NULL,
  google_range text NOT NULL DEFAULT 'A1:Z2000',
  linked_by uuid NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  row_version integer NOT NULL DEFAULT 1
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON client_estimate_source TO crm_app;
