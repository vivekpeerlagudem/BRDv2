# Open Decisions: Internal Sales CRM, Phase 1

| Item | Detail |
|---|---|
| Document | OPEN-DECISIONS.md (register of OD-01..OD-47 + proposed OD-48..OD-104) |
| Status | Draft, v0.1, 17 Nov 2026 |
| Owner | Product Owner (register). Each decision has its own owner |
| Related | PRD.md · SCOPE-RECONCILIATION.md · FUNCTIONAL-REQUIREMENTS.md · BUSINESS-RULES.md · WORKFLOWS.md · ROLE-PERMISSION-MATRIX.md · ARCHITECTURE-DECISIONS.md · ACCEPTANCE-CRITERIA.md |

## 1. How to use this register

- Every OD has a **Working Assumption (WA)**. The design uses it until the owner decides. A WA is not a business answer. It is chosen to be reversible.
- Any document that depends on a WA must cite the OD ID.
- "Needed by" is the latest release (R1/R2/R3, PRD §7) whose design or build cannot be completed without the decision. Items with long lead times say so.
- All ODs are **Open** at v0.1. Record outcomes in §4 and update SCOPE-RECONCILIATION.md rows.
- "Impact if decided differently" lists modules (backend module map) and documents that must change if the decision differs from the WA.

## 2. Index

| OD | Title | Owner | Needed by | Status |
|---|---|---|---|---|
| OD-01 | Jurisdictions of entity and signers | Leadership + Legal | R2 | Open |
| OD-02 | E-signature build vs partner | Product + Tech Lead | R2 (lead time: decide during R1) | Open |
| OD-03 | E-signature provider selection | Tech Lead | R2 | Open |
| OD-04 | OpenCRM foundation suitability | Tech Lead | R1 | Open |
| OD-05 | AI model provider and data terms | Tech Lead | R2 | Open |
| OD-06 | Mail/calendar provider | Product | R2 (IT registration in R1) | Open |
| OD-07 | Inbox add-in stays Must | Product | R3 | Open |
| OD-08 | Launch date and team capacity | Leadership | R1 | Open |
| OD-09 | Import sources | Product with Sales | R1 | Open |
| OD-10 | Baselines and AC-15..18 sign-off owners | Product with Sales Leadership | R1 (start measuring) | Open |
| OD-11 | Hosting target | IT / Tech Lead | R1 | Open |
| OD-12 | Login methods | IT | R1 | Open |
| OD-13 | MFA enforcement | IT / Security | R1 | Open |
| OD-14 | Transactional email service | Tech Lead | R1 | Open |
| OD-15 | Multi-currency and FX | Finance / Sales Ops | R1 | Open |
| OD-16 | Which total sets the deal amount | Sales Leadership / Finance | R1 | Open |
| OD-17 | Buyer accept without signature | Sales Leadership | R1 | Open |
| OD-18 | Void / Voided | Product | R1 | Open |
| OD-19 | Partially signed state | Product | R2 | Open |
| OD-20 | Status level (proposal vs version) | Product | R1 | Open |
| OD-21 | Sending a new version | Product | R1 | Open |
| OD-22 | Three expiry clocks | Product | R1 | Open |
| OD-23 | Multiple proposals per deal | Sales Leadership | R1 | Open |
| OD-24 | Reversing automated Closed Won | Product | R2 | Open |
| OD-25 | Signer decline | Product | R2 | Open |
| OD-26 | Forwarded viewers | Product + Legal | R1 | Open |
| OD-27 | Duplicate matching keys | Sales Ops | R1 | Open |
| OD-28 | Email linking with several open deals | Product | R2 | Open |
| OD-29 | Unknown senders | Product + Legal | R2 | Open |
| OD-30 | Private emails | Product + Legal | R2 | Open |
| OD-31 | Permission gaps in §9.17 | Sales Leadership | R1 | Open |
| OD-32 | Teams | Sales Ops | R1 | Open |
| OD-33 | Contact↔company and deal↔company | Sales Ops | R1 | Open |
| OD-34 | Deal contact roles | Sales Ops | R1 | Open |
| OD-35 | Metric definitions | Sales Leadership | R1 | Open |
| OD-36 | Retention schedule and deletion exemptions | Legal / DPO | R1 | Open |
| OD-37 | Email open-tracking consent | Legal | R2 | Open |
| OD-38 | Lead from inbound email | Product | R2 | Open |
| OD-39 | Discount limits | Sales Leadership | R3 | Open |
| OD-40 | Priority inversions | Product | R1 | Open |
| OD-41 | Phases 2–3 still intended | Product | R1 | Open |
| OD-42 | E-signature consent wording, withdrawal, paper copy | Legal | R2 | Open |
| OD-43 | PDF/DOCX parity | Product | R1 | Open |
| OD-44 | Recurring items | Product | R1 | Open |
| OD-45 | Internal sizing and NFR targets | Tech Lead / IT | R1 | Open |
| OD-46 | Lead form spam protection | Product | R1 | Open |
| OD-47 | Task reminders and notification channels | Product | R1 | Open |
| OD-48 | *Proposed:* internal go-live release and cutover | Leadership + Product + Sales Leadership | R1 | Proposed |
| OD-49 | *Proposed:* tax model | Finance | R1 | Proposed |
| OD-50 | *Proposed:* historical data from retired tools | Sales Ops + Legal | R2 | Proposed |
| OD-51 | *Proposed:* email/calendar backfill window | Product + Legal | R2 | Proposed |
| OD-52 | *Proposed:* mailbox connection obligation and employee privacy | Sales Leadership + Legal/HR | R2 | Proposed |
| OD-53 | *Proposed:* AI budget and usage limits | Leadership/Finance + Tech Lead | R2 | Proposed |
| OD-54 | *Proposed:* confirmation of unnumbered analysis WAs | Product + Sales Leadership | R1 (item n: R2) | Proposed |
| OD-55 | *Proposed:* Deterministic pre-send checks when AI is disabled | Product | R1 | Proposed |
| OD-56 | *Proposed:* Which pre-send findings block sending | Product + Sales Leadership | R1 | Proposed |
| OD-57 | *Proposed:* Catalog prices in a non-default currency and missing exchange rates | Finance / Sales Ops | R1 | Proposed |
| OD-58 | *Proposed:* Record update and ownership policy for imports and lead forms | Sales Ops | R1 | Proposed |
| OD-59 | *Proposed:* Import limits, undo window and undo after later changes | Sales Ops + Tech Lead | R1 | Proposed |
| OD-60 | *Proposed:* Are companies and contacts unique? | Sales Ops | R1 | Proposed |
| OD-61 | *Proposed:* Duplicate-deal suppression window for repeat form submissions | Sales Ops | R1 | Proposed |
| OD-62 | *Proposed:* CAPTCHA failure mode | Product + Security | R1 | Proposed |
| OD-63 | *Proposed:* Calendar meetings with unknown attendees | Product + Legal | R2 | Proposed |
| OD-64 | *Proposed:* Internal email domain(s) | IT + Product | R1 | Proposed |
| OD-65 | *Proposed:* Source of contact placeholders | Product | R1 | Proposed |
| OD-66 | *Proposed:* Discount model | Sales Leadership + Finance | R1 | Proposed |
| OD-67 | *Proposed:* Contract term and billing periods | Finance | R1 | Proposed |
| OD-68 | *Proposed:* How "signature not required" is set | Product + Sales Leadership | R1 | Proposed |
| OD-69 | *Proposed:* Identity gate for original recipients | Product + Legal | R1 | Proposed |
| OD-70 | *Proposed:* Buyer DOCX download | Product | R1 | Proposed |
| OD-71 | *Proposed:* Internal countersigner | Sales Leadership + Legal | R2 | Proposed |
| OD-72 | *Proposed:* Notification and signing defaults | Product + Sales Leadership | R1 (signing items R2) | Proposed |
| OD-73 | *Proposed:* Proposal "reopen" definition and notification throttling | Product with Sales | R1 | Proposed |
| OD-74 | *Proposed:* Automation and attention thresholds | Sales Leadership | R1 | Proposed |
| OD-75 | *Proposed:* Invitation validity | IT | R1 | Proposed |
| OD-76 | *Proposed:* Session and lockout parameters | IT / Security | R1 | Proposed |
| OD-77 | *Proposed:* TOTP with Google/Microsoft sign-in | IT / Security | R1 | Proposed |
| OD-78 | *Proposed:* Changing the default currency | Finance | R1 | Proposed |
| OD-79 | *Proposed:* NFR percentile and measurement window | Tech Lead | R1 | Proposed |
| OD-80 | *Proposed:* Definition of an "active weekly" user | Product + Sales Leadership | R1 | Proposed |
| OD-81 | *Proposed:* Confirmation of BUSINESS-RULES and WORKFLOWS working assumptions | Product + Sales Leadership | R1 | Proposed |
| OD-82 | *Proposed:* Break-glass Admin account | Security / IT | R1 | Proposed |
| OD-83 | *Proposed:* Admin session lifetime and step-up authentication | Security / IT | R1 | Proposed |
| OD-84 | *Proposed:* Retention periods for IP addresses, monitoring logs and AI generations | Legal / DPO + Security | R1 | Proposed |
| OD-85 | *Proposed:* Malware scanning of uploads | Security | R1 | Proposed |
| OD-86 | *Proposed:* Penetration test before go-live | Security + Leadership | R2 | Proposed |
| OD-87 | *Proposed:* Default buyer email verification (OTP) | Product + Legal | R1 | Proposed |
| OD-88 | *Proposed:* Legal hold | Legal | R2 | Proposed |
| OD-89 | *Proposed:* Hosting region and data residency | IT + Legal | R1 | Proposed |
| OD-90 | *Proposed:* AI features eligible for zero data retention | Tech Lead + Legal | R2 | Proposed |
| OD-91 | *Proposed:* AI inference region | Tech Lead + Legal | R2 | Proposed |
| OD-92 | *Proposed:* Custom fields excluded from AI context | Product + Legal | R2 | Proposed |
| OD-93 | *Proposed:* When AUT-004 follow-up drafts are generated | Product | R3 | Proposed |
| OD-94 | *Proposed:* AI output language | Product | R2 | Proposed |
| OD-95 | *Proposed:* AI evaluation data source | Tech Lead + Legal | R2 | Proposed |
| OD-96 | *Proposed:* Database high availability tier | IT / Tech Lead | R1 | Proposed |
| OD-97 | *Proposed:* Egress firewall | IT / Security | R1 | Proposed |
| OD-98 | *Proposed:* Error-tracking vendor | Tech Lead | R1 | Proposed |
| OD-99 | *Proposed:* On-call and support model | Leadership + IT | R1 | Proposed |
| OD-100 | *Proposed:* CI/CD platform | Tech Lead | R1 | Proposed |
| OD-101 | *Proposed:* Maintenance window | IT + Sales Leadership | R1 | Proposed |
| OD-102 | *Proposed:* Object Lock mode for signed artifacts | Legal + IT | R2 | Proposed |
| OD-103 | *Proposed:* Long-term backups and erasure | Legal / DPO | R1 | Proposed |
| OD-104 | *Proposed:* Staging and test data policy | Security + Legal | R1 | Proposed |

Count by owner group (§3): Leadership 2 · Legal/DPO 3 · Product 23 · Sales Leadership 6 · Sales Ops/Finance 5 · Tech Lead/IT 8 = 47. Proposed: OD-48..OD-54 (§5) OD-55..OD-81 (§5.1) and OD-82..OD-104 (§5.2) = 57; register total 104.

## 3. Decisions by owner

Joint decisions are listed under the first-named owner.

### 3.1 Leadership

#### OD-01 — Jurisdictions of our entity and our signers

| Field | Content |
|---|---|
| Question | In which jurisdictions are our contracting entity and our signers located, and is a simple electronic signature (SES) sufficient for our contracts? |
| Why it matters | BR-SIG-003 requires signatures "legally valid in the target markets". The jurisdiction sets the signature level, the evidence needed, data protection rules and currencies (OQ-1) |
| Options | 1. US ESIGN/UETA + EU eIDAS SES only, B2B signers. 2. Some contracts need advanced (AES) or qualified (QES) signatures, so the provider must support them. 3. Other jurisdictions (e.g. UK, APAC) need local legal review |
| Working assumption | Design evidence to meet US ESIGN/UETA and EU eIDAS SES. The e-sign provider supplies the legal evidence. Legal confirms. No consumer signers (B2B) |
| Impact if decided differently | esign module and `ESignatureProvider` adapter (AES/QES flows); provider shortlist (OD-03); consent (OD-42); retention (OD-36); currencies (OD-15). Docs: FUNCTIONAL-REQUIREMENTS (SIG), BUSINESS-RULES (SIG), ARCHITECTURE-DECISIONS (ADR-012), ACCEPTANCE-CRITERIA (AC-10) |
| Owner | Leadership + Legal |
| BRD refs | OQ-1, BR-SIG-003, NFR-002, NFR-004, AC-10, §13.1, §5.3 |
| Needed by | R2 (before provider contract) |
| Status | Open |

#### OD-08 — Launch date and team capacity

| Field | Content |
|---|---|
| Question | What is the target go-live date, and what delivery capacity is available? |
| Why it matters | Decides whether ~100 Musts are realistic and how releases are cut (BRD §17.2: settle OQ-3 and OQ-7 first) |
| Options | 1. Phased releases R1/R2/R3. 2. One release containing all Musts. 3. Reduced scope: more Shoulds deferred, BR-EML-005 deferred through OD-07 |
| Working assumption | Date and capacity unknown. Delivery planned as R1 (core CRM + proposals + sharing), R2 (email/calendar + AI + e-sign), R3 (add-in, HubSpot/Pipedrive import, remaining Shoulds). The plan is a recommendation |
| Impact if decided differently | PRD §7; release tags in SCOPE-RECONCILIATION.md; delivery plan; OD-48 |
| Owner | Leadership |
| BRD refs | OQ-7, §13.4 risk 1, §9.16, §17.2 |
| Needed by | R1 (now) |
| Status | Open |

### 3.2 Legal / DPO

#### OD-36 — Retention schedule and deletion exemptions

| Field | Content |
|---|---|
| Question | What retention periods apply per data category, what are the platform limits, and what is exempt from erasure? |
| Why it matters | NFR-015 says limits are "to be defined". NFR-002 requires deletion requests to be honoured. The audit log and signed documents hold personal data |
| Options | 1. Configurable per category within platform limits; legal-obligation exemptions; erasure = anonymisation. 2. Fixed system-wide periods, not configurable. 3. Keep indefinitely until an erasure request |
| Working assumption | Configurable per category with platform limits. Signed documents, completion certificates and audit log are exempt from erasure (legal obligation). Erasure of a contact = anonymise personal fields, keep financial records |
| Impact if decided differently | platform module (retention jobs, `audit_log`), crm (anonymisation), esign (`signed_document`), comms (email bodies), export. Docs: BUSINESS-RULES (PLT), FUNCTIONAL-REQUIREMENTS (DR on erasure), data model |
| Owner | Legal / DPO |
| BRD refs | NFR-015, NFR-002, NFR-009, BR-PLT-009, BR-PLT-010, BR-CRM-001 |
| Needed by | R1 (real data from R1) |
| Status | Open |

#### OD-37 — Email open-tracking consent

| Field | Content |
|---|---|
| Question | On what consent basis may emails sent from the CRM carry open tracking? |
| Why it matters | Tracking pixels touch ePrivacy/GDPR rules (BR-EML-007) |
| Options | 1. Off by default; Admin enables org-wide; user opts in per email. 2. On by default with a disclosure in the footer. 3. Not offered |
| Working assumption | Option 1 |
| Impact if decided differently | comms module (`email_tracking`), settings UI, email composer. Docs: FUNCTIONAL-REQUIREMENTS (EML), BUSINESS-RULES (EML) |
| Owner | Legal |
| BRD refs | BR-EML-007, NFR-002 |
| Needed by | R2 (BR-EML-007 is R2 per §12 R1) |
| Status | Open |

#### OD-42 — E-signature consent wording, withdrawal and paper-copy process

| Field | Content |
|---|---|
| Question | What consent and intent wording is shown to signers, how can they withdraw consent, and how can they request a paper copy? |
| Why it matters | BR-SIG-006 requires consent to be captured. ESIGN consumer-disclosure practice and intent-to-sign UX support evidence quality |
| Options | 1. Provider's standard ERSD/consent with our wording. 2. Our own consent screen before handing off to the provider. 3. Provider default text unchanged |
| Working assumption | Option 1. Legal approves the wording |
| Impact if decided differently | esign module configuration; buyer app (if option 2); evidence stored. Docs: FUNCTIONAL-REQUIREMENTS (SIG), WORKFLOWS (signing) |
| Owner | Legal |
| BRD refs | BR-SIG-006, NFR-004 |
| Needed by | R2 |
| Status | Open |

### 3.3 Product

#### OD-02 — E-signature: build or partner

| Field | Content |
|---|---|
| Question | Do we build legally valid e-signature in-house or integrate a partner? |
| Why it matters | Effort, compliance risk and cost (OQ-2). BR-SIG has 11 Musts |
| Options | 1. Integrate a partner behind an `ESignatureProvider` adapter. 2. Build SES in-house (evidence capture, PDF sealing with our certificate, audit trail, reminders). 3. Hybrid: in-house accept (BR-SHR-010) + partner for signatures |
| Working assumption | Option 1. No signing cryptography built in-house |
| Impact if decided differently | Option 2 rewrites the esign module (PKI/certificate management, sealing, certificate generation, reminders scheduler), adds legal review effort and puts R2 at risk. Docs: ARCHITECTURE-DECISIONS (ADR-012), FUNCTIONAL-REQUIREMENTS (SIG), data model `signature_*`, PRD §8.4 RK3 |
| Owner | Product + Tech Lead |
| BRD refs | OQ-2, BR-SIG-001..013, §13.3, §13.4 risk 3 |
| Needed by | R2 (decide during R1 because of contract lead time) |
| Status | Open |

#### OD-06 — Mail and calendar provider

| Field | Content |
|---|---|
| Question | Gmail first, Outlook first, or both? |
| Why it matters | Scope, API access and AC-04/AC-05 (OQ-5, INC-05) |
| Options | 1. Adapter supports both; build the company's provider first; the second follows. 2. Both at R2. 3. Company's provider only, second never built |
| Working assumption | Option 1. Google "Internal" OAuth app / single-tenant Entra app (verify with IT) avoids public app verification |
| Impact if decided differently | comms module (second `MailProvider`/`CalendarProvider` driver), addin app, R2 effort, AC-04 acceptance scope. Docs: PRD §7, ACCEPTANCE-CRITERIA (AC-04/05), ARCHITECTURE-DECISIONS (ADR-012) |
| Owner | Product |
| BRD refs | OQ-5, BR-EML-001, BR-EML-005, BR-EML-006, AC-04, AC-05, §13.1, §13.3, §13.4 risk 2 |
| Needed by | R2 (start IT app registration during R1) |
| Status | Open |

#### OD-07 — Does the inbox add-in stay Must?

| Field | Content |
|---|---|
| Question | Is BR-EML-005 required at launch, and in what form? |
| Why it matters | "Largest integration effort in Phase 1" (OQ-10). Affects go-live (OD-48) |
| Options | 1. Stays Must, company's provider only, delivered after core email sync (R3). 2. Downgraded to Should (BRD change). 3. Must at go-live (moved into R2). 4. Reduced add-in: record view + create only, sending proposals later |
| Working assumption | Option 1. Outlook add-in = Office.js task pane web app. Gmail = Google Workspace add-on (HTTP runtime, card JSON from our server) |
| Impact if decided differently | addin app, release plan, BR-SHR-002 staging, AC-05. Docs: PRD §7.6, SCOPE-RECONCILIATION.md (BR-EML-005, INC-16), OD-48 |
| Owner | Product |
| BRD refs | OQ-10, BR-EML-005, BR-SHR-002, AC-05, §11 step 8 |
| Needed by | R3 (confirm before R2 exit for planning) |
| Status | Open |

#### OD-09 — Import sources

| Field | Content |
|---|---|
| Question | Which of our current tools must we import from or replace? |
| Why it matters | Import priorities and switching plan (OQ-8). AC-02 requires HubSpot/Pipedrive import although BR-MIG-002 is Should (INC-15) |
| Options | 1. CSV/Excel always; HubSpot/Pipedrive export import only if used; API import deferred. 2. Build both export importers regardless. 3. API import from the current tool (BR-MIG-007) |
| Working assumption | Option 1 |
| Impact if decided differently | import module (source-specific mappers), release plan (BR-MIG-002 before go-live), AC-02 scope. Docs: SCOPE-RECONCILIATION.md (MIG rows), PRD §7.4 |
| Owner | Product with Sales |
| BRD refs | OQ-8, BR-MIG-001, BR-MIG-002, BR-MIG-007, AC-02 |
| Needed by | R1 |
| Status | Open |

#### OD-10 — Baselines and sign-off owners for AC-15..AC-18

| Field | Content |
|---|---|
| Question | What are our current-process baselines for §12 metrics, how are they measured, and who signs off AC-15..AC-18? |
| Why it matters | Targets are relative ("50% reduction"). Without a baseline, AC-17 cannot be assessed (OQ-9) |
| Options | 1. Retrospective sample from current tools + time study for production effort. 2. Prospective measurement for 4–6 weeks before go-live. 3. No baseline; set absolute targets instead |
| Working assumption | Baselines TBD; measurement methods as proposed in PRD §2.2. Sign-off by the internal sales leadership sponsor (IDD-14) |
| Impact if decided differently | PRD §2; ACCEPTANCE-CRITERIA (AC-15..18); reporting instrumentation if extra events are needed |
| Owner | Product with Sales Leadership |
| BRD refs | OQ-9, §12, AC-15..AC-18 |
| Needed by | R1 (measurement must start before go-live) |
| Status | Open |

#### OD-18 — Void / Voided

| Field | Content |
|---|---|
| Question | How do the proposal status "Void" and the signature request status "Voided" relate? |
| Why it matters | Vocabulary inconsistency (INC-02) and cascade behaviour |
| Options | 1. Keep both BRD labels; voiding a proposal voids its open request; voiding a request does not void the proposal. 2. Unify both as "Void" (wording change). 3. Bidirectional cascade |
| Working assumption | Option 1 |
| Impact if decided differently | enums in shared package; proposal and signature state machines. Docs: BUSINESS-RULES (PRP, SIG), WORKFLOWS, UI labels |
| Owner | Product |
| BRD refs | BR-PRP-007, BR-SIG-007, BR-SIG-013 |
| Needed by | R1 |
| Status | Open |

#### OD-19 — Partially signed state

| Field | Content |
|---|---|
| Question | How is a proposal shown when some but not all signers have signed? |
| Why it matters | BR-PRP-007 has no such status. Users need progress visibility |
| Options | 1. No new status; proposal stays Sent/Viewed; derived badge "Signing in progress (x of n)". 2. New proposal status "Partially signed" (extension). 3. Progress shown only on the signature request |
| Working assumption | Option 1 |
| Impact if decided differently | proposals state machine, reporting filters, notifications. Docs: BUSINESS-RULES (PRP), FUNCTIONAL-REQUIREMENTS (PRP/SIG) |
| Owner | Product |
| BRD refs | BR-PRP-007, BR-SIG-002, BR-SIG-007 |
| Needed by | R2 |
| Status | Open |

#### OD-20 — Status level: proposal vs version

| Field | Content |
|---|---|
| Question | Is the BRD status carried by the proposal, by each version, or both? |
| Why it matters | Links and signatures attach to versions (BR-SHR-001, BR-SIG-001). Reports count proposals |
| Options | 1. Proposal carries the BRD status for its current version; each version has its own state draft/sent/superseded/signed. 2. Status per version only. 3. Proposal status only, no version state |
| Working assumption | Option 1. Share links and signature requests attach to a specific version |
| Impact if decided differently | proposals data model, sharing and esign foreign keys, RPT-004 metric definitions. Docs: data model, BUSINESS-RULES (PRP) |
| Owner | Product |
| BRD refs | BR-PRP-006, BR-PRP-007, BR-SHR-001, BR-SIG-001, BR-SIG-011 |
| Needed by | R1 |
| Status | Open |

#### OD-21 — Sending a new version

| Field | Content |
|---|---|
| Question | What happens to the previous version's links and signature request when a new version is sent? |
| Why it matters | Avoids version confusion (P3) and signing the wrong version |
| Options | 1. Previous version → superseded; its links stay read-only with a "newer version available" banner unless revoked; any open signature request is voided after user confirmation; superseded versions cannot be signed. 2. Old links revoked automatically. 3. Old version stays fully active |
| Working assumption | Option 1 |
| Impact if decided differently | sharing, esign, buyer app, notifications. Docs: WORKFLOWS (versioning), BUSINESS-RULES (SHR, SIG) |
| Owner | Product |
| BRD refs | BR-PRP-006, BR-SHR-001, BR-SHR-007, BR-SIG-011 |
| Needed by | R1 |
| Status | Open |

#### OD-22 — Three expiry clocks

| Field | Content |
|---|---|
| Question | How do proposal validity, link expiry and signature request expiry interact? |
| Why it matters | Three BRD sources of "expiry" (BR-PRP-009, BR-SHR-007, BR-SIG-007) can conflict |
| Options | 1. (a) Validity date reached → proposal Expired, open request expires, links show "expired"; (b) link expiry blocks only that link; (c) provider request expiry → request Expired, proposal returns to Sent/Viewed, owner notified; earliest clock wins; revive only by new version. 2. Single clock = proposal validity; links inherit. 3. As 1, but an Expired proposal can be extended by editing the date without a new version |
| Working assumption | Option 1 |
| Impact if decided differently | proposals, sharing, esign, scheduled jobs, `link_expiring` notification. Docs: BUSINESS-RULES, WORKFLOWS |
| Owner | Product |
| BRD refs | BR-PRP-007, BR-PRP-009, BR-SHR-007, BR-SIG-007, BR-NTF-001 |
| Needed by | R1 |
| Status | Open |

#### OD-24 — Reversing an automated Closed Won

| Field | Content |
|---|---|
| Question | What does reversing the automated Closed Won (BR-AUT-008) restore? |
| Why it matters | Reversal must be safe and must not re-trigger |
| Options | 1. Restore previous stage, amount and close date from the execution record; proposal stays Signed; the same signature request never re-triggers (idempotency key = signatureRequestId). 2. Reversal also voids the proposal. 3. Signature-driven closes cannot be reversed |
| Working assumption | Option 1 |
| Impact if decided differently | automation (`automation_execution`), crm deals, timeline. Docs: BUSINESS-RULES (AUT), WORKFLOWS |
| Owner | Product |
| BRD refs | BR-AUT-002, BR-AUT-008 |
| Needed by | R2 |
| Status | Open |

#### OD-25 — Signer decline

| Field | Content |
|---|---|
| Question | What happens when one of several signers declines? |
| Why it matters | Drives the Declined status and the AUT-003 task |
| Options | 1. Any decline → request Declined; remaining signers cancelled and notified by the provider; proposal Declined; AUT-003 task. 2. Sender may replace the declining signer and continue. 3. Only the request is Declined; proposal stays Sent/Viewed |
| Working assumption | Option 1 |
| Impact if decided differently | esign webhook handling, proposal state machine, automation, notifications |
| Owner | Product |
| BRD refs | BR-SIG-012, BR-PRP-007, BR-AUT-003, BR-NTF-001 |
| Needed by | R2 |
| Status | Open |

#### OD-26 — Forwarded viewers

| Field | Content |
|---|---|
| Question | How are forwarded viewers identified, recorded and limited? |
| Why it matters | BR-SHR-005 creates CRM records about third parties who never interacted with us. This has privacy and accuracy implications |
| Options | 1. Identity gate (name + email) with privacy notice; match by normalised email, else create contact (company = deal company if domain matches); add as stakeholder "Forwarded viewer"; view and download only. 2. As 1 plus email verification code. 3. Record viewer only on the proposal access history; no CRM contact created |
| Working assumption | Option 1. Cannot accept, decline or sign unless the salesperson adds them as recipient/signer |
| Impact if decided differently | sharing (`viewer_identity`), crm contact creation, buyer app gate, privacy notice. Docs: FUNCTIONAL-REQUIREMENTS (SHR), BUSINESS-RULES (SHR) |
| Owner | Product + Legal |
| BRD refs | BR-SHR-005, BR-SHR-006, NFR-002 |
| Needed by | R1 |
| Status | Open |

#### OD-28 — Email linking with several open deals

| Field | Content |
|---|---|
| Question | When an email's contact is on several open deals, which deal(s) get the link? |
| Why it matters | Timeline accuracy, AI context, M6 |
| Options | 1. Always link to contacts and company; to the single open deal if exactly one; if several, to the deal with the most recent activity, marked "auto — review suggested". 2. Link to all open deals. 3. Link only to contact/company; the user picks the deal |
| Working assumption | Option 1. The user can correct |
| Impact if decided differently | comms linking service (`email_link`), timelines, AI context builder |
| Owner | Product |
| BRD refs | BR-EML-002, BR-TIM-001, BR-TIM-003 |
| Needed by | R2 |
| Status | Open |

#### OD-29 — Unknown senders

| Field | Content |
|---|---|
| Question | Are emails with no known contact stored? |
| Why it matters | Data minimisation vs completeness |
| Options | 1. Not stored, unless part of an already-linked thread; the user can "add to CRM" from the add-in. 2. Held in a triage area for N days. 3. Store everything and auto-create contacts |
| Working assumption | Option 1 |
| Impact if decided differently | comms storage, sizing (OD-45), privacy notice, add-in |
| Owner | Product + Legal |
| BRD refs | BR-EML-002, BR-EML-003, NFR-002, §13.4 risk 9 |
| Needed by | R2 |
| Status | Open |

#### OD-30 — Private emails

| Field | Content |
|---|---|
| Question | What does "mark emails as private" hide, and from whom? |
| Why it matters | BR-EML-003 does not define it. Affects timelines, AI, reports, export |
| Options | 1. Metadata (date, direction, participants) visible as "Private email"; subject/body only to the mailbox owner; excluded from AI context, report content and export bodies; metadata counted in activity reports. 2. Fully hidden, including metadata. 3. Content also visible to the user's manager |
| Working assumption | Option 1 |
| Impact if decided differently | comms, timeline, ai (context builder), reporting, platform export. Docs: ROLE-PERMISSION-MATRIX, BUSINESS-RULES (EML) |
| Owner | Product + Legal |
| BRD refs | BR-EML-003, BR-AIA-001, BR-AIA-003, BR-RPT-010, BR-PLT-010 |
| Needed by | R2 |
| Status | Open |

#### OD-38 — Lead from inbound email

| Field | Content |
|---|---|
| Question | Does an inbound email create a lead automatically (§11 step 1)? |
| Why it matters | Step 1 has no backing requirement (INC-03) |
| Options | 1. No automatic lead-from-email in Phase 1; users create records from the add-in or manually. 2. A dedicated inbox (e.g. a sales@ address) parsed into leads. 3. Rule-based detection in synced mail |
| Working assumption | Option 1 |
| Impact if decided differently | leads and comms modules (new intake path, new DR), assignment rules |
| Owner | Product |
| BRD refs | §11 step 1, BR-LED-001..004, BR-EML-005 |
| Needed by | R2 |
| Status | Open |

#### OD-40 — Priority inversions

| Field | Content |
|---|---|
| Question | How are Should items that Must items depend on delivered? |
| Why it matters | INC-06..INC-09: Musts would be incomplete without them |
| Options | 1. Deliver BR-AUT-006, BR-SIG-012, BR-SHR-010, BR-PRP-009, BR-RPT-006 in the same release as their dependent Musts; labels unchanged. 2. Re-label them Must (BRD revision). 3. Deliver the Musts in degraded form |
| Working assumption | Option 1 |
| Impact if decided differently | PRD §7; SCOPE-RECONCILIATION.md release notes; ACCEPTANCE-CRITERIA |
| Owner | Product |
| BRD refs | BR-CRM-005, BR-CRM-009, BR-RPT-005, BR-PRP-007, BR-NTF-001, BR-AUT-003 and the five Shoulds above |
| Needed by | R1 |
| Status | Open |

#### OD-41 — Are Phases 2–3 still intended?

| Field | Content |
|---|---|
| Question | Do Phases 2 and 3 remain the intended future for the internal product? |
| Why it matters | Justifies the extension-point effort under NFR-014 |
| Options | 1. Yes, as future internal phases; extension points only. 2. No; Phase 1 is final; drop extension-point work. 3. Yes, and design Phase 2 now |
| Working assumption | Option 1 |
| Impact if decided differently | ARCHITECTURE-DECISIONS (outbox, adapters, rule table); PRD §9 |
| Owner | Product |
| BRD refs | §2, §4, §8.2, §15, NFR-014 |
| Needed by | R1 |
| Status | Open |

#### OD-43 — PDF/DOCX parity

| Field | Content |
|---|---|
| Question | What does "PDF and DOCX files with the same content" require? |
| Why it matters | Pixel parity requires a different rendering stack |
| Options | 1. Same content and order (text, tables, pricing, images); DOCX editable, not pixel-identical. 2. Pixel-identical (render DOCX, convert to PDF). 3. DOCX limited to text content |
| Working assumption | Option 1 |
| Impact if decided differently | proposal-render package, worker dependencies, NFR-012 test plan. Docs: ARCHITECTURE-DECISIONS (ADR-010) |
| Owner | Product |
| BRD refs | BR-PRP-005, AC-07, NFR-012 |
| Needed by | R1 |
| Status | Open |

#### OD-44 — Recurring items

| Field | Content |
|---|---|
| Question | How are recurring lines priced and totalled? |
| Why it matters | BR-PRC-003 requires separate totals. The deal amount depends on it (OD-16) |
| Options | 1. Recurring lines carry billing period (monthly/quarterly/annual); proposal has `termMonths`; separate one-time and recurring subtotals/taxes/totals; TCV per OD-16. 2. Per-period price only, no term. 3. Also support custom periods and ramp pricing |
| Working assumption | Option 1 |
| Impact if decided differently | catalog, proposals pricing model, renderer, TCV calculation, Phase 3 invoicing extension point |
| Owner | Product |
| BRD refs | BR-PRC-002, BR-PRC-003, BR-PRC-004 |
| Needed by | R1 |
| Status | Open |

#### OD-46 — Lead form spam protection

| Field | Content |
|---|---|
| Question | Which spam protection do public forms use? |
| Why it matters | Public unauthenticated endpoint (BR-LED-006) |
| Options | 1. Honeypot + per-IP rate limiting in Postgres + optional CAPTCHA (Cloudflare Turnstile, needs credentials). 2. Mandatory CAPTCHA. 3. Honeypot only |
| Working assumption | Option 1 |
| Impact if decided differently | leads module, buyer app form embed, `Captcha` adapter, credential list |
| Owner | Product |
| BRD refs | BR-LED-006, BR-LED-001 |
| Needed by | R1 (BR-LED-006 ships with BR-LED-001 in R1, §12 R1) |
| Status | Open |

#### OD-47 — Task reminders and notification channels

| Field | Content |
|---|---|
| Question | Through which channels are reminders and notifications delivered? |
| Why it matters | BR-CRM-008 reminders; BR-NTF-004 browser push (Could) |
| Options | 1. In-app + email; browser push deferred. 2. Add browser push now. 3. In-app only for task reminders |
| Working assumption | Option 1 |
| Impact if decided differently | notifications module (push subscription, service worker), web app |
| Owner | Product |
| BRD refs | BR-CRM-008, BR-NTF-002, BR-NTF-004 |
| Needed by | R1 |
| Status | Open |

### 3.4 Sales Leadership

#### OD-16 — Which total sets the deal amount

| Field | Content |
|---|---|
| Question | Which proposal total is compared with, and written to, the deal amount? |
| Why it matters | BR-PRC-004 prompt, BR-AUT-002 Closed Won amount, all revenue reporting |
| Options | 1. TCV excluding tax = one-time + Σ(recurring per period × periods in term). 2. First-year value (one-time + 12 months recurring). 3. One-time + annualised recurring. 4. Grand total including tax |
| Working assumption | Option 1. Proposal `termMonths` default 12 |
| Impact if decided differently | proposals totals service, automation (AUT-002), reporting (RPT-001..003), PRD glossary (TCV). Docs: BUSINESS-RULES (PRC, AUT) |
| Owner | Sales Leadership / Finance |
| BRD refs | BR-PRC-004, BR-AUT-002, AC-11, BR-RPT-001..003 |
| Needed by | R1 |
| Status | Open |

#### OD-17 — Buyer accept without signature

| Field | Content |
|---|---|
| Question | What does buyer "accept" (BR-SHR-010) do to the proposal and deal? |
| Why it matters | BR-PRP-007 has no status for it (INC-14). It affects win rate |
| Options | 1. New status Accepted (labelled extension); notify owner; task "Confirm Closed Won"; no auto-close. 2. Accept auto-closes Closed Won like signing. 3. Accept recorded only as a buyer response; status unchanged |
| Working assumption | Option 1 |
| Impact if decided differently | proposal enum, automation rules, notifications, reporting (M4), buyer app |
| Owner | Sales Leadership |
| BRD refs | BR-SHR-010, BR-PRP-007, BR-AUT-002, BR-AUT-003, BR-NTF-001, §12 |
| Needed by | R1 |
| Status | Open |

#### OD-23 — Multiple proposals per deal

| Field | Content |
|---|---|
| Question | May a deal have several proposals, and what happens when one is signed? |
| Why it matters | Alternatives are common in negotiation. Closed Won must use one amount |
| Options | 1. Allowed; one open signature request per deal; on Signed, others set Void (reason "Another proposal was signed", automated, reversible). 2. One active proposal per deal. 3. Allowed; siblings untouched |
| Working assumption | Option 1 |
| Impact if decided differently | proposals, esign (concurrency), automation. Docs: BUSINESS-RULES (PRP, SIG, AUT) |
| Owner | Sales Leadership |
| BRD refs | BR-PRP-001, BR-SIG-001, BR-AUT-002 |
| Needed by | R1 |
| Status | Open |

#### OD-31 — Permission gaps in §9.17

| Field | Content |
|---|---|
| Question | How are the cases §9.17 leaves open resolved (reassignment, cross-visibility, view-only, closed deals, access history, email templates, lost reasons, discount limits)? |
| Why it matters | The permission model is enforced centrally and affects every query |
| Options | Per sub-question. Salesperson reassign: none (incl. bulk) / to own manager only. Cross-visibility: Admin setting per object type / always / never. View-only users add notes/tasks: no / yes |
| Working assumption | Salesperson cannot reassign (incl. bulk). Cross-visibility = Admin setting per object type (companies, contacts, deals), view-only. View-only means read-only. A Sales Manager's own records count as "own team". Closed deals editable by owner/manager/admin; reopening requires a reason. Access history visible to anyone who can view the deal. Email templates: personal (any user) and shared (Admin, or Manager with template rights). Lost reasons and discount limits: Admin |
| Impact if decided differently | identity policy module, repository query scoping, permissions payload. Docs: ROLE-PERMISSION-MATRIX (authoritative), FUNCTIONAL-REQUIREMENTS |
| Owner | Sales Leadership |
| BRD refs | §9.17, BR-PLT-005, BR-CRM-004, BR-CRM-013, BR-SHR-008, BR-EML-004, BR-CRM-014, BR-PRC-007, BR-RPT-008 |
| Needed by | R1 |
| Status | Open |

#### OD-35 — Metric definitions

| Field | Content |
|---|---|
| Question | How are win rate, cycle length, proposal win rate, "activity" and report date bases defined? |
| Why it matters | Dashboards (BR-RPT-002..005), stalled flags (BR-AUT-005) and PRD metrics must agree |
| Options | 1. WA below. 2. Win rate by created-date cohort. 3. Cycle length from a qualification stage instead of deal creation |
| Working assumption | Win rate = won ÷ (won + lost) by close date in period (count and value). Cycle = deal created → closed, won deals, calendar days. Proposal win rate = Signed (or Accepted) ÷ Sent, per proposal. Activity = any user or buyer activity excluding automated system events. Won/lost filtered by close date, pipeline-created metrics by created date. "Deals going quiet" = 14 days |
| Impact if decided differently | reporting SQL views, automation (AUT-005), PRD §2.2 |
| Owner | Sales Leadership |
| BRD refs | §12, BR-RPT-002..005, BR-AUT-005 |
| Needed by | R1 |
| Status | Open |

#### OD-39 — Discount limits

| Field | Content |
|---|---|
| Question | How are discount limits defined and enforced? |
| Why it matters | BR-PRC-007 warns; approvals are Phase 2 |
| Options | 1. Admin sets max % per role (per line and overall); exceeding shows a warning recorded on the proposal; no approval. 2. Limits per product. 3. Limits per user |
| Working assumption | Option 1 |
| Impact if decided differently | catalog (`discount_limit`), proposals pricing validation |
| Owner | Sales Leadership |
| BRD refs | BR-PRC-007, §8.2 (approval workflows) |
| Needed by | R3 |
| Status | Open |

### 3.5 Sales Ops and Finance

#### OD-15 — Multi-currency and FX for reporting

| Field | Content |
|---|---|
| Question | How do non-default currencies work and how are reports converted? |
| Why it matters | BR-PRC-006 (Should) and correct pipeline totals |
| Options | 1. Proposal uses its deal's currency; deals may use a non-default currency; reports convert using an Admin-maintained rate table with effective dates. 2. Single currency only. 3. Automatic FX rate feed |
| Working assumption | Option 1 |
| Impact if decided differently | crm (`exchange_rate`), reporting views, settings UI. Schema holds currency from R1 regardless |
| Owner | Finance / Sales Ops |
| BRD refs | BR-PRC-005, BR-PRC-006, BR-PLT-012, BR-RPT-001..003 |
| Needed by | R1 |
| Status | Open |

#### OD-27 — Duplicate matching keys

| Field | Content |
|---|---|
| Question | Which keys identify duplicates in import, lead forms and forwarded viewers? |
| Why it matters | Data quality and wrong merges |
| Options | 1. Contact = normalised email; company = normalised primary domain else exact normalised name; deal = external source id (import) only; fuzzy matches (pg_trgm) as suggestions only. 2. Fuzzy auto-merge above a threshold. 3. Contacts only; no company dedupe |
| Working assumption | Option 1 |
| Impact if decided differently | import, leads, sharing, crm search indexes |
| Owner | Sales Ops |
| BRD refs | BR-MIG-003, BR-LED-004, BR-SHR-005 |
| Needed by | R1 |
| Status | Open |

#### OD-32 — Teams

| Field | Content |
|---|---|
| Question | What is the team structure? |
| Why it matters | Manager visibility scope (BR-PLT-006) |
| Options | 1. User in at most one team; team has ≥ 1 managers; manager may manage several teams; no nesting. 2. Multiple team membership. 3. Nested hierarchy |
| Working assumption | Option 1 |
| Impact if decided differently | identity (`team_member`, `team_manager`), policy scoping, reporting filters |
| Owner | Sales Ops |
| BRD refs | BR-PLT-006, §9.17 |
| Needed by | R1 |
| Status | Open |

#### OD-33 — Contact↔company and deal↔company

| Field | Content |
|---|---|
| Question | How many companies can a contact belong to, and does a deal require a company? |
| Why it matters | Data model and lead form matching |
| Options | 1. Contact has zero or one primary company; deal requires a company; lead forms create/match company from name or domain. 2. Many-to-many contact↔company. 3. Deals without a company allowed |
| Working assumption | Option 1 |
| Impact if decided differently | crm data model, import mapping, leads, placeholders |
| Owner | Sales Ops |
| BRD refs | BR-CRM-002, BR-CRM-003, BR-LED-001 |
| Needed by | R1 |
| Status | Open |

#### OD-34 — Deal contact roles

| Field | Content |
|---|---|
| Question | How are contact roles on a deal defined? |
| Why it matters | BR-CRM-003 examples; forwarded-viewer role |
| Options | 1. Admin-defined list seeded with Decision-maker, Signer, Influencer, Forwarded viewer (system); multiple roles per contact per deal. 2. Fixed list. 3. Single role per contact per deal |
| Working assumption | Option 1 |
| Impact if decided differently | crm (`contact_role`, `deal_contact`), sharing |
| Owner | Sales Ops |
| BRD refs | BR-CRM-003, BR-SHR-005 |
| Needed by | R1 |
| Status | Open |

### 3.6 Tech Lead and IT

#### OD-03 — E-signature provider selection

| Field | Content |
|---|---|
| Question | Which e-signature provider do we contract? |
| Why it matters | Capabilities behind BR-SIG-002..013, cost, data residency |
| Options | 1. DocuSign eSignature. 2. Dropbox Sign. 3. Adobe Acrobat Sign. 4. BoldSign |
| Working assumption | Provider-neutral adapter. Criteria: sequential and parallel signing, email + SMS verification, webhooks, completion certificate, tamper-evident sealed PDF, decline with reason, reminders, void, data residency, cost |
| Impact if decided differently | esign adapter driver, webhook verification, credential list; possibly BR-SIG-005 release |
| Owner | Tech Lead |
| BRD refs | BR-SIG-002..013 |
| Needed by | R2 |
| Status | Open |

#### OD-04 — OpenCRM foundation suitability

| Field | Content |
|---|---|
| Question | Is clawnify/OpenCRM a suitable code foundation? |
| Why it matters | Possible rework (OQ-3, §13.4) |
| Options | 1. Not adopted; UI reference only; greenfield. 2. Fork and extend. 3. Adopt its data model only |
| Working assumption | Option 1. Finding: small MIT project (React 19 + Hono on Cloudflare Workers + D1/SQLite, no roles/permissions, ~80 commits) |
| Impact if decided differently | Entire architecture (ADR-001..019) |
| Owner | Tech Lead |
| BRD refs | OQ-3, §1, §13.3, §13.4 |
| Needed by | R1 |
| Status | Open |

#### OD-05 — AI model provider and data terms

| Field | Content |
|---|---|
| Question | Which AI provider, and on what data terms? |
| Why it matters | Privacy, cost, quality (OQ-4); BR-AIA-009, NFR-003 |
| Options | 1. Anthropic Claude API (no training on inputs; confirm zero data retention). 2. Azure OpenAI in the company tenant. 3. Another provider or self-hosted model |
| Working assumption | Option 1, server-side only behind an `AiProvider` adapter |
| Impact if decided differently | ai adapter driver, prompt templates, DPA, cost model (OD-53) |
| Owner | Tech Lead |
| BRD refs | OQ-4, BR-AIA-001..009, NFR-003, §13.3 |
| Needed by | R2 |
| Status | Open |

#### OD-11 — Hosting target

| Field | Content |
|---|---|
| Question | Where and how is the system hosted? |
| Why it matters | Availability, backup, storage driver, secrets |
| Options | 1. Containers on the company's cloud (Azure or AWS) with managed PostgreSQL 18 (target per foundation §15; 17 only as fallback if the managed offering lacks 18), object storage, TLS load balancer, managed secrets. 2. On-premises VMs. 3. Simpler PaaS |
| Working assumption | Option 1; cloud to confirm |
| Impact if decided differently | storage adapter driver (S3 vs Azure Blob), deployment docs, NFR-006/008 approach |
| Owner | IT / Tech Lead |
| BRD refs | NFR-001, NFR-006, NFR-008 |
| Needed by | R1 |
| Status | Open |

#### OD-12 — Login methods

| Field | Content |
|---|---|
| Question | Which sign-in methods are enabled? |
| Why it matters | BR-PLT-003; SSO is Phase 3 (INC-12) |
| Options | 1. Email+password and Google/Microsoft OAuth restricted to the company domain/tenant; Admin can disable password login. 2. OAuth only. 3. Enterprise SAML SSO now |
| Working assumption | Option 1 |
| Impact if decided differently | identity (Better Auth configuration), invitation flow |
| Owner | IT |
| BRD refs | BR-PLT-003, §8.2 |
| Needed by | R1 |
| Status | Open |

#### OD-13 — MFA enforcement

| Field | Content |
|---|---|
| Question | Who must use MFA? |
| Why it matters | BR-PLT-004 (Should) vs NFR-001 "MFA available" (INC-11) |
| Options | 1. TOTP at launch; Admin can require; recommended required for Admins. 2. Required for all users. 3. Rely on IdP MFA via OAuth only |
| Working assumption | Option 1 |
| Impact if decided differently | identity (two-factor), settings, onboarding |
| Owner | IT / Security |
| BRD refs | BR-PLT-004, NFR-001 |
| Needed by | R1 |
| Status | Open |

#### OD-14 — Transactional email service

| Field | Content |
|---|---|
| Question | Which service sends system notifications and buyer emails not sent from a user mailbox? |
| Why it matters | NFR-013 deliverability |
| Options | 1. Amazon SES. 2. Postmark. 3. Azure Communication Services |
| Working assumption | `TransactionalEmail` adapter; SMTP-compatible provider with SPF/DKIM/DMARC on a company subdomain |
| Impact if decided differently | adapter driver, DNS setup |
| Owner | Tech Lead |
| BRD refs | NFR-013, BR-NTF-001, BR-CRM-008, §13.3 |
| Needed by | R1 |
| Status | Open |

#### OD-45 — Internal sizing and NFR targets

| Field | Content |
|---|---|
| Question | What volumes and service levels must the system meet? |
| Why it matters | NFR-007 does not apply (IDD-06). NFR-005/006/008 are "proposed" |
| Options | 1. WA volumes; BRD targets kept. 2. Higher volumes. 3. Tighter RPO/RTO with PITR |
| Working assumption | ≤ 150 users, ≤ 200k contacts, ≤ 100k companies, ≤ 100k deals, ≤ 5M synced emails, ≤ 20k proposals/year; NFR-005/006/008 as proposed; RPO 24 h, RTO 8 h; PITR recommended |
| Impact if decided differently | indexing, sync batch sizes, backup design, test plans |
| Owner | Tech Lead / IT |
| BRD refs | NFR-005, NFR-006, NFR-007, NFR-008 |
| Needed by | R1 |
| Status | Open |

## 4. Decision log

Record each outcome here. Do not delete the OD entry above. Change its Status to Decided and link the log row.

| Date | OD | Decision (option chosen / text) | Same as WA? | Decided by | Evidence / rationale | Affected documents updated | Follow-up actions (owner, date) |
|---|---|---|---|---|---|---|---|
| YYYY-MM-DD | OD-NN | | Yes / No | Name, role | | SCOPE-RECONCILIATION.md rows …; FUNCTIONAL-REQUIREMENTS …; | |

Status values: Open · Proposed (OD-48+ until accepted into the register) · Decided · Superseded (by OD-NN) · Withdrawn.

## 5. Proposed additional decisions

These decisions were found missing while writing PRD.md and SCOPE-RECONCILIATION.md. They are **not** in the foundation register. The design does not depend on them unless stated. Where an option is labelled "PM recommendation", it is not a Working Assumption until the Product Owner accepts it.

#### OD-48 — Internal go-live release and cutover from current tools

| Field | Content |
|---|---|
| Question | Which release marks internal go-live (start of the AC-15 30-day window), and how do we cut over from the current CRM, document and e-signature tools (freeze date, parallel run, in-flight signatures in the old tool)? |
| Why it matters | BRD: "Must = required for launch", but BR-EML-005 (Must) is R3 under the OD-07 WA (INC-16). AC-15..AC-18 and BR-MIG-002 timing depend on it. OD-08 covers date and capacity, not the cutover point |
| Options | 1. Go-live at R2 exit, add-in committed for R3 (PM recommendation, ~65% confidence). 2. Go-live at R3 exit, all Musts complete. 3. Go-live at R1 for CRM and link-shared proposals; signing stays in the old tool until R2 |
| Working assumption | Option 1 (foundation §12 R1): internal go-live at the end of R2; R1 may run as a pilot; add-in (BR-EML-005) and BR-MIG-002 committed for R3 |
| Impact if decided differently | PRD §7; release placement of BR-MIG-002 (OD-09); AC-15..18 timing; baseline window (OD-10) |
| Owner | Leadership + Product + Sales Leadership |
| BRD refs | §9 priority key, BR-EML-005, AC-15..AC-18, OQ-7, OQ-10, §13.2 |
| Needed by | R1 |
| Status | Proposed |

#### OD-49 — Tax model

| Field | Content |
|---|---|
| Question | What does a product's "tax category" resolve to: a fixed rate per category, or a rate by category × buyer jurisdiction? Are prices tax-exclusive or tax-inclusive? Are recurring lines taxed per period? Is rounding per line or on totals? |
| Why it matters | BR-PRC-001 names "tax category" and BR-PRC-002/003 require taxes and totals, but the rate model is unspecified. Totals on signed documents must be correct. TCV excludes tax (OD-16) |
| Options | 1. Fixed rate per tax category, tax-exclusive, per-line rounding. 2. Rate table by tax category × buyer country/region. 3. Tax shown as informational only or omitted (handled at invoicing) |
| Working assumption | Foundation §12 R10/R11: fixed rate per tax category; catalog prices tax-exclusive in the org default currency (currency conversion: OD-57); line totals rounded half-up to 2 decimals; subtotals, taxes and totals summed from rounded lines; tax computed per line, then summed; recurring lines taxed per billing period |
| Impact if decided differently | catalog (`tax_category`), pricing calculation, renderer, data model |
| Owner | Finance |
| BRD refs | BR-PRC-001, BR-PRC-002, BR-PRC-003 |
| Needed by | R1 |
| Status | Proposed |

#### OD-50 — Historical data from tools being retired

| Field | Content |
|---|---|
| Question | Beyond companies, contacts and deals (BR-MIG-001), do we migrate historical proposals, signed PDFs and certificates, notes and activities from the tools we retire? Where is the old-tool archive kept? |
| Why it matters | AC-18 retires the previous tools. Signed contracts and history must stay retrievable (OD-36) |
| Options | 1. Records only; old signed PDFs attached as files to the matching deals. 2. Records only; full export of the old tools archived outside the CRM. 3. Full activity history import (notes, activities) |
| Working assumption | None in foundation |
| Impact if decided differently | import module (file attachment import, a new DR), object storage sizing, AC-18 checklist |
| Owner | Sales Ops + Legal |
| BRD refs | BR-MIG-001, AC-18, OQ-8 |
| Needed by | R2 (before go-live) |
| Status | Proposed |

#### OD-51 — Initial email and calendar backfill window

| Field | Content |
|---|---|
| Question | When a user connects a mailbox, how far back are emails and calendar events synced? |
| Why it matters | Storage sizing (OD-45: ≤ 5M emails), initial sync duration, privacy minimisation, quality of AI summaries (BR-AIA-003) and M6 |
| Options | 1. 90 days. 2. 12 months. 3. Forward-only (no backfill) |
| Working assumption | None in foundation |
| Impact if decided differently | comms sync jobs, sizing, privacy notice |
| Owner | Product + Legal |
| BRD refs | BR-EML-001, BR-EML-002, BR-EML-006, BR-AIA-003, NFR-002 |
| Needed by | R2 |
| Status | Proposed |

#### OD-52 — Mailbox connection obligation and employee privacy

| Field | Content |
|---|---|
| Question | Is connecting a mailbox mandatory for salespeople? What employee notice (and, where applicable, works-council or HR consultation) is required before sync? |
| Why it matters | M6 (80% automatic capture) and M7 adoption depend on it. The BRD §13.4 privacy risk now concerns our employees (IDD-09: we are controller) |
| Options | 1. Mandatory for Salesperson and Sales Manager roles, with an employee privacy notice. 2. Strongly encouraged, optional. 3. Optional, no tracking of who connected |
| Working assumption | None in foundation. The employee privacy notice is listed as a compliance task |
| Impact if decided differently | internal setup checklist (BR-PLT-008), adoption reporting, PRD §2 targets |
| Owner | Sales Leadership + Legal / HR |
| BRD refs | BR-EML-001, BR-EML-003, BR-PLT-008, NFR-002, §12, §13.4 risk 9 |
| Needed by | R2 |
| Status | Proposed |

#### OD-53 — AI budget and usage limits

| Field | Content |
|---|---|
| Question | What is the monthly AI budget, are there per-user or per-feature limits, and what happens when they are exceeded? |
| Why it matters | IDD-10 turns AI cost into an internal budget control with "usage limits/monitoring retained", but no values or behaviour are defined |
| Options | 1. Monthly organization budget with alert to Admin; no hard stop. 2. Per-user daily quotas with a hard stop and message. 3. No limits; monitoring only |
| Working assumption | Defaults (HLD wave, ADR-043; FUNCTIONAL-REQUIREMENTS DR-AIA-02): Admin-set organization monthly token budget and per-user monthly cap, both checked before each call (A15); alert to Admin at 80%; hard stop at 100% with message "AI limit reached for this month" (`AI_QUOTA_EXCEEDED`); values are settings `ai.orgMonthlyBudget`, `ai.userMonthlyCap`, `ai.alertPercent = 80`. Values to be set by Leadership/Finance |
| Impact if decided differently | ai module (`ai_usage` aggregation, limit checks), settings UI, notifications |
| Owner | Leadership / Finance + Tech Lead |
| BRD refs | BR-AIA-007, BR-AIA-008, §13.4 risk 5, §15.3 |
| Needed by | R2 |
| Status | Proposed |

#### OD-54 — Confirmation of unnumbered analysis working assumptions

| Field | Content |
|---|---|
| Question | Confirm or change the Stage-1 analysis WAs that the design uses but that have no OD of their own (a–m), and decide two newly found gaps (n, o) |
| Why it matters | These WAs drive automation, statuses and data model. Without an OD they have no business owner |
| Options | Per item: confirm WA / change (state alternative) |
| Working assumption | a. **"Sent"** = version shared through CRM/add-in email, OR the user marks "link shared manually" after copying the link (BR-SHR-002, BR-AUT-001, BR-AUT-004, M1). b. **"Answered"** = accepted, declined, signed, or an inbound email from a recipient on the deal (BR-AUT-004). c. Editing a sent proposal creates a new draft version; the sent version is immutable (BR-PRP-003, -006). d. Declined/Expired → new version on the same proposal, status returns to Draft; Void is terminal, so copy to a new proposal (BR-PRP-007, -010). e. Manual Closed Lost with an open signature request prompts to void it (BR-CRM-014, BR-SIG-013). f. Proposals pin the template version; a new proposal version re-resolves placeholders from current CRM data with a diff shown (BR-TPL-004). g. Placeholder formatting from org locale/currency; multi-select joined by ", "; checkbox Yes/No (BR-CRM-007, BR-TPL-002). h. Deleting a custom field archives the definition, keeps values, flags templates (BR-CRM-007, BR-TPL-008). i. Export = CSV/JSON per entity + signed PDFs and certificates; private emails metadata only (BR-PLT-010). j. Deactivation: Admin reassigns open deals/tasks/proposals; pending signature requests keep the sender of record, notifications go to the new owner; mailbox sync stops and tokens are revoked; removed from round-robin (BR-PLT-011). k. Signers and recipients must be contacts on the deal (BR-SIG-002, BR-SHR-003). l. Each pipeline has system stages Closed Won (100, won) and Closed Lost (0, lost) (BR-CRM-005). m. Notifications go to the current deal owner after reassignment (BR-NTF-001). **New, no WA:** n. Who receives the signed PDF as "all parties" (BR-SIG-010): signers + deal owner / + all recipients / + forwarded viewers. o. Lead assignment when no rule matches (BR-LED-002): Admin-set default owner / unassigned queue visible to Admin and Managers |
| Impact if decided differently | BUSINESS-RULES, WORKFLOWS and FUNCTIONAL-REQUIREMENTS (DR items) for PRP, SHR, SIG, AUT, CRM, TPL, PLT, LED, NTF |
| Owner | Product + Sales Leadership |
| BRD refs | As listed per item |
| Needed by | R1 (a–m, o — lead capture is in R1 per §12 R1); R2 (n) |
| Status | Proposed |

### 5.1 Specification-wave decisions (OD-55..OD-81)

Consolidated from foundation §12 R4, R10 and R12 and from the BUSINESS-RULES, WORKFLOWS and FUNCTIONAL-REQUIREMENTS open points. Each WA is parameterised as an Admin setting or constant where stated. Duplicates of earlier ODs are not repeated: unmatched-lead fallback owner = OD-54 item o; audit log retention = OD-36; rounding and tax per line (§12 R11) = OD-49; AI budget values = OD-53; reversing Closed Won after manual edits = OD-24 (compare-and-swap with confirmation, A9); rep attribution = OD-35 (and OD-81 item k); free-mail exclusion = accepted by §12 R3 (DR-LED-04).

#### OD-55 — Deterministic pre-send checks when AI is disabled

| Field | Content |
|---|---|
| Question | Do the deterministic pre-send checks (missing placeholders, totals consistency, dates, required sections) run when the AI switch is off (BR-AIA-008), and which part of BR-AIA-002 is governed by the AI switch? |
| Why it matters | BR-AIA-002 is an AI requirement, but its deterministic part protects every proposal (BR-TPL-008, A15). If the AI switch also disabled it, turning AI off would remove error protection |
| Options | 1. Deterministic checks always run; only the LLM consistency check follows BR-AIA-008 switches. 2. All checks follow the AI switch. 3. Deterministic checks configurable separately by Admin |
| Working assumption | Option 1 (foundation §12 R4): deterministic checks run from R1 and always, independent of AI settings; the LLM consistency check (R2) is governed by the org and per-feature AI switches (BR-AIA-008). Deterministic findings cannot be suppressed by LLM output (A15) |
| Impact if decided differently | proposals (pre-send service), ai module, FUNCTIONAL-REQUIREMENTS BR-AIA-002/BR-TPL-008, ACCEPTANCE-CRITERIA |
| Owner | Product |
| BRD refs | BR-AIA-002, BR-AIA-008, BR-TPL-008 |
| Needed by | R1 |
| Status | Proposed |

#### OD-56 — Which pre-send findings block sending

| Field | Content |
|---|---|
| Question | Which pre-send findings block sending, which only warn, and does pending (unaccepted) AI content block sending? |
| Why it matters | BR-AIA-002 says the check "flags" issues; AC-08 says nothing is sent without user action. Blocking too much stalls sales; too little ships wrong documents |
| Options | 1. Block: unresolved placeholders, missing required sections, totals mismatch, validity date in the past, pending AI content; warn: everything else including LLM findings. 2. Warnings only. 3. Admin-configurable severity per check |
| Working assumption | Severities exactly as RULE-AIA-11 (authoritative, foundation §15): blocking = `PLACEHOLDER_UNRESOLVED`, `REQUIRED_SECTION_EMPTY`, `AI_CONTENT_PENDING`, `VALIDITY_DATE_PAST`, `CURRENCY_REVIEW_REQUIRED`; warning = `PRICING_DEAL_AMOUNT_MISMATCH`, `DISCOUNT_LIMIT_EXCEEDED`, `DATE_IN_PAST_IN_TEXT` and all LLM findings. Held as a constant table; LLM findings never block |
| Impact if decided differently | proposals, ai, sharing (send endpoint), PERM-110, send workflows |
| Owner | Product + Sales Leadership |
| BRD refs | BR-AIA-002, BR-TPL-008, BR-PRP-009, AC-08 |
| Needed by | R1 |
| Status | Proposed |

#### OD-57 — Catalog prices in a non-default currency and missing exchange rates

| Field | Content |
|---|---|
| Question | How are tax-exclusive catalog prices (org default currency) converted when a deal/proposal uses another currency, and what happens when no exchange rate is effective for a date? |
| Why it matters | Pricing lines and reports both need a rate (OD-15). A missing rate otherwise blocks proposals or silently prices at zero |
| Options | 1. Convert at the rate effective at line creation, editable by the user; if no rate, the user must enter the unit price manually. 2. Per-product price lists per currency only. 3. Block non-default currencies until a rate exists |
| Working assumption | Option 1 (foundation §12 R10): catalog prices are tax-exclusive in the default currency; conversion at the rate effective at line creation (editable by the user); missing rate → manual unit price required; reporting uses the latest earlier rate and flags "rate missing" to Admin |
| Impact if decided differently | catalog (`exchange_rate`), proposals pricing, reporting conversion, DOMAIN-MODEL §10.1/§11.3 |
| Owner | Finance / Sales Ops |
| BRD refs | BR-PRC-001, BR-PRC-005, BR-PRC-006, BR-RPT-001 |
| Needed by | R1 |
| Status | Proposed |

#### OD-58 — Record update and ownership policy for imports and lead forms

| Field | Content |
|---|---|
| Question | When an import (merge) or a lead form matches an existing company/contact, which values win and who owns the record? |
| Why it matters | Anonymous form data must not overwrite curated data; imports need predictable merges (BR-MIG-003 "merge" is undefined) |
| Options | 1. Lead forms fill empty fields only, existing owner wins over assignment rules, an existing open deal for the contact is reused (OD-61); import merge = file value wins for mapped non-empty columns, chosen per batch. 2. Newest value always wins. 3. Field-by-field choice per record |
| Working assumption | Option 1 (RULE-LED-06/08). Import merge precedence is a per-batch choice (`fileWins` default, `fillEmptyOnly` alternative) |
| Impact if decided differently | import, leads, crm; WF-09; DOMAIN-MODEL §8.2 |
| Owner | Sales Ops |
| BRD refs | BR-MIG-003, BR-LED-001, BR-LED-002, BR-LED-004 |
| Needed by | R1 |
| Status | Proposed |

#### OD-59 — Import limits, undo window and undo after later changes

| Field | Content |
|---|---|
| Question | What file/row limits apply, may valid rows be imported when other rows fail validation, how long can a batch be undone, and what does undo do with records modified after the import? |
| Why it matters | BR-MIG-005 requires undo, but undo after edits can destroy users' work |
| Options | 1. 25 MB / 50,000 rows; undo has no time limit and skips records modified after import (reported). 2. Undo within 30 days, all-or-nothing. 3. Undo only until the first edit |
| Working assumption | Option 1 for undo semantics (RULE-MIG-10); invalid rows are never persisted, and the Admin may import the valid rows only after explicit confirmation; limits as constants `import.maxFileMb = 25`, `import.maxRows = 50000`. FUNCTIONAL-REQUIREMENTS DR-MIG-02 ("undo 30 days") follows this OD |
| Impact if decided differently | import module, SM-08, DR-MIG-01/02 |
| Owner | Sales Ops + Tech Lead |
| BRD refs | BR-MIG-004, BR-MIG-005 |
| Needed by | R1 |
| Status | Proposed |

#### OD-60 — Are companies and contacts unique?

| Field | Content |
|---|---|
| Question | Is `normalizedDomain` unique among non-archived companies and `normalizedEmail` unique among non-archived contacts (hard constraint), or only a duplicate warning? |
| Why it matters | OD-27 defines matching keys but not whether duplicates may exist. Uniqueness makes form, import and email matching deterministic but blocks legitimate cases (subsidiaries sharing a domain) |
| Options | 1. Contacts: unique email (hard); companies: domain unique (hard) with Admin override. 2. Both warnings only. 3. Both hard, no override |
| Working assumption | Option 1. Companies sharing a domain exist only via Admin override; matching then picks the oldest non-archived company and flags "review". Free-mail domains are never company domains (§12 R3) |
| Impact if decided differently | crm (DB constraints), import, leads, comms linking; DOMAIN-MODEL §5.1/§5.2 |
| Owner | Sales Ops |
| BRD refs | BR-CRM-001, BR-CRM-002, BR-MIG-003, BR-LED-004 |
| Needed by | R1 |
| Status | Proposed |

#### OD-61 — Duplicate-deal suppression window for repeat form submissions

| Field | Content |
|---|---|
| Question | When the same contact submits a deal-creating form again, when is a new deal created rather than the existing one reused? |
| Why it matters | Repeat submissions otherwise inflate the pipeline |
| Options | 1. Reuse an open deal for the same contact + pipeline + form within N days. 2. Always reuse any open deal for the contact. 3. Always create |
| Working assumption | Option 1, Admin setting `leads.dealSuppressionDays = 30` |
| Impact if decided differently | leads, DR-LED-05 |
| Owner | Sales Ops |
| BRD refs | BR-LED-001, BR-LED-004 |
| Needed by | R1 |
| Status | Proposed |

#### OD-62 — CAPTCHA failure mode

| Field | Content |
|---|---|
| Question | If the CAPTCHA provider is unavailable, are submissions accepted (fail-open) or rejected (fail-closed)? |
| Why it matters | FUNCTIONAL-REQUIREMENTS used fail-open; WORKFLOWS WA-8 used fail-closed. Lost leads vs spam risk |
| Options | 1. Fail-open: accept, mark "unverified"; honeypot and rate limits still apply. 2. Fail-closed: reject with a retry message |
| Working assumption | Option 1, Admin setting `leadForms.captchaFailMode = open` (WORKFLOWS WA-8 aligned to this WA) |
| Impact if decided differently | leads, WF-09 |
| Owner | Product + Security |
| BRD refs | BR-LED-006, OD-46 |
| Needed by | R1 |
| Status | Proposed |

#### OD-63 — Calendar meetings with unknown attendees

| Field | Content |
|---|---|
| Question | Are calendar events whose attendees match no known contact stored or ignored? |
| Why it matters | OD-29 covers emails from unknown senders only; meetings carry the same data-minimisation issue |
| Options | 1. Not stored (as OD-29), unless an attendee matches a contact. 2. Stored as unlinked. 3. Stored for the mailbox owner only |
| Working assumption | Option 1, mirroring OD-29 |
| Impact if decided differently | comms sync |
| Owner | Product + Legal |
| BRD refs | BR-EML-006, NFR-002 |
| Needed by | R2 |
| Status | Proposed |

#### OD-64 — Internal email domain(s)

| Field | Content |
|---|---|
| Question | Which domains are "internal", so that colleagues are excluded from email/meeting linking and from forwarded-viewer detection? |
| Why it matters | Without it, internal participants become contacts or forwarded viewers |
| Options | 1. Admin setting listing internal domains, defaulting to the login allowed domains (OD-12). 2. Derived from active users' emails only |
| Working assumption | Option 1, setting `organization.internalDomains` (RULE-SHR-05, RULE-EML-05) |
| Impact if decided differently | comms, sharing, identity |
| Owner | IT + Product |
| BRD refs | BR-EML-002, BR-SHR-005 |
| Needed by | R1 |
| Status | Proposed |

#### OD-65 — Source of contact placeholders

| Field | Content |
|---|---|
| Question | Which contact fills `contact.*` placeholders in a proposal? |
| Why it matters | A deal can have several contacts; BR-TPL-002 does not say which one |
| Options | 1. The proposal's primary contact, chosen at creation (default: first deal contact with role Decision-maker, else first deal contact). 2. Always the first signer. 3. Choice per placeholder |
| Working assumption | Option 1 (`Proposal.primaryContactId`, DOMAIN-MODEL §11.1) |
| Impact if decided differently | proposals, templates |
| Owner | Product |
| BRD refs | BR-TPL-002, BR-PRP-002 |
| Needed by | R1 |
| Status | Proposed |

#### OD-66 — Discount model

| Field | Content |
|---|---|
| Question | Are amount discounts allowed in addition to percentages, is the overall discount applied per one-time/recurring group, and in which order are discounts and tax applied? |
| Why it matters | BR-PRC-002 names line and overall discounts but no model; totals on signed documents must be unambiguous |
| Options | 1. Percent or amount on lines; overall discount per group (one-time, recurring); order line → overall → tax. 2. Percent only. 3. One overall discount across groups |
| Working assumption | Option 1 (RULE-PRC-05/06) |
| Impact if decided differently | proposals pricing, renderer, DOMAIN-MODEL §11.3 |
| Owner | Sales Leadership + Finance |
| BRD refs | BR-PRC-002, BR-PRC-003, BR-PRC-007 |
| Needed by | R1 |
| Status | Proposed |

#### OD-67 — Contract term and billing periods

| Field | Content |
|---|---|
| Question | Must `termMonths` be a whole multiple of every recurring line's billing period, or are partial periods pro-rated? |
| Why it matters | TCV (OD-16) depends on the number of periods |
| Options | 1. Whole multiple required (validation error otherwise). 2. Pro-rate partial periods |
| Working assumption | Option 1 (RULE-PRC-07) |
| Impact if decided differently | proposals pricing |
| Owner | Finance |
| BRD refs | BR-PRC-003, OD-16, OD-44 |
| Needed by | R1 |
| Status | Proposed |

#### OD-68 — How "signature not required" is set

| Field | Content |
|---|---|
| Question | How does a proposal declare that buyer Accept/Decline (BR-SHR-010) is offered instead of signing? |
| Why it matters | BR-SHR-010 applies "when signature is not required", but nothing sets it |
| Options | 1. Per-version response mode chosen at send (accept/decline vs signature). 2. Template setting. 3. Deal setting |
| Working assumption | Option 1 (RULE-PRP-19) |
| Impact if decided differently | proposals, sharing, buyer view |
| Owner | Product + Sales Leadership |
| BRD refs | BR-SHR-010, OD-17 |
| Needed by | R1 |
| Status | Proposed |

#### OD-69 — Identity gate for original recipients

| Field | Content |
|---|---|
| Question | Must an original recipient opening their own link in a new browser identify (name + email) like a forwarded viewer? |
| Why it matters | Forward detection (BR-SHR-005) relies on it, but it adds friction |
| Options | 1. Recipient link shows "Continue as <recipient name>" or "I'm someone else"; the latter requires name + email (forwarded viewer, OD-26); if BR-SHR-006 verification is on, both paths require the OTP; device remembered by HttpOnly cookie. 2. Every new browser enters name + email. 3. Trust the first opener |
| Working assumption | Option 1 (foundation §16 S3; RULE-SHR-06). No general links. Pending Legal/Product confirmation; OTP default per OD-87 |
| Impact if decided differently | sharing, buyer view |
| Owner | Product + Legal |
| BRD refs | BR-SHR-005, OD-26 |
| Needed by | R1 |
| Status | Proposed |

#### OD-70 — Buyer DOCX download

| Field | Content |
|---|---|
| Question | Can buyers download the DOCX, or only the PDF? |
| Why it matters | DOCX is editable; buyers could alter terms |
| Options | 1. PDF only for buyers (DOCX internal). 2. Per-version option |
| Working assumption | Option 1 |
| Impact if decided differently | sharing, buyer view |
| Owner | Product |
| BRD refs | BR-SHR-004, BR-PRP-005 |
| Needed by | R1 |
| Status | Proposed |

#### OD-71 — Internal countersigner

| Field | Content |
|---|---|
| Question | Do our own signatories need to sign in the same signature request? |
| Why it matters | Signers must be deal contacts (OD-54 item k), which excludes internal users |
| Options | 1. Not supported in Phase 1; our signatory signs outside the CRM. 2. Internal signer added from users in the same request |
| Working assumption | Option 1 (BUSINESS-RULES §19 item 15). FUNCTIONAL-REQUIREMENTS BR-SIG-002 follows this WA |
| Impact if decided differently | esign, SIG workflows |
| Owner | Sales Leadership + Legal |
| BRD refs | BR-SIG-002, BR-SIG-010 |
| Needed by | R2 |
| Status | Proposed |

#### OD-72 — Notification and signing defaults

| Field | Content |
|---|---|
| Question | Default values: link-expiring lead time, digest time and time-zone basis, signature reminder cadence, signature request expiry, maximum signers, in-app-only "proposal expired" notification |
| Why it matters | Values drive NTF and SIG behaviour; the BRD gives none |
| Options | Confirm or change each default |
| Working assumption | Link-expiring notice 48 h before (`shareDefaults.linkExpiringNoticeHours`, Admin range 24–336 h); digests at 08:00 in the recipient's time zone (fallback org time zone); reminders 2 days after send then every 3 days, max 5; request expiry 30 days; max 10 signers; derived in-app-only `proposal_expired` notification (WORKFLOWS WA-6) |
| Impact if decided differently | notifications, esign, OrganizationSettings |
| Owner | Product + Sales Leadership |
| BRD refs | BR-NTF-001, BR-NTF-003, BR-SIG-008, BR-SHR-007 |
| Needed by | R1 (signing items R2) |
| Status | Proposed |

#### OD-73 — Proposal "reopen" definition and notification throttling

| Field | Content |
|---|---|
| Question | When does a view count as a re-open, and how are repeat notifications throttled? |
| Why it matters | Avoids notification floods while keeping real-time alerts |
| Options | 1. New session at least 30 min after the previous one; at most one re-open notice per viewer per proposal per 2 h. 2. Every session notifies |
| Working assumption | Option 1 (constants `ntf.reopenGapMinutes = 30`, `ntf.reopenThrottleHours = 2`) |
| Impact if decided differently | sharing, notifications; DR-SHR-03, DR-NTF-02 |
| Owner | Product with Sales |
| BRD refs | BR-NTF-001, BR-SHR-004 |
| Needed by | R1 |
| Status | Proposed |

#### OD-74 — Automation and attention thresholds

| Field | Content |
|---|---|
| Question | Default follow-up days for BR-AUT-004 (calendar vs business days), default stalled days per stage (BR-AUT-005) and the "unviewed proposal" threshold for BR-RPT-005 |
| Why it matters | Defaults are needed on day one; values change team behaviour |
| Options | Confirm or change each default |
| Working assumption | AUT-004: 3 business days, condition "neither viewed nor answered" (OD-54 item b); AUT-005: 14 days per stage; unviewed threshold: 3 business days after send. All are Admin settings in `automation_setting` (A6) |
| Impact if decided differently | automation, reporting |
| Owner | Sales Leadership |
| BRD refs | BR-AUT-004, BR-AUT-005, BR-RPT-005 |
| Needed by | R1 |
| Status | Proposed |

#### OD-75 — Invitation validity

| Field | Content |
|---|---|
| Question | How long is an invitation link valid? |
| Why it matters | Security vs convenience |
| Options | 1. 7 days, resendable. 2. 72 hours. 3. 30 days |
| Working assumption | Option 1 (constant `invitation.validityDays = 7`) |
| Impact if decided differently | identity |
| Owner | IT |
| BRD refs | BR-PLT-002 |
| Needed by | R1 |
| Status | Proposed |

#### OD-76 — Session and lockout parameters

| Field | Content |
|---|---|
| Question | Session idle and absolute lifetimes; failed-sign-in lockout thresholds |
| Why it matters | NFR-001 security baseline |
| Options | Confirm or change |
| Working assumption | Idle 12 h, absolute 30 days (Admin sessions: OD-83); sign-in throttling per RULE-PLT-08 (authoritative, foundation §16 S4): after 5 consecutive failures per account, exponential delay up to 15 min, plus per-IP limit; values as settings |
| Impact if decided differently | identity |
| Owner | IT / Security |
| BRD refs | BR-PLT-003, NFR-001 |
| Needed by | R1 |
| Status | Proposed |

#### OD-77 — TOTP with Google/Microsoft sign-in

| Field | Content |
|---|---|
| Question | When MFA is required (OD-13), do OAuth sign-ins also require the CRM's TOTP? |
| Why it matters | Double MFA adds friction; skipping it relies on the IdP's MFA |
| Options | 1. Not required for OAuth sign-ins (IdP MFA relied upon); Admin can require it. 2. Always required |
| Working assumption | Option 1 (setting `mfaPolicy.applyToOAuth = false`) |
| Impact if decided differently | identity |
| Owner | IT / Security |
| BRD refs | BR-PLT-003, BR-PLT-004, OD-13 |
| Needed by | R1 |
| Status | Proposed |

#### OD-78 — Changing the default currency

| Field | Content |
|---|---|
| Question | May Admin change the organization default currency after deals exist? |
| Why it matters | The reporting conversion base and catalog prices depend on it |
| Options | 1. Blocked once deals exist. 2. Allowed with a re-conversion job |
| Working assumption | Option 1 |
| Impact if decided differently | platform settings, catalog, reporting |
| Owner | Finance |
| BRD refs | BR-PRC-005, OD-15 |
| Needed by | R1 |
| Status | Proposed |

#### OD-79 — NFR percentile and measurement window

| Field | Content |
|---|---|
| Question | How are NFR-005 response targets measured (percentile, window, endpoints)? |
| Why it matters | OD-45 keeps the targets but not how they are measured |
| Options | 1. p95 per endpoint group over a rolling 7 days, excluding file generation and exports. 2. p90 monthly |
| Working assumption | Option 1 |
| Impact if decided differently | observability (A14) |
| Owner | Tech Lead |
| BRD refs | NFR-005, OD-45 |
| Needed by | R1 |
| Status | Proposed |

#### OD-80 — Definition of an "active weekly" user

| Field | Content |
|---|---|
| Question | What counts as an active user for adoption metrics? |
| Why it matters | The PRD §2 adoption metric needs a definition; OD-35 covers sales metrics only |
| Options | 1. At least one user-initiated action in the ISO week (ACCEPTANCE-CRITERIA AC-16 proposed measure). 2. Signed in at least once |
| Working assumption | Option 1 |
| Impact if decided differently | reporting (adoption), PRD §2 |
| Owner | Product + Sales Leadership |
| BRD refs | §12 Adoption, AC-15..AC-18 |
| Needed by | R1 |
| Status | Proposed |

#### OD-81 — Confirmation of BUSINESS-RULES and WORKFLOWS working assumptions

| Field | Content |
|---|---|
| Question | Confirm the specification-wave WAs that have no OD of their own |
| Why it matters | They drive state machines and automation |
| Options | Per item: confirm / change |
| Working assumption | a. Proposal status follows the last **sent** version and returns to Draft only after Declined/Expired (OD-20, OD-54 item d). b. Signed is final: changes after signing need a new proposal (BR-SIG-011, RULE-PRP-18). c. Expired links show a notice without content (OD-22, WORKFLOWS WA-4). d. AUT-002 does nothing if the deal is already won/lost and flags it for the owner (RULE-AUT-21). e. Locked sections are read-only for everyone inside a proposal, Admin included (§12 R8). f. Accepted proposals do not expire (WA-5). g. An archived contact matched by a lead form is linked, not restored (WA-7). h. Emails deleted at the provider are retained (WA-9). i. A new-version send voids the provider request synchronously and aborts on failure (WA-2). j. Completion is applied only after documents are stored (WA-3). k. Won/lost metrics are attributed to the owner at close time (RULE-RPT-08; metric definitions OD-35) |
| Impact if decided differently | BUSINESS-RULES, WORKFLOWS, FUNCTIONAL-REQUIREMENTS |
| Owner | Product + Sales Leadership |
| BRD refs | BR-PRP-007, BR-SIG-011, BR-SHR-007, BR-AUT-002, BR-TPL-003 |
| Needed by | R1 |
| Status | Proposed |

### 5.2 Security, AI and deployment decisions (OD-82..OD-104)

From foundation §15/§16 (S7) and the HLD wave. Deduplicated: TOTP on OAuth sign-ins = OD-77; general session/lockout = OD-76 (lockout parameters per RULE-PLT-08); identity gate for recipients (S3) = OD-69; AI budget defaults = OD-53; monitoring/log retention, IP retention and `ai_generation` retention are combined in OD-84; data residency (S7) and deployment region are one decision (OD-89).

#### OD-82 — Break-glass Admin account

| Field | Content |
|---|---|
| Question | Is there an emergency Admin account usable when the identity provider or all Admins are unavailable, and how is it controlled? |
| Why it matters | OAuth-only sign-in (OD-12) plus invite-only users (IDD-02) can lock everyone out; an uncontrolled emergency account is a high-value target |
| Options | 1. One sealed break-glass account (password + TOTP, credentials in the secrets vault), use alerts Security and is audited; reviewed quarterly. 2. None; recovery via the bootstrap command (IDD-02) by IT. 3. Two named emergency Admins |
| Working assumption | Option 1; constant `security.breakGlass.enabled = true`; any sign-in raises an alert |
| Impact if decided differently | identity, operations runbook, SECURITY-ARCHITECTURE |
| Owner | Security / IT |
| BRD refs | BR-PLT-003, BR-PLT-005, NFR-001, IDD-02 |
| Needed by | R1 |
| Status | Proposed |

#### OD-83 — Admin session lifetime and step-up authentication

| Field | Content |
|---|---|
| Question | Do Admin sessions have shorter lifetimes than other roles, and which actions require re-authentication (step-up)? |
| Why it matters | Admins can export all data, change roles and settings; OD-76 sets general session values only |
| Options | 1. Admin idle 30 min / absolute 12 h; step-up (password or TOTP within 10 min) for full export, role changes, MFA policy, login methods, erasure, retention changes. 2. Same as other users, no step-up |
| Working assumption | Option 1, settings `session.admin.idleMinutes = 30`, `session.admin.absoluteHours = 12`, `stepUp.maxAgeMinutes = 10` |
| Impact if decided differently | identity, PERM-001..PERM-018, ADR-027 |
| Owner | Security / IT |
| BRD refs | BR-PLT-005, BR-PLT-010, NFR-001, OD-76 |
| Needed by | R1 |
| Status | Proposed |

#### OD-84 — Retention periods for IP addresses, monitoring logs and AI generations

| Field | Content |
|---|---|
| Question | How long are buyer/user IP addresses, monitoring and application logs, and `ai_generation` output texts kept? (Sub-categories of the OD-36 schedule.) |
| Why it matters | IP addresses and AI outputs are personal data; logs are needed for security investigations. OD-36 defines the schedule mechanism, not these values |
| Options | 1. IP addresses: full for 90 days, then truncated (/24 IPv4, /48 IPv6) except in signing evidence; logs 90 days hot, 1 year archive; ai_generation text 180 days after accept/reject (metadata kept). 2. Shorter (30 days everywhere). 3. Same as the record they belong to |
| Working assumption | Option 1, as OD-36 retention-category settings (`retention.ipAddressDays = 90`, `retention.logDays = 90/365`, `retention.aiGenerationDays = 180`); signing evidence keeps IPs (BR-SIG-009) |
| Impact if decided differently | platform retention jobs, observability, ai module, privacy notice |
| Owner | Legal / DPO + Security |
| BRD refs | NFR-002, NFR-009, NFR-015, BR-SIG-009, OD-36 |
| Needed by | R1 |
| Status | Proposed |

#### OD-85 — Malware scanning of uploads

| Field | Content |
|---|---|
| Question | Are uploaded files (images, DOCX templates, import files, attachments) scanned for malware, and with which service? |
| Why it matters | Uploaded files are rendered, converted or downloaded by others; A10 validates type and size but does not scan |
| Options | 1. Scan every upload asynchronously (ClamAV container or cloud-native scanner); file unusable until clean; infected → quarantined, uploader and Admin notified. 2. Scan DOCX and import files only. 3. No scanning (validation only) |
| Working assumption | Option 1, scanner behind an adapter; `uploads.scan.required = true` |
| Impact if decided differently | storage, import, templates, renderer; external service list |
| Owner | Security |
| BRD refs | BR-MIG-001, BR-MIG-006, BR-TPL-001, NFR-001 |
| Needed by | R1 |
| Status | Proposed |

#### OD-86 — Penetration test before go-live

| Field | Content |
|---|---|
| Question | Is an independent penetration test required before internal go-live, and what is in scope? |
| Why it matters | The buyer origin and lead forms are internet-facing; the system holds customer and signing data |
| Options | 1. External test of buyer origin, lead forms, auth and API before go-live (end of R2); high findings fixed before go-live. 2. Internal security review only. 3. After go-live |
| Working assumption | Option 1 |
| Impact if decided differently | release plan (PRD §7.5 R2 gate), security budget |
| Owner | Security + Leadership |
| BRD refs | NFR-001, NFR-004, OD-48 |
| Needed by | R2 |
| Status | Proposed |

#### OD-87 — Default buyer email verification (OTP)

| Field | Content |
|---|---|
| Question | Is email verification (BR-SHR-006) on or off by default for new proposals? |
| Why it matters | With the S3 identity gate, OTP is the only proof that a viewer controls the email; it adds friction for every buyer |
| Options | 1. Off by default, salesperson can enable per proposal; Admin can force it org-wide. 2. On by default. 3. On for proposals above an amount |
| Working assumption | Option 1 (`shareDefaults.requireEmailVerificationDefault = false`, Admin `shareDefaults.forceEmailVerification`) |
| Impact if decided differently | sharing, buyer view, OrganizationSettings |
| Owner | Product + Legal |
| BRD refs | BR-SHR-005, BR-SHR-006, OD-69 |
| Needed by | R1 |
| Status | Proposed |

#### OD-88 — Legal hold

| Field | Content |
|---|---|
| Question | How are records placed under legal hold so retention jobs and erasure do not delete them? |
| Why it matters | OD-36 exempts signed documents and audit logs but has no case-based hold |
| Options | 1. Admin/Legal can set a legal-hold flag on a company, contact or deal (and its children); retention and erasure skip held records; holds are audited. 2. Handled outside the CRM via exports |
| Working assumption | Option 1 |
| Impact if decided differently | platform retention, erasure handlers (A12), DOMAIN-MODEL |
| Owner | Legal |
| BRD refs | NFR-015, OD-36 |
| Needed by | R2 |
| Status | Proposed |

#### OD-89 — Hosting region and data residency

| Field | Content |
|---|---|
| Question | In which cloud region are the database, object storage and backups hosted, and must data stay in a given jurisdiction (including e-sign provider and email service data)? |
| Why it matters | Residency affects the provider choices (OD-03, OD-05, OD-14) and the DPIA |
| Options | 1. Single region in the company's home jurisdiction; backups in a second region of the same jurisdiction; providers chosen with matching residency. 2. Any region |
| Working assumption | Option 1; region to be named by IT |
| Impact if decided differently | deployment, provider selection, DPIA |
| Owner | IT + Legal |
| BRD refs | NFR-002, NFR-008, OD-01, OD-11 |
| Needed by | R1 |
| Status | Proposed |

#### OD-90 — AI features eligible for zero data retention

| Field | Content |
|---|---|
| Question | Which AI features run under the provider's zero-data-retention (ZDR) terms, and are features that cannot use ZDR disabled? |
| Why it matters | OD-05 asks to confirm ZDR; not all provider capabilities may be ZDR-eligible, and deal data includes customer personal data |
| Options | 1. All Phase 1 AI features (drafting, pre-send LLM check, summary, rewrite, follow-up) must run ZDR; any feature not eligible stays disabled. 2. ZDR preferred, not required |
| Working assumption | Option 1 |
| Impact if decided differently | ai module (ADR-041 model routing), provider contract |
| Owner | Tech Lead + Legal |
| BRD refs | BR-AIA-008, NFR-003, IDD-07, OD-05 |
| Needed by | R2 |
| Status | Proposed |

#### OD-91 — AI inference region

| Field | Content |
|---|---|
| Question | In which region is AI inference performed? |
| Why it matters | Prompts contain customer data; residency (OD-89) may require in-region inference |
| Options | 1. Provider endpoint in the same jurisdiction as OD-89 (via a cloud-provider-hosted model endpoint if needed). 2. Provider default region |
| Working assumption | Option 1 if OD-89 requires residency; otherwise option 2 |
| Impact if decided differently | ai adapter configuration |
| Owner | Tech Lead + Legal |
| BRD refs | NFR-003, OD-05, OD-89 |
| Needed by | R2 |
| Status | Proposed |

#### OD-92 — Custom fields excluded from AI context

| Field | Content |
|---|---|
| Question | May Admins mark custom fields as excluded from AI context, and which are excluded by default? |
| Why it matters | Custom fields may hold sensitive data that should not be sent to the AI provider |
| Options | 1. Per-field flag `aiExcluded` (default false); excluded fields never enter prompts. 2. No exclusion |
| Working assumption | Option 1 |
| Impact if decided differently | crm (CustomFieldDefinition), ai context builder |
| Owner | Product + Legal |
| BRD refs | BR-CRM-007, BR-AIA-001, BR-AIA-003, NFR-003 |
| Needed by | R2 |
| Status | Proposed |

#### OD-93 — When AUT-004 follow-up drafts are generated

| Field | Content |
|---|---|
| Question | Is the BR-AIA-005 follow-up email draft generated automatically when the AUT-004 task is created, or only when the user opens the task and asks? |
| Why it matters | Automatic drafts cost tokens for tasks never acted on and create AI content without a request |
| Options | 1. On demand only (button on the task). 2. Automatically at task creation |
| Working assumption | Option 1 |
| Impact if decided differently | automation, ai budget (OD-53) |
| Owner | Product |
| BRD refs | BR-AUT-004, BR-AIA-005, OD-53 |
| Needed by | R3 |
| Status | Proposed |

#### OD-94 — AI output language

| Field | Content |
|---|---|
| Question | In which language does AI write: organization locale, user locale, or the language of the deal's emails/template? |
| Why it matters | Proposals may go to buyers in different languages |
| Options | 1. Language of the template/proposal section (default org locale), user can override per request. 2. Always org locale |
| Working assumption | Option 1 |
| Impact if decided differently | ai prompts |
| Owner | Product |
| BRD refs | BR-AIA-001, BR-AIA-004, BR-AIA-005 |
| Needed by | R2 |
| Status | Proposed |

#### OD-95 — AI evaluation data source

| Field | Content |
|---|---|
| Question | Which data does the AI evaluation harness (ADR-044) use: synthetic, anonymised production samples or real data? |
| Why it matters | Real customer data in test sets raises privacy issues; synthetic data may not reflect reality |
| Options | 1. Synthetic and hand-written cases only; anonymised samples only with DPO approval. 2. Production samples |
| Working assumption | Option 1 |
| Impact if decided differently | ai eval harness, privacy |
| Owner | Tech Lead + Legal |
| BRD refs | NFR-003, IDD-07 |
| Needed by | R2 |
| Status | Proposed |

#### OD-96 — Database high availability tier

| Field | Content |
|---|---|
| Question | Which managed PostgreSQL HA option is used (zone-redundant standby, failover time), and is the cost accepted? |
| Why it matters | ADR-049 decides managed HA + 35-day PITR; the tier and cost need IT approval; NFR-006 99.5% availability |
| Options | 1. Zone-redundant HA with automatic failover, 35-day PITR. 2. Single instance + PITR only |
| Working assumption | Option 1 (ADR-049), PostgreSQL 18 (foundation §15) |
| Impact if decided differently | deployment, cost |
| Owner | IT / Tech Lead |
| BRD refs | NFR-006, NFR-008, OD-11, OD-45 |
| Needed by | R1 |
| Status | Proposed |

#### OD-97 — Egress firewall

| Field | Content |
|---|---|
| Question | Is outbound traffic restricted by a network egress firewall with an allow-list (ADR-048 second layer)? |
| Why it matters | Limits data exfiltration and SSRF impact; needs network team support |
| Options | 1. Network egress allow-list per role (server, worker, renderer) plus application-level allow-list. 2. Application-level allow-list only |
| Working assumption | Option 1 (ADR-048) |
| Impact if decided differently | deployment, operations |
| Owner | IT / Security |
| BRD refs | NFR-001 |
| Needed by | R1 |
| Status | Proposed |

#### OD-98 — Error-tracking vendor

| Field | Content |
|---|---|
| Question | Which error-tracking/observability service is used (ADR-051), and is sending stack traces to a SaaS acceptable? |
| Why it matters | Error events can contain personal data; vendor needs a DPA |
| Options | 1. Self-hosted or company-approved SaaS with scrubbing of personal data and no request bodies. 2. Cloud-provider native tooling only |
| Working assumption | Option 1, vendor to be named; PII scrubbing mandatory |
| Impact if decided differently | observability, external service list |
| Owner | Tech Lead |
| BRD refs | NFR-002, NFR-009 |
| Needed by | R1 |
| Status | Proposed |

#### OD-99 — On-call and support model

| Field | Content |
|---|---|
| Question | Who responds to alerts and outages, in which hours? |
| Why it matters | NFR-006 99.5% and RTO 8 h (NFR-008) need named responders |
| Options | 1. Business-hours on-call by the delivery team, best-effort out of hours. 2. 24×7 rotation. 3. IT operations team |
| Working assumption | Option 1 |
| Impact if decided differently | operations runbooks, alert routing |
| Owner | Leadership + IT |
| BRD refs | NFR-006, NFR-008 |
| Needed by | R1 |
| Status | Proposed |

#### OD-100 — CI/CD platform

| Field | Content |
|---|---|
| Question | Which CI/CD platform builds, tests and promotes images (ADR-046, ADR-052)? |
| Why it matters | Pipeline secrets and registry access depend on it |
| Options | 1. The company's existing platform (e.g. GitHub Actions or Azure DevOps). 2. Cloud-provider native |
| Working assumption | Option 1, platform to be named by IT |
| Impact if decided differently | delivery pipeline |
| Owner | Tech Lead |
| BRD refs | NFR-001 |
| Needed by | R1 |
| Status | Proposed |

#### OD-101 — Maintenance window

| Field | Content |
|---|---|
| Question | When may planned maintenance with possible downtime happen, and how are users told? |
| Why it matters | Buyer links and lead forms are used outside office hours |
| Options | 1. Weekly window outside business hours in the org time zone, announced 48 h ahead in-app; zero-downtime deploys preferred (ADR-052). 2. No fixed window |
| Working assumption | Option 1 |
| Impact if decided differently | operations, notifications |
| Owner | IT + Sales Leadership |
| BRD refs | NFR-006 |
| Needed by | R1 |
| Status | Proposed |

#### OD-102 — Object Lock mode for signed artifacts

| Field | Content |
|---|---|
| Question | Are signed PDFs and completion certificates stored with Object Lock in governance mode (admin-overridable) or compliance mode (no one can delete until expiry), and for how long? |
| Why it matters | Compliance mode prevents erasure or correction, even by us; governance mode allows privileged deletion (ADR-036) |
| Options | 1. Governance mode, retention = signed-document retention (OD-36). 2. Compliance mode |
| Working assumption | Option 1 |
| Impact if decided differently | storage, esign, retention |
| Owner | Legal + IT |
| BRD refs | BR-SIG-010, NFR-004, OD-36 |
| Needed by | R2 |
| Status | Proposed |

#### OD-103 — Long-term backups and erasure

| Field | Content |
|---|---|
| Question | How are erasure requests honoured for data inside backups and PITR history? |
| Why it matters | Backups cannot be edited; personal data may reappear after a restore |
| Options | 1. Backups expire on their schedule (35-day PITR, no long-term backups beyond it); erased ids are re-applied after any restore (erasure log). 2. Long-term (yearly) backups kept, erasure re-applied on restore |
| Working assumption | Option 1 |
| Impact if decided differently | operations (restore runbook), platform erasure |
| Owner | Legal / DPO |
| BRD refs | NFR-008, NFR-015, OD-36 |
| Needed by | R1 |
| Status | Proposed |

#### OD-104 — Staging and test data policy

| Field | Content |
|---|---|
| Question | May production data be copied to staging or test environments? |
| Why it matters | Copies multiply the exposure of customer and signing data |
| Options | 1. Never; staging uses synthetic seed data; production-like data only after anonymisation approved by the DPO. 2. Masked copies allowed |
| Working assumption | Option 1 |
| Impact if decided differently | environments, test data tooling |
| Owner | Security + Legal |
| BRD refs | NFR-002 |
| Needed by | R1 |
| Status | Proposed |

## Decisions added during HLD/TLD (architect, data-flow and integration review)

| OD | Question | Working assumption used by the design | Owner | Needed by | Status |
|---|---|---|---|---|---|
| OD-105 | How long may a prepared proposal send (ADR-081) wait to be committed? | 30 minutes; then the attempt expires and the draft unlocks | Product | R1 | Proposed |
| OD-106 | Mailbox deletions and which folders sync | Sync Inbox, Sent and their sub-folders; exclude Spam/Junk, Trash, Drafts; a message deleted in the mailbox stays in the CRM (business record) unless the user removes it or retention applies | Product + Legal | R2 | Proposed |
| OD-107 | Erasure scope for synced emails and AI output | Erasure of a contact removes stored email bodies/subjects where the contact is the only external participant, anonymises participant entries otherwise, and deletes `ai_generation` outputs that reference the contact | Legal/DPO | R2 | Proposed |
| OD-108 | The same email is private in one user's mailbox but not in another's | Privacy is per mailbox copy; the non-private copy is visible per normal rules; timelines de-duplicate by Internet Message-ID showing the most visible copy | Product + Legal | R2 | Proposed |
| OD-109 | Bounce handling for CRM-sent emails and system notifications | Detect provider bounces/NDRs during sync and mark the outbound email `failed`; transactional-email bounces suppress further emails to that address and notify the Admin | Product | R2 | Proposed |
| OD-110 | Gmail add-on message scope | `gmail.addons.current.message.readonly` + `gmail.addons.current.action.compose`; no broad scopes in the add-on | IT + Security | R3 | Proposed |
| OD-111 | Embedded signing in the buyer view vs provider-delivered signing emails | Provider-delivered signing emails (email possession = BR-SIG-004 verification); embedded signing not in Phase 1 | Product + Legal | R2 | Proposed |
| OD-112 | AI provider credential type | API key held in the secrets manager, rotated quarterly; workload identity if the provider/cloud supports it | Tech Lead | R2 | Proposed |
