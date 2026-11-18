import pg from 'pg';
import type { Config } from './config/env.ts';
import { createAuth } from './modules/identity.ts';
import { BrowserPdfRenderer, FakeESignProvider, LocalFsStorage, LogEmail, StubPdfRenderer } from './platform/adapters.ts';
import { AnthropicAiProvider } from './platform/anthropic.ts';
import { type AppContext, createDb } from './platform/core.ts';
import { createLogger } from './platform/logging/logger.ts';
import { MockAiProvider } from './platform/mock-ai.ts';

/**
 * Composition root (ADR-001): the only place where concrete drivers are chosen. Every runtime role
 * (server, worker, CLI, tests) builds its context here, so all of them share the same services.
 */
export function buildContext(config: Config, overrides: Partial<Pick<AppContext, 'pdf' | 'now' | 'ai'>> & { databaseUrl?: string } = {}) {
  const logger = createLogger(config.LOG_LEVEL);
  const pool = new pg.Pool({
    connectionString: overrides.databaseUrl ?? config.DATABASE_URL,
    max: config.DB_POOL_MAX,
    connectionTimeoutMillis: 5_000,
    application_name: `sales-crm-${config.PROCESS_ROLE}`,
  });
  const db = createDb(pool);
  const storage = new LocalFsStorage(config.STORAGE_DIR);
  const ctx: AppContext = {
    db,
    config,
    logger,
    storage,
    esign: new FakeESignProvider(storage, config.ESIGN_WEBHOOK_SECRET),
    // Choosing "anthropic" without a key does NOT silently fall back to the simulator: the provider reports
    // "not configured" and AI calls fail with a clear error, so nobody mistakes template text for model output.
    ai: overrides.ai ?? (config.AI_PROVIDER === 'anthropic' ? new AnthropicAiProvider({ apiKey: config.ANTHROPIC_API_KEY }) : new MockAiProvider()),
    email: new LogEmail(logger),
    pdf: overrides.pdf ?? (config.NODE_ENV === 'test' ? new StubPdfRenderer() : new BrowserPdfRenderer(config.PDF_BROWSER_CHANNEL)),
    now: overrides.now ?? (() => new Date()),
  };
  return { ctx, pool, auth: createAuth(db, config) };
}
