import { createHash, createPrivateKey, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { WebhookKeys } from './keys.js';
import {
  proxySignatureContent,
  verifyProxy,
  verifyProxyRequest,
} from './proxy.js';
import type { ProxyRequest, VerifyProxyOptions } from './proxy.js';
import { vectors } from './vectors.test-helpers.js';
import { verifyWebhook } from './webhooks.js';

// verifyProxyRequest (AP-K2.3), built to the app proxy's contract before
// AP-B2.5 forwards anything (tassyir/backend docs/APPS_PHASE2_PLAN.md §7):
// Ed25519 `v1a` with a published webhook key over
// `tassyir-proxy.v1.{ts}.{METHOD}.{path+query}.{sha256 hex(body)}.{installationId}.{storeId}`.
// The requests are signed here with RFC 8032 §7.1 TEST 2's key, the seed
// behind the fixtures' `whk-test-2`.

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
const TS = String(NOW / 1000);
const INSTALLATION = vectors.installationId;
const STORE = '7400000000000000311';

interface Signing {
  method?: string;
  path?: string;
  body?: string;
  timestamp?: string;
  installationId?: string;
  storeId?: string;
}

/** The text by the plan's words, built independently of the package. */
function contentOf(fields: Required<Signing>): string {
  const digest = createHash('sha256').update(fields.body, 'utf8').digest('hex');
  return `tassyir-proxy.v1.${fields.timestamp}.${fields.method}.${fields.path}.${digest}.${fields.installationId}.${fields.storeId}`;
}

function signedRequest(
  signing: Signing = {},
  overrides: Omit<Partial<ProxyRequest>, 'headers'> & {
    headers?: Record<string, string>;
  } = {},
): ProxyRequest {
  const fields: Required<Signing> = {
    method: 'GET',
    path: '/proxy/reviews?product=42&page=2',
    body: '',
    timestamp: TS,
    installationId: INSTALLATION,
    storeId: STORE,
    ...signing,
  };
  const signature = sign(
    null,
    Buffer.from(contentOf(fields)),
    privateKey,
  ).toString('base64');
  return {
    method: fields.method,
    url: fields.path,
    body: fields.body === '' ? undefined : fields.body,
    ...overrides,
    headers: {
      'tassyir-proxy-timestamp': fields.timestamp,
      'tassyir-proxy-signature': `v1a,${signature}`,
      'tassyir-installation-id': fields.installationId,
      'tassyir-store-id': fields.storeId,
      'tassyir-business-id': '741939488313319175',
      'tassyir-store-host': 'dar-amina.tassyir.io',
      'tassyir-country': 'DZ',
      'tassyir-locale': 'ar',
      ...overrides.headers,
    },
  };
}

const keys = WebhookKeys.fromPublicKeys(vectors.webhookKeys);
const options = (
  extra: Partial<VerifyProxyOptions> = {},
): VerifyProxyOptions => ({
  keys,
  installationId: INSTALLATION,
  now: () => NOW,
  ...extra,
});

async function refusal(
  request: ProxyRequest,
  extra: Partial<VerifyProxyOptions> = {},
): Promise<{ code: string; fix: string }> {
  try {
    await verifyProxy(request, options(extra));
  } catch (error) {
    return error as { code: string; fix: string };
  }
  throw new Error('verified');
}

describe('verifyProxy', () => {
  it('returns what the signature covers, and the unsigned context apart', async () => {
    await expect(verifyProxy(signedRequest(), options())).resolves.toEqual({
      installationId: INSTALLATION,
      storeId: STORE,
      timestamp: NOW / 1000,
      method: 'GET',
      path: '/proxy/reviews?product=42&page=2',
      unsigned: {
        businessId: '741939488313319175',
        storeHost: 'dar-amina.tassyir.io',
        country: 'DZ',
        locale: 'ar',
      },
    });
  });

  it('signs the text the plan names, label first', async () => {
    const text = await proxySignatureContent({
      timestamp: TS,
      method: 'POST',
      path: '/proxy/x',
      body: new TextEncoder().encode('{"a":1}'),
      installationId: INSTALLATION,
      storeId: STORE,
    });
    expect(text).toBe(
      contentOf({
        timestamp: TS,
        method: 'POST',
        path: '/proxy/x',
        body: '{"a":1}',
        installationId: INSTALLATION,
        storeId: STORE,
      }),
    );
    expect(text.startsWith('tassyir-proxy.v1.')).toBe(true);
  });

  it('takes the body as a string or as bytes, and refuses a changed body', async () => {
    const body = '{"rating":5}';
    const request = signedRequest({ method: 'POST', body });
    await expect(verifyProxy(request, options())).resolves.toMatchObject({
      method: 'POST',
    });
    await expect(
      verifyProxy(
        { ...request, body: new TextEncoder().encode(body) },
        options(),
      ),
    ).resolves.toMatchObject({ method: 'POST' });
    expect((await refusal({ ...request, body: '{"rating":1}' })).code).toBe(
      'PROXY_SIGNATURE_INVALID',
    );
    expect(
      (await refusal({ ...request, body: { rating: 5 } as never })).code,
    ).toBe('PROXY_BODY_NOT_RAW');
  });

  it.each([
    ['the path', { url: '/proxy/reviews?product=43&page=2' }],
    ['the query order', { url: '/proxy/reviews?page=2&product=42' }],
    ['the method', { method: 'POST' }],
  ])('refuses a request whose %s changed', async (_, change) => {
    const error = await refusal({ ...signedRequest(), ...change });
    expect(error.code).toBe('PROXY_SIGNATURE_INVALID');
    expect(error.fix).toContain('path and query as received');
  });

  it('refuses another installation or store put in the headers', async () => {
    const other = await refusal(
      signedRequest(
        {},
        { headers: { 'tassyir-store-id': '7400000000000000312' } },
      ),
    );
    expect(other.code).toBe('PROXY_SIGNATURE_INVALID');
    const moved = await refusal(
      signedRequest(
        {},
        { headers: { 'tassyir-installation-id': '7400000000000000999' } },
      ),
      { installationId: () => true },
    );
    expect(moved.code).toBe('PROXY_SIGNATURE_INVALID');
  });

  it("never verifies a webhook's signature as a proxy request, nor the reverse", async () => {
    const body = '';
    const webhookSignature = sign(
      null,
      Buffer.from(`dlv_42.${TS}.${body}`),
      privateKey,
    ).toString('base64');
    const error = await refusal(
      signedRequest(
        {},
        { headers: { 'tassyir-proxy-signature': `v1a,${webhookSignature}` } },
      ),
    );
    expect(error.code).toBe('PROXY_SIGNATURE_INVALID');
    const proxy = signedRequest();
    await expect(
      verifyWebhook(
        {
          headers: {
            'webhook-id': 'dlv_42',
            'webhook-timestamp': TS,
            'webhook-signature': String(
              (proxy.headers as Record<string, string>)[
                'tassyir-proxy-signature'
              ],
            ),
          },
          body,
        },
        {
          keys,
          appId: vectors.appId,
          installationId: INSTALLATION,
          now: () => NOW,
        },
      ),
    ).rejects.toMatchObject({ code: 'WEBHOOK_SIGNATURE_INVALID' });
  });

  it('refuses a stale or future timestamp, missing headers and malformed ids', async () => {
    const stale = await refusal(
      signedRequest({ timestamp: String(NOW / 1000 - 301) }),
    );
    expect(stale.code).toBe('PROXY_TIMESTAMP_OUT_OF_RANGE');
    const future = await refusal(
      signedRequest({ timestamp: String(NOW / 1000 + 301) }),
    );
    expect(future.code).toBe('PROXY_TIMESTAMP_OUT_OF_RANGE');
    for (const name of [
      'tassyir-proxy-timestamp',
      'tassyir-proxy-signature',
      'tassyir-installation-id',
      'tassyir-store-id',
    ]) {
      const error = await refusal(
        signedRequest({}, { headers: { [name]: '' } }),
      );
      expect([name, error.code]).toEqual([name, 'PROXY_HEADER_MISSING']);
    }
    const malformed = await refusal(signedRequest({ storeId: 'store-1' }));
    expect(malformed.code).toBe('PROXY_HEADER_INVALID');
    const unsigned = await refusal(
      signedRequest({}, { headers: { 'tassyir-proxy-signature': 'v1,abc' } }),
    );
    expect(unsigned.code).toBe('PROXY_SIGNATURE_MISSING');
  });

  it('holds the installation to your check: an id, a list, or a lookup', async () => {
    expect((await refusal(signedRequest(), { installationId: '1' })).code).toBe(
      'PROXY_UNKNOWN_INSTALLATION',
    );
    await expect(
      verifyProxy(
        signedRequest(),
        options({ installationId: ['1', INSTALLATION] }),
      ),
    ).resolves.toMatchObject({ installationId: INSTALLATION });
    const seen: [string, string][] = [];
    await verifyProxy(
      signedRequest(),
      options({
        installationId: (installationId, storeId) => {
          seen.push([installationId, storeId]);
          return Promise.resolve(true);
        },
      }),
    );
    expect(seen).toEqual([[INSTALLATION, STORE]]);
  });

  it('needs an installation check: the signature is the same for every app', async () => {
    await expect(
      verifyProxy(signedRequest(), {
        keys,
        installationId: undefined as never,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
    await expect(
      verifyProxy(signedRequest(), options({ toleranceSeconds: 0 })),
    ).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
  });
});

describe('verifyProxyRequest', () => {
  it('reads a Fetch Request: its method, path and query, headers and body', async () => {
    const body = '{"rating":4}';
    const signed = signedRequest({ method: 'POST', path: '/proxy/rate', body });
    const request = new Request('https://reviews.acme-apps.dz/proxy/rate', {
      method: 'POST',
      headers: signed.headers as Record<string, string>,
      body,
    });
    await expect(verifyProxyRequest(request, options())).resolves.toMatchObject(
      {
        method: 'POST',
        path: '/proxy/rate',
      },
    );
  });

  it('signs a GET over an empty body', async () => {
    const signed = signedRequest();
    const request = new Request(
      'https://reviews.acme-apps.dz/proxy/reviews?product=42&page=2',
      { headers: signed.headers as Record<string, string> },
    );
    await expect(verifyProxyRequest(request, options())).resolves.toMatchObject(
      {
        path: '/proxy/reviews?product=42&page=2',
      },
    );
  });
});
