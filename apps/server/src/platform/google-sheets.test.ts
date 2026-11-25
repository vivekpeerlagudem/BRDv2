/**
 * Google Sheets estimates reader — unit tests with a fake fetch. Google is never called.
 * A throw-away RSA key is generated per run, so no real credential is involved.
 */
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DomainError } from './errors/domain-error.ts';
import { CsvOnlyEstimatesSource, GoogleSheetsEstimatesSource, parseSpreadsheetId } from './google-sheets.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const EMAIL = 'crm-reader@example-project.iam.gserviceaccount.com';
const credentials = Buffer.from(JSON.stringify({ type: 'service_account', client_email: EMAIL, private_key: PEM })).toString('base64');
const SHEET = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
const TOKEN = 'ya29.test-access-token';
const NOW = Date.parse('2026-11-23T10:00:00Z');

interface Call {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: string | undefined;
}
function fakeFetch(values: Response | (() => Response), token: Response = Response.json({ access_token: TOKEN, expires_in: 3600 })) {
  const calls: Call[] = [];
  const fetchFn = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    calls.push({ url, method: init?.method, headers: init?.headers ?? {}, body: init?.body });
    if (url.startsWith('https://oauth2.googleapis.com/')) return token.clone();
    return typeof values === 'function' ? values() : values.clone();
  };
  return { calls, fetchFn };
}
const source = (f: ReturnType<typeof fakeFetch>, now = () => NOW) => new GoogleSheetsEstimatesSource({ credentialsBase64: credentials, fetch: f.fetchFn, now });
const failure = async (p: Promise<unknown>): Promise<DomainError> => {
  try {
    await p;
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('expected a DomainError');
};

describe('Google Sheets estimates reader', () => {
  it('signs a service-account JWT, exchanges it for a read-only token and reads the range', async () => {
    const f = fakeFetch(
      Response.json({
        range: 'Sheet1!A1:C3',
        values: [
          ['Task', 'Estimate hours'],
          ['Workshop', 16],
          ['Design', null, 'x'],
        ],
      }),
    );
    const rows = await source(f).fetchRows({ spreadsheetId: SHEET, range: 'Estimates!A1:G50' });
    expect(rows).toEqual([
      ['Task', 'Estimate hours'],
      ['Workshop', '16'],
      ['Design', '', 'x'],
    ]); // every cell as text

    expect(f.calls).toHaveLength(2);
    const [tokenCall, valuesCall] = f.calls as [Call, Call];
    expect(tokenCall.url).toBe('https://oauth2.googleapis.com/token');
    expect(tokenCall.method).toBe('POST');
    expect(tokenCall.headers['content-type']).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(tokenCall.body);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [header, claims, signature] = (form.get('assertion') as string).split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({
      iss: EMAIL,
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly', // read-only: the reader can never write a sheet
      aud: 'https://oauth2.googleapis.com/token',
      iat: NOW / 1000,
      exp: NOW / 1000 + 3600,
    });
    expect(createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true);

    expect(valuesCall.method).toBe('GET');
    expect(valuesCall.url).toBe(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/Estimates!A1%3AG50?majorDimension=ROWS`);
    expect(valuesCall.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(valuesCall.body).toBeUndefined();
  });

  it('reuses the access token until shortly before it expires', async () => {
    const f = fakeFetch(Response.json({ values: [['Task']] }));
    let now = NOW;
    const s = source(f, () => now);
    await s.fetchRows({ spreadsheetId: SHEET, range: 'A1:B2' });
    await s.fetchRows({ spreadsheetId: SHEET, range: 'A1:B2' });
    expect(f.calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(1);
    now += 3600_000; // an hour later the token is no longer valid
    await s.fetchRows({ spreadsheetId: SHEET, range: 'A1:B2' });
    expect(f.calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(2);
  });

  it('an empty sheet gives no rows', async () => {
    expect(await source(fakeFetch(Response.json({ range: 'A1:Z2000' }))).fetchRows({ spreadsheetId: SHEET, range: 'A1:Z2000' })).toEqual([]);
  });

  it('maps 403 and 404 to clear errors that name the service account but never a secret', async () => {
    const denied = await failure(
      source(fakeFetch(new Response('{"error":{"message":"denied"}}', { status: 403 }))).fetchRows({ spreadsheetId: SHEET, range: 'A1:B2' }),
    );
    expect([denied.code, denied.status]).toEqual(['ESTIMATES_SHEET_NOT_SHARED', 422]);
    expect(denied.message).toContain(EMAIL); // the address the sheet must be shared with
    const missing = await failure(source(fakeFetch(new Response('{}', { status: 404 }))).fetchRows({ spreadsheetId: SHEET, range: 'A1:B2' }));
    expect([missing.code, missing.status]).toEqual(['ESTIMATES_SHEET_NOT_FOUND', 422]);
    const range = await failure(source(fakeFetch(new Response('{}', { status: 400 }))).fetchRows({ spreadsheetId: SHEET, range: 'Nope!A1' }));
    expect(range.code).toBe('ESTIMATES_SHEET_RANGE_INVALID');
    const down = await failure(source(fakeFetch(new Response('boom', { status: 500 }))).fetchRows({ spreadsheetId: SHEET, range: 'A1:B2' }));
    expect([down.code, down.status]).toEqual(['ESTIMATES_SOURCE_UNAVAILABLE', 502]);
    for (const e of [denied, missing, range, down]) {
      const text = `${e.message} ${JSON.stringify(e)}`;
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain('PRIVATE KEY');
      expect(text).not.toContain(PEM.slice(40, 80));
    }
  });

  it('a refused key or an unreachable Google ends in a clear error without leaking the response', async () => {
    const refused = fakeFetch(
      Response.json({ values: [] }),
      Response.json({ error: 'invalid_grant', error_description: 'secret-detail-from-google' }, { status: 400 }),
    );
    const e = await failure(source(refused).fetchRows({ spreadsheetId: SHEET, range: 'A1:B2' }));
    expect([e.code, e.status]).toEqual(['ESTIMATES_SOURCE_AUTH_FAILED', 502]);
    expect(e.message).not.toContain('secret-detail-from-google');
    expect(refused.calls).toHaveLength(1); // the sheet is never requested without a token

    const offline = new GoogleSheetsEstimatesSource({
      credentialsBase64: credentials,
      fetch: async () => {
        throw new Error(`network down ${PEM}`);
      },
    });
    const net = await failure(offline.fetchRows({ spreadsheetId: SHEET, range: 'A1:B2' }));
    expect(net.code).toBe('ESTIMATES_SOURCE_UNAVAILABLE');
    expect(net.message).not.toContain('PRIVATE KEY');

    const badKey = new GoogleSheetsEstimatesSource({
      credentialsBase64: Buffer.from(JSON.stringify({ client_email: EMAIL, private_key: 'not a key' })).toString('base64'),
      fetch: fakeFetch(Response.json({})).fetchFn,
    });
    expect((await failure(badKey.fetchRows({ spreadsheetId: SHEET, range: 'A1:B2' }))).code).toBe('ESTIMATES_SOURCE_AUTH_FAILED');
  });

  it('reports configuration status without a network call, and refuses to read when not configured', async () => {
    const f = fakeFetch(Response.json({}));
    expect(source(f).status()).toEqual({ provider: 'google', simulated: false, configured: true, detail: `Reads sheets shared with ${EMAIL} (read-only)` });
    for (const bad of [undefined, 'not-base64-json', Buffer.from('{"client_email":"x"}').toString('base64')]) {
      const s = new GoogleSheetsEstimatesSource({ credentialsBase64: bad, fetch: f.fetchFn });
      expect(s.status().configured).toBe(false);
      expect((await failure(s.fetchRows({ spreadsheetId: SHEET, range: 'A1:B2' }))).code).toBe('ESTIMATES_SOURCE_NOT_CONFIGURED');
    }
    expect(f.calls).toHaveLength(0);
  });

  it('the default CSV-only source never reads a sheet', async () => {
    const csv = new CsvOnlyEstimatesSource();
    expect(csv.status()).toMatchObject({ provider: 'csv', configured: true });
    expect((await failure(csv.fetchRows())).code).toBe('ESTIMATES_SOURCE_NOT_CONFIGURED');
  });

  it('reads the spreadsheet id from a link or accepts the id itself', () => {
    expect(parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=0`)).toBe(SHEET);
    expect(parseSpreadsheetId(`  https://docs.google.com/spreadsheets/d/${SHEET}/edit?usp=sharing `)).toBe(SHEET);
    expect(parseSpreadsheetId(`docs.google.com/spreadsheets/d/${SHEET}`)).toBe(SHEET);
    expect(parseSpreadsheetId(SHEET)).toBe(SHEET);
    expect(parseSpreadsheetId('https://docs.google.com/document/d/abc/edit')).toBeNull();
    expect(parseSpreadsheetId('https://example.com/sheet')).toBeNull();
    expect(parseSpreadsheetId('short')).toBeNull();
    expect(parseSpreadsheetId('')).toBeNull();
  });
});
