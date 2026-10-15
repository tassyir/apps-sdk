import { env } from 'cloudflare:test';
import type { HostedProps, TassyirBinding } from '@tassyir/app';
import type { Hono } from 'hono';

// Stand-ins for Tassyir Hosting's per-request ctx.props, and Tassyir's
// webhook signature. Every id here is made up; never paste a real one.

export const INSTALLATION = {
  id: '1001',
  businessId: '1002',
  appId: '1003',
  handle: 'my-tassyir-app',
  version: 1,
  scopes: ['read_orders'],
  storeAccess: 'all',
  storeIds: [],
  devStore: true,
} as const satisfies HostedProps['installation'];

export const VIEWER = { userId: '1004', sessionId: 'tab-1' };

interface StandInEnv {
  STAND_IN_STORAGE: DurableObjectNamespace;
}

/** A fresh SQLite database per name, reached over RPC like STORAGE. */
export function standInStorage(name: string): HostedProps['STORAGE'] {
  const namespace = (env as unknown as StandInEnv).STAND_IN_STORAGE;
  return namespace.get(
    namespace.idFromName(name),
  ) as unknown as HostedProps['STORAGE'];
}

export interface AdminCall {
  method: string;
  url: string;
  headers: Headers;
  body: string;
}

/**
 * A fake Admin API in place of ctx.props.TASSYIR: records each call and
 * answers with `answer` (an order list by default).
 */
export function fakeTassyir(
  answer: (call: AdminCall) => Response = () =>
    Response.json({ data: [], nextCursor: null }),
): TassyirBinding & { calls: AdminCall[] } {
  const calls: AdminCall[] = [];
  return {
    calls,
    async fetch(input, init) {
      const request = new Request(input, init);
      const call = {
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: await request.text(),
      };
      calls.push(call);
      return answer(call);
    },
  };
}

let databases = 0;

/** The props of one request; a new database unless `STORAGE` is given. */
export function hostedProps(
  overrides: Partial<HostedProps> = {},
): HostedProps & { TASSYIR: ReturnType<typeof fakeTassyir> } {
  databases += 1;
  return {
    installation: {
      ...INSTALLATION,
      scopes: [...INSTALLATION.scopes],
      storeIds: [],
    },
    viewer: VIEWER,
    STORAGE: standInStorage(`installation:${String(databases)}`),
    TASSYIR: fakeTassyir(),
    ...overrides,
  } as HostedProps & { TASSYIR: ReturnType<typeof fakeTassyir> };
}

/** One request through the app, as Tassyir Hosting makes it. */
export function call(
  app: Hono<never> | { fetch: Hono['fetch'] },
  props: unknown,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const ctx = {
    props,
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
  };
  return Promise.resolve(
    app.fetch(
      new Request(`https://my-tassyir-app.tassyir-apps.com${path}`, init),
      {},
      ctx as unknown as ExecutionContext,
    ),
  );
}

/** An Ed25519 key pair standing for Tassyir's webhook key. */
export async function webhookKey(): Promise<{
  privateKey: CryptoKey;
  publicKey: string;
}> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(
    (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer,
  );
  return {
    privateKey: pair.privateKey,
    publicKey: `whpk_${btoa(String.fromCharCode(...raw))}`,
  };
}

/** A delivery as the dispatcher POSTs it: Tassyir's headers, signed body. */
export async function delivery(
  privateKey: CryptoKey,
  envelope: Record<string, unknown>,
  { id = 'dlv_1', timestamp = Math.floor(Date.now() / 1000) } = {},
): Promise<RequestInit> {
  const body = JSON.stringify(envelope);
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'Ed25519' },
      privateKey,
      new TextEncoder().encode(`${id}.${String(timestamp)}.${body}`),
    ),
  );
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': String(timestamp),
      'webhook-signature': `v1a,${btoa(String.fromCharCode(...signature))}`,
      'tassyir-topic': String(envelope['type']),
      'tassyir-business-id': INSTALLATION.businessId,
      'tassyir-api-version': '2026-10',
    },
    body,
  };
}

/** A 2026-10 envelope for this installation. */
export function envelope(
  type: string,
  data: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'evt_1',
    type,
    apiVersion: '2026-10',
    createdAt: '2026-10-15T09:00:00.000Z',
    businessId: INSTALLATION.businessId,
    storeId: null,
    appId: INSTALLATION.appId,
    installationId: INSTALLATION.id,
    changed: [],
    data,
    ...overrides,
  };
}
