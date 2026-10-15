---
'@tassyir/app': patch
---

The Admin API types follow the API's OpenAPI document at backend `fd60d953`, which adds bulk exports (`POST /bulk/exports`, `GET /bulk/exports`, `GET /bulk/exports/{id}`: one JSON Lines file holding a list of orders, products or customers, downloaded from a URL valid 7 days) and the `bulk/finished` webhook. With retries on, 429 `BULK_EXPORT_RATE_LIMITED` waits `Retry-After` like the other rate limits (a wait longer than `maxDelayMs` throws at once), and 503 `BULK_EXPORTS_NOT_CONFIGURED` and 409 `BULK_EXPORT_IN_PROGRESS` are never retried.
