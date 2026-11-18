# Functional Requirements Specification — Internal Sales CRM, Phase 1

| Item | Detail |
|---|---|
| Document | FUNCTIONAL-REQUIREMENTS.md |
| Source of requirements | BRD v2.0 "Sales CRM Platform: Phase 1 (Core Platform)", 17 Nov 2026 (Sales_CRM_Phase_1_BRD_v2.0.docx) |
| Binding design foundation | Design Foundation (IDD-01..IDD-16, OD-01..OD-47, ADR-001..ADR-019) |
| Deployment objective | Single-company, single-tenant internal production Sales CRM; roles Admin, Sales Manager, Salesperson; external buyers/signers view, forward, accept/decline and sign proposals |
| Status | Draft for review |
| Related documents | SCOPE-RECONCILIATION.md (IDDs), OPEN-DECISIONS.md (ODs), BUSINESS-RULES.md (RULE-*), WORKFLOWS.md (WF-*), ROLE-PERMISSION-MATRIX.md (PERM-*), ACCEPTANCE-CRITERIA.md (FAC-*), ARCHITECTURE-DECISIONS.md (ADR-*) |

## 0. How to read this document

### 0.1 Structure
1. Section 1 — module overview and the corrected requirement count.
2. Sections 2–16 — one section per BRD module in BRD order (PLT, MIG, CRM, EML, LED, TPL, PRC, PRP, AIA, SHR, NTF, SIG, AUT, RPT, TIM). Each section contains: purpose (with BRD pains P1–P9), primary users, interactions summary, then every `BR-*` requirement in BRD order, then the module's derived requirements (`DR-<MOD>-NN`).
3. Section 17 — non-functional requirements NFR-001..NFR-015 with internal-deployment interpretation and measurable acceptance.
4. Section 18 — index of derived requirements; Section 19 — proposed new open decisions (unnumbered, for OPEN-DECISIONS.md owner to number); Section 20 — traceability check.

### 0.2 Per-requirement layout
Every `BR-*` entry has:
- the BRD text quoted verbatim (blockquote);
- **Priority** exactly as stated in the BRD (labels are never changed, OD-40);
- **Disposition**: `Unchanged` (implemented as written), `Clarified` (implemented as written; ambiguity resolved by an IDD/OD working assumption), `Modified` (implemented in altered form because of the internal objective, IDD-*), `Deferred` (not built in Phase 1; extension point only), `Out of scope` (not built in any phase of this internal product);
- a functional specification: inputs/fields, behaviour, validations, system responses, errors and exceptions (what the user sees), dependencies, and working assumptions (WA) cited by OD number.

### 0.3 Conventions
- BRD IDs, statuses and terms are preserved exactly ("Void" for proposals, "Voided" for signature requests, OD-18).
- "User" = an internal, signed-in person with role `admin`, `sales_manager` or `salesperson`. "Buyer" = any external recipient, forwarded viewer or signer; buyers never have accounts.
- "Visible to the user" means within the user's visibility scope (admin = all; sales_manager = own + records owned by members **and co-managers** of managed teams, with a deactivated member's membership retained as inactive (§12 resolution R7, OD-32); salesperson = own + view-only of others if the Admin setting allows, OD-31). Companies and contacts have an owner; their reassignment mirrors deals (§12 R6). Anyone who can view a deal can view (read-only) the deal's company and deal contacts and, with write scope on the deal, use them as recipients/signers, regardless of their owner (§12 R6; ROLE-PERMISSION-MATRIX §4.4). Child records inherit visibility from their parent deal/company/contact.
- Error messages are given as the text the user sees, followed by a stable problem `code` in backticks (ADR-016, RFC 9457 `application/problem+json`). **Authority (foundation §15):** BUSINESS-RULES.md is authoritative for rules, validations, error codes (its §20 index, UPPER_SNAKE codes), pre-send finding codes/severities and limits. Where this document gives a different code spelling or limit, the BUSINESS-RULES value applies; the dotted codes here are descriptive and are mapped to the §20 codes at API design. Field-level errors are shown inline next to the field; non-field errors as a page-level alert/toast.
- "Derived — pending confirmation" marks a requirement that is not in the BRD and fills a gap a builder must resolve. Each DR names the BR/OD it derives from. Default values inside DRs (e.g. limits, durations) are design parameters, configurable where stated, and must be confirmed by the named owner.
- No implementation code is specified. Field names in `camelCase` are logical names used in API contracts (ADR-016).

### 0.4 Common field validation conventions (apply everywhere unless a requirement states otherwise)

**DR-PLT-10 — Common field validation conventions.** *Derived — pending confirmation (derives from NFR-001, ADR-005, ADR-016; owner Tech Lead).*

| Field kind | Rule |
|---|---|
| Person / record name (company name, deal name, template name, product name) | Required unless stated; trimmed; 1–200 characters; no control characters |
| First name / last name | First name 1–100 chars required for users; for contacts at least one of first name, last name or email is required; last name 0–100 |
| Email address | Trimmed, lower-cased for matching (OD-27); syntactically valid addr-spec; max 254 characters; local part max 64 |
| Phone | Optional; 0–32 chars; digits, spaces, `+ - ( ) .` and `x`/`ext`; stored as entered plus a normalised E.164 value when parseable (no rejection if not parseable) |
| URL / website / domain | Optional; max 2,048 chars; `http`/`https` only; domain derived as lower-cased host without `www.` |
| Short text (single line) | 0–255 chars |
| Long text (notes, descriptions) | 0–50,000 chars (rich text measured as plain text) |
| Integer counts / days | Whole numbers; ranges stated per field |
| Money amount | Decimal, max 2 fraction digits, range 0 – 9,999,999,999,999,999.99 (numeric(18,2)); negative values rejected unless stated |
| Unit price | Max 4 fraction digits (numeric(18,4)), ≥ 0 |
| Quantity | Max 4 fraction digits (numeric(14,4)), > 0 |
| Percentage | 0–100, max 4 fraction digits (numeric(7,4)) |
| Currency | ISO-4217 three-letter code from the enabled list |
| Date | ISO calendar date; displayed in the organization date format; date-only fields have no time zone |
| Date-time | Stored UTC; displayed in the user's time zone (fallback: organization time zone) |
| Concurrency | Every update carries `rowVersion`; a stale version returns "This record was changed by someone else. Reload to see the latest version." `conflict.stale_version` (HTTP 409) |
| Uniqueness messages | "A <thing> with this <field> already exists." `<entity>.duplicate_<field>` |
| Permission failure | "You don't have permission to do this." `auth.forbidden` (HTTP 403); a record outside visibility scope returns "Not found" `resource.not_found` (HTTP 404) so existence is not disclosed |

---

## 1. Module overview and requirement counts

### 1.1 Modules

| Module | BRD section | Pains addressed (BRD §7) | Primary users | Backend module (foundation §7) |
|---|---|---|---|---|
| PLT Platform and accounts | 9.1 | P9 | Admin; all users for sign-in | identity, platform |
| MIG Data import | 9.2 | P9 | Admin | import |
| CRM CRM records | 9.3 | P5, P6 | Salesperson, Sales Manager, Admin | crm |
| EML Email and calendar | 9.4 | P6 | Salesperson, Sales Manager | comms |
| LED Lead capture | 9.5 | P7 | Admin (configure); Salesperson (receive) | leads |
| TPL Templates and content library | 9.6 | P1, P8 | Admin, Sales Manager (if granted) | templates |
| PRC Product catalog and pricing tables | 9.7 | P1 | Admin (catalog); Salesperson (pricing tables) | catalog, proposals |
| PRP Proposal generation | 9.8 | P1, P3 | Salesperson | proposals |
| AIA AI assistance | 9.9 | P1 | Salesperson; Admin (switches) | ai |
| SHR Sharing and tracking | 9.10 | P2 | Salesperson; Buyer | sharing |
| NTF Notifications | 9.11 | P2 | Deal owner (all roles) | notifications |
| SIG E-signature | 9.12 | P3, P4 | Salesperson; Signer | esign |
| AUT Automation | 9.13 | P2, P5, P6 | System; deal owner; Sales Manager | automation |
| RPT Reporting and dashboards | 9.14 | P5 | Sales Manager, Admin, Salesperson | reporting |
| TIM Timelines | 9.15 | P6 | All users | timeline |

NFR-related functional items are not repeated as BR entries; NFR-001..NFR-015 are in Section 17.

### 1.2 Corrected priority count (foundation §2)

The BRD §9.16 table states PRC as 4 Must / 3 Should and totals 100 / 26 / 4. Counting the requirement rows in §9.7 gives PRC = 5 Must (BR-PRC-001..005) and 2 Should (BR-PRC-006..007). Corrected counts (BRD priority labels, unchanged):

| Module | Must | Should | Could | Total | BRD §9.16 said |
|---|---|---|---|---|---|
| PLT | 11 | 1 | 0 | 12 | same |
| MIG | 4 | 2 | 1 | 7 | same |
| CRM | 12 | 2 | 0 | 14 | same |
| EML | 6 | 1 | 0 | 7 | same |
| LED | 4 | 2 | 1 | 7 | same |
| TPL | 6 | 2 | 0 | 8 | same |
| PRC | **5** | **2** | 0 | 7 | 4 / 3 / 0 |
| PRP | 8 | 2 | 0 | 10 | same |
| AIA | 7 | 2 | 0 | 9 | same |
| SHR | 8 | 2 | 0 | 10 | same |
| NTF | 2 | 1 | 1 | 4 | same |
| SIG | 11 | 2 | 0 | 13 | same |
| AUT | 6 | 1 | 1 | 8 | same |
| RPT | 7 | 3 | 0 | 10 | same |
| TIM | 4 | 0 | 0 | 4 | same |
| **Total** | **101** | **25** | **4** | **130** | 100 / 26 / 4 |

### 1.3 Disposition summary (this document)

| Disposition | Count | Requirements |
|---|---|---|
| Out of scope | 1 | BR-PLT-007 (IDD-03) |
| Deferred | 2 | BR-MIG-007 (OD-09), BR-NTF-004 (OD-47) |
| Modified | 6 | BR-PLT-001 (IDD-01), BR-PLT-002 (IDD-02), BR-PLT-008 (IDD-04), BR-TPL-007 (IDD-11), BR-AIA-008 (IDD-08), BR-AIA-009 (IDD-07) |
| Clarified | 79 | Requirements whose behaviour depends on an OD working assumption or derived requirement (listed per entry) |
| Unchanged | 42 | Implemented as written (DRs and design notes may add detail without changing the disposition) |
| **Total** | **130** | |

By priority: Unchanged 30 Must / 10 Should / 2 Could; Clarified 65 Must / 14 Should; Modified 5 Must / 1 Should; Deferred 2 Could; Out of scope 1 Must. SCOPE-RECONCILIATION.md §7.1 is authoritative for dispositions; every per-requirement disposition in this document is identical to it (§12 resolution R2, verified by script).

In-scope Musts after dispositions: 100 of 101 (BR-PLT-007 Out). BR-PLT-001 and BR-PLT-002 are Musts delivered in modified (reduced) form. Should items on which Musts depend (BR-AUT-006, BR-SIG-012, BR-SHR-010, BR-PRP-009, BR-RPT-006) ship in the same release as their dependent Musts (OD-40).

---

## 2. PLT — Platform and accounts (BRD §9.1)

**Purpose.** Provides identity, roles, teams, organization settings, auditability and data export for one internal organization. Addresses P9 (switching is too hard: guided onboarding) and underpins every other module's permission checks (BRD §9.17). Multi-organization tenancy, self sign-up, trials and billing are removed by IDD-01..IDD-03.

**Primary users.** Admin (user, team, settings, audit, export); all users (sign-in, MFA, profile).

**Interactions summary.** Admin is bootstrapped by a one-time command (IDD-02) → Admin configures organization settings, invites users, assigns roles and teams → users accept invitations and sign in with password or company Google/Microsoft account (OD-12), optionally with TOTP MFA (OD-13) → every key action writes an audit entry → Admin can export all data and deactivate users with reassignment. Settings are consumed by TPL (branding), PRC (currency), RPT (fiscal year), NTF/CRM (time zone).

### BR-PLT-001
> "The platform shall support many customer organizations, keeping each organization's data completely separate."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Modified | IDD-01 |

- **Inputs / fields:** None user-facing. One `organization_settings` singleton row per deployment.
- **Behaviour:** The product is deployed once for our company. Separation of data from any other organization is achieved by a dedicated deployment, dedicated database and dedicated object-storage bucket. No tenant/organization identifier exists on business tables. No UI to create a second organization.
- **Validations:** Deployment start-up fails if more than one `organization_settings` row exists (integrity check).
- **System responses:** n/a.
- **Errors / exceptions:** Start-up integrity failure is logged and the readiness endpoint reports not-ready; users see the generic "Service unavailable" page.
- **Dependencies:** NFR-001, NFR-007 (IDD-06), BR-PLT-012.
- **Working assumptions:** OD-11 (hosting). Separation *within* the organization (who sees what) is governed by BR-PLT-005/006 and OD-31, not by this requirement.

### BR-PLT-002
> "A new organization shall be able to sign up, create a workspace, start a trial and invite users."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Modified — sign-up, workspace creation and trial Out; invite retained | IDD-02 |

- **Inputs / fields (invite):** email (required, DR-PLT-10 email rules), first name (required, 1–100), last name (optional, 0–100), role (required: admin, sales_manager, salesperson), team (optional, one team, OD-32), manager-of teams (optional, only for sales_manager), template-rights flag (sales_manager only, BRD §9.17 "Optional").
- **Behaviour:** No public sign-up page. The first Admin is created by DR-PLT-01. An Admin invites a user; the system sends an invitation email (transactional email, OD-14) with a single-use link; the invitee sets a password or signs in with the company Google/Microsoft account whose email matches the invitation; the account becomes active with the invited role and team. Invitations can be resent or revoked while pending (DR-PLT-02).
- **Validations:** Email must not belong to an existing active or deactivated user ("A user with this email already exists." `user.duplicate_email`); when domain restriction is enabled (OD-12) the email domain must be on the allowed list ("This email is outside the company domain." `user.domain_not_allowed`); role/team combination valid (a salesperson cannot be manager-of).
- **System responses:** "Invitation sent to <email>." Invitation listed as Pending with sent date and expiry. On acceptance: user appears as Active; audit entry `user.invited` / `user.activated`.
- **Errors / exceptions:** Expired or revoked link → page "This invitation has expired or was withdrawn. Ask your administrator for a new one." `invitation.invalid`. OAuth account email differs from invitation → "Sign in with <invited email> to accept this invitation." `invitation.email_mismatch`. Email delivery failure → invitation status "Delivery failed" with Resend action.
- **Dependencies:** BR-PLT-003, BR-PLT-005, BR-PLT-006, BR-PLT-009, DR-PLT-01, DR-PLT-02.
- **Working assumptions:** IDD-02; OD-12 (company domain restriction); OD-14 (email service). AC-01 trial part not applicable (IDD-02).

### BR-PLT-003
> "Each user shall have individual credentials, with sign-in by email and password or Google or Microsoft account."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | OD-12; foundation §2 (SSO vs OAuth) |

- **Inputs / fields:** Sign-in: email, password; or "Sign in with Google" / "Sign in with Microsoft". Password set/reset: new password, confirmation.
- **Behaviour:** Each person has exactly one user account; shared accounts are not supported. Google/Microsoft sign-in is restricted to the company Google Workspace domain / Entra tenant configured by the Admin. Admin can disable password sign-in organization-wide (OAuth only). Sessions use secure HTTP-only cookies; the inbox add-in uses a bearer token issued after interactive sign-in (ADR-006). Password reset via emailed single-use link. Enterprise SAML SSO is Phase 3 and not offered.
- **Validations:** Password policy DR-PLT-05 (min 12 chars, max 128, not equal to email, checked against a breached/common password list). Reset link single-use, expires (DR-PLT-05). OAuth identity must map to an invited or existing active user with the same normalised email; otherwise sign-in is refused (no auto-provisioning).
- **System responses:** Successful sign-in → redirect to My Day (BR-CRM-009) or the originally requested page. Audit entries `auth.sign_in`, `auth.sign_in_failed`, `auth.password_reset`.
- **Errors / exceptions:** Wrong credentials → "Email or password is incorrect." `auth.invalid_credentials` (same message whether the email exists or not). Account locked after repeated failures → "Too many attempts. Try again in 15 minutes or reset your password." `auth.locked`. Deactivated user → "Your account is deactivated. Contact your administrator." `auth.user_deactivated`. Password sign-in disabled → password form hidden; direct API attempt returns `auth.method_disabled`. OAuth account outside company domain/tenant → "Use your company account to sign in." `auth.domain_not_allowed`.
- **Dependencies:** BR-PLT-002, BR-PLT-004, BR-PLT-011, DR-PLT-05, DR-PLT-08.
- **Working assumptions:** OD-12.

### BR-PLT-004
> "The platform shall support multi-factor authentication, which admins can require."

| Priority | Disposition | Basis |
|---|---|---|
| Should | Clarified (delivered at launch) | OD-13; NFR-001 "multi-factor authentication available" |

- **Inputs / fields:** Enrolment: TOTP secret via QR code, 6-digit verification code; 10 single-use recovery codes shown once. Admin settings: "Require MFA for" = none | admins | all users.
- **Behaviour:** Any user may enrol TOTP MFA in their profile. When MFA is required for the user's role and the user has not enrolled, after password sign-in the user is forced into enrolment before accessing anything else. Sign-in with MFA asks for a TOTP code or a recovery code. OAuth sign-ins rely on the identity provider's own MFA; the CRM additionally requires its TOTP only when the Admin setting "Also require CRM MFA for Google/Microsoft sign-in" is on (default off; pending OD-13 confirmation). Admin can reset a user's MFA (audited).
- **Validations:** TOTP code: exactly 6 digits, accepted within ±1 time step; recovery code format fixed length, single use. Max 5 failed MFA attempts per sign-in session then the session must restart.
- **System responses:** "Two-factor authentication is on." Recovery codes downloadable once. Audit `auth.mfa_enrolled`, `auth.mfa_reset`, `settings.mfa_policy_changed`.
- **Errors / exceptions:** Wrong code → "That code didn't work. Check your authenticator app's time and try again." `auth.mfa_invalid`. Lost device → use recovery code or ask Admin to reset.
- **Dependencies:** BR-PLT-003, BR-PLT-009.
- **Working assumptions:** OD-13 (recommendation: required for Admins).

### BR-PLT-005
> "The platform shall support Admin, Sales Manager and Salesperson roles with the permissions in Section 9.17."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | OD-31; foundation §8; ROLE-PERMISSION-MATRIX.md authoritative |

- **Inputs / fields:** User role (exactly one of admin, sales_manager, salesperson); sales_manager "template/content/catalog rights" flag; organization visibility settings per object type (companies, contacts, deals): "Salespeople can view others' records" on/off (view-only).
- **Behaviour:** Enforced server-side by a central policy (ADR-006) on every read and write; the UI hides or disables controls the user may not use, using `/me/permissions`. §9.17 rows apply with these WAs (OD-31): salespeople cannot reassign (including bulk); view-only means read-only (no notes/tasks on view-only records); a manager's own records are part of "own team"; closed deals are editable by owner/manager/admin and reopening needs a reason; access history visible to anyone who can view the deal; email templates personal (any user) or shared (Admin, or Manager with template rights); lost reasons and discount limits Admin only. "Billing" in §9.17 is not applicable (IDD-03). Role change takes effect on the user's next request.
- **Validations:** At least one active Admin must always exist (DR-PLT-04). Only Admins change roles.
- **System responses:** Role change audited `user.role_changed` with old/new values.
- **Errors / exceptions:** Forbidden action → "You don't have permission to do this." `auth.forbidden`. Record outside scope → 404 `resource.not_found`.
- **Dependencies:** All modules; BR-PLT-006; BR-RPT-008.
- **Working assumptions:** OD-31, OD-32.

### BR-PLT-006
> "Admins shall be able to define teams and assign managers; managers see records owned by their team."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | OD-32 |

- **Inputs / fields:** Team: name (required, 1–100, unique case-insensitive), description (0–500), members (users), managers (≥1 user with role sales_manager or admin).
- **Behaviour:** A user belongs to at most one team; a team has one or more managers; a manager may manage several teams; no nested teams (OD-32). A manager's scope = records owned by members of all teams they manage + their own records. Moving a user between teams changes manager visibility immediately; record ownership is unchanged. Teams can be archived only when they have no members.
- **Validations:** Duplicate name → `team.duplicate_name`. Adding a user already in another team prompts "Move <user> from <team A> to <team B>?" (confirm required). Manager must have role sales_manager or admin (`team.invalid_manager`). Archive with members → "Remove all members before archiving this team." `team.not_empty`.
- **System responses:** Team list with member and manager counts; audit `team.created/updated/member_added/member_removed/manager_assigned`.
- **Errors / exceptions:** As above; concurrent edits → 409.
- **Dependencies:** BR-PLT-005, BR-CRM-004, BR-RPT-007/008.
- **Working assumptions:** OD-32.

### BR-PLT-007
> "The platform shall provide subscription billing: plan selection, seat management, payment, invoices and trial conversion."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Out of scope | IDD-03; disposition aligned to SCOPE-RECONCILIATION.md §7.1 (§12 R2) |

- **Specification:** Not built. No plans, seats, payments, invoices or trial conversion. "Seat management" is replaced by user management (invite, deactivate, reassign: BR-PLT-002, BR-PLT-011). No billing provider dependency (§13.3). AC-14 billing part not applicable. Any UI or API reference to billing must be absent.
- **Dependencies:** none.

### BR-PLT-008
> "The platform shall provide a guided onboarding checklist: import data, connect email, configure pipeline, create first template, send first proposal."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Modified (internal setup checklist) | IDD-04 |

- **Inputs / fields:** None entered; checklist items are derived from system state. User may dismiss/restore the checklist.
- **Behaviour:** Two checklists. **Admin setup checklist:** (1) import data — complete when ≥1 import batch committed (BR-MIG-001) or Admin marks "Not needed"; (2) configure pipeline — complete when the default pipeline's open stages have been saved at least once by an Admin (BR-CRM-005); (3) create first template — complete when ≥1 template is published (BR-TPL-001/004). **User checklist** (every user): (1) connect mailbox — complete when the user has an active mailbox connection (BR-EML-001); (2) send first proposal — complete when the user has sent ≥1 proposal version (BR-SHR-002). Each item links to the relevant screen. Progress shown as "x of n done" on My Day until all complete or dismissed.
- **Validations:** n/a (state-derived). "Not needed" allowed only for "import data".
- **System responses:** Item ticks automatically within one page refresh of the triggering event.
- **Errors / exceptions:** None user-facing.
- **Dependencies:** BR-MIG-001, BR-EML-001, BR-CRM-005, BR-TPL-001, BR-SHR-002; NFR-010.
- **Working assumptions:** IDD-04.

### BR-PLT-009
> "The platform shall keep an audit log of key user, admin and system actions."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | NFR-009; foundation §9 compliance (access restriction clarified); disposition aligned to SCOPE-RECONCILIATION.md §7.1 (§12 R2) |

- **Inputs / fields:** Audit viewer filters: date range, actor (user/system/ai/buyer), action type, entity type, entity id.
- **Behaviour:** Written synchronously in the same transaction as the change (ADR-022). Each entry: timestamp (UTC), actor type and id, action code, entity type and id, summary, before/after values of changed fields (personal data minimised: field names plus values for business fields; secrets never), request id, IP address and user agent for user actions. Minimum audited actions: sign-in success/failure, MFA changes, password reset, user invite/activate/deactivate/role change/team change, settings changes, permission settings, pipeline/stage/custom field/lost reason/automation rule/lead form/assignment rule changes, import commit and undo, export requested/downloaded, record archive/restore/reassign/erasure, proposal send/void/version create, share link create/revoke/expiry change, signature request create/void/resend, automation execution and reversal, AI feature switches and AI generation acceptance, mailbox connect/disconnect. Audit entries are append-only; no user, including Admin, can edit or delete them. Viewing is Admin only. Audit log is exempt from erasure and has its own retention (OD-36, DR-PLT-07).
- **Validations:** Filter date range ≤ 366 days per query.
- **System responses:** Paginated list (newest first), entry detail with before/after diff; CSV export of filtered results (Admin, audited itself).
- **Errors / exceptions:** Non-admin access → 403. If the audit write fails the originating action fails and is rolled back ("Something went wrong. Your change was not saved." `system.audit_unavailable`).
- **Dependencies:** All modules; NFR-009; BR-AIA-007 (AI usage log is separate but linked).
- **Working assumptions:** OD-36.

### BR-PLT-010
> "Admins shall be able to export all organization data in standard formats."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged (purpose = backup/exit/compliance) | IDD-12 |

- **Inputs / fields:** Export request: scope = full (default) or selected entity types; include files (signed PDFs, completion certificates, proposal PDFs, uploaded images) yes/no.
- **Behaviour:** Runs as a background job. Produces a ZIP containing one CSV and one JSON (newline-delimited) file per entity type (users, teams, companies, contacts, deals, deal contacts, pipelines and stages, custom field definitions and values, tasks, notes, logged activities, email metadata and bodies, calendar events, lead forms and submissions, templates and versions, content blocks, products, proposals, versions and pricing, share links, view/download events, signature requests, signers and events, automation executions, timeline events, audit log), a `manifest.json` (entity counts, schema version, generated timestamp, SHA-256 per file) and optionally a `files/` folder. Private emails (OD-30) export metadata only. Archived records are included with their archive flag. The Admin is notified (in-app + email) when ready; download through a signed URL valid 24 hours; export file deleted from storage after 7 days (DR-PLT-06).
- **Validations:** Only one running export at a time ("An export is already in progress." `export.in_progress`).
- **System responses:** Export job status (queued, running with progress %, ready, failed, expired). Audit `export.requested`, `export.downloaded`.
- **Errors / exceptions:** Job failure → status Failed with "Export failed. Try again; if it fails again contact support." and correlation id. Expired download → "This export has expired. Start a new export."
- **Dependencies:** BR-PLT-009, NFR-002, NFR-015, DR-PLT-06.
- **Working assumptions:** IDD-12, OD-30, OD-36.

### BR-PLT-011
> "Admins shall be able to deactivate users and reassign their records."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified (deactivation effects) | IDD-03; foundation §9 deactivation WA |

- **Inputs / fields:** Deactivate dialog: user; reassignment target per category (open deals, open tasks, draft/sent proposals not yet closed, owned companies, owned contacts) — one target user for all or per category; option "Reassign closed deals too" (default off).
- **Behaviour:** See DR-PLT-03 for full effects. Summary: the dialog lists counts of the user's open deals, open tasks, open proposals and pending signature requests; open deals/tasks/proposals must be reassigned before deactivation completes; deactivation immediately ends sessions and add-in tokens, stops mailbox and calendar sync and revokes provider tokens, removes the user from round-robin assignment, keeps their historical records, timelines and authorship intact (shown as "<name> (deactivated)"). Pending signature requests keep the original sender of record; notifications go to the new deal owner. Users can be reactivated by an Admin (records are not automatically returned).
- **Validations:** Target user must be active and have scope to own records (any role). Cannot deactivate self. Cannot deactivate the last active Admin (DR-PLT-04).
- **System responses:** "<name> was deactivated. <n> records reassigned to <target>." Reassignment changes appear on each record's timeline as "Owner changed from A to B (user deactivation)". Audit `user.deactivated` with counts.
- **Errors / exceptions:** Missing target for a non-empty category → "Choose who will take over <category>." `user.reassignment_required`. Partial failure → whole operation rolled back.
- **Dependencies:** BR-CRM-004, BR-CRM-013, BR-EML-001, BR-LED-002, BR-SIG-001, BR-NTF-001, DR-PLT-03, DR-NTF-01.
- **Working assumptions:** Foundation §9 deactivation WA; OD-31 (reassign permission).

### BR-PLT-012
> "Admins shall be able to manage organization settings, including name, branding, currency, time zone and fiscal year."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified (singleton settings) | IDD-01 |

- **Inputs / fields:** Organization name (required, 1–200); legal name (optional, 0–200); address (optional, multi-line 0–1,000); website (URL); logo (PNG/SVG/JPEG, ≤ 2 MB, min 200 px wide); brand colours primary/secondary (hex `#RRGGBB`); fonts (choose from a supported list of web-safe and bundled fonts); default currency (ISO-4217, BR-PRC-005); enabled currencies (BR-PRC-006); time zone (IANA name); fiscal year start month (1–12) and fiscal year naming (by start year or end year); locale for number/date formatting (DR-PLT-09); default proposal validity days (0–365, BR-PRP-009); email-domain allow list for sign-in (OD-12); visibility settings (BR-PLT-005); AI switches (BR-AIA-008); open-tracking switch (BR-EML-007).
- **Behaviour:** Single settings record. Changes take effect for new actions immediately. Branding applies to template rendering and the buyer view for drafts and newly sent versions; already-sent versions keep the branding frozen in their snapshot (ADR-010). Changing default currency does not change amounts or currency of existing deals/proposals; reports convert using the exchange-rate table (DR-PRC-02).
- **Validations:** Hex colours must match `#RRGGBB`; contrast warning (not block) if text-on-primary contrast < 4.5:1 (NFR-011). Logo type/size enforced ("Logo must be PNG, JPEG or SVG and under 2 MB." `settings.invalid_logo`). SVG sanitised (scripts removed). Changing default currency requires confirmation: "Existing deals keep their currency. Reports will convert to <new currency> using exchange rates." 
- **System responses:** "Settings saved." Audit `settings.updated` with diff.
- **Errors / exceptions:** Concurrent save → 409.
- **Dependencies:** BR-TPL-006, BR-PRC-005/006, BR-RPT-007, BR-SHR-009, DR-PLT-09.
- **Working assumptions:** IDD-01, OD-15.

### PLT derived requirements

**DR-PLT-01 — First Admin bootstrap.** *Derived — pending confirmation (from BR-PLT-002, IDD-02).* A one-time command, run by an operator with deployment access, creates the organization settings row and the first Admin (email, first name, last name). It refuses to run if any Admin already exists. The Admin receives an invitation email and completes sign-up as in BR-PLT-002. The run is recorded in the audit log with actor type `system` and the operator-supplied reason.

**DR-PLT-02 — Invitation lifecycle.** *Derived — pending confirmation (from BR-PLT-002).* States: pending → accepted | revoked | expired. Expiry default 7 days (configurable 1–30). Resend issues a new token and invalidates the previous one. Only the latest token works. Accepted invitations cannot be reused.

**DR-PLT-03 — User deactivation effects.** *Derived — pending confirmation (from BR-PLT-011; foundation §9 deactivation WA).* On deactivation: (a) all sessions and bearer tokens revoked; (b) mailbox/calendar sync stopped and provider tokens revoked; already-synced emails remain linked (private emails remain private and visible only to the now-deactivated owner, i.e. effectively to no one, and are subject to retention, OD-30/OD-36); (c) removed from all round-robin assignment rules and from field-value rules (rules referencing the user are flagged "needs attention" for the Admin, DR-LED-01); (d) open deals, open tasks and open proposals reassigned to the chosen target(s); (e) pending signature requests keep the original sender of record in the provider; notifications and AUT tasks go to the new deal owner; (f) personal email templates and saved views of the user are retained but hidden; Admin may transfer them; (g) team membership and manager assignments removed; a team left without a manager is flagged to the Admin; (h) user is excluded from the default rep list in dashboards but historical metrics remain attributable.

**DR-PLT-04 — Last-Admin protection.** *Derived — pending confirmation (from BR-PLT-005, BR-PLT-011).* The system rejects any change (role change, deactivation) that would leave zero active Admins: "At least one active administrator is required." `user.last_admin`.

**DR-PLT-05 — Credential policy.** *Derived — pending confirmation (from BR-PLT-003, NFR-001; owner IT/Security).* Password 12–128 characters, not containing the email local part, rejected if on a common/breached password list; sign-in throttling per RULE-PLT-08 (authoritative, foundation §16 S4): after 5 consecutive failed attempts for an account, further attempts are delayed exponentially up to 15 minutes, without revealing whether the account exists (`AUTH_RATE_LIMITED`); parameters are settings (OD-76); password reset link single-use, valid 60 minutes; sign-in rate-limited per IP and per account.

**DR-PLT-06 — Export package contents and lifetime.** *Derived — pending confirmation (from BR-PLT-010, IDD-12, foundation §9 export WA).* As specified in BR-PLT-010: CSV + NDJSON per entity, manifest with SHA-256, optional files folder with signed PDFs and completion certificates, private emails metadata only; download link valid 24 h; package deleted after 7 days.

**DR-PLT-07 — Audit log access and retention.** *Derived — pending confirmation (from BR-PLT-009, OD-36).* Audit log readable by Admins only; retained for a configurable period (default 7 years, owner Legal/DPO); exempt from contact erasure (personal identifiers in audit entries are retained under legal obligation, OD-36).

**DR-PLT-08 — Session management.** *Derived — pending confirmation (from BR-PLT-003, NFR-001).* Idle session timeout default 12 hours, absolute lifetime default 30 days (configurable by Admin); users can see and sign out their other sessions; password change and deactivation revoke all sessions.

**DR-PLT-09 — Locale and formatting setting.** *Derived — pending confirmation (from BR-PLT-012, BR-CRM-007, BR-TPL-002; foundation §9 custom field formatting WA).* Organization setting `locale` (e.g. en-US, en-GB) drives number, currency and date formatting in the app, placeholders, PDFs and DOCX. Launch is English-language first (BRD §13.1); UI translation is out of scope.

**DR-PLT-10 — Common field validation conventions.** Defined in §0.4.

---

## 3. MIG — Data import (BRD §9.2)

**Purpose.** Lets the Admin bring existing companies, contacts and deals (and proposal documents) into the CRM with validation, duplicate handling and undo, so the team can retire spreadsheets/previous tools. Addresses P9; supports AC-02 and the switching-effort metric (§12).

**Primary users.** Admin.

**Interactions summary.** Admin uploads file → selects entity type and source profile (generic CSV/Excel, HubSpot export, Pipedrive export) → maps columns to standard/custom fields → system validates every row and runs duplicate detection → Admin reviews the error report and resolves duplicates (skip/merge/create) → Admin commits → records created/updated in a batch → Admin may undo the batch. DOCX upload creates a template draft (BR-MIG-006).

### BR-MIG-001
> "Admins shall be able to import companies, contacts and deals from CSV or Excel, mapping columns to standard and custom fields."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged | OD-09 (CSV/Excel always) |

- **Inputs / fields:** File (`.csv` UTF-8 or UTF-8-BOM, comma/semicolon/tab auto-detected; `.xlsx` first sheet or chosen sheet); entity type (companies | contacts | deals | combined contacts+companies); header row number (default 1); column mapping (each column → standard field, custom field, "create new custom field", or ignore); defaults for unmapped required fields (e.g. owner, pipeline, stage, currency); date format for ambiguous dates (e.g. DD/MM/YYYY vs MM/DD/YYYY); owner matching key (user email).
- **Behaviour:** Upload → parse preview (first 20 rows) → mapping screen with auto-suggested mappings by header name similarity (saved per source profile) → validation run (BR-MIG-004) → duplicate review (BR-MIG-003) → commit as a background job in a single import batch (BR-MIG-005). Relationships: contact rows may reference a company by name or domain (matched per OD-27; created if missing when "create missing companies" is ticked); deal rows must reference a company (OD-33) and may reference contacts by email and a role (OD-34). Deal stage mapped by stage name in the selected pipeline (DR-MIG-04). Owner mapped by user email; unmatched owner → default owner (DR-MIG-03). Imported records carry `source = import` and the batch id; a single timeline event "Imported (batch <name>)" per record.
- **Validations:** File ≤ 25 MB and ≤ 50,000 data rows per batch (DR-MIG-01); at least one column mapped; each standard required field mapped or defaulted (company: name; contact: first name or last name or email; deal: name, company, pipeline, stage, owner, currency); field-level rules per DR-PLT-10 and the custom field type (BR-CRM-007); a column can be mapped to only one field.
- **System responses:** Progress bar with rows processed; on completion "Imported <n> companies, <m> contacts, <k> deals. <x> skipped." with links to the batch report.
- **Errors / exceptions:** Unreadable file → "We couldn't read this file. Save it as CSV (UTF-8) or Excel (.xlsx) and try again." `import.unreadable_file`. Too large → `import.file_too_large`. Password-protected Excel → `import.protected_file`. Commit job failure → batch status Failed; nothing committed (all-or-nothing per batch).
- **Dependencies:** BR-CRM-001/002/003/007, BR-MIG-003/004/005, BR-PLT-009.
- **Working assumptions:** OD-09, OD-27, OD-33, OD-34.

### BR-MIG-002
> "The platform shall provide guided import from HubSpot and Pipedrive exports."

| Priority | Disposition | Basis |
|---|---|---|
| Should | Clarified (conditional) | OD-09 — built only if we currently use HubSpot or Pipedrive |

- **Inputs / fields:** Source selection (HubSpot | Pipedrive); the vendor's standard CSV/XLSX export files for companies/organizations, contacts/persons and deals.
- **Behaviour:** Same pipeline as BR-MIG-001 with a predefined source profile: known column headers pre-mapped, vendor stage names presented for mapping to our stages, vendor owner names/emails mapped to users, vendor record ids stored as external source ids (used as the deal duplicate key, OD-27). Guided steps: "1. Companies, 2. Contacts, 3. Deals" so references resolve in order.
- **Validations:** Same as BR-MIG-001; files whose headers do not match the chosen profile trigger a warning "This doesn't look like a <vendor> <entity> export. Continue with manual mapping?"
- **System responses / errors:** As BR-MIG-001.
- **Dependencies:** BR-MIG-001, BR-MIG-003.
- **Working assumptions:** OD-09 (if neither vendor is in use this requirement is not built and AC-02's HubSpot/Pipedrive part is not applicable).

### BR-MIG-003
> "The import shall detect duplicates and let the admin skip, merge or create new records."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | OD-27 |

- **Inputs / fields:** Per duplicate group: action (skip | merge | create new); for merge, field-level choice "keep existing" (default) or "use imported" per conflicting field; bulk action "apply to all duplicates of this type".
- **Behaviour:** Exact-key matching only (OD-27): contacts by normalised email; companies by normalised primary domain, else normalised exact name; deals by external source id only. Matches are checked against existing records and within the file itself (intra-file duplicates grouped, first row wins by default). Fuzzy candidates (name similarity) are shown as "Possible duplicate" suggestions only and default to "create new". Merge updates the existing record: empty existing fields are filled; conflicting fields follow the chosen rule; multi-select values are unioned; the existing record keeps its id, owner and timeline; the batch records the before-values (for undo, BR-MIG-005).
- **Validations:** Every exact duplicate must have an action before commit (default action selectable: skip).
- **System responses:** Duplicate review table showing imported row vs existing record side by side with differing fields highlighted; counts per action.
- **Errors / exceptions:** Existing record archived → shown as duplicate with option "restore and merge" or "create new". Existing record changed between review and commit → because a batch is all-or-nothing (BR-MIG-001), the commit is aborted with "Some matched records changed since review. Re-run validation." `import.target_changed`, listing the affected rows.
- **Dependencies:** BR-MIG-001/004/005, BR-LED-004 (same matching service).
- **Working assumptions:** OD-27; fuzzy matching via trigram similarity is suggestion-only.

### BR-MIG-004
> "The import shall validate data and show an error report before saving."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged | — |

- **Inputs / fields:** None beyond mapping; Admin may fix mapping/defaults and re-validate, or download the error report, fix the file and re-upload.
- **Behaviour:** Validation runs on every row before any write. Per row: type conversion per mapped field type, required fields, length/format/range (DR-PLT-10, BR-CRM-007 types), dropdown/multi-select values exist in the option list (option to "add missing options" per field), owner email resolves to an active user, pipeline/stage resolve, currency enabled, referenced company/contacts resolvable. Rows are classified Valid / Warning (imported with adjustment, e.g. trimmed, phone not parseable) / Error (not importable).
- **Validations:** Commit is allowed when error rows are either fixed or explicitly excluded ("Import valid rows only, skip <n> error rows").
- **System responses:** Summary (valid, warnings, errors, duplicates) and an error report table: row number, column, value, message; downloadable as CSV with an extra "error" column.
- **Errors / exceptions:** Validation exceeding time limit runs as a background job with progress; the Admin is notified when done.
- **Dependencies:** BR-MIG-001, BR-MIG-003, BR-CRM-007.
- **Working assumptions:** —

### BR-MIG-005
> "Admins shall be able to undo an import batch."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged | DR-MIG-02 (conflict handling); disposition aligned to SCOPE-RECONCILIATION.md §7.1 (§12 R2) |

- **Inputs / fields:** Batch selection; confirmation dialog.
- **Behaviour:** Undo reverts the batch: records created by the batch are hard-deleted if untouched since import, otherwise handled per DR-MIG-02; records merged by the batch have the imported field values reverted to the stored before-values where the field has not been changed since. Undo is a background job; batch status becomes "Undone". Undo is available for 30 days after commit (DR-MIG-02). An undo cannot itself be undone.
- **Validations:** Only committed batches; one undo at a time.
- **System responses:** Pre-undo impact summary: "<n> records will be deleted, <m> merged records reverted, <k> records changed since import will be kept and listed." Post-undo report downloadable.
- **Errors / exceptions:** Batch older than window → "This import is too old to undo." `import.undo_window_passed`. Job failure → batch stays "Committed", "Undo failed; nothing was changed."
- **Dependencies:** BR-MIG-001/003, BR-PLT-009, DR-MIG-02.
- **Working assumptions:** —

### BR-MIG-006
> "Admins shall be able to upload existing DOCX proposals as starting points for templates."

| Priority | Disposition | Basis |
|---|---|---|
| Should | Unchanged | ADR-010 |

- **Who:** Admin only, including when a Sales Manager holds template rights (§12 resolution R8; PERM-034). Release R1 (§12 R1).
- **Inputs / fields:** DOCX file (≤ 20 MB); template name (required, 1–200).
- **Behaviour:** The document is converted into a draft template in the block model: headings become sections (Heading 1 → section; deeper headings kept as rich-text headings), paragraphs, lists, tables and inline images preserved; unsupported elements (text boxes, SmartArt, tracked changes, comments, macros, headers/footers beyond plain text) dropped and listed. No automatic placeholder detection; the Admin inserts placeholders afterwards. Result opens in the template editor as Draft (unpublished).
- **Validations:** `.docx` only (not `.doc`, not macro-enabled); file opens; not password-protected.
- **System responses:** "Template draft created from <file>. <n> items could not be converted — see list."
- **Errors / exceptions:** Conversion failure → "We couldn't convert this document." `template.import_failed`.
- **Dependencies:** BR-TPL-001, BR-TPL-004.
- **Working assumptions:** OD-43 (layout fidelity not guaranteed).

### BR-MIG-007
> "The platform shall import directly from HubSpot and Pipedrive through their APIs."

| Priority | Disposition | Basis |
|---|---|---|
| Could | Deferred | OD-09 |

- **Specification:** Not built in Phase 1. The import pipeline's source-profile abstraction (BR-MIG-002) is the extension point; an API connector would supply rows into the same validation/duplicate/commit/undo flow.

### MIG derived requirements

**DR-MIG-01 — Import limits.** *Derived — pending confirmation (from BR-MIG-001, OD-45, OD-59).* Max file size 25 MB, max 50,000 data rows per batch, max 300 columns; larger data sets are split into several batches. Uploaded source files are retained 30 days then deleted.

**DR-MIG-02 — Undo conflict handling.** *Derived — pending confirmation (from BR-MIG-005).* A record created by the batch that has since been edited, or has gained child records (notes, tasks, emails, proposals, deal links) is not deleted; it is listed in the undo report as "kept (changed since import)". Merged fields changed after import are not reverted. No undo time limit (OD-59 WA; RULE-MIG-10).

**DR-MIG-03 — Owner mapping.** *Derived — pending confirmation (from BR-MIG-001, BR-CRM-004).* Owner column matched by user email (active users only); unmatched or blank → default owner chosen on the mapping screen (required).

**DR-MIG-04 — Stage and pipeline mapping.** *Derived — pending confirmation (from BR-MIG-001, BR-CRM-005).* Distinct source stage values are listed and must each be mapped to a stage of the target pipeline (including Closed Won / Closed Lost). Deals mapped to Closed Lost require a lost reason (column or default, BR-CRM-014). Imported closed deals keep their imported close date and do not trigger automation (AUT rules do not fire on import).

**DR-MIG-05 — No automation or notifications on import.** *Derived — pending confirmation (from BR-MIG-001, BR-AUT-*, BR-NTF-*).* Imported records do not trigger assignment rules, notifications, stalled-deal flags at commit time (flags are computed on the next scheduled run), or AUT actions.

---

## 4. CRM — CRM records (BRD §9.3)

**Purpose.** The system of record for companies, contacts, deals, pipelines, custom fields, tasks, notes, logged calls/meetings, list views and search. Addresses P5 (managers can't see the real pipeline) and P6 (admin time, via My Day and bulk edit); every other module attaches to CRM records.

**Primary users.** Salesperson (daily work on own records), Sales Manager (team records, reassignment), Admin (configuration: pipelines, stages, custom fields, lost reasons, contact roles, visibility).

**Interactions summary.** Admin configures pipelines/stages/probabilities, custom fields, lost reasons and deal contact roles → users create companies, contacts (linked to one company) and deals (one company, one pipeline/stage, one owner, contacts with roles) → users add tasks, notes, logged calls/meetings → work is driven from My Day, list views, the deal board and search → stage changes and closing won/lost (with lost reason) feed AUT, RPT and TIM.

### BR-CRM-001
> "Users shall be able to create, view, update and archive company records."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged | DR-CRM-01; ADR-005 (archive behaviour); disposition aligned to SCOPE-RECONCILIATION.md §7.1 (§12 R2) |

- **Inputs / fields:** Name (required, 1–200); website/domain (optional URL; derived normalised primary domain used for matching, OD-27); additional domains (0–10); phone; address (street, city, region, postal code, country ISO-3166 alpha-2); industry (dropdown, Admin list); employee count (integer 0–10,000,000); owner (required, default creator); description (long text); custom fields (BR-CRM-007).
- **Behaviour:** Create/view/update within permissions (BR-PLT-005). Company page shows fields, contacts, deals, proposals and the combined timeline (BR-TIM-003). Archive hides the company from lists, search defaults, pickers and lead/email matching suggestions but keeps all relations and history; archived records can be viewed (with an "Archived" banner) and restored (DR-CRM-01). There is no user hard delete; permanent removal only via governed erasure (OD-36).
- **Validations:** Duplicate check on save: same normalised domain or same normalised name as an existing non-archived company → warning "A company with this domain/name already exists: <link>. Create anyway?" (create allowed; OD-27 no auto-merge). Free-mail domains (DR-LED-04) are never stored as a company's primary domain. Archive is blocked while the company has open deals: "Close or move this company's open deals before archiving." `company.has_open_deals`.
- **System responses:** "Company created/updated/archived/restored." Timeline events for create, archive, restore and owner change.
- **Errors / exceptions:** Validation errors inline; stale update → 409; view-only user → edit controls disabled, API 403.
- **Dependencies:** BR-CRM-002/003/007, BR-TIM-003, BR-PLT-005, DR-CRM-01.
- **Working assumptions:** OD-27, OD-31, OD-33, OD-36.

### BR-CRM-002
> "Users shall be able to manage contacts and associate them with companies."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | OD-33 |

- **Inputs / fields:** First name (0–100), last name (0–100), email (primary, unique among non-archived contacts), additional emails (0–5), phones (0–3 with type), job title (0–150), company (zero or one primary company, OD-33), owner (required), LinkedIn URL, address, source (manual | import | lead form | add-in | forwarded viewer — system-set), custom fields.
- **Behaviour:** Create, view, update, archive, restore (DR-CRM-01). Associate or change the contact's company; changing company does not change the contact's existing deal roles. Contact page shows deals (with roles), emails, meetings, proposals viewed and the combined timeline (BR-TIM-003). Contacts may exist without a company (e.g. forwarded viewer with non-matching domain, OD-26).
- **Validations:** At least one of first name, last name, email required (`contact.identity_required`). Email unique by normalised value (primary and additional) across non-archived contacts → "A contact with this email already exists: <link>." `contact.duplicate_email` (hard uniqueness because email is the matching key, OD-27). Archive blocked if the contact is a signer on an open signature request (`contact.active_signer`).
- **System responses / errors:** As BR-CRM-001.
- **Dependencies:** BR-CRM-001/003, BR-EML-002, BR-SHR-005, BR-LED-001/004.
- **Working assumptions:** OD-26, OD-27, OD-33.

### BR-CRM-003
> "Users shall be able to manage deals with name, amount, expected close date, stage, owner, company and one or more contacts with roles (for example decision-maker, signer, influencer)."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | OD-15, OD-31, OD-33, OD-34 |

- **Inputs / fields:** Name (required, 1–200); company (required, OD-33, DR-CRM-09); pipeline (required; default preselected); stage (required; open stages of the pipeline; Closed Won/Lost reached via close actions); amount (money ≥ 0, default 0); currency (default organization currency; other enabled currencies when BR-PRC-006 is active); expected close date (required); owner (required, default creator); contacts (0..n), each with one or more roles from the Admin list (OD-34, DR-CRM-07); source (manual | lead form | import | add-in, system-set); description; custom fields.
- **Behaviour:** Create from the deals list, board, company page, contact page, add-in or lead form. The deal page header shows stage path, amount, close date, owner, status (open/won/lost derived from stage kind) and flags (stalled, overdue — BR-AUT-005/006). Stage changes via stage path, board drag or edit. Closed Won requires amount and close date confirmation (DR-CRM-06); Closed Lost requires a lost reason (BR-CRM-014). Closed deals are editable by owner/manager/admin; reopening requires a reason (OD-31, DR-CRM-04). Every stage, amount, close date and owner change writes a timeline event.
- **Validations:** Expected close date any valid date (past allowed, flagged by BR-AUT-006). Currency change blocked once the deal has a sent proposal: "Currency can't change after a proposal is sent." `deal.currency_locked`. A contact appears once per deal (roles multi-select). Removing a contact who is a signer on an open signature request is blocked (`deal.contact_active_signer`). Manual close with an open signature request → DR-CRM-05/06.
- **System responses:** "Deal created." Deal appears on board and lists immediately.
- **Errors / exceptions:** Missing required → inline; stale → 409; close without permission → 403.
- **Dependencies:** BR-CRM-004/005/014, BR-PRC-004/005/006, BR-AUT-001/002, BR-TIM-001.
- **Working assumptions:** OD-15, OD-31, OD-33, OD-34.

### BR-CRM-004
> "Each deal shall have one owner; authorized users can reassign it."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | OD-31; BRD §9.17 "Reassign deals" |

- **Inputs / fields:** New owner (active user); "also reassign open tasks on this deal" (default on); "also reassign draft proposals" (default on).
- **Behaviour:** Exactly one owner per deal. Admin reassigns any deal; Sales Manager reassigns deals in scope to members of teams they manage or to themselves; Salesperson cannot reassign (OD-31). Reassignment writes timeline "Owner changed from A to B", notifies the new owner in-app, and routes later deal notifications to the current owner (DR-NTF-01). Sent proposals and pending signature requests keep the original sender of record.
- **Validations:** Target active; for managers, target within managed teams (`deal.reassign_out_of_scope`).
- **System responses:** "Deal reassigned to <name>." Audit `deal.reassigned`.
- **Errors / exceptions:** 403 for salesperson; 409 stale.
- **Dependencies:** BR-PLT-005/006/011, BR-CRM-013, BR-NTF-001.
- **Working assumptions:** OD-31, OD-32.

### BR-CRM-005
> "Admins shall be able to configure a pipeline's stages and a win probability for each stage."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | foundation §5 stage kinds; disposition aligned to SCOPE-RECONCILIATION.md §7.1 (§12 R2) |

- **Inputs / fields:** Per open stage: name (required, 1–60, unique within pipeline, case-insensitive), order, win probability (integer 0–100), stalled-after days (BR-AUT-005; integer 1–365 or blank = not monitored). Per pipeline: proposal-sent target stage (BR-AUT-001; zero or one open stage).
- **Behaviour:** Each pipeline has exactly one system stage "Closed Won" (probability 100, kind won) and one "Closed Lost" (probability 0, kind lost), always last, not removable, name editable, probability fixed. Admin adds, renames, reorders and removes open stages. Removing a stage that contains deals requires a target stage (DR-CRM-10). Probability changes apply from the time of change (no historical restatement).
- **Validations:** At least one open stage (`pipeline.no_open_stage`); probabilities integers 0–100; non-ascending probabilities produce a warning only.
- **System responses:** "Pipeline saved." Audit `pipeline.updated` with stage diff.
- **Errors / exceptions:** Removing a stage with deals and no target → `pipeline.stage_in_use`.
- **Dependencies:** BR-CRM-006, BR-RPT-001/006, BR-AUT-001/005.
- **Working assumptions:** —

### BR-CRM-006
> "Admins shall be able to create multiple pipelines."

| Priority | Disposition | Basis |
|---|---|---|
| Should | Unchanged | — |

- **Inputs / fields:** Pipeline name (required, 1–100, unique), description (0–500), default flag (exactly one default), stages (BR-CRM-005).
- **Behaviour:** Admin creates, renames, sets default and archives pipelines. A deal belongs to exactly one pipeline; moving a deal to another pipeline requires choosing a stage in the target pipeline and writes a timeline event. Archiving is allowed only with no open deals; closed deals keep reporting on the archived pipeline.
- **Validations:** Cannot archive the default pipeline (`pipeline.is_default`) or one with open deals (`pipeline.has_open_deals`).
- **System responses / errors:** As BR-CRM-005.
- **Dependencies:** BR-CRM-005, BR-RPT-001/007.
- **Working assumptions:** —

### BR-CRM-007
> "Admins shall be able to create custom fields for companies, contacts and deals (text, number, currency, date, dropdown, multi-select, checkbox). Custom fields shall be usable in filters, reports and proposal templates."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified (formatting, deletion, type rules) | foundation §9 custom field WAs; DR-CRM-02, DR-CRM-03 |

- **Inputs / fields (definition):** Object (company | contact | deal); label (required, 1–60, unique per object); key (auto-generated slug, immutable, used in placeholders e.g. `{{deal.custom.<key>}}`); type (text | number | currency | date | dropdown | multi-select | checkbox); help text (0–200); required flag; options for dropdown/multi-select (1–200 options, each 1–100 chars, unique, orderable); number: decimal places 0–4, optional min/max; text: max length 1–255; currency: deal fields use the deal's currency, company/contact fields the organization default; checkbox default.
- **Behaviour:** Fields appear on forms, detail pages, list columns, filters (type-appropriate operators: text contains/equals/is empty; number/currency/date comparisons and ranges; dropdown is any of; multi-select contains any/all; checkbox is true/false), sort, saved views, import mapping, reports (dropdown/checkbox as group-by; number/currency as measures) and template placeholders (BR-TPL-002) formatted per DR-CRM-02. "Required" is enforced on create/edit; existing records without a value are flagged on next edit, not retroactively rejected. Delete = archive definition (DR-CRM-03). Type cannot be changed after creation. Dropdown options are removed by archiving the option; existing values show "(archived option)".
- **Validations:** Max 100 active custom fields per object; values validated per type (DR-PLT-10); dropdown values must be active options.
- **System responses:** "Field created." Field immediately available in forms, filters and the template placeholder picker.
- **Errors / exceptions:** Duplicate label → `custom_field.duplicate_label`; limit → `custom_field.limit_reached`; invalid value → inline error naming the field.
- **Dependencies:** BR-CRM-011, BR-RPT-*, BR-TPL-002/008, BR-MIG-001, BR-LED-001.
- **Working assumptions:** Foundation §9 custom field formatting and deletion WAs.

### BR-CRM-008
> "Users shall be able to create tasks with due dates and reminders, linked to records."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified (reminder channels) | OD-47 |

- **Inputs / fields:** Title (required, 1–200); description (0–5,000); type (to-do | call | email | meeting | follow-up); due date (required) with optional time; reminder (none | at due time | 15 min | 1 h | 1 day before | custom date-time); assignee (default creator; salesperson → self only; manager → self or team members; admin → anyone); linked record (one of deal, company, contact, or none for a personal task); priority (normal | high).
- **Behaviour:** Status open | completed | cancelled; source manual | automation | ai_suggested. Reminders delivered in-app and by email at reminder time (OD-47); browser push deferred (BR-NTF-004). Overdue = open and past due date-time (end of due date in the assignee's time zone if no time). Completing records completion time and writes a timeline event on the linked record. Automation-created tasks are labelled "Automated" (BR-AUT-008).
- **Validations:** Reminder ≤ due date-time and in the future at creation (`task.reminder_in_past`); view-only users cannot add tasks to view-only records (OD-31).
- **System responses:** Task appears in My Day and on the record; reminder "Reminder: <title> is due <when>".
- **Errors / exceptions:** Assignee out of scope → `task.assignee_out_of_scope`.
- **Dependencies:** BR-CRM-009, BR-NTF-002, BR-AUT-003/004, BR-TIM-001.
- **Working assumptions:** OD-31, OD-47.

### BR-CRM-009
> "Each user shall have a "My Day" view showing today's and overdue tasks and deals needing attention."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | OD-35, OD-40 (depends on BR-AUT-006 Should) |

- **Inputs / fields:** None required; managers toggle "Mine / My team".
- **Behaviour:** Default landing page. Sections: (1) Overdue tasks; (2) Today's tasks (due today in the user's time zone); (3) Deals needing attention — same definition as BR-RPT-005: stalled (BR-AUT-005), past expected close date (BR-AUT-006), or with a sent proposal not viewed by the follow-up threshold (BR-AUT-004); (4) Today's meetings (BR-EML-006) if connected; (5) setup checklist (BR-PLT-008) until complete or dismissed. Tasks can be completed, rescheduled or opened inline.
- **Validations:** n/a.
- **System responses:** Counts per section; empty states.
- **Errors / exceptions:** Calendar not connected → "Connect your calendar to see today's meetings."
- **Dependencies:** BR-CRM-008, BR-AUT-004/005/006, BR-RPT-005, BR-EML-006, BR-PLT-008.
- **Working assumptions:** OD-35, OD-40.

### BR-CRM-010
> "Users shall be able to add notes and manually log calls and meetings."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged | — |

- **Inputs / fields:** Note: body (rich text, required, 1–50,000 chars), primary linked record plus optional additional deal/company/contact links, pinned flag. Logged call: date-time (required; not more than 1 day in the future), duration minutes (0–1,440), direction (inbound | outbound), outcome (Admin list), participants (contacts), notes. Logged meeting: date-time, duration, participants (contacts and users), location/online, notes.
- **Behaviour:** Appear on linked records' timelines with the author (BR-TIM-001/003). Notes editable/deletable by author and Admin; edits show "edited" and keep prior text in audit; deletion is soft (removed from timeline, retained in audit). If a synced calendar meeting (BR-EML-006) exists for the same time and participants, the user is offered "Add notes to the synced meeting instead".
- **Validations:** As fields; view-only users cannot add (OD-31).
- **System responses:** Item placed at its date in timelines; counted in BR-RPT-010.
- **Errors / exceptions:** Standard.
- **Dependencies:** BR-TIM-001/003, BR-RPT-010, BR-AIA-001/003.
- **Working assumptions:** OD-31; OD-35 (notes and logs count as activity).

### BR-CRM-011
> "Users shall be able to filter, sort and save list views, and view deals on a board grouped by stage."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged | ADR-016 |

- **Inputs / fields:** Lists for companies, contacts, deals, tasks and proposals: columns (choose/reorder), filters (field + operator + value; AND between conditions; OR within a multi-value condition), sort (primary + secondary), page size (25/50/100). Saved view: name (1–100, unique per owner), visibility (private | shared; shared views by Admin/Manager only), personal default. Deal board: pipeline selector, filters, card fields.
- **Behaviour:** Server-side filtering, sorting and cursor pagination within scope. Built-in views: My open deals, My team's open deals (managers), All open deals (admin), Closing this month, Stalled deals. Board: one column per stage with count and total (converted to organization default currency where currencies differ, DR-PRC-02); dragging a card changes stage (close dialogs as BR-CRM-003/014). Filter/sort state is in the URL.
- **Validations:** Filter values by field type.
- **System responses:** Result count; "View saved."
- **Errors / exceptions:** Filter on an archived custom field → shown struck through, "Field archived", ignored.
- **Dependencies:** BR-CRM-007, BR-CRM-013, BR-RPT-*.
- **Working assumptions:** OD-15.

### BR-CRM-012
> "The platform shall provide search across companies, contacts, deals and proposals."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged | ADR-005 |

- **Inputs / fields:** Global search (2–200 characters); optional type filter; "include archived" toggle.
- **Behaviour:** Searches company name/domain, contact name/email/phone, deal name, proposal title/number and text custom fields; prefix and typo-tolerant matching; grouped by type; ranked by relevance then recency; only records the user can see. Private email content is never searched (OD-30).
- **Validations:** Query length.
- **System responses:** Top 5 per type in the quick panel; "See all results".
- **Errors / exceptions:** No results → "No matches. Try fewer words or check spelling."
- **Dependencies:** BR-PLT-005, NFR-005.
- **Working assumptions:** OD-30.

### BR-CRM-013
> "Users shall be able to edit and reassign records in bulk, within their permissions."

| Priority | Disposition | Basis |
|---|---|---|
| Should | Clarified | OD-31 |

- **Inputs / fields:** Selection from a list (explicit rows or "all matching filter", max 1,000 records); action: update one field (standard or custom) to a value, reassign owner (Admin/Manager only), archive (where allowed).
- **Behaviour:** Background job for > 100 records; per-record permission and validation checks; failures skipped and reported; each changed record gets its own timeline and audit entry with a shared bulk-operation id. Bulk stage changes limited to open stages.
- **Validations:** As single-record edits.
- **System responses:** "Updated <n> records. <m> skipped." with downloadable skip report.
- **Errors / exceptions:** Over limit → `bulk.too_many_records`.
- **Dependencies:** BR-CRM-004, BR-PLT-005.
- **Working assumptions:** OD-31 (salesperson cannot bulk reassign).

### BR-CRM-014
> "Closing a deal as lost shall require a lost reason from an admin-defined list."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged | — |

- **Inputs / fields:** Lost reason (required, active Admin list); details (0–1,000); close date (default today). Admin list: label (1–100, unique), active flag, order.
- **Behaviour:** Moving to Closed Lost opens the dialog; the deal closes only when a reason is chosen. Open proposals keep their status; an open signature request triggers DR-CRM-05. Reasons feed BR-RPT-002. Deactivated reasons remain on historic deals.
- **Validations:** Reason required (`deal.lost_reason_required`); Admin cannot deactivate the last active reason.
- **System responses:** Deal status Lost; timeline "Closed Lost — <reason>".
- **Errors / exceptions:** Cancel → no change.
- **Dependencies:** BR-CRM-003, BR-RPT-002, DR-CRM-05.
- **Working assumptions:** OD-31.

### CRM derived requirements

**DR-CRM-01 — Archive behaviour.** *Derived — pending confirmation (from BR-CRM-001/002, ADR-005).* Archive applies to companies, contacts and closed deals. Archived records are hidden from default lists, board, search (unless "include archived"), pickers, matching suggestions and AI context; visible by direct link with a banner; included in historical reports and export; restorable by anyone who can edit them. Archiving a company does not archive its contacts. Emails from archived contacts are not auto-linked (treated as unknown, OD-29).

**DR-CRM-02 — Custom field formatting.** *Derived — pending confirmation (from BR-CRM-007, BR-TPL-002; foundation §9 WA).* Number: organization locale with configured decimals; currency: locale currency format with the record's currency; date: organization long date format in documents; dropdown: option label; multi-select: labels joined by ", " in option order; checkbox: "Yes"/"No"; empty: missing (BR-TPL-008).

**DR-CRM-03 — Custom field limits and deletion.** *Derived — pending confirmation (from BR-CRM-007).* Max 100 active custom fields per object; deletion archives the definition; values retained and exported; Admin can restore; type immutable.

**DR-CRM-04 — Reopening closed deals.** *Derived — pending confirmation (from BR-CRM-003, OD-31, OD-24).* Reopen requires a reason (1–500 chars), records the previous close date and lost reason on the timeline and never changes a Signed proposal. Reopening an automation-closed deal through "Reverse" follows BR-AUT-008/OD-24 (restores previous stage, amount, close date); a manual reopen does not restore pre-automation values.

**DR-CRM-05 — Manual Closed Lost with an open signature request.** *Derived — pending confirmation (from BR-CRM-014; foundation §9 lifecycle WA).* Dialog warns "This deal has an open signature request. It will be voided." Confirm voids the request (BR-SIG-013, reason "Deal closed lost") and closes the deal; cancel changes nothing.

**DR-CRM-06 — Manual Closed Won.** *Derived — pending confirmation (from BR-CRM-003, BR-AUT-002).* Requires amount (≥ 0) and close date (not in the future: `deal.close_date_in_future`). If an open signature request exists the user is warned and may void it.

**DR-CRM-07 — Deal contact roles list.** *Derived — pending confirmation (from BR-CRM-003, OD-34).* Admin maintains roles (label 1–60, unique, active flag). Seeded: Decision-maker, Signer, Influencer, Forwarded viewer (system, not removable, assigned by BR-SHR-005).

**DR-CRM-08 — Optimistic concurrency.** *Derived — pending confirmation (from ADR-016).* All edits carry `rowVersion`; on conflict the form keeps the user's unsaved values and offers reload.

**DR-CRM-09 — Deal requires company.** *Derived — pending confirmation (from BR-CRM-003, OD-33).* A deal cannot be saved without a company; inline company quick-create is offered.

**DR-CRM-10 — Stage removal.** *Derived — pending confirmation (from BR-CRM-005/006).* Removing a stage requires a target open stage; moves are recorded as system stage changes (actor `system`, reason "Stage removed by admin") and do not count as activity (OD-35).

---

## 5. EML — Email and calendar (BRD §9.4)

**Purpose.** Captures email and meeting activity automatically and lets users send from their own mailbox, removing manual logging and providing context for AI and timelines. Addresses P6 (admin time) and supports the "automatic activity capture ≥ 80%" metric (§12) and AC-04/AC-05.

**Primary users.** Salesperson, Sales Manager (own mailbox); Admin (organization switches, provider configuration).

**Interactions summary.** User connects mailbox and calendar via OAuth (company provider first, OD-06) → worker syncs mail and events every 2–5 minutes → messages/events are matched to contacts, companies and deals (OD-28/29) → user corrects links, excludes domains/contacts, marks private (OD-30) → user composes emails (templates, placeholders, proposal links) sent through their mailbox → inbox add-in shows CRM context and lets the user create records and send proposals from the inbox (OD-07) → optional open tracking (OD-37).

### BR-EML-001
> "Each user shall be able to connect a Gmail or Outlook mailbox."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | OD-06 (company provider first; second provider follow-up) |

- **Inputs / fields:** Provider choice (only providers enabled by the Admin); OAuth consent at the provider; sync start date (default 90 days back; options 30/90/180/365 days, DR-EML-06); connect calendar too (default on, BR-EML-006).
- **Behaviour:** Before first connection the user sees the employee mailbox privacy notice (what is synced, exclusions, private marking) and confirms (DR-EML-05). OAuth grants offline access with the minimum scopes (read, send, calendar read); tokens encrypted at rest (ADR-012). One mailbox per user. Initial back-fill runs as a background job; ongoing delta sync every 2–5 minutes. Connection status shown in profile: Connected, Syncing (with progress), Needs reconnection (token revoked/expired), Disconnected. Disconnect stops sync and revokes tokens; already-synced emails remain linked (subject to retention, OD-36). The mailbox address must be the user's own company address (equal to the user's sign-in email or an Admin-approved alias).
- **Validations:** Provider account email domain on the company allow list (`mailbox.domain_not_allowed`); a mailbox can be connected to only one user (`mailbox.already_connected`).
- **System responses:** "Mailbox connected. Importing the last 90 days of email — this can take a while." Notification when back-fill completes. Audit `mailbox.connected/disconnected`.
- **Errors / exceptions:** User denies consent → "Mailbox not connected. You can try again from your profile." Token revoked later → status "Needs reconnection", in-app and email notice "Your mailbox stopped syncing. Reconnect to continue." Provider outage/rate limit → sync retried with backoff; status shows last successful sync time.
- **Dependencies:** BR-EML-002/003/004/006, BR-PLT-008, BR-PLT-011 (deactivation stops sync), NFR-002/013.
- **Working assumptions:** OD-06; AC-04 "Gmail and Outlook" satisfied for the company's provider at launch, second provider follow-up (foundation §2).

### BR-EML-002
> "The platform shall automatically link sent and received emails to matching contacts, companies and deals, and users can correct the links."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | OD-28, OD-29 |

- **Inputs / fields:** Correction UI on each email: linked contacts (add/remove), company, deal (choose from the contact's deals or search), "Don't link this thread".
- **Behaviour:** For each synced message, participants (from, to, cc; bcc only for sent messages) are matched by normalised email to non-archived contacts. Messages with no matching participant are not stored unless they belong to an already-linked thread (OD-29). Matched messages are linked to the contacts, their company, and: the single open deal of those contacts if exactly one; if several, the open deal with the most recent activity, marked "auto — review suggested" (OD-28); no deal if none open. Users' corrections apply to the message and, by choice, to the whole thread. Linked emails appear on deal/company/contact timelines (BR-TIM-*) and count as activity (OD-35). Internal-only emails (all participants are users) are not stored. Excluded domains/contacts are skipped (BR-EML-003).
- **Validations:** Users can link only to records they can edit.
- **System responses:** Email entry on timelines with direction, participants, subject, snippet; "auto — review suggested" badge where applicable.
- **Errors / exceptions:** Correction on a record outside scope → 403.
- **Dependencies:** BR-EML-001/003, BR-TIM-001/003, BR-AUT-004/005, BR-AIA-001/003.
- **Working assumptions:** OD-27, OD-28, OD-29, OD-30.

### BR-EML-003
> "Users shall be able to exclude domains or contacts from syncing and mark emails as private."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | OD-30 |

- **Inputs / fields:** Personal exclusion list: domains (valid domain names, max 200 entries) and email addresses (max 500 entries); Admin organization-wide exclusion list (same format); per-email/thread "Mark private" toggle; per-contact "Always private" option.
- **Behaviour:** Excluded participants: messages where every external participant is excluded are not synced; existing stored messages of a newly excluded address/domain are removed from the CRM (DR-EML-04). Private email (OD-30): metadata (date, direction, participants) visible on timelines as "Private email"; subject and body visible only to the mailbox owner; excluded from AI context, search, reporting content and export bodies; counted as activity in reports. Marking private is reversible by the mailbox owner.
- **Validations:** Domain syntax; cannot exclude the company's own domain (`exclusion.own_domain`).
- **System responses:** "<domain> excluded. <n> previously synced emails removed."
- **Errors / exceptions:** Standard.
- **Dependencies:** BR-EML-002, BR-AIA-001/003/009, BR-PLT-010, BR-RPT-010, BR-TIM-*.
- **Working assumptions:** OD-29, OD-30.

### BR-EML-004
> "Users shall be able to send emails from the CRM through their own mailbox, using email templates with placeholders."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | NFR-013; OD-31 (template ownership); disposition aligned to SCOPE-RECONCILIATION.md §7.1 (§12 R2) |

- **Inputs / fields:** To/Cc/Bcc (1–50 total recipients, valid emails; picker suggests deal contacts); subject (required, 1–255); body (rich text, ≤ 1 MB); attachments (total ≤ 20 MB; files or the proposal PDF of a sent version); email template (optional); related record (deal/contact/company, pre-filled from context); open tracking toggle (BR-EML-007); schedule send not in scope. Email template: name (1–100), subject, body, placeholders (same placeholder catalogue as BR-TPL-002, plus `{{proposal.link}}` when sent with a proposal), scope personal | shared (shared: Admin, or Manager with template rights, OD-31).
- **Behaviour:** Compose from a record, timeline or the add-in. Selecting a template fills subject/body; placeholders are resolved against the related record at preview; unresolved placeholders are highlighted and block sending until filled or removed. Send goes through the user's mailbox provider API (appears in their Sent folder), is idempotent (DR-EML-02), and the sent message is linked immediately (not waiting for sync). Sending requires the user's explicit click (BR-AIA-006 applies to AI drafts).
- **Validations:** Mailbox connected (`mailbox.not_connected`: "Connect your mailbox to send email."); recipients valid; subject required; attachment limits; unresolved placeholders (`email.unresolved_placeholders`).
- **System responses:** "Email sent." Timeline entry "Email sent by <user>".
- **Errors / exceptions:** Provider rejects/send fails → "Your email couldn't be sent: <provider reason>. It has been saved as a draft in the CRM." `email.send_failed`; retry keeps the same idempotency key. Token expired → reconnection prompt; message not sent.
- **Dependencies:** BR-EML-001, BR-SHR-002, BR-AIA-005, BR-EML-007, DR-EML-02.
- **Working assumptions:** OD-31 (template rights).

### BR-EML-005
> "The platform shall provide a Gmail and Outlook add-in that shows the related CRM record and lets the user create records and send proposals from the inbox."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | OD-07 (company provider only at launch; after core email sync), OD-38 |

- **Inputs / fields:** Add-in context: the open message's sender/recipients. Create contact form (first/last name, email pre-filled, company), create company (name, domain pre-filled from sender domain unless free-mail, DR-LED-04), create deal (name, company, pipeline/stage, amount, close date). Send proposal: choose deal → choose a ready proposal version or create from template (opens web app) → choose recipients → insert share link into a reply/compose.
- **Behaviour:** User signs in once inside the add-in (bearer token, ADR-006). For the open message, the add-in shows matched contact(s) with company, open deals (stage, amount, close date), latest proposal status and recent timeline items, within the user's permissions. If no contact matches, it offers "Add to CRM" (creates contact, optionally company and deal; links the current message, overriding OD-29 non-storage for that thread). "Send proposal" generates share links for the chosen recipients (BR-SHR-001/003) and inserts them into the draft reply; the email is sent by the user from their inbox; the version is then considered sent (DR-PRP-06) when the add-in reports the send or the user confirms "Mark as sent". Gmail: Workspace add-on; Outlook: task-pane add-in (OD-07).
- **Validations:** As record creation (BR-CRM-001/002/003); proposal version must be ready to send (pre-send check run, BR-AIA-002).
- **System responses:** Record cards; "Contact added"; "Proposal link inserted. Send the email to share it."
- **Errors / exceptions:** Not signed in → sign-in card; token expired → re-sign-in; add-in cannot reach server → "Can't reach the CRM. Check your connection."; user lacks permission for the matched record → "This contact is owned by another team."
- **Dependencies:** BR-EML-001/002, BR-SHR-001/002/003, BR-PRP-001, BR-CRM-001/002/003, AC-05.
- **Working assumptions:** OD-06, OD-07, OD-29, OD-38.

### BR-EML-006
> "The platform shall sync calendars and log meetings with known contacts to the relevant timelines."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | OD-28 (same linking logic), OD-30 |

- **Inputs / fields:** Calendar connection (with mailbox); per-event "Don't log" and link corrections (as BR-EML-002).
- **Behaviour:** Sync primary calendar events from sync start date to 90 days ahead. Events with at least one attendee matching a known contact are logged to the contact(s), company and deal (same rules as OD-28). Stored fields: title, start/end, attendees, location/online link, organizer, description (description treated like email body: private events show metadata only). Updates and cancellations are reflected; cancelled meetings are marked cancelled on timelines. Meetings count as activity when the meeting end time has passed (OD-35). Upcoming meetings appear on My Day. Events marked private in the provider are stored as metadata only.
- **Validations:** n/a.
- **System responses:** Timeline entry "Meeting: <title>" with attendees.
- **Errors / exceptions:** As BR-EML-001 sync errors.
- **Dependencies:** BR-EML-001, BR-CRM-009/010, BR-TIM-001/003, BR-RPT-010.
- **Working assumptions:** OD-06, OD-28, OD-29, OD-30, OD-35.

### BR-EML-007
> "Users shall be able to turn on open tracking for emails sent from the CRM."

| Priority | Disposition | Basis |
|---|---|---|
| Should | Clarified | OD-37 |

- **Inputs / fields:** Admin org switch "Allow email open tracking" (default off); per-email toggle in compose (default off; visible only when allowed).
- **Behaviour:** When on, a tracking pixel is added to the sent email; opens are recorded (first open time, open count, last open time) and shown on the email and timeline as "Opened (approx.)". Opens are informational only — they do not trigger automation, notifications (beyond an optional in-app indicator) or proposal view tracking. Proposal views are tracked by share links (BR-SHR-004), not by pixels.
- **Validations:** Toggle unavailable when org switch off.
- **System responses:** Open indicators.
- **Errors / exceptions:** None user-facing.
- **Dependencies:** BR-EML-004.
- **Working assumptions:** OD-37 (consent; off by default).

### EML derived requirements

**DR-EML-01 — Unknown-sender minimisation.** *Derived — pending confirmation (from BR-EML-002, OD-29).* Messages with no known-contact participant are discarded after matching (only a hash of the message id is kept to avoid reprocessing); they become stored only via "Add to CRM" (BR-EML-005) or by joining an already-linked thread.

**DR-EML-02 — Idempotent email send.** *Derived — pending confirmation (from BR-EML-004, ADR-016).* Each send carries an idempotency key; repeated submissions (double click, retry after timeout) send at most one message; a retry after a definite provider failure reuses the key and the stored draft.

**DR-EML-03 — Token loss and reconnection.** *Derived — pending confirmation (from BR-EML-001).* On provider token revocation the connection moves to "Needs reconnection"; sync resumes from the last delta cursor after reconnection without duplicates (dedupe by provider message id).

**DR-EML-04 — Retroactive exclusion.** *Derived — pending confirmation (from BR-EML-003).* Adding an exclusion removes previously stored messages whose external participants are all excluded (hard delete of bodies, timeline entries removed); messages also involving non-excluded contacts are kept.

**DR-EML-05 — Employee mailbox privacy notice.** *Derived — pending confirmation (from BR-EML-001, NFR-002; foundation §9 compliance).* The connection flow shows an Admin-maintained notice (text owned by Legal) and records the user's acknowledgement time and notice version.

**DR-EML-06 — Back-fill window.** *Derived — pending confirmation (from BR-EML-001, OD-45).* Initial sync window selectable 30/90/180/365 days (default 90); Admin can cap the maximum.

---

## 6. LED — Lead capture (BRD §9.5)

**Purpose.** Turns website enquiries into assigned CRM records with immediate notification, so leads are not entered manually or lost. Addresses P7; supports AC-06 and §11 step 1.

**Primary users.** Admin (forms, assignment rules); Salesperson (receives leads); website visitors (submit forms).

**Interactions summary.** Admin builds a form (fields mapped to contact/company/deal fields) → embeds it on the company website or uses the hosted page → visitor submits → spam checks (OD-46) → duplicate matching (OD-27) → create/update contact and company, optionally deal → assignment rule picks the owner → owner notified immediately → source information stored. Optional webhook intake for existing forms (Could).

### BR-LED-001
> "Admins shall be able to build web forms and embed them on their website. Submissions create or update contacts and companies, and optionally create deals."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | OD-33, OD-27 |

- **Inputs / fields:** Form: name (1–100, unique), status (draft | active | inactive), fields (1–30) each with label (1–100), mapped target (contact standard/custom field, company field, deal field, or "submission only"), input type compatible with target type, required flag, placeholder text, help text, options for dropdowns; email field mandatory and required; consent/privacy text and optional consent checkbox (DR-LED-02); submit button label; success message or redirect URL (https); create deal option (off | on) with pipeline, stage, deal name pattern (e.g. "<Company> — Website enquiry"), amount default 0, expected close date offset (days, 0–365, default 30); assignment rule set (BR-LED-002); allowed embed domains (for the embed script).
- **Behaviour:** Form preview in builder. Publishing produces an **iframe-only** embed snippet (an `<iframe>` of the hosted form page on the buyer origin, auto-resized via postMessage; no cross-origin posting script — A2, foundation §16 S4) and the hosted page URL on the buyer app domain. On submission: spam checks (BR-LED-006) → normalise → match contact by email; match company by email domain (unless free-mail, DR-LED-04) or by company name field (OD-27, OD-33) → create missing records or update existing (update rule: fill empty fields only; never overwrite non-empty values; differing values stored on the submission and shown to the owner) → optionally create a deal linked to company and contact (the contact is added without a role; the owner assigns roles later) — only when a company was resolved: a deal requires a company (OD-33), so a submission without a resolvable company (free-mail domain and no company name) creates/updates and assigns the contact without creating a deal (§12 resolution R3); a repeat submission reuses an open deal within the suppression window (OD-61) → assign owner (BR-LED-002) for newly created records; existing records keep their owner, a new deal gets the assigned owner → notify (BR-LED-003) → store source (BR-LED-005) → timeline "Form submitted: <form>". Inactive forms reject submissions.
- **Validations (builder):** At least an email field; mapped types compatible; redirect URL https; unique field keys. **Validations (submission):** required fields present; email valid; field lengths per target type; dropdown values valid.
- **System responses:** Visitor sees success message/redirect. Admin sees submission list with outcome (created/updated/duplicate-merged/spam-rejected).
- **Errors / exceptions (visitor):** Field errors shown inline in the form ("Please enter a valid email address."); server error → "Something went wrong. Please try again later." Submission is stored before processing so a processing failure is retried by the worker and does not lose the lead (DR-LED-03).
- **Dependencies:** BR-LED-002/003/004/005/006, BR-CRM-001/002/003/007.
- **Working assumptions:** OD-27, OD-33, OD-46.

### BR-LED-002
> "Admins shall be able to define assignment rules: round-robin, or by field value such as region or product."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | OD-54 item o (no-match fallback); analysis WA (deactivated users leave round-robin); disposition aligned to SCOPE-RECONCILIATION.md §7.1 (§12 R2) |

- **Inputs / fields:** Rule set per form (or a default rule set): ordered rules, each: condition (form field / mapped field equals / is any of values; or "always") and action (assign to user, or round-robin among a list of active users or a team); fallback owner (required).
- **Behaviour:** Rules evaluated top-down; first match wins. Round-robin rotates among eligible active users in a fixed order, persisting the pointer per rule (concurrency-safe; two simultaneous submissions never pick the same pointer value). Deactivated users are skipped automatically (BR-PLT-011). If no rule matches or no eligible user remains → fallback owner; if fallback is inactive → first active Admin and the Admin is notified "Assignment rule needs attention" (DR-LED-01).
- **Validations:** Fallback required; each round-robin list ≥ 1 user; values for field conditions validated against the field type/options.
- **System responses:** Assignment outcome stored on the submission ("Assigned by rule 2: Region = EMEA → round-robin").
- **Errors / exceptions:** Rule references an archived field → rule flagged inactive with warning in the builder.
- **Dependencies:** BR-LED-001/003, BR-PLT-011.
- **Working assumptions:** —

### BR-LED-003
> "The assigned salesperson shall be notified of a new lead immediately."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged | NFR-005 (≤ 1 minute) |

- **Inputs / fields:** None (preferences per BR-NTF-002; this notification's in-app channel cannot be disabled — email can).
- **Behaviour:** Event `new_lead_assigned` → in-app real-time notification and email to the assigned owner within 1 minute of submission processing: "New lead: <name>, <company> from <form>", linking to the contact/deal. If the submission matched an existing contact owned by someone else, that owner is notified instead with "Existing contact submitted <form>".
- **Validations:** n/a.
- **System responses / errors:** Email delivery failure logged and retried; in-app notification still shown.
- **Dependencies:** BR-NTF-001/002, BR-LED-002.
- **Working assumptions:** OD-14.

### BR-LED-004
> "Submissions shall be checked against existing records to avoid duplicates."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | OD-27 |

- **Inputs / fields:** None (automatic).
- **Behaviour:** Contact matched by normalised email (primary or additional) including archived contacts (an archived match is linked, not restored, and flagged "archived contact resubmitted" for the owner to decide, DR-LED-05). Company matched by normalised domain (excluding free-mail domains, DR-LED-04), else by exact normalised name. Deal: a new deal is not created if the contact already has an open deal in the same pipeline created from the same form within the last 30 days (DR-LED-05); the submission is added to that deal's timeline instead. Fuzzy name similarities are shown on the submission as "possible duplicate" suggestions only.
- **Validations:** n/a.
- **System responses:** Submission outcome: created | matched existing (updated) | matched existing (no change) | deal suppressed (duplicate).
- **Errors / exceptions:** None for the visitor.
- **Dependencies:** BR-LED-001, BR-MIG-003 (shared matching rules).
- **Working assumptions:** OD-27.

### BR-LED-005
> "The platform shall record lead source information (campaign tags, page) on the record."

| Priority | Disposition | Basis |
|---|---|---|
| Should | Unchanged | — |

- **Inputs / fields (captured automatically):** page URL, referrer URL, UTM parameters (utm_source, utm_medium, utm_campaign, utm_term, utm_content; each ≤ 255 chars), form name, submission time; optional hidden fields defined in the builder.
- **Behaviour:** Stored on the submission; first-touch values copied to the new contact/deal fields "Original source", "Original campaign", "Original page" (system fields, filterable and reportable); later submissions are stored on the submission and timeline only (first-touch not overwritten).
- **Validations:** Values truncated to 255 chars; URLs stored without fragments.
- **System responses:** Source shown on record and submission.
- **Errors / exceptions:** None.
- **Dependencies:** BR-LED-001, BR-RPT-* (filtering by source).
- **Working assumptions:** —

### BR-LED-006
> "Forms shall include spam protection."

| Priority | Disposition | Basis |
|---|---|---|
| Should | Clarified | OD-46 |

- **Inputs / fields:** Form setting: CAPTCHA on/off (requires configured CAPTCHA credentials); rate limits (defaults below).
- **Behaviour:** Honeypot hidden field; minimum time-to-submit (submissions completed in < 2 seconds after render are rejected); per-IP rate limit (default 5 submissions per 10 minutes per form) stored in Postgres; optional CAPTCHA (Cloudflare Turnstile) verified server-side. Rejected submissions are stored as "spam-rejected" (no records created) for 30 days for Admin review; Admin can "Process anyway".
- **Validations:** CAPTCHA token required when enabled.
- **System responses:** Visitor sees a generic success message for honeypot rejections (to avoid teaching bots) and "Please try again in a few minutes." for rate limits; CAPTCHA failure → "Please complete the verification."
- **Errors / exceptions:** CAPTCHA provider unavailable → submission accepted and marked "unverified" for Admin review (fail-open, pending confirmation).
- **Dependencies:** BR-LED-001.
- **Working assumptions:** OD-46.

### BR-LED-007
> "The platform shall accept leads from existing website forms through a webhook."

| Priority | Disposition | Basis |
|---|---|---|
| Could | Unchanged (capacity permitting) | ADR-024 extension point |

- **Inputs / fields:** Webhook endpoint per form with secret; JSON or form-encoded payload; field-name mapping to form fields.
- **Behaviour:** Authenticated by shared secret (header HMAC-SHA256 of body). Payload processed through the same pipeline as BR-LED-001 (spam rate limits apply; CAPTCHA not applicable). Responds 202 Accepted with submission id; idempotent by optional `Idempotency-Key` header.
- **Validations:** Signature valid; payload ≤ 64 KB; mapped required fields present.
- **System responses:** 202; 400 with field errors; 401 invalid signature; 429 rate limited.
- **Dependencies:** BR-LED-001/002/004.
- **Working assumptions:** Built only if capacity allows (BRD Could).

### LED derived requirements

**DR-LED-01 — Assignment fallback and rule health.** *Derived — pending confirmation (from BR-LED-002, BR-PLT-011).* Rules referencing inactive users or archived fields are flagged in the Admin UI; fallback order: rule target → fallback owner → first active Admin (with Admin notification).

**DR-LED-02 — Form privacy text and consent.** *Derived — pending confirmation (from BR-LED-001, NFR-002).* Each form displays an Admin-maintained privacy notice link; an optional consent checkbox (label text Legal-approved) whose value and timestamp are stored on the submission and contact.

**DR-LED-03 — Durable submission intake.** *Derived — pending confirmation (from BR-LED-001, NFR-006).* Every accepted submission is persisted before processing; processing is a retried background job; failures after retries surface to the Admin as "Unprocessed submissions" with a retry action.

**DR-LED-04 — Free-mail domain exclusion.** *Accepted as working assumption by foundation §12 resolution R3 (from OD-27, OD-26, OD-33, BR-LED-001/004).* An Admin-maintained list of public email domains (e.g. gmail.com, outlook.com, yahoo.com; seeded, editable in organization settings) is never used for company matching or creation; for such submitters the company comes from the company-name field if present, otherwise no company (and no deal, since a deal requires a company, OD-33 — the contact is created/updated and assigned without a deal, and the owner is asked to complete the company; §12 R3). The same exclusion applies to forwarded-viewer company assignment (OD-26) and email linking (BR-EML-002).

**DR-LED-05 — Resubmissions.** *Derived — pending confirmation (from BR-LED-004).* Archived contact match → contact linked (not restored) and owner notified "Archived contact resubmitted"; duplicate-deal suppression window 30 days per contact + pipeline + form.

**DR-LED-06 — Submission retention.** *Derived — pending confirmation (from NFR-015, OD-36).* Submissions retained per the "lead submissions" retention category; spam-rejected submissions deleted after 30 days.

---

## 7. TPL — Templates and content library (BRD §9.6)

**Purpose.** Gives the organization controlled, branded, reusable proposal templates and content blocks with CRM placeholders, so proposals are fast, consistent and correct. Addresses P1 (slow, error-prone proposals) and P8 (knowledge stays with individuals).

**Primary users.** Admin; Sales Manager when granted template/content rights (BRD §9.17 "Optional"); Salesperson consumes templates.

**Interactions summary.** Admin (or granted Manager) creates a template in the block editor (sections → text, images, tables, pricing table, content block references, signature block) → inserts placeholders → marks sections locked/editable → publishes, creating an immutable template version → salespeople create proposals pinned to that version (BR-PRP-001) → branding from organization settings applies to rendering → missing placeholder values are flagged before generation.

### BR-TPL-001
> "Authorized users shall be able to create and edit proposal templates with sections, text, images and tables."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified (authorization, draft/publish) | BRD §9.17; ADR-010; DR-TPL-01 |

- **Inputs / fields:** Template: name (1–200, unique among non-archived), description (0–500), category/tags (0–10, each 1–50), default pricing table settings (BR-PRC-002), cover page on/off. Sections: title (1–200), order, lock flag (BR-TPL-003), "required section" flag (used by BR-AIA-002 missing required sections). Blocks: rich text (headings, paragraphs, lists, bold/italic/underline, links https/mailto only, placeholders), image (PNG/JPEG/SVG/WebP ≤ 5 MB, alt text required for accessibility NFR-011, width options), table (1–20 columns, 1–200 rows, header row option, cell text with placeholders), pricing table (one or more, BR-PRC-002), content block reference (BR-TPL-005), page break, signature block (signer role placeholders for BR-SIG-002), AI draft slot (marks a section where BR-AIA-001 drafting is offered).
- **Behaviour:** Authorized = Admin, or Sales Manager with template rights. Templates have a working draft and published versions (DR-TPL-01). Editing changes the draft only; "Publish" creates a new immutable version. Proposals use only published versions. Templates can be duplicated and archived (archived templates cannot be chosen for new proposals; existing proposals unaffected). Live preview with sample or chosen deal data.
- **Validations:** Name required/unique (`template.duplicate_name`); at least one section to publish; image type/size; alt text required for images; links protocol; unknown placeholders rejected at publish (`template.unknown_placeholder`); sanitisation of pasted HTML (no scripts/styles beyond allowed marks).
- **System responses:** "Draft saved" (autosave every 10 s and on blur); "Version <n> published."
- **Errors / exceptions:** Concurrent editing by two authors → second save gets 409 with "This template was changed by <user>. Reload to continue." (no real-time co-editing in Phase 1).
- **Dependencies:** BR-TPL-002/003/004/006/008, BR-PRC-002, BR-PRP-001.
- **Working assumptions:** OD-31 (manager rights flag), foundation §9 (template change WA).

### BR-TPL-002
> "Templates shall support placeholders from standard and custom fields of companies, contacts, deals, owners and the organization."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified (formatting, contact selection) | DR-CRM-02, DR-TPL-03 |

- **Inputs / fields:** Placeholder picker listing: `company.*` (standard + custom), `deal.*` (standard + custom, including amount, currency, expected close date), `contact.*` for the deal's primary contact and role-based contacts (e.g. `contact[Signer].firstName`, `contact[Decision-maker].fullName`), `owner.*` (name, title, email, phone), `organization.*` (name, legal name, address, website), `proposal.*` (number, title, date, validity date, version), pricing totals (`pricing.oneTimeTotal`, `pricing.recurringTotal`, `pricing.tcv`). Each placeholder may carry a fallback text.
- **Behaviour:** Placeholders are structured nodes, not free text. They resolve at proposal creation and at each new version creation from current CRM data (foundation §9 WA) and are frozen into the version snapshot on send. Formatting per DR-CRM-02. Role-based contact placeholders resolve to the first deal contact holding that role (ordered by when the role was added); "primary contact" = the deal contact chosen as primary on the proposal (default: first Decision-maker, else first contact).
- **Validations:** Only known paths can be inserted; archived custom fields displayed as "archived field" and flagged (BR-TPL-008).
- **System responses:** Placeholders shown as chips in the editor; preview shows resolved values.
- **Errors / exceptions:** Missing values → BR-TPL-008.
- **Dependencies:** BR-CRM-007, BR-PLT-012, BR-PRP-002, BR-TPL-008, BR-EML-004 (same catalogue).
- **Working assumptions:** Foundation §9 custom field formatting WA; OD-34 (roles).

### BR-TPL-003
> "Admins shall be able to mark template sections as locked or editable by salespeople."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged | BRD §9.17 (who may lock); disposition aligned to SCOPE-RECONCILIATION.md §7.1 (§12 R2) |

- **Inputs / fields:** Per section: Locked (default) | Editable.
- **Behaviour:** Only Admins set the flag (§12 resolution R8; PERM-096). Managers with template rights may edit templates but cannot change a section's lock state or edit a locked section's content. In proposals, locked sections are read-only for every role, Admin included, and every user including the proposal owner; only editing the template (new template version) changes them (§12 R8, OD-81 e); their placeholders still resolve and pricing tables in locked sections remain editable only if the pricing table itself is marked "editable pricing" (default editable — pricing is deal-specific). Editable sections allow full rich-text editing (BR-PRP-003). Salespeople cannot reorder or delete locked sections; they may add new sections only if the template allows "additional sections" (template setting, default on), and added sections are editable.
- **Validations:** n/a.
- **System responses:** Lock icon on locked sections in the proposal editor with tooltip "Locked by your administrator."
- **Errors / exceptions:** Attempted API edit of a locked section → `proposal.section_locked` (403).
- **Dependencies:** BR-PRP-003, BR-TPL-001.
- **Working assumptions:** —

### BR-TPL-004
> "The platform shall keep template versions and record which version each proposal used."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified (version-creation semantics) | DR-TPL-01; foundation §9 |

- **Inputs / fields:** Publish note (optional, 0–500).
- **Behaviour:** Each publish creates version n+1 with an immutable snapshot of sections, blocks and settings, publisher and timestamp. A proposal records the template id and version at creation; template changes never alter existing proposals or their versions; new proposal versions keep their own content (foundation §9). Version history lists versions with publisher, date, note and the number of proposals using each; any version can be viewed and "restored to draft" (copies it into the working draft).
- **Validations:** Publishing an unchanged draft is rejected ("No changes since version <n>." `template.no_changes`).
- **System responses:** Version list; proposal detail shows "Template: <name> v<n>".
- **Errors / exceptions:** Standard.
- **Dependencies:** BR-TPL-001, BR-PRP-001/006.
- **Working assumptions:** Foundation §9 template change WA.

### BR-TPL-005
> "The platform shall provide a library of reusable content blocks (case studies, team bios, terms) for insertion into proposals."

| Priority | Disposition | Basis |
|---|---|---|
| Should | Unchanged | — |

- **Inputs / fields:** Content block: title (1–200, unique), category (Admin list, e.g. Case study, Team bio, Terms), tags, body (rich text, images, tables, placeholders), locked-on-insert flag (default on for Terms).
- **Behaviour:** Authorized users (as BR-TPL-001) maintain the library with versioning on publish (same model as templates). Blocks can be referenced in templates or inserted into editable sections of a proposal by salespeople (searchable picker with preview). Insertion copies the current published block version into the proposal (reference recorded for reporting); later block edits do not change existing proposals. Archived blocks cannot be inserted.
- **Validations:** As templates.
- **System responses:** "Block inserted."
- **Errors / exceptions:** Standard.
- **Dependencies:** BR-TPL-001, BR-PRP-003.
- **Working assumptions:** —

### BR-TPL-006
> "Organization branding (logo, colors, fonts) shall be applied to templates and the buyer-facing view."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged | BR-PLT-012 |

- **Inputs / fields:** From organization settings (logo, primary/secondary colour, heading/body fonts); per-template override of cover image (optional).
- **Behaviour:** One renderer applies branding consistently to editor preview, internal preview (BR-PRP-004), buyer view (BR-SHR-009), PDF and DOCX (BR-PRP-005). Branding is captured into the version snapshot at send, so later branding changes do not alter sent versions.
- **Validations:** As BR-PLT-012.
- **System responses / errors:** Missing logo → text organization name used.
- **Dependencies:** BR-PLT-012, BR-PRP-004/005, BR-SHR-009, NFR-011.
- **Working assumptions:** OD-43.

### BR-TPL-007
> "The platform shall provide starter templates for the priority industries."

| Priority | Disposition | Basis |
|---|---|---|
| Should | Modified | IDD-11 |

- **Specification:** Replaced by company starter template(s) supplied at go-live as configuration content (seed data loaded by an Admin action "Load starter templates"), built with the same template model, published as version 1, editable afterwards. No industry template packs (Phase 3 §15.2). Content owner: Sales Ops.
- **Dependencies:** BR-TPL-001/004.

### BR-TPL-008
> "The platform shall flag missing placeholder values before a proposal is generated."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified (blocking rule, archived fields) | DR-TPL-03 |

- **Inputs / fields:** Missing-values panel: per missing placeholder a link to the source record field (edit inline) or "use fallback"/"enter value for this proposal" (proposal-level override).
- **Behaviour:** Checked on proposal creation, on opening the editor, on preview, on new version creation and before send/PDF/DOCX generation. A placeholder is missing when its resolved value is empty and it has no fallback, or it references an archived field or a role with no contact. Missing placeholders are highlighted in the document. Draft saving and preview are allowed with missing values; generating the final PDF/DOCX for sending, sending, and requesting signatures are blocked until resolved (`proposal.missing_placeholders`: "Fill in <n> missing values before sending."). Internal "draft PDF" download (watermarked "Draft") is allowed.
- **Validations:** Override values validated by field type.
- **System responses:** Panel "3 values missing" with list.
- **Errors / exceptions:** As above.
- **Dependencies:** BR-TPL-002, BR-PRP-002/005, BR-SHR-002, BR-SIG-001, BR-AIA-002.
- **Working assumptions:** Foundation §9 (archived custom fields flagged).

### TPL derived requirements

**DR-TPL-01 — Template draft/publish and version semantics.** *Derived — pending confirmation (from BR-TPL-001/004).* Templates and content blocks have one working draft plus immutable published versions; only published versions are usable; publish increments version; restore copies a past version into the draft; archive affects only new usage.

**DR-TPL-02 — Template health check.** *Derived — pending confirmation (from BR-TPL-008, BR-CRM-007).* When a custom field, contact role or content block referenced by a template is archived, the template is flagged "needs review" in the template list, and authors are notified in-app.

**DR-TPL-03 — Placeholder fallback and overrides.** *Derived — pending confirmation (from BR-TPL-002/008).* Placeholders may define fallback text in the template; proposal-level overrides are stored on the proposal version (not written back to CRM unless the user edits the CRM field) and are visible in version comparison.

**DR-TPL-04 — Template permissions.** *Derived — pending confirmation (from BRD §9.17, OD-31).* Create/edit/publish/archive templates and content blocks: Admin; Sales Manager only with the Admin-granted rights flag; Salesperson read/use only.

---

## 8. PRC — Product catalog and pricing tables (BRD §9.7)

**Purpose.** Replaces single-amount proposals with accurate, catalog-based pricing tables (one-time and recurring, discounts, taxes, totals) and keeps the deal amount consistent with the proposal. Addresses P1 (errors in proposals) and enables accurate pipeline value for P5.

**Primary users.** Admin (catalog, tax categories, discount limits, currencies, exchange rates); Sales Manager with catalog rights; Salesperson (pricing tables in proposals).

**Interactions summary.** Admin maintains products, tax categories, currencies, exchange rates and discount limits → salesperson adds catalog or ad-hoc lines to a proposal pricing table → system computes line totals, discounts, taxes, one-time and recurring subtotals and TCV (OD-16/OD-44) → warns on discount over limit (OD-39) → on save/send, prompts to update the deal amount when different.

### BR-PRC-001
> "Admins shall be able to maintain a product and service catalog with name, description, unit, unit price and tax category."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged | BRD §9.17 (Manager optional rights) |

- **Inputs / fields:** Product: name (required, 1–200, unique among active), SKU/code (optional, 0–50, unique), description (rich text 0–5,000), unit (required; Admin list e.g. each, hour, day, month, user, licence), unit price (required, ≥ 0, 4 decimals) in the organization default currency, optional prices in other enabled currencies, tax category (required), billing type (one-time | recurring), billing period for recurring (monthly | quarterly | annual, OD-44), active flag. Tax category: name (1–100, unique), rate % (0–100, 4 decimals), description.
- **Behaviour:** Admin (or Manager with catalog rights) creates, edits, archives products and tax categories. Price changes affect only lines added afterwards; existing proposal lines keep their prices (DR-PRC-03). Archived products cannot be added to new pricing tables. Tax categories in use cannot be deleted, only archived.
- **Validations:** As fields; recurring requires billing period (`product.billing_period_required`); SKU unique (`product.duplicate_sku`).
- **System responses:** "Product saved." Catalog list with search and filters (active, billing type, tax category).
- **Errors / exceptions:** Standard.
- **Dependencies:** BR-PRC-002/003/006.
- **Working assumptions:** OD-44.

### BR-PRC-002
> "Proposals shall include pricing tables with line items, quantities, unit prices, discounts (per line or overall), taxes, subtotals and totals."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified (calculation order, rounding) | OD-44; DR-PRC-01 |

- **Inputs / fields:** Pricing table: title (0–200), currency (= proposal/deal currency, OD-15), column visibility (show/hide quantity, unit, discount, tax columns to buyer), tax display (exclusive — default; inclusive not supported in Phase 1). Line: product (catalog pick) or ad-hoc (name required 1–200), description (0–2,000), quantity (> 0, 4 decimals), unit, unit price (≥ 0, 4 decimals; pre-filled from catalog in the table currency; editable unless the Admin disables price override — default editable), line discount (percent 0–100 or amount ≥ 0 and ≤ line gross), tax category (pre-filled from product, editable), billing type and period (from product, OD-44), optional flag not supported (Phase 2). Overall discount: percent 0–100 or amount, applied separately to the one-time and recurring groups (user chooses group(s)).
- **Behaviour:** Calculation per DR-PRC-01: line gross = qty × unit price; line net = gross − line discount; overall discount allocated pro rata to line nets within the chosen group; tax per line = (line net after allocated overall discount) × tax rate; group subtotal (before tax), group discount total, group tax total by tax category, group total; TCV per OD-16. Lines reorderable; section headings/subtotal rows optional. Totals recalculate instantly in the editor and authoritative values are recalculated server-side on save. Pricing tables may appear in locked sections and still be editable (BR-TPL-003).
- **Validations:** Quantity > 0 (`pricing.invalid_quantity`); discount ≤ line gross (`pricing.discount_exceeds_amount`); at least one line before send if the template marks the pricing table required; totals must be ≥ 0.
- **System responses:** Totals area: per group subtotal, discount, tax lines per category, total; and "Total contract value (excl. tax)" when recurring lines exist.
- **Errors / exceptions:** Server/client total mismatch → server values win and the editor refreshes with notice "Totals were recalculated."
- **Dependencies:** BR-PRC-001/003/004/007, BR-PRP-002, BR-AIA-002 (figure consistency).
- **Working assumptions:** OD-15, OD-16, OD-44.

### BR-PRC-003
> "Pricing tables shall separate one-time and recurring items, with separate totals."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | OD-44, OD-16 |

- **Inputs / fields:** Proposal term in months (`termMonths`, integer 1–120, default 12); per recurring line: billing period.
- **Behaviour:** Lines are grouped into "One-time" and "Recurring" groups with separate subtotals, discounts, taxes and totals. Recurring totals are displayed per billing period (e.g. "€1,000 / month") grouped by period; a recurring annualised or per-term figure is shown as TCV component. TCV (excl. tax) = one-time total excl. tax + Σ(recurring line net per period × number of periods in termMonths) (OD-16). Number of periods = termMonths ÷ period months (monthly 1, quarterly 3, annual 12); if not a whole number, rounded up and a warning shown ("Term isn't a whole number of billing periods.").
- **Validations:** termMonths range; recurring line requires period.
- **System responses:** Separate totals blocks; TCV shown when recurring lines exist.
- **Errors / exceptions:** As above.
- **Dependencies:** BR-PRC-002/004, BR-AUT-002.
- **Working assumptions:** OD-16, OD-44.

### BR-PRC-004
> "When the proposal total differs from the deal amount, the user shall be prompted to update the deal amount."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified (which total) | OD-16 |

- **Inputs / fields:** Prompt choice: "Update deal amount to <TCV>" | "Keep <deal amount>".
- **Behaviour:** Compared value = proposal TCV excluding tax (OD-16), in the deal currency. Prompt shown when saving the pricing table and again at send if values differ; also shown on Accepted/Signed handling (BR-AUT-002 sets the amount automatically on signing). Choosing update changes the deal amount (timeline "Amount changed from X to Y from proposal <number>"). Choosing keep records the decision on the proposal version so the prompt is not repeated for the same values. When a deal has several open proposals (OD-23), the prompt shows which proposal it relates to.
- **Validations:** User must have edit rights on the deal; otherwise the prompt is informational only ("The deal amount differs; ask the owner to update it.").
- **System responses:** "Deal amount updated."
- **Errors / exceptions:** Deal changed concurrently → 409 and re-prompt.
- **Dependencies:** BR-PRC-002/003, BR-CRM-003, BR-AUT-002.
- **Working assumptions:** OD-16, OD-23.

### BR-PRC-005
> "Each organization shall have a default currency."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged | BR-PLT-012 |

- **Inputs / fields:** Default currency (ISO-4217) in organization settings; required at bootstrap.
- **Behaviour:** Default for new deals, products' base price, reports' reporting currency, and company/contact currency custom fields. Changing it affects only new records and reporting conversion (BR-PLT-012).
- **Validations:** Valid ISO-4217 code from supported list.
- **System responses / errors:** As BR-PLT-012.
- **Dependencies:** BR-PLT-012, BR-PRC-006, BR-RPT-*.
- **Working assumptions:** OD-15.

### BR-PRC-006
> "Deals and proposals shall support a currency other than the organization's default."

| Priority | Disposition | Basis |
|---|---|---|
| Should | Clarified | OD-15 |

- **Inputs / fields:** Enabled currencies list (Admin); deal currency; exchange-rate table (DR-PRC-02).
- **Behaviour:** A deal may use any enabled currency; a proposal always uses its deal's currency (no independent proposal currency). Catalog prices in that currency are used if defined; otherwise the base price is converted using the current exchange rate and flagged "converted price — review" on the line. Reports convert deal and proposal values to the organization default currency using the rate effective on the relevant date (close date for won/lost, report date for open pipeline) (DR-PRC-02, DR-RPT-01).
- **Validations:** Currency must be enabled; reporting requires a rate for every non-default currency in use — missing rate → values excluded and a warning on the dashboard ("<n> deals in <CUR> excluded: no exchange rate.").
- **System responses:** Amounts always shown with currency code/symbol.
- **Errors / exceptions:** As above; currency lock after send (BR-CRM-003).
- **Dependencies:** BR-PRC-005, BR-CRM-003, BR-RPT-*, DR-PRC-02.
- **Working assumptions:** OD-15.

### BR-PRC-007
> "The platform shall warn when a discount exceeds a limit set for the user's role. Approval workflows are Phase 2."

| Priority | Disposition | Basis |
|---|---|---|
| Should | Clarified | OD-39 |

- **Inputs / fields:** Admin discount limits per role: maximum line discount % and maximum overall discount % (0–100; blank = no limit).
- **Behaviour:** Effective discount % per line = line discount ÷ line gross; overall = (sum of all discounts incl. allocated) ÷ gross total per group. When exceeding the proposal owner's role limit, a non-blocking warning is shown in the editor and at send ("Discount 25% exceeds your limit of 15%."); on send the exceedance (values, limit, user) is recorded on the proposal version and appears on the deal timeline and is visible to managers. No approval step (Phase 2).
- **Validations:** None blocking.
- **System responses:** Warning badge on the line and totals.
- **Errors / exceptions:** n/a.
- **Dependencies:** BR-PRC-002, BR-PLT-005.
- **Working assumptions:** OD-39.

### PRC derived requirements

**DR-PRC-01 — Calculation and rounding.** *Working assumption per foundation §12 resolution R11, pending OD-49 (from BR-PRC-002/003; owner Finance).* Catalog prices are tax-exclusive; tax is computed per line, then summed. All intermediate calculations at full precision; each line's net, discount and tax amounts rounded to the currency's minor units (2 decimals; 0 for zero-decimal currencies) using round-half-up; totals = sums of rounded line amounts; overall-discount allocation remainder assigned to the largest line.

**DR-PRC-02 — Exchange-rate table.** *Derived — pending confirmation (from BR-PRC-006, OD-15, OD-57).* Catalog prices are held in the organization default currency; a line added to a proposal in another currency converts the catalog price at the rate effective at line creation, and the user may edit the converted price; if no rate exists the user must enter the unit price (§12 resolution R10, OD-57). Admin maintains rates: from currency, to = organization default, rate (positive, 8 decimals), effective date; one rate per currency per date; the applicable rate is the latest with effective date ≤ the conversion date. Rates are audited. No automatic rate feed in Phase 1.

**DR-PRC-03 — Price snapshot.** *Derived — pending confirmation (from BR-PRC-001/002).* Proposal lines copy product name, description, unit, price and tax rate at the time they are added; catalog changes never alter existing proposals; a "refresh from catalog" action on a draft updates selected lines explicitly.

**DR-PRC-04 — Tax rate snapshot.** *Derived — pending confirmation (from BR-PRC-001/002).* Tax rate changes in a tax category apply to new lines and to draft lines on "refresh"; sent versions keep their frozen rates.

---

## 9. PRP — Proposal generation (BRD §9.8)

**Purpose.** Creates proposals from deals and templates, populated with CRM data and pricing, editable within template rules, previewable exactly as the buyer sees them, exportable as PDF/DOCX, versioned and comparable, with a defined status lifecycle. Addresses P1 (speed/errors) and P3 (version confusion).

**Primary users.** Salesperson (create/edit/send own deals' proposals); Sales Manager and Admin (same within scope).

**Interactions summary.** From a deal, select a published template → proposal created (pinned template version, placeholders resolved, pricing table) → edit editable sections, pricing, AI drafts (AIA) → resolve missing values (BR-TPL-008) → preview → pre-send check (BR-AIA-002) → share (SHR) which freezes the version (Sent) → buyer views (Viewed) → accept/decline (OD-17) or signature (SIG) → Signed/Declined/Expired/Void; revisions create new versions with comparison.

### BR-PRP-001
> "Salespeople shall be able to create a proposal from a deal by selecting a template."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | OD-23 (multiple proposals per deal allowed); disposition aligned to SCOPE-RECONCILIATION.md §7.1 (§12 R2) |

- **Inputs / fields:** Deal (context); template (required; active published templates); proposal title (default "<Template name> — <Deal name>", 1–200); primary contact (from deal contacts; default per BR-TPL-002); recipients may be chosen later (BR-SHR-003); validity date (default today + organization default validity days, BR-PRP-009).
- **Behaviour:** Allowed for users who can edit the deal (salesperson: own deals; manager: team; admin: all — BRD §9.17). Creates proposal (status Draft) with version 1 (state draft), unique proposal number (format `P-<year>-<6-digit sequence>`), template id + version pinned (BR-TPL-004), content copied from the template version, placeholders resolved (BR-PRP-002), pricing table pre-filled (BR-PRP-002). A deal may have multiple proposals (OD-23). Proposals can only be created on open deals (`proposal.deal_closed`: "Reopen the deal to create a proposal.") — DR-PRP-08. Timeline "Proposal <number> created".
- **Validations:** Deal open; template published and active; user permission.
- **System responses:** Opens the proposal editor; missing values panel if any (BR-TPL-008).
- **Errors / exceptions:** No published templates → "No templates are available. Ask your administrator to publish one."
- **Dependencies:** BR-TPL-001/004, BR-PRP-002/008, BR-PLT-005.
- **Working assumptions:** OD-23.

### BR-PRP-002
> "The proposal shall be populated automatically with CRM data and pricing."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged | foundation §9; DR-PRP-01 (refresh semantics, pricing seed); disposition aligned to SCOPE-RECONCILIATION.md §7.1 (§12 R2) |

- **Inputs / fields:** None (automatic); "Refresh CRM data" action on drafts.
- **Behaviour:** At creation and at each new version creation, placeholders resolve from current CRM records (company, deal, contacts by role, owner, organization) with DR-CRM-02 formatting. Pricing: if the template contains pricing table defaults (pre-set catalog lines) they are copied; if the deal already has a previous proposal the user may choose "Copy pricing from proposal <number>"; otherwise the table starts empty with the deal currency. While Draft, the user can "Refresh CRM data" (shows a diff of changed values before applying). Values are frozen into the version snapshot when sent; later CRM changes do not alter sent versions.
- **Validations:** As BR-TPL-008.
- **System responses:** Diff dialog "3 values changed in the CRM since this draft was created."
- **Errors / exceptions:** n/a.
- **Dependencies:** BR-TPL-002/008, BR-PRC-002, BR-PRP-006.
- **Working assumptions:** Foundation §9 (re-resolve at version creation with diff).

### BR-PRP-003
> "Salespeople shall be able to edit content in sections marked editable."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged | BR-TPL-003 |

- **Inputs / fields:** Rich-text editing in editable sections (same block types as templates except signature block placement, which is template-controlled), content block insertion (BR-TPL-005), AI drafting/rewrite (BR-AIA-001/004), add new editable sections (if template allows), pricing table editing.
- **Behaviour:** Only the draft version is editable. Autosave every 10 s and on blur. Editing a proposal whose current version is sent creates a new draft version (DR-PRP-01). Locked sections are read-only. AI-inserted content is marked until accepted (BR-AIA-007).
- **Validations:** As BR-TPL-001 content rules; size limit per proposal 10 MB of content excluding images, ≤ 200 images.
- **System responses:** "Saved" indicator.
- **Errors / exceptions:** Concurrent edit → 409 with reload prompt; locked section edit → `proposal.section_locked`.
- **Dependencies:** BR-TPL-003/005, BR-AIA-001/004/007, BR-PRP-006.
- **Working assumptions:** Foundation §9 (editing a sent proposal creates a new draft version).

### BR-PRP-004
> "Users shall be able to preview the proposal exactly as the buyer will see it."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified (internal preview excluded from tracking) | ADR-013; DR-PRP-03 |

- **Inputs / fields:** Preview mode selector: desktop | mobile width; "as PDF".
- **Behaviour:** Uses the same renderer and branding as the buyer view (BR-SHR-009) and PDF (BR-PRP-005), with buyer-side controls (accept/decline/sign buttons) shown inert and a banner "Preview — the buyer will not see this banner." Missing placeholders highlighted. Internal previews never create view/download tracking events or notifications (DR-PRP-03).
- **Validations:** n/a.
- **System responses:** Preview opens in a new tab/panel.
- **Errors / exceptions:** Render failure → "Preview couldn't be generated." with retry.
- **Dependencies:** BR-SHR-009, BR-TPL-006, BR-PRP-005.
- **Working assumptions:** OD-43.

### BR-PRP-005
> "The platform shall generate PDF and DOCX files with the same content."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified (parity definition) | OD-43; NFR-005 (< 10 s) |

- **Inputs / fields:** Download PDF / Download DOCX actions on any version (draft PDFs watermarked "Draft").
- **Behaviour:** PDF rendered from the block model with branding; on send the PDF of the sent version is generated once, stored immutably with SHA-256 and reused for buyer downloads and as the document sent for signature (BR-SIG-001). DOCX generated from the same block model: same text, tables, pricing, images and order; editable; not pixel-identical (OD-43). Generation target < 10 s for proposals up to 30 pages (NFR-005). Files named `<proposal number>-v<version>-<title>.pdf|docx` (sanitised).
- **Validations:** Missing placeholders block final (non-draft) generation (BR-TPL-008).
- **System responses:** Download starts; for longer jobs a progress indicator and a notification when ready.
- **Errors / exceptions:** Generation failure → "We couldn't generate the PDF. Try again." `document.generation_failed` (with correlation id); sending is blocked if the PDF for the version cannot be produced.
- **Dependencies:** BR-PRP-004, BR-TPL-006, BR-SIG-001/010, NFR-012.
- **Working assumptions:** OD-43.

### BR-PRP-006
> "Every sent version shall be kept, and users shall be able to compare versions."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | OD-20, OD-21; DR-PRP-01 |

- **Inputs / fields:** Version list; compare: select two versions (any two, default latest vs previous sent).
- **Behaviour:** Versions are numbered 1..n per proposal; states draft | sent | superseded | signed (OD-20). At most one draft version at a time. Sending freezes the version (immutable snapshot, PDF, SHA-256). Sending a newer version sets the previous sent version to superseded; its links show a "newer version available" banner and remain viewable read-only unless revoked; any open signature request on it is voided after user confirmation (OD-21). Comparison shows: text changes per section (inserted/deleted highlighting), added/removed sections, pricing line changes (added/removed/changed quantity, price, discount, tax), totals before/after, placeholder value changes and overrides, validity date change. Sent versions are never deleted (retention per OD-36).
- **Validations:** Cannot create a new version on a Void proposal (DR-PRP-02) or while a signature request is being completed.
- **System responses:** "Version 3 created from version 2." Comparison view side-by-side or inline.
- **Errors / exceptions:** Compare of a version the user cannot see → 404.
- **Dependencies:** BR-PRP-003/007, BR-SHR-001/007, BR-SIG-001/011.
- **Working assumptions:** OD-20, OD-21.

### BR-PRP-007
> "Proposals shall have the statuses Draft, Sent, Viewed, Signed, Declined, Expired and Void."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified (extended with Accepted; transitions defined) | OD-17, OD-18, OD-19, OD-20, OD-22, OD-23, OD-25, OD-40 |

- **Inputs / fields:** User actions: Send (via SHR), Void (reason required, 1–500), Mark as sent manually (DR-PRP-06), Create new version.
- **Behaviour:** Statuses (proposal level, reflecting the current version): Draft, Sent, Viewed, **Accepted** (extension, OD-17), Signed, Declined, Expired, Void. Transitions:

| From | Event | To |
|---|---|---|
| Draft | version sent (DR-PRP-06) | Sent |
| Sent | first buyer view of the current version | Viewed |
| Sent / Viewed | buyer accepts (BR-SHR-010) | Accepted |
| Sent / Viewed | buyer declines (BR-SHR-010) or any signer declines (BR-SIG-012, OD-25) | Declined |
| Sent / Viewed | all signers signed (BR-SIG-007) | Signed |
| Sent / Viewed / Accepted | validity date passed (BR-PRP-009, OD-22a) | Expired |
| Sent / Viewed / Declined / Expired / Accepted | new version created | Draft (new version draft) |
| any except Signed, Void | user voids, or another proposal on the deal is Signed (OD-23, automated) | Void |
| Accepted | signature requested and completed | Signed |

  Signature request expiry (OD-22c) returns the proposal to its prior Sent/Viewed status. Partially signed is not a status; UI shows "Signing in progress (x of n)" (OD-19). Signed and Void are terminal (Void: copy to a new proposal to continue, DR-PRP-02). Voiding a proposal voids its open signature request and revokes nothing automatically except blocking buyer actions (links show "This proposal is no longer available.") (OD-18). Status changes write timeline events and feed NTF/AUT.
- **Validations:** Transitions not in the table are rejected (`proposal.invalid_transition`); Void requires reason; Signed cannot be voided ("Signed proposals can't be voided." `proposal.signed_immutable`).
- **System responses:** Status badge with colour and tooltip of the last transition.
- **Errors / exceptions:** Race (e.g. void while signer completes) → the first committed event wins; the other action receives 409 "This proposal's status changed to <status>."
- **Dependencies:** BR-SHR-004/010, BR-SIG-007/012/013, BR-PRP-009, BR-AUT-001..004, BR-NTF-001, BR-RPT-004.
- **Working assumptions:** OD-17..OD-23, OD-25, OD-40.

### BR-PRP-008
> "Each proposal shall be linked to its deal, company and contacts."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged | — |

- **Inputs / fields:** Deal (fixed at creation); company (derived from the deal at creation, snapshotted on send); contacts = primary contact, recipients (BR-SHR-003), signers (BR-SIG-002), forwarded viewers (BR-SHR-005).
- **Behaviour:** Proposal appears on the deal, company and each linked contact's record and timelines. The deal link cannot be changed (use copy, BR-PRP-010). If the deal's company changes later, sent versions keep the snapshotted company name; the live link follows the deal.
- **Validations:** n/a.
- **System responses / errors:** n/a.
- **Dependencies:** BR-TIM-001/003, BR-SHR-003/005, BR-SIG-002.
- **Working assumptions:** OD-26.

### BR-PRP-009
> "Users shall be able to set a validity or expiry date on a proposal."

| Priority | Disposition | Basis |
|---|---|---|
| Should | Clarified (three clocks) | OD-22, OD-40 (delivered with BR-PRP-007) |

- **Inputs / fields:** Validity date (date; default today + organization default validity days; blank allowed = no expiry); time = end of day in the organization time zone.
- **Behaviour:** Shown on the proposal and as placeholder `proposal.validityDate`. When the date passes for a sent version: proposal → Expired; any open signature request on it expires (voided at the provider with reason "Proposal expired"); all its links show "This proposal has expired. Contact <owner> for an updated proposal." and block accept/sign; owner notified. Reviving requires a new version with a new validity date (OD-22). Changing the validity date of a sent version is not allowed (it is frozen) — create a new version. Link expiry (BR-SHR-007) and signature request expiry are separate clocks; the earliest wins for any buyer action.
- **Validations:** Validity date ≥ today when sending (`proposal.validity_in_past`).
- **System responses:** Expiry warning on the proposal 3 days before (also NTF "link about to expire" uses the earliest clock, BR-NTF-001).
- **Errors / exceptions:** As above.
- **Dependencies:** BR-PRP-007, BR-SHR-007, BR-SIG-007, BR-NTF-001.
- **Working assumptions:** OD-22, OD-40.

### BR-PRP-010
> "Users shall be able to copy an existing proposal to another deal."

| Priority | Disposition | Basis |
|---|---|---|
| Should | Unchanged | — |

- **Inputs / fields:** Source proposal (any version the user can see); target deal (open deal the user can edit); title; options: copy pricing (default on), keep proposal-level placeholder overrides (default off).
- **Behaviour:** Creates a new Draft proposal on the target deal with version 1 copied from the chosen source version's content (editable sections, added sections, pricing lines), pinned to the source's template version if still available (otherwise the template's latest published version, with a notice), and placeholders re-resolved from the target deal's CRM data. Pricing currency must match the target deal's currency; if different, prices are converted (DR-PRC-02) and flagged for review. Tracking, links, signatures and statuses are not copied. Also used to continue after Void.
- **Validations:** Target deal open and editable; same-deal copy allowed (creates an alternative proposal, OD-23).
- **System responses:** "Proposal copied to <deal>." Opens the new draft.
- **Errors / exceptions:** Source template archived → still allowed (copy uses snapshot content) with notice.
- **Dependencies:** BR-PRP-001/002, BR-PRC-006.
- **Working assumptions:** OD-15, OD-23.

### PRP derived requirements

**DR-PRP-01 — Version-creation semantics.** *Derived — pending confirmation (from BR-PRP-006, foundation §9).* A new version is created (a) explicitly via "Create new version", or (b) implicitly when a user starts editing a proposal whose current version is sent. The new draft copies the latest version's content, re-resolves placeholders from current CRM data and shows a diff of changed values. Only one draft version may exist; it can be discarded (deleting only that unsent draft).

**DR-PRP-02 — Re-send after Declined/Expired/Void.** *Derived — pending confirmation (from BR-PRP-007, foundation §9).* Declined and Expired proposals accept a new version (status returns to Draft). Void is terminal; continuing requires copying to a new proposal (BR-PRP-010).

**DR-PRP-03 — Internal preview excluded from tracking.** *Derived — pending confirmation (from BR-PRP-004, BR-SHR-004, ADR-013).* Previews and downloads by signed-in users inside the app never create tracking events. Additionally, when a buyer link is opened in a browser holding a valid internal user session, the view is recorded as "internal view" and excluded from buyer metrics and notifications.

**DR-PRP-04 — One open signature request per deal.** *Derived — pending confirmation (from OD-23, BR-SIG-001).* Creating a signature request is blocked while another signature request on any proposal of the same deal is Pending/Sent/Viewed: "Another signature request is open on this deal. Void it first." `signature.request_open_on_deal`.

**DR-PRP-05 — Alternative proposals and automatic void on signing.** *Derived — pending confirmation (from OD-23).* When a proposal is Signed, other non-terminal proposals of the deal are set to Void with reason "Another proposal was signed", labelled automated and reversible (BR-AUT-008).

**DR-PRP-06 — Definition of "sent".** *Derived — pending confirmation (from BR-AUT-001/004, foundation §9).* A version becomes sent when (a) an email containing its share link is sent through the CRM or confirmed sent from the add-in, or (b) the user copies a share link and confirms "I shared this link manually". Sending freezes the version, generates the final PDF, sets the version state sent and proposal status Sent.

**DR-PRP-07 — Frozen snapshot integrity.** *Derived — pending confirmation (from BR-PRP-005/006, BR-SIG-011, ADR-010).* The sent version stores the resolved content JSON, pricing, branding, rendered PDF and SHA-256 of the PDF; any later access verifies the stored hash; mismatch is logged as a security event and blocks signing.

**DR-PRP-08 — Proposals only on open deals.** *Derived — pending confirmation (from BR-PRP-001, OD-31).* New proposals and new versions require an open deal; closed deals must be reopened (DR-CRM-04).

---

## 10. AIA — AI assistance (BRD §9.9)

**Purpose.** Reduces proposal production effort and errors through AI drafting, pre-send checks, summaries, rewrites and follow-up drafts, with a human always in control. Addresses P1; supports the "proposal production effort < 30 minutes" metric (§12) and AC-08.

**Primary users.** Salesperson (uses AI features); Admin (switches, usage monitoring).

**Interactions summary.** User invokes an AI action on a deal/proposal/email → server builds context strictly from records the user may see, excluding private emails (IDD-07, OD-30) → AI provider called server-side (OD-05) → output stored as a pending generation, shown labelled "AI-generated" → user accepts, edits or rejects → acceptance logged; nothing is ever sent externally by AI (BR-AIA-006). Admin controls organization and per-feature switches (IDD-08) and sees usage.

### BR-AIA-001
> "AI shall draft proposal content, such as the introduction, summary of the customer's needs and scope summary, from the deal record, notes, linked emails and the template. The salesperson reviews and edits before use."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified (context limits) | IDD-07, OD-05, OD-30; ADR-014 |

- **Inputs / fields:** Target section (editable section or AI draft slot); draft type (introduction | needs summary | scope summary | custom instruction); optional instruction (0–1,000 chars); tone (default from template: professional); length (short | medium | long).
- **Behaviour:** Context = deal fields and custom fields, company and contact basics, notes and logged activities, linked non-private emails and meeting metadata (most recent first, capped to the model context budget), the template's section guidance and the current proposal content and pricing table. Private emails, records outside the user's scope and other deals' data are excluded (IDD-07). Email content is treated as untrusted data (prompt-injection guard, DR-AIA-01). Output is inserted into the section as a pending AI block, visually marked "AI-generated — review before use" with Accept / Edit / Regenerate / Discard. Accepted content becomes ordinary content (BR-AIA-007). Pending AI blocks block sending (`proposal.pending_ai_content`: "Review AI-generated content before sending.").
- **Validations:** Feature enabled (BR-AIA-008); user can edit the proposal; section editable; instruction length.
- **System responses:** Streaming or spinner "Drafting…" (target < 20 s); result inserted.
- **Errors / exceptions:** AI disabled → actions hidden; provider error/timeout → "AI couldn't draft this right now. Try again or write it yourself." `ai.unavailable`; budget limit reached (DR-AIA-02) → "AI usage limit reached for this month. Contact your administrator." `ai.limit_reached`; insufficient context → AI returns a draft noting missing information, flagged.
- **Dependencies:** BR-AIA-006/007/008/009, BR-PRP-003, BR-EML-002/003, BR-CRM-010.
- **Working assumptions:** IDD-07, OD-05, OD-30.

### BR-AIA-002
> "Before sending, AI shall check for wrong or mismatched names, figures inconsistent with the pricing table or deal, empty placeholders, missing required sections and outdated dates."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified (deterministic + AI checks; non-blocking findings) | ADR-014 |

- **Inputs / fields:** "Run pre-send check" (also triggered automatically when the user starts sending a version).
- **Behaviour:** Two layers. **Deterministic checks (always run, even if AI is disabled org-wide or per feature; delivered in R1 — §12 resolution R4, OD-55):** codes and severities per RULE-AIA-11 (authoritative, foundation §15): `PLACEHOLDER_UNRESOLVED` (blocking, BR-TPL-008), `REQUIRED_SECTION_EMPTY` (blocking), `AI_CONTENT_PENDING` (blocking), `VALIDITY_DATE_PAST` (blocking), `CURRENCY_REVIEW_REQUIRED` (blocking), `PRICING_DEAL_AMOUNT_MISMATCH` (warning, BR-PRC-004), `DISCOUNT_LIMIT_EXCEEDED` (warning, BR-PRC-007), `DATE_IN_PAST_IN_TEXT` (warning). Send preconditions such as an empty recipient list are enforced by RULE-PRP-08, not as findings. **AI consistency check (when enabled):** names in text that do not match the company/contact names on the deal (e.g. another customer's name left from a copied proposal), figures in text inconsistent with the pricing table or deal amount, dates in text inconsistent with the deal/proposal dates. LLM findings: `NAME_MISMATCH`, `FIGURE_INCONSISTENT`, `OUTDATED_DATE` (all warning). Findings returned as a structured list: severity (blocking | warning | info; OD-56), code, location (section, excerpt), message, suggested fix. Blocking findings (deterministic only) prevent sending (`PRESEND_BLOCKING_FINDINGS`, 409); warnings and LLM findings require acknowledgement ("Send anyway") which is recorded on the version. The check is bound to the version content hash; any edit invalidates it (RULE-AIA-11).
- **Validations:** n/a.
- **System responses:** Check panel listing findings with "Go to" links; "No issues found" state. Result stored per version (ai_check_result).
- **Errors / exceptions:** AI layer failure → deterministic results shown plus "AI check unavailable — review names and figures manually." (sending allowed after acknowledgement).
- **Dependencies:** BR-TPL-008, BR-PRC-002/004/007, BR-PRP-009, BR-SHR-002, BR-AIA-007/008.
- **Working assumptions:** OD-05.

### BR-AIA-003
> "Users shall be able to request an AI summary of a deal's email thread and history."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified (context limits, storage) | IDD-07, OD-30 |

- **Inputs / fields:** Scope: deal history (default) | a specific email thread; optional period (last 30/90 days/all).
- **Behaviour:** Generates a summary: current situation, stakeholders and their positions, open questions/requests, commitments made, next steps, risks. Context as BR-AIA-001 (no private emails). Displayed in a side panel labelled "AI summary — generated <time>"; can be saved to the deal as a note (then labelled "AI-generated note", accepted by the saving user) or discarded. Summaries are not auto-sent anywhere.
- **Validations:** Feature enabled; user can view the deal.
- **System responses:** Summary within ~20 s; "Save as note".
- **Errors / exceptions:** As BR-AIA-001; no history → "There's not enough activity on this deal to summarise."
- **Dependencies:** BR-EML-002/003, BR-CRM-010, BR-TIM-001, BR-AIA-007/008.
- **Working assumptions:** IDD-07, OD-30.

### BR-AIA-004
> "Users shall be able to rewrite selected text with AI, for example to shorten it or change its tone."

| Priority | Disposition | Basis |
|---|---|---|
| Should | Unchanged | — |

- **Inputs / fields:** Selected text (1–5,000 chars by default, Admin setting `ai.rewrite.maxSelectionChars`; RULE-AIA-13, error `AI_INPUT_TOO_LARGE`) in an editable proposal section or email compose; action (shorten | expand | more formal | friendlier | fix grammar | custom instruction 0–500 chars).
- **Behaviour:** Shows the rewrite as a suggestion next to the selection with Replace / Insert below / Discard; replaced text is marked AI-generated until accepted (BR-AIA-007). Placeholders inside the selection are preserved as placeholders (not resolved text).
- **Validations:** Selection inside editable content; feature enabled.
- **System responses / errors:** As BR-AIA-001.
- **Dependencies:** BR-PRP-003, BR-EML-004, BR-AIA-007/008.
- **Working assumptions:** —

### BR-AIA-005
> "AI shall be able to draft a follow-up email after a proposal is sent, for the salesperson to review."

| Priority | Disposition | Basis |
|---|---|---|
| Should | Unchanged | BR-AIA-006 |

- **Inputs / fields:** Trigger: user action "Draft follow-up" on a sent proposal or on an AUT-004 follow-up task; options: recipient (proposal recipients), goal (check-in | answer questions | nudge for signature), tone.
- **Behaviour:** Draft uses proposal status and engagement (views, time on page, forwarded viewers — not section-level analytics), last emails (non-private) and deal context. Opens in the compose window (BR-EML-004) labelled AI-generated; the user edits and must click Send. Never auto-sent.
- **Validations:** Feature enabled; mailbox connected to send.
- **System responses / errors:** As BR-AIA-001.
- **Dependencies:** BR-EML-004, BR-SHR-004, BR-AUT-004, BR-AIA-006/007.
- **Working assumptions:** —

### BR-AIA-006
> "AI shall never send anything to an external party without a user's explicit action."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged | NFR-003; ADR-014 |

- **Behaviour:** Architectural rule: AI components have no capability to send emails, share links, create signature requests or post to any external system. Every external send path (email send, share link creation/sending, signature request, buyer-visible proposal content) requires an authenticated user request initiated by an explicit UI action. Automation (AUT) never invokes AI to send. AI-generated content in a sent artifact must have been accepted (BR-AIA-007) — enforced by the pending-AI blocker (BR-AIA-002).
- **Validations:** Server-side check that send endpoints are invoked with a user session (not a system/AI actor).
- **System responses / errors:** n/a (no user-facing behaviour beyond the review controls).
- **Dependencies:** BR-AIA-001..005, BR-EML-004, BR-SHR-002, BR-SIG-001.
- **Working assumptions:** —

### BR-AIA-007
> "AI-generated content shall be marked as such until a user accepts it, and AI usage shall be logged."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged | NFR-003, NFR-009 |

- **Inputs / fields:** Accept / Edit / Reject controls on AI blocks and suggestions.
- **Behaviour:** Each AI output is stored as a generation (state pending → accepted | edited-and-accepted | rejected | expired) with feature, prompt version, model, input record references (ids, not content), output, user, timestamps. While pending, content shows a distinct style and "AI-generated" label in the editor and preview; it never reaches buyers. On acceptance the label is removed from the document but the provenance (generation id, accepted by, accepted at) remains on the version and is visible in version history. Usage log per call: feature, model, input/output tokens, latency, cost estimate, user, record, outcome — viewable by Admin (usage dashboard by feature/user/month) and included in the audit trail (acceptance events).
- **Validations:** Only the proposal editor's user can accept.
- **System responses:** Admin usage page; per-proposal AI provenance list.
- **Errors / exceptions:** Logging failure does not block the user but raises an operational alert.
- **Dependencies:** BR-AIA-001..005, BR-PLT-009.
- **Working assumptions:** IDD-10 (usage monitoring as internal budget control).

### BR-AIA-008
> "Admins shall be able to turn AI features on or off for their organization."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Modified (organization switch + per-feature switches) | IDD-08 |

- **Inputs / fields:** Organization AI master switch (on/off); per-feature switches: proposal drafting (AIA-001), AI consistency check (AIA-002 AI layer), deal summary (AIA-003), rewrite (AIA-004), follow-up draft (AIA-005).
- **Behaviour:** Master off disables all AI calls immediately (pending generations remain reviewable); per-feature off hides that feature. Deterministic pre-send checks remain active regardless. Changes audited.
- **Validations:** Admin only.
- **System responses:** "AI features turned off for everyone."
- **Errors / exceptions:** Requests in flight complete; new requests rejected `ai.disabled`.
- **Dependencies:** BR-AIA-001..005, BR-PLT-012.
- **Working assumptions:** IDD-08.

### BR-AIA-009
> "Customer data shall not be used to train AI models, and AI processing shall keep each organization's data separate."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Modified | IDD-07, OD-05; NFR-003 |

- **Behaviour:** (1) The AI provider is contracted under terms that prohibit training on our inputs/outputs, with zero-data-retention requested (OD-05); no fine-tuning on our data. (2) Each AI request's context is assembled server-side only from records the requesting user is permitted to see, excluding private emails (OD-30) and archived records; no cross-user caching of context. (3) Prompts and outputs are stored only in our database (ai_generation) under our retention rules. (4) No AI calls from the browser.
- **Validations:** Context builder permission checks are unit-testable and audited (record ids included per request).
- **System responses / errors:** n/a.
- **Dependencies:** BR-AIA-001..005, BR-PLT-005, NFR-002/003.
- **Working assumptions:** IDD-07, OD-05.

### AIA derived requirements

**DR-AIA-01 — Prompt-injection guard.** *Derived — pending confirmation (from BR-AIA-001/003/005, ADR-014).* Email/meeting/form text is passed as delimited untrusted data; system instructions forbid following instructions inside it; outputs are plain content only (no tool calls, no links not present in CRM data); outputs containing URLs not found in the context are flagged in the review UI.

**DR-AIA-02 — AI usage budget controls.** *Derived — pending confirmation (from IDD-10, BR-AIA-007; owner Tech Lead/Finance).* Admin sets a monthly organization token/cost budget and optional per-user daily request limit; at 80% the Admin is notified; at 100% AI requests are rejected until the next month or the limit is raised.

**DR-AIA-03 — Graceful degradation.** *Derived — pending confirmation (from BR-AIA-001..005, NFR-006).* Provider outage never blocks non-AI work: proposals can be written, checked deterministically and sent; AI controls show "temporarily unavailable".

**DR-AIA-04 — Prompt versioning.** *Derived — pending confirmation (from BR-AIA-007, ADR-014).* Each generation records the prompt template version; prompt changes are deployed with code and listed in release notes.

---

## 11. SHR — Sharing and tracking (BRD §9.10)

**Purpose.** Delivers proposals to buyers through secure, per-version, per-recipient links; records views, time, downloads and forwarded viewers; supports revocation/expiry, access history, branded mobile view and accept/decline without signature. Addresses P2 (no visibility after sending); supports AC-09 and the "deals going quiet" metric.

**Primary users.** Salesperson (send, revoke, view history); Buyer — recipients and forwarded viewers (view, download, forward, accept/decline).

**Interactions summary.** Salesperson chooses recipients (deal contacts) → system creates one link per recipient for the version → link sent from the user's mailbox (CRM compose or add-in) or copied and marked shared manually → buyer opens link (optional email verification) → view sessions and downloads recorded → buyer forwards the link → new viewer identifies (name, email, privacy notice) → added as contact and deal stakeholder "Forwarded viewer" → owner notified → buyer accepts/declines (no-signature proposals) or proceeds to signing (SIG).

### BR-SHR-001
> "The platform shall create a unique, secure link for each proposal version."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified (one link per recipient per version) | ADR-013; foundation §5 ShareLink |

- **Inputs / fields:** Created automatically per intended recipient when a version is shared. There are no general (recipient-less) links (foundation §16 S3); to share with another person, add them as a recipient.
- **Behaviour:** Token = 32 random bytes, base64url; the SHA-256 hash is stored for lookup and the token itself is stored envelope-encrypted (A10) so an authorised user can copy an existing link again without re-issuing it (§12 resolution R5, ADR-034; PERM-118); URL on the buyer origin with the token in the URL **fragment** (`https://<buyer-origin>/p#<token>`), never in path or query; the buyer page posts it to `/public/v1/session/exchange`, receives a short-lived HttpOnly cookie bound to that link and clears the fragment, so tokens never reach edge/LB logs and mail-scanner prefetch cannot open the proposal (foundation §16 S2, ADR-071). One link per intended recipient; no general links (S3). A link grants access to exactly one proposal version (read-only view, PDF download, accept/decline or sign entry where applicable). Link states: active | revoked | expired. Links of a superseded version remain viewable with a "A newer version is available" banner — the banner does not reveal the newer version unless the recipient also received a link to it (OD-21). Tokens never appear in logs (redacted).
- **Validations:** Version must be sent (or being sent) — links cannot be created for drafts.
- **System responses:** Link list per version: recipient, created, status, last viewed.
- **Errors / exceptions (buyer):** Unknown/invalid token → generic "This link isn't valid." (no detail).
- **Dependencies:** BR-SHR-002/003/004/007, BR-PRP-006, BR-SIG-001.
- **Working assumptions:** OD-20, OD-21.

### BR-SHR-002
> "Users shall be able to send the link through their own mailbox, from the CRM or the inbox add-in."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified (manual-share option; send freezes version) | DR-PRP-06; NFR-013 |

- **Inputs / fields:** Send dialog: recipients (BR-SHR-003), email template (default "Proposal" template with `{{proposal.link}}` resolved per recipient), subject, message body, attach PDF (default off — the link is the tracked channel), require email verification (BR-SHR-006), link expiry (BR-SHR-007).
- **Behaviour:** Pre-send check runs first (BR-AIA-002); blockers stop the send. On confirm: version frozen (DR-PRP-07), final PDF generated, links created per recipient, one email per recipient sent through the user's mailbox (each email contains only that recipient's link so tracking is per person), proposal status → Sent, timeline and AUT-001 triggered, AUT-004 timer started. From the add-in the link is inserted into the user's draft (BR-EML-005). Manual option: "Copy link" for a recipient then confirm "I shared this link" to mark sent (DR-PRP-06). Idempotent send (DR-EML-02).
- **Validations:** Mailbox connected (for CRM send); at least one recipient; no blockers; validity date not in the past; user permission (own deals / team / all).
- **System responses:** "Proposal sent to 2 recipients."
- **Errors / exceptions:** Partial failure (one recipient's email fails) → version still sent; failed recipient shown with "Retry" and a notification; the freeze happens only after at least one email is accepted by the provider; if none succeeds the version stays draft, nothing is frozen and the user sees "The proposal wasn't sent: <reason>." `proposal.send_failed`.
- **Dependencies:** BR-EML-004/005, BR-SHR-001/003/006/007, BR-AIA-002, BR-PRP-007, BR-AUT-001/004.
- **Working assumptions:** Foundation §9 ("sent" definition).

### BR-SHR-003
> "The salesperson shall be able to specify the intended recipients."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged | — |

- **Inputs / fields:** Recipients: 1–20 contacts chosen from deal contacts, or a new email address (creates a contact, added to the deal with no role); per recipient: can accept/decline (default on for no-signature proposals).
- **Behaviour:** Recipients are stored per version; adding a recipient to an already-sent version creates a new link for them and sends it (version content unchanged). Removing a recipient revokes their link.
- **Validations:** Valid email; not an internal user's email (warning: "This is a colleague's address; their views won't be tracked."); no duplicates.
- **System responses:** Recipient chips with link status.
- **Errors / exceptions:** Standard.
- **Dependencies:** BR-SHR-001/002, BR-CRM-003, BR-PRP-008.
- **Working assumptions:** OD-26.

### BR-SHR-004
> "The platform shall record each view (who, when, how long) and each download."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged (session definition derived) | ADR-013; DR-SHR-03 |

- **Inputs / fields:** None (automatic, server-side).
- **Behaviour:** View session starts when the buyer page renders the proposal for an identified viewer (link recipient, verified email, or forwarded viewer identity); heartbeats every 15 s while the page is visible; session ends on page hide/close or after 60 s without heartbeat; duration = active visible time. Recorded: viewer identity (recipient contact or forwarded viewer contact), link, version, start, end, active duration, device class (desktop/mobile/tablet), browser family, approximate location from IP (country/region only), IP address (stored for security, retention per OD-36). Downloads (PDF; DOCX only if the user enabled DOCX download for buyers — default off) recorded with viewer and time, served via server-mediated download. First view of the current version → proposal status Viewed. Internal views excluded (DR-PRP-03). Bots/link scanners (e.g. email security pre-fetch: requests without JS execution) are not counted as views.
- **Validations:** n/a.
- **System responses:** Data available in access history (BR-SHR-008), timeline, notifications and reports.
- **Errors / exceptions:** Tracking failures never block viewing.
- **Dependencies:** BR-SHR-001/005/008, BR-NTF-001, BR-RPT-004, BR-PRP-007, BR-AUT-004.
- **Working assumptions:** OD-35, OD-36.

### BR-SHR-005
> "Recipients shall be able to forward the proposal. New viewers identify themselves by name and email before viewing and are recorded as new stakeholders on the deal."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | OD-26, OD-27, OD-34 |

- **Inputs / fields (buyer identity gate):** Name (required, 1–200), email (required, valid), privacy notice acknowledgement (shown; acceptance by continuing), optional company.
- **Behaviour:** Any person opening a recipient link who is not established as that recipient (new browser without the recipient's verified cookie when verification is on, or anyone choosing "I'm not <recipient>") sees the identity gate. Without email verification a visitor on a recipient link is assumed to be the recipient unless they choose "I'm not <name>"; a "Forward" button on the buyer page lets recipients send the proposal to colleagues by entering their email (the system sends a link to the colleague from the transactional email service on behalf of the owner, naming the forwarder), and generic forwarding of the URL is also handled by the gate. After identification: match contact by normalised email (OD-27), else create a contact (company = deal's company if email domain matches the company's domain, else none, OD-26; free-mail never matches, DR-LED-04); add to the deal with role "Forwarded viewer" (if not already a deal contact); record a view session as that person; notify owner `proposal_forwarded_new_viewer`. Forwarded viewers can view and download; they cannot accept/decline or sign unless the salesperson adds them as recipient/signer (OD-26). When email verification is required (BR-SHR-006), forwarded viewers must verify too.
- **Validations:** Email syntax; rate limit 10 identity submissions per link per hour; disposable-email domains are not blocked in Phase 1.
- **System responses (buyer):** Proposal opens after the gate. **Internal:** timeline "<Name> (forwarded by <recipient> or unknown) viewed the proposal".
- **Errors / exceptions:** Invalid email → "Enter a valid email address."; rate limit → "Too many attempts. Try again later."
- **Dependencies:** BR-SHR-004/006, BR-CRM-002/003, BR-NTF-001, BR-TIM-001.
- **Working assumptions:** OD-26, OD-27, OD-34.

### BR-SHR-006
> "Users shall be able to require email verification before a proposal can be viewed."

| Priority | Disposition | Basis |
|---|---|---|
| Should | Unchanged | — |

- **Inputs / fields:** Send option "Require email verification" (default off; Admin may set default on); buyer enters the 6-digit code emailed to them.
- **Behaviour:** Before viewing, the visitor enters their email; if it matches the link's recipient (or, for forwarded viewers, any email after the identity gate) a one-time 6-digit code valid 10 minutes is sent via transactional email; on success a browser cookie (30 days, scoped to the link) marks the viewer verified. Verified identity is recorded on view sessions.
- **Validations:** Max 5 code attempts per code; max 5 codes per email per hour.
- **System responses:** "We sent a code to j***@example.com."
- **Errors / exceptions:** Wrong/expired code → "That code is wrong or expired. Request a new one."
- **Dependencies:** BR-SHR-001/004/005, OD-14.
- **Working assumptions:** OD-14.

### BR-SHR-007
> "Authorized users shall be able to revoke links and set link expiry."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified (expiry clocks) | OD-22; BRD §9.17 |

- **Inputs / fields:** Per link or all links of a version: Revoke (confirm); Link expiry date-time (optional; default none; must be in the future); reactivate a revoked link (creates a new token; old URL stays dead).
- **Behaviour:** Authorized per §9.17: Admin all, Manager own team, Salesperson own deals. Revoked/expired link shows "This link is no longer active. Contact <owner name> for access." and blocks all actions including signing entry. Link expiry affects only that link (OD-22b); proposal validity (OD-22a) and signature request expiry (OD-22c) are separate; the earliest applicable clock wins for buyer actions. Expiry triggers "link about to expire" notification 2 days before (BR-NTF-001, DR-NTF-03).
- **Validations:** Expiry in the future; expiry not after proposal validity date (warning, allowed).
- **System responses:** Link status updates; timeline "Link revoked for <recipient>".
- **Errors / exceptions:** 403 outside scope.
- **Dependencies:** BR-SHR-001, BR-PRP-009, BR-SIG-007, BR-NTF-001.
- **Working assumptions:** OD-22, OD-31.

### BR-SHR-008
> "Authorized users shall be able to view each proposal's access history."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified (who is authorized) | OD-31 |

- **Inputs / fields:** Filters: version, viewer, event type (view, download, identity, verification, accept/decline, sign events), date range.
- **Behaviour:** Anyone who can view the deal can view access history (OD-31). Shows per viewer: identity, first/last view, total sessions, total active time, downloads, devices; and a chronological event list with session durations. Internal views shown separately and excluded from totals (DR-PRP-03). Exportable to CSV.
- **Validations:** n/a.
- **System responses:** History table; per-viewer drill-down.
- **Errors / exceptions:** No views → "Not viewed yet."
- **Dependencies:** BR-SHR-004/005, BR-TIM-001.
- **Working assumptions:** OD-31.

### BR-SHR-009
> "The buyer-facing proposal view shall be branded and work well on mobile."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged | NFR-011, NFR-012 |

- **Behaviour:** Separate lightweight buyer app (ADR-002) rendering the frozen version with organization branding (BR-TPL-006): header with logo, proposal title, sender (owner name, photo optional, email), section navigation, pricing tables (responsive: tables reflow into stacked cards below 600 px width), download PDF, forward, accept/decline (BR-SHR-010) or "Review and sign" (SIG), validity date, status banners (superseded, expired, void, accepted, declined, signed). Meets WCAG 2.1 AA; works on current Chrome, Edge, Safari, Firefox including iOS Safari and Android Chrome; first meaningful render < 2 s at p95 on 4G (NFR-005 interpretation). No internal UI, no third-party trackers.
- **Validations:** n/a.
- **System responses / errors:** Status banners as above.
- **Dependencies:** BR-TPL-006, BR-SHR-004/010, BR-SIG-*.
- **Working assumptions:** OD-43.

### BR-SHR-010
> "Where a signature is not required, the buyer shall be able to accept or decline, giving a reason when declining."

| Priority | Disposition | Basis |
|---|---|---|
| Should | Clarified (Accepted status; no auto-close) | OD-17, OD-40 |

- **Inputs / fields:** Proposal-level setting "Acceptance method": signature (default when the template contains a signature block) | accept/decline. Buyer: Accept (confirm checkbox "I accept this proposal on behalf of <company>", typed full name 1–200); Decline (reason required, 1–1,000 chars).
- **Behaviour:** Available only to link recipients flagged can-accept (not forwarded viewers, OD-26) on the current (non-superseded, non-expired) version. Accept → proposal status Accepted (extension, OD-17), owner notified `proposal_accepted`, task "Confirm Closed Won" created for the owner; deal not closed automatically. Decline → proposal status Declined with reason; owner notified; AUT-003 task created. After a decision the buyer page shows the outcome and disables further actions. Accepting records name, email, timestamp, IP, version hash (lightweight evidence; not an e-signature).
- **Validations:** Reason required on decline; name required on accept; one decision per version (first wins; later attempts see the outcome).
- **System responses (buyer):** "Thank you — <owner> has been notified."
- **Errors / exceptions:** Version superseded/expired/void → actions hidden with banner.
- **Dependencies:** BR-PRP-007, BR-NTF-001, BR-AUT-003, BR-SHR-009.
- **Working assumptions:** OD-17, OD-26, OD-40.

### SHR derived requirements

**DR-SHR-01 — Per-recipient links.** *Derived — pending confirmation (from BR-SHR-001/003/004).* One link per intended recipient per sent version; no general links (foundation §16 S3); each email carries only its recipient's link.

**DR-SHR-02 — Superseded-version links.** *Derived — pending confirmation (from OD-21).* Links of superseded versions remain viewable read-only with a banner; accept/decline/sign disabled; recipients of the newer version see only their own new links.

**DR-SHR-03 — View session definition.** *Derived — pending confirmation (from BR-SHR-004).* Session = continuous visible time with heartbeats every 15 s; ends after 60 s without heartbeat; a "reopen" is a new session starting ≥ 30 minutes after the previous session ended (used by BR-NTF-001).

**DR-SHR-04 — Link-scanner filtering.** *Derived — pending confirmation (from BR-SHR-004).* Requests that do not execute the buyer app's script or that come from known security-scanner user agents are not counted as views and do not trigger notifications.

**DR-SHR-05 — Identity-gate privacy notice.** *Derived — pending confirmation (from OD-26; foundation §9 compliance).* The gate shows a short notice (Legal-approved) that the viewer's name, email and viewing activity will be recorded and shared with the sender, with a link to the privacy policy.

**DR-SHR-06 — Public endpoint protection.** *Derived — pending confirmation (from ADR-013, NFR-001).* Buyer endpoints are rate-limited per IP and per token; invalid-token responses are uniform and do not reveal existence; tokens are redacted from logs and analytics.

**DR-SHR-07 — Buyer-initiated forward.** *Derived — pending confirmation (from BR-SHR-005, OD-14).* The buyer page "Forward" action sends the colleague an email from the transactional email domain ("<Forwarder> shared a proposal from <Organization> with you") containing the forwarder's recipient link (no general links, §16 S3); the colleague passes the identity gate via "I'm someone else" and becomes a forwarded viewer (OD-26, OD-69); max 10 forwards per link per day.

---

## 12. NTF — Notifications (BRD §9.11)

**Purpose.** Alerts deal owners in real time to buyer engagement and important events so they act at the right moment. Addresses P2; supports AC-09 and NFR-005 (≤ 1 minute).

**Primary users.** Deal owners (all roles); Sales Managers for their own deals.

**Interactions summary.** Domain events (views, forwards, downloads, signatures, declines, acceptances, expiring links, new leads, task reminders, stalled deals) → notification service determines the recipient (current deal owner) and channels per preferences → in-app real-time (SSE) and email → optional daily digest.

### BR-NTF-001
> "The deal owner shall receive real-time in-app and email notifications when a proposal is opened for the first time, reopened, forwarded to a new viewer, downloaded, signed or declined, and when a link is about to expire."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified (event definitions, recipient, throttling) | foundation §5 event types; OD-17, OD-25, OD-40 |

- **Inputs / fields:** None (event-driven).
- **Behaviour:** Events and triggers: `proposal_first_open` (first buyer view session of a version); `proposal_reopen` (new session ≥ 30 min after previous session by the same viewer, DR-SHR-03; throttled to max 1 per viewer per proposal per 2 hours, DR-NTF-02); `proposal_forwarded_new_viewer` (BR-SHR-005); `proposal_downloaded`; `proposal_signed` (all signers signed) and `signer_signed` (each signer, derived); `proposal_declined` (buyer decline or signer decline); `proposal_accepted` (OD-17); `link_expiring` (earliest of link expiry, proposal validity, signature request expiry within 2 days, sent once per clock, DR-NTF-03); `signature_request_expired` (derived). Recipient = current deal owner at event time (DR-NTF-01). Channels: in-app (real-time via SSE, delivered within 1 minute, design target < 5 s) and email (within 1 minute). Each notification: title, short body (who, what, which proposal/deal, when), deep link. In-app notifications have read/unread state and a bell counter; "mark all read". Internal views never notify (DR-PRP-03).
- **Validations:** n/a.
- **System responses:** Toast for real-time in-app notifications when the app is open; email subject e.g. "Jane Doe (Acme) opened your proposal P-2026-000123".
- **Errors / exceptions:** Email delivery failure retried; in-app still delivered. SSE disconnected → notifications fetched on reconnect.
- **Dependencies:** BR-SHR-004/005/007/010, BR-SIG-007/012, BR-PRP-009, BR-NTF-002, NFR-005.
- **Working assumptions:** OD-17, OD-22, OD-25, OD-40.

### BR-NTF-002
> "Users shall be able to configure which notifications they receive and how."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged | — |

- **Inputs / fields:** Preferences matrix: each event type (BR-NTF-001 list, new lead, task reminder/overdue, deal stalled/overdue, mailbox needs reconnection, import/export completed, AI limit) × channel (in-app, email) on/off; digest (BR-NTF-003) on/off and time; quiet hours for email (optional start/end, user time zone).
- **Behaviour:** Defaults: all events in-app on; email on for first open, forwarded viewer, signed, declined, accepted, link expiring, new lead, task reminder; email off for reopen and download. Some system-critical notices cannot be fully disabled (at least one channel stays on): new lead assigned (in-app), mailbox needs reconnection (in-app), signature request expired (in-app). Quiet hours delay non-critical emails until the end of quiet hours (in-app unaffected).
- **Validations:** Quiet hours start ≠ end.
- **System responses:** "Preferences saved."
- **Errors / exceptions:** Attempt to disable a mandatory channel → toggle disabled with tooltip.
- **Dependencies:** BR-NTF-001/003, BR-LED-003, BR-CRM-008.
- **Working assumptions:** OD-47.

### BR-NTF-003
> "Users shall be able to receive a daily summary of activity on their deals."

| Priority | Disposition | Basis |
|---|---|---|
| Should | Unchanged | — |

- **Inputs / fields:** Digest on/off (default on); send time (default 08:00 user time zone); include team (managers, default off).
- **Behaviour:** Daily email (business days only by default; option all days) summarising the previous 24 h on the user's deals: proposal views/forwards/downloads/decisions/signatures, new leads, deals newly flagged stalled/overdue, tasks due today and overdue, AUT actions taken. Not sent if there is nothing to report. Idempotent per user per day (digest_run).
- **Validations:** Time on the hour or half hour.
- **System responses / errors:** Email failure retried for 2 hours, then skipped.
- **Dependencies:** BR-NTF-001/002, BR-AUT-005/006, BR-CRM-008.
- **Working assumptions:** —

### BR-NTF-004
> "The platform shall support browser push notifications."

| Priority | Disposition | Basis |
|---|---|---|
| Could | Deferred | OD-47 |

- **Specification:** Not built in Phase 1. The notification channel abstraction (in-app, email) is the extension point; a web-push channel can be added with its own preference column.

### NTF derived requirements

**DR-NTF-01 — Notification routing on reassignment and deactivation.** *Derived — pending confirmation (from BR-NTF-001, BR-CRM-004, BR-PLT-011; foundation §9).* Recipient is resolved at event time as the current deal owner; notifications already delivered stay with the previous owner. If the owner is deactivated and not yet reassigned, notifications go to the owner's team manager(s), else to Admins.

**DR-NTF-02 — Reopen throttling.** *Derived — pending confirmation (from BR-NTF-001).* `proposal_reopen` at most once per viewer per proposal per 2 hours; downloads at most once per viewer per version per hour; other events not throttled.

**DR-NTF-03 — Expiry warning lead time.** *Derived — pending confirmation (from BR-NTF-001, OD-22).* "About to expire" sent 48 h (Admin-configurable 24–336 h, OD-72) before the earliest applicable clock (link expiry, proposal validity, signature request expiry), once per clock instance; not sent for revoked links or terminal proposals.

**DR-NTF-04 — Manager visibility of notifications.** *Derived — pending confirmation (from BR-NTF-001).* Managers do not receive owner notifications for team deals by default; they see team activity via the digest (team option) and dashboards.

---

## 13. SIG — E-signature (BRD §9.12)

**Purpose.** Provides legally valid electronic signature on the exact proposal version, with multiple signers, signing order, identity verification, consent, reminders, completion certificate and tamper-evident signed PDF — through an integrated e-signature partner (OD-02). Addresses P3 (version confusion: signing tied to the exact version) and P4 (signing delays); supports AC-10 and the time-to-sign metric.

**Primary users.** Salesperson (requests, monitors, resends, voids); Signers (external, via provider); Sales Manager/Admin within scope.

**Interactions summary.** Salesperson requests signatures on a sent version → selects signers (deal contacts) and order → system creates a signature request at the provider with the frozen PDF (SHA-256) → provider emails signers, verifies identity (email; SMS optional), captures consent, collects signatures in order → provider webhooks update signer and request statuses → on completion the signed PDF and completion certificate are stored, sent to all parties, and AUT-002 closes the deal; decline/expiry/void handled per ODs.

### BR-SIG-001
> "Users shall be able to request signatures on a specific proposal version."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | OD-20, OD-21, OD-23; DR-PRP-04 |

- **Inputs / fields:** Proposal version (the current sent version; default); signers and order (BR-SIG-002); message to signers (0–2,000); expiry (days from send, 1–120, default = days until proposal validity date, capped by provider); reminder schedule (BR-SIG-008); SMS verification per signer (BR-SIG-005); signature field placement: from the template's signature block (one signature + name + date field per signer role), or provider default placement on the last page if the template has no signature block.
- **Behaviour:** Allowed for: Admin (all), Manager (team), Salesperson (own deals) (BRD §9.17). The version must be the current, non-superseded, sent version of a proposal in status Sent, Viewed or Accepted, not expired. If the current version is draft, the user must send it first (sending through SHR may be combined: "Send for signature" sends links and creates the request). Creates a SignatureRequest (status Pending) linked to the version and its PDF hash; dispatch to the provider is a background job with idempotency key; on provider acceptance → Sent. Only one open signature request per deal (DR-PRP-04, OD-23). The buyer page for this version shows "Review and sign" for signers, redirecting to the provider's signing session (or embedded where the provider supports it).
- **Validations:** Version state sent and current (`signature.version_not_current`); validity not passed (`signature.proposal_expired`); no missing placeholders (BR-TPL-008); ≥ 1 signer; no open request on the deal; PDF hash verification (DR-PRP-07).
- **System responses:** "Signature request sent to 2 signers." Timeline "Signature requested on v3".
- **Errors / exceptions:** Provider rejects/unavailable → request status stays Pending with "Sending to the signature service failed; we'll retry." and after final failure "Signature request couldn't be sent. Try again or contact support." `signature.provider_error` (request then Voided automatically with reason "Dispatch failed").
- **Dependencies:** BR-SIG-002..013, BR-PRP-005/006/007, BR-SHR-001, DR-PRP-04, DR-SIG-01.
- **Working assumptions:** OD-02, OD-03, OD-20, OD-21, OD-23.

### BR-SIG-002
> "Users shall be able to add multiple signers and set a signing order (one after another, or all at once)."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | DR-SIG-01; disposition aligned to SCOPE-RECONCILIATION.md §7.1 (§12 R2) |

- **Inputs / fields:** Signers (1–10): contact (must be a contact on the deal, DR-SIG-01; contacts with role "Signer" preselected), signer role label matching the template signature block (e.g. "Customer signatory"), no internal countersigner in Phase 1 (signers must be deal contacts; OD-71 WA), order number; mode: sequential (one after another) | parallel (all at once).
- **Behaviour:** Sequential: signer n receives the request only after signer n−1 has signed (signer status waiting → sent). Parallel: all receive at once. Mixed ordering (groups) not supported in Phase 1. Signer emails/names are taken from the contact at creation and frozen on the request.
- **Validations:** Each signer has name and valid email; no duplicate emails; contact on deal; SMS phone in E.164 if SMS verification chosen (BR-SIG-005).
- **System responses:** Signer list with per-signer status (waiting, sent, viewed, signed, declined, cancelled).
- **Errors / exceptions:** Signer not on deal → "Add <name> to the deal first." `signature.signer_not_on_deal`.
- **Dependencies:** BR-SIG-001/004/005/007, BR-CRM-003, DR-CRM-07.
- **Working assumptions:** OD-03 (provider supports sequential and parallel).

### BR-SIG-003
> "Signatures shall be legally valid in the target markets, for example under the ESIGN Act and UETA in the US and as standard electronic signatures under eIDAS in the EU. Whether to build or partner is an open decision (Section 16)."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | OD-01, OD-02, OD-03, OD-42 |

- **Behaviour:** Delivered by integrating an established e-signature provider behind an `ESignatureProvider` adapter (OD-02); no in-house signing cryptography. The signing process provides: intent to sign (explicit signature action), consent to electronic records and signatures (BR-SIG-006), signer identity verification (BR-SIG-004/005), association of signature with the exact document (hash, BR-SIG-011), record retention and reproducibility (signed PDF + certificate, BR-SIG-009/010), and audit trail — meeting US ESIGN/UETA and EU eIDAS simple electronic signature (SES) for B2B signers (OD-01). Advanced/qualified signatures are out of scope (BRD §5.3).
- **Validations:** Provider selection checklist per OD-03 must be satisfied before go-live; Legal sign-off on jurisdiction coverage (OD-01).
- **System responses / errors:** n/a (process requirement).
- **Dependencies:** BR-SIG-004..011, NFR-004.
- **Working assumptions:** OD-01, OD-02, OD-03, OD-42.

### BR-SIG-004
> "Each signer's identity shall be verified by email at minimum."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged | OD-03 |

- **Behaviour:** Each signer accesses signing only through a unique link delivered by the provider to the signer's email address (or, for the embedded entry from our buyer page, after the provider sends an email one-time code). The verification method and outcome are recorded in the completion certificate. Signing links are single-signer and not transferable; a forwarded viewer cannot sign (OD-26).
- **Validations:** Provider configuration enforces email authentication for every signer.
- **System responses / errors:** Provider-hosted.
- **Dependencies:** BR-SIG-002/009, BR-SHR-005.
- **Working assumptions:** OD-03, OD-26.

### BR-SIG-005
> "Signers shall be able to verify their identity with an SMS code."

| Priority | Disposition | Basis |
|---|---|---|
| Should | Clarified | OD-03 (provider capability) |

- **Inputs / fields:** Per signer: "Require SMS code" (default off); mobile number (E.164, required when on; prefilled from contact mobile).
- **Behaviour:** Provider sends an SMS code before signing; result recorded in the certificate. Costs per SMS borne by provider plan.
- **Validations:** Valid E.164 (`signature.invalid_phone`).
- **System responses / errors:** Provider-hosted; failed SMS verification shown on signer status as "verification failed" event.
- **Dependencies:** BR-SIG-002/004/009.
- **Working assumptions:** OD-03.

### BR-SIG-006
> "Each signer's consent to sign electronically shall be captured."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | OD-42 |

- **Behaviour:** Before signing, each signer is shown the provider's electronic record and signature disclosure (ERSD) with our Legal-approved wording (including how to withdraw consent and request a paper copy) and must agree; consent timestamp, IP and disclosure version are recorded in the completion certificate and synchronised to our signature events. A signer who refuses consent cannot sign; this is reported as a decline with reason "Consent not given" (BR-SIG-012).
- **Validations:** Provider configuration.
- **System responses / errors:** Provider-hosted.
- **Dependencies:** BR-SIG-003/009/012, NFR-004.
- **Working assumptions:** OD-42.

### BR-SIG-007
> "Signature requests shall have the statuses Pending, Sent, Viewed, Signed, Declined, Expired and Voided."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified (definitions, proposal effects) | OD-18, OD-19, OD-22, OD-25 |

- **Behaviour:** Statuses and transitions:

| Status | Meaning / trigger | Effect on proposal |
|---|---|---|
| Pending | Created; awaiting provider dispatch | none |
| Sent | Provider accepted; at least one signer notified | none (proposal stays Sent/Viewed/Accepted; UI badge "Signing in progress (0 of n)", OD-19) |
| Viewed | First signer opened the signing session | none |
| Signed | All signers signed; provider completion received | Proposal → Signed; version → signed; AUT-002 |
| Declined | Any signer declined (OD-25) | Proposal → Declined; AUT-003 |
| Expired | Provider expiry reached, or proposal validity passed (OD-22) | Signature expiry: proposal returns to prior Sent/Viewed; validity: proposal Expired |
| Voided | User void (BR-SIG-013), proposal voided, new version sent (OD-21), deal closed lost (DR-CRM-05), dispatch failure | Proposal unchanged unless the void was caused by proposal void |

  Terminal: Signed, Declined, Expired, Voided. Status updates come from verified provider webhooks (signature/HMAC) processed idempotently (DR-SIG-03), with a periodic reconciliation poll for missed webhooks (every 15 min for open requests). Each status and signer event writes a timeline event (actor buyer/system).
- **Validations:** Out-of-order or duplicate webhooks ignored; transitions only forward.
- **System responses:** Status badge; signer progress.
- **Errors / exceptions:** Webhook signature invalid → rejected (401) and security-logged.
- **Dependencies:** BR-SIG-001/012/013, BR-PRP-007, BR-AUT-002/003, BR-NTF-001.
- **Working assumptions:** OD-18, OD-19, OD-22, OD-25.

### BR-SIG-008
> "The platform shall send automatic reminders on a configurable schedule, and users can resend manually."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged | OD-03 |

- **Inputs / fields:** Organization default schedule (Admin): first reminder after N days (1–30, default 2), repeat every M days (1–30, default 3), max reminders (0–10, default 3); per-request override. Manual "Resend" per signer.
- **Behaviour:** Reminders sent by the provider (or by our scheduler calling the provider's remind API) to signers whose status is sent/viewed and not signed. Manual resend limited to once per signer per hour. Reminder events recorded on the timeline.
- **Validations:** Ranges; resend only for active signers of open requests (`signature.resend_not_allowed`).
- **System responses:** "Reminder sent to <signer>."
- **Errors / exceptions:** Provider failure → "Reminder couldn't be sent. Try again later."
- **Dependencies:** BR-SIG-007.
- **Working assumptions:** OD-03.

### BR-SIG-009
> "The platform shall produce a completion certificate recording signer names, emails, timestamps, IP addresses, signing events and a digital fingerprint of the document."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified (provider-produced, stored by us) | OD-02, OD-03 |

- **Behaviour:** On completion the provider's completion certificate (audit trail) is downloaded and stored immutably in object storage, linked to the signature request, with SHA-256. It must contain: each signer's name, email, verification method(s), consent event, view, sign (and decline) timestamps (UTC), IP addresses, user agents where available, the document fingerprint (hash) of the original and signed document, and request id. Our own signature event log (from webhooks) is stored alongside and shown in the UI. Certificate downloadable by users who can view the deal.
- **Validations:** Completion is not marked Signed in our system until both signed PDF and certificate are stored and verified (hash recorded); retried with backoff.
- **System responses:** "Signed document and certificate available."
- **Errors / exceptions:** Download failure → request shows "Completing…" and an operational alert after 1 hour.
- **Dependencies:** BR-SIG-003/010/011, NFR-004.
- **Working assumptions:** OD-02, OD-03.

### BR-SIG-010
> "The final signed PDF shall be tamper-evident, stored securely and sent to all parties."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | NFR-004; disposition aligned to SCOPE-RECONCILIATION.md §7.1 (§12 R2) |

- **Behaviour:** The provider-sealed signed PDF (digitally sealed so modifications are detectable in common PDF viewers) is stored in private object storage (encrypted at rest, access via short-lived signed URLs, downloads audited), with SHA-256 recorded. Delivered to all parties: all signers and the original recipients by provider completion email (attachment or secure link per provider) and to the deal owner (and internal signers) in-app and by email. Retained per OD-36 (exempt from erasure).
- **Validations:** Seal validity checked on receipt where the provider API exposes it.
- **System responses:** Signed PDF on the proposal and deal; timeline "Signed document stored".
- **Errors / exceptions:** As BR-SIG-009.
- **Dependencies:** BR-SIG-009/011, BR-PLT-010.
- **Working assumptions:** OD-03, OD-36.

### BR-SIG-011
> "A signed document shall be locked to the exact version signed; any change requires a new version and new signatures."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | DR-PRP-07; disposition aligned to SCOPE-RECONCILIATION.md §7.1 (§12 R2) |

- **Behaviour:** The signature request references the version id and the SHA-256 of the PDF sent to the provider; the signed version state becomes signed and immutable; the proposal becomes Signed (terminal). No edits, new versions or re-signing on a Signed proposal; changes after signing require a new proposal (copy, BR-PRP-010) with new signatures. Signing a superseded version is impossible (open requests are voided when a new version is sent, OD-21).
- **Validations:** Any attempt to edit/create a version on a Signed proposal → `proposal.signed_immutable`.
- **System responses / errors:** Editor read-only with banner "Signed — this proposal can't be changed."
- **Dependencies:** BR-PRP-006/007, BR-SIG-001.
- **Working assumptions:** OD-21.

### BR-SIG-012
> "Signers shall be able to decline and give a reason."

| Priority | Disposition | Basis |
|---|---|---|
| Should | Clarified | OD-25, OD-40 |

- **Behaviour:** Provider offers "Decline to sign" with a reason (required in provider configuration). Any single signer declining → signature request Declined; remaining signers cancelled and notified by the provider; proposal Declined with the reason; owner notified (`proposal_declined`); AUT-003 task created (OD-25). Delivered in the same release as BR-PRP-007/BR-NTF-001 (OD-40).
- **Validations:** Reason required (provider).
- **System responses:** Timeline "<Signer> declined to sign: <reason>".
- **Dependencies:** BR-SIG-007, BR-PRP-007, BR-NTF-001, BR-AUT-003.
- **Working assumptions:** OD-25, OD-40.

### BR-SIG-013
> "Users shall be able to cancel (void) a pending signature request."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified ("pending" = any open status) | OD-18 |

- **Inputs / fields:** Void reason (required, 1–500).
- **Behaviour:** Allowed for open requests (Pending, Sent, Viewed) by Admin (all), Manager (team), Salesperson (own deals) (BRD §9.17). Voids the request at the provider (signers notified by provider), sets status Voided, writes timeline. Voiding a signature request does not void the proposal; voiding a proposal voids its open request (OD-18).
- **Validations:** Not allowed on terminal requests (`signature.not_open`).
- **System responses:** "Signature request voided."
- **Errors / exceptions:** Provider void failure → retried; request marked "Voiding…"; if the provider reports completion before void succeeds, completion wins and the user is informed "The request was completed before it could be voided."
- **Dependencies:** BR-SIG-007, BR-PRP-007, DR-CRM-05.
- **Working assumptions:** OD-18.

### SIG derived requirements

**DR-SIG-01 — Signer must be a deal contact.** *Derived — pending confirmation (from BR-SIG-002; foundation §9 WA).* External signers must be contacts linked to the deal (any role); adding a new person requires adding them as a deal contact first (inline action available). Internal countersigners are active users.

**DR-SIG-02 — One open signature request per deal.** *Derived — pending confirmation (from OD-23).* See DR-PRP-04.

**DR-SIG-03 — Webhook idempotency and reconciliation.** *Derived — pending confirmation (from BR-SIG-007, OD-24).* Provider events are deduplicated by provider event id; completion processing is keyed by signatureRequestId so AUT-002 runs once; a reconciliation job runs **hourly** over open requests (A9, foundation §16 S4; RULE-SIG-14).

**DR-SIG-04 — New version while signing.** *Derived — pending confirmation (from OD-21).* Sending a new version prompts "Sending version n will void the open signature request on version n−1." Confirm voids it (reason "Superseded by version n").

**DR-SIG-05 — Sender of record after reassignment/deactivation.** *Derived — pending confirmation (from BR-PLT-011, foundation §9).* The provider sender of record is not changed; notifications and tasks follow the current deal owner (DR-NTF-01).

**DR-SIG-06 — Signer details frozen.** *Derived — pending confirmation (from BR-SIG-002).* Changing a contact's name/email after the request is created does not change the open request; to change a signer the request must be voided and recreated.

---

## 14. AUT — Automation (BRD §9.13)

**Purpose.** Keeps the pipeline accurate and drives follow-up without manual updates: stage moves on send, Closed Won on signature, tasks on decline and no engagement, stalled and overdue flags, all visible and reversible. Addresses P2, P5, P6; supports AC-11.

**Primary users.** System (actor); deal owners (receive tasks, see/reverse changes); Admin (configure thresholds and target stages).

**Interactions summary.** Domain events (proposal sent, all signed, declined; scheduled checks) → built-in rules (in code, parameters in `automation_setting`, ADR-024) evaluate preconditions → actions applied with an execution record (before/after snapshot, idempotency key) → timeline entry labelled "Automated" with "Reverse" action → reversal restores the before-state where still applicable.

### BR-AUT-001
> "When a proposal is sent, the deal shall move to a configured stage, if it is at an earlier stage."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified ("sent", "earlier") | DR-PRP-06; foundation §9 |

- **Inputs / fields:** Per pipeline: proposal-sent target stage (BR-CRM-005); rule enabled flag (Admin).
- **Behaviour:** Trigger: a proposal version becomes sent (DR-PRP-06), including subsequent versions. Condition: deal is open, the pipeline has a target stage, and the deal's current stage order is lower than the target's. Action: move the deal to the target stage (system actor), timeline "Stage moved from X to Y — automated (proposal P-… sent)". No change if the deal is already at or beyond the target, or closed. Idempotency key = proposalVersionId.
- **Validations:** Precondition re-checked at execution time (optimistic locking); skipped if no longer true (DR-AUT-02).
- **System responses:** Timeline entry with Reverse.
- **Errors / exceptions:** Failure retried; persistent failure logged and surfaced to Admin in the automation log.
- **Dependencies:** BR-CRM-005, BR-SHR-002, BR-AUT-008, BR-TIM-001.
- **Working assumptions:** Foundation §9 sent definition.

### BR-AUT-002
> "When all signers have signed, the deal shall be marked Closed Won, with the amount taken from the proposal and the close date set to the signing date."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | OD-16, OD-23, OD-24 |

- **Behaviour:** Trigger: signature request status Signed (all signers). Condition: deal not already Closed Won from this request (idempotency key = signatureRequestId, OD-24). Action (one transaction): deal stage → Closed Won of its pipeline; amount = signed version's TCV excluding tax (OD-16) in the deal currency; close date = date the last signer signed (organization time zone); other non-terminal proposals of the deal → Void "Another proposal was signed" (OD-23); open AUT follow-up tasks on the deal → cancelled; execution record stores previous stage, amount, close date and the voided proposals for reversal. If the deal was Closed Lost, it is moved to Closed Won and the owner is notified prominently ("Deal reopened as won after signature"). Timeline entries labelled automated.
- **Validations:** Precondition re-check at execution.
- **System responses:** Owner notification `proposal_signed`; dashboards update (BR-RPT-*).
- **Errors / exceptions:** Failure retried; never duplicated.
- **Dependencies:** BR-SIG-007, BR-PRC-003/004, BR-CRM-003, BR-AUT-008, BR-RPT-*.
- **Working assumptions:** OD-16, OD-23, OD-24.

### BR-AUT-003
> "When a proposal is declined, a task shall be created for the owner to record the outcome. The deal is not closed automatically."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | OD-25, OD-40; disposition aligned to SCOPE-RECONCILIATION.md §7.1 (§12 R2) |

- **Behaviour:** Trigger: proposal status → Declined (buyer decline BR-SHR-010 or signer decline BR-SIG-012). Action: task for the current deal owner: "Record outcome: <proposal> was declined — <reason>", type follow-up, due next business day, linked to the deal, source automation. The deal stage is not changed. Idempotency key = proposalId + versionId + decline event.
- **Validations:** n/a.
- **System responses:** Task in My Day; timeline entry labelled automated.
- **Errors / exceptions:** Retried.
- **Dependencies:** BR-SHR-010, BR-SIG-012, BR-CRM-008, BR-AUT-008.
- **Working assumptions:** OD-25, OD-40.

### BR-AUT-004
> "A follow-up task shall be created a configurable number of days after sending if the proposal has not been viewed or answered."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified ("answered") | foundation §9 WA; DR-AUT-03 |

- **Inputs / fields:** Admin: days after sending (1–60, default 3); business days vs calendar days (default business days, pending confirmation).
- **Behaviour:** Scheduled check per sent version. Condition at due time: version still current and not superseded; no buyer view (excluding internal views); and not answered (accepted, declined, signed, or an inbound email from a recipient/deal contact since sending, DR-AUT-03); deal open. Action: task "Follow up on proposal <number> — not viewed/answered after N days" for the current deal owner, due today, with "Draft follow-up with AI" shortcut (BR-AIA-005). One task per version. Idempotency key = versionId.
- **Validations:** n/a.
- **System responses:** Task; timeline entry labelled automated.
- **Errors / exceptions:** n/a.
- **Dependencies:** BR-SHR-002/004/010, BR-EML-002, BR-SIG-007, BR-CRM-008, BR-AIA-005, BR-RPT-005.
- **Working assumptions:** Foundation §9 ("answered").

### BR-AUT-005
> "Deals with no activity for a configurable number of days (set per stage) shall be flagged."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified ("activity") | OD-35 |

- **Inputs / fields:** Per stage: stalled-after days (BR-CRM-005).
- **Behaviour:** Daily job (and on-demand recalculation after relevant events) computes last activity per open deal = latest of: email in/out linked, meeting held, note, logged call/meeting, task completed, proposal view, stage change (user), buyer actions — excluding automated system events (OD-35). Flag "Stalled" when days since last activity > the stage's threshold; flag cleared automatically on new activity or stage change. Flag shown on deal, board card, lists, My Day, "deals needing attention" (BR-RPT-005); owner notified once when newly flagged (`deal_stalled`, preference-controlled). Flag set/clear writes a timeline entry labelled automated.
- **Validations:** Stages without threshold are not monitored.
- **System responses:** Flag badge with "No activity for N days".
- **Errors / exceptions:** n/a.
- **Dependencies:** BR-CRM-005/009, BR-RPT-005, BR-NTF-002, BR-TIM-001.
- **Working assumptions:** OD-35.

### BR-AUT-006
> "Deals past their expected close date shall be flagged."

| Priority | Disposition | Basis |
|---|---|---|
| Should | Clarified | OD-40 (delivered with dependent Musts); disposition aligned to SCOPE-RECONCILIATION.md §7.1 (§12 R2) |

- **Behaviour:** Daily job flags open deals whose expected close date is before today (organization time zone) as "Overdue"; cleared when the date is moved to today or later or the deal closes. Shown as BR-AUT-005; included in My Day and BR-RPT-005. Notification optional (preference).
- **Dependencies:** BR-CRM-003/009, BR-RPT-005.
- **Working assumptions:** OD-40.

### BR-AUT-007
> "Admins shall be able to configure simple rules (trigger, condition, action) from a predefined list."

| Priority | Disposition | Basis |
|---|---|---|
| Could | Unchanged (capacity permitting; extension point guaranteed) | ADR-024; foundation §2 |

- **Behaviour:** In Phase 1 the built-in rules (AUT-001..006) are stored as rule rows with editable parameters (enabled flag, thresholds, target stages) exposed in Admin settings — this is delivered regardless. If capacity allows, Admins may add rules from a predefined catalogue: triggers (deal stage changed, proposal sent/viewed/declined/accepted, form submitted, task overdue), conditions (pipeline, stage, amount range, owner team, custom field equals), actions (create task, notify user, set field value, move stage). Each rule execution is logged and reversible as BR-AUT-008. Loop protection: rule-caused changes do not trigger rules (depth 1).
- **Validations:** Rule must be complete; actions limited to the predefined list.
- **Dependencies:** BR-AUT-008, ADR-024.
- **Working assumptions:** Foundation §2 ("rules-based automation" in scope vs Could).

### BR-AUT-008
> "Every automated change shall appear on the timeline labeled as automated, and users can reverse it."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified (reversal semantics) | OD-24 |

- **Inputs / fields:** "Reverse" action on automated timeline entries; optional reason (0–500).
- **Behaviour:** Every automation execution writes a timeline entry with actor `system`, label "Automated", rule name and a link to the execution record. Reversible actions: stage move (restores previous stage if the deal is still at the automation's resulting stage), Closed Won (restores previous stage, amount, close date; proposal stays Signed; voided alternative proposals restored to their previous status) (OD-24), automatic proposal void (restores previous status), task creation (cancels the task), flag (clears it until the next evaluation — flags recompute, so reversal of a flag is a "snooze" for the threshold period). Reversal is allowed for users who can edit the deal; it is itself recorded (timeline "Reversed by <user>") and cannot be reversed again. If later manual changes conflict (e.g. stage changed again since), reversal is refused: "This change can't be reversed because the deal has changed since." `automation.reversal_conflict`. The same trigger never re-applies after reversal (idempotency).
- **Validations:** As above.
- **System responses:** "Change reversed."
- **Errors / exceptions:** As above.
- **Dependencies:** BR-AUT-001..007, BR-TIM-001/004.
- **Working assumptions:** OD-24.

### AUT derived requirements

**DR-AUT-01 — Idempotency of automation.** *Derived — pending confirmation (from ADR-024, OD-24).* Each rule execution has an idempotency key per trigger instance (version id, signature request id, decline event id, deal + day for scheduled flags); duplicates are ignored.

**DR-AUT-02 — Concurrency with manual changes.** *Derived — pending confirmation (from foundation §9 races).* Automation re-reads the record and re-checks preconditions within its transaction using optimistic locking; if the precondition no longer holds the execution is recorded as "skipped" with the reason.

**DR-AUT-03 — Definition of "answered".** *Derived — pending confirmation (from BR-AUT-004, foundation §9).* Accepted, declined, signed, or an inbound email from a recipient or any deal contact after the send time.

**DR-AUT-04 — Automation visibility for Admin.** *Derived — pending confirmation (from BR-AUT-008, BR-PLT-009).* Admin automation log lists executions (rule, record, outcome executed/skipped/failed/reversed, time) with filters.

**DR-AUT-05 — Automation does not fire on import or bulk system moves.** *Derived — pending confirmation (from BR-MIG-001, DR-CRM-10).* See DR-MIG-05.

---

## 15. RPT — Reporting and dashboards (BRD §9.14)

**Purpose.** Gives managers and admins a reliable, permission-scoped view of pipeline, outcomes, rep performance, proposal effectiveness, attention lists and activity. Addresses P5; supports AC-12 and the §12 metrics.

**Primary users.** Sales Manager (team), Admin (organization), Salesperson (own performance).

**Interactions summary.** Dashboards read from reporting views over CRM, proposal, sharing, signature and activity data → common filter bar (date range, team, owner, pipeline) → values converted to the organization currency (OD-15) → drill-down to record lists → CSV export.

### BR-RPT-001
> "A pipeline dashboard shall show deal count and value by stage, owner and pipeline."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | OD-15; disposition aligned to SCOPE-RECONCILIATION.md §7.1 (§12 R2) |

- **Inputs / fields:** Filters (BR-RPT-007); group by stage (default) | owner | pipeline; measure count | value.
- **Behaviour:** Open deals (status open) in scope; value = deal amount converted to organization default currency (DR-RPT-01); stage ordering per pipeline; when "all pipelines" is selected, stage grouping is shown per pipeline. Includes pipeline-created metric option (deals created in date range, OD-35). Drill-down to the deal list with the same filters.
- **Validations:** n/a.
- **System responses:** Bar/funnel chart and table; totals; data freshness timestamp (near real time; ≤ 5 minutes old).
- **Errors / exceptions:** Missing exchange rate → excluded count warning (BR-PRC-006).
- **Dependencies:** BR-CRM-003/005/006, BR-RPT-007/008, DR-PRC-02.
- **Working assumptions:** OD-15, OD-35.

### BR-RPT-002
> "Won and lost reporting shall show count, value, win rate and lost reasons."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified (metric definitions) | OD-35 |

- **Behaviour:** For deals closed in the date range (by close date): won count/value, lost count/value, win rate by count = won ÷ (won + lost) and by value = won value ÷ (won value + lost value) (OD-35); lost reasons breakdown (count, value, %); trend by month/fiscal quarter (fiscal year from BR-PLT-012). Division by zero shows "—".
- **Dependencies:** BR-CRM-014, BR-RPT-007/008.
- **Working assumptions:** OD-35.

### BR-RPT-003
> "Rep performance reporting shall show deals owned, won revenue, win rate, average deal size and average cycle length."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified (metric definitions) | OD-35 |

- **Behaviour:** Per owner (current owner attribution): open deals owned (now), won revenue (won value with close date in range), win rate (OD-35), average deal size (mean won value in range), average cycle length (mean calendar days from deal created to close date, won deals in range, OD-35). Salespeople see only their own row; managers their teams; Admin all. Deactivated users appear with "(deactivated)" when they have data in range.
- **Dependencies:** BR-RPT-007/008, BR-CRM-004.
- **Working assumptions:** OD-35.

### BR-RPT-004
> "Proposal reporting shall show time from deal creation to first proposal, proposals sent, view rate, time to first view, time to sign and proposal win rate."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified (metric definitions) | OD-35, OD-17 |

- **Behaviour (definitions):** Time from deal creation to first proposal = deal created → first version sent of any proposal on the deal (median and mean, days). Proposals sent = proposals with at least one version sent in range (and versions sent count). View rate = sent proposals with ≥ 1 buyer view (excluding internal) ÷ sent proposals. Time to first view = first send → first buyer view (median, hours). Time to sign = send of the version that was signed → signature completion (median, days) — "final proposal sent to fully signed" (§12). Proposal win rate = proposals Signed or Accepted ÷ proposals Sent, per proposal (OD-35, OD-17). Cohort by first-sent date in range.
- **Dependencies:** BR-SHR-002/004, BR-SIG-007, BR-PRP-007, BR-RPT-007/008.
- **Working assumptions:** OD-17, OD-35.

### BR-RPT-005
> "A "deals needing attention" list shall show stalled, overdue and unviewed-proposal deals."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | OD-40, OD-35 |

- **Behaviour:** List of open deals in scope with one or more reasons: Stalled (BR-AUT-005), Overdue (BR-AUT-006), Unviewed proposal (a current sent version not viewed by a buyer within the AUT-004 threshold). Columns: deal, owner, stage, amount, reasons, days since last activity, last proposal status. Sorted by amount descending by default. Same definition feeds My Day (BR-CRM-009). Optional "going quiet" filter: proposals with no buyer activity 14 days after sending (OD-35, §12).
- **Dependencies:** BR-AUT-004/005/006, BR-CRM-009.
- **Working assumptions:** OD-35, OD-40.

### BR-RPT-006
> "The platform shall show a weighted pipeline using stage probabilities."

| Priority | Disposition | Basis |
|---|---|---|
| Should | Clarified | OD-40 (delivered with BR-CRM-005); disposition aligned to SCOPE-RECONCILIATION.md §7.1 (§12 R2) |

- **Behaviour:** Weighted value = Σ(converted deal amount × current stage probability ÷ 100) over open deals in scope; shown by stage, owner, pipeline and expected close month/fiscal quarter, alongside unweighted value.
- **Dependencies:** BR-CRM-005, BR-RPT-001/007.
- **Working assumptions:** OD-40.

### BR-RPT-007
> "Dashboards shall be filterable by date range, team, owner and pipeline."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged | OD-32, OD-35 (date basis, team); disposition aligned to SCOPE-RECONCILIATION.md §7.1 (§12 R2) |

- **Inputs / fields:** Date range presets (this/last month, this/last quarter and fiscal quarter, this/last fiscal year, last 30/90 days, custom from–to, max 5 years); team (teams in scope); owner (users in scope, including deactivated); pipeline (one or all).
- **Behaviour:** Date basis per metric: won/lost by close date; pipeline-created metrics by created date; proposal metrics by first-sent date; activity by activity date (OD-35). Team filter = owners currently in the team (OD-32). Filters persist per user per dashboard and are reflected in the URL.
- **Validations:** From ≤ to; range ≤ 5 years.
- **Dependencies:** BR-RPT-001..006/010, BR-PLT-006/012.
- **Working assumptions:** OD-32, OD-35.

### BR-RPT-008
> "Dashboards shall respect each user's permissions."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Clarified | BRD §9.17 "View dashboards"; disposition aligned to SCOPE-RECONCILIATION.md §7.1 (§12 R2) |

- **Behaviour:** Admin: whole organization; Sales Manager: own team (records owned by members of managed teams + own); Salesperson: own performance only (records they own) — the view-only cross-visibility setting (OD-31) does not extend dashboards. Filter options limited to scope. Aggregates computed only over in-scope records; private email content never shown (counts only). Exports apply the same scope.
- **Dependencies:** BR-PLT-005/006, BR-RPT-009.
- **Working assumptions:** OD-31.

### BR-RPT-009
> "Users shall be able to export report data to CSV."

| Priority | Disposition | Basis |
|---|---|---|
| Should | Unchanged | — |

- **Behaviour:** Each dashboard widget and drill-down list offers "Export CSV" of the displayed data with current filters (UTF-8 with BOM, comma-separated, ISO dates, amounts with currency column); max 100,000 rows (larger → background export with notification). Exports are audited.
- **Dependencies:** BR-RPT-008, BR-PLT-009.
- **Working assumptions:** —

### BR-RPT-010
> "Activity reporting shall show emails, meetings and completed tasks per rep."

| Priority | Disposition | Basis |
|---|---|---|
| Should | Clarified (private emails counted) | OD-30 |

- **Behaviour:** Per rep in the date range: emails sent, emails received (linked to CRM records, including private emails as counts), meetings held (synced + logged), calls logged, notes added, tasks completed; trend by week. Automated events excluded.
- **Dependencies:** BR-EML-002/003/006, BR-CRM-008/010, BR-RPT-007/008.
- **Working assumptions:** OD-30.

### RPT derived requirements

**DR-RPT-01 — Currency conversion in reports.** *Derived — pending confirmation (from OD-15, BR-PRC-006).* Open pipeline converted at the latest rate on or before the report date; won/lost at the rate effective on the close date; records without an applicable rate excluded with a visible warning.

**DR-RPT-02 — Metric dictionary.** *Derived — pending confirmation (from OD-35).* All metric definitions in BR-RPT-002..005 are published in an in-app "How metrics are calculated" panel and in ACCEPTANCE-CRITERIA.md test data.

**DR-RPT-03 — Fiscal periods.** *Derived — pending confirmation (from BR-PLT-012).* Fiscal quarters/years derive from the fiscal year start month; changing it re-buckets historical reports (no stored period snapshots).

**DR-RPT-04 — Freshness.** *Derived — pending confirmation (from NFR-005).* Dashboards reflect committed data within 5 minutes; a "last updated" time is shown.

---

## 16. TIM — Timelines (BRD §9.15)

**Purpose.** One chronological record per deal (and combined for company/contact) of all sales, email, proposal, signing and automated events, with actor attribution — the shared memory of each deal. Addresses P6; supports AC-13 and feeds AI context.

**Primary users.** All users.

**Interactions summary.** Every module writes timeline events in the same transaction as the change (ADR-022) → deal/company/contact pages render paginated, filterable timelines → each entry shows actor type, actor, time, and links to the object; automated entries carry Reverse (BR-AUT-008).

### BR-TIM-001
> "Each deal shall have a single chronological timeline of emails, meetings, notes, tasks, stage changes, proposal events, signing events and automated actions."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged | ADR-022 |

- **Behaviour:** Event types (minimum): deal created/updated (amount, close date, owner, pipeline), stage changed, closed won/lost/reopened, email sent/received (private shown as "Private email" metadata, OD-30), meeting (synced/logged), call logged, note added/edited, task created/completed/cancelled, proposal created/version created/sent/viewed (session summary)/forwarded viewer/downloaded/accepted/declined/expired/voided, link revoked/expiry changed, signature requested/signer viewed/signed/declined/request expired/voided/completed, automation executed/reversed, AI summary saved, form submission, import. Ordered by event occurrence time (newest first by default; toggle oldest first); pinned notes at top. Infinite scroll with cursor pagination (50 per page). Each entry shows icon, summary, actor, time (user time zone, relative + absolute on hover) and expandable details (e.g. email body if permitted, view durations).
- **Validations:** n/a.
- **System responses / errors:** Empty state "No activity yet."
- **Dependencies:** All event-producing modules; BR-TIM-002/004.
- **Working assumptions:** OD-30.

### BR-TIM-002
> "Users shall be able to filter the timeline by event type."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged | — |

- **Inputs / fields:** Multi-select type groups: Emails, Meetings & calls, Notes, Tasks, Deal changes, Proposals, Signatures, Automation, Forms/Imports; actor filter (user, buyer, system, AI); date range.
- **Behaviour:** Filters apply server-side; selection persists per user.
- **Dependencies:** BR-TIM-001/003/004.
- **Working assumptions:** —

### BR-TIM-003
> "Company and contact timelines shall combine their related events."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged | DR-TIM-01 (combination rules); disposition aligned to SCOPE-RECONCILIATION.md §7.1 (§12 R2) |

- **Behaviour:** Company timeline = company's own events + events of all its deals + emails/meetings linked to the company or its contacts. Contact timeline = contact's own events + emails/meetings with the contact + proposal views/forwards/signatures by the contact + events of deals where the contact is a deal contact (deal-level events labelled with the deal name). Duplicates (same event reachable via several paths) shown once. Events of deals the user cannot see are excluded.
- **Dependencies:** BR-TIM-001, BR-CRM-001/002.
- **Working assumptions:** OD-31 (child visibility inheritance).

### BR-TIM-004
> "Each event shall show who performed it (user, buyer, system or AI) and when."

| Priority | Disposition | Basis |
|---|---|---|
| Must | Unchanged | foundation §5 actor types |

- **Behaviour:** Actor type user (name; "(deactivated)" if applicable), buyer (contact name and email; "unidentified viewer" not possible because identity is required), system (rule or job name, labelled "Automated" for automations), ai (feature name; shown for saved AI outputs; accepted AI content shows "AI-generated, accepted by <user>"). Timestamp of occurrence stored UTC with source precision (provider timestamps for signatures/emails).
- **Dependencies:** BR-TIM-001, BR-AIA-007, BR-AUT-008.
- **Working assumptions:** —

### TIM derived requirements

**DR-TIM-01 — Combination and de-duplication rules.** *Derived — pending confirmation (from BR-TIM-003).* As specified in BR-TIM-003; contact timelines include deal-level events only for deals where the contact holds a role.

**DR-TIM-02 — Timeline immutability.** *Derived — pending confirmation (from BR-TIM-001, BR-PLT-009).* Timeline events are append-only; corrections (e.g. note edits, link corrections, reversals) are new events or update the displayed object with an "edited" marker; system events cannot be deleted by users.

**DR-TIM-03 — Event time vs record time.** *Derived — pending confirmation (from BR-TIM-001).* Ordering uses the business occurrence time (email sent time, meeting start, signature time), not the sync/insert time; late-arriving events appear in their chronological position.

---

## 17. Non-functional requirements (BRD §10) — internal-deployment interpretation

Targets marked "proposed" in the BRD are adopted as stated unless an IDD/OD changes them. Sizing basis for all performance and capacity acceptance is OD-45 (≤ 150 internal users, ≤ 200k contacts, ≤ 100k companies, ≤ 100k deals, ≤ 5M synced emails, ≤ 20k proposals/year), which replaces NFR-007 (IDD-06).

| ID | Area | BRD requirement (verbatim) | Internal-deployment interpretation | Measurable acceptance |
|---|---|---|---|---|
| NFR-001 | Security | "Data encrypted in transit and at rest; complete separation of each organization's data; role-based access; multi-factor authentication available." | Separation satisfied by dedicated deployment/database/bucket (IDD-01). RBAC enforced server-side (BR-PLT-005, ADR-006). TOTP MFA available at launch (OD-13). OAuth tokens encrypted AES-256-GCM (ADR-012). | TLS 1.2+ only on all endpoints (scan shows no plaintext/weak ciphers); database, backups and object storage encrypted at rest (provider config evidence); automated authorization test suite covering every API route × role × scope passes 100%; MFA enrolment and enforcement tests pass; external penetration test with no open Critical/High findings before go-live. |
| NFR-002 | Privacy | "Compliance with applicable data protection law (for example GDPR) in target markets; a data processing agreement available to customers; user control over which emails are synced; customer deletion requests honored." | We are data controller; customer DPA clause replaced by processor DPAs with vendors, records of processing, DPIA (IDD-09 — compliance tasks). Email control = BR-EML-003. Deletion requests = governed erasure: anonymise contact personal fields, keep financial records, exempt signed documents/certificates/audit log (OD-36). | Erasure function anonymises all personal fields of a contact across CRM, emails, views, submissions within 30 days of request (test with seeded data); exclusion and private-email tests pass; DPIA and processor DPAs on file (compliance checklist signed by DPO). |
| NFR-003 | AI governance | "No training on customer data; a human approves before anything is sent externally; AI content labeled and logged; AI provider covered by data processing terms." | BR-AIA-006/007/009, IDD-07, OD-05. | Contract evidence of no-training/ZDR; tests prove no AI code path can call send endpoints; 100% of AI calls present in `ai_usage`; pending AI content blocks sending (test). |
| NFR-004 | E-signature compliance | "Signing process, consent and evidence meet the legal requirements of target markets; signed documents tamper-evident." | Via partner provider (OD-02/03) meeting ESIGN/UETA and eIDAS SES (OD-01); consent wording Legal-approved (OD-42). | Legal sign-off on provider and flow; end-to-end test produces sealed PDF that a standard viewer reports as unmodified and a certificate with all BR-SIG-009 fields; modifying the PDF invalidates the seal. |
| NFR-005 | Performance | "Proposed: common screens load in under 2 seconds for 95% of requests; proposal generation in under 10 seconds; notifications delivered within 1 minute of the event." | Kept as proposed (OD-45). "Common screens": My Day, deal/company/contact detail, list views (50 rows), board, search, buyer proposal view. | Load test at OD-45 data volumes with 150 concurrent users: p95 server response ≤ 500 ms for list/detail APIs and p95 time-to-interactive ≤ 2 s for common screens; PDF generation ≤ 10 s p95 for proposals ≤ 30 pages; event-to-notification ≤ 60 s p99 (in-app and email hand-off), design target < 5 s in-app. |
| NFR-006 | Availability | "Proposed: 99.5% monthly uptime for the application and buyer-facing proposal links." | Kept (OD-45). Measured separately for internal app and buyer links. | External uptime monitor (1-minute checks) on app health and a canary buyer link shows ≥ 99.5% per calendar month excluding announced maintenance (≤ 4 h/month, outside business hours). |
| NFR-007 | Scalability | "Proposed: support launch volumes of at least 100 organizations of up to 50 users each without redesign." | Replaced by internal sizing (IDD-06, OD-45). Single organization. | Performance tests of NFR-005 pass at 2× OD-45 data volumes without architecture change (horizontal `server` scaling only). |
| NFR-008 | Backup and recovery | "Proposed: daily backups; maximum data loss of 24 hours; recovery within 8 hours." | RPO 24 h, RTO 8 h (OD-45); point-in-time recovery recommended; object storage versioning for documents. | Daily automated database backups retained ≥ 30 days; quarterly restore drill restores database and files to a clean environment within 8 h with data no older than 24 h (drill report). |
| NFR-009 | Auditability | "Key user, admin, system and AI actions recorded in an audit log." | BR-PLT-009, BR-AIA-007, DR-PLT-07. | Test matrix: every action listed in BR-PLT-009 produces exactly one audit entry with actor, time, entity, before/after; entries are not modifiable via any API. |
| NFR-010 | Usability | "A new salesperson can send a first proposal without training; an admin can complete onboarding in under a day." | Internal: new salesperson = new hire on our team; admin onboarding = BR-PLT-008 Admin checklist with our data. | Moderated usability test: ≥ 4 of 5 salespeople without training send a first proposal from a seeded deal within 30 minutes; Admin completes setup checklist (import, pipeline, template) in < 1 working day in the pilot. |
| NFR-011 | Accessibility | "Application and buyer-facing views meet WCAG 2.1 AA." | Applies to `web`, `buyer`, `addin` UIs and generated PDFs where feasible (tagged PDF desirable, pending confirmation). | Automated axe checks with zero serious/critical violations on all routes; manual keyboard and screen-reader audit of core flows (create deal, create/send proposal, buyer view, accept/decline) with no WCAG 2.1 AA failures. |
| NFR-012 | Compatibility | "Current versions of Chrome, Edge, Safari and Firefox; responsive layout on mobile; PDF and DOCX open correctly in common viewers." | Current and previous major versions; mobile = iOS Safari, Android Chrome; viewers: Adobe Acrobat Reader, browser PDF viewers, Microsoft Word, Google Docs, LibreOffice. | Cross-browser E2E smoke suite passes on all listed browsers; buyer view usable at 360 px width; generated PDF/DOCX open without errors in all listed viewers (test corpus). |
| NFR-013 | Email deliverability | "Emails sent through users' own mailboxes; system notifications sent from properly authenticated domains." | User emails via Gmail/Graph APIs (BR-EML-004); system/buyer emails via transactional provider on a company subdomain (OD-14). | SPF, DKIM and DMARC (p=quarantine or stricter) pass for the notification subdomain (mail-tester / header checks); 0 system emails sent from unauthenticated domains. |
| NFR-014 | Maintainability | "Modular design so Phase 2 and 3 modules can be added without reworking Phase 1." | Modular monolith with module-owned tables and service APIs, domain events, provider adapters, rule table, block-based proposal model (ADR-001/008/010/012/015, IDD-13). | Architecture lint rule: no cross-module table access (CI check passes); every external integration behind an adapter interface; domain events published for all state changes listed in foundation §5. |
| NFR-015 | Data retention | "Retention periods configurable by admins within platform limits (to be defined)." | Configurable per category with platform limits; signed documents, certificates and audit log exempt from erasure (OD-36). | Admin retention settings for categories (emails, view events, lead submissions, AI generations, uploaded import files, exports) with min/max limits enforced; nightly retention job deletes/anonymises expired data (verified with time-shifted test data). |

---

## 18. Derived requirements index

All entries are *Derived — pending confirmation*.

| DR ID | Title | Derives from |
|---|---|---|
| DR-PLT-01 | First Admin bootstrap | BR-PLT-002, IDD-02 |
| DR-PLT-02 | Invitation lifecycle | BR-PLT-002 |
| DR-PLT-03 | User deactivation effects | BR-PLT-011, foundation §9 |
| DR-PLT-04 | Last-Admin protection | BR-PLT-005/011 |
| DR-PLT-05 | Credential policy | BR-PLT-003, NFR-001 |
| DR-PLT-06 | Export package contents and lifetime | BR-PLT-010, IDD-12 |
| DR-PLT-07 | Audit log access and retention | BR-PLT-009, OD-36 |
| DR-PLT-08 | Session management | BR-PLT-003, NFR-001 |
| DR-PLT-09 | Locale and formatting setting | BR-PLT-012, BR-CRM-007 |
| DR-PLT-10 | Common field validation conventions | NFR-001, ADR-005/016 |
| DR-MIG-01 | Import limits | BR-MIG-001, OD-45 |
| DR-MIG-02 | Undo conflict handling | BR-MIG-005 |
| DR-MIG-03 | Owner mapping | BR-MIG-001 |
| DR-MIG-04 | Stage and pipeline mapping | BR-MIG-001, BR-CRM-005 |
| DR-MIG-05 | No automation or notifications on import | BR-MIG-001, BR-AUT-* |
| DR-CRM-01 | Archive behaviour | BR-CRM-001/002 |
| DR-CRM-02 | Custom field formatting | BR-CRM-007, BR-TPL-002 |
| DR-CRM-03 | Custom field limits and deletion | BR-CRM-007 |
| DR-CRM-04 | Reopening closed deals | BR-CRM-003, OD-31, OD-24 |
| DR-CRM-05 | Manual Closed Lost with open signature request | BR-CRM-014 |
| DR-CRM-06 | Manual Closed Won | BR-CRM-003, BR-AUT-002 |
| DR-CRM-07 | Deal contact roles list | BR-CRM-003, OD-34 |
| DR-CRM-08 | Optimistic concurrency | ADR-016 |
| DR-CRM-09 | Deal requires company | BR-CRM-003, OD-33 |
| DR-CRM-10 | Stage removal | BR-CRM-005/006 |
| DR-EML-01 | Unknown-sender minimisation | BR-EML-002, OD-29 |
| DR-EML-02 | Idempotent email send | BR-EML-004, ADR-016 |
| DR-EML-03 | Token loss and reconnection | BR-EML-001 |
| DR-EML-04 | Retroactive exclusion | BR-EML-003 |
| DR-EML-05 | Employee mailbox privacy notice | BR-EML-001, NFR-002 |
| DR-EML-06 | Back-fill window | BR-EML-001, OD-45 |
| DR-LED-01 | Assignment fallback and rule health | BR-LED-002 |
| DR-LED-02 | Form privacy text and consent | BR-LED-001, NFR-002 |
| DR-LED-03 | Durable submission intake | BR-LED-001, NFR-006 |
| DR-LED-04 | Free-mail domain exclusion | OD-26, OD-27, OD-33 |
| DR-LED-05 | Resubmissions | BR-LED-004 |
| DR-LED-06 | Submission retention | NFR-015, OD-36 |
| DR-TPL-01 | Template draft/publish and version semantics | BR-TPL-001/004 |
| DR-TPL-02 | Template health check | BR-TPL-008, BR-CRM-007 |
| DR-TPL-03 | Placeholder fallback and overrides | BR-TPL-002/008 |
| DR-TPL-04 | Template permissions | BRD §9.17, OD-31 |
| DR-PRC-01 | Calculation and rounding | BR-PRC-002/003 |
| DR-PRC-02 | Exchange-rate table | BR-PRC-006, OD-15 |
| DR-PRC-03 | Price snapshot | BR-PRC-001/002 |
| DR-PRC-04 | Tax rate snapshot | BR-PRC-001/002 |
| DR-PRP-01 | Version-creation semantics | BR-PRP-006, foundation §9 |
| DR-PRP-02 | Re-send after Declined/Expired/Void | BR-PRP-007 |
| DR-PRP-03 | Internal preview excluded from tracking | BR-PRP-004, BR-SHR-004 |
| DR-PRP-04 | One open signature request per deal | OD-23, BR-SIG-001 |
| DR-PRP-05 | Alternative proposals and automatic void on signing | OD-23 |
| DR-PRP-06 | Definition of "sent" | BR-AUT-001/004, foundation §9 |
| DR-PRP-07 | Frozen snapshot integrity | BR-PRP-005/006, BR-SIG-011 |
| DR-PRP-08 | Proposals only on open deals | BR-PRP-001 |
| DR-AIA-01 | Prompt-injection guard | BR-AIA-001/003/005 |
| DR-AIA-02 | AI usage budget controls | IDD-10, BR-AIA-007 |
| DR-AIA-03 | Graceful degradation | BR-AIA-001..005, NFR-006 |
| DR-AIA-04 | Prompt versioning | BR-AIA-007 |
| DR-SHR-01 | Per-recipient links | BR-SHR-001/003/004 |
| DR-SHR-02 | Superseded-version links | OD-21 |
| DR-SHR-03 | View session definition | BR-SHR-004 |
| DR-SHR-04 | Link-scanner filtering | BR-SHR-004 |
| DR-SHR-05 | Identity-gate privacy notice | OD-26 |
| DR-SHR-06 | Public endpoint protection | ADR-013, NFR-001 |
| DR-SHR-07 | Buyer-initiated forward | BR-SHR-005, OD-14 |
| DR-NTF-01 | Notification routing on reassignment/deactivation | BR-NTF-001, BR-CRM-004, BR-PLT-011 |
| DR-NTF-02 | Reopen throttling | BR-NTF-001 |
| DR-NTF-03 | Expiry warning lead time | BR-NTF-001, OD-22 |
| DR-NTF-04 | Manager visibility of notifications | BR-NTF-001 |
| DR-SIG-01 | Signer must be a deal contact | BR-SIG-002 |
| DR-SIG-02 | One open signature request per deal | OD-23 |
| DR-SIG-03 | Webhook idempotency and reconciliation | BR-SIG-007, OD-24 |
| DR-SIG-04 | New version while signing | OD-21 |
| DR-SIG-05 | Sender of record after reassignment/deactivation | BR-PLT-011 |
| DR-SIG-06 | Signer details frozen | BR-SIG-002 |
| DR-AUT-01 | Idempotency of automation | ADR-024, OD-24 |
| DR-AUT-02 | Concurrency with manual changes | foundation §9 |
| DR-AUT-03 | Definition of "answered" | BR-AUT-004 |
| DR-AUT-04 | Automation visibility for Admin | BR-AUT-008, BR-PLT-009 |
| DR-AUT-05 | Automation does not fire on import or bulk system moves | BR-MIG-001, DR-CRM-10 |
| DR-RPT-01 | Currency conversion in reports | OD-15 |
| DR-RPT-02 | Metric dictionary | OD-35 |
| DR-RPT-03 | Fiscal periods | BR-PLT-012 |
| DR-RPT-04 | Freshness | NFR-005 |
| DR-TIM-01 | Combination and de-duplication rules | BR-TIM-003 |
| DR-TIM-02 | Timeline immutability | BR-TIM-001, BR-PLT-009 |
| DR-TIM-03 | Event time vs record time | BR-TIM-001 |

Total derived requirements: **86**.

---

## 19. Proposed new open decisions (numbered in OPEN-DECISIONS.md as OD-55..OD-81)

The following gaps surfaced while specifying; each has a working value in this document that must be confirmed.

| Topic | Working value used here | Where used | Suggested owner | Numbered as |
|---|---|---|---|---|
| Rounding policy for pricing (per line vs on totals; half-up vs banker's) | Per line, half-up, 2 decimals | DR-PRC-01 | Finance | OD-49 (WA per §12 R11) |
| Free-mail domain handling in company matching | Maintained exclusion list; no company/deal created from free-mail domains without a company name | DR-LED-04, BR-SHR-005, BR-CRM-001 | Sales Ops | §12 R3 (accepted WA) |
| Definition of a "reopen" and notification throttling | New session ≥ 30 min after previous; max 1 reopen notice per viewer per proposal per 2 h | DR-SHR-03, DR-NTF-02 | Product with Sales | OD-73 |
| Expiry-warning lead time | 48 h, Admin-configurable 24–336 h | DR-NTF-03 | Product | OD-72 (WA 48 h) |
| Internal countersignature (our signatory on the proposal) | Not supported in Phase 1 (signers must be deal contacts, OD-54 item k) | BR-SIG-002 | Sales Leadership + Legal | OD-71 (WA: not supported) |
| Default AUT-004 follow-up period and business vs calendar days | 3 business days | BR-AUT-004 | Sales Leadership | OD-74 |
| Import limits and undo window | 25 MB / 50,000 rows; undo without time limit, records modified after import skipped | DR-MIG-01/02 | Sales Ops + Tech Lead | OD-59 (WA: undo without time limit, modified records skipped) |
| Invitation expiry, session lifetimes, lockout thresholds | 7 days; idle 12 h, absolute 30 days; 10 attempts/15 min | DR-PLT-02/05/08 | IT/Security | OD-75, OD-76 |
| Whether OAuth sign-ins also require CRM TOTP | Off by default (IdP MFA relied upon) | BR-PLT-004 | IT/Security | OD-77 |
| AI budget values and per-user limits | Admin-set monthly budget; alert 80%; block 100% | DR-AIA-02 | Tech Lead + Finance | OD-53 |
| Buyer DOCX download | Off by default (PDF only for buyers) | BR-SHR-004 | Product | OD-70 |
| CAPTCHA provider outage behaviour (fail-open vs fail-closed) | Fail-open, marked "unverified" (WORKFLOWS WA-8 aligned) | BR-LED-006 | Product + Security | OD-62 |
| Audit log retention period | 7 years | DR-PLT-07 | Legal/DPO | OD-36 |
| Duplicate-deal suppression window for repeat form submissions | 30 days per contact + pipeline + form | DR-LED-05 | Sales Ops | OD-61 |
| Whether reversing an automated "Closed Won" should also be allowed after the deal was manually edited | Refused on conflict | BR-AUT-008 | Product | OD-24 (A9: compare-and-swap; diff shown, confirmation required) |

---

## 20. Traceability check

| Module | BR IDs specified in this document | Count |
|---|---|---|
| PLT | BR-PLT-001 … BR-PLT-012 | 12 |
| MIG | BR-MIG-001 … BR-MIG-007 | 7 |
| CRM | BR-CRM-001 … BR-CRM-014 | 14 |
| EML | BR-EML-001 … BR-EML-007 | 7 |
| LED | BR-LED-001 … BR-LED-007 | 7 |
| TPL | BR-TPL-001 … BR-TPL-008 | 8 |
| PRC | BR-PRC-001 … BR-PRC-007 | 7 |
| PRP | BR-PRP-001 … BR-PRP-010 | 10 |
| AIA | BR-AIA-001 … BR-AIA-009 | 9 |
| SHR | BR-SHR-001 … BR-SHR-010 | 10 |
| NTF | BR-NTF-001 … BR-NTF-004 | 4 |
| SIG | BR-SIG-001 … BR-SIG-013 | 13 |
| AUT | BR-AUT-001 … BR-AUT-008 | 8 |
| RPT | BR-RPT-001 … BR-RPT-010 | 10 |
| TIM | BR-TIM-001 … BR-TIM-004 | 4 |
| **Total** | | **130** |

BRD acceptance criteria mapping (summary; detailed FAC-* in ACCEPTANCE-CRITERIA.md): AC-01 → BR-PLT-002/005/006 (trial part n/a, IDD-02); AC-02 → BR-MIG-001..005; AC-03 → BR-CRM-001..014; AC-04 → BR-EML-001/002/006 (company provider first, OD-06); AC-05 → BR-EML-005 (OD-07); AC-06 → BR-LED-001..003; AC-07 → BR-PRP-001..005, BR-PRC-002; AC-08 → BR-AIA-001/002/006; AC-09 → BR-SHR-004/005, BR-NTF-001; AC-10 → BR-SIG-001..011; AC-11 → BR-AUT-001/002; AC-12 → BR-RPT-001..004/008; AC-13 → BR-TIM-001; AC-14 → BR-PLT-009/010 (billing part Out, IDD-03); AC-15..AC-18 → internal rollout acceptance (IDD-14, OD-10).
