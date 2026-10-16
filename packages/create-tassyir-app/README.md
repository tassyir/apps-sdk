# create-tassyir-app

Starts a [Tassyir](https://tassyir.io) app, on your own server (the
`external` template, the default) or on Tassyir Hosting (`hosted`: Tassyir
runs it, no server). Either project uses the app contract end to end: the
manifest, an embedded page in the dashboard, the Admin API and webhooks. It
is ready for AI coding agents: an `AGENTS.md`, a `CLAUDE.md` and a Claude
Code skill (`tassyir-app`) that explains the contract, both hosting modes.

## Use

Node 22.18 or later:

```bash
npm create tassyir-app@latest my-app
```

It writes `my-app/` and prints the next steps. The project's README walks
the rest: for `external`, create the app in the developer console, upload the
manifest, create a dev store, run behind an https tunnel, and install; for
`hosted`, `tassyir app create`, `npm run deploy`, `tassyir store create`, and
install.

```bash
npm create tassyir-app@latest my-app -- --template hosted
```

With options (after `--`, which npm needs to pass them on):

```bash
npm create tassyir-app@latest my-app -- --handle review-requests --name "Review Requests" --json
```

| Option              | Meaning                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `--handle <handle>` | The app's handle: permanent and unique on Tassyir. Default: the folder's name.                         |
| `--name <name>`     | The display name. Default: the handle in words.                                                        |
| `--url <url>`       | `external` only: the server's public https address (`hosting.url`). Default: a placeholder to replace. |
| `--template <name>` | `external` (default, your own server) or `hosted` (Tassyir Hosting).                                   |
| `--install`         | Runs `npm install` in the new folder.                                                                  |
| `--json`            | Prints one JSON document, the result or the error, and never asks anything.                            |
| `-y`, `--yes`       | Never asks: uses the defaults.                                                                         |

The handle, name and URL are checked with the manifest's own rules
(`@tassyir/app-manifest`, the Tassyir API's validator) before anything is
written, and nothing is ever written into a folder that is not empty.

## The projects

`external`, your own server:

```
tassyir.app.toml        the manifest; npm run validate checks it with the API's validator
src/server.ts           Node 22 entry (Hono on @hono/node-server)
src/app.ts              routes: /health, /webhooks, /api/* (ID token → Admin API), the page
src/webhooks.ts         verifies deliveries on the raw body, dedupes on webhook-id
src/store.ts            the token store behind @tassyir/app's TokenStore: one file, tokens encrypted
src/page/               the embedded page on @tassyir/app-bridge and @tassyir/ui (ar/en, rtl, dark)
test/                   specs against a fake Tassyir API; no network, no account
AGENTS.md, CLAUDE.md, .claude/skills/tassyir-app/SKILL.md
```

Why Hono: it is built on the Web-standard `Request` and `Response`, like
`@tassyir/app` (fetch and WebCrypto only), so the same routes run on Node
today and on Cloudflare Workers, which Tassyir Hosting is built on. Node runs
the TypeScript as it is (type stripping, Node 22.18 and later), so the
server has no build step; esbuild bundles the page.

`hosted`, on Tassyir Hosting (a Cloudflare Worker that Tassyir runs for every
installation):

```
tassyir.app.toml        hosting.mode = "tassyir", allowed_hosts, the page, webhooks
src/worker.ts           what Tassyir runs: the routes with the built page inside, one ES module
src/app.ts              routes (Hono): ctx.props, /webhooks, /api/* (ctx.props.TASSYIR → Admin API), the page
src/storage.ts          ctx.props.STORAGE: the installation's own SQLite database
src/webhooks.ts         verifyHostedWebhook: the signature (keys through TASSYIR), this installation
src/page/               a React page on @tassyir/app-bridge/react and @tassyir/ui (ar/en, rtl, dark)
test/worker/            specs in workerd (Cloudflare's Vitest integration) with stand-in ctx.props
AGENTS.md, CLAUDE.md, .claude/skills/tassyir-app/SKILL.md
```

It holds no secret and no `.env`: a hosted app reads its installation, who
is looking, its storage and the Admin API from `ctx.props`, per request.
`npm run check` validates, typechecks, runs the specs and `deploy:check`
(`tassyir deploy --dry-run`: the bundle built and checked, nothing uploaded);
`npm run deploy` is `tassyir deploy`.

The generated `package.json` names the versions of this repo's packages
released with this version of `create-tassyir-app` (`@tassyir/*`, and
`tassyir` for `hosted`), and pins every other dependency to an exact
version.

## Errors

A refusal has a stable `code`, the input at fault (`path`: `--handle`,
`--url`, `directory`, …), a `message` and a one-sentence `fix`; `problems`
lists every problem found, this one first. With `--json`
(`npm create tassyir-app@latest my-app -- --handle tassyir --json`):

```json
{
  "ok": false,
  "error": {
    "code": "MANIFEST_HANDLE_RESERVED",
    "path": "--handle",
    "message": "`handle` is \"tassyir\", which Tassyir reserves.",
    "fix": "Choose another handle, e.g. \"tassyir-app\" or one naming what the app does.",
    "problems": [
      {
        "code": "MANIFEST_HANDLE_RESERVED",
        "path": "--handle",
        "message": "`handle` is \"tassyir\", which Tassyir reserves.",
        "fix": "Choose another handle, e.g. \"tassyir-app\" or one naming what the app does."
      }
    ]
  }
}
```

Codes: `TEMPLATE_UNKNOWN`, `TEMPLATE_NOT_AVAILABLE`,
`OPTION_NOT_FOR_TEMPLATE` (`--url` with `hosted`), `TARGET_NOT_EMPTY`,
`TARGET_NOT_A_DIRECTORY`, `INVALID_ARGUMENT`, `NODE_VERSION_UNSUPPORTED`,
`WRITE_FAILED`, `INSTALL_FAILED`, and the manifest's own codes for the
handle, name and URL (`MANIFEST_HANDLE_INVALID`, `MANIFEST_URL_INVALID`, …).

## From code

```ts
import { createProject, isCreateError } from 'create-tassyir-app';

try {
  const project = await createProject({
    directory: 'review-requests',
    name: 'Review Requests',
  });
  console.log(project.files.length, project.app.handle);
} catch (error) {
  if (isCreateError(error)) console.error(error.code, error.fix);
  else throw error;
}
```

## Contributing

In a clone of [tassyir/apps-sdk](https://github.com/tassyir/apps-sdk), CI
generates a project of each template with the packed CLI and checks it whole
(`npm run check:template`). The pages are also checked in a real browser,
locally:

```bash
npm run build && npm run check:template -- --keep
```

```bash
npm run browser-check -w create-tassyir-app -- <the folder it kept> --out shots
```

```bash
npm run browser-check -w create-tassyir-app -- <the folder it kept> --template hosted --out shots
```

It starts the project's own server (its real Content-Security-Policy; for
`hosted`, the Worker's routes run by Node with stand-in `ctx.props`),
frames the page in a fake dashboard at `https://app.tassyir.io` that answers
App Bridge, answers the page's `/api` calls with sample orders, and drives a
headless Chrome over the DevTools protocol. It checks the page in Arabic and
English, light and dark, at 390 and 1440 px (`lang`, `dir` and theme, the
frame's width, no error and no CSP violation, the title bar), then the save
bar, a field error, a save (with a fresh ID token; the hosted page sends
none), Open, a live change of
language and theme, and the empty state, with a screenshot of each in
`--out`. It needs `openssl`; `CHROME_PATH` names a Chrome other than macOS
Google Chrome.

## License

MIT
