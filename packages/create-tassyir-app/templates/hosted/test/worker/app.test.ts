import { describe, expect, it } from 'vitest';
import { createApp, DASHBOARD_ORIGIN } from '../../src/app.ts';
import {
  call,
  delivery,
  envelope,
  fakeTassyir,
  hostedProps,
  INSTALLATION,
  webhookKey,
} from './helpers.ts';

// The Worker's handler inside workerd (the Workers runtime), with stand-in
// ctx.props: a real SQLite STORAGE over RPC, a fake Admin API as TASSYIR.

const PAGE = { html: '<!doctype html><title>page</title>', script: 'void 0;' };
const app = createApp(PAGE);

const ORDERS = [
  {
    id: '2001',
    orderNumber: '00001042',
    total: '7500.00',
    currency: 'DZD',
    createdAt: '2026-10-15T08:12:00.000Z',
  },
];

describe('the page', () => {
  it('is served only to the dashboard’s frame, under a strict policy', async () => {
    const props = hostedProps();
    for (const path of ['/', '/settings?tab=1']) {
      const response = await call(app, props, path);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(await response.text()).toBe(PAGE.html);
      const policy = response.headers.get('content-security-policy') ?? '';
      expect(policy).toContain(`frame-ancestors ${DASHBOARD_ORIGIN}`);
      expect(policy).toContain("script-src 'self'");
      expect(policy).toContain("style-src 'self'");
    }
    const script = await call(app, props, '/app.js');
    expect(script.headers.get('content-type')).toContain('text/javascript');
    expect(await script.text()).toBe(PAGE.script);
  });

  it('answers HOSTED_PROPS_MISSING outside Tassyir Hosting', async () => {
    const response = await call(app, undefined, '/api/settings');
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      code: 'HOSTED_PROPS_MISSING',
    });
  });
});

describe('GET /api/orders', () => {
  it('reads pending orders through ctx.props.TASSYIR, with no token', async () => {
    const props = hostedProps({
      TASSYIR: fakeTassyir(() =>
        Response.json({ data: ORDERS, nextCursor: 'next' }),
      ),
    });
    const response = await call(app, props, '/api/orders');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      orders: ORDERS,
      more: true,
      received: 0,
    });
    const [request] = props.TASSYIR.calls;
    expect(request?.method).toBe('GET');
    expect(request?.url).toBe(
      'https://api.tassyir.io/apps/2026-10/orders?status=pending&limit=20&fields=orderNumber%2Ctotal%2Ccurrency%2CcreatedAt',
    );
    expect(request?.headers.get('authorization')).toBeNull();
  });

  it("passes on the Admin API's refusal, its code and fix", async () => {
    const props = hostedProps({
      TASSYIR: fakeTassyir(() =>
        Response.json(
          {
            type: 'https://developers.tassyir.io/errors/permission-denied',
            status: 403,
            code: 'PERMISSION_DENIED',
            detail: 'The installation lacks read_orders',
            fix: 'Add read_orders to the manifest.',
            requestId: 'req_1',
          },
          { status: 403 },
        ),
      ),
    });
    const response = await call(app, props, '/api/orders');
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: 'PERMISSION_DENIED',
      message: 'The installation lacks read_orders',
      fix: 'Add read_orders to the manifest.',
      requestId: 'req_1',
    });
  });

  it('answers the page only: a request without a viewer is refused', async () => {
    const response = await call(
      app,
      hostedProps({ viewer: null }),
      '/api/orders',
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'VIEWER_REQUIRED' });
  });
});

describe('/api/settings (ctx.props.STORAGE)', () => {
  it('keeps the setting in the installation’s own database', async () => {
    const props = hostedProps();
    expect(await (await call(app, props, '/api/settings')).json()).toEqual({
      highlightFrom: null,
    });

    const saved = await call(app, props, '/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ highlightFrom: '5000' }),
    });
    expect(await saved.json()).toEqual({ highlightFrom: '5000.00' });
    expect(await (await call(app, props, '/api/settings')).json()).toEqual({
      highlightFrom: '5000.00',
    });

    // Another installation has its own database: it sees nothing of it.
    expect(
      await (await call(app, hostedProps(), '/api/settings')).json(),
    ).toEqual({ highlightFrom: null });

    const cleared = await call(app, props, '/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ highlightFrom: null }),
    });
    expect(await cleared.json()).toEqual({ highlightFrom: null });
  });

  it('refuses an amount that is not a decimal string', async () => {
    for (const highlightFrom of [5000, '5000.001', 'abc']) {
      const response = await call(app, hostedProps(), '/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ highlightFrom }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'SETTINGS_INVALID' });
    }
  });
});

describe('POST /webhooks', () => {
  const order = { id: '2001', total: '7500.00', currency: 'DZD' };

  /** A delivery's props: no viewer, and Tassyir's key served through TASSYIR. */
  async function delivering() {
    const key = await webhookKey();
    const props = hostedProps({
      viewer: null,
      TASSYIR: fakeTassyir(undefined, [key.publicKey]),
    });
    return { key, props };
  }
  const asPage = (props: ReturnType<typeof hostedProps>) => ({
    ...props,
    viewer: { userId: '1', sessionId: 's' },
  });

  it('records orders/created once, however often Tassyir delivers it', async () => {
    const { key, props } = await delivering();
    const created = envelope('orders/created', { order });
    for (const id of ['dlv_1', 'dlv_1', 'dlv_2']) {
      const response = await call(
        app,
        props,
        '/webhooks',
        await delivery(key.privateKey, created, { id }),
      );
      expect(response.status).toBe(200);
    }
    // Each delivery read Tassyir's keys through ctx.props.TASSYIR.
    expect(
      props.TASSYIR.calls.filter(
        (request) => request.url === 'https://api.tassyir.io/apps/webhook-keys',
      ),
    ).toHaveLength(3);
    const page = await call(app, asPage(props), '/api/orders');
    expect(await page.json()).toMatchObject({ received: 1 });
  });

  it('refuses a delivery Tassyir did not sign, and one it cannot verify yet', async () => {
    const { props } = await delivering();
    const stranger = await webhookKey();
    const forged = await call(
      app,
      props,
      '/webhooks',
      await delivery(
        stranger.privateKey,
        envelope('orders/created', { order }),
      ),
    );
    expect(forged.status).toBe(400);

    // The keys cannot be read: never processed unverified, Tassyir retries.
    const unverifiable = await call(
      app,
      hostedProps({ viewer: null }),
      '/webhooks',
      await delivery(
        stranger.privateKey,
        envelope('orders/created', { order }),
      ),
    );
    expect(unverifiable.status).toBe(503);
    const page = await call(app, asPage(props), '/api/orders');
    expect(await page.json()).toMatchObject({ received: 0 });
  });

  it('refuses a request from a page, and an envelope of another installation', async () => {
    const { key, props } = await delivering();
    const created = envelope('orders/created', { order });
    const fromPage = await call(
      app,
      asPage(props),
      '/webhooks',
      await delivery(key.privateKey, created),
    );
    expect(fromPage.status).toBe(400);

    const elsewhere = await call(
      app,
      props,
      '/webhooks',
      await delivery(
        key.privateKey,
        envelope('orders/created', { order }, { installationId: '1' }),
      ),
    );
    expect(elsewhere.status).toBe(400);
  });

  it('never writes to STORAGE for business/redact (Tassyir erased it)', async () => {
    const { key, props } = await delivering();
    const response = await call(
      app,
      props,
      '/webhooks',
      await delivery(
        key.privateKey,
        envelope('business/redact', {
          installation: { id: INSTALLATION.id },
        }),
      ),
    );
    expect(response.status).toBe(200);
    const { rows } = await props.STORAGE.sql(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%'",
    );
    expect(rows).toEqual([]);
  });

  it('acknowledges a test delivery without processing it', async () => {
    const { key, props } = await delivering();
    const response = await call(
      app,
      props,
      '/webhooks',
      await delivery(
        key.privateKey,
        envelope('orders/created', { order }, { id: 'evt_0' }),
        { id: 'dlv_test_1' },
      ),
    );
    expect(response.status).toBe(200);
    const page = await call(app, asPage(props), '/api/orders');
    expect(await page.json()).toMatchObject({ received: 0 });
  });
});
