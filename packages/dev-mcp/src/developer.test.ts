import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupHarnesses, createHarness } from './harness.test-helpers.js';
import type { Harness } from './harness.test-helpers.js';

// trigger_test_webhook, seed_dev_store and list_dev_stores against the
// tassyir CLI's fake developer API (AP-K1.6), signed in as `tassyir login`
// leaves a machine.

afterEach(cleanupHarnesses);

const DEVELOPER_TOOLS: [string, Record<string, unknown>][] = [
  ['trigger_test_webhook', { topic: 'orders/created', app: 'review-requests' }],
  ['seed_dev_store', {}],
  ['list_dev_stores', {}],
];

/** The developer API's requests, method and path. */
function routes(harness: Harness): string[] {
  return harness.fake.requests.map(
    (request) => `${request.method} ${request.path}`,
  );
}

describe('signing in', () => {
  it.each(DEVELOPER_TOOLS)(
    '%s answers NOT_LOGGED_IN without a sign-in, and calls nothing',
    async (name, args) => {
      const harness = await createHarness();
      const error = await harness.refused(name, args);
      expect(error.code).toBe('NOT_LOGGED_IN');
      expect(error.fix).toContain('npx tassyir login');
      expect(harness.fake.requests).toEqual([]);
    },
  );

  it('sends the stored token to the API origin only, as a bearer', async () => {
    const harness = await createHarness();
    const token = await harness.signIn();
    await harness.ok('list_dev_stores');
    expect(harness.fake.requests).toHaveLength(1);
    const [request] = harness.fake.requests;
    expect(request?.headers.get('authorization')).toBe(`Bearer ${token}`);
    expect(request?.headers.get('user-agent')).toBe(
      'tassyir-dev-mcp/0.0.0-test (node 22.18.0; linux)',
    );
  });

  it('uses TASSYIR_TOKEN when it is set, as the CLI does', async () => {
    const harness = await createHarness();
    const token = harness.fake.issueToken();
    harness.env['TASSYIR_TOKEN'] = token;
    await harness.ok('list_dev_stores');
    expect(harness.fake.requests[0]?.headers.get('authorization')).toBe(
      `Bearer ${token}`,
    );
  });

  it('reads the sign-in at each call: `tassyir login` after the server started counts', async () => {
    const harness = await createHarness();
    expect((await harness.refused('list_dev_stores')).code).toBe(
      'NOT_LOGGED_IN',
    );
    await harness.signIn();
    await harness.ok('list_dev_stores');
  });

  it("relays a revoked token as the API's refusal, with the CLI's fix", async () => {
    const harness = await createHarness();
    await harness.signIn();
    for (const row of harness.fake.tokens) row.revoked = true;
    const error = await harness.refused('list_dev_stores');
    expect(error).toMatchObject({
      code: 'DEVELOPER_TOKEN_INVALID',
      status: 401,
      requestId: 'req-test-1',
    });
    expect(error.fix).toMatch(/tassyir login/);
  });

  it('refuses an API origin a token must never travel to', async () => {
    const harness = await createHarness({
      env: { TASSYIR_API_ORIGIN: 'http://api.tassyir.example' },
    });
    await harness.signIn().catch(() => undefined);
    const error = await harness.refused('list_dev_stores');
    expect(error.code).toBe('API_ORIGIN_INVALID');
    expect(harness.fake.requests).toEqual([]);
  });
});

describe('list_dev_stores and seed_dev_store', () => {
  it('creates a seeded store, then lists it with its dashboard link', async () => {
    const harness = await createHarness();
    await harness.signIn();
    expect(await harness.ok('list_dev_stores')).toEqual({ stores: [] });
    const created = await harness.ok('seed_dev_store', {
      name: ' Amina test shop ',
    });
    const store = created['store'] as Record<string, unknown>;
    expect(store).toMatchObject({
      name: 'Amina test shop',
      dashboardUrl: `https://app.tassyir.io/en${String(store['dashboardPath'])}`,
      store: { subdomain: 'dev-w0fmk843' },
      seedError: null,
    });
    expect(store['seed']).toMatchObject({ products: 30 });
    expect(created['next']).toMatch(/trigger_test_webhook/);
    const listed = await harness.ok('list_dev_stores');
    expect(listed['stores']).toEqual([
      expect.objectContaining({
        id: store['id'],
        dashboardUrl: store['dashboardUrl'],
      }),
    ]);
    expect(routes(harness)).toEqual([
      'GET /developer/dev-stores',
      'POST /developer/dev-stores',
      'GET /developer/dev-stores',
    ]);
    expect(JSON.parse(harness.fake.requests[1]?.body ?? '{}')).toEqual({
      name: 'Amina test shop',
    });
  });

  it('creates an empty one with empty: true', async () => {
    const harness = await createHarness();
    await harness.signIn();
    const created = await harness.ok('seed_dev_store', { empty: true });
    expect((created['store'] as { seed: unknown }).seed).toBeNull();
    expect(JSON.parse(harness.fake.requests[0]?.body ?? '{}')).toEqual({
      seed: false,
    });
  });

  it("relays the API's limit with its fix and subject", async () => {
    const harness = await createHarness();
    await harness.signIn();
    for (let index = 0; index < 3; index += 1)
      await harness.ok('seed_dev_store');
    const error = await harness.refused('seed_dev_store');
    expect(error).toMatchObject({
      code: 'DEV_STORE_LIMIT_REACHED',
      status: 409,
      fix: 'Use one of your dev stores: they cannot be deleted yet.',
      details: { limit: 3 },
    });
  });
});

describe('trigger_test_webhook', () => {
  it("sends the test to the app's only active installation, the app read from ./tassyir.app.toml", async () => {
    const harness = await createHarness();
    await harness.signIn();
    const app = harness.fake.seedApp();
    await writeFile(
      join(harness.cwd, 'tassyir.app.toml'),
      'handle = "review-requests"\nname = "Review Requests"\n',
    );
    const answer = await harness.ok('trigger_test_webhook', {
      topic: 'bulk/finished',
    });
    expect(answer).toEqual({
      app: { id: app.id, handle: 'review-requests' },
      delivery: expect.objectContaining({
        installationId: '5001',
        topic: 'bulk/finished',
        status: 'delivered',
        statusCode: 200,
      }) as unknown,
    });
    expect(routes(harness)).toEqual([
      'GET /developer/apps',
      `GET /developer/apps/${app.id}/installations`,
      `POST /developer/apps/${app.id}/installations/5001/webhooks/test`,
    ]);
    expect(harness.fake.requests[1]?.query.get('status')).toBe('active');
    expect(JSON.parse(harness.fake.requests[2]?.body ?? '{}')).toEqual({
      topic: 'bulk/finished',
    });
  });

  it('takes the app by id and the installation given, without listing installations', async () => {
    const harness = await createHarness();
    await harness.signIn();
    const app = harness.fake.seedApp();
    await harness.ok('trigger_test_webhook', {
      topic: 'orders/created',
      app: app.id,
      installation: '5001',
    });
    expect(routes(harness)).toEqual([
      'GET /developer/apps',
      `POST /developer/apps/${app.id}/installations/5001/webhooks/test`,
    ]);
  });

  it('asks which app when there is no manifest, and names the apps when it is not found', async () => {
    const harness = await createHarness();
    await harness.signIn();
    harness.fake.seedApp();
    const required = await harness.refused('trigger_test_webhook', {
      topic: 'orders/created',
    });
    expect(required.code).toBe('APP_REQUIRED');
    const missing = await harness.refused('trigger_test_webhook', {
      topic: 'orders/created',
      app: 'other-app',
    });
    expect(missing.code).toBe('APP_NOT_FOUND');
    expect(missing.fix).toContain('review-requests');
  });

  it('asks which installation when there are none or several', async () => {
    const harness = await createHarness();
    await harness.signIn();
    const app = harness.fake.seedApp();
    const installations = harness.fake.installations.get(app.id) ?? [];
    const [first] = installations;
    if (!first) throw new Error('seedApp installs the app once');
    installations.push({ ...first, id: '5002', businessId: '6002' });
    const several = await harness.refused('trigger_test_webhook', {
      topic: 'orders/created',
      app: 'review-requests',
    });
    expect(several).toMatchObject({
      code: 'INSTALLATION_REQUIRED',
      details: { installations: ['5001', '5002'] },
    });
    expect(several.fix).toContain('5002 (business 6002)');
    harness.fake.installations.set(app.id, []);
    const none = await harness.refused('trigger_test_webhook', {
      topic: 'orders/created',
      app: 'review-requests',
    });
    expect(none.code).toBe('INSTALLATION_REQUIRED');
    expect(none.fix).toMatch(/seed_dev_store/);
  });

  it.each([
    ['http', 500, /answered 500/],
    ['timeout', null, /more than 10 seconds/],
    ['network', null, /could not connect/],
    ['refused', null, /private or reserved IP/],
  ] as const)(
    'reports an endpoint that failed (%s) with the fix for it',
    async (errorClass, statusCode, fix) => {
      const harness = await createHarness();
      await harness.signIn();
      harness.fake.seedApp();
      harness.fake.testResult = {
        status: 'failed',
        statusCode,
        error: errorClass === 'http' ? 'HTTP_500' : errorClass.toUpperCase(),
        errorClass,
      };
      const error = await harness.refused('trigger_test_webhook', {
        topic: 'orders/created',
        app: 'review-requests',
      });
      expect(error.code).toBe('WEBHOOK_ENDPOINT_FAILED');
      expect(error.fix).toMatch(fix);
      expect(error['details']).toMatchObject({
        delivery: { status: 'failed', errorClass },
      });
    },
  );
});
