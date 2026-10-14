---
'@tassyir/app': patch
---

The Admin API types follow the API's OpenAPI document at backend `283f2b6b`, which adds `POST /images` (re-host an image by URL on Tassyir's CDN, scope `write_products`) and its codes. With retries on, the client never retries 429 `IMAGE_QUOTA_REACHED`: a daily quota is not worth retrying, so it throws at once and the error's `problem` names the quota (`per`, `window`: `day` or `minute`, `limit`, `retryAfter`).
