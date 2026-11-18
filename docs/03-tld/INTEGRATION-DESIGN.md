# Integration Design — Internal Sales CRM (Phase 1)

| Item | Value |
|---|---|
| Requirements | BR-EML-001..007 (mailbox connect, sync, linking, privacy controls, send, inbox add-in BR-EML-005 §2.4/§3.4, calendar logging BR-EML-006 §2.3/§3.3, open tracking), BR-PLT-003, BR-SIG-001..013, BR-AIA-001..009, BR-LED-006, NFR-013 |
| HLD | ../02-hld/INTEGRATION-ARCHITECTURE.md (purpose, protocols, sequence diagrams), ../02-hld/DATA-FLOW-ARCHITECTURE.md |
| Ports | BACKEND-DESIGN.md §6 |
| Decisions | ADR-012, ADR-031, ADR-053, ADR-080, ADR-084..087; OD-03, OD-05, OD-06, OD-07, OD-11, OD-14, OD-46, OD-51, OD-106..112 |

This document fixes the implementation details per integration: endpoints, scopes, payload mapping, limits, retry policy and configuration. Every integration lives in `apps/server/src/adapters/<port>/<driver>/` with a contract test suite (`*.contract.test.ts`) run against a recorded fixture server and, in staging, against the real provider sandbox.

---

## 1. Shared integration infrastructure

| Concern | Implementation |
|---|---|
| HTTP client | `undici` `fetch` wrapper `providerFetch(providerKey, url, init)`: host allow-list check (ADR-048), timeouts (connect 5 s, headers 15 s, body 30 s; AI streams 120 s), `User-Agent: SalesCRM/<version>`, request id propagation, metrics (`provider_requests_total{provider,status}`), redaction of auth headers in logs |
| Retries | Only inside jobs: pg-boss retry (5 attempts, exponential 30 s → 1 h). Inside a request (interactive), at most 1 retry for idempotent GETs on 502/503/ECONNRESET |
| Rate limits | Honour `Retry-After`; per-provider concurrency via queue bulkheads (ADR-087): `mail.google` 4, `mail.microsoft` 4, `esign` 2, `ai` 2 background + interactive limiter 10 concurrent per instance, `txemail` 4 |
| Circuit breaking | In-memory counter per provider per instance: ≥ 10 consecutive failures in 2 min → pause queue 5 min (`boss.offWork` / resume), alert `provider_circuit_open` |
| Secrets | From secrets manager via config; never logged; rotated per runbook |
| Webhooks | Raw body captured before JSON parsing (`c.req.arrayBuffer()`), verified, persisted, 200 within 2 s (ADR-053) |

---

## 2. Google Workspace

### 2.1 Projects and clients
| Client | Type | Scopes | Used by |
|---|---|---|---|
| Login | OAuth web client (Internal consent screen) | `openid email profile` | Better Auth Google provider |
| Mailbox | Same Google Cloud project, separate OAuth flow with incremental consent | `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/gmail.send`, `https://www.googleapis.com/auth/calendar.readonly` (+ `openid email`) ; `access_type=offline`, `prompt=consent` | comms module |
| Gmail add-on | Workspace add-on (alternate runtime / HTTP deployment) | `gmail.addons.execute`, `gmail.addons.current.message.readonly`, `gmail.addons.current.action.compose`, `userinfo.email` (OD-110) | `/addin/v1/gmail/*` |
Consent screen user type **Internal** (verify with IT — avoids public verification/CASA, OD-06); Workspace admin marks the client as trusted in API Controls; add-on deployed via admin install.

### 2.2 Gmail sync (`GoogleMailProvider`)
| Step | API | Detail |
|---|---|---|
| Initial | `users.messages.list(q='after:<initial_sync_from epoch> -in:spam -in:trash -in:drafts', maxResults=500)` | pages; record `historyId` from `users.getProfile` before listing |
| Incremental | `users.history.list(startHistoryId, historyTypes=[messageAdded, labelAdded, labelRemoved, messageDeleted], maxResults=500)` | `404` (history expired) → `cursorInvalid` → bounded resync (BACKEND-DESIGN §3.7) |
| Headers first (ADR-080) | `users.messages.get(format=metadata, metadataHeaders=[From,To,Cc,Bcc,Subject,Date,Message-ID,In-Reply-To,References,X-CRM-Send-Id])` batched (≤ 50 per batch request) | filter before body fetch |
| Body | `users.messages.get(format=full)` | MIME walk: prefer `text/html` → sanitise; `text/plain` fallback; attachments metadata only |
| Labels → folders | SENT → outbound; INBOX/others → inbound; SPAM/TRASH/DRAFT skipped (OD-106) | |
| Send | `users.messages.send` with raw RFC 5322 (built with `nodemailer/lib/mail-composer`), `threadId` when replying | ambiguous outcome rule ADR-084 |
| Quota | 250 quota units/user/second; our usage ≪ limit; on 429 honour backoff | |

### 2.3 Google Calendar
`events.list(calendarId='primary', syncToken | timeMin=initial_sync_from, singleEvents=true, showDeleted=true)`; `410 Gone` → full resync. Map attendees → `calendar_event_attendee`; `visibility=private|confidential` → `is_private=true`.

### 2.4 Gmail add-on (Card service, alternate runtime)
- Deployment descriptor lists HTTP endpoints `https://<app>/addin/v1/gmail/homepage|message|compose`.
- Request verification: `Authorization` system ID token (Google service account audience) **and** `userIdToken` (user identity) both verified.
- Responses: `{ "action": { "navigations": [{ "pushCard": { header, sections[] } }] } }` built by `addin/gmail/cards.ts`: contact/deal lookup card, create-contact form card, "Insert proposal links" compose action (`ComposeActionResponse` with `insertContent` per recipient link).

---

## 3. Microsoft 365

### 3.1 Entra app registrations
| App | Type | Permissions (delegated) | Notes |
|---|---|---|---|
| CRM Login | Single-tenant web app | `openid profile email User.Read` | Better Auth Microsoft provider, tenant id fixed |
| CRM Mailbox | Same app, incremental consent | `Mail.Read`, `Mail.Send`, `Calendars.Read`, `offline_access` | Tenant admin consent recommended (no user prompts) |
| CRM Outlook Add-in | Same app exposing API scope `api://<appId>/access_as_user`; SPA redirect `brk-multihub://<host>` for NAA | — | ADR-085 |

### 3.2 Graph mail sync (`MicrosoftMailProvider`)
| Step | API |
|---|---|
| Initial + incremental | `GET /me/mailFolders/{inbox|sentitems}/messages/delta?$select=id,conversationId,internetMessageId,from,toRecipients,ccRecipients,bccRecipients,subject,receivedDateTime,sentDateTime,isDraft,parentFolderId,internetMessageHeaders&$filter=receivedDateTime ge <initial_sync_from>` per folder (Inbox, Sent Items, and their child folders discovered via `mailFolders/{id}/childFolders`); store `@odata.deltaLink` per folder in `mail_sync_cursor` JSON |
| Delta expiry | `410 Gone` / `syncStateNotFound` → bounded resync |
| Body | `GET /me/messages/{id}?$select=body,uniqueBody&Prefer: outlook.body-content-type="html"` |
| Send | `POST /me/sendMail` with `internetMessageHeaders: [{name:'X-CRM-Send-Id', value}]`, `saveToSentItems: true` (202 has no id → outcome `accepted`, message correlated on next sync by header) |
| Throttling | 429/503 with `Retry-After`; 4 concurrent requests per mailbox max |

### 3.3 Calendar
`GET /me/calendarView/delta?startDateTime=<initial_sync_from>&endDateTime=<+1y>`; `sensitivity in (private, confidential)` → private.

### 3.4 Outlook add-in
Manifest: unified JSON manifest (Teams/Microsoft 365 app manifest) with Outlook `mailbox` extension, `requirements: Mailbox 1.13` (NAA requires recent clients; fallback dialog), task pane `https://<app>/addin.html`, `ItemSend` event-based activation where supported. Deployed by Microsoft 365 admin (Integrated Apps / centralized deployment) to the sales group.

---

## 4. E-signature provider (`ESignatureProvider`, OD-02/03)

### 4.1 Provider-neutral contract (mapping table)
| Our concept | Provider concept (typical) |
|---|---|
| signature_request | envelope / signature request / document package |
| signer.sign_order + sequential | recipient routing order |
| parallel | same routing order for all |
| sms_verification | SMS authentication per recipient |
| reminder_schedule_days | reminder settings (first reminder + frequency) — or our `esign.remind` schedule when unsupported |
| expires_at | expiration days |
| status pending/sent/viewed/signed/declined/expired/voided | created / sent / delivered (viewed) / completed / declined / expired / voided |
| completion certificate | certificate of completion / audit trail PDF |
| tamper evidence | provider PAdES seal on completed PDF |

### 4.2 Provider selection criteria (OD-03) — must-pass list
Sequential + parallel routing; email authentication by default; SMS authentication add-on; decline with reason; void with reason; reminders + expiry; webhooks with HMAC body signature (else ADR-086 baseline); authoritative status API; download sealed PDF + certificate; ESIGN/UETA and eIDAS SES evidence; data residency option matching OD-89; API sandbox; consent/ERSD customisation (OD-42).

### 4.3 Driver behaviour
- `createEnvelope`: upload PDF bytes (from object storage, hash asserted), signers with email/name/order/phone, signature + date field placement from `signatureBlock` anchors (`[[sig:<signerOrder>]]` text anchors rendered invisible in the PDF by `packages/proposal`), `metadata.signatureRequestId`, `eventNotification` callback URL `https://<app>/webhooks/esign/<provider>`.
- `verifyWebhook`: provider HMAC header over raw body with shared secret; timestamp tolerance 5 min; event id extraction.
- Webhook processing never trusts payload status: always `getEnvelope` (ADR-025).
- Embedded signing not used (OD-111): signers receive provider emails.

---

## 5. AI provider (`AiProvider`, OD-05) — see AI-IMPLEMENTATION-DESIGN.md
Anthropic Messages API via official TypeScript SDK `@anthropic-ai/sdk`; streaming for interactive features; JSON structured output for pre-send check; API key from secrets (OD-112); outbound host `api.anthropic.com` (or regional endpoint per OD-91).

## 6. Transactional email (`TransactionalEmail`, OD-14)
| Item | Value |
|---|---|
| Uses | Invitations, password reset, notification emails, daily digest, buyer OTP, lead-assigned emails, export ready |
| Sender | `no-reply@notify.<company-domain>` (dedicated subdomain) with SPF, DKIM (2048-bit), DMARC `p=quarantine` (NFR-013) |
| Driver | Provider HTTP API (Amazon SES v2 / Postmark / Azure Communication Services Email) or SMTP (`nodemailer`) — one driver per OD-14 decision |
| Idempotency | `idempotencyKey = notificationId:email` passed as provider message tag / header; duplicate sends suppressed by `notification.email_status` |
| Bounces | Provider bounce webhook (or polling) → suppress address, `email_status=failed`, Admin notice (OD-109) |
| Templates | React Email components rendered server-side to HTML + text (`@react-email/components`, `@react-email/render`) |

## 7. Object storage (`ObjectStorage`, OD-11)
| Item | S3 driver (`@aws-sdk/client-s3`, also MinIO dev) | Azure driver (`@azure/storage-blob`) |
|---|---|---|
| Container | bucket `crm-<env>` (private, block public access) | container `crm` in a storage account (no public access) |
| Keys | `{purpose}/{yyyy}/{mm}/{uuid}.{ext}` | same |
| Immutability | Object Lock (mode per OD-102) on `signed_pdf`, `certificate`, `audit_export` | immutable blob policy (version-level WORM) |
| Versioning | enabled | enabled |
| Encryption | SSE-KMS | Microsoft-managed or CMK |
| Signed URLs | 5 min, `response-content-disposition=attachment` | SAS 5 min |
| Uploads | Server-mediated (multipart to API, validated, then `put`) — no direct browser uploads in Phase 1 | same |
Only the driver for the OD-11 target is implemented, plus S3 for local MinIO (ADR-036).

## 8. CAPTCHA (`Captcha`, OD-46)
Cloudflare Turnstile: widget on hosted form page (site key); server `POST https://challenges.cloudflare.com/turnstile/v0/siteverify {secret, response, remoteip}`; outage/timeout (3 s) → `unavailable` → accept with verdict `captcha_unavailable_accepted` (OD-62 fail-open; honeypot + rate limit still apply).

## 9. Configuration and credential register

| Integration | Credential / configuration | Provisioned by | Stored in |
|---|---|---|---|
| Google login + mailbox + add-on | OAuth client id/secret; Internal consent screen; Workspace API Controls trust; add-on deployment | IT (Workspace admin) | Secrets manager |
| Microsoft login + mailbox + add-in | Entra app id, secret/cert, tenant id, API scope, admin consent; add-in manifest deployment | IT (Entra/M365 admin) | Secrets manager |
| E-sign | Account, API keys/OAuth app, webhook secret, sender branding, consent text | Tech Lead + Legal | Secrets manager |
| AI | API key (or workload identity), ZDR agreement, region | Tech Lead + Legal | Secrets manager |
| Transactional email | API key/SMTP creds; DNS SPF/DKIM/DMARC records | IT (DNS) | Secrets manager / DNS |
| Object storage | Bucket/account, KMS key, workload identity | DevOps | IaC |
| CAPTCHA | Site key (public), secret | DevOps | Config / secrets |
| Domains/TLS | `crm.<domain>`, `proposals.<domain>`, `notify.<domain>` | IT | DNS / LB certificates |
| KMS | Key for keyring wrap | DevOps | Cloud KMS |

## 10. Integration test matrix
| Integration | Contract tests (CI, fixtures) | Staging sandbox tests | Failure drills |
|---|---|---|---|
| Gmail / Graph | delta paging, cursor expiry, header filter, MIME parsing, send outcome mapping | real test mailbox in company tenant (OD-104) | revoke token → `reauth_required`; quota 429 |
| Calendar | delta, private events | test mailbox | |
| E-sign | create/get/void/remind/download mapping; webhook signature verify (valid, invalid, stale, replay) | provider sandbox end-to-end incl. sequential signing and decline | duplicate/out-of-order webhooks; lost webhook → reconciliation |
| AI | request shaping, stream parsing, refusal handling, JSON schema validation | eval harness (ADR-044) | provider 5xx → `AI_PROVIDER_UNAVAILABLE` |
| Transactional email | payload rendering | Mailpit locally; provider sandbox | bounce handling |
| Storage | put/get/signed URL/immutability flag | MinIO + staging bucket | |
| CAPTCHA | pass/fail/unavailable | Turnstile test keys | outage → fail-open path |
