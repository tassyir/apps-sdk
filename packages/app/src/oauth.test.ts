import { describe, expect, it } from 'vitest';
import { TassyirError, TassyirOAuthError } from './errors.js';
import { TassyirOAuthClient } from './oauth.js';
import {
  headerOf,
  jsonResponse,
  recordingFetch,
  containing,
  bodyOf,
} from './vectors.test-helpers.js';
import type { RecordedCall } from './vectors.test-helpers.js';

// Placeholders shaped like real values; nothing here is a credential.
const CLIENT_ID = 'app_7Hq2Kx9Vb4Nm1Lp8Zr3Ty6Wd5Q';
const CLIENT_SECRET = 'tsy_cs_testsecretnotreal000000000000000000000000';
const NOW = 1_800_000_000_000;

const offlineAnswer = {
  access_token: 'tsy_at_access1',
  token_type: 'Bearer',
  expires_in: 3600,
  refresh_token: 'tsy_rt_refresh1',
  refresh_token_expires_in: 7_776_000,
  issued_token_type: 'urn:tassyir:params:oauth:token-type:offline-access-token',
  scope: 'read_orders read_products write_orders',
  installation_id: '9330000000000000001',
  business_id: '741939488313319175',
};

function client(handler: Parameters<typeof recordingFetch>[0]) {
  const { fetch, calls } = recordingFetch(handler);
  return {
    oauth: new TassyirOAuthClient({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      fetch,
      now: () => NOW,
    }),
    calls,
  };
}

function form(call: RecordedCall | undefined): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(bodyOf(call)));
}

describe('TassyirOAuthClient', () => {
  it('exchanges an ID token for an offline token with Basic auth and a form body', async () => {
    const { oauth, calls } = client(() => jsonResponse(200, offlineAnswer));
    const tokens = await oauth.exchangeIdToken('header.payload.signature');
    const [call] = calls;
    expect(call?.url).toBe('https://api.tassyir.io/apps/oauth/token');
    expect(call?.init.method).toBe('POST');
    expect(headerOf(call, 'authorization')).toBe(
      `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    );
    expect(headerOf(call, 'content-type')).toBe(
      'application/x-www-form-urlencoded',
    );
    expect(form(call)).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: 'header.payload.signature',
      subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
      requested_token_type:
        'urn:tassyir:params:oauth:token-type:offline-access-token',
    });
    expect(bodyOf(call)).not.toContain('client_secret');
    expect(tokens).toEqual({
      kind: 'offline',
      accessToken: 'tsy_at_access1',
      expiresAt: NOW + 3_600_000,
      refreshToken: 'tsy_rt_refresh1',
      refreshTokenExpiresAt: NOW + 7_776_000_000,
      scopes: ['read_orders', 'read_products', 'write_orders'],
      installationId: '9330000000000000001',
      businessId: '741939488313319175',
      userId: undefined,
      obtainedAt: NOW,
    });
  });

  it('asks for an online token and returns one without a refresh token', async () => {
    const { oauth, calls } = client(() =>
      jsonResponse(200, {
        ...offlineAnswer,
        refresh_token: undefined,
        refresh_token_expires_in: undefined,
        issued_token_type:
          'urn:tassyir:params:oauth:token-type:online-access-token',
        user_id: '741939488313319001',
      }),
    );
    const tokens = await oauth.exchangeIdToken('a.b.c', {
      tokenType: 'online',
    });
    expect(form(calls[0])['requested_token_type']).toBe(
      'urn:tassyir:params:oauth:token-type:online-access-token',
    );
    expect(tokens).toMatchObject({
      kind: 'online',
      userId: '741939488313319001',
      refreshToken: undefined,
    });
  });

  it('redeems an install code and refreshes with the right grants', async () => {
    const { oauth, calls } = client(() =>
      jsonResponse(200, { ...offlineAnswer, issued_token_type: undefined }),
    );
    await expect(oauth.redeemInstallCode('tsy_ic_code')).resolves.toMatchObject(
      { kind: 'offline' },
    );
    await expect(oauth.refresh('tsy_rt_refresh1')).resolves.toMatchObject({
      kind: 'offline',
    });
    expect(calls.map((call) => form(call))).toEqual([
      { grant_type: 'authorization_code', code: 'tsy_ic_code' },
      { grant_type: 'refresh_token', refresh_token: 'tsy_rt_refresh1' },
    ]);
  });

  it.each([
    [401, 'invalid_client', 'TASSYIR_CLIENT_SECRET'],
    [400, 'invalid_grant', 'reinstall'],
    [400, 'unauthorized_client', 'suspended'],
    [400, 'invalid_request', 'issued'],
    [400, 'unsupported_grant_type', 'issued'],
  ])(
    'turns %i %s into a typed error with a fix',
    async (status, error, fix) => {
      const { oauth } = client(() =>
        jsonResponse(status, { error, error_description: 'described' }),
      );
      const caught = await oauth.refresh('tsy_rt_x').catch((e: unknown) => e);
      expect(caught).toBeInstanceOf(TassyirOAuthError);
      expect(caught).toMatchObject({
        code: `OAUTH_${error.toUpperCase()}`,
        error,
        status,
        errorDescription: 'described',
        fix: containing(fix),
      });
    },
  );

  it('names the grant in the invalid_grant fix', async () => {
    const { oauth } = client(() =>
      jsonResponse(400, { error: 'invalid_grant', error_description: 'x' }),
    );
    await expect(oauth.exchangeIdToken('a.b.c')).rejects.toMatchObject({
      fix: containing('fresh ID token'),
    });
    await expect(oauth.redeemInstallCode('tsy_ic_x')).rejects.toMatchObject({
      fix: containing('5 minutes'),
    });
  });

  it('reads Retry-After on slow_down and temporarily_unavailable', async () => {
    const { oauth } = client(() =>
      jsonResponse(
        429,
        { error: 'slow_down', error_description: 'x' },
        { 'retry-after': '7' },
      ),
    );
    await expect(oauth.refresh('tsy_rt_x')).rejects.toMatchObject({
      code: 'OAUTH_SLOW_DOWN',
      retryAfterSeconds: 7,
    });
  });

  it('reports a 500 without an OAuth body as server_error with its request id', async () => {
    const { oauth } = client(() =>
      jsonResponse(500, {
        statusCode: 500,
        message: 'Internal',
        requestId: 'req-1',
      }),
    );
    await expect(oauth.refresh('tsy_rt_x')).rejects.toMatchObject({
      code: 'OAUTH_SERVER_ERROR',
      status: 500,
      requestId: 'req-1',
    });
  });

  it('refuses an unexpected 200 body', async () => {
    const { oauth } = client(() => jsonResponse(200, { access_token: 'x' }));
    await expect(oauth.refresh('tsy_rt_x')).rejects.toMatchObject({
      code: 'INVALID_TOKEN_RESPONSE',
    });
  });

  it('wraps a network failure', async () => {
    const { oauth } = client(() => {
      throw new TypeError('fetch failed');
    });
    await expect(oauth.refresh('tsy_rt_x')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });

  it('never puts a token or the secret in an error message', async () => {
    const { oauth } = client(() =>
      jsonResponse(400, {
        error: 'invalid_grant',
        error_description: 'Refresh token revoked',
      }),
    );
    const caught = (await oauth
      .refresh('tsy_rt_SECRETVALUE')
      .catch((e: unknown) => e)) as Error;
    expect(
      `${caught.message} ${String((caught as TassyirError).fix)}`,
    ).not.toMatch(/SECRETVALUE|tsy_cs_/);
  });

  it('checks its credentials without echoing them', () => {
    const swapped = () =>
      new TassyirOAuthClient({
        clientId: CLIENT_SECRET,
        clientSecret: CLIENT_ID,
      });
    expect(swapped).toThrow(TassyirError);
    try {
      swapped();
    } catch (error) {
      expect((error as Error).message).not.toContain(CLIENT_SECRET);
      expect(error).toMatchObject({ code: 'INVALID_OPTIONS' });
    }
  });

  it('refuses an empty token before calling the endpoint', async () => {
    const { oauth, calls } = client(() => jsonResponse(200, offlineAnswer));
    await expect(oauth.refresh('')).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(calls).toHaveLength(0);
  });
});
