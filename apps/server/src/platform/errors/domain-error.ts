import type { FieldError } from '@crm/shared';

/**
 * Services throw DomainError; the HTTP error mapper turns it into RFC 9457 problem JSON
 * (ERROR-HANDLING-AND-VALIDATION §5). Routes never build error responses by hand.
 */
export class DomainError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: string | undefined;
  readonly errors: FieldError[] | undefined;
  readonly meta: Record<string, unknown> | undefined;

  constructor(code: string, status: number, title: string, options: { detail?: string; errors?: FieldError[]; meta?: Record<string, unknown> } = {}) {
    super(title);
    this.name = 'DomainError';
    this.code = code;
    this.status = status;
    this.detail = options.detail;
    this.errors = options.errors;
    this.meta = options.meta;
  }
}
