// Signs the cross-check vectors in fixtures/backend-vectors.json with the
// BACKEND's own code, so the SDK's verifiers are tested against what
// production signs, not against themselves.
//
//   TASSYIR_BACKEND_DIR=~/src/backend npm run vectors:generate -w @tassyir/app [-- --ref origin/master]
//
// It reads, at one commit of the backend clone (read only, `git show`):
//   src/app-platform/auth/app-keys.ts            parseAppKeySet
//   src/app-platform/auth/id-token.ts            signIdToken
//   src/app-platform/auth/webhook-signature.ts   signWebhook, webhookPublicKey
//   src/app-platform/auth/app-keys.test-harness.ts  the fixed RFC 8032 §7.1 test keys
// transpiles them with the repo's TypeScript into a temporary folder, and
// runs them. Only public keys and signed outputs are written: the test seeds
// are the RFC's published vectors, never a real key.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as prettier from 'prettier';
import ts from 'typescript';
import {
  backendDir,
  refArgument,
  resolveCommit,
  showFile,
} from './backend.mjs';

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(PACKAGE, 'fixtures', 'backend-vectors.json');
const AUTH = 'src/app-platform/auth';
const FILES = [
  'app-keys',
  'id-token',
  'webhook-signature',
  'app-keys.test-harness',
];

/** 2026-10-14T09:00:00Z: every vector is signed relative to this instant. */
const NOW_MS = Date.UTC(2026, 9, 14, 9, 0, 0);
const NOW_S = NOW_MS / 1000;

const CLIENT_ID = 'app_7Hq2Kx9Vb4Nm1Lp8Zr3Ty6Wd5Q';
const OTHER_CLIENT_ID = 'app_0OtherAppClientIdXy9Zw8Vu';
const APP_ID = '9310000000000000001';
const INSTALLATION_ID = '9330000000000000001';
const BUSINESS_ID = '741939488313319175';
const SUBJECT = {
  clientId: CLIENT_ID,
  userId: '741939488313319001',
  businessId: BUSINESS_ID,
  installationId: INSTALLATION_ID,
  sessionId: 'sid_k3Jd9QwPz1',
  locale: 'ar',
};

/** @typedef {{ kid: string, publicKeyRaw: Buffer }} BackendKey */
/** @typedef {{ keys: BackendKey[], signing: BackendKey[] }} BackendKeySet */
/** @typedef {{ kid: string, seedHex: string, active: boolean }} TestKeyEntry */
/** @typedef {typeof SUBJECT} Subject */
/**
 * @typedef {{
 *   signIdToken: (keys: BackendKeySet, subject: Subject, nowMs: number) => string,
 *   signWebhook: (keys: BackendKeySet, id: string, timestamp: number, body: string) => string,
 *   webhookPublicKey: (key: BackendKey) => string,
 *   RFC8032: Record<'test1' | 'test2' | 'test3', { seedHex: string }>,
 *   testKeySet: (entries: TestKeyEntry[], name: string) => BackendKeySet,
 * }} Backend
 */

const dir = backendDir();
const ref = refArgument(process.argv);
const commit = resolveCommit(dir, ref);

const work = mkdtempSync(join(tmpdir(), 'tassyir-vectors-'));
try {
  for (const name of FILES) {
    const source = showFile(dir, commit, `${AUTH}/${name}.ts`);
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: `${name}.ts`,
    });
    // Relative imports gain the extension Node's ESM loader needs.
    const code = outputText.replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'");
    writeFileSync(join(work, `${name}.mjs`), code);
  }
  /** @param {string} name */
  const load = async (name) => {
    /** @type {unknown} */
    const loaded = await import(pathToFileURL(join(work, `${name}.mjs`)).href);
    return /** @type {Partial<Backend>} */ (loaded);
  };
  const backend = /** @type {Backend} */ ({
    ...(await load('id-token')),
    ...(await load('webhook-signature')),
    ...(await load('app-keys.test-harness')),
  });
  const { signIdToken, signWebhook, webhookPublicKey, RFC8032, testKeySet } =
    backend;

  // ID-token keys: test1 signs, test2 is published too (a rotation), test3
  // signs under a kid nobody publishes.
  const idKeysPublished = testKeySet(
    [
      { kid: 'idt-test-1', seedHex: RFC8032.test1.seedHex, active: true },
      { kid: 'idt-test-2', seedHex: RFC8032.test2.seedHex, active: false },
    ],
    'APPS_ID_TOKEN_KEYS',
  );
  const idKeysRotated = testKeySet(
    [{ kid: 'idt-test-2', seedHex: RFC8032.test2.seedHex, active: true }],
    'APPS_ID_TOKEN_KEYS',
  );
  const idKeysUnpublished = testKeySet(
    [{ kid: 'idt-retired', seedHex: RFC8032.test3.seedHex, active: true }],
    'APPS_ID_TOKEN_KEYS',
  );
  // The JWKS exactly as AppKeysService builds it.
  const jwks = {
    keys: idKeysPublished.keys.map((key) => ({
      kty: 'OKP',
      crv: 'Ed25519',
      x: key.publicKeyRaw.toString('base64url'),
      kid: key.kid,
      alg: 'EdDSA',
      use: 'sig',
    })),
  };

  // Webhook keys: test2 and test3 published; test1 is an ID-token key, never
  // a webhook key.
  const webhookKeysPublished = testKeySet(
    [
      { kid: 'whk-test-2', seedHex: RFC8032.test2.seedHex, active: true },
      { kid: 'whk-test-3', seedHex: RFC8032.test3.seedHex, active: false },
    ],
    'APPS_WEBHOOK_KEYS',
  );
  const webhookKeysRotating = testKeySet(
    [
      { kid: 'whk-test-2', seedHex: RFC8032.test2.seedHex, active: true },
      { kid: 'whk-test-3', seedHex: RFC8032.test3.seedHex, active: true },
    ],
    'APPS_WEBHOOK_KEYS',
  );
  const webhookKeysForeign = testKeySet(
    [{ kid: 'whk-foreign', seedHex: RFC8032.test1.seedHex, active: true }],
    'APPS_WEBHOOK_KEYS',
  );
  const webhookKeys = {
    keys: webhookKeysPublished.keys.map((key) => ({
      kid: key.kid,
      scheme: 'v1a',
      publicKey: webhookPublicKey(key),
    })),
  };

  /**
   * @param {BackendKeySet} keys
   * @param {Subject} [subject]
   * @param {number} [atMs]
   */
  const idToken = (keys, subject = SUBJECT, atMs = NOW_MS) =>
    signIdToken(keys, subject, atMs);
  const valid = idToken(idKeysPublished);
  const [header = '', payload = '', signature = ''] = valid.split('.');
  /** @type {unknown} */
  const decoded = JSON.parse(
    Buffer.from(payload, 'base64url').toString('utf8'),
  );
  const claims = /** @type {{ exp: number }} */ (decoded);
  const tamperedPayload = Buffer.from(
    JSON.stringify({ ...claims, iid: '9339999999999999999' }),
    'utf8',
  ).toString('base64url');
  const noneHeader = Buffer.from(
    JSON.stringify({ alg: 'none', typ: 'JWT', kid: 'idt-test-1' }),
  ).toString('base64url');

  const idTokens = {
    valid: { token: valid, nowMs: NOW_MS, expect: 'ok' },
    validAtLeewayEdge: {
      token: valid,
      nowMs: (claims.exp + 29) * 1000,
      expect: 'ok',
    },
    signedByRotatedKey: {
      token: idToken(idKeysRotated),
      nowMs: NOW_MS,
      expect: 'ok',
    },
    wrongKid: {
      token: idToken(idKeysUnpublished),
      nowMs: NOW_MS,
      expect: 'ID_TOKEN_UNKNOWN_KEY',
    },
    expired: {
      token: valid,
      nowMs: (claims.exp + 30) * 1000,
      expect: 'ID_TOKEN_EXPIRED',
    },
    signedTwoMinutesAgo: {
      token: idToken(idKeysPublished, SUBJECT, NOW_MS - 120_000),
      nowMs: NOW_MS,
      expect: 'ID_TOKEN_EXPIRED',
    },
    notYetValid: {
      token: idToken(idKeysPublished, SUBJECT, NOW_MS + 120_000),
      nowMs: NOW_MS,
      expect: 'ID_TOKEN_NOT_YET_VALID',
    },
    wrongAudience: {
      token: idToken(idKeysPublished, {
        ...SUBJECT,
        clientId: OTHER_CLIENT_ID,
      }),
      nowMs: NOW_MS,
      expect: 'ID_TOKEN_WRONG_AUDIENCE',
    },
    tamperedPayload: {
      token: `${header}.${tamperedPayload}.${signature}`,
      nowMs: NOW_MS,
      expect: 'ID_TOKEN_BAD_SIGNATURE',
    },
    algNone: {
      token: `${noneHeader}.${payload}.`,
      nowMs: NOW_MS,
      expect: 'ID_TOKEN_MALFORMED',
    },
    algNoneSigned: {
      token: `${noneHeader}.${payload}.${signature}`,
      nowMs: NOW_MS,
      expect: 'ID_TOKEN_UNSUPPORTED_HEADER',
    },
  };

  /** @param {Record<string, unknown>} [overrides] */
  const envelope = (overrides = {}) =>
    JSON.stringify({
      id: 'evt_7419394883133191',
      type: 'orders/created',
      apiVersion: '2026-10',
      createdAt: '2026-10-14T08:59:58.120Z',
      businessId: BUSINESS_ID,
      storeId: '741939488313319200',
      appId: APP_ID,
      installationId: INSTALLATION_ID,
      changed: [],
      data: {
        order: {
          id: '741939488313319300',
          orderNumber: '1042',
          status: 'pending',
          currency: 'DZD',
          total: '2500.00',
          buyer: { name: 'أمينة بن علي', phone: '0555000000' },
        },
      },
      ...overrides,
    });
  /**
   * @param {string} id
   * @param {number} timestamp
   * @param {string} signatureHeader
   * @param {Record<string, string>} [extra]
   * @returns {Record<string, string>}
   */
  const headers = (id, timestamp, signatureHeader, extra = {}) => ({
    'webhook-id': id,
    'webhook-timestamp': String(timestamp),
    'webhook-signature': signatureHeader,
    'tassyir-topic': 'orders/created',
    'tassyir-business-id': BUSINESS_ID,
    'tassyir-api-version': '2026-10',
    ...extra,
  });
  /**
   * @param {BackendKeySet} keys
   * @param {{ id?: string, timestamp?: number, body?: string, extra?: Record<string, string> }} [options]
   */
  const delivery = (
    keys,
    {
      id = 'dlv_7419394883133191001',
      timestamp = NOW_S,
      body = envelope(),
      extra,
    } = {},
  ) => ({
    headers: headers(
      id,
      timestamp,
      signWebhook(keys, id, timestamp, body),
      extra,
    ),
    body,
  });

  const validDelivery = delivery(webhookKeysPublished);
  const testId = 'dlv_test_0123456789abcdef01234567';
  const testBody = envelope({ id: 'evt_0' });
  const testDelivery = delivery(webhookKeysPublished, {
    id: testId,
    body: testBody,
    extra: { 'tassyir-test': 'true' },
  });
  const testHeadersWithoutFlag = Object.fromEntries(
    Object.entries(testDelivery.headers).filter(
      ([name]) => name !== 'tassyir-test',
    ),
  );

  const webhooks = {
    valid: { ...validDelivery, nowMs: NOW_MS, expect: 'ok' },
    rotationTwoSignatures: {
      ...delivery(webhookKeysRotating),
      nowMs: NOW_MS,
      expect: 'ok',
    },
    signedFourMinutesAgo: {
      ...delivery(webhookKeysPublished, { timestamp: NOW_S - 240 }),
      nowMs: NOW_MS,
      expect: 'ok',
    },
    tamperedBody: {
      headers: validDelivery.headers,
      body: validDelivery.body.replace('"2500.00"', '"25.00"'),
      nowMs: NOW_MS,
      expect: 'WEBHOOK_SIGNATURE_INVALID',
    },
    wrongKey: {
      ...delivery(webhookKeysForeign),
      nowMs: NOW_MS,
      expect: 'WEBHOOK_SIGNATURE_INVALID',
    },
    expiredTimestamp: {
      ...delivery(webhookKeysPublished, { timestamp: NOW_S - 600 }),
      nowMs: NOW_MS,
      expect: 'WEBHOOK_TIMESTAMP_OUT_OF_RANGE',
    },
    hmacV1Only: {
      headers: {
        ...validDelivery.headers,
        'webhook-signature': 'v1,K5oZfzN95Z9UVu1EsfQmfVNQhnkZ2pj9o9NDN/H/pI4=',
      },
      body: validDelivery.body,
      nowMs: NOW_MS,
      expect: 'WEBHOOK_SIGNATURE_MISSING',
    },
    wrongAppId: {
      ...delivery(webhookKeysPublished, {
        body: envelope({ appId: '9310000000000000999' }),
      }),
      nowMs: NOW_MS,
      expect: 'WEBHOOK_WRONG_APP',
    },
    unknownInstallation: {
      ...delivery(webhookKeysPublished, {
        body: envelope({ installationId: '9330000000000000999' }),
      }),
      nowMs: NOW_MS,
      expect: 'WEBHOOK_UNKNOWN_INSTALLATION',
    },
    topicHeaderMismatch: {
      headers: {
        ...validDelivery.headers,
        'tassyir-topic': 'orders/cancelled',
      },
      body: validDelivery.body,
      nowMs: NOW_MS,
      expect: 'WEBHOOK_HEADER_MISMATCH',
    },
    testDelivery: {
      ...testDelivery,
      nowMs: NOW_MS,
      expect: 'WEBHOOK_TEST_DELIVERY',
    },
    testDeliveryWithoutHeader: {
      headers: testHeadersWithoutFlag,
      body: testDelivery.body,
      nowMs: NOW_MS,
      expect: 'WEBHOOK_TEST_DELIVERY',
    },
  };

  const vectors = {
    $comment:
      "Generated by packages/app/scripts/generate-vectors.mjs with the backend's signIdToken / signWebhook and its RFC 8032 test keys. Do not edit by hand.",
    backend: {
      repository: 'tassyir/backend',
      commit,
      files: FILES.map((name) => `${AUTH}/${name}.ts`),
    },
    nowMs: NOW_MS,
    clientId: CLIENT_ID,
    appId: APP_ID,
    installationId: INSTALLATION_ID,
    jwks,
    webhookKeys,
    idTokens,
    webhooks,
  };
  const text = await prettier.format(JSON.stringify(vectors), {
    filepath: OUTPUT,
  });
  writeFileSync(OUTPUT, text);
  console.log(
    `✓ wrote fixtures/backend-vectors.json from ${commit.slice(0, 12)} (${ref})`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
