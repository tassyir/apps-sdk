import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { AdminClient } from './admin-client.js';
import type { AdminClientOptions, ResponseInfo } from './admin-client.js';
import type {
  AdminApiErrorCode,
  AdminApiPaths,
  FieldName,
  ListItem,
  Order,
  Product,
  ResponseBody,
} from './admin-types.js';
import { TassyirApiError } from './errors.js';
import {
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
    expectTypeOf<ResponseBody<'get', '/orders/{id}'>>().toEqualTypeOf<{
      data: Order;
    }>();
    expectTypeOf<ListItem<'/products'>>().toEqualTypeOf<Product>();
    expectTypeOf<Order['total']>().toEqualTypeOf<string | null>();
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
  }
}
