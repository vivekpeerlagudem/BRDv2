# Local setup (Windows 11, no Docker)

Everything runs on this machine: PostgreSQL, the API, the web app. No GitHub, no cloud service, no real email, no real e-signature.

## 1. Prerequisites
| Tool | Version used | Check |
|---|---|---|
| Node.js | 26.x | `node -v` |
| pnpm | 10.34.9 (pinned in `package.json`) | `pnpm -v` |
| PostgreSQL | 18.x, installed natively, service running | `"C:\Program Files\PostgreSQL\18\bin\psql" --version` |
| Microsoft Edge | any current version | used to render PDFs and to run browser tests — no browser download needed |

## 2. Install
```
pnpm install
```

## 3. Database (one time)
Two roles are used: `crm_migrator` owns the schema; `crm_app` can only read and write data, and cannot edit or delete audit-log and timeline rows.

Run as the PostgreSQL superuser (replace the two passwords with your own; they are not stored in the repository):
```sql
CREATE ROLE crm_migrator LOGIN PASSWORD '<migrator-password>';
CREATE ROLE crm_app      LOGIN PASSWORD '<app-password>';
CREATE DATABASE crm_dev  OWNER crm_migrator;
CREATE DATABASE crm_test OWNER crm_migrator;
-- then, connected to EACH of crm_dev and crm_test:
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```
On the original development machine this is already done.

## 4. Environment file
```
copy .env.example .env.local
```
Edit `.env.local`: put the two passwords into the four database URLs and generate the three secrets (command is in the file). `.env.local` is ignored by version control.

## 5. Create tables and demo data
```
pnpm db:check      # can the app reach PostgreSQL?
pnpm db:migrate    # creates/updates tables (never drops data)
pnpm db:seed       # demo organisation, users, template, products, deals — only on an empty database
```
`pnpm db:seed` writes the demo password to `.env.local` as `SEED_PASSWORD` (it is not printed and not in source code).

Demo sign-ins (all use `SEED_PASSWORD`):
| Email | Role |
|---|---|
| admin@northwind.example | Admin |
| morgan@northwind.example | Sales Manager (may manage templates and catalogue) |
| riley@northwind.example | Salesperson |
| jordan@northwind.example | Salesperson |

## 6. Run
Two terminals:
```
pnpm dev:server    # API on http://localhost:3000  (health: /healthz, /readyz)
pnpm dev:web       # Web app on http://localhost:5273
```
Open http://localhost:5273. In development the API process also runs background jobs every few seconds, so no separate worker is needed (`pnpm dev:worker` exists for running it separately).

Buyer links look like `http://proposals.localhost:5273/p#<token>` — browsers resolve `*.localhost` automatically; nothing to configure.

Port 5273 is used because another application on the original machine already uses 5173. To change it, edit `apps/web/vite.config.ts` and the two `*_ORIGIN` values in `.env.local` together.

## 7. Checks
| Command | What it does | Needs |
|---|---|---|
| `pnpm typecheck` | TypeScript in every package | — |
| `pnpm lint` | Biome lint + format check | — |
| `pnpm test` | Unit + integration tests (98). Migrates and uses the `crm_test` database | PostgreSQL |
| `pnpm build` | Builds server and web | — |
| `pnpm verify` | The four above, in order | PostgreSQL |
| `pnpm test:e2e` | 9 browser tests through the real UI (starts the servers if they are not running) | PostgreSQL, Edge, seeded dev database |

The browser tests run against the **development** database. They only add records named `E2E …`; they never change or delete existing data.

## 8. Trying the simulated parts by hand
- **E-signature:** after "Request signatures…", the proposal page shows *Simulate sign / Simulate decline* buttons for each signer. These exist only with `ESIGN_PROVIDER=fake` outside production.
- **AI features (all on the built-in mock by default — no network, no cost):**
  - Proposal editor: *Draft with AI* on a section, *Draft N empty sections with AI*, select text → *Rewrite selection*, *Review with AI*.
  - Deal page: *Summarise this deal with AI*, *Follow-up email…*.
  - *AI activity* (everyone) shows your requests and decisions; *AI settings* (Admin) has the switches, limits and usage.
  - Every result is labelled "simulator" and nothing is applied until you accept it.
- **Using a real AI model:** set `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` in `.env.local` and restart the server. This sends CRM text to the provider and costs money — it needs the owner's approval, and it has not been tried in this build.
- **Email:** notification emails are written to the server log, not sent. Proposal links are copied and pasted into your own email by hand.
- **Files:** PDFs, DOCX files and signed documents are stored under `.data/storage/`.

## 9. Troubleshooting
| Symptom | Cause / fix |
|---|---|
| `pnpm db:check` fails | PostgreSQL service not running, or wrong password in `.env.local` |
| Login says "Too many attempts" | Sign-in is rate-limited; wait about 10 seconds |
| Sending a proposal fails with a PDF error | Microsoft Edge is missing or blocked; PDFs are rendered by the installed Edge |
| `pnpm install` is very slow | The project folder is inside OneDrive; pause OneDrive sync during installs |
| Port already in use | Another program uses 3000 or 5273; stop it or change the port (section 6) |

## 10. Weekly reports — demo steps
Needs the migrations up to `0008` (`pnpm db:migrate`) and both dev servers running. Everything uses the AI simulator.

1. Sign in as the admin. **AI settings** → AI must be on and the **Weekly client report** feature switched on (otherwise the text is placeholders you write yourself).
2. **Companies** → open a company you own (or any company as admin).
3. In the **Weekly reports** card choose `e2e/fixtures/estimates-sample.csv` → **Upload estimates CSV**. The card shows "8 scope items · 220 h".
4. Optional, to see progress: create tasks on that company whose title contains a scope id from the sheet, for example `[S-003] Data migration`, and complete one.
5. **Generate now**. The run shows "Queued" or "Generating…" and becomes "Ready for review" or "Needs attention" within a few seconds (the dev API runs jobs itself).
6. **Open** → the report page: figures, summary, completed, next week, risks, each sentence with its sources.
7. **Edit** a sentence → **Save** (it gets the "Edited" label). **Add sentence** adds your own. **Regenerate** replaces all text with a new AI draft; the figures stay.
8. **Approve** → tick "I checked the flagged figures" if the dialog shows warnings → **Approve report**.
9. **Download final** → `<Client>_Weekly_Status_<week end>_v1.pptx`. Open it in PowerPoint.
10. **Weekly reports** in the sidebar lists all reports you may see. **Settings → Weekly reports** (admin) sets the weekday and time of the automatic run (default Monday 09:00, organization time zone).

A salesperson sees only reports of companies they own; a sales manager sees their team's.

Google Sheets instead of CSV (optional, read-only): see DEPLOY.md "Estimates from Google Sheets". Locally set `ESTIMATES_SOURCE=google` and `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` in `.env.local`, restart the server, then use **Link Google Sheet** and **Sync now** on the company card. This has not been tried against Google in this build.
