# Scope Reconciliation: BRD v2.0 to Internal Sales CRM

| Item | Detail |
|---|---|
| Document | SCOPE-RECONCILIATION.md (authoritative disposition of every BRD v2.0 item) |
| Source | Sales_CRM_Phase_1_BRD_v2.0.docx, "Version 2.0 · Draft for review · 17 November 2026" (not modified) |
| Status | Draft for review, v0.1, 17 Nov 2026 |
| Owner | Product Owner, with the Principal Solution Architect |
| Related | PRD.md, OPEN-DECISIONS.md, FUNCTIONAL-REQUIREMENTS.md (DR-* items), ROLE-PERMISSION-MATRIX.md, ARCHITECTURE-DECISIONS.md |

## 1. Purpose and authority

This document records what happens to **every** item in BRD v2.0 now that the product is a **single-company, single-tenant internal production Sales CRM** for our own sales team (roles Admin, Sales Manager, Salesperson; external buyers/signers still receive, view, forward and sign proposals) and not the commercial multi-customer product the BRD describes.

Rules:
1. Every BRD item has exactly one row and one disposition. An item missing from this document is a defect in this document. Nothing is dropped without a row.
2. BRD IDs and wording are preserved. The "Short text" column abbreviates. The BRD text in brd.md stays the requirement of record.
3. A disposition other than Unchanged must cite an IDD (decided) or an OD (open, Working Assumption applied), or must name the analysis finding that leads to a Derived requirement (DR, "Derived — pending confirmation").
4. Release tags (R1/R2/R3) in Notes are a **recommendation** under OD-08. They do not change BRD priority labels (OD-40).

## 2. Original BRD requirements vs Internal Deployment Decisions

| Category | What it is | ID namespace | Status | Who can change it |
|---|---|---|---|---|
| **Original BRD requirement** | Text written in BRD v2.0: what the business asked for | BR-*, NFR-*, AC-01..AC-18, OQ-1..OQ-10, P1..P9, §11 step N | Requirement of record, never reworded | BRD owner, through a BRD revision |
| **Internal Deployment Decision (IDD)** | A decision already taken because the product is now a single-tenant internal app. It changes how (or whether) an original requirement applies | IDD-01..IDD-16 | **Decided** | Product Owner + Leadership, through a change to this document |
| **Open Decision (OD) + Working Assumption (WA)** | An unresolved business or technical question. The design uses the WA until the owner decides | OD-01..OD-47 (foundation), OD-48+ proposed in OPEN-DECISIONS.md | **Open**, WA reversible | Named OD owner (see OPEN-DECISIONS.md) |
| **Derived requirement (DR)** | A gap filled by analysis that the BRD does not state | DR-<MOD>-NN | "Derived — pending confirmation" | Product Owner |

An IDD is **not** a BRD requirement and does not claim BRD authority. Where an IDD and the BRD text disagree, the IDD governs delivery of the internal product, and the BRD text is kept as the original intent.

## 3. Disposition legend

| Disposition | Meaning |
|---|---|
| Unchanged | Delivered as written. The note may only add release or design context |
| Clarified | Delivered as written. An ambiguity, gap or inconsistency is resolved by an OD WA or an analysis WA, and the BRD intent is kept. Reversible if the OD is decided differently |
| Modified | The intent is changed for the internal deployment by an IDD (decided). The retained part is stated |
| Deferred | Not delivered in Phase 1 (R1–R3). Kept as a future capability or an extension point (IDD-13) |
| Out of scope | Will not be built for the internal product |

"Analysis WA" means a Stage-1 analysis working assumption that has no OD of its own. These are listed for confirmation as proposed **OD-54** in OPEN-DECISIONS.md and become DR-* items in FUNCTIONAL-REQUIREMENTS.md.

## 4. Summary counts

### 4.1 Business requirements (BR-*) by disposition and BRD priority

| Disposition | Must | Should | Could | Total |
|---|---|---|---|---|
| Unchanged | 30 | 10 | 2 | 42 |
| Clarified | 65 | 14 | 0 | 79 |
| Modified | 5 | 1 | 0 | 6 |
| Deferred | 0 | 0 | 2 | 2 |
| Out of scope | 1 | 0 | 0 | 1 |
| **Total** | **101** | **25** | **4** | **130** |

- Modified Musts: BR-PLT-001, BR-PLT-002, BR-PLT-008, BR-AIA-008, BR-AIA-009. Modified Should: BR-TPL-007.
- Out of scope: BR-PLT-007 (Must). Deferred: BR-MIG-007, BR-NTF-004 (both Could, under the OD-09 and OD-47 WAs).
- Effective Must build scope is **100 in-scope Musts** (101 minus BR-PLT-007, which is Out). Three of them (BR-PLT-001, -002, -008) are delivered in much reduced (Modified) form but still count as in scope. The earlier foundation estimate of "~97 Musts" is superseded (foundation §12 resolution R2).
- Counts in this table are a row-by-row count of §7.1 (verified by script, 17 Nov 2026). The previous summary (43 Unchanged / 78 Clarified) was off by one Must row and is corrected. FUNCTIONAL-REQUIREMENTS.md §1.3 and every per-requirement disposition there match §7.1 exactly (§12 R2).

### 4.2 Other BRD items

| Item group | Rows | Unchanged | Clarified | Modified | Deferred | Out of scope |
|---|---|---|---|---|---|---|
| NFR-001..NFR-015 | 15 | 1 | 11 | 3 | 0 | 0 |
| AC-01..AC-18 | 18 | 7 | 5 | 6 | 0 | 0 |
| §8.2 later-phase capabilities | 12 | 0 | 0 | 0 | 12 | 0 |
| §8.3 never-planned items | 4 | 0 | 0 | 0 | 0 | 4 |
| §13 assumptions (6), constraints (3), dependencies (6), risks (9) | 24 | 5 | 8 | 9 | 0 | 2 |
| OQ-1..OQ-10 | 10 | 0 | 9 (transferred to OD) | 0 | 0 | 1 |
| Other BRD content (§1–§7, §8.1, §9 key, §9.17, §12, §15, §17) | 59 | see §7.8 | | | | |

## 5. Corrected requirement count (BRD §9.16)

BRD §9.16 states **100 Must / 26 Should / 4 Could = 130**. A row-by-row count of §9.1–§9.15 gives **101 Must / 25 Should / 4 Could = 130**.

| Module | BRD §9.16 (M/S/C) | Actual count (M/S/C) | Difference |
|---|---|---|---|
| PLT | 11/1/0 | 11/1/0 | — |
| MIG | 4/2/1 | 4/2/1 | — |
| CRM | 12/2/0 | 12/2/0 | — |
| EML | 6/1/0 | 6/1/0 | — |
| LED | 4/2/1 | 4/2/1 | — |
| TPL | 6/2/0 | 6/2/0 | — |
| **PRC** | **4/3/0** | **5/2/0** | BR-PRC-001..005 are Must; only BR-PRC-006 and BR-PRC-007 are Should |
| PRP | 8/2/0 | 8/2/0 | — |
| AIA | 7/2/0 | 7/2/0 | — |
| SHR | 8/2/0 | 8/2/0 | — |
| NTF | 2/1/1 | 2/1/1 | — |
| SIG | 11/2/0 | 11/2/0 | — |
| AUT | 6/1/1 | 6/1/1 | — |
| RPT | 7/3/0 | 7/3/0 | — |
| TIM | 4/0/0 | 4/0/0 | — |
| **Total** | **100/26/4** | **101/25/4** | One PRC item was miscounted as Should. The §17.2 closing sentence ("whether 100 Must requirements is realistic") repeats the error |

The item total (130) is correct. Only the Must/Should split is wrong. The BRD text itself is not changed. This document and all derived documents use 101/25/4.

## 6. BRD inconsistencies found in analysis

| INC | Inconsistency | BRD refs | Resolution |
|---|---|---|---|
| INC-01 | §9.16 count wrong (101/25/4, not 100/26/4) | §9.16, §17.2 closing line | §5 above |
| INC-02 | Proposal status "Void" vs signature request status "Voided" | BR-PRP-007, BR-SIG-007 | OD-18: keep both labels and define how they interact |
| INC-03 | §11 step 1 "A lead arrives through … an email" has no backing requirement | §11 step 1 | OD-38: no automatic lead-from-email in Phase 1 |
| INC-04 | §3.2/§8.1 put "rules-based automation" in scope, while configurable rules BR-AUT-007 is Could | §3.2, §8.1, BR-AUT-007 | Built-in rules BR-AUT-001..006 fulfil §8.1. Rules are stored as rows so BR-AUT-007 can expose them later (ADR-024) |
| INC-05 | AC-04/AC-05 require both Gmail and Outlook, while §13.4 mitigation says "launch Outlook or Gmail first" | AC-04, AC-05, §13.4, OQ-5 | OD-06/OD-07: build the company's provider first |
| INC-06 | Must items use "overdue" deals, which only BR-AUT-006 (Should) defines | BR-CRM-009, BR-RPT-005, BR-AUT-006 | OD-40: AUT-006 ships with its dependent Musts |
| INC-07 | Must items use status "Declined", which comes only from Should items | BR-PRP-007, BR-NTF-001, BR-AUT-003 ← BR-SIG-012, BR-SHR-010 | OD-40 |
| INC-08 | Must status "Expired" depends on Should validity date | BR-PRP-007 ← BR-PRP-009 | OD-40, OD-22 |
| INC-09 | Stage probabilities (Must) are consumed only by weighted pipeline (Should) | BR-CRM-005, BR-RPT-006 | OD-40 |
| INC-10 | Form builder is Must, but webhook from existing forms is Could, although the webhook is usually cheaper | BR-LED-001, BR-LED-007 | Priorities unchanged. LED-007 is an R3 candidate |
| INC-11 | MFA is only Should (BR-PLT-004), while NFR-001 requires "multi-factor authentication available" | BR-PLT-004, NFR-001 | OD-13: TOTP MFA at launch |
| INC-12 | §8.2 defers "single sign-on" to Phase 3, but BR-PLT-003 (Must) requires Google/Microsoft sign-in | §8.2, BR-PLT-003 | Google/Microsoft OAuth login is in scope; enterprise SAML SSO stays Phase 3 (OD-12) |
| INC-13 | v1.0 and v2.0 carry the same date (17 Nov 2026) | §1 | Recorded only |
| INC-14 | BR-SHR-010 lets the buyer "accept", but BR-PRP-007 has no status for acceptance. §12 proposal win rate ("Signed proposals ÷ proposals sent") ignores accepted proposals | BR-SHR-010, BR-PRP-007, §12 | OD-17 (Accepted status as a labelled extension), OD-35 |
| INC-15 | AC-02 (acceptance of the whole release) requires import "from CSV, HubSpot or Pipedrive exports", but HubSpot/Pipedrive import BR-MIG-002 is Should | AC-02, BR-MIG-002 | OD-09: required only if we currently use HubSpot or Pipedrive |
| INC-16 | "Must = required for launch" (§9), but OQ-10 questions whether the inbox add-in (BR-EML-005, Must) is needed at launch, and the OD-07 WA sequences it after email sync | §9 key, BR-EML-005, OQ-10 | OD-07 + proposed OD-48 (which release counts as internal go-live) |

## 7. Disposition tables

### 7.1 Business requirements (130)

#### PLT — Platform and accounts (11 Must / 1 Should)

| ID | Short text | BRD priority | Disposition | Reason | Decision ref | Notes |
|---|---|---|---|---|---|---|
| BR-PLT-001 | Many customer organizations; each organization's data completely separate | Must | Modified | Single tenant: one organization per deployment | IDD-01 | Met by a dedicated deployment + database. No tenant/org id on business tables; singleton `organization_settings`. R1 |
| BR-PLT-002 | Sign up, create workspace, start trial, invite users | Must | Modified | No self sign-up or trial for an internal app | IDD-02 | Retained: Admin invites users by email. First Admin is bootstrapped by a one-time CLI/seed command. R1 |
| BR-PLT-003 | Individual credentials; email+password or Google/Microsoft sign-in | Must | Clarified | OAuth limited to the company domain/tenant; Admin may disable password login; SAML SSO stays Phase 3 | OD-12 | INC-12. R1 |
| BR-PLT-004 | MFA, which admins can require | Should | Clarified | NFR-001 needs MFA "available"; TOTP delivered at launch; recommended mandatory for Admins | OD-13 | INC-11. Priority label unchanged. R1 |
| BR-PLT-005 | Admin, Sales Manager, Salesperson roles with §9.17 permissions | Must | Clarified | Gaps in §9.17 filled | OD-31 | ROLE-PERMISSION-MATRIX.md is authoritative. Enforced in the backend. R1 |
| BR-PLT-006 | Teams and managers; managers see their team's records | Must | Clarified | Team structure not specified | OD-32, OD-31 | Each user is in at most one team. A manager can manage several teams. A manager's own records count as "own team". R1 |
| BR-PLT-007 | Subscription billing: plans, seats, payment, invoices, trial conversion | Must | Out of scope | No billing for an internal product | IDD-03 | Seat management is absorbed by user management (BR-PLT-011) |
| BR-PLT-008 | Guided onboarding checklist | Must | Modified | Becomes an internal setup checklist | IDD-04 | Admin: import data, configure pipeline, create first template. User: connect mailbox (active from R2), send first proposal. R1 |
| BR-PLT-009 | Audit log of key user, admin, system actions | Must | Clarified | The audit log holds personal data, so access is Admin-only and a retention period applies. It also covers AI actions (NFR-009) | OD-36 | Exempt from erasure (OD-36 WA). R1 |
| BR-PLT-010 | Admins export all organization data in standard formats | Must | Unchanged | Purpose is backup, exit and compliance | IDD-12 | Content per analysis WA (OD-54): CSV/JSON per entity + signed PDFs and certificates; metadata only for private emails (OD-30). R1 |
| BR-PLT-011 | Deactivate users and reassign their records | Must | Clarified | Effects of deactivation not specified; takes over seat management | IDD-03, OD-54 | Analysis WA: on deactivation the Admin must reassign open deals, tasks and proposals; mailbox sync stops and tokens are revoked; the user leaves round-robin; pending signature requests keep the sender of record, and notifications go to the new owner. R1 |
| BR-PLT-012 | Organization settings: name, branding, currency, time zone, fiscal year | Must | Clarified | A single organization means one singleton settings row | IDD-01, OD-15 | Also holds the exchange-rate table (OD-15) and locale formatting for placeholders. R1 |

#### MIG — Data import (4 Must / 2 Should / 1 Could)

| ID | Short text | BRD priority | Disposition | Reason | Decision ref | Notes |
|---|---|---|---|---|---|---|
| BR-MIG-001 | Import companies, contacts, deals from CSV/Excel with field mapping | Must | Unchanged | Always required | OD-09 | §13.2 says this capability cannot be cut. R1 |
| BR-MIG-002 | Guided import from HubSpot and Pipedrive exports | Should | Clarified | Built only if we currently use HubSpot or Pipedrive | OD-09 | If neither is used, the disposition becomes Out of scope when OD-09 is decided. Default R3; must come before go-live if a source is confirmed (proposed OD-48). INC-15 |
| BR-MIG-003 | Duplicate detection; skip/merge/create | Must | Clarified | Matching keys not defined | OD-27 | Exact keys only; fuzzy candidates (pg_trgm) are suggestions only. R1 |
| BR-MIG-004 | Validation and error report before saving | Must | Unchanged | — | — | R1 |
| BR-MIG-005 | Undo an import batch | Must | Unchanged | — | — | Records are linked to `import_batch`. R1 |
| BR-MIG-006 | Upload DOCX proposals as template starting points | Should | Unchanged | — | — | R1 (§12 R1; Admin-only, §12 R8) |
| BR-MIG-007 | Direct API import from HubSpot and Pipedrive | Could | Deferred | WA: API import deferred | OD-09 | Revisit if export-based import is not enough |

#### CRM — CRM records (12 Must / 2 Should)

| ID | Short text | BRD priority | Disposition | Reason | Decision ref | Notes |
|---|---|---|---|---|---|---|
| BR-CRM-001 | Create, view, update, archive companies | Must | Unchanged | — | — | Archive is a soft delete. Hard delete happens only through governed erasure (OD-36). R1 |
| BR-CRM-002 | Manage contacts and associate them with companies | Must | Clarified | Contact–company cardinality not specified | OD-33 | A contact has zero or one primary company. R1 |
| BR-CRM-003 | Deals with name, amount, close date, stage, owner, company, contacts with roles | Must | Clarified | Company optionality and role list not specified | OD-33, OD-34, OD-15 | A deal requires a company. The Admin defines the roles, seeded with Decision-maker, Signer, Influencer and the system role Forwarded viewer. A deal has a currency (OD-15). R1 |
| BR-CRM-004 | One owner per deal; authorized users reassign | Must | Clarified | "Authorized" not defined | OD-31 | Admin: all deals. Sales Manager: within team. Salesperson: cannot reassign. R1 |
| BR-CRM-005 | Configure pipeline stages and win probability | Must | Clarified | Won/lost stage semantics not specified | Analysis WA (OD-54), OD-40 | Each pipeline has the system stages "Closed Won" (100) and "Closed Lost" (0). Probabilities feed BR-RPT-006 (INC-09). R1 |
| BR-CRM-006 | Multiple pipelines | Should | Unchanged | — | — | The data model supports several pipelines from R1; the admin UI ships in R3 |
| BR-CRM-007 | Custom fields (7 types) usable in filters, reports, templates | Must | Clarified | Placeholder formatting and field deletion not specified | OD-54 | Analysis WA: formatting follows locale and currency from org settings; multi-select values joined by ", "; checkbox shows Yes/No; deleting a definition archives it and keeps its values. R1 |
| BR-CRM-008 | Tasks with due dates and reminders linked to records | Must | Clarified | Reminder channels not specified | OD-47 | Reminders are in-app + email. R1 |
| BR-CRM-009 | "My Day": today's/overdue tasks and deals needing attention | Must | Clarified | "Deals needing attention" uses overdue deals from BR-AUT-006 (Should) | OD-40 | INC-06. AUT-006 also ships in R1. R1 |
| BR-CRM-010 | Notes; manually log calls and meetings | Must | Unchanged | — | — | R1 |
| BR-CRM-011 | Filter, sort, save list views; deal board by stage | Must | Unchanged | — | — | R1 |
| BR-CRM-012 | Search across companies, contacts, deals, proposals | Must | Unchanged | — | — | Postgres full-text search + pg_trgm (ADR-005). R1 |
| BR-CRM-013 | Bulk edit and reassign within permissions | Should | Clarified | Salesperson cannot bulk reassign | OD-31 | R3 |
| BR-CRM-014 | Lost requires a lost reason from an admin-defined list | Must | Unchanged | — | OD-31 (Admin maintains list) | R1 |

#### EML — Email and calendar (6 Must / 1 Should)

| ID | Short text | BRD priority | Disposition | Reason | Decision ref | Notes |
|---|---|---|---|---|---|---|
| BR-EML-001 | Each user connects a Gmail or Outlook mailbox | Must | Clarified | The adapter supports both; the company's actual provider is built first, the second is a follow-up | OD-06 | INC-05. An internal OAuth app (Google "Internal" / single-tenant Entra) avoids public verification. R2 |
| BR-EML-002 | Auto-link emails to contacts, companies, deals; users correct links | Must | Clarified | Contact on several open deals; unknown senders | OD-28, OD-29 | If several open deals match, link to the one with the most recent activity and mark it "auto — review suggested". Unmatched emails are not stored. R2 |
| BR-EML-003 | Exclude domains/contacts; mark emails private | Must | Clarified | What "private" hides is not defined | OD-30 | Metadata is shown on timelines; subject/body only to the mailbox owner; excluded from AI, report content and export bodies. R2 |
| BR-EML-004 | Send from CRM via own mailbox with email templates + placeholders | Must | Clarified | Who owns email templates | OD-31 | Personal templates (any user) and shared templates (Admin, or a Manager with template rights). R2 |
| BR-EML-005 | Gmail and Outlook add-in: related record, create records, send proposals | Must | Clarified | Largest integration item; for the company's provider only, delivered after core email sync | OD-07, OD-06 | Outlook: Office.js task pane. Gmail: Workspace add-on. R3. INC-16 |
| BR-EML-006 | Calendar sync; log meetings with known contacts | Must | Clarified | Calendar provider follows the mail provider | OD-06 | R2 |
| BR-EML-007 | Open tracking for CRM-sent emails | Should | Clarified | Consent | OD-37 | Off by default; the Admin enables it org-wide; users opt in per email. R2 (§12 R1) |

#### LED — Lead capture (4 Must / 2 Should / 1 Could)

| ID | Short text | BRD priority | Disposition | Reason | Decision ref | Notes |
|---|---|---|---|---|---|---|
| BR-LED-001 | Form builder + embed; submissions create/update contacts, companies, optional deals | Must | Clarified | How the company is matched or created | OD-33, OD-27 | Company comes from the company name or email domain; free-mail domains (Admin-maintained list) are never matched as company domains; a submission without a resolvable company creates/updates the contact without a deal (§12 R3, OD-33). INC-10. R1 (§12 R1) |
| BR-LED-002 | Assignment rules: round-robin or by field value | Must | Clarified | Deactivated users and the no-match case | OD-54 | Deactivated users leave round-robin (analysis WA). The fallback owner when no rule matches is a newly found gap (OD-54). R1 (§12 R1) |
| BR-LED-003 | Assigned salesperson notified immediately | Must | Unchanged | — | — | Event `new_lead_assigned`. R1 (§12 R1) |
| BR-LED-004 | Submissions checked for duplicates | Must | Clarified | Matching keys | OD-27 | R1 (§12 R1) |
| BR-LED-005 | Record lead source (campaign tags, page) | Should | Unchanged | — | — | R3 |
| BR-LED-006 | Spam protection on forms | Should | Clarified | Mechanism | OD-46 | Honeypot + per-IP rate limit + optional Turnstile. R1 with LED-001: public forms must not go live without it (§12 R1) |
| BR-LED-007 | Leads from existing website forms via webhook | Could | Unchanged | — | — | R3 candidate if capacity allows (INC-10) |

#### TPL — Templates and content library (6 Must / 2 Should)

| ID | Short text | BRD priority | Disposition | Reason | Decision ref | Notes |
|---|---|---|---|---|---|---|
| BR-TPL-001 | Authorized users create/edit templates with sections, text, images, tables | Must | Clarified | "Authorized" = Admin, plus a Manager if the Admin grants the right (§9.17 "Optional") | OD-31 | R1 |
| BR-TPL-002 | Placeholders from company, contact, deal, owner, organization fields | Must | Clarified | Placeholder formatting | OD-54 | Same formatting rule as BR-CRM-007. R1 |
| BR-TPL-003 | Sections locked or editable by salespeople | Must | Unchanged | — | — | R1 |
| BR-TPL-004 | Template versions; record which version each proposal used | Must | Clarified | Effect of template changes on existing proposals | OD-54 | Analysis WA: a proposal pins the template version at creation, and template changes never alter existing proposals. R1 |
| BR-TPL-005 | Reusable content block library | Should | Unchanged | — | — | Block model ready from R1 (ADR-010); library UI in R3 |
| BR-TPL-006 | Branding applied to templates and buyer view | Must | Unchanged | — | — | R1 |
| BR-TPL-007 | Starter templates for priority industries | Should | Modified | No industry packs internally | IDD-11 | Company starter template(s) supplied at go-live as configuration content |
| BR-TPL-008 | Flag missing placeholder values before generation | Must | Clarified | Archived custom fields | OD-54 | Templates that reference archived fields are flagged as well. R1 |

#### PRC — Product catalog and pricing tables (5 Must / 2 Should)

| ID | Short text | BRD priority | Disposition | Reason | Decision ref | Notes |
|---|---|---|---|---|---|---|
| BR-PRC-001 | Catalog: name, description, unit, unit price, tax category | Must | Unchanged | — | — | The tax-rate model behind "tax category" is not specified (proposed OD-49). R1 |
| BR-PRC-002 | Pricing tables: lines, qty, unit price, line/overall discounts, taxes, subtotals, totals | Must | Clarified | Recurring billing structure | OD-44 | R1 |
| BR-PRC-003 | Separate one-time and recurring items with separate totals | Must | Clarified | Recurring periods and term | OD-44 | Recurring lines are monthly/quarterly/annual; the proposal has `termMonths`. R1 |
| BR-PRC-004 | Prompt to update deal amount when proposal total differs | Must | Clarified | Which total | OD-16 | Deal amount = TCV excluding tax. R1 |
| BR-PRC-005 | Default currency per organization | Must | Unchanged | Single organization | IDD-01 | Stored in `organization_settings`. R1 |
| BR-PRC-006 | Non-default currency for deals and proposals | Should | Clarified | FX for reporting | OD-15 | A proposal uses its deal's currency. Reports convert using the Admin rate table. Default R3; the schema holds currency from R1 |
| BR-PRC-007 | Warn when discount exceeds role limit | Should | Clarified | Limit model | OD-39 | Max % per role (per line and overall); warning recorded; approvals Phase 2. R3 |

#### PRP — Proposal generation (8 Must / 2 Should)

| ID | Short text | BRD priority | Disposition | Reason | Decision ref | Notes |
|---|---|---|---|---|---|---|
| BR-PRP-001 | Create proposal from deal by selecting template | Must | Clarified | Several proposals per deal | OD-23 | Allowed as alternatives. R1 |
| BR-PRP-002 | Auto-populate with CRM data and pricing | Must | Unchanged | — | — | R1 |
| BR-PRP-003 | Edit sections marked editable | Must | Unchanged | — | — | Editing a sent proposal creates a new draft version (see BR-PRP-006). R1 |
| BR-PRP-004 | Preview exactly as the buyer sees it | Must | Clarified | Previews must not distort tracking | — (ADR-013) | Internal previews never create tracking events. One renderer for preview, buyer view and PDF (ADR-010). R1 |
| BR-PRP-005 | PDF and DOCX with the same content | Must | Clarified | Meaning of "same content" | OD-43 | Same content and order; DOCX is editable and not pixel-identical. R1 |
| BR-PRP-006 | Keep every sent version; compare versions | Must | Clarified | Version states; effect of a new version | OD-20, OD-21, OD-54 | A sent version is immutable. Editing creates a new draft version. The previous version becomes superseded. R1 |
| BR-PRP-007 | Statuses Draft, Sent, Viewed, Signed, Declined, Expired, Void | Must | Clarified | Gaps: accept, partial signing, status level, Void vs Voided | OD-17, OD-18, OD-19, OD-20 | Adds status **Accepted**, labelled as an extension of BR-PRP-007 (WA OD-17). INC-02, INC-07, INC-08, INC-14. Re-send rules after Declined/Expired/Void are analysis WAs (OD-54). R1 |
| BR-PRP-008 | Proposal linked to deal, company and contacts | Must | Unchanged | — | — | R1 |
| BR-PRP-009 | Validity/expiry date on a proposal | Should | Clarified | Three expiry clocks; Must status "Expired" depends on this | OD-22, OD-40 | Ships with PRP-007 in R1 |
| BR-PRP-010 | Copy proposal to another deal | Should | Unchanged | — | — | Also how a Void proposal is "revived" (OD-54). R3 |

#### AIA — AI assistance (7 Must / 2 Should)

| ID | Short text | BRD priority | Disposition | Reason | Decision ref | Notes |
|---|---|---|---|---|---|---|
| BR-AIA-001 | AI drafts intro, needs summary, scope summary from deal, notes, emails, template | Must | Clarified | Context limits and provider | IDD-07, OD-05, OD-30 | Context is limited to records the user can see, with private emails excluded. Inbound email is treated as untrusted (prompt-injection guard). R2 |
| BR-AIA-002 | AI pre-send check (names, figures, placeholders, sections, dates) | Must | Clarified | Implementation approach | OD-05 | Deterministic checks + an LLM consistency check returning structured findings (ADR-014). R2 |
| BR-AIA-003 | AI summary of deal email thread and history | Must | Clarified | Exclusions | IDD-07, OD-30 | R2 |
| BR-AIA-004 | AI rewrite of selected text | Should | Unchanged | — | — | R3 |
| BR-AIA-005 | AI follow-up email draft after proposal sent | Should | Unchanged | — | — | R3. Needed for the AI part of §11 step 10 |
| BR-AIA-006 | AI never sends externally without explicit user action | Must | Unchanged | — | — | R2 |
| BR-AIA-007 | AI content marked until accepted; AI usage logged | Must | Unchanged | — | — | `ai_generation`, `ai_usage`. R2 |
| BR-AIA-008 | Admins turn AI on/off for their organization | Must | Modified | Single organization | IDD-08 | One organization-level switch + per-feature switches. R2 |
| BR-AIA-009 | No training on customer data; keep each organization's data separate | Must | Modified | No other organizations exist | IDD-07, OD-05 | Means no training on our data + AI context limited to what the requesting user may see. Zero-data-retention to be confirmed (OD-05). R2 |

#### SHR — Sharing and tracking (8 Must / 2 Should)

| ID | Short text | BRD priority | Disposition | Reason | Decision ref | Notes |
|---|---|---|---|---|---|---|
| BR-SHR-001 | Unique secure link per proposal version | Must | Clarified | Per-recipient tracking | — (ADR-013) | One link per intended recipient per sent version. Token hash stored. R1 |
| BR-SHR-002 | Send link through own mailbox, from CRM or inbox add-in | Must | Clarified | What counts as "sent"; staged delivery | OD-06, OD-07, OD-54 | Analysis WA: "sent" = shared through CRM/add-in email, OR the user marks "link shared manually". R1 manual share, R2 mailbox send, R3 add-in |
| BR-SHR-003 | Specify intended recipients | Must | Unchanged | — | — | Recipients must be contacts on the deal (analysis WA, OD-54). R1 |
| BR-SHR-004 | Record each view (who, when, how long) and download | Must | Unchanged | — | — | Recorded server-side. R1 |
| BR-SHR-005 | Forwarding; new viewers identify (name+email) and become stakeholders | Must | Clarified | Matching, rights and privacy of forwarded viewers | OD-26, OD-27 | Identity gate with privacy notice. Role "Forwarded viewer". Can view and download, but not accept or sign. R1 |
| BR-SHR-006 | Require email verification before viewing | Should | Unchanged | — | — | R3 |
| BR-SHR-007 | Revoke links; set link expiry | Must | Clarified | Interaction with other expiry clocks | OD-22 | R1 |
| BR-SHR-008 | View proposal access history | Must | Clarified | "Authorized" not defined | OD-31 | Anyone who can view the deal. R1 |
| BR-SHR-009 | Branded, mobile-friendly buyer view | Must | Unchanged | — | — | NFR-011, NFR-012. R1 |
| BR-SHR-010 | Buyer accept/decline (with reason) when no signature required | Should | Clarified | Must statuses depend on it; meaning of "accept" | OD-17, OD-40 | Accept → status Accepted + task "Confirm Closed Won"; no auto-close. Ships in R1 |

#### NTF — Notifications (2 Must / 1 Should / 1 Could)

| ID | Short text | BRD priority | Disposition | Reason | Decision ref | Notes |
|---|---|---|---|---|---|---|
| BR-NTF-001 | Real-time in-app + email to deal owner on first open, reopen, forward, download, signed, declined, link expiring | Must | Clarified | Event list completed; recipient after reassignment | OD-17, OD-54 | Adds proposal_accepted plus derived signer_signed and signature_request_expired. Goes to the current owner. Email channel via OD-14. R1; signing events from R2 |
| BR-NTF-002 | Users configure which notifications and how | Must | Unchanged | — | — | R1 |
| BR-NTF-003 | Daily summary of activity | Should | Unchanged | — | — | R3 |
| BR-NTF-004 | Browser push notifications | Could | Deferred | WA: push deferred | OD-47 | In-app (SSE) + email only |

#### SIG — E-signature (11 Must / 2 Should)

| ID | Short text | BRD priority | Disposition | Reason | Decision ref | Notes |
|---|---|---|---|---|---|---|
| BR-SIG-001 | Request signatures on a specific proposal version | Must | Clarified | Version attachment; superseded versions | OD-20, OD-21 | Signing a superseded version is impossible. R2 |
| BR-SIG-002 | Multiple signers; sequential or parallel order | Must | Clarified | Concurrency and signer eligibility | OD-23, OD-54 | Only one open signature request per deal. Signers must be contacts on the deal (analysis WA). R2 |
| BR-SIG-003 | Legally valid (ESIGN/UETA, eIDAS SES); build vs partner open | Must | Clarified | Jurisdiction and approach | OD-01, OD-02, OD-03 | WA: integrate a partner behind `ESignatureProvider`; SES evidence; Legal confirms. R2 |
| BR-SIG-004 | Signer identity verified by email at minimum | Must | Unchanged | — | OD-03 | Provided by the e-sign provider. R2 |
| BR-SIG-005 | SMS code verification | Should | Clarified | Provider capability | OD-03 | Provider selection criterion. Default R3; PRD §7.4 pull-forward to R2 if the provider supports it out of the box |
| BR-SIG-006 | Capture consent to sign electronically | Must | Clarified | Wording, withdrawal, paper copy | OD-42 | Provider ERSD with our wording, approved by Legal. R2 |
| BR-SIG-007 | Statuses Pending, Sent, Viewed, Signed, Declined, Expired, Voided | Must | Clarified | Void vs Voided; partial signing | OD-18, OD-19 | INC-02. Per-signer status adds the derived badge "Signing in progress (x of n)". R2 |
| BR-SIG-008 | Automatic reminders on configurable schedule; manual resend | Must | Unchanged | — | OD-03 | Provider reminders. R2 |
| BR-SIG-009 | Completion certificate (names, emails, timestamps, IPs, events, fingerprint) | Must | Clarified | Who produces it | OD-02, OD-03 | Produced by the provider and stored by us. R2 |
| BR-SIG-010 | Signed PDF tamper-evident, stored securely, sent to all parties | Must | Clarified | Who seals and stores it; "all parties" not defined | OD-02, OD-11, OD-54 | Provider-sealed PDF stored in our object storage with SHA-256. Who counts as "all parties" goes to OD-54. R2 |
| BR-SIG-011 | Signed document locked to exact version; change needs new version and signatures | Must | Clarified | Effect of new versions | OD-21 | R2 |
| BR-SIG-012 | Signers decline with reason | Should | Clarified | Must statuses depend on it; multi-signer effect | OD-25, OD-40 | Any one decline → request Declined → proposal Declined → AUT-003 task. Ships with SIG in R2 |
| BR-SIG-013 | Cancel (void) a pending signature request | Must | Clarified | Effect on the proposal | OD-18 | Voiding a request does not void the proposal. A manual Closed Lost prompts a void (OD-54). R2 |

#### AUT — Automation (6 Must / 1 Should / 1 Could)

| ID | Short text | BRD priority | Disposition | Reason | Decision ref | Notes |
|---|---|---|---|---|---|---|
| BR-AUT-001 | Proposal sent → deal moves to configured stage if earlier | Must | Clarified | Definition of "sent" | OD-54 | Same definition as BR-SHR-002. R1 |
| BR-AUT-002 | All signers signed → Closed Won, amount from proposal, close date = signing date | Must | Clarified | Which amount; sibling proposals; reversal; idempotency | OD-16, OD-23, OD-24 | Amount = TCV excl. tax. Other open proposals are set Void (automated, reversible). Idempotency key = signatureRequestId. Built R1 (§12 R1); first fires when SIG is live in R2 |
| BR-AUT-003 | Proposal declined → task for owner; no auto-close | Must | Clarified | Declined comes from Should items | OD-25, OD-40 | Buyer decline (SHR-010) in R1; signer decline (SIG-012) in R2. R1 |
| BR-AUT-004 | Follow-up task N days after sending if not viewed or answered | Must | Clarified | Definition of "answered" | OD-54 | Analysis WA: accepted, declined, signed, or an inbound email from a recipient on the deal. R1 |
| BR-AUT-005 | Flag deals with no activity for N days per stage | Must | Clarified | Definition of "activity" | OD-35 | Excludes automated system events. R1 |
| BR-AUT-006 | Flag deals past expected close date | Should | Clarified | Must items depend on it | OD-40 | INC-06. R1 |
| BR-AUT-007 | Admin-configurable simple rules (trigger, condition, action) | Could | Unchanged | — | — | INC-04. Built-in rules are implemented in code with parameters in `automation_setting` (ADR-024); a configurable rule table would be added only for BR-AUT-007 (ADR-024). Not scheduled; R3 candidate |
| BR-AUT-008 | Automated changes labelled on timeline; users can reverse | Must | Clarified | What reversal restores | OD-24 | Restores stage, amount and close date from the execution snapshot. A Signed proposal stays Signed. R1 (Closed Won reversal from R2) |

#### RPT — Reporting and dashboards (7 Must / 3 Should)

| ID | Short text | BRD priority | Disposition | Reason | Decision ref | Notes |
|---|---|---|---|---|---|---|
| BR-RPT-001 | Pipeline dashboard: count and value by stage, owner, pipeline | Must | Clarified | Values in mixed currencies | OD-15 | Converted to the org default currency. R1 |
| BR-RPT-002 | Won/lost: count, value, win rate, lost reasons | Must | Clarified | Metric definitions | OD-35 | R1 |
| BR-RPT-003 | Rep performance: deals owned, won revenue, win rate, avg size, avg cycle | Must | Clarified | Metric definitions | OD-35 | R1 |
| BR-RPT-004 | Proposal metrics: creation→first proposal, sent, view rate, time to first view, time to sign, proposal win rate | Must | Clarified | Metric definitions; Accepted | OD-35, OD-17 | Time to sign is available from R2. R1 |
| BR-RPT-005 | "Deals needing attention": stalled, overdue, unviewed-proposal | Must | Clarified | Overdue depends on AUT-006 | OD-40 | R1 |
| BR-RPT-006 | Weighted pipeline using stage probabilities | Should | Clarified | Sole consumer of Must BR-CRM-005 probabilities | OD-40 | INC-09. R1 |
| BR-RPT-007 | Filter by date range, team, owner, pipeline | Must | Unchanged | — | OD-35 (date basis) | Fiscal-year presets from BR-PLT-012. R1 |
| BR-RPT-008 | Dashboards respect permissions | Must | Clarified | Scope per role | OD-31 | Admin: org. Manager: own team (incl. own records). Salesperson: own performance. R1 |
| BR-RPT-009 | Export report data to CSV | Should | Unchanged | — | — | R3 |
| BR-RPT-010 | Activity reporting: emails, meetings, completed tasks per rep | Should | Clarified | Private emails | OD-30 | Private email metadata is counted. R3 |

#### TIM — Timelines (4 Must)

| ID | Short text | BRD priority | Disposition | Reason | Decision ref | Notes |
|---|---|---|---|---|---|---|
| BR-TIM-001 | Single chronological deal timeline of all event types | Must | Unchanged | — | — | Written in the originating transaction (ADR-022). Email/meeting entries from R2, signing entries from R2. R1 |
| BR-TIM-002 | Filter timeline by event type | Must | Unchanged | — | — | R1 |
| BR-TIM-003 | Company and contact timelines combine related events | Must | Unchanged | — | — | R1 |
| BR-TIM-004 | Each event shows actor (user, buyer, system, AI) and time | Must | Unchanged | — | — | Actor types: user, buyer, system, ai. R1 |

### 7.2 Non-functional requirements (15)

| ID | Short text | BRD priority | Disposition | Reason | Decision ref | Notes |
|---|---|---|---|---|---|---|
| NFR-001 | Encryption in transit/at rest; complete separation of each organization's data; RBAC; MFA available | (NFR) | Modified | The separation part is met by a dedicated deployment | IDD-01, OD-13 | Encryption, RBAC and MFA retained. OAuth tokens encrypted with AES-256-GCM (ADR-012) |
| NFR-002 | GDPR compliance; DPA available to customers; user control of synced email; deletion requests honored | (NFR) | Modified | We are data controller, not processor | IDD-09, OD-36, OD-30 | Customer DPA dropped. Replaced by vendor DPAs, records of processing and a DPIA (compliance tasks). Erasure per OD-36 |
| NFR-003 | No training on customer data; human approval before external send; AI labelled and logged; AI provider DPA | (NFR) | Clarified | Provider terms | IDD-07, OD-05 | Confirm zero data retention |
| NFR-004 | E-signature process, consent and evidence meet target-market law; tamper-evident | (NFR) | Clarified | Jurisdictions and approach open | OD-01, OD-02, OD-42 | — |
| NFR-005 | Proposed: screens < 2 s p95; generation < 10 s; notifications < 1 min | (NFR) | Clarified | Targets kept as proposed | OD-45 | Notification design target < 5 s (ADR-009) |
| NFR-006 | Proposed: 99.5% monthly uptime (app and buyer links) | (NFR) | Clarified | Kept; depends on hosting | OD-45, OD-11 | — |
| NFR-007 | Proposed: 100 organizations × 50 users without redesign | (NFR) | Modified | Not applicable to a single tenant | IDD-06, OD-45 | WA sizing: ≤150 users, ≤200k contacts, ≤100k companies, ≤100k deals, ≤5M emails, ≤20k proposals/year |
| NFR-008 | Proposed: daily backups; RPO 24 h; RTO 8 h | (NFR) | Clarified | Kept; PITR recommended | OD-45, OD-11 | — |
| NFR-009 | Audit log of key user, admin, system, AI actions | (NFR) | Clarified | Access and retention | OD-36 | Admin-only access |
| NFR-010 | New salesperson sends first proposal without training; admin onboarding < 1 day | (NFR) | Clarified | "Onboarding" = internal setup checklist | IDD-04 | — |
| NFR-011 | WCAG 2.1 AA for app and buyer views | (NFR) | Unchanged | — | — | Add-in surfaces included |
| NFR-012 | Current Chrome/Edge/Safari/Firefox; responsive; PDF/DOCX open correctly | (NFR) | Clarified | DOCX parity | OD-43 | Also the Outlook/Gmail add-in hosts (OD-07) |
| NFR-013 | Email via users' mailboxes; system notifications from authenticated domains | (NFR) | Clarified | Transactional provider | OD-14 | SPF/DKIM/DMARC on a company subdomain |
| NFR-014 | Modular design for Phase 2/3 | (NFR) | Clarified | Extension points only | IDD-13, OD-41 | Domain events, provider adapters, rule table, block-based proposals |
| NFR-015 | Admin-configurable retention within platform limits | (NFR) | Clarified | Limits "to be defined" | OD-36 | Exemptions: signed docs, certificates, audit log |

### 7.3 Acceptance criteria (18)

| ID | Short text | BRD priority | Disposition | Reason | Decision ref | Notes |
|---|---|---|---|---|---|---|
| AC-01 | New organization signs up, starts trial, invites users, assigns roles/teams | Functional | Modified | No sign-up or trial | IDD-02 | Becomes: bootstrapped Admin invites users and assigns roles and teams |
| AC-02 | Import from CSV, HubSpot or Pipedrive exports with duplicates and undo | Functional | Clarified | HubSpot/Pipedrive only if used | OD-09 | INC-15 |
| AC-03 | Manage companies, contacts, deals, tasks, notes, custom fields, configurable pipelines | Functional | Unchanged | — | — | — |
| AC-04 | Gmail and Outlook emails and meetings link automatically | Functional | Clarified | Company's provider first | OD-06 | INC-05. The second provider is accepted when it is delivered |
| AC-05 | Proposal created and sent from Gmail or Outlook inbox | Functional | Clarified | Add-in for the company's provider, after email sync | OD-07 | R3. INC-16 |
| AC-06 | Website form submissions create assigned records and notify owner | Functional | Unchanged | — | — | R1 (§12 R1) |
| AC-07 | Proposal from deal with CRM data, custom fields, pricing table; preview; PDF and DOCX | Functional | Unchanged | — | OD-43 | — |
| AC-08 | AI drafts sections, flags errors; nothing sent without user action | Functional | Unchanged | — | — | R2 |
| AC-09 | Views, forwards, downloads recorded; owner alerted in real time | Functional | Unchanged | — | — | R1 |
| AC-10 | Multiple signers in order with reminders; signed PDF and certificate meet target-market law | Functional | Clarified | Target markets open | OD-01 | R2 |
| AC-11 | Sending and signing update stage; signing → Closed Won with amount and date | Functional | Clarified | Which amount | OD-16 | R2 |
| AC-12 | Dashboards within each user's permissions | Functional | Unchanged | — | — | R1 |
| AC-13 | Deal timeline shows all event types in order | Functional | Unchanged | — | — | Complete at R2 |
| AC-14 | Billing, audit log and full data export work for each organization | Functional | Modified | Billing out; single organization | IDD-03, IDD-01 | Becomes: audit log and full data export work for the deployment |
| AC-15 | Design partner runs live deals for ≥ 30 days | Business | Modified | Design partner → our sales team | IDD-14, OD-10 | Window start depends on go-live (proposed OD-48) |
| AC-16 | ≥ 80% of client's salespeople active weekly by week 4 | Business | Modified | Internal rollout acceptance | IDD-14, OD-10 | Denominator = active internal salesperson users |
| AC-17 | Time to proposal and time to sign improve vs baseline per §12 | Business | Modified | Internal baselines | IDD-14, OD-10 | Baselines TBD |
| AC-18 | Client confirms in writing they will replace previous tools | Business | Modified | Becomes an internal decision to retire the previous tools | IDD-14, OD-10 | Sign-off by the internal sponsor |

### 7.4 §8.2 Out of Phase 1 (planned for later phases)

Row labels §8.2-01..12 are introduced here for traceability. They are not BRD IDs.

| ID | Capability (BRD) | BRD phase | Disposition | Reason | Decision ref | Notes (Phase 1 extension point) |
|---|---|---|---|---|---|---|
| §8.2-01 | Call recording, transcription and AI field extraction | 2 | Deferred | Not Phase 1 | IDD-13, OD-41 | Calendar events, timeline, `AiProvider` |
| §8.2-02 | Engagement-based AI follow-up agents, stakeholder detection | 2 | Deferred | Not Phase 1 | IDD-13 | Tracking events, domain events |
| §8.2-03 | Tiered options, optional add-ons, buyer-configurable proposals | 2 | Deferred | Not Phase 1 | IDD-13 | Block-based proposal model, pricing table |
| §8.2-04 | Discount and terms approval workflows | 2 | Deferred | Not Phase 1 | IDD-13, OD-39 | Discount warnings recorded on the proposal |
| §8.2-05 | Deal risk scoring, AI forecasting, weekly AI pipeline brief | 2 | Deferred | Not Phase 1 | IDD-13 | Stage probabilities, activity data |
| §8.2-06 | Section-level proposal analytics, win/loss analysis | 2 | Deferred | Not Phase 1 | IDD-13 | View sessions, lost reasons |
| §8.2-07 | Slack and Teams integration, buyer comments | 2 | Deferred | Not Phase 1 | IDD-13 | Notification channel abstraction |
| §8.2-08 | AI lead research and scoring, outbound drafting, email sequences | 3 | Deferred | Not Phase 1 | IDD-13 | Lead forms, mail adapter |
| §8.2-09 | Autonomous agents with configurable permissions | 3 | Deferred | Not Phase 1 | IDD-13 | Policy module, rule table |
| §8.2-10 | Delivery handoff, invoicing (QuickBooks, Xero), project tools, renewals | 3 | Deferred | Not Phase 1 | IDD-13 | Signed proposals, recurring lines (OD-44) |
| §8.2-11 | Customer portal, procurement workflows | 3 | Deferred | Not Phase 1 | IDD-13 | Buyer app, share tokens |
| §8.2-12 | Open API, integration marketplace, single sign-on, data residency | 3 | Deferred | Not Phase 1. Google/Microsoft OAuth login is **not** part of this (INC-12) | IDD-13, OD-12 | Versioned REST API `/api/v1`, OpenAPI |

### 7.5 §8.3 Not planned in any phase

| ID | Item (BRD) | Disposition | Reason | Decision ref | Notes |
|---|---|---|---|---|---|
| §8.3-01 | Full marketing automation (campaigns, landing pages, nurture) | Out of scope | BRD: never planned | — | — |
| §8.3-02 | Payment collection inside the product | Out of scope | BRD: never planned | IDD-03 | Consistent with no billing |
| §8.3-03 | Native mobile apps | Out of scope | BRD: never planned | — | Mobile-friendly web app is in Phase 1 (NFR-012); "to be revisited later" |
| §8.3-04 | Phone dialer | Out of scope | BRD: never planned | — | Calls are logged manually (BR-CRM-010) |

### 7.6 §13 Assumptions, constraints, dependencies and risks

| ID | BRD text (short) | Disposition | Reason | Decision ref | Notes / internal restatement |
|---|---|---|---|---|---|
| §13.1-A1 | Current client is design partner and first paying customer | Modified | The user is our own sales team | IDD-14, IDD-15 | The internal sales leadership sponsor takes the design-partner role |
| §13.1-A2 | Target customers match the ICP (§5) | Modified | ICP is reference context only | IDD-05 | Describes our own sales motion |
| §13.1-A3 | English first; target markets to be confirmed | Clarified | Jurisdictions = our entity and our signers | OD-01 | English-only UI assumed |
| §13.1-A4 | Paid third-party services permitted (AI, e-sign, payment, email) | Modified | Payment processing not needed | IDD-03, OD-02, OD-05, OD-14 | AI, e-sign and email services retained |
| §13.1-A5 | Web app; mobile-friendly web meets mobile needs | Unchanged | — | — | — |
| §13.1-A6 | Customers use Gmail or Microsoft 365 | Clarified | Applies to our company's provider | OD-06 | — |
| §13.2-C1 | Sold and used on real customer data, so security, privacy and compliance are launch requirements | Modified | Not sold. Real data still used | IDD-10 | Security, privacy and compliance remain launch requirements |
| §13.2-C2 | AI keeps a human in control of external sends | Unchanged | — | — | BR-AIA-006 |
| §13.2-C3 | Cut breadth (Should/Could), never import, email sync, legally valid signing | Unchanged | — | OD-08, OD-40 | Guides the release plan. Dependency-driven Shoulds are exempt (OD-40) |
| §13.3-D1 | Google/Microsoft API access incl. app verification and Gmail security assessment | Modified | An internal OAuth app may avoid public verification | OD-06 | Verify with IT. Entra app registration / Workspace add-on deployment |
| §13.3-D2 | AI model provider with acceptable data terms | Clarified | — | OD-05 | — |
| §13.3-D3 | E-signature approach: build or partner | Clarified | — | OD-02, OD-03 | — |
| §13.3-D4 | Payment and subscription billing provider | Out of scope | No billing | IDD-03 | — |
| §13.3-D5 | Email delivery service for system notifications | Clarified | — | OD-14 | — |
| §13.3-D6 | OpenCRM can support many organizations, permissions, integrations | Clarified | Multi-org no longer needed; finding: not adopted | OD-04 | Used as UI reference only |
| §13.4-R1 | Scope too large → late launch | Modified | Mitigation becomes a release plan + internal sponsor confirmation | OD-08, IDD-14 | See PRD §7 |
| §13.4-R2 | Email API approval delays | Modified | Internal OAuth app lowers the risk | OD-06 | — |
| §13.4-R3 | In-house e-signature complex | Clarified | Partner integration WA | OD-02 | Risk mostly retired if OD-02 is confirmed |
| §13.4-R4 | AI output errors → loss of buyer trust | Unchanged | — | — | Human review, pre-send checks, labelling |
| §13.4-R5 | AI costs grow faster than revenue | Modified | No revenue; becomes an internal budget control | IDD-10 | Usage limits and monitoring retained (proposed OD-53) |
| §13.4-R6 | Poor-quality imported data | Unchanged | — | OD-27 | Validation, duplicates, undo |
| §13.4-R7 | OpenCRM unsuitable → rework | Clarified | Not adopted as a code foundation | OD-04 | Risk retired if OD-04 is confirmed |
| §13.4-R8 | Strong competitors (HubSpot, Pipedrive + PandaDoc) | Out of scope | No market positioning | IDD-10 | — |
| §13.4-R9 | Privacy concerns about email syncing → customers refuse | Modified | The concern is now employees and their contacts | OD-30, OD-29 | Employee privacy notice is a compliance task (proposed OD-52) |

### 7.7 Open questions (OQ-1..OQ-10)

| ID | BRD question (short) | BRD owner | Disposition | Reason | Decision ref | Notes |
|---|---|---|---|---|---|---|
| OQ-1 | Which markets will we launch in? | Leadership | Clarified | Reframed as the jurisdictions of our entity and our signers | OD-01 | — |
| OQ-2 | Build e-signature or partner? | Product + Technical Lead | Clarified | — | OD-02 | — |
| OQ-3 | Is OpenCRM suitable for many customer organizations? | Technical Lead | Clarified | Multi-org part no longer applies | OD-04 | — |
| OQ-4 | Which AI provider and data terms? | Technical Lead | Clarified | — | OD-05 | — |
| OQ-5 | Gmail first, Outlook first or both? | Product | Clarified | — | OD-06 | — |
| OQ-6 | Pricing and packaging model? | Leadership | Out of scope | No billing or packaging | IDD-03, IDD-10 | — |
| OQ-7 | Launch date and team capacity? | Leadership | Clarified | — | OD-08 | Plus proposed OD-48 |
| OQ-8 | Which design-partner tools to import from or replace? | Product with client | Clarified | Becomes our own current tools | OD-09 | Plus proposed OD-50 |
| OQ-9 | Design partner's baseline metrics? | Product with client | Clarified | Becomes internal baselines | OD-10, IDD-14 | — |
| OQ-10 | Should the inbox add-in stay Must at launch? | Product | Clarified | — | OD-07 | — |

### 7.8 Other BRD content

| ID | BRD item | Disposition | Reason | Decision ref | Notes |
|---|---|---|---|---|---|
| §1-01 | Product type "Commercial software product for many customer companies" | Modified | Single-tenant internal product | IDD-01 | — |
| §1-02 | CRM foundation clawnify/OpenCRM | Clarified | Not adopted as code foundation | OD-04 | UI reference only |
| §1-03 | Reviewer "Client sponsor (design partner)" | Modified | Reassigned to the internal sales leadership sponsor | IDD-15 | — |
| §1-04 | Reviewers Product Owner, Technical Lead, Leadership | Unchanged | — | — | — |
| §2-01 | Phase model (Core / Win more / Grow) and the 5–25 person team framing | Clarified | Phases kept as future internal phases | OD-41, IDD-13 | — |
| §2-02 | Phase 1 collects data for Phase 2 AI | Unchanged | — | NFR-014 | Data captured from R1/R2 |
| §3.1/§3.2 | Gaps of v1.0 and key changes table | Clarified | Commercial items (product type, switching for customers) are restated internally | IDD-01, IDD-10 | Integration/AI/e-sign/pricing/tracking/automation/import rows unchanged in substance |
| §4-01 | Vision; revenue levers formula | Clarified | Kept as rationale; "why customers upgrade" not applicable | IDD-10 | — |
| §5.1 | ICP profile | Modified | Reference context only | IDD-05 | Informs sizing (OD-45) and pricing scale |
| §5.2 | Priority industries | Modified | Reference only; drives BR-TPL-007 reinterpretation | IDD-05, IDD-11 | — |
| §5.3 | Not the ICP (disqualifiers) | Modified | Reference only | IDD-05 | The "advanced or qualified e-signatures" disqualifier is consistent with the SES WA (OD-01) |
| §6-01 | Persona Salesperson | Unchanged | — | IDD-16 | — |
| §6-02 | Persona Sales Manager | Unchanged | — | IDD-16 | — |
| §6-03 | Persona Admin / Sales Ops | Unchanged | — | IDD-16 | — |
| §6-04 | Persona Economic buyer | Modified | Maps to the internal leadership sponsor | IDD-05 | — |
| §6-05 | Persona Recipient / Signer (external) | Unchanged | — | IDD-16 | Forwarded viewer is a sub-type (OD-26) |
| §7 P1–P9 | Problems to solve (9 rows) | Unchanged | All apply internally | — | Mapping in PRD §1.3. P9 "switching" = our own migration |
| §7 note | Handoff to delivery deferred to Phase 3 | Unchanged | — | IDD-13 | — |
| §8.1-01 | Platform: many companies, sign-up, roles and teams, billing, onboarding, audit log, export | Modified | Multi-org, sign-up and billing removed | IDD-01, IDD-02, IDD-03, IDD-04 | Roles, teams, audit log and export retained |
| §8.1-02 | Import from CSV/Excel, HubSpot, Pipedrive | Clarified | — | OD-09 | — |
| §8.1-03 | CRM essentials | Unchanged | — | — | — |
| §8.1-04 | Email and calendar incl. inbox add-in | Clarified | — | OD-06, OD-07 | — |
| §8.1-05 | Lead capture | Unchanged | — | — | — |
| §8.1-06 | Proposals | Unchanged | — | — | — |
| §8.1-07 | AI assist | Clarified | — | OD-05, IDD-07 | — |
| §8.1-08 | Sharing and tracking with forwarded viewers | Clarified | — | OD-26 | — |
| §8.1-09 | Real-time notifications | Unchanged | — | — | — |
| §8.1-10 | Legally valid e-signature | Clarified | — | OD-01, OD-02 | — |
| §8.1-11 | Rules-based automation | Clarified | Delivered as built-in rules | — | INC-04 |
| §8.1-12 | Reporting and dashboards | Unchanged | — | — | — |
| §8.1-13 | Deal, company and contact timelines | Unchanged | — | — | — |
| §9 key | Priority definitions Must/Should/Could | Unchanged | Labels never changed | OD-40 | INC-16 |
| §9.17-01 | Manage users, teams, billing, organization settings: Admin | Modified | Billing removed | IDD-03 | — |
| §9.17-02 | Configure pipelines, custom fields, automation, lead forms: Admin | Unchanged | — | — | — |
| §9.17-03 | Import data, export all data: Admin | Unchanged | — | — | — |
| §9.17-04 | Templates, content library, catalog: Admin; Manager "Optional (set by Admin)" | Clarified | Admin-granted flag per manager | OD-31 | — |
| §9.17-05 | View/edit records: All / Own team / Own + view-only if allowed | Clarified | View-only setting per object type; view-only = read-only; closed deals editable by owner/manager/admin with reason to reopen | OD-31 | — |
| §9.17-06 | Reassign deals: All / Within team / – | Clarified | Salesperson cannot reassign, incl. bulk | OD-31 | — |
| §9.17-07 | Create/send proposals, request signatures: ✓ / ✓ / Own deals | Unchanged | — | — | — |
| §9.17-08 | Revoke links, void requests: All / Own team / Own deals | Unchanged | — | — | — |
| §9.17-09 | View dashboards: Org / Own team / Own performance | Clarified | Manager's own records included | OD-31 | — |
| §9.17-10 | Turn AI on/off: Admin | Clarified | Org switch + per-feature switches | IDD-08 | — |
| §12-01 | Time to proposal | Unchanged | Baseline TBD | OD-10, OD-35 | PRD §2 |
| §12-02 | Proposal production effort | Unchanged | Baseline TBD; measured by time study | OD-10 | PRD §2 |
| §12-03 | Time to sign | Unchanged | Baseline TBD | OD-10 | PRD §2 |
| §12-04 | Proposal win rate | Clarified | Accepted counted with Signed | OD-35, OD-17 | INC-14 |
| §12-05 | Deals going quiet after proposal (14 days) | Unchanged | — | OD-35 | — |
| §12-06 | Automatic activity capture ≥ 80% | Unchanged | — | — | — |
| §12-07 | Adoption: share of licensed salespeople active weekly | Modified | No licences; active internal salespeople | IDD-14 | — |
| §12-08 | Time to value: sign-up to first proposal | Modified | No sign-up; measured from first sign-in after invite | IDD-02, IDD-14 | — |
| §12-09 | Switching effort for an ICP-sized organization | Modified | Our own import | IDD-14 | — |
| §12-10 | Commercial: trial-to-paid, 90-day retention | Out of scope | No commercial model | IDD-10 | — |
| §15.1 | Phase 2 modules | Deferred | Future internal phase | IDD-13, OD-41 | — |
| §15.2 | Phase 3 modules | Deferred | Future internal phase | IDD-13, OD-41 | — |
| §15.3-01 | Gate Phase 1 → Phase 2 (business AC met; metrics trending; paying organizations) | Modified | "Paying organizations" criterion removed | IDD-10, IDD-14 | — |
| §15.3-02 | Gate Phase 2 → Phase 3 (upgrade rate, AI cost per org within margin, demand) | Modified | Becomes internal adoption + AI budget + business case | IDD-10 | — |
| §15.4 | Packaging options (tiers, add-ons, AI credits, trial) | Out of scope | No packaging | IDD-10 | — |
| §17.1 | Glossary | Clarified | "Organization / workspace" and "Design partner" reinterpreted | IDD-01, IDD-14 | PRD §10 |
| §17.2 | Traceability from v1.0 | Unchanged | — | — | Closing sentence repeats INC-01 |

## 8. Change control

1. When an OD is decided, update its row(s) here: change the disposition if needed, replace the WA note, and record the outcome in the OPEN-DECISIONS.md decision log.
2. A new IDD requires Product Owner + Leadership approval and must list every affected row.
3. The summary counts (§4) are recalculated with each change. The BR total must stay 130.
