---
name: tassyir-app
description: The Tassyir app contract for this project. tassyir.app.toml (manifest v1), scopes and consent, tokens (ID token, offline and online access tokens, refresh rotation), the ID token as the only proof of who is looking, signed webhooks (raw body, at least once, webhook-id), the Admin API (money as decimal strings, problem+json with code and fix, cursors, fields, Idempotency-Key, rate limits), app data, App Bridge and dev stores. Use it whenever you change this app's server, page, manifest or webhooks, or explain a Tassyir error code.
---

# The Tassyir app contract

[Tassyir](https://tassyir.io) is the back office of e-commerce merchants in
Algeria: orders (mostly cash on delivery), products and stock, delivery
carriers, customers, several stores per business. Merchants install apps on a
business. This project is one such app, on its own server ("external"
hosting). Everything below is the contract of API version `2026-10`; it holds
whether an app runs on its own server or, later, on Tassyir Hosting.

**An installed app is a team member of the business.** It acts with exactly
the scopes the merchant granted, only in the stores the merchant gave it, and
under the merchant's plan (a plan limit refuses an app as it refuses the
merchant). Apps are private for now ("custom apps"): one installs on the
businesses its developer owns, and on one other business the developer names.

## Addresses

| What                     | Where                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| Admin API                | `https://api.tassyir.io/apps/2026-10/`                                                            |
| Token endpoint           | `POST https://api.tassyir.io/apps/oauth/token`                                                    |
| ID-token keys (JWKS)     | `GET https://api.tassyir.io/apps/.well-known/jwks.json`                                           |
| Webhook public keys      | `GET https://api.tassyir.io/apps/webhook-keys`                                                    |
| The app's page           | `https://app.tassyir.io/{locale}/dashboard/{businessId}/apps/{handle}`                            |
| Developer console        | `https://app.tassyir.io/en/developers`                                                            |
| Manifest                 | `tassyir.app.toml`, validated by `@tassyir/app-manifest`                                          |
| SDK (server, page, docs) | `@tassyir/app`, `@tassyir/app-bridge`, `@tassyir/ui`, `@tassyir/app-manifest`                     |
| Developer docs           | `https://developers.tassyir.io` (a page's Markdown: its address + `.md`; every page: `/llms.txt`) |

## The manifest (`tassyir.app.toml`)

The manifest says what the app is and needs. It is uploaded in the developer
console as a new **version**; `npm run validate` checks it first with the
API's own validator. Every error has a stable `code`, the field's `path` and a
one-sentence `fix`.

- `name` (1-50 characters, one line) and `handle` (3-40 lowercase letters
  and digits joined by single hyphens, unique on Tassyir, **never changes**:
  it must equal the handle of the app in the console).
- `api_version = "2026-10"`.
- `[access]`: `scopes` (required) and `optional_scopes` (the merchant may
  tick them), each once, never in both. `[access.scope_reasons]`: one sentence
  (10-200 characters) per requested scope, shown on the install screen.
- `[hosting]`: `mode = "external"` and `url`: `https://host` or
  `https://host/path`, port 443 only (no port in the URL), no query, no
  trailing `/`, a public lowercase hostname (no IP, no `localhost`, nothing
  on `tassyir.io`, `tassyir-apps.com` or `tassyir.shop`).
- `[admin] page`: the embedded page, a path on `url` (`/`). Omit it for a
  headless app; `[auth] callback_url` then receives an install code.
- `[[webhooks]]`: at most 10 entries of `topics` and `uri` (a path on `url`,
  or an absolute https URL). Each topic once in the whole manifest; each
  needs the scope that reads its resource.
- `[[data.definitions]]`: the app data keys (`owner`, `key`, `type`,
  `visibility`), below.
- Every table is strict: an unknown key is an error. At most 64 KB.

**Versions and consent.** An upload becomes the app's current version at once
(external custom apps are not reviewed). An installation stays pinned to the
version its merchant consented to: a new version is offered as an update in
the dashboard (Apps, Installed apps), and applied only when a member of that
business accepts it. A version that adds scopes, or a host the data reaches
(a new `url` included), asks for consent again.

## Scopes

| Scope                   | Gives                                                                              | Implies                       |
| ----------------------- | ---------------------------------------------------------------------------------- | ----------------------------- |
| `read_orders`           | orders and their tracking, all of them                                             |                               |
| `write_orders`          | create, update, confirm, cancel, schedule, comment on orders                       | `read_orders`                 |
| `dispatch_orders`       | hand orders to a real carrier, print labels (danger)                               | `read_orders`                 |
| `read_returns`          | returned orders                                                                    |                               |
| `write_returns`         | return orders, process returns                                                     | `read_returns`, `read_orders` |
| `read_products`         | products, variants, collections                                                    |                               |
| `write_products`        | create, change products and collections                                            | `read_products`               |
| `read_inventory`        | stock levels                                                                       |                               |
| `write_inventory`       | adjust stock                                                                       | `read_inventory`              |
| `read_costs`            | buy prices (sensitive)                                                             | `read_inventory`              |
| `read_customers`        | customers: counts and delivery record, no contact fields                           | `read_orders`                 |
| `read_customer_contact` | buyer name, phones, address on orders and customers (sensitive, every read logged) | needs `read_orders`           |
| `read_analytics`        | analytics                                                                          |                               |
| `read_finance`          | finance (sensitive)                                                                |                               |
| `read_stores`           | stores                                                                             |                               |
| `read_delivery`         | delivery agents and fee groups (never carrier credentials)                         |                               |
| `write_storefront`      | storefront blocks: refused until they exist                                        |                               |

- Ask for the least the app needs. Without `read_customer_contact`, contact
  fields are **absent** (not null) in answers and webhooks.
- A missing scope answers 403 `PERMISSION_DENIED`; its `fix` names the scope.
  Add it to the manifest, upload, and the merchant consents to the update.
- Never grantable to an app: team, roles, billing, domains, integrations,
  publishing the store.
- When the plan hides phones, they read `**********`. A **waiting** order
  (past the plan's monthly allowance, `waiting: true`) is masked whatever the
  scopes until it unlocks.

## Tokens

| Kind                 | Format            | Lives                         | Notes                                                                |
| -------------------- | ----------------- | ----------------------------- | -------------------------------------------------------------------- |
| Client id            | `app_…`           | forever                       | `TASSYIR_CLIENT_ID`                                                  |
| Client secret        | `tsy_cs_…`        | until rotated (24 h overlap)  | shown once in the console; `TASSYIR_CLIENT_SECRET`; at most 3        |
| ID token             | JWT, `alg: EdDSA` | 60 seconds, exchanged once    | minted by the dashboard for the page; proves who is looking          |
| Offline access token | `tsy_at_…`        | 1 hour                        | acts as the app; comes with a refresh token                          |
| Refresh token        | `tsy_rt_…`        | 90 days, rotated on every use | offline only; the SDK stores the rotated one before using it         |
| Online access token  | `tsy_at_…`        | 1 hour                        | acts for one dashboard user (their permissions ∩ scopes); no refresh |
| Install code         | `tsy_ic_…`        | 5 minutes, one use            | headless apps: arrives at `auth.callback_url?code=`                  |

- **The flow here:** the page asks App Bridge for an ID token on every call
  to this server; the server's `tassyir.authenticate(idToken)` verifies it
  (signature, `aud` = the client id, 60 seconds) and then **reuses the
  installation's stored offline token**, or exchanges the ID token for one and
  stores it. Do not exchange on every page view: each exchange starts a new
  refresh family and an installation keeps at most 25.
- **Refresh rotation:** a refresh token presented again within 60 seconds of
  its rotation is accepted (a lost answer); later, it **revokes every token of
  the installation**, and the merchant has to reopen the app. `@tassyir/app`'s
  `TokenManager` prevents it: one refresh at a time per installation, the new
  set stored (durably) before it is used. With several processes, pass a
  `RefreshLock` and a shared store.
- Every token of an installation is revoked at once on uninstall,
  suspension and a scope change (`app/scopes_updated`). Revoking a client
  secret stops new tokens and refreshes made with it; access tokens already
  issued live out their hour.
- Token endpoint errors are OAuth's `{ error, error_description }`
  (`invalid_client`, `invalid_grant`, …), not problem+json; the SDK turns
  them into `TassyirOAuthError` with a `fix`.
- **Never** log, commit or send a token or secret anywhere but Tassyir. The
  store here encrypts them (`TOKEN_STORE_KEY`).

## Who is looking: the ID token, and nothing else

- The dashboard frames the page at `hosting.url` + `admin.page` + the app
  path + the dashboard's own query string. **Tassyir vouches for nothing in
  that address.** Never read a business, store, user or installation from it.
- App Bridge's `context` (locale, direction, theme, store) is for display
  only.
- The only proof is an ID token verified on the server (`verifyIdToken` or
  `authenticate`): it names the user (`sub`), business (`bid`), installation
  (`iid`), tab session (`sid`) and locale. An unverified token proves nothing.
- The dashboard never gives the page a Tassyir credential. Do not put one in
  the page, a cookie (the frame's cookies are third-party and often blocked)
  or a URL.

## Admin API

- `Authorization: Bearer tsy_at_…`; paths under `/apps/2026-10/`. Use
  `tassyir.admin(installationId)`: paths, parameters and bodies are typed
  from the OpenAPI document, and errors become `TassyirApiError`.
- JSON fields are camelCase, ids are strings, times ISO 8601 UTC.
- **Money is a decimal string** with two decimals (`"2500.00"`) next to a
  `currency` field (`DZD`). Never `parseFloat` it: compare and add in integer
  cents (`src/shared/money.ts`), format at the edge.
- **Lists** answer `{ data, nextCursor }`, newest first, keyset-paged:
  `limit` 1-100 (default 50; outside is a 400, never clamped), `cursor` = the
  previous `nextCursor` unchanged (opaque, bound to its list and filters),
  `nextCursor: null` on the last page. `admin.paginate()` walks them.
- `?fields=` keeps the named top-level fields (`id` always). An unknown
  parameter or field is a 400: a misspelled filter never returns everything.
- **Writes** send an `Idempotency-Key` (the SDK makes one per call and reuses
  it on its retries; pass your own to make a business action idempotent). A
  success is stored 24 hours: the same key and request replays the answer
  (`Idempotent-Replayed: true`); the same key with another request is 422
  `IDEMPOTENCY_KEY_REUSED`; while the first still runs, 409
  `IDEMPOTENCY_KEY_IN_USE`.
- **Errors** are `application/problem+json`:
  `{ type, title, status, detail, code, fix, requestId, … }`. Act on `code`,
  never on `detail`; `fix` is one sentence saying what to do; quote
  `requestId` to Tassyir support. `type`
  (`https://developers.tassyir.io/errors/<code in kebab case>`) is the code's
  page on the docs site.
- **Rate limits:** a leaky bucket per installation (40 at once, 4 a second;
  429 `RATE_LIMITED`), a ceiling shared by all the apps of a business (20 a
  second; 429 `BUSINESS_RATE_LIMITED`), and a per-process cap (503 `API_BUSY`,
  nothing done). Every answer carries `RateLimit-Limit`,
  `RateLimit-Remaining`, `RateLimit-Reset`; refusals carry `Retry-After`. With
  `retries: 3` (set in `src/server.ts`) the SDK waits and retries for you.
- Store-scope: a store outside the installation's is HTTP **460**
  `STORE_SCOPE_FORBIDDEN`; a resource of another store reads as 404.

| Code                                                            | What to do                                                             |
| --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `APP_TOKEN_INVALID` (401)                                       | the SDK refreshes once; then reauthenticate (reopen the page)          |
| `PERMISSION_DENIED` (403)                                       | request the scope its `fix` names; upload; merchant accepts the update |
| `PLAN_FEATURE_REQUIRED`, `PLAN_LIMIT_REACHED` (403)             | the merchant's plan refuses it; tell the merchant, do not retry        |
| `ORDER_LIMIT_REACHED` (403)                                     | a waiting order cannot be confirmed until the plan allows it           |
| `VALIDATION_FAILED`, `INVALID_FIELDS`, `INVALID_CURSOR` (400)   | fix the request (`errors`, `allowedFields`)                            |
| `NOT_FOUND` (404)                                               | gone, or outside the installation's stores                             |
| `STORE_SCOPE_FORBIDDEN` (460)                                   | that store was not given to the app                                    |
| `RATE_LIMITED`, `BUSINESS_RATE_LIMITED` (429), `API_BUSY` (503) | wait `Retry-After`, then retry (the SDK does with `retries`)           |
| `DEV_STORE_RESTRICTED` (409)                                    | a dev store never reaches carriers, ads, WhatsApp or payments          |

## Webhooks

Tassyir POSTs a JSON envelope to the manifest's `uri` for each subscribed
topic:

```json
{
  "id": "evt_…",
  "type": "orders/created",
  "apiVersion": "2026-10",
  "createdAt": "…",
  "businessId": "…",
  "storeId": "…",
  "appId": "…",
  "installationId": "…",
  "changed": [],
  "data": {
    "order": { "…": "the 2026-10 order, masked for this installation" }
  }
}
```

- Headers (Standard Webhooks): `webhook-id` (`dlv_…`, the same on every
  retry and replay), `webhook-timestamp`, `webhook-signature`
  (`v1a,<base64 Ed25519>`, several during a key rotation), plus unsigned
  `tassyir-topic`, `tassyir-business-id`, `tassyir-api-version`.
- **Verify the raw body**: the signature covers
  `{webhook-id}.{webhook-timestamp}.{raw body}`, the exact bytes received.
  Never parse and re-serialise the JSON before verifying. `verifyWebhook`
  also checks the timestamp (5 minutes), the envelope's `appId` (the numeric
  app id, `TASSYIR_APP_ID`, not the client id) and that the installation is
  yours. A failure is a 400; `KEYS_UNAVAILABLE` is a 503 (Tassyir retries).
- **At least once, in any order.** Deduplicate on `webhook-id`. `data` is
  read when the delivery is built, seconds after the event, so it can be
  newer than the event: reconcile by `updatedAt`, re-read through the Admin
  API when unsure. `changed` names the top-level fields `orders/updated`,
  `products/updated` and `customers/updated` changed.
- Answer 2xx within **10 seconds**; move slow work to a queue. Anything else
  (a 3xx included: redirects are not followed) is retried after 5 s, 5 min,
  30 min, 2 h, 5 h, 10 h, 14 h, 20 h, 24 h. Three days of failure, or one
  410, disables the installation's webhooks until the developer re-enables
  them in the console.
- **Test deliveries** from the console (Installs, Send test) carry sample
  data: `tassyir-test: true`, `webhook-id` `dlv_test_…`, envelope id `evt_0`.
  Acknowledge them, never process them as real.
- HTTPS on port 443 only, a public address: use a tunnel while developing.

| Topic                                                                                                                                  | Needs            |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `orders/created`, `orders/confirmed`, `orders/cancelled`, `orders/dispatched`, `orders/delivered`, `orders/returned`, `orders/updated` | `read_orders`    |
| `abandoned_checkouts/created`                                                                                                          | `read_orders`    |
| `products/created`, `products/updated`, `products/deleted`                                                                             | `read_products`  |
| `inventory_levels/updated`                                                                                                             | `read_inventory` |
| `customers/updated`                                                                                                                    | `read_customers` |
| `app/installed`, `app/uninstalled`, `app/scopes_updated`                                                                               | nothing          |
| `customers/data_request`, `customers/redact`, `business/redact` (compliance)                                                           | nothing          |

- `orders/created` fires once per real order (not for an abandoned checkout).
  `orders/returned` keys on `returned: true`; the status may stay as it was.
  A product deactivation is `products/updated` with `active: false`.
- Compliance: `customers/data_request` / `customers/redact` name a buyer and
  their orders: export or erase what the app holds about them.
  `business/redact` comes 48 hours after an uninstall, when Tassyir has
  deleted the app data: delete everything about that installation.

## App data

Values the app keeps in Tassyir, under keys its manifest declares:
`[[data.definitions]]` with `owner` (`business`, `store`, `product`, `order`,
`customer`), `key` (`[a-z][a-z0-9_]{0,63}`), `type` (`string`, `number`,
`integer`, `boolean`, `json`) and `visibility` (`app`; `merchant` and
`storefront` are read by Tassyir later).

- `GET` / `PUT` (`{ value }`, the whole value) / `DELETE`
  `/apps/2026-10/data/{ownerType}/{ownerId}/{key}`; `GET /apps/2026-10/data`
  lists. `business` needs no scope; the others need the owner's read scope
  (`read_stores`, `read_products`, `read_orders`, `read_customers`).
- A missing value is 404 `NOT_FOUND`. An undeclared key is 400
  `APP_DATA_KEY_NOT_DECLARED`; a value of the wrong type
  `APP_DATA_VALUE_INVALID`; more than 16 KB `APP_DATA_VALUE_TOO_LARGE`; past
  50,000 values 409 `APP_DATA_LIMIT_REACHED`.
- Keys and types come from the installation's **pinned** version: a key added
  in a new version is writable once the merchant accepts it.
- Deleted 48 hours after uninstall (then `business/redact`).

## App Bridge (the page)

`createAppBridge()` from `@tassyir/app-bridge`, once, as the page loads. It
talks to `https://app.tassyir.io` by `postMessage` only.

- `idToken()` (a new one per server call; never cache it), `toast.show`,
  `titleBar.set`, `saveBar.show` / `hide` with the `saveBar.save` and
  `saveBar.discard` events, `navigate({ path })` inside the app or
  `navigate({ dashboard: 'order', id })` out of it, `modal.open` / `close`,
  `resource.pick` (products, collections, customers), `context.get` and the
  `context.changed` event (`locale` `ar` | `en`, `dir`, `theme`, `storeId`).
- Per minute: `idToken` 30, `toast.show` 20, `navigate` 30, `modal.open`
  10, `resource.pick` 10, the save and title bars 60. A page that calls its
  server more often must batch.
- Refusals are `AppBridgeError { code, fix }`: `NOT_EMBEDDED` (opened outside
  the dashboard), `ID_TOKEN_UNAVAILABLE`, `APP_UNAVAILABLE`,
  `PERMISSION_DENIED`, `SCOPE_REQUIRED`, `RATE_LIMITED`, `TIMEOUT`, …
- The frame is sandboxed (`allow-scripts allow-same-origin allow-forms
allow-popups allow-downloads`) on the app's own origin. Arabic is
  right-to-left: use logical CSS properties.
- The server sends `Content-Security-Policy: frame-ancestors
https://app.tassyir.io` so no other site can frame the page.
- **Draw the page with `@tassyir/ui`**, the dashboard's own look as custom
  elements (`<tsy-table>`, `<tsy-card>`, `<tsy-text-field>`, `<tsy-button>`,
  `<tsy-status-pill>`, `<tsy-banner>`, `<tsy-empty-state>`,
  `<tsy-skeleton>`, …) and tokens (`var(--tsy-color-ink)`, never a hex
  code). `followDashboardContext(bridge)` puts the dashboard's `lang`,
  `dir` and `data-theme` on `<html>`; the elements follow. One primary
  (ink) button per view; a status is a `<tsy-status-pill>`; money reads
  `DZD 7,500` / `7.500 دج`. Toasts, modals, pickers, the save bar and the
  title are App Bridge calls, not elements.

## Dev stores

A **dev store** is a business made in the developer console (Dev stores, at
most 3) to build and test on. It is seeded with synthetic data (30 products,
about 200 orders in every state across the 58 wilayas, 64 buyers with fake
phones `+213 500 000 xxx`), needs no subscription, and the developer owns it,
so custom apps install there.

- Nothing reaches the outside or costs money: carriers, conversions APIs and
  pixels, WhatsApp, emails to others, payments, AI and custom domains answer
  409 `DEV_STORE_RESTRICTED` with an `action` and a `fix`. Its storefront
  takes no orders.
- At most 50 new orders a day (dashboard, Admin API together): 429
  `DEV_STORE_ORDER_LIMIT_REACHED`.
- Webhooks to the app work: create an order in its dashboard to get
  `orders/created`.

## Before you ship a change

1. `npm run validate`: the manifest passes; `hosting.url` is the real
   address.
2. `npm run check`: validate, typecheck, tests, build.
3. A new scope, topic, host or app data key: upload the manifest as a new
   version, then accept the update in the dev store (Apps, Installed apps).
4. No token, secret or buyer data in logs; money stays a decimal string;
   identity comes from a verified ID token only.
