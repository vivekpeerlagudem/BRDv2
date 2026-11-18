# Database Design — Internal Sales CRM (Phase 1)

| Item | Value |
|---|---|
| Engine | PostgreSQL 18 (17 fallback, ADR-032) |
| ORM / migrations | Drizzle ORM schema in `apps/server/src/db/schema/<module>.ts`; drizzle-kit generated SQL migrations, reviewed and committed; executed only by the `migrate` release job (ADR-030, ADR-050) |
| Source of truth | ../01-specifications/DOMAIN-MODEL.md (entities/attributes), BUSINESS-RULES.md (rules, SM-01..SM-10), ROLE-PERMISSION-MATRIX.md (visibility) |
| Diagrams | DATABASE-ERD.md |
| Tenancy | Single tenant (IDD-01): BR-PLT-001 is satisfied by a dedicated deployment and database; no tenant/org id columns; `organization_settings` singleton holds BR-PLT-012 settings |

The DDL below is a **design specification** written in PostgreSQL syntax so it is unambiguous. The Drizzle schema must produce exactly these tables, columns, constraints and indexes. Names are `snake_case`; API/TypeScript names are the camelCase equivalents.

---

## 1. Conventions

### 1.1 Types
| Concept | Column type | Notes |
|---|---|---|
| Primary key | `uuid` default `uuidv7()` (PG 18) or app-generated UUIDv7 (PG 17) | Time-ordered → good B-tree locality |
| Timestamps | `timestamptz` | Always UTC; display in org/user time zone |
| Calendar dates | `date` | Interpreted in org time zone (close date, valid until) |
| Money amount | `numeric(18,2)` | Never `float` |
| Unit price | `numeric(18,4)` | |
| Quantity | `numeric(14,4)` | |
| Percent | `numeric(7,4)` | 0–100 |
| Currency | `char(3)` | ISO-4217, upper case, CHECK `~ '^[A-Z]{3}$'` |
| Email (normalised) | `text` | `lower(trim(email))`; stored next to the display value |
| Enumerations | `text` + `CHECK (col IN (...))` | No PG enum types (easier expand/contract migrations) |
| Hash | `char(64)` | Lower-case hex SHA-256 |
| Encrypted value | `text` | Envelope JSON `{"v":1,"kid":"...","iv":"...","ct":"...","tag":"..."}` (ADR-073) |
| Structured value | `jsonb` | Validated by Zod in the service layer; shape documented per column |

### 1.2 Standard column groups
- **AUDIT** (all mutable tables):
  `created_at timestamptz NOT NULL DEFAULT now()`, `created_by uuid NULL REFERENCES app_user_profile(user_id)`, `created_by_actor text NOT NULL DEFAULT 'user' CHECK (created_by_actor IN ('user','buyer','system','ai'))`, `updated_at timestamptz NOT NULL DEFAULT now()`, `updated_by uuid NULL REFERENCES app_user_profile(user_id)`, `row_version integer NOT NULL DEFAULT 1`.
  `row_version` is incremented by every UPDATE issued through repositories (`SET row_version = row_version + 1 WHERE id = $1 AND row_version = $expected`); 0 rows affected → `CONCURRENT_MODIFICATION` (409).
- **ARCHIVE** (archivable tables): `archived_at timestamptz NULL`, `archived_by uuid NULL REFERENCES app_user_profile(user_id)`. Partial indexes use `WHERE archived_at IS NULL`.
- **APPEND-ONLY** tables have `created_at` (or `occurred_at`) only; the `app` DB role is granted INSERT/SELECT only on them where noted.

### 1.3 Ownership and visibility columns
| Record | Visibility root | Column(s) used by `scopeFilter` (ADR-076) |
|---|---|---|
| company | itself | `owner_id`; plus deal-derived read (R6): any visible deal with `deal.company_id = company.id` |
| contact | itself | `owner_id`; plus deal-derived read: `deal_contact` of a visible deal |
| deal | itself | `owner_id` |
| proposal, proposal_version, recipient, share_link, viewer_identity, view_session, buyer_response, signature_request, signer, ai_generation(target deal) | parent deal | `deal_id` (denormalised on proposal, signature_request) |
| task, note, activity_log | related record (`related_type`,`related_id`) | resolved to the related record's rule; task assignee always sees their tasks |
| email_message / calendar_event | linked records + mailbox owner | `email_link`/`calendar_event_link` targets; mailbox owner always; private content per OD-30 |
| timeline_event | `source_type`,`source_id` | evaluated via source record visibility (ROLE-PERMISSION-MATRIX §5) |

TeamScope(actor) = `{actor.user_id} ∪ members(active or inactive) and co-managers of teams the actor manages` (R7). Computed once per request into an array and cached (ADR-054); SQL predicate: `owner_id = ANY($teamScopeIds)`.

### 1.4 Database roles and grants (ADR-026, ADR-050)
| Role | Grants |
|---|---|
| `crm_migrator` | Owner of schemas `public`, `pgboss`; DDL |
| `crm_app` | SELECT/INSERT/UPDATE/DELETE on business tables; **INSERT/SELECT only** on `audit_log`, `domain_event`, `signature_event`, `view_session`*, `download_event`, `ai_usage`, `deal_stage_history`, `timeline_event`, `timeline_event_anchor` (*`view_session` also UPDATE of `last_heartbeat_at, ended_at, active_seconds`); no DDL; USAGE on `pgboss` |
| `crm_renderer` | SELECT on `proposal_version`, `pricing_table`, `pricing_line`, `organization_settings`, `file_object`; INSERT/UPDATE on `generated_file`, `file_object`; pgboss usage for queue `pdf` |
| `crm_sealer` (used by `audit.seal` job connection) | SELECT on `audit_log`; INSERT on `audit_chain` |
| `crm_readonly` | SELECT on all except secret-bearing columns (column privileges exclude `*_ciphertext`, `encrypted_tokens`, `token_hash`, `code_hash`, Better Auth tables) |

### 1.5 Extensions
`pgcrypto` (digest for triggers), `pg_trgm` (fuzzy name matching, OD-27 suggestions), `citext` not used (explicit normalised columns instead), `btree_gin` (combined GIN indexes).

---

## 2. Identity module

```sql
-- Singleton (IDD-01). The CHECK on id enforces exactly one row.
CREATE TABLE organization_settings (
  id                     smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  organization_name      text NOT NULL CHECK (length(organization_name) BETWEEN 1 AND 200),
  default_currency       char(3) NOT NULL,
  enabled_currencies     char(3)[] NOT NULL,
  time_zone              text NOT NULL,                     -- IANA
  locale                 text NOT NULL DEFAULT 'en-US',     -- BCP-47
  fiscal_year_start_month smallint NOT NULL DEFAULT 1 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  branding               jsonb NOT NULL,   -- {logoFileId, primaryColor, secondaryColor, fontFamily, buyerFooterText}
  buyer_link_domain      text NULL,
  salesperson_cross_visibility jsonb NOT NULL DEFAULT '{"companies":"none","contacts":"none","deals":"none"}',
  login_methods          jsonb NOT NULL,   -- {password, google, microsoft, allowedDomains[], microsoftTenantId}
  mfa_policy             text NOT NULL DEFAULT 'required_admins' CHECK (mfa_policy IN ('optional','required_admins','required_all')),
  ai_settings            jsonb NOT NULL,   -- {enabled, features{draft_section,rewrite_text,deal_summary,follow_up_email,presend_llm}, monthlyBudget{amount,currency}, perUserDailyCalls}
  email_open_tracking_allowed boolean NOT NULL DEFAULT false,      -- OD-37
  esign_defaults         jsonb NOT NULL,   -- {reminderScheduleDays[], requestExpiryDays, smsVerificationAllowed}
  share_defaults         jsonb NOT NULL,   -- {defaultLinkExpiryDays, linkExpiringNoticeHours, requireEmailVerificationDefault}
  proposal_defaults      jsonb NOT NULL,   -- {defaultTermMonths:12, defaultValidityDays}
  automation_defaults    jsonb NOT NULL DEFAULT '{}',              -- see automation_setting for per-pipeline values
  default_lead_owner_id  uuid NULL,        -- FK added after app_user_profile
  free_mail_domains      text[] NOT NULL,
  internal_domains       text[] NOT NULL,
  privacy_notice_text    text NOT NULL,
  privacy_notice_version integer NOT NULL DEFAULT 1,
  notification_defaults  jsonb NOT NULL,   -- {eventType: {inApp, email}}
  onboarding_checklist   jsonb NOT NULL DEFAULT '{}',              -- IDD-04 item → {doneAt, doneBy}
  limits                 jsonb NOT NULL DEFAULT '{}',              -- parameterised OD values (import max rows, AI rewrite max chars, etc.)
  bootstrap_completed_at timestamptz NOT NULL,
  -- AUDIT columns
  CONSTRAINT org_default_currency_enabled CHECK (default_currency = ANY (enabled_currencies))
);
```

Better Auth tables (owned by Better Auth, configured with `modelName` overrides and UUIDv7 id generation): `auth_user(id uuid PK, email, email_verified, name, image, created_at, updated_at, two_factor_enabled)`, `auth_session(id, user_id, token UNIQUE, expires_at, ip_address, user_agent, kind text DEFAULT 'web' CHECK (kind IN ('web','addin')), created_at, updated_at)`, `auth_account(id, user_id, provider_id, account_id, access_token, refresh_token, id_token, access_token_expires_at, scope, password, created_at, updated_at)`, `auth_verification(id, identifier, value, expires_at)`, `auth_two_factor(id, user_id, secret, backup_codes)`. Login OAuth tokens in `auth_account` are encrypted through Better Auth `databaseHooks` using the keyring (ADR-073); mailbox tokens are **not** stored here (separate consent, `mailbox_connection`). See AUTHENTICATION-AUTHORIZATION.md §3 for storage handling of session tokens and TOTP secrets.

```sql
CREATE TABLE app_user_profile (
  user_id            uuid PRIMARY KEY REFERENCES auth_user(id) ON DELETE RESTRICT,
  email              text NOT NULL,
  normalized_email   text NOT NULL UNIQUE,                 -- unique incl. deactivated
  full_name          text NOT NULL CHECK (length(full_name) BETWEEN 1 AND 200),
  title              text NULL,
  phone              text NULL,
  role               text NOT NULL CHECK (role IN ('admin','sales_manager','salesperson')),
  status             text NOT NULL CHECK (status IN ('invited','active','deactivated')),
  can_manage_content boolean NOT NULL DEFAULT false,       -- §9.17 "Optional", managers only
  can_manage_shared_email_templates boolean NOT NULL DEFAULT false,
  time_zone          text NULL,
  email_signature    jsonb NULL,                           -- ProseMirror doc
  last_sign_in_at    timestamptz NULL,
  round_robin_eligible boolean NOT NULL DEFAULT true,
  deactivated_at     timestamptz NULL,
  deactivated_by     uuid NULL REFERENCES app_user_profile(user_id),
  reassigned_to_user_id uuid NULL REFERENCES app_user_profile(user_id),
  -- AUDIT
  CONSTRAINT user_deactivation_complete CHECK ((status = 'deactivated') = (deactivated_at IS NOT NULL))
);
CREATE INDEX app_user_role_active_idx ON app_user_profile (role) WHERE status = 'active';
ALTER TABLE organization_settings ADD FOREIGN KEY (default_lead_owner_id) REFERENCES app_user_profile(user_id);

CREATE TABLE invitation (
  id           uuid PRIMARY KEY,
  email        text NOT NULL,
  normalized_email text NOT NULL,
  role         text NOT NULL CHECK (role IN ('admin','sales_manager','salesperson')),
  team_id      uuid NULL REFERENCES team(id),
  token_hash   char(64) NOT NULL UNIQUE,
  status       text NOT NULL CHECK (status IN ('pending','accepted','revoked','expired')),
  expires_at   timestamptz NOT NULL,
  invited_by   uuid NOT NULL REFERENCES app_user_profile(user_id),
  accepted_user_id uuid NULL REFERENCES app_user_profile(user_id)
  -- AUDIT
);
CREATE UNIQUE INDEX invitation_one_pending_per_email ON invitation (normalized_email) WHERE status = 'pending';

CREATE TABLE team (
  id    uuid PRIMARY KEY,
  name  text NOT NULL CHECK (length(name) BETWEEN 1 AND 100)
  -- AUDIT, ARCHIVE
);
CREATE UNIQUE INDEX team_name_active_uq ON team (lower(name)) WHERE archived_at IS NULL;

CREATE TABLE team_membership (               -- OD-32: at most one team per user
  user_id    uuid PRIMARY KEY REFERENCES app_user_profile(user_id),
  team_id    uuid NOT NULL REFERENCES team(id),
  is_active  boolean NOT NULL DEFAULT true,   -- R7: retained when the member is deactivated
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at   timestamptz NULL
);
CREATE INDEX team_membership_team_idx ON team_membership (team_id);

CREATE TABLE team_membership_history (       -- append-only
  id uuid PRIMARY KEY, user_id uuid NOT NULL, team_id uuid NOT NULL,
  started_at timestamptz NOT NULL, ended_at timestamptz NOT NULL
);

CREATE TABLE team_manager (
  team_id uuid NOT NULL REFERENCES team(id),
  user_id uuid NOT NULL REFERENCES app_user_profile(user_id),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX team_manager_user_idx ON team_manager (user_id);
```

Invariants enforced in the identity service (single transaction, `SELECT … FOR UPDATE` on `app_user_profile` rows involved): at least one active admin (`LAST_ADMIN`); `team_manager.user.role = 'sales_manager'` (`MANAGER_ROLE_REQUIRED`); a non-archived team with members has ≥ 1 manager (`TEAM_MANAGER_REQUIRED`).

---

## 3. CRM module

```sql
CREATE TABLE company (
  id                uuid PRIMARY KEY,
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  normalized_name   text NOT NULL,
  domain            text NULL,
  normalized_domain text NULL,                    -- never a free-mail domain (R3)
  owner_id          uuid NOT NULL REFERENCES app_user_profile(user_id),
  industry          text NULL,
  size_band         text NULL,
  phone             text NULL,
  website           text NULL,
  address           jsonb NULL,                   -- {line1,line2,city,region,postalCode,country}
  custom_fields     jsonb NOT NULL DEFAULT '{}',  -- {key: value}, validated against definitions
  source            jsonb NULL,                   -- SourceAttribution
  external_ids      jsonb NOT NULL DEFAULT '{}',  -- {"hubspot": "123"}
  anonymised_at     timestamptz NULL,
  search_tsv        tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(domain,''))) STORED
  -- AUDIT, ARCHIVE
);
CREATE UNIQUE INDEX company_domain_uq ON company (normalized_domain) WHERE archived_at IS NULL AND normalized_domain IS NOT NULL;
CREATE INDEX company_owner_idx ON company (owner_id) WHERE archived_at IS NULL;
CREATE INDEX company_name_trgm ON company USING gin (normalized_name gin_trgm_ops);
CREATE INDEX company_search_idx ON company USING gin (search_tsv);
CREATE INDEX company_custom_fields_idx ON company USING gin (custom_fields jsonb_path_ops);
CREATE INDEX company_external_ids_idx ON company USING gin (external_ids jsonb_path_ops);

CREATE TABLE contact (
  id                uuid PRIMARY KEY,
  first_name        text NULL,
  last_name         text NULL,
  email             text NULL,
  normalized_email  text NULL,
  additional_emails text[] NOT NULL DEFAULT '{}', -- normalised
  phone             text NULL,
  mobile_phone      text NULL,
  job_title         text NULL,
  company_id        uuid NULL REFERENCES company(id),   -- 0..1 primary company (OD-33)
  owner_id          uuid NOT NULL REFERENCES app_user_profile(user_id),
  custom_fields     jsonb NOT NULL DEFAULT '{}',
  source            jsonb NULL,
  external_ids      jsonb NOT NULL DEFAULT '{}',
  anonymised_at     timestamptz NULL,
  search_tsv        tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(first_name,'')||' '||coalesce(last_name,'')||' '||coalesce(email,''))) STORED,
  -- AUDIT, ARCHIVE
  CONSTRAINT contact_has_identity CHECK (coalesce(first_name,last_name,email) IS NOT NULL OR anonymised_at IS NOT NULL)
);
CREATE UNIQUE INDEX contact_email_uq ON contact (normalized_email) WHERE archived_at IS NULL AND normalized_email IS NOT NULL;   -- OD-60
CREATE INDEX contact_additional_emails_idx ON contact USING gin (additional_emails);
CREATE INDEX contact_company_idx ON contact (company_id);
CREATE INDEX contact_owner_idx ON contact (owner_id) WHERE archived_at IS NULL;
CREATE INDEX contact_search_idx ON contact USING gin (search_tsv);
CREATE INDEX contact_name_trgm ON contact USING gin ((lower(coalesce(first_name,'')||' '||coalesce(last_name,''))) gin_trgm_ops);

CREATE TABLE pipeline (
  id          uuid PRIMARY KEY,
  name        text NOT NULL,
  is_default  boolean NOT NULL DEFAULT false
  -- AUDIT, ARCHIVE
);
CREATE UNIQUE INDEX pipeline_name_uq ON pipeline (lower(name)) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX pipeline_one_default ON pipeline (is_default) WHERE is_default AND archived_at IS NULL;

CREATE TABLE pipeline_stage (
  id                   uuid PRIMARY KEY,
  pipeline_id          uuid NOT NULL REFERENCES pipeline(id),
  name                 text NOT NULL,
  kind                 text NOT NULL CHECK (kind IN ('open','won','lost')),
  sort_order           integer NOT NULL,
  probability          numeric(7,4) NOT NULL CHECK (probability BETWEEN 0 AND 100),
  stall_threshold_days integer NULL CHECK (stall_threshold_days > 0),
  is_system            boolean NOT NULL DEFAULT false,
  -- AUDIT, ARCHIVE
  CONSTRAINT stage_system_probability CHECK ((kind = 'won' AND probability = 100 AND is_system) OR (kind = 'lost' AND probability = 0 AND is_system) OR (kind = 'open' AND NOT is_system))
);
CREATE UNIQUE INDEX stage_name_uq ON pipeline_stage (pipeline_id, lower(name)) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX stage_one_won  ON pipeline_stage (pipeline_id) WHERE kind = 'won';
CREATE UNIQUE INDEX stage_one_lost ON pipeline_stage (pipeline_id) WHERE kind = 'lost';
CREATE UNIQUE INDEX stage_order_uq ON pipeline_stage (pipeline_id, sort_order) WHERE archived_at IS NULL;

CREATE TABLE lost_reason (
  id uuid PRIMARY KEY, name text NOT NULL, sort_order integer NOT NULL DEFAULT 0
  -- AUDIT, ARCHIVE
);
CREATE UNIQUE INDEX lost_reason_name_uq ON lost_reason (lower(name)) WHERE archived_at IS NULL;

CREATE TABLE contact_role (
  id uuid PRIMARY KEY, name text NOT NULL, is_system boolean NOT NULL DEFAULT false,
  system_key text NULL UNIQUE CHECK (system_key IN ('forwarded_viewer','signer')),
  sort_order integer NOT NULL DEFAULT 0
  -- AUDIT, ARCHIVE
);

CREATE TABLE deal (
  id                 uuid PRIMARY KEY,
  name               text NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  company_id         uuid NOT NULL REFERENCES company(id),          -- OD-33
  owner_id           uuid NOT NULL REFERENCES app_user_profile(user_id),
  pipeline_id        uuid NOT NULL REFERENCES pipeline(id),
  stage_id           uuid NOT NULL REFERENCES pipeline_stage(id),
  status             text NOT NULL CHECK (status IN ('open','won','lost')),   -- maintained = stage.kind
  amount             numeric(18,2) NULL CHECK (amount >= 0),
  currency           char(3) NOT NULL,
  amount_source      jsonb NOT NULL DEFAULT '{"kind":"manual"}',   -- {kind: manual|proposal|automation, proposalVersionId}
  close_date         date NULL,
  closed_at          timestamptz NULL,
  lost_reason_id     uuid NULL REFERENCES lost_reason(id),
  lost_reason_note   text NULL,
  won_from_proposal_id uuid NULL,                                   -- FK after proposal
  last_activity_at   timestamptz NULL,
  stage_entered_at   timestamptz NOT NULL DEFAULT now(),
  custom_fields      jsonb NOT NULL DEFAULT '{}',
  source             jsonb NULL,
  external_ids       jsonb NOT NULL DEFAULT '{}',
  search_tsv         tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(name,''))) STORED,
  -- AUDIT, ARCHIVE
  CONSTRAINT deal_lost_reason CHECK (status <> 'lost' OR lost_reason_id IS NOT NULL),
  CONSTRAINT deal_closed_fields CHECK (status = 'open' OR (close_date IS NOT NULL AND closed_at IS NOT NULL))
);
CREATE INDEX deal_owner_status_idx ON deal (owner_id, status) WHERE archived_at IS NULL;
CREATE INDEX deal_pipeline_stage_idx ON deal (pipeline_id, stage_id) WHERE archived_at IS NULL;
CREATE INDEX deal_company_idx ON deal (company_id);
CREATE INDEX deal_close_date_idx ON deal (close_date) WHERE archived_at IS NULL;
CREATE INDEX deal_closed_at_idx ON deal (closed_at) WHERE status <> 'open';
CREATE INDEX deal_last_activity_idx ON deal (last_activity_at) WHERE status = 'open' AND archived_at IS NULL;
CREATE INDEX deal_search_idx ON deal USING gin (search_tsv);
CREATE INDEX deal_custom_fields_idx ON deal USING gin (custom_fields jsonb_path_ops);
-- Trigger deal_stage_consistency: BEFORE INSERT/UPDATE, verifies stage.pipeline_id = pipeline_id and sets status = stage.kind.

CREATE TABLE deal_contact (                       -- Stakeholder
  id          uuid PRIMARY KEY,
  deal_id     uuid NOT NULL REFERENCES deal(id),
  contact_id  uuid NOT NULL REFERENCES contact(id),
  is_primary  boolean NOT NULL DEFAULT false,
  added_via   text NOT NULL CHECK (added_via IN ('manual','import','lead_form','forwarded_viewer','email_link','signer_add')),
  added_by_actor jsonb NOT NULL,                  -- ActorRef
  -- AUDIT
  UNIQUE (deal_id, contact_id)
);
CREATE UNIQUE INDEX deal_contact_one_primary ON deal_contact (deal_id) WHERE is_primary;
CREATE INDEX deal_contact_contact_idx ON deal_contact (contact_id);

CREATE TABLE deal_contact_role (
  deal_contact_id uuid NOT NULL REFERENCES deal_contact(id) ON DELETE CASCADE,
  contact_role_id uuid NOT NULL REFERENCES contact_role(id),
  PRIMARY KEY (deal_contact_id, contact_role_id)
);

CREATE TABLE deal_stage_history (                 -- append-only
  id              uuid PRIMARY KEY,
  deal_id         uuid NOT NULL REFERENCES deal(id),
  from_stage_id   uuid NULL REFERENCES pipeline_stage(id),
  to_stage_id     uuid NOT NULL REFERENCES pipeline_stage(id),
  changed_at      timestamptz NOT NULL DEFAULT now(),
  actor           jsonb NOT NULL,
  automation_execution_id uuid NULL,
  reason          text NULL
);
CREATE INDEX deal_stage_history_deal_idx ON deal_stage_history (deal_id, changed_at);

CREATE TABLE custom_field_definition (
  id          uuid PRIMARY KEY,
  object_type text NOT NULL CHECK (object_type IN ('company','contact','deal')),
  key         text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  label       text NOT NULL,
  data_type   text NOT NULL CHECK (data_type IN ('text','number','currency','date','dropdown','multi_select','checkbox')),
  options     jsonb NULL,          -- [{value,label,archived}]
  required    boolean NOT NULL DEFAULT false,
  help_text   text NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  ai_excluded boolean NOT NULL DEFAULT false,      -- OD-92
  -- AUDIT, ARCHIVE
  UNIQUE (object_type, key),
  CONSTRAINT cfd_options CHECK ((data_type IN ('dropdown','multi_select')) = (options IS NOT NULL))
);

CREATE TABLE task (
  id            uuid PRIMARY KEY,
  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 255),
  description   text NULL,
  related_type  text NOT NULL CHECK (related_type IN ('company','contact','deal')),
  related_id    uuid NOT NULL,
  assignee_id   uuid NOT NULL REFERENCES app_user_profile(user_id),
  due_at        timestamptz NOT NULL,
  all_day       boolean NOT NULL DEFAULT false,
  reminder_at   timestamptz NULL,
  reminder_sent_at timestamptz NULL,
  overdue_notified_at timestamptz NULL,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','cancelled')),
  completed_at  timestamptz NULL,
  completed_by  jsonb NULL,
  source        text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','automation','ai_suggested')),
  automation_execution_id uuid NULL,
  -- AUDIT
  CONSTRAINT task_reminder_before_due CHECK (reminder_at IS NULL OR reminder_at <= due_at)
);
CREATE INDEX task_assignee_open_idx ON task (assignee_id, due_at) WHERE status = 'open';
CREATE INDEX task_related_idx ON task (related_type, related_id);
CREATE INDEX task_reminder_idx ON task (reminder_at) WHERE status = 'open' AND reminder_sent_at IS NULL;

CREATE TABLE note (
  id uuid PRIMARY KEY, body jsonb NOT NULL, body_text text NOT NULL,   -- body_text = plain text for search/AI
  related_type text NOT NULL CHECK (related_type IN ('company','contact','deal')), related_id uuid NOT NULL,
  author_id uuid NOT NULL REFERENCES app_user_profile(user_id), pinned boolean NOT NULL DEFAULT false
  -- AUDIT
);
CREATE INDEX note_related_idx ON note (related_type, related_id, created_at DESC);

CREATE TABLE activity_log (                       -- manual call/meeting logs (BR-CRM-010)
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('call','meeting')),
  occurred_at timestamptz NOT NULL, duration_minutes integer NULL CHECK (duration_minutes >= 0),
  outcome text NULL, notes jsonb NULL,
  related_type text NOT NULL CHECK (related_type IN ('company','contact','deal')), related_id uuid NOT NULL,
  logged_by uuid NOT NULL REFERENCES app_user_profile(user_id)
  -- AUDIT
);
CREATE INDEX activity_log_related_idx ON activity_log (related_type, related_id, occurred_at DESC);
CREATE TABLE activity_log_participant (
  activity_log_id uuid NOT NULL REFERENCES activity_log(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contact(id),
  PRIMARY KEY (activity_log_id, contact_id)
);

CREATE TABLE saved_view (
  id uuid PRIMARY KEY, name text NOT NULL,
  object_type text NOT NULL CHECK (object_type IN ('company','contact','deal','proposal','task')),
  layout text NOT NULL DEFAULT 'list' CHECK (layout IN ('list','board')),
  definition jsonb NOT NULL,        -- {filters[], sort[], columns[], pipelineId?}
  owner_id uuid NOT NULL REFERENCES app_user_profile(user_id),
  sharing text NOT NULL DEFAULT 'personal' CHECK (sharing IN ('personal','team','organization')),
  is_default boolean NOT NULL DEFAULT false
  -- AUDIT
);
CREATE INDEX saved_view_owner_idx ON saved_view (owner_id, object_type);
```

Polymorphic `related_type/related_id` (task, note, activity_log) is validated by the service (the record must exist and be editable/viewable by the actor). It is not a DB foreign key; an integrity job (`ops.integrity-check`, daily) reports orphans.

---

## 4. Catalog module

```sql
CREATE TABLE tax_category (
  id uuid PRIMARY KEY, name text NOT NULL, code text NOT NULL,
  rate_percent numeric(7,4) NOT NULL CHECK (rate_percent BETWEEN 0 AND 100),
  is_default boolean NOT NULL DEFAULT false
  -- AUDIT, ARCHIVE
);
CREATE UNIQUE INDEX tax_category_code_uq ON tax_category (code);
CREATE UNIQUE INDEX tax_category_one_default ON tax_category (is_default) WHERE is_default AND archived_at IS NULL;

CREATE TABLE product (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  description text NULL,
  sku text NULL,
  unit text NOT NULL,
  tax_category_id uuid NOT NULL REFERENCES tax_category(id),
  billing_type text NOT NULL CHECK (billing_type IN ('one_time','recurring')),
  default_billing_period text NULL CHECK (default_billing_period IN ('month','quarter','year')),
  search_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(name,'')||' '||coalesce(sku,''))) STORED,
  -- AUDIT, ARCHIVE
  CONSTRAINT product_recurring_period CHECK ((billing_type = 'recurring') = (default_billing_period IS NOT NULL))
);
CREATE UNIQUE INDEX product_sku_uq ON product (lower(sku)) WHERE sku IS NOT NULL AND archived_at IS NULL;
CREATE INDEX product_search_idx ON product USING gin (search_tsv);

CREATE TABLE product_price (                       -- tax-exclusive prices (R10)
  product_id uuid NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  currency   char(3) NOT NULL,
  unit_price numeric(18,4) NOT NULL CHECK (unit_price >= 0),
  PRIMARY KEY (product_id, currency)
);
-- Service invariant: a price in organization_settings.default_currency must exist.

CREATE TABLE discount_limit (                     -- BR-PRC-007, OD-39
  role text PRIMARY KEY CHECK (role IN ('admin','sales_manager','salesperson')),
  max_line_discount_percent    numeric(7,4) NOT NULL CHECK (max_line_discount_percent BETWEEN 0 AND 100),
  max_overall_discount_percent numeric(7,4) NOT NULL CHECK (max_overall_discount_percent BETWEEN 0 AND 100)
  -- AUDIT
);

CREATE TABLE exchange_rate (                       -- OD-15, R10 (catalog owns, A12)
  id uuid PRIMARY KEY,
  from_currency char(3) NOT NULL,
  to_currency   char(3) NOT NULL,                    -- = org default currency at creation
  rate          numeric(18,8) NOT NULL CHECK (rate > 0),
  effective_from date NOT NULL,
  -- AUDIT
  UNIQUE (from_currency, to_currency, effective_from)
);
```

---

## 5. Templates module

```sql
CREATE TABLE proposal_template (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description text NULL,
  current_published_version_id uuid NULL,          -- FK after template_version
  is_starter boolean NOT NULL DEFAULT false,       -- IDD-11
  source_docx_file_id uuid NULL,                   -- BR-MIG-006
  default_pricing_config jsonb NULL
  -- AUDIT, ARCHIVE
);
CREATE UNIQUE INDEX template_name_uq ON proposal_template (lower(name)) WHERE archived_at IS NULL;

CREATE TABLE template_version (
  id uuid PRIMARY KEY,
  template_id uuid NOT NULL REFERENCES proposal_template(id),
  version_number integer NOT NULL,
  state text NOT NULL CHECK (state IN ('draft','published','retired')),
  schema_version smallint NOT NULL,                 -- content schema version (ADR-029)
  content jsonb NOT NULL,                           -- {sections:[{id,title,locked,required,aiDraftable,doc}]}
  placeholder_refs jsonb NOT NULL DEFAULT '[]',     -- [{namespace, fieldKey, isCustom}]
  published_at timestamptz NULL,
  published_by uuid NULL REFERENCES app_user_profile(user_id),
  -- AUDIT
  UNIQUE (template_id, version_number)
);
CREATE UNIQUE INDEX template_one_draft ON template_version (template_id) WHERE state = 'draft';
ALTER TABLE proposal_template ADD FOREIGN KEY (current_published_version_id) REFERENCES template_version(id);
-- Trigger template_version_immutable: rejects UPDATE of content/placeholder_refs when OLD.state <> 'draft'.

CREATE TABLE content_block (
  id uuid PRIMARY KEY, name text NOT NULL,
  category text NOT NULL CHECK (category IN ('case_study','team_bio','terms','other')),
  schema_version smallint NOT NULL, content jsonb NOT NULL, content_text text NOT NULL,
  revision integer NOT NULL DEFAULT 1, tags text[] NOT NULL DEFAULT '{}'
  -- AUDIT, ARCHIVE
);
CREATE INDEX content_block_tags_idx ON content_block USING gin (tags);
```

---

## 6. Proposals module

```sql
CREATE TABLE proposal (
  id                  uuid PRIMARY KEY,
  deal_id             uuid NOT NULL REFERENCES deal(id),
  company_id          uuid NOT NULL REFERENCES company(id),
  primary_contact_id  uuid NULL REFERENCES contact(id),
  title               text NOT NULL CHECK (length(title) BETWEEN 1 AND 255),
  template_id         uuid NOT NULL REFERENCES proposal_template(id),
  template_version_id uuid NOT NULL REFERENCES template_version(id),   -- pinned (BR-TPL-004)
  currency            char(3) NOT NULL,                                  -- = deal.currency (OD-15)
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','viewed','accepted','signed','declined','expired','void')),
  current_version_id  uuid NULL,                                         -- FK after proposal_version
  last_sent_version_id uuid NULL,
  valid_until         date NULL,                                         -- BR-PRP-009
  signature_required  boolean NOT NULL DEFAULT true,                     -- BR-SHR-010 mode (OD-68)
  copied_from_proposal_id uuid NULL REFERENCES proposal(id),
  void_reason         text NULL,
  voided_by_actor     jsonb NULL,
  void_kind           text NULL CHECK (void_kind IN ('user','automation')),  -- automation voids are reversible (ADR-025)
  status_before_void  text NULL,
  accepted_at timestamptz NULL, signed_at timestamptz NULL, declined_at timestamptz NULL, expired_at timestamptz NULL,
  outcome_version_id  uuid NULL,
  decline_reason      text NULL,
  search_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title,''))) STORED,
  -- AUDIT
  CONSTRAINT proposal_void_reason CHECK (status <> 'void' OR void_reason IS NOT NULL)
);
CREATE INDEX proposal_deal_idx ON proposal (deal_id, status);
CREATE INDEX proposal_status_valid_idx ON proposal (valid_until) WHERE status IN ('sent','viewed','accepted');
CREATE INDEX proposal_search_idx ON proposal USING gin (search_tsv);
ALTER TABLE deal ADD FOREIGN KEY (won_from_proposal_id) REFERENCES proposal(id);

CREATE TABLE proposal_version (
  id                 uuid PRIMARY KEY,
  proposal_id        uuid NOT NULL REFERENCES proposal(id),
  version_number     integer NOT NULL,
  state              text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','sent','superseded','signed')),
  based_on_version_id uuid NULL REFERENCES proposal_version(id),
  schema_version     smallint NOT NULL,
  content            jsonb NOT NULL,                 -- sections (ADR-029)
  term_months        integer NOT NULL CHECK (term_months BETWEEN 1 AND 120),
  totals             jsonb NOT NULL,                 -- ProposalTotals (computed)
  placeholder_bindings jsonb NOT NULL DEFAULT '{}',  -- {"deal.name": {value, source, resolvedAt}}
  missing_placeholders jsonb NOT NULL DEFAULT '[]',
  discount_warnings  jsonb NOT NULL DEFAULT '[]',
  accept_decline_enabled boolean NOT NULL DEFAULT false,  -- copy of proposal.signature_required=false at send
  sent_at            timestamptz NULL,
  sent_by            uuid NULL REFERENCES app_user_profile(user_id),
  sent_channel       text NULL CHECK (sent_channel IN ('crm_email','addin_email','manual_link')),
  frozen_snapshot    jsonb NULL,                     -- full render model
  snapshot_sha256    char(64) NULL,                  -- SHA-256 of canonical JSON of frozen_snapshot
  pdf_file_id        uuid NULL,                      -- FK file_object
  pdf_sha256         char(64) NULL,
  docx_file_id       uuid NULL,
  superseded_at      timestamptz NULL,
  last_presend_check_id uuid NULL,
  send_lock_until    timestamptz NULL,               -- ADR-081 prepare lock
  -- AUDIT
  UNIQUE (proposal_id, version_number),
  CONSTRAINT pv_sent_fields CHECK (state = 'draft' OR (sent_at IS NOT NULL AND frozen_snapshot IS NOT NULL AND snapshot_sha256 IS NOT NULL AND pdf_file_id IS NOT NULL AND pdf_sha256 IS NOT NULL))
);
CREATE UNIQUE INDEX pv_one_draft ON proposal_version (proposal_id) WHERE state = 'draft';
ALTER TABLE proposal ADD FOREIGN KEY (current_version_id) REFERENCES proposal_version(id);
ALTER TABLE proposal ADD FOREIGN KEY (last_sent_version_id) REFERENCES proposal_version(id);
ALTER TABLE proposal ADD FOREIGN KEY (outcome_version_id) REFERENCES proposal_version(id);
```

**Immutability trigger (ADR-025):**
```sql
CREATE FUNCTION proposal_version_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.state <> 'draft' AND (
       NEW.content IS DISTINCT FROM OLD.content OR NEW.totals IS DISTINCT FROM OLD.totals OR
       NEW.term_months IS DISTINCT FROM OLD.term_months OR NEW.placeholder_bindings IS DISTINCT FROM OLD.placeholder_bindings OR
       NEW.frozen_snapshot IS DISTINCT FROM OLD.frozen_snapshot OR NEW.snapshot_sha256 IS DISTINCT FROM OLD.snapshot_sha256 OR
       NEW.pdf_file_id IS DISTINCT FROM OLD.pdf_file_id OR NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256) THEN
    RAISE EXCEPTION 'VERSION_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.state = 'signed' AND NEW.state <> 'signed' THEN
    RAISE EXCEPTION 'VERSION_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER proposal_version_immutable BEFORE UPDATE ON proposal_version FOR EACH ROW EXECUTE FUNCTION proposal_version_immutable();
-- A twin trigger on pricing_table/pricing_line rejects INSERT/UPDATE/DELETE whose version state <> 'draft'.
```
Allowed state transitions at DB level: draft→sent, sent→superseded, sent→signed (CHECK in trigger mirrors SM-03).

```sql
CREATE TABLE pricing_table (               -- real rows for drafts (A12); frozen into snapshot on send
  id uuid PRIMARY KEY,
  proposal_version_id uuid NOT NULL REFERENCES proposal_version(id) ON DELETE CASCADE,
  section_id text NOT NULL,                 -- section containing the pricingTable node
  title text NULL,
  sort_order integer NOT NULL,
  overall_discount_type text NULL CHECK (overall_discount_type IN ('percent','amount')),
  overall_discount_value numeric(18,4) NULL CHECK (overall_discount_value >= 0),
  overall_discount_scope text NULL CHECK (overall_discount_scope IN ('one_time','recurring','both')),   -- OD-66 WA
  CONSTRAINT pt_discount_pair CHECK ((overall_discount_type IS NULL) = (overall_discount_value IS NULL))
);
CREATE INDEX pricing_table_version_idx ON pricing_table (proposal_version_id);

CREATE TABLE pricing_line (
  id uuid PRIMARY KEY,
  pricing_table_id uuid NOT NULL REFERENCES pricing_table(id) ON DELETE CASCADE,
  proposal_version_id uuid NOT NULL REFERENCES proposal_version(id) ON DELETE CASCADE,  -- denormalised for reporting
  line_key text NOT NULL,                   -- stable id across versions (diff)
  sort_order integer NOT NULL,
  product_id uuid NULL REFERENCES product(id),
  product_snapshot jsonb NULL,              -- copy of catalog at insertion
  name text NOT NULL, description text NULL, unit text NOT NULL,
  quantity numeric(14,4) NOT NULL CHECK (quantity > 0),
  unit_price numeric(18,4) NOT NULL CHECK (unit_price >= 0),
  discount_type text NULL CHECK (discount_type IN ('percent','amount')),
  discount_value numeric(18,4) NULL CHECK (discount_value >= 0),
  tax_category_code text NOT NULL,
  tax_rate_percent numeric(7,4) NOT NULL,
  billing_type text NOT NULL CHECK (billing_type IN ('one_time','recurring')),
  billing_period text NULL CHECK (billing_period IN ('month','quarter','year')),
  line_subtotal numeric(18,2) NOT NULL, line_discount_amount numeric(18,2) NOT NULL,
  line_tax numeric(18,2) NOT NULL, line_total numeric(18,2) NOT NULL,
  CONSTRAINT pl_period CHECK ((billing_type = 'recurring') = (billing_period IS NOT NULL)),
  CONSTRAINT pl_discount_pair CHECK ((discount_type IS NULL) = (discount_value IS NULL)),
  UNIQUE (pricing_table_id, line_key)
);
CREATE INDEX pricing_line_product_idx ON pricing_line (product_id);

CREATE TABLE generated_file (
  id uuid PRIMARY KEY,
  proposal_version_id uuid NOT NULL REFERENCES proposal_version(id),
  format text NOT NULL CHECK (format IN ('pdf','docx')),
  purpose text NOT NULL CHECK (purpose IN ('preview','sent','signed_copy_export')),
  file_object_id uuid NOT NULL,
  sha256 char(64) NOT NULL,
  renderer_version text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX generated_file_version_idx ON generated_file (proposal_version_id, format, purpose);

CREATE TABLE proposal_send_attempt (       -- ADR-081 two-phase send
  id uuid PRIMARY KEY,
  proposal_version_id uuid NOT NULL REFERENCES proposal_version(id),
  channel text NOT NULL CHECK (channel IN ('crm_email','addin_email','manual_link')),
  status text NOT NULL CHECK (status IN ('preparing','prepared','committing','committed','failed','expired','cancelled')),
  idempotency_key text NOT NULL,
  requested_by uuid NOT NULL REFERENCES app_user_profile(user_id),
  recipient_contact_ids uuid[] NOT NULL,
  email_draft jsonb NULL,                   -- {subject, body, templateId}
  outbound_email_id uuid NULL,              -- comms.outbound_email
  prepared_at timestamptz NULL, committed_at timestamptz NULL, expires_at timestamptz NOT NULL,
  failure_code text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (requested_by, idempotency_key)
);
CREATE UNIQUE INDEX send_attempt_one_active ON proposal_send_attempt (proposal_version_id) WHERE status IN ('preparing','prepared','committing');
```

Totals JSON (`proposal_version.totals`) shape (BUSINESS-RULES §7.2):
```json
{ "currency":"USD","termMonths":12,
  "oneTime":{"subtotal":"10000.00","discount":"500.00","tax":"950.00","total":"10450.00"},
  "recurring":[{"period":"month","subtotal":"1000.00","discount":"0.00","tax":"100.00","total":"1100.00","periodsInTerm":12}],
  "overallDiscount":{"type":"percent","value":"5","scope":"one_time","amount":"500.00"},
  "grandTotalFirstPeriod":"11550.00","tcvExclTax":"21500.00" }
```

---

## 7. Sharing module

```sql
CREATE TABLE recipient (
  id uuid PRIMARY KEY,
  proposal_version_id uuid NOT NULL REFERENCES proposal_version(id),
  contact_id uuid NOT NULL REFERENCES contact(id),
  deal_contact_id uuid NOT NULL REFERENCES deal_contact(id),
  name_snapshot text NOT NULL, email_snapshot text NOT NULL,
  delivered_via text NOT NULL CHECK (delivered_via IN ('crm_email','addin_email','manual_link')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (proposal_version_id, contact_id)
);

CREATE TABLE share_link (
  id uuid PRIMARY KEY,
  proposal_version_id uuid NOT NULL REFERENCES proposal_version(id),
  proposal_id uuid NOT NULL REFERENCES proposal(id),     -- denormalised
  deal_id uuid NOT NULL REFERENCES deal(id),             -- denormalised visibility root
  recipient_id uuid NOT NULL UNIQUE REFERENCES recipient(id),
  token_hash char(64) NOT NULL UNIQUE,                   -- ADR-034
  token_ciphertext text NOT NULL,
  link_handle text NOT NULL UNIQUE,                      -- non-secret public id for /v/<handle> (ADR-071)
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
  expires_at timestamptz NULL,
  require_email_verification boolean NOT NULL,
  revoked_at timestamptz NULL, revoked_by uuid NULL REFERENCES app_user_profile(user_id), revoke_reason text NULL,
  first_viewed_at timestamptz NULL, last_viewed_at timestamptz NULL,
  expiring_notified_at timestamptz NULL,
  -- AUDIT
  CONSTRAINT share_link_revoked CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);
CREATE INDEX share_link_version_idx ON share_link (proposal_version_id);
CREATE INDEX share_link_expiry_idx ON share_link (expires_at) WHERE status = 'active' AND expires_at IS NOT NULL;

CREATE TABLE buyer_session (               -- cookie-bound session (ADR-071)
  id uuid PRIMARY KEY,
  session_hash char(64) NOT NULL UNIQUE,
  share_link_id uuid NOT NULL REFERENCES share_link(id),
  viewer_identity_id uuid NULL,            -- set after identity gate
  device_key_hash char(64) NOT NULL,
  email_verified_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX buyer_session_link_idx ON buyer_session (share_link_id);

CREATE TABLE viewer_identity (
  id uuid PRIMARY KEY,
  share_link_id uuid NOT NULL REFERENCES share_link(id),
  name text NOT NULL, email text NOT NULL, normalized_email text NOT NULL,
  is_original_recipient boolean NOT NULL,
  contact_id uuid NULL REFERENCES contact(id),
  deal_contact_id uuid NULL REFERENCES deal_contact(id),
  email_verified_at timestamptz NULL,
  privacy_notice_version_accepted integer NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (share_link_id, normalized_email)
);
ALTER TABLE buyer_session ADD FOREIGN KEY (viewer_identity_id) REFERENCES viewer_identity(id);

CREATE TABLE view_session (                -- append-mostly (heartbeat updates only)
  id uuid PRIMARY KEY,
  share_link_id uuid NOT NULL REFERENCES share_link(id),
  deal_id uuid NOT NULL,
  viewer_identity_id uuid NOT NULL REFERENCES viewer_identity(id),
  started_at timestamptz NOT NULL, last_heartbeat_at timestamptz NOT NULL, ended_at timestamptz NULL,
  active_seconds integer NOT NULL DEFAULT 0,
  is_first_view_of_proposal boolean NOT NULL, is_reopen boolean NOT NULL,
  user_agent text NULL, ip_truncated inet NULL
);
CREATE INDEX view_session_link_idx ON view_session (share_link_id, started_at);
CREATE INDEX view_session_deal_idx ON view_session (deal_id, started_at);

CREATE TABLE download_event (
  id uuid PRIMARY KEY, share_link_id uuid NOT NULL REFERENCES share_link(id), deal_id uuid NOT NULL,
  viewer_identity_id uuid NOT NULL REFERENCES viewer_identity(id),
  format text NOT NULL CHECK (format IN ('pdf','docx')), occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE buyer_response (
  id uuid PRIMARY KEY,
  proposal_version_id uuid NOT NULL UNIQUE REFERENCES proposal_version(id),   -- first response wins
  share_link_id uuid NOT NULL REFERENCES share_link(id),
  viewer_identity_id uuid NOT NULL REFERENCES viewer_identity(id),
  response text NOT NULL CHECK (response IN ('accept','decline')),
  reason text NULL,
  typed_name text NULL,
  evidence jsonb NOT NULL,     -- {name,email,ipTruncated,userAgent,versionSha256,termsTextShown,at} (ADR-025)
  responded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT decline_reason_required CHECK (response <> 'decline' OR length(coalesce(reason,'')) >= 1)
);

CREATE TABLE email_verification_challenge (
  id uuid PRIMARY KEY, share_link_id uuid NOT NULL REFERENCES share_link(id),
  buyer_session_id uuid NOT NULL REFERENCES buyer_session(id),
  email text NOT NULL, code_hash char(64) NOT NULL,
  expires_at timestamptz NOT NULL, attempts smallint NOT NULL DEFAULT 0 CHECK (attempts <= 5),
  verified_at timestamptz NULL, created_at timestamptz NOT NULL DEFAULT now()
);
```

---

## 8. E-signature module

```sql
CREATE TABLE signature_request (
  id uuid PRIMARY KEY,
  proposal_id uuid NOT NULL REFERENCES proposal(id),
  proposal_version_id uuid NOT NULL REFERENCES proposal_version(id),
  deal_id uuid NOT NULL REFERENCES deal(id),
  requested_by uuid NOT NULL REFERENCES app_user_profile(user_id),
  sender_of_record uuid NOT NULL REFERENCES app_user_profile(user_id),
  provider text NOT NULL,                        -- adapter key (OD-03)
  provider_envelope_id text NULL,
  signing_order text NOT NULL CHECK (signing_order IN ('sequential','parallel')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','viewed','signed','declined','expired','voided')),
  document_sha256 char(64) NOT NULL,             -- must equal proposal_version.pdf_sha256
  sms_verification boolean NOT NULL DEFAULT false,
  reminder_schedule_days integer[] NOT NULL,
  expires_at timestamptz NOT NULL,
  dispatch_attempts smallint NOT NULL DEFAULT 0,
  voided_at timestamptz NULL, voided_by_actor jsonb NULL, void_reason text NULL,
  provider_void_status text NULL CHECK (provider_void_status IN ('pending','done','failed')),
  declined_at timestamptz NULL, decline_reason text NULL, declined_by_signer_id uuid NULL,
  completed_at timestamptz NULL,
  stale_completion boolean NOT NULL DEFAULT false,   -- ADR-025 (signed after void/supersede/expiry)
  -- AUDIT
  UNIQUE (provider, provider_envelope_id)
);
CREATE UNIQUE INDEX sr_one_open_per_deal ON signature_request (deal_id) WHERE status IN ('pending','sent','viewed');   -- OD-23
CREATE INDEX sr_open_idx ON signature_request (status, expires_at) WHERE status IN ('pending','sent','viewed');

CREATE TABLE signer (
  id uuid PRIMARY KEY,
  signature_request_id uuid NOT NULL REFERENCES signature_request(id),
  deal_contact_id uuid NOT NULL REFERENCES deal_contact(id),
  contact_id uuid NOT NULL REFERENCES contact(id),
  name_snapshot text NOT NULL, email_snapshot text NOT NULL, normalized_email text NOT NULL,
  phone text NULL,
  sign_order smallint NULL CHECK (sign_order >= 1),
  status text NOT NULL CHECK (status IN ('waiting','sent','viewed','signed','declined','cancelled')),
  consent_captured_at timestamptz NULL, viewed_at timestamptz NULL, signed_at timestamptz NULL,
  declined_at timestamptz NULL, decline_reason text NULL,
  ip_address inet NULL,                             -- from provider evidence
  provider_recipient_id text NULL,
  UNIQUE (signature_request_id, normalized_email)
);

CREATE TABLE signature_event (               -- append-only (BR-SIG-009 evidence mirror)
  id uuid PRIMARY KEY,
  signature_request_id uuid NOT NULL REFERENCES signature_request(id),
  signer_id uuid NULL REFERENCES signer(id),
  type text NOT NULL CHECK (type IN ('dispatched','delivered','viewed','consented','signed','declined','reminder_sent','resent','expired','voided','completed')),
  occurred_at timestamptz NOT NULL,
  provider_event_id text NULL UNIQUE,
  source text NOT NULL CHECK (source IN ('provider_webhook','user_action','scheduler','reconciliation')),
  payload_file_id uuid NULL
);
CREATE INDEX signature_event_request_idx ON signature_event (signature_request_id, occurred_at);

CREATE TABLE signed_document (
  id uuid PRIMARY KEY,
  signature_request_id uuid NOT NULL UNIQUE REFERENCES signature_request(id),
  signed_pdf_file_id uuid NOT NULL, signed_pdf_sha256 char(64) NOT NULL,
  certificate_file_id uuid NOT NULL, certificate_sha256 char(64) NOT NULL,
  source_document_sha256 char(64) NOT NULL,
  sealed_at timestamptz NOT NULL, distributed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE esign_webhook_inbox (            -- ADR-025, ADR-053
  id uuid PRIMARY KEY,
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  signature_verified boolean NOT NULL,
  raw_body bytea NOT NULL,                      -- retained 30 days (purge job)
  headers jsonb NOT NULL,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','ignored','failed')),
  processed_at timestamptz NULL, error_code text NULL,
  UNIQUE (provider, provider_event_id)
);
```

---

## 9. Comms module (email & calendar)

```sql
CREATE TABLE mailbox_connection (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES app_user_profile(user_id),   -- one per user
  provider text NOT NULL CHECK (provider IN ('google','microsoft')),
  email_address text NOT NULL, normalized_email text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','reauth_required','error','disconnected')),
  granted_scopes text[] NOT NULL,
  encrypted_tokens text NOT NULL,            -- envelope {access, refresh, expiresAt}; AAD = userId|provider
  mail_sync_cursor text NULL, calendar_sync_cursor text NULL,
  initial_sync_from timestamptz NOT NULL,    -- OD-51 lookback
  last_synced_at timestamptz NULL, last_error_at timestamptz NULL, last_error_code text NULL,
  consecutive_failures smallint NOT NULL DEFAULT 0,
  calendar_sync_enabled boolean NOT NULL DEFAULT true
  -- AUDIT
);

CREATE TABLE email_thread (
  id uuid PRIMARY KEY,
  mailbox_connection_id uuid NOT NULL REFERENCES mailbox_connection(id),
  provider_thread_id text NOT NULL, subject text NULL,
  last_message_at timestamptz NOT NULL, is_linked boolean NOT NULL DEFAULT false,
  UNIQUE (mailbox_connection_id, provider_thread_id)
);

CREATE TABLE email_message (
  id uuid PRIMARY KEY,
  mailbox_connection_id uuid NOT NULL REFERENCES mailbox_connection(id),
  owner_user_id uuid NOT NULL REFERENCES app_user_profile(user_id),   -- denormalised mailbox owner
  thread_id uuid NOT NULL REFERENCES email_thread(id),
  provider_message_id text NOT NULL,
  internet_message_id text NULL,
  crm_send_id uuid NULL,                     -- X-CRM-Send-Id (ADR-084)
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  sent_at timestamptz NOT NULL,
  from_address jsonb NOT NULL, to_addresses jsonb NOT NULL, cc_addresses jsonb NOT NULL DEFAULT '[]', bcc_addresses jsonb NOT NULL DEFAULT '[]',
  subject text NULL,
  body_text text NULL,                       -- sanitised plain text
  body_html_sanitised text NULL,             -- sanitised HTML (DOMPurify server-side)
  attachments jsonb NOT NULL DEFAULT '[]',   -- metadata only
  is_private boolean NOT NULL DEFAULT false,
  sent_via_crm boolean NOT NULL DEFAULT false,
  email_template_id uuid NULL,
  related_proposal_version_id uuid NULL REFERENCES proposal_version(id),
  tracking_enabled boolean NOT NULL DEFAULT false,
  search_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(subject,''))) STORED,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mailbox_connection_id, provider_message_id)
);
CREATE INDEX email_message_thread_idx ON email_message (thread_id, sent_at);
CREATE INDEX email_message_imid_idx ON email_message (internet_message_id);
CREATE INDEX email_message_sent_idx ON email_message (sent_at);

CREATE TABLE email_message_participant (     -- matching/reporting index
  email_message_id uuid NOT NULL REFERENCES email_message(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('from','to','cc','bcc')),
  normalized_email text NOT NULL,
  contact_id uuid NULL REFERENCES contact(id),
  PRIMARY KEY (email_message_id, role, normalized_email)
);
CREATE INDEX email_participant_contact_idx ON email_message_participant (contact_id);
CREATE INDEX email_participant_email_idx ON email_message_participant (normalized_email);

CREATE TABLE email_link (
  id uuid PRIMARY KEY,
  email_message_id uuid NOT NULL REFERENCES email_message(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('company','contact','deal')),
  target_id uuid NOT NULL,
  link_source text NOT NULL CHECK (link_source IN ('auto','manual','thread_inherited')),
  review_suggested boolean NOT NULL DEFAULT false,      -- OD-28
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','removed')),
  linked_by jsonb NOT NULL, removed_by jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX email_link_uq ON email_link (email_message_id, target_type, target_id) WHERE state = 'active';
CREATE INDEX email_link_target_idx ON email_link (target_type, target_id) WHERE state = 'active';

CREATE TABLE email_exclusion (
  id uuid PRIMARY KEY,
  scope text NOT NULL CHECK (scope IN ('user','organization')),
  owner_user_id uuid NULL REFERENCES app_user_profile(user_id),
  kind text NOT NULL CHECK (kind IN ('domain','email_address','contact')),
  value text NOT NULL,                        -- normalised domain/email or contact id
  -- AUDIT
  CONSTRAINT exclusion_owner CHECK ((scope = 'user') = (owner_user_id IS NOT NULL))
);
CREATE UNIQUE INDEX email_exclusion_uq ON email_exclusion (scope, coalesce(owner_user_id,'00000000-0000-0000-0000-000000000000'), kind, value);

CREATE TABLE email_template (
  id uuid PRIMARY KEY, name text NOT NULL, subject text NOT NULL, body jsonb NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('personal','shared')),
  owner_user_id uuid NULL REFERENCES app_user_profile(user_id),
  -- AUDIT, ARCHIVE
  CONSTRAINT email_template_owner CHECK ((visibility = 'personal') = (owner_user_id IS NOT NULL))
);

CREATE TABLE outbound_email (               -- send attempts through a user mailbox (ADR-084)
  id uuid PRIMARY KEY,
  crm_send_id uuid NOT NULL UNIQUE,
  mailbox_connection_id uuid NOT NULL REFERENCES mailbox_connection(id),
  requested_by uuid NOT NULL REFERENCES app_user_profile(user_id),
  idempotency_key text NOT NULL,
  to_addresses jsonb NOT NULL, cc_addresses jsonb NOT NULL DEFAULT '[]',
  subject text NOT NULL, body_html text NOT NULL,
  related_type text NULL, related_id uuid NULL,
  proposal_send_attempt_id uuid NULL REFERENCES proposal_send_attempt(id),
  tracking_enabled boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('queued','sending','sent','failed','unknown')),
  provider_message_id text NULL, failure_code text NULL,
  created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz NULL,
  UNIQUE (requested_by, idempotency_key)
);

CREATE TABLE email_tracking (
  id uuid PRIMARY KEY,
  outbound_email_id uuid NOT NULL UNIQUE REFERENCES outbound_email(id),
  email_message_id uuid NULL REFERENCES email_message(id),
  pixel_token_hash char(64) NOT NULL UNIQUE,
  first_opened_at timestamptz NULL, last_opened_at timestamptz NULL, open_count integer NOT NULL DEFAULT 0
);

CREATE TABLE calendar_event (
  id uuid PRIMARY KEY,
  mailbox_connection_id uuid NOT NULL REFERENCES mailbox_connection(id),
  owner_user_id uuid NOT NULL REFERENCES app_user_profile(user_id),
  provider_event_id text NOT NULL, ical_uid text NULL,
  title text NULL, start_at timestamptz NOT NULL, end_at timestamptz NOT NULL,
  organizer jsonb NOT NULL, location text NULL, online_meeting_url text NULL,
  status text NOT NULL CHECK (status IN ('confirmed','tentative','cancelled')),
  is_private boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mailbox_connection_id, provider_event_id)
);
CREATE INDEX calendar_event_ical_idx ON calendar_event (ical_uid);
CREATE TABLE calendar_event_attendee (
  calendar_event_id uuid NOT NULL REFERENCES calendar_event(id) ON DELETE CASCADE,
  normalized_email text NOT NULL, name text NULL, response text NULL,
  contact_id uuid NULL REFERENCES contact(id),
  PRIMARY KEY (calendar_event_id, normalized_email)
);
CREATE TABLE calendar_event_link (           -- same semantics as email_link
  id uuid PRIMARY KEY,
  calendar_event_id uuid NOT NULL REFERENCES calendar_event(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('company','contact','deal')), target_id uuid NOT NULL,
  link_source text NOT NULL CHECK (link_source IN ('auto','manual')),
  review_suggested boolean NOT NULL DEFAULT false,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','removed')),
  linked_by jsonb NOT NULL, removed_by jsonb NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX calendar_link_uq ON calendar_event_link (calendar_event_id, target_type, target_id) WHERE state = 'active';
CREATE INDEX calendar_link_target_idx ON calendar_event_link (target_type, target_id) WHERE state = 'active';
```

---

## 10. Leads module

```sql
CREATE TABLE lead_form (
  id uuid PRIMARY KEY, name text NOT NULL,
  public_key text NOT NULL UNIQUE,                -- 22-char random, non-secret
  status text NOT NULL CHECK (status IN ('draft','published','unpublished','archived')),
  fields jsonb NOT NULL,                          -- [FormField]
  create_deal jsonb NULL,                         -- {enabled, pipelineId, stageId, dealNameTemplate}
  spam_protection jsonb NOT NULL,                 -- {honeypot:true, captcha:bool, rateLimitPerIpPerHour}
  consent_text text NULL, success_message text NULL, redirect_url text NULL,
  allowed_origins text[] NOT NULL DEFAULT '{}',   -- frame-ancestors for the hosted page
  webhook_secret_ciphertext text NULL,            -- BR-LED-007 (Could)
  published_at timestamptz NULL
  -- AUDIT
);

CREATE TABLE assignment_rule (
  id uuid PRIMARY KEY, name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('round_robin','field_value')),
  conditions jsonb NOT NULL DEFAULT '[]',          -- [{fieldRef, operator, values}]
  priority integer NOT NULL, active boolean NOT NULL DEFAULT true
  -- AUDIT
);
CREATE TABLE assignment_rule_member (
  assignment_rule_id uuid NOT NULL REFERENCES assignment_rule(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user_profile(user_id),
  position integer NOT NULL,
  PRIMARY KEY (assignment_rule_id, user_id)
);
CREATE TABLE lead_form_assignment_rule (
  lead_form_id uuid NOT NULL REFERENCES lead_form(id) ON DELETE CASCADE,
  assignment_rule_id uuid NOT NULL REFERENCES assignment_rule(id),
  sort_order integer NOT NULL,
  PRIMARY KEY (lead_form_id, assignment_rule_id)
);
CREATE TABLE assignment_state (                    -- round-robin cursor; updated with SELECT … FOR UPDATE
  assignment_rule_id uuid PRIMARY KEY REFERENCES assignment_rule(id) ON DELETE CASCADE,
  last_assigned_user_id uuid NULL REFERENCES app_user_profile(user_id),
  last_assigned_at timestamptz NULL
);

CREATE TABLE lead_form_submission (
  id uuid PRIMARY KEY,
  lead_form_id uuid NOT NULL REFERENCES lead_form(id),
  channel text NOT NULL CHECK (channel IN ('hosted_form','webhook')),
  received_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  source jsonb NULL,                                -- utm/page/referrer (BR-LED-005)
  ip_hash char(64) NULL,
  spam_verdict text NOT NULL CHECK (spam_verdict IN ('clean','rejected_honeypot','rejected_captcha','rate_limited','captcha_unavailable_accepted')),
  processing_status text NOT NULL CHECK (processing_status IN ('received','processed','rejected','failed')),
  dedupe_result jsonb NULL, resulting_records jsonb NULL,
  assigned_user_id uuid NULL REFERENCES app_user_profile(user_id),
  assignment_rule_id uuid NULL REFERENCES assignment_rule(id),
  processed_at timestamptz NULL, error_code text NULL
);
CREATE INDEX lead_submission_form_idx ON lead_form_submission (lead_form_id, received_at DESC);
```

---

## 11. Import module

```sql
CREATE TABLE import_batch (
  id uuid PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('csv','xlsx','hubspot_export','pipedrive_export','api')),
  entity_types text[] NOT NULL,
  source_file_ids uuid[] NOT NULL,
  mapping jsonb NULL, defaults jsonb NULL,
  duplicate_strategy_default text NOT NULL DEFAULT 'skip' CHECK (duplicate_strategy_default IN ('skip','merge','create')),
  status text NOT NULL CHECK (status IN ('uploaded','mapped','validating','validated','committing','committed','undoing','undone','failed')),
  counts jsonb NOT NULL DEFAULT '{}',
  committed_at timestamptz NULL, undone_at timestamptz NULL, undone_by uuid NULL REFERENCES app_user_profile(user_id),
  undo_report jsonb NULL, failure_code text NULL
  -- AUDIT
);
CREATE TABLE import_row (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES import_batch(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('company','contact','deal')),
  raw_data jsonb NOT NULL, mapped_data jsonb NULL,
  validation_errors jsonb NOT NULL DEFAULT '[]',
  duplicate_candidates jsonb NOT NULL DEFAULT '[]',
  resolution text NULL CHECK (resolution IN ('skip','merge','create')),
  merge_target_id uuid NULL,
  outcome text NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','created','merged','skipped','error')),
  UNIQUE (batch_id, entity_type, row_number)
);
CREATE INDEX import_row_batch_outcome_idx ON import_row (batch_id, outcome);
CREATE TABLE import_record_link (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES import_batch(id),
  row_id uuid NOT NULL REFERENCES import_row(id),
  record_type text NOT NULL CHECK (record_type IN ('company','contact','deal','deal_contact')),
  record_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('created','merged')),
  before_snapshot jsonb NULL,             -- merged: changed fields before import
  after_row_version integer NOT NULL
);
CREATE INDEX import_record_link_batch_idx ON import_record_link (batch_id);
```

---

## 12. AI module

```sql
CREATE TABLE prompt_version (
  id uuid PRIMARY KEY, key text NOT NULL, version integer NOT NULL,
  content_hash char(64) NOT NULL, model text NOT NULL, params jsonb NOT NULL,
  active boolean NOT NULL DEFAULT false, released_at timestamptz NOT NULL,
  UNIQUE (key, version)
);
CREATE UNIQUE INDEX prompt_one_active ON prompt_version (key) WHERE active;
-- Prompt text lives in code (packages); this table registers which version ran (ADR-014).

CREATE TABLE ai_generation (
  id uuid PRIMARY KEY,
  feature text NOT NULL CHECK (feature IN ('draft_section','rewrite_text','deal_summary','follow_up_email')),
  requested_by uuid NOT NULL REFERENCES app_user_profile(user_id),
  deal_id uuid NULL REFERENCES deal(id),
  target jsonb NOT NULL,                    -- {proposalVersionId, sectionId} | {dealId} | {taskId}
  prompt_version_id uuid NOT NULL REFERENCES prompt_version(id),
  context_refs jsonb NOT NULL,              -- [{type,id}] records used (no content)
  output jsonb NULL,                        -- text or ProseMirror fragment (sanitised)
  status text NOT NULL CHECK (status IN ('streaming','pending','accepted','edited_accepted','rejected','discarded','failed')),
  decided_by uuid NULL REFERENCES app_user_profile(user_id), decided_at timestamptz NULL,
  ai_usage_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL   -- retention OD-84
);
CREATE INDEX ai_generation_target_idx ON ai_generation USING gin (target jsonb_path_ops);

CREATE TABLE ai_check_result (
  id uuid PRIMARY KEY,
  proposal_version_id uuid NOT NULL REFERENCES proposal_version(id),
  requested_by uuid NULL REFERENCES app_user_profile(user_id),
  status text NOT NULL CHECK (status IN ('running','completed','partial','failed')),
  deterministic_findings jsonb NOT NULL DEFAULT '[]',
  llm_findings jsonb NOT NULL DEFAULT '[]',
  llm_status text NOT NULL CHECK (llm_status IN ('disabled','pending','completed','failed','skipped_budget')),
  content_sha256 char(64) NOT NULL,          -- check is valid only for this exact draft content
  acknowledgements jsonb NOT NULL DEFAULT '[]',
  completed_at timestamptz NULL, ai_usage_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_check_version_idx ON ai_check_result (proposal_version_id, created_at DESC);
ALTER TABLE proposal_version ADD FOREIGN KEY (last_presend_check_id) REFERENCES ai_check_result(id);

CREATE TABLE ai_usage (                         -- append-only, metadata only (ADR-035)
  id uuid PRIMARY KEY,
  feature text NOT NULL, provider text NOT NULL, model text NOT NULL,
  prompt_version_id uuid NULL REFERENCES prompt_version(id),
  user_id uuid NULL REFERENCES app_user_profile(user_id),
  record_type text NULL, record_id uuid NULL,
  input_tokens integer NOT NULL DEFAULT 0, output_tokens integer NOT NULL DEFAULT 0,
  cache_read_tokens integer NOT NULL DEFAULT 0, cache_write_tokens integer NOT NULL DEFAULT 0,
  latency_ms integer NULL,
  estimated_cost numeric(12,6) NOT NULL DEFAULT 0, cost_currency char(3) NOT NULL DEFAULT 'USD',
  outcome text NOT NULL CHECK (outcome IN ('success','error','blocked_disabled','blocked_budget','blocked_permission','refused')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_month_idx ON ai_usage (occurred_at);
CREATE INDEX ai_usage_user_day_idx ON ai_usage (user_id, occurred_at);
```

---

## 13. Notifications module

```sql
CREATE TABLE notification (
  id uuid PRIMARY KEY,
  seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,       -- polling cursor (ADR-023)
  recipient_user_id uuid NOT NULL REFERENCES app_user_profile(user_id),
  event_type text NOT NULL,                              -- catalogue in NOTIFICATION-AUTOMATION-DESIGN §2
  subject_type text NOT NULL, subject_id uuid NOT NULL,
  deal_id uuid NULL,
  title text NOT NULL, body text NOT NULL, link_path text NOT NULL,
  source_event_id uuid NULL,
  dedupe_key text NOT NULL UNIQUE,
  channels text[] NOT NULL,
  email_status text NOT NULL DEFAULT 'not_sent' CHECK (email_status IN ('not_sent','queued','sent','failed','suppressed')),
  read_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_user_seq_idx ON notification (recipient_user_id, seq DESC);
CREATE INDEX notification_user_unread_idx ON notification (recipient_user_id) WHERE read_at IS NULL;

CREATE TABLE notification_preference (
  user_id uuid NOT NULL REFERENCES app_user_profile(user_id),
  event_type text NOT NULL,
  in_app boolean NOT NULL, email boolean NOT NULL,
  PRIMARY KEY (user_id, event_type)
);
CREATE TABLE notification_digest_setting (
  user_id uuid PRIMARY KEY REFERENCES app_user_profile(user_id),
  enabled boolean NOT NULL DEFAULT false, local_time time NOT NULL DEFAULT '08:00'
);
CREATE TABLE digest_run (
  user_id uuid NOT NULL REFERENCES app_user_profile(user_id),
  digest_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','sent','skipped_empty','failed')),
  sent_at timestamptz NULL,
  PRIMARY KEY (user_id, digest_date)
);
```

---

## 14. Automation module (ADR-024)

```sql
CREATE TABLE automation_setting (
  id uuid PRIMARY KEY,
  rule_key text NOT NULL CHECK (rule_key IN ('aut_001_stage_on_send','aut_002_won_on_signed','aut_003_task_on_decline','aut_004_follow_up_unanswered','aut_005_stalled_flag','aut_006_overdue_flag','od17_task_on_accept','od23_void_siblings')),
  pipeline_id uuid NULL REFERENCES pipeline(id),        -- NULL = global
  enabled boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL,          -- aut_001: {targetStageId}; aut_004: {daysAfterSend, aiDraft}; aut_003: {taskDueDays}
  -- AUDIT
  UNIQUE NULLS NOT DISTINCT (rule_key, pipeline_id)
);

CREATE TABLE automation_execution (
  id uuid PRIMARY KEY,
  rule_key text NOT NULL,
  trigger_event_id uuid NULL,
  idempotency_key text NOT NULL UNIQUE,            -- e.g. BR-AUT-002:{signatureRequestId} (RULE-AUT-24)
  target_type text NOT NULL, target_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('applied','skipped_precondition','skipped_conflict','failed','reversed')),
  before_snapshot jsonb NULL, after_snapshot jsonb NULL,
  related_changes jsonb NOT NULL DEFAULT '[]',     -- e.g. sibling proposals [{proposalId, priorStatus}] (ADR-025)
  created_records jsonb NOT NULL DEFAULT '[]',
  target_row_version_after integer NULL,           -- CAS base for reversal
  executed_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz NULL, reversed_by uuid NULL REFERENCES app_user_profile(user_id), reversal_reason text NULL
);
CREATE INDEX automation_execution_target_idx ON automation_execution (target_type, target_id, executed_at DESC);

CREATE TABLE deal_flag (
  id uuid PRIMARY KEY,
  deal_id uuid NOT NULL REFERENCES deal(id),
  kind text NOT NULL CHECK (kind IN ('stalled','past_close_date','signed_on_stale_version')),   -- past_close_date = "overdue" in RULE-AUT-40..42
  raised_at timestamptz NOT NULL DEFAULT now(), cleared_at timestamptz NULL,
  dismissed_until timestamptz NULL,               -- RULE-AUT-35/42 reversal = dismiss
  dismissed_by uuid NULL REFERENCES app_user_profile(user_id),
  automation_execution_id uuid NULL REFERENCES automation_execution(id),
  details jsonb NULL
);
CREATE UNIQUE INDEX deal_flag_one_open ON deal_flag (deal_id, kind) WHERE cleared_at IS NULL;
```

---

## 15. Timeline module (ADR-082)

```sql
CREATE TABLE timeline_event (
  id uuid PRIMARY KEY,
  event_type text NOT NULL,                       -- DOMAIN-MODEL §17.1 list
  source_type text NOT NULL, source_id uuid NOT NULL,
  actor jsonb NOT NULL,                           -- ActorRef (BR-TIM-004)
  actor_type text NOT NULL CHECK (actor_type IN ('user','buyer','system','ai')),
  occurred_at timestamptz NOT NULL,
  summary text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',               -- small display payload, never private email content
  is_automated boolean NOT NULL DEFAULT false,
  automation_execution_id uuid NULL,
  privacy text NOT NULL DEFAULT 'normal' CHECK (privacy IN ('normal','private_email')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE timeline_event_anchor (
  timeline_event_id uuid NOT NULL REFERENCES timeline_event(id) ON DELETE CASCADE,
  record_type text NOT NULL CHECK (record_type IN ('company','contact','deal')),
  record_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,              -- copy for keyset pagination
  event_type text NOT NULL,                      -- copy for filter (BR-TIM-002)
  PRIMARY KEY (record_type, record_id, occurred_at, timeline_event_id)
);
CREATE INDEX timeline_anchor_type_idx ON timeline_event_anchor (record_type, record_id, event_type, occurred_at DESC);
```

---

## 16. Platform module

```sql
CREATE TABLE file_object (
  id uuid PRIMARY KEY,
  storage_key text NOT NULL UNIQUE,                -- e.g. proposals/{yyyy}/{mm}/{uuid}.pdf
  content_type text NOT NULL, size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 char(64) NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('proposal_pdf','proposal_docx','signed_pdf','certificate','template_asset','branding','import_source','export_archive','webhook_payload','audit_export')),
  immutable boolean NOT NULL DEFAULT false,         -- Object Lock applied (signed docs, certificates, audit exports)
  owner_type text NULL, owner_id uuid NULL,
  retention_class text NOT NULL,
  uploaded_by uuid NULL REFERENCES app_user_profile(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);
CREATE INDEX file_object_owner_idx ON file_object (owner_type, owner_id);

CREATE TABLE audit_log (                           -- append-only, partitioned monthly (ADR-083)
  id uuid NOT NULL,
  seq bigint NOT NULL,                              -- from sequence audit_log_seq (ordering for sealer)
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor jsonb NOT NULL, actor_type text NOT NULL,
  action text NOT NULL,                             -- dot.case catalogue (AUDIT-LOGGING-DESIGN §3)
  target_type text NULL, target_id uuid NULL,
  changes jsonb NULL,                               -- redacted diff (ids, not personal data where possible)
  request_id text NULL, ip_truncated inet NULL, user_agent text NULL,
  outcome text NOT NULL CHECK (outcome IN ('success','denied','failed')),
  PRIMARY KEY (occurred_at, id)
) PARTITION BY RANGE (occurred_at);
CREATE INDEX audit_log_target_idx ON audit_log (target_type, target_id, occurred_at DESC);
CREATE INDEX audit_log_actor_idx ON audit_log ((actor->>'userId'), occurred_at DESC);
CREATE UNIQUE INDEX audit_log_seq_idx ON audit_log (seq, occurred_at);

CREATE TABLE audit_chain (                          -- ADR-072
  seq bigint PRIMARY KEY,
  audit_log_id uuid NOT NULL,
  row_hash char(64) NOT NULL,
  chain_hash char(64) NOT NULL,                     -- sha256(prev.chain_hash || row_hash)
  sealed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_anchor (
  id uuid PRIMARY KEY, up_to_seq bigint NOT NULL, chain_hash char(64) NOT NULL,
  exported_file_id uuid NULL REFERENCES file_object(id), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE domain_event (                         -- history only (ADR-022), partitioned monthly
  id uuid NOT NULL,
  name text NOT NULL,                               -- WORKFLOWS.md §0.3 catalogue
  aggregate_type text NOT NULL, aggregate_id uuid NOT NULL,
  actor jsonb NOT NULL,
  payload jsonb NOT NULL,                           -- ids and small values only
  occurred_at timestamptz NOT NULL DEFAULT now(),
  request_id text NULL,
  PRIMARY KEY (occurred_at, id)
) PARTITION BY RANGE (occurred_at);
CREATE INDEX domain_event_aggregate_idx ON domain_event (aggregate_type, aggregate_id, occurred_at);

CREATE TABLE idempotency_key (
  key text NOT NULL, scope text NOT NULL,           -- scope = userId|endpoint or buyerSession|endpoint
  request_hash char(64) NOT NULL,
  status text NOT NULL CHECK (status IN ('in_progress','completed')),
  response_status smallint NULL, response_body jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  PRIMARY KEY (scope, key)
);
CREATE TABLE rate_limit_bucket (
  bucket_key text NOT NULL, window_start timestamptz NOT NULL, count integer NOT NULL,
  PRIMARY KEY (bucket_key, window_start)
);

CREATE TABLE export_job (
  id uuid PRIMARY KEY, requested_by uuid NOT NULL REFERENCES app_user_profile(user_id),
  status text NOT NULL CHECK (status IN ('queued','running','completed','failed','expired')),
  manifest jsonb NULL, file_object_id uuid NULL REFERENCES file_object(id),
  expires_at timestamptz NULL, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz NULL
);
CREATE UNIQUE INDEX export_one_running ON export_job ((true)) WHERE status IN ('queued','running');

CREATE TABLE retention_policy (
  category text PRIMARY KEY CHECK (category IN ('synced_email','calendar_event','view_session','download_event','lead_submission','ai_generation','ai_usage','audit_log','import_source','webhook_inbox','ip_addresses','notification','domain_event')),
  retention_days integer NOT NULL CHECK (retention_days > 0),
  action text NOT NULL CHECK (action IN ('delete','anonymise')),
  min_days integer NOT NULL, max_days integer NOT NULL,
  exempt boolean NOT NULL DEFAULT false,
  -- AUDIT
  CONSTRAINT retention_in_range CHECK (retention_days BETWEEN min_days AND max_days)
);

CREATE TABLE erasure_request (
  id uuid PRIMARY KEY,
  subject_type text NOT NULL CHECK (subject_type IN ('contact')), subject_id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES app_user_profile(user_id),
  reason text NOT NULL,
  status text NOT NULL CHECK (status IN ('requested','running','completed','rejected')),
  summary jsonb NULL, completed_at timestamptz NULL, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE encryption_key (                         -- keyring metadata (ADR-073); key material never stored in plaintext
  kid text PRIMARY KEY,
  purpose text NOT NULL CHECK (purpose IN ('oauth_tokens','share_tokens','totp','webhook_secrets','auth_accounts')),
  wrapped_dek text NOT NULL,                          -- DEK wrapped by KMS
  status text NOT NULL CHECK (status IN ('active','decrypt_only','retired')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX encryption_key_one_active ON encryption_key (purpose) WHERE status = 'active';
```

pg-boss creates its own tables in schema `pgboss` (owned by `crm_migrator`, ADR-050).

---

## 17. Transaction boundaries (normative)

Every row below is **one** database transaction executed by the named service through the unit of work (ADR-028). "Lock" = `SELECT … FOR UPDATE` taken first, in the listed order (deal before proposal before version before signature request) to avoid deadlocks.

| Operation | Locks | Writes in the same transaction | Jobs enqueued in-tx |
|---|---|---|---|
| Create deal | — | deal, deal_contact(s), deal_stage_history, timeline_event(+anchors), audit_log, domain_event `deal.created` | — |
| Move stage / close won / close lost | deal | deal (status, stage, closed fields), deal_stage_history, deal_flag clear, timeline, audit, domain_event `deal.stage_changed`/`deal.closed_won`/`deal.closed_lost`; on Lost with open signature request: signature_request→voided + `esign.void` | `esign.void`, `evt.*` subscribers |
| Reassign owner (single/bulk ≤ 500) | each deal (id order) | deal.owner_id, timeline `owner_changed`, audit | notifications |
| Create proposal | deal (share) | proposal, proposal_version (draft, resolved bindings), pricing tables/lines, timeline, audit | — |
| Save draft | proposal_version (row_version CAS) | proposal_version, pricing_table/line (replace), audit (field summary) | — |
| Prepare send (ADR-081) | proposal, draft version | proposal_send_attempt(preparing), version.send_lock_until | `pdf` (render), then `proposal.send.prepared` |
| Commit send | deal, proposal, version, previous sent version, open signature request | version→sent (frozen fields), previous→superseded, signature_request→voided (if any), recipients, share_links, proposal.status=sent, send_attempt→committed, timeline, audit, domain_event `proposal.version_sent` | `mail.send` (crm_email), `esign.void`, BR-AUT-001/BR-AUT-004 subscribers, `ai.generate` none |
| Buyer first view (heartbeat confirmed) | proposal | view_session, share_link first/last viewed, proposal.status sent→viewed (via proposals state machine), timeline, domain_event `proposal.view_counted` | notification subscriber |
| Forwarded viewer identified | deal | contact (create/match), deal_contact + role, viewer_identity, timeline `stakeholder_added`, audit (buyer actor) | notification `proposal_forwarded_new_viewer` |
| Buyer accept/decline | deal, proposal | buyer_response, proposal.status, timeline, domain_event | BR-AUT-003 / OD-17 task, notifications |
| Request signatures | deal, proposal, version | signature_request(pending), signers, timeline, audit | `esign.dispatch` |
| Process provider completion | deal, proposal, version, signature_request | signers, signature_event, signature_request→signed, proposal→signed, version→signed, domain_event `signature_request.completed`; if stale → deal_flag `signed_on_stale_version` instead | `esign.fetch-signed`, BR-AUT-002 subscriber |
| BR-AUT-002 Closed Won | deal, proposal(s) | deal (won, amount=TCV, close_date=signing date), sibling proposals→void (automation), automation_execution, timeline (automated), audit | notifications |
| Reverse automation | target (CAS row_version) | target restore, related_changes restore, automation_execution→reversed, timeline `automation_reversed`, audit | — |
| Lead submission processing | assignment_state (round-robin) | company/contact (match or create), deal (optional), deal_contact, submission status, timeline, audit | notification `new_lead_assigned` |
| Import commit chunk (500 rows) | import_batch | entities, import_record_link, import_row outcomes, counts | next chunk |
| Mail sync page | mailbox_connection (advisory lock by singleton job) | email_thread/message/participant/link, deal.last_activity_at, timeline, cursor | AUT subscribers (`answered` detection) |
| Deactivate user | user + all reassigned records | profile, team_membership.is_active=false, reassignments, assignment_rule_member delete, mailbox disconnect, auth_session delete, audit | token revoke at provider |

Isolation level: READ COMMITTED (default) with explicit row locks above; uniqueness races are resolved by unique indexes (caught and mapped to domain errors).

---

## 18. Partitioning, retention and sizing

| Table | Strategy | Retention (default, Admin-configurable within limits, OD-36/OD-84) |
|---|---|---|
| audit_log | Monthly partitions; drop partitions older than retention after WORM export | 7 years (min 1 y, max 10 y) — exempt from erasure |
| domain_event | Monthly partitions | 13 months |
| view_session, download_event | Plain (≤ 10 M rows/year) | 3 years; IP truncation at insert; `ip_truncated` nulled after 90 days (OD-84) |
| email_message (+participants, links) | Plain; consider partitioning if > 20 M rows | Per `retention_policy.synced_email` (default 5 years) |
| esign_webhook_inbox.raw_body | Purge job | 30 days |
| idempotency_key, rate_limit_bucket | Purge job | 24 h / 2 h |
| ai_generation | Purge job on `expires_at` | 180 days (output text), metadata stays in ai_usage |
| notification | Purge job | 12 months |

Sizing at OD-45 limits (year 1): ~80–90 GB, dominated by email bodies (see DATA-FLOW-ARCHITECTURE §10). Object storage: PDFs ~0.5 MB × 20k/year × versions ≈ 30 GB/year.

---

## 19. Seed and reference data (created by `bootstrap` CLI and migrations, not mock data)
- `organization_settings` row (bootstrap command inputs: organization name, default currency, time zone, first admin email).
- Default pipeline with stages: open stages from the bootstrap input (or a minimal "Qualification, Proposal, Negotiation"), plus system "Closed Won" (100) and "Closed Lost" (0).
- System contact roles: Decision-maker, Signer (`system_key='signer'`), Influencer, Forwarded viewer (`system_key='forwarded_viewer'`).
- Default `tax_category` (0 %, code `EXEMPT`) until Finance supplies real categories (OD-49).
- `retention_policy` rows with defaults above; `discount_limit` rows for each role (100 % until configured, OD-39); `automation_setting` rows for all built-in rules (enabled, global config).
- `free_mail_domains` seed list; `internal_domains` = login allowed domains.
- Prompt versions registered by migration from code.

## 20. Data-access rules for developers
1. Never query an owned table from another module; call the owning module's service (dependency-cruiser enforced, ADR-021/028).
2. Every list/search/report query starts from `policy.scopeFilter(actor, recordType, access)` (ADR-076).
3. Every UPDATE of an AUDIT table includes the `row_version` predicate.
4. JSONB columns are written only through Zod-validated service functions; shapes are versioned (`schema_version` for content).
5. Archived rows are excluded by default; queries opt in with `includeArchived` (Admin only).
