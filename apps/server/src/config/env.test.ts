import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig } from './env.ts';

const valid = {
  APP_ORIGIN: 'http://localhost:5173',
  BUYER_ORIGIN: 'http://proposals.localhost:5174',
  DATABASE_URL: 'postgres://crm_app:secret@localhost:5432/crm_dev',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  KEYRING_LOCAL_MASTER_KEY: 'ab'.repeat(32),
  ESIGN_WEBHOOK_SECRET: 'y'.repeat(16),
};

describe('parseConfig', () => {
  it('applies documented defaults', () => {
    const config = parseConfig(valid);
    expect(config.PORT).toBe(3000);
    expect(config.PROCESS_ROLE).toBe('server');
    expect(config.DB_POOL_MAX).toBe(10);
  });

  it('coerces numeric strings', () => {
    expect(parseConfig({ ...valid, PORT: '4000' }).PORT).toBe(4000);
  });

  it('fails fast with readable messages when required values are missing', () => {
    expect(() => parseConfig({})).toThrow(ConfigError);
    try {
      parseConfig({});
    } catch (error) {
      const issues = (error as ConfigError).issues.join('\n');
      expect(issues).toContain('APP_ORIGIN');
      expect(issues).toContain('DATABASE_URL');
    }
  });

  it('rejects a non-postgres database URL', () => {
    expect(() => parseConfig({ ...valid, DATABASE_URL: 'mysql://x' })).toThrow(/postgres/);
  });

  it('refuses to start production on simulated providers unless explicitly allowed', () => {
    expect(() => parseConfig({ ...valid, NODE_ENV: 'production' })).toThrow(/e-signature simulator is not legally valid/);
    try {
      parseConfig({ ...valid, NODE_ENV: 'production' });
    } catch (error) {
      expect((error as ConfigError).issues).toHaveLength(3); // e-signature, email, AI
    }
    expect(parseConfig({ ...valid, NODE_ENV: 'production', ALLOW_SIMULATED_PROVIDERS: 'true' }).ESIGN_PROVIDER).toBe('fake');
    expect(parseConfig({ ...valid, NODE_ENV: 'development' }).ESIGN_PROVIDER).toBe('fake');
  });

  it('requires an API key when a real AI provider is selected', () => {
    expect(() => parseConfig({ ...valid, AI_PROVIDER: 'anthropic' })).toThrow(/ANTHROPIC_API_KEY/);
    expect(parseConfig({ ...valid, AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-key-not-real' }).AI_PROVIDER).toBe('anthropic');
    // OpenAI-compatible provider: base URL, key and main model are all required; the fake provider needs none of them.
    expect(() => parseConfig({ ...valid, AI_PROVIDER: 'openai' })).toThrow(/AI_BASE_URL[^]*AI_API_KEY[^]*AI_MODEL_MAIN/);
    const openai = parseConfig({
      ...valid,
      AI_PROVIDER: 'openai',
      AI_BASE_URL: 'https://llm.example/v1/',
      AI_API_KEY: 'test-key-not-real',
      AI_MODEL_MAIN: 'm-main',
    });
    expect(openai.AI_PROVIDER).toBe('openai');
    expect(parseConfig({ ...valid, AI_PROVIDER: 'fake' }).AI_MODEL_MAIN).toBeUndefined();
    expect(() => parseConfig({ ...valid, AI_PRICES: '{not json' })).toThrow(/AI_PRICES/);
  });
});
