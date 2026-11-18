# Requirement traceability — implementation

Maps every BRD requirement (`docs/01-specifications/FUNCTIONAL-REQUIREMENTS.md`) to what was actually built.
This file reports the build; it does not replace the approved matrix in `docs/01-specifications/`.
Last updated: 2026-11-18.

**Status key**
| Status | Meaning |
|---|---|
| Done · tested | Built and exercised by an automated test that passes |
| Done · UI untested | Built; server side tested, the screen was opened but its actions are not covered by a browser test |
| Partial | Some of the requirement is built — the gap is stated |
| Simulated | Works end to end against a local stand-in, not a real external service |
| Done · mock-tested | Built and tested end to end, including the screens, with the deterministic mock AI provider. The real provider driver is tested only against recorded fixtures — no live call has been made |
| Not built | Not implemented in this build |
| N/A | Removed by the approved single-company reframing (see SCOPE-RECONCILIATION.md) |

**Test references:** `INT` = `apps/server/src/lifecycle.integration.test.ts` (real PostgreSQL) · `DOM` = `apps/server/src/modules/domain.test.ts` · `PRC` = `packages/shared/src/pricing.test.ts` · `PRP` = `packages/proposal/src/index.test.ts` · `E2E-J` = `e2e/journey.spec.ts` · `E2E-S` = `e2e/screens.spec.ts` · `AI-U` = `apps/server/src/modules/ai/ai-unit.test.ts` · `AI-I` = `apps/server/src/ai.integration.test.ts` (real PostgreSQL) · `E2E-AI` = `e2e/ai.spec.ts`

## Platform and accounts (PLT)
| ID | Requirement (short) | Status | Evidence / gap |
|---|---|---|---|
| BR-PLT-001 | Multi-organization separation | N/A | Single company by approved scope |
| BR-PLT-002 | Self-service sign-up, trial | N/A | Admin creates users; public sign-up disabled (INT, E2E-S) |
| BR-PLT-003 | Individual credentials; Google/Microsoft sign-in | Partial | Email + password done · tested (INT, E2E-J). Google/Microsoft sign-in not built (needs OAuth credentials) |
| BR-PLT-004 | Multi-factor authentication | Not built | — |
| BR-PLT-005 | Admin / Sales Manager / Salesperson roles | Done · tested | `packages/shared/src/permissions.ts`; INT "record-level access", E2E-S "salesperson cannot use admin functions" |
| BR-PLT-006 | Teams; managers see their team | Partial | Team scope enforced and tested (INT). No screen to create teams or assign managers (seeded) |
| BR-PLT-007 | Subscription billing | N/A | — |
| BR-PLT-008 | Onboarding checklist | Not built | — |
| BR-PLT-009 | Audit log | Partial | Written for all changes; append-only enforced by the database (INT). No screen or API to read it |
| BR-PLT-010 | Export all data | Not built | — |
| BR-PLT-011 | Deactivate users, reassign records | Done · tested | INT "deactivation reassigns…"; screen in `pages/admin.tsx` (UI action not browser-tested) |
| BR-PLT-012 | Organization settings | Partial | Settings exist and are used (currency, AI on/off, stage rules); set by seed only, no settings screen |

## Data import (MIG)
| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| BR-MIG-001…007 | CSV/Excel import, HubSpot/Pipedrive, dedupe, validation report, undo, DOCX template upload | Not built | Tables exist in the schema; no import code or screens |

## CRM records (CRM)
| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| BR-CRM-001 | Companies: create, view, update, archive | Partial | Create/view done · tested (INT, E2E-J). Update and archive: API only, no edit form |
| BR-CRM-002 | Contacts linked to companies | Partial | Create/list done · tested (E2E-J). Update: API only |
| BR-CRM-003 | Deals with amount, close date, stage, owner, contacts with roles | Done · tested | INT, E2E-J (deal, stakeholder with role) |
| BR-CRM-004 | One owner; reassign | Done · UI untested | API tested (INT); no reassign control on the deal screen |
| BR-CRM-005 | Configure pipeline stages and probabilities | Partial | Stages and probabilities drive the board and forecast; seeded, no admin screen |
| BR-CRM-006 | Multiple pipelines | Not built | One pipeline |
| BR-CRM-007 | Custom fields | Not built | — |
| BR-CRM-008 | Tasks with due dates and reminders | Done · tested | INT "logs activities, notes and tasks"; reminder scan in `modules/workflow.ts` |
| BR-CRM-009 | "My Day" view | Partial | "My tasks" page + dashboard "Deals needing attention" (E2E-S opens both); not one combined view |
| BR-CRM-010 | Notes, call and meeting logs | Done · tested | INT; dialogs on the deal screen (not browser-tested) |
| BR-CRM-011 | Filter, sort, saved views; deal board | Partial | Board and list with text filter done (E2E-S). No column sort or saved views |
| BR-CRM-012 | Search across records | Partial | Companies, contacts, deals (`/api/v1/search`). Proposals not searched |
| BR-CRM-013 | Bulk edit / reassign | Not built | — |
| BR-CRM-014 | Lost reason required | Done · tested | INT "requires a lost reason"; reasons are seeded |

## Email and calendar (EML)
| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| BR-EML-001…007 | Mailbox connection, email sync, send from CRM, inbox add-in, calendar sync, open tracking | Not built | Blocked on Google/Microsoft app credentials and decisions OD-08/OD-09. Proposal links are shared by copy-and-paste |

## Leads (LED)
| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| BR-LED-001 | Web forms creating contacts, companies, deals | Partial | One fixed hosted form, done · tested (INT, E2E-S). No form builder |
| BR-LED-002 | Assignment rules | Partial | Round-robin done · tested (INT). Rules by field value not built |
| BR-LED-003 | Notify assigned salesperson | Done · tested | In-app notification (INT) |
| BR-LED-004 | Duplicate check | Done · tested | Matches contact by email, company by domain (INT) |
| BR-LED-005 | Lead source (campaign tags, page) | Not built | — |
| BR-LED-006 | Spam protection | Done · tested | Honeypot + rate limit (INT) |
| BR-LED-007 | Webhook intake | Partial | The public submission endpoint accepts JSON; no per-source keys or mapping |

## Templates (TPL)
| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| BR-TPL-001 | Create/edit templates with sections, text, images, tables | Partial | Sections with plain text + pricing table + signature block (INT, E2E-S opens editor). No rich text or images |
| BR-TPL-002 | Placeholders | Partial | Standard fields done · tested (PRP, E2E-J shows resolved values). Custom fields not built |
| BR-TPL-003 | Locked sections | Done · tested | INT; Admin-only lock control in the editor |
| BR-TPL-004 | Template versions pinned to proposals | Done · tested | INT "publishing pins an immutable version" |
| BR-TPL-005 | Content block library | Not built | — |
| BR-TPL-006 | Branding (logo, colours, fonts) | Partial | Organization name and one fixed style. No logo or colour settings |
| BR-TPL-007 | Starter templates | Partial | One seeded "Services proposal" |
| BR-TPL-008 | Flag missing placeholder values | Done · tested | Pre-send check (PRP, INT, E2E-J) |

## Pricing (PRC)
| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| BR-PRC-001 | Product catalogue | Done · UI untested | API tested (INT); screen opened (E2E-S); E2E-J adds a catalogue item to a proposal |
| BR-PRC-002 | Line items, discounts, taxes, totals | Done · tested | PRC (decimal maths), INT, E2E-J |
| BR-PRC-003 | One-time vs recurring totals | Done · tested | PRC |
| BR-PRC-004 | Prompt to update deal amount | Done · UI untested | API tested (INT); prompt visible in E2E screenshots, button not clicked by a test |
| BR-PRC-005 | Default currency | Done · tested | Organization setting used throughout |
| BR-PRC-006 | Other currencies per deal | Not built | — |
| BR-PRC-007 | Discount limit warning | Done · tested | Role limits 15 % / 30 % → confirmation before send (INT). Limits are constants, not settings |

## Proposals (PRP)
| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| BR-PRP-001 | Create from deal + template | Done · tested | INT, E2E-J |
| BR-PRP-002 | Auto-populated with CRM data and pricing | Done · tested | PRP, E2E-J (buyer sees resolved names) |
| BR-PRP-003 | Edit editable sections only | Done · tested | INT (locked section rejected) |
| BR-PRP-004 | Preview as the buyer sees it | Done · tested | E2E-J; same HTML renderer as the buyer view and PDF |
| BR-PRP-005 | PDF and DOCX with the same content | Partial | Both generated from one frozen snapshot. PDF via real Edge verified in E2E-J (`%PDF-` header only). DOCX generation unit-tested (PRP); visual parity not checked |
| BR-PRP-006 | Keep every sent version; compare | Done · UI untested | Immutability enforced by a database trigger (INT); compare API tested (PRP, INT); dialog not browser-tested |
| BR-PRP-007 | Statuses Draft … Void | Done · tested | DOM, INT |
| BR-PRP-008 | Linked to deal, company, contacts | Done · tested | INT |
| BR-PRP-009 | Validity / expiry date | Partial | Default validity applied and expiry scan tested (INT). No field to change the date |
| BR-PRP-010 | Copy to another deal | Not built | — |

## AI assistance (AIA)
Every AI feature runs through one pipeline: authorize → context engine → versioned prompt → provider → schema validation → pending suggestion → human decision. **No live call to a real AI provider has been made** (no credentials, no approval for paid calls — OD-05). What the mock proves is the pipeline, the permissions, the approval flow and the screens; it does not prove output quality.

| ID | Requirement | Status | Implementation | Test evidence | Gap |
|---|---|---|---|---|---|
| BR-AIA-001 | AI drafts proposal content | Done · mock-tested | `modules/ai.ts` `draftSections`; context from company, contacts, deal, pricing lines, template text, notes, catalogue (`ai/context.ts`); one or all empty sections; editable; regenerate; provenance stored | AI-I "drafts proposal sections…", "rejecting leaves…", "flags prices…"; E2E-AI test 1; AI-U mock | Linked emails are not context (mailbox integration not built). Plain text, not rich text. Not streamed |
| BR-AIA-002 | Pre-send checks (names, figures, placeholders, required sections, dates) | Done · mock-tested | `reviewProposal`: rule layer (`packages/proposal` `presendChecks`, authoritative) + AI layer with quote validation; findings stored in `ai_review` with a decision per finding | AI-I "review combines…", "rule blockers are authoritative, hallucinated AI findings are dropped…"; E2E-AI test 1; PRP | "Outdated date" and "contradiction" detection rely entirely on the real model — the mock does not produce them, so they are untested |
| BR-AIA-003 | AI summary of a deal's history | Done · mock-tested | `dealSummary`: facts panel from CRM data + AI text; can be saved as a note | AI-I "deal summary separates recorded facts…"; E2E-AI test 2 | Email threads are not included (not built) |
| BR-AIA-004 | Rewrite selected text | Done · mock-tested | `rewriteText` + `RewriteControl`: 8 modes incl. custom; only the stored selection can be replaced | AI-I "rewrites only the selected text…", "stale selections, locked sections…"; E2E-AI test 1 | — |
| BR-AIA-005 | AI drafts a follow-up email for review | Done · mock-tested | `followUpDraft` + `FollowUpDialog`: 6 situations, engagement-aware context, editable, approve → copy or open the user's mail program | AI-I "follow-up email stays a draft…"; E2E-AI test 2 | Not triggered automatically from the follow-up task (BR-AUT-004); the user starts it |
| BR-AIA-006 | AI never sends anything without a user's action | Done · tested | Provider has no tools; AI module does not import sharing, e-signature, email or job code; only `decide` writes, and only to a draft section or a note | AI-I "BR-AIA-006 is structural…" (source check), "follow-up email stays a draft…" (no email, link, signature, job, deal or proposal change); AI-U "tool-free request" | — |
| BR-AIA-007 | AI content marked until accepted; usage logged | Done · tested | Pending suggestions labelled on every screen and block sending; `ai_generation` (provider, model, prompt version, context record ids, decision, who decided); `ai_usage` (tokens, cost estimate, latency, attempts, request ids, outcome); audit log entries | AI-I "drafts… with provenance", "records usage with attribution…"; E2E-AI tests 1–2 (labels, "AI activity" page) | Accepted text is not marked "AI-assisted" inside the proposal afterwards (provenance is in the record and timeline only) |
| BR-AIA-008 | Admins can turn AI on or off | Done · tested | `/admin/ai`: organization switch, per-feature switches, daily per-user limit, monthly budget; enforced in `assertAiAllowed` for every call | AI-I "Admin switches are enforced on the server…", "enforces the per-user daily limit…"; E2E-AI test 3 | — |
| BR-AIA-009 | Customer data not used for training; data kept separate | Blocked · decision | Data minimization and permission-scoped context are built and tested (AI-I "context is minimized…", "permission-scoped…"). Whether the provider trains on or retains data is a contract matter | — | Provider terms not chosen (OD-05, OD-90). Single organization, so cross-organization separation does not apply |

**Provider layer evidence (AI-U, 24 tests):** request shape sent to the Anthropic SDK; response parsing incl. cache token counters; refusal and truncation handling; mapping of HTTP 400/401/403/404/408/429/500/503/529, timeouts and connection errors; retry-after; configuration status without exposing the key; mock determinism; schema validity for all five features; prompt-delimiter injection defence; cost estimation; settings defaults.
**Engine evidence (AI-I):** one retry on transient failures, none on permanent ones, refusal reported distinctly, one repair attempt on invalid output, markup stripped from output, per-minute / per-day / monthly limits.

## Sharing and engagement (SHR)
| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| BR-SHR-001 | Unique secure link | Done · tested | Per recipient; token only in the URL fragment, stored hashed (INT, E2E-J) |
| BR-SHR-002 | Send link through own mailbox | Not built | Copy-and-paste only (depends on EML) |
| BR-SHR-003 | Choose recipients | Done · tested | E2E-J |
| BR-SHR-004 | Record views (who, when, how long) and downloads | Done · tested | INT, E2E-J |
| BR-SHR-005 | Forwarded viewers identify themselves | Done · tested | INT. Not covered in the browser test |
| BR-SHR-006 | Email verification before viewing | Not built | Needs an email provider |
| BR-SHR-007 | Revoke links; link expiry | Partial | Revoke done · tested (INT). Links expire with the proposal; no per-link expiry control |
| BR-SHR-008 | Access history | Done · tested | Proposal page "Sharing and engagement" (E2E-J) |
| BR-SHR-009 | Branded, mobile-friendly buyer view | Partial | Responsive layout; not tested on a phone; branding limited (see TPL-006) |
| BR-SHR-010 | Accept / decline without signature | Done · tested | INT. Buyer buttons not covered in the browser test |

## Notifications (NTF)
| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| BR-NTF-001 | In-app and email alerts on proposal events | Partial | In-app done · tested (INT), polled every 30 s. Email goes to the server log only |
| BR-NTF-002 | Notification preferences | Not built | — |
| BR-NTF-003 | Daily summary | Not built | — |
| BR-NTF-004 | Browser push | Not built | — |

## E-signature (SIG)
All signing is **simulated**. Nothing here is legally valid until a real provider is chosen (OD-03) and connected.
| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| BR-SIG-001 | Request signatures on a specific version | Simulated | INT, E2E-J |
| BR-SIG-002 | Multiple signers, order | Simulated | INT (sequential order) |
| BR-SIG-003 | Legally valid signatures | Not built | Unresolved — requires a real provider |
| BR-SIG-004 | Email identity verification | Not built | Provider responsibility |
| BR-SIG-005 | SMS verification | Not built | — |
| BR-SIG-006 | Consent captured | Not built | Provider responsibility; simulator records a placeholder |
| BR-SIG-007 | Statuses Pending … Voided | Done · tested | DOM, INT (forward-only) |
| BR-SIG-008 | Reminders, resend | Not built | — |
| BR-SIG-009 | Completion certificate | Simulated | Simulator produces a placeholder file |
| BR-SIG-010 | Tamper-evident signed PDF, sent to all parties | Simulated | Stored and downloadable; not tamper-evident; not emailed |
| BR-SIG-011 | Signed document locked to its version | Done · tested | Database trigger (INT) |
| BR-SIG-012 | Signer can decline | Simulated | INT |
| BR-SIG-013 | Void a pending request | Done · tested | INT, incl. late completion after void (ADR-025) |

## Automation (AUT)
| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| BR-AUT-001 | Sent → move stage | Done · tested | INT, E2E-J |
| BR-AUT-002 | All signed → Closed Won | Done · tested | INT, E2E-J |
| BR-AUT-003 | Declined → task, deal stays open | Done · tested | INT |
| BR-AUT-004 | Follow-up task if not viewed | Done · tested | DOM/INT (delayed job) |
| BR-AUT-005 | Flag stalled deals | Done · tested | INT "scheduled scans" |
| BR-AUT-006 | Flag overdue deals | Done · UI untested | Scan built; shown as a badge; no dedicated test assertion |
| BR-AUT-007 | Admin-configurable rules | Not built | Rules are built in |
| BR-AUT-008 | Labelled as automated; reversible | Done · tested | INT "can be reversed once"; E2E-J sees the label and Reverse button |

## Reporting (RPT)
| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| BR-RPT-001 | Pipeline by stage / owner | Done · tested | Dashboard (INT, E2E-S) |
| BR-RPT-002 | Won/lost, win rate, lost reasons | Done · UI untested | In dashboard API; figures not asserted beyond scope test |
| BR-RPT-003 | Rep performance | Done · UI untested | Same |
| BR-RPT-004 | Proposal metrics | Partial | Sent, view rate, win rate, time to first view. Time to sign and creation-to-first-proposal not built |
| BR-RPT-005 | Deals needing attention | Done · tested | E2E-S (dashboard), INT flags |
| BR-RPT-006 | Weighted pipeline | Done · UI untested | Dashboard "Weighted forecast" |
| BR-RPT-007 | Filters (date, team, owner, pipeline) | Not built | Fixed 90-day window |
| BR-RPT-008 | Respect permissions | Done · tested | INT "reports are scoped by role" |
| BR-RPT-009 | CSV export | Not built | — |
| BR-RPT-010 | Activity reporting | Partial | Calls/meetings and completed tasks counts; no per-rep table; no emails |

## Timeline (TIM)
| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| BR-TIM-001 | One chronological deal timeline | Done · tested | INT, E2E-J (emails excluded — EML not built) |
| BR-TIM-002 | Filter by type | Done · UI untested | Filter control present |
| BR-TIM-003 | Company and contact timelines | Partial | Company timeline shown; contact timeline API only |
| BR-TIM-004 | Who and when on every event | Done · tested | E2E-J ("system · Automated") |

## Totals
| Status | Count |
|---|---|
| Done · tested | 45 |
| Done · mock-tested | 5 |
| Done · UI untested | 9 |
| Partial | 25 |
| Simulated | 5 |
| Not built | 37 |
| Blocked · decision | 1 |
| N/A | 3 |
| **All requirements** | **130** |
