---
name: tassyir-app
description: The Tassyir app contract for this project, on its own server or on Tassyir Hosting. tassyir.app.toml (manifest v1), scopes and consent, tokens (ID token, offline and online access tokens, refresh rotation), who is looking (a verified ID token, or ctx.props.viewer on Tassyir Hosting), signed webhooks (raw body, at least once, webhook-id), the Admin API (money as decimal strings, problem+json with code and fix, cursors, fields, Idempotency-Key, rate limits), app data, App Bridge, dev stores, and Tassyir Hosting (ctx.props, STORAGE, TASSYIR, allowed_hosts, the bundle rules, tassyir deploy). Use it whenever you change this app's server or Worker, page, manifest or webhooks, or explain a Tassyir error code.
---

# The Tassyir app contract

[Tassyir](https://tassyir.io) is the back office of e-commerce merchants in
Algeria: orders (mostly cash on delivery), products and stock, delivery
carriers, customers, several stores per business. Merchants install apps on a
business. This project is one such app. It runs either on its own server
(`hosting.mode = "external"`) or on **Tassyir Hosting**
(`hosting.mode = "tassyir"`: Tassyir runs the code as a Cloudflare Worker,
see "Tassyir Hosting" below); `tassyir.app.toml` says which. Everything below
is the contract of API version `2026-10`, the same in both modes unless a
section says otherwise.

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
| A hosted app's origin    | `https://{handle}.tassyir-apps.com` (served only inside the dashboard's frame)                    |
| Developer console        | `https://app.tassyir.io/en/developers`                                                            |
| Manifest                 | `tassyir.app.toml`, validated by `@tassyir/app-manifest`                                          |
| SDK (server, page, docs) | `@tassyir/app`, `@tassyir/app-bridge` (React: `/react`), `@tassyir/ui`, `@tassyir/app-manifest`   |
| CLI                      | `tassyir` (`login`, `validate`, `deploy`, `app version`; `--json` everywhere)                     |
| Developer docs           | `https://developers.tassyir.io` (a page's Markdown: its address + `.md`; every page: `/llms.txt`) |

## The manifest (`tassyir.app.toml`)

The manifest says what the app is and needs. It is uploaded as a new
**version** (the developer console, or `tassyir deploy`; a hosted app's code
goes with it); `npm run validate` checks it first with the API's own
validator. Every error has a stable `code`, the field's `path` and a
one-sentence `fix`.

- `name` (1-50 characters, one line) and `handle` (3-40 lowercase letters
  and digits joined by single hyphens, unique on Tassyir, **never changes**:
  it must equal the handle of the app in the console).
- `api_version = "2026-10"`.
- `[access]`: `scopes` (required) and `optional_scopes` (the merchant may
  tick them), each once, never in both. `[access.scope_reasons]`: one sentence
  (10-200 characters) per requested scope, shown on the install screen.
- `[hosting]`, external: `mode = "external"` and `url`: `https://host` or
  `https://host/path`, port 443 only (no port in the URL), no query, no
  trailing `/`, a public lowercase hostname (no IP, no `localhost`, nothing
  on `tassyir.io`, `tassyir-apps.com` or `tassyir.shop`).
- `[hosting]`, Tassyir Hosting: `mode = "tassyir"` and `allowed_hosts`
  (required, may be empty, at most 20): every outside host the code calls,
  `api.example.com` or `*.example.com` (its subdomains, never the name
  itself); no Tassyir domain. No `url`.
- `[admin] page`: the embedded page, a path on the app's origin (`/`). Omit
  it for a headless app; an external one's `[auth] callback_url` then
  receives an install code.
- `[[webhooks]]`: at most 10 entries of `topics` and `uri` (a path on the
  app's origin, or for an external app an absolute https URL). Each topic
  once in the whole manifest; each needs the scope that reads its resource.
- Nothing under `/.tassyir/`: that prefix of a hosted origin is Tassyir's.
- `[[data.definitions]]`: the app data keys (`owner`, `key`, `type`,
  `visibility`), below.
- Every table is strict: an unknown key is an error. At most 64 KB.

**Versions and consent.** An external upload becomes the app's current
version at once (custom apps are not reviewed). A hosted version is scanned
first (its code against the manifest: hosts, scopes, banned APIs; secrets,
dependencies; an AI review that can only add caution) and is released when
the scan passes, or held for a person (`in_review`). An installation stays
pinned to the version its merchant consented to: a new version is offered as
an update in the dashboard (Apps, Installed apps), and applied only when a
member of that business accepts it. A version that adds scopes, or a host the
data reaches (a new `url` or `allowed_hosts` entry, or a change of hosting
mode), asks for consent again.

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
| `read_offers`           | the merchant's pricing offers: rules, dates, code count, never a code or a buyer   |                               |
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
- Order money: `subtotal` (goods before offers) − `discountTotal` +
  `shippingPrice` = `total`; `discounts[]` names the offers; a line's
  `unitPrice`/`totalPrice` are net, `originalPrice` is gross. Money is never
  masked, and keep a default branch over `changed` on `orders/updated`.

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

- **On Tassyir Hosting, none of this:** a hosted app holds no client
  secret and no token. It calls the Admin API through `ctx.props.TASSYIR`,
  which authenticates each call as the installation ("Tassyir Hosting").
- **The flow on your own server:** the page asks App Bridge for an ID token
  on every call to the server; the server's `tassyir.authenticate(idToken)`
  verifies it
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

## Who is looking

- The dashboard frames the page at the app's origin + `admin.page` + the app
  path + the dashboard's own query string. **Tassyir vouches for nothing in
  that address.** Never read a business, store, user or installation from it.
- App Bridge's `context` (locale, direction, theme, store) is for display
  only.
- **On your own server, the only proof is an ID token** verified on the
  server (`verifyIdToken` or `authenticate`): it names the user (`sub`),
  business (`bid`), installation (`iid`), tab session (`sid`) and locale. An
  unverified token proves nothing.
- **On Tassyir Hosting, `ctx.props` says it:** `installation` is the one the
  request runs for and `viewer` (`{ userId, sessionId }`) the member who
  opened the page, set by Tassyir from a session the dashboard opened for
  that frame. `viewer` is who is looking, not a permission. The page needs
  no ID token to call its own Worker.
- The dashboard never gives the page a Tassyir credential. Do not put one in
  the page, a cookie (the frame's cookies are third-party and often blocked)
  or a URL.

## Admin API

- `Authorization: Bearer tsy_at_…`; paths under `/apps/2026-10/`. Use
  `tassyir.admin(installationId)` (own server) or `hostedAdmin(ctx.props)`
  (Tassyir Hosting, no token): paths, parameters and bodies are typed from
  the OpenAPI document, and errors become `TassyirApiError`.
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
  `retries: 3` the SDK waits and retries for you (on Tassyir Hosting every
  retry is one more subrequest of the request).
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
- **On Tassyir Hosting** a delivery reaches the Worker through Tassyir's
  dispatcher, which runs the version with `ctx.props.viewer` null (a page
  request always has a viewer). `verifyHostedWebhook(request, ctx.props)`
  runs every rule above, the signature verified with Tassyir's keys read
  through `ctx.props.TASSYIR` (`GET /apps/webhook-keys`; a hosted Worker's
  own `fetch()` never reaches a Tassyir host), the envelope's installation,
  business and app checked against `ctx.props.installation`, and refuses a
  request with a viewer. Keys it cannot read are `KEYS_UNAVAILABLE`: answer
  503, never process an unverified delivery. `app/uninstalled` and
  `business/redact` still arrive after an uninstall, with `TASSYIR` refused
  (but for the key documents).
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
- HTTPS on port 443 only, a public address: on your own server, use a
  tunnel while developing.

| Topic                                                                                                                                  | Needs            |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `orders/created`, `orders/confirmed`, `orders/cancelled`, `orders/dispatched`, `orders/delivered`, `orders/returned`, `orders/updated` | `read_orders`    |
| `abandoned_checkouts/created`                                                                                                          | `read_orders`    |
| `products/created`, `products/updated`, `products/deleted`                                                                             | `read_products`  |
| `inventory_levels/updated`                                                                                                             | `read_inventory` |
| `customers/updated`                                                                                                                    | `read_customers` |
| `offers/created`, `offers/updated`, `offers/deleted`                                                                                   | `read_offers`    |
| `app/installed`, `app/uninstalled`, `app/scopes_updated`                                                                               | nothing          |
| `customers/data_request`, `customers/redact`, `business/redact` (compliance)                                                           | nothing          |

- `orders/created` fires once per real order (not for an abandoned checkout).
  `orders/returned` keys on `returned: true`; the status may stay as it was.
  A product deactivation is `products/updated` with `active: false`.
- Compliance: `customers/data_request` / `customers/redact` name a buyer and
  their orders: export or erase what the app holds about them.
  `business/redact` comes 48 hours after an uninstall, when Tassyir has
  deleted the app data (and a hosted app's `STORAGE`): delete everything
  about that installation that the app keeps elsewhere.

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
talks to `https://app.tassyir.io` by `postMessage` only. In React,
`@tassyir/app-bridge/react` wraps it: `<AppBridgeProvider bridge={bridge}>`,
then `useBridgeContext`, `useTitleBar`, `useSaveBar`, `useToast`,
`useNavigate`, `useModal`, `useResourcePicker`.

- `idToken()` (a new one per server call on your own server; never cache
  it; a hosted page needs none), `toast.show`,
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
- The server (or Worker) sends `Content-Security-Policy: frame-ancestors
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

## Tassyir Hosting (`hosting.mode = "tassyir"`)

Tassyir runs the app as a Cloudflare Worker (Workers for Platforms), one
script per released version, for every installation pinned to it. No server,
no URL, no credential.

- **The Worker** is ONE ES module whose default export has
  `fetch(request, env, ctx)` (`export default app` for a Hono app). `env` is
  empty. Everything per installation arrives with each request in
  **`ctx.props`**, never in `env`; read it with
  `readHostedProps(ctx)` from `@tassyir/app`:
  - `installation`: `{ id, businessId, appId, handle, version, scopes,
storeAccess, storeIds, devStore }`;
  - `viewer`: `{ userId, sessionId }` or `null` (a webhook delivery);
  - `STORAGE`: the installation's own SQLite database:
    `sql(query, ...bindings)` (`{ rows, rowsRead, rowsWritten }`),
    `batch([{ query, bindings }])` (ONE transaction), `usage()`. Each call is
    a transaction (`BEGIN` / `COMMIT` refused); at most 5,000 rows and about
    4 MiB per answer (page with `LIMIT`), 100 bound values, 50 statements a
    batch, 50 MB a database (`STORAGE_FULL`; reads and deletes still run).
    Create tables with `CREATE TABLE IF NOT EXISTS` in the same batch as
    their first use. Erased 48 hours after an uninstall;
  - `TASSYIR`: the Admin API as the installation, `fetch()` with the Admin
    API's own URLs, no token; `hostedAdmin(ctx.props)` is the typed client
    over it. It sends Admin API paths only (`HOSTED_PATH_NOT_ALLOWED`), JSON
    bodies (ids as strings: numbers past 2^53 are rounded), answers up to
    8 MiB (`RESPONSE_TOO_LARGE`); a call the installation can no longer make
    (uninstalled, suspended) is 401 `HOSTED_CALL_REFUSED`.
- **One script serves many merchants**, possibly in one isolate: module
  variables are shared between installations. Keep per-request state per
  request; never cache anything of an installation in a module variable.
- **Outside calls** (`fetch()`) go through Tassyir's egress: https on port 443
  to a host in `allowed_hosts` only, never a Tassyir host, never an IP; a
  refusal is `403` with the header `tassyir-egress-refused`. Every call is
  logged (host, status, bytes). Call Tassyir through `TASSYIR`, never
  `fetch('https://api.tassyir.io/…')`.
- **Limits per request** (the starting values): 300 ms of CPU and 50
  subrequests (each `fetch()`, `STORAGE` and `TASSYIR` call is one); past
  them the request fails (503).
- **The bundle** (`tassyir deploy` builds it with esbuild from
  `src/worker.ts`): text only (ES modules; `.html`, `.css` and `.txt`
  imported as strings, `.json` as data), 3 MB, 100 files. Refused: a `node:` import (no
  Node.js built-ins: use the Web APIs), `eval` / `new Function` / a string
  timer, WebAssembly, `import()` of a computed name, `cloudflare:sockets`,
  a remote import, a request to a host not in `allowed_hosts` or to a
  Tassyir host, and a module without a `fetch` handler.
- **Pages are served only inside the dashboard's frame**, with a session the
  dashboard opened for it: a top-level visit, another site's frame or
  another app's request is refused. The page calls its own Worker on the
  same origin (`fetch('/api/…')`), with no token. Never change state on a
  GET. Do not trust the app's own cookies for anything (every
  `*.tassyir-apps.com` app is one site).
- **`/.tassyir/`** on the app's origin is Tassyir's (the launch): never a
  page, a webhook path or a link of the app.
- **Deploy:** `tassyir deploy` builds the bundle, runs the API's upload rules
  and the scan's code checks locally (nothing is sent when they fail),
  uploads `{ manifest, bundle }` with the lockfile, and follows the scan:
  released (exit 0), `in_review` (0, `released: false`), `VERSION_SCAN_FAILED`
  (1, with each finding). `tassyir app version <n> --follow` checks later.
  Tassyir Hosting must be open on the API you deploy to
  (`APP_HOSTING_NOT_AVAILABLE` otherwise).

## Before you ship a change

1. `npm run validate`: the manifest passes (on your own server,
   `hosting.url` is the real address).
2. `npm run check`: validate, typecheck, tests, and the build (on Tassyir
   Hosting, `deploy:check`: the checks `tassyir deploy` runs before it
   uploads).
3. A new scope, topic, host or app data key: a new version (upload the
   manifest, or `npm run deploy`), then accept the update in the dev store
   (Apps, Installed apps).
4. No token, secret or buyer data in logs; money stays a decimal string;
   identity comes from a verified ID token, or on Tassyir Hosting from
   `ctx.props`, only.
