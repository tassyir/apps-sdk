import { randomBytes } from 'node:crypto';
import { validateManifest } from '@tassyir/app-manifest';
import type {
  AppCredential,
  AppVersionDetail,
  Delivery,
  DevStore,
  DeveloperAccount,
  DeveloperApp,
  Installation,
  ReplayOutcome,
  TestDelivery,
} from './developer-types.js';
import {
  operationFor,
  requestProblems,
  responseProblems,
} from './openapi.test-helpers.js';

// A local fake of the developer API: the routes, shapes, codes and rules the
// CLI relies on, in memory, behind a `fetch`. Its shapes are the API's
// OpenAPI document's (openapi/openapi.developer.json, the file the client's
// types are generated from): every request it receives and every answer it
// gives is checked against the document, and `cleanupHarnesses` fails the
// spec on any difference (`takeDocumentViolations`). The device grant keeps
// the interval like the API does (a poll sooner than `interval` minus 500 ms
// is `slow_down`, and the interval grows by 5 s), on the harness's clock.

/** What the fakes received or answered that the document does not allow. */
const VIOLATIONS: string[] = [];

/** Every difference from the document since the last call, then none. */
export function takeDocumentViolations(): string[] {
  return VIOLATIONS.splice(0);
}

/** Throws when a fake received or answered what the document does not allow. */
export function assertFakesFollowTheDocument(): void {
  const found = takeDocumentViolations();
  if (found.length > 0) {
    throw new Error(
      `The fake developer API left openapi.developer.json:\n${found.map((line) => `  - ${line}`).join('\n')}`,
    );
  }
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function base62(length: number): string {
  const bytes = randomBytes(length);
  return [...bytes].map((byte) => BASE62[byte % 62]).join('');
}

export interface FakeClock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Every sleep the CLI asked for, in ms. */
  sleeps: number[];
}

export function fakeClock(
  start = Date.parse('2026-10-14T10:00:00Z'),
): FakeClock {
  let now = start;
  const sleeps: number[] = [];
  return {
    now: () => now,
    sleep: (ms) => {
      sleeps.push(ms);
      now += ms;
      return Promise.resolve();
    },
    sleeps,
  };
}

/** What one poll of the token route does, in order; then `pending` for ever. */
export type PollStep =
  | 'pending'
  | 'slow_down'
  | 'approve'
  | 'deny'
  | 'expire'
  | 'invalid_grant'
  | 'server_error'
  | 'network'
  /** A 429 that is not OAuth's slow_down (the rate limiter), Retry-After 90. */
  | 'throttled';

interface SignIn {
  deviceCode: string;
  userCode: string;
  createdAt: number;
  interval: number;
  lastPolledAt: number | undefined;
  issued: boolean;
  form: Record<string, string>;
}

interface TokenRow {
  id: string;
  token: string;
  revoked: boolean;
  createdAt: string;
  deviceName: string | null;
  clientVersion: string | null;
}

export interface RecordedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Headers;
  body: string | undefined;
  /** Which poll of a sign-in this was (token route only). */
  at: number;
}

/** Whether the fake API takes hosted versions (`APPS_HOSTING_ENABLED`). */
export type HostingAvailability = 'off' | 'on' | 'unconfigured';

/**
 * What the next `GET …/versions/:n` of a hosted version finds, in order (one
 * step per read; then the version stays as it is). The pipeline's states as
 * the API moves them (AP-B1.14), plus two answers of the route itself.
 */
export type ScanStep =
  | 'dispatched'
  /** Every check passed: `ready`, the staging upload queued. */
  | 'passed'
  /** Uploaded to staging; production queued. */
  | 'staging'
  /** Uploaded to production: approved, released, current. */
  | 'released'
  /** A check failed on findings (`scanChecks`, `scanReview`). */
  | 'failed'
  /** The AI review asked for a person: `in_review`, staging only. */
  | 'held'
  /** `SCAN_INCOMPLETE`, `SCAN_TIMED_OUT`, `SCAN_DISPATCH_FAILED`, `SCAN_RESULT_INVALID`. */
  | 'incomplete'
  | 'timed_out'
  | 'dispatch_failed'
  | 'result_invalid'
  /** Cloudflare refused the staging upload. */
  | 'deploy_failed'
  /** A Tassyir admin rejected the held version. */
  | 'rejected'
  /** This read answers 429 (the rate limiter, Retry-After 30). */
  | 'throttled'
  /** This read never reaches the API. */
  | 'network'
  /** This read waits until the CLI aborts it (`onVersionRead` runs first). */
  | 'hang';

type HostedRecord = NonNullable<AppVersionDetail['hosting']>;
type ScanCheck = HostedRecord['checks'][number];
type DeployRefusal = HostedRecord['deploy']['staging']['refusal'];

/** The nine checks the API requires, every one passed. */
export function passingChecks(): ScanCheck[] {
  return [
    'bundle',
    'size',
    'unicode',
    'banned_apis',
    'manifest_scopes',
    'manifest_hosts',
    'semgrep',
    'gitleaks',
    'osv',
  ].map((id) => ({
    id,
    status: 'pass',
    summary: id === 'size' ? '1 module(s), 120 bytes' : '',
    findings: [],
    truncated: false,
  }));
}

export interface UploadRefusal {
  status: number;
  code: string;
  message: string;
  fix?: string;
  extra?: Record<string, unknown>;
}

export const FAKE_EMAIL = 'amina@example.com';
export const FAKE_USER_ID = '741939488313319175';

export class FakeDeveloperApi {
  readonly origin = 'https://api.tassyir.test';
  readonly clock: FakeClock;
  readonly requests: RecordedRequest[] = [];

  /** The device grant. */
  pollScript: PollStep[] = [];
  signIns: SignIn[] = [];
  tokens: TokenRow[] = [];
  deviceCodeStatus: 200 | 429 | 400 | 503 = 200;
  /** Runs when a secret is minted, before the answer (to break the next step). */
  onMint: (() => void) | undefined;
  verificationOrigin = 'https://app.tassyir.io';

  account: DeveloperAccount | null = {
    id: '9001',
    displayName: 'Amina Apps',
    supportEmail: FAKE_EMAIL,
    websiteUrl: null,
    status: 'active',
    verifiedAt: null,
    createdAt: '2026-10-12T10:00:00.000Z',
    updatedAt: '2026-10-12T10:00:00.000Z',
  };
  apps: DeveloperApp[] = [];
  versions = new Map<string, AppVersionDetail[]>();
  credentials = new Map<string, AppCredential[]>();
  /** Every secret minted, so specs can check where it went. */
  secrets: string[] = [];
  devStores: DevStore[] = [];
  installations = new Map<string, Installation[]>();
  deliveries = new Map<string, Delivery[]>();
  replayOutcome: ReplayOutcome = 'delivered';
  testResult: Partial<TestDelivery> = {};
  /** Set to echo this text in every refusal's message (a hostile API). */
  echoInErrors: string | undefined;

  /** Tassyir Hosting on this API: off (production today), on, or on but not set up. */
  hosting: HostingAvailability = 'off';
  /** The pipeline, one step per read of a hosted version. */
  scanScript: ScanStep[] = [];
  /** What the scan reports (a `failed` step expects a failing check here). */
  scanChecks: ScanCheck[] = passingChecks();
  scanReview: HostedRecord['review'] = null;
  /** The next upload's refusal, once (a conflict, a busy pipeline, …). */
  nextUploadRefusal: UploadRefusal | undefined;
  /** What Cloudflare answered, on a `deploy_failed` step. */
  deployRefusal: DeployRefusal = {
    code: 10021,
    message:
      'Uncaught Error: No such module "node:fs". imported from "worker.js"',
  };
  /** Runs at every read of a version, before the answer (a spec's Ctrl-C). */
  onVersionRead: (() => void) | undefined;
  /** Every bundle a hosted upload sent, as sent. */
  bundles: unknown[] = [];

  #ids = 100;

  constructor(clock: FakeClock = fakeClock()) {
    this.clock = clock;
  }

  /** A token as `tassyir login` would get it, for specs that start signed in. */
  issueToken(): string {
    const token = `tsy_dt_${base62(43)}`;
    this.tokens.push({
      id: this.#id(),
      token,
      revoked: false,
      createdAt: new Date(this.clock.now()).toISOString(),
      deviceName: 'test-machine',
      clientVersion: '0.0.0-test',
    });
    return token;
  }

  liveTokens(): string[] {
    return this.tokens.filter((row) => !row.revoked).map((row) => row.token);
  }

  /** An app with one installation, as specs need for webhooks. */
  seedApp(handle = 'review-requests'): DeveloperApp {
    const app = this.#newApp({ handle, nameEn: 'Review Requests' });
    this.installations.set(app.id, [
      {
        id: '5001',
        businessId: '6001',
        status: 'active',
        appVersionId: '7001',
        version: 1,
        grantedScopes: ['read_orders'],
        storeAccess: 'all',
        installedAt: '2026-10-13T00:00:00.000Z',
        uninstalledAt: null,
        webhooks: { state: 'ok', failingSince: null, disabledAt: null },
      },
    ]);
    this.deliveries.set(app.id, [
      {
        id: '8001',
        webhookId: 'dlv_8001',
        eventId: 'evt_8001',
        installationId: '5001',
        businessId: '6001',
        topic: 'orders/created',
        status: 'failed',
        attempts: 10,
        lastStatusCode: 500,
        lastError: 'HTTP_500',
        errorClass: 'http',
        lastDurationMs: 412,
        nextAttemptAt: null,
        deliveredAt: null,
        createdAt: '2026-10-13T08:00:00.000Z',
      },
    ]);
    return app;
  }

  readonly fetch = async (
    input: string,
    init: RequestInit = {},
  ): Promise<Response> => {
    if (
      this.scanScript[0] === 'hang' &&
      /\/versions\/\d+$/.test(new URL(input).pathname)
    ) {
      this.scanScript.shift();
      this.onVersionRead?.();
      return new Promise<Response>((_, reject) => {
        const signal = init.signal;
        const abort = () => {
          reject(new DOMException('The operation was aborted', 'AbortError'));
        };
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
      });
    }
    const response = this.#dispatch(input, init);
    await this.#check(input, init, response);
    return response;
  };

  /** Holds the request and the answer to the document (VIOLATIONS). */
  async #check(
    input: string,
    init: RequestInit,
    response: Response,
  ): Promise<void> {
    const url = new URL(input);
    const method = (init.method ?? 'GET').toUpperCase();
    const operation = operationFor(method, url.pathname);
    if (!operation) {
      VIOLATIONS.push(
        `${method} ${url.pathname} is not an operation of the document`,
      );
      return;
    }
    VIOLATIONS.push(
      ...requestProblems(operation, {
        query: url.searchParams,
        contentType: new Headers(init.headers).get('content-type'),
        body: typeof init.body === 'string' ? init.body : undefined,
      }),
    );
    const text = await response.clone().text();
    VIOLATIONS.push(
      ...responseProblems(
        operation,
        response.status,
        text === '' ? undefined : (JSON.parse(text) as unknown),
      ),
    );
  }

  #dispatch(input: string, init: RequestInit): Response {
    const url = new URL(input);
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    const body = typeof init.body === 'string' ? init.body : undefined;
    this.requests.push({
      method,
      path: url.pathname,
      query: url.searchParams,
      headers,
      body,
      at: this.clock.now(),
    });
    if (url.origin !== this.origin) {
      throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
    }
    if (init.redirect !== 'error') {
      return json(500, { message: 'the CLI must never follow redirects' });
    }
    const path = url.pathname;
    if (method === 'POST' && path === '/developer/cli/device-code') {
      return this.#deviceCode(new URLSearchParams(body));
    }
    if (method === 'POST' && path === '/developer/cli/token') {
      return this.#token(new URLSearchParams(body));
    }
    const caller = this.#authenticate(headers);
    if (!caller) {
      return this.#refuse(
        401,
        'DEVELOPER_TOKEN_INVALID',
        'The developer token is not valid',
        undefined,
        {
          'www-authenticate':
            'Bearer realm="tassyir-developer", error="invalid_token"',
        },
      );
    }
    return this.#route(method, path, url.searchParams, body, caller);
  }

  // ── Device grant ────────────────────────────────────────────────────────

  #deviceCode(form: URLSearchParams): Response {
    if (this.deviceCodeStatus === 503) {
      return json(503, {
        statusCode: 503,
        message: 'Service temporarily unavailable, please retry.',
      });
    }
    if (this.deviceCodeStatus === 429) {
      return json(
        429,
        { error: 'slow_down', error_description: 'Too many sign-ins' },
        { 'retry-after': '120' },
      );
    }
    if (form.get('client_id') !== 'tassyir-cli') {
      return json(400, {
        error: 'invalid_client',
        error_description: 'Unknown client_id',
      });
    }
    const deviceName = form.get('device_name');
    if (
      this.deviceCodeStatus === 400 ||
      (deviceName !== null &&
        !/^[\p{L}\p{N} ._\-'()@]{1,64}$/u.test(deviceName))
    ) {
      return json(400, {
        error: 'invalid_request',
        error_description: 'device_name is malformed',
      });
    }
    const signIn: SignIn = {
      deviceCode: `tsy_dc_${base62(43)}`,
      userCode: 'BCDF-GHJK',
      createdAt: this.clock.now(),
      interval: 5,
      lastPolledAt: undefined,
      issued: false,
      form: Object.fromEntries(form),
    };
    this.signIns.push(signIn);
    const locale = form.get('locale') === 'ar' ? 'ar' : 'en';
    const page = `${this.verificationOrigin}/${locale}/developers/cli`;
    return json(200, {
      device_code: signIn.deviceCode,
      user_code: signIn.userCode,
      verification_uri: page,
      verification_uri_complete: `${page}?code=${signIn.userCode}`,
      expires_in: 600,
      interval: signIn.interval,
    });
  }

  #token(form: URLSearchParams): Response {
    if (
      form.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:device_code'
    ) {
      return oauthError('unsupported_grant_type');
    }
    if (form.get('client_id') !== 'tassyir-cli') {
      return oauthError('invalid_request', 'client_id is missing');
    }
    const signIn = this.signIns.find(
      (candidate) => candidate.deviceCode === form.get('device_code'),
    );
    if (!signIn || signIn.issued) return oauthError('invalid_grant');
    const now = this.clock.now();
    if (now >= signIn.createdAt + 600_000) return oauthError('expired_token');
    if (
      signIn.lastPolledAt !== undefined &&
      now - signIn.lastPolledAt < signIn.interval * 1000 - 500
    ) {
      signIn.lastPolledAt = now;
      signIn.interval = Math.min(signIn.interval + 5, 60);
      return oauthError('slow_down');
    }
    signIn.lastPolledAt = now;
    const step = this.pollScript.shift() ?? 'pending';
    switch (step) {
      case 'pending':
        return oauthError('authorization_pending');
      case 'slow_down':
        signIn.interval = Math.min(signIn.interval + 5, 60);
        return oauthError('slow_down');
      case 'deny':
        return oauthError('access_denied');
      case 'expire':
        return oauthError('expired_token');
      case 'invalid_grant':
        return oauthError('invalid_grant');
      case 'server_error':
        return json(500, { statusCode: 500, message: 'Internal server error' });
      case 'network':
        throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
      case 'throttled':
        // The global rate limiter's body is a bare JSON string.
        return json(429, 'ThrottlerException: Too Many Requests', {
          'retry-after': '90',
        });
      case 'approve': {
        signIn.issued = true;
        const token = `tsy_dt_${base62(43)}`;
        const row: TokenRow = {
          id: this.#id(),
          token,
          revoked: false,
          createdAt: new Date(now).toISOString(),
          deviceName: signIn.form['device_name'] ?? null,
          clientVersion: signIn.form['client_version'] ?? null,
        };
        this.tokens.push(row);
        return json(200, {
          access_token: token,
          token_type: 'Bearer',
          expires_in: 7_776_000,
          scope: 'developer',
          token_id: row.id,
          user_id: FAKE_USER_ID,
          email: FAKE_EMAIL,
        });
      }
    }
  }

  #authenticate(headers: Headers): TokenRow | undefined {
    const match = /^Bearer (.+)$/.exec(headers.get('authorization') ?? '');
    return this.tokens.find((row) => row.token === match?.[1] && !row.revoked);
  }

  // ── Developer API ───────────────────────────────────────────────────────

  #route(
    method: string,
    path: string,
    query: URLSearchParams,
    rawBody: string | undefined,
    caller: TokenRow,
  ): Response {
    const body =
      rawBody === undefined
        ? {}
        : (JSON.parse(rawBody) as Record<string, unknown>);
    const route = `${method} ${path}`;
    if (route === 'GET /developer/cli/tokens') {
      return json(200, {
        data: this.tokens
          .filter((row) => !row.revoked)
          .map((row) => this.#tokenView(row, row === caller)),
      });
    }
    if (route === 'DELETE /developer/cli/tokens/current') {
      caller.revoked = true;
      return json(200, {
        data: {
          ...this.#tokenView(caller, true),
          revokedAt: new Date(this.clock.now()).toISOString(),
        },
      });
    }
    if (route === 'GET /developer/account')
      return json(200, { data: this.account });
    if (!this.account) {
      return this.#refuse(
        404,
        'DEVELOPER_ACCOUNT_NOT_FOUND',
        'Developer mode is not enabled for this account',
        'Enable developer mode: POST /developer/account.',
      );
    }
    if (route === 'GET /developer/apps') return json(200, { data: this.apps });
    if (route === 'POST /developer/apps') {
      if (body['hostingMode'] === 'tassyir') {
        return this.#refuse(
          400,
          'APP_HOSTING_NOT_AVAILABLE',
          'Tassyir Hosting is not available yet',
          'Use hostingMode "external" (your own server) until Tassyir Hosting opens.',
          { hostingMode: 'tassyir' },
        );
      }
      const handle = String(body['handle']);
      if (this.apps.some((app) => app.handle === handle)) {
        return this.#refuse(
          409,
          'APP_HANDLE_TAKEN',
          `The handle "${handle}" is taken`,
          'Choose another handle.',
          { handle },
        );
      }
      return json(201, {
        data: this.#newApp({
          handle,
          nameEn: String(body['nameEn']),
          nameAr: body['nameAr'] as string | undefined,
        }),
      });
    }
    if (route === 'GET /developer/dev-stores')
      return json(200, { data: this.devStores });
    if (route === 'POST /developer/dev-stores') {
      if (this.devStores.length >= 3) {
        return this.#refuse(
          409,
          'DEV_STORE_LIMIT_REACHED',
          'You hold 3 dev stores already',
          'Use one of your dev stores: they cannot be deleted yet.',
          { limit: 3 },
        );
      }
      const id = this.#id();
      const store: DevStore = {
        id,
        name: typeof body['name'] === 'string' ? body['name'] : 'Dev store',
        createdAt: new Date(this.clock.now()).toISOString(),
        dashboardPath: `/dashboard/${id}`,
      };
      this.devStores.push(store);
      const seeded = body['seed'] !== false;
      return json(201, {
        data: {
          ...store,
          store: { id: this.#id(), subdomain: 'dev-w0fmk843' },
          seed: seeded
            ? {
                products: 30,
                variants: 160,
                orders: 180,
                abandonedCheckouts: 20,
                customers: 64,
                wilayas: 58,
                trackedItems: 22,
              }
            : null,
          seedError: null,
        },
      });
    }

    const appMatch = /^\/developer\/apps\/([^/]+)(\/.*)?$/.exec(path);
    const app = this.apps.find((candidate) => candidate.id === appMatch?.[1]);
    if (!appMatch || !app) {
      return appMatch
        ? this.#refuse(
            404,
            'APP_NOT_FOUND',
            'App not found',
            'Check the app id: GET /developer/apps lists yours.',
            { appId: appMatch[1] },
          )
        : json(404, {
            statusCode: 404,
            message: `Cannot ${method} ${path}`,
            error: 'Not Found',
          });
    }
    const rest = appMatch[2] ?? '';
    if (method === 'GET' && rest === '') return json(200, { data: app });
    if (rest === '/versions' && method === 'POST')
      return this.#upload(app, body['manifest'], body['bundle']);
    if (rest === '/versions' && method === 'GET') {
      const list = [...(this.versions.get(app.id) ?? [])].reverse();
      const limit = Number(query.get('limit') ?? '20');
      return json(200, {
        data: list.slice(0, limit).map((version) => summaryOf(version)),
        nextCursor: null,
      });
    }
    const versionMatch = /^\/versions\/([^/]+)$/.exec(rest);
    if (versionMatch && method === 'GET') {
      return this.#readVersion(app, versionMatch[1] ?? '');
    }
    if (rest === '/credentials') {
      const list = this.credentials.get(app.id) ?? [];
      if (method === 'GET') return json(200, { data: [...list].reverse() });
      if (method === 'POST') {
        const live = list.filter(
          (credential) =>
            credential.state === 'active' || credential.state === 'expiring',
        );
        if (live.length >= 3) {
          return this.#refuse(
            409,
            'APP_SECRETS_LIMIT_REACHED',
            'The app has 3 live secrets',
            'Revoke one, or wait for an overlap to end.',
            { limit: 3 },
          );
        }
        const expiresAt = new Date(this.clock.now() + 86_400_000).toISOString();
        for (const credential of live) {
          if (credential.state === 'active') {
            credential.state = 'expiring';
            credential.expiresAt = expiresAt;
          }
        }
        const secret = `tsy_cs_${base62(43)}`;
        this.secrets.push(secret);
        this.onMint?.();
        const credential: AppCredential = {
          id: this.#id(),
          secretPrefix: secret.slice(0, 15),
          state: 'active',
          createdAt: new Date(this.clock.now()).toISOString(),
          expiresAt: null,
          revokedAt: null,
        };
        this.credentials.set(app.id, [...list, credential]);
        return json(
          201,
          {
            data: { ...credential, clientId: app.clientId, secret },
            rotated: live.map((old) => ({ ...old })),
          },
          { 'cache-control': 'no-store' },
        );
      }
    }
    const credentialMatch = /^\/credentials\/([^/]+)$/.exec(rest);
    if (credentialMatch && method === 'DELETE') {
      const credential = (this.credentials.get(app.id) ?? []).find(
        (candidate) => candidate.id === credentialMatch[1],
      );
      if (!credential) {
        return this.#refuse(
          404,
          'APP_CREDENTIAL_NOT_FOUND',
          'Credential not found',
          'Check the id: `tassyir secrets list`.',
          { credentialId: credentialMatch[1] },
        );
      }
      credential.state = 'revoked';
      credential.revokedAt ??= new Date(this.clock.now()).toISOString();
      return json(200, { data: credential });
    }
    if (rest === '/installations' && method === 'GET') {
      const status = query.get('status');
      return json(200, {
        data: (this.installations.get(app.id) ?? []).filter(
          (installation) => !status || installation.status === status,
        ),
        nextCursor: null,
      });
    }
    if (rest === '/webhooks/deliveries' && method === 'GET') {
      const list = (this.deliveries.get(app.id) ?? []).filter(
        (delivery) =>
          (!query.get('installationId') ||
            delivery.installationId === query.get('installationId')) &&
          (!query.get('topic') || delivery.topic === query.get('topic')) &&
          (!query.get('status') || delivery.status === query.get('status')),
      );
      return json(200, {
        data: list,
        nextCursor: list.length > 0 ? 'eyJ2IjoxfQ' : null,
      });
    }
    const replayMatch = /^\/webhooks\/deliveries\/([^/]+)\/replay$/.exec(rest);
    if (replayMatch && method === 'POST') {
      const delivery = (this.deliveries.get(app.id) ?? []).find(
        (candidate) => candidate.id === replayMatch[1],
      );
      if (!delivery) {
        return this.#refuse(
          404,
          'WEBHOOK_DELIVERY_NOT_FOUND',
          'Delivery not found',
          'Check the id: `tassyir webhook deliveries`.',
          { deliveryId: replayMatch[1] },
        );
      }
      delivery.attempts += 1;
      if (this.replayOutcome === 'delivered') {
        Object.assign(delivery, {
          status: 'delivered',
          lastStatusCode: 200,
          lastError: null,
          errorClass: null,
        });
      } else if (this.replayOutcome === 'skipped') {
        Object.assign(delivery, {
          status: 'skipped',
          lastError: 'SCOPE_NOT_GRANTED',
          errorClass: 'skipped',
        });
      }
      return json(200, { data: delivery, outcome: this.replayOutcome });
    }
    const testMatch = /^\/installations\/([^/]+)\/webhooks\/test$/.exec(rest);
    if (testMatch && method === 'POST') {
      const installation = (this.installations.get(app.id) ?? []).find(
        (candidate) => candidate.id === testMatch[1],
      );
      if (!installation) {
        return this.#refuse(
          404,
          'APP_INSTALLATION_NOT_FOUND',
          'Installation not found',
          'Check the id.',
          { installationId: testMatch[1] },
        );
      }
      return json(200, {
        data: {
          webhookId: 'dlv_test_4f0c2b000000000000000000',
          installationId: installation.id,
          topic: body['topic'],
          status: 'delivered',
          statusCode: 200,
          error: null,
          errorClass: null,
          durationMs: 230,
          sentAt: new Date(this.clock.now()).toISOString(),
          ...this.testResult,
        },
      });
    }
    return json(404, {
      statusCode: 404,
      message: `Cannot ${method} ${path}`,
      error: 'Not Found',
    });
  }

  #upload(app: DeveloperApp, manifest: unknown, bundle: unknown): Response {
    const result = validateManifest(manifest);
    if (!result.ok) {
      return this.#refuse(
        400,
        'APP_MANIFEST_INVALID',
        'The manifest is not valid',
        'Fix each error listed in `errors`, then upload again.',
        { errors: result.errors },
      );
    }
    const hosted = result.manifest.hosting.mode === 'tassyir';
    if (hosted && this.hosting === 'off') {
      return this.#refuse(
        400,
        'APP_HOSTING_NOT_AVAILABLE',
        'Tassyir Hosting is not available yet',
        'Host the app on your own server: set hosting.mode = "external" and hosting.url to its https base URL.',
        { hostingMode: 'tassyir' },
      );
    }
    if (hosted && this.hosting === 'unconfigured') {
      return this.#refuse(
        503,
        'APP_HOSTING_NOT_CONFIGURED',
        'Tassyir Hosting cannot take uploads right now',
        'Try again later, or host the app on your own server (hosting.mode = "external").',
      );
    }
    if (hosted && (bundle === undefined || bundle === null)) {
      return this.#refuse(
        400,
        'APP_BUNDLE_REQUIRED',
        'A hosted version needs its bundle',
        'Send "bundle": { "main", "files" } next to "manifest" (`tassyir deploy` builds it).',
      );
    }
    if (!hosted && bundle !== undefined && bundle !== null) {
      return this.#refuse(
        400,
        'APP_BUNDLE_NOT_ALLOWED',
        'An external version has no bundle',
        'Leave "bundle" out, or set hosting.mode = "tassyir" to run the bundle on Tassyir Hosting.',
      );
    }
    if (hosted) this.bundles.push(bundle);
    const refusal = this.nextUploadRefusal;
    if (refusal) {
      this.nextUploadRefusal = undefined;
      return this.#refuse(
        refusal.status,
        refusal.code,
        refusal.message,
        refusal.fix,
        refusal.extra,
      );
    }
    if (result.manifest.handle !== app.handle) {
      return this.#refuse(
        400,
        'APP_MANIFEST_HANDLE_MISMATCH',
        'The manifest names another handle',
        "Set handle to the app's handle: it never changes.",
        { appHandle: app.handle, manifestHandle: result.manifest.handle },
      );
    }
    const list = this.versions.get(app.id) ?? [];
    const latest = list.at(-1);
    const bundleKey = hosted ? JSON.stringify(bundle) : null;
    const scanBroke =
      latest?.hosting?.scan.status === 'error' ||
      latest?.hosting?.scan.status === 'timed_out';
    if (
      latest &&
      JSON.stringify(latest.manifest) === JSON.stringify(result.manifest) &&
      (this.#bundleKeys.get(latest.id) ?? null) === bundleKey &&
      !scanBroke
    ) {
      return this.#refuse(
        409,
        'APP_VERSION_UNCHANGED',
        'This manifest equals the latest version',
        'Change the manifest before uploading it again.',
        { version: latest.version },
      );
    }
    const now = new Date(this.clock.now()).toISOString();
    const version: AppVersionDetail = {
      id: this.#id(),
      version: list.length + 1,
      apiVersion: result.manifest.api_version,
      scopes: result.manifest.access.scopes,
      optionalScopes: result.manifest.access.optional_scopes,
      webhookTopics: result.manifest.webhooks.flatMap(
        (webhook) => webhook.topics,
      ),
      allowedHosts:
        result.manifest.hosting.mode === 'tassyir'
          ? result.manifest.hosting.allowed_hosts
          : [],
      reviewState: hosted ? 'scanning' : 'approved',
      current: !hosted,
      releasedAt: hosted ? null : now,
      createdAt: now,
      hosting: hosted ? initialHosting(bundle) : null,
      manifest: result.manifest as unknown as Record<string, unknown>,
    };
    if (!hosted) {
      for (const other of list) other.current = false;
      app.currentVersion = version.version;
      app.status = 'active';
    }
    this.#bundleKeys.set(version.id, bundleKey);
    this.versions.set(app.id, [...list, version]);
    return json(201, { data: version });
  }

  /** `GET …/versions/:n`: the next scan step first, for a hosted version. */
  #readVersion(app: DeveloperApp, raw: string): Response {
    this.onVersionRead?.();
    const version = (this.versions.get(app.id) ?? []).find(
      (candidate) => String(candidate.version) === raw,
    );
    if (!version) {
      return this.#refuse(
        404,
        'APP_VERSION_NOT_FOUND',
        'Version not found',
        'List the versions: GET /developer/apps/:appId/versions.',
        { version: raw },
      );
    }
    if (version.hosting) {
      const step = this.scanScript.shift();
      if (step === 'throttled') {
        return json(429, 'ThrottlerException: Too Many Requests', {
          'retry-after': '30',
        });
      }
      if (step === 'network') {
        throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
      }
      if (step) this.#advance(app, version, version.hosting, step);
    }
    return json(200, { data: version });
  }

  /** Moves a hosted version the way the API's pipeline does. */
  #advance(
    app: DeveloperApp,
    version: AppVersionDetail,
    hosting: HostedRecord,
    step: ScanStep,
  ): void {
    const now = new Date(this.clock.now()).toISOString();
    const scan = hosting.scan;
    const finish = (status: HostedRecord['scan']['status']) => {
      scan.status = status;
      scan.finishedAt = now;
      hosting.checks = this.scanChecks;
      hosting.review = this.scanReview;
    };
    const broke = (
      status: 'error' | 'timed_out',
      code: NonNullable<HostedRecord['scan']['failureCode']>,
    ) => {
      scan.status = status;
      scan.failureCode = code;
      scan.finishedAt = now;
      version.reviewState = 'scan_failed';
    };
    switch (step) {
      case 'dispatched':
        scan.status = 'dispatched';
        scan.dispatchedAt = now;
        return;
      case 'passed':
        finish('passed');
        version.reviewState = 'ready';
        hosting.deploy.staging.status = 'pending';
        return;
      case 'staging':
        hosting.deploy.staging = {
          status: 'deployed',
          deployedAt: now,
          errorCode: null,
          refusal: null,
        };
        hosting.deploy.production.status = 'pending';
        return;
      case 'released': {
        hosting.deploy.production = {
          status: 'deployed',
          deployedAt: now,
          errorCode: null,
          refusal: null,
        };
        version.reviewState = 'approved';
        version.releasedAt = now;
        for (const other of this.versions.get(app.id) ?? []) {
          other.current = false;
        }
        version.current = true;
        app.currentVersion = version.version;
        app.status = 'active';
        return;
      }
      case 'failed':
        finish('failed');
        scan.reasons = this.scanChecks
          .filter((check) => check.status === 'fail')
          .map((check) => `CHECK_FAILED:${check.id}`);
        if (this.scanReview?.status === 'fail')
          scan.reasons.push('REVIEW_FAILED');
        version.reviewState = 'scan_failed';
        return;
      case 'held':
        finish('held');
        scan.reasons = ['REVIEW_NEEDS_HUMAN'];
        version.reviewState = 'in_review';
        hosting.deploy.staging = {
          status: 'deployed',
          deployedAt: now,
          errorCode: null,
          refusal: null,
        };
        return;
      case 'incomplete':
        broke('error', 'SCAN_INCOMPLETE');
        scan.reasons = ['CHECK_ERROR:semgrep'];
        return;
      case 'timed_out':
        broke('timed_out', 'SCAN_TIMED_OUT');
        return;
      case 'dispatch_failed':
        broke('error', 'SCAN_DISPATCH_FAILED');
        return;
      case 'result_invalid':
        broke('error', 'SCAN_RESULT_INVALID');
        return;
      case 'deploy_failed':
        hosting.deploy.staging = {
          status: 'failed',
          deployedAt: null,
          errorCode: 'CLOUDFLARE_REJECTED',
          refusal: this.deployRefusal,
        };
        return;
      case 'rejected':
        version.reviewState = 'rejected';
        hosting.rejectionReason = 'The page asks buyers for their card number.';
        return;
      default:
        return;
    }
  }

  #newApp(fields: {
    handle: string;
    nameEn: string;
    nameAr?: string | undefined;
  }): DeveloperApp {
    const app: DeveloperApp = {
      id: this.#id(),
      handle: fields.handle,
      clientId: `app_${base62(26)}`,
      nameEn: fields.nameEn,
      nameAr: fields.nameAr ?? fields.nameEn,
      distribution: 'custom',
      customBusinessId: null,
      hostingMode: 'external',
      status: 'draft',
      suspendedReason: null,
      currentVersion: null,
      installCount: 0,
      createdAt: new Date(this.clock.now()).toISOString(),
      updatedAt: new Date(this.clock.now()).toISOString(),
    };
    this.apps.unshift(app);
    return app;
  }

  #tokenView(row: TokenRow, current: boolean) {
    return {
      id: row.id,
      prefix: row.token.slice(0, 15),
      client: {
        id: 'tassyir-cli',
        name: 'Tassyir CLI',
        version: row.clientVersion,
      },
      deviceName: row.deviceName,
      country: 'DZ',
      createdAt: row.createdAt,
      lastUsedAt: new Date(this.clock.now()).toISOString(),
      expiresAt: '2027-01-12T10:00:00.000Z',
      revokedAt: null,
      current,
    };
  }

  #refuse(
    status: number,
    code: string,
    message: string,
    fix: string | undefined,
    extra: Record<string, unknown> = {},
  ): Response {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(extra)) {
      if (key.includes('-')) headers[key] = String(value);
    }
    const subject = Object.fromEntries(
      Object.entries(extra).filter(([key]) => !key.includes('-')),
    );
    return json(
      status,
      {
        statusCode: status,
        code,
        message: this.echoInErrors
          ? `${message} (${this.echoInErrors})`
          : message,
        ...(fix ? { fix } : {}),
        ...subject,
      },
      { 'x-request-id': 'req-test-1', ...headers },
    );
  }

  #id(): string {
    this.#ids += 1;
    return String(this.#ids);
  }

  /** Each version's bundle as uploaded (JSON), to tell an unchanged upload. */
  #bundleKeys = new Map<string, string | null>();
}

/** A hosted version's record right after its upload: scan pending. */
function initialHosting(bundle: unknown): HostedRecord {
  const record = bundle as {
    main?: string;
    files?: { content: string }[];
    lockfile?: { name: string };
  };
  const files = record.files ?? [];
  return {
    bundleSha256: 'ab'.repeat(32),
    bundleBytes: files.reduce(
      (sum, file) => sum + Buffer.byteLength(file.content, 'utf8'),
      0,
    ),
    files: Math.max(1, files.length),
    main: record.main ?? 'worker.js',
    lockfile: record.lockfile?.name ?? null,
    scan: {
      status: 'pending',
      dispatchedAt: null,
      finishedAt: null,
      failureCode: null,
      reasons: [],
    },
    deploy: {
      staging: {
        status: 'none',
        deployedAt: null,
        errorCode: null,
        refusal: null,
      },
      production: {
        status: 'none',
        deployedAt: null,
        errorCode: null,
        refusal: null,
      },
    },
    checks: [],
    review: null,
    rejectionReason: null,
  };
}

/** The list's view of a version: no manifest, no findings. */
function summaryOf(version: AppVersionDetail): Record<string, unknown> {
  const view: Record<string, unknown> = { ...version };
  delete view['manifest'];
  if (version.hosting) {
    const hosting: Record<string, unknown> = { ...version.hosting };
    delete hosting['checks'];
    delete hosting['review'];
    delete hosting['rejectionReason'];
    view['hosting'] = hosting;
  }
  return view;
}

/** What the sign-in routes say for each OAuth error (RFC 6749 §5.2). */
const OAUTH_DESCRIPTIONS: Readonly<Record<string, string>> = {
  authorization_pending: 'The sign-in is waiting for your approval',
  slow_down: 'Polling too fast',
  access_denied: 'The sign-in was denied',
  expired_token: 'The code expired',
  invalid_grant: 'Unknown or used device code',
  invalid_request: 'The request is malformed',
  unsupported_grant_type: 'Only the device code grant is supported',
};

function oauthError(error: string, description?: string): Response {
  return json(400, {
    error,
    error_description: description ?? OAUTH_DESCRIPTIONS[error] ?? error,
  });
}

function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}
