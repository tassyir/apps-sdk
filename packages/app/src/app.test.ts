import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTassyirApp } from './app.js';
import type { TassyirAppOptions } from './app.js';
import { MemoryTokenStore } from './token-store.js';
import {
  headerOf,
  jsonResponse,
  recordingFetch,
  vectors,
} from './vectors.test-helpers.js';

const tokenAnswer = (n: number, online = false) => ({
  access_token: `tsy_at_${String(n)}`,
  token_type: 'Bearer',
  expires_in: 3600,
  ...(online
    ? {
        user_id: '741939488313319001',
        issued_token_type:
          'urn:tassyir:params:oauth:token-type:online-access-token',
      }
    : {
        refresh_token: `tsy_rt_${String(n)}`,
        refresh_token_expires_in: 7_776_000,
      }),
  scope: 'read_orders',
  installation_id: vectors.installationId,
  business_id: '741939488313319175',
});

function setup(options: Partial<TassyirAppOptions> = {}) {
  let issued = 0;
  const { fetch, calls } = recordingFetch((url, init) => {
    const { pathname } = new URL(url);
    if (pathname === '/apps/.well-known/jwks.json')
      return jsonResponse(200, vectors.jwks);
    if (pathname === '/apps/webhook-keys')
      return jsonResponse(200, vectors.webhookKeys);
    if (pathname === '/apps/oauth/token') {
      issued += 1;
      const online =
        typeof init.body === 'string' &&
        init.body.includes('online-access-token');
      return jsonResponse(200, tokenAnswer(issued, online));
    }
    if (pathname === '/apps/2026-10/business')
      return jsonResponse(200, { data: { id: '741939488313319175' } });
    return new Response('not found', { status: 404 });
  });
  const tokenStore = new MemoryTokenStore();
  const app = createTassyirApp({
    clientId: vectors.clientId,
    clientSecret: 'tsy_cs_testsecretnotreal000000000000000000000000',
    appId: vectors.appId,
    tokenStore,
    fetch,
    ...options,
  });
  const tokenCalls = () =>
    calls.filter((call) => call.url.endsWith('/apps/oauth/token'));
  return { app, calls, tokenStore, tokenCalls };
}

const ID_TOKEN = vectors.idTokens['valid']?.token ?? '';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(vectors.nowMs);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TassyirApp', () => {
  it('exchanges an ID token for an offline token once, then reuses the stored one', async () => {
    const { app, tokenStore, tokenCalls } = setup();
    const first = await app.authenticate(ID_TOKEN);
    expect(first).toMatchObject({
      exchanged: true,
      tokens: { kind: 'offline', accessToken: 'tsy_at_1' },
    });
    expect(first.idToken.installationId).toBe(vectors.installationId);
    expect(tokenStore.get(vectors.installationId)?.refreshToken).toBe(
      'tsy_rt_1',
    );

    const second = await app.authenticate(ID_TOKEN);
    expect(second).toMatchObject({
      exchanged: false,
      tokens: { accessToken: 'tsy_at_1' },
    });
    expect(tokenCalls()).toHaveLength(1);
  });

  it('exchanges for an online token on every call and does not store it', async () => {
    const { app, tokenStore, tokenCalls } = setup();
    const session = await app.authenticate(ID_TOKEN, { tokenType: 'online' });
    expect(session).toMatchObject({
      exchanged: true,
      tokens: { kind: 'online', userId: '741939488313319001' },
    });
    await app.authenticate(ID_TOKEN, { tokenType: 'online' });
    expect(tokenCalls()).toHaveLength(2);
    expect(tokenStore.get(vectors.installationId)).toBeUndefined();
  });

  it('refuses an ID token issued to another app before any exchange', async () => {
    const { app, tokenCalls } = setup();
    await expect(
      app.authenticate(vectors.idTokens['wrongAudience']?.token ?? ''),
    ).rejects.toMatchObject({
      code: 'ID_TOKEN_WRONG_AUDIENCE',
    });
    expect(tokenCalls()).toHaveLength(0);
  });

  it("calls the Admin API with the installation's stored token", async () => {
    const { app, calls } = setup();
    await app.redeemInstallCode('tsy_ic_code');
    await expect(
      app.admin(vectors.installationId).get('/business'),
    ).resolves.toEqual({ data: { id: '741939488313319175' } });
    expect(headerOf(calls.at(-1), 'authorization')).toBe('Bearer tsy_at_1');
    await app.adminWithToken('tsy_at_online').get('/business');
    expect(headerOf(calls.at(-1), 'authorization')).toBe(
      'Bearer tsy_at_online',
    );
  });

  it('verifies webhooks for its appId, from a header record or a Request', async () => {
    const { app } = setup();
    const vector = vectors.webhooks['valid'];
    if (!vector) throw new Error('missing vector');
    await expect(
      app.verifyWebhook(
        { headers: vector.headers, body: vector.body },
        { installationId: vectors.installationId },
      ),
    ).resolves.toMatchObject({ topic: 'orders/created' });
    const request = new Request('https://app.example/webhooks', {
      method: 'POST',
      headers: vector.headers,
      body: vector.body,
    });
    await expect(
      app.verifyWebhook(request, { installationId: vectors.installationId }),
    ).resolves.toMatchObject({
      topic: 'orders/created',
    });
  });

  it('needs appId to verify webhooks', () => {
    const { app } = setup({ appId: undefined });
    expect(() =>
      app.verifyWebhook({ headers: {}, body: '' }, { installationId: 'x' }),
    ).toThrow(
      expect.objectContaining({
        code: 'INVALID_OPTIONS',
        fix: expect.stringContaining('TASSYIR_APP_ID') as string,
      }) as Error,
    );
  });
});
