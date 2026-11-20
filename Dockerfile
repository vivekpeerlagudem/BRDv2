# API + worker image for Railway / Render (the web app is deployed separately on Vercel).
# One image, three commands:
#   API (default):  pnpm --filter @crm/server serve
#   Worker:         pnpm --filter @crm/server worker
#   Migrations:     pnpm --filter @crm/server db:migrate      (run before each deploy)
#   First admin:    pnpm --filter @crm/server bootstrap:admin (once, on an empty database)
FROM node:26-bookworm-slim

ENV CI=true \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PDF_BROWSER_CHANNEL=chromium \
    STORAGE_DIR=/data/storage \
    PORT=3000

RUN corepack enable
WORKDIR /app

# Install dependencies first (cached until a package.json or the lockfile changes).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/proposal/package.json packages/proposal/
RUN pnpm install --frozen-lockfile

# Chromium for proposal PDFs (headless), with its system libraries.
RUN pnpm --filter @crm/server exec playwright-core install --with-deps chromium

COPY . .
RUN mkdir -p /data/storage
# Set only after install: with NODE_ENV=production pnpm would skip devDependencies (tsx runs the TypeScript server).
ENV NODE_ENV=production

EXPOSE 3000
CMD ["pnpm", "--filter", "@crm/server", "serve"]
