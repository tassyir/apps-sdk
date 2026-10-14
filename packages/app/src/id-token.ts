import {
  ID_TOKEN_ISSUER,
  ID_TOKEN_LEEWAY_SECONDS,
  ID_TOKEN_MAX_LIFETIME_SECONDS,
} from './constants.js';
import { verifyEd25519 } from './ed25519.js';
import { base64UrlDecode, utf8Decode, utf8Encode } from './encoding.js';
import { TassyirError, TassyirVerificationError } from './errors.js';
import type { VerificationErrorCode } from './errors.js';
import { isRecord } from './http.js';
import type { IdTokenKeys } from './keys.js';

// The ID token the dashboard hands an embedded app page (plan §3.4): a
// compact JWS, `alg: EdDSA`, 60 seconds. This check mirrors the backend's own
// `verifyIdToken` (src/app-platform/auth/id-token.ts) rule for rule, and is
// cross-checked against tokens the backend signed (fixtures/).

/** The claims of a Tassyir ID token (plan §3.4). */
export interface IdTokenClaims {
  /** Always `https://api.tassyir.io/apps`. */
  iss: string;
  /** Your app's client id. */
  aud: string;
  /** The dashboard user. */
  sub: string;
  /** The business. */
  bid: string;
  /** The installation of your app on that business. */
  iid: string;
  /** Random per dashboard tab session. */
  sid: string;
  /** The dashboard's locale (`ar`, `en`, …). */
  locale: string;
  iat: number;
  nbf: number;
  exp: number;
  /** Unique per token: the token endpoint accepts each ID token once. */
  jti: string;
}

export interface VerifiedIdToken {
  claims: IdTokenClaims;
  /** The key that signed it. */
  kid: string;
  userId: string;
  businessId: string;
  installationId: string;
  sessionId: string;
  locale: string;
}

export interface VerifyIdTokenOptions {
  /** Your app's client id (`app_…`): the token's `aud` must equal it. */
  clientId: string;
  /** `IdTokenKeys.remote()`. Keep one instance for the process: it caches. */
  keys: IdTokenKeys;
  /** The clock, in ms. Default `Date.now`. */
  now?: () => number;
  /** Clock skew accepted on `exp`, `nbf` and `iat`, 0 to 60. Default 30, the backend's. */
  leewaySeconds?: number;
}

/** Far above a real token (~600 characters); bounds the work spent on garbage. */
const MAX_TOKEN_LENGTH = 4096;
const SEGMENT = /^[A-Za-z0-9_-]+$/;

const FIX = {
  stale:
    "Ask App Bridge for a fresh ID token (they live 60 seconds) and check this server's clock.",
  forged:
    'Refuse the request: this token was not signed by Tassyir for your app.',
  audience:
    'Check that clientId is the client id of the app the token was issued to (TASSYIR_CLIENT_ID).',
} as const;

function fail(
  code: VerificationErrorCode,
  message: string,
  fix: string,
): never {
  throw new TassyirVerificationError(code, message, { fix });
}

function decodeJson(segment: string): Record<string, unknown> | null {
  const bytes = base64UrlDecode(segment);
  const text = bytes && utf8Decode(bytes);
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

const isInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);

/**
 * Verifies an ID token for your app and returns its claims. Throws a
 * `TassyirVerificationError` (`ID_TOKEN_*` code) when the token is not
 * genuine, not yours, or not valid now.
 *
 * The signature is checked before any claim is read; the key is chosen only
 * by `kid` among Tassyir's published keys (`jwk`, `jku` and `x5u` are never
 * followed); `alg` must be `EdDSA`.
 */
export async function verifyIdToken(
  token: string,
  options: VerifyIdTokenOptions,
): Promise<VerifiedIdToken> {
  const leeway = options.leewaySeconds ?? ID_TOKEN_LEEWAY_SECONDS;
  if (!Number.isInteger(leeway) || leeway < 0 || leeway > 60) {
    throw new TassyirError(
      'INVALID_OPTIONS',
      'leewaySeconds must be a whole number from 0 to 60',
      {
        fix: "Omit leewaySeconds to use the backend's 30 seconds, and fix the server clock instead of widening it.",
      },
    );
  }
  if (typeof options.clientId !== 'string' || options.clientId === '') {
    throw new TassyirError(
      'INVALID_OPTIONS',
      'clientId is required to verify an ID token',
      {
        fix: "Pass your app's client id (app_…), for example from process.env.TASSYIR_CLIENT_ID.",
      },
    );
  }

  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) {
    fail('ID_TOKEN_MALFORMED', 'The ID token is not a compact JWS', FIX.forged);
  }
  const segments = token.split('.');
  const [headerSegment, payloadSegment, signatureSegment] = segments;
  if (
    segments.length !== 3 ||
    headerSegment === undefined ||
    payloadSegment === undefined ||
    signatureSegment === undefined ||
    !segments.every((segment) => SEGMENT.test(segment))
  ) {
    fail(
      'ID_TOKEN_MALFORMED',
      'The ID token is not three base64url segments',
      FIX.forged,
    );
  }

  const header = decodeJson(headerSegment);
  if (!header) {
    fail(
      'ID_TOKEN_MALFORMED',
      'The ID token header is not a JSON object',
      FIX.forged,
    );
  }
  const kid = header['kid'];
  if (
    header['alg'] !== 'EdDSA' ||
    typeof kid !== 'string' ||
    (header['typ'] !== undefined && header['typ'] !== 'JWT') ||
    header['crit'] !== undefined
  ) {
    fail(
      'ID_TOKEN_UNSUPPORTED_HEADER',
      'The ID token header must be { alg: "EdDSA", kid } with no crit',
      FIX.forged,
    );
  }

  const key = await options.keys.get(kid);
  if (!key) {
    fail(
      'ID_TOKEN_UNKNOWN_KEY',
      // The kid is the caller's: named only when it looks like one of ours.
      /^[A-Za-z0-9._-]{1,64}$/.test(kid)
        ? `No published Tassyir key has kid "${kid}"`
        : 'No published Tassyir key has this kid',
      'Refuse the token. If Tassyir just rotated its keys, the next request fetches them again; check apiOrigin points at the right environment.',
    );
  }

  // Ed25519 signatures are 64 bytes, canonical base64url only.
  const signature = base64UrlDecode(signatureSegment);
  if (signature?.length !== 64) {
    fail(
      'ID_TOKEN_BAD_SIGNATURE',
      'The ID token signature is not 64 bytes of base64url',
      FIX.forged,
    );
  }
  if (
    !(await verifyEd25519(
      key,
      signature,
      utf8Encode(`${headerSegment}.${payloadSegment}`),
    ))
  ) {
    fail(
      'ID_TOKEN_BAD_SIGNATURE',
      'The ID token signature does not verify',
      FIX.forged,
    );
  }

  const payload = decodeJson(payloadSegment);
  if (!payload) {
    fail(
      'ID_TOKEN_MALFORMED',
      'The ID token payload is not a JSON object',
      FIX.forged,
    );
  }
  const { iss, aud, sub, bid, iid, sid, locale, iat, nbf, exp, jti } = payload;
  if (
    typeof iss !== 'string' ||
    typeof aud !== 'string' ||
    typeof sub !== 'string' ||
    typeof bid !== 'string' ||
    typeof iid !== 'string' ||
    typeof sid !== 'string' ||
    typeof locale !== 'string' ||
    typeof jti !== 'string' ||
    !isInt(iat) ||
    !isInt(nbf) ||
    !isInt(exp) ||
    exp <= iat ||
    exp - iat > ID_TOKEN_MAX_LIFETIME_SECONDS
  ) {
    fail(
      'ID_TOKEN_INVALID_CLAIMS',
      'The ID token claims are missing, mistyped, or live longer than 60 seconds',
      FIX.forged,
    );
  }
  if (iss !== ID_TOKEN_ISSUER) {
    fail(
      'ID_TOKEN_WRONG_ISSUER',
      `The ID token issuer is not ${ID_TOKEN_ISSUER}`,
      FIX.forged,
    );
  }
  if (aud !== options.clientId) {
    fail(
      'ID_TOKEN_WRONG_AUDIENCE',
      'The ID token was issued to another app',
      FIX.audience,
    );
  }

  const now = Math.floor((options.now ?? Date.now)() / 1000);
  if (now >= exp + leeway) {
    fail('ID_TOKEN_EXPIRED', 'The ID token has expired', FIX.stale);
  }
  if (now < nbf - leeway || now < iat - leeway) {
    fail('ID_TOKEN_NOT_YET_VALID', 'The ID token is not valid yet', FIX.stale);
  }

  const claims: IdTokenClaims = {
    iss,
    aud,
    sub,
    bid,
    iid,
    sid,
    locale,
    iat,
    nbf,
    exp,
    jti,
  };
  return {
    claims,
    kid,
    userId: sub,
    businessId: bid,
    installationId: iid,
    sessionId: sid,
    locale,
  };
}
