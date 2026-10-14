---
'@tassyir/app': patch
---

The Admin API types follow the API's OpenAPI document at backend `a70094c2`: every operation can now answer 429 `BUSINESS_RATE_LIMITED` (the ceiling all of a business's apps share) and 503 `API_BUSY` (the API process was too busy and did nothing). With retries on, the client waits `Retry-After` and retries both, writes included, as it does `RATE_LIMITED`.
