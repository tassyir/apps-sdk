# @tassyir/dev-mcp

## 0.1.2

### Patch Changes

- 86ab80c: New guide, Tassyir Hosting (`fetch_doc tassyir-hosting`): deploying a hosted app, the scan's checks and findings, `ctx.props`, storage, egress and webhooks; the errors guide explains `HOSTED_CALL_REFUSED` and the hosted binding's own codes. `get_api_operation` serves both documents at backend `46a49b6b` (`HOSTED_CALL_REFUSED` on every Admin API 401; `refusal` on every deploy state of a hosted version), and `validate_manifest` refuses a hosted app's page or webhook under `/.tassyir/`.
- Updated dependencies [acb578f]
- Updated dependencies [86ab80c]
- Updated dependencies [86ab80c]
- Updated dependencies [86ab80c]
- Updated dependencies [0834ea6]
  - create-tassyir-app@0.2.0
  - tassyir@0.3.0
  - @tassyir/app-manifest@0.2.0

## 0.1.1

### Patch Changes

- 1eb5105: `get_api_operation` also answers the developer API, what the `tassyir` CLI calls (apps, versions, client secrets, dev stores, the webhook console, the CLI sign-in), from its OpenAPI document shipped in the package. An operation is found by its id or by `METHOD /developer/…` as before; `api: "developer"` lists the developer operations or reads one of its schemas, and every answer names its `api`. A status whose body may be one of several lists them (`shapes`), so an agent knows when a refusal can come without a `code`. Fixed: `seed_dev_store` accepts a dev store whose store has no subdomain yet (`null`), as the API documents.
- 7ad6134: `get_api_operation` serves the developer API as the backend describes it at `e6f930db`, with descriptions written for app developers, and a refusal that is a bare string is the `RateLimitError` shape (formerly `ThrottlerError`). Also: a version upload takes a hosted app's `bundle` (`main`, `files`, `lockfile`) and can answer `APP_BUNDLE_INVALID`, `APP_BUNDLE_REQUIRED`, `APP_BUNDLE_NOT_ALLOWED`, `APP_VERSION_CONFLICT`, `APP_HOSTING_NOT_CONFIGURED`, `APP_HOSTING_BUSY` and `APP_BUNDLE_STORAGE_FAILED`, and every version carries `hosting` (the scan, its checks and findings, the AI review, the uploads; `null` for an app on its own server).
- b146c8c: `fetch_doc`'s `source` is now the guide's page on the docs site, `https://developers.tassyir.io/guides/<slug>` (the index guide at `/guides`), with `#<section>` when you read a section, instead of the guide's file on GitHub. Each page's Markdown is the same address plus `.md`.
- Updated dependencies [2c0bbe7]
- Updated dependencies [f5a07cb]
- Updated dependencies [7ad6134]
- Updated dependencies [b146c8c]
  - tassyir@0.2.0
  - create-tassyir-app@0.1.1

## 0.1.0

### Minor Changes

- cb973db: First release: an MCP server over stdio for the AI agent that builds a Tassyir app (`claude mcp add tassyir -- npx -y @tassyir/dev-mcp`). `search_docs` and `fetch_doc` over the developer guides, `get_api_operation` and `get_event_schema` over the Admin API's OpenAPI document (API version 2026-10, shipped inside the package), `validate_manifest` with the API's own validator, `scaffold` from `create-tassyir-app`, and `trigger_test_webhook`, `seed_dev_store` and `list_dev_stores` through the developer API with the sign-in of `tassyir login` (the token is never in an answer). `validate_block`, `tail_logs` and `run_review_checks` answer `TOOL_NOT_AVAILABLE` until the marketplace and Tassyir Hosting exist. Every tool has a JSON Schema input and output; every answer is at most 8 KB; every refusal is `{ error: { code, message, fix } }`.

### Patch Changes

- Updated dependencies [cc6d0c2]
  - @tassyir/app-manifest@0.1.1
