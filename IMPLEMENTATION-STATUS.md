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
