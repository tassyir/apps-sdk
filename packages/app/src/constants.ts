// The contract's names and numbers (tassyir/backend docs/APPS_PLATFORM_PLAN.md
// §3.1, §3.4, §3.8). Change them there first.

/** Where the Tassyir API lives. Pass `apiOrigin` to point at another environment. */
export const TASSYIR_API_ORIGIN = 'https://api.tassyir.io';

/** The Admin API version this release of the SDK is generated from. */
export const ADMIN_API_VERSION = '2026-10';

export const TOKEN_ENDPOINT_PATH = '/apps/oauth/token';
export const JWKS_PATH = '/apps/.well-known/jwks.json';
export const WEBHOOK_KEYS_PATH = '/apps/webhook-keys';

/**
 * The `iss` of every ID token. The same constant on every environment: never
 * use it to tell staging from production (staging tokens fail on production
 * keys).
 */
export const ID_TOKEN_ISSUER = 'https://api.tassyir.io/apps';

/** An ID token lives 60 seconds (`exp - iat`). */
export const ID_TOKEN_MAX_LIFETIME_SECONDS = 60;

/** Clock skew the backend tolerates on `exp`, `nbf` and `iat`. */
export const ID_TOKEN_LEEWAY_SECONDS = 30;

/** How far a webhook's `webhook-timestamp` may be from now (5 minutes). */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

/** How far an app proxy request's `tassyir-proxy-timestamp` may be from now. */
export const PROXY_TOLERANCE_SECONDS = 300;

/**
 * The first field of the text an app proxy request's signature covers
 * (Phase 2 §7): it keeps a proxy signature from verifying as a webhook.
 */
export const PROXY_SIGNATURE_LABEL = 'tassyir-proxy.v1';

/**
 * A rotated refresh token stays usable for 60 seconds after its first
 * rotation; presented later, it revokes its whole family.
 */
export const REFRESH_GRACE_SECONDS = 60;

export const GRANT_TYPE_TOKEN_EXCHANGE =
  'urn:ietf:params:oauth:grant-type:token-exchange';
export const TOKEN_TYPE_ID_TOKEN = 'urn:ietf:params:oauth:token-type:id_token';
export const TOKEN_TYPE_OFFLINE =
  'urn:tassyir:params:oauth:token-type:offline-access-token';
export const TOKEN_TYPE_ONLINE =
  'urn:tassyir:params:oauth:token-type:online-access-token';
