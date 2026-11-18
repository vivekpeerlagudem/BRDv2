# Database ER Diagrams — Internal Sales CRM (Phase 1)

Physical ER diagrams for the schema specified in DATABASE-DESIGN.md (authoritative for columns, types, constraints and indexes). Diagrams show primary keys, foreign keys and the attributes that matter for relationships and lifecycle; audit columns (`created_*`, `updated_*`, `row_version`, `archived_*`) are omitted for readability.

Cardinality notation (Mermaid `erDiagram`): `||--o{` one-to-zero-or-many, `||--|{` one-to-one-or-many, `|o--o{` zero-or-one to many, `||--||` one-to-one.

## 1. Overview (aggregate roots and principal relationships)

```mermaid
erDiagram
  APP_USER_PROFILE ||--o| TEAM_MEMBERSHIP : "belongs to (0..1 team)"
  TEAM ||--o{ TEAM_MEMBERSHIP : has
  TEAM ||--|{ TEAM_MANAGER : "managed by"
  APP_USER_PROFILE ||--o{ COMPANY : owns
  APP_USER_PROFILE ||--o{ CONTACT : owns
  APP_USER_PROFILE ||--o{ DEAL : owns
  COMPANY ||--o{ CONTACT : "primary company of"
  COMPANY ||--o{ DEAL : "has"
  PIPELINE ||--|{ PIPELINE_STAGE : contains
  DEAL }o--|| PIPELINE_STAGE : "is at"
  DEAL ||--o{ DEAL_CONTACT : "stakeholders"
  CONTACT ||--o{ DEAL_CONTACT : "participates"
  DEAL ||--o{ PROPOSAL : "has 0..*"
  PROPOSAL ||--|{ PROPOSAL_VERSION : versions
  PROPOSAL }o--|| TEMPLATE_VERSION : "pins"
  PROPOSAL_VERSION ||--o{ RECIPIENT : "sent to"
  RECIPIENT ||--|| SHARE_LINK : "has one"
  PROPOSAL_VERSION ||--o{ SIGNATURE_REQUEST : "signed via"
  SIGNATURE_REQUEST ||--|{ SIGNER : has
  SIGNATURE_REQUEST ||--o| SIGNED_DOCUMENT : produces
  MAILBOX_CONNECTION ||--o{ EMAIL_MESSAGE : syncs
  EMAIL_MESSAGE ||--o{ EMAIL_LINK : "linked to records"
  DEAL ||--o{ TASK : "related (polymorphic)"
  DEAL ||--o{ TIMELINE_EVENT_ANCHOR : "timeline"
  TIMELINE_EVENT ||--|{ TIMELINE_EVENT_ANCHOR : anchored
```

## 2. Identity

```mermaid
erDiagram
  AUTH_USER ||--|| APP_USER_PROFILE : "profile (same id)"
  AUTH_USER ||--o{ AUTH_SESSION : sessions
  AUTH_USER ||--o{ AUTH_ACCOUNT : "credentials/OAuth"
  AUTH_USER ||--o| AUTH_TWO_FACTOR : totp
  APP_USER_PROFILE ||--o| TEAM_MEMBERSHIP : member
  TEAM ||--o{ TEAM_MEMBERSHIP : members
  TEAM ||--o{ TEAM_MANAGER : managers
  APP_USER_PROFILE ||--o{ TEAM_MANAGER : manages
  APP_USER_PROFILE ||--o{ INVITATION : "invited_by"
  TEAM |o--o{ INVITATION : "target team"
  ORGANIZATION_SETTINGS |o--o| APP_USER_PROFILE : "default_lead_owner"

  AUTH_USER { uuid id PK text email boolean two_factor_enabled }
  AUTH_SESSION { uuid id PK uuid user_id FK text token UK text kind "web|addin" timestamptz expires_at }
  APP_USER_PROFILE { uuid user_id PK,FK text normalized_email UK text role "admin|sales_manager|salesperson" text status "invited|active|deactivated" boolean can_manage_content }
  TEAM { uuid id PK text name }
  TEAM_MEMBERSHIP { uuid user_id PK,FK uuid team_id FK boolean is_active }
  TEAM_MANAGER { uuid team_id PK,FK uuid user_id PK,FK }
  INVITATION { uuid id PK text normalized_email char64 token_hash UK text status timestamptz expires_at }
  ORGANIZATION_SETTINGS { smallint id PK "=1" char3 default_currency text mfa_policy jsonb ai_settings }
```

## 3. CRM core

```mermaid
erDiagram
  COMPANY ||--o{ CONTACT : "company_id (0..1 per contact)"
  COMPANY ||--o{ DEAL : "company_id (required)"
  PIPELINE ||--|{ PIPELINE_STAGE : stages
  PIPELINE ||--o{ DEAL : pipeline_id
  PIPELINE_STAGE ||--o{ DEAL : stage_id
  DEAL ||--o{ DEAL_CONTACT : stakeholders
  CONTACT ||--o{ DEAL_CONTACT : roles
  DEAL_CONTACT ||--|{ DEAL_CONTACT_ROLE : "1..* roles"
  CONTACT_ROLE ||--o{ DEAL_CONTACT_ROLE : role
  DEAL ||--o{ DEAL_STAGE_HISTORY : history
  LOST_REASON |o--o{ DEAL : "lost_reason_id"
  DEAL |o--o| PROPOSAL : "won_from_proposal_id"
  APP_USER_PROFILE ||--o{ TASK : assignee
  ACTIVITY_LOG ||--o{ ACTIVITY_LOG_PARTICIPANT : participants
  CONTACT ||--o{ ACTIVITY_LOG_PARTICIPANT : participant
  APP_USER_PROFILE ||--o{ SAVED_VIEW : owns

  COMPANY { uuid id PK text normalized_domain "UK when active" uuid owner_id FK jsonb custom_fields }
  CONTACT { uuid id PK text normalized_email "UK when active" uuid company_id FK "nullable" uuid owner_id FK }
  DEAL { uuid id PK uuid company_id FK uuid owner_id FK uuid pipeline_id FK uuid stage_id FK text status "open|won|lost" numeric amount char3 currency date close_date }
  DEAL_CONTACT { uuid id PK uuid deal_id FK uuid contact_id FK boolean is_primary text added_via }
  PIPELINE_STAGE { uuid id PK uuid pipeline_id FK text kind "open|won|lost" int sort_order numeric probability int stall_threshold_days }
  DEAL_STAGE_HISTORY { uuid id PK uuid deal_id FK uuid from_stage_id uuid to_stage_id jsonb actor }
  TASK { uuid id PK text related_type uuid related_id uuid assignee_id FK timestamptz due_at text status text source }
  NOTE { uuid id PK text related_type uuid related_id uuid author_id FK }
  ACTIVITY_LOG { uuid id PK text kind "call|meeting" text related_type uuid related_id }
  CUSTOM_FIELD_DEFINITION { uuid id PK text object_type text key text data_type }
```

## 4. Catalog, templates and proposals

```mermaid
erDiagram
  TAX_CATEGORY ||--o{ PRODUCT : tax
  PRODUCT ||--|{ PRODUCT_PRICE : "prices per currency"
  PROPOSAL_TEMPLATE ||--|{ TEMPLATE_VERSION : versions
  PROPOSAL_TEMPLATE |o--o| TEMPLATE_VERSION : "current_published_version"
  TEMPLATE_VERSION ||--o{ PROPOSAL : "pinned by"
  DEAL ||--o{ PROPOSAL : proposals
  PROPOSAL ||--|{ PROPOSAL_VERSION : versions
  PROPOSAL_VERSION |o--o{ PROPOSAL_VERSION : "based_on"
  PROPOSAL_VERSION ||--o{ PRICING_TABLE : tables
  PRICING_TABLE ||--|{ PRICING_LINE : lines
  PRODUCT |o--o{ PRICING_LINE : "snapshot source"
  PROPOSAL_VERSION ||--o{ GENERATED_FILE : renditions
  PROPOSAL_VERSION ||--o{ PROPOSAL_SEND_ATTEMPT : "send attempts"
  PROPOSAL_VERSION ||--o{ AI_CHECK_RESULT : "pre-send checks"
  FILE_OBJECT ||--o{ GENERATED_FILE : stores

  PROPOSAL { uuid id PK uuid deal_id FK uuid template_version_id FK text status "draft|sent|viewed|accepted|signed|declined|expired|void" uuid current_version_id FK uuid last_sent_version_id FK date valid_until boolean signature_required }
  PROPOSAL_VERSION { uuid id PK uuid proposal_id FK int version_number text state "draft|sent|superseded|signed" jsonb content jsonb totals char64 snapshot_sha256 char64 pdf_sha256 }
  PRICING_TABLE { uuid id PK uuid proposal_version_id FK text section_id text overall_discount_type }
  PRICING_LINE { uuid id PK uuid pricing_table_id FK text line_key numeric quantity numeric unit_price text billing_type text billing_period numeric line_total }
  TEMPLATE_VERSION { uuid id PK uuid template_id FK int version_number text state "draft|published|retired" jsonb content }
  PROPOSAL_SEND_ATTEMPT { uuid id PK uuid proposal_version_id FK text channel text status timestamptz expires_at }
  CONTENT_BLOCK { uuid id PK text category int revision }
  DISCOUNT_LIMIT { text role PK numeric max_line_discount_percent numeric max_overall_discount_percent }
  EXCHANGE_RATE { uuid id PK char3 from_currency char3 to_currency numeric rate date effective_from }
```

## 5. Sharing and e-signature

```mermaid
erDiagram
  PROPOSAL_VERSION ||--o{ RECIPIENT : recipients
  DEAL_CONTACT ||--o{ RECIPIENT : "is"
  RECIPIENT ||--|| SHARE_LINK : link
  SHARE_LINK ||--o{ BUYER_SESSION : "cookie sessions"
  SHARE_LINK ||--o{ VIEWER_IDENTITY : viewers
  VIEWER_IDENTITY |o--o| DEAL_CONTACT : "resolved stakeholder"
  VIEWER_IDENTITY ||--o{ VIEW_SESSION : views
  VIEWER_IDENTITY ||--o{ DOWNLOAD_EVENT : downloads
  PROPOSAL_VERSION ||--o| BUYER_RESPONSE : "accept/decline (first wins)"
  BUYER_SESSION ||--o{ EMAIL_VERIFICATION_CHALLENGE : otp
  PROPOSAL_VERSION ||--o{ SIGNATURE_REQUEST : requests
  DEAL ||--o{ SIGNATURE_REQUEST : "≤1 open (partial unique)"
  SIGNATURE_REQUEST ||--|{ SIGNER : signers
  DEAL_CONTACT ||--o{ SIGNER : "signer is deal contact"
  SIGNATURE_REQUEST ||--o{ SIGNATURE_EVENT : evidence
  SIGNATURE_REQUEST ||--o| SIGNED_DOCUMENT : result
  ESIGN_WEBHOOK_INBOX }o..o| SIGNATURE_REQUEST : "processed into"

  SHARE_LINK { uuid id PK uuid recipient_id FK,UK char64 token_hash UK text token_ciphertext text link_handle UK text status "active|revoked|expired" timestamptz expires_at }
  BUYER_SESSION { uuid id PK char64 session_hash UK uuid share_link_id FK uuid viewer_identity_id FK }
  VIEWER_IDENTITY { uuid id PK uuid share_link_id FK text normalized_email boolean is_original_recipient }
  VIEW_SESSION { uuid id PK uuid share_link_id FK timestamptz started_at int active_seconds boolean is_first_view_of_proposal }
  SIGNATURE_REQUEST { uuid id PK uuid proposal_version_id FK uuid deal_id FK text status "pending|sent|viewed|signed|declined|expired|voided" char64 document_sha256 text signing_order boolean stale_completion }
  SIGNER { uuid id PK uuid signature_request_id FK uuid deal_contact_id FK smallint sign_order text status }
  SIGNATURE_EVENT { uuid id PK uuid signature_request_id FK text type text provider_event_id UK }
  SIGNED_DOCUMENT { uuid id PK uuid signature_request_id FK,UK char64 signed_pdf_sha256 char64 certificate_sha256 }
  ESIGN_WEBHOOK_INBOX { uuid id PK text provider text provider_event_id text status }
```

## 6. Communications, leads and import

```mermaid
erDiagram
  APP_USER_PROFILE ||--o| MAILBOX_CONNECTION : "one mailbox"
  MAILBOX_CONNECTION ||--o{ EMAIL_THREAD : threads
  EMAIL_THREAD ||--|{ EMAIL_MESSAGE : messages
  EMAIL_MESSAGE ||--|{ EMAIL_MESSAGE_PARTICIPANT : participants
  CONTACT |o--o{ EMAIL_MESSAGE_PARTICIPANT : "matched contact"
  EMAIL_MESSAGE ||--o{ EMAIL_LINK : links
  MAILBOX_CONNECTION ||--o{ OUTBOUND_EMAIL : sends
  OUTBOUND_EMAIL ||--o| EMAIL_TRACKING : "open tracking"
  MAILBOX_CONNECTION ||--o{ CALENDAR_EVENT : events
  CALENDAR_EVENT ||--|{ CALENDAR_EVENT_ATTENDEE : attendees
  CALENDAR_EVENT ||--o{ CALENDAR_EVENT_LINK : links
  LEAD_FORM ||--o{ LEAD_FORM_SUBMISSION : submissions
  LEAD_FORM ||--o{ LEAD_FORM_ASSIGNMENT_RULE : "ordered rules"
  ASSIGNMENT_RULE ||--o{ LEAD_FORM_ASSIGNMENT_RULE : used
  ASSIGNMENT_RULE ||--|{ ASSIGNMENT_RULE_MEMBER : pool
  ASSIGNMENT_RULE ||--o| ASSIGNMENT_STATE : cursor
  IMPORT_BATCH ||--|{ IMPORT_ROW : rows
  IMPORT_BATCH ||--o{ IMPORT_RECORD_LINK : "undo links"
  IMPORT_ROW ||--o{ IMPORT_RECORD_LINK : produced

  MAILBOX_CONNECTION { uuid id PK uuid user_id FK,UK text provider "google|microsoft" text status text encrypted_tokens text mail_sync_cursor }
  EMAIL_MESSAGE { uuid id PK uuid mailbox_connection_id FK text provider_message_id text internet_message_id text direction boolean is_private }
  EMAIL_LINK { uuid id PK uuid email_message_id FK text target_type uuid target_id text link_source boolean review_suggested }
  OUTBOUND_EMAIL { uuid id PK uuid crm_send_id UK text status "queued|sending|sent|failed|unknown" }
  LEAD_FORM { uuid id PK text public_key UK text status jsonb fields }
  LEAD_FORM_SUBMISSION { uuid id PK uuid lead_form_id FK text spam_verdict text processing_status }
  IMPORT_BATCH { uuid id PK text source text status jsonb counts }
```

## 7. AI, notifications, automation, timeline and platform

```mermaid
erDiagram
  PROMPT_VERSION ||--o{ AI_GENERATION : "ran with"
  PROMPT_VERSION ||--o{ AI_USAGE : "ran with"
  AI_GENERATION |o--|| AI_USAGE : "cost record"
  PROPOSAL_VERSION ||--o{ AI_CHECK_RESULT : checks
  APP_USER_PROFILE ||--o{ NOTIFICATION : receives
  APP_USER_PROFILE ||--o{ NOTIFICATION_PREFERENCE : prefers
  APP_USER_PROFILE ||--o{ DIGEST_RUN : digests
  PIPELINE |o--o{ AUTOMATION_SETTING : "per-pipeline config"
  AUTOMATION_EXECUTION ||--o{ DEAL_FLAG : raises
  DEAL ||--o{ DEAL_FLAG : flags
  TIMELINE_EVENT ||--|{ TIMELINE_EVENT_ANCHOR : anchors
  AUDIT_LOG ||--|| AUDIT_CHAIN : "sealed as"
  AUDIT_CHAIN }o--o| AUDIT_ANCHOR : "anchored up to"
  FILE_OBJECT ||--o{ EXPORT_JOB : archive
  ENCRYPTION_KEY ||--o{ MAILBOX_CONNECTION : "kid in ciphertext"

  AI_GENERATION { uuid id PK text feature uuid requested_by FK jsonb target text status }
  AI_USAGE { uuid id PK text feature text model int input_tokens int output_tokens numeric estimated_cost text outcome }
  NOTIFICATION { uuid id PK bigint seq UK uuid recipient_user_id FK text event_type text dedupe_key UK timestamptz read_at }
  AUTOMATION_SETTING { uuid id PK text rule_key uuid pipeline_id FK boolean enabled jsonb config }
  AUTOMATION_EXECUTION { uuid id PK text rule_key text idempotency_key UK text status jsonb before_snapshot jsonb related_changes }
  DEAL_FLAG { uuid id PK uuid deal_id FK text kind "stalled|past_close_date|signed_on_stale_version" timestamptz cleared_at }
  TIMELINE_EVENT { uuid id PK text event_type text source_type uuid source_id text actor_type boolean is_automated }
  TIMELINE_EVENT_ANCHOR { text record_type PK uuid record_id PK timestamptz occurred_at PK uuid timeline_event_id PK,FK }
  AUDIT_LOG { uuid id PK bigint seq text action text target_type uuid target_id text outcome }
  AUDIT_CHAIN { bigint seq PK char64 row_hash char64 chain_hash }
  DOMAIN_EVENT { uuid id PK text name text aggregate_type uuid aggregate_id }
  FILE_OBJECT { uuid id PK text storage_key UK char64 sha256 text purpose boolean immutable }
  IDEMPOTENCY_KEY { text scope PK text key PK char64 request_hash text status }
  RETENTION_POLICY { text category PK int retention_days text action boolean exempt }
  ERASURE_REQUEST { uuid id PK uuid subject_id text status }
```

## 8. Workflow → entity coverage check

| Workflow (WORKFLOWS.md) | Entities written | Covered |
|---|---|---|
| Lead capture → assignment (BR-LED-001..005) | lead_form_submission, company, contact, deal, deal_contact, assignment_state, notification, timeline | ✓ |
| Import + undo (BR-MIG-001..005) | import_batch, import_row, import_record_link, company/contact/deal | ✓ |
| Mailbox sync & linking (BR-EML-001..003, 006) | mailbox_connection, email_thread/message/participant/link, calendar_event/attendee/link, email_exclusion | ✓ |
| Send from CRM (BR-EML-004, 007) | outbound_email, email_tracking, email_template | ✓ |
| Proposal create/edit/version (BR-PRP-001..010, BR-PRC-002..007) | proposal, proposal_version, pricing_table, pricing_line, generated_file, discount_limit, exchange_rate | ✓ |
| AI drafting / pre-send / summary (BR-AIA-001..009) | ai_generation, ai_check_result, ai_usage, prompt_version | ✓ |
| Send + share + track (BR-SHR-001..009, BR-NTF-001) | proposal_send_attempt, recipient, share_link, buyer_session, viewer_identity, view_session, download_event, notification | ✓ |
| Accept/decline without signature (BR-SHR-010, OD-17) | buyer_response, proposal, task | ✓ |
| E-signature (BR-SIG-001..013) | signature_request, signer, signature_event, signed_document, esign_webhook_inbox | ✓ |
| Automation + reversal (BR-AUT-001..008) | automation_setting, automation_execution, deal_flag, deal_stage_history, task | ✓ |
| Reporting (BR-RPT-001..010) | read-only over deal, deal_stage_history, proposal, proposal_version, share_link, view_session, signature_request, email_message, calendar_event, task, activity_log | ✓ |
| Timeline (BR-TIM-001..004) | timeline_event, timeline_event_anchor | ✓ |
| Audit/export/erasure (BR-PLT-009/010, NFR-002/015) | audit_log, audit_chain, audit_anchor, export_job, file_object, retention_policy, erasure_request | ✓ |
