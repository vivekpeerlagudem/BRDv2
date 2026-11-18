CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer,
	"outcome" text,
	"notes" text,
	"related_type" text NOT NULL,
	"related_id" uuid NOT NULL,
	"logged_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_generation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"feature" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"deal_id" uuid,
	"target" jsonb NOT NULL,
	"prompt_version" text NOT NULL,
	"output" jsonb,
	"status" text NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"feature" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"user_id" uuid,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"outcome" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_user_profile" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"normalized_email" text NOT NULL,
	"full_name" text NOT NULL,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"can_manage_content" boolean DEFAULT false NOT NULL,
	"round_robin_eligible" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "app_user_profile_normalized_email_unique" UNIQUE("normalized_email")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"changes" jsonb,
	"request_id" text,
	"outcome" text DEFAULT 'success' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_verification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_execution" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"rule_key" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"status" text NOT NULL,
	"skip_reason" text,
	"before_snapshot" jsonb,
	"after_snapshot" jsonb,
	"related_changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_task_id" uuid,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	CONSTRAINT "automation_execution_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "buyer_response" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"proposal_version_id" uuid NOT NULL,
	"share_link_id" uuid NOT NULL,
	"viewer_identity_id" uuid NOT NULL,
	"response" text NOT NULL,
	"reason" text,
	"evidence" jsonb NOT NULL,
	"responded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buyer_response_proposal_version_id_unique" UNIQUE("proposal_version_id")
);
--> statement-breakpoint
CREATE TABLE "buyer_session" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"session_hash" char(64) NOT NULL,
	"share_link_id" uuid NOT NULL,
	"viewer_identity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "buyer_session_session_hash_unique" UNIQUE("session_hash")
);
--> statement-breakpoint
CREATE TABLE "company" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"domain" text,
	"normalized_domain" text,
	"owner_id" uuid NOT NULL,
	"industry" text,
	"phone" text,
	"website" text,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"first_name" text,
	"last_name" text,
	"email" text,
	"normalized_email" text,
	"phone" text,
	"job_title" text,
	"company_id" uuid,
	"owner_id" uuid NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"company_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"amount" numeric(18, 2),
	"currency" char(3) NOT NULL,
	"amount_source" text DEFAULT 'manual' NOT NULL,
	"close_date" date,
	"closed_at" timestamp with time zone,
	"lost_reason_id" uuid,
	"lost_reason_note" text,
	"won_from_proposal_id" uuid,
	"last_activity_at" timestamp with time zone,
	"stage_entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_contact" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"deal_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"roles" text[] DEFAULT '{}' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"added_via" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_flag" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"deal_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "deal_stage_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"deal_id" uuid NOT NULL,
	"from_stage_id" uuid,
	"to_stage_id" uuid NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" uuid,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "download_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"share_link_id" uuid NOT NULL,
	"viewer_identity_id" uuid NOT NULL,
	"format" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "esign_webhook_inbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_body" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_object" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" char(64) NOT NULL,
	"purpose" text NOT NULL,
	"immutable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_object_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "job_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"queue" text NOT NULL,
	"payload" jsonb NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_form_submission" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"spam_verdict" text NOT NULL,
	"processing_status" text NOT NULL,
	"contact_id" uuid,
	"company_id" uuid,
	"deal_id" uuid,
	"assigned_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "lost_reason" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "lost_reason_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "note" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"body" text NOT NULL,
	"related_type" text NOT NULL,
	"related_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "notification_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"recipient_user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"deal_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link_path" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"email_status" text DEFAULT 'not_sent' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "organization_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"organization_name" text NOT NULL,
	"default_currency" char(3) NOT NULL,
	"time_zone" text NOT NULL,
	"locale" text DEFAULT 'en-US' NOT NULL,
	"branding" jsonb NOT NULL,
	"salesperson_cross_visibility" jsonb NOT NULL,
	"ai_settings" jsonb NOT NULL,
	"proposal_defaults" jsonb NOT NULL,
	"automation_settings" jsonb NOT NULL,
	"default_lead_owner_id" uuid,
	"free_mail_domains" text[] NOT NULL,
	"privacy_notice_text" text NOT NULL,
	"lead_form_key" text NOT NULL,
	"lead_round_robin_cursor" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_stage" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"sort_order" integer NOT NULL,
	"probability" numeric(7, 4) NOT NULL,
	"stall_threshold_days" integer,
	"is_proposal_sent_target" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sku" text,
	"unit" text NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"tax_rate_percent" numeric(7, 4) DEFAULT '0' NOT NULL,
	"billing_type" text NOT NULL,
	"billing_period" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"deal_id" uuid NOT NULL,
	"title" text NOT NULL,
	"template_version_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_version_id" uuid,
	"last_sent_version_id" uuid,
	"valid_until" date,
	"signature_required" boolean DEFAULT true NOT NULL,
	"void_reason" text,
	"void_kind" text,
	"status_before_void" text,
	"decline_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal_template" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"current_published_version_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal_version" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"schema_version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"pricing" jsonb NOT NULL,
	"term_months" integer NOT NULL,
	"totals" jsonb NOT NULL,
	"missing_placeholders" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sent_at" timestamp with time zone,
	"sent_by" uuid,
	"frozen_snapshot" jsonb,
	"snapshot_sha256" char(64),
	"pdf_file_id" uuid,
	"pdf_sha256" char(64),
	"docx_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_bucket" (
	"bucket_key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "rate_limit_bucket_bucket_key_window_start_pk" PRIMARY KEY("bucket_key","window_start")
);
--> statement-breakpoint
CREATE TABLE "share_link" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"proposal_version_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_email" text NOT NULL,
	"token_hash" char(64) NOT NULL,
	"token_ciphertext" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"first_viewed_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "share_link_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "signature_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"signature_request_id" uuid NOT NULL,
	"signer_id" uuid,
	"type" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_event_id" text,
	"source" text NOT NULL,
	CONSTRAINT "signature_event_provider_event_id_unique" UNIQUE("provider_event_id")
);
--> statement-breakpoint
CREATE TABLE "signature_request" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"proposal_version_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_envelope_id" text,
	"signing_order" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"document_sha256" char(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"void_reason" text,
	"decline_reason" text,
	"completed_at" timestamp with time zone,
	"stale_completion" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signed_document" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"signature_request_id" uuid NOT NULL,
	"signed_pdf_file_id" uuid NOT NULL,
	"signed_pdf_sha256" char(64) NOT NULL,
	"certificate_file_id" uuid NOT NULL,
	"certificate_sha256" char(64) NOT NULL,
	"source_document_sha256" char(64) NOT NULL,
	"sealed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "signed_document_signature_request_id_unique" UNIQUE("signature_request_id")
);
--> statement-breakpoint
CREATE TABLE "signer" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"signature_request_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"sign_order" integer NOT NULL,
	"status" text NOT NULL,
	"consent_captured_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"ip_address" text
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"related_type" text NOT NULL,
	"related_id" uuid NOT NULL,
	"assignee_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"completed_at" timestamp with time zone,
	"source" text DEFAULT 'manual' NOT NULL,
	"automation_execution_id" uuid,
	"reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_manager" (
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "team_manager_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "team_membership" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_version" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"template_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"state" text NOT NULL,
	"schema_version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timeline_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event_type" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"actor_name" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"summary" text NOT NULL,
	"is_automated" boolean DEFAULT false NOT NULL,
	"automation_execution_id" uuid
);
--> statement-breakpoint
CREATE TABLE "timeline_event_anchor" (
	"timeline_event_id" uuid NOT NULL,
	"record_type" text NOT NULL,
	"record_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "timeline_event_anchor_record_type_record_id_occurred_at_timeline_event_id_pk" PRIMARY KEY("record_type","record_id","occurred_at","timeline_event_id")
);
--> statement-breakpoint
CREATE TABLE "view_session" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"share_link_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"viewer_identity_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"active_seconds" integer DEFAULT 0 NOT NULL,
	"counted" boolean DEFAULT false NOT NULL,
	"is_reopen" boolean DEFAULT false NOT NULL,
	"section_seconds" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "viewer_identity" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"share_link_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_email" text NOT NULL,
	"is_original_recipient" boolean NOT NULL,
	"contact_id" uuid,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_logged_by_app_user_profile_user_id_fk" FOREIGN KEY ("logged_by") REFERENCES "public"."app_user_profile"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user_profile" ADD CONSTRAINT "app_user_profile_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_response" ADD CONSTRAINT "buyer_response_proposal_version_id_proposal_version_id_fk" FOREIGN KEY ("proposal_version_id") REFERENCES "public"."proposal_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_session" ADD CONSTRAINT "buyer_session_share_link_id_share_link_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."share_link"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_owner_id_app_user_profile_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user_profile"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_owner_id_app_user_profile_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user_profile"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_owner_id_app_user_profile_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user_profile"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_pipeline_id_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipeline"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_stage_id_pipeline_stage_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stage"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_lost_reason_id_lost_reason_id_fk" FOREIGN KEY ("lost_reason_id") REFERENCES "public"."lost_reason"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_contact" ADD CONSTRAINT "deal_contact_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_contact" ADD CONSTRAINT "deal_contact_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_flag" ADD CONSTRAINT "deal_flag_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "deal_stage_history_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "download_event" ADD CONSTRAINT "download_event_share_link_id_share_link_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."share_link"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_author_id_app_user_profile_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."app_user_profile"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_user_id_app_user_profile_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."app_user_profile"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stage" ADD CONSTRAINT "pipeline_stage_pipeline_id_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipeline"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_template_version_id_template_version_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."template_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_version" ADD CONSTRAINT "proposal_version_proposal_id_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_proposal_version_id_proposal_version_id_fk" FOREIGN KEY ("proposal_version_id") REFERENCES "public"."proposal_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_proposal_id_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_event" ADD CONSTRAINT "signature_event_signature_request_id_signature_request_id_fk" FOREIGN KEY ("signature_request_id") REFERENCES "public"."signature_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_request" ADD CONSTRAINT "signature_request_proposal_id_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_request" ADD CONSTRAINT "signature_request_proposal_version_id_proposal_version_id_fk" FOREIGN KEY ("proposal_version_id") REFERENCES "public"."proposal_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_request" ADD CONSTRAINT "signature_request_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signed_document" ADD CONSTRAINT "signed_document_signature_request_id_signature_request_id_fk" FOREIGN KEY ("signature_request_id") REFERENCES "public"."signature_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signer" ADD CONSTRAINT "signer_signature_request_id_signature_request_id_fk" FOREIGN KEY ("signature_request_id") REFERENCES "public"."signature_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signer" ADD CONSTRAINT "signer_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_assignee_id_app_user_profile_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."app_user_profile"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_manager" ADD CONSTRAINT "team_manager_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_manager" ADD CONSTRAINT "team_manager_user_id_app_user_profile_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user_profile"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_membership" ADD CONSTRAINT "team_membership_user_id_app_user_profile_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user_profile"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_membership" ADD CONSTRAINT "team_membership_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_version" ADD CONSTRAINT "template_version_template_id_proposal_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."proposal_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_event_anchor" ADD CONSTRAINT "timeline_event_anchor_timeline_event_id_timeline_event_id_fk" FOREIGN KEY ("timeline_event_id") REFERENCES "public"."timeline_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_session" ADD CONSTRAINT "view_session_share_link_id_share_link_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."share_link"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewer_identity" ADD CONSTRAINT "viewer_identity_share_link_id_share_link_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."share_link"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_target_idx" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_domain_uq" ON "company" USING btree ("normalized_domain") WHERE archived_at is null and normalized_domain is not null;--> statement-breakpoint
CREATE INDEX "company_owner_idx" ON "company" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_email_uq" ON "contact" USING btree ("normalized_email") WHERE archived_at is null and normalized_email is not null;--> statement-breakpoint
CREATE INDEX "contact_company_idx" ON "contact" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "contact_owner_idx" ON "contact" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "deal_owner_status_idx" ON "deal" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "deal_company_idx" ON "deal" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "deal_stage_idx" ON "deal" USING btree ("stage_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_contact_uq" ON "deal_contact" USING btree ("deal_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_flag_one_open" ON "deal_flag" USING btree ("deal_id","kind") WHERE cleared_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "esign_inbox_uq" ON "esign_webhook_inbox" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "job_outbox_pending_idx" ON "job_outbox" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notification" USING btree ("recipient_user_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "stage_order_uq" ON "pipeline_stage" USING btree ("pipeline_id","sort_order");--> statement-breakpoint
CREATE INDEX "proposal_deal_idx" ON "proposal" USING btree ("deal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pv_number_uq" ON "proposal_version" USING btree ("proposal_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "pv_one_draft" ON "proposal_version" USING btree ("proposal_id") WHERE state = 'draft';--> statement-breakpoint
CREATE INDEX "share_link_version_idx" ON "share_link" USING btree ("proposal_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sr_one_open_per_deal" ON "signature_request" USING btree ("deal_id") WHERE status in ('pending','sent','viewed');--> statement-breakpoint
CREATE INDEX "task_assignee_idx" ON "task" USING btree ("assignee_id","status");--> statement-breakpoint
CREATE INDEX "task_related_idx" ON "task" USING btree ("related_type","related_id");--> statement-breakpoint
CREATE UNIQUE INDEX "template_version_uq" ON "template_version" USING btree ("template_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "template_one_draft" ON "template_version" USING btree ("template_id") WHERE state = 'draft';--> statement-breakpoint
CREATE INDEX "view_session_link_idx" ON "view_session" USING btree ("share_link_id");--> statement-breakpoint
CREATE UNIQUE INDEX "viewer_identity_uq" ON "viewer_identity" USING btree ("share_link_id","normalized_email");