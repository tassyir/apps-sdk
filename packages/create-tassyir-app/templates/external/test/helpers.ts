import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTassyirApp } from '@tassyir/app';
import type { TassyirApp } from '@tassyir/app';
import { createApp } from '../src/app.ts';
import type { Log } from '../src/log.ts';
import { FileStore } from '../src/store.ts';

// Test doubles for Tassyir, so the tests need no network and no account:
// Ed25519 keys made for each run (no key is committed), a fake Tassyir API
// behind the SDK's `fetch` option, and deliveries and ID tokens signed the
// way Tassyir signs them. Every id here is made up.

export const CLIENT_ID = 'app_test';
export const APP_ID = '42';
export const BUSINESS_ID = 'test-business';
export const INSTALLATION_ID = 'test-installation';
const KID = 'test-key';
const API = 'https://api.tassyir.io';

export interface TestKeys {
  privateKey: KeyObject;
  /** The public key, base64url (a JWK's `x`). */
  x: string;
}

export function makeKeys(): TestKeys {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' });
  return { privateKey, x: jwk.x ?? '' };
}

/** An ID token as the dashboard hands it to the page (60 seconds). */
export function idToken(
  keys: TestKeys,
  claims: Record<string, unknown> = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'EdDSA', typ: 'JWT', kid: KID };
  const payload = {
    iss: 'https://api.tassyir.io/apps',
    aud: CLIENT_ID,
    sub: 'test-user',
    bid: BUSINESS_ID,
    iid: INSTALLATION_ID,
    sid: 'test-session',
    locale: 'en',
    iat: now,
    nbf: now,
    exp: now + 60,
    jti: randomUUID(),
    ...claims,
  };
  const input = `${base64url(header)}.${base64url(payload)}`;
  return `${input}.${sign(null, Buffer.from(input), keys.privateKey).toString('base64url')}`;
}

/** A webhook envelope (plan §3.7) for this app's installation. */
export function envelope(
  type: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: `evt_${randomUUID()}`,
    type,
    apiVersion: '2026-10',
    createdAt: new Date().toISOString(),
    businessId: BUSINESS_ID,
    storeId: null,
    appId: APP_ID,
    installationId: INSTALLATION_ID,
    changed: [],
    data,
  };
}

/** A delivery signed like Tassyir's: v1a over `{id}.{timestamp}.{raw body}`. */
export function delivery(
  keys: TestKeys,
  event: Record<string, unknown>,
  options: { id?: string; body?: string; timestamp?: number } = {},
): RequestInit {
  const id = options.id ?? `dlv_${randomUUID()}`;
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const body = options.body ?? JSON.stringify(event);
  const signature = sign(
    null,
    Buffer.from(`${id}.${String(timestamp)}.${body}`),
    keys.privateKey,
  );
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': String(timestamp),
      'webhook-signature': `v1a,${signature.toString('base64')}`,
      'tassyir-topic': String(event['type']),
      'tassyir-business-id': BUSINESS_ID,
      'tassyir-api-version': '2026-10',
    },
    body,
  };
}

export const ORDERS = [
  {
    id: 'order-2',
    orderNumber: '1042',
    total: '7500.00',
    currency: 'DZD',
    createdAt: '2026-10-02T10:00:00.000Z',
  },
  {
    id: 'order-1',
    orderNumber: '1041',
    total: '2500.00',
    currency: 'DZD',
    createdAt: '2026-10-01T10:00:00.000Z',
  },
];

/** The parts of the Tassyir API this app calls, in memory. */
export class FakeTassyir {
  readonly keys: TestKeys;
  readonly calls: string[] = [];
  readonly appData = new Map<string, unknown>();
  exchanges = 0;

  constructor(keys: TestKeys) {
    this.keys = keys;
  }

  readonly fetch = async (
    url: string,
    init: RequestInit,
  ): Promise<Response> => {
    const method = init.method ?? 'GET';
    const { pathname } = new URL(url);
    this.calls.push(`${method} ${pathname}`);
    const authorization = new Headers(init.headers).get('authorization') ?? '';

    if (method === 'GET' && pathname === '/apps/webhook-keys') {
      const publicKey = Buffer.from(this.keys.x, 'base64url').toString(
        'base64',
      );
      return Response.json({
        keys: [{ kid: KID, scheme: 'v1a', publicKey: `whpk_${publicKey}` }],
      });
    }
    if (method === 'GET' && pathname === '/apps/.well-known/jwks.json') {
      return Response.json({
        keys: [
          {
            kty: 'OKP',
            crv: 'Ed25519',
            x: this.keys.x,
            kid: KID,
            alg: 'EdDSA',
            use: 'sig',
          },
        ],
      });
    }
    if (method === 'POST' && pathname === '/apps/oauth/token') {
      this.exchanges += 1;
      return Response.json({
        access_token: `tsy_at_test${String(this.exchanges)}`,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: `tsy_rt_test${String(this.exchanges)}`,
        refresh_token_expires_in: 7_776_000,
        issued_token_type:
          'urn:tassyir:params:oauth:token-type:offline-access-token',
        scope: 'read_orders',
        installation_id: INSTALLATION_ID,
        business_id: BUSINESS_ID,
      });
    }
    if (!authorization.startsWith('Bearer tsy_at_test')) {
      return problem(401, 'APP_TOKEN_INVALID');
    }
    if (method === 'GET' && pathname === '/apps/2026-10/orders') {
      return Response.json({ data: ORDERS, nextCursor: null });
    }
    const data = /^\/apps\/2026-10\/data\/business\/([^/]+)\/([^/]+)$/.exec(
      pathname,
    );
    if (data) {
      const key = `${data[1] ?? ''}/${data[2] ?? ''}`;
      if (method === 'PUT') {
        const { value } = JSON.parse(String(init.body)) as { value: unknown };
        const created = !this.appData.has(key);
        this.appData.set(key, value);
        return Response.json(
          { data: appData(data[1] ?? '', data[2] ?? '', value) },
          { status: created ? 201 : 200 },
        );
      }
      if (!this.appData.has(key)) return problem(404, 'NOT_FOUND');
      return Response.json({
        data: appData(data[1] ?? '', data[2] ?? '', this.appData.get(key)),
      });
    }
    return problem(404, 'NOT_FOUND');
  };
}

export const silentLog: Log & { lines: string[] } = {
  lines: [],
  info(message) {
    this.lines.push(message);
  },
  warn(message) {
    this.lines.push(message);
  },
  error(message) {
    this.lines.push(message);
  },
};

export interface TestServer {
  app: ReturnType<typeof createApp>;
  tassyir: TassyirApp;
  store: FileStore;
  fake: FakeTassyir;
  keys: TestKeys;
  dir: string;
  close(): Promise<void>;
}

/** The app, wired to the fake Tassyir and a store in a temporary folder. */
export async function testServer(): Promise<TestServer> {
  const keys = makeKeys();
  const fake = new FakeTassyir(keys);
  const dir = await mkdtemp(join(tmpdir(), 'tassyir-app-test-'));
  const store = await FileStore.open(
    join(dir, 'store.json'),
    Buffer.alloc(32, 7),
  );
  const tassyir = createTassyirApp({
    clientId: CLIENT_ID,
    clientSecret: 'tsy_cs_test',
    appId: APP_ID,
    tokenStore: store.tokens,
    fetch: fake.fetch,
  });
  const app = createApp({
    tassyir,
    store,
    log: silentLog,
    pageFile: async (name) =>
      name === 'index.html'
        ? new TextEncoder().encode('<!doctype html><title>test</title>')
        : undefined,
  });
  return {
    app,
    tassyir,
    store,
    fake,
    keys,
    dir,
    close: () => rm(dir, { recursive: true, force: true }),
  };
}

function appData(ownerId: string, key: string, value: unknown) {
  return {
    id: 'data-1',
    ownerType: 'business',
    ownerId,
    key,
    value,
    visibility: 'app',
    declared: true,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
  };
}

function problem(status: number, code: string): Response {
  return Response.json(
    {
      type: `https://developers.tassyir.io/errors/${code.toLowerCase()}`,
      title: code,
      status,
      detail: code,
      code,
      requestId: 'test-request',
    },
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
