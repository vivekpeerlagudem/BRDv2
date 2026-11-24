# Kensium Sales CRM

An internal, single-tenant sales CRM: companies, people, leads and opportunities, proposals built from templates and
shared with buyers through tracked links, PDF export, e-signature, AI assistance and workflow automation.
Kensium branding, Twenty-style workspace layout.

Product and architecture documentation lives in [`docs/`](docs/README.md). This file explains what is built and how
to run, demo and host it.

| Start here | |
|---|---|
| Solution overview | [docs/06-solution-architecture/SOLUTION-ARCHITECTURE.md](docs/06-solution-architecture/SOLUTION-ARCHITECTURE.md) |
| Stack and packages | [docs/04-engineering/TECH-STACK.md](docs/04-engineering/TECH-STACK.md), [DEPENDENCY-PLAN.md](docs/04-engineering/DEPENDENCY-PLAN.md) |
| Repository layout | [docs/04-engineering/PROJECT-STRUCTURE.md](docs/04-engineering/PROJECT-STRUCTURE.md) |
| Local setup | [LOCAL-SETUP.md](LOCAL-SETUP.md) |
| Hosting (Render + Vercel) | [DEPLOY.md](DEPLOY.md) |

## What the CRM does

| Area | Features |
|---|---|
| **Workspace** | Kensium navy sidebar, Twenty-style pages, ⌘K / Ctrl+K search, notifications, Inter type scale (nothing under 12px) |
| **Roles** | Admin, Sales manager (sees their team), Salesperson (own records). Records you cannot see return 404 |
| **Companies & People** | Lists with search and sorting, record pages with details, related opportunities and timeline. Creating a person can link an existing company or create a new one (name, domain, industry) in the same step; duplicate domains are caught |
| **Leads** | Status tabs with counts; one next step per lead: New → *Start working* → *Qualify* → *Convert*, plus *Disqualify* / *Reopen*; details view; reassign. Converting reuses an existing company with the same name, then creates the person and (optionally) the opportunity |
| **Opportunities** | Pipeline board and list, stage stepper, Closed Won / Lost, stakeholders, proposals per opportunity |
| **Proposal templates** | Admins build templates from sections (locked / required / AI-draftable) with CRM placeholders such as `{{company.name}}`, then publish versions |
| **Proposals** | Built from a published template, priced from the catalogue, pre-send checks, buyer preview, send → frozen version + PDF and DOCX. Proposals dashboard with status tabs, views, viewers, reading time, time per section and downloads |
| **Buyer portal** | Personal tracked link per recipient (token kept in the URL fragment), proposal view, accept / decline, PDF download |
| **E-signature** | Signature requests, multiple signers, webhook-driven status, signed PDF + completion certificate (simulated provider) |
| **AI assistance** | Draft sections, rewrite text, pre-send review, opportunity summary, follow-up email drafts (simulated provider unless configured) |
| **Automation** | Stage moves on send, Closed Won on signing, follow-up checks, stalled / overdue flags, task reminders |
| **Admin** | Users (including renaming), teams, pipeline stages, lost reasons, organization settings and branding, import, audit log, AI settings |

## Tech stack

| Layer | Technology (exact versions in the `package.json` files) |
|---|---|
| Runtime / tooling | Node.js 26, pnpm 10 workspace, TypeScript 7, Biome 2 (lint + format) |
| Web (`apps/web`) | React 19, Vite 8, TanStack Router + Query, Tailwind CSS 4, lucide-react icons, Inter font |
| API (`apps/server`) | Hono 4, Drizzle ORM + PostgreSQL (`pg`), Better Auth (sessions), Zod 4, pino logging |
| Documents | `playwright-core` headless Edge/Chromium for PDFs, `docx` for Word files (`packages/proposal`) |
| AI | Anthropic SDK (Claude models), or a simulated provider |
| Tests | Vitest (unit + integration against a real PostgreSQL test database), Playwright (end-to-end in Edge) |

## Layout

```
apps/server        Hono API, job worker (src/worker.ts), CLI scripts (migrate, seed, reset, bootstrap-admin)
apps/web           React app (index.html) and the buyer portal (buyer.html)
packages/shared    Contracts shared by server and web (Zod schemas, roles, error shape)
packages/proposal  Proposal content model and PDF/DOCX renderers
e2e/               Playwright tests and the Marvel demo scripts
scripts/           tunnel.ps1: share the app from this PC through a Cloudflare quick tunnel
docs/              Specifications, HLD, TLD, engineering docs
```

## Run it locally

Follow [LOCAL-SETUP.md](LOCAL-SETUP.md) once (database roles, `.env.local`, migrate, seed).

| Command | What it does |
|---|---|
| `pnpm dev:server` | API on http://localhost:3000 (also runs background jobs in development) |
| `pnpm dev:web` | Web app on http://localhost:5273 (buyer links on http://proposals.localhost:5273) |
| `pnpm db:migrate` / `pnpm db:seed` | Create tables / load demo data (seed only on an empty database) |
| `pnpm verify` | Typecheck, lint, unit + integration tests, build |
| `pnpm test:e2e` | Browser tests through the real UI (Microsoft Edge) |

## Demo data (Marvel)

A clean demo dataset you can rebuild at any time. **This deletes all business data** in the local `_dev` database
(users, settings and pipeline are kept):

```powershell
pnpm db:reset:dev --demo
pnpm exec playwright test e2e/marvel-seed.spec.ts
pnpm exec playwright test e2e/marvel-proposal-demo.spec.ts
```

- **Data**: 7 companies (Stark Industries, S.H.I.E.L.D., Wakanda Design Group, Pym Technologies, Oscorp, Daily Bugle,
  Hydra), 12 people, 7 opportunities, Marvel products, the "Avengers services proposal" template and a proposal sent
  to Tony Stark.
- **Users**: Tony Stark (admin, `admin@northwind.example`), Captain America (sales manager, `morgan@northwind.example`),
  Spider-Man (salesperson, `riley@northwind.example`), Jordan Patel (salesperson). The demo password is in
  `.env.local` (`SEED_PASSWORD`), never in the code.
- `marvel-proposal-demo.spec.ts` walks the whole flow through the UI (template → proposal → preview → send → seller
  and buyer PDF) and saves screenshots to `demo-preview/` (ignored by git).
- `leads-workflow.spec.ts` and `people-company.spec.ts` cover the lead workflow and the person + company form.

## Put it online

| Option | Cost | Runs when | How |
|---|---|---|---|
| **Cloudflare quick tunnel** (demos) | Free | Only while this PC and the script run; new address each start | `powershell -ExecutionPolicy Bypass -File scripts/tunnel.ps1` |
| **Render + Vercel** (team use) | Render paid plan | 24/7, fixed address | [DEPLOY.md](DEPLOY.md) (`render.yaml`, `Dockerfile`, `apps/web/vercel.json`) |

**Tunnel** (needs `cloudflared`: `winget install --id Cloudflare.cloudflared`; stop the dev servers first): builds the
web app, opens the tunnel, starts the API in production mode on that address and the web app with `vite preview`,
then prints `Your CRM is live at: https://….trycloudflare.com`. Share that address; Ctrl+C stops everything.
Logs go to `.data/tunnel/`.

**Render + Vercel**: Vercel serves the web app and forwards `/api`, `/auth`, `/public` to the Render API. The API
runs the background jobs in-process (`RUN_JOBS_IN_PROCESS=true`) because a Render disk cannot be shared with a
separate worker. First admin on an empty production database: `pnpm --filter @crm/server bootstrap:admin`.

## Simulated parts

E-signature, AI and email are **simulated** by default. Production refuses to start with them unless
`ALLOW_SIMULATED_PROVIDERS=true` (demos only). In production mode the "Simulate sign" action is not available, so
signatures cannot be completed until a real provider is connected. See KNOWN-ISSUES.md before any real use.

## Recent changes

| Change | Where |
|---|---|
| Kensium branding: navy sidebar, logo, colours; Twenty-style typography in Inter; fixed text rendering too small | `apps/web/src/styles.css`, `main.tsx`, `lib/ui.tsx` |
| Terminology: People, Opportunities, Tasks | web pages |
| Proposals dashboard and per-proposal engagement analytics | `apps/web/src/pages/documents.tsx`, `listAllProposals` |
| Person form links or creates the company in one transaction | `crm.tsx` `CompanyField`, `createContact` |
| Leads: status tabs, next-step actions, details, reassign; conversion reuses existing companies; reopening clears the disqualify reason | `leads.tsx`, `convertLead`, `updateLead` |
| Fix: actions returning an empty response (Qualify, Reassign) no longer fail in the browser | `apps/web/src/lib/api.ts` |
| Admins can rename users; organization name and PDF footer set to Kensium | `patchUser`, organization settings |
| `db:reset:dev --demo`, Marvel seed and demo specs | `apps/server/src/cli/reset-dev.ts`, `e2e/` |
| Hosting: Dockerfile, Render Blueprint, Vercel config, `bootstrap:admin`, in-process jobs, Cloudflare tunnel script | `Dockerfile`, `render.yaml`, `apps/web/vercel.json`, `scripts/tunnel.ps1`, `DEPLOY.md` |

## Project records

| File | Contents |
|---|---|
| IMPLEMENTATION-STATUS.md | What is built and the latest verification results |
| REQUIREMENT-TRACEABILITY.md | Every BRD requirement → built / partial / simulated / not built, with test evidence |
| ARCHITECTURE-DECISIONS.md | Decisions made during the build and every deviation from the approved documents |
| KNOWN-ISSUES.md | Limitations and gaps |
| LOCAL-SETUP.md | How to install, run and test locally |
| DEPLOY.md | Render + Vercel hosting guide and checklist |
