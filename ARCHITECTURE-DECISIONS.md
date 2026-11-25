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

## G. Weekly Report Agents — Part 1 (prototype, 2026-11-24)
| Decision | What was done | Why |
|---|---|---|
| Run as the company owner | Each run stores `run_as_user_id` = the company owner. The Collector reads with that user's scope (`ownerScope`), and the narrative AI call is made on their behalf (their `ai.use` permission, rate limit, daily quota and usage records). An inactive owner ends the run as `failed` (RUN_AS_USER_INACTIVE). | AI-ARCHITECTURE §2: AI always acts for a user. A report can never contain a record that user could not open. |
| Estimates sheet as CSV + matching rule | The client's scope and estimated hours are imported as CSV per company (all-or-nothing). A scope row matches a CRM task whose title contains `[<scope id>]`, else one with the same normalized title. When sheet and CRM disagree the CRM wins and the row is flagged internally (STATUS_MISMATCH). | No new business modules (projects, timesheets, budget) in the prototype; the CRM's existing tasks carry progress. |
| Metrics by code, measured from the week end | All figures (E-01..E-12, A-01, A-02, health) are computed in `metrics.ts` with decimal arithmetic. "Overdue" and "due in the next 7 days" are measured from the end of the reporting week. | Numbers never come from the AI model, and a report for a past week gives the same result whenever it is generated. |
| pptxgenjs in apps/server | `pptxgenjs` 4.0.1 renders the deck in the API/worker process; `deck.ts` separates a pure deck model from layout. Fonts: Inter is named; PowerPoint substitutes its default where Inter is not installed. | Smallest working option; no template file exists yet (the real company template is still an open input). |
| Files written before transactions | Snapshot (write-once), draft deck and final deck (write-once) are stored BEFORE the transaction that records them; for write-once keys an existing file wins (EEXIST) and its fingerprint is recorded, as in `esign.fetchSigned`. | Avoids the stuck state that `sendProposal` can reach when a transaction fails after a write-once file was written inside it. |
| Internal figures and flags stay internal | E-11 (rows without a CRM task), E-12 (mismatches), check flags and source ids are never put in the AI facts pack or on slides. Checks reject internal wording, unsourced statements and numbers that are not in the facts. STATUS_MISMATCH is a notice that does not block approval. | Client-facing text must not expose how the report is produced or internal data-quality notes. |
| AI never fails a run | Failed checks → up to 2 regenerations with the failures as feedback → placeholders (`[To be written before sending]`), `ai_fallback = true`, status `needs_attention`. Any AI error (disabled, limits, provider, invalid output) goes straight to placeholders. | The figures and the deck are still useful without AI text; a person writes the text (Part 2 adds editing). |
| New AI feature registration | `weekly_report` added to the AI feature lists; in `aiSettingsInput` its switch is optional so existing clients that send only the original five switches keep working. Two expectations in `ai-unit.test.ts` were extended with the new feature (same strictness). | Additive change; existing API callers and tests keep passing. |
| Report scope stricter than company visibility | Estimates and reports follow `weekly_report.view/manage` (own / team / all) on the company owner. Seeing a company through salesperson cross-visibility does not open its reports. | Reports aggregate a client's delivery status; view-only access to a company record should not include them. |

## H. Weekly Report Agents — Part 2 (2026-11-25)
| Decision | What was done | Why |
|---|---|---|
| Editing rules | Text can be edited only while a report is `ready` or `needs_attention` (never while it is generating, after approval, or when it failed). One request can change, remove and add sentences; it carries the report's `rowVersion`, and a stale one is refused (409). A changed or added sentence gets origin `user`. Sources for an added sentence must come from that report's own fact list. After every edit the checks run again, the status is recomputed and a new draft deck is stored (file first, then the transaction). The audit entry holds counts only, never the text. | The approver must be able to finish a report without AI, and two people must not overwrite each other. |
| User-written sentences need no source | The "no source" check applies to AI sentences only. A number in a user-written sentence that is not in the report's figures is a warning, not a block. | A person is accountable for what they write; they may know things the CRM does not. |
| Regenerate rules | "Regenerate" keeps the stored snapshot (same figures, same week, same version number) and redrafts only the text with AI; all current text, including edits, is replaced. The run is set to `queued` while the job runs, so a second request is refused (409) and the page polls. Flags that describe the data rather than the text (`ESTIMATES_SYNC_FAILED`) are kept. "Generate now" on the company page is different: it collects data again and creates a new version. | Figures must stay reproducible for a version; only the wording is retried. |
| Warning vs blocking flags | Three kinds. **Blocking** (unsourced or internal wording in AI text, unknown number in AI text, placeholder text, empty summary, too many sentences): the report is `needs_attention` and cannot be approved. **Warning** (`level: 'warning'` — unknown number in a user-written sentence, estimates sheet could not be read): approval needs the tick "I checked the flagged figures" (`acknowledgeWarnings`), recorded in the audit entry. **Notice** (`STATUS_MISMATCH`): shown, never blocks. | Lets a person override where they are the better judge, while AI output stays strictly checked. |
| Internal-term check | A word from the internal-term list is flagged only when it does not also appear in the cited fact text (for example a task really named "Flag design"). | Part 1 flagged legitimate client wording. |
| AI suggestion "decide" not used | `POST /ai/suggestions/:id/decide` refuses weekly-report suggestions (422 `WEEKLY_REPORT_DECIDED_BY_APPROVAL`); approval of the report is the decision. AI settings updates merge the feature switches instead of replacing them. | One approval step; older clients that send five switches no longer switch the sixth off. |
| Google Sheets is input only, read-only | `GoogleSheetsEstimatesSource` (port `EstimatesSource`) uses no SDK: a service-account JWT (RS256, `node:crypto`) is exchanged for a token with the scope `spreadsheets.readonly`, then one `values.get` call. There is no code path that writes to Google. Off by default (`ESTIMATES_SOURCE=csv`); with `ESTIMATES_SOURCE=google` and no key the server refuses to start in every environment. Keys and tokens never appear in logs or error messages. | The sheet is the client's scope document; the CRM only reads it. |
| Per-company sheet link | `client_estimate_source` (migration 0008) stores one spreadsheet id and range per company. "Sync now" and every weekly run read the sheet and store the rows as a new `estimate_import`, through the same parser as CSV. If the read fails, the run uses the latest import and adds the warning `ESTIMATES_SYNC_FAILED`. With Google on, a linked sheet counts as "has estimates" for the schedule and "Generate now". | Each client has its own sheet; history of what was read stays in the CRM; a Google outage does not stop the weekly report. |
| Schedule settings and notification | One organization-wide schedule (on/off, weekday, time) in `organization_settings.weekly_report_settings`, edited by an Admin under Settings → Weekly reports; routes live in `routes/weekly-reports.ts`. A scheduled run that reaches `ready`/`needs_attention` sends one in-app notification to the company owner (passed from `workflow.ts` as a hook, so `weekly-reports.ts` does not depend on the notification code). Runs started by hand do not notify. | Smallest additive change; the person who clicked "Generate now" is already looking at the page. |
| Report page provenance | The report page shows its own "About this text" line (simulator or model, prompt version) instead of the shared `AiProvenance` component. | That component needs token counts of one suggestion; a report can be the result of several AI calls. |

## I. Weekly Sales Brief (2026-11-25)
Requirement from the owner (Aakash Saha): "The PPT and Google Sheets reports are independent of deal." "This will be for admins and CEO roles to get an understanding of overall sales and throughput." "Because it's by agents it can also do analysis and actual insights."

| Decision | What was done | Why |
|---|---|---|
| A second report, not a change to the first | The Weekly Sales Brief is a new module (`modules/sales-brief*`, table `sales_brief_run`). The per-client weekly report (`modules/weekly-reports*`) is kept as it is; both run side by side. Shared code was reused, and one helper (`startDeck`: the slide masters) was extracted from `weekly-reports/deck.ts` with its tests unchanged. | The requirement describes a company-wide leadership report; the client report still has its use. Nothing built was removed. |
| CEO = Admin role | Two permissions, `sales_brief.view` and `sales_brief.manage`, are `all` for admins and `none` for sales managers and salespeople. Routes check the permission before parsing anything: non-admins get 403, and the navigation item and dashboard card are not shown. | There is no CEO role in the CRM; no new role was added. |
| Numbers come from `reportOverview` | The Collector calls the Reports page function with the admin actor for four windows (the week, the week before, month to date, quarter to date). Only what that page lacks is queried: leads, opportunities created, forward stage moves, won and lost deals of the week, lead sources, stage ages. Money follows the same currency rule (organization currency only). | The brief must equal the Reports page for the same dates; this is asserted in the integration and browser tests. |
| Signals = code, insights = AI with evidence | "Analysis" is two layers. Signals are computed by deterministic rules with thresholds (`signals.ts`) and carry the metrics and records they are based on. The AI only explains signals and recommends actions; every insight and action must name a signal, every sentence must cite evidence ids, every number must be in the facts, and wording such as "will close", "forecast", "certainly", guarantees and blame is rejected. | The AI never calculates and cannot invent a finding; every sentence can be traced to evidence. |
| Runs as an admin | The brief runs on behalf of the admin chosen in Settings → Sales brief, else the longest-standing active admin; none → the run fails with NO_ACTIVE_ADMIN. AI limits and usage records are that admin's. | AI always acts for a user (AI-ARCHITECTURE §2); the brief needs whole-company scope. |
| A step above 100 % is not a funnel step | New opportunities can exceed converted leads because reps also open opportunities directly. Such a step is never reported as a bottleneck and its percentage is not shown. | Found in the demo: "converted 150 % against 300 %" was reported as a bottleneck. |
| Trends are capped at 3 | Only the three largest moves are kept. | Otherwise trend findings crowd out risks in the limit of 8. |
| Spreadsheet = file first, Google behind a switch | The spreadsheet is an .xlsx (exceljs 4.4.0) that opens in Excel and Google Sheets. `SALES_BRIEF_SHEETS=google` adds a publisher that writes the approved brief to one Google Sheet with RAW values; it runs as a job after approval and its failure never changes the brief. With the switch on and no key or sheet id the server refuses to start. | No Google service account exists yet; a file works everywhere. |
| Tab "Brief history" | The history tab is named "Brief history". | Excel reserves the sheet name "History". |
| No timeline entry | Brief events are written to the audit log only. | Timeline entries are anchored to a company, person or deal; the brief belongs to none. |
| Scheduled brief needs data | The schedule skips a CRM without a single lead or opportunity ("Generate now" still works). | Nothing to brief on; it also leaves existing test suites, which run the scheduled scan, unchanged. |
| Timestamps the clock does not control | Record creation and audit times come from the database clock. Tests and the demo seed set them explicitly with the migrator role. | Needed to place activity in "last week" and "the week before". |
