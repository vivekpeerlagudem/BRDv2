import { z } from 'zod';

/**
 * RFC 9457 problem details — the only error shape the API returns
 * (API-SPECIFICATION §1.3, ERROR-HANDLING-AND-VALIDATION.md).
 * `code` values come from the registry in BUSINESS-RULES.md §20.
 */
export const fieldErrorSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
});

export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'codes are UPPER_SNAKE (BUSINESS-RULES §20)'),
  detail: z.string().optional(),
  errors: z.array(fieldErrorSchema).optional(),
  requestId: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type FieldError = z.infer<typeof fieldErrorSchema>;
export type Problem = z.infer<typeof problemSchema>;

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** Error codes used by the platform foundation. Module codes are added as modules are built. */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  TEMPORARILY_UNAVAILABLE: 'TEMPORARILY_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export function problemTypeUri(code: string): string {
  return `https://crm.internal/errors/${code}`;
}
