---
title: Errors
description: Every error code the Admin API and the token endpoint answer, and what to do about the common ones.
order: 170
---

# Errors

Every refusal says what failed and how to fix it. Act on the stable `code`,
show or log the `fix`, and quote the `requestId` when you ask Tassyir for
help.

## The shape

The Admin API answers errors as `application/problem+json`:

```json
{
  "type": "https://developers.tassyir.io/errors/permission-denied",
  "title": "Permission denied",
  "status": 403,
  "detail": "You do not have permission: orders:read",
  "code": "PERMISSION_DENIED",
  "permission": "orders:read",
  "fix": "Request the read_orders scope in the app's manifest; it applies once the merchant consents to the new version.",
  "requestId": "a1b2c3"
}
```

| Member      | Meaning                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `code`      | Stable and machine-readable. Act on it, never on `title` or `detail`.                          |
| `fix`       | One sentence saying what to do, when there is one.                                             |
| `status`    | The HTTP status, also the answer's.                                                            |
| `requestId` | Names the request (also the `X-Request-Id` header).                                            |
| `type`      | `https://developers.tassyir.io/errors/<code in kebab case>`: an identifier.                    |
| others      | What was refused: `permission`, `storeId`, `limit`, `retryAfter`, `errors`, `allowedFields`, … |

A 5xx never carries an internal message. The token endpoint is the one
exception to this shape: it answers OAuth errors ([below](#token-endpoint-errors)).

In `@tassyir/app`, an Admin API error is a `TassyirApiError` (`code`, `fix`,
`status`, `requestId`, `retryAfterSeconds`, `problem`), a token endpoint
error a `TassyirOAuthError` (its `code` is `OAUTH_` and the OAuth error in
capitals), and every other refusal a `TassyirError` with a `code` and a
`fix`. App Bridge's errors are listed in
[Embedded pages](embedded-pages.md#errors), the manifest's in
[The manifest](manifest.md#validate-before-you-upload), and those of the
hosted helpers (`HOSTED_PROPS_MISSING`, and `KEYS_UNAVAILABLE`,
`KEYS_NOT_CONFIGURED` and `WEBHOOK_NOT_A_DELIVERY` from
`verifyHostedWebhook`) in [Tassyir Hosting](tassyir-hosting.md#webhooks).

## Common errors and what to do

### `VALIDATION_FAILED`

HTTP 400. A parameter or a field failed validation, or is not one the route
takes. `errors` lists each problem. Fix the request: unknown parameters are
refused on purpose, so a misspelt filter never silently returns everything.

### `INVALID_CURSOR`

HTTP 400. The `cursor` is not this list's, was edited, or was made with other
filters. Send `nextCursor` back unchanged, with the same filters; to change a
filter, start again without a cursor.

### `INVALID_FIELDS`

HTTP 400. `fields` names a field the resource does not have. `allowedFields`
lists the valid names; fields are top-level only.

### `APP_TOKEN_REQUIRED`

HTTP 401. No `Authorization: Bearer` header. Send the installation's access token.

### `APP_TOKEN_INVALID`

HTTP 401. The token is unknown, expired or revoked, or its installation or app is
no longer active. Refresh it once (the SDK does). If the refresh is refused,
the installation was uninstalled, suspended or had its scopes changed: an
embedded app gets a new token on the next page view, a headless app needs a
new install code.

### `HOSTED_CALL_REFUSED`

HTTP 401. A hosted app's call through `ctx.props.TASSYIR` was refused: its
installation is uninstalled or suspended, or no longer runs a released
version. It is also the answer during an `app/uninstalled` or
`business/redact` delivery. Make the call from the request that received
`ctx.props.TASSYIR`; if the installation is active, retry after a short wait
([Tassyir Hosting](tassyir-hosting.md#call-the-admin-api)).

### `PERMISSION_DENIED`

HTTP 403. Your installation lacks the permission the route checks (`permission`).
The `fix` names the scope: add it to the manifest, upload a version, and the
merchant must accept the update. With an online token, the person may lack
it even when your app has it.

### `STORE_SCOPE_FORBIDDEN`

HTTP 460. Your request named a store (`storeId`) outside the stores the
merchant gave your installation. Use one of its stores; list them with
`GET /stores` (`read_stores`).

### `NOT_FOUND`

HTTP 404. No such route, or no resource your token can read under that id: a
resource of another store or business, or a malformed id, reads the same.

### `RATE_LIMITED`

HTTP 429. Your installation's bucket is empty. Wait `Retry-After` seconds, then
retry; spread your calls using the `RateLimit-*` headers.

### `BUSINESS_RATE_LIMITED`

HTTP 429. All the apps of this business together are past its ceiling. Wait
`Retry-After` seconds; other apps are using the room, so slow down.

### `API_BUSY`

HTTP 503. The API was too busy to take your call and did **nothing**. Wait
`Retry-After` (1 second) and send the same call again, a write included.

### `IDEMPOTENCY_KEY_REUSED`

HTTP 422. You reused an `Idempotency-Key` with another method, path, query or
body. Use a new key for a different write.

### `IDEMPOTENCY_KEY_IN_USE`

HTTP 409. A request with the same key is still running. Wait, then retry with the
same key: you will get its answer.

### `IDEMPOTENCY_UNAVAILABLE`

HTTP 503. Tassyir cannot check idempotency keys right now, so the write was not
attempted. Retry after `Retry-After` with the same key.

### `PLAN_FEATURE_REQUIRED`

HTTP 403. The merchant's plan lacks the feature (`feature`), such as stock at a
chosen location. Do without it, or tell the merchant.

### `SUBSCRIPTION_REQUIRED`

HTTP 422. The route needs a plan, and the business has no usable subscription.
Tell the merchant.

### `ORDER_LIMIT_REACHED`

HTTP 403. The order is waiting: it is past the plan's order allowance, and
cannot be confirmed until it unlocks (`orders/updated` with `waiting`).

### `ORDER_NOT_EDITABLE`

HTTP 409. The order is dispatched, delivered or returned (`orderStatus`): it can
no longer be edited, confirmed or cancelled.

### `ORDER_STATUS_CONFLICT`

HTTP 409. The order's status does not allow this move (`orderStatus`,
`requestedStatus`): read the order again and decide.

### `MEDIA_URL_NOT_ALLOWED`

HTTP 400. An image is not on `https://cdn.tassyir.io/` and not already on the
resource (`field`, `url`). Upload it with `POST /images` first
([Products and collections](products-and-collections.md#bring-an-image-onto-the-cdn)).

### `APP_DATA_KEY_NOT_DECLARED`

HTTP 400. Your installation's version does not declare that key for that owner
type. Declare it under `[[data.definitions]]`, upload, and have the merchant
accept the update.

### `INTERNAL_ERROR`

HTTP 500. Tassyir's fault. Retry reads with backoff; retry writes only with the
same `Idempotency-Key`. Quote the `requestId` if it persists.

### `SERVICE_UNAVAILABLE`

HTTP 503. Something Tassyir depends on is down. Retry with backoff, writes with the
same `Idempotency-Key`.

## Hosted apps: the binding's own codes

A hosted app calls the Admin API through `ctx.props.TASSYIR.fetch`
([Tassyir Hosting](tassyir-hosting.md#call-the-admin-api)). The binding checks
each call before it sends it and answers some refusals itself, in the same
problem shape but without a `requestId`: they never reached the API.
`@tassyir/app` lists all nine in `HOSTED_BINDING_ERRORS`, and `hostedAdmin`
throws them as `TassyirApiError`s. Six of them are the API's own codes
(`METHOD_NOT_ALLOWED`, `BAD_REQUEST`, `IDEMPOTENCY_KEY_INVALID`,
`PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, and `SERVICE_UNAVAILABLE` when
the API did not answer within 30 seconds). Three exist only there, so the
API's reference does not list them:

### `HOSTED_PATH_NOT_ALLOWED`

HTTP 400. The call was not to an Admin API path. Call `/apps/<version>/…`
with segments of letters, digits, `_` and `-` only: no other path, no `//`,
no trailing `/`, no percent-encoding and no `;`. The binding also reads
Tassyir's two public key documents, with `GET` at exactly
`/apps/webhook-keys` and `/apps/.well-known/jwks.json` (another method there
is `METHOD_NOT_ALLOWED`).

### `RESPONSE_TOO_LARGE`

HTTP 502. The API's answer was larger than a hosted app may receive (8 MiB).
Ask for less: a smaller `limit`, or `?fields=` with only the fields you read.

### `TASSYIR_BINDING_NOT_AVAILABLE`

HTTP 503. Calls to the Admin API from a hosted app are not available right
now; nothing was sent. Try again later.

<!-- generated:error-reference: npm run guides:errors writes everything up to the end marker -->

## Every Admin API code

Generated from the OpenAPI document of API version `2026-10` that `@tassyir/app` is typed from (41 operations under `/apps/2026-10/`). An operation lists every code it can answer, per status, in that document; a status fallback (the code of a refusal that carries no more specific one) is in its error catalogue and may come from any operation.

| Code                                    | HTTP     | Answered by                                                                                                                           |
| --------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `API_BUSY`                              | 503      | every operation                                                                                                                       |
| `APP_DATA_KEY_NOT_DECLARED`             | 400      | `PUT /data/{ownerType}/{ownerId}/{key}`                                                                                               |
| `APP_DATA_LIMIT_REACHED`                | 409      | `PUT /data/{ownerType}/{ownerId}/{key}`                                                                                               |
| `APP_DATA_VALUE_INVALID`                | 400      | `PUT /data/{ownerType}/{ownerId}/{key}`                                                                                               |
| `APP_DATA_VALUE_TOO_LARGE`              | 400      | `PUT /data/{ownerType}/{ownerId}/{key}`                                                                                               |
| `APP_TOKEN_INVALID`                     | 401      | every operation                                                                                                                       |
| `APP_TOKEN_REQUIRED`                    | 401      | every operation                                                                                                                       |
| `BAD_REQUEST`                           | 400      | 16 operations                                                                                                                         |
| `BRAND_NOT_FOUND`                       | 400      | `PATCH /products/{id}`, `POST /products`                                                                                              |
| `BULK_EXPORTS_NOT_CONFIGURED`           | 503      | `POST /bulk/exports`                                                                                                                  |
| `BULK_EXPORT_IN_PROGRESS`               | 409      | `POST /bulk/exports`                                                                                                                  |
| `BULK_EXPORT_RATE_LIMITED`              | 429      | `POST /bulk/exports`                                                                                                                  |
| `BUSINESS_RATE_LIMITED`                 | 429      | every operation                                                                                                                       |
| `CANCEL_NOTE_REQUIRED`                  | 400      | `POST /orders/{id}/cancel`                                                                                                            |
| `CANCEL_REASON_INVALID`                 | 400      | `POST /orders/{id}/cancel`                                                                                                            |
| `COLLECTION_CONDITIONAL_LIMIT`          | 409      | `PATCH /collections/{id}`, `POST /collections`                                                                                        |
| `COLLECTION_DEPTH_LIMIT`                | 409      | `PATCH /collections/{id}`, `POST /collections`                                                                                        |
| `COLLECTION_NOT_FOUND`                  | 400      | `POST /products`                                                                                                                      |
| `COLLECTION_PARENT_CYCLE`               | 409      | `PATCH /collections/{id}`                                                                                                             |
| `COLLECTION_PARENT_NOT_FOUND`           | 404      | `PATCH /collections/{id}`, `POST /collections`                                                                                        |
| `COLLECTION_PRODUCT_WRONG_STORE`        | 400      | `PATCH /collections/{id}/products`                                                                                                    |
| `COLLECTION_RULE_INVALID`               | 400      | `PATCH /collections/{id}`, `POST /collections`                                                                                        |
| `CONFLICT`                              | 409      | any operation, as a fallback                                                                                                          |
| `DELIVERY_SPEED_UNAVAILABLE`            | 400      | `PATCH /orders/{id}`, `POST /orders`                                                                                                  |
| `DELIVERY_SPEED_UNSUPPORTED`            | 400      | `PATCH /orders/{id}`                                                                                                                  |
| `DEV_STORE_ORDER_LIMIT_REACHED`         | 429      | `POST /orders`                                                                                                                        |
| `FORBIDDEN`                             | 403      | `GET /inventory-levels`, `GET /inventory-levels/{id}`, `POST /inventory-levels/{id}/adjust`, `POST /orders`                           |
| `HOSTED_CALL_REFUSED`                   | 401      | every operation                                                                                                                       |
| `HTML_NOT_ALLOWED`                      | 400      | `PATCH /collections/{id}`, `PATCH /products/{id}`, `POST /collections`, `POST /products`                                              |
| `IDEMPOTENCY_KEY_INVALID`               | 400      | 18 operations                                                                                                                         |
| `IDEMPOTENCY_KEY_IN_USE`                | 409      | 18 operations                                                                                                                         |
| `IDEMPOTENCY_KEY_REUSED`                | 422      | 18 operations                                                                                                                         |
| `IDEMPOTENCY_UNAVAILABLE`               | 503      | 18 operations                                                                                                                         |
| `IMAGE_FETCH_FAILED`                    | 400      | `POST /images`                                                                                                                        |
| `IMAGE_QUOTA_REACHED`                   | 429      | `POST /images`                                                                                                                        |
| `IMAGE_TOO_LARGE`                       | 400      | `POST /images`                                                                                                                        |
| `IMAGE_TYPE_NOT_ALLOWED`                | 400      | `POST /images`                                                                                                                        |
| `IMAGE_URL_NOT_ALLOWED`                 | 400      | `POST /images`                                                                                                                        |
| `INSUFFICIENT_AT_LOCATION`              | 409      | `POST /inventory-levels/{id}/adjust`                                                                                                  |
| `INTERNAL_ERROR`                        | 500      | every operation                                                                                                                       |
| `INVALID_CURSOR`                        | 400      | 10 operations                                                                                                                         |
| `INVALID_FIELDS`                        | 400      | 37 operations                                                                                                                         |
| `LOCATION_NOT_FOUND`                    | 400, 404 | `POST /inventory-levels/{id}/adjust`                                                                                                  |
| `MEDIA_URL_NOT_ALLOWED`                 | 400      | `PATCH /collections/{id}`, `PATCH /products/{id}`, `PATCH /products/{id}/variants/{variantId}`, `POST /collections`, `POST /products` |
| `METHOD_NOT_ALLOWED`                    | 405      | any operation, as a fallback                                                                                                          |
| `NOT_FOUND`                             | 404      | 28 operations                                                                                                                         |
| `ORDER_DUPLICATE`                       | 409      | `POST /orders`                                                                                                                        |
| `ORDER_LIMIT_REACHED`                   | 403      | `POST /orders/{id}/confirm`                                                                                                           |
| `ORDER_NOT_EDITABLE`                    | 409      | `PATCH /orders/{id}`, `POST /orders/{id}/cancel`, `POST /orders/{id}/confirm`, `POST /orders/{id}/schedule`                           |
| `ORDER_PRICING_LOCKED`                  | 400      | `PATCH /orders/{id}`                                                                                                                  |
| `ORDER_STATUS_CONFLICT`                 | 409      | `POST /orders/{id}/cancel`, `POST /orders/{id}/confirm`, `POST /orders/{id}/schedule`                                                 |
| `PAYLOAD_TOO_LARGE`                     | 413      | 15 operations                                                                                                                         |
| `PERMISSION_DENIED`                     | 403      | 40 operations                                                                                                                         |
| `PLAN_FEATURE_REQUIRED`                 | 403      | `GET /inventory-levels`, `GET /inventory-levels/{id}`, `POST /inventory-levels/{id}/adjust`                                           |
| `PRODUCT_DEFAULT_VARIANT`               | 409      | `PATCH /products/{id}/variants/{variantId}`                                                                                           |
| `PRODUCT_OPTIONS_REQUIRE_VARIANTS`      | 400      | `PATCH /products/{id}`, `POST /products`                                                                                              |
| `PRODUCT_OPTION_DUPLICATE_NAME`         | 400      | `PATCH /products/{id}`, `POST /products`                                                                                              |
| `PRODUCT_OPTION_DUPLICATE_VALUE`        | 400      | `PATCH /products/{id}`, `POST /products`                                                                                              |
| `PRODUCT_OPTION_NOT_FOUND`              | 400      | `PATCH /products/{id}`, `POST /products`                                                                                              |
| `PRODUCT_OPTION_NO_VALUES`              | 400      | `PATCH /products/{id}`, `POST /products`                                                                                              |
| `PRODUCT_OPTION_VALUE_EMPTY`            | 400      | `PATCH /products/{id}`                                                                                                                |
| `PRODUCT_OPTION_VALUE_NOT_FOUND`        | 400      | `PATCH /products/{id}`, `POST /products`                                                                                              |
| `PRODUCT_SLUG_INVALID`                  | 400      | `PATCH /products/{id}`, `POST /products`                                                                                              |
| `PRODUCT_SLUG_TAKEN`                    | 409      | `PATCH /products/{id}`, `POST /products`                                                                                              |
| `PRODUCT_VARIANT_COMBINATION_MISMATCH`  | 400      | `PATCH /products/{id}`, `POST /products`                                                                                              |
| `PRODUCT_VARIANT_COUNT_MISMATCH`        | 400      | `PATCH /products/{id}`, `PATCH /products/{id}/variants/{variantId}`, `POST /products`                                                 |
| `PRODUCT_VARIANT_DUPLICATE_COMBINATION` | 400      | `PATCH /products/{id}`, `POST /products`                                                                                              |
| `PRODUCT_VARIANT_DUPLICATE_OPTION`      | 400      | `PATCH /products/{id}`, `POST /products`                                                                                              |
| `PRODUCT_VARIANT_INVALID_VALUE`         | 400      | `PATCH /products/{id}`, `POST /products`                                                                                              |
| `PRODUCT_VARIANT_MISSING_COMBINATIONS`  | 400      | `PATCH /products/{id}`, `PATCH /products/{id}/variants/{variantId}`, `POST /products`                                                 |
| `PRODUCT_VARIANT_MISSING_OPTION`        | 400      | `PATCH /products/{id}`, `POST /products`                                                                                              |
| `PRODUCT_VARIANT_SELECTED_COUNT`        | 400      | `PATCH /products/{id}`, `POST /products`                                                                                              |
| `PRODUCT_VARIANT_UNKNOWN_OPTION`        | 400      | `PATCH /products/{id}`, `POST /products`                                                                                              |
| `PRODUCT_WRITE_TIMEOUT`                 | 400      | `PATCH /products/{id}`, `PATCH /products/{id}/variants/{variantId}`, `POST /products`                                                 |
| `RATE_LIMITED`                          | 429      | every operation                                                                                                                       |
| `REQUEST_FAILED`                        | 4xx      | any operation, as a fallback                                                                                                          |
| `SERVICE_UNAVAILABLE`                   | 503      | every operation                                                                                                                       |
| `STORE_REQUIRED`                        | 400      | `POST /orders`                                                                                                                        |
| `STORE_SCOPE_FORBIDDEN`                 | 460      | 15 operations                                                                                                                         |
| `SUBSCRIPTION_REQUIRED`                 | 422      | `GET /inventory-levels`, `GET /inventory-levels/{id}`, `POST /inventory-levels/{id}/adjust`                                           |
| `UNAUTHORIZED`                          | 401      | any operation, as a fallback                                                                                                          |
| `UNPROCESSABLE_ENTITY`                  | 422      | any operation, as a fallback                                                                                                          |
| `UNSUPPORTED_MEDIA_TYPE`                | 415      | 15 operations                                                                                                                         |
| `VALIDATION_FAILED`                     | 400      | 40 operations                                                                                                                         |

## Token endpoint errors

`POST /apps/oauth/token` answers OAuth errors, `{ "error": "…", "error_description": "…" }`, never problem+json.

| `error`                   | HTTP     |
| ------------------------- | -------- |
| `invalid_client`          | 401      |
| `invalid_grant`           | 400      |
| `invalid_request`         | 400, 413 |
| `slow_down`               | 429      |
| `temporarily_unavailable` | 503      |
| `unauthorized_client`     | 400      |
| `unsupported_grant_type`  | 400      |

<!-- end:error-reference -->
