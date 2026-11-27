import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * Environment configuration (BACKEND-DESIGN §7). Parsed once at boot with Zod so the process
 * fails fast with a readable message instead of failing later on a missing value.
 * Secrets are never given defaults.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PROCESS_ROLE: z.enum(['server', 'worker', 'renderer', 'migrate', 'cli']).default('server'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_ORIGIN: z.url(),
  BUYER_ORIGIN: z.url(),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a postgres:// connection string'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  KEYRING_LOCAL_MASTER_KEY: z.string().regex(/^[0-9a-f]{64}$/, 'KEYRING_LOCAL_MASTER_KEY must be 64 hex characters'),
  STORAGE_DIR: z.string().default('./.data/storage'),
  ESIGN_PROVIDER: z.enum(['fake']).default('fake'),
  ESIGN_WEBHOOK_SECRET: z.string().min(16),
  /** fake = built-in simulator (default; tests and CI). openai = any OpenAI-compatible endpoint. anthropic = Claude API. */
  AI_PROVIDER: z.enum(['fake', 'openai', 'anthropic']).default('fake'),
  ANTHROPIC_API_KEY: z.string().optional(),
  /** OpenAI-compatible endpoint (OpenAI, Gemini's OpenAI endpoint, OpenRouter, Groq, Ollama). Needed for AI_PROVIDER=openai. */
  AI_BASE_URL: z.url().optional(),
  /** Secret. Used by AI_PROVIDER=openai, and by anthropic when ANTHROPIC_API_KEY is not set. Never logged. */
  AI_API_KEY: z.string().optional(),
  /** Kensium Copilot models: the chat loop, the cheap triage/summary model, and the offline eval judge. */
  AI_MODEL_MAIN: z.string().optional(),
  AI_MODEL_FAST: z.string().optional(),
  AI_MODEL_JUDGE: z.string().optional(),
  /** Optional reasoning effort sent to OpenAI-compatible providers that accept it (left out when not set). */
  AI_REASONING_EFFORT: z.enum(['none', 'minimal', 'low', 'medium', 'high']).optional(),
  /** Optional JSON: USD per million tokens for models missing from the built-in price table, e.g. {"m":{"input":0.3,"output":2.5}}. */
  AI_PRICES: z.string().optional(),
  // Model per AI feature (AI-IMPLEMENTATION-DESIGN §4). Override to re-route a feature without a code change.
  AI_MODEL_DRAFT: z.string().default('claude-sonnet-5-5'),
  AI_MODEL_SUMMARY: z.string().default('claude-sonnet-5-5'),
  AI_MODEL_FOLLOW_UP: z.string().default('claude-sonnet-5-5'),
  AI_MODEL_REWRITE: z.string().default('claude-haiku-5-5'),
  AI_MODEL_REVIEW: z.string().default('claude-opus-5-5'),
  AI_MODEL_WEEKLY: z.string().default('claude-sonnet-5-5'),
  AI_MODEL_SALES_BRIEF: z.string().default('claude-sonnet-5-5'),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(90000),
  AI_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(4).default(2),
  AI_RETRY_DELAY_MS: z.coerce.number().int().min(0).max(30000).default(1000),
  AI_RATE_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(20),
  TXEMAIL_PROVIDER: z.enum(['log']).default('log'),
  /** Where estimates (scope) sheets come from: CSV upload only, or also a read-only Google Sheets reader. */
  ESTIMATES_SOURCE: z.enum(['csv', 'google']).default('csv'),
  /** Service-account key file (JSON), base64-encoded. Secret: needed only when ESTIMATES_SOURCE=google. */
  GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: z.string().optional(),
  /** Where the approved weekly sales brief spreadsheet goes: a file download only, or also one Google Sheet. */
  SALES_BRIEF_SHEETS: z.enum(['file', 'google']).default('file'),
  /** The Google Sheet the sales brief is written to (shared with the service account as an Editor). */
  SALES_BRIEF_SPREADSHEET_ID: z.string().optional(),
  PDF_BROWSER_CHANNEL: z.string().default('msedge'),
  /** Explicit, logged opt-in to run production with stand-in providers (never appropriate for real customers). */
  ALLOW_SIMULATED_PROVIDERS: z.enum(['true', 'false']).default('false'),
  /**
   * Run the job outbox and scheduled scans inside the API process instead of a separate worker. For single-instance
   * hosts whose persistent disk cannot be shared between services (e.g. Render): the worker reads and writes the
   * same proposal and signature files as the API, so it must run where the disk is.
   */
  RUN_JOBS_IN_PROCESS: z.enum(['true', 'false']).default('false'),
});

export type Config = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid environment configuration:\n- ${issues.join('\n- ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/** Pure: parse a plain record (used by tests and by loadConfig). */
export function parseConfig(source: Record<string, string | undefined>): Config {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`));
  }
  const issues = productionProviderIssues(result.data);
  if (issues.length > 0) throw new ConfigError(issues);
  return result.data;
}

/**
 * Production must not start on stand-in providers by accident: a simulated signature is not legally valid, logged
 * email never reaches anyone, and the AI mock returns template text. Each is refused unless the operator sets
 * ALLOW_SIMULATED_PROVIDERS=true (for example on a demo system), and a real AI provider needs its key.
 */
export function productionProviderIssues(config: Config): string[] {
  const issues: string[] = [];
  if (config.AI_PROVIDER === 'anthropic' && !config.ANTHROPIC_API_KEY && !config.AI_API_KEY)
    issues.push('ANTHROPIC_API_KEY: required when AI_PROVIDER=anthropic');
  if (config.AI_PROVIDER === 'openai') {
    if (!config.AI_BASE_URL) issues.push('AI_BASE_URL: required when AI_PROVIDER=openai');
    if (!config.AI_API_KEY) issues.push('AI_API_KEY: required when AI_PROVIDER=openai');
    if (!config.AI_MODEL_MAIN) issues.push('AI_MODEL_MAIN: required when AI_PROVIDER=openai');
  }
  if (config.AI_PRICES) {
    try {
      JSON.parse(config.AI_PRICES);
    } catch {
      issues.push('AI_PRICES: must be valid JSON');
    }
  }
  if (config.ESTIMATES_SOURCE === 'google' && !config.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64)
    issues.push('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: required when ESTIMATES_SOURCE=google');
  if (config.SALES_BRIEF_SHEETS === 'google' && !config.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64)
    issues.push('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: required when SALES_BRIEF_SHEETS=google');
  if (config.SALES_BRIEF_SHEETS === 'google' && !config.SALES_BRIEF_SPREADSHEET_ID)
    issues.push('SALES_BRIEF_SPREADSHEET_ID: required when SALES_BRIEF_SHEETS=google');
  if (config.NODE_ENV !== 'production' || config.ALLOW_SIMULATED_PROVIDERS === 'true') return issues;
  if (config.ESIGN_PROVIDER === 'fake') issues.push('ESIGN_PROVIDER: the e-signature simulator is not legally valid and cannot be used in production (OD-03)');
  if (config.TXEMAIL_PROVIDER === 'log') issues.push('TXEMAIL_PROVIDER: "log" does not send email and cannot be used in production (OD-14)');
  if (config.AI_PROVIDER === 'fake') issues.push('AI_PROVIDER: the AI mock returns template text and cannot be used in production (OD-05)');
  return issues;
}

/** Repository-root .env.local (development only; production injects real environment variables). */
const ROOT_ENV_FILE = fileURLToPath(new URL('../../../../.env.local', import.meta.url));

/** Impure: loads .env.local if present, then parses process.env. */
export function loadConfig(): Config {
  if (existsSync(ROOT_ENV_FILE)) {
    process.loadEnvFile(ROOT_ENV_FILE);
  }
  return parseConfig(process.env);
}
