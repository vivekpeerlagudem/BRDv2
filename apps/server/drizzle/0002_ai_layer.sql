-- AI intelligence layer: provenance on generations, richer usage metadata, AI-assisted review results.
-- Additive only: no column or table is dropped or rewritten.
ALTER TABLE ai_generation
  ADD COLUMN provider text,
  ADD COLUMN model text,
  ADD COLUMN simulated boolean NOT NULL DEFAULT false,
  ADD COLUMN request_id uuid,
  ADD COLUMN context_refs jsonb,
  ADD COLUMN accepted_output jsonb,
  ADD COLUMN decided_by uuid;
--> statement-breakpoint
ALTER TABLE ai_generation ADD CONSTRAINT ai_generation_status_check
  CHECK (status IN ('pending','accepted','edited_accepted','rejected','failed','discarded'));
--> statement-breakpoint
CREATE INDEX ai_generation_requester_idx ON ai_generation (requested_by, created_at DESC);
--> statement-breakpoint
ALTER TABLE ai_usage
  ADD COLUMN request_id uuid,
  ADD COLUMN correlation_id text,
  ADD COLUMN provider_request_id text,
  ADD COLUMN deal_id uuid,
  ADD COLUMN prompt_version text,
  ADD COLUMN latency_ms integer,
  ADD COLUMN attempts integer NOT NULL DEFAULT 1,
  ADD COLUMN cache_read_tokens integer NOT NULL DEFAULT 0,
  ADD COLUMN cache_write_tokens integer NOT NULL DEFAULT 0,
  ADD COLUMN cost_micro_usd integer,
  ADD COLUMN error_code text,
  ADD COLUMN simulated boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE INDEX ai_usage_occurred_idx ON ai_usage (occurred_at DESC);
--> statement-breakpoint
CREATE INDEX ai_usage_user_idx ON ai_usage (user_id, occurred_at DESC);
--> statement-breakpoint
CREATE TABLE ai_review (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  proposal_id uuid NOT NULL REFERENCES proposal(id),
  proposal_version_id uuid NOT NULL REFERENCES proposal_version(id),
  version_row_version integer NOT NULL,
  requested_by uuid NOT NULL,
  ai_status text NOT NULL CHECK (ai_status IN ('completed','disabled','failed')),
  findings jsonb NOT NULL,
  request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX ai_review_proposal_idx ON ai_review (proposal_id, created_at DESC);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_review TO crm_app;
