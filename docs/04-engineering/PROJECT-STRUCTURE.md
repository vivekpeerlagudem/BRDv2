# Project Structure — Internal Sales CRM (Phase 1)

Repository location: **outside OneDrive**, e.g. `C:\dev\sales-crm` (ADR-033). The documentation in this OneDrive folder is copied into `docs/` of the repository at project start (or linked) and from then on maintained in the repo.

```
sales-crm/
├─ apps/
│  ├─ server/                         # Hono API + worker + renderer + migrate + cli (one package, PROCESS_ROLE)
│  │  ├─ src/
│  │  │  ├─ main.ts
│  │  │  ├─ composition/              # container, ports, subscriptions registry
│  │  │  ├─ config/                   # env schema
│  │  │  ├─ http/
│  │  │  │  ├─ app.ts                 # host-based sub-apps (app origin, buyer origin)
│  │  │  │  ├─ middleware/
│  │  │  │  ├─ routes/
│  │  │  │  │  ├─ api/                 # /api/v1/<module>.routes.ts
│  │  │  │  │  ├─ public/              # /public/v1 (buyer, forms, pixel)
│  │  │  │  │  ├─ addin/               # /addin/v1 (outlook, gmail cards)
│  │  │  │  │  └─ webhooks/            # /webhooks/esign, /webhooks/leads
│  │  │  │  └─ sse.ts
│  │  │  ├─ modules/
│  │  │  │  ├─ identity/  crm/  import/  comms/  leads/  templates/  catalog/
│  │  │  │  ├─ proposals/  sharing/  esign/  ai/  notifications/  automation/
│  │  │  │  └─ reporting/  timeline/  platform/
│  │  │  │     # each: service.ts, types.ts, domain/, repo/, jobs/, hooks/, erasure.ts
│  │  │  ├─ platform/                 # db, jobs, events, audit, policy, crypto, cache, errors, logging, files, ratelimit
│  │  │  ├─ adapters/                 # mail/{google,microsoft}, calendar/*, esign/<provider>, ai/anthropic, txemail/<provider>, storage/{s3,azure-blob}, captcha/turnstile
│  │  │  ├─ renderer/                 # Chromium pool + pdf queue worker
│  │  │  ├─ cli/                      # bootstrap, seed-starter-templates, rotate-keys, resync-mailbox, reconcile-esign, verify-audit-chain, verify-signed
│  │  │  └─ db/
│  │  │     ├─ schema/                # Drizzle schema per module (identity.ts, crm.ts, …)
│  │  │     └─ sql/                   # triggers, functions, grants (applied by migrations)
│  │  ├─ drizzle/                     # generated + reviewed SQL migrations (0001_*.sql …)
│  │  ├─ test/                        # integration, jobs, factories, fakes
│  │  ├─ Dockerfile                   # crm-app (multi-stage)
│  │  ├─ Dockerfile.renderer          # crm-renderer (Chromium + fonts)
│  │  └─ package.json
│  └─ web/
│     ├─ index.html  buyer.html  addin.html
│     ├─ src/
│     │  ├─ app/                      # internal SPA
│     │  │  ├─ main.tsx
│     │  │  ├─ routes/                # TanStack Router file routes (see FRONTEND-DESIGN §2)
│     │  │  ├─ features/              # deals/, proposals/, companies/, contacts/, tasks/, reports/, admin/, settings/, notifications/
│     │  │  └─ layouts/
│     │  ├─ buyer/                    # buyer view + hosted lead form
│     │  ├─ addin/                    # Outlook task pane
│     │  └─ shared/                   # ui (shadcn), api (client, keys), permissions, format, editor, errors
│     ├─ public/                      # static assets (fonts, manifest for add-in)
│     ├─ vite.config.ts               # multi-page build, router plugin, tailwind
│     └─ package.json
├─ packages/
│  ├─ shared/                         # contracts (Zod), enums, permission matrix, pricing, money/date utils, error codes
│  └─ proposal/                       # content schema, validation, migrations, placeholder resolver, HTML renderer, DOCX mapper, diff, starter templates
├─ e2e/                               # Playwright specs, fixtures, docker-compose overrides
├─ evals/                             # AI golden datasets and graders (no customer data, OD-95)
├─ perf/                              # k6 scripts
├─ infra/                             # IaC (Bicep or Terraform per OD-11), environment configs (no secrets)
├─ docs/                              # this documentation set
├─ docker-compose.yml                 # local: postgres:18, minio, mailpit, fakes (e-sign, ai, mail)
├─ .dependency-cruiser.cjs            # module boundary rules (MODULE-ARCHITECTURE §2.1)
├─ biome.json
├─ tsconfig.base.json                 # strict, composite project references
├─ pnpm-workspace.yaml
├─ renovate.json
├─ .env.example                       # variable names only, dev-safe defaults
└─ package.json                       # scripts (below)
```

## Root scripts (cross-platform, no bash-only syntax)
| Script | Command (intent) |
|---|---|
| `dev` | `docker compose up -d` then concurrently: server (`tsx watch src/main.ts` with `PROCESS_ROLE=server`), worker, renderer, web (`vite`) |
| `db:generate` | `drizzle-kit generate` (creates SQL migration from schema changes; reviewed in PR) |
| `db:migrate` | `PROCESS_ROLE=migrate node dist/main.js` (advisory lock, migrator role) |
| `db:bootstrap` | `PROCESS_ROLE=cli node dist/main.js bootstrap --org-name … --currency … --timezone … --admin-email …` |
| `typecheck` | `tsc -b` |
| `lint` / `format` | `biome check` / `biome format --write` |
| `boundaries` | `depcruise apps packages --config .dependency-cruiser.cjs` |
| `test` | `vitest run` (workspace) |
| `test:e2e` | `playwright test` |
| `build` | `pnpm -r build` (server via `tsc`/bundled with `tsup`-free esbuild script; web via `vite build`) |
| `openapi` | generate `openapi.json` from server and `openapi-typescript` types for web |

## Module boundary rules (summary; authoritative in MODULE-ARCHITECTURE §1.2/§2.1)
- `apps/web` → may import `packages/shared`, `packages/proposal`; never `apps/server`.
- `apps/server/src/modules/A` → may import `modules/B/service.ts|types.ts` only for allowed B; `domain/` has no I/O imports.
- `adapters/` → no module imports; `http/` → only module `service.ts`.
- `packages/proposal` → may import `packages/shared`; no Node-only APIs in the renderer path used by the browser.

## Naming conventions
| Item | Convention |
|---|---|
| Files | kebab-case for React components (`deal-board.tsx`) and camelCase for TS modules (`dealStateMachine.ts`) — enforced by Biome naming rule |
| DB | snake_case tables/columns; constraint names explicit (`<table>_<purpose>_uq/_idx/_chk`) because they map to error codes |
| API | `/api/v1/<plural-resource>`; actions as sub-resources (`/deals/{id}/won`) |
| Events | dot.case `<aggregate>.<past_tense>` (WORKFLOWS §0.3) |
| Queues | `<module>.<action>`; event subscriptions `evt.<event>.<subscriber>` |
| Error codes | UPPER_SNAKE from BUSINESS-RULES §20 |
| Permissions | `PermKey` `<resource>.<action>` mapped to PERM-NNN |
