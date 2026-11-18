# Architecture Decision Records — Internal Sales CRM (Phase 1)

| Item | Value |
|---|---|
| Status | Accepted for Phase 1 design (decisions marked "pending OD-xx" are reversible working assumptions) |
| Scope | Single-company, single-tenant internal Sales CRM (IDD-01) |
| Authority | This log is the single register of ADR numbers. Other documents cite ADRs by these numbers. |
| Related | SYSTEM-ARCHITECTURE.md, COMPONENT-ARCHITECTURE.md, MODULE-ARCHITECTURE.md, SECURITY-ARCHITECTURE.md, DEPLOYMENT-ARCHITECTURE.md, AI-ARCHITECTURE.md, DATA-FLOW-ARCHITECTURE.md, INTEGRATION-ARCHITECTURE.md, ../01-specifications/OPEN-DECISIONS.md |

## 0. How to read this log

- **Status values:** Accepted · Accepted – pending OD-xx (design uses the working assumption) · Refined by ADR-xxx (still valid, detail changed) · Superseded by ADR-xxx (no longer valid).
- **Numbering:** ADR-001..019 are the original backbone. ADR-020..037 record the outcomes of the two independent architecture challenges (Software Architect; wshobson comprehensive-review architect-review). ADR-040..044 come from the AI architecture, ADR-045..052 from deployment architecture, ADR-053..055 from component/module architecture, ADR-071..076 from the security architecture, and ADR-080..087 from data-flow/integration architecture. Gaps (038–039, 056–070, 077–079) are unused on purpose. New ADRs start at ADR-088.
- **Review process followed:** every backbone ADR was challenged by two architecture reviewers before HLD writing; HLD authors proposed further ADRs; conflicts were resolved by the Principal Solution Architect and recorded here.

## 1. Register

| ADR | Title | Status | Key refs |
|---|---|---|---|
| ADR-001 | Modular monolith, one codebase, one PostgreSQL database | Accepted; refined by ADR-045 (three runtime roles) | NFR-014, IDD-01 |
| ADR-002 | React 19 SPA with TanStack Router/Query/Table/Form, Tailwind v4, shadcn/ui, TipTap | Accepted; refined by ADR-020 | BR-CRM-011, BR-TPL-001 |
| ADR-003 | Hono on Node.js LTS, REST `/api/v1`, Zod v4 contracts, OpenAPI 3.1 | Accepted | BR-EML-005, NFR-014 |
| ADR-004 | TanStack Start not chosen for Phase 1 | Accepted | ADR-003 |
| ADR-005 | PostgreSQL + Drizzle ORM, UUIDv7, numeric money, audit columns, archive semantics, FTS | Accepted; refined by ADR-032 | NFR-001, BR-CRM-012 |
| ADR-006 | Better Auth for authentication; application-owned authorization; no RLS | Accepted; refined by ADR-027, ADR-076 | BR-PLT-003/004/005, §9.17 |
| ADR-007 | pg-boss for background jobs and schedules | Accepted | NFR-005, BR-SIG-008 |
| ADR-008 | Transactional outbox `domain_event` with dispatcher | **Superseded by ADR-022** | — |
| ADR-009 | Real-time via SSE + LISTEN/NOTIFY | Refined by ADR-023 | BR-NTF-001, NFR-005 |
| ADR-010 | Canonical JSON content model; one HTML renderer; Playwright PDF; `docx` DOCX | Accepted; refined by ADR-029, ADR-045 | BR-PRP-004/005, OD-43 |
| ADR-011 | Object storage behind an adapter | Refined by ADR-036 | BR-SIG-010 |
| ADR-012 | External integrations behind adapters (Mail, Calendar, ESignature, AI, TransactionalEmail, Storage, Captcha) | Accepted | OD-02/03/05/06/14/46 |
| ADR-013 | Buyer access via unguessable share tokens and a public API | Accepted; refined by ADR-034, ADR-071 | BR-SHR-001..010 |
| ADR-014 | AI server-side only, versioned prompts, permission-scoped context, labelled output | Refined by ADR-035 | BR-AIA-001..009 |
| ADR-015 | Automation rules stored as rows in `automation_rule` | **Superseded by ADR-024** | — |
| ADR-016 | API conventions (pagination, errors RFC 9457, idempotency, optimistic concurrency, CSRF) | Accepted | NFR-012 |
| ADR-017 | Observability baseline (structured logs, request ids) | Refined by ADR-030, ADR-051 | NFR-009 |
| ADR-018 | pnpm workspace monorepo | Refined by ADR-021 | NFR-014 |
| ADR-019 | Not used: microservices, Redis, brokers, Elasticsearch, GraphQL, RLS, SSR framework | Accepted | Project constraints |
| ADR-020 | One Vite project with three HTML entries; buyer surface on a separate origin | Accepted | BR-SHR-009, BR-EML-005, BR-LED-001 |
| ADR-021 | Four workspace packages + dependency-cruiser boundaries | Accepted | NFR-014 |
| ADR-022 | pg-boss jobs enqueued inside the business transaction; `domain_event` = history only; idempotent handlers; DLQ | Accepted | NFR-005, BR-AUT-008 |
| ADR-023 | Notifications: table + cursor polling baseline + SSE poke via LISTEN/NOTIFY | Accepted | BR-NTF-001, NFR-005 |
| ADR-024 | Automation: built-in rules in code + `automation_setting` + `automation_execution` | Accepted | BR-AUT-001..008 |
| ADR-025 | Signing-chain integrity: webhook inbox, reconciliation, stale-version signing, DB-enforced immutability, one open request per deal | Accepted | BR-SIG-001..013, OD-21..25 |
| ADR-026 | Security hardening baseline (offline PDF, XSS/CSP, token handling, envelope encryption, rate-limit tiers, audit chain, DB roles, scopeFilter, upload validation) | Accepted | NFR-001, NFR-009 |
| ADR-027 | Authentication details (add-in auth, hd/tid checks, invite-only, MFA middleware, single role source) | Accepted; refined by ADR-074, ADR-085 | BR-PLT-002/003/004 |
| ADR-028 | Module boundaries and unit-of-work cross-cutting writers | Accepted | NFR-014 |
| ADR-029 | Section + ProseMirror content model | Accepted | BR-TPL-001..004, BR-PRP-003/006 |
| ADR-030 | Operations: PITR, restore drills, migration release job, mandatory observability | Accepted; refined by ADR-049, ADR-051 | NFR-006, NFR-008 |
| ADR-031 | Email/calendar sync by polling with minimal scopes and pre-persist filtering | Accepted; refined by ADR-080 | BR-EML-001..006 |
| ADR-032 | PostgreSQL 18 preferred, 17 fallback | Accepted – pending OD-11 | ADR-005 |
| ADR-033 | Code repository outside OneDrive | Accepted | Dev environment |
| ADR-034 | Share-link token stored as hash + envelope-encrypted copy | Accepted | BR-SHR-001, PERM-118 |
| ADR-035 | AI guardrails (authoritative deterministic checks, per-request scoped context, budgets, no prompt logging) | Accepted | BR-AIA-002/006/007/009 |
| ADR-036 | Single object-storage driver + immutability for signed artifacts | Accepted – pending OD-11, OD-102 | BR-SIG-010 |
| ADR-037 | Single worker instance by default | Accepted | OD-45 |
| ADR-040 | AI streaming transport (SSE from server for drafting/rewrite) | Accepted | BR-AIA-001/004 |
| ADR-041 | AI model routing per feature | Accepted – pending OD-05, evals | BR-AIA-001..005 |
| ADR-042 | AI output contracts without tool use | Accepted | BR-AIA-006 |
| ADR-043 | AI budget enforcement (cost budget primary, token caps secondary) | Accepted – pending OD-53 | IDD-10 |
| ADR-044 | AI evaluation harness | Accepted – pending OD-95 | §13.4 AI risks |
| ADR-045 | Separate `renderer` runtime role for PDF/DOCX | Accepted | NFR-005, ADR-026 |
| ADR-046 | Single application image + renderer image; build once, promote by digest | Accepted | NFR-006 |
| ADR-047 | Managed container platform, no Kubernetes | Accepted – pending OD-11 | Constraints |
| ADR-048 | Two-layer egress control | Accepted – pending OD-97 | NFR-001 |
| ADR-049 | Managed PostgreSQL HA + 35-day PITR | Accepted – pending OD-96 | NFR-006, NFR-008 |
| ADR-050 | pg-boss schema owned by the migration job | Accepted | ADR-026 DB roles |
| ADR-051 | Observability stack and alert catalogue | Accepted – pending OD-98 | NFR-005/006/009 |
| ADR-052 | Rollout and rollback policy (forward-only migrations, expand/contract) | Accepted | NFR-006 |
| ADR-053 | Persist-then-process for all inbound external events (webhook inbox, lead submissions) | Accepted | BR-LED-001/007, BR-SIG-007 |
| ADR-054 | Per-instance LocalCache with TTL + NOTIFY invalidation (no shared cache) | Accepted | NFR-005 |
| ADR-055 | Ports for upward calls + static event-subscription registry | Accepted | NFR-014 |
| ADR-071 | Buyer token in URL fragment, exchanged for a link-bound cookie | Accepted | BR-SHR-001/004/005 |
| ADR-072 | Asynchronous audit hash-chain sealer with WORM anchoring | Accepted | BR-PLT-009, NFR-009 |
| ADR-073 | Application keyring: per-purpose DEKs wrapped by cloud KMS | Accepted – pending OD-11 | NFR-001 |
| ADR-074 | Add-in session establishment (restricted `addin` sessions) | Accepted | BR-EML-005 |
| ADR-075 | Host-based sub-apps and per-origin security headers | Accepted | BR-SHR-009 |
| ADR-076 | Compile-time scoped repositories (`ScopedQuery`) | Accepted | §9.17, BR-RPT-008 |
| ADR-080 | Metadata-first mail fetch | Accepted | BR-EML-003, OD-29 |
| ADR-081 | Two-phase proposal send (prepare → commit) | Accepted | BR-SHR-002, RULE-PRP-09 |
| ADR-082 | Timeline anchor table | Accepted | BR-TIM-001..003 |
| ADR-083 | Monthly partitioning of `audit_log` and `domain_event` | Accepted | NFR-015 |
| ADR-084 | No blind resend of ambiguous mailbox sends | Accepted | BR-EML-004, BR-SHR-002 |
| ADR-085 | Outlook add-in auth: Nested App Authentication, Office dialog fallback | Accepted – pending OD-07 | BR-EML-005 |
| ADR-086 | Webhook verification baseline for providers without body signatures | Accepted – pending OD-03 | BR-SIG-* |
| ADR-087 | Per-provider bulkheads and circuit breaking in the worker | Accepted | NFR-006 |

## 2. Decision records

### ADR-001 — Modular monolith, one codebase, one PostgreSQL database
- **Context.** One company, ≤ 150 internal users (OD-45), 16 business modules, strong cross-module transactions (send → stage change → timeline → audit; signature → Closed Won). Team productivity and auditability dominate; there is no independent scaling or deployment need per module.
- **Decision.** A single TypeScript codebase organised as bounded modules (MODULE-ARCHITECTURE.md) with one PostgreSQL database. Runtime roles from the same code: `server` (HTTP), `worker` (jobs/schedules), `renderer` (PDF/DOCX, ADR-045), plus a one-shot `migrate` release job.
- **Alternatives.** (a) Microservices per module — rejected: distributed transactions for the signing chain, many deployables, no scaling driver. (b) Single process doing HTTP and jobs — rejected: PDF rendering and mail sync would compete with request latency (NFR-005) and the renderer needs network isolation (ADR-045). (c) Serverless functions — rejected: long-running sync, warm Chromium, LISTEN connections.
- **Consequences.** Simple local development and deployment; module boundaries must be enforced by tooling (ADR-021, ADR-028); one database is the scaling ceiling, which OD-45 volumes do not approach (DATA-FLOW-ARCHITECTURE §10: ~80–90 GB year 1).

### ADR-002 — Frontend stack
- **Decision.** React 19 + Vite; TanStack Router (file-based, typed routes, search-param state), TanStack Query (server state), TanStack Table (list views, BR-CRM-011), TanStack Form + Zod (forms), Tailwind CSS v4 + shadcn/ui (Radix primitives, WCAG 2.1 AA base, NFR-011), TipTap (ProseMirror) for template/proposal editing, dnd-kit for the deal board.
- **Alternatives.** Next.js / TanStack Start (SSR not needed, ADR-004); React Hook Form (fine, but TanStack Form keeps one ecosystem and typed field APIs); MUI/Ant (heavier, less control over a11y/branding); Slate/Lexical (TipTap/ProseMirror has the best schema control needed for locked sections and DOCX mapping).
- **Consequences.** Client-rendered app; first paint of the buyer page relies on a small separate bundle (ADR-020).

### ADR-003 — Backend: Hono on Node.js LTS with Zod contracts
- **Decision.** Hono with `@hono/node-server` on Node.js 26 LTS; REST JSON under `/api/v1` (internal), `/public/v1` (buyer and forms), `/webhooks/*`, `/addin/*` (Gmail card endpoints, Outlook API), SSE stream. Contracts are Zod v4 schemas in `packages/shared`; OpenAPI 3.1 generated via `@hono/zod-openapi`. Domain services are framework-free functions that take a unit of work (ADR-028); Hono routes are thin adapters; the worker calls the same services.
- **Alternatives.** Express/Fastify (Hono is lighter, first-class Zod/OpenAPI integration, Web-standard Request/Response); NestJS (heavy DI/decorators, slower to iterate); tRPC (no stable public REST for add-ins/webhooks).
- **Consequences.** One OpenAPI document serves the web app, the Outlook add-in, tests and future Phase 3 Open API.

### ADR-004 — TanStack Start not chosen for Phase 1
- **Context.** The team prefers the TanStack ecosystem; TanStack Start offers full-stack server functions and server routes.
- **Evaluation.**

| Criterion | TanStack Start alone | Hono API + Vite SPA (chosen) |
|---|---|---|
| Stable external HTTP contracts (Outlook add-in, Gmail add-on card callbacks, e-sign webhooks, lead-form intake, buyer API, tracking, SSE) | Must be written as Start server routes anyway; server functions are RPC endpoints with framework-generated URLs not suitable as external contracts | Native: every surface is an explicit, versioned route with OpenAPI |
| Background worker sharing domain services | Worker needs its own Node entry outside the Start/Nitro runtime; two runtime styles | Same services imported by `server`, `worker`, `renderer` |
| SSR/SEO need | None for an internal app; buyer page is small | Not needed |
| Surfaces with different security headers (app vs buyer origin) | Possible but less explicit | Host-based sub-apps (ADR-075) |
| Operational simplicity | One app server + worker | One Node server serving API + static assets + worker |
| Ecosystem maturity for this shape | Younger full-stack framework | Mature, minimal |
| Migration path | — | TanStack Router file routes can move to Start later if SSR becomes valuable |
- **Decision.** Use Hono + Vite SPA. Re-evaluate only if SSR becomes a real requirement (e.g. public marketing pages, which are out of scope).
- **Consequences.** Two layers to keep in sync (routes and client), mitigated by shared Zod schemas and a generated typed API client.

### ADR-005 — Database conventions
- **Decision.** PostgreSQL (version per ADR-032); Drizzle ORM schema in TypeScript with drizzle-kit generated SQL migrations that are reviewed and committed. UUIDv7 primary keys (native `uuidv7()` on PG 18, app-generated on 17). `timestamptz` (UTC). Money `numeric(18,2)`, unit prices `numeric(18,4)`, quantities `numeric(14,4)`, percentages `numeric(7,4)`, currency `char(3)`. Audit columns (`created_at/by`, `updated_at/by`, `row_version`) on mutable tables. Archive via `archived_at` for archivable entities; hard delete only through governed erasure (OD-36). Search via generated `tsvector` columns + `pg_trgm`.
- **Alternatives.** Prisma (less SQL control, heavier client); Kysely (excellent, but Drizzle gives schema-as-code + migrations in one tool); MySQL/SQLite (weaker JSONB, FTS, partial indexes, LISTEN/NOTIFY).
- **Consequences.** See DATABASE-DESIGN.md for the complete schema.

### ADR-006 — Authentication with Better Auth; authorization in the application
- **Decision.** Better Auth provides email/password, Google and Microsoft social sign-in, TOTP 2FA, sessions (HttpOnly cookies) and bearer sessions (add-in). The application owns role (`app_user_profile.role`), teams and all authorization through a central policy module (`decide`, `scopeFilter`, `redact`) applied in services and by construction in repositories (ADR-076). Postgres RLS is not used in Phase 1: one application DB role with least-privilege grants (ADR-026) and a permission test matrix per PERM row.
- **Alternatives.** Auth.js/Lucia (less complete 2FA/admin features), Keycloak/Entra-only (adds infrastructure; BR-PLT-003 requires password + Google + Microsoft), RLS (cannot cheaply express own/team/view-only/deal-derived visibility over pooled connections; complicates reporting).
- **Consequences.** A missed `scopeFilter` is the main residual risk → mitigated by ADR-076 and tests (SECURITY-ARCHITECTURE RR-03).

### ADR-007 — pg-boss for jobs
- **Decision.** pg-boss (Postgres-backed) for queues, retries with exponential backoff, cron schedules, singleton keys (one sync per mailbox), dead-letter queues. No Redis/broker.
- **Alternatives.** graphile-worker (comparable; pg-boss chosen for built-in cron, singleton and DLQ semantics), BullMQ (requires Redis), cloud queues (vendor lock-in, no in-transaction enqueue).

### ADR-008 — Outbox + dispatcher (Superseded by ADR-022)
Kept for history: a `domain_event` outbox drained by a dispatcher would duplicate what pg-boss already offers transactionally.

### ADR-009 — SSE + LISTEN/NOTIFY (Refined by ADR-023)

### ADR-010 — Document rendering
- **Decision.** One canonical content model (ADR-029) rendered to HTML by `packages/proposal` for editor preview, buyer view and PDF. PDF via headless Chromium (Playwright `page.pdf`, tagged, embedded fonts) in the renderer role (ADR-045). DOCX via the `docx` library mapping the same model (same content and order, not pixel-identical, OD-43).
- **Alternatives.** react-pdf (second layout engine → preview/PDF divergence, BR-PRP-004 "exactly as the buyer will see it"); Gotenberg (extra service, no gain); LibreOffice conversion HTML→DOCX (heavy, unpredictable).

### ADR-011 — Object storage (Refined by ADR-036)

### ADR-012 — Integration adapters
- **Decision.** Every third party is behind a port in `apps/server/src/adapters/<port>/` with one driver per provider: `MailProvider` and `CalendarProvider` (Google, Microsoft), `ESignatureProvider` (selected per OD-03), `AiProvider` (Anthropic per OD-05), `TransactionalEmail` (per OD-14), `ObjectStorage` (per OD-11), `Captcha` (Turnstile, OD-46). Contract tests per port; fakes only in tests (never as production substitutes).

### ADR-013 — Buyer access model (Refined by ADR-034, ADR-071)
- **Decision.** One link per sent version per intended recipient; 32-byte random tokens; public API `/public/v1/*` with per-IP limits; tracking recorded server-side; internal previews never create tracking events.

### ADR-014 — AI baseline (Refined by ADR-035)

### ADR-015 — Automation rule rows (Superseded by ADR-024)

### ADR-016 — API conventions
- **Decision.** JSON camelCase; cursor pagination (`limit` ≤ 100, opaque `cursor`); `sort` with `-` prefix; filters as explicit, documented query parameters; RFC 9457 `application/problem+json` with stable UPPER_SNAKE `code` (BUSINESS-RULES §20 is the code registry) and `errors[]` per field; `Idempotency-Key` required on send, sign, import commit, email send and other non-repeatable POSTs; optimistic concurrency via `rowVersion` (409 `CONCURRENT_MODIFICATION`); CSRF: SameSite=Lax cookies + Origin check on unsafe methods; `X-Request-Id` correlation. Full spec: ../03-tld/API-SPECIFICATION.md.

### ADR-017 — Observability baseline (Refined by ADR-030, ADR-051)
Structured JSON logs (pino) with request id, user id, no PII beyond ids; health and readiness endpoints.

### ADR-018 — Monorepo (Refined by ADR-021)

### ADR-019 — Deliberately not used
Microservices, Redis/Memcached, Kafka/RabbitMQ/SQS, Elasticsearch/OpenSearch, GraphQL, Postgres RLS, SSR frameworks, Kubernetes (ADR-047). Each can be introduced later only with a demonstrated requirement recorded as a new ADR.

### ADR-020 — Frontend entries and origins
- **Decision.** One Vite project `apps/web` with three HTML entries: `index.html` (internal app, app origin), `buyer.html` (buyer proposal view + hosted lead form, **separate buyer origin** e.g. `proposals.<company-domain>`), `addin.html` (Outlook task pane). The same Hono server serves both origins by host (ADR-075). Lead-form embedding is an iframe of the hosted form page (postMessage auto-resize). The Gmail add-on has no frontend (server-rendered Card JSON).
- **Alternatives.** Three separate apps (more build config, duplicated tooling); buyer view on the app origin (shares cookies/CSP with the internal app — rejected for security).

### ADR-021 — Package layout
- **Decision.** `apps/server`, `apps/web`, `packages/shared`, `packages/proposal`. dependency-cruiser rules enforce module boundaries and forbid `apps/web` importing server code. shadcn components live in `apps/web`.

### ADR-022 — In-transaction job enqueue; event history
- **Decision.** Producers call `jobs.enqueue(tx, …)` and `events.record(tx, …)` inside the business transaction; pg-boss stores jobs in the same database, so a rolled-back transaction never emits a job. `domain_event` is an append-only history (debugging, Phase 2 analytics), not a dispatch queue. Fan-out to subscribers uses the static subscription registry (ADR-055), creating one job per subscriber. Every handler is idempotent (`eventId` + subscriber key). Each queue has a dead-letter queue, alerting on depth, and an Admin replay view.
- **Verification note.** Confirm the pinned pg-boss version accepts a caller-supplied executor for `send` inside a transaction; if not, use the fallback of a minimal outbox table drained by the worker (behaviour identical for producers).

### ADR-023 — Notification delivery
- **Decision.** `notification` rows are the source of truth; the client polls `GET /api/v1/notifications?since=<cursor>` every 30 s; an SSE stream (`/api/v1/events/stream`) sends id-only "pokes" triggered by `NOTIFY` after commit, with 20 s heartbeats; each server instance holds one dedicated, non-pooled LISTEN connection. Meets NFR-005 (≤ 1 min) even if SSE is unavailable.

### ADR-024 — Automation in code
- **Decision.** BR-AUT-001..006 (plus the OD-17 accept task and OD-23 sibling auto-void) are built-in rule handlers in the automation module, configured by `automation_setting` rows (e.g. per-pipeline target stage, follow-up days, overdue flag on/off). Every firing writes `automation_execution` (idempotency key, before/after snapshot, created records, status, reversal data). BR-AUT-007 (Could) is deferred; no generic rule engine.

### ADR-025 — Signing-chain integrity
- **Decision.**
  1. Provider webhooks are verified (HMAC over raw body + timestamp tolerance, or ADR-086 baseline), persisted to `esign_webhook_inbox` (unique provider event id), acknowledged 2xx, processed asynchronously.
  2. Processing re-reads authoritative status from the provider API; only forward transitions are applied (SM-04/SM-05).
  3. An hourly reconciliation job checks every non-terminal request (RULE-SIG-14).
  4. A completion for a superseded, voided or expired request is stored as a legal record but does not trigger AUT-002; the deal gets flag `signed_on_stale_version` and the owner is notified.
  5. Partial unique index: at most one non-terminal signature request per deal (OD-23).
  6. All proposal/signature status changes go through the proposals state-machine service in one transaction holding `SELECT … FOR UPDATE` on the deal row.
  7. DB trigger blocks content updates of `proposal_version` once state ∈ (sent, superseded, signed); SHA-256 of the canonical snapshot JSON and of the PDF are stored; the PDF sent to the provider must match the frozen hash.
  8. OD-23 sibling auto-void stores prior statuses; OD-24 reversal restores deal and siblings via compare-and-swap on `row_version`.

### ADR-026 — Security hardening baseline
Detailed in SECURITY-ARCHITECTURE.md (SC-* controls). Summary: offline PDF rendering in a no-egress renderer; schema-allowlisted rich-text serialization, escaped placeholder values, sanitised email HTML in sandboxed iframes, strict CSP per entry; buyer token handling (ADR-071); envelope encryption for OAuth and share tokens (ADR-073); rate limiting at WAF/LB + Postgres buckets for auth/forms/OTP + in-memory for heartbeats; audit log INSERT-only with hash chain (ADR-072); DB roles `app` (DML), `migrator` (DDL), `readonly`; mandatory `scopeFilter` (ADR-076); upload validation (size, MIME sniffing, zip-bomb limits, image re-encode).

### ADR-027 — Authentication details
Invite-only (implicit sign-up disabled, IDD-02); Google `hd` and Microsoft `tid` claims verified server-side against `allowedDomains`/tenant; MFA policy (`optional|required_admins|required_all`, OD-13) enforced by middleware; deactivation revokes all sessions and bearer tokens; single role source `app_user_profile.role`. Gmail add-on requests verified via Google-signed ID token; Outlook add-in via ADR-085.

### ADR-028 — Module boundaries and unit of work
Cross-cutting writes only via `timeline.record(tx)`, `audit.record(tx)`, `jobs.enqueue(tx)`, `events.record(tx)`, `notify.afterCommit()`. Proposal status is owned by proposals (sharing and esign call the proposals service). Reporting is the read-only exception. Each module provides an erasure (anonymise) handler.

### ADR-029 — Content model
Template/proposal content = ordered sections; each section holds one ProseMirror document using a restricted node/mark set supported by both HTML and DOCX renderers; custom nodes: `placeholder`, `pricingTable`, `image`, `contentBlockRef` (copy-on-insert), `signatureBlock`, `pageBreak`. `schemaVersion` with stored-JSON migrations; server-side validation; version comparison = per-section text diff + pricing diff; no TipTap Pro extensions. Detail: ../03-tld/PROPOSAL-ENGINE-DESIGN.md.

### ADR-030 — Operations baseline
PITR (ADR-049), object-storage versioning/replication, quarterly restore drill with post-restore reconciliation (e-sign and mailbox resync), migrations as a one-shot release job (migrator role, advisory lock, expand/contract, never `drizzle-kit push` in production), mandatory observability (ADR-051).

### ADR-031 — Mail and calendar sync
Polling only in Phase 1 (2–5 min per mailbox, singleton job); minimal scopes (Gmail `gmail.readonly` + `gmail.send`, Calendar read-only; Graph `Mail.Read`, `Mail.Send`, `Calendars.Read`, `offline_access`); historyId/delta expiry → bounded resync; filters applied before persisting (ADR-080); sanitised bodies stored, attachments metadata only; new exclusions purge matching stored messages. Mailbox OAuth consent is separate from login OAuth.

### ADR-032 — PostgreSQL version
PostgreSQL 18 (native `uuidv7()`, improved I/O) where the managed service supports it; 17 otherwise with app-generated UUIDv7. Decision bound to OD-11.

### ADR-033 — Repository location
The code repository lives outside OneDrive (e.g. `C:\dev\sales-crm`) because pnpm symlinks and `node_modules` break under sync. Documentation may stay in OneDrive.

### ADR-034 — Share-link token storage
Store `token_hash` (SHA-256, unique, lookup) and `token_ciphertext` + `token_key_id` (envelope-encrypted) so authorised users can copy an existing link again (PERM-118). Tokens are never logged.

### ADR-035 — AI guardrails
Deterministic pre-send checks are authoritative and run even when AI is disabled (OD-55); LLM findings are advisory; context is built per request for the requesting user (scopeFilter + private-email exclusion + AI-excluded fields OD-92); untrusted text is delimited and hidden text stripped; output sanitised (no auto-loaded links/images); no cached summaries across users; budgets checked before each call (ADR-043); prompts and outputs never logged; `ai_usage` stores metadata only.

### ADR-036 — Object storage
One `ObjectStorage` interface; implement only the production driver chosen by OD-11 (S3 or Azure Blob) plus the S3 driver used against MinIO locally. Private buckets/containers, server-mediated downloads for tracked files, short-lived signed URLs for internal downloads; versioning and Object Lock/immutability (mode per OD-102) for signed PDFs, certificates and audit exports.

### ADR-037 — Single worker instance
One `worker` instance by default; pg-boss singleton keys make a second instance safe but scale-out is not designed for. The renderer may scale 1→2 (ADR-045).

### ADR-040 — AI streaming transport
Drafting and rewrite stream tokens to the browser over a per-request SSE response from `/api/v1/ai/...`; the final output is persisted as `ai_generation` (pending) only on completion. Summaries and pre-send checks are non-streaming (summary in request, pre-send LLM check as a job).

### ADR-041 — AI model routing
Default routing (eval-gated, configurable per prompt version): Claude Sonnet 5.5 for section drafting, deal summary and follow-up drafts; Claude Haiku 5.5 for rewrite; Claude Opus 5.5 for the pre-send LLM consistency check (structured JSON output, worker job) and as offline eval judge. Claude Fable 5.2 excluded because its data-retention requirement conflicts with the zero-data-retention request (OD-05, OD-90).

### ADR-042 — AI output contracts without tools
The model is never given tools or the ability to call back into the system; outputs are text or schema-validated JSON (BR-AIA-006). Invalid JSON → one repair retry, then failure surfaced to the user.

### ADR-043 — AI budget enforcement
Monthly organization cost budget (primary) and per-user daily caps (secondary), checked before every call; warn at 80 %, block at 100 % with `AI_BUDGET_EXCEEDED` (OD-53 defaults).

### ADR-044 — AI eval harness
Versioned golden datasets per feature, offline regression runs on prompt/model changes, LLM-as-judge (Opus) plus deterministic assertions; release gate for prompt versions (OD-95 data source).

### ADR-045 — Renderer runtime role
- **Context.** Chromium must not reach the internet (SSRF, A10), but the worker needs egress to Google/Microsoft/AI/e-sign/email providers, and network policy is per container.
- **Decision.** Separate `renderer` role (image `crm-renderer` with Chromium) consuming only the `pdf` queue (PDF and DOCX generation), egress limited to Postgres and object storage, no third-party credentials, own DB login with minimal grants, concurrency 1–2, scale 1→2 on lag. Refines ADR-001 (three runtime roles).

### ADR-046 — Images and promotion
`crm-app` image (roles via `PROCESS_ROLE`: server, worker, migrate, cli) and `crm-renderer`. Built once in CI, promoted by digest to staging and production; configuration injected at runtime.

### ADR-047 — No Kubernetes
Managed containers (Azure Container Apps or AWS ECS Fargate per OD-11). Revisit only with > ~10 runtime units or an existing centrally operated cluster.

### ADR-048 — Egress control
Application-level outbound host allow-list (always) + NAT static IP; network FQDN firewall optional (OD-97).

### ADR-049 — Database HA and PITR
Zone-redundant HA / Multi-AZ, 35-day PITR (RPO ≤ 5 min, RTO ≤ 8 h — exceeds NFR-008), geo-redundant backups (OD-96, OD-103).

### ADR-050 — pg-boss schema ownership
Runtime pg-boss instances start with schema migration disabled; the migration job (migrator role) creates/upgrades the `pgboss` schema, so the `app` role has no DDL.

### ADR-051 — Observability stack
Cloud-native logs and metrics, error tracking (vendor per OD-98), external uptime monitor, in-DB metrics collector job (queue lag, DLQ depth, mailbox-sync lag, webhook failures, PDF render time, AI spend); alert catalogue in DEPLOYMENT-ARCHITECTURE §13.4.

### ADR-052 — Rollout and rollback
Rolling server deploys, stop-start worker/renderer, forward-only expand/contract migrations, N-1 compatibility test in CI, automatic rollback within the watch window; data damage handled by PITR.

### ADR-053 — Persist-then-process for inbound events
Every inbound external event (e-sign webhooks, lead-form submissions, lead webhooks, Gmail add-on callbacks that mutate data) is validated, persisted (inbox/submission row) and acknowledged before business processing in a job. Guarantees no loss on downstream failure and enables replay.

### ADR-054 — LocalCache with NOTIFY invalidation
Small per-instance caches (organization settings, actor permission context, AI switches) with TTL ≤ 60 s and invalidation through `NOTIFY` on change. No shared cache service.

### ADR-055 — Ports and event subscriptions
Lower-level modules define ports (interfaces) for behaviour they need from higher-level modules (e.g. `UserDeactivationHook`, `ProposalVoidPort`); implementations are registered at the composition root. Event consumers are declared in a static subscription registry producing one queue per subscriber (`evt.<event>.<subscriber>`).

### ADR-071 — Buyer token in URL fragment
Share URLs have the form `https://<buyer-origin>/p#<token>`. The buyer bundle reads and clears the fragment and calls `POST /public/v1/session/exchange`; the server returns a link-bound HttpOnly `__Host-bs` cookie and a non-secret `linkHandle`. Tokens never appear in paths, query strings, edge logs or scanner prefetches; views count only after a JS heartbeat. Supersedes the "token in path + 303" variant considered in A10.

### ADR-072 — Audit hash-chain sealer
Audit rows are inserted in the business transaction with a monotonic sequence; an ordered sealer job computes `hash = SHA-256(prev_hash || canonical(row))` into `audit_chain`, anchors hourly, exports daily to immutable storage, verifies daily. Avoids lock contention of in-transaction chaining.

### ADR-073 — Application keyring
Per-purpose data-encryption keys (oauth_tokens, share_tokens, totp, webhook_secrets) wrapped by the cloud KMS key (OD-11); AES-256-GCM; ciphertext envelope `{v, kid, iv, ct, tag}`; AAD binds ciphertext to its row/purpose (e.g. `userId|provider`); rotation by new kid + background re-encryption job.

### ADR-074 — Add-in sessions
Add-ins obtain a restricted CRM session (`kind=addin`, routes limited to `/addin/*` and the documented subset of `/api/v1`) via ADR-085 for Outlook, or per-request Google ID-token verification for the Gmail add-on. No third-party cookies.

### ADR-075 — Host-based sub-apps
The Hono server mounts disjoint sub-apps per host (app origin vs buyer origin) with route allow-lists and a per-origin headers/CSP matrix (SECURITY-ARCHITECTURE §8.8). Internal cookies are never set on the buyer origin.

### ADR-076 — Scoped repositories
Repositories for owned records accept only a branded `ScopedQuery` produced by `policy.scopeFilter(actor, recordType, access)`; dependency rules and type checks make unscoped data access fail the build. Reporting queries use the same predicates.

### ADR-080 — Metadata-first mail fetch
Sync fetches participant headers first, applies OD-29/exclusions/internal-domain/private filters, then downloads bodies only for qualifying messages.

### ADR-081 — Two-phase proposal send
Prepare (under a per-proposal send lock): build the frozen snapshot, totals, PDF (renderer job), link tokens, without changing version state; the draft is not editable while a send is preparing. Commit: on the first accepted email (provider accepted), add-in confirmation, or manual-share confirmation, freeze the version (`state=sent`, immutability trigger active), supersede the previous version (OD-21), activate links, record `proposal.version_sent`. A prepared send that is never committed expires (maximum wait per OD-105) and is discarded. Reconciles BR-SHR-002 with RULE-PRP-09.

### ADR-082 — Timeline anchor table
`timeline_event` plus `timeline_event_anchor(event_id, record_type, record_id, occurred_at)` with a keyset index, enabling combined company/contact timelines (BR-TIM-003) and cheap re-anchoring.

### ADR-083 — Partitioning
Monthly range partitions for `audit_log` and `domain_event` (and `view_session` if volume requires); retention by detaching/dropping whole partitions (audit retention per OD-36/OD-84).

### ADR-084 — No blind resend
Outbound mail carries an `X-CRM-Send-Id` header; ambiguous provider outcomes mark the send `unknown`, reconciled from the next sync (sent items) and never resent automatically.

### ADR-085 — Outlook add-in authentication
Primary: Nested App Authentication (MSAL nested public client) → Entra access token for our API scope → server validates (`iss`, `aud`, `tid`, `scp`, signature via JWKS), maps to an active user, issues a short-lived CRM bearer token. Fallback: Office dialog sign-in on the app origin returning a one-time code exchanged for a bearer token.

### ADR-086 — Webhook baseline without body signatures
If the chosen e-sign provider does not sign bodies: secret path segment + IP allow-list where published + mandatory authoritative API re-read before any state change.

### ADR-087 — Bulkheads
Dedicated pg-boss queues and concurrency per provider (`mail.google`, `mail.microsoft`, `esign`, `ai`, `txemail`, `pdf`); in-memory failure counters pause a queue on repeated provider failure; alerts; no external circuit-breaker component.

## 3. Decisions intentionally left open (see OPEN-DECISIONS.md)
OD-02/03 e-sign provider, OD-05 AI provider terms, OD-06/07 mail provider and add-in, OD-11 hosting, OD-14 transactional email, OD-46 CAPTCHA, OD-89 region/residency, OD-96..104 operational choices. Each affected ADR above is marked "pending" and designed so the decision changes only an adapter driver or configuration.
