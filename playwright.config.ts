import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Secrets (the seeded demo password) come from .env.local, never from source.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

/**
 * End-to-end tests drive the real web app, API, PostgreSQL and the Edge PDF renderer.
 * They use the system Microsoft Edge (no browser download) and run against the DEVELOPMENT database:
 * every record they create has a unique "E2E <timestamp>" name and nothing existing is changed or deleted.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5273', channel: 'msedge', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: [
    { command: 'pnpm dev:server', url: 'http://localhost:3000/readyz', reuseExistingServer: true, timeout: 60_000 },
    { command: 'pnpm dev:web', url: 'http://localhost:5273', reuseExistingServer: true, timeout: 60_000 },
  ],
});
