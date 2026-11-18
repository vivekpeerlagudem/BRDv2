# Internal Sales CRM — Engineering Documentation

Engineering blueprint for our **single-company, single-tenant internal Sales CRM** (roles: Admin, Sales Manager, Salesperson; external buyers and signers via secure links). It is derived from **BRD v2.0** ("Sales CRM Platform: Phase 1", 17 Nov 2026), which itself is not modified. This set covers specifications, high-level design, technical design and the engineering stack. **No application code has been written and no dependencies have been installed.**

## 1. Folder structure

| Folder | Contents | Count |
|---|---|---|
| `01-specifications/` | What the system must do: PRD, functional requirements, domain model, business rules, workflows, user stories, acceptance criteria, permissions, traceability, open decisions, scope reconciliation | 11 |
| `02-hld/` | How the system is shaped: system/component/module architecture, data flow, integrations, security, deployment, AI, ADR log | 9 |
| `03-tld/` | How to build it: database ERD and schema, API, backend, frontend, auth, integrations, proposal engine, sharing, e-signature, AI, notifications and automation, audit, testing, error handling | 15 |
| `04-engineering/` | Technology stack, dependency plan, project structure, development environment | 4 |
| `05-diagrams/` | All 104 Mermaid diagrams extracted as `.mmd` files, plus an index (`05-diagrams/README.md`) | 105 |
| `06-solution-architecture/` | **Solution Architecture Document** — the consolidated, leadership-level blueprint (start here for presentations) | 1 |

## 2. Reading order

| Step | Read | Why |
|---|---|---|
| 0 | `06-solution-architecture/SOLUTION-ARCHITECTURE.md` | One-document overview for CEO and technical leadership: context, C4 views, application, data, integration, infrastructure, security, key decisions, open items |
| 1 | `01-specifications/PRD.md` | Purpose, users, scope, releases R1–R3 |
| 2 | `01-specifications/SCOPE-RECONCILIATION.md` | What changed from the commercial BRD to the internal deployment (IDD-01..16) and the disposition of every BRD item |
| 3 | `01-specifications/OPEN-DECISIONS.md` | OD-01..OD-112: unresolved decisions and the working assumptions the design uses |
| 4 | `01-specifications/DOMAIN-MODEL.md`, `ROLE-PERMISSION-MATRIX.md` | Entities, relationships, ownership and visibility |
| 5 | `01-specifications/BUSINESS-RULES.md`, `WORKFLOWS.md` | Rules (RULE-*), state machines (SM-01..10), workflows (WF-01..39), domain events, error codes |
| 6 | `01-specifications/FUNCTIONAL-REQUIREMENTS.md`, `USER-STORIES.md`, `ACCEPTANCE-CRITERIA.md` | Per-requirement behaviour, stories, Given/When/Then criteria |
| 7 | `02-hld/SYSTEM-ARCHITECTURE.md` → `ARCHITECTURE-DECISIONS.md` | Architecture overview and every decision (ADR-001..087) |
| 8 | `02-hld/COMPONENT-`, `MODULE-`, `DATA-FLOW-`, `INTEGRATION-`, `SECURITY-`, `AI-`, `DEPLOYMENT-ARCHITECTURE.md` | Detailed HLD views |
| 9 | `03-tld/DATABASE-ERD.md`, `DATABASE-DESIGN.md` | Physical schema |
| 10 | `03-tld/API-SPECIFICATION.md`, `BACKEND-DESIGN.md`, `FRONTEND-DESIGN.md`, `AUTHENTICATION-AUTHORIZATION.md` | Build-level design of the core |
| 11 | Remaining `03-tld/*` | Proposal engine, sharing, e-signature, AI, notifications/automation, integrations, audit, errors, testing |
| 12 | `04-engineering/*` | Stack, packages, repository layout, Windows dev setup |
| — | `01-specifications/REQUIREMENT-TRACEABILITY-MATRIX.md` | Look up any BR-* requirement across all documents |

## 3. Identifier conventions

| Prefix | Meaning | Defined in |
|---|---|---|
| `BR-<MOD>-NNN`, `NFR-NNN`, `AC-NN`, `OQ-N` | Original BRD identifiers (preserved verbatim) | BRD v2.0 |
| `IDD-NN` | Internal deployment decision (decided because the product is internal and single-tenant) | SCOPE-RECONCILIATION |
| `OD-NN` | Open decision with working assumption | OPEN-DECISIONS |
| `DR-<MOD>-NN` | Derived requirement (gap filled, pending confirmation) | FUNCTIONAL-REQUIREMENTS |
| `RULE-<MOD>-NN`, `SM-NN` | Business rule, state machine | BUSINESS-RULES |
| `WF-NN` | Workflow | WORKFLOWS |
| `US-<MOD>-NN`, `FAC-<MOD>-NN` | User story, functional acceptance criterion | USER-STORIES, ACCEPTANCE-CRITERIA |
| `PERM-NNN` | Permission row | ROLE-PERMISSION-MATRIX |
| `ADR-NNN` | Architecture decision | 02-hld/ARCHITECTURE-DECISIONS |
| `SC-*`, `TH-*`, `RR-*` | Security control, threat, residual risk | 02-hld/SECURITY-ARCHITECTURE |

Authority when documents disagree: BUSINESS-RULES for rules, validations, error codes and limits; DOMAIN-MODEL for entity names and attributes; ROLE-PERMISSION-MATRIX for permissions; WORKFLOWS for flows and event names; SCOPE-RECONCILIATION for dispositions; ARCHITECTURE-DECISIONS for ADR numbers; DATABASE-DESIGN for physical schema.

## 4. Recommended architecture (summary)
- **Modular monolith** in TypeScript: one repository, one PostgreSQL 18 database, three runtime roles from one codebase — `server` (Hono REST API + static SPA + SSE), `worker` (pg-boss jobs and schedules, integrations), `renderer` (Chromium PDF/DOCX, no internet egress).
- **Frontend:** React 19 + Vite multi-page (internal app, buyer view on a separate origin, Outlook add-in), TanStack Router/Query/Table/Form, Tailwind v4 + shadcn/ui, TipTap editor.
- **Data/infrastructure:** PostgreSQL also provides the queue (pg-boss), pub/sub (LISTEN/NOTIFY) and full-text search; object storage with Object Lock for signed documents; managed containers (Azure Container Apps or AWS ECS Fargate — OD-11). No Redis, brokers, Kubernetes or microservices.
- **Auth:** Better Auth (password, Google, Microsoft, TOTP; invite-only); application-owned RBAC with own/team/all scopes enforced by scoped repositories.
- **Integrations behind adapters:** Gmail/Graph (polling sync, minimal scopes), e-signature partner (OD-02/03), Anthropic Claude (OD-05), transactional email (OD-14), Turnstile CAPTCHA.

## 5. Quality review and cross-check results (2026-11-17)

| Check | Result |
|---|---|
| BRD coverage | All 130 BR-* requirements dispositioned (42 Unchanged, 79 Clarified, 6 Modified, 2 Deferred, 1 Out of scope); corrected count 101 Must / 25 Should / 4 Could (BRD §9.16 table is off by one in PRC) |
| Traceability | 127 / 127 in-scope requirements traced to FR + user stories + acceptance criteria + at least one TLD document (generated matrix, 0 gaps) |
| Cross-references | Every OD, ADR, PERM and RULE reference in 01–04 resolves to a defined item (script-verified) |
| Diagrams | 104 Mermaid diagrams parse with Mermaid 11.4 (script-verified in browser) |
| Entities ↔ workflows | DATABASE-ERD §8 maps every workflow to the tables it writes |
| Frontend ↔ API | Every endpoint referenced by FRONTEND-DESIGN routes exists in API-SPECIFICATION |
| Permissions | One shared matrix (`packages/shared/permissions/matrix.ts`) drives backend `decide`, SQL `scopeFilter` and the UI payload; generated permission test suite specified (TESTING-STRATEGY §3.4) |
| Contradictions resolved | Release plan, disposition counts, Must count (100 in scope), token storage and URL-fragment transport, identity gate, co-manager scope, automation storage (ADR-024), event history vs outbox (ADR-022), stale-version signing, ADR numbering, event names, pre-send finding codes |
| Not verified | Mermaid rendering appearance (only parsing); package versions are registry-current on 2026-11-17 but untested together; provider-specific API parameters (e-sign provider not yet selected; Anthropic SDK parameter names to be re-checked at the pinned SDK version) |

## 6. How this set was produced
1. **Specifications** — written by installed Agency specialists in parallel: Product Manager (PRD, scope reconciliation, open decisions), Workflow Architect (business rules, workflows), Salesforce Architect (domain model, permission matrix), Senior Project Manager (functional requirements, then a reconciliation pass across all specs), Sprint Prioritizer (user stories, acceptance criteria).
2. **Architecture challenge** — Software Architect (Agency) and wshobson `comprehensive-review:architect-review` independently challenged the architecture backbone; accepted outcomes became ADR-020..037.
3. **HLD** — Software Architect (system/component/module), Backend Architect (data flow, integrations), Security Architect (security), DevOps Automator (deployment), wshobson `llm-application-dev:ai-engineer` (AI, using the Claude API reference skill); conflicts resolved by the Principal Solution Architect.
4. **ADR log, TLD, engineering docs, traceability, diagrams, cross-checks** — written directly by the Principal Solution Architect (no further delegation, at the project owner's request).

## 7. Next steps (implementation phase, not started)
1. Leadership/IT/Legal decide the R1-blocking open decisions (OPEN-DECISIONS index "Needed by R1"), in particular OD-06 mail provider, OD-11 hosting, OD-08 capacity, OD-48 go-live, OD-14 transactional email.
2. Create the repository outside OneDrive (`C:\dev\sales-crm`, ADR-033), set up per DEVELOPMENT-ENVIRONMENT.md, install per DEPENDENCY-PLAN.md.
3. Build R1 in vertical slices following TESTING-STRATEGY Definition of Done; keep this documentation in the repository and update the traceability matrix per change.
