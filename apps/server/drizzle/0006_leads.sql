-- Managed leads (BR-LED): manually captured prospects with a qualification lifecycle that convert into
-- company + contact + deal. Separate from lead_form_submission (raw inbound intake).
CREATE TABLE lead (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name text NOT NULL,
  company_name text,
  email text,
  normalized_email text,
  phone text,
  job_title text,
  source text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'new',
  owner_id uuid NOT NULL REFERENCES app_user_profile(user_id),
  notes text,
  disqualify_reason text,
  converted_company_id uuid REFERENCES company(id),
  converted_contact_id uuid REFERENCES contact(id),
  converted_deal_id uuid REFERENCES deal(id),
  converted_at timestamptz,
  custom_fields jsonb NOT NULL DEFAULT '{}',
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  row_version integer NOT NULL DEFAULT 1
);
CREATE INDEX lead_owner_idx ON lead(owner_id);
CREATE INDEX lead_status_idx ON lead(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON lead TO crm_app;
