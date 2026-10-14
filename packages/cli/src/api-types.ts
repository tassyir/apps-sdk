// The developer API's shapes, written from the backend's reference
// (tassyir/backend docs/api/apps/developer-cli-auth.md, developer.md,
// dev-stores.md, developer-webhooks.md). The developer API has no OpenAPI
// document yet (the Admin API's is AP-B1.12); when it gets one, generate
// these instead, as @tassyir/app does.

/** `POST /developer/cli/device-code` (RFC 8628 §3.2). */
export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

/** `POST /developer/cli/token`, once approved (RFC 6749 §5.1 + three fields). */
export interface DeveloperTokenResponse {
  access_token: string;
  token_type: string;
  /** The idle expiry (90 days); every use extends it. */
  expires_in: number;
  scope: string;
  token_id: string;
  user_id: string;
  email: string;
}

/** The device grant's refusals (RFC 8628 §3.5, RFC 6749 §5.2). */
export type DeviceGrantError =
  | 'authorization_pending'
  | 'slow_down'
  | 'access_denied'
  | 'expired_token'
  | 'invalid_grant'
  | 'invalid_request'
  | 'invalid_client'
  | 'unsupported_grant_type';

/** One CLI token of the caller (`GET developer/cli/tokens`). */
export interface CliToken {
  id: string;
  prefix: string;
  client: { id: string; name: string; version: string | null };
  deviceName: string | null;
  country: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
  /** The token the request was made with. */
  current: boolean;
}

export interface DeveloperAccount {
  id: string;
  displayName: string;
  supportEmail: string;
  websiteUrl: string | null;
  status: 'active' | 'suspended';
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeveloperApp {
  /** The numeric id: webhook envelopes name it (`appId`, `TASSYIR_APP_ID`). */
  id: string;
  handle: string;
  clientId: string;
  nameEn: string;
  nameAr: string;
  distribution: string;
  customBusinessId: string | null;
  hostingMode: 'external' | 'tassyir';
  status: 'draft' | 'active' | 'suspended' | 'archived';
  suspendedReason: string | null;
  currentVersion: number | null;
  installCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAppBody {
  handle: string;
  nameEn: string;
  nameAr?: string;
  hostingMode?: 'external' | 'tassyir';
  customBusinessId?: string;
}

export interface AppVersion {
  id: string;
  version: number;
  apiVersion: string;
  scopes: string[];
  optionalScopes: string[];
  webhookTopics: string[];
  allowedHosts: string[];
  reviewState: string;
  current: boolean;
  releasedAt: string | null;
  createdAt: string;
  manifest?: Record<string, unknown>;
}

export type CredentialState = 'active' | 'expiring' | 'expired' | 'revoked';

export interface AppCredential {
  id: string;
  secretPrefix: string;
  state: CredentialState;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

/** `POST developer/apps/:appId/credentials`: the secret, once. */
export interface MintedCredential extends AppCredential {
  clientId: string;
  secret: string;
}

export interface MintCredentialResponse {
  data: MintedCredential;
  /** The secrets still live after this one, each `expiring`. */
  rotated: AppCredential[];
}

export interface DevStore {
  id: string;
  name: string;
  createdAt: string;
  dashboardPath: string;
}

export interface CreatedDevStore extends DevStore {
  store: { id: string; subdomain: string } | null;
  seed: Record<string, number> | null;
  seedError: string | null;
}

export interface Installation {
  id: string;
  businessId: string;
  status: 'active' | 'suspended' | 'uninstalled';
  appVersionId: string;
  version: number | null;
  grantedScopes: string[];
  storeAccess: string;
  installedAt: string;
  uninstalledAt: string | null;
  webhooks: {
    state: 'ok' | 'failing' | 'disabled';
    failingSince: string | null;
    disabledAt: string | null;
  };
}

export type DeliveryStatus = 'pending' | 'delivered' | 'failed' | 'skipped';

export interface Delivery {
  id: string;
  webhookId: string;
  eventId: string;
  installationId: string;
  businessId: string;
  topic: string;
  status: DeliveryStatus;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  errorClass: string | null;
  lastDurationMs: number | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface DeliveryFilters {
  installationId?: string;
  topic?: string;
  status?: DeliveryStatus;
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
}

export type ReplayOutcome =
  'delivered' | 'failed' | 'skipped' | 'paused' | 'raced' | 'not_pending';

export interface ReplayResponse {
  data: Delivery;
  outcome: ReplayOutcome;
}

/** `POST …/webhooks/test`: what the endpoint answered a test event. */
export interface TestDelivery {
  webhookId: string;
  installationId: string;
  topic: string;
  status: 'delivered' | 'failed';
  statusCode: number | null;
  error: string | null;
  errorClass: string | null;
  durationMs: number | null;
  sentAt: string;
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}
