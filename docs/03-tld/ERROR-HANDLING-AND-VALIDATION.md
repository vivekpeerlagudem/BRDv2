# Error Handling and Validation Design — Internal Sales CRM (Phase 1)

| Item | Value |
|---|---|
| Error registry | ../01-specifications/BUSINESS-RULES.md §20 (authoritative codes); codes added by the TLD are listed in §4 below and must be added to the registry |
| Format | RFC 9457 problem details (API-SPECIFICATION §1.3) |
| Decisions | ADR-016, ADR-017, ADR-022, ADR-025, ADR-053, ADR-084 |

---

## 1. Validation layers

| Layer | What | Tool | Failure |
|---|---|---|---|
| 1. Client | Field formats, required, lengths, ranges; immediate feedback | Zod schemas from `packages/shared/contracts` via TanStack Form | inline field errors (no request sent) |
| 2. HTTP boundary | Shape/type of params, query, body; unknown properties stripped (`strict()` for create/update bodies); size limits | `validate` middleware (Zod) + body limit | 400 `VALIDATION_FAILED` with `errors[]` |
| 3. Authorization | PERM + scope + view-only | `policy.decide`, `scopeFilter` | 401/403/404 |
| 4. Domain rules | Business rules, state machines, cross-field and cross-record invariants | `modules/*/domain/*` pure functions + service checks | 409/422 with module codes |
| 5. Database | Constraints (NOT NULL, CHECK, UNIQUE, FK, partial uniques), immutability triggers | PostgreSQL | mapped to domain codes (§3); unmapped → 500 |
| 6. Integration | Provider responses validated (Zod) before use | adapter layer | retry / `*_PROVIDER_*` codes |

Rule: every business rule is enforced at layer 4 (and where possible guarded at layer 5); layer 1 is a convenience only.

### 1.1 Common field rules (packages/shared)
| Type | Rule |
|---|---|
| Names / titles | trim; 1–255 chars (users 1–200); no control characters |
| Email | RFC 5322 (practical subset), ≤ 254 chars, normalised lower-case for comparison |
| Domain | lower-case, no scheme/path, IDN → punycode, must contain a dot, not in free-mail list when used for company matching |
| Phone | E.164 preferred; accepted free text 5–32 chars `[0-9+()\-\s.]` ; SMS signer phone must parse to E.164 (`libphonenumber-js`) |
| URL | http(s) only, ≤ 2048 chars |
| Money | decimal string `^-?\d{1,16}(\.\d{1,2})?$` (amounts), unit price up to 4 dp; non-negative unless stated |
| Percent | 0–100, ≤ 4 dp |
| Quantity | > 0, ≤ 4 dp, ≤ 1e10 |
| Currency | ISO-4217 and ∈ `enabledCurrencies` |
| Dates | `YYYY-MM-DD`; instants ISO-8601 with offset; interpreted in org/user TZ for "today" rules |
| Rich text | valid against `packages/proposal` schema; ≤ 500 KB JSON per document; ≤ 200 sections |
| Uploads | allow-listed MIME by magic bytes (`file-type`), size per purpose (images 5 MB, DOCX 10 MB, CSV/XLSX 20 MB), DOCX/XLSX zip entry count ≤ 2,000 and uncompressed ≤ 100 MB (zip-bomb), images re-encoded (`sharp`) and stripped of metadata; SVG rasterised (never served as SVG) |
| Custom fields | per definition: type coercion, dropdown/multi-select values ∈ active options, required on UI create/edit |

## 2. Error taxonomy

| Class | HTTP | Retry by client? | Logged as |
|---|---|---|---|
| Validation (`VALIDATION_FAILED`) | 400 | no (fix input) | info |
| Authentication / authorization | 401/403/404 | no | info (+ audit per AUDIT-LOGGING §4) |
| Concurrency (`CONCURRENT_MODIFICATION`) | 409 | after reload | info |
| State / rule conflicts | 409/422 | no | info |
| Confirmation required | 409 `CONFIRMATION_REQUIRED` | yes with `confirm[]` | debug |
| Idempotency (`IDEMPOTENCY_KEY_REUSED`, in-progress) | 409 | in-progress: yes after `Retry-After` | info |
| Rate/budget limits | 429 | after `Retry-After` | info |
| Provider unavailable | 502/503 | yes (backoff) | warn + metric |
| Unexpected | 500 | maybe (idempotent only) | error + error tracking |

## 3. Database error mapping
| PG error | Constraint / condition | Domain code |
|---|---|---|
| 23505 | `contact_email_uq` | `CONTACT_EMAIL_TAKEN` |
| 23505 | `company_domain_uq` | `DUPLICATE_SUSPECTED` (409 with existing id) |
| 23505 | `sr_one_open_per_deal` | `SIGNATURE_REQUEST_ALREADY_OPEN` |
| 23505 | `pv_one_draft` | `DRAFT_VERSION_EXISTS` |
| 23505 | `deal_contact_deal_id_contact_id_key` | `DEAL_CONTACT_DUPLICATE` |
| 23505 | `invitation_one_pending_per_email` | `USER_ALREADY_EXISTS` |
| 23505 | `buyer_response_proposal_version_id_key` | `RESPONSE_ALREADY_RECORDED` |
| 23505 | `send_attempt_one_active` | `PROPOSAL_ALREADY_SENT` (send in progress) |
| 23505 | `export_one_running` | `EXPORT_ALREADY_RUNNING` |
| 23505 | `automation_execution_idempotency_key_key` | (handled internally: already executed) |
| 23503 | FK violation | `NOT_FOUND` (referenced record) or 500 if unexpected |
| 23514 | `deal_lost_reason` | `LOST_REASON_REQUIRED` |
| 23514 | other CHECK | `VALIDATION_FAILED` |
| P0001 | `VERSION_IMMUTABLE` (trigger) | `VERSION_IMMUTABLE` (409) |
| 40001 / 40P01 | serialization / deadlock | retried once, then 503 `TEMPORARILY_UNAVAILABLE` |
| 57014 | statement timeout (15 s app default, 60 s reports) | 503 `TEMPORARILY_UNAVAILABLE` |

## 4. Codes added by the TLD (appended to BUSINESS-RULES §20)
`NOT_FOUND` (generic), `REAUTH_REQUIRED` (step-up, OD-83), `TEMPORARILY_UNAVAILABLE`, `AI_PROVIDER_REFUSED` (refusal path), `ESIGN_HASH_MISMATCH` (internal alert, not user-facing), `SEND_ATTEMPT_EXPIRED` (ADR-081/OD-105), `WEBHOOK_UNKNOWN_ENVELOPE` (internal). They are registered in BUSINESS-RULES §20 with their HTTP status.

## 5. Server error handling patterns
- **Services throw DomainError**; never return error objects. Routes never catch except to translate provider-specific exceptions in adapters.
- **errorMapper** (Hono `onError`): DomainError → problem JSON; ZodError → 400 with `errors[].path` as dotted paths; PG errors per §3; anything else → 500 `{code:'INTERNAL_ERROR', requestId}` (no stack/SQL), logged at error with stack and sent to error tracking with request id, actor id and route template (no body).
- **Confirmations**: domain functions return `needsConfirmation(codes)`; services throw `ConfirmationRequired` unless `input.confirm` contains all codes.
- **Transactions**: any thrown error rolls back the unit of work, including enqueued jobs (in-tx enqueue, ADR-022) and timeline/audit rows.
- **Jobs**: handler errors classified `retryable` (network, 5xx, 429, deadlock) vs `permanent` (validation, not found, rule violation). Permanent → no retry, job completes with `failed_permanent` result and module-specific compensation (e.g. send attempt `failed`, notification to user). Retryable → pg-boss backoff; after the retry limit → DLQ + alert.
- **Provider calls**: never inside a DB transaction (no network while holding locks). Pattern: tx1 record intent → call provider (job) → tx2 record outcome. Ambiguous outcomes follow ADR-084 (no blind resend).
- **Webhooks**: verification failure → 401 without detail; processing errors never returned to the provider after persistence (always 200 once stored, ADR-053).

## 6. Client error handling patterns
| Situation | UX |
|---|---|
| 400 with field errors | map to form fields; focus first error; screen-reader live region announces summary |
| 401 | redirect to sign-in preserving `next` |
| 403 `MFA_ENROLMENT_REQUIRED` / `REAUTH_REQUIRED` | enrolment page / re-auth dialog then replay |
| 403 other / 404 | in-page "You don't have access" / "Not found" (no detail) |
| 409 `CONCURRENT_MODIFICATION` | dialog with reload; unsaved local edits preserved in the editor for copy |
| 409 `CONFIRMATION_REQUIRED` | confirmation dialog listing items; replay with `confirm` |
| 409/422 rule codes | message from a client-side code → message catalogue (`src/shared/errors/messages.ts`), fallback to `title`/`detail` |
| 429 | toast "Too many requests — try again in N s"; AI quota shows budget message |
| 5xx / network | toast with retry for idempotent requests; mutations with Idempotency-Key are retried automatically up to 2× with backoff |
| Long-running job failures | status components show failure code + guidance (e.g. PDF generation failed → "Try again"; mailbox reauth → "Reconnect mailbox") |

## 7. Buyer surface error handling
Uniform, non-revealing states: unknown/revoked link and server errors show the same neutral "not available" page (no proposal data, no hints whether a link existed); expired/withdrawn messages shown only after a valid session establishes link ownership; OTP errors show remaining attempts; network failures during heartbeat are silent (retry next tick).

## 8. Exception scenarios by workflow (selection; full list in WORKFLOWS.md exception flows)
| Scenario | Handling |
|---|---|
| Two users edit the same deal | second save → `CONCURRENT_MODIFICATION`; reload |
| User moves stage while BR-AUT-001 runs | automation re-evaluates guard under lock → skipped (RULE-AUT-04) |
| Send while PDF render fails | attempt `failed` (`DOCUMENT_GENERATION_FAILED`); draft unlocked; retry |
| Mail provider ambiguous on proposal send | attempt `committing`; resolved by next sync; UI shows "Sending…" then sent/failed |
| Duplicate signature completion webhooks | inbox unique + idempotent BR-AUT-002 |
| Signer completes after void | stale completion handling (ADR-025) |
| Import commit fails mid-way | chunks committed so far recorded; batch `failed`; undo available |
| Mailbox token revoked externally | sync gets 401/invalid_grant → `reauth_required` + notification; sends blocked with `MAILBOX_REAUTH_REQUIRED` |
| AI provider down | `AI_PROVIDER_UNAVAILABLE`; deterministic pre-send checks still run; send not blocked |
| CAPTCHA provider down | fail-open with honeypot + rate limit (OD-62) |
| Object storage unavailable | uploads/downloads 503; render jobs retry; buyer view of cached snapshot still loads (assets may fail gracefully) |
| DB failover (HA) | in-flight requests fail with 503 → client retries idempotent requests; jobs retry |
