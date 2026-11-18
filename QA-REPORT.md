# QA Report — Internal Sales CRM

End-to-end test of the running application (API on :3000, web on http://localhost:5273), driven in a real browser (Microsoft Edge) as Admin, Sales Manager, Salesperson and external Buyer, plus the full automated suite. Single-company scope is authoritative (confirmed by the owner 2026-11-18).

Date: 2026-11-18. Tester: QA pass on the build after the parallel "Must-gap" sprint.

## How this was tested
- **Automated, against the live app:** `pnpm verify` (typecheck, lint, 198 unit + integration tests on real PostgreSQL 18, build) and `pnpm test:e2e` (24 Playwright tests across 8 specs, driving Edge as each role and as a buyer, asserting real persistence and refusals — not "the page rendered").
- **Live browser:** the running app was opened and exercised; screenshots were captured for each AI feature, both Reports views, and the admin screens.
- **No external side effects:** `AI_PROVIDER=fake`, e-signature and email are simulators; no real email, no paid AI call, no real signature, no production config changed. `.env.local` was not read or modified.

## Headline result
| Check | Result |
|---|---|
| `pnpm typecheck` | PASS (4 packages) |
| `pnpm lint` (Biome) | PASS (109 files, 0 errors) |
| `pnpm test` | PASS — **198 / 198** (16 files; 39 integration tests on real PostgreSQL) |
| `pnpm build` | PASS |
| `pnpm verify` | **PASS** |
| `pnpm test:e2e` | PASS — **24 / 24** across 8 specs, live in Edge |

The tree arrived from the interrupted sprint with a broken test file, a lint error and one failing security test; all were fixed (see "Bugs found and fixed"). It is now fully green.

## Module-by-module results
| # | Module | Status | Notes |
|---|---|---|---|
| 1 | Authentication & RBAC | **PASS** | Email+password login; wrong password refused; unauthenticated API → 401; a salesperson cannot reach admin APIs (403) or see them in nav. No MFA / Google / Microsoft sign-in (not built). |
| 2 | Dashboard | **PASS** | KPIs, pipeline-by-stage, proposal metrics, "deals needing attention", rep performance — all from real SQL, permission-scoped. |
| 3 | Companies | **PASS** | Create, view, **edit**, archive, duplicate detection, sortable list, change owner (with permission). |
| 4 | Contacts | **PASS** | Create, view, **edit**, link to company, **contact detail page with timeline**. |
| 5 | Leads | **PASS** | Hosted web form → contact + company + deal, round-robin assignment, duplicate check, honeypot spam protection. HubSpot/Pipedrive and lead-source tags not built. |
| 6 | Deals | **PASS** | Create, **edit**, **reassign owner** (role-scoped), stage moves with optimistic concurrency, Kanban board + list, close won/lost (lost reason required). |
| 7 | Activities | **PASS** | Notes, call/meeting logs, tasks with due dates, overdue flagging, task reminders, deal timeline. |
| 8 | Proposals | **PASS** | Template → CRM-populated draft, pricing with discounts and one-time/recurring totals, pre-send checks, preview, send (frozen immutable version), **validity-date editing**, **version comparison UI**, **copy to another deal**, PDF (real Edge render) + DOCX with verified content parity. |
| 9 | AI features | **PASS (on the mock provider)** | All five: section drafting, rewrite selection, deal summary, follow-up email, pre-send review. Human accept/reject on every result; AI content labelled; usage + cost logged; admin on/off enforced server-side; AI cannot send/share/sign (structurally proven). **Simulator, not a real model — output quality is unmeasured.** |
| 10 | Document sharing | **PASS** | Per-recipient secure links (token only in URL fragment, stored hashed), buyer portal with identity gate, view/download tracking, forwarded-viewer capture, **per-link expiry**, revoke, accept/decline. |
| 11 | E-signature | **PASS (simulated)** | Full ordered-signer workflow, verified webhooks, signed-PDF + certificate, one-open-request rule, stale-completion handling, auto Closed-Won on completion. **The signature is a simulator with no legal validity** (OD-03). |
| 12 | Notifications | **PARTIAL** | In-app alerts (polled ~30 s) for proposal opened/forwarded/downloaded/signed and lead/task assignment work. Email alerts go to the server log only (no email provider). Per-user notification preferences and daily digest not built. |
| 13 | Reports | **PASS** | Date-range + team + owner filters, permission-scoped (salesperson = own, manager = team, admin = all); pipeline, won/lost, rep performance, proposal metrics, activity per rep, attention lists; CSV export with formula-injection protection. |
| 14 | Settings | **PASS** | Organization settings, pipeline-stage administration (probabilities, reorder, proposal-sent target, protected system stages), lost-reason management, teams & managers, **audit-log viewer** (filters, read-only), AI settings. |
| 15 | Data management | **PARTIAL** | CSV import: upload → column mapping → validation preview → duplicate detection → transactional commit → batch history → undo. HubSpot/Pipedrive guided import, Excel and DOCX-template upload not built. General per-entity CSV *export* exists only inside Reports. |
| 16 | Security & permissions | **PASS** | Record-level access (404 for invisible records, 403 for visible-but-forbidden), admin-only settings refused to non-admins, AI-disabled enforced server-side, immutable sent proposals (DB trigger), expired/ revoked links refused, append-only audit log & timeline. |

## Complete business journey — PASS
Driven end to end in the browser by `e2e/journey.spec.ts`:
Lead (hosted form) → Company → Contact → Deal → Activities → Proposal (template + pricing) → **AI drafting / rewrite / review** → **human approval** → secure share link → **buyer opens portal, views & downloads** (tracked) → **e-signature (simulated) signed** → deal **auto-closed Won** → **dashboard & reports updated**. Every step persisted and was re-read; forbidden actions were refused.

## Bugs found and fixed during this QA pass
| Severity | Bug | Fix | Retested |
|---|---|---|---|
| **High (security)** | Deal-reassign endpoint: a sprint change made a non-owner salesperson receive `403` (leaking that the deal exists) and the owner receive a generic `FORBIDDEN` instead of the specified `FORBIDDEN_REASSIGN`. | Removed the redundant role pre-check so the record-level checks run: invisible deal → **404** (no existence leak), owner-but-not-permitted → **403 FORBIDDEN_REASSIGN**. Reassign remains fully blocked for salespeople. | lifecycle 20/20, crm-edit 17/17 |
| Medium | Reports page: Period / Team / Owner filter dropdowns had no accessible label, so the control was unreachable by label (a screen-reader and automation gap). | Added `aria-label` to each `<Select>`. | reports e2e 2/2 |
| Medium | `reports.integration.test.ts` failed to type-check (Drizzle `.set().where()` inference), breaking `pnpm verify`. | Narrowed the id argument type. | typecheck clean |
| Low | Lint error (unused import) and formatting drift in sprint files. | Auto-fixed; lint clean. | lint 0 errors |
| Hardening (added) | Production could silently boot on the e-signature simulator, log-only email, or the AI mock. | Server now refuses to start in production on any stand-in provider unless `ALLOW_SIMULATED_PROVIDERS=true`; a real AI provider requires its key. Tests added. | config tests pass |

## Critical bugs still remaining
**None.** No crash, data-loss, authorization or correctness defect is open. The app typechecks, lints, builds, and all 198 unit/integration and 24 browser tests pass.

## Security & permission review
No issues open. Verified live and by tests: cross-user record access returns 404; admin-only settings/users/pipeline/import/audit refuse non-admins (403); managers are scoped to their team for reassignment and reports; AI-disabled is enforced on the server (not just hidden in the UI); sent proposal versions are immutable at the database level; the audit log and timeline are append-only; secrets are never returned to the frontend or written to logs. The reassign fix above made the API strictly more secure.

## AI: simulated vs functional
- **Functional end to end (on the mock provider):** all five features, the human approval workflow, content labelling, usage/cost logging, admin controls, and the "AI never sends externally" guarantee (structural — the AI module cannot reach sending/sharing/signing code).
- **Simulated:** the model itself. Answers are deterministic template text from a built-in mock. The real Anthropic driver is written and unit-tested against recorded fixtures but **has never made a live call**, so real output quality, latency and the review categories the mock does not emit are unverified.

## Overall product readiness
**Demo-ready for an internal CEO walkthrough.** The complete sales journey works in the browser, the UI is professional and consistent, and permissions hold. Three things must be stated plainly in any demo and before real use:
1. **E-signature is a simulator** — not legally valid (needs a provider, OD-03).
2. **AI runs on a mock** — real quality is unproven until a provider key is added and approved (OD-05).
3. **Email is not sent** — notifications are in-app and server-log only (needs a provider, OD-14).

Not built (out of this build's scope): MFA / SSO, mailbox & calendar integration, HubSpot/Pipedrive import, custom fields, multiple pipelines, notification preferences & digest, rich-text proposals.

## What you can demonstrate to the CEO
1. **Sign in** as a salesperson; show the dashboard KPIs and pipeline.
2. **Create** a company, a contact and a deal; move it across the Kanban board.
3. **Generate a proposal** from a template — watch CRM data and pricing fill in; **edit a section, then use AI** to draft, rewrite and review it; approve the result.
4. **Send** the proposal; open the **buyer portal** in a separate window; view and download it; watch the engagement appear back in the CRM.
5. **Request signatures**; use the simulator to sign; the deal **closes Won automatically**.
6. Switch to **Admin**: show Settings (pipeline, lost reasons, teams, audit log), **Reports** with filters and CSV export, **CSV import** with validation and undo, and **AI settings** (turn a feature off and show the salesperson is blocked).
7. Switch to **Sales Manager**: show team-scoped reports and deal reassignment within the team.

## What must be fixed before it is a real product
- Connect a real **e-signature** provider and complete the legal-validity review (hard requirement of the BRD).
- Connect a real **AI** provider, then run an evaluation pass on output quality.
- Connect a real **email** provider (unblocks notifications, password reset, email verification).
- Add **MFA / SSO**, and the remaining Must gaps tracked in `REQUIREMENT-TRACEABILITY.md`.
