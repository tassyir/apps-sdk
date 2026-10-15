// Types of the developer API (`developer/*`), derived from the types
// generated from its OpenAPI document (src/generated/developer-api.ts,
// `npm run openapi:update -w tassyir`). Nothing here exists at run time.

import type {
  components,
  operations,
  paths,
} from './generated/developer-api.js';

/** The raw generated types, for anything the aliases below do not name. */
export type {
  components as DeveloperApiComponents,
  operations as DeveloperApiOperations,
  paths as DeveloperApiPaths,
};

type Schemas = components['schemas'];

// ── Sign-in (RFC 8628) ───────────────────────────────────────────────────────

/** `POST /developer/cli/device-code` (RFC 8628 §3.2). */
export type DeviceCodeResponse = Schemas['DeviceAuthorizationResponse'];
/** What `POST /developer/cli/device-code` takes (form-encoded). */
export type DeviceCodeRequest = Schemas['DeviceAuthorizationRequest'];
/** `POST /developer/cli/token`, once approved (RFC 6749 §5.1 + three fields). */
export type DeveloperTokenResponse = Schemas['DeveloperTokenResponse'];
/** What `POST /developer/cli/token` takes (form-encoded). */
export type DeveloperTokenRequest = Schemas['DeviceTokenRequest'];
/** The device grant's refusals (RFC 8628 §3.5, RFC 6749 §5.2). */
export type DeviceGrantError = Schemas['OAuthError']['error'];
/** One CLI token of the caller (`GET developer/cli/tokens`). */
export type CliToken = Schemas['CliToken'];

// ── Account, apps, versions, secrets ─────────────────────────────────────────

export type DeveloperAccount = Schemas['DeveloperAccount'];
/** `id` is numeric: webhook envelopes name it (`appId`, `TASSYIR_APP_ID`). */
export type DeveloperApp = Schemas['DeveloperApp'];
export type CreateAppBody = Schemas['CreateDeveloperAppInput'];
export type AppVersion = Schemas['AppVersion'];
/** A version with its normalised manifest (what an upload answers). */
export type AppVersionDetail = Schemas['AppVersionDetail'];
export type AppCredential = Schemas['AppCredential'];
export type CredentialState = AppCredential['state'];
/** `POST developer/apps/:appId/credentials`: the secret, once. */
export type MintCredentialResponse = Schemas['IssuedSecretResponse'];
export type MintedCredential = MintCredentialResponse['data'];

// ── Dev stores ───────────────────────────────────────────────────────────────

export type DevStore = Schemas['DevStore'];
export type CreatedDevStore = Schemas['CreatedDevStore'];
export type CreateDevStoreBody = Schemas['CreateDevStoreInput'];

// ── The webhook console ──────────────────────────────────────────────────────

export type Installation = Schemas['DeveloperInstallation'];
export type InstallationFilters = NonNullable<
  operations['listAppInstallations']['parameters']['query']
>;
export type Delivery = Schemas['WebhookDelivery'];
export type DeliveryStatus = Delivery['status'];
export type DeliveryFilters = NonNullable<
  operations['listWebhookDeliveries']['parameters']['query']
>;
/** The webhook topics the console can send and filter on. */
export type WebhookTopic = Schemas['SendWebhookTestInput']['topic'];
export type ReplayResponse = Schemas['WebhookReplayResponse'];
export type ReplayOutcome = ReplayResponse['outcome'];
/** `POST …/webhooks/test`: what the endpoint answered a test event. */
export type TestDelivery = Schemas['WebhookTestResult'];

/** A paged list: pass `nextCursor` back as `cursor`; null on the last page. */
export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

// ── Refusals ─────────────────────────────────────────────────────────────────

/**
 * Every body a refusal of the developer API can have. Only `DeveloperError`
 * carries a `code`: the ValidationPipe's 400 (`ValidationError`), the
 * dashboard session guard's 401 (`HttpError`) and the rate limiter's 429
 * (`ThrottlerError`, a bare JSON string) do not, so the client names them by
 * status. The two sign-in routes answer OAuth's `{ error, error_description }`.
 */
export type DeveloperApiErrorBody =
  | Schemas['DeveloperError']
  | Schemas['ValidationError']
  | Schemas['HttpError']
  | Schemas['ThrottlerError']
  | Schemas['ServerError'];
export type OAuthErrorBody = Schemas['OAuthError'];
