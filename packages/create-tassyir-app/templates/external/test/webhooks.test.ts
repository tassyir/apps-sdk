import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BUSINESS_ID,
  delivery,
  envelope,
  INSTALLATION_ID,
  silentLog,
  testServer,
} from './helpers.ts';
import type { TestServer } from './helpers.ts';

const INSTALLED = { installation: { id: INSTALLATION_ID, status: 'active' } };
const ORDER = {
  order: {
    id: 'order-1',
    orderNumber: '1041',
    total: '2500.00',
    currency: 'DZD',
  },
};

let server: TestServer;
beforeEach(async () => {
  server = await testServer();
  silentLog.lines.length = 0;
});
afterEach(() => server.close());

async function send(init: RequestInit): Promise<number> {
  return (await server.app.request('/webhooks', init)).status;
}

describe('POST /webhooks', () => {
  it('records the installation from a signed app/installed', async () => {
    expect(
      await send(delivery(server.keys, envelope('app/installed', INSTALLED))),
    ).toBe(200);
    expect(server.store.installation(INSTALLATION_ID)).toMatchObject({
      businessId: BUSINESS_ID,
      uninstalledAt: null,
    });
  });

  it('verifies the raw body: the same JSON serialised again is refused', async () => {
    const event = envelope('app/installed', INSTALLED);
    const init = delivery(server.keys, event);
    expect(await send({ ...init, body: JSON.stringify(event, null, 2) })).toBe(
      400,
    );
    expect(server.store.installation(INSTALLATION_ID)).toBeUndefined();
  });

  it('refuses a delivery signed by another key', async () => {
    const other = await testServer();
    try {
      expect(
        await send(delivery(other.keys, envelope('app/installed', INSTALLED))),
      ).toBe(400);
    } finally {
      await other.close();
    }
  });

  it('refuses a delivery older than 5 minutes', async () => {
    const timestamp = Math.floor(Date.now() / 1000) - 600;
    expect(
      await send(
        delivery(server.keys, envelope('app/installed', INSTALLED), {
          timestamp,
        }),
      ),
    ).toBe(400);
  });

  it('refuses an installation it does not know yet, so Tassyir delivers it again later', async () => {
    expect(
      await send(delivery(server.keys, envelope('orders/created', ORDER))),
    ).toBe(400);
  });

  it('handles a delivery once: the same webhook-id again is acknowledged, not processed', async () => {
    await send(delivery(server.keys, envelope('app/installed', INSTALLED)));
    const event = envelope('orders/created', ORDER);
    expect(await send(delivery(server.keys, event, { id: 'dlv_1' }))).toBe(200);
    expect(await send(delivery(server.keys, event, { id: 'dlv_1' }))).toBe(200);
    expect(
      silentLog.lines.filter((line) => line.includes('order 1041 created')),
    ).toEqual(['webhook: order 1041 created, total 2500.00 DZD']);
  });

  it('acknowledges a test delivery from the developer console without processing it', async () => {
    const event = { ...envelope('app/installed', INSTALLED), id: 'evt_0' };
    const init = delivery(server.keys, event, {
      id: 'dlv_test_0123456789abcdef01234567',
    });
    init.headers = {
      ...(init.headers as Record<string, string>),
      'tassyir-test': 'true',
    };
    expect(await send(init)).toBe(200);
    expect(server.store.installation(INSTALLATION_ID)).toBeUndefined();
  });

  it('forgets the tokens on app/uninstalled, and everything on business/redact', async () => {
    await send(delivery(server.keys, envelope('app/installed', INSTALLED)));
    await server.store.tokens.set(INSTALLATION_ID, {
      kind: 'offline',
      accessToken: 'tsy_at_test',
      expiresAt: Date.now() + 3_600_000,
      refreshToken: 'tsy_rt_test',
      scopes: ['read_orders'],
      installationId: INSTALLATION_ID,
      businessId: BUSINESS_ID,
      obtainedAt: Date.now(),
    });

    expect(
      await send(delivery(server.keys, envelope('app/uninstalled', INSTALLED))),
    ).toBe(200);
    expect(await server.store.tokens.get(INSTALLATION_ID)).toBeUndefined();
    expect(
      server.store.installation(INSTALLATION_ID)?.uninstalledAt,
    ).not.toBeNull();

    expect(
      await send(
        delivery(
          server.keys,
          envelope('business/redact', { business: { id: BUSINESS_ID } }),
        ),
      ),
    ).toBe(200);
    expect(server.store.installation(INSTALLATION_ID)).toBeUndefined();
  });
});
