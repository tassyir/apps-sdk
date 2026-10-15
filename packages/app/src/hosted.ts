import { AdminClient, HOSTED_TRANSPORT } from './admin-client.js';
import type { AdminClientOptions } from './admin-client.js';
import { TassyirError, TassyirVerificationError } from './errors.js';
import type { FetchLike } from './http.js';
import { isRecord } from './http.js';
import type { WebhookKeys } from './keys.js';
import { verifyDelivery } from './webhooks.js';
import type { VerifiedWebhook, VerifyWebhookOptions } from './webhooks.js';

// Tassyir Hosting (plan §3.4 "Hosted apps hold no token", AP-B1.15/B1.16):
// a hosted app's Worker gets its capabilities per request in `ctx.props`,
// never in `env` (one script serves every installation pinned to its
// version, so nothing per installation can be a binding). The dispatcher
// sets them from the API's context; the app's code can neither read nor
// change what the two capabilities act for.
//
//   export default {
//     async fetch(request, env, ctx) {
//       const props = readHostedProps(ctx);
//       const admin = hostedAdmin(props);
//       …
//     },
//   };
//
// Module-level state is shared between the merchants an isolate serves:
// keep per-request state per request.

/** `ctx.props.installation`: the installation this request runs for. */
export interface HostedInstallation {
  id: string;
  businessId: string;
  /** The app's numeric id (webhook envelopes name it `appId`). */
  appId: string;
  handle: string;
  /** The version the installation is pinned to (the one running). */
  version: number;
  /** The scopes the merchant granted. */
  scopes: string[];
  /** `selected`: only `storeIds`; `all`: every store of the business. */
  storeAccess: 'all' | 'selected';
  storeIds: string[];
  /** A developer's test business (synthetic data, no outside effects). */
  devStore: boolean;
}

/**
 * `ctx.props.viewer`: the dashboard member who opened the page, or `null`
 * when nobody is looking (a webhook delivery). It says who is looking; it is
 * not a permission: the dashboard decided the member may open the app, and
 * what the page shows them is the app's responsibility.
 */
export interface HostedViewer {
  userId: string;
  /** One per dashboard tab. */
  sessionId: string;
}

/** A value SQLite hands back. */
export type HostedSqlValue = string | number | null | ArrayBuffer;

/** A value a statement may bind: strings, finite numbers, null, bytes. */
export type HostedSqlBinding =
  string | number | null | ArrayBuffer | ArrayBufferView;

export interface HostedSqlResult<
  Row extends Record<string, HostedSqlValue> = Record<string, HostedSqlValue>,
> {
  /** The last statement's rows: at most 5,000 and about 4 MiB (page with LIMIT). */
  rows: Row[];
  rowsRead: number;
  rowsWritten: number;
}

export interface HostedSqlStatement {
  query: string;
  bindings?: readonly HostedSqlBinding[];
}

/**
 * `ctx.props.STORAGE`: the installation's own SQLite database. Each call is
 * one transaction (a failure rolls back everything the call wrote; `BEGIN`
 * and `COMMIT` are refused). Limits per call: a query of 100,000
 * characters, 100 bound values (1 MiB together), a batch of 50 statements.
 * The database is capped (50 MiB by default): a write past it is refused
 * `STORAGE_FULL`; reads and deletes always run. Refusals reject with an
 * Error whose message starts with `STORAGE_FULL`, `STORAGE_LIMIT`,
 * `STORAGE_INVALID`, `STORAGE_UNAVAILABLE`, or is SQLite's own. Erased 48
 * hours after an uninstall.
 */
export interface HostedStorage {
  sql<
    Row extends Record<string, HostedSqlValue> = Record<string, HostedSqlValue>,
  >(
    query: string,
    ...bindings: HostedSqlBinding[]
  ): Promise<HostedSqlResult<Row>>;
  /** Several statements in ONE transaction; one result each. */
  batch(statements: readonly HostedSqlStatement[]): Promise<HostedSqlResult[]>;
  usage(): Promise<{ bytes: number; limitBytes: number }>;
}

/**
 * `ctx.props.TASSYIR`: the Admin API as the installation, with no token.
 * Called like `fetch` with the Admin API's own URLs; `hostedAdmin(props)`
 * wraps it in the typed client.
 */
export interface TassyirBinding {
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

/** Everything Tassyir Hosting hands a hosted app's Worker, per request. */
export interface HostedProps {
  installation: HostedInstallation;
  viewer: HostedViewer | null;
  STORAGE: HostedStorage;
  TASSYIR: TassyirBinding;
}

/**
 * The codes `ctx.props.TASSYIR` answers by itself, as problem+json in the
 * Admin API's shape (`type`, `title`, `status`, `detail`, `code`, `fix`,
 * `docs`, no `requestId`: they never reached the API). The first three are
 * the binding's own; the others are Admin API codes the binding also uses.
 * `hostedAdmin` throws them as `TassyirApiError`s, like the API's.
 */
export const HOSTED_BINDING_ERRORS = Object.freeze({
  HOSTED_PATH_NOT_ALLOWED: {
    status: 400,
    meaning: 'Not an Admin API path: TASSYIR only calls /apps/<version>/….',
  },
  RESPONSE_TOO_LARGE: {
    status: 502,
    meaning:
      'The answer is over 8 MiB, the most a hosted app may receive: ask for less (a smaller limit, ?fields=).',
  },
  TASSYIR_BINDING_NOT_AVAILABLE: {
    status: 503,
    meaning:
      'The binding is not configured: nothing was sent. Not retried by the SDK.',
  },
  METHOD_NOT_ALLOWED: {
    status: 405,
    meaning: 'Only GET, POST, PUT, PATCH and DELETE.',
  },
  BAD_REQUEST: { status: 400, meaning: 'The body is not valid UTF-8 JSON.' },
  IDEMPOTENCY_KEY_INVALID: {
    status: 400,
    meaning: 'An Idempotency-Key of 1 to 255 printable ASCII characters.',
  },
  PAYLOAD_TOO_LARGE: {
    status: 413,
    meaning: 'A body of at most 256 KiB as sent, 100 KB as compact JSON.',
  },
  UNSUPPORTED_MEDIA_TYPE: {
    status: 415,
    meaning: 'JSON bodies only (Content-Type: application/json).',
  },
  SERVICE_UNAVAILABLE: {
    status: 503,
    meaning:
      "Tassyir's API did not answer within 30 seconds; retry (a write with an Idempotency-Key is safe to retry).",
  },
} as const);

export type HostedBindingErrorCode = keyof typeof HOSTED_BINDING_ERRORS;

const ID = /^\d{1,20}$/;

function propsMissing(why: string): TassyirError {
  return new TassyirError(
    'HOSTED_PROPS_MISSING',
    `ctx.props is not a Tassyir Hosting installation: ${why}`,
    {
      fix: 'This code runs on Tassyir Hosting, where the dispatcher passes ctx.props with each request; in tests, pass stand-in props of the same shape.',
    },
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    (value as unknown[]).every((item) => typeof item === 'string')
  );
}

/**
 * `ctx.props` as Tassyir Hosting passes it, checked. Throws
 * `HOSTED_PROPS_MISSING` (a TassyirError with a `fix`) outside Tassyir
 * Hosting, where the Worker gets no props.
 */
export function readHostedProps(
  ctx: { readonly props?: unknown } | null | undefined,
): HostedProps {
  const props: unknown = ctx?.props;
  if (!isRecord(props)) throw propsMissing('it is missing');
  const installation = props['installation'];
  if (
    !isRecord(installation) ||
    typeof installation['id'] !== 'string' ||
    !ID.test(installation['id']) ||
    typeof installation['businessId'] !== 'string' ||
    !ID.test(installation['businessId']) ||
    typeof installation['appId'] !== 'string' ||
    !ID.test(installation['appId']) ||
    typeof installation['handle'] !== 'string' ||
    typeof installation['version'] !== 'number' ||
    !isStringArray(installation['scopes']) ||
    (installation['storeAccess'] !== 'all' &&
      installation['storeAccess'] !== 'selected') ||
    !isStringArray(installation['storeIds']) ||
    typeof installation['devStore'] !== 'boolean'
  ) {
    throw propsMissing('installation is missing or malformed');
  }
  const viewer = props['viewer'];
  if (
    viewer !== null &&
    !(
      isRecord(viewer) &&
      typeof viewer['userId'] === 'string' &&
      typeof viewer['sessionId'] === 'string'
    )
  ) {
    throw propsMissing('viewer is neither null nor { userId, sessionId }');
  }
  // The two capabilities are RPC stubs: every member reads as a function.
  const storage = props['STORAGE'] as Partial<HostedStorage> | undefined;
  if (
    (typeof storage !== 'object' && typeof storage !== 'function') ||
    typeof storage.sql !== 'function' ||
    typeof storage.batch !== 'function'
  ) {
    throw propsMissing('STORAGE is missing');
  }
  const binding = props['TASSYIR'] as Partial<TassyirBinding> | undefined;
  if (
    (typeof binding !== 'object' && typeof binding !== 'function') ||
    typeof binding.fetch !== 'function'
  ) {
    throw propsMissing('TASSYIR is missing');
  }
  return props as unknown as HostedProps;
}

/** What `hostedAdmin` accepts: no token, no origin, no fetch of its own. */
export type HostedAdminOptions = Pick<
  AdminClientOptions,
  'retries' | 'timeoutMs' | 'onResponse'
>;

/**
 * The binding as the client's fetch. The caller's timeout and AbortSignal
 * stop the WAIT here, without handing the signal across the service
 * binding: the binding bounds its own call to the API (30 seconds).
 */
function bindingFetch(binding: TassyirBinding): FetchLike {
  return (url, init) => {
    const { signal, ...rest } = init;
    const call = binding.fetch(url, rest);
    if (!signal) return call;
    return new Promise<Response>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason as Error);
        return;
      }
      const onAbort = () => {
        reject(signal.reason as Error);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      call
        .finally(() => {
          signal.removeEventListener('abort', onAbort);
        })
        .then(resolve, reject);
    });
  };
}

/**
 * The Admin API client for a hosted app: the same typed `AdminClient`, its
 * requests sent through `ctx.props.TASSYIR` as the installation, with no
 * token (none is needed or held). Errors are `TassyirApiError`s: the API's
 * problem+json, or the binding's own (`HOSTED_BINDING_ERRORS`). Each call is
 * a subrequest of the invocation (50 by default), retries included.
 */
export function hostedAdmin(
  props: Pick<HostedProps, 'TASSYIR'> | TassyirBinding,
  options: HostedAdminOptions = {},
): AdminClient {
  const binding = 'TASSYIR' in props ? props.TASSYIR : props;
  if (typeof binding.fetch !== 'function') {
    throw propsMissing('TASSYIR is missing');
  }
  return new AdminClient({
    retries: options.retries,
    timeoutMs: options.timeoutMs,
    onResponse: options.onResponse,
    [HOSTED_TRANSPORT]: bindingFetch(binding),
  });
}

export interface VerifyHostedWebhookOptions extends Pick<
  VerifyWebhookOptions,
  'testDeliveries' | 'toleranceSeconds' | 'now'
> {
  /**
   * Tassyir's webhook public keys, when you hold them
   * (`WebhookKeys.fromPublicKeys([...])`): the signature is then verified as
   * `verifyWebhook` does. Without them the dispatcher's word stands for it
   * (see `verifyHostedWebhook`): a hosted Worker cannot fetch
   * `/apps/webhook-keys` itself (its egress refuses every Tassyir host).
   */
  keys?: WebhookKeys;
}

export interface HostedVerifiedWebhook extends VerifiedWebhook {
  /** True when `keys` verified the signature; false when the dispatcher's word stood for it. */
  signatureVerified: boolean;
}

/**
 * A webhook delivery to a hosted app (`POST <the manifest's webhook path>`),
 * checked by every rule of `verifyWebhook` with `appId` and the installation
 * taken from `ctx.props`. Throws `TassyirVerificationError`: answer 400 and
 * do not process it.
 *
 * How a hosted app receives webhooks: the API sends the delivery (the same
 * headers, `v1a` signature and body as to an external app) to Tassyir
 * Hosting's dispatcher, signed with a key only the API and the dispatcher
 * hold, each delivery once; the dispatcher runs the installation's version
 * with `viewer: null` and POSTs it to the app. A page request always has a
 * viewer, and nothing else on the internet reaches the Worker. So:
 *
 * - a request with a viewer is refused `WEBHOOK_NOT_A_DELIVERY`;
 * - the envelope must name this installation, its business and its app;
 * - the timestamp (5 minutes), the test-delivery rule and the `tassyir-*`
 *   headers are checked as for any delivery, and a `v1a` signature must be
 *   there; it is verified when `keys` are given.
 *
 * Deduplicate on `delivery.id` (`webhook-id`), as everywhere: delivery is at
 * least once. Reads the body: do not read it before.
 */
export async function verifyHostedWebhook(
  request: Request,
  props: Pick<HostedProps, 'installation' | 'viewer'>,
  options: VerifyHostedWebhookOptions = {},
): Promise<HostedVerifiedWebhook> {
  if (props.viewer !== null) {
    throw new TassyirVerificationError(
      'WEBHOOK_NOT_A_DELIVERY',
      'This request comes from a page of the app (a member is looking), not from a webhook delivery',
      {
        fix: 'Answer 400 and do not process it: on Tassyir Hosting a delivery always runs with ctx.props.viewer null.',
      },
    );
  }
  const { installation } = props;
  const delivery = await verifyDelivery(
    { headers: request.headers, body: await request.arrayBuffer() },
    {
      appId: installation.appId,
      installationId: (installationId, event) =>
        installationId === installation.id &&
        event.businessId === installation.businessId,
      testDeliveries: options.testDeliveries,
      toleranceSeconds: options.toleranceSeconds,
      now: options.now,
    },
    options.keys ?? null,
  );
  return { ...delivery, signatureVerified: options.keys !== undefined };
}
