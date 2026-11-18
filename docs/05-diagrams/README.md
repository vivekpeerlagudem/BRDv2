# Diagram Index

All Mermaid diagrams embedded in the documentation, extracted as standalone `.mmd` files (render with any Mermaid-compatible viewer, e.g. VS Code Markdown preview, GitHub, or `mmdc` from @mermaid-js/mermaid-cli). The embedded copies in the source documents are authoritative; re-run the extraction script after edits.

## Key diagrams

| Diagram | File |
|---|---|
| System context (C4 L1) | `02-SYSTEM-ARCHITECTURE-01-flowchart.mmd` |
| Containers (C4 L2) | `02-SYSTEM-ARCHITECTURE-02-flowchart.mmd` |
| Server component diagram | `02-COMPONENT-ARCHITECTURE-02-flowchart.mmd` |
| Module dependency graph | `02-MODULE-ARCHITECTURE-01-flowchart.mmd` |
| End-to-end send → view → sign → Closed Won | `02-SYSTEM-ARCHITECTURE-04-sequenceDiagram.mmd` |
| Deployment topology | `02-DEPLOYMENT-ARCHITECTURE-02-flowchart.mmd` |
| CI/CD pipeline | `02-DEPLOYMENT-ARCHITECTURE-05-flowchart.mmd` |
| Trust boundaries | `02-SECURITY-ARCHITECTURE-01-flowchart.mmd` |
| AI component diagram | `02-AI-ARCHITECTURE-01-flowchart.mmd` |
| ER overview | `03-DATABASE-ERD-01-erDiagram.mmd` |
| Proposal two-phase send | `03-PROPOSAL-ENGINE-DESIGN-01-sequenceDiagram.mmd` |
| E-sign webhook processing | `03-E-SIGNATURE-DESIGN-02-sequenceDiagram.mmd` |
| Buyer first open → notification | `03-DOCUMENT-SHARING-DESIGN-01-sequenceDiagram.mmd` |
| Notification/automation pipeline | `03-NOTIFICATION-AUTOMATION-DESIGN-01-flowchart.mmd` |
| Audit integrity chain | `03-AUDIT-LOGGING-DESIGN-01-flowchart.mmd` |
| Deal state machine (SM-01) | `01-BUSINESS-RULES-01-stateDiagram-v2.mmd` |
| Proposal state machine (SM-02) | `01-BUSINESS-RULES-02-stateDiagram-v2.mmd` |

## All diagrams (104)

| Folder | Document | Section | Type | File |
|---|---|---|---|---|
| 01-specifications | BUSINESS-RULES | 17.1 SM-01 Deal | stateDiagram-v2 | `01-BUSINESS-RULES-01-stateDiagram-v2.mmd` |
| 01-specifications | BUSINESS-RULES | 17.2 SM-02 Proposal (status — BR-PRP-007 + OD-17 "Accepted") | stateDiagram-v2 | `01-BUSINESS-RULES-02-stateDiagram-v2.mmd` |
| 01-specifications | BUSINESS-RULES | 17.3 SM-03 ProposalVersion (OD-20) | stateDiagram-v2 | `01-BUSINESS-RULES-03-stateDiagram-v2.mmd` |
| 01-specifications | BUSINESS-RULES | 17.4 SM-04 SignatureRequest (BR-SIG-007) | stateDiagram-v2 | `01-BUSINESS-RULES-04-stateDiagram-v2.mmd` |
| 01-specifications | BUSINESS-RULES | 17.5 SM-05 Signer | stateDiagram-v2 | `01-BUSINESS-RULES-05-stateDiagram-v2.mmd` |
| 01-specifications | BUSINESS-RULES | 17.6 SM-06 ShareLink | stateDiagram-v2 | `01-BUSINESS-RULES-06-stateDiagram-v2.mmd` |
| 01-specifications | BUSINESS-RULES | 17.7 SM-07 Task | stateDiagram-v2 | `01-BUSINESS-RULES-07-stateDiagram-v2.mmd` |
| 01-specifications | BUSINESS-RULES | 17.8 SM-08 Import batch | stateDiagram-v2 | `01-BUSINESS-RULES-08-stateDiagram-v2.mmd` |
| 01-specifications | BUSINESS-RULES | 17.9 SM-09 Lead form submission | stateDiagram-v2 | `01-BUSINESS-RULES-09-stateDiagram-v2.mmd` |
| 01-specifications | BUSINESS-RULES | 17.10 SM-10 Mailbox connection | stateDiagram-v2 | `01-BUSINESS-RULES-10-stateDiagram-v2.mmd` |
| 01-specifications | DOMAIN-MODEL | 3. Overview class diagram | classDiagram | `01-DOMAIN-MODEL-01-classDiagram.mmd` |
| 01-specifications | DOMAIN-MODEL | 20.1 Identity and CRM core | classDiagram | `01-DOMAIN-MODEL-02-classDiagram.mmd` |
| 01-specifications | DOMAIN-MODEL | 20.2 Proposals, templates, catalog | classDiagram | `01-DOMAIN-MODEL-03-classDiagram.mmd` |
| 01-specifications | DOMAIN-MODEL | 20.3 Sharing and e-signature | classDiagram | `01-DOMAIN-MODEL-04-classDiagram.mmd` |
| 01-specifications | DOMAIN-MODEL | 20.4 Communications, leads, import | classDiagram | `01-DOMAIN-MODEL-05-classDiagram.mmd` |
| 01-specifications | DOMAIN-MODEL | 20.5 Automation, AI, notifications, timeline, platform | classDiagram | `01-DOMAIN-MODEL-06-classDiagram.mmd` |
| 01-specifications | PRD | 5. End-to-end process (BRD §11, 15 steps) | flowchart | `01-PRD-01-flowchart.mmd` |
| 01-specifications | WORKFLOWS | WF-01 Organization bootstrap and admin setup | flowchart | `01-WORKFLOWS-01-flowchart.mmd` |
| 01-specifications | WORKFLOWS | WF-04 User deactivation with reassignment | flowchart | `01-WORKFLOWS-02-flowchart.mmd` |
| 01-specifications | WORKFLOWS | WF-05 Data import from CSV/Excel | flowchart | `01-WORKFLOWS-03-flowchart.mmd` |
| 01-specifications | WORKFLOWS | WF-09 Lead capture via web form → assignment → notification | sequenceDiagram | `01-WORKFLOWS-04-sequenceDiagram.mmd` |
| 01-specifications | WORKFLOWS | WF-13 Incremental email and calendar sync with linking | sequenceDiagram | `01-WORKFLOWS-05-sequenceDiagram.mmd` |
| 01-specifications | WORKFLOWS | WF-22 Send proposal from the CRM (and end-to-end overview) | sequenceDiagram | `01-WORKFLOWS-06-sequenceDiagram.mmd` |
| 01-specifications | WORKFLOWS | WF-24 Buyer view: identity gate, verification, forward, download | sequenceDiagram | `01-WORKFLOWS-07-sequenceDiagram.mmd` |
| 01-specifications | WORKFLOWS | WF-28 Negotiation: new version, comparison, re-send | flowchart | `01-WORKFLOWS-08-flowchart.mmd` |
| 01-specifications | WORKFLOWS | WF-29 Signature request with order and reminders | sequenceDiagram | `01-WORKFLOWS-09-sequenceDiagram.mmd` |
| 01-specifications | WORKFLOWS | WF-32 Signature completion → documents → Closed Won | sequenceDiagram | `01-WORKFLOWS-10-sequenceDiagram.mmd` |
| 01-specifications | WORKFLOWS | WF-34 Expiry: proposal validity, link expiry, signature request expiry | flowchart | `01-WORKFLOWS-11-flowchart.mmd` |
| 02-hld | AI-ARCHITECTURE | 3.1 Component diagram | flowchart | `02-AI-ARCHITECTURE-01-flowchart.mmd` |
| 02-hld | AI-ARCHITECTURE | 4.1 Pipeline | flowchart | `02-AI-ARCHITECTURE-02-flowchart.mmd` |
| 02-hld | AI-ARCHITECTURE | 7.1 States | stateDiagram-v2 | `02-AI-ARCHITECTURE-03-stateDiagram-v2.mmd` |
| 02-hld | AI-ARCHITECTURE | 10.1 Draft generation (`draft_section`, streamed) | sequenceDiagram | `02-AI-ARCHITECTURE-04-sequenceDiagram.mmd` |
| 02-hld | AI-ARCHITECTURE | 10.2 Pre-send check | sequenceDiagram | `02-AI-ARCHITECTURE-05-sequenceDiagram.mmd` |
| 02-hld | COMPONENT-ARCHITECTURE | 1. Repository and package map (ADR-018, ADR-021) | flowchart | `02-COMPONENT-ARCHITECTURE-01-flowchart.mmd` |
| 02-hld | COMPONENT-ARCHITECTURE | 2.1 Component diagram | flowchart | `02-COMPONENT-ARCHITECTURE-02-flowchart.mmd` |
| 02-hld | COMPONENT-ARCHITECTURE | 3. Request lifecycle (internal API write) | sequenceDiagram | `02-COMPONENT-ARCHITECTURE-03-sequenceDiagram.mmd` |
| 02-hld | COMPONENT-ARCHITECTURE | 3.1 Buyer request lifecycle (token exchange, view counting) | sequenceDiagram | `02-COMPONENT-ARCHITECTURE-04-sequenceDiagram.mmd` |
| 02-hld | COMPONENT-ARCHITECTURE | 4.1 Component diagram | flowchart | `02-COMPONENT-ARCHITECTURE-05-flowchart.mmd` |
| 02-hld | COMPONENT-ARCHITECTURE | 4.4 Job lifecycle | sequenceDiagram | `02-COMPONENT-ARCHITECTURE-06-sequenceDiagram.mmd` |
| 02-hld | COMPONENT-ARCHITECTURE | 5.1 Component diagram | flowchart | `02-COMPONENT-ARCHITECTURE-07-flowchart.mmd` |
| 02-hld | COMPONENT-ARCHITECTURE | 7. Webhook processing (e-sign) — component interaction | sequenceDiagram | `02-COMPONENT-ARCHITECTURE-08-sequenceDiagram.mmd` |
| 02-hld | DATA-FLOW-ARCHITECTURE | 2. Runtime topology for data flows | flowchart | `02-DATA-FLOW-ARCHITECTURE-01-flowchart.mmd` |
| 02-hld | DATA-FLOW-ARCHITECTURE | 3. Common write pattern (unit of work) | flowchart | `02-DATA-FLOW-ARCHITECTURE-02-flowchart.mmd` |
| 02-hld | DATA-FLOW-ARCHITECTURE | F-01 Lead form → contact/company/deal → assignment → notification | flowchart | `02-DATA-FLOW-ARCHITECTURE-03-flowchart.mmd` |
| 02-hld | DATA-FLOW-ARCHITECTURE | F-02 CSV/Excel import pipeline | flowchart | `02-DATA-FLOW-ARCHITECTURE-04-flowchart.mmd` |
| 02-hld | DATA-FLOW-ARCHITECTURE | F-03 Mailbox sync | flowchart | `02-DATA-FLOW-ARCHITECTURE-05-flowchart.mmd` |
| 02-hld | DATA-FLOW-ARCHITECTURE | F-05 Send email from CRM | flowchart | `02-DATA-FLOW-ARCHITECTURE-06-flowchart.mmd` |
| 02-hld | DATA-FLOW-ARCHITECTURE | F-06 Proposal generation and send | flowchart | `02-DATA-FLOW-ARCHITECTURE-07-flowchart.mmd` |
| 02-hld | DATA-FLOW-ARCHITECTURE | F-07 Share and tracking | flowchart | `02-DATA-FLOW-ARCHITECTURE-08-flowchart.mmd` |
| 02-hld | DATA-FLOW-ARCHITECTURE | F-08 E-signature | flowchart | `02-DATA-FLOW-ARCHITECTURE-09-flowchart.mmd` |
| 02-hld | DATA-FLOW-ARCHITECTURE | F-09 Automation and scheduled scans | flowchart | `02-DATA-FLOW-ARCHITECTURE-10-flowchart.mmd` |
| 02-hld | DATA-FLOW-ARCHITECTURE | F-10 Notifications and digest | flowchart | `02-DATA-FLOW-ARCHITECTURE-11-flowchart.mmd` |
| 02-hld | DATA-FLOW-ARCHITECTURE | F-13 Full export | flowchart | `02-DATA-FLOW-ARCHITECTURE-12-flowchart.mmd` |
| 02-hld | DATA-FLOW-ARCHITECTURE | F-14 Erasure and retention | flowchart | `02-DATA-FLOW-ARCHITECTURE-13-flowchart.mmd` |
| 02-hld | DEPLOYMENT-ARCHITECTURE | 3.2 Local development on Windows (Docker Compose) | flowchart | `02-DEPLOYMENT-ARCHITECTURE-01-flowchart.mmd` |
| 02-hld | DEPLOYMENT-ARCHITECTURE | 4. Production runtime topology (cloud-neutral) | flowchart | `02-DEPLOYMENT-ARCHITECTURE-02-flowchart.mmd` |
| 02-hld | DEPLOYMENT-ARCHITECTURE | 5.1 Azure reference | flowchart | `02-DEPLOYMENT-ARCHITECTURE-03-flowchart.mmd` |
| 02-hld | DEPLOYMENT-ARCHITECTURE | 5.2 AWS reference | flowchart | `02-DEPLOYMENT-ARCHITECTURE-04-flowchart.mmd` |
| 02-hld | DEPLOYMENT-ARCHITECTURE | 7.1 Flow | flowchart | `02-DEPLOYMENT-ARCHITECTURE-05-flowchart.mmd` |
| 02-hld | DEPLOYMENT-ARCHITECTURE | 10.1 Mechanics | sequenceDiagram | `02-DEPLOYMENT-ARCHITECTURE-06-sequenceDiagram.mmd` |
| 02-hld | INTEGRATION-ARCHITECTURE | 2. Integration context | flowchart | `02-INTEGRATION-ARCHITECTURE-01-flowchart.mmd` |
| 02-hld | INTEGRATION-ARCHITECTURE | 10.1 Mailbox OAuth connect | sequenceDiagram | `02-INTEGRATION-ARCHITECTURE-02-sequenceDiagram.mmd` |
| 02-hld | INTEGRATION-ARCHITECTURE | 10.2 Gmail / Graph delta sync including history expiry resync | sequenceDiagram | `02-INTEGRATION-ARCHITECTURE-03-sequenceDiagram.mmd` |
| 02-hld | INTEGRATION-ARCHITECTURE | 10.3 Send from CRM | sequenceDiagram | `02-INTEGRATION-ARCHITECTURE-04-sequenceDiagram.mmd` |
| 02-hld | INTEGRATION-ARCHITECTURE | 10.4 Outlook add-in sign-in and record lookup | sequenceDiagram | `02-INTEGRATION-ARCHITECTURE-05-sequenceDiagram.mmd` |
| 02-hld | INTEGRATION-ARCHITECTURE | 10.5 Gmail add-on card request | sequenceDiagram | `02-INTEGRATION-ARCHITECTURE-06-sequenceDiagram.mmd` |
| 02-hld | INTEGRATION-ARCHITECTURE | 10.6 Signature request create → signer events → completion webhook → reconciliation | sequenceDiagram | `02-INTEGRATION-ARCHITECTURE-07-sequenceDiagram.mmd` |
| 02-hld | INTEGRATION-ARCHITECTURE | 10.7 AI draft call | sequenceDiagram | `02-INTEGRATION-ARCHITECTURE-08-sequenceDiagram.mmd` |
| 02-hld | INTEGRATION-ARCHITECTURE | 10.8 Transactional notification email | sequenceDiagram | `02-INTEGRATION-ARCHITECTURE-09-sequenceDiagram.mmd` |
| 02-hld | INTEGRATION-ARCHITECTURE | 10.9 Lead form iframe submit with CAPTCHA | sequenceDiagram | `02-INTEGRATION-ARCHITECTURE-10-sequenceDiagram.mmd` |
| 02-hld | MODULE-ARCHITECTURE | 2. Module dependency graph (allowed directions) | flowchart | `02-MODULE-ARCHITECTURE-01-flowchart.mmd` |
| 02-hld | SECURITY-ARCHITECTURE | 3.1 Trust zones and boundaries | flowchart | `02-SECURITY-ARCHITECTURE-01-flowchart.mmd` |
| 02-hld | SECURITY-ARCHITECTURE | 6.3 Password sign-in with TOTP | sequenceDiagram | `02-SECURITY-ARCHITECTURE-02-sequenceDiagram.mmd` |
| 02-hld | SECURITY-ARCHITECTURE | 6.4 Google / Microsoft sign-in (invite-only, claim verification) | sequenceDiagram | `02-SECURITY-ARCHITECTURE-03-sequenceDiagram.mmd` |
| 02-hld | SECURITY-ARCHITECTURE | 6.6 Outlook add-in (Office dialog hand-off) | sequenceDiagram | `02-SECURITY-ARCHITECTURE-04-sequenceDiagram.mmd` |
| 02-hld | SECURITY-ARCHITECTURE | 6.7 Gmail add-on request verification | sequenceDiagram | `02-SECURITY-ARCHITECTURE-05-sequenceDiagram.mmd` |
| 02-hld | SECURITY-ARCHITECTURE | 6.8 Deactivation and session revocation | sequenceDiagram | `02-SECURITY-ARCHITECTURE-06-sequenceDiagram.mmd` |
| 02-hld | SECURITY-ARCHITECTURE | 7.2 Enforcement points | flowchart | `02-SECURITY-ARCHITECTURE-07-flowchart.mmd` |
| 02-hld | SECURITY-ARCHITECTURE | 8.3 Buyer link open, scanner prefetch and view counting | sequenceDiagram | `02-SECURITY-ARCHITECTURE-08-sequenceDiagram.mmd` |
| 02-hld | SECURITY-ARCHITECTURE | 9.1 E-signature webhooks (ADR-025) | sequenceDiagram | `02-SECURITY-ARCHITECTURE-09-sequenceDiagram.mmd` |
| 02-hld | SECURITY-ARCHITECTURE | 14. AI security (BR-AIA-001..009, NFR-003, ADR-014, ADR-035) | flowchart | `02-SECURITY-ARCHITECTURE-10-flowchart.mmd` |
| 02-hld | SYSTEM-ARCHITECTURE | 3. System context (C4 level 1) | flowchart | `02-SYSTEM-ARCHITECTURE-01-flowchart.mmd` |
| 02-hld | SYSTEM-ARCHITECTURE | 4. Containers (C4 level 2) | flowchart | `02-SYSTEM-ARCHITECTURE-02-flowchart.mmd` |
| 02-hld | SYSTEM-ARCHITECTURE | 4.2 Deployment view (summary; authoritative detail in DEPLOYMENT-ARCHITECTURE.md) | flowchart | `02-SYSTEM-ARCHITECTURE-03-flowchart.mmd` |
| 02-hld | SYSTEM-ARCHITECTURE | 6.1 End-to-end flow: send → view → sign → Closed Won | sequenceDiagram | `02-SYSTEM-ARCHITECTURE-04-sequenceDiagram.mmd` |
| 03-tld | AI-IMPLEMENTATION-DESIGN | 2. Request pipeline (every feature) | flowchart | `03-AI-IMPLEMENTATION-DESIGN-01-flowchart.mmd` |
| 03-tld | AUDIT-LOGGING-DESIGN | 2. Integrity (ADR-072) | flowchart | `03-AUDIT-LOGGING-DESIGN-01-flowchart.mmd` |
| 03-tld | AUTHENTICATION-AUTHORIZATION | 3. Sign-in flows | sequenceDiagram | `03-AUTHENTICATION-AUTHORIZATION-01-sequenceDiagram.mmd` |
| 03-tld | AUTHENTICATION-AUTHORIZATION | 4. Add-in authentication (ADR-074/085) | sequenceDiagram | `03-AUTHENTICATION-AUTHORIZATION-02-sequenceDiagram.mmd` |
| 03-tld | AUTHENTICATION-AUTHORIZATION | 5. Buyer authentication (ADR-071, OD-69) | stateDiagram-v2 | `03-AUTHENTICATION-AUTHORIZATION-03-stateDiagram-v2.mmd` |
| 03-tld | DATABASE-ERD | 1. Overview (aggregate roots and principal relationships) | erDiagram | `03-DATABASE-ERD-01-erDiagram.mmd` |
| 03-tld | DATABASE-ERD | 2. Identity | erDiagram | `03-DATABASE-ERD-02-erDiagram.mmd` |
| 03-tld | DATABASE-ERD | 3. CRM core | erDiagram | `03-DATABASE-ERD-03-erDiagram.mmd` |
| 03-tld | DATABASE-ERD | 4. Catalog, templates and proposals | erDiagram | `03-DATABASE-ERD-04-erDiagram.mmd` |
| 03-tld | DATABASE-ERD | 5. Sharing and e-signature | erDiagram | `03-DATABASE-ERD-05-erDiagram.mmd` |
| 03-tld | DATABASE-ERD | 6. Communications, leads and import | erDiagram | `03-DATABASE-ERD-06-erDiagram.mmd` |
| 03-tld | DATABASE-ERD | 7. AI, notifications, automation, timeline and platform | erDiagram | `03-DATABASE-ERD-07-erDiagram.mmd` |
| 03-tld | DOCUMENT-SHARING-DESIGN | 10. Sequence — buyer first open to notification | sequenceDiagram | `03-DOCUMENT-SHARING-DESIGN-01-sequenceDiagram.mmd` |
| 03-tld | E-SIGNATURE-DESIGN | 2. Lifecycle | stateDiagram-v2 | `03-E-SIGNATURE-DESIGN-01-stateDiagram-v2.mmd` |
| 03-tld | E-SIGNATURE-DESIGN | 5. Webhooks and reconciliation (ADR-025, ADR-053) | sequenceDiagram | `03-E-SIGNATURE-DESIGN-02-sequenceDiagram.mmd` |
| 03-tld | FRONTEND-DESIGN | 3. Layout structure | flowchart | `03-FRONTEND-DESIGN-01-flowchart.mmd` |
| 03-tld | NOTIFICATION-AUTOMATION-DESIGN | 1. Event → job → effect pipeline | flowchart | `03-NOTIFICATION-AUTOMATION-DESIGN-01-flowchart.mmd` |
| 03-tld | PROPOSAL-ENGINE-DESIGN | 5.4 Send — two-phase (ADR-081) | sequenceDiagram | `03-PROPOSAL-ENGINE-DESIGN-01-sequenceDiagram.mmd` |
| 04-engineering | TECH-STACK | 1. Recommended architecture in one picture | flowchart | `04-TECH-STACK-01-flowchart.mmd` |
