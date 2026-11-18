# Dependency Plan — Internal Sales CRM (Phase 1)

**Nothing in this document is installed yet.** Versions are the latest published on the npm registry on 2026-11-17 (checked read-only). At project start: install with exact versions (`pnpm add -E`), commit `pnpm-lock.yaml`, and let Renovate propose weekly updates behind the CI gate. Major upgrades require an ADR note if they change behaviour.

## 1. Workspace root (`package.json`, dev only)
| Package | Version | Purpose |
|---|---|---|
| `typescript` | 7.0.x (fallback 6.x) | Compiler / typecheck (`tsc -b`) |
| `@biomejs/biome` | 2.6.x | Lint + format |
| `dependency-cruiser` | 18.8.x | Module boundary rules (ADR-021) |
| `vitest` | 5.1.x | Test runner (workspace mode) |
| `@vitest/coverage-v8` | match vitest | Coverage |
| `@playwright/test` | 1.65.x | E2E, visual, a11y |
| `@axe-core/playwright` | 4.14.x | Accessibility assertions |
| `fast-check` | 4.10.x | Property-based tests (pricing, state machines) |
| `tsx` | 4.23.x | Run TS scripts / watch mode |
| `cross-env`, `rimraf`, `concurrently` | latest | Windows-friendly scripts |
| `openapi-typescript` | 7.13.x | Generate API types for the web client |
| `renovate` (config only) | — | Dependency updates |

## 2. `packages/shared`
| Package | Version | Purpose |
|---|---|---|
| `zod` | 4.6.x | Contracts, validation |
| `decimal.js` | 10.6.x | Money/pricing math (shared with web) |
| `date-fns`, `date-fns-tz` | 4.4.x / 3.2.x | Date logic in org TZ |
| `libphonenumber-js` | 1.13.x | Phone validation (SMS signer) |

## 3. `packages/proposal`
| Package | Version | Purpose |
|---|---|---|
| `prosemirror-model` | 1.25.x | Schema + document validation (server-side, no DOM) |
| `react`, `react-dom` | 19.3.x (peer) | HTML renderer (`renderToStaticMarkup`) shared with buyer view |
| `docx` | 9.15.x | DOCX generation |
| `canonicalize` | 5.1.x | RFC 8785 canonical JSON for snapshot hashing |
| `diff` | 9.0.x | Version comparison |
| `nanoid` | 6.0.x | Section/line ids |

## 4. `apps/server`
| Package | Version | Purpose |
|---|---|---|
| `hono` | 4.13.x | HTTP framework |
| `@hono/node-server` | 2.1.x | Node adapter |
| `@hono/zod-openapi` | 1.6.x | Validated routes + OpenAPI 3.1 |
| `drizzle-orm` | 0.45.x | ORM |
| `drizzle-kit` (dev) | 0.31.x | Migration generation |
| `pg` (+ `@types/pg` dev) | 8.23.x | PostgreSQL driver, LISTEN/NOTIFY |
| `pg-boss` | 12.x | Jobs, schedules, DLQ |
| `better-auth` | 1.7.x | Authentication (twoFactor, bearer plugins) |
| `uuid` | 14.x | UUIDv7 generation (PG 17 fallback) |
| `pino` (+ `pino-pretty` dev) | 10.x | Logging |
| `@sentry/node` | 11.x | Error tracking (if OD-98 selects Sentry) |
| `@opentelemetry/sdk-node` + auto-instrumentations | 0.30x | Tracing (optional exporter) |
| `undici` | 8.x | Provider HTTP client wrapper |
| `@anthropic-ai/sdk` | 1.9.x | Claude API (AiProvider driver) |
| `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` | 3.11xx | S3/MinIO storage driver |
| `@azure/storage-blob` + `@azure/identity` | 12.34.x | Only if OD-11 = Azure |
| `@azure/keyvault-keys` / `@aws-sdk/client-kms` | current | Keyring wrap/unwrap (one, per OD-11) |
| `googleapis` (or `@googleapis/gmail`, `@googleapis/calendar`) | current | Gmail/Calendar driver (only if company uses Google, OD-06) |
| `google-auth-library` | current | Verify Google ID tokens (login hd, Gmail add-on) |
| `@microsoft/microsoft-graph-client` + `@azure/msal-node` | current | Graph driver + Entra token validation (only if Microsoft, OD-06) |
| `jose` | current | JWT/JWKS verification (NAA tokens) |
| `dompurify` + `jsdom` | 3.4.x / 31.x | Server-side HTML sanitisation of email bodies |
| `html-to-text` | 10.x | Email/notes → plain text for AI and search |
| `nodemailer` | 10.x | RFC 5322 composition (Gmail raw send), SMTP driver if OD-14 = SMTP |
| `@react-email/components`, `@react-email/render` | 1.0.x / 2.3.x | Notification/digest/OTP email templates |
| `mammoth` | 1.13.x | DOCX → HTML for template import |
| `exceljs` | 4.4.x | XLSX import, report export |
| `papaparse` | 5.7.x | CSV import/export |
| `sharp` | 0.35.x | Image validation/re-encode |
| `file-type` | 22.x | Magic-byte MIME detection |
| E-sign provider SDK | per OD-03 | Only if the provider's SDK is maintained; else plain HTTP via `undici` |
| Transactional email SDK | per OD-14 | e.g. `@aws-sdk/client-sesv2` / `postmark` / `@azure/communication-email` |

Renderer-only (same package, `crm-renderer` image): `playwright` 1.65.x with Chromium installed in the image (`npx playwright install --with-deps chromium` during image build), bundled fonts.

## 5. `apps/web`
| Package | Version | Purpose |
|---|---|---|
| `react`, `react-dom` | 19.3.x | UI |
| `vite`, `@vitejs/plugin-react` (dev) | 8.3.x / 6.3.x | Build/dev server, multi-page |
| `@tanstack/react-router`, `@tanstack/router-plugin` (dev) | 1.170.x / 1.169.x | Routing (file-based) |
| `@tanstack/react-query` (+ devtools dev) | 5.108.x | Server state |
| `@tanstack/react-table`, `@tanstack/react-virtual` | 9.3.x / 3.14.x | Tables |
| `@tanstack/react-form` (+ zod adapter as required by the version) | 1.33.x | Forms |
| `tailwindcss`, `@tailwindcss/vite` | 4.3.x | Styling |
| shadcn/ui CLI (dev, `npx shadcn@latest add …`) + Radix packages it pulls (`@radix-ui/*`), `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css` | current | Components copied into `src/shared/ui` |
| `lucide-react` | current | Icons |
| `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-table` (+ row/cell/header), `@tiptap/extension-image`, `@tiptap/extension-link`, `@tiptap/extension-text-align`, `@tiptap/extension-color`, `@tiptap/extension-highlight`, `@tiptap/extension-underline` | 3.34.x | Editors (open-source extensions only) |
| `@dnd-kit/core`, `@dnd-kit/sortable` | 6.3.x / current | Board and section reordering |
| `recharts` | 3.10.x | Dashboards |
| `openapi-fetch` | 0.17.x | Typed API client |
| `date-fns`, `date-fns-tz` | as shared | Dates |
| `sonner` | current | Toasts (shadcn) |
| `@azure/msal-browser` | current | Outlook add-in NAA (addin entry only) |
| `@sentry/react` | 11.x | Front-end error tracking (OD-98) |
| `@testing-library/react`, `@testing-library/user-event`, `jsdom` (dev) | current | Component tests |

## 6. Not added (and why)
| Package | Reason |
|---|---|
| Redis clients, BullMQ | No Redis (ADR-019) |
| Prisma | Drizzle chosen |
| Express / NestJS | Hono chosen |
| Puppeteer | Playwright already provides Chromium automation |
| Moment.js | date-fns |
| Lodash (full) | Native ES + small utils |
| TipTap Pro extensions | Paid, not needed (ADR-029) |
| LibreOffice / unoconv | Heavy; DOCX via `docx`/`mammoth` |

## 7. Installation order at project start (later phase)
1. Root tooling → 2. `packages/shared` → 3. `packages/proposal` → 4. `apps/server` core (hono, drizzle, pg, pg-boss, better-auth, zod) → 5. `apps/web` core (react, vite, TanStack, tailwind, shadcn) → 6. renderer (playwright) → 7. integration drivers only for the decided providers (OD-03/05/06/11/14) → 8. observability. Each step ends with `pnpm -r typecheck && pnpm -r test`.

## 8. Supply-chain controls
Lockfile committed; `pnpm install --frozen-lockfile` in CI; `onlyBuiltDependencies` allow-list (sharp, playwright, esbuild-based tools); OSV/`pnpm audit` gate on High; Renovate grouping (TanStack, Tiptap, AWS SDK, Better Auth); SBOM (CycloneDX) generated per image; no packages from unknown publishers without review.
