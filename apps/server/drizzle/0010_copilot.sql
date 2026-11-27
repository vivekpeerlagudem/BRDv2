-- Kensium Copilot: the agentic layer (conversations, runs, the action ledger, lead assignments with SLA, record
-- scores) and the optional Kensium qualification fields on leads. Purely additive; forward-only.

-- One chat thread per user. Readable only by its owner through the API; purged after expires_at.
CREATE TABLE copilot_conversation (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES app_user_profile(user_id),
  title text NOT NULL DEFAULT 'New conversation',
  context_ref jsonb,
  role_at_start text NOT NULL,
  summary text,
  summarized_through integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX copilot_conversation_user_idx ON copilot_conversation(user_id, last_at DESC);
--> statement-breakpoint
CREATE INDEX copilot_conversation_expiry_idx ON copilot_conversation(expires_at);
--> statement-breakpoint
-- Turn history: user text, assistant text + tool calls, tool results, rolling summaries. Never copied to logs.
CREATE TABLE copilot_message (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  conversation_id uuid NOT NULL REFERENCES copilot_conversation(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  role text NOT NULL CHECK (role IN ('user','assistant','tool','summary')),
  content jsonb NOT NULL,
  tainted boolean NOT NULL DEFAULT false,
  run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT copilot_message_seq_uq UNIQUE (conversation_id, seq)
);
--> statement-breakpoint
-- One row per agent run (a chat turn or a background job). Metadata only; append-only for the app role.
CREATE TABLE agent_run (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('chat','triage','my_day','digest','handoff','home','eval')),
  trigger text NOT NULL,
  principal_user_id uuid NOT NULL,
  principal_role text NOT NULL,
  conversation_id uuid,
  status text NOT NULL CHECK (status IN ('completed','failed','capped','refused','blocked','skipped')),
  steps integer NOT NULL DEFAULT 0,
  tool_calls integer NOT NULL DEFAULT 0,
  auto_writes integer NOT NULL DEFAULT 0,
  proposals integer NOT NULL DEFAULT 0,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cache_read_tokens integer NOT NULL DEFAULT 0,
  cost_micro_usd bigint,
  latency_ms integer,
  first_token_ms integer,
  provider text NOT NULL,
  model text NOT NULL,
  simulated boolean NOT NULL DEFAULT false,
  tainted boolean NOT NULL DEFAULT false,
  grounding_failures integer NOT NULL DEFAULT 0,
  injection_flags integer NOT NULL DEFAULT 0,
  error_code text,
  idempotency_key text UNIQUE,
  request_id text,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX agent_run_time_idx ON agent_run(started_at);
--> statement-breakpoint
CREATE INDEX agent_run_user_idx ON agent_run(principal_user_id, started_at);
--> statement-breakpoint
-- The action ledger: everything the agent did on its own (with its Undo recipe) and everything waiting for a person.
CREATE TABLE agent_action (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  run_id uuid,
  conversation_id uuid,
  principal_user_id uuid NOT NULL REFERENCES app_user_profile(user_id),
  tool text NOT NULL,
  tier text NOT NULL CHECK (tier IN ('auto','approval','draft')),
  status text NOT NULL CHECK (status IN ('proposed','approved','rejected','executed','undone','expired','failed')),
  summary text NOT NULL,
  args jsonb NOT NULL,
  target_type text,
  target_id uuid,
  result jsonb,
  undo jsonb,
  row_version_seen integer,
  tainted boolean NOT NULL DEFAULT false,
  decided_by uuid,
  decided_at timestamptz,
  expires_at timestamptz,
  undo_until timestamptz,
  error_code text,
  idempotency_key text UNIQUE,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX agent_action_user_idx ON agent_action(principal_user_id, status, created_at DESC);
--> statement-breakpoint
CREATE INDEX agent_action_target_idx ON agent_action(target_type, target_id);
--> statement-breakpoint
-- Accept-and-escalate: one row per routed lead (or web-form deal). Timers are deterministic code, never the AI.
CREATE TABLE work_assignment (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  record_type text NOT NULL CHECK (record_type IN ('lead','deal')),
  record_id uuid NOT NULL,
  record_label text NOT NULL,
  assignee_id uuid NOT NULL REFERENCES app_user_profile(user_id),
  assigned_by uuid,
  source text NOT NULL CHECK (source IN ('web_form','manual','reassignment')),
  assigned_at timestamptz NOT NULL,
  accept_due_at timestamptz NOT NULL,
  reminder_at timestamptz,
  reminded_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','escalated_manager','escalated_admin','superseded')),
  accepted_at timestamptz,
  accepted_by uuid,
  declined_at timestamptz,
  decline_reason text,
  escalation_level integer NOT NULL DEFAULT 0,
  escalated_to uuid,
  escalated_at timestamptz,
  escalation_due_at timestamptz,
  first_contact_at timestamptz,
  first_contact_ref uuid,
  minutes_to_accept integer,
  business_minutes_to_accept integer,
  accepted_within_sla boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX work_assignment_assignee_idx ON work_assignment(assignee_id, status);
--> statement-breakpoint
CREATE INDEX work_assignment_due_idx ON work_assignment(status, accept_due_at);
--> statement-breakpoint
CREATE INDEX work_assignment_record_idx ON work_assignment(record_type, record_id);
--> statement-breakpoint
-- Deterministic lead/deal score: computed by code from named factors; the model only writes the reason.
CREATE TABLE record_score (
  record_type text NOT NULL CHECK (record_type IN ('lead','deal')),
  record_id uuid NOT NULL,
  score smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  band char(1) NOT NULL CHECK (band IN ('A','B','C')),
  factors jsonb NOT NULL,
  missing text[] NOT NULL DEFAULT '{}',
  tags text[] NOT NULL DEFAULT '{}',
  reason text,
  scoring_version integer NOT NULL DEFAULT 1,
  scored_by_run uuid,
  scored_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (record_type, record_id)
);
--> statement-breakpoint
ALTER TABLE organization_settings ADD COLUMN copilot_settings jsonb NOT NULL DEFAULT '{}';
--> statement-breakpoint
-- Optional Kensium qualification fields (all nullable; values come from fixed lists validated by the API).
ALTER TABLE lead
  ADD COLUMN industry text,
  ADD COLUMN current_platform text,
  ADD COLUMN company_size_band text,
  ADD COLUMN service_interest text[],
  ADD COLUMN budget_band text,
  ADD COLUMN timeline text;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON copilot_conversation, copilot_message, agent_action, work_assignment, record_score TO crm_app;
--> statement-breakpoint
-- agent_run is append-only for the application role, like ai_usage.
GRANT SELECT, INSERT ON agent_run TO crm_app;
