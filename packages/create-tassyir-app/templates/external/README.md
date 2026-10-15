# My Tassyir App

A [Tassyir](https://tassyir.io) app that runs on your own server: a Node 22
server (Hono), a page inside the Tassyir dashboard, signed webhooks and the
Tassyir Admin API. It shows a business's pending orders and keeps one
setting, as a starting point. Made with `create-tassyir-app`.

Working with an AI coding agent? It reads [AGENTS.md](AGENTS.md) (Claude Code
through [CLAUDE.md](CLAUDE.md)) and the `tassyir-app` skill in
[.claude/skills](.claude/skills/tassyir-app/SKILL.md).

## What you need

- Node 22.18 or later.
- A Tassyir account (https://app.tassyir.io).
- A tunnel that gives your laptop a public **https** address on port 443,
  such as [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)
  or [ngrok](https://ngrok.com). Tassyir only calls https addresses on port
  443 with a public hostname: never `localhost`, an IP address or a port.

## Run it on a dev store

Tassyir's command-line tool is not out yet, so these steps use the developer
console in the dashboard.

### 1. Install and set up

```bash
npm install
```

```bash
npm run setup
```

`setup` writes `.env` from `.env.example` with a new random
`TOKEN_STORE_KEY` (it encrypts the tokens the app stores).

### 2. Give your server a public address

Start the tunnel to port 3000 and keep it running, for example:

```bash
cloudflared tunnel --url http://localhost:3000
```

Copy the https address it prints (`https://<random>.trycloudflare.com`) into
`hosting.url` in `tassyir.app.toml` (no trailing `/`), then check the
manifest:

```bash
npm run validate
```

A quick tunnel's address changes every time it starts, and each change means
a new version of the manifest and a new consent (step 7). A tunnel that keeps
its hostname (a Cloudflare named tunnel on your own domain, a reserved ngrok
domain) saves that.

### 3. Create the app in the developer console

1. Open https://app.tassyir.io/en/developers and turn on developer mode.
2. **Create an app**: choose "Your own server". The handle must be exactly the
   one in `tassyir.app.toml` (`my-tassyir-app`); it is permanent and unique on
   Tassyir, so change it in the file first if you want another one.
3. In the app's **Credentials** tab, create a secret. It is shown once.
4. Fill in `.env`:
   - `TASSYIR_CLIENT_ID`: the client ID (`app_…`), on the Credentials tab;
   - `TASSYIR_CLIENT_SECRET`: the secret (`tsy_cs_…`);
   - `TASSYIR_APP_ID`: the app's numeric id, the number at the end of the
     app's address in the console (`/developers/apps/<id>`). Webhooks name
     it; it is not the client ID.
5. In the **Versions** tab, upload `tassyir.app.toml`. The version is
   approved and current at once.

### 4. Create a dev store

In the console's home, open **Dev stores** and create one. A dev store is a
business for testing, seeded with products, about 200 orders and buyers with
fake phones. It costs nothing and never reaches the outside world: carriers,
ad pixels, WhatsApp and payments are switched off, and its storefront takes
no orders.

### 5. Start the server

```bash
npm run dev
```

It listens on http://localhost:3000, restarts when `src/` changes, and
rebuilds the page. If a setting is missing, it says which one and how to fix
it.

### 6. Install the app on the dev store

On the app's **Overview** tab in the console, copy the install link, open it,
pick your dev store, and install. The dashboard then opens the app's page: the
pending orders of the dev store, and a setting kept in Tassyir (app data) with
the dashboard's save bar.

### 7. Watch webhooks

Create an order in the dev store's dashboard: the server logs
`orders/created`. The console's **Installs** tab sends a test delivery; its
**Webhook deliveries** tab shows every attempt and replays one.

Whenever you change `tassyir.app.toml` (a scope, a webhook topic, the
address), run `npm run validate`, upload it as a new version, then accept the
update in the dev store: Apps, Installed apps, Update.

## What is where

| Path               | What                                                    |
| ------------------ | ------------------------------------------------------- |
| `tassyir.app.toml` | The manifest: scopes, address, page, webhooks, app data |
| `src/app.ts`       | Routes: `/health`, `/webhooks`, `/api/*`, the page      |
| `src/webhooks.ts`  | Verifies and handles webhook deliveries                 |
| `src/store.ts`     | Tokens (encrypted), installations, handled deliveries   |
| `src/page/`        | The page in the dashboard (App Bridge, `@tassyir/ui`)   |
| `test/`            | Specs, with a fake Tassyir API (no network)             |

| Script              | What it does                                |
| ------------------- | ------------------------------------------- |
| `npm run dev`       | Server and page, reloaded on change         |
| `npm run validate`  | Checks the manifest (`-- --json` for tools) |
| `npm run typecheck` | TypeScript                                  |
| `npm test`          | The specs                                   |
| `npm run build`     | Builds the page                             |
| `npm start`         | Runs the server in production               |
| `npm run check`     | All of the above but `dev` and `start`      |

## Deploy

Any host that runs Node 22.18 or later behind https on port 443 works. On the
host: `npm ci`, `npm run build`, then `npm start` with the four variables of
`.env` set in its environment (never upload `.env` itself). Set `hosting.url`
to the host's address, upload the manifest, and accept the update.

The store is one file in `DATA_DIR` (`data/` by default): keep it on a
persistent disk and run **one** process. To run several, keep the tokens in a
database instead (AGENTS.md, "Run several processes").

## When something fails

| You see                                                   | Do                                                                                                 |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `CONFIG_MISSING`, `CONFIG_PLACEHOLDER` at start           | Fill in `.env` (step 3); the message names the variable and where to find it.                      |
| The page says "Open this page from the Tassyir dashboard" | It runs outside the dashboard's frame: open it from Apps in the dashboard.                         |
| The dashboard says the app did not load                   | Is the tunnel up, and is its address the manifest's `hosting.url`, uploaded and accepted (step 7)? |
| `ID_TOKEN_UNAVAILABLE` in the browser console             | Tassyir cannot sign ID tokens on that environment right now; nothing in the app can fix it.        |
| `invalid_client`                                          | Check the client ID and secret; a revoked secret, or one rotated more than 24 hours ago, fails.    |
| `PERMISSION_DENIED`                                       | Add the scope its fix names to `[access]`, upload, and accept the update.                          |
| Webhooks answered 400 `WEBHOOK_WRONG_APP`                 | `TASSYIR_APP_ID` must be the numeric app id, not the client ID.                                    |
| Webhooks answered 400 `WEBHOOK_UNKNOWN_INSTALLATION`      | Open the app's page once (or wait for `app/installed`): Tassyir retries the delivery.              |

## Tassyir Hosting

Tassyir Hosting (apps that run on Tassyir, no server to manage) is not open
yet. When it opens, this app moves with the same manifest, API and webhooks:
`src/app.ts` and `src/webhooks.ts` are Web-standard (Hono runs on Workers);
only `src/server.ts` and the store change.
