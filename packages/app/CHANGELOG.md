# @tassyir/app

## 0.4.0

### Minor Changes

- d978cfe: Offers, read-only: `admin.get('/offers')`, `admin.paginate('/offers', { query: { status, kind, method, storeId } })` and `admin.get('/offers/{id}')` are typed (scope `read_offers`), the `Offer` type is exported, and `verifyWebhook` narrows `offers/created` and `offers/updated` (an `Offer`) and `offers/deleted` (its `id` only). An offer's `kind` is an open string: ignore one you do not know. The Admin API types follow the API's OpenAPI document at backend `5cfe4ee3`; no new error code.
- 0efc04c: Offers, write side (scope `write_offers`): `admin.post('/offers')`, `admin.patch('/offers/{id}')`, `admin.delete('/offers/{id}')`, `/publish`, `/pause` and `/resume`, the codes routes (including `/codes/bulk`) and `admin.paginate` over `/offers/{id}/codes` and `/offers/{id}/redemptions` are typed. New exports: `addOfferCodes` (adds any number of codes, 250 per call, and gathers the answers) with `OFFER_CODES_BULK_MAX`, the types `OfferKind`, `CreateOfferInput`, `UpdateOfferInput`, `OfferTargetInput`, `OfferCode`, `OfferCodeInput`, `OfferCodesBulkResult`, `OfferRedemption` and `OfferRemoval`, and the declarative rule of an app-owned offer: `AppOfferConfig`, `AppOfferRule`, `AppOfferCondition`, `AppOfferLeaf`, `AppOfferAction`, `AppOfferClass`, `AppOfferChannel`, `AppOfferIds` and `APP_OFFER_RULE_LIMITS`. `POST /orders` takes `codes` and answers `rejectedCodes`, so `ResponseBody<'get', '/orders/{id}'>` now carries an optional `rejectedCodes` next to `data`. The body of `publish`, `pause` and `resume` is optional, and `RequestBody` / `RequestOptions` now tell an optional body from a required one. An `Offer` carries the Phase 2 blocks `orderDiscount`, `bxgy`, `addon` and `appRule` (types `OfferOrderDiscount`, `OfferBxgy`, `OfferAddon`, `OfferAppRule`, `OfferQuantity`). New problem codes, typed per operation: `OFFER_NOT_OWNED`, `OFFER_INVALID`, `OFFER_KIND_NOT_AVAILABLE`, `OFFER_KIND_IMMUTABLE`, `OFFER_TARGET_NOT_FOUND`, `OFFER_TARGET_OUTSIDE_STORE`, `OFFER_CODE_INVALID`, `OFFER_CODE_TAKEN`, `OFFER_CODE_NOT_FOUND`, `OFFER_STORE_NOT_FOUND`, `OFFER_VERSION_CONFLICT`, `OFFER_ARCHIVED`, `OFFER_NOT_PUBLISHED`, `OFFER_ENDED`, `OFFER_NOT_CODE_METHOD` and `OFFER_LIMIT_REACHED`. The Admin API types follow the API's OpenAPI document at backend `1c852025`.
- 304c3d1: Order money, typed: an `Order` carries `subtotal`, `discountTotal` and `discounts` (one entry per title, code, class and source), and each order line `originalPrice`, `discountAmount` and `discounts`, so `total = subtotal − discountTotal + shippingPrice` and a line's `unitPrice`/`totalPrice` are net of the offers. The `Discount` and `OrderItem` types are exported, `?fields=` accepts the three new names, and `orders/*` webhook bodies carry the same fields: `verifyWebhook` narrows them, and `changed` on `orders/updated` can now name `subtotal`, `discountTotal` and `discounts`, so keep a default branch if you switch over it. Additive inside `2026-10`; the Admin API types follow the API's OpenAPI document at backend `505f4ac4`; no new scope or error code.

## 0.3.0

### Minor Changes

- 0b5430e: `verifyProxyRequest(request, { keys, installationId })` and `verifyProxy({ method, url, headers, body }, …)` check a request the Tassyir app proxy forwards (not live yet: the proxy opens after the marketplace): the Ed25519 `v1a` signature by Tassyir's webhook keys over `tassyir-proxy.v1.{timestamp}.{METHOD}.{path+query}.{sha256 hex of the body}.{installationId}.{storeId}`, the timestamp within 5 minutes, and the installation by your check (required). It answers the signed `installationId`, `storeId`, `method` and `path`, and the unsigned context (`businessId`, `storeHost`, `country`, `locale`) apart. New `PROXY_*` verification codes, `PROXY_SIGNATURE_LABEL`, `PROXY_TOLERANCE_SECONDS` and `proxySignatureContent`.

## 0.2.0

### Minor Changes

- acb578f: Tassyir Hosting: `readHostedProps(ctx)` reads and checks `ctx.props` (`installation`, `viewer`, `STORAGE`, `TASSYIR`; `HOSTED_PROPS_MISSING` elsewhere), `hostedAdmin(props)` is the typed Admin API client sending its requests through `ctx.props.TASSYIR` with no token, `verifyHostedWebhook(request, props)` checks a delivery by every rule of `verifyWebhook` (unchanged), the signature verified with Tassyir's keys read through `ctx.props.TASSYIR` (`hostedWebhookKeys(props)`, per request; it never skips the signature: unreadable keys are `KEYS_UNAVAILABLE`), the envelope's installation, business and app taken from `ctx.props`, and a request with a viewer refused. `HOSTED_BINDING_ERRORS` lists the binding's own problem codes; the client never retries `RESPONSE_TOO_LARGE` or `TASSYIR_BINDING_NOT_AVAILABLE`. New verification code `WEBHOOK_NOT_A_DELIVERY`.

### Patch Changes

- 86ab80c: The Admin API types follow the API's OpenAPI document at backend `46a49b6b`: a 401 can carry `HOSTED_CALL_REFUSED` (a hosted app's call through `ctx.props.TASSYIR` that can no longer run as its installation), and `WWW-Authenticate` names the `Tassyir-Hosted` challenge.

## 0.1.2

### Patch Changes

- 444dd42: The Admin API types follow the API's OpenAPI document at backend `08da6223`: `GET /business` answers `devStore` (a boolean, also a `?fields=` name), true when the installation is on a dev store, a test business whose orders are not real.
- 2b24f25: The Admin API types follow the API's OpenAPI document at backend `e6f930db`: every problem carries `docs`, the page of its code on developers.tassyir.io (the same URL as `type`), every code has a `fix` sentence, and the descriptions are written for app developers.

## 0.1.1

### Patch Changes

- cc6d0c2: The Admin API types follow the API's OpenAPI document at backend `fd60d953`, which adds bulk exports (`POST /bulk/exports`, `GET /bulk/exports`, `GET /bulk/exports/{id}`: one JSON Lines file of an orders, products or customers list, downloaded from a URL valid 7 days) and the `bulk/finished` webhook. With retries on, 429 `BULK_EXPORT_RATE_LIMITED` waits `Retry-After` like the other rate limits (a wait longer than `maxDelayMs` throws at once), and 503 `BULK_EXPORTS_NOT_CONFIGURED` and 409 `BULK_EXPORT_IN_PROGRESS` are never retried.

## 0.1.0

### Minor Changes

- 72c0eeb: First release: token exchange (ID token, install code) and refresh with a token store and refresh locking, ID-token and webhook (`v1a`) verification on WebCrypto, and an Admin API client typed from the 2026-10 OpenAPI document.

### Patch Changes

- cb4b0cf: The Admin API types follow the API's OpenAPI document at backend `a70094c2`: every operation can now answer 429 `BUSINESS_RATE_LIMITED` (the ceiling all of a business's apps share) and 503 `API_BUSY` (the API process was too busy and did nothing). With retries on, the client waits `Retry-After` and retries both, writes included, as it does `RATE_LIMITED`.
- 3b4353f: The Admin API types follow the API's OpenAPI document at backend `283f2b6b`, which adds `POST /images` (re-host an image by URL on Tassyir's CDN, scope `write_products`) and its codes. With retries on, the client never retries 429 `IMAGE_QUOTA_REACHED`: a daily quota is not worth retrying, so it throws at once and the error's `problem` names the quota (`per`, `window`: `day` or `minute`, `limit`, `retryAfter`).
