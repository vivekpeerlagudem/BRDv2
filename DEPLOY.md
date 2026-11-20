# Deploying the Sales CRM (Railway + Vercel)

```
Browser ──► Vercel (web app, global CDN)  crm.<your-domain>, proposals.<your-domain>
              │  /api /auth /public are forwarded (same origin, so sign-in cookies work)
              ▼
            Railway: API service ── PostgreSQL
                     Worker service ─┘   (+ volume /data for proposal PDFs)
```

The API and the worker are built by Railway from the `Dockerfile` in this repo. You do not need Docker locally.

> **Demo only, for now.** E-signature is the simulator and email is only logged (no real providers are built
> yet). The server refuses to start in production with them unless `ALLOW_SIMULATED_PROVIDERS=true`.

## 1. Secrets (generate once, keep them safe)

```bash
openssl rand -base64 48   # BETTER_AUTH_SECRET
openssl rand -hex 32      # KEYRING_LOCAL_MASTER_KEY (64 hex characters)
openssl rand -hex 24      # ESIGN_WEBHOOK_SECRET
```

Never change `KEYRING_LOCAL_MASTER_KEY` after go-live: it encrypts the stored share-link tokens.

## 2. Railway — database

1. New project → **Deploy PostgreSQL**. Pick the region closest to your users.
2. Open the database → **Data** → **Query**, and create the two roles the app uses
   (the migrator owns the tables; the app role cannot rewrite audit history):

```sql
CREATE ROLE crm_migrator LOGIN PASSWORD '<strong password 1>';
CREATE ROLE crm_app LOGIN PASSWORD '<strong password 2>';
GRANT ALL ON SCHEMA public TO crm_migrator;
GRANT USAGE ON SCHEMA public TO crm_app;
```

3. Note the database host, port and name from its **Connect** tab.

## 3. Railway — API service

1. **New → GitHub repo** → this repository (branch `main`, or the branch you deploy).
   Railway detects the `Dockerfile`.
2. **Variables**:

| Variable | Value |
|---|---|
| `APP_ORIGIN` | `https://crm.<your-domain>` |
| `BUYER_ORIGIN` | `https://proposals.<your-domain>` |
| `DATABASE_URL` | `postgresql://crm_app:<password 2>@<host>:<port>/<db>` |
| `DATABASE_URL_MIGRATOR` | `postgresql://crm_migrator:<password 1>@<host>:<port>/<db>` |
| `BETTER_AUTH_SECRET` | from step 1 |
| `KEYRING_LOCAL_MASTER_KEY` | from step 1 |
| `ESIGN_WEBHOOK_SECRET` | from step 1 |
| `ALLOW_SIMULATED_PROVIDERS` | `true` (demo) |
| `AI_PROVIDER` | `fake`, or `anthropic` with `ANTHROPIC_API_KEY` |

   (`NODE_ENV`, `PORT`, `STORAGE_DIR`, `PDF_BROWSER_CHANNEL` are set by the Dockerfile.)
3. **Settings → Deploy → Pre-deploy command**: `pnpm --filter @crm/server db:migrate`
4. **Volume**: attach one mounted at `/data` (proposal PDFs and signed documents live there).
5. **Networking → Generate domain** (e.g. `crm-api-production.up.railway.app`). This is the API host.
6. First admin (once): add `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` (12+ characters), `ORG_NAME`
   to the variables, then in the service's shell run `pnpm --filter @crm/server bootstrap:admin`.
   Remove `ADMIN_PASSWORD` afterwards. Add the other users from **Admin → Users** in the app.

## 4. Railway — worker service

**New → GitHub repo** → same repository again. Same variables as the API (Railway: *Shared variables* or copy them),
same volume is not needed. **Settings → Deploy → Custom start command**: `pnpm --filter @crm/server worker`.
It sends alerts and runs signing and automation jobs.

## 5. Vercel — web app

1. In `apps/web/vercel.json` replace `REPLACE-WITH-RAILWAY-API-HOST` with the API host from step 3.5 and
   `REPLACE-WITH-BUYER-DOMAIN` with `proposals.<your-domain>`. Commit and push.
2. Vercel → **Add New → Project** → import the repository → **Root Directory: `apps/web`** → Deploy.
3. **Settings → Domains**: add `crm.<your-domain>` and `proposals.<your-domain>`, then create the DNS records
   Vercel shows (CNAME to `cname.vercel-dns.com`) at your domain registrar.

## 6. Check

- `https://crm.<your-domain>` → sign in as the admin.
- Create a template, a proposal, send it, open the buyer link on `proposals.<your-domain>`, download the PDF.
- Railway logs: API shows `server listening` with `env: production`; the worker shows no errors.

## Updating

Push to the deployed branch: Railway rebuilds the API and worker (running migrations first) and Vercel rebuilds the
web app automatically.
