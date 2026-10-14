# AGENTS.md

How to work on this project. It is for any coding agent (Claude Code, Codex,
Cursor, …) and any person. Read the `tassyir-app` skill too:
[.claude/skills/tassyir-app/SKILL.md](.claude/skills/tassyir-app/SKILL.md)
holds the Tassyir contract this app must follow (manifest, scopes, tokens,
webhooks, Admin API, App Bridge, dev stores).

## What this is

A [Tassyir](https://tassyir.io) app on its own server ("external" hosting),
made with `create-tassyir-app`. A merchant installs it on a business; it then:

- shows a page inside the Tassyir dashboard (`src/page`, framed at
  `admin.page`), which lists the business's pending orders and keeps one
  setting;
- calls the Tassyir Admin API through `@tassyir/app` (`src/app.ts`);
- receives signed webhooks (`src/webhooks.ts`);
- keeps each installation's tokens in a small encrypted file store
  (`src/store.ts`).

The demo features are there to be replaced; the wiring around them (tokens,
verification, the store, the page's bridge) is what to keep.

## Commands

Node 22.18 or later. Node runs the TypeScript files as they are (type
stripping): there is no server build.

| Command             | What it does                                                             |
| ------------------- | ------------------------------------------------------------------------ |
| `npm install`       | Installs the dependencies                                                |
| `npm run setup`     | Writes `.env` from `.env.example` with a new `TOKEN_STORE_KEY`           |
| `npm run dev`       | Server on `PORT` (3000), restarted on change; the page rebuilt on change |
| `npm run validate`  | Checks `tassyir.app.toml` with the Tassyir API's validator (`-- --json`) |
| `npm run typecheck` | `tsc` on the server, tests and scripts, then on the page                 |
| `npm test`          | Vitest (`test/`): no network, no Tassyir account                         |
| `npm run build`     | Bundles the page into `dist/public`                                      |
| `npm start`         | Runs the server (production)                                             |
| `npm run check`     | validate, typecheck, test, build: run it before you finish a change      |

## Layout

```
tassyir.app.toml        the manifest: scopes, hosting.url, the page, webhooks, app data keys
src/server.ts           Node entry: settings, store, the @tassyir/app instance, listen
src/app.ts              the HTTP routes (Hono, Web-standard): /health, /webhooks, /api/*, the page
src/webhooks.ts         verifies a delivery on the raw body, dedupes, handles each topic
src/store.ts            the file store: tokens (encrypted), installations, handled webhook-ids
src/config.ts           environment variables, every problem reported with a fix
src/page/               the embedded page (browser): app.ts, app.css, index.html, own tsconfig
src/shared/money.ts     decimal-string money, used by the server and the page
scripts/                dev, build, setup, validate (run by Node, TypeScript)
test/                   Vitest specs; test/helpers.ts fakes the Tassyir API and signs like Tassyir
```

`src/app.ts` and `src/webhooks.ts` use only Web APIs (Request, Response,
fetch): Node-specific code stays in `src/server.ts`, `src/store.ts` and
`src/page-files.ts`. Keep it so: moving to Tassyir Hosting then replaces
those three files only.

## How a request flows

- **The page → this server.** For each call the page asks App Bridge for a
  NEW ID token and sends it as `Authorization: Bearer`. The `/api/*`
  middleware runs `tassyir.authenticate(idToken)`: it verifies the token
  (who is looking: user, business, installation) and reuses the installation's
  stored offline token, or exchanges the ID token for one. Routes read
  `c.get('session')` and call `c.get('admin')`.
- **Tassyir → `/webhooks`.** `receiveWebhook` passes the raw `Request` to
  `tassyir.verifyWebhook` (signature over the raw body, timestamp, app id,
  known installation), skips a `webhook-id` already handled, then
  `handleEvent` switches on `event.type`.
- **Tokens.** `@tassyir/app` refreshes them and writes each rotated set to
  the store before using it. The store is one JSON file; tokens in it are
  encrypted with `TOKEN_STORE_KEY`.

## Rules

- **Identity comes from a verified ID token only.** Never read a business,
  store, user or installation from the page's URL, its query string, a
  header the page chose, or App Bridge's `context`.
- **Never log or return a token, a secret or a buyer's contact details.** No
  `console.log` of a `TokenSet`, a request's headers or a webhook body.
- **Verify webhooks on the raw body.** Never put a JSON body parser in front
  of `/webhooks`, never re-serialise the body.
- **Money is a decimal string** (`"2500.00"`). Use `src/shared/money.ts`;
  never `parseFloat` or `Number()` an amount to compute with it.
- **Act on error `code`s, show `fix` to the developer**, never parse
  `message` or `detail`.
- **Webhooks are at least once, in any order:** keep handlers idempotent;
  reconcile by `updatedAt`; answer within 10 seconds.
- **Writes go through `admin.post/put/patch/delete`**, which send an
  `Idempotency-Key`; pass your own key when the write stands for one business
  action (`confirm-${orderId}`).
- **The manifest and the code change together.** A new scope, topic, host or
  app data key is a manifest change: `npm run validate`, upload the new
  version in the developer console, accept the update in the dev store.
- **Never commit** `.env`, `data/` or anything with a credential.
  `.env.example` holds placeholders only.

## Recipes

**Call another Admin API route.** Add a route under `/api/` in `src/app.ts`
and call `c.get('admin').get('/products', { query: { limit: 20 } })` (typed:
your editor completes paths, parameters and fields). Add the scope it needs
to `[access]` with a reason. Errors reach the page as
`{ code, message, fix }` through `app.onError`.

**Handle another webhook topic.** Add it to `topics` in `tassyir.app.toml`
(with the scope it needs), add a `case` in `handleEvent` (`event.data` is
typed per topic), add a spec in `test/webhooks.test.ts` that sends a signed
delivery (`delivery(keys, envelope('orders/delivered', { order }))`).

**Keep a value in Tassyir (app data).** Declare the key in
`[[data.definitions]]`, then `admin.put('/data/{ownerType}/{ownerId}/{key}',
{ path, body: { value } })`. A missing value is 404 `NOT_FOUND`.

**Use the dashboard from the page.** `bridge.toast.show`,
`bridge.navigate({ dashboard: 'order', id })`, `bridge.resource.pick({
type: 'product' })`, `bridge.saveBar.*`: see the skill and
`@tassyir/app-bridge`'s README. Call the server through `api()` in
`src/page/app.ts`, which adds a fresh ID token.

**Run several processes or use a database.** Replace `FileStore` with a
class implementing `AppStore` on your database (keep the `TokenStore`
contract: `set` durable when it resolves, `get` returns the latest `set`),
and pass a `RefreshLock` to `createTassyirApp`.

**Go headless (no page).** Remove `[admin]`, add `[auth] callback_url`, and
a route that redeems the code: `await tassyir.redeemInstallCode(code)` (5
minutes, one use) when the merchant's browser lands there after the install.

## Tests

`npm test` runs without a network or an account: `test/helpers.ts` makes
Ed25519 keys per run, signs deliveries and ID tokens the way Tassyir does,
and serves a fake Tassyir API through the SDK's `fetch` option. Use them for
every route and topic you add. Every id in the tests is made up; never paste
a real token, secret or business id into a test.

## References

- `@tassyir/app`, `@tassyir/app-bridge`, `@tassyir/app-manifest`: their
  READMEs in `node_modules/@tassyir/*/README.md`, or
  https://github.com/tassyir/apps-sdk.
- The developer console: https://app.tassyir.io/en/developers.
