/**
 * Spreadsheet publishers for the Weekly Sales Brief (port: SpreadsheetPublisher in ports.ts).
 *  - FileOnlyPublisher        default: the brief is an .xlsx download only; nothing is sent anywhere.
 *  - GoogleSheetsPublisher    writes the approved brief's tabs into ONE Google Sheet (SALES_BRIEF_SPREADSHEET_ID).
 *
 * The Google publisher uses no SDK: a service-account JWT (RS256, node:crypto) is exchanged for a short-lived
 * access token with the Sheets scope, missing tabs are added, and each tab is cleared and rewritten with RAW
 * values (never USER_ENTERED, so no cell is ever evaluated as a formula). The sheet must be shared with the
 * service-account email as an Editor. Keys and tokens are never logged or put in error messages.
 */
import { createSign } from 'node:crypto';
import { DomainError } from './errors/domain-error.ts';
import type { SheetTab, SpreadsheetPublisher, SpreadsheetPublisherStatus } from './ports.ts';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const TIMEOUT_MS = 20_000;

export class FileOnlyPublisher implements SpreadsheetPublisher {
  readonly name = 'file';
  readonly enabled = false;
  async publish(): Promise<{ url: string | null }> {
    throw new DomainError('SALES_BRIEF_SHEETS_NOT_CONFIGURED', 422, 'Publishing to Google Sheets is not set up. Download the Excel file instead.');
  }
  status(): SpreadsheetPublisherStatus {
    return { provider: this.name, configured: true, detail: 'The sales brief spreadsheet is a file download (.xlsx)' };
  }
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
}
type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<Response>;
const base64url = (data: string | Buffer) => Buffer.from(data).toString('base64url');
const quoted = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

export class GoogleSheetsPublisher implements SpreadsheetPublisher {
  readonly name = 'google';
  readonly enabled = true;
  private readonly account: ServiceAccount | null;
  private readonly spreadsheetId: string | null;
  private readonly fetchFn: FetchLike;
  private readonly now: () => number;

  constructor(opts: { credentialsBase64?: string | undefined; spreadsheetId?: string | undefined; fetch?: FetchLike; now?: () => number }) {
    this.fetchFn = opts.fetch ?? ((url, init) => fetch(url, init));
    this.now = opts.now ?? (() => Date.now());
    this.spreadsheetId = opts.spreadsheetId?.trim() || null;
    this.account = GoogleSheetsPublisher.parseAccount(opts.credentialsBase64);
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

  status(): SpreadsheetPublisherStatus {
    if (!this.account) return { provider: this.name, configured: false, detail: 'GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is missing or not a service-account key' };
    if (!this.spreadsheetId) return { provider: this.name, configured: false, detail: 'SALES_BRIEF_SPREADSHEET_ID is missing' };
    return { provider: this.name, configured: true, detail: `Writes the approved brief to a sheet shared with ${this.account.client_email}` };
  }

  private async call(url: string, token: string, method: string, body?: unknown): Promise<Response> {
    try {
      return await this.fetchFn(url, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new DomainError('SALES_BRIEF_SHEETS_UNAVAILABLE', 502, 'Google Sheets could not be reached. Try again later.');
    }
  }

  private async accessToken(account: ServiceAccount): Promise<string> {
    const iat = Math.floor(this.now() / 1000);
    const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(
      JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }),
    )}`;
    let assertion: string;
    try {
      assertion = `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(account.private_key).toString('base64url')}`;
    } catch {
      throw new DomainError('SALES_BRIEF_SHEETS_AUTH_FAILED', 502, 'The Google service-account key could not be used. Ask an administrator to check it.');
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
      throw new DomainError('SALES_BRIEF_SHEETS_UNAVAILABLE', 502, 'Google could not be reached. Try again later.');
    }
    const body = (await res.json().catch(() => null)) as { access_token?: unknown } | null;
    if (!res.ok || typeof body?.access_token !== 'string')
      throw new DomainError('SALES_BRIEF_SHEETS_AUTH_FAILED', 502, 'Google did not accept the service-account key. Ask an administrator to check it.');
    return body.access_token;
  }

  async publish(tabs: SheetTab[]): Promise<{ url: string | null }> {
    const { account, spreadsheetId } = this;
    if (!account || !spreadsheetId) throw new DomainError('SALES_BRIEF_SHEETS_NOT_CONFIGURED', 422, 'Publishing to Google Sheets is not set up.');
    const token = await this.accessToken(account);
    const base = `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}`;
    const fail = (res: Response) => {
      if (res.status === 403)
        return new DomainError(
          'SALES_BRIEF_SHEET_NOT_SHARED',
          422,
          `The sheet is not shared with ${account.client_email}. Share it with that address as an Editor.`,
        );
      if (res.status === 404) return new DomainError('SALES_BRIEF_SHEET_NOT_FOUND', 422, 'The Google Sheet was not found. Check SALES_BRIEF_SPREADSHEET_ID.');
      return new DomainError('SALES_BRIEF_SHEETS_UNAVAILABLE', 502, 'Google Sheets returned an error. Try again later.');
    };

    // 1. Which tabs exist already?
    const meta = await this.call(`${base}?fields=sheets.properties.title`, token, 'GET');
    if (!meta.ok) throw fail(meta);
    const existing = new Set(
      (((await meta.json().catch(() => null)) as { sheets?: { properties?: { title?: string } }[] } | null)?.sheets ?? []).map(
        (s) => s.properties?.title ?? '',
      ),
    );
    // 2. Add the missing ones.
    const missing = tabs.filter((t) => !existing.has(t.name));
    if (missing.length) {
      const added = await this.call(`${base}:batchUpdate`, token, 'POST', { requests: missing.map((t) => ({ addSheet: { properties: { title: t.name } } })) });
      if (!added.ok) throw fail(added);
    }
    // 3. Clear every tab, then write header + rows as RAW values (nothing is evaluated as a formula).
    const cleared = await this.call(`${base}/values:batchClear`, token, 'POST', { ranges: tabs.map((t) => quoted(t.name)) });
    if (!cleared.ok) throw fail(cleared);
    const written = await this.call(`${base}/values:batchUpdate`, token, 'POST', {
      valueInputOption: 'RAW',
      data: tabs.map((t) => ({
        range: `${quoted(t.name)}!A1`,
        majorDimension: 'ROWS',
        values: [t.columns.map((c) => c.header), ...t.rows.map((r) => r.map((v) => (v === null ? '' : v)))],
      })),
    });
    if (!written.ok) throw fail(written);
    return { url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}` };
  }
}
