# AGENTS.md

How to work on this project. It is for any coding agent (Claude Code, Codex,
Cursor, …) and any person. Read the `tassyir-app` skill too:
[.claude/skills/tassyir-app/SKILL.md](.claude/skills/tassyir-app/SKILL.md)
holds the Tassyir contract this app must follow (manifest, scopes, Tassyir
Hosting, webhooks, Admin API, App Bridge, dev stores).

## What this is

A [Tassyir](https://tassyir.io) app on **Tassyir Hosting**, made with
`create-tassyir-app --template hosted`. Tassyir runs its code as a Cloudflare
Worker, for every business that installs it: there is no server to run, no
URL to keep, no credential to store. A merchant installs it on a business;
it then:

- shows a React page inside the Tassyir dashboard (`src/page`, framed at
  `admin.page`, drawn with `@tassyir/ui`, talking to the dashboard through
  `@tassyir/app-bridge/react`), which lists the business's pending orders and
  keeps one setting;
- reads the Admin API through `ctx.props.TASSYIR`, with no token
  (`src/app.ts`);
- keeps its data in the installation's own SQLite database,
  `ctx.props.STORAGE` (`src/storage.ts`);
- receives webhooks (`src/webhooks.ts`): `orders/created` is recorded in
  STORAGE and counted on the page.

The demo features are there to be replaced; the wiring around them
(`ctx.props`, the storage helpers, the webhook check, the page's bridge) is
what to keep.

## What is different from an app on your own server

- **Everything per installation is in `ctx.props`, per request**, never in
  `env` (empty) and never in a module variable: `installation`, `viewer`
  (who is looking, or `null` for a webhook delivery), `STORAGE`, `TASSYIR`.
  `readHostedProps(c.executionCtx)` (a middleware in `src/app.ts`) reads it.
- **One Worker serves every installation pinned to its version, possibly in
  one isolate.** A module variable is shared between merchants: keep
  per-request state per request.
- **No token, no ID token.** The page calls its own Worker on the same
  origin; Tassyir says who is looking (`ctx.props.viewer`). The Worker calls
  the Admin API with `hostedAdmin(c.get('props'))`.
- **Outside calls are limited** to the hosts in `hosting.allowed_hosts`
  (empty here), never a Tassyir host. Each request has 300 ms of CPU and 50
  subrequests (every `fetch()`, `STORAGE` and `TASSYIR` call is one) to
  start with: batch STORAGE statements, ask the API for what the page shows
  (`fields`, `limit`).
- **The code is scanned before it runs**, as one bundle: no `node:` import,
  no `eval` / `new Function`, no WebAssembly, no `import()` of a computed
  name, no request to a host outside `allowed_hosts`, a `fetch` handler as
  the default export. `npm run deploy:check` runs the same checks locally.
- **Pages are served only inside the dashboard's frame.** Opened anywhere
  else, Tassyir refuses them. To see the page, deploy and open the app from
  a dev store's dashboard.

## Commands

Node 22.18 or later. Node runs the scripts' TypeScript as it is (type
stripping).

| Command                | What it does                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `npm install`          | Installs the dependencies                                                            |
| `npm run validate`     | Checks `tassyir.app.toml` with the Tassyir API's validator (`-- --json`)             |
| `npm run typecheck`    | `tsc` on the Worker and its specs, the scripts, then the page                        |
| `npm test`             | Vitest: the Worker in workerd (stand-in `ctx.props`), the manifest and money on Node |
| `npm run build`        | Bundles the page into `dist/page` (the Worker imports it as text)                    |
| `npm run deploy:check` | Builds, then runs what `tassyir deploy` checks before it uploads; uploads nothing    |
| `npm run deploy`       | Builds, then `tassyir deploy`: uploads the version and follows its scan              |
| `npm run check`        | validate, typecheck, test, deploy:check: run it before you finish a change           |

## Layout

```
tassyir.app.toml        the manifest: scopes, hosting (tassyir, allowed_hosts), the page, webhooks
src/worker.ts           the Worker's entry: the routes with the built page inside (what Tassyir runs)
src/app.ts              the routes (Hono): ctx.props, /webhooks, /api/*, the page and its headers
src/storage.ts          ctx.props.STORAGE: the schema, settings, the orders the webhook recorded
src/webhooks.ts         verifies a delivery (verifyHostedWebhook), handles each topic
src/page/               the page (React, browser): main.tsx, App.tsx, api.ts, messages.ts, own tsconfig
src/shared/money.ts     decimal-string money, used by the Worker and the page
scripts/                build, deploy-check, validate (run by Node, TypeScript)
test/worker/            specs in workerd; stand-ins.ts, helpers.ts make ctx.props and deliveries
test/node/              the manifest and money specs, on Node
```

## How a request flows

- **The dashboard → the page.** The dashboard frames
  `https://my-tassyir-app.tassyir-apps.com/` with a session it opened for this
  frame. Tassyir checks it on every request, then runs the Worker with that
  installation's `ctx.props`. `GET /` and `GET /app.js` answer the built page
  (`src/worker.ts` imports `dist/page`).
- **The page → `/api/*`.** Same origin, no token. The `/api/*` middleware
  refuses a request without a viewer (`VIEWER_REQUIRED`: only a webhook
  delivery has none). `/api/orders` reads the Admin API through
  `hostedAdmin(props)` and the count from STORAGE; `/api/settings` reads and
  writes STORAGE.
- **Tassyir → `/webhooks`.** The dispatcher delivers it with `viewer: null`.
  `verifyHostedWebhook(request, props)` verifies Tassyir's signature with the
  keys it reads through `ctx.props.TASSYIR`, then checks it is not a page
  request and names this installation, business and app, with a fresh
  timestamp; `handleEvent` then switches on `event.type`. Keys that cannot be
  read answer 503 (`KEYS_UNAVAILABLE`): Tassyir delivers again. Every handler
  is idempotent: deliveries are at least once.

## Rules

- **Who is looking comes from `ctx.props` only.** Never read a business,
  store, user or installation from the page's URL, its query string, a header
  the page chose, or App Bridge's `context`.
- **Never keep installation data in a module variable.** It would reach
  another merchant served by the same isolate.
- **Never log a buyer's contact details** or a webhook body.
- **Never write to STORAGE in `business/redact`**: Tassyir erased it before
  sending it.
- **Money is a decimal string** (`"2500.00"`). Use `src/shared/money.ts`;
  never `parseFloat` or `Number()` an amount to compute with it. Show it
  with `formatAmount` (`DZD 7,500`, `7.500 دج`), as the dashboard does.
- **The page looks like the dashboard.** Build it from `@tassyir/ui`'s
  elements (`<tsy-table>`, `<tsy-card>`, `<tsy-text-field>`,
  `<tsy-status-pill>`, …; their JSX types are in `src/page/elements.d.ts`)
  and its tokens (`var(--tsy-color-…)`, never a hex code); one primary button
  per view, a status is a pill; logical CSS only (`margin-inline-start`), so
  Arabic reads right to left. Toasts, the save bar, modals and pickers are App
  Bridge calls (`useToast`, `useSaveBar`, `useModal`, `useResourcePicker`).
  The page's own CSS is the `layout` sheet in `src/page/main.tsx`
  (constructable: the Content-Security-Policy stays `style-src 'self'`).
- **Never change state on a GET.** Writes are `PUT`/`POST`/`DELETE` from the
  page.
- **Act on error `code`s, show `fix` to the developer**, never parse
  `message` or `detail`.
- **Writes to the Admin API go through `admin.post/put/patch/delete`**, which
  send an `Idempotency-Key`; pass your own key when the write stands for one
  business action (`confirm-${orderId}`). Send ids as strings.
- **The manifest and the code change together.** A new scope, topic or host
  is a manifest change: `npm run validate`, `npm run deploy`, then accept the
  update in the dev store.

## Recipes

**Call another Admin API route.** Add a route under `/api/` in `src/app.ts`
and call `hostedAdmin(c.get('props')).get('/products', { query: { limit: 20 }
})` (typed: your editor completes paths, parameters and fields). Add the
scope it needs to `[access]` with a reason. Errors reach the page as
`{ code, message, fix }` through `app.onError`.

**Keep more in STORAGE.** Add a `CREATE TABLE IF NOT EXISTS` to `SCHEMA` in
`src/storage.ts` and a function that runs its statements through `run()` (one
batch, one transaction). Key rows on the resource's id so a repeated webhook
changes nothing twice. Page large reads with `LIMIT`.

**Handle another webhook topic.** Add it to `topics` in `tassyir.app.toml`
(with the scope it needs), add a `case` in `handleEvent` (`event.data` is
typed per topic), and a spec in `test/worker/app.test.ts` that posts a
delivery (`delivery(privateKey, envelope('orders/confirmed', { order }))`).

**Call an outside service.** Add its host to `hosting.allowed_hosts`
(`api.example.com`, or `*.example.com` for its subdomains), then `fetch()`
it. Without the entry the call is refused (`403`, header
`tassyir-egress-refused`), and the scan refuses a literal URL to a host that
is not listed.

**Use the dashboard from the page.** `useNavigate()({ dashboard: 'order', id
})`, `useResourcePicker().pick({ type: 'product' })`, `useToast()`,
`useSaveBar(…)`, `useModal().open({ path })`: see `@tassyir/app-bridge`'s
README, "React".

**Add to the page.** Use an element of `@tassyir/ui` (its README lists each
one's attributes) and declare it in `src/page/elements.d.ts` if it is not
there yet. `followDashboardContext` already puts the dashboard's language,
direction and theme on `<html>`; `MESSAGES` (`src/page/messages.ts`) holds
the page's own words in Arabic and English.

## Tests

`npm test` runs without a network or an account. The Worker's specs run in
workerd, the Workers runtime, through Cloudflare's Vitest integration:
`test/worker/stand-ins.ts` gives each spec a real SQLite STORAGE over RPC (as
on Tassyir Hosting) and `test/worker/helpers.ts` a fake Admin API as TASSYIR,
signed deliveries and envelopes. Use them for every route and topic you add.
Every id in the tests is made up; never paste a real one.

## References

- The developer docs, https://developers.tassyir.io: the guides, the Admin
  API reference, a page per error code (a problem's `type` is its page) and a
  page per package. Every page's Markdown is at its address plus `.md`;
  https://developers.tassyir.io/llms.txt lists them all.
- `@tassyir/app` ("Tassyir Hosting"), `@tassyir/app-bridge` ("React"),
  `@tassyir/app-manifest`, `@tassyir/ui`, `tassyir`:
  https://developers.tassyir.io/packages/app (and `/packages/app-bridge`, …),
  or their READMEs in `node_modules` offline.
- The developer console: https://app.tassyir.io/en/developers.
