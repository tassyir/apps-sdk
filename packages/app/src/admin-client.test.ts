import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { AdminClient } from './admin-client.js';
import type { AdminClientOptions, ResponseInfo } from './admin-client.js';
import type {
  AdminApiErrorCode,
  AdminApiPaths,
  CreateOfferInput,
  Discount,
  FieldName,
  ListItem,
  Offer,
  OfferAddon,
  OfferAppRule,
  OfferBxgy,
  OfferCode,
  OfferCodesBulkResult,
  OfferKind,
  OfferOrderDiscount,
  OfferRedemption,
  OfferRemoval,
  Order,
  OrderItem,
  Product,
  RequestOptions,
  ResponseBody,
} from './admin-types.js';
import { TassyirApiError } from './errors.js';
import { OFFER_CODES_BULK_MAX, addOfferCodes } from './offers.js';
import type { AppOfferConfig, AppOfferRule } from './offers.js';
import {
  bodyOf,
  headerOf,
  jsonResponse,
  recordingFetch,
} from './vectors.test-helpers.js';

const ORDER = {
  id: '741939488313319300',
  orderNumber: '1042',
  status: 'pending',
  currency: 'DZD',
  total: '2500.00',
  shippingPrice: '400.00',
};

function problem(
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return new Response(
    JSON.stringify({
      type: `https://developers.tassyir.io/errors/${code.toLowerCase()}`,
      title: 'Problem',
      status,
      detail: `detail of ${code}`,
      code,
      requestId: 'req-1',
      ...extra,
    }),
    {
      status,
      headers: { 'content-type': 'application/problem+json', ...headers },
    },
  );
}

function client(
  handler: Parameters<typeof recordingFetch>[0],
  options: Partial<AdminClientOptions> = {},
) {
  const { fetch, calls } = recordingFetch(handler);
  return {
    admin: new AdminClient({ accessToken: 'tsy_at_test', fetch, ...options }),
    calls,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('AdminClient requests', () => {
  it('builds the URL, encodes path parameters and joins fields', async () => {
    const { admin, calls } = client(() => jsonResponse(200, { data: ORDER }));
    await admin.get('/orders/{id}', {
      path: { id: '74/1' },
      query: { fields: ['status', 'total'] },
    });
    expect(calls[0]?.url).toBe(
      'https://api.tassyir.io/apps/2026-10/orders/74%2F1?fields=status%2Ctotal',
    );
    expect(calls[0]?.init.method).toBe('GET');
    expect(headerOf(calls[0], 'authorization')).toBe('Bearer tsy_at_test');
    expect(headerOf(calls[0], 'idempotency-key')).toBeUndefined();
  });

  it('keeps money a decimal string', async () => {
    const { admin } = client(
      () =>
        new Response(
          '{"data":{"id":"1","total":"2500.10","shippingPrice":"0.00"}}',
          { status: 200 },
        ),
    );
    const { data } = await admin.get('/orders/{id}', { path: { id: '1' } });
    expect(data.total).toBe('2500.10');
    expect(data.shippingPrice).toBe('0.00');
  });

  it('reads the order money as decimal strings, with the discount entries', async () => {
    const discount = {
      title: 'Autumn sale',
      code: null,
      class: 'product',
      source: 'offer',
      amount: '500.00',
      offerId: '741000000000000800',
    };
    const { admin, calls } = client(() =>
      jsonResponse(200, {
        data: {
          ...ORDER,
          total: '5000.00',
          shippingPrice: '500.00',
          subtotal: '5000.00',
          discountTotal: '500.00',
          discounts: [discount],
          items: [
            {
              id: '11',
              quantity: 1,
              unitPrice: '4500.00',
              totalPrice: '4500.00',
              originalPrice: '5000.00',
              discountAmount: '500.00',
              discounts: [discount],
            },
          ],
        },
      }),
    );
    const { data } = await admin.get('/orders/{id}', {
      path: { id: '1' },
      query: { fields: ['subtotal', 'discountTotal', 'discounts'] },
    });
    expect(calls[0]?.url).toContain(
      'fields=subtotal%2CdiscountTotal%2Cdiscounts',
    );
    const order = data;
    expect(order.subtotal).toBe('5000.00');
    expect(order.discountTotal).toBe('500.00');
    expect(order.discounts[0]?.offerId).toBe('741000000000000800');
    expect(order.items[0]?.originalPrice).toBe('5000.00');
    expect(order.items[0]?.discountAmount).toBe('500.00');
    expect(order.items[0]?.discounts[0]?.class).toBe('product');
  });

  it('sends a JSON body and a fresh Idempotency-Key on every write', async () => {
    const { admin, calls } = client(() => jsonResponse(201, { data: ORDER }));
    const body = {
      buyer: { name: 'Amina', phone: '0555000000' },
      items: [{ variantId: '9', quantity: 1 }],
    };
    await admin.post('/orders', { body } as never);
    await admin.post('/orders', { body } as never);
    expect(calls[0]?.init.body).toBe(JSON.stringify(body));
    expect(headerOf(calls[0], 'content-type')).toBe('application/json');
    const keys = calls.map((call) => headerOf(call, 'idempotency-key'));
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("uses the caller's Idempotency-Key, or none", async () => {
    const { admin, calls } = client(() => jsonResponse(200, { data: ORDER }));
    await admin.post('/orders/{id}/confirm', {
      path: { id: '1' },
      idempotencyKey: 'order-1-confirm',
    });
    await admin.post('/orders/{id}/confirm', {
      path: { id: '1' },
      idempotencyKey: false,
    });
    expect(headerOf(calls[0], 'idempotency-key')).toBe('order-1-confirm');
    expect(headerOf(calls[1], 'idempotency-key')).toBeUndefined();
    await expect(
      admin.post('/orders/{id}/confirm', {
        path: { id: '1' },
        idempotencyKey: 'has space',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  it('returns status and metadata from request()', async () => {
    const { admin } = client(() =>
      jsonResponse(
        200,
        { data: ORDER },
        {
          'ratelimit-limit': '40',
          'ratelimit-remaining': '39',
          'ratelimit-reset': '1',
          'x-request-id': 'req-9',
          'idempotent-replayed': 'true',
        },
      ),
    );
    const response = await admin.request('post', '/orders/{id}/confirm', {
      path: { id: '1' },
    });
    expect(response).toMatchObject({
      status: 200,
      requestId: 'req-9',
      replayed: true,
      rateLimit: { limit: 40, remaining: 39, resetSeconds: 1 },
    });
  });

  it('reports every answer to onResponse, never a token', async () => {
    const seen: ResponseInfo[] = [];
    const { admin } = client(
      () => jsonResponse(200, { data: ORDER }, { 'ratelimit-remaining': '3' }),
      {
        onResponse: (info) => seen.push(info),
      },
    );
    await admin.get('/orders/{id}', { path: { id: '1' } });
    expect(seen).toEqual([
      expect.objectContaining({
        operation: 'GET /orders/{id}',
        status: 200,
        attempt: 0,
      }),
    ]);
    expect(JSON.stringify(seen)).not.toContain('tsy_at_');
  });

  it("keeps the caller's headers but never lets them replace the token or the key", async () => {
    const { admin, calls } = client(() => jsonResponse(200, { data: ORDER }));
    await admin.post('/orders/{id}/confirm', {
      path: { id: '1' },
      idempotencyKey: 'k-1',
      headers: {
        'X-Trace': 't-1',
        Authorization: 'Bearer stolen',
        'Idempotency-Key': 'other',
      },
    });
    expect(headerOf(calls[0], 'x-trace')).toBe('t-1');
    expect(headerOf(calls[0], 'authorization')).toBe('Bearer tsy_at_test');
    expect(headerOf(calls[0], 'idempotency-key')).toBe('k-1');
  });

  it('refuses a missing path parameter before calling', async () => {
    const { admin, calls } = client(() => jsonResponse(200, {}));
    await expect(
      admin.get('/orders/{id}', { path: {} } as never),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(calls).toHaveLength(0);
  });
});

describe('AdminClient errors', () => {
  it('turns problem+json into a TassyirApiError', async () => {
    const { admin } = client(() =>
      problem(
        403,
        'PERMISSION_DENIED',
        { permission: 'orders:read', fix: 'Request the read_orders scope.' },
        { 'ratelimit-remaining': '12' },
      ),
    );
    const error = await admin.get('/orders').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TassyirApiError);
    expect(error).toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
      fix: 'Request the read_orders scope.',
      requestId: 'req-1',
      detail: 'detail of PERMISSION_DENIED',
      operation: 'GET /orders',
      problem: { permission: 'orders:read' },
      rateLimit: { remaining: 12 },
    });
    expect((error as Error).message).toContain('PERMISSION_DENIED');
  });

  it('gives a code to an answer that is not a problem document', async () => {
    const { admin } = client(
      () => new Response('<html>bad gateway</html>', { status: 502 }),
    );
    await expect(admin.get('/business')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 502,
    });
  });

  it('does not retry unless asked', async () => {
    const { admin, calls } = client(() =>
      problem(429, 'RATE_LIMITED', {}, { 'retry-after': '1' }),
    );
    await expect(admin.get('/business')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: 1,
    });
    expect(calls).toHaveLength(1);
  });
});

describe('AdminClient retries', () => {
  it('waits Retry-After on 429, then succeeds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { admin, calls } = client(
      (_url, _init, index) =>
        index === 0
          ? problem(429, 'RATE_LIMITED', {}, { 'retry-after': '2' })
          : jsonResponse(200, { data: ORDER }),
      { retries: 3 },
    );
    const result = admin.get('/orders/{id}', { path: { id: '1' } });
    await vi.advanceTimersByTimeAsync(1999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toMatchObject({ data: { id: ORDER.id } });
    expect(calls).toHaveLength(2);
  });

  it('retries a write with the same Idempotency-Key', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { admin, calls } = client(
      (_url, _init, index) => {
        if (index === 0) throw new TypeError('socket hang up');
        if (index === 1) return problem(409, 'IDEMPOTENCY_KEY_IN_USE');
        return jsonResponse(200, { data: ORDER });
      },
      { retries: { maxRetries: 3, baseDelayMs: 10 } },
    );
    const result = admin.post('/orders/{id}/confirm', { path: { id: '1' } });
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBeDefined();
    const keys = new Set(
      calls.map((call) => headerOf(call, 'idempotency-key')),
    );
    expect(calls).toHaveLength(3);
    expect(keys.size).toBe(1);
  });

  it('never retries a write without a key on a network error, nor a write on 500', async () => {
    const { admin, calls } = client(
      (_url, _init, index) => {
        if (index === 0) throw new TypeError('socket hang up');
        return problem(500, 'INTERNAL_ERROR');
      },
      { retries: 3 },
    );
    await expect(
      admin.post('/orders/{id}/confirm', {
        path: { id: '1' },
        idempotencyKey: false,
      }),
    ).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
    await expect(
      admin.post('/orders/{id}/confirm', { path: { id: '1' } }),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(calls).toHaveLength(2);
  });

  it('waits Retry-After on 429 BUSINESS_RATE_LIMITED, like RATE_LIMITED, writes included', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { admin, calls } = client(
      (_url, _init, index) =>
        index === 0
          ? problem(
              429,
              'BUSINESS_RATE_LIMITED',
              { limit: 20, retryAfter: 1 },
              { 'retry-after': '1' },
            )
          : jsonResponse(200, { data: ORDER }),
      { retries: 3 },
    );
    const result = admin.post('/orders/{id}/confirm', {
      path: { id: '1' },
      idempotencyKey: false,
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toMatchObject({ data: { id: ORDER.id } });
    expect(calls).toHaveLength(2);
  });

  it('retries 503 API_BUSY after Retry-After even for a write without a key (nothing was done)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { admin, calls } = client(
      (_url, _init, index) =>
        index === 0
          ? problem(
              503,
              'API_BUSY',
              { limit: 24, retryAfter: 1 },
              { 'retry-after': '1' },
            )
          : jsonResponse(200, { data: ORDER }),
      { retries: 3 },
    );
    const result = admin.post('/orders/{id}/confirm', {
      path: { id: '1' },
      idempotencyKey: false,
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toMatchObject({ data: { id: ORDER.id } });
    expect(calls).toHaveLength(2);
    expect(headerOf(calls[0], 'idempotency-key')).toBeUndefined();
  });

  it('never retries another 503 for a write without a key', async () => {
    const { admin, calls } = client(
      () => problem(503, 'SERVICE_UNAVAILABLE', {}, { 'retry-after': '1' }),
      { retries: 3 },
    );
    await expect(
      admin.post('/orders/{id}/confirm', {
        path: { id: '1' },
        idempotencyKey: false,
      }),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(calls).toHaveLength(1);
  });

  it('never retries 429 IMAGE_QUOTA_REACHED, even a short minute window (AP-B1.19)', async () => {
    const { admin, calls } = client(
      () =>
        problem(
          429,
          'IMAGE_QUOTA_REACHED',
          { per: 'installation', window: 'minute', limit: 30, retryAfter: 1 },
          { 'retry-after': '1' },
        ),
      { retries: 3 },
    );
    await expect(
      admin.post('/images', {
        body: { url: 'https://example.com/a.png' },
        idempotencyKey: 'image-1',
      }),
    ).rejects.toMatchObject({
      status: 429,
      code: 'IMAGE_QUOTA_REACHED',
      retryAfterSeconds: 1,
      problem: { per: 'installation', window: 'minute', limit: 30 },
    });
    expect(calls).toHaveLength(1);
  });

  it('retries 429 BULK_EXPORT_RATE_LIMITED after Retry-After, and gives up past maxDelayMs (AP-B1.8)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const EXPORT = { id: '7', resource: 'orders', status: 'queued' };
    const { admin, calls } = client(
      (_url, _init, index) =>
        index === 0
          ? problem(
              429,
              'BULK_EXPORT_RATE_LIMITED',
              { limit: 5, retryAfter: 2 },
              { 'retry-after': '2' },
            )
          : jsonResponse(201, { data: EXPORT }),
      { retries: 3 },
    );
    const result = admin.post('/bulk/exports', {
      body: { resource: 'orders' },
    });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toMatchObject({ data: { id: '7' } });
    expect(calls).toHaveLength(2);
    // The same Idempotency-Key on the retry: the API answers one export.
    expect(headerOf(calls[1], 'idempotency-key')).toBe(
      headerOf(calls[0], 'idempotency-key'),
    );

    const hourly = client(
      () =>
        problem(
          429,
          'BULK_EXPORT_RATE_LIMITED',
          { limit: 5, retryAfter: 1_800 },
          { 'retry-after': '1800' },
        ),
      { retries: 3 },
    );
    await expect(
      hourly.admin.post('/bulk/exports', { body: { resource: 'products' } }),
    ).rejects.toMatchObject({
      code: 'BULK_EXPORT_RATE_LIMITED',
      retryAfterSeconds: 1_800,
    });
    expect(hourly.calls).toHaveLength(1);
  });

  it('never retries 503 BULK_EXPORTS_NOT_CONFIGURED or 409 BULK_EXPORT_IN_PROGRESS', async () => {
    for (const [status, code] of [
      [503, 'BULK_EXPORTS_NOT_CONFIGURED'],
      [409, 'BULK_EXPORT_IN_PROGRESS'],
    ] as const) {
      const { admin, calls } = client(() => problem(status, code), {
        retries: 3,
      });
      await expect(
        admin.post('/bulk/exports', { body: { resource: 'customers' } }),
      ).rejects.toMatchObject({ status, code });
      expect(calls).toHaveLength(1);
    }
  });

  it('gives up when Retry-After is longer than maxDelayMs', async () => {
    const { admin, calls } = client(
      () => problem(503, 'SERVICE_UNAVAILABLE', {}, { 'retry-after': '120' }),
      { retries: 3 },
    );
    await expect(admin.get('/business')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      retryAfterSeconds: 120,
    });
    expect(calls).toHaveLength(1);
  });

  it('does not retry a refusal', async () => {
    const { admin, calls } = client(() => problem(404, 'NOT_FOUND'), {
      retries: 3,
    });
    await expect(
      admin.get('/orders/{id}', { path: { id: '1' } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(calls).toHaveLength(1);
  });
});

describe('AdminClient tokens', () => {
  it('asks the provider for a new token once after APP_TOKEN_INVALID', async () => {
    const asked: (string | undefined)[] = [];
    const { fetch, calls } = recordingFetch((_url, _init, index) =>
      index === 0
        ? problem(401, 'APP_TOKEN_INVALID')
        : jsonResponse(200, { data: ORDER }),
    );
    const admin = new AdminClient({
      fetch,
      accessToken: ({ rejectedAccessToken }) => {
        asked.push(rejectedAccessToken);
        return rejectedAccessToken ? 'tsy_at_new' : 'tsy_at_old';
      },
    });
    await admin.get('/orders/{id}', { path: { id: '1' } });
    expect(asked).toEqual([undefined, 'tsy_at_old']);
    expect(calls.map((call) => headerOf(call, 'authorization'))).toEqual([
      'Bearer tsy_at_old',
      'Bearer tsy_at_new',
    ]);
  });

  it('does not loop on a second refusal, nor retry a fixed token', async () => {
    const { fetch, calls } = recordingFetch(() =>
      problem(401, 'APP_TOKEN_INVALID'),
    );
    const admin = new AdminClient({ fetch, accessToken: () => 'tsy_at_x' });
    await expect(admin.get('/business')).rejects.toMatchObject({
      code: 'APP_TOKEN_INVALID',
    });
    expect(calls).toHaveLength(2);
    const fixed = client(() => problem(401, 'APP_TOKEN_INVALID'));
    await expect(fixed.admin.get('/business')).rejects.toMatchObject({
      code: 'APP_TOKEN_INVALID',
    });
    expect(fixed.calls).toHaveLength(1);
  });

  it('requires a token', () => {
    expect(() => new AdminClient({ accessToken: '' })).toThrow(
      expect.objectContaining({ code: 'INVALID_OPTIONS' }) as Error,
    );
  });
});

describe('AdminClient.paginate', () => {
  it('walks every page with the same filters and yields items', async () => {
    const pages = [
      { data: [{ id: '3' }, { id: '2' }], nextCursor: 'c1' },
      { data: [{ id: '1' }], nextCursor: null },
    ];
    const { admin, calls } = client((_url, _init, index) =>
      jsonResponse(200, pages[index]),
    );
    const ids: string[] = [];
    for await (const order of admin.paginate('/orders', {
      query: { status: 'pending', limit: 2 },
    }))
      ids.push(order.id);
    expect(ids).toEqual(['3', '2', '1']);
    expect(calls.map((call) => new URL(call.url).search)).toEqual([
      '?status=pending&limit=2',
      '?status=pending&limit=2&cursor=c1',
    ]);
  });

  it('lists offers with their filters, and reads one', async () => {
    const offer = {
      id: '741000000000002000',
      storeId: '741000000000000100',
      kind: 'a_kind_added_later',
      method: 'automatic',
      title: 'Buy 2, save 900',
      status: 'active',
      codeCount: 0,
    };
    const { admin, calls } = client((_url, _init, index) =>
      jsonResponse(
        200,
        index === 0
          ? { data: [offer], nextCursor: 'c1' }
          : index === 1
            ? { data: [], nextCursor: null }
            : { data: offer },
      ),
    );
    const seen: string[] = [];
    for await (const item of admin.paginate('/offers', {
      query: {
        status: 'active',
        method: 'automatic',
        storeId: '741000000000000100',
      },
    }))
      seen.push(`${item.kind} ${String(item.codeCount)}`);
    expect(seen).toEqual(['a_kind_added_later 0']);
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/apps/2026-10/offers',
      '/apps/2026-10/offers',
    ]);
    expect(calls.map((call) => new URL(call.url).search)).toEqual([
      '?status=active&method=automatic&storeId=741000000000000100',
      '?status=active&method=automatic&storeId=741000000000000100&cursor=c1',
    ]);
    const { data } = await admin.get('/offers/{id}', {
      path: { id: offer.id },
    });
    expect(new URL(calls[2]?.url ?? '').pathname).toBe(
      '/apps/2026-10/offers/741000000000002000',
    );
    expect(data.id).toBe(offer.id);
  });

  it('writes offers: create as a draft, publish, pause, resume and delete', async () => {
    const offer = { id: '741000000000002000', status: 'draft', appOwned: true };
    const { admin, calls } = client((_url, init, index) =>
      index === 0
        ? jsonResponse(201, { data: offer })
        : init.method === 'DELETE'
          ? jsonResponse(200, {
              data: { id: offer.id, deleted: false, archived: true },
            })
          : jsonResponse(200, { data: { ...offer, status: 'active' } }),
    );
    const created = await admin.request('post', '/offers', {
      body: {
        storeId: '741000000000000100',
        kind: 'product_discount',
        method: 'code',
        title: 'Influencer codes',
        config: { valueType: 'percent', value: 10 },
        targets: [{ refType: 'all' }],
      },
    });
    expect(created.status).toBe(201);
    await admin.post('/offers/{id}/publish', {
      path: { id: offer.id },
      body: { expectedVersion: 1 },
    });
    // The body of these three is optional: none is needed.
    await admin.post('/offers/{id}/pause', {
      path: { id: offer.id },
    });
    await admin.post('/offers/{id}/resume', {
      path: { id: offer.id },
    });
    await admin.patch('/offers/{id}', {
      path: { id: offer.id },
      body: { title: 'Autumn influencers', endsAt: '2026-12-31' },
    });
    const removed = await admin.delete('/offers/{id}', {
      path: { id: offer.id },
    });
    expect(removed.data).toEqual({
      id: offer.id,
      deleted: false,
      archived: true,
    });
    expect(
      calls.map(
        (call) => `${call.init.method ?? ''} ${new URL(call.url).pathname}`,
      ),
    ).toEqual([
      'POST /apps/2026-10/offers',
      'POST /apps/2026-10/offers/741000000000002000/publish',
      'POST /apps/2026-10/offers/741000000000002000/pause',
      'POST /apps/2026-10/offers/741000000000002000/resume',
      'PATCH /apps/2026-10/offers/741000000000002000',
      'DELETE /apps/2026-10/offers/741000000000002000',
    ]);
    // Every write carries an Idempotency-Key of its own.
    const keys = calls.map((call) => headerOf(call, 'idempotency-key'));
    expect(new Set(keys).size).toBe(6);
    expect(JSON.parse(bodyOf(calls[0]))).toMatchObject({
      kind: 'product_discount',
      config: { valueType: 'percent', value: 10 },
    });
  });

  it('adds codes in batches of 250 and gathers the answers in order', async () => {
    expect(OFFER_CODES_BULK_MAX).toBe(250);
    const { admin, calls } = client((_url, init) => {
      const { codes } = JSON.parse(
        typeof init.body === 'string' ? init.body : '',
      ) as {
        codes: { code: string }[];
      };
      return jsonResponse(200, {
        data: {
          created: codes.filter((c) => c.code !== 'TAKEN1').length,
          results: codes.map((c) => ({
            code: c.code,
            outcome: c.code === 'TAKEN1' ? 'taken' : 'created',
          })),
        },
      });
    });
    const codes = Array.from({ length: 600 }, (_, i) => ({
      code: i === 300 ? 'TAKEN1' : `INF${String(i).padStart(4, '0')}`,
      usageLimit: 50,
    }));
    const result = await addOfferCodes(admin, '741000000000002000', codes);
    expect(calls).toHaveLength(3);
    expect(
      calls.map(
        (call) =>
          (JSON.parse(bodyOf(call)) as { codes: unknown[] }).codes.length,
      ),
    ).toEqual([250, 250, 100]);
    expect(new URL(calls[0]?.url ?? '').pathname).toBe(
      '/apps/2026-10/offers/741000000000002000/codes/bulk',
    );
    expect(result.created).toBe(599);
    expect(result.results.map((r) => r.code)).toEqual(codes.map((c) => c.code));
    expect(result.results[300]).toEqual({ code: 'TAKEN1', outcome: 'taken' });
    // Nothing to add: no call.
    expect(await addOfferCodes(admin, '1', [])).toEqual({
      created: 0,
      results: [],
    });
    expect(calls).toHaveLength(3);
  });

  it('stops at the failing batch and throws its error', async () => {
    const { admin, calls } = client((_url, _init, index) =>
      index === 0
        ? jsonResponse(200, {
            data: {
              created: 1,
              results: [{ code: 'A1B', outcome: 'created' }],
            },
          })
        : problem(403, 'OFFER_NOT_OWNED', { fix: 'Create your own offer.' }),
    );
    const codes = Array.from({ length: 300 }, (_, i) => ({ code: `C${i}XY` }));
    const error: unknown = await addOfferCodes(admin, '9', codes).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(TassyirApiError);
    expect((error as TassyirApiError).code).toBe('OFFER_NOT_OWNED');
    expect(calls).toHaveLength(2);
  });

  it("walks an offer's codes and redemptions page by page", async () => {
    const { admin, calls } = client((url) =>
      jsonResponse(
        200,
        url.includes('cursor=')
          ? { data: [], nextCursor: null }
          : url.includes('/codes')
            ? { data: [{ id: '1', code: 'SARA10' }], nextCursor: 'c1' }
            : {
                data: [{ id: '5', orderId: '77', state: 'held' }],
                nextCursor: 'r1',
              },
      ),
    );
    const codes: string[] = [];
    for await (const code of admin.paginate('/offers/{id}/codes', {
      path: { id: '741000000000002000' },
    }))
      codes.push(code.code);
    const redemptions: string[] = [];
    for await (const redemption of admin.paginate('/offers/{id}/redemptions', {
      path: { id: '741000000000002000' },
      query: { state: 'held' },
    }))
      redemptions.push(`${redemption.orderId} ${redemption.state}`);
    expect(codes).toEqual(['SARA10']);
    expect(redemptions).toEqual(['77 held']);
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/apps/2026-10/offers/741000000000002000/codes',
      '/apps/2026-10/offers/741000000000002000/codes',
      '/apps/2026-10/offers/741000000000002000/redemptions',
      '/apps/2026-10/offers/741000000000002000/redemptions',
    ]);
    expect(new URL(calls[2]?.url ?? '').search).toBe('?state=held');
  });

  it('turns an offer an app does not own into a TassyirApiError', async () => {
    const { admin } = client(() =>
      problem(403, 'OFFER_NOT_OWNED', {
        fix: 'Create your own offer with POST /offers and change that one.',
      }),
    );
    const error: unknown = await admin
      .post('/offers/{id}/pause', { path: { id: '5' } })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TassyirApiError);
    expect((error as TassyirApiError).status).toBe(403);
    expect((error as TassyirApiError).code).toBe('OFFER_NOT_OWNED');
    expect((error as TassyirApiError).fix).toContain('POST /offers');
  });

  it('stops when the caller breaks', async () => {
    const { admin, calls } = client(() =>
      jsonResponse(200, {
        data: [{ id: '1' }, { id: '2' }],
        nextCursor: 'more',
      }),
    );
    for await (const product of admin.paginate('/products')) {
      expect(product.id).toBe('1');
      break;
    }
    expect(calls).toHaveLength(1);
  });
});

describe('AdminClient types (checked by tsc)', () => {
  it('derive bodies, items, fields and error codes from the OpenAPI document', () => {
    expectTypeOf<
      ResponseBody<'get', '/orders/{id}'>['data']
    >().toEqualTypeOf<Order>();
    // POST /orders takes the buyer's codes; the answer lists the ones that
    // did not apply, with the reason.
    expectTypeOf<
      NonNullable<ResponseBody<'post', '/orders'>['rejectedCodes']>[number]
    >().toEqualTypeOf<{ code: string; reason: string }>();
    expectTypeOf<ListItem<'/products'>>().toEqualTypeOf<Product>();
    // read_offers: `kind` is an open string (new kinds are added within the
    // version), the codes are a count, money a decimal string.
    expectTypeOf<ListItem<'/offers'>>().toEqualTypeOf<Offer>();
    expectTypeOf<ResponseBody<'get', '/offers/{id}'>>().toEqualTypeOf<{
      data: Offer;
    }>();
    expectTypeOf<Offer['kind']>().toEqualTypeOf<string>();
    expectTypeOf<Offer['codeCount']>().toEqualTypeOf<number>();
    expectTypeOf<Offer['storeId']>().toEqualTypeOf<string>();
    expectTypeOf<'STORE_SCOPE_FORBIDDEN' | 'INVALID_CURSOR'>().toExtend<
      AdminApiErrorCode<'get', '/offers'>
    >();
    expectTypeOf<Order['total']>().toEqualTypeOf<string | null>();
    // The order money: the goods, what the offers took off, and the entries
    // that name them. Lines are net; `originalPrice` is the gross unit price.
    expectTypeOf<Order['subtotal']>().toEqualTypeOf<string>();
    expectTypeOf<Order['discountTotal']>().toEqualTypeOf<string>();
    expectTypeOf<Order['discounts']>().toEqualTypeOf<Discount[]>();
    expectTypeOf<OrderItem['originalPrice']>().toEqualTypeOf<string | null>();
    expectTypeOf<OrderItem['discountAmount']>().toEqualTypeOf<string>();
    expectTypeOf<OrderItem['discounts']>().toEqualTypeOf<Discount[]>();
    expectTypeOf<Discount['class']>().toEqualTypeOf<
      'product' | 'order' | 'delivery'
    >();
    expectTypeOf<Discount['code']>().toEqualTypeOf<string | null>();
    expectTypeOf<Discount['offerId']>().toEqualTypeOf<string | null>();
    expectTypeOf<'subtotal' | 'discountTotal' | 'discounts'>().toExtend<
      FieldName<NonNullable<AdminApiPaths['/orders']['get']>>
    >();
    expectTypeOf<Product['price']>().toEqualTypeOf<string>();
    expectTypeOf<'total'>().toExtend<
      FieldName<NonNullable<AdminApiPaths['/orders']['get']>>
    >();
    expectTypeOf<'ORDER_LIMIT_REACHED'>().toExtend<
      AdminApiErrorCode<'post', '/orders/{id}/confirm'>
    >();
    expectTypeOf<'RATE_LIMITED'>().toExtend<
      AdminApiErrorCode<'get', '/orders'>
    >();
    // AP-B1.11: the business ceiling and the in-flight cap, on every operation.
    expectTypeOf<'BUSINESS_RATE_LIMITED' | 'API_BUSY'>().toExtend<
      AdminApiErrorCode<'post', '/orders/{id}/confirm'>
    >();
    expectTypeOf<'BUSINESS_RATE_LIMITED' | 'API_BUSY'>().toExtend<
      AdminApiErrorCode<'get', '/business'>
    >();
    // write_offers: the offers an app owns, their codes and redemptions.
    expectTypeOf<OfferKind>().toEqualTypeOf<
      | 'quantity'
      | 'free_delivery'
      | 'product_discount'
      | 'order_discount'
      | 'bxgy'
      | 'addon'
      | 'app'
    >();
    expectTypeOf<'OFFER_NOT_OWNED' | 'OFFER_INVALID'>().toExtend<
      AdminApiErrorCode<'patch', '/offers/{id}'>
    >();
    expectTypeOf<'OFFER_NOT_OWNED' | 'PLAN_LIMIT_REACHED'>().toExtend<
      AdminApiErrorCode<'post', '/offers/{id}/publish'>
    >();
    expectTypeOf<'OFFER_CODE_TAKEN' | 'OFFER_NOT_CODE_METHOD'>().toExtend<
      AdminApiErrorCode<'post', '/offers/{id}/codes'>
    >();
    expectTypeOf<'OFFER_NOT_OWNED'>().toExtend<
      AdminApiErrorCode<'get', '/offers/{id}/redemptions'>
    >();
    expectTypeOf<ResponseBody<'post', '/offers'>>().toEqualTypeOf<{
      data: Offer;
    }>();
    expectTypeOf<ResponseBody<'delete', '/offers/{id}'>>().toEqualTypeOf<{
      data: OfferRemoval;
    }>();
    expectTypeOf<
      ResponseBody<'post', '/offers/{id}/codes/bulk'>
    >().toEqualTypeOf<{
      data: OfferCodesBulkResult;
    }>();
    expectTypeOf<ListItem<'/offers/{id}/codes'>>().toEqualTypeOf<OfferCode>();
    expectTypeOf<
      ListItem<'/offers/{id}/redemptions'>
    >().toEqualTypeOf<OfferRedemption>();
    // The Phase 2 kinds: exactly one block is set, the others are null.
    expectTypeOf<
      Offer['orderDiscount']
    >().toEqualTypeOf<OfferOrderDiscount | null>();
    expectTypeOf<Offer['bxgy']>().toEqualTypeOf<OfferBxgy | null>();
    expectTypeOf<Offer['addon']>().toEqualTypeOf<OfferAddon | null>();
    expectTypeOf<Offer['appRule']>().toEqualTypeOf<OfferAppRule | null>();
    expectTypeOf<OfferAppRule['typeHandle']>().toEqualTypeOf<string>();
    expectTypeOf<OfferAppRule['rule']>().toEqualTypeOf<unknown>();
    expectTypeOf<OfferOrderDiscount['amount']>().toEqualTypeOf<string | null>();
    expectTypeOf<OfferBxgy['buyPieces']>().toEqualTypeOf<number>();
    expectTypeOf<OfferBxgy['getPrice']>().toEqualTypeOf<string | null>();
    expectTypeOf<OfferAddon['afterSubmit']>().toEqualTypeOf<boolean>();
    // publish, pause and resume take an optional body; a create needs its own.
    expectTypeOf<
      RequestOptions<'post', '/offers/{id}/pause'>['body']
    >().toEqualTypeOf<{ expectedVersion?: number | null } | undefined>();
    expectTypeOf<
      RequestOptions<'post', '/offers'>['body']
    >().toEqualTypeOf<CreateOfferInput>();
    expectTypeOf<OfferCode['uses']>().toEqualTypeOf<number>();
    expectTypeOf<OfferRedemption['amount']>().toEqualTypeOf<string>();
    expectTypeOf<OfferRedemption['codeId']>().toEqualTypeOf<string | null>();
    expectTypeOf<OfferRemoval['archived']>().toEqualTypeOf<boolean>();
    // The rule of an app-owned offer is a plain object the create body takes.
    expectTypeOf<AppOfferConfig>().toExtend<
      NonNullable<CreateOfferInput['config']>
    >();
    expectTypeOf<AppOfferRule['class']>().toEqualTypeOf<
      'product' | 'order' | 'delivery'
    >();
    // AP-B1.19: image uploads and their quota.
    expectTypeOf<'IMAGE_QUOTA_REACHED' | 'IMAGE_FETCH_FAILED'>().toExtend<
      AdminApiErrorCode<'post', '/images'>
    >();
    // AP-B1.8: bulk exports and their limits.
    expectTypeOf<
      | 'BULK_EXPORT_IN_PROGRESS'
      | 'BULK_EXPORT_RATE_LIMITED'
      | 'BULK_EXPORTS_NOT_CONFIGURED'
    >().toExtend<AdminApiErrorCode<'post', '/bulk/exports'>>();

    // Compiled, never run.
    const misuses = (admin: AdminClient) => {
      misuse(admin);
    };
    expect(misuses).toBeTypeOf('function');
  });
});

function misuse(admin: AdminClient): void {
  {
    // @ts-expect-error a path parameter is required
    void admin.get('/orders/{id}');
    // @ts-expect-error an unknown path
    void admin.get('/nope');
    // @ts-expect-error GET has no Idempotency-Key
    void admin.get('/orders', { idempotencyKey: 'x' });
    // @ts-expect-error an unknown field name
    void admin.get('/orders', { query: { fields: ['nope'] } });
    // @ts-expect-error a create needs its body
    void admin.post('/orders');
    void admin.patch('/products/{id}', {
      path: { id: '1' },
      // @ts-expect-error money is a string
      body: { price: 2500 },
    });
    void admin.post('/offers', {
      // @ts-expect-error an offer needs its store, kind, method and title
      body: { title: 'No store' },
    });
    void admin.post('/offers/{id}/codes/bulk', {
      path: { id: '1' },
      // @ts-expect-error a code is a string
      body: { codes: [{ code: 12345 }] },
    });
    const config: AppOfferConfig = {
      typeHandle: 'mix-match',
      rule: {
        // @ts-expect-error a rule's class is product, order or delivery
        class: 'cart',
        then: [],
      },
    };
    Object.keys(config);
  }
}
