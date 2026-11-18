# Solution Architecture Document
## Internal Sales CRM — Phase 1

| | |
|---|---|
| **Document** | Solution Architecture Document (SAD) |
| **Version** | 1.0 — for leadership review |
| **Date** | 17 November 2026 |
| **Author** | Principal Solution Architect |
| **Basis** | BRD v2.0 (Phase 1) and the engineering documentation set in `docs/01`–`05` (specifications, HLD, TLD, engineering) |
| **Audience** | CEO, Sales leadership, IT, Technical Lead, Engineering team |
| **Status** | Architecture recommended; decisions marked *Open* in §10 must be confirmed before or during Release 1 |

> This document is the single, consolidated view of the solution. It does not repeat requirement analysis; it summarises *what we will build, how it fits together, and why*. Detailed designs are referenced in the right-hand "Detail" columns.

---

## Executive summary

**What.** One internal web application in which our sales team manages companies, contacts and deals; builds branded proposals with pricing from a product catalogue; shares them through tracked links; gets real-time alerts when buyers open or forward them; collects legally valid e-signatures; and sees a self-updating pipeline. AI drafts and checks proposals, always under human control.

**Why.** It replaces today's mix of spreadsheets / light CRM, Word proposals and a separate e-signature tool (BRD P1–P9): faster proposals, visibility after sending, fewer manual updates, and one source of truth for management.

**How (in one sentence).** A **single-tenant modular monolith** — one TypeScript codebase, one PostgreSQL database, three runtime roles (web/API server, background worker, isolated document renderer) — integrated with our Microsoft 365 or Google Workspace tenant, an e-signature provider and the Claude AI API, deployed as managed containers on our cloud.

**Why this shape.** It is the simplest architecture that meets the requirements with production-grade security and auditability: no microservices, no Redis, no message broker, no Kubernetes. The database does triple duty (data, job queue, notifications), which keeps operations small for a team of our size while leaving clean extension points for Phase 2 (deal intelligence) and Phase 3 (AI agents).

| Key figure | Value |
|---|---|
| Users | ≤ 150 internal users (Admin, Sales Manager, Salesperson) + external buyers/signers via links |
| Scope | 130 BRD requirements → 127 in scope (100 Must), traced end-to-end |
| Runtime units | 3 application roles + 1 managed database + 1 object store |
| Releases | R1 core CRM + proposals + sharing → R2 email/calendar, AI, e-signature (recommended go-live) → R3 inbox add-in, HubSpot/Pipedrive import |
| Indicative run cost (production) | ~USD 550–900 / month (AWS) or ~USD 900–1,300 / month (Azure) infrastructure, plus AI usage (~USD 1,300 / month at full adoption, budget-capped) and e-signature licences |

---

## 1. Solution architecture overview

### 1.1 Business context
| Pain today (BRD) | Solution capability |
|---|---|
| Proposals slow to build, error-prone (P1) | Templates bound to CRM data, product catalogue and pricing tables, AI drafting, deterministic pre-send checks |
| No visibility after sending (P2) | Per-recipient tracked links, forward detection, real-time alerts, follow-up automation |
| Version confusion (P3) | Immutable sent versions, side-by-side comparison, signing locked to an exact version |
| Signing delays (P4) | Integrated e-signature with signing order, reminders, completion certificate |
| Managers can't see the real pipeline (P5) | Role-scoped dashboards, weighted pipeline, stalled-deal flags |
| Admin overhead (P6) | Email/calendar sync, automatic stage moves and Closed Won, unified timeline |
| Lost / manual leads (P7) | Embeddable web forms with assignment rules and instant alerts |
| Knowledge silos (P8) | Shared templates and content library |
| Hard to switch (P9) | CSV/Excel (and HubSpot/Pipedrive export) import with duplicate handling and undo |

### 1.2 Objectives and measures
Reduce time-to-proposal by 50 %, time-to-sign by 30 %, deals going quiet after a proposal by 30 %; capture ≥ 80 % of email/meeting activity automatically; ≥ 80 % weekly active salespeople by week 4 (BRD §12; baselines to be measured — OD-10).

### 1.3 Users and actors
| Actor | Uses | Access |
|---|---|---|
| **Salesperson** | Deals, proposals, email, tasks, own dashboard | Own records (+ read-only colleagues' records if enabled) |
| **Sales Manager** | Team pipeline, coaching, proposals for team deals; optionally templates/catalogue | Own team |
| **Admin / Sales Ops** | Users, pipelines, fields, templates, imports, automation, AI controls, audit | Whole organisation |
| **Leadership sponsor** | Dashboards, outcomes | Via Admin/Manager role |
| **Buyer / recipient** (external) | Views, downloads, forwards, accepts/declines a proposal | One proposal version through a secure link |
| **Signer** (external) | Signs through the e-signature provider | Provider-controlled |
| **Website visitor** (external) | Submits a lead form | Public form only |

### 1.4 System boundary
**Inside the solution:** CRM records, pipelines, tasks, timelines; proposal templates, catalogue, pricing, document generation; sharing and tracking; signature orchestration and evidence storage; automation; notifications; reporting; AI orchestration; audit; import/export.

**Outside (integrated, not built):** identity provider and mailboxes (Google Workspace or Microsoft 365), e-signature provider (signing ceremony, sealing, certificates), Claude API (language model), transactional email service, CAPTCHA, cloud hosting services.

**Explicitly out of scope:** multi-tenant SaaS features (sign-up, trials, billing — IDD-01/02/03), marketing automation, payments, phone dialer, native mobile apps, Phase 2/3 capabilities (call recording, deal scoring, AI agents, open API, SSO via SAML).

---

## 2. End-to-end solution architecture

```mermaid
flowchart LR
  classDef ext fill:#F4F1EA,stroke:#8A7F6B,color:#3D3527
  classDef ui fill:#E3F0FF,stroke:#2F6FB3,color:#0E2A47
  classDef app fill:#E8F6EE,stroke:#2E8B57,color:#123D26
  classDef data fill:#FFF4DC,stroke:#C48A00,color:#4A3400
  classDef sec fill:#FDECEC,stroke:#C0392B,color:#5B1610
  classDef ppl fill:#0E2A47,stroke:#0E2A47,color:#FFFFFF

  subgraph USERS["People"]
    direction LR
    U1["Sales team<br/>Salesperson · Manager · Admin"]:::ppl
    U2["Buyers &<br/>forwarded viewers"]:::ppl
    U4["Website visitors"]:::ppl
  end

  subgraph CLIENTS["Client apps"]
    direction LR
    WEB["Internal CRM app<br/>crm.company.com"]:::ui
    ADDIN["Outlook add-in /<br/>Gmail add-on"]:::ui
    BUY["Buyer view & lead forms<br/>proposals.company.com"]:::ui
  end

  subgraph EDGE["Edge"]
    direction LR
    WAF["Load balancer + WAF<br/>TLS · rate limits"]:::sec
  end

  subgraph CORE["Sales CRM"]
    direction LR
    API["SERVER<br/>Hono REST API<br/>auth · RBAC · SSE"]:::app
    MOD["16 business modules<br/>CRM · Proposals · Sharing<br/>E-sign · AI · Automation · …"]:::app
    WRK["WORKER<br/>jobs · schedules<br/>integrations"]:::app
    RND["RENDERER<br/>PDF / DOCX<br/>no internet access"]:::app
  end

  subgraph DATA["Data"]
    direction LR
    PG[("PostgreSQL 18<br/>data · queue · search · audit")]:::data
    OBJ[("Object storage<br/>PDFs · signed docs (WORM)")]:::data
    KMS["Key vault / KMS"]:::sec
  end

  subgraph EXT["External"]
    direction LR
    IDP["Microsoft 365 /<br/>Google Workspace"]:::ext
    ESIG["E-signature provider"]:::ext
    AI["Claude API"]:::ext
    MAIL["Transactional email"]:::ext
  end

  USERS --> CLIENTS
  CLIENTS -->|"HTTPS"| EDGE
  EDGE --> CORE
  CORE -->|"SQL · files · keys"| DATA
  CORE <-->|"APIs out · webhooks in"| EXT
```

**How a typical deal flows through the system**

```mermaid
flowchart TB
  classDef step fill:#E8F6EE,stroke:#2E8B57,color:#123D26
  classDef auto fill:#E3F0FF,stroke:#2F6FB3,color:#0E2A47
  subgraph ROW1["Win the opportunity"]
    direction LR
    A["1 · Lead form or<br/>manual entry"]:::step --> B["2 · Deal & contacts<br/>auto-assigned"]:::step --> C["3 · Emails & meetings<br/>auto-logged"]:::auto --> D["4 · Proposal from template<br/>CRM data + pricing + AI draft"]:::step --> E["5 · Pre-send checks,<br/>send tracked links"]:::step
  end
  subgraph ROW2["Close and learn"]
    direction LR
    F["6 · Buyer opens / forwards<br/>owner alerted in seconds"]:::auto --> G["7 · Revise & compare<br/>versions"]:::step --> H["8 · E-signature<br/>ordered signers + reminders"]:::step --> I["9 · Closed Won automatically<br/>amount + date, signed PDF stored"]:::auto --> J["10 · Dashboards &<br/>timeline update"]:::auto
  end
  ROW1 --> ROW2
```

---

## 3. C4 architecture views

### 3.1 Level 1 — System context
```mermaid
flowchart TB
  classDef person fill:#0E2A47,stroke:#0E2A47,color:#FFFFFF
  classDef system fill:#2F6FB3,stroke:#1D4F86,color:#FFFFFF
  classDef ext fill:#9AA5B1,stroke:#6B7785,color:#FFFFFF

  SP["Salesperson / Sales Manager<br/>[Person]<br/>Manages deals, proposals, pipeline"]:::person
  AD["Admin / Sales Ops<br/>[Person]<br/>Configures and governs the system"]:::person
  BY["Buyer / forwarded viewer<br/>[External person]<br/>Reviews, forwards, accepts proposals"]:::person
  SG["Signer<br/>[External person]<br/>Signs proposals"]:::person
  WV["Website visitor<br/>[External person]<br/>Submits enquiries"]:::person

  CRM["Internal Sales CRM<br/>[Software system]<br/>CRM, proposals, sharing, signature orchestration,<br/>automation, AI assistance, reporting"]:::system

  M365["Microsoft 365 / Google Workspace<br/>[External system]<br/>Identity, mail, calendar, add-ins"]:::ext
  ES["E-signature provider<br/>[External system]<br/>Legally valid signing, sealing, certificates"]:::ext
  CL["Claude API<br/>[External system]<br/>Language model"]:::ext
  TE["Transactional email<br/>[External system]<br/>Notifications, invitations, codes"]:::ext
  CP["Cloudflare Turnstile<br/>[External system]<br/>Bot protection"]:::ext

  SP -->|"Uses (browser, Outlook/Gmail)"| CRM
  AD -->|"Administers"| CRM
  BY -->|"Views proposal via secure link"| CRM
  WV -->|"Submits lead form"| CRM
  SG -->|"Signs"| ES
  CRM -->|"Sign-in, sync and send mail, read calendar"| M365
  CRM -->|"Creates envelopes, receives status webhooks"| ES
  CRM -->|"Drafting, summaries, checks (server-side only)"| CL
  CRM -->|"Sends system emails"| TE
  CRM -->|"Verifies form tokens"| CP
```

### 3.2 Level 2 — Containers
```mermaid
flowchart TB
  classDef person fill:#0E2A47,stroke:#0E2A47,color:#FFFFFF
  classDef cont fill:#2F6FB3,stroke:#1D4F86,color:#FFFFFF
  classDef store fill:#C48A00,stroke:#8A6100,color:#FFFFFF
  classDef ext fill:#9AA5B1,stroke:#6B7785,color:#FFFFFF

  P1["Sales team<br/>[Person]"]:::person
  P2["Buyers · visitors<br/>[External person]"]:::person

  subgraph SYS["Internal Sales CRM"]
    SPA["Internal web app<br/>[React 19 SPA · TanStack]<br/>CRM, proposal editor, dashboards"]:::cont
    OA["Outlook add-in<br/>[React task pane · Office.js]"]:::cont
    BV["Buyer app<br/>[React · minimal bundle]<br/>Proposal view, hosted lead form"]:::cont
    SRV["API server<br/>[Node.js 26 · Hono]<br/>REST /api · /public · /addin · /webhooks · SSE<br/>serves the apps on two origins"]:::cont
    WK["Worker<br/>[Node.js · pg-boss]<br/>jobs · schedules · integrations"]:::cont
    RD["Renderer<br/>[Node.js · Chromium]<br/>PDF / DOCX · network-isolated"]:::cont
    DB[("Database<br/>[PostgreSQL 18]<br/>data · queue · pub/sub · search")]:::store
    OS[("Object storage<br/>[S3 or Azure Blob]<br/>documents · WORM evidence")]:::store
  end

  M365["Microsoft 365 / Google<br/>[External system]"]:::ext
  ESG["E-signature provider<br/>[External system]"]:::ext
  CLA["Claude API<br/>[External system]"]:::ext
  TXE["Transactional email<br/>[External system]"]:::ext

  P1 --> SPA
  P1 --> OA
  P2 --> BV
  SPA -->|"JSON · session cookie"| SRV
  OA -->|"JSON · bearer token"| SRV
  BV -->|"JSON · link-bound cookie"| SRV
  SRV -->|"SQL"| DB
  SRV ~~~ WK
  SRV ~~~ RD
  WK -->|"SQL · job queue"| DB
  RD -->|"SQL · read snapshot"| DB
  WK -->|"files"| OS
  RD -->|"PDF / DOCX"| OS
  WK -->|"Graph / Gmail API"| M365
  WK -->|"REST"| ESG
  WK -->|"HTTPS"| CLA
  WK -->|"API / SMTP"| TXE
  ESG -.->|"webhooks to server"| SRV
```

*Also: the API server calls Microsoft/Google for user sign-in (OIDC) and Claude for interactive, streamed AI features; the server reads and writes object storage for uploads and downloads. These edges are omitted above for readability.*

### 3.3 Level 3 — Components of the API server and worker
```mermaid
flowchart TB
  classDef layer fill:#E3F0FF,stroke:#2F6FB3,color:#0E2A47
  classDef mod fill:#E8F6EE,stroke:#2E8B57,color:#123D26
  classDef plat fill:#FFF4DC,stroke:#C48A00,color:#4A3400
  classDef adp fill:#F4F1EA,stroke:#8A7F6B,color:#3D3527

  subgraph HTTP["HTTP layer"]
    direction TB
    R1["Routers<br/>/api/v1 · /public/v1 · /addin/v1 · /webhooks · SSE"]:::layer
    MW["Middleware chain<br/>request id · logging · security headers · rate limit · authenticate<br/>MFA policy · actor context · Zod validation · idempotency · error mapper"]:::layer
  end

  subgraph DOMAIN["Business modules"]
    direction LR
    subgraph DR2[" "]
      direction TB
      M8["sharing"]:::mod
      M9["esign"]:::mod
      M10["ai"]:::mod
      M11["automation"]:::mod
      M12["notifications"]:::mod
      M13["reporting<br/>read-only"]:::mod
      M14["timeline"]:::mod
    end
    subgraph DR1[" "]
      direction TB
      M1["identity"]:::mod
      M2["crm"]:::mod
      M3["leads"]:::mod
      M4["import"]:::mod
      M5["comms"]:::mod
      M6["templates · catalog"]:::mod
      M7["proposals<br/>owns status machine"]:::mod
    end
  end

  subgraph PLATFORM["Platform services"]
    direction TB
    P1["Unit of work<br/>tx + audit + timeline + events + jobs"]:::plat
    P2["Policy<br/>decide · scopeFilter · redact"]:::plat
    P3["Keyring · Files ·<br/>Rate limits · Cache"]:::plat
    P4["Job runtime<br/>pg-boss queues · schedules · DLQ<br/>(worker role runs module jobs)"]:::plat
  end

  subgraph ADAPTERS["Integration adapters"]
    direction TB
    A1["Mail · Calendar"]:::adp
    A2["E-signature"]:::adp
    A3["AI"]:::adp
    A4["Email · Storage · Captcha"]:::adp
  end

  HTTP --> DOMAIN
  DOMAIN --> PLATFORM
  DOMAIN --> ADAPTERS
```

Detail: COMPONENT-ARCHITECTURE, MODULE-ARCHITECTURE (HLD); BACKEND-DESIGN (TLD).

---

## 4. Application architecture

### 4.1 Codebase and runtime
| Package / app | Role | Key technology |
|---|---|---|
| `apps/web` | Three HTML entries from one Vite project: internal app, buyer app (separate origin), Outlook add-in | React 19, TanStack Router/Query/Table/Form, Tailwind v4, shadcn/ui, TipTap |
| `apps/server` | One Node.js package started as `server`, `worker`, `renderer`, `migrate` or `cli` | Hono, Drizzle ORM, pg-boss, Better Auth, Zod |
| `packages/shared` | Contracts used by both sides: Zod schemas, enums, **permission matrix**, pricing/money maths, error codes | Zod, decimal.js |
| `packages/proposal` | Proposal content model, placeholder resolution, HTML renderer (same in browser, server and PDF), DOCX mapper, version diff | ProseMirror schema, React static render, docx |

### 4.2 How the pieces interact
```mermaid
sequenceDiagram
  autonumber
  participant UI as React app (TanStack Query)
  participant API as Hono route (thin adapter)
  participant SVC as Module service
  participant POL as Policy
  participant DB as PostgreSQL
  participant Q as pg-boss queue
  participant WK as Worker job
  UI->>API: PATCH /api/v1/deals/{id} (Zod-validated, rowVersion)
  API->>SVC: deals.update(actor, input)
  SVC->>POL: decide(actor, 'deal.edit', deal)
  SVC->>DB: one transaction - update deal, stage history, timeline, audit, event history
  SVC->>Q: enqueue subscriber jobs in the same transaction
  DB-->>SVC: commit (all or nothing)
  SVC-->>API: Deal + per-record permissions
  API-->>UI: 200 JSON
  Q->>WK: job (notifications, automation)
  WK->>DB: notification row, then NOTIFY
  DB-->>UI: SSE poke (fallback poll every 30 s) - UI refreshes
```

### 4.3 Architectural rules that keep the monolith modular
| Rule | Enforcement |
|---|---|
| A module owns its tables; others call its service, never its tables | dependency-cruiser in CI |
| Domain logic (state machines, pricing, checks) is pure and unit-tested | `domain/` folders, no I/O imports |
| Every data read is permission-scoped | Repositories only accept a `ScopedQuery` (compile-time) |
| Cross-cutting writes (audit, timeline, events, jobs) happen in the business transaction | Unit-of-work API |
| The same Zod schema validates in the browser and on the server | `packages/shared` contracts, generated OpenAPI client |
| Integrations only through adapters | Ports in `adapters/`, contract-tested |

Detail: MODULE-ARCHITECTURE (HLD), BACKEND-DESIGN, FRONTEND-DESIGN, API-SPECIFICATION (TLD).

---

## 5. Data architecture

### 5.1 Data platform
| Store | Holds | Notes |
|---|---|---|
| **PostgreSQL 18** (managed, HA, 35-day point-in-time recovery) | ~75 tables: CRM, proposals, sharing, signatures, email metadata/bodies, automation, notifications, audit; plus the `pgboss` job schema | UUIDv7 keys, numeric money, optimistic concurrency, full-text + trigram search, monthly partitions for audit/event history |
| **Object storage** (S3 or Azure Blob) | Proposal PDFs/DOCX, signed PDFs and completion certificates (immutable/WORM), template images, import files, exports, audit exports | Private, server-mediated access, versioning |
| **Key vault / KMS** | Secrets and the master key for envelope encryption | OAuth tokens, share-link tokens, TOTP secrets encrypted per field |

Sizing at planned limits (150 users, 200k contacts, 5M emails, 20k proposals/year): ~80–90 GB database in year 1 (mostly email bodies), ~30 GB/year documents.

### 5.2 Core entities and relationships
```mermaid
erDiagram
  USER ||--o| TEAM_MEMBERSHIP : "in 0..1 team"
  TEAM ||--|{ TEAM_MANAGER : "managed by"
  USER ||--o{ DEAL : owns
  COMPANY ||--o{ CONTACT : employs
  COMPANY ||--o{ DEAL : has
  PIPELINE ||--|{ STAGE : contains
  DEAL }o--|| STAGE : "is at"
  DEAL ||--o{ DEAL_CONTACT : stakeholders
  CONTACT ||--o{ DEAL_CONTACT : "plays roles"
  TEMPLATE ||--|{ TEMPLATE_VERSION : publishes
  DEAL ||--o{ PROPOSAL : "0..many"
  PROPOSAL }o--|| TEMPLATE_VERSION : pins
  PROPOSAL ||--|{ PROPOSAL_VERSION : versions
  PROPOSAL_VERSION ||--o{ PRICING_LINE : prices
  PRODUCT ||--o{ PRICING_LINE : "snapshot of"
  PROPOSAL_VERSION ||--o{ SHARE_LINK : "one per recipient"
  SHARE_LINK ||--o{ VIEW_SESSION : tracks
  PROPOSAL_VERSION ||--o{ SIGNATURE_REQUEST : "signed via"
  SIGNATURE_REQUEST ||--|{ SIGNER : has
  SIGNATURE_REQUEST ||--o| SIGNED_DOCUMENT : produces
  MAILBOX ||--o{ EMAIL_MESSAGE : syncs
  EMAIL_MESSAGE ||--o{ EMAIL_LINK : "linked to deal/contact/company"
  DEAL ||--o{ TIMELINE_EVENT : history
  DEAL ||--o{ TASK : "follow-ups"
```

**Integrity guarantees built into the database**
- A sent proposal version cannot be modified (database trigger); its content and PDF carry SHA-256 fingerprints.
- At most one open signature request per deal (partial unique index).
- The application database account cannot update or delete audit records; a background sealer hash-chains them and exports daily to write-once storage.
- Every change runs in one transaction together with its audit, timeline and follow-up jobs — no partial updates.

### 5.3 Data movement
```mermaid
flowchart LR
  classDef in fill:#E3F0FF,stroke:#2F6FB3,color:#0E2A47
  classDef core fill:#E8F6EE,stroke:#2E8B57,color:#123D26
  classDef out fill:#FFF4DC,stroke:#C48A00,color:#4A3400
  I1["Lead forms"]:::in --> C1
  I2["CSV / Excel / HubSpot / Pipedrive exports"]:::in --> C1
  I3["Mailbox & calendar sync<br/>(filtered before storing)"]:::in --> C1
  I4["Buyer activity<br/>(views, forwards, responses)"]:::in --> C1
  I5["E-signature webhooks"]:::in --> C1
  C1[("PostgreSQL<br/>system of record")]:::core
  C1 --> O1["Dashboards & reports<br/>(role-scoped)"]:::out
  C1 --> O2["Proposal PDF/DOCX<br/>→ object storage"]:::out
  C1 --> O3["AI context<br/>(permission-scoped, private mail excluded)"]:::out
  C1 --> O4["Notifications<br/>(in-app, email, digest)"]:::out
  C1 --> O5["Full export · audit export<br/>· retention & erasure"]:::out
```

### 5.4 Data governance
| Data class | Examples | Protection | Retention (defaults, configurable) |
|---|---|---|---|
| Credentials & secrets | OAuth tokens, share tokens, TOTP secrets | Field-level envelope encryption, key rotation | Lifetime of connection/link |
| Personal data | Contacts, email participants, buyer identities, IPs (truncated) | Role-based access, private-email masking, erasure by anonymisation | Emails 5 y; IPs 90 days |
| Commercial confidential | Proposals, pricing, deals | Role scope, immutable sent versions | Life of the record |
| Legal evidence | Signed PDFs, certificates, audit log | WORM storage, hash verification, erasure-exempt | Legal schedule (OD-36); audit 7 y |

Detail: DATABASE-ERD, DATABASE-DESIGN (TLD); DATA-FLOW-ARCHITECTURE (HLD).

---

## 6. Integration architecture

```mermaid
flowchart LR
  classDef core fill:#E8F6EE,stroke:#2E8B57,color:#123D26
  classDef ext fill:#F4F1EA,stroke:#8A7F6B,color:#3D3527
  classDef port fill:#E3F0FF,stroke:#2F6FB3,color:#0E2A47
    MP["MailProvider · CalendarProvider<br/>delta polling every 3 min · send via user's mailbox"]:::port
    EP["ESignatureProvider<br/>create · void · remind · download"]:::port
    IN["Webhook inbox<br/>persist → re-read authoritative status"]:::core
    AP["AiProvider<br/>server-side · streamed · budgeted"]:::port
    TP["TransactionalEmail<br/>notifications · invitations · codes"]:::port
    G["Google Workspace<br/>Gmail · Calendar · add-on"]:::ext
    MS["Microsoft 365<br/>Graph mail & calendar · Outlook add-in"]:::ext
    ES["E-signature provider<br/>(selection pending, OD-03)"]:::ext
    CL["Claude API<br/>Sonnet 5.5 · Haiku 5.5 · Opus 5.5"]:::ext
    TE["Transactional email<br/>(selection pending, OD-14)"]:::ext
  MP <-->|"OAuth · delta sync · send"| G
  MP <-->|"OAuth · delta sync · send"| MS
  EP -->|"REST"| ES
  ES -.->|"signed webhooks"| IN
  AP -->|"HTTPS · SSE"| CL
  TP -->|"API / SMTP"| TE
```

| Integration | Purpose | Pattern | Key controls | Release |
|---|---|---|---|---|
| **Microsoft Graph / Gmail API** | Sign-in, mailbox & calendar sync, send email from CRM | OAuth per user (separate consent from login), delta polling, headers-first filtering | Minimal scopes (read + send, calendar read); unknown senders not stored; private/excluded mail filtered; tokens encrypted; internal-only tenant app avoids public verification | R2 |
| **Outlook add-in / Gmail add-on** | Look up records, create records, insert proposal links from the inbox | Office.js task pane (Nested App Auth) / server-rendered Google cards | Restricted add-in sessions; Google ID-token verification | R3 |
| **E-signature provider** | Legally valid signing, sealing, certificates | Adapter; provider emails signers; webhooks → inbox → authoritative re-read → forward-only state; hourly reconciliation | HMAC-verified webhooks; document hash asserted before upload; signed artefacts stored write-once | R2 |
| **Claude API** | Draft sections, summaries, rewrite, follow-up drafts, pre-send consistency check | Server-side only; versioned prompts; structured outputs; streaming | Permission-scoped context; untrusted-text delimiting; budgets; never sends anything; outputs labelled until accepted; no prompt logging | R2 |
| **Transactional email** | System notifications, digests, invitations, buyer one-time codes | Provider API/SMTP from a dedicated subdomain | SPF/DKIM/DMARC; bounce suppression | R1 |
| **Cloudflare Turnstile** | Lead-form bot protection | Server-side token verification | Fails open with honeypot + rate limits if unavailable | R1 |

Resilience pattern for all integrations: calls run in background jobs with retries and dead-letter queues, per-provider concurrency limits and circuit breaking; inbound events are persisted before processing so nothing is lost.

Detail: INTEGRATION-ARCHITECTURE (HLD), INTEGRATION-DESIGN, E-SIGNATURE-DESIGN, AI-IMPLEMENTATION-DESIGN (TLD).

---

## 7. Infrastructure and deployment architecture

### 7.1 Production topology
```mermaid
flowchart TB
  classDef net fill:#FDECEC,stroke:#C0392B,color:#5B1610
  classDef run fill:#E8F6EE,stroke:#2E8B57,color:#123D26
  classDef data fill:#FFF4DC,stroke:#C48A00,color:#4A3400
  classDef ops fill:#EEF0F3,stroke:#6B7785,color:#2A3139
  classDef ext fill:#F4F1EA,stroke:#8A7F6B,color:#3D3527

  DNS["DNS · crm. · proposals. · notify."]:::net
  LB["Load balancer + WAF<br/>TLS termination · IP rate limits"]:::net

  subgraph APPZ["Application subnet"]
    direction TB
    S1["server ×2<br/>across zones"]:::run
    W1["worker ×1"]:::run
    RN["renderer ×1–2<br/>no internet egress"]:::run
    MJ["migrate<br/>release job"]:::run
  end

  subgraph DATAZ["Data subnet"]
    direction TB
    PG[("PostgreSQL 18<br/>HA · PITR 35 days")]:::data
    OS[("Object storage<br/>versioning · WORM")]:::data
    KV["Key vault / KMS"]:::data
  end

  NAT["NAT gateway<br/>static egress IP · host allow-list<br/>(server and worker only)"]:::net
  INET["Google / Microsoft · e-sign · Claude · email"]:::ext

  subgraph OPS["Operations"]
    direction TB
    MON["Logs · metrics · alerts<br/>error tracking · uptime"]:::ops
    CI["CI/CD · build once,<br/>promote by digest"]:::ops
  end

  DNS --> LB --> APPZ
  APPZ -->|"private endpoints"| DATAZ
  APPZ --> NAT --> INET
  APPZ -.->|"telemetry"| OPS
```

### 7.2 Environments
| Environment | Purpose | Hosting | Data |
|---|---|---|---|
| Local (Windows) | Development | Docker Compose: PostgreSQL 18, MinIO, Mailpit, provider simulators | Synthetic |
| CI | Automated tests on every change | Ephemeral containers with real PostgreSQL | Synthetic |
| Staging | Integration with real provider sandboxes, UAT, performance and security tests | Same as production, smaller | Test data only (no production copies, OD-104) |
| Production | Live use | Managed containers (Azure Container Apps **or** AWS ECS Fargate — OD-11), managed PostgreSQL, object storage, key vault | Live |

### 7.3 Delivery pipeline
```mermaid
flowchart TB
  classDef s fill:#E3F0FF,stroke:#2F6FB3,color:#0E2A47
  classDef g fill:#FDECEC,stroke:#C0392B,color:#5B1610
  subgraph BUILD["Build and verify"]
    direction LR
    A["Commit / PR"]:::s --> B["Lint · typecheck ·<br/>module boundaries"]:::s --> C["Unit · integration ·<br/>contract tests"]:::s --> D["Security scans<br/>SAST · deps · secrets"]:::g --> E["Build 2 images<br/>app + renderer · SBOM"]:::s
  end
  subgraph RELEASE["Release"]
    direction LR
    F["Staging<br/>migration job · smoke · E2E"]:::s --> G["Approval"]:::g --> H["Production<br/>rolling deploy"]:::s --> I["Watch window<br/>auto-rollback"]:::g
  end
  BUILD --> RELEASE
```
Database changes are forward-only "expand/contract" migrations run as a one-shot release job; application rollback is always to a schema-compatible version.

### 7.4 Operations
| Area | Approach |
|---|---|
| Availability (target 99.5 %) | ≥ 2 server instances across zones, HA database, stateless app tier |
| Backup & recovery | Database point-in-time recovery 35 days (RPO ≤ 5 min, RTO ≤ 8 h), object versioning + replication, quarterly restore drill with provider reconciliation |
| Monitoring | Structured logs, error tracking, metrics and alerts: error rate, latency, job queue lag, dead-letter queue, mailbox-sync lag, webhook failures, PDF render time, AI spend; external uptime checks for app and buyer links |
| Scaling | Server scales horizontally; one worker; renderer 1→2; database vertically (ample headroom at planned volumes) |
| Run cost | Infrastructure ~USD 550–900/month (AWS) or ~900–1,300 (Azure) + AI usage (budget-capped) + e-signature licences |

Detail: DEPLOYMENT-ARCHITECTURE (HLD), DEVELOPMENT-ENVIRONMENT (engineering).

---

## 8. Security architecture

### 8.1 Trust zones
```mermaid
flowchart LR
  classDef z0 fill:#FDECEC,stroke:#C0392B,color:#5B1610
  classDef z1 fill:#FFF4DC,stroke:#C48A00,color:#4A3400
  classDef z2 fill:#E8F6EE,stroke:#2E8B57,color:#123D26
  classDef z3 fill:#E3F0FF,stroke:#2F6FB3,color:#0E2A47
  subgraph Z0["Internet"]
    B["Buyers · visitors · scanners"]:::z0
    PR["Providers (webhooks)"]:::z0
  end
  subgraph Z1["Internal users"]
    U["Sales team browsers / add-ins"]:::z1
  end
  subgraph Z2["Application zone"]
    APPO["App origin: crm.*<br/>session cookies · strict CSP"]:::z2
    BUYO["Buyer origin: proposals.*<br/>no internal cookies · strict CSP"]:::z2
    WH["Webhook endpoints<br/>signature-verified"]:::z2
    REN["Renderer sandbox<br/>no internet"]:::z2
  end
  subgraph Z3["Data zone"]
    DBZ[("Database · least-privilege roles")]:::z3
    OBZ[("Object storage · WORM")]:::z3
    KMZ["KMS / key vault"]:::z3
  end
  B --> BUYO
  PR --> WH
  U --> APPO
  APPO & BUYO & WH --> DBZ
  REN --> DBZ & OBZ
  APPO --> KMZ
```

### 8.2 Controls by concern
| Concern | Design |
|---|---|
| **Authentication** | Invite-only accounts; sign-in with company Microsoft or Google account (tenant/domain verified server-side) or password; TOTP MFA required for Admins (policy can require all); account lockout; session revocation on deactivation; step-up re-authentication for sensitive admin actions |
| **Authorisation (RBAC)** | Three roles × three scopes (own / team / all), plus optional read-only cross-visibility. One permission matrix drives the API, the database query filters and the UI. Out-of-scope records return "not found" |
| **Data access** | Every query passes a mandatory, compile-time-enforced scope filter (no reliance on UI hiding); private emails show metadata only to non-owners; AI sees only what the requesting user may see |
| **External buyer links** | One link per recipient per version; 256-bit random token carried in the URL fragment, so it never reaches logs or email scanners; exchanged for a short-lived cookie bound to that link; separate web origin; optional email one-time code; revocable and expiring; views counted only by real browsers; forwarded viewers must identify themselves |
| **Sensitive documents** | Sent versions immutable and fingerprinted; PDFs generated in a network-isolated renderer (no data exfiltration or server-side request forgery); signed PDFs and certificates on write-once storage; downloads via short-lived signed URLs |
| **Secrets & encryption** | TLS everywhere; encryption at rest; field-level envelope encryption with rotating keys from the cloud KMS; secrets only in the key vault |
| **Application security** | Zod validation on every input; allow-listed rich-text rendering; sanitised email HTML in sandboxed frames; CSRF and origin checks; tiered rate limiting; upload validation |
| **Audit** | Tamper-evident audit log (hash chain + daily write-once export) of user, admin, system and AI actions |
| **AI** | Server-side only; no training on our data; zero data retention requested; prompt-injection defences; human approval before anything leaves the system |
| **Assurance** | Generated permission test suite, SAST/dependency scanning, DAST on the buyer surface, penetration test before go-live (OD-86) |

Non-software compliance tasks (owned by Legal/DPO): DPIA and legitimate-interest assessment for email sync, privacy notices for contacts, staff and forwarded viewers, processor agreements with every provider, e-signature consent wording, retention schedule.

Detail: SECURITY-ARCHITECTURE (HLD), AUTHENTICATION-AUTHORIZATION, DOCUMENT-SHARING-DESIGN, AUDIT-LOGGING-DESIGN (TLD).

---

## 9. Key architecture decisions

| # | Decision | Why it is right for us | Alternatives rejected | ADR |
|---|---|---|---|---|
| 1 | **Single-tenant deployment** | One company; complete data isolation by dedicated database; no tenant logic to build or test | Multi-tenant platform (BRD's commercial framing) | IDD-01 |
| 2 | **Modular monolith, three runtime roles** | Strong transactional consistency across the deal-to-signature chain; one deployable; small ops footprint; module boundaries enforced by tooling so it stays maintainable | Microservices (distributed transactions, many deployables, no scaling need) | ADR-001, -045 |
| 3 | **Hono API + React SPA** (not TanStack Start alone) | Over half the server surface is external HTTP contracts (add-ins, webhooks, buyer API, forms) plus a shared worker; Hono does this simply; TanStack Router keeps a path to Start | TanStack Start alone; NestJS; Express | ADR-003, -004 |
| 4 | **PostgreSQL as data + queue + pub/sub + search** | Removes Redis, broker and search engine; transactional job enqueue means no lost or phantom jobs | Redis/BullMQ, Kafka/RabbitMQ, Elasticsearch | ADR-005, -007, -022, -023 |
| 5 | **TypeScript end-to-end with shared Zod contracts** | One language and one validation schema for UI, API and tests; fewer integration defects | Separate backend language | ADR-003, -021 |
| 6 | **Drizzle ORM, Better Auth** | SQL-level control for triggers/partial indexes; complete auth (SSO, MFA, sessions) inside our database | Prisma; Auth.js; Keycloak (extra infrastructure) | ADR-005, -006, -027 |
| 7 | **Application-level RBAC with compile-time scoped queries** | Expresses own/team/view-only rules that row-level security cannot express cheaply; tested per permission | Postgres RLS | ADR-006, -076 |
| 8 | **Partner e-signature** | Legal validity, evidence and sealing are the provider's speciality; no in-house cryptography | Build in-house | OD-02, ADR-025 |
| 9 | **Immutable proposal versions and signing-chain integrity** | A signed contract must match exactly what the buyer saw; webhook duplicates/losses cannot corrupt deal status | Mutable documents, trusting webhooks | ADR-025, -081 |
| 10 | **One rendering pipeline (HTML → PDF in isolated Chromium)** | Preview, buyer view and PDF are identical; renderer cannot reach the internet | Second layout engine (react-pdf), LibreOffice | ADR-010, -029, -045 |
| 11 | **AI behind an adapter, human-in-the-loop** | Model choice per feature (quality vs cost), budgets, provider switchable, nothing sent without a person | Embedding AI calls in the UI; autonomous AI actions | ADR-014, -035, -041..044 |
| 12 | **Managed containers, no Kubernetes** | Four runtime units do not need an orchestrator; lower cost and skills burden | Kubernetes, serverless | ADR-046, -047 |
| 13 | **Buyer links in URL fragment, separate origin** | Prevents token leakage and false "opened" alerts from email scanners; isolates buyers from internal sessions | Token in URL path; same origin | ADR-020, -071, -075 |

Full register: ARCHITECTURE-DECISIONS (ADR-001..087).

---

## 10. Contradictions and unresolved decisions

### 10.1 Contradictions in the source material (resolved in the design — confirm)
| # | Contradiction | Resolution in the architecture | Confirm with |
|---|---|---|---|
| C1 | BRD describes a commercial multi-tenant SaaS (sign-up, trials, billing, data separation between customers) | Single-tenant internal deployment; billing out of scope; tenant separation satisfied by a dedicated deployment (IDD-01..03) | Leadership |
| C2 | BRD §9.16 says 100 Must; the requirements list contains 101 | Corrected to 101 / 25 / 4; 100 Musts in scope after billing is removed | Product |
| C3 | Acceptance criteria require both Gmail and Outlook; BRD risk plan says launch one first | Build our company's provider first; second provider only if needed (OD-06) | IT / Product |
| C4 | SSO is listed as Phase 3, yet Google/Microsoft sign-in is a Phase 1 Must | Google/Microsoft OIDC sign-in in Phase 1; enterprise SAML remains Phase 3 | IT |
| C5 | Several Musts depend on Should items (decline, expiry, overdue, weighted pipeline) | Those Shoulds are delivered with their dependent Musts; BRD priorities unchanged (OD-40) | Product |
| C6 | BR-AIA-002 says "AI shall check"; checks must still run when AI is switched off | Deterministic checks always run and are authoritative; the AI check is an extra layer (OD-55) | Product |
| C7 | "Void" (proposal) vs "Voided" (signature request); no "Accepted" or "partially signed" status in the BRD | Keep BRD labels; add "Accepted" for accept-without-signature; show "x of n signed" as a badge (OD-17..19) | Sales leadership |
| C8 | Inbox add-in is a Must but is the largest integration effort | Kept as Must, delivered in R3 after email sync; go-live recommended at end of R2 (OD-07, OD-48) | Product |
| C9 | Documentation housekeeping: the functional requirements use dotted error codes while business rules use UPPER_SNAKE; field-length limits not cross-checked one by one | Business rules are authoritative; to be harmonised before build starts | Engineering |

### 10.2 Open decisions that shape the architecture
| Decision | Options | Working assumption used | Architecture impact if changed | Owner | Needed by |
|---|---|---|---|---|---|
| **OD-06** Mail/calendar provider | Microsoft 365 / Google Workspace / both | Build our actual provider first | Only an adapter changes | IT / Product | R2 (before R1 ends) |
| **OD-11** Hosting | Azure / AWS | Managed containers + managed PostgreSQL on whichever cloud we already use | Only infrastructure code and the storage/KMS adapter | IT / Tech Lead | R1 |
| **OD-02 / OD-03** E-signature provider | DocuSign, Dropbox Sign, Adobe Acrobat Sign, BoldSign | Partner via adapter | One adapter + webhook verification | Product / Legal | R2 |
| **OD-01** Jurisdictions of entity and signers | US / EU / other | ESIGN/UETA + eIDAS simple e-signature | Provider choice, consent wording, retention | Legal | R2 |
| **OD-05 / OD-90** AI provider terms | Anthropic with zero-data-retention / other | Anthropic Claude, ZDR requested | Model routing, which features may use caching/fallback | Tech Lead / Legal | R2 |
| **OD-14** Transactional email | SES / Postmark / Azure Communication Services | Any, via adapter | None beyond adapter | Tech Lead | R1 |
| **OD-48 / OD-08** Go-live release and capacity | Go-live at R1 pilot or R2 | Pilot R1, go-live R2 | Release plan only | Leadership | Now |
| **OD-36 / OD-84** Retention schedule | Per data category | Defaults in §5.4 | Configuration only | Legal / DPO | R2 |
| **OD-89** Region / data residency | — | Company's primary region | Hosting region, AI region | Legal / IT | R1 |
| **OD-96 / OD-97 / OD-98 / OD-100** HA tier, egress firewall, error tracking, CI platform | — | HA on, app allow-list, any vendor, existing CI | Operations only | IT / DevOps | R1 |

The full register (OD-01..OD-112) is in OPEN-DECISIONS; none of the remaining items changes the architecture's shape — they are parameters, policies or vendor choices behind adapters.

### 10.3 Documentation status note
At the time of writing, the folder `docs/02-hld/` (9 HLD documents, including ARCHITECTURE-DECISIONS) is **not present** in the OneDrive documentation folder, although it was produced earlier the same day. Its diagrams are preserved in `docs/05-diagrams/` (files prefixed `02-`), and this document consolidates its content. References to HLD documents in this SAD point to that folder and will resolve once it is restored (see the project owner's decision).

---

## 11. Roadmap alignment and next steps

```mermaid
flowchart LR
  classDef r fill:#E8F6EE,stroke:#2E8B57,color:#123D26
  classDef f fill:#EEF0F3,stroke:#6B7785,color:#2A3139
  R1["R1 · Core<br/>CRM · pipeline · lead forms · import<br/>templates · catalog · proposals · tracked sharing<br/>automation · notifications · dashboards · audit<br/>(pilot)"]:::r --> R2["R2 · Connected & signed<br/>email/calendar sync · send from CRM<br/>AI assistance · e-signature<br/>(recommended go-live)"]:::r --> R3["R3 · Inbox & migration<br/>Outlook/Gmail add-in<br/>HubSpot/Pipedrive import · remaining Shoulds"]:::r --> P2["Phase 2 · Win more<br/>deal intelligence, call insights,<br/>approvals, interactive proposals"]:::f --> P3["Phase 3 · Grow<br/>AI agents, pipeline generation,<br/>open API, SSO"]:::f
```

Extension points already in the design for Phases 2–3: event history and job subscriptions (new consumers without changing producers), provider adapters, the block-based proposal model, the automation execution log, and an OpenAPI-described REST surface.

**Immediate next steps**
1. Leadership confirms C1–C8 and the decisions marked "Needed by R1" in §10.2.
2. IT provisions the cloud subscription, tenant app registrations (Microsoft and/or Google) and DNS names.
3. Engineering creates the repository outside OneDrive and starts R1 in vertical slices (identity → CRM → templates/pricing → proposals → sharing → automation/notifications → reporting).
4. Legal starts the DPIA, privacy notices and e-signature provider due diligence in parallel (they gate R2).

---

## Appendix A — Where the detail lives
| Topic | Documents |
|---|---|
| Scope, requirements, decisions | `01-specifications/` PRD, SCOPE-RECONCILIATION, FUNCTIONAL-REQUIREMENTS, BUSINESS-RULES, WORKFLOWS, DOMAIN-MODEL, ROLE-PERMISSION-MATRIX, USER-STORIES, ACCEPTANCE-CRITERIA, REQUIREMENT-TRACEABILITY-MATRIX, OPEN-DECISIONS |
| High-level design | `02-hld/` SYSTEM-, COMPONENT-, MODULE-, DATA-FLOW-, INTEGRATION-, SECURITY-, DEPLOYMENT-, AI-ARCHITECTURE, ARCHITECTURE-DECISIONS |
| Technical design | `03-tld/` DATABASE-ERD, DATABASE-DESIGN, API-SPECIFICATION, BACKEND-, FRONTEND-DESIGN, AUTHENTICATION-AUTHORIZATION, INTEGRATION-DESIGN, PROPOSAL-ENGINE-DESIGN, DOCUMENT-SHARING-DESIGN, E-SIGNATURE-DESIGN, AI-IMPLEMENTATION-DESIGN, NOTIFICATION-AUTOMATION-DESIGN, AUDIT-LOGGING-DESIGN, TESTING-STRATEGY, ERROR-HANDLING-AND-VALIDATION |
| Engineering | `04-engineering/` TECH-STACK, DEPENDENCY-PLAN, PROJECT-STRUCTURE, DEVELOPMENT-ENVIRONMENT |
| Diagrams | `05-diagrams/` (all Mermaid sources) and this document |

## Appendix B — Technology summary
| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 8, TanStack Router / Query / Table / Form, Tailwind CSS v4, shadcn/ui, TipTap 3 |
| Backend | Node.js 26 LTS, TypeScript, Hono 4, Zod 4, Drizzle ORM, pg-boss, Better Auth |
| Documents | Playwright Chromium (PDF), docx, mammoth |
| Data | PostgreSQL 18, S3 or Azure Blob, cloud KMS / key vault |
| AI | Anthropic Claude (Sonnet 5.5, Haiku 5.5, Opus 5.5) via official SDK |
| Integrations | Microsoft Graph / Gmail & Calendar APIs, Office.js add-in, Google Workspace add-on, e-signature provider API, transactional email, Cloudflare Turnstile |
| Hosting & ops | Docker images on Azure Container Apps or AWS ECS Fargate, managed LB + WAF, CI/CD, error tracking, metrics and alerts |
| Quality | Vitest, Playwright, axe, fast-check, k6, Biome, dependency-cruiser, SAST/SCA scanners |
