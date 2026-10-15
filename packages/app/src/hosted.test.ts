import { createPrivateKey, sign } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TassyirApiError, TassyirError } from './errors.js';
import {
  HOSTED_BINDING_ERRORS,
  hostedAdmin,
  readHostedProps,
  verifyHostedWebhook,
} from './hosted.js';
import type { HostedProps, TassyirBinding } from './hosted.js';
import { WebhookKeys } from './keys.js';
import { vectors } from './vectors.test-helpers.js';

afterEach(() => {
  vi.useRealTimers();
});

const INSTALLATION = {
  id: vectors.installationId,
  businessId: '741939488313319175',
  appId: vectors.appId,
  handle: 'review-requests',
  version: 4,
  scopes: ['read_orders'],
  storeAccess: 'all',
  storeIds: [],
  devStore: false,
} as const;

interface BindingCall {
  url: string;
  init: RequestInit | undefined;
}

/** A stand-in `ctx.props.TASSYIR` answering each call with `answer`. */
function binding(
  answer: (call: BindingCall, index: number) => Response | Promise<Response>,
): TassyirBinding & { calls: BindingCall[] } {
  const calls: BindingCall[] = [];
  return {
    calls,
    fetch(input, init) {
      const call = {
        url: input instanceof Request ? input.url : input.toString(),
        init,
      };
      calls.push(call);
      return Promise.resolve(answer(call, calls.length - 1));
    },
  };
}

function props(overrides: Record<string, unknown> = {}): HostedProps {
  return {
    installation: {
      ...INSTALLATION,
      scopes: [...INSTALLATION.scopes],
      storeIds: [],
    },
    viewer: { userId: '7300', sessionId: 'tab-1' },
    STORAGE: {
      sql: () => Promise.resolve({ rows: [], rowsRead: 0, rowsWritten: 0 }),
      batch: () => Promise.resolve([]),
      usage: () => Promise.resolve({ bytes: 0, limitBytes: 1 }),
    },
    TASSYIR: binding(() => Response.json({})),
    ...overrides,
  };
}

/** A problem+json answer shaped like the binding's own (no requestId). */
function bindingProblem(
  status: number,
  code: string,
  headers: Record<string, string> = {},
): Response {
  const type = `https://developers.tassyir.io/errors/${code.toLowerCase().replace(/_/g, '-')}`;
  return new Response(
    JSON.stringify({
      type,
      title: 'Refused',
      status,
      detail: `${code} detail`,
      code,
      fix: `${code} fix`,
      docs: type,
    }),
    {
      status,
      headers: { 'content-type': 'application/problem+json', ...headers },
    },
  );
}

describe('readHostedProps', () => {
  it("returns ctx.props when it is Tassyir Hosting's", () => {
    const given = props();
    expect(readHostedProps({ props: given })).toBe(given);
    expect(
      readHostedProps({ props: props({ viewer: null }) }).viewer,
    ).toBeNull();
  });

  it('throws HOSTED_PROPS_MISSING, with a fix, anywhere else', () => {
    const cases: [string, unknown][] = [
      ['no ctx', undefined],
      ['no props', {}],
      ['installation', { props: props({ installation: null }) }],
      [
        'installation id',
        { props: props({ installation: { ...INSTALLATION, id: 'abc' } }) },
      ],
      [
        'store access',
        {
          props: props({
            installation: { ...INSTALLATION, storeAccess: 'some' },
          }),
        },
      ],
      ['viewer', { props: props({ viewer: { userId: 7 } }) }],
      ['STORAGE', { props: props({ STORAGE: undefined }) }],
      ['TASSYIR', { props: props({ TASSYIR: {} }) }],
    ];
    for (const [name, ctx] of cases) {
      let caught: unknown;
      try {
        readHostedProps(ctx as { props?: unknown });
      } catch (error) {
        caught = error;
      }
      expect(caught, name).toBeInstanceOf(TassyirError);
      expect((caught as TassyirError).code, name).toBe('HOSTED_PROPS_MISSING');
      expect((caught as TassyirError).fix, name).toMatch(/Tassyir Hosting/);
    }
  });
});

describe('hostedAdmin', () => {
  it('calls the Admin API through ctx.props.TASSYIR, with no token', async () => {
    const tassyir = binding(() =>
      Response.json({
        data: [{ id: '1', orderNumber: '00001042', total: '7500.00' }],
        nextCursor: null,
      }),
    );
    const admin = hostedAdmin(props({ TASSYIR: tassyir }));
    const page = await admin.get('/orders', {
      query: { status: 'pending', limit: 20, fields: ['orderNumber', 'total'] },
    });
    expect(page.data[0]?.total).toBe('7500.00');
    expect(tassyir.calls).toHaveLength(1);
    const [call] = tassyir.calls;
    expect(call?.url).toBe(
      'https://api.tassyir.io/apps/2026-10/orders?status=pending&limit=20&fields=orderNumber%2Ctotal',
    );
    expect(call?.init?.method).toBe('GET');
    const headers = new Headers(call?.init?.headers);
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('accept')).toBe('application/json');
    // The signal stays on this side of the service binding.
    expect(call?.init && 'signal' in call.init).toBe(false);
  });

  it('sends writes with an Idempotency-Key and a JSON body', async () => {
    const tassyir = binding(() =>
      Response.json({ data: { key: 'settings', value: { on: true } } }),
    );
    const admin = hostedAdmin(tassyir);
    await admin.put('/data/{ownerType}/{ownerId}/{key}', {
      path: { ownerType: 'business', ownerId: '7200', key: 'settings' },
      body: { value: { on: true } },
      idempotencyKey: 'settings-1',
    });
    const [call] = tassyir.calls;
    expect(call?.url).toBe(
      'https://api.tassyir.io/apps/2026-10/data/business/7200/settings',
    );
    expect(call?.init?.method).toBe('PUT');
    const headers = new Headers(call?.init?.headers);
    expect(headers.get('idempotency-key')).toBe('settings-1');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('authorization')).toBeNull();
    expect(call?.init?.body).toBe('{"value":{"on":true}}');
  });

  it("throws the binding's refusals as TassyirApiErrors, like the API's", async () => {
    for (const code of [
      'HOSTED_PATH_NOT_ALLOWED',
      'RESPONSE_TOO_LARGE',
      'TASSYIR_BINDING_NOT_AVAILABLE',
    ] as const) {
      const { status } = HOSTED_BINDING_ERRORS[code];
      const admin = hostedAdmin(binding(() => bindingProblem(status, code)));
      const error = await admin
        .get('/orders')
        .catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(TassyirApiError);
      expect(error).toMatchObject({
        status,
        code,
        fix: `${code} fix`,
        docs: `https://developers.tassyir.io/errors/${code.toLowerCase().replace(/_/g, '-')}`,
        requestId: undefined,
      });
    }
  });

  it('never retries what retrying cannot change, and retries what it can', async () => {
    for (const [status, code] of [
      [502, 'RESPONSE_TOO_LARGE'],
      [503, 'TASSYIR_BINDING_NOT_AVAILABLE'],
      [401, 'HOSTED_CALL_REFUSED'],
    ] as const) {
      const tassyir = binding(() => bindingProblem(status, code));
      const admin = hostedAdmin(tassyir, { retries: 3 });
      await expect(admin.get('/orders')).rejects.toMatchObject({ code });
      expect(tassyir.calls, code).toHaveLength(1);
    }

    vi.useFakeTimers();
    const flaky = binding((_, index) =>
      index === 0
        ? bindingProblem(503, 'SERVICE_UNAVAILABLE', { 'retry-after': '1' })
        : Response.json({ data: [], nextCursor: null }),
    );
    const read = hostedAdmin(flaky, { retries: 3 }).get('/orders');
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(read).resolves.toEqual({ data: [], nextCursor: null });
    expect(flaky.calls).toHaveLength(2);
  });

  it('stops waiting at its timeout or the caller’s signal', async () => {
    const silent: TassyirBinding = {
      fetch: () => new Promise<Response>(() => undefined),
    };
    await expect(
      hostedAdmin(silent, { timeoutMs: 20 }).get('/orders'),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });

    const controller = new AbortController();
    const read = hostedAdmin(silent).get('/orders', {
      signal: controller.signal,
    });
    controller.abort(new Error('stop'));
    await expect(read).rejects.toThrow('stop');
  });

  it('refuses props without the binding', () => {
    expect(() => hostedAdmin({} as TassyirBinding)).toThrow(
      expect.objectContaining({ code: 'HOSTED_PROPS_MISSING' }),
    );
  });
});

// RFC 8032 §7.1 TEST 2, the seed behind the fixtures' `whk-test-2`.
const RFC8032_TEST2_SEED =
  '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb';
const privateKey = createPrivateKey({
  key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(RFC8032_TEST2_SEED, 'hex'),
  ]),
  format: 'der',
  type: 'pkcs8',
});
const NOW = vectors.nowMs;
const TS = NOW / 1000;
const ENVELOPE = {
  id: 'evt_1',
  type: 'orders/created',
  apiVersion: '2026-10',
  createdAt: '2026-10-14T08:59:00.000Z',
  businessId: INSTALLATION.businessId,
  storeId: null,
  appId: INSTALLATION.appId,
  installationId: INSTALLATION.id,
  changed: [],
  data: { order: { id: '1', total: '7500.00', currency: 'DZD' } },
};

function delivery(
  envelope: object = ENVELOPE,
  { id = 'dlv_42', timestamp = TS, signed = true } = {},
): Request {
  const body = JSON.stringify(envelope);
  const signature = sign(
    null,
    Buffer.from(`${id}.${String(timestamp)}.${body}`),
    privateKey,
  ).toString('base64');
  return new Request('https://review-requests.tassyir-apps.com/webhooks', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': String(timestamp),
      'webhook-signature': signed ? `v1a,${signature}` : 'v1,AAAA',
      'tassyir-topic': 'orders/created',
      'tassyir-business-id': INSTALLATION.businessId,
      'tassyir-api-version': '2026-10',
    },
    body,
  });
}

const now = () => NOW;
const noViewer = () => props({ viewer: null });

describe('verifyHostedWebhook', () => {
  it("takes the dispatcher's delivery for this installation, and verifies the signature when given keys", async () => {
    const plain = await verifyHostedWebhook(delivery(), noViewer(), { now });
    expect(plain).toMatchObject({
      id: 'dlv_42',
      topic: 'orders/created',
      installationId: INSTALLATION.id,
      test: false,
      signatureVerified: false,
    });

    const keys = WebhookKeys.fromPublicKeys(vectors.webhookKeys);
    const checked = await verifyHostedWebhook(delivery(), noViewer(), {
      now,
      keys,
    });
    expect(checked.signatureVerified).toBe(true);

    const forged = new Request(delivery(), {
      body: JSON.stringify({ ...ENVELOPE, data: { order: { id: '2' } } }),
    });
    await expect(
      verifyHostedWebhook(forged, noViewer(), { now, keys }),
    ).rejects.toMatchObject({ code: 'WEBHOOK_SIGNATURE_INVALID' });
  });

  it('refuses a request a member made from a page', async () => {
    await expect(
      verifyHostedWebhook(delivery(), props(), { now }),
    ).rejects.toMatchObject({
      code: 'WEBHOOK_NOT_A_DELIVERY',
      fix: expect.stringContaining('viewer null') as unknown,
    });
  });

  it('refuses an envelope of another installation, business or app', async () => {
    for (const [change, code] of [
      [{ installationId: '700' }, 'WEBHOOK_UNKNOWN_INSTALLATION'],
      [{ businessId: '701' }, 'WEBHOOK_UNKNOWN_INSTALLATION'],
      [{ appId: '702' }, 'WEBHOOK_WRONG_APP'],
    ] as const) {
      const envelope = { ...ENVELOPE, ...change };
      const request = delivery(envelope);
      request.headers.delete('tassyir-business-id');
      await expect(
        verifyHostedWebhook(request, noViewer(), { now }),
        code,
      ).rejects.toMatchObject({ code });
    }
  });

  it('keeps every other rule of a delivery: signature present, timestamp, test deliveries', async () => {
    await expect(
      verifyHostedWebhook(delivery(ENVELOPE, { signed: false }), noViewer(), {
        now,
      }),
    ).rejects.toMatchObject({ code: 'WEBHOOK_SIGNATURE_MISSING' });
    await expect(
      verifyHostedWebhook(
        delivery(ENVELOPE, { timestamp: TS - 301 }),
        noViewer(),
        { now },
      ),
    ).rejects.toMatchObject({ code: 'WEBHOOK_TIMESTAMP_OUT_OF_RANGE' });
    const test = delivery({ ...ENVELOPE, id: 'evt_0' }, { id: 'dlv_test_1' });
    await expect(
      verifyHostedWebhook(test, noViewer(), { now }),
    ).rejects.toMatchObject({ code: 'WEBHOOK_TEST_DELIVERY' });
    await expect(
      verifyHostedWebhook(
        delivery({ ...ENVELOPE, id: 'evt_0' }, { id: 'dlv_test_1' }),
        noViewer(),
        { now, testDeliveries: 'accept' },
      ),
    ).resolves.toMatchObject({ test: true });
  });
});
