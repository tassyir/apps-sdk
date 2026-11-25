---
'@tassyir/app': minor
'@tassyir/dev-mcp': patch
'tassyir': patch
---

Re-vendor the Admin OpenAPI at backend 7792ed7b. `POST /orders` now answers a stock shortfall with 400 `OUT_OF_STOCK` ("Not enough stock") instead of `BAD_REQUEST`: `details` carries `item`, `requested`, `available` and `lineCount`, and `lines` names each short item (`productId`, `variantId`, `productName`, `variantName`, `label`, `requested`, `available`).

The same document brings what the backend shipped since d2fa3e63, now typed for `admin.request`: the reads `GET /business/setup`, `/orders/stats`, `/tracking`, `/returns`, `/custom-statuses`, `/analytics/{overview,variants,marketing,utm}`, `/finance/{summary,transactions,products}` and `/expenses`; `pauseClashing` on offer writes; and the codes `OFFER_CLASH`, `PRODUCT_SKU_TAKEN`, `PRODUCT_SKU_DUPLICATE_IN_PRODUCT`, `INVALID_DATE_RANGE`, `REPORT_BUSY`, `REPORT_QUERY_TIMEOUT` and `STORE_SCOPE_RESTRICTED_SURFACE`, each with its page under developers.tassyir.io/errors.

`AdminApiErrorCode` gains eight members: a handler that maps every code exhaustively (a `Record<AdminApiErrorCode, …>` or a `switch` with a `never` check) must add them.
