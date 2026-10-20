# @tassyir/dev-mcp

## 0.3.0

### Minor Changes

- 2e608d2: The server knows offers: the new Offers guide, `listOffers` and `getOffer` (`get_api_operation`), the `Offer` schema, and the `offers/created`, `offers/updated` and `offers/deleted` topics (`get_event_schema`), with the `read_offers` scope in the manifest vocabulary it checks against.
- 0efc04c: The server knows writing offers: the new "Write offers and codes" guide (`search_docs`, `fetch_doc`), the `createOffer`, `updateOffer`, `deleteOffer`, `publishOffer`, `pauseOffer`, `resumeOffer`, `listOfferCodes`, `addOfferCode`, `addOfferCodes`, `disableOfferCode`, `enableOfferCode` and `listOfferRedemptions` operations (`get_api_operation`) with their schemas, `validate_manifest` checks `[[offers.types]]` and the `write_offers` scope, and `search_docs` ranks a section whose heading is the whole query ("create an order") above the guide it sits in.

### Patch Changes

- 304c3d1: The server knows the order money: the `Order` schema (`get_api_operation`) and the `orders/*` topics (`get_event_schema`) carry `subtotal`, `discountTotal`, `discounts` and the per-line `originalPrice`, `discountAmount` and `discounts`, and the Orders guide gains an "Order money" section.
- Updated dependencies [d978cfe]
- Updated dependencies [79d20f8]
- Updated dependencies [891045a]
- Updated dependencies [0efc04c]
- Updated dependencies [1b2ca05]
- Updated dependencies [f6bb3c0]
- Updated dependencies [f744f56]
  - tassyir@0.6.0
  - @tassyir/app-manifest@0.4.0
  - create-tassyir-app@0.2.4

## 0.2.0

### Minor Changes

- 0b5430e: `validate_block` and `run_review_checks` are live (no longer `TOOL_NOT_AVAILABLE`). `validate_block` checks a storefront block offline with `@tassyir/storefront-blocks`, the API's upload check: every `[[storefront.blocks]]` entry of `tassyir.app.toml` with its files (or one, `block`), or a template given as text (`template`, `stylesheet`, `declaration`), each problem with its `code`, `path` (`file:line:column`) and `fix`; `preview` adds the sample render's HTML. `run_review_checks` runs the marketplace review's checklist as a dry run on the draft listing and latest version (the sign-in of `tassyir login`), waits up to `waitSeconds` and answers `passed`, the failed hard checks with their fix and every result; `runId` reads a run again. It never submits. `tail_logs` stays a seam.

### Patch Changes

- Updated dependencies [0b5430e]
- Updated dependencies [0b5430e]
  - tassyir@0.5.0
  - create-tassyir-app@0.2.3

## 0.1.4

### Patch Changes

- 0cfc8d0: The Tassyir Hosting guide (`fetch_doc tassyir-hosting`) follows `@tassyir/app`'s hosted helpers: the `hosted` template and `tassyir deploy --dry-run`, `readHostedProps`, the page on `@tassyir/app-bridge/react`, `hostedAdmin` and `HOSTED_BINDING_ERRORS`, and webhooks verified with `verifyHostedWebhook` (Tassyir's keys read through `ctx.props.TASSYIR`, never pinned in the bundle); the errors guide points to the hosted helpers' codes. `scaffold` with `template: "hosted"` answers the hosted project's next steps (`npm run check`, `npm run deploy`; no `npm run setup`, no secret).
- Updated dependencies [0cfc8d0]
- Updated dependencies [0cfc8d0]
- Updated dependencies [0cfc8d0]
  - tassyir@0.4.0
  - create-tassyir-app@0.2.2
  - @tassyir/app-manifest@0.3.1

## 0.1.3

### Patch Changes

- 492bb64: The manifest guide (`fetch_doc manifest`) describes the marketplace's fields, marked not live yet: storefront blocks and their settings, data labels, admin actions and the app proxy. `validate_manifest` checks them with `@tassyir/app-manifest`'s new release.
- afca14a: The storefront blocks guide (`fetch_doc storefront-blocks`, marked not live yet): the block template language, its objects, tags and filters, the HTML and stylesheet rules, the limits and the error codes.
- Updated dependencies [492bb64]
- Updated dependencies [492bb64]
  - @tassyir/app-manifest@0.3.0
  - create-tassyir-app@0.2.1
  - tassyir@0.3.1

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
