# @tassyir/app

## 0.1.1

### Patch Changes

- cc6d0c2: The Admin API types follow the API's OpenAPI document at backend `fd60d953`, which adds bulk exports (`POST /bulk/exports`, `GET /bulk/exports`, `GET /bulk/exports/{id}`: one JSON Lines file of an orders, products or customers list, downloaded from a URL valid 7 days) and the `bulk/finished` webhook. With retries on, 429 `BULK_EXPORT_RATE_LIMITED` waits `Retry-After` like the other rate limits (a wait longer than `maxDelayMs` throws at once), and 503 `BULK_EXPORTS_NOT_CONFIGURED` and 409 `BULK_EXPORT_IN_PROGRESS` are never retried.

## 0.1.0

### Minor Changes

- 72c0eeb: First release: token exchange (ID token, install code) and refresh with a token store and refresh locking, ID-token and webhook (`v1a`) verification on WebCrypto, and an Admin API client typed from the 2026-10 OpenAPI document.

### Patch Changes

- cb4b0cf: The Admin API types follow the API's OpenAPI document at backend `a70094c2`: every operation can now answer 429 `BUSINESS_RATE_LIMITED` (the ceiling all of a business's apps share) and 503 `API_BUSY` (the API process was too busy and did nothing). With retries on, the client waits `Retry-After` and retries both, writes included, as it does `RATE_LIMITED`.
- 3b4353f: The Admin API types follow the API's OpenAPI document at backend `283f2b6b`, which adds `POST /images` (re-host an image by URL on Tassyir's CDN, scope `write_products`) and its codes. With retries on, the client never retries 429 `IMAGE_QUOTA_REACHED`: a daily quota is not worth retrying, so it throws at once and the error's `problem` names the quota (`per`, `window`: `day` or `minute`, `limit`, `retryAfter`).
