import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  idToken,
  INSTALLATION_ID,
  makeKeys,
  ORDERS,
  testServer,
} from './helpers.ts';
import type { TestServer } from './helpers.ts';

let server: TestServer;
beforeEach(async () => {
  server = await testServer();
});
afterEach(() => server.close());

function call(
  path: string,
  init: RequestInit = {},
  token = idToken(server.keys),
) {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  return server.app.request(path, { ...init, headers });
}

describe('the page API', () => {
  it('refuses a call without an ID token', async () => {
    const response = await server.app.request('/api/orders');
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'ID_TOKEN_REQUIRED' });
  });

  it('refuses an ID token Tassyir did not sign, or one for another app', async () => {
    const forged = await call('/api/orders', {}, idToken(makeKeys()));
    expect(forged.status).toBe(401);
    expect(await forged.json()).toMatchObject({
      code: expect.stringMatching(/^ID_TOKEN_/) as string,
    });

    const otherApp = await call(
      '/api/orders',
      {},
      idToken(server.keys, { aud: 'app_other' }),
    );
    expect(otherApp.status).toBe(401);
    expect(server.fake.exchanges).toBe(0);
  });

  it('exchanges the first ID token, then reuses the stored offline token', async () => {
    const first = await call('/api/orders');
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ orders: ORDERS, more: false });

    expect((await call('/api/orders')).status).toBe(200);
    expect(server.fake.exchanges).toBe(1);
    expect(server.store.installation(INSTALLATION_ID)).toBeDefined();

    // The token store is encrypted at rest.
    const file = await readFile(join(server.dir, 'store.json'), 'utf8');
    expect(file).not.toContain('tsy_at_');
    expect(file).not.toContain('tsy_rt_');
  });

  it('keeps settings as app data, with money as a decimal string', async () => {
    expect(await (await call('/api/settings')).json()).toEqual({
      highlightFrom: null,
    });

    const saved = await call('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ highlightFrom: '5000.5' }),
    });
    expect(await saved.json()).toEqual({ highlightFrom: '5000.50' });
    expect(server.fake.appData.get('test-business/settings')).toEqual({
      highlightFrom: '5000.50',
    });
    expect(await (await call('/api/settings')).json()).toEqual({
      highlightFrom: '5000.50',
    });

    const number = await call('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ highlightFrom: 5000 }),
    });
    expect(number.status).toBe(400);
    expect(await number.json()).toMatchObject({ code: 'SETTINGS_INVALID' });
  });
});

describe('the embedded page', () => {
  it('is served for admin.page and every path below it, framed by the dashboard only', async () => {
    for (const path of ['/', '/reviews/2?tab=sent']) {
      const response = await server.app.request(path);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('content-security-policy')).toContain(
        'frame-ancestors https://app.tassyir.io',
      );
    }
  });
});
