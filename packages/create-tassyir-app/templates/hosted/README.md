# My Tassyir App

A [Tassyir](https://tassyir.io) app on **Tassyir Hosting**: Tassyir runs it as
a Cloudflare Worker for every business that installs it, so there is no
server to run. A React page inside the Tassyir dashboard, its own SQLite
storage, the Tassyir Admin API and webhooks. It shows a business's pending
orders and keeps one setting, as a starting point. Made with
`create-tassyir-app --template hosted`.

Working with an AI coding agent? It reads [AGENTS.md](AGENTS.md) (Claude Code
through [CLAUDE.md](CLAUDE.md)) and the `tassyir-app` skill in
[.claude/skills](.claude/skills/tassyir-app/SKILL.md).

The developer docs, from the manifest to every error code:
[developers.tassyir.io](https://developers.tassyir.io).

## What you need

- Node 22.18 or later.
- A Tassyir account (https://app.tassyir.io).
- Tassyir Hosting open on the API you deploy to. Until it opens there,
  `npm run deploy` answers `APP_HOSTING_NOT_AVAILABLE`; everything else here
  (the tests, `npm run deploy:check`) works offline.

## Check it

```bash
npm install
```

```bash
npm run check
```

`check` validates the manifest, typechecks, runs the specs (the Worker in
workerd, the Workers runtime, with stand-ins for what Tassyir passes it), and
runs `deploy:check`: the page is built, the Worker bundled the way Tassyir
Hosting runs it, and held to the same rules `tassyir deploy` checks before it
uploads. Nothing leaves your machine.

## Run it on a dev store

The `tassyir` CLI (a dev dependency here) does every step but the install.

### 1. Sign in

```bash
npx tassyir login
```

It prints a code and opens the approval page in the dashboard (turn on
developer mode there first: https://app.tassyir.io/en/developers).

### 2. Create the app

```bash
npx tassyir app create
```

It reads the handle, the name and the hosting mode from `tassyir.app.toml`.
The handle (`my-tassyir-app`) is permanent and unique on Tassyir, and the app
is served at `https://my-tassyir-app.tassyir-apps.com`: change it in the file
first if you want another one. A hosted app has no client secret to keep and
no `.env`.

### 3. Deploy

```bash
npm run deploy
```

`deploy` builds the page, bundles the Worker, checks it, uploads it with
`tassyir.app.toml` as a new version, and follows Tassyir's scan of it. A
version that passes is released; one held for a person says so
(`in_review`); a failed scan lists each finding, at its line in `src/`.
`npx tassyir app version <n> --follow` checks a version later.

### 4. Create a dev store

```bash
npx tassyir store create
```

A business for testing, seeded with products, about 200 orders and buyers
with fake phones. It never reaches the outside world.

### 5. Install the app on the dev store

On the app's **Overview** tab in the console, copy the install link, open it,
pick your dev store, and install. The dashboard then opens the app's page:
the pending orders of the dev store, and a setting kept in the app's own
storage, with the dashboard's save bar.

### 6. Watch webhooks

Create an order in the dev store's dashboard: the page then counts it ("1 new
order reached this app by webhook"). The console's **Webhook deliveries** tab
shows every attempt and replays one.

Whenever you change `tassyir.app.toml` (a scope, a webhook topic, an outside
host) or the code, `npm run deploy` again, then accept the update in the dev
store: Apps, Installed apps, Update.

## What is where

| Path               | What                                                         |
| ------------------ | ------------------------------------------------------------ |
| `tassyir.app.toml` | The manifest: scopes, hosting, page, webhooks                |
| `src/worker.ts`    | The Worker Tassyir runs: the routes and the built page       |
| `src/app.ts`       | Routes: `/webhooks`, `/api/*`, the page                      |
| `src/storage.ts`   | The app's SQLite storage (`ctx.props.STORAGE`)               |
| `src/webhooks.ts`  | Verifies and handles webhook deliveries                      |
| `src/page/`        | The page in the dashboard (React, App Bridge, `@tassyir/ui`) |
| `test/`            | Specs: the Worker in workerd, the manifest and money on Node |

| Script                 | What it does                                       |
| ---------------------- | -------------------------------------------------- |
| `npm run validate`     | Checks the manifest (`-- --json` for tools)        |
| `npm run typecheck`    | TypeScript                                         |
| `npm test`             | The specs                                          |
| `npm run build`        | Builds the page                                    |
| `npm run deploy:check` | The checks `tassyir deploy` runs, nothing uploaded |
| `npm run deploy`       | Deploys a new version                              |
| `npm run check`        | validate, typecheck, test, deploy:check            |

## When something fails

| You see                                                   | Do                                                                                                  |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `APP_HOSTING_NOT_AVAILABLE` on deploy                     | Tassyir Hosting is not open on that API yet; deploy later, or run the app on your own server.       |
| `BUNDLE_INVALID` (exit 4) on deploy:check/deploy          | Each problem names its line in `src/` and a fix: a `node:` import, a host not in `allowed_hosts`, … |
| `VERSION_SCAN_FAILED` on deploy                           | Tassyir's scan refused the version: fix each finding it lists, then deploy again.                   |
| The page says "Open this page from the Tassyir dashboard" | It runs outside the dashboard's frame: open it from Apps in the dashboard.                          |
| `HOSTED_PROPS_MISSING`                                    | The Worker ran outside Tassyir Hosting (no `ctx.props`); the specs use stand-ins.                   |
| `PERMISSION_DENIED`                                       | Add the scope its fix names to `[access]`, deploy, and accept the update.                           |
| A `fetch()` answers 403 `tassyir-egress-refused`          | Add the host to `hosting.allowed_hosts`, deploy, and accept the update.                             |
| `STORAGE_FULL`                                            | The app's storage holds 50 MB at most: delete rows it no longer needs.                              |
