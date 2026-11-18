# Backend Design — Internal Sales CRM (Phase 1)

| Item | Value |
|---|---|
| Runtime | Node.js 26 LTS, TypeScript strict, ESM |
| HTTP | Hono + `@hono/node-server`, `@hono/zod-openapi` |
| Data | Drizzle ORM over `pg` (node-postgres) pool; pg-boss on the same database |
| Roles | `server`, `worker`, `renderer`, `migrate`, `cli` selected by `PROCESS_ROLE` (ADR-045/046) |
| Related | MODULE-ARCHITECTURE.md (module catalogue), COMPONENT-ARCHITECTURE.md (middleware, queues), DATABASE-DESIGN.md, API-SPECIFICATION.md |

---

## 1. Source layout (`apps/server/src`)

```
apps/server/src/
  main.ts                    # reads PROCESS_ROLE → server | worker | renderer | migrate | cli
  composition/               # composition root: wires adapters, ports, subscriptions, routes
    container.ts             # builds AppContext (db, jobs, adapters, cache, config, logger)
    subscriptions.ts         # static event→subscriber registry (ADR-055)
    ports.ts                 # registers port implementations (ADR-055)
  config/                    # env schema (Zod) → typed Config; fails fast on missing values
  http/
    app.ts                   # host-based sub-apps (ADR-075): appHost, buyerHost
    middleware/              # requestId, logger, securityHeaders, rateLimit, authenticate, mfaPolicy, actorContext, validate, idempotency, errorMapper
    routes/                  # thin route adapters per module: api/*.routes.ts, public/*.routes.ts, addin/*.routes.ts, webhooks/*.routes.ts
    sse.ts                   # /api/v1/events/stream
  modules/
    <module>/                # identity, crm, import, comms, leads, templates, catalog, proposals, sharing, esign, ai, notifications, automation, reporting, timeline, platform
      service.ts             # public service API (only file other modules may import, plus types.ts)
      types.ts               # public types/DTOs
      domain/                # pure functions: state machines, calculations, validations (no I/O)
      repo/                  # Drizzle queries for owned tables (ScopedQuery-typed)
      jobs/                  # job handlers owned by the module
      hooks/                 # implementations of ports defined by other modules
      erasure.ts             # anonymise handler (OD-36)
  platform/
    db/                      # pool, Drizzle instance, unitOfWork, advisory locks, NOTIFY helper
    db/schema/               # Drizzle table definitions per module (one file per module)
    jobs/                    # pg-boss wrapper: enqueue(tx), work(), schedules, DLQ, metrics
    events/                  # events.record(tx) + fan-out per subscription registry
    audit/                   # audit.record(tx), sealer job (ADR-072)
    timeline/                # timeline.record(tx) (module facade over timeline tables)
    policy/                  # decide, scopeFilter, redact, permission matrix loader (from packages/shared)
    crypto/                  # keyring (ADR-073), token generation, hashing
    cache/                   # LocalCache + NOTIFY invalidation (ADR-054)
    errors/                  # DomainError hierarchy, problem mapper
    logging/                 # pino logger, redaction config, async context (requestId, actor)
    files/                   # ObjectStorage port + upload validation
    ratelimit/               # Postgres buckets + in-memory limiter
  adapters/
    mail/{google,microsoft}/ calendar/{google,microsoft}/ esign/<provider>/ ai/anthropic/
    txemail/<provider>/ storage/{s3,azure-blob}/ captcha/turnstile/
  cli/                       # bootstrap, create-admin, rotate-keys, resync-mailbox, reconcile-esign, verify-audit-chain
  renderer/                  # Playwright browser pool + pdf queue worker (renderer role only)
```

Dependency rules (dependency-cruiser, ADR-021): `modules/A/**` may import `modules/B/service.ts|types.ts` only for B in A's allowed list (MODULE-ARCHITECTURE §2.1); `domain/**` imports nothing with I/O; `http/**` imports only `modules/*/service.ts`; `adapters/**` never import modules; `apps/web` never imports `apps/server`.

---

## 2. Core runtime abstractions

### 2.1 AppContext and request context
```ts
interface AppContext {
  db: Db;                         // Drizzle over pg Pool (max 20 per server instance, 10 worker)
  jobs: JobQueue;                 // pg-boss wrapper
  storage: ObjectStorage; mail: MailProviderRegistry; calendar: CalendarProviderRegistry;
  esign: ESignatureProvider; ai: AiProvider; txEmail: TransactionalEmail; captcha: Captcha;
  keyring: Keyring; cache: LocalCache; config: Config; logger: Logger; clock: Clock;
}
type Actor =
  | { type: 'user'; userId: Uuid; role: Role; flags: {canManageContent: boolean; canManageSharedEmailTemplates: boolean};
      teamScopeIds: Uuid[]; managedTeamIds: Uuid[]; crossVisibility: CrossVisibility; aiFeatures: AiFeatureFlags; sessionKind: 'web'|'addin' }
  | { type: 'buyer'; shareLinkId: Uuid; viewerIdentityId?: Uuid; buyerSessionId: Uuid }
  | { type: 'system'; component: 'automation'|'scheduler'|'mail_sync'|'esign_webhook'|'lead_intake'|'import'|'renderer' }
  | { type: 'ai'; onBehalfOfUserId: Uuid; aiGenerationId: Uuid };
```
`actorContext` middleware builds `Actor` from LocalCache (TTL 60 s, invalidated by `NOTIFY crm_cache` on role/team/settings changes). Async context (`AsyncLocalStorage`) carries `{requestId, actor}` for logging.

### 2.2 Unit of work (ADR-028)
```ts
async function unitOfWork<T>(ctx: AppContext, actor: Actor, fn: (uow: Uow) => Promise<T>): Promise<T>;
interface Uow {
  tx: Tx;                                                     // Drizzle transaction
  actor: Actor;
  audit(entry: AuditEntryInput): Promise<void>;               // INSERT audit_log (seq from sequence)
  timeline(entry: TimelineEntryInput): Promise<void>;         // INSERT timeline_event + anchors
  event(e: DomainEventInput): Promise<void>;                  // INSERT domain_event + enqueue subscribers (pg-boss in tx)
  enqueue(queue: QueueName, data: JobData, opts?: JobOpts): Promise<void>;   // pg-boss send with tx executor
  afterCommit(fn: () => void): void;                          // NOTIFY, metrics, cache invalidation
}
```
- Transactions are `READ COMMITTED`; services take row locks explicitly with `lockForUpdate(table, id)` in the canonical order **deal → proposal → proposal_version → signature_request** (DATABASE-DESIGN §17).
- `unitOfWork` retries once on serialization/deadlock errors (`40001`, `40P01`) when the function is marked `retryable`.
- pg-boss in-transaction enqueue: the wrapper calls `boss.send(queue, data, {...opts, db: { executeSql: (text, values) => tx.execute(sql.raw...) }})`. **Verification gate:** a startup self-test confirms that a job enqueued in a rolled-back transaction does not exist; if the pinned pg-boss version lacks executor support, `enqueue` writes to `job_outbox` (same transaction) and a 1 s drainer moves rows to pg-boss (ADR-022 fallback).

### 2.3 Repositories and scoping (ADR-076)
```ts
type ScopedQuery<R extends RecordType, A extends 'read'|'write'> = { readonly __brand: 'scoped'; recordType: R; access: A; where: SQL };
policy.scopeFilter(actor, 'deal', 'read'): ScopedQuery<'deal','read'>;
dealRepo.list(tx, scope: ScopedQuery<'deal','read'>, filters: DealFilters, page: PageRequest): Promise<Page<DealRow>>;
dealRepo.getForUpdate(tx, scope: ScopedQuery<'deal','write'>, id: Uuid): Promise<DealRow>;   // NOT_FOUND if outside scope
```
- Owned-record repositories have no method that accepts a raw id without a `ScopedQuery` (except system-actor variants named `*Unscoped`, allowed only in `jobs/` and `hooks/` and reviewed).
- Scope predicates per record type (registered by each module through `policy.registerScopePredicate`):

| Record | read predicate (user actor) |
|---|---|
| deal | admin: `true`; manager: `owner_id = ANY(:teamScope)`; salesperson: `owner_id = :me` OR (`crossVisibility.deals='view_only'`) |
| company | deal predicate variants on `company.owner_id` OR `EXISTS (SELECT 1 FROM deal d WHERE d.company_id = company.id AND <deal predicate>)` (R6) |
| contact | owner predicate OR `EXISTS (deal_contact dc JOIN deal d … <deal predicate>)` |
| proposal/version/share_link/signature_request | `EXISTS (deal predicate on deal_id)` |
| task | related-record predicate OR `assignee_id = :me` |
| email_message | `owner_user_id = :me` OR `EXISTS (email_link el WHERE el.state='active' AND <target predicate>)`; content columns redacted when `is_private AND owner_user_id <> :me` (`policy.redact`) |
- Write predicates exclude view-only grants (`VIEW_ONLY` error instead of 404 when the record is readable).

### 2.4 Errors
```ts
class DomainError extends Error { code: ErrorCode; status: 400|401|403|404|409|410|413|422|428|429|502|503; detail?: string; errors?: FieldError[]; meta?: object }
class NotFound extends DomainError {}   // also used for out-of-scope
class Forbidden extends DomainError {}; class ConflictError extends DomainError {}; class RuleViolation extends DomainError {}
class ConfirmationRequired extends ConflictError { confirmations: {code: string; message: string; data?: unknown}[] }
```
`errorMapper` converts DomainError → RFC 9457 (API-SPECIFICATION §1.3); PG errors: `23505` unique → mapped by constraint name (e.g. `contact_email_uq` → `CONTACT_EMAIL_TAKEN`, `sr_one_open_per_deal` → `SIGNATURE_REQUEST_ALREADY_OPEN`), `P0001 VERSION_IMMUTABLE` → 409 `VERSION_IMMUTABLE`; anything else → 500 generic + error tracking. Full catalogue: ERROR-HANDLING-AND-VALIDATION.md.

---

## 3. Module service design

Each table lists the public operations (in `service.ts`), the domain logic they delegate to, and the rules they enforce. All operations take `(ctx, actor, input)` and run in one unit of work unless marked *(job)*.

### 3.1 identity
| Operation | Logic |
|---|---|
| `bootstrap(cli input)` | CLI-only; fails `BOOTSTRAP_ALREADY_DONE` if `organization_settings` exists; creates settings, default pipeline, system roles, retention defaults, first admin invitation |
| `invite`, `resendInvitation`, `revokeInvitation`, `acceptInvitation` | token = 32 random bytes, hash stored; email via `txEmail`; acceptance creates `auth_user` through Better Auth server API + `app_user_profile` in one tx |
| `changeRole`, `setFlags` | `LAST_ADMIN` guard (`SELECT count(*) … FOR UPDATE` on admins); NOTIFY cache invalidation |
| `deactivate(userId, plan)` | runs registered `UserDeactivationHook`s (crm reassign, proposals reassign, tasks, leads pool removal, comms disconnect) in one tx; then deletes `auth_session` rows; afterCommit: provider token revocation job |
| `teams.*` | OD-32/R7 invariants |
| `settings.get/update` | section-level PERM checks; Zod validation per section; audit diff |
| `getPermissions(actor)` | from `packages/shared/permissions/matrix.ts` (same file the web app uses) |

### 3.2 crm
| Operation | Logic / rules |
|---|---|
| `companies.create/update/archive/changeOwner` | normalise name/domain (free-mail exclusion R3); duplicate check (OD-27) → `ConfirmationRequired(DUPLICATE_SUSPECTED)` with trigram candidates (similarity ≥ 0.6); custom-field validation |
| `contacts.*` | email normalisation; `CONTACT_EMAIL_TAKEN`; primary company must be active |
| `deals.create` | stage ∈ pipeline; currency ∈ enabledCurrencies; contacts → deal_contact with roles; stage history row; event `deal.created` |
| `deals.moveStage` | `domain/dealStateMachine.ts` (SM-01): open→open only; writes `deal_stage_history`, resets `stage_entered_at`, clears stalled flag; event `deal.stage_changed` |
| `deals.closeWon/closeLost/reopen` | SM-01 guards; Lost with open signature request → `ConfirmationRequired(OPEN_SIGNATURE_REQUEST_CONFIRM)` then calls `esign.voidForDeal(uow, dealId, 'deal_lost')` port |
| `deals.applyAutomation(uow, change)` | used only by automation module; returns before/after snapshot for `automation_execution` |
| `deals.recordActivity(uow, dealId, at)` | updates `last_activity_at` (monotonic max), clears stalled flag |
| `tasks.*`, `notes.*`, `activityLogs.*` | related-record visibility; assignee must be active and have access (`TASK_ASSIGNEE_NO_ACCESS`) |
| `search(q, types)` | per-type FTS (`websearch_to_tsquery('simple', q)`) + trigram fallback, each with its ScopedQuery; merged by rank |
| `myDay(actor, date)` | tasks due today/overdue (org/user TZ), deals needing attention (flags + unviewed proposals via reporting port), meetings today |

### 3.3 catalog, templates
- `catalog.products.*`, `taxCategories.*`, `discountLimits.*`, `exchangeRates.get(from, date)`.
- `templates.saveDraft` validates content with `packages/proposal` schema (`validateDocument(schemaVersion, content)`), extracts placeholder refs, rejects unknown placeholders (`TEMPLATE_PLACEHOLDER_UNKNOWN`), checks lock changes require Admin (R8).
- `templates.publish` freezes a new `template_version` (trigger-protected), sets `current_published_version_id`.
- `templates.importDocx` *(job)*: mammoth-based DOCX→HTML→ProseMirror conversion into a new draft, unsupported constructs reported (`DOCX_UNSUPPORTED_FORMAT` warnings).

### 3.4 proposals (owns proposal status, SM-02/SM-03)
| Operation | Logic |
|---|---|
| `create(dealId, templateId, …)` | lock deal (share); pin `templateVersionId`; copy sections; `placeholders.resolve(deal, contacts, owner, org)` → bindings + missing list; default pricing table from template config; event `proposal.created` |
| `saveDraft(id, edit)` | CAS on version row_version; reject edits to locked sections (compare section docs to template — `SECTION_LOCKED`); `pricing.compute(tables, termMonths, currency)` (`domain/pricing.ts`, BUSINESS-RULES §7.2); discount limit check → `discountWarnings`; recompute missing placeholders |
| `createVersion(id)` | SM-02 guard (not signed/void); copy last sent version content; re-resolve placeholders; diff returned |
| `prepareSend(id, SendRequest)` | ADR-081 phase 1: validations (API §9.1); `send_attempt(preparing)`; `version.send_lock_until = now + OD-105`; enqueue `pdf` with `{versionId, purpose:'sent', snapshot}` — the frozen snapshot (resolved bindings, pricing, branding, schemaVersion) and `snapshot_sha256` are computed in-process and stored on the attempt |
| `onPdfRendered(attemptId)` *(job hook)* | attempt → `prepared`; `crm_email`: enqueue `mail.send` with share URLs (tokens generated now, stored hashed+encrypted on attempt); `manual_link`: expose links once via `GET /send-attempts/{id}` |
| `commitSend(attemptId, providerResult)` | ADR-081 phase 2, one tx with locks deal→proposal→version→prev version→open SR: version→`sent` (frozen fields), previous `sent`→`superseded` (+OD-21 void of its open SR via esign port), recipients + share links inserted, proposal.status (draft/declined/expired→sent; sent/viewed/accepted stay unless new version → `sent`), `last_sent_version_id`; event `proposal.version_sent` (subscribers: BR-AUT-001, BR-AUT-004 scheduling, notifications none, timeline) |
| `applyBuyerEvent(uow, event)` | called by sharing: first view → `viewed`; accept → `accepted` (OD-17); decline → `declined`; enforces §18.2 precedence |
| `applySignatureEvent(uow, event)` | called by esign: completed → `signed` + version `signed` (unless stale → no change, flag); declined → `declined` |
| `expire()` *(schedule `proposal.expiry-scan`)* | `valid_until < today(org TZ)` and status ∈ {sent, viewed, accepted} → `expired`; open SR → void via port |
| `void(id, reason)` | SM-02; voids open SR; user voids are terminal |
| `voidByAutomation(uow, proposalIds, reason)` / `restoreFromAutomation(uow, priorStatuses)` | OD-23/OD-24 |
| `compare(from, to)` | `packages/proposal` `diffSections` + `diffPricing` |
| `preview(id, versionId)` | renders HTML with `packages/proposal.renderHtml(snapshotOrDraft, {mode:'preview'})`; never touches sharing |

### 3.5 sharing
| Operation | Logic |
|---|---|
| `createLinks(uow, versionId, recipients)` | per recipient: 32-byte token (`crypto.randomBytes`), `token_hash = sha256`, `token_ciphertext = keyring.encrypt('share_tokens', token, aad=linkId)`, `link_handle` = 16 random bytes base64url |
| `exchange(token, clientMeta)` | lookup by hash; create `buyer_session` (cookie value 32 bytes, stored hashed, 30 days, bound to link + device key) |
| `getState(buyerActor)` | BUSINESS-RULES §18.2 evaluation order: link revoked → void → validity expired → link expired → identity → verification → superseded (read-only) → signed/responded → ready |
| `identify(buyer, {continueAs | name,email})` | OD-69/OD-26: original recipient continue; else forwarded viewer: match contact by normalised email, else create (company per domain rule R3), `deal_contact` role forwarded_viewer via crm service; privacy notice version recorded; event `share.forwarded_viewer_identified` |
| `startView / heartbeat / endView` | first heartbeat creates the counted view (`proposal.view_counted`, `isFirstViewOfProposal`, `isReopen` per OD-73 — new view session after ≥ 30 min gap); updates link aggregates; calls `proposals.applyBuyerEvent` on first view; `crm.deals.recordActivity` |
| `download(format)` | records `download_event`; event `proposal.downloaded` |
| `respond(accept|decline)` | allowed only for original recipient, `accept_decline_enabled`, current sent version (`RESPONSE_NOT_ALLOWED`); writes `buyer_response` with evidence; `proposals.applyBuyerEvent` |
| `revoke`, `setExpiry`, `copyLink` | PERM-118..120 |
| `expireLinks()` *(schedule)* | status→expired; `link_expiring` notifications at `linkExpiringNoticeHours` |

### 3.6 esign
| Operation | Logic |
|---|---|
| `createRequest(proposalId, input)` | version must equal `last_sent_version_id` and state `sent` (`SIGNATURE_VERSION_NOT_ELIGIBLE`); signers are deal contacts with email; insert (`sr_one_open_per_deal` guards race); `document_sha256 = version.pdf_sha256`; enqueue `esign.dispatch` |
| `dispatch` *(job)* | download PDF, recompute SHA-256 and assert equality (abort + alert on mismatch); `provider.createEnvelope({document, signers, order, sms, reminders, expiresAt, callbackUrl, metadata: {signatureRequestId}})`; status `sent`; 5 failures → owner notified, status stays `pending` (SM-04) |
| `ingestWebhook(provider, rawBody, headers)` | verify; insert inbox (dedupe unique); 200; enqueue `esign.webhook.process` |
| `processWebhook(inboxId)` *(job)* | `provider.getEnvelope(envelopeId)` (authoritative); map to SM-04/SM-05 forward transitions; insert `signature_event`s (dedupe provider_event_id); on completion: if request voided/expired or version superseded → `stale_completion=true`, deal flag `signed_on_stale_version`, notify owner (ADR-025); else `proposals.applySignatureEvent(completed)` + enqueue `esign.fetch-signed`; on decline → cancel others (provider does), `proposals.applySignatureEvent(declined)` (OD-25) |
| `fetchSigned` *(job)* | download sealed PDF + certificate, SHA-256, store immutable (`file_object.immutable=true`, Object Lock), `signed_document`; distribute (provider emails all parties; internal owner notified) |
| `void(id, reason)` / `voidForDeal` / `voidForVersion` (ports) | local status `voided` immediately; enqueue `esign.void` (provider) |
| `remind(id, signerId?)` | throttle 1/h/signer; provider resend |
| `reconcile()` *(hourly)* | for every non-terminal request re-read provider; apply missed transitions; expire past `expires_at` |

### 3.7 comms
| Operation | Logic |
|---|---|
| `connect(provider)` / `oauthCallback` | PKCE + state; verify mailbox address domain ∈ allowed domains and equals user email (`MAILBOX_ADDRESS_MISMATCH`); tokens envelope-encrypted (aad `userId|provider`) |
| `syncMailbox(connectionId)` *(job `mail.sync`, singleton)* | `MailProvider.listChanges(cursor)` → headers only (ADR-080) → filter: internal-only threads skipped, exclusions, OD-29 unknown participants (unless thread linked), Spam/Trash/Drafts (OD-106) → fetch bodies for kept messages → sanitise (DOMPurify on jsdom; strip remote images to placeholder; remove hidden text) → upsert thread/message/participants → `linking.link(message)` (OD-28) → timeline (anchors on linked records) → `deals.recordActivity`; inbound from a deal recipient after a sent version → event `email.stored` (BR-AUT-004 "answered"); cursor saved per page; `invalid cursor` → bounded resync from `max(last_synced_at - 7d, initial_sync_from)` |
| `send(input)` → `mail.send` *(job)* | create `outbound_email(queued)` with `crm_send_id`; render placeholders; append tracking pixel if enabled; `MailProvider.send({…, headers: {'X-CRM-Send-Id'}})`; success → `sent` (+`proposals.commitSend` when linked to a send attempt); timeout/5xx ambiguous → `unknown` and reconcile from next sync (ADR-084), never blind-resend |
| `syncCalendar` | events with ≥1 known contact attendee (OD-63); links like email; timeline `meeting` |
| `setPrivate`, `link/unlink`, `exclusions.*` | exclusion creation enqueues `mail.purge-excluded` |

### 3.8 leads
- `submit(publicKey, payload, meta)`: form published; honeypot empty; per-IP bucket; CAPTCHA verify (`captcha.verify(token, ip)`; provider outage → accept with verdict `captcha_unavailable_accepted` per OD-62); persist submission; enqueue `lead.submission.process`; always 202 generic.
- `processSubmission` *(job)*: SM-09; dedupe (OD-27, R3), fill-empty-fields policy (OD-58), company resolution, deal creation only with company (R3) and duplicate-deal suppression window (OD-61); assignment: rules in form order → first match with non-empty eligible pool → round-robin cursor under `SELECT … FOR UPDATE` on `assignment_state`; fallback `default_lead_owner_id`; notification `new_lead_assigned` (immediate, BR-LED-003).

### 3.9 import
- `upload` parses with `papaparse` (CSV, encoding sniff UTF-8/UTF-16/Windows-1252) or `exceljs` (XLSX, first sheet or chosen sheet); stores source in object storage; header detection.
- `validate` *(job)*: map → Zod per entity → custom-field coercion → dedupe within file and against DB (OD-27) → row errors; status `validated`.
- `commit` *(job)*: chunks of 500 rows per transaction (status `committing`, progress counts); `import_record_link` per created/merged record; on failure mid-way → status `failed` with committed chunks recorded (undo available).
- `undo` *(job)*: per DOMAIN-MODEL §6.3 rule; report.
- HubSpot/Pipedrive exports: column dictionaries map known export headers to standard fields (`import/domain/sourceProfiles.ts`).

### 3.10 ai — see AI-IMPLEMENTATION-DESIGN.md
### 3.11 notifications, automation — see NOTIFICATION-AUTOMATION-DESIGN.md
### 3.12 timeline
`timeline.record(uow, {eventType, source, actor, occurredAt, summary, data, anchors[], isAutomated?, automationExecutionId?, privacy?})`; `timeline.list(actor, record, {types, cursor})` keyset over `timeline_event_anchor` then per-row visibility check of `source` (events whose source is not visible are omitted; private emails render metadata only).

### 3.13 reporting
Read-only SQL in `modules/reporting/queries/*.sql.ts` built with Drizzle `sql` templates, every query parameterised by the actor's report scope (`orgScope | teamScope | self`). Heavy aggregates (pipeline by stage, won/lost) run directly against indexed tables at OD-45 volumes (< 300 ms p95 target); no materialised views in Phase 1 (revisit if p95 > 2 s, NFR-005).

### 3.14 platform
`audit.record`, `files.upload/validate`, `exports.start` *(job)*, `erasure.execute` *(job, calls each module's `erasure.ts`)*, `retention.sweep` *(daily)*, `idempotency.*`, `rateLimit.*`, `keyring.*`, `audit.seal` *(every minute)*.

---

## 4. Domain logic (pure, unit-tested)

| File | Content |
|---|---|
| `crm/domain/dealStateMachine.ts` | SM-01 transitions table + `assertTransition(from, to, ctx)` |
| `proposals/domain/proposalStateMachine.ts` | SM-02 incl. OD-17..25 rules |
| `proposals/domain/versionStateMachine.ts` | SM-03 |
| `proposals/domain/pricing.ts` | `computeTotals(tables, termMonths, currency)` — line: subtotal = round2(qty × unitPrice); line discount (percent → round2(subtotal × p/100), amount ≤ subtotal); tax = round2((subtotal − discount) × rate/100); overall discount allocated per OD-66 scope then tax recomputed per line; totals = Σ rounded lines; TCV = oneTime.totalExclTax + Σ recurring.totalExclTax × periodsIn(termMonths, period) with `PRICING_TERM_PERIOD_MISMATCH` when not whole periods (OD-67). Uses `decimal.js` (precision 30, ROUND_HALF_UP). Test vector TV-PRC-01 from BUSINESS-RULES §7.2 is a mandatory unit test. |
| `proposals/domain/presendChecks.ts` | deterministic checks: unresolved placeholders, missing required sections, totals vs pricing table figures, deal amount difference, past dates (validity, dates in text vs today), recipients without email, archived content blocks (codes/severities per RULE-AIA-11) |
| `sharing/domain/accessPrecedence.ts` | §18.2 evaluation |
| `esign/domain/signatureStateMachine.ts` | SM-04 / SM-05 forward-only mapping from provider statuses |
| `leads/domain/assignment.ts` | rule matching + round-robin selection |
| `import/domain/*` | mapping, coercion, duplicate keys |
| `automation/domain/rules/*.ts` | each built-in rule: `evaluate(event, state, settings) → Plan | Skip` |

---

## 5. Background processing

### 5.1 Job framework
```ts
defineJob<'proposal.send.prepared'>({
  queue: 'evt.proposal.version_sent.automation-aut001', retryLimit: 5, retryBackoff: true, retryDelay: 30,
  expireInSeconds: 300, deadLetter: 'evt.proposal.version_sent.automation-aut001.dlq',
  handler: async (ctx, job) => { /* idempotent */ }
});
```
- Handlers run with a `system` actor (or the originating user id carried in payload for audit attribution, never for authorization shortcuts).
- Idempotency: each handler records its effect keyed by `(eventId, subscriber)` (unique constraint in the target table, e.g. `automation_execution.idempotency_key`, `notification.dedupe_key`) so retries are no-ops.
- Queue catalogue and schedules: COMPONENT-ARCHITECTURE §4.2–4.3 (authoritative); bulkheads per provider (ADR-087): `mail.google`, `mail.microsoft` partitions of `mail.sync`/`mail.send`, `esign.*`, `ai.generate`, `notify.email`, `pdf`.
- Worker boot: `boss.start({ migrate: false })` (ADR-050), registers handlers for all queues except `pdf`; renderer registers only `pdf`.

### 5.2 Event subscriptions (ADR-055) — registry excerpt
| Event (WORKFLOWS §0.3) | Subscribers |
|---|---|
| `deal.stage_changed`, `deal.closed_won`, `deal.closed_lost` | notifications (owner/manager per prefs), automation (flag clear) |
| `proposal.version_sent` | automation-aut001 (move stage), automation-aut004 (schedule follow-up check at `sentAt + days`) |
| `proposal.view_counted` (first/reopen), `share.forwarded_viewer_identified`, `proposal.downloaded`, `proposal.accepted`, `proposal.declined` | notifications (BR-NTF-001), automation-aut003 (declined), automation-od17 (accepted) |
| `signature.signer_signed`, `signature_request.completed`, `signature_request.declined`, `signature_request.expired` | notifications, automation-aut002 (completed), automation-aut003 (declined) |
| `email.stored` | automation-aut004 (answered), notifications none |
| `lead.assigned` | notifications |
| `task.created` (assignee ≠ actor) | notifications |

### 5.3 Schedules
As COMPONENT-ARCHITECTURE §4.3; all created idempotently at worker start with `boss.schedule(name, cron, data, {tz: orgTimeZone})`.

---

## 6. Integration adapters (ports)

```ts
interface MailProvider {
  buildAuthUrl(input: {state: string; codeChallenge: string; loginHint: string}): string;
  exchangeCode(code: string, verifier: string): Promise<OAuthTokens & {emailAddress: string; scopes: string[]}>;
  refresh(tokens: OAuthTokens): Promise<OAuthTokens>;
  revoke(tokens: OAuthTokens): Promise<void>;
  listChanges(tokens, cursor: string | null, opts: {since: Date; pageSize: number}): Promise<{headers: MessageHeader[]; nextCursor: string; cursorInvalid?: boolean}>;
  getMessage(tokens, providerMessageId: string): Promise<RawMessage>;
  send(tokens, msg: OutgoingMessage): Promise<{providerMessageId?: string; outcome: 'accepted'|'rejected'|'ambiguous'; error?: ProviderError}>;
}
interface CalendarProvider { listChanges(tokens, cursor, opts): Promise<{events: RawEvent[]; nextCursor: string; cursorInvalid?: boolean}> }
interface ESignatureProvider {
  createEnvelope(input: EnvelopeInput): Promise<{envelopeId: string; signerIds: Record<string,string>}>;
  getEnvelope(envelopeId: string): Promise<EnvelopeStatus>;           // authoritative status incl. per-signer
  voidEnvelope(envelopeId: string, reason: string): Promise<void>;
  remind(envelopeId: string, signerProviderId?: string): Promise<void>;
  downloadCompleted(envelopeId: string): Promise<{signedPdf: Buffer; certificate: Buffer}>;
  verifyWebhook(rawBody: Buffer, headers: Headers): {valid: boolean; eventId?: string; envelopeId?: string};
}
interface AiProvider { stream(req: AiRequest): AsyncIterable<AiChunk>; complete(req: AiRequest): Promise<AiResult>; }
interface TransactionalEmail { send(msg: {to; subject; html; text; tags; idempotencyKey}): Promise<{messageId: string}> }
interface ObjectStorage { put(key, body, {contentType, sha256, immutable?}); get(key); signedUrl(key, ttlSeconds, disposition); delete(key) }
interface Captcha { verify(token: string, remoteIp?: string): Promise<'pass'|'fail'|'unavailable'> }
```
Driver rules: timeouts (connect 5 s, total 30 s; AI streaming 120 s), retries only in jobs, outbound host allow-list enforced in a shared `fetch` wrapper (ADR-048), structured provider errors mapped to retryable/non-retryable.

---

## 7. Configuration (environment, validated at boot)

| Group | Variables (names only) |
|---|---|
| Core | `PROCESS_ROLE`, `NODE_ENV`, `APP_ORIGIN`, `BUYER_ORIGIN`, `PORT`, `LOG_LEVEL` |
| Database | `DATABASE_URL` (app role), `DATABASE_URL_MIGRATOR`, `DATABASE_URL_RENDERER`, `DATABASE_URL_SEALER`, `DB_POOL_MAX` |
| Auth | `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `MICROSOFT_CLIENT_ID/SECRET/TENANT_ID` |
| Mailbox OAuth | `GOOGLE_MAIL_CLIENT_ID/SECRET` (may equal login client with separate consent), `MICROSOFT_MAIL_CLIENT_ID/SECRET` |
| Add-ins | `OUTLOOK_ADDIN_APP_ID`, `GOOGLE_ADDON_AUDIENCE` |
| Keys | `KMS_KEY_ID` (cloud), `KEYRING_LOCAL_MASTER_KEY` (dev only) |
| Storage | `STORAGE_DRIVER` (`s3`|`azure`), `STORAGE_BUCKET`, endpoint/credentials (workload identity preferred) |
| E-sign | `ESIGN_PROVIDER`, `ESIGN_API_BASE`, `ESIGN_CLIENT_ID/SECRET` or key, `ESIGN_WEBHOOK_SECRET` |
| AI | `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `AI_DEFAULT_REGION` |
| Transactional email | `TXEMAIL_PROVIDER`, credentials, `TXEMAIL_FROM` |
| CAPTCHA | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` |
| Observability | `ERROR_TRACKING_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT` (optional) |
Secrets come from the secrets manager (OD-11), never from committed files; `.env.local` only for local development with dev-only values.

---

## 8. Logging and observability
- pino JSON logs; fields: `time, level, msg, requestId, actorType, userId, route, status, latencyMs, jobQueue, jobId`; redaction paths (SECURITY-ARCHITECTURE SC-APP-20).
- Metrics: HTTP rate/latency by route template, job duration/failures per queue, DLQ depth, mailbox sync lag, PDF render time, AI tokens/cost, webhook failures (ADR-051).
- Tracing: OpenTelemetry auto-instrumentation for HTTP, pg, fetch (optional exporter).

## 9. Performance budgets (NFR-005)
| Path | Budget p95 | Technique |
|---|---|---|
| List/detail screens | < 300 ms server time | indexed scoped queries, keyset pagination, no N+1 (batched `IN` loads) |
| Deal board (≤ 500 open deals per pipeline) | < 500 ms | single grouped query + per-stage limit |
| Proposal PDF render | < 10 s end-to-end | warm Chromium, fonts embedded locally, images pre-fetched from storage |
| Notification after event | < 5 s typical, ≤ 60 s guaranteed | in-tx enqueue + SSE poke + 30 s polling |
| Buyer proposal load | < 2 s | static bundle on buyer origin, snapshot JSON cached (immutable, ETag) |
