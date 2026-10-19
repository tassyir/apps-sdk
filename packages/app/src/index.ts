// @tassyir/app: the server side of a Tassyir app (plan §3.4–§3.8), and the
// app proxy's request check (Phase 2 §7, `verifyProxyRequest`).
//
// It runs on Node 22 and on Workers-like runtimes: the only platform APIs it
// uses are fetch and WebCrypto. On Tassyir Hosting (AP-B1.14–B1.16) a hosted
// app's Worker reads its capabilities from `ctx.props` (`readHostedProps`),
// calls the Admin API through `ctx.props.TASSYIR` with no token
// (`hostedAdmin`) and checks its webhooks with `verifyHostedWebhook`.

export { createTassyirApp, TassyirApp } from './app.js';
export type { IdTokenSession, TassyirAppOptions } from './app.js';

export {
  ADMIN_API_VERSION,
  ID_TOKEN_ISSUER,
  ID_TOKEN_LEEWAY_SECONDS,
  PROXY_SIGNATURE_LABEL,
  PROXY_TOLERANCE_SECONDS,
  REFRESH_GRACE_SECONDS,
  TASSYIR_API_ORIGIN,
  WEBHOOK_TOLERANCE_SECONDS,
} from './constants.js';

export {
  isTassyirError,
  TassyirApiError,
  TassyirError,
  TassyirOAuthError,
  TassyirTokenError,
  TassyirVerificationError,
} from './errors.js';
export type {
  OAuthErrorCode,
  Problem,
  RateLimitInfo,
  TassyirErrorOptions,
  TokenErrorCode,
  VerificationErrorCode,
} from './errors.js';

export type { VerificationKey } from './ed25519.js';
export type { FetchLike } from './http.js';

export { IdTokenKeys, WebhookKeys } from './keys.js';
export type { IdTokenJwk, KeySourceOptions, WebhookKeyEntry } from './keys.js';

export { verifyIdToken } from './id-token.js';
export type {
  IdTokenClaims,
  VerifiedIdToken,
  VerifyIdTokenOptions,
} from './id-token.js';

export { verifyWebhook, verifyWebhookRequest } from './webhooks.js';
export type {
  HeadersInput,
  InstallationCheck,
  RawBody,
  VerifiedWebhook,
  VerifyWebhookOptions,
  WebhookDelivery,
} from './webhooks.js';

export {
  proxySignatureContent,
  verifyProxy,
  verifyProxyRequest,
} from './proxy.js';
export type {
  ProxyInstallationCheck,
  ProxyRequest,
  VerifiedProxyRequest,
  VerifyProxyOptions,
} from './proxy.js';

export { TassyirOAuthClient } from './oauth.js';
export type { OAuthClientOptions, TokenSet } from './oauth.js';

export { MemoryTokenStore } from './token-store.js';
export type { TokenStore } from './token-store.js';

export { TokenManager } from './token-manager.js';
export type {
  GetAccessTokenOptions,
  RefreshLock,
  TokenManagerOptions,
} from './token-manager.js';

export {
  HOSTED_BINDING_ERRORS,
  hostedAdmin,
  hostedWebhookKeys,
  readHostedProps,
  verifyHostedWebhook,
} from './hosted.js';
export type {
  HostedAdminOptions,
  HostedBindingErrorCode,
  HostedInstallation,
  HostedProps,
  HostedSqlBinding,
  HostedSqlResult,
  HostedSqlStatement,
  HostedSqlValue,
  HostedStorage,
  HostedViewer,
  TassyirBinding,
  VerifyHostedWebhookOptions,
} from './hosted.js';

export { AdminClient } from './admin-client.js';
export type {
  AccessTokenProvider,
  AdminClientOptions,
  ApiResponse,
  ResponseInfo,
  RetryOptions,
} from './admin-client.js';

export type {
  AdminApiComponents,
  AdminApiErrorCode,
  AdminApiOperations,
  AdminApiPaths,
  AdminApiRawPaths,
  AdminApiWebhooks,
  AdminOperation,
  AdminPath,
  AppData,
  Business,
  CancelReason,
  Checkout,
  Collection,
  Customer,
  DeliveryAgent,
  DeliveryFeeGroup,
  Discount,
  ErrorCodeOf,
  FieldName,
  HttpMethod,
  Installation,
  InventoryLevel,
  ListItem,
  ListPath,
  Offer,
  Order,
  OrderComment,
  OrderItem,
  PathsWithMethod,
  Product,
  ProductVariant,
  RequestArgs,
  RequestOptions,
  ResponseBody,
  Store,
  WebhookEvent,
  WebhookEventOf,
  WebhookTopic,
} from './admin-types.js';
