# Internal Sales CRM — application

Code for the internal, single-tenant Sales CRM. **All product and architecture documentation lives in [`docs/`](docs/README.md)** — this file only explains how to work with the code.

| Start here | |
|---|---|
| Solution overview | [docs/06-solution-architecture/SOLUTION-ARCHITECTURE.md](docs/06-solution-architecture/SOLUTION-ARCHITECTURE.md) |
| Stack and packages | [docs/04-engineering/TECH-STACK.md](docs/04-engineering/TECH-STACK.md), [DEPENDENCY-PLAN.md](docs/04-engineering/DEPENDENCY-PLAN.md) |
| Repository layout | [docs/04-engineering/PROJECT-STRUCTURE.md](docs/04-engineering/PROJECT-STRUCTURE.md) |

## Layout
```
apps/server        Hono API (+ later: worker, renderer, migrate, cli roles via PROCESS_ROLE)
apps/web           React + Vite front end (internal app; buyer and add-in entries added later)
packages/shared    Contracts shared by server and web (Zod schemas, roles, error shape)
packages/proposal  Proposal content model and renderers (from Milestone 5)
docs/              Specifications, HLD, TLD, engineering docs (not modified by code work)
```

## Getting started
Follow **LOCAL-SETUP.md** (database roles, `.env.local`, migrate, seed, run).

| Command | What it does |
|---|---|
| `pnpm dev:server` | API on http://localhost:3000 |
| `pnpm dev:web` | Web app on http://localhost:5273 (buyer links on http://proposals.localhost:5273) |
| `pnpm db:migrate` / `pnpm db:seed` | Create tables / load demo data (seed only on an empty database) |
| `pnpm verify` | Typecheck, lint, unit + integration tests, build |
| `pnpm test:e2e` | Browser tests through the real UI (Microsoft Edge) |

## Project records
| File | Contents |
|---|---|
| IMPLEMENTATION-STATUS.md | What is built and the latest verification results |
| REQUIREMENT-TRACEABILITY.md | Every BRD requirement → built / partial / simulated / not built, with test evidence |
| ARCHITECTURE-DECISIONS.md | Decisions made during the build and every deviation from the approved documents |
| KNOWN-ISSUES.md | Limitations and gaps |
| LOCAL-SETUP.md | How to install, run and test locally |

E-signature, AI and email are **simulated**; see KNOWN-ISSUES.md before any real use.
