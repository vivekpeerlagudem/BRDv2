import { type Logger, pino } from 'pino';

/**
 * Structured JSON logging (ADR-017). Redaction paths follow SECURITY-ARCHITECTURE SC-APP-20:
 * credentials, tokens and secrets must never reach logs.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.secret',
  '*.code',
  '*Ciphertext',
];

export function createLogger(level: string): Logger {
  return pino({
    level,
    base: { service: 'sales-crm' },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type { Logger };
