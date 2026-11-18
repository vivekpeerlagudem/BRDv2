import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, money, personName } from './api.ts';

const respond = (status: number, body: unknown) => vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }));

describe('api client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns parsed JSON on success and sends a JSON body', async () => {
    const fetchMock = respond(200, { id: 'x' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(api('POST', '/api/v1/companies', { name: 'Acme' })).resolves.toEqual({ id: 'x' });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.body).toBe('{"name":"Acme"}');
    expect(init.credentials).toBe('same-origin');
  });

  it('returns undefined for 204', async () => {
    vi.stubGlobal('fetch', respond(204, undefined));
    await expect(api('POST', '/public/v1/views/heartbeat', {})).resolves.toBeUndefined();
  });

  it('turns problem JSON into an ApiError with field errors and confirmation metadata', async () => {
    vi.stubGlobal(
      'fetch',
      respond(409, {
        type: 'about:blank',
        title: 'Confirmation required',
        status: 409,
        code: 'CONFIRMATION_REQUIRED',
        errors: [{ path: 'amount', code: 'X', message: 'Check the amount' }],
        meta: { confirmations: [{ code: 'DISCOUNT', message: 'Large discount' }] },
      }),
    );
    const error = (await api('POST', '/public/v1/response', {}).catch((e) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(409);
    expect(error.code).toBe('CONFIRMATION_REQUIRED');
    expect(error.errors[0]?.path).toBe('amount');
    expect(error.meta.confirmations).toHaveLength(1);
  });

  it('falls back to a generic error when the body is not problem JSON', async () => {
    vi.stubGlobal('fetch', respond(500, 'boom'));
    const error = (await api('GET', '/public/v1/session').catch((e) => e)) as ApiError;
    expect(error.code).toBe('UNKNOWN');
    expect(error.message).toBe('Request failed (500)');
  });
});

describe('formatting helpers', () => {
  it('formats money without decimals and shows a dash for no amount', () => {
    expect(money('12500.50', 'USD')).toBe('$12,501');
    expect(money(null)).toBe('—');
  });
  it('builds a display name, falling back to email', () => {
    expect(personName({ firstName: 'Ada', lastName: 'Lovelace' })).toBe('Ada Lovelace');
    expect(personName({ email: 'a@b.example' })).toBe('a@b.example');
    expect(personName({})).toBe('Unnamed');
  });
});
