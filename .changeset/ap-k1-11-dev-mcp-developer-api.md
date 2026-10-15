---
'@tassyir/dev-mcp': patch
---

`get_api_operation` serves the developer API as the backend describes it at `e6f930db`, with descriptions written for app developers, and a refusal that is a bare string is the `RateLimitError` shape (formerly `ThrottlerError`). Also: a version upload takes a hosted app's `bundle` (`main`, `files`, `lockfile`) and can answer `APP_BUNDLE_INVALID`, `APP_BUNDLE_REQUIRED`, `APP_BUNDLE_NOT_ALLOWED`, `APP_VERSION_CONFLICT`, `APP_HOSTING_NOT_CONFIGURED`, `APP_HOSTING_BUSY` and `APP_BUNDLE_STORAGE_FAILED`, and every version carries `hosting` (the scan, its checks and findings, the AI review, the uploads; `null` for an app on its own server).
