import { createPrivateKey, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyIdToken } from './id-token.js';
import { IdTokenKeys } from './keys.js';
import {
  jsonResponse,
  recordingFetch,
  vectors,
} from './vectors.test-helpers.js';

// RFC 8032 §7.1 TEST 1: a published test vector, the seed behind the
// fixtures' `idt-test-1`. Used here to craft tokens the backend never signs.
const RFC8032_TEST1_SEED =
  '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const privateKey = createPrivateKey({
  key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(RFC8032_TEST1_SEED, 'hex'),
  ]),
  format: 'der',
  type: 'pkcs8',
});

const NOW = vectors.nowMs;
const iat = NOW / 1000;
const baseClaims = {
  iss: 'https://api.tassyir.io/apps',
  aud: vectors.clientId,
  sub: '741939488313319001',
  bid: '741939488313319175',
  iid: vectors.installationId,
  sid: 'sid_test',
  locale: 'en',
  iat,
  nbf: iat,
  exp: iat + 60,
  jti: 'jti-test-1',
};

function craft(
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${encode(header)}.${encode(claims)}`;
  return `${input}.${sign(null, Buffer.from(input), privateKey).toString('base64url')}`;
}

const keys = IdTokenKeys.fromJwks(vectors.jwks);
const verify = (token: string, now = NOW) =>
  verifyIdToken(token, { clientId: vectors.clientId, keys, now: () => now });
const HEADER = { alg: 'EdDSA', typ: 'JWT', kid: 'idt-test-1' };

describe('verifyIdToken', () => {
  it('accepts a token the SDK crafts like the backend', async () => {
    await expect(verify(craft(HEADER, baseClaims))).resolves.toMatchObject({
      installationId: vectors.installationId,
    });
  });

  it.each([
    ['a crit header', { ...HEADER, crit: ['exp'] }],
    ['typ other than JWT', { ...HEADER, typ: 'at+jwt' }],
    ['alg HS256', { ...HEADER, alg: 'HS256' }],
    ['no kid', { alg: 'EdDSA', typ: 'JWT' }],
  ])('refuses %s', async (_name, header) => {
    await expect(verify(craft(header, baseClaims))).rejects.toMatchObject({
      code: 'ID_TOKEN_UNSUPPORTED_HEADER',
    });
  });

  it.each([
    ['a lifetime over 60 s', { ...baseClaims, exp: iat + 61 }],
    ['exp before iat', { ...baseClaims, exp: iat - 1 }],
    ['a missing jti', { ...baseClaims, jti: undefined }],
    ['a string iat', { ...baseClaims, iat: String(iat) }],
  ])('refuses %s', async (_name, claims) => {
    await expect(verify(craft(HEADER, claims))).rejects.toMatchObject({
      code: 'ID_TOKEN_INVALID_CLAIMS',
    });
  });

  it('refuses another issuer', async () => {
    await expect(
      verify(
        craft(HEADER, { ...baseClaims, iss: 'https://evil.example/apps' }),
      ),
    ).rejects.toMatchObject({
      code: 'ID_TOKEN_WRONG_ISSUER',
    });
  });

  it('applies the backend leeway on both sides', async () => {
    const token = craft(HEADER, baseClaims);
    await expect(verify(token, (iat + 89) * 1000)).resolves.toBeDefined();
    await expect(verify(token, (iat + 90) * 1000)).rejects.toMatchObject({
      code: 'ID_TOKEN_EXPIRED',
    });
    await expect(verify(token, (iat - 30) * 1000)).resolves.toBeDefined();
    await expect(verify(token, (iat - 31) * 1000)).rejects.toMatchObject({
      code: 'ID_TOKEN_NOT_YET_VALID',
    });
    await expect(
      verifyIdToken(token, {
        clientId: vectors.clientId,
        keys,
        now: () => (iat + 60) * 1000,
        leewaySeconds: 0,
      }),
    ).rejects.toMatchObject({ code: 'ID_TOKEN_EXPIRED' });
  });

  it('refuses a signature that is not canonical or not 64 bytes', async () => {
    const token = craft(HEADER, baseClaims);
    await expect(verify(`${token.slice(0, -1)}A`)).rejects.toMatchObject({
      code: 'ID_TOKEN_BAD_SIGNATURE',
    });
    await expect(verify(`${token}AA`)).rejects.toMatchObject({
      code: 'ID_TOKEN_BAD_SIGNATURE',
    });
  });

  it.each([
    ['not a string', 42],
    ['too long', 'a'.repeat(4097)],
    ['two segments', 'a.b'],
    ['padding', 'eyJhbGciOiJFZERTQSJ9=.e30.AA'],
    ['a header that is not JSON', 'bm9wZQ.e30.AA'],
  ])('refuses a token that is %s', async (_name, token) => {
    await expect(verify(token as string)).rejects.toMatchObject({
      code: 'ID_TOKEN_MALFORMED',
    });
  });

  it('never echoes the token in the error', async () => {
    const token = craft(HEADER, { ...baseClaims, aud: 'app_someoneElse' });
    const error = await verify(token).catch(
      (caught: unknown) => caught as Error,
    );
    expect((error as Error).message).not.toContain(token.split('.')[2]);
    expect((error as { fix?: string }).fix).toContain('TASSYIR_CLIENT_ID');
  });

  it('validates its options', async () => {
    const token = craft(HEADER, baseClaims);
    await expect(
      verifyIdToken(token, { clientId: '', keys }),
    ).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
    await expect(
      verifyIdToken(token, {
        clientId: vectors.clientId,
        keys,
        leewaySeconds: 3600,
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_OPTIONS',
    });
  });

  it('fetches the JWKS again once for an unknown kid, then refuses', async () => {
    let clock = 0;
    const { fetch, calls } = recordingFetch(() =>
      jsonResponse(200, vectors.jwks),
    );
    const remote = IdTokenKeys.remote({ fetch, now: () => clock });
    const options = {
      clientId: vectors.clientId,
      keys: remote,
      now: () => NOW,
    };
    await verifyIdToken(craft(HEADER, baseClaims), options);
    expect(calls).toHaveLength(1);
    clock = 60_000;
    const unknown = craft({ ...HEADER, kid: 'idt-unknown' }, baseClaims);
    await expect(verifyIdToken(unknown, options)).rejects.toMatchObject({
      code: 'ID_TOKEN_UNKNOWN_KEY',
    });
    expect(calls).toHaveLength(2);
    clock = 61_000;
    await expect(verifyIdToken(unknown, options)).rejects.toMatchObject({
      code: 'ID_TOKEN_UNKNOWN_KEY',
    });
    expect(calls).toHaveLength(2);
  });
});
