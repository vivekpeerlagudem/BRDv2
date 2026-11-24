/**
 * Estimates sources (port: EstimatesSource in ports.ts).
 *  - CsvOnlyEstimatesSource        default: estimates arrive only as uploaded CSV; reading a sheet is refused.
 *  - GoogleSheetsEstimatesSource   READ-ONLY reader for a client's estimates sheet in Google Sheets.
 *
 * The Google reader uses no SDK: a service-account JWT (RS256, signed with node:crypto) is exchanged for a short-lived
 * access token with the read-only Sheets scope, then one `values.get` call reads the range. It can only read sheets
 * that were shared with the service-account email. Keys and tokens are never logged or put in error messages.
 */
import { createSign } from 'node:crypto';
import { DomainError } from './errors/domain-error.ts';
import type { EstimatesSource, EstimatesSourceStatus } from './ports.ts';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const TIMEOUT_MS = 15_000;

export class CsvOnlyEstimatesSource implements EstimatesSource {
  readonly name = 'csv';
  readonly simulated = false;
  async fetchRows(): Promise<string[][]> {
    throw new DomainError('ESTIMATES_SOURCE_NOT_CONFIGURED', 422, 'Reading estimates from Google Sheets is not set up. Upload the sheet as a CSV file.');
  }
  status(): EstimatesSourceStatus {
    return { provider: this.name, simulated: false, configured: true, detail: 'Estimates are uploaded as CSV files' };
  }
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
}
type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<Response>;
const base64url = (data: string | Buffer) => Buffer.from(data).toString('base64url');

/** The spreadsheet id from a docs.google.com URL, or the id itself. Null when it is neither. */
export function parseSpreadsheetId(input: string): string | null {
  const text = input.trim();
  const fromUrl = /docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(text);
  if (fromUrl) return fromUrl[1] as string;
  return /^[A-Za-z0-9_-]{20,}$/.test(text) ? text : null;
}

export class GoogleSheetsEstimatesSource implements EstimatesSource {
  readonly name = 'google';
  readonly simulated = false;
  private readonly account: ServiceAccount | null;
  private readonly fetchFn: FetchLike;
  private readonly now: () => number;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(opts: { credentialsBase64?: string | undefined; fetch?: FetchLike; now?: () => number }) {
    this.fetchFn = opts.fetch ?? ((url, init) => fetch(url, init));
    this.now = opts.now ?? (() => Date.now());
    this.account = GoogleSheetsEstimatesSource.parseAccount(opts.credentialsBase64);
  }

  private static parseAccount(credentialsBase64: string | undefined): ServiceAccount | null {
    if (!credentialsBase64) return null;
    try {
      const json = JSON.parse(Buffer.from(credentialsBase64, 'base64').toString('utf8')) as Partial<ServiceAccount>;
      return typeof json.client_email === 'string' && typeof json.private_key === 'string'
        ? { client_email: json.client_email, private_key: json.private_key }
        : null;
    } catch {
      return null; // reported by status(); the content is never echoed
    }
  }

  status(): EstimatesSourceStatus {
    return this.account
      ? { provider: this.name, simulated: false, configured: true, detail: `Reads sheets shared with ${this.account.client_email} (read-only)` }
      : { provider: this.name, simulated: false, configured: false, detail: 'GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is missing or not a service-account key' };
  }

  private async accessToken(account: ServiceAccount): Promise<string> {
    const nowMs = this.now();
    if (this.token && this.token.expiresAt - 60_000 > nowMs) return this.token.value;
    const iat = Math.floor(nowMs / 1000);
    const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(
      JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }),
    )}`;
    let assertion: string;
    try {
      assertion = `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(account.private_key).toString('base64url')}`;
    } catch {
      throw new DomainError('ESTIMATES_SOURCE_AUTH_FAILED', 502, 'The Google service-account key could not be used. Ask an administrator to check it.');
    }
    let res: Response;
    try {
      res = await this.fetchFn(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new DomainError('ESTIMATES_SOURCE_UNAVAILABLE', 502, 'Google could not be reached. Try again later.');
    }
    const body = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
    if (!res.ok || typeof body?.access_token !== 'string')
      throw new DomainError('ESTIMATES_SOURCE_AUTH_FAILED', 502, 'Google did not accept the service-account key. Ask an administrator to check it.');
    this.token = { value: body.access_token, expiresAt: nowMs + (typeof body.expires_in === 'number' ? body.expires_in : 3600) * 1000 };
    return this.token.value;
  }

  async fetchRows(ref: { spreadsheetId: string; range: string }): Promise<string[][]> {
    const account = this.account;
    if (!account) throw new DomainError('ESTIMATES_SOURCE_NOT_CONFIGURED', 422, 'Reading estimates from Google Sheets is not set up.');
    const token = await this.accessToken(account);
    let res: Response;
    try {
      res = await this.fetchFn(`${SHEETS_API}/${encodeURIComponent(ref.spreadsheetId)}/values/${encodeURIComponent(ref.range)}?majorDimension=ROWS`, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new DomainError('ESTIMATES_SOURCE_UNAVAILABLE', 502, 'Google Sheets could not be reached. Try again later.');
    }
    if (res.status === 403)
      throw new DomainError('ESTIMATES_SHEET_NOT_SHARED', 422, `The sheet is not shared with ${account.client_email}. Share it with that address as a Viewer.`);
    if (res.status === 404) throw new DomainError('ESTIMATES_SHEET_NOT_FOUND', 422, 'The Google Sheet was not found. Check the link.');
    if (res.status === 400) throw new DomainError('ESTIMATES_SHEET_RANGE_INVALID', 422, 'The range is not valid for this sheet, for example use A1:Z2000.');
    if (res.status === 401) {
      this.token = null;
      throw new DomainError('ESTIMATES_SOURCE_AUTH_FAILED', 502, 'Google did not accept the access. Try again.');
    }
    if (!res.ok) throw new DomainError('ESTIMATES_SOURCE_UNAVAILABLE', 502, 'Google Sheets returned an error. Try again later.');
    const body = (await res.json().catch(() => null)) as { values?: unknown } | null;
    const values = Array.isArray(body?.values) ? body.values : [];
    return values.map((row) => (Array.isArray(row) ? row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))) : []));
  }
}
