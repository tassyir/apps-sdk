// The SDK's verifiers against tokens and deliveries signed by the BACKEND's
// own signIdToken / signWebhook (fixtures/backend-vectors.json, produced by
// scripts/generate-vectors.mjs at the commit recorded in the file).

import { describe, expect, it } from 'vitest';
import { TassyirVerificationError } from './errors.js';
import { verifyIdToken } from './id-token.js';
import { IdTokenKeys, WebhookKeys } from './keys.js';
import { vectors } from './vectors.test-helpers.js';
import { verifyWebhook } from './webhooks.js';

async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return 'ok';
  } catch (error) {
    if (error instanceof TassyirVerificationError) return error.code;
    throw error;
  }
}

describe('backend vectors', () => {
  it('come from a recorded backend commit', () => {
    expect(vectors.backend.repository).toBe('tassyir/backend');
    expect(vectors.backend.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('cover the negative cases the ticket names', () => {
    expect(Object.keys(vectors.idTokens)).toEqual(
      expect.arrayContaining([
        'wrongKid',
        'expired',
        'wrongAudience',
        'tamperedPayload',
      ]),
    );
    expect(Object.keys(vectors.webhooks)).toEqual(
      expect.arrayContaining([
        'tamperedBody',
        'wrongKey',
        'expiredTimestamp',
        'testDelivery',
      ]),
    );
  });
});

describe('verifyIdToken on backend-signed ID tokens', () => {
  const keys = IdTokenKeys.fromJwks(vectors.jwks);

  it.each(Object.entries(vectors.idTokens))(
    '%s → %s',
    async (_name, vector) => {
      const result = await outcome(() =>
        verifyIdToken(vector.token, {
          clientId: vectors.clientId,
          keys,
          now: () => vector.nowMs,
        }),
      );
      expect(result).toBe(vector.expect);
    },
  );

  it('returns the claims the backend signed', async () => {
    const vector = vectors.idTokens['valid'];
    if (!vector) throw new Error('missing vector');
    const verified = await verifyIdToken(vector.token, {
      clientId: vectors.clientId,
      keys,
      now: () => vector.nowMs,
    });
    expect(verified).toMatchObject({
      kid: 'idt-test-1',
      installationId: vectors.installationId,
      businessId: '741939488313319175',
      userId: '741939488313319001',
      sessionId: 'sid_k3Jd9QwPz1',
      locale: 'ar',
      claims: {
        iss: 'https://api.tassyir.io/apps',
        aud: vectors.clientId,
        iat: vectors.nowMs / 1000,
        nbf: vectors.nowMs / 1000,
        exp: vectors.nowMs / 1000 + 60,
      },
    });
    expect(verified.claims.jti).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe('verifyWebhook on backend-signed deliveries', () => {
  const keys = WebhookKeys.fromPublicKeys(vectors.webhookKeys);

  it.each(Object.entries(vectors.webhooks))(
    '%s → %s',
    async (_name, vector) => {
      const result = await outcome(() =>
        verifyWebhook(
          { headers: vector.headers, body: vector.body },
          {
            keys,
            appId: vectors.appId,
            installationId: vectors.installationId,
            now: () => vector.nowMs,
          },
        ),
      );
      expect(result).toBe(vector.expect);
    },
  );

  it('verifies the exact bytes, Arabic text included, as a Buffer, a Uint8Array or an ArrayBuffer', async () => {
    const vector = vectors.webhooks['valid'];
    if (!vector) throw new Error('missing vector');
    const bytes = new TextEncoder().encode(vector.body);
    for (const body of [
      Buffer.from(vector.body, 'utf8'),
      bytes,
      bytes.buffer,
    ]) {
      const verified = await verifyWebhook(
        { headers: vector.headers, body },
        {
          keys,
          appId: vectors.appId,
          installationId: vectors.installationId,
          now: () => vector.nowMs,
        },
      );
      expect(verified.event.type).toBe('orders/created');
    }
  });

  it('accepts a test delivery only when asked to, and marks it', async () => {
    for (const name of ['testDelivery', 'testDeliveryWithoutHeader']) {
      const vector = vectors.webhooks[name];
      if (!vector) throw new Error('missing vector');
      const verified = await verifyWebhook(
        { headers: vector.headers, body: vector.body },
        {
          keys,
          appId: vectors.appId,
          installationId: vectors.installationId,
          now: () => vector.nowMs,
          testDeliveries: 'accept',
        },
      );
      expect(verified.test).toBe(true);
      expect(verified.event.id).toBe('evt_0');
    }
  });
});
