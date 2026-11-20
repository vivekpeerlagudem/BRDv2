import { type FieldError, problemSchema } from '@crm/shared';

/** API errors always arrive as RFC 9457 problem JSON; this class is what pages catch and display. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly errors: FieldError[];
  readonly meta: Record<string, unknown>;
  constructor(status: number, code: string, message: string, errors: FieldError[] = [], meta: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.errors = errors;
    this.meta = meta;
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    // Never read from or write to the browser's HTTP cache: the authenticated user's role/permissions must
    // always come fresh from the server, so a refresh or an account switch can never show a stale role.
    cache: 'no-store',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
  const parsed = problemSchema.safeParse(await res.json().catch(() => null));
  if (res.status === 401 && path.startsWith('/api/') && !location.pathname.startsWith('/login')) location.assign('/login');
  if (parsed.success) throw new ApiError(res.status, parsed.data.code, parsed.data.title, parsed.data.errors ?? [], parsed.data.meta ?? {});
  const fallback: Record<number, string> = { 401: 'Email or password is incorrect', 429: 'Too many attempts. Please wait a moment and try again.' };
  throw new ApiError(res.status, res.status === 429 ? 'RATE_LIMITED' : 'UNKNOWN', fallback[res.status] ?? `Request failed (${res.status})`);
}
export const get = <T>(path: string) => api<T>('GET', `/api/v1${path}`);
export const post = <T>(path: string, body: unknown = {}) => api<T>('POST', `/api/v1${path}`, body);
export const put = <T>(path: string, body: unknown) => api<T>('PUT', `/api/v1${path}`, body);
export const patch = <T>(path: string, body: unknown) => api<T>('PATCH', `/api/v1${path}`, body);
export const del = <T>(path: string) => api<T>('DELETE', `/api/v1${path}`);

export const money = (amount: string | number | null | undefined, currency = 'USD') =>
  amount === null || amount === undefined
    ? '—'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(amount));
export const dateTime = (v: string | null | undefined) => (v ? new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const dateOnly = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—');
export const personName = (p: { firstName?: string | null; lastName?: string | null; email?: string | null }) =>
  [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email || 'Unnamed';

export interface Me {
  user: { id: string; fullName: string; role: 'admin' | 'sales_manager' | 'salesperson' };
  permissions: Record<string, boolean>;
  settings: { organizationName: string; currency: string; aiEnabled: boolean; leadFormKey?: string; esignSimulated: boolean; aiSimulated: boolean };
}
