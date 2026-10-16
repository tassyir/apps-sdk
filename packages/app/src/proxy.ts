import { PROXY_SIGNATURE_LABEL, PROXY_TOLERANCE_SECONDS } from './constants.js';
import { verifyEd25519 } from './ed25519.js';
import type { VerificationKey } from './ed25519.js';
import type { Bytes } from './encoding.js';
import { base64Decode, toBytes, utf8Encode } from './encoding.js';
import { TassyirError, TassyirVerificationError } from './errors.js';
import type { VerificationErrorCode } from './errors.js';
import type { WebhookKeys } from './keys.js';
import type { HeadersInput, RawBody } from './webhooks.js';

// The app proxy (tassyir/backend docs/APPS_PHASE2_PLAN.md §7, AP-B2.5): a
// buyer's request to `https://{store}/apps/{handle}/{rest}` reaches the app
// at `{hosting.url}{[app_proxy] path}/{rest}`, forwarded by the Tassyir API,
// which adds `tassyir-*` headers and signs it like a webhook (D8): an Ed25519
// `v1a` signature, with a key of Tassyir's published webhook keys, over
//
//   tassyir-proxy.v1.{timestamp}.{METHOD}.{path+query}.{sha256(body)}.{installationId}.{storeId}
//
// The `tassyir-proxy.v1.` label keeps a proxy signature from ever verifying
// as a webhook (and a webhook's as a proxy request). Built to the plan's
// contract before AP-B2.5 forwards anything: the encodings below (the hash
// in lowercase hex, the path and query as the app receives them) are this
// package's reading of it, to be confirmed by AP-B2.5.

/** A forwarded request: what the app's server received. */
export interface ProxyRequest {
  /** `GET`, `POST`, …: the method the buyer's browser used. */
  method: string;
  /**
   * The path and query exactly as received (`/proxy/reviews?page=2`), or the
   * whole URL (only its path and query are read).
   */
  url: string;
  headers: HeadersInput;
  /** The raw body: bytes or their UTF-8 string; empty for a GET. */
  body?: RawBody | undefined;
}

/**
 * Which installations are yours: one id, a list, or a function that looks
 * the id up. The signature is Tassyir's, the same for every app, so this
 * check is what makes a request yours.
 */
export type ProxyInstallationCheck =
  | string
  | readonly string[]
  | ((installationId: string, storeId: string) => boolean | Promise<boolean>);

export interface VerifyProxyOptions {
  /** `WebhookKeys.remote()` (or `hostedWebhookKeys(ctx.props)` on Tassyir Hosting). */
  keys: WebhookKeys;
  /** The signed `tassyir-installation-id` must pass this check. */
  installationId: ProxyInstallationCheck;
  /** How far `tassyir-proxy-timestamp` may be from now. Default 300 seconds. */
  toleranceSeconds?: number;
  /** The clock, in ms. Default `Date.now`. */
  now?: () => number;
}

export interface VerifiedProxyRequest {
  /** Signed: the installation the request is for. */
  installationId: string;
  /** Signed: the store whose page the buyer is on. */
  storeId: string;
  /** Signed: `tassyir-proxy-timestamp`, unix seconds. */
  timestamp: number;
  /** Signed: the method, upper case. */
  method: string;
  /** Signed: the path and query the signature covers. */
  path: string;
  /**
   * Not covered by the signature: context Tassyir adds (§7). Decide on
   * `installationId` and `storeId`; look the business up from the
   * installation you recorded at install.
   */
  unsigned: {
    businessId: string | null;
    storeHost: string | null;
    country: string | null;
    locale: string | null;
  };
}

const DIGITS = /^\d{1,20}$/;
const TIMESTAMP = /^\d{1,15}$/;
const METHOD = /^[A-Z]{1,16}$/;

const FIX = {
  forged:
    'Answer 401 and do not process it: Tassyir did not sign it, or it was changed on the way.',
  raw: 'Pass the raw request body (express.raw({ type: "*/*" }), await request.arrayBuffer(), or the string before parsing).',
  clock:
    "Answer 401. If real requests fail here, check this server's clock (NTP).",
  path: 'Pass the path and query exactly as your server received them (`url`), before any rewrite or decoding.',
} as const;

function fail(
  code: VerificationErrorCode,
  message: string,
  fix: string,
): never {
  throw new TassyirVerificationError(code, message, { fix });
}

function readHeader(headers: HeadersInput, name: string): string | undefined {
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) ?? undefined;
  }
  const record = headers as Readonly<
    Record<string, string | readonly string[] | undefined>
  >;
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() !== name) continue;
    const value = record[key];
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return (value as readonly string[]).join(' ');
  }
  return undefined;
}

function requireHeader(headers: HeadersInput, name: string): string {
  const value = readHeader(headers, name);
  if (value === undefined || value === '') {
    fail(
      'PROXY_HEADER_MISSING',
      `The request has no ${name} header: it did not come through the Tassyir app proxy`,
      FIX.forged,
    );
  }
  return value;
}

function bodyBytes(body: unknown): Bytes {
  if (body === undefined) return new Uint8Array(0);
  if (typeof body === 'string') return utf8Encode(body);
  if (body instanceof Uint8Array || body instanceof ArrayBuffer)
    return toBytes(body);
  return fail(
    'PROXY_BODY_NOT_RAW',
    'The proxy request body must be the raw bytes or string received',
    FIX.raw,
  );
}

/** `/proxy/x?y=1` from a path or a whole URL; the query as written. */
function pathAndQuery(url: string): string {
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fail(
      'PROXY_PATH_INVALID',
      'The request URL is neither a path nor an absolute URL',
      FIX.path,
    );
  }
  return `${parsed.pathname}${parsed.search}`;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** The `v1a` signatures of the header (others, like `v1`, are ignored). */
function v1aSignatures(header: string): Bytes[] {
  const signatures: Bytes[] = [];
  for (const entry of header.split(/\s+/)) {
    const [scheme, value] = entry.replace(/,$/, '').split(',', 2);
    if (scheme !== 'v1a' || value === undefined) continue;
    const signature = base64Decode(value);
    if (signature?.length === 64) signatures.push(signature);
  }
  return signatures;
}

async function anyVerifies(
  keys: readonly VerificationKey[],
  signatures: readonly Bytes[],
  content: Bytes,
): Promise<boolean> {
  for (const signature of signatures) {
    for (const key of keys) {
      if (await verifyEd25519(key, signature, content)) return true;
    }
  }
  return false;
}

async function isOurs(
  check: ProxyInstallationCheck,
  installationId: string,
  storeId: string,
): Promise<boolean> {
  if (typeof check === 'string') return check === installationId;
  if (typeof check === 'function') return check(installationId, storeId);
  return check.includes(installationId);
}

/**
 * The text Tassyir signs for a proxy request (§7). Exported for tests that
 * sign their own requests; the verifier builds it the same way.
 */
export async function proxySignatureContent(fields: {
  timestamp: string;
  method: string;
  path: string;
  body: Uint8Array;
  installationId: string;
  storeId: string;
}): Promise<string> {
  const digest = hex(
    await crypto.subtle.digest('SHA-256', toBytes(fields.body)),
  );
  return [
    PROXY_SIGNATURE_LABEL,
    fields.timestamp,
    fields.method,
    fields.path,
    digest,
    fields.installationId,
    fields.storeId,
  ].join('.');
}

/**
 * Verifies a request forwarded by the Tassyir app proxy and returns what it
 * is for. Throws a `TassyirVerificationError` (`PROXY_*` code) when it is
 * not a genuine, fresh proxy request for one of your installations: answer
 * 401 and do not process it.
 *
 * The signature covers the timestamp, the method, the path and query, the
 * body's hash, the installation and the store. The other `tassyir-*`
 * headers are context, returned under `unsigned`. The proxy never forwards
 * the buyer's cookies or IP; a request may be replayed within the tolerance,
 * so keep handlers of non-GET requests idempotent.
 */
export async function verifyProxy(
  request: ProxyRequest,
  options: VerifyProxyOptions,
): Promise<VerifiedProxyRequest> {
  const tolerance = options.toleranceSeconds ?? PROXY_TOLERANCE_SECONDS;
  if (!Number.isInteger(tolerance) || tolerance < 1 || tolerance > 3600) {
    throw new TassyirError(
      'INVALID_OPTIONS',
      'toleranceSeconds must be a whole number from 1 to 3600',
      { fix: 'Omit toleranceSeconds to use the standard 300 seconds.' },
    );
  }
  const installationCheck = options.installationId as unknown;
  if (
    installationCheck === undefined ||
    installationCheck === null ||
    installationCheck === ''
  ) {
    throw new TassyirError(
      'INVALID_OPTIONS',
      'installationId is required: the signature is the same for every app',
      {
        fix: 'Pass installationId: your installation id, a list, or a function that looks it up (the installations you recorded at app/installed).',
      },
    );
  }

  const body = bodyBytes(request.body);
  const method = request.method.toUpperCase();
  if (!METHOD.test(method)) {
    fail('PROXY_HEADER_INVALID', 'The request method is malformed', FIX.forged);
  }
  const path = pathAndQuery(request.url);
  const timestampHeader = requireHeader(
    request.headers,
    'tassyir-proxy-timestamp',
  );
  const signatureHeader = requireHeader(
    request.headers,
    'tassyir-proxy-signature',
  );
  const installationId = requireHeader(
    request.headers,
    'tassyir-installation-id',
  );
  const storeId = requireHeader(request.headers, 'tassyir-store-id');
  if (!TIMESTAMP.test(timestampHeader)) {
    fail(
      'PROXY_HEADER_INVALID',
      'The tassyir-proxy-timestamp header is not unix seconds',
      FIX.forged,
    );
  }
  if (!DIGITS.test(installationId) || !DIGITS.test(storeId)) {
    fail(
      'PROXY_HEADER_INVALID',
      'The tassyir-installation-id or tassyir-store-id header is not a Tassyir id',
      FIX.forged,
    );
  }
  const timestamp = Number(timestampHeader);
  const now = Math.floor((options.now ?? Date.now)() / 1000);
  if (Math.abs(now - timestamp) > tolerance) {
    fail(
      'PROXY_TIMESTAMP_OUT_OF_RANGE',
      `The request was signed ${String(now - timestamp)} s from now, outside ±${String(tolerance)} s`,
      FIX.clock,
    );
  }
  const signatures = v1aSignatures(signatureHeader);
  if (signatures.length === 0) {
    fail(
      'PROXY_SIGNATURE_MISSING',
      'The request carries no v1a (Ed25519) signature',
      FIX.forged,
    );
  }
  const content = utf8Encode(
    await proxySignatureContent({
      timestamp: timestampHeader,
      method,
      path,
      body,
      installationId,
      storeId,
    }),
  );
  let verified = await anyVerifies(
    await options.keys.all(),
    signatures,
    content,
  );
  // A key published for a rotation after our last fetch: fetch once more.
  if (!verified && (await options.keys.refresh())) {
    verified = await anyVerifies(await options.keys.all(), signatures, content);
  }
  if (!verified) {
    fail(
      'PROXY_SIGNATURE_INVALID',
      "No signature of the request verifies with Tassyir's published keys",
      `${FIX.forged} If every request fails here, check that you pass the path and query as received (url) and the raw body.`,
    );
  }
  if (!(await isOurs(options.installationId, installationId, storeId))) {
    fail(
      'PROXY_UNKNOWN_INSTALLATION',
      `The request is for installation ${installationId}, which the installationId check refused`,
      'Answer 401 if it is not yours; otherwise record the installation (app/installed) before serving its proxy requests.',
    );
  }
  const optional = (name: string) => {
    const value = readHeader(request.headers, name);
    return value === undefined || value === '' ? null : value;
  };
  return {
    installationId,
    storeId,
    timestamp,
    method,
    path,
    unsigned: {
      businessId: optional('tassyir-business-id'),
      storeHost: optional('tassyir-store-host'),
      country: optional('tassyir-country'),
      locale: optional('tassyir-locale'),
    },
  };
}

/**
 * `verifyProxy` for a Fetch API `Request` (Cloudflare Workers, Hono, Next.js
 * route handlers, Deno, Bun): its method, URL, headers and body. Reads the
 * body: do not read it before. Behind a proxy that rewrites paths, call
 * `verifyProxy` with the original `url` instead.
 */
export async function verifyProxyRequest(
  request: Request,
  options: VerifyProxyOptions,
): Promise<VerifiedProxyRequest> {
  const body =
    request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : await request.arrayBuffer();
  return verifyProxy(
    {
      method: request.method,
      url: request.url,
      headers: request.headers,
      body,
    },
    options,
  );
}
