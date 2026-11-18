# User Stories — Internal Sales CRM, Phase 1

| Item | Value |
|---|---|
| Source | BRD v2.0 (Sales_CRM_Phase_1_BRD_v2.0.docx) §6, §9, §11, §14; Design Foundation (binding) |
| Scope basis | Single-company, single-tenant internal deployment (IDD-01..IDD-16) |
| Verification | Every story references the `FAC-<MOD>-NN` criteria in [ACCEPTANCE-CRITERIA.md](ACCEPTANCE-CRITERIA.md) that verify it |
| Status | Draft — release plan is a recommendation only (OD-08) |

## 1. Conventions

- **ID**: `US-<MOD>-NN`, module codes as in the BRD (PLT, MIG, CRM, EML, LED, TPL, PRC, PRP, AIA, SHR, NTF, SIG, AUT, RPT, TIM).
- **Persona** (IDD-16): `ADM` = Admin / Sales Ops; `MGR` = Sales Manager; `SP` = Salesperson; `EXT` = Recipient / Signer (external, no user account); `SYS` = System (behaviour the platform performs without a user action). Where a story is phrased for SP it applies to every role that holds the permission (§9.17, OD-31) unless stated otherwise.
- **Priority** is inherited from the BRD requirement (highest priority wins when a story covers several). BRD priority labels are never changed (OD-40).
- **Release** (OD-08 WA, recommendation): **R1** = core CRM + proposals + sharing (plus platform, import, lead capture, notifications, automation, reporting, timelines — see §2); **R2** = email/calendar + AI + e-signature; **R3** = inbox add-in, HubSpot/Pipedrive import, remaining Shoulds. This plan matches foundation §12 resolution R1 and PRD §7 exactly (LED incl. BR-LED-006 and BR-MIG-006 in R1; BR-EML-007 in R2); internal go-live recommended at end of R2 (OD-48). OD-40 is honoured: BR-AUT-006, BR-SHR-010, BR-PRP-009, BR-RPT-006 ship in R1 with their dependent Musts; BR-SIG-012 ships in R2 with BR-SIG-007. BR-PLT-004 is R1 per OD-13 ("implemented at launch"). BR-TPL-007 is R1 per IDD-11 ("supplied at go-live").
- **Depends**: other stories that must be delivered first (or in the same release).
- **(IDD-nn / OD-nn)** marks where a story relies on an Internal Deployment Decision or a Working Assumption.

## 2. Release placement rules applied

| Rule | Basis |
|---|---|
| Modules not named in OD-08 (PLT, MIG Musts, LED, NTF, AUT, RPT, TIM) are placed in R1 because R1 Musts (CRM-009, RPT-005, PRP-007) consume them | OD-08, OD-40; confirmed by foundation §12 resolution R1 |
| BR-SHR-002 is split: R1 = copy link + "link shared manually" (foundation §9 definition of "sent"); R2 = send through own mailbox from the CRM (needs BR-EML-001/004); R3 = send from the inbox add-in (BR-EML-005) | OD-07, OD-08 |
| BR-NTF-001 "signed" and signature-related "declined" events ship in R2 with SIG; proposal open/reopen/forward/download/accept/decline (buyer) and link-expiry events ship in R1 | OD-08, OD-17 |
| Release plan matches foundation §12 resolution R1 exactly (authoritative; PRD §7 matches): R1 = PLT (excl. BR-PLT-007), MIG-001/003/004/005/006, CRM, TPL, PRC, PRP, SHR (manual link share), NTF, AUT, RPT, TIM, LED incl. BR-LED-006; R2 = EML-001..004/006/007, BR-SHR-002 via mailbox, AIA, SIG; R3 = BR-EML-005 add-in, BR-MIG-002, remaining Shoulds, Coulds if capacity. Internal go-live recommended at end of R2; R1 may run as a pilot | §12 R1, OD-08, OD-48 |
| BR-AUT-002 is built in R1 (AUT in R1) but its signature trigger first fires when SIG goes live in R2 (US-SIG-14) | §12 R1 |
| BR-LED-006 spam protection ships with BR-LED-001 in R1: public forms must not go live without it | §12 R1, OD-46 |
| BR-MIG-002 (Should) is conditional: built only if we currently use HubSpot or Pipedrive | OD-09 |
| Could items not deferred by an OD (BR-LED-007, BR-AUT-007) are storied as R3 "if capacity allows"; they have no FAC (FACs are mandatory for Must/Should only) | BRD §9 priority key |

## 3. Epic map

| Epic | Module | Goal (BRD pain) | Stories | Releases |
|---|---|---|---|---|
| E-PLT Platform & accounts | PLT | Users, roles, teams, setup, audit, export (P9) | US-PLT-01..17 | R1 |
| E-MIG Data import | MIG | Switch from current tools (P9) | US-MIG-01..06 | R1, R3 |
| E-CRM CRM records | CRM | Companies, contacts, deals, pipelines, tasks, views (P5, P6) | US-CRM-01..18 | R1, R3 |
| E-EML Email & calendar | EML | Automatic activity capture, send from mailbox, add-in (P6) | US-EML-01..13 | R2, R3 |
| E-LED Lead capture | LED | Web leads created and assigned (P7) | US-LED-01..07 | R1, R3 |
| E-TPL Templates & content | TPL | Consistent proposals from shared templates (P1, P8) | US-TPL-01..09 | R1, R3 |
| E-PRC Catalog & pricing | PRC | Accurate pricing tables (P1) | US-PRC-01..08 | R1, R3 |
| E-PRP Proposal generation | PRP | Proposals from deal data, versions, files (P1, P3) | US-PRP-01..13 | R1, R3 |
| E-AIA AI assistance | AIA | Drafting, checks, summaries with human control (P1) | US-AIA-01..10 | R2, R3 |
| E-SHR Sharing & tracking | SHR | Visibility after sending, forwarding (P2) | US-SHR-01..12 | R1, R2, R3 |
| E-NTF Notifications | NTF | Real-time alerts (P2) | US-NTF-01..03 | R1, R2, R3 |
| E-SIG E-signature | SIG | Legally valid signing (P3, P4) | US-SIG-01..14 | R2, R3 |
| E-AUT Automation | AUT | Pipeline updates itself (P2, P5, P6) | US-AUT-01..09 | R1, R2, R3 |
| E-RPT Reporting | RPT | Real pipeline visibility (P5) | US-RPT-01..11 | R1, R3 |
| E-TIM Timelines | TIM | Full history in one place (P6) | US-TIM-01..04 | R1 |

## 4. Stories

### 4.1 PLT — Platform and accounts

| ID | Persona | Story | BR (basis) | Pri | Rel | Depends | Verified by |
|---|---|---|---|---|---|---|---|
| US-PLT-01 | SYS | As the System, I want the deployment to hold exactly one organization in a dedicated database with a singleton settings record, so that our company's data is separated from any other system by construction. | BR-PLT-001 (IDD-01) | Must | R1 | — | FAC-PLT-01; NFR-001 |
| US-PLT-02 | ADM | As an Admin, I want the first Admin account to be created by a one-time bootstrap command, so that the system can be initialised without a public sign-up page. | BR-PLT-002 (IDD-02) | Must | R1 | US-PLT-01 | FAC-PLT-02, FAC-PLT-04 |
| US-PLT-03 | ADM | As an Admin, I want to invite colleagues by email with a role and optional team, so that only people I invite get access. | BR-PLT-002, BR-PLT-005, BR-PLT-006 (IDD-02) | Must | R1 | US-PLT-02 | FAC-PLT-03, FAC-PLT-04 |
| US-PLT-04 | SP | As a user, I want to sign in with my own email and password or my company Google/Microsoft account, so that my access is individual and convenient. | BR-PLT-003 (OD-12) | Must | R1 | US-PLT-03 | FAC-PLT-05, FAC-PLT-06 |
| US-PLT-05 | ADM | As an Admin, I want to disable password sign-in, so that everyone authenticates through the company identity provider. | BR-PLT-003 (OD-12) | Must | R1 | US-PLT-04 | FAC-PLT-07 |
| US-PLT-06 | SP | As a user, I want to enrol an authenticator app (TOTP) as a second factor, so that my account is protected if my password leaks. | BR-PLT-004 (OD-13) | Should | R1 | US-PLT-04 | FAC-PLT-08 |
| US-PLT-07 | ADM | As an Admin, I want to require MFA for all users or for Admins, so that privileged and customer data access is protected. | BR-PLT-004 (OD-13) | Should | R1 | US-PLT-06 | FAC-PLT-09 |
| US-PLT-08 | ADM | As an Admin, I want to assign and change each user's role (Admin, Sales Manager, Salesperson), so that permissions follow §9.17. | BR-PLT-005 (OD-31) | Must | R1 | US-PLT-03 | FAC-PLT-10, FAC-PLT-11 |
| US-PLT-09 | ADM | As an Admin, I want to create teams, add members (one team per user) and assign one or more managers, so that manager visibility matches our org chart. | BR-PLT-006 (OD-32) | Must | R1 | US-PLT-08 | FAC-PLT-12, FAC-PLT-14 |
| US-PLT-10 | MGR | As a Sales Manager, I want to see and edit records owned by members of the teams I manage plus my own, so that I can manage the team pipeline. | BR-PLT-006, BR-PLT-005 (OD-31, OD-32) | Must | R1 | US-PLT-09 | FAC-PLT-13, FAC-PLT-14 |
| US-PLT-11 | ADM | As an Admin, I want an internal setup checklist (import data, configure pipeline, create first template), so that go-live configuration is complete. | BR-PLT-008 (IDD-04) | Must | R1 | US-MIG-01, US-CRM-06, US-TPL-01 | FAC-PLT-15 |
| US-PLT-12 | SP | As a Salesperson, I want a personal checklist (connect mailbox, send first proposal), so that I can get productive without training. | BR-PLT-008 (IDD-04), NFR-010 | Must | R1 (mailbox item R2) | US-EML-01, US-SHR-02 | FAC-PLT-16 |
| US-PLT-13 | SYS | As the System, I want to write an append-only audit entry for key user, admin, system and AI actions, so that we can investigate who did what. | BR-PLT-009, NFR-009 | Must | R1 | — | FAC-PLT-17 |
| US-PLT-14 | ADM | As an Admin, I want to search and filter the audit log, so that I can answer security and compliance questions. | BR-PLT-009 | Must | R1 | US-PLT-13 | FAC-PLT-18 |
| US-PLT-15 | ADM | As an Admin, I want to export all organization data in CSV/JSON plus a file archive of signed documents, so that we have backup, exit and compliance copies. | BR-PLT-010 (IDD-12, OD-30) | Must | R1 | — | FAC-PLT-19, FAC-PLT-20 |
| US-PLT-16 | ADM | As an Admin, I want to deactivate a leaver and reassign their open deals, tasks and proposals, so that no customer work is orphaned and access ends immediately. | BR-PLT-011 | Must | R1 | US-CRM-05 | FAC-PLT-21, FAC-PLT-22 |
| US-PLT-17 | ADM | As an Admin, I want to manage organization name, branding, default currency, time zone and fiscal year, so that documents, dates and reports are correct. | BR-PLT-012, BR-PRC-005 | Must | R1 | US-PLT-01 | FAC-PLT-23, FAC-PLT-24 |

### 4.2 MIG — Data import

| ID | Persona | Story | BR (basis) | Pri | Rel | Depends | Verified by |
|---|---|---|---|---|---|---|---|
| US-MIG-01 | ADM | As an Admin, I want to upload a CSV or Excel file and map its columns to standard and custom fields of companies, contacts and deals, so that I can bring existing data in. | BR-MIG-001 | Must | R1 | US-CRM-08 | FAC-MIG-01, FAC-MIG-02 |
| US-MIG-02 | ADM | As an Admin, I want the import validated with an error report before anything is saved, so that bad data never enters the CRM. | BR-MIG-004 | Must | R1 | US-MIG-01 | FAC-MIG-06 |
| US-MIG-03 | ADM | As an Admin, I want duplicates detected and to choose skip, merge or create new per record, so that the import does not create duplicate companies or contacts. | BR-MIG-003 (OD-27) | Must | R1 | US-MIG-01 | FAC-MIG-04, FAC-MIG-05 |
| US-MIG-04 | ADM | As an Admin, I want to undo an import batch, so that a mistaken import can be reversed safely. | BR-MIG-005 | Must | R1 | US-MIG-01 | FAC-MIG-07, FAC-MIG-08 |
| US-MIG-05 | ADM | As an Admin, I want guided import of HubSpot or Pipedrive export files with preset mappings, so that switching from our current tool is fast. | BR-MIG-002 (OD-09, conditional) | Should | R3 | US-MIG-01..04 | FAC-MIG-03 |
| US-MIG-06 | ADM | As an Admin, I want to upload an existing DOCX proposal as the starting point for a template, so that our current proposal content is reused. (Admin-only, §12 R8: Managers with template rights cannot upload DOCX.) | BR-MIG-006 (§12 R8) | Should | R1 | US-TPL-01 | FAC-MIG-09 |

### 4.3 CRM — CRM records

| ID | Persona | Story | BR (basis) | Pri | Rel | Depends | Verified by |
|---|---|---|---|---|---|---|---|
| US-CRM-01 | SP | As a Salesperson, I want to create, view, update and archive company records, so that account data stays current. | BR-CRM-001 (OD-31) | Must | R1 | US-PLT-08 | FAC-CRM-01, FAC-CRM-02 |
| US-CRM-02 | SP | As a Salesperson, I want to manage contacts and link each to a primary company, so that I know who works where. | BR-CRM-002 (OD-33, OD-27) | Must | R1 | US-CRM-01 | FAC-CRM-03 |
| US-CRM-03 | SP | As a Salesperson, I want to manage deals with name, amount, expected close date, stage, owner, company and contacts with one or more roles, so that each opportunity is fully described. | BR-CRM-003 (OD-33, OD-34) | Must | R1 | US-CRM-02, US-CRM-06 | FAC-CRM-04, FAC-CRM-05 |
| US-CRM-04 | MGR | As a Sales Manager, I want to reassign deals between members of my teams, so that I can balance workload. | BR-CRM-004 (OD-31) | Must | R1 | US-PLT-10 | FAC-CRM-06, FAC-CRM-07 |
| US-CRM-05 | ADM | As an Admin, I want to reassign any deal to any active user, so that ownership is always correct. | BR-CRM-004 | Must | R1 | US-CRM-03 | FAC-CRM-06 |
| US-CRM-06 | ADM | As an Admin, I want to configure a pipeline's open stages, their order and win probabilities, with system Closed Won/Closed Lost stages, so that the pipeline reflects our sales process. | BR-CRM-005 | Must | R1 | — | FAC-CRM-08, FAC-CRM-09 |
| US-CRM-07 | ADM | As an Admin, I want to create additional pipelines, so that different sales motions have their own stages. | BR-CRM-006 | Should | R3 | US-CRM-06 | FAC-CRM-10 |
| US-CRM-08 | ADM | As an Admin, I want custom fields (text, number, currency, date, dropdown, multi-select, checkbox) on companies, contacts and deals, usable in filters, reports and templates, so that we capture our own data. | BR-CRM-007 | Must | R1 | — | FAC-CRM-11, FAC-CRM-12 |
| US-CRM-09 | SP | As a Salesperson, I want tasks with due dates and reminders linked to records, so that I never miss a follow-up. | BR-CRM-008 (OD-47) | Must | R1 | US-CRM-03 | FAC-CRM-13 |
| US-CRM-10 | SP | As a Salesperson, I want a "My Day" view of today's and overdue tasks and deals needing attention, so that I know what to do first. | BR-CRM-009 (OD-40) | Must | R1 | US-CRM-09, US-AUT-06, US-AUT-07, US-RPT-05 | FAC-CRM-14 |
| US-CRM-11 | SP | As a Salesperson, I want to add notes and manually log calls and meetings, so that offline interactions are on record. | BR-CRM-010 | Must | R1 | US-CRM-03 | FAC-CRM-15 |
| US-CRM-12 | SP | As a Salesperson, I want to filter, sort and save list views and see deals on a board grouped by stage, so that I can work my pipeline efficiently. | BR-CRM-011 | Must | R1 | US-CRM-03 | FAC-CRM-16, FAC-CRM-17 |
| US-CRM-13 | SP | As a Salesperson, I want to search across companies, contacts, deals and proposals, so that I find any record quickly. | BR-CRM-012 | Must | R1 | US-CRM-03, US-PRP-01 | FAC-CRM-18 |
| US-CRM-14 | MGR | As a Sales Manager, I want to edit and reassign records in bulk within my permissions, so that clean-up and territory changes are fast. | BR-CRM-013 (OD-31) | Should | R3 | US-CRM-04 | FAC-CRM-19 |
| US-CRM-15 | SP | As a Salesperson, I want closing a deal as lost to require a lost reason from the admin list, so that loss analysis is reliable. | BR-CRM-014 | Must | R1 | US-CRM-16 | FAC-CRM-20, FAC-CRM-21 |
| US-CRM-16 | ADM | As an Admin, I want to maintain the list of lost reasons, so that reasons are consistent. | BR-CRM-014 (OD-31) | Must | R1 | — | FAC-CRM-20 |
| US-CRM-17 | SP | As a deal owner, I want to reopen a closed deal by giving a reason, so that mistakes or revived opportunities can be handled with an audit trail. | BR-CRM-003, BR-CRM-014 (OD-31) | Must | R1 | US-CRM-15 | FAC-CRM-22 |
| US-CRM-18 | ADM | As an Admin, I want to grant Salespeople view-only access to others' companies, contacts or deals per object type, so that collaboration is possible without edit rights. | BR-PLT-005, BR-CRM-001 (§9.17, OD-31) | Must | R1 | US-PLT-08 | FAC-CRM-02 |

### 4.4 EML — Email and calendar

| ID | Persona | Story | BR (basis) | Pri | Rel | Depends | Verified by |
|---|---|---|---|---|---|---|---|
| US-EML-01 | SP | As a Salesperson, I want to connect (and disconnect) my company mailbox, so that my email is captured without manual entry. | BR-EML-001 (OD-06) | Must | R2 | US-PLT-04 | FAC-EML-01, FAC-EML-02 |
| US-EML-02 | SYS | As the System, I want to link synced emails to matching contacts, companies and deals, so that activity is captured automatically (target ≥ 80 %, §12). | BR-EML-002 (OD-28, OD-29) | Must | R2 | US-EML-01 | FAC-EML-03, FAC-EML-04, FAC-EML-05 |
| US-EML-03 | SP | As a Salesperson, I want to correct the records an email is linked to, so that timelines stay accurate. | BR-EML-002 (OD-28) | Must | R2 | US-EML-02 | FAC-EML-06 |
| US-EML-04 | SP | As a Salesperson, I want to exclude domains or contacts from syncing, so that personal or irrelevant correspondence never enters the CRM. | BR-EML-003, NFR-002 | Must | R2 | US-EML-01 | FAC-EML-07 |
| US-EML-05 | SP | As a Salesperson, I want to mark an email as private so that only I can see its subject and body, so that confidential exchanges stay confidential. | BR-EML-003 (OD-30) | Must | R2 | US-EML-02 | FAC-EML-08, FAC-EML-09 |
| US-EML-06 | SP | As a Salesperson, I want to send emails from the CRM through my own mailbox using templates with placeholders, so that sent mail is in my Sent folder and on the timeline. | BR-EML-004, NFR-013 | Must | R2 | US-EML-01 | FAC-EML-10, FAC-EML-11 |
| US-EML-07 | MGR | As a Sales Manager with template rights (or Admin), I want to maintain shared email templates, while any user keeps personal templates, so that good messages are reused. | BR-EML-004 (OD-31) | Must | R2 | US-EML-06 | FAC-EML-10 |
| US-EML-08 | SP | As a Salesperson, I want an inbox add-in that shows the CRM record for the open email, so that I have context without switching apps. | BR-EML-005 (OD-07) | Must | R3 | US-EML-02 | FAC-EML-12, FAC-EML-15 |
| US-EML-09 | SP | As a Salesperson, I want to create a contact, company or deal from the add-in, so that leads arriving by email are captured. | BR-EML-005 (OD-07, OD-38, OD-29) | Must | R3 | US-EML-08 | FAC-EML-13 |
| US-EML-10 | SP | As a Salesperson, I want to send a proposal link from the add-in, so that I can reply to a buyer with a tracked proposal from my inbox. | BR-EML-005, BR-SHR-002 (OD-07) | Must | R3 | US-EML-08, US-SHR-03 | FAC-EML-14 |
| US-EML-11 | SP | As a Salesperson, I want my calendar synced and meetings with known contacts logged to timelines, so that meetings are captured automatically. | BR-EML-006 | Must | R2 | US-EML-01 | FAC-EML-16 |
| US-EML-12 | SP | As a Salesperson, I want to opt in to open tracking on an email I send from the CRM, so that I know when it is read. | BR-EML-007 (OD-37) | Should | R2 | US-EML-06, US-EML-13 | FAC-EML-17 |
| US-EML-13 | ADM | As an Admin, I want open tracking off by default and enabled only org-wide by me, so that tracking follows our legal position. | BR-EML-007 (OD-37) | Should | R2 | — | FAC-EML-17 |

### 4.5 LED — Lead capture

| ID | Persona | Story | BR (basis) | Pri | Rel | Depends | Verified by |
|---|---|---|---|---|---|---|---|
| US-LED-01 | ADM | As an Admin, I want to build a web form, map its fields and embed it on our website, so that inbound leads enter the CRM directly. | BR-LED-001 | Must | R1 | US-CRM-08 | FAC-LED-01, FAC-LED-03 |
| US-LED-02 | SYS | As the System, I want each submission to create or update the contact and company (matched against existing records) and optionally create a deal, so that leads are captured without duplicates. | BR-LED-001, BR-LED-004 (OD-27, OD-33) | Must | R1 | US-LED-01 | FAC-LED-02, FAC-LED-07 |
| US-LED-03 | ADM | As an Admin, I want assignment rules (round-robin, or by field value such as region or product), so that leads reach the right salesperson. | BR-LED-002 (OD-32) | Must | R1 | US-LED-01 | FAC-LED-04, FAC-LED-05 |
| US-LED-04 | SP | As a Salesperson, I want to be notified immediately of a lead assigned to me, so that I respond fast. | BR-LED-003 (NFR-005) | Must | R1 | US-LED-03, US-NTF-01 | FAC-LED-06 |
| US-LED-05 | MGR | As a Sales Manager, I want campaign tags and source page recorded on the lead record, so that we know which channels produce leads. | BR-LED-005 | Should | R3 | US-LED-02 | FAC-LED-08 |
| US-LED-06 | ADM | As an Admin, I want forms protected against spam, so that bots do not create junk records or notifications. | BR-LED-006 (OD-46) | Should | R1 | US-LED-01 | FAC-LED-09 |
| US-LED-07 | ADM | As an Admin, I want to receive leads from our existing website forms through a webhook, so that we can keep current forms. | BR-LED-007 | Could | R3 (if capacity) | US-LED-02 | No FAC (Could); criteria to be added when scheduled |

### 4.6 TPL — Templates and content library

| ID | Persona | Story | BR (basis) | Pri | Rel | Depends | Verified by |
|---|---|---|---|---|---|---|---|
| US-TPL-01 | ADM | As an Admin, I want to create and edit proposal templates with sections, text, images and tables, so that proposals start consistent. | BR-TPL-001 | Must | R1 | — | FAC-TPL-01 |
| US-TPL-02 | MGR | As a Sales Manager granted template rights by an Admin, I want to manage templates, content blocks and the catalog, so that I can maintain my team's material. | BR-TPL-001, BR-TPL-005, BR-PRC-001 (§9.17 "Optional") | Must | R1 | US-TPL-01 | FAC-TPL-01, FAC-PRC-02 |
| US-TPL-03 | ADM | As an Admin, I want placeholders for standard and custom fields of company, contact, deal, owner and organization, so that proposals fill themselves from CRM data. | BR-TPL-002, BR-CRM-007 | Must | R1 | US-TPL-01, US-CRM-08 | FAC-TPL-02, FAC-TPL-03 |
| US-TPL-04 | ADM | As an Admin, I want to mark template sections locked or editable, so that legal and pricing terms cannot be changed by salespeople. | BR-TPL-003 | Must | R1 | US-TPL-01 | FAC-TPL-04 |
| US-TPL-05 | SYS | As the System, I want to version templates and record which version each proposal used, so that template changes never alter existing proposals. | BR-TPL-004 | Must | R1 | US-TPL-01 | FAC-TPL-05 |
| US-TPL-06 | ADM | As an Admin, I want a library of reusable content blocks (case studies, team bios, terms) that users insert into proposals, so that knowledge is shared. | BR-TPL-005 | Should | R3 | US-TPL-01 | FAC-TPL-06 |
| US-TPL-07 | ADM | As an Admin, I want organization branding (logo, colours, fonts) applied to templates, PDFs and the buyer view, so that every proposal is on-brand. | BR-TPL-006, BR-PLT-012 | Must | R1 | US-PLT-17 | FAC-TPL-07 |
| US-TPL-08 | ADM | As an Admin, I want company starter template(s) available at go-live, so that the team can send a first proposal on day one. | BR-TPL-007 (IDD-11) | Should | R1 | US-TPL-01 | FAC-TPL-08 |
| US-TPL-09 | SP | As a Salesperson, I want missing placeholder values flagged before a proposal is generated, so that no proposal goes out with blanks. | BR-TPL-008 | Must | R1 | US-TPL-03 | FAC-TPL-09 |

### 4.7 PRC — Product catalog and pricing tables

| ID | Persona | Story | BR (basis) | Pri | Rel | Depends | Verified by |
|---|---|---|---|---|---|---|---|
| US-PRC-01 | ADM | As an Admin, I want to maintain a product and service catalog (name, description, unit, unit price, tax category), so that prices are consistent. | BR-PRC-001 | Must | R1 | — | FAC-PRC-01, FAC-PRC-02 |
| US-PRC-02 | SP | As a Salesperson, I want pricing tables with line items, quantities, unit prices, line and overall discounts, taxes, subtotals and totals, so that the offer is precise. | BR-PRC-002 | Must | R1 | US-PRC-01 | FAC-PRC-03 |
| US-PRC-03 | SP | As a Salesperson, I want one-time and recurring items separated with separate totals, so that buyers see setup and ongoing costs clearly. | BR-PRC-003 (OD-44, OD-16) | Must | R1 | US-PRC-02 | FAC-PRC-04 |
| US-PRC-04 | SP | As a Salesperson, I want to be prompted to update the deal amount when the proposal total differs, so that the pipeline value is right. | BR-PRC-004 (OD-16) | Must | R1 | US-PRC-03 | FAC-PRC-05 |
| US-PRC-05 | ADM | As an Admin, I want a default organization currency, so that amounts are consistent. | BR-PRC-005 | Must | R1 | US-PLT-17 | FAC-PRC-06 |
| US-PRC-06 | SP | As a Salesperson, I want a deal (and therefore its proposals) to use a currency other than the default, so that I can quote foreign buyers. | BR-PRC-006 (OD-15) | Should | R3 | US-PRC-05 | FAC-PRC-07 |
| US-PRC-07 | ADM | As an Admin, I want to maintain exchange rates with effective dates, so that reports convert to the default currency. | BR-PRC-006 (OD-15) | Should | R3 | US-PRC-06 | FAC-PRC-07 |
| US-PRC-08 | ADM | As an Admin, I want maximum discount percentages per role, with a warning to users who exceed them, so that discounting is visible (approval is Phase 2). | BR-PRC-007 (OD-39) | Should | R3 | US-PRC-02 | FAC-PRC-08 |

### 4.8 PRP — Proposal generation

| ID | Persona | Story | BR (basis) | Pri | Rel | Depends | Verified by |
|---|---|---|---|---|---|---|---|
| US-PRP-01 | SP | As a Salesperson, I want to create a proposal from my deal by selecting a template, so that I start from CRM data, not a blank page. | BR-PRP-001 | Must | R1 | US-TPL-05, US-CRM-03 | FAC-PRP-01, FAC-PRP-02 |
| US-PRP-02 | SYS | As the System, I want the new proposal populated with CRM data and pricing, so that nothing is retyped. | BR-PRP-002 | Must | R1 | US-PRP-01, US-PRC-02 | FAC-PRP-03 |
| US-PRP-03 | SP | As a Salesperson, I want to edit only sections marked editable, so that I tailor the offer without touching locked terms. | BR-PRP-003, BR-TPL-003 | Must | R1 | US-TPL-04 | FAC-PRP-04 |
| US-PRP-04 | SP | As a Salesperson, I want a preview exactly as the buyer will see it, so that I send with confidence. | BR-PRP-004 | Must | R1 | US-PRP-02 | FAC-PRP-05 |
| US-PRP-05 | SP | As a Salesperson, I want PDF and DOCX files with the same content, so that buyers can file or edit as needed. | BR-PRP-005 (OD-43), NFR-012 | Must | R1 | US-PRP-02 | FAC-PRP-06 |
| US-PRP-06 | SP | As a Salesperson, I want editing a sent proposal to create a new draft version while the sent version stays frozen, so that every sent version is kept. | BR-PRP-006 (OD-20, OD-21) | Must | R1 | US-SHR-02 | FAC-PRP-07, FAC-PRP-09 |
| US-PRP-07 | SP | As a Salesperson, I want to compare any two versions, so that I can see what changed during negotiation. | BR-PRP-006 | Must | R1 | US-PRP-06 | FAC-PRP-08 |
| US-PRP-08 | MGR | As a Sales Manager, I want each proposal to show its status (Draft, Sent, Viewed, Accepted, Signed, Declined, Expired, Void) and a signing-progress badge, so that I know where every offer stands. | BR-PRP-007 (OD-17, OD-19, OD-20, OD-22) | Must | R1 | US-SHR-05 | FAC-PRP-10, FAC-PRP-11 |
| US-PRP-09 | SP | As a Salesperson, I want to void a proposal, so that a withdrawn offer can no longer be accepted or signed. | BR-PRP-007 (OD-18) | Must | R1 | US-PRP-08 | FAC-PRP-11, FAC-SIG-16 |
| US-PRP-10 | SYS | As the System, I want each proposal linked to its deal, company and contacts, so that it appears in their context and timelines. | BR-PRP-008 | Must | R1 | US-PRP-01 | FAC-PRP-12 |
| US-PRP-11 | SP | As a Salesperson, I want to set a validity date after which the proposal expires, so that old prices cannot be accepted. | BR-PRP-009 (OD-22, OD-40) | Should | R1 | US-PRP-08 | FAC-PRP-13 |
| US-PRP-12 | SP | As a Salesperson, I want to copy an existing proposal to another deal, so that similar offers are quick. | BR-PRP-010 | Should | R3 | US-PRP-01 | FAC-PRP-14 |
| US-PRP-13 | SP | As a Salesperson, I want several alternative proposals on one deal, so that I can offer options. | BR-PRP-001 (OD-23) | Must | R1 | US-PRP-01 | FAC-PRP-01, FAC-AUT-05 |

### 4.9 AIA — AI assistance

| ID | Persona | Story | BR (basis) | Pri | Rel | Depends | Verified by |
|---|---|---|---|---|---|---|---|
| US-AIA-01 | SP | As a Salesperson, I want AI to draft the introduction, needs summary and scope summary from the deal, notes, linked emails and template, so that I edit rather than write. | BR-AIA-001 (OD-05, OD-30, IDD-07) | Must | R2 | US-PRP-02, US-EML-02, US-AIA-09 | FAC-AIA-01, FAC-AIA-02, FAC-AIA-03 |
| US-AIA-02 | SP | As a Salesperson, I want an AI pre-send check for wrong names, inconsistent figures, empty placeholders, missing required sections and outdated dates, so that errors are caught before the buyer sees them. | BR-AIA-002 | Must | R2 | US-PRP-04 | FAC-AIA-04, FAC-AIA-05 |
| US-AIA-03 | MGR | As a Sales Manager (or the owner), I want an AI summary of a deal's email thread and history, so that I get up to speed in seconds. | BR-AIA-003 (OD-30) | Must | R2 | US-EML-02, US-TIM-01 | FAC-AIA-06 |
| US-AIA-04 | SP | As a Salesperson, I want to rewrite selected text with AI (shorten, change tone), so that copy fits the buyer. | BR-AIA-004 | Should | R3 | US-AIA-01 | FAC-AIA-07 |
| US-AIA-05 | SP | As a Salesperson, I want AI to draft a follow-up email after a proposal is sent, for me to review, so that follow-up is fast. | BR-AIA-005 | Should | R3 | US-EML-06, US-AUT-05 | FAC-AIA-08 |
| US-AIA-06 | SYS | As the System, I must never send anything AI-generated to an external party without an explicit user action, so that a human stays in control. | BR-AIA-006, NFR-003 | Must | R2 | — | FAC-AIA-09 |
| US-AIA-07 | SP | As a Salesperson, I want AI content labelled until I accept, edit or reject it, so that I always know what I have reviewed. | BR-AIA-007 | Must | R2 | US-AIA-01 | FAC-AIA-10 |
| US-AIA-08 | ADM | As an Admin, I want every AI call logged (feature, user, record, model, tokens) and usage visible against our budget limit, so that AI use is governed and cost-controlled. | BR-AIA-007 (IDD-10), NFR-003, NFR-009 | Must | R2 | — | FAC-AIA-11, FAC-AIA-15 |
| US-AIA-09 | ADM | As an Admin, I want one organization AI switch plus per-feature switches, so that we can disable AI quickly. | BR-AIA-008 (IDD-08) | Must | R2 | — | FAC-AIA-12 |
| US-AIA-10 | SYS | As the System, I want AI context limited to records the requesting user may see, private emails excluded, provider terms prohibiting training, and inbound content treated as untrusted, so that our data is protected. | BR-AIA-009 (IDD-07, OD-05, OD-30) | Must | R2 | — | FAC-AIA-02, FAC-AIA-13, FAC-AIA-14 |

### 4.10 SHR — Sharing and tracking

| ID | Persona | Story | BR (basis) | Pri | Rel | Depends | Verified by |
|---|---|---|---|---|---|---|---|
| US-SHR-01 | SYS | As the System, I want a unique, unguessable link per proposal version (one per intended recipient), so that access and tracking are per person. | BR-SHR-001 (ADR-013) | Must | R1 | US-PRP-02 | FAC-SHR-01, FAC-SHR-02 |
| US-SHR-02 | SP | As a Salesperson, I want to copy a recipient link and mark it "link shared manually", so that I can send proposals before mailbox integration exists and the deal still counts it as sent. | BR-SHR-002 (foundation §9 "sent" WA) | Must | R1 | US-SHR-01 | FAC-SHR-04 |
| US-SHR-03 | SP | As a Salesperson, I want to send the proposal link from the CRM through my own mailbox, so that the buyer receives it from me. | BR-SHR-002, BR-EML-004, NFR-013 | Must | R2 | US-EML-06, US-SHR-01 | FAC-SHR-03 |
| US-SHR-04 | SP | As a Salesperson, I want to specify the intended recipients from the deal's contacts, so that each gets their own tracked link. | BR-SHR-003 (OD-34) | Must | R1 | US-SHR-01 | FAC-SHR-05 |
| US-SHR-05 | SP | As a Salesperson, I want each view (who, when, how long) and each download recorded, so that I know how buyers engage. | BR-SHR-004 | Must | R1 | US-SHR-01 | FAC-SHR-06, FAC-SHR-07 |
| US-SHR-06 | EXT | As a Recipient, I want a branded proposal view that works on my phone, so that I can review it anywhere. | BR-SHR-009, BR-TPL-006, NFR-011, NFR-012 | Must | R1 | US-TPL-07 | FAC-SHR-15 |
| US-SHR-07 | EXT | As a forwarded viewer, I want to identify myself by name and email (with a privacy notice) before viewing, so that the seller knows who is evaluating the offer. | BR-SHR-005 (OD-26, OD-27, OD-34) | Must | R1 | US-SHR-05 | FAC-SHR-08, FAC-SHR-09 |
| US-SHR-08 | SP | As a Salesperson, I want to require email verification before a proposal can be viewed, so that sensitive pricing reaches only verified people. | BR-SHR-006 | Should | R3 | US-SHR-01 | FAC-SHR-10 |
| US-SHR-09 | SP | As a Salesperson (own deals; Manager team; Admin all), I want to revoke links and set link expiry, so that I control access. | BR-SHR-007 (OD-22) | Must | R1 | US-SHR-01 | FAC-SHR-11, FAC-SHR-12, FAC-SHR-13 |
| US-SHR-10 | MGR | As a Sales Manager, I want to see each proposal's access history, so that I can coach on buyer engagement. | BR-SHR-008 (OD-31) | Must | R1 | US-SHR-05 | FAC-SHR-14 |
| US-SHR-11 | EXT | As a Recipient, where signature is not required, I want to accept or decline (with a reason) the proposal, so that I can respond without signing. | BR-SHR-010 (OD-17, OD-40) | Should | R1 | US-SHR-06 | FAC-SHR-16, FAC-SHR-17, FAC-SHR-18 |
| US-SHR-12 | EXT | As a Recipient holding a link to an older version, I want a "newer version available" banner, so that I avoid version confusion. | BR-SHR-001, BR-PRP-006 (OD-21) | Must | R1 | US-PRP-06 | FAC-SHR-19 |

### 4.11 NTF — Notifications

| ID | Persona | Story | BR (basis) | Pri | Rel | Depends | Verified by |
|---|---|---|---|---|---|---|---|
| US-NTF-01 | SP | As a deal owner, I want real-time in-app and email notifications when a proposal is first opened, reopened, forwarded to a new viewer, downloaded, accepted, signed or declined, and when a link is about to expire, so that I follow up at the right moment. | BR-NTF-001 (OD-17, OD-14), NFR-005 | Must | R1 (signed/SIG-declined R2) | US-SHR-05 | FAC-NTF-01, FAC-NTF-02, FAC-NTF-04 |
| US-NTF-02 | SP | As a user, I want to choose which notifications I receive and by which channel, so that alerts stay useful. | BR-NTF-002 | Must | R1 | US-NTF-01 | FAC-NTF-03 |
| US-NTF-03 | SP | As a user, I want a daily summary of activity on my deals, so that I can review engagement once a day. | BR-NTF-003 | Should | R3 | US-NTF-01 | FAC-NTF-05 |

### 4.12 SIG — E-signature

| ID | Persona | Story | BR (basis) | Pri | Rel | Depends | Verified by |
|---|---|---|---|---|---|---|---|
| US-SIG-01 | SP | As a Salesperson, I want to request signatures on a specific sent proposal version, so that buyers sign exactly what was offered. | BR-SIG-001 (OD-20, OD-21, OD-23, OD-02) | Must | R2 | US-PRP-06 | FAC-SIG-01, FAC-SIG-02 |
| US-SIG-02 | SP | As a Salesperson, I want to add multiple signers (contacts on the deal) and choose sequential or parallel signing, so that the buyer's approval chain is followed. | BR-SIG-002 | Must | R2 | US-SIG-01 | FAC-SIG-03 |
| US-SIG-03 | EXT | As a Signer, I want my electronic signature to be legally valid (ESIGN/UETA, eIDAS SES), so that no paper signing is needed. | BR-SIG-003, NFR-004 (OD-01, OD-02, OD-03) | Must | R2 | US-SIG-01 | FAC-SIG-04 |
| US-SIG-04 | EXT | As a Signer, I want my identity verified by email at minimum, so that only I can sign for me. | BR-SIG-004 | Must | R2 | US-SIG-01 | FAC-SIG-05 |
| US-SIG-05 | EXT | As a Signer, I want to verify my identity with an SMS code when the sender requires it, so that higher-value contracts get stronger assurance. | BR-SIG-005 (OD-03) | Should | R3 | US-SIG-04 | FAC-SIG-06 |
| US-SIG-06 | EXT | As a Signer, I want to be asked for consent to sign electronically before signing, so that my consent is recorded. | BR-SIG-006 (OD-42) | Must | R2 | US-SIG-01 | FAC-SIG-07 |
| US-SIG-07 | SP | As a Salesperson, I want signature request status (Pending, Sent, Viewed, Signed, Declined, Expired, Voided) and per-signer status, so that I can chase the right person. | BR-SIG-007 (OD-19, OD-22) | Must | R2 | US-SIG-14 | FAC-SIG-08, FAC-SIG-20 |
| US-SIG-08 | SP | As a Salesperson, I want automatic reminders on a configurable schedule and a manual resend, so that signing is not delayed. | BR-SIG-008 | Must | R2 | US-SIG-01 | FAC-SIG-09, FAC-SIG-10 |
| US-SIG-09 | SP | As a Salesperson, I want a completion certificate with signer names, emails, timestamps, IP addresses, events and document fingerprint, so that we hold legal evidence. | BR-SIG-009 (OD-01) | Must | R2 | US-SIG-14 | FAC-SIG-11 |
| US-SIG-10 | EXT | As a Signer, I want the tamper-evident signed PDF sent to me and all parties, so that everyone has the executed copy. | BR-SIG-010, NFR-004 | Must | R2 | US-SIG-14 | FAC-SIG-12 |
| US-SIG-11 | SYS | As the System, I want a signed document locked to the exact version signed, so that any change requires a new version and new signatures. | BR-SIG-011 (OD-21) | Must | R2 | US-SIG-01 | FAC-SIG-13, FAC-SIG-14 |
| US-SIG-12 | EXT | As a Signer, I want to decline and give a reason, so that the seller knows why. | BR-SIG-012 (OD-25, OD-40) | Should | R2 | US-SIG-01 | FAC-SIG-15 |
| US-SIG-13 | SP | As a Salesperson (own deals; Manager team; Admin all), I want to void a pending signature request, so that a wrong or outdated request cannot be signed. | BR-SIG-013 (OD-18) | Must | R2 | US-SIG-01 | FAC-SIG-16, FAC-SIG-17 |
| US-SIG-14 | SYS | As the System, I want provider webhooks verified and processed exactly once, so that statuses are trustworthy and duplicate events cause no double effects. | BR-SIG-007, BR-AUT-002 (OD-24, ADR-012) | Must | R2 | — | FAC-SIG-18, FAC-SIG-19 |

### 4.13 AUT — Automation

| ID | Persona | Story | BR (basis) | Pri | Rel | Depends | Verified by |
|---|---|---|---|---|---|---|---|
| US-AUT-01 | SYS | As the System, I want a deal moved to the configured stage when a proposal is sent, if it is at an earlier stage, so that the pipeline updates itself. | BR-AUT-001 (foundation §9 "sent") | Must | R1 | US-SHR-02, US-AUT-02 | FAC-AUT-01, FAC-AUT-02 |
| US-AUT-02 | ADM | As an Admin, I want to configure the on-send target stage, the follow-up delay and per-stage stalled thresholds, so that automation fits our process. | BR-AUT-001, BR-AUT-004, BR-AUT-005 (ADR-024) | Must | R1 | US-CRM-06 | FAC-AUT-01, FAC-AUT-07, FAC-AUT-09 |
| US-AUT-03 | SYS | As the System, I want the deal marked Closed Won with amount from the proposal and close date = signing date when all signers have signed, so that won deals need no manual update. | BR-AUT-002 (OD-16, OD-23, OD-24) | Must | R1 (fires from R2 with SIG) | US-SIG-14 | FAC-AUT-03, FAC-AUT-04, FAC-AUT-05, FAC-AUT-14 |
| US-AUT-04 | SYS | As the System, I want a task created for the owner to record the outcome when a proposal is declined, without closing the deal, so that a human decides. | BR-AUT-003 (OD-25, OD-40) | Must | R1 | US-SHR-11 | FAC-AUT-06 |
| US-AUT-05 | SYS | As the System, I want a follow-up task created N days after sending if the proposal is not viewed or answered, so that no proposal goes quiet. | BR-AUT-004 | Must | R1 | US-AUT-02 | FAC-AUT-07, FAC-AUT-08 |
| US-AUT-06 | MGR | As a Sales Manager, I want deals with no activity for a per-stage number of days flagged, so that I can rescue stalled deals. | BR-AUT-005 (OD-35) | Must | R1 | US-AUT-02 | FAC-AUT-09 |
| US-AUT-07 | SP | As a Salesperson, I want deals past their expected close date flagged, so that I update or close them. | BR-AUT-006 (OD-40) | Should | R1 | US-CRM-03 | FAC-AUT-10 |
| US-AUT-08 | ADM | As an Admin, I want to configure simple trigger–condition–action rules from a predefined list, so that we can extend automation without code. | BR-AUT-007 (ADR-024) | Could | R3 (if capacity) | US-AUT-02 | No FAC (Could); criteria to be added when scheduled |
| US-AUT-09 | SP | As a deal owner, I want every automated change labelled "Automated" on the timeline and reversible, so that I trust and can correct automation. | BR-AUT-008 (OD-24) | Must | R1 | US-TIM-01 | FAC-AUT-11, FAC-AUT-12, FAC-AUT-13 |

### 4.14 RPT — Reporting and dashboards

| ID | Persona | Story | BR (basis) | Pri | Rel | Depends | Verified by |
|---|---|---|---|---|---|---|---|
| US-RPT-01 | MGR | As a Sales Manager, I want a pipeline dashboard of deal count and value by stage, owner and pipeline, so that I see the real pipeline. | BR-RPT-001 (OD-15) | Must | R1 | US-CRM-03 | FAC-RPT-01 |
| US-RPT-02 | MGR | As a Sales Manager, I want won/lost reporting with count, value, win rate and lost reasons, so that I understand outcomes. | BR-RPT-002 (OD-35) | Must | R1 | US-CRM-15 | FAC-RPT-02 |
| US-RPT-03 | MGR | As a Sales Manager, I want rep performance (deals owned, won revenue, win rate, average deal size, average cycle length), so that I can coach. | BR-RPT-003 (OD-35) | Must | R1 | US-RPT-02 | FAC-RPT-03 |
| US-RPT-04 | MGR | As a Sales Manager, I want proposal metrics (time to first proposal, proposals sent, view rate, time to first view, time to sign, proposal win rate), so that I see proposal effectiveness. | BR-RPT-004 (OD-35, OD-17) | Must | R1 (time to sign data from R2) | US-SHR-05 | FAC-RPT-04 |
| US-RPT-05 | MGR | As a Sales Manager, I want a "deals needing attention" list of stalled, overdue and unviewed-proposal deals, so that I act early. | BR-RPT-005 (OD-40) | Must | R1 | US-AUT-06, US-AUT-07 | FAC-RPT-05 |
| US-RPT-06 | MGR | As a Sales Manager, I want a weighted pipeline using stage probabilities, so that I can forecast. | BR-RPT-006 (OD-40) | Should | R1 | US-CRM-06 | FAC-RPT-06 |
| US-RPT-07 | MGR | As a Sales Manager, I want dashboards filterable by date range, team, owner and pipeline, so that I can slice results. | BR-RPT-007 (OD-35) | Must | R1 | US-RPT-01 | FAC-RPT-07 |
| US-RPT-08 | SP | As a Salesperson, I want dashboards limited to my own performance, so that permissions are respected. | BR-RPT-008 | Must | R1 | US-RPT-01 | FAC-RPT-08, FAC-RPT-09 |
| US-RPT-09 | ADM | As an Admin, I want organization-wide dashboards, so that leadership sees the whole business. | BR-RPT-008 | Must | R1 | US-RPT-01 | FAC-RPT-08 |
| US-RPT-10 | MGR | As a Sales Manager, I want to export report data to CSV, so that I can analyse further. | BR-RPT-009 | Should | R3 | US-RPT-01 | FAC-RPT-10 |
| US-RPT-11 | MGR | As a Sales Manager, I want emails, meetings and completed tasks per rep, so that I see activity levels. | BR-RPT-010 (OD-30) | Should | R3 | US-EML-02, US-EML-11 | FAC-RPT-11 |

### 4.15 TIM — Timelines

| ID | Persona | Story | BR (basis) | Pri | Rel | Depends | Verified by |
|---|---|---|---|---|---|---|---|
| US-TIM-01 | SP | As a Salesperson, I want one chronological deal timeline of emails, meetings, notes, tasks, stage changes, proposal events, signing events and automated actions, so that the full history is in one place. | BR-TIM-001 | Must | R1 (email/meeting/signing events populate from R2) | — | FAC-TIM-01 |
| US-TIM-02 | SP | As a Salesperson, I want to filter the timeline by event type, so that I find what matters. | BR-TIM-002 | Must | R1 | US-TIM-01 | FAC-TIM-02 |
| US-TIM-03 | SP | As a Salesperson, I want company and contact timelines combining their related events, so that I see account-wide history. | BR-TIM-003 | Must | R1 | US-TIM-01 | FAC-TIM-03 |
| US-TIM-04 | MGR | As a Sales Manager, I want each event to show who performed it (user, buyer, system or AI) and when, with private emails shown as metadata only, so that the history is trustworthy and private content stays private. | BR-TIM-004 (OD-30) | Must | R1 | US-TIM-01 | FAC-TIM-04, FAC-TIM-05 |

## 5. Not storied

| ID | Reason | Basis |
|---|---|---|
| BR-PLT-007 | Subscription billing, plans, payment, invoices, trial conversion are out of scope for an internal deployment; seat management is user management (BR-PLT-011). | IDD-03 |
| BR-MIG-007 | API import from HubSpot/Pipedrive deferred (Could). | OD-09 |
| BR-NTF-004 | Browser push notifications deferred (Could). | OD-47 |
| BR-PLT-002 (sign-up / trial part only) | Self sign-up and trial removed; invite part storied in US-PLT-02/03. | IDD-02 |

## 6. Story → BR coverage table

Every in-scope BR-* (100 Must after IDD-03, 25 Should, 2 Could storied) is covered by at least one story.

| BR ID | Pri | Stories | Rel |
|---|---|---|---|
| BR-PLT-001 | Must | US-PLT-01 | R1 |
| BR-PLT-002 | Must (modified IDD-02) | US-PLT-02, US-PLT-03 | R1 |
| BR-PLT-003 | Must | US-PLT-04, US-PLT-05 | R1 |
| BR-PLT-004 | Should | US-PLT-06, US-PLT-07 | R1 |
| BR-PLT-005 | Must | US-PLT-03, US-PLT-08, US-PLT-10, US-CRM-18 | R1 |
| BR-PLT-006 | Must | US-PLT-03, US-PLT-09, US-PLT-10 | R1 |
| BR-PLT-007 | Must | Not storied (IDD-03) | — |
| BR-PLT-008 | Must | US-PLT-11, US-PLT-12 | R1/R2 |
| BR-PLT-009 | Must | US-PLT-13, US-PLT-14 | R1 |
| BR-PLT-010 | Must | US-PLT-15 | R1 |
| BR-PLT-011 | Must | US-PLT-16 | R1 |
| BR-PLT-012 | Must | US-PLT-17, US-TPL-07 | R1 |
| BR-MIG-001 | Must | US-MIG-01 | R1 |
| BR-MIG-002 | Should | US-MIG-05 | R3 |
| BR-MIG-003 | Must | US-MIG-03 | R1 |
| BR-MIG-004 | Must | US-MIG-02 | R1 |
| BR-MIG-005 | Must | US-MIG-04 | R1 |
| BR-MIG-006 | Should | US-MIG-06 | R1 |
| BR-MIG-007 | Could | Not storied (OD-09) | — |
| BR-CRM-001 | Must | US-CRM-01, US-CRM-18 | R1 |
| BR-CRM-002 | Must | US-CRM-02 | R1 |
| BR-CRM-003 | Must | US-CRM-03, US-CRM-17 | R1 |
| BR-CRM-004 | Must | US-CRM-04, US-CRM-05 | R1 |
| BR-CRM-005 | Must | US-CRM-06 | R1 |
| BR-CRM-006 | Should | US-CRM-07 | R3 |
| BR-CRM-007 | Must | US-CRM-08, US-TPL-03 | R1 |
| BR-CRM-008 | Must | US-CRM-09 | R1 |
| BR-CRM-009 | Must | US-CRM-10 | R1 |
| BR-CRM-010 | Must | US-CRM-11 | R1 |
| BR-CRM-011 | Must | US-CRM-12 | R1 |
| BR-CRM-012 | Must | US-CRM-13 | R1 |
| BR-CRM-013 | Should | US-CRM-14 | R3 |
| BR-CRM-014 | Must | US-CRM-15, US-CRM-16, US-CRM-17 | R1 |
| BR-EML-001 | Must | US-EML-01 | R2 |
| BR-EML-002 | Must | US-EML-02, US-EML-03 | R2 |
| BR-EML-003 | Must | US-EML-04, US-EML-05 | R2 |
| BR-EML-004 | Must | US-EML-06, US-EML-07, US-SHR-03 | R2 |
| BR-EML-005 | Must | US-EML-08, US-EML-09, US-EML-10 | R3 |
| BR-EML-006 | Must | US-EML-11 | R2 |
| BR-EML-007 | Should | US-EML-12, US-EML-13 | R2 |
| BR-LED-001 | Must | US-LED-01, US-LED-02 | R1 |
| BR-LED-002 | Must | US-LED-03 | R1 |
| BR-LED-003 | Must | US-LED-04 | R1 |
| BR-LED-004 | Must | US-LED-02 | R1 |
| BR-LED-005 | Should | US-LED-05 | R3 |
| BR-LED-006 | Should | US-LED-06 | R1 |
| BR-LED-007 | Could | US-LED-07 | R3 (if capacity) |
| BR-TPL-001 | Must | US-TPL-01, US-TPL-02 | R1 |
| BR-TPL-002 | Must | US-TPL-03 | R1 |
| BR-TPL-003 | Must | US-TPL-04, US-PRP-03 | R1 |
| BR-TPL-004 | Must | US-TPL-05 | R1 |
| BR-TPL-005 | Should | US-TPL-06, US-TPL-02 | R3 |
| BR-TPL-006 | Must | US-TPL-07, US-SHR-06 | R1 |
| BR-TPL-007 | Should | US-TPL-08 | R1 (IDD-11) |
| BR-TPL-008 | Must | US-TPL-09 | R1 |
| BR-PRC-001 | Must | US-PRC-01, US-TPL-02 | R1 |
| BR-PRC-002 | Must | US-PRC-02 | R1 |
| BR-PRC-003 | Must | US-PRC-03 | R1 |
| BR-PRC-004 | Must | US-PRC-04 | R1 |
| BR-PRC-005 | Must | US-PRC-05, US-PLT-17 | R1 |
| BR-PRC-006 | Should | US-PRC-06, US-PRC-07 | R3 |
| BR-PRC-007 | Should | US-PRC-08 | R3 |
| BR-PRP-001 | Must | US-PRP-01, US-PRP-13 | R1 |
| BR-PRP-002 | Must | US-PRP-02 | R1 |
| BR-PRP-003 | Must | US-PRP-03 | R1 |
| BR-PRP-004 | Must | US-PRP-04 | R1 |
| BR-PRP-005 | Must | US-PRP-05 | R1 |
| BR-PRP-006 | Must | US-PRP-06, US-PRP-07, US-SHR-12 | R1 |
| BR-PRP-007 | Must | US-PRP-08, US-PRP-09 | R1 |
| BR-PRP-008 | Must | US-PRP-10 | R1 |
| BR-PRP-009 | Should | US-PRP-11 | R1 (OD-40) |
| BR-PRP-010 | Should | US-PRP-12 | R3 |
| BR-AIA-001 | Must | US-AIA-01 | R2 |
| BR-AIA-002 | Must | US-AIA-02 | R2 |
| BR-AIA-003 | Must | US-AIA-03 | R2 |
| BR-AIA-004 | Should | US-AIA-04 | R3 |
| BR-AIA-005 | Should | US-AIA-05 | R3 |
| BR-AIA-006 | Must | US-AIA-06 | R2 |
| BR-AIA-007 | Must | US-AIA-07, US-AIA-08 | R2 |
| BR-AIA-008 | Must | US-AIA-09 | R2 |
| BR-AIA-009 | Must | US-AIA-10 | R2 |
| BR-SHR-001 | Must | US-SHR-01, US-SHR-12 | R1 |
| BR-SHR-002 | Must | US-SHR-02 (R1), US-SHR-03 (R2), US-EML-10 (R3) | R1–R3 |
| BR-SHR-003 | Must | US-SHR-04 | R1 |
| BR-SHR-004 | Must | US-SHR-05 | R1 |
| BR-SHR-005 | Must | US-SHR-07 | R1 |
| BR-SHR-006 | Should | US-SHR-08 | R3 |
| BR-SHR-007 | Must | US-SHR-09 | R1 |
| BR-SHR-008 | Must | US-SHR-10 | R1 |
| BR-SHR-009 | Must | US-SHR-06 | R1 |
| BR-SHR-010 | Should | US-SHR-11 | R1 (OD-40) |
| BR-NTF-001 | Must | US-NTF-01 | R1/R2 |
| BR-NTF-002 | Must | US-NTF-02 | R1 |
| BR-NTF-003 | Should | US-NTF-03 | R3 |
| BR-NTF-004 | Could | Not storied (OD-47) | — |
| BR-SIG-001 | Must | US-SIG-01 | R2 |
| BR-SIG-002 | Must | US-SIG-02 | R2 |
| BR-SIG-003 | Must | US-SIG-03 | R2 |
| BR-SIG-004 | Must | US-SIG-04 | R2 |
| BR-SIG-005 | Should | US-SIG-05 | R3 |
| BR-SIG-006 | Must | US-SIG-06 | R2 |
| BR-SIG-007 | Must | US-SIG-07, US-SIG-14 | R2 |
| BR-SIG-008 | Must | US-SIG-08 | R2 |
| BR-SIG-009 | Must | US-SIG-09 | R2 |
| BR-SIG-010 | Must | US-SIG-10 | R2 |
| BR-SIG-011 | Must | US-SIG-11 | R2 |
| BR-SIG-012 | Should | US-SIG-12 | R2 (OD-40) |
| BR-SIG-013 | Must | US-SIG-13 | R2 |
| BR-AUT-001 | Must | US-AUT-01, US-AUT-02 | R1 |
| BR-AUT-002 | Must | US-AUT-03, US-SIG-14 | R1 build; live R2 |
| BR-AUT-003 | Must | US-AUT-04 | R1 |
| BR-AUT-004 | Must | US-AUT-05, US-AUT-02 | R1 |
| BR-AUT-005 | Must | US-AUT-06, US-AUT-02 | R1 |
| BR-AUT-006 | Should | US-AUT-07 | R1 (OD-40) |
| BR-AUT-007 | Could | US-AUT-08 | R3 (if capacity) |
| BR-AUT-008 | Must | US-AUT-09 | R1 |
| BR-RPT-001 | Must | US-RPT-01 | R1 |
| BR-RPT-002 | Must | US-RPT-02 | R1 |
| BR-RPT-003 | Must | US-RPT-03 | R1 |
| BR-RPT-004 | Must | US-RPT-04 | R1 |
| BR-RPT-005 | Must | US-RPT-05 | R1 |
| BR-RPT-006 | Should | US-RPT-06 | R1 (OD-40) |
| BR-RPT-007 | Must | US-RPT-07 | R1 |
| BR-RPT-008 | Must | US-RPT-08, US-RPT-09 | R1 |
| BR-RPT-009 | Should | US-RPT-10 | R3 |
| BR-RPT-010 | Should | US-RPT-11 | R3 |
| BR-TIM-001 | Must | US-TIM-01 | R1 |
| BR-TIM-002 | Must | US-TIM-02 | R1 |
| BR-TIM-003 | Must | US-TIM-03 | R1 |
| BR-TIM-004 | Must | US-TIM-04 | R1 |

### 6.1 Totals

| Item | Count |
|---|---|
| User stories | 154 (PLT 17, MIG 6, CRM 18, EML 13, LED 7, TPL 9, PRC 8, PRP 13, AIA 10, SHR 12, NTF 3, SIG 14, AUT 9, RPT 11, TIM 4) |
| BR covered | 127 (100 Must, 25 Should, 2 Could) |
| BR not storied | 3 (BR-PLT-007, BR-MIG-007, BR-NTF-004) |
| BRD total (corrected, foundation §2) | 130 = 101 Must / 25 Should / 4 Could |

### 6.2 Stories by release

| Release | Must stories | Should stories | Could stories |
|---|---|---|---|
| R1 | PLT-01..05, PLT-08..17 (PLT-12 mailbox item in R2), MIG-01..04, CRM (excl. CRM-07, CRM-14), LED-01..04, TPL (excl. TPL-06), PRC-01..05, PRP (excl. PRP-12), SHR (excl. SHR-03, SHR-08), NTF-01..02, AUT (excl. AUT-08; AUT-03 fires from R2), RPT-01..09, TIM | PLT-06/07, MIG-06, LED-06, TPL-08, PRP-11, SHR-11, AUT-07, RPT-06 | — |
| R2 | EML-01..07, EML-11, AIA-01..03, AIA-06..10, SHR-03, SIG (excl. SIG-05) | SIG-12, EML-12/13 | — |
| R3 | EML-08..10 | MIG-05, CRM-07, CRM-14, LED-05, TPL-06, PRC-06..08, PRP-12, AIA-04/05, SHR-08, NTF-03, SIG-05, RPT-10/11 | LED-07, AUT-08 |
