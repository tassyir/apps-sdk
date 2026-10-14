import { createPrivateKey, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { WebhookKeys } from './keys.js';
import {
  jsonResponse,
  recordingFetch,
  vectors,
  containing,
} from './vectors.test-helpers.js';
import { verifyWebhook, verifyWebhookRequest } from './webhooks.js';
import type { VerifyWebhookOptions } from './webhooks.js';

// RFC 8032 §7.1 TEST 2: a published test vector, the seed behind the
// fixtures' `whk-test-2`. Used to sign deliveries the backend never sends.
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
  type: 'products/updated',
  apiVersion: '2026-10',
  createdAt: '2026-10-14T08:59:00.000Z',
  businessId: '741939488313319175',
  storeId: null,
  appId: vectors.appId,
  installationId: vectors.installationId,
  changed: ['price'],
  data: { product: { id: '1', price: '1999.00' } },
};

function signed(
  body: string,
  { id = 'dlv_42', timestamp = TS } = {},
): Record<string, string> {
  const signature = sign(
    null,
    Buffer.from(`${id}.${String(timestamp)}.${body}`),
    privateKey,
  ).toString('base64');
  return {
    'webhook-id': id,
    'webhook-timestamp': String(timestamp),
    'webhook-signature': `v1a,${signature}`,
  };
}

const keys = WebhookKeys.fromPublicKeys(vectors.webhookKeys);
const options = (
  extra: Partial<VerifyWebhookOptions> = {},
): VerifyWebhookOptions => ({
  keys,
  appId: vectors.appId,
  installationId: vectors.installationId,
  now: () => NOW,
  ...extra,
});

describe('verifyWebhook', () => {
  const body = JSON.stringify(ENVELOPE);

  it('returns the delivery and its envelope', async () => {
    await expect(
      verifyWebhook({ headers: signed(body), body }, options()),
    ).resolves.toEqual({
      id: 'dlv_42',
      timestamp: TS,
      topic: 'products/updated',
      businessId: ENVELOPE.businessId,
      installationId: vectors.installationId,
      apiVersion: '2026-10',
      test: false,
      event: ENVELOPE,
    });
  });

  it('keeps money a decimal string', async () => {
    const verified = await verifyWebhook(
      { headers: signed(body), body },
      options(),
    );
    if (verified.event.type !== 'products/updated')
      throw new Error('narrowing');
    expect(verified.event.data.product.price).toBe('1999.00');
  });

  it('reads a Fetch Request (Workers, Hono, Next.js)', async () => {
    const request = new Request('https://app.example/webhooks', {
      method: 'POST',
      headers: signed(body),
      body,
    });
    await expect(
      verifyWebhookRequest(request, options()),
    ).resolves.toMatchObject({ id: 'dlv_42' });
  });

  it('reads Headers, and Node header records in any case', async () => {
    const headers = signed(body);
    await expect(
      verifyWebhook({ headers: new Headers(headers), body }, options()),
    ).resolves.toBeDefined();
    const upper = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toUpperCase(), v]),
    );
    await expect(
      verifyWebhook({ headers: upper, body }, options()),
    ).resolves.toBeDefined();
  });

  it('accepts a v1a signature among others, and ignores malformed entries', async () => {
    const headers = signed(body);
    headers['webhook-signature'] =
      `v1,abc= v1a,!!! ${headers['webhook-signature'] ?? ''} v1a,AAAA`;
    await expect(
      verifyWebhook({ headers, body }, options()),
    ).resolves.toBeDefined();
  });

  it('accepts signatures repeated as separate headers', async () => {
    const headers = signed(body);
    const record = {
      ...headers,
      'webhook-signature': ['v1a,AAAA', headers['webhook-signature'] ?? ''],
    };
    await expect(
      verifyWebhook({ headers: record, body }, options()),
    ).resolves.toBeDefined();
  });

  it('refuses a parsed body with a fix that names the raw body', async () => {
    await expect(
      verifyWebhook(
        { headers: signed(body), body: ENVELOPE as unknown as string },
        options(),
      ),
    ).rejects.toMatchObject({
      code: 'WEBHOOK_BODY_NOT_RAW',
      fix: containing('express.raw'),
    });
  });

  it('refuses a body re-serialised with other spacing', async () => {
    const pretty = JSON.stringify(ENVELOPE, null, 2);
    await expect(
      verifyWebhook({ headers: signed(body), body: pretty }, options()),
    ).rejects.toMatchObject({
      code: 'WEBHOOK_SIGNATURE_INVALID',
    });
  });

  it.each(['webhook-id', 'webhook-timestamp', 'webhook-signature'])(
    'refuses a delivery without %s',
    async (name) => {
      const headers = Object.fromEntries(
        Object.entries(signed(body)).filter(([key]) => key !== name),
      );
      await expect(
        verifyWebhook({ headers, body }, options()),
      ).rejects.toMatchObject({ code: 'WEBHOOK_HEADER_MISSING' });
    },
  );

  it.each([
    ['an id with a dot', { 'webhook-id': 'dlv.1' }],
    [
      'a timestamp in ms with a fraction',
      { 'webhook-timestamp': `${String(TS)}.5` },
    ],
    ['a negative timestamp', { 'webhook-timestamp': '-1' }],
  ])('refuses %s', async (_name, override) => {
    const headers = { ...signed(body), ...override };
    await expect(
      verifyWebhook({ headers, body }, options()),
    ).rejects.toMatchObject({ code: 'WEBHOOK_HEADER_INVALID' });
  });

  it('refuses a timestamp more than the tolerance in the future or past', async () => {
    for (const timestamp of [TS + 301, TS - 301]) {
      const headers = signed(body, { timestamp });
      await expect(
        verifyWebhook({ headers, body }, options()),
      ).rejects.toMatchObject({
        code: 'WEBHOOK_TIMESTAMP_OUT_OF_RANGE',
      });
    }
    const headers = signed(body, { timestamp: TS - 301 });
    await expect(
      verifyWebhook({ headers, body }, options({ toleranceSeconds: 600 })),
    ).resolves.toBeDefined();
  });

  it('refuses a signed body that is not an envelope', async () => {
    const text = '{"hello":"world"}';
    await expect(
      verifyWebhook({ headers: signed(text), body: text }, options()),
    ).rejects.toMatchObject({
      code: 'WEBHOOK_BODY_INVALID',
    });
  });

  it('checks installations against a list or a function', async () => {
    const headers = signed(body);
    await expect(
      verifyWebhook(
        { headers, body },
        options({ installationId: ['x', vectors.installationId] }),
      ),
    ).resolves.toBeDefined();
    await expect(
      verifyWebhook({ headers, body }, options({ installationId: ['x'] })),
    ).rejects.toMatchObject({
      code: 'WEBHOOK_UNKNOWN_INSTALLATION',
    });
    const seen: string[] = [];
    await expect(
      verifyWebhook(
        { headers, body },
        options({
          installationId: (id) => {
            seen.push(id);
            return Promise.resolve(true);
          },
        }),
      ),
    ).resolves.toBeDefined();
    expect(seen).toEqual([vectors.installationId]);
  });

  it('refuses a business id header that disagrees with the envelope', async () => {
    const headers = { ...signed(body), 'tassyir-business-id': '1' };
    await expect(
      verifyWebhook({ headers, body }, options()),
    ).rejects.toMatchObject({ code: 'WEBHOOK_HEADER_MISMATCH' });
  });

  it('refuses a client id passed as appId', async () => {
    await expect(
      verifyWebhook(
        { headers: signed(body), body },
        options({ appId: vectors.clientId }),
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_OPTIONS',
    });
  });

  it('fetches the keys again when no key verifies, once per cool-down', async () => {
    let clock = 0;
    const [first, second] = vectors.webhookKeys.keys;
    // The signing key (whk-test-2) is published only from the second fetch.
    const { fetch, calls } = recordingFetch((_url, _init, index) =>
      jsonResponse(200, { keys: index === 0 ? [second] : [first, second] }),
    );
    const remote = WebhookKeys.remote({ fetch, now: () => clock });
    await remote.all();
    clock = 60_000;
    await expect(
      verifyWebhook({ headers: signed(body), body }, options({ keys: remote })),
    ).resolves.toBeDefined();
    expect(calls).toHaveLength(2);
  });
});
