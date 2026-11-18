# Architecture decisions — implementation register

Decisions made **while building**, and every place the code differs from the approved documents in `docs/`.
The approved ADRs stay where they are and are not edited. Each entry needs the project owner's confirmation or reversal.
Last updated: 2026-11-18.

**How to read "Status":** *Deviation* = the code does something different from an approved document. *New* = the documents did not decide this. *Unresolved* = a business or legal decision is still needed; the code uses a stand-in.

## A. Environment and tooling
| # | Decision | Approved document said | Why | Status |
|---|---|---|---|---|
| I-01 | Code lives in the BRDv2 folder inside OneDrive | Outside OneDrive (ADR-033) | Owner's instruction. pnpm uses a flat `node_modules` to avoid link problems | Deviation |
| I-02 | pnpm 10.34.9 | pnpm 12 | Switching to 12 fails on this Windows setup; global pnpm left untouched | Deviation |
| I-03 | No Docker; native PostgreSQL 18; files on local disk (`.data/storage`); email written to the log | Docker Compose with Postgres, MinIO, Mailpit | Owner's instruction | Deviation |
| I-04 | Web dev port 5273 | 5173 | 5173 is used by another application on this machine | New |
| I-05 | No version control initialised | — | Owner's instruction ("do not initialize or connect version control unless asked") | New |
| I-06 | Browser tests use the installed Microsoft Edge and the development database, adding only `E2E …` records | Dedicated E2E environment | No browser download; no database reset without approval | New |
| I-07 | Biome: `any` allowed in web page files and tests | Strict everywhere | API responses in the web pages are not yet typed end to end (see KNOWN-ISSUES K-12) | Deviation |

## B. Backend structure
| # | Decision | Approved document said | Why | Status |
|---|---|---|---|---|
| I-10 | One file per module (`modules/crm.ts`, `proposals.ts`, `sharing.ts`, `esign.ts`, `workflow.ts`, `ai.ts`, `identity.ts`, `reporting.ts`) | Folder per module with domain / application / infrastructure layers | Speed of a single-pass build. Module boundaries and the ports are kept; the inner layering is not | Deviation |
| I-11 | Background jobs use the database outbox table directly, polled by the worker | pg-boss, with the outbox as fallback (ADR-022) | Removes a moving part; same at-least-once behaviour, retries and dead-letter. pg-boss dependency removed | Deviation |
| I-12 | Sending a proposal is one synchronous request (freeze → render PDF → create links) | Two-phase send with a background render | Simpler and verified to take about one second locally. Revisit if PDF rendering becomes slow | Deviation |
| I-13 | Pricing lines stored as structured JSON on the proposal version | Separate pricing-line rows | The version is immutable once sent, so the JSON is the frozen record; totals are recomputed by shared code | Deviation |
| I-14 | Plain routes with Zod validation; no generated OpenAPI document | `@hono/zod-openapi` | Not needed for one internal web client; contracts are shared TypeScript in `packages/shared` | Deviation |
| I-15 | Role permission is checked before the request body is validated on admin-only routes | Not specified | Found by a browser test: a salesperson received validation details instead of "forbidden" | New |
| I-16 | PDF rendering uses the installed Edge through `playwright-core`, with scripts and network disabled | Dedicated renderer process | No browser download; same isolation settings | Deviation |
| I-17 | Sign-in rate limiting is the authentication library's default (a few attempts per 10 seconds) | Explicit limits in the security design | Works and is tested; limits are not yet tuned or configurable | New |

## C. Frontend
| # | Decision | Approved document said | Why | Status |
|---|---|---|---|---|
| I-20 | Own small component kit (`apps/web/src/lib/ui.tsx`) on Tailwind tokens | shadcn/ui components | Fewer dependencies; same look and accessibility basics | Deviation |
| I-21 | Plain-text proposal sections | Rich-text editor (TipTap) | Scope cut; documents render safely from escaped text | Deviation |
| I-22 | TanStack Router and Query only; simple HTML forms and tables | TanStack Form and Table | Scope cut | Deviation |
| I-23 | Buyer portal is a second entry page in the same web build, served on a separate origin | Separate buyer origin (ADR-020) | Same isolation (separate origin, separate cookie, no internal session); one build to run locally | New |
| I-24 | The buyer and internal preview show the proposal in a sandboxed frame using the same HTML as the PDF | Not specified | One renderer for preview, buyer view and PDF, so they cannot drift apart | New |

## C2. AI layer (compared with AI-ARCHITECTURE.md and AI-IMPLEMENTATION-DESIGN.md)
| # | Decision | Approved document said | Why | Status |
|---|---|---|---|---|
| I-30 | Responses are returned whole, not streamed | Server-sent event stream for drafting, rewrite and summary (ADR-040) | Structured JSON output is validated before anything is shown; streaming partial JSON adds complexity with no benefit on the mock. Revisit once a real model's latency is known | Deviation |
| I-31 | Prompts are versioned constants in `modules/ai/prompts.ts` | Prompt files registered in a `prompt_version` table by migration, activated through an evaluation gate (ADR-044) | No evaluation set exists yet. The version string is stored on every suggestion and usage row, so traceability is kept | Deviation |
| I-32 | Review results are stored in a new `ai_review` table | `ai_check_result` with separate rule and AI columns | One list of findings with a source and a per-finding decision matches what the screen needs | Deviation |
| I-33 | The AI review runs on request, in the request | Queued as a background job when a send is prepared | Simpler; sending never waits on AI. The rule checks still run at send time | Deviation |
| I-34 | Draft, summary and follow-up output is plain text | Markdown subset converted to rich-text nodes | The proposal editor is plain text (I-21) | Deviation |
| I-35 | Output token ceilings are 4,000–12,000 | 2,000–8,000 | Current models spend part of the ceiling on reasoning; lower values risk cut-off answers | Deviation |
| I-36 | Refusal fallback to another model is not enabled | Not specified | It needs a beta endpoint; a refusal is reported to the user instead | New |
| I-37 | Input size is estimated at 4 characters per token | Tokenizer library with that estimate as fallback | Avoids a dependency; budgets are generous | Deviation |
| I-38 | Limits: 20 AI requests per user per minute (configurable), plus the per-day and monthly limits | 30 per minute | Conservative default until real usage is known | Deviation |
| I-39 | Choosing `AI_PROVIDER=anthropic` without a key does not fall back to the mock; AI calls fail with a clear error | Not specified | Prevents template text being mistaken for model output | New |
| I-40 | Model per feature follows the approved design (Sonnet for drafting, summary and follow-up; Haiku for rewrite; Opus for review) and can be overridden with `AI_MODEL_*` | Same | Confirmed; none of these has been exercised live | Confirmed |
| I-41 | No vector search, embeddings or retrieval index | Not required | Context is small and structured; it is selected by rules per feature | Confirmed |
| I-42 | Accepting a deal summary saves it as a note; approving an email draft records it on the timeline | Summary shown in a panel; email opens the compose window | There is no compose window (mailbox integration not built). Both actions are explicit user decisions | Deviation |

## D. Unresolved — stand-ins in use
These are **not** decided. The code uses a replaceable adapter and says so on screen where relevant.
| # | Topic | Stand-in | Needed to resolve | Open decision |
|---|---|---|---|---|
| U-01 | E-signature provider and legal validity | Local simulator (HMAC-signed webhooks, placeholder certificate). Screen states "not legally valid" | Choose a provider, obtain credentials, legal review | OD-03 |
| U-02 | AI provider, data-handling and no-training terms (BR-AIA-009) | Deterministic mock provider. The Anthropic driver is complete and fixture-tested but has never made a live call | Provider contract, API key, approval for paid calls | OD-05, OD-90 |
| U-09 | AI limits and budget values | 50 requests per user per day, USD 50 per month, both editable by an Admin | Confirm values | OD-53 |
| U-03 | Transactional email | Messages written to the server log | Provider choice and credentials | OD-14 |
| U-04 | Mailbox and calendar integration | None; links are copied by hand | Google / Microsoft app registrations | OD-08, OD-09 |
| U-05 | File storage | Local folder | Cloud storage choice | OD-11 |
| U-06 | Encryption key for stored link tokens | Key in `.env.local` | Managed key service for production | ADR-073 |
| U-07 | Discount limits by role | Constants: Salesperson 15 %, Sales Manager 30 % | Confirm values; make them settings | — |
| U-08 | Hosting and deployment target | Local only | Cloud choice | OD-11 |

## E. Decisions confirmed by the build (no change)
Modular monolith · PostgreSQL as the only data store · Hono API · Drizzle with generated SQL migrations · Better Auth with public sign-up disabled · separate migration and application database roles · append-only audit log and timeline enforced by database grants · sent proposal versions made immutable by a database trigger · share token only in the URL fragment and stored hashed · e-signature, AI, email, storage and PDF behind ports.

## F. Scope conflict: BRD v2.0 (multi-organization product) vs this build (single company)
**What the repository says.** `docs/01-specifications/SCOPE-RECONCILIATION.md` records the product as a single-company internal CRM. BR-PLT-001 (many organizations, data separated), BR-PLT-002 (sign-up, workspace, trial) and BR-PLT-007 (billing) are dispositioned by Internal Deployment Decisions IDD-01, IDD-02 and IDD-03, which that document marks **Decided**. The document itself is still headed "Draft for review, v0.1". No file in the repository reverses those decisions, so this build follows them. **The owner should confirm in writing which scope is authoritative**; nothing below has been changed on an assumption.

**If BRD v2.0 as written (multi-organization) is authoritative, this is the real gap — it is architectural, not a field to add:**
| Area | Today | Needed for multi-organization | Risk if done badly |
|---|---|---|---|
| Data model | No organization id on any of the business tables; `organization_settings` is a single row (id = 1) | Organization table; organization id (NOT NULL, indexed, in every unique key) on every business, audit, AI, file and job table; data backfill | A missing filter on one query leaks another customer's data |
| Isolation enforcement | Authorization is by role and record owner inside one company | PostgreSQL row-level security per organization (or schema/database per organization) so isolation does not depend on every query being right; per-request organization context set on the connection | Application-only filtering is the classic cross-tenant leak |
| Uniqueness | Email, company domain, lead form key, stage names are unique across the whole database | Unique per organization | Organizations would block each other's data |
| Authentication | One user list; public sign-up disabled; users created by an Admin | Organization membership, invitations, organization selection at sign-in, optional SSO per organization | Account takeover across organizations |
| Onboarding and billing | First Admin created by a seed command; no billing | Self-service sign-up, workspace creation, trial, plans, seats, payment, invoices | Out of scope today (IDD-02, IDD-03) |
| Files, links, jobs, AI | Storage keys, buyer links, background jobs, AI usage and budgets are global | All keyed and limited per organization | Cross-organization file access; one customer exhausting shared limits |
| Settings | Pipeline, lost reasons, templates, catalogue, AI settings are global | Per organization | — |

**Owner decision (2026-11-18): the single-company scope is authoritative.** IDD-01, IDD-02 and IDD-03 stand. BR-PLT-001 is met by one deployment and one database per organization; BR-PLT-002 is reduced to Admin-created users; BR-PLT-007 (billing) is out of scope. The table above is kept as the record of what a future move to a multi-organization product would involve.

**Why it was not attempted in this sprint.** Adding an organization id column without enforcing isolation everywhere would give a false impression of multi-tenancy. A correct change touches every table, every query, the sign-in flow and every test; it needs its own design decision (row-level security vs database per organization), a data migration plan and a security review. Estimated as several weeks, not hours. The currently documented alternative (IDD-01) is one deployment and one database per organization, which this build already satisfies.
