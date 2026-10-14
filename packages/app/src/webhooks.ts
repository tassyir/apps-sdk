import type { WebhookEvent } from './admin-types.js';
import { WEBHOOK_TOLERANCE_SECONDS } from './constants.js';
import { verifyEd25519 } from './ed25519.js';
import type { VerificationKey } from './ed25519.js';
import type { Bytes } from './encoding.js';
import {
  base64Decode,
  concatBytes,
  toBytes,
  utf8Decode,
  utf8Encode,
} from './encoding.js';
import { TassyirError, TassyirVerificationError } from './errors.js';
import type { VerificationErrorCode } from './errors.js';
import { isRecord } from './http.js';
import type { WebhookKeys } from './keys.js';

// Webhook deliveries (plan §3.8): Standard Webhooks headers, an Ed25519 `v1a`
// signature of `{webhook-id}.{webhook-timestamp}.{raw body}` per active
// Tassyir key, then the envelope's appId / installationId. Cross-checked
// against deliveries the backend's `signWebhook` signed (fixtures/).

/** Request headers: a Fetch `Headers`, or Node's `req.headers`. */
export type HeadersInput =
  Headers | Readonly<Record<string, string | readonly string[] | undefined>>;

/**
 * The body exactly as received: the bytes (Buffer, Uint8Array, ArrayBuffer)
 * or their UTF-8 string. Never a parsed and re-serialised object.
 */
export type RawBody = string | Uint8Array | ArrayBuffer;

export interface WebhookDelivery {
  headers: HeadersInput;
  body: RawBody;
}

/**
 * Which installations are yours: one id, a list, or a function that looks
 * the id up (in your database, say).
 */
export type InstallationCheck =
  | string
  | readonly string[]
  | ((
      installationId: string,
      event: WebhookEvent,
    ) => boolean | Promise<boolean>);

export interface VerifyWebhookOptions {
  /** `WebhookKeys.remote()`. Keep one instance for the process: it caches. */
  keys: WebhookKeys;
  /**
   * Your app's id, as the developer console shows it (`developer/apps/:appId`):
   * the envelope's `appId`. Not the `app_…` client id.
   */
  appId: string;
  /** The envelope's `installationId` must pass this check. */
  installationId: InstallationCheck;
  /** How far `webhook-timestamp` may be from now. Default 300 seconds. */
  toleranceSeconds?: number;
  /**
   * Test deliveries from the developer console carry sample data. They are
   * refused (`WEBHOOK_TEST_DELIVERY`) unless this is `'accept'`; then
   * `delivery.test` is true. Default `'reject'`.
   */
  testDeliveries?: 'reject' | 'accept';
  /** The clock, in ms. Default `Date.now`. */
  now?: () => number;
}

export interface VerifiedWebhook<E extends WebhookEvent = WebhookEvent> {
  /** `webhook-id`: the same on every retry and replay. Deduplicate on it. */
  id: string;
  /** `webhook-timestamp`, unix seconds of this attempt. */
  timestamp: number;
  topic: E['type'];
  businessId: string;
  installationId: string;
  apiVersion: string;
  /** A test delivery from the developer console (sample data). */
  test: boolean;
  /** The envelope (plan §3.7). `switch (event.type)` narrows `data`. */
  event: E;
}

/** Matches what the backend signs; no `.` can shift where the id ends. */
const WEBHOOK_ID = /^[A-Za-z0-9_-]{1,128}$/;
const TIMESTAMP = /^\d{1,15}$/;
const TEST_WEBHOOK_ID_PREFIX = 'dlv_test_';
const TEST_EVENT_ID = 'evt_0';

const FIX = {
  forged:
    'Answer 400 and do not process it: it was not signed by Tassyir, or it was changed on the way.',
  raw: 'Pass the raw request body (express.raw({ type: "application/json" }), await request.arrayBuffer(), or the string before JSON.parse).',
  clock:
    "Answer 400. If real deliveries fail here, check this server's clock (NTP).",
  app: "Check appId: it is your app's numeric id from the developer console (TASSYIR_APP_ID), not the client id.",
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
      'WEBHOOK_HEADER_MISSING',
      `The delivery has no ${name} header`,
      FIX.forged,
    );
  }
  return value;
}

function bodyBytes(body: unknown): Bytes {
  if (typeof body === 'string') return utf8Encode(body);
  if (body instanceof Uint8Array || body instanceof ArrayBuffer)
    return toBytes(body);
  return fail(
    'WEBHOOK_BODY_NOT_RAW',
    'The webhook body must be the raw bytes or string received',
    FIX.raw,
  );
}

/** The `v1a` signatures of the header (other schemes, like `v1`, are ignored). */
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

function parseEnvelope(bytes: Bytes): WebhookEvent {
  const text = utf8Decode(bytes);
  let value: unknown;
  try {
    value = text === null ? undefined : JSON.parse(text);
  } catch {
    value = undefined;
  }
  if (
    !isRecord(value) ||
    typeof value['id'] !== 'string' ||
    typeof value['type'] !== 'string' ||
    typeof value['apiVersion'] !== 'string' ||
    typeof value['createdAt'] !== 'string' ||
    typeof value['businessId'] !== 'string' ||
    typeof value['appId'] !== 'string' ||
    typeof value['installationId'] !== 'string' ||
    !Array.isArray(value['changed']) ||
    !isRecord(value['data'])
  ) {
    fail(
      'WEBHOOK_BODY_INVALID',
      'The signed body is not a Tassyir event envelope',
      'Answer 400; report it to Tassyir with the webhook-id if it keeps happening.',
    );
  }
  return value as unknown as WebhookEvent;
}

async function isOurInstallation(
  check: InstallationCheck,
  event: WebhookEvent,
): Promise<boolean> {
  if (typeof check === 'string') return check === event.installationId;
  if (typeof check === 'function') return check(event.installationId, event);
  return check.includes(event.installationId);
}

/**
 * Verifies a webhook delivery and returns its envelope. Throws a
 * `TassyirVerificationError` (`WEBHOOK_*` code) when it is not a genuine,
 * fresh delivery for your app: answer 400 and do not process it.
 *
 * The signature covers the `webhook-id`, the timestamp and the body. The
 * `tassyir-*` headers are not signed: the envelope is the truth, and a
 * header that disagrees with it is refused (`WEBHOOK_HEADER_MISMATCH`).
 * A test delivery is recognised by its signed id (`dlv_test_…`) and envelope
 * id (`evt_0`) as well as by `tassyir-test`, so removing the header does not
 * make it look real.
 */
export async function verifyWebhook(
  delivery: WebhookDelivery,
  options: VerifyWebhookOptions,
): Promise<VerifiedWebhook> {
  const tolerance = options.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;
  if (!Number.isInteger(tolerance) || tolerance < 1 || tolerance > 3600) {
    throw new TassyirError(
      'INVALID_OPTIONS',
      'toleranceSeconds must be a whole number from 1 to 3600',
      {
        fix: 'Omit toleranceSeconds to use the standard 300 seconds.',
      },
    );
  }
  if (
    typeof options.appId !== 'string' ||
    options.appId === '' ||
    options.appId.startsWith('app_')
  ) {
    throw new TassyirError(
      'INVALID_OPTIONS',
      "appId must be your app's numeric id, not the app_… client id",
      {
        fix: FIX.app,
      },
    );
  }

  const body = bodyBytes(delivery.body);
  const id = requireHeader(delivery.headers, 'webhook-id');
  const timestampHeader = requireHeader(delivery.headers, 'webhook-timestamp');
  const signatureHeader = requireHeader(delivery.headers, 'webhook-signature');
  if (!WEBHOOK_ID.test(id)) {
    fail(
      'WEBHOOK_HEADER_INVALID',
      'The webhook-id header is malformed',
      FIX.forged,
    );
  }
  if (!TIMESTAMP.test(timestampHeader)) {
    fail(
      'WEBHOOK_HEADER_INVALID',
      'The webhook-timestamp header is not unix seconds',
      FIX.forged,
    );
  }
  const timestamp = Number(timestampHeader);
  const now = Math.floor((options.now ?? Date.now)() / 1000);
  if (Math.abs(now - timestamp) > tolerance) {
    fail(
      'WEBHOOK_TIMESTAMP_OUT_OF_RANGE',
      `The delivery was signed ${String(now - timestamp)} s from now, outside ±${String(tolerance)} s`,
      FIX.clock,
    );
  }

  const signatures = v1aSignatures(signatureHeader);
  if (signatures.length === 0) {
    fail(
      'WEBHOOK_SIGNATURE_MISSING',
      'The delivery carries no v1a (Ed25519) signature',
      FIX.forged,
    );
  }
  const content = concatBytes(utf8Encode(`${id}.${timestampHeader}.`), body);
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
      'WEBHOOK_SIGNATURE_INVALID',
      "No signature of the delivery verifies with Tassyir's published keys",
      FIX.forged,
    );
  }

  const event = parseEnvelope(body);
  if (event.appId !== options.appId) {
    fail(
      'WEBHOOK_WRONG_APP',
      'The delivery is addressed to another app',
      FIX.app,
    );
  }
  if (!(await isOurInstallation(options.installationId, event))) {
    fail(
      'WEBHOOK_UNKNOWN_INSTALLATION',
      `The delivery is for installation ${event.installationId}, which the installationId check refused`,
      'Answer 400 if it is not yours; otherwise record the installation (app/installed) before checking deliveries against it.',
    );
  }

  const unsigned: Array<[string, string]> = [
    ['tassyir-topic', event.type],
    ['tassyir-business-id', event.businessId],
    ['tassyir-api-version', event.apiVersion],
  ];
  for (const [name, expected] of unsigned) {
    const value = readHeader(delivery.headers, name);
    if (value !== undefined && value !== expected) {
      fail(
        'WEBHOOK_HEADER_MISMATCH',
        `The ${name} header disagrees with the signed envelope`,
        FIX.forged,
      );
    }
  }

  const test =
    readHeader(delivery.headers, 'tassyir-test') === 'true' ||
    id.startsWith(TEST_WEBHOOK_ID_PREFIX) ||
    event.id === TEST_EVENT_ID;
  if (test && options.testDeliveries !== 'accept') {
    fail(
      'WEBHOOK_TEST_DELIVERY',
      'This is a test delivery from the developer console: its data are samples',
      'Answer 2xx without processing it, or pass { testDeliveries: "accept" } and branch on delivery.test.',
    );
  }

  return {
    id,
    timestamp,
    topic: event.type,
    businessId: event.businessId,
    installationId: event.installationId,
    apiVersion: event.apiVersion,
    test,
    event,
  };
}

/**
 * `verifyWebhook` for a Fetch API `Request` (Cloudflare Workers, Hono,
 * Next.js route handlers, Deno, Bun). Reads the body: do not read it before.
 */
export async function verifyWebhookRequest(
  request: Request,
  options: VerifyWebhookOptions,
): Promise<VerifiedWebhook> {
  return verifyWebhook(
    { headers: request.headers, body: await request.arrayBuffer() },
    options,
  );
}
