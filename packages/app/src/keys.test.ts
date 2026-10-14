import { describe, expect, it } from 'vitest';
import { TassyirError } from './errors.js';
import { IdTokenKeys, WebhookKeys } from './keys.js';
import {
  jsonResponse,
  recordingFetch,
  vectors,
  containing,
} from './vectors.test-helpers.js';

const jwksAnswer = (
  keys = vectors.jwks.keys,
  headers: Record<string, string> = {},
) =>
  jsonResponse(
    200,
    { keys },
    { 'cache-control': 'public, max-age=3600', ...headers },
  );

describe('IdTokenKeys.remote', () => {
  it('fetches the JWKS from the API origin once and caches it', async () => {
    const { fetch, calls } = recordingFetch(() => jwksAnswer());
    const keys = IdTokenKeys.remote({ fetch });
    expect(await keys.get('idt-test-1')).toBeDefined();
    expect(await keys.get('idt-test-2')).toBeDefined();
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.tassyir.io/apps/.well-known/jwks.json',
    ]);
  });

  it('honours apiOrigin', async () => {
    const { fetch, calls } = recordingFetch(() => jwksAnswer());
    await IdTokenKeys.remote({
      fetch,
      apiOrigin: 'https://api.tassyir.test',
    }).get('idt-test-1');
    expect(calls[0]?.url).toBe(
      'https://api.tassyir.test/apps/.well-known/jwks.json',
    );
  });

  it('refetches once on an unknown kid, then respects the cool-down', async () => {
    let now = 0;
    const [first, second] = vectors.jwks.keys;
    if (!first || !second) throw new Error('missing vector');
    const { fetch, calls } = recordingFetch((_url, _init, index) =>
      jwksAnswer(index === 0 ? [first] : [first, second]),
    );
    const keys = IdTokenKeys.remote({ fetch, now: () => now });
    expect(await keys.get('idt-test-1')).toBeDefined();
    // A key published for a rotation after our fetch: found by one refetch.
    now = 31_000;
    expect(await keys.get('idt-test-2')).toBeDefined();
    expect(calls).toHaveLength(2);
    // Garbage kids cannot make us fetch more than once per cool-down.
    now = 32_000;
    expect(await keys.get('nope-1')).toBeUndefined();
    expect(await keys.get('nope-2')).toBeUndefined();
    expect(calls).toHaveLength(2);
    now = 62_000;
    expect(await keys.get('nope-3')).toBeUndefined();
    expect(calls).toHaveLength(3);
  });

  it('refetches after max-age, the shorter of the header and the option', async () => {
    let now = 0;
    const { fetch, calls } = recordingFetch(() =>
      jwksAnswer(undefined, { 'cache-control': 'max-age=60' }),
    );
    const keys = IdTokenKeys.remote({ fetch, now: () => now });
    await keys.get('idt-test-1');
    now = 59_000;
    await keys.get('idt-test-1');
    expect(calls).toHaveLength(1);
    now = 61_000;
    await keys.get('idt-test-1');
    expect(calls).toHaveLength(2);
  });

  it('fetches once for concurrent callers', async () => {
    const { fetch, calls } = recordingFetch(() => jwksAnswer());
    const keys = IdTokenKeys.remote({ fetch });
    await Promise.all(Array.from({ length: 10 }, () => keys.get('idt-test-1')));
    expect(calls).toHaveLength(1);
  });

  it('skips keys that are not Ed25519 signing keys', async () => {
    const [first] = vectors.jwks.keys;
    const { fetch } = recordingFetch(() =>
      jsonResponse(200, {
        keys: [
          { kty: 'RSA', kid: 'rsa', n: 'x', e: 'AQAB' },
          { ...first, kid: 'enc', use: 'enc' },
          { ...first, kid: 'short', x: 'AAAA' },
          first,
        ],
      }),
    );
    const keys = IdTokenKeys.remote({ fetch });
    expect(await keys.get('idt-test-1')).toBeDefined();
    for (const kid of ['rsa', 'enc', 'short'])
      expect(await keys.get(kid)).toBeUndefined();
  });

  it('says KEYS_NOT_CONFIGURED when the environment has no keys', async () => {
    const { fetch } = recordingFetch(() =>
      jsonResponse(503, {
        code: 'APPS_KEYS_NOT_CONFIGURED',
        message: 'x',
        keySet: 'id_token',
      }),
    );
    await expect(
      IdTokenKeys.remote({ fetch }).get('idt-test-1'),
    ).rejects.toMatchObject({
      code: 'KEYS_NOT_CONFIGURED',
      fix: containing('apiOrigin'),
    });
  });

  it('says KEYS_UNAVAILABLE on another error or a network failure, and retries on the next call', async () => {
    const { fetch, calls } = recordingFetch((_url, _init, index) => {
      if (index === 0) throw new TypeError('fetch failed');
      if (index === 1) return new Response('bad gateway', { status: 502 });
      return jwksAnswer();
    });
    const keys = IdTokenKeys.remote({ fetch });
    await expect(keys.get('idt-test-1')).rejects.toMatchObject({
      code: 'KEYS_UNAVAILABLE',
    });
    await expect(keys.get('idt-test-1')).rejects.toMatchObject({
      code: 'KEYS_UNAVAILABLE',
    });
    expect(await keys.get('idt-test-1')).toBeDefined();
    expect(calls).toHaveLength(3);
  });

  it('refuses a document that is not a key set', async () => {
    const { fetch } = recordingFetch(() => jsonResponse(200, { nope: true }));
    await expect(
      IdTokenKeys.remote({ fetch }).get('idt-test-1'),
    ).rejects.toMatchObject({ code: 'KEYS_INVALID' });
  });

  it('refuses an apiOrigin that is not an https origin', () => {
    for (const apiOrigin of [
      'http://api.tassyir.io',
      'https://api.tassyir.io/apps',
      'nope',
    ]) {
      expect(() => IdTokenKeys.remote({ apiOrigin })).toThrow(
        expect.objectContaining({ code: 'INVALID_OPTIONS' }) as Error,
      );
    }
    expect(() =>
      IdTokenKeys.remote({ apiOrigin: 'http://localhost:3000' }),
    ).not.toThrow();
  });
});

describe('WebhookKeys', () => {
  it('fetches /apps/webhook-keys and keeps the v1a keys', async () => {
    const { fetch, calls } = recordingFetch(() =>
      jsonResponse(200, {
        keys: [
          ...vectors.webhookKeys.keys,
          { kid: 'other', scheme: 'v2', publicKey: 'whpk_x' },
        ],
      }),
    );
    const keys = WebhookKeys.remote({ fetch });
    expect(await keys.all()).toHaveLength(2);
    expect(calls[0]?.url).toBe('https://api.tassyir.io/apps/webhook-keys');
  });

  it('refresh() refetches at most once per cool-down', async () => {
    let now = 0;
    const { fetch, calls } = recordingFetch(() =>
      jsonResponse(200, vectors.webhookKeys),
    );
    const keys = WebhookKeys.remote({ fetch, now: () => now });
    await keys.all();
    expect(await keys.refresh()).toBe(false);
    now = 30_000;
    expect(await keys.refresh()).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('fromPublicKeys takes whpk_ strings and refuses anything else', async () => {
    const strings = vectors.webhookKeys.keys.map((key) => key.publicKey);
    expect(await WebhookKeys.fromPublicKeys(strings).all()).toHaveLength(2);
    for (const bad of [
      'PUAXw+hDiVqStwqnTRt+vJyYLM8uxJaMwM1V8Sr0Zgw=',
      'whpk_AAAA',
      'whpk_not base64',
    ]) {
      await expect(
        WebhookKeys.fromPublicKeys([bad]).all(),
      ).rejects.toBeInstanceOf(TassyirError);
    }
  });
});
