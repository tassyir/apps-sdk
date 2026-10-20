---
'@tassyir/app': minor
---

Offers, read-only: `admin.get('/offers')`, `admin.paginate('/offers', { query: { status, kind, method, storeId } })` and `admin.get('/offers/{id}')` are typed (scope `read_offers`), the `Offer` type is exported, and `verifyWebhook` narrows `offers/created` and `offers/updated` (an `Offer`) and `offers/deleted` (its `id` only). An offer's `kind` is an open string: ignore one you do not know. The Admin API types follow the API's OpenAPI document at backend `5cfe4ee3`; no new error code.
