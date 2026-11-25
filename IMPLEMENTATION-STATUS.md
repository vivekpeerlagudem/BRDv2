# Implementation status

Internal Sales CRM — state of the build. Approved documentation lives in `docs/` and was not modified by implementation work.
Last updated: 2026-11-18.

## Verification results (2026-11-18, this machine)
After the "Must-gap" sprint (CRM record editing & reassignment, administration screens, reports, CSV import, proposal validity/link-expiry/copy) and a full QA pass. See **QA-REPORT.md** for the module-by-module result.
| Check | Result |
|---|---|
| `pnpm typecheck` | Pass — 4 packages |
| `pnpm lint` (Biome) | Pass — 109 files, 0 findings |
| `pnpm test` (Vitest) | Pass — **198 tests in 16 files**, including 39 integration tests against real PostgreSQL 18 (`crm_test`) |
| `pnpm build` | Pass — server and web |
| `pnpm verify` | Pass (runs the four above) |
| `pnpm test:e2e` (Playwright, Edge) | Pass — **24 tests in 8 specs** through the real UI, API, PostgreSQL and Edge PDF renderer (core journey, AI, admin, CRM edit, reports, import, proposal extensions) |

Fixed during QA (2026-11-18): a deal-reassign authorization regression (now returns 404 for invisible deals / `FORBIDDEN_REASSIGN` for the owner — strictly more secure), missing accessible labels on the Reports filters, a test-file type error, and a lint error. Added: production refuses to boot on simulated e-signature / log-email / AI-mock unless `ALLOW_SIMULATED_PROVIDERS=true`.

Not run: load or performance tests, full accessibility audit, independent security review, any test against a real e-signature, AI or email provider. **No request has been sent to a real AI model**; AI output quality is therefore unmeasured. HubSpot/Pipedrive import, MFA/SSO, mailbox integration and notification preferences are not built.

## What exists
| Area | State | Where |
|---|---|---|
| Workspace and tooling | Complete | root config, `packages/shared`, `packages/proposal` |
| Database: 48 tables, migrations, immutability trigger, least-privilege roles, seed | Complete · tested | `apps/server/src/db/schema.ts`, `apps/server/drizzle/`, `src/cli/` |
| Sign-in, users, 3 roles, team scope, record-level access, audit log | Complete · tested (password sign-in only) | `modules/identity.ts`, `platform/core.ts` |
| Companies, contacts, deals, pipeline board, tasks, notes, calls/meetings, timeline, search | Complete · tested (edit screens missing) | `modules/crm.ts`, `apps/web/src/pages/crm.tsx`, `deals.tsx` |
| Lead form with round-robin assignment, duplicate check, spam protection | Complete · tested | `modules/crm.ts`, `apps/web/src/buyer/main.tsx` |
| Templates (versioned, locked sections), product catalogue | Complete · tested | `modules/proposals.ts`, `pages/admin.tsx` |
| Proposals: draft, pricing, pre-send check, preview, send, frozen versions, PDF + DOCX, compare | Complete · tested | `modules/proposals.ts`, `packages/proposal`, `pages/proposal.tsx` |
| Sharing: per-recipient links, buyer portal, identity gate, view/download tracking, accept/decline | Complete · tested | `modules/sharing.ts`, `apps/web/src/buyer/main.tsx` |
| E-signature | **Simulated** · flow tested | `modules/esign.ts`, `platform/adapters.ts` |
| AI intelligence layer — see the section below | Complete · tested with the mock provider; real provider not exercised live | `modules/ai.ts`, `modules/ai/`, `platform/anthropic.ts`, `platform/mock-ai.ts`, `apps/web/src/pages/ai.tsx` |
| Automation rules, reversal, in-app notifications, background jobs | Complete · tested (email is logged, not sent) | `modules/workflow.ts` |
| Dashboard / reporting, scoped by role | Complete · tested (no filters or export) | `modules/reporting.ts`, `pages/dashboard.tsx` |
| Web app: login, shell, search, alerts, all pages above, user administration | Complete · every screen opened by a browser test; not every action | `apps/web/src` |

## AI intelligence layer (BR-AIA-001..009)
| Part | What exists | How it was verified |
|---|---|---|
| Provider abstraction | `AiProvider` port; Anthropic driver on the official SDK (structured output, no tools, SDK retries off); deterministic mock that reads the same prompts | 24 unit tests. Anthropic driver: controlled fixtures only, **never called live** |
| Call engine | Admin and per-feature switches, per-minute / per-day / monthly limits, timeout, one retry on transient errors, JSON + schema validation with one repair attempt, usage and cost record with request and correlation ids | 19 integration tests on PostgreSQL |
| Context engine | Builders for deal, company, contacts, proposal, activities, tasks, buyer engagement, catalogue; authorizes on the requesting user first; minimizes fields; token budget; records which records were used. No vector search (the approved architecture does not call for it) | Integration tests for scoping, minimization, budget, injection handling |
| Proposal drafting | One section or all empty sections; editable suggestion; regenerate; warning for prices not in the CRM | Integration + browser test |
| Pre-send review | Rule findings (authoritative) + AI findings validated against the proposal text; decision per finding; stale detection | Integration + browser test |
| Deal summary | Recorded facts shown separately from AI interpretation; save as note | Integration + browser test |
| Rewrite selected text | 8 modes; replaces only the stored selection | Integration + browser test |
| Follow-up email draft | 6 situations; edit and approve; copy or open own mail program; never sent by the CRM | Integration + browser test |
| Governance | Labels on every suggestion, pending suggestions block sending, accept / edit / reject, provenance, audit log, usage history page, Admin settings and usage report | Integration + browser tests |

**Real provider:** code complete and unit-tested against fixtures. Using it needs `AI_PROVIDER=anthropic`, an `ANTHROPIC_API_KEY`, and the owner's approval for paid calls. Nothing else changes.

## Requirement coverage (130 BRD requirements)
| Status | Count |
|---|---|
| Done and tested | 45 |
| Done, tested with the mock AI provider (no live model call) | 5 |
| Done, screen action not browser-tested | 9 |
| Partly built | 25 |
| Simulated (e-signature) | 5 |
| Not built | 37 |
| Blocked by a business decision | 1 |
| Removed by single-company scope | 3 |

Details per requirement: REQUIREMENT-TRACEABILITY.md.

## Not built (largest items)
Mailbox and calendar integration · data import · custom fields · multiple pipelines · MFA and Google/Microsoft sign-in · settings and pipeline administration screens · record edit forms · report filters and CSV export · rich-text proposals and content blocks · notification preferences and email delivery.

## Related records
LOCAL-SETUP.md · REQUIREMENT-TRACEABILITY.md · ARCHITECTURE-DECISIONS.md · KNOWN-ISSUES.md

## Weekly Report Agents — Part 1, prototype (2026-11-24)
One weekly status PowerPoint per client (company), produced inside the CRM from existing CRM data plus the client's estimates (scope) sheet uploaded as CSV. A person approves, downloads the final deck and sends it. Mock AI only.

| Piece | Where | Status |
|---|---|---|
| Estimates CSV import (all-or-nothing, header aliases, row errors) | `modules/weekly-reports/estimates.ts`, `drizzle/0007_weekly_reports.sql` | Built |
| Orchestrator: weekly schedule (Monday 09:00, organization time zone), "Generate now", stuck-run cleanup | `modules/weekly-reports.ts`, hooked into `workflow.ts` | Built |
| Collector (company owner's scope), Matcher (scope row to CRM task), Metrics (E-01..E-12, A-01, A-02, health, deltas) | `modules/weekly-reports/{collect,match,metrics}.ts` | Built |
| Narrative agent (AI text with cited fact ids), Checks, regeneration (max 2), placeholder fallback | `modules/weekly-reports/{facts,narrative,checks}.ts`, prompt `weekly_report/v1` | Built — simulator only |
| PPT builder (6 slides, draft label, final at approval) | `modules/weekly-reports/deck.ts` (pptxgenjs 4.0.1) | Built |
| Approval, list, detail, download | `modules/weekly-reports.ts`, `http/routes/weekly-reports.ts` | Built |
| Company page card (upload, generate, runs, approve, downloads, read-only text) | `apps/web/src/pages/weekly-reports.tsx` | Built (minimal) |

Tests: 15 unit tests (period incl. a DST week, matcher, metrics), 12 unit tests (facts, checks, simulator output) and 8 integration tests (`weekly-reports.integration.test.ts`: import, schedule exactly once, exact metrics, deck contents, owner scoping, approval, regeneration, fallback).

Not in Part 1: editing the report text (so a report that fell back to placeholders cannot be approved yet), a full report page, Google Sheets, email delivery, real AI provider runs, settings screen for the weekly schedule.

## Weekly Report Agents — Part 2 (2026-11-25)
Finishes the feature: a person can edit the text, regenerate it, approve with acknowledged warnings, and work from full report pages. Estimates can also be read from a linked Google Sheet (read-only, off by default). Mock AI only.

| Piece | Where | Status |
|---|---|---|
| Fixes from Part 1 review: AI "decide" refused for weekly reports, AI settings merge feature switches, internal-term check compares with the fact text | `modules/ai.ts`, `modules/weekly-reports/checks.ts` | Built |
| Edit text (change / remove / add sentences, sources from the report's facts, `rowVersion` guard, checks and draft deck redone) | `updateNarrative` in `modules/weekly-reports.ts`, `PATCH /weekly-reports/:id/narrative` | Built |
| Regenerate text from the stored snapshot (same figures and version) | `regenerateNarrative`, `redraftJob`, job `weekly_report.redraft`, `POST /weekly-reports/:id/regenerate` | Built — simulator only |
| Approve with warnings acknowledged | `approveWeeklyReport` (`acknowledgeWarnings`), `POST /weekly-reports/:id/approve` | Built |
| Weekly reports list (status tabs, search by client) and report page (figures, text with sources, edit, points to review, scope progress, regenerate, approve, downloads) | `apps/web/src/pages/weekly-report-pages.tsx`, nav item "Weekly reports" | Built |
| Schedule settings (on/off, weekday, time) for Admins | Settings → Weekly reports, `GET/PUT /admin/weekly-report-settings` | Built |
| In-app notification to the company owner when a scheduled draft is ready | `workflow.ts` (`weekly_report_ready`) | Built |
| Google Sheets estimates reader (read-only), per-company sheet link, "Sync now", sync before each run with fallback to the latest import | `platform/google-sheets.ts`, `modules/weekly-reports/estimates.ts`, `drizzle/0008_estimate_source.sql`, company page card | Built — never called live |

Tests added in Part 2: integration tests now 16 in `weekly-reports.integration.test.ts` (edit, stale edit, regenerate, warnings at approval, schedule settings, notification, Google link / sync / failed sync with a fake source), 8 unit tests for the Google reader (`platform/google-sheets.test.ts`, fake `fetch`, throw-away key), narrative/check unit tests now 13, and one browser test `e2e/weekly-reports.spec.ts` (upload → generate → edit → approve → download final `.pptx` → a salesperson who does not own the client gets "not found").

Not built / not done: email delivery of reports (by design), writing anything to Google Sheets (by design), per-client schedules, the real slide template, a real AI provider run, a live Google call, a visual check of the decks in PowerPoint. See KNOWN-ISSUES.md "Weekly reports".

Verification (2026-11-25, this machine, branch `feature/weekly-report-agents`):
| Check | Result |
|---|---|
| `pnpm verify` (typecheck, lint, test, build) | Pass — **260 tests in 21 files**; Biome 148 files, 3 warnings that existed before this feature |
| `e2e/weekly-reports.spec.ts` | Pass (1 test) |
| `pnpm test:e2e` (all specs) | **28 passed, 10 failed.** The 10 failures are in specs written before this feature (`ai`, `crm-edit`, `journey`, `marvel-seed`, `personas-demo`, `personas-sign-demo`, `proposal-ext`, `qa-demo` B, `reports`, `session-isolation`). They expect the original demo data and screens: user names "Riley Chen" / "Avery Admin" / "Jordan Patel" (the users were renamed), a published template named "Services proposal" (not in the Marvel-only database), and the old person form with a plain Company drop-down. They were not changed. |

## Weekly Report Agents — Part 3 (2026-11-25)
| Piece | Where | Status |
|---|---|---|
| Named PowerPoint template `default` ("Default (mock)") on slide masters `WR_TITLE` and `WR_CONTENT`: brand colour, header bar, Kensium logo (PNG generated once from the SVG), footer text, slide number, fixed positions for title, KPI tiles, table, chart and statements | `modules/weekly-reports/deck.ts`, `deck-logo.ts`, `deck-unit.test.ts` | Built — a mock, not the real company template; not opened in PowerPoint |
| `weekly_report_settings.templateKey` (code default `default`, no migration); shown read-only in Settings → Weekly reports | `modules/weekly-reports.ts`, `apps/web/src/pages/settings.tsx` | Built |
| `pnpm weekly:demo` | `apps/server/src/cli/weekly-demo.ts` | Built — run twice on `crm_dev` (second run: new version, no duplicate tasks or import) |
