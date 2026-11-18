# Testing Strategy — Internal Sales CRM (Phase 1)

| Item | Value |
|---|---|
| Acceptance source | ../01-specifications/ACCEPTANCE-CRITERIA.md (AC-01..18, FAC-*, NFR checks, Definition of Done) |
| Traceability | ../01-specifications/REQUIREMENT-TRACEABILITY-MATRIX.md (BR → US → FAC → design → test suite) |
| Tools | Vitest (unit/integration), Testcontainers-free real PostgreSQL via Docker Compose service in CI, Playwright (E2E, a11y with `@axe-core/playwright`, visual), k6 (load), Stryker (mutation, domain only), OWASP ZAP baseline (DAST), Semgrep + `pnpm audit`/OSV-Scanner (SAST/SCA) |
| Principle | Tests run against **real PostgreSQL 18** and real renderer code; external providers are replaced by contract-tested fakes only in tests (never in production code paths) |

---

## 1. Test pyramid and ownership

| Level | Scope | Location | Run | Target |
|---|---|---|---|---|
| Unit (domain) | Pure functions: state machines SM-01..10, pricing (TV-PRC-01 + edge cases), pre-send checks, access precedence §18.2, assignment, import mapping, permission `decide` | `apps/server/src/modules/*/domain/*.test.ts`, `packages/*/src/**/*.test.ts` | every commit | ≥ 95 % branch coverage on `domain/`; mutation score ≥ 80 % for pricing & state machines |
| Unit (web) | Components, forms, hooks, permission rendering | `apps/web/src/**/*.test.tsx` (Vitest + Testing Library + jsdom) | every commit | key components covered |
| Integration (API) | HTTP route → service → real DB (transaction rolled back or schema-per-worker), fakes for providers | `apps/server/test/integration/**` | every commit | every endpoint: happy path + validation + permission + main rule violations |
| Contract (adapters) | Each driver vs recorded fixtures (HTTP replay) and schema of provider payloads | `apps/server/src/adapters/**/*.contract.test.ts` | every commit; live sandbox nightly in staging | all port operations |
| Job/worker | Handlers with real pg-boss in test DB: idempotency (run twice), retry classification, DLQ | `apps/server/test/jobs/**` | every commit | every queue |
| E2E | Browser flows across app + buyer origins with local stack (Docker Compose: Postgres, MinIO, Mailpit, fake e-sign/AI/mail servers) | `e2e/**` Playwright | PR (smoke), nightly (full) | all BRD AC-01..14 flows |
| Accessibility | axe on key pages (app + buyer), keyboard paths (board, editor, dialogs) | Playwright | nightly | 0 serious/critical violations (NFR-011) |
| Visual | Buyer proposal renderer & PDF golden images (pdf → png via `pdf-to-img`) | Playwright | PR when `packages/proposal` changes | pixel diff ≤ 0.1 % |
| Performance | k6 scenarios per NFR-005 | `perf/**` | pre-release on staging | p95 targets met |
| Security | SAST, SCA, secrets scan, DAST baseline on buyer origin + authenticated scan of `/api/v1`, permission matrix suite | CI + staging | PR / weekly / pre-release | no High findings open |
| AI evals | Golden datasets, graders (ADR-044) | `evals/**` | on prompt/model change; weekly | release-gate thresholds |
| UAT | Business acceptance AC-15..18 with internal sales team (IDD-14) | pilot | R1 pilot, R2 go-live | sign-off owners per OD-10 |

## 2. Test data and environments
- **No mock data substitutes production behaviour**; tests build data through service-level factories (`test/factories/*.ts`) that call real services (so invariants hold), e.g. `createDealWithProposal({stage:'Proposal', recipients:2})`.
- Each integration test worker gets its own database (`crm_test_<n>`) migrated once; each test runs inside a transaction rolled back at the end, except job tests (truncate between tests).
- Fake servers for providers (`test/fakes/`): Gmail/Graph (delta + send), e-sign (envelopes, webhooks with valid signatures, controllable status), Anthropic (streaming + JSON + refusal), Turnstile, transactional email (captured), storage = MinIO.
- Staging uses real provider sandboxes and company test mailboxes; production data never copied to lower environments (OD-104).
- Time control: `Clock` port with fake timers for expiry, reminders, stalled/overdue scans, digest windows and time zones (org TZ ≠ UTC test cases, DST boundaries).

## 3. Mandatory scenario suites (by risk)

### 3.1 Signing chain (ADR-025) — highest risk
| # | Scenario | Expected |
|---|---|---|
| S1 | Sequential 3 signers complete | proposal signed, version signed, deal Closed Won with TCV and completion date, siblings void, notifications, timeline, audit |
| S2 | Duplicate `completed` webhooks (×3, concurrent) | one BR-AUT-002 execution; one signed_document |
| S3 | Out-of-order webhooks (completed before viewed) | forward-only final state signed |
| S4 | Webhook lost | hourly reconciliation converges |
| S5 | Void while signer signs (late completion) | request voided, `stale_completion=true`, deal flag, no Closed Won |
| S6 | New version sent while request open | user confirmation required; old request voided; signing old version yields stale handling |
| S7 | PDF bytes altered in storage | dispatch aborts with `ESIGN_HASH_MISMATCH` alert |
| S8 | Concurrent creation of two requests on one deal | one 201, one 409 `SIGNATURE_REQUEST_ALREADY_OPEN` |
| S9 | Reverse BR-AUT-002 with siblings | deal and siblings restored; re-delivered webhook does not re-close |
| S10 | Reverse after user edited amount | 409 `AUTOMATION_REVERSAL_STALE` with diff |
| S11 | Signer declines (OD-25) | request declined, others cancelled, proposal declined, BR-AUT-003 task |
| S12 | Proposal validity passes with open request | proposal expired, request voided (job), late completion stale |

### 3.2 Proposal engine
Pricing vectors (TV-PRC-01 + 40 generated property-based cases with `fast-check`: totals = Σ lines, TCV formula, rounding half-up, discount allocation sums), placeholder resolution and formatting per data type and locale, locked-section edit rejection (incl. Admin), template version pinning, version diff correctness, two-phase send (render failure, mail rejected, mail ambiguous then found / not found, expiry of prepared attempt), DB immutability trigger (direct UPDATE fails), PDF/DOCX parity (same text extraction order), renderer offline guard (document with external image URL renders without network request — asserted via request log).

### 3.3 Sharing and buyer surface
Token in fragment never in server logs (log capture assertion), scanner GET of `/p` creates nothing, identity gate (continue vs forwarded; internal domain rejected), forwarded viewer creates contact + stakeholder (domain rules incl. free-mail), OTP limits, precedence table rows 1–9, accept/decline restrictions, revoke/expiry behaviour, cookie bound to link (cannot access another link's proposal), heartbeat counting and reopen throttling, downloads tracked, internal preview untracked.

### 3.4 Permissions (generated suite)
For each `PermKey` in `packages/shared/permissions/matrix.ts` × role × fixture relationship (own, team member, inactive member, co-manager, other team, view-only enabled/disabled, deal-derived company/contact, locked section, closed deal) → expected `200/403/404`. Generated from the matrix and checked against ROLE-PERMISSION-MATRIX.md rows by a doc-sync test (fails if a PERM row lacks a matrix entry). Also: reports scoped per role (BR-RPT-008), search results scoped, timeline hides out-of-scope sources, private email content hidden from managers/admins (OD-30), AI context excludes private/out-of-scope data.

### 3.5 Email/calendar sync
Header-first filtering (unknown participants not stored, OD-29), exclusions incl. retroactive purge, private marking, linking rules (single open deal, multiple → most recent + reviewSuggested, OD-28), cursor expiry resync, duplicate messages across mailboxes de-duplicated on timelines, send ambiguous → no resend (ADR-084), token revoked → reauth state.

### 3.6 Lead capture and import
Honeypot, rate limit, CAPTCHA pass/fail/unavailable (fail-open), dedupe keys, fill-empty-fields policy, deal only with resolved company, round-robin fairness under 50 concurrent submissions, fallback owner; import validation errors report, duplicate resolutions, chunked commit failure + undo report, undo with modified records.

### 3.7 Automation and notifications
Each built-in rule: trigger, guard skip reasons, idempotency (double delivery), reversal, settings disabled; notification dedupe keys, preference filtering, digest idempotency per day/time zone, SSE poke + polling fallback (SSE disabled test still meets 60 s).

### 3.8 AI
Disabled/feature-off/budget paths, permission-scoped context, injection corpus, structured-output validation and repair, refusal handling, streaming abort on disconnect, AI never sends (no send call reachable from AI module — dependency-cruiser rule + test).

## 4. Acceptance criteria mapping
| BRD AC | Automated E2E suite | Manual/UAT |
|---|---|---|
| AC-01 setup (invite, roles, teams; trial/billing N/A per IDD-02/03) | `e2e/admin/users-teams.spec.ts` | — |
| AC-02 import CSV (+HubSpot/Pipedrive exports when OD-09 applies) with duplicates and undo | `e2e/import/*.spec.ts` | sample real export files |
| AC-03 CRM records, custom fields, pipelines | `e2e/crm/*.spec.ts` | — |
| AC-04 email/calendar auto-linking (company provider, OD-06) | `e2e/comms/sync.spec.ts` (fake) + staging sandbox | test mailbox |
| AC-05 create & send proposal from inbox (R3) | staging (Office add-in sideload) | manual in Outlook/Gmail clients |
| AC-06 web form → assigned record + notification | `e2e/leads/form.spec.ts` | embed on test website |
| AC-07 proposal with CRM data, custom fields, pricing; preview; PDF/DOCX | `e2e/proposals/create-edit-export.spec.ts` + visual | — |
| AC-08 AI drafting and pre-send; nothing sent without user action | `e2e/ai/*.spec.ts` (fake AI) + evals | pilot review |
| AC-09 views/forwards/downloads recorded, real-time alerts | `e2e/sharing/buyer-flow.spec.ts` (two browser contexts) | — |
| AC-10 multi-signer ordered signing, reminders, signed PDF + certificate, legal validity | `e2e/esign/*.spec.ts` (fake) + provider sandbox | Legal review (OD-01/42) |
| AC-11 stage updates on send/sign; Closed Won with amount/date | `e2e/automation/*.spec.ts` | — |
| AC-12 dashboards within permissions | `e2e/reports/*.spec.ts` + permission suite | — |
| AC-13 timeline completeness and order | `e2e/timeline.spec.ts` | — |
| AC-14 audit log + full export (billing N/A) | `e2e/admin/audit-export.spec.ts` | — |
| AC-15..18 business acceptance | metrics dashboards (§12 PRD) | pilot sign-off (OD-10) |

## 5. Non-functional verification
| NFR | Test |
|---|---|
| NFR-005 performance | k6: 150 virtual users mixed workload; p95 < 2 s common screens (OD-79 percentile), PDF < 10 s, notification < 60 s (synthetic buyer view → owner notification latency probe) |
| NFR-006 availability | staging failover drill (DB HA switch, server instance kill) with synthetic checks |
| NFR-008 backup/recovery | quarterly restore drill into isolated env: PITR to timestamp, run reconciliation, measure RTO |
| NFR-001/004/009 security & integrity | permission suite, DAST, audit chain verification job, signed artefact hash verification |
| NFR-011 accessibility | axe + manual screen-reader pass (NVDA + VoiceOver) on buyer view, editor, board |
| NFR-012 compatibility | Playwright projects: Chromium, Firefox, WebKit; mobile viewport for buyer view |
| NFR-013 deliverability | SPF/DKIM/DMARC checks in staging (mail-tester), seed-list delivery |
| NFR-010 usability | moderated sessions in pilot: new salesperson sends first proposal without training |

## 6. CI pipeline gates
1. Lint (Biome), typecheck (tsc -b), dependency-cruiser boundaries.
2. Unit + integration + contract + job tests (PostgreSQL 18 service), coverage thresholds.
3. Build web + server; bundle size budget for `buyer.html` (< 120 KB gzip JS).
4. E2E smoke (Chromium) on Docker Compose stack.
5. SAST/SCA/secret scan; migrations dry-run on a copy of the schema + N-1 compatibility test (ADR-052).
6. On main: full E2E nightly, visual, a11y, evals when prompts change.

## 7. Definition of Done (engineering)
Requirement implemented as specified; FACs automated (or documented manual case for add-ins/legal); permission cases covered; audit/timeline entries asserted; error codes registered; docs (API spec/OpenAPI) updated; RTM updated with test ids; no High security findings; performance budget unaffected.
