# create-tassyir-app

Starts a [Tassyir](https://tassyir.io) app. The project it writes runs on
your own server and uses every part of the app contract: the manifest, an
embedded page in the dashboard, token exchange and the Admin API, signed
webhooks and app data. It is ready for AI coding agents: an `AGENTS.md`, a
`CLAUDE.md` and a Claude Code skill (`tassyir-app`) that explains the
contract.

## Use

Node 22.18 or later:

```bash
npm create tassyir-app@latest my-app
```

It writes `my-app/` and prints the next steps. The project's README walks
the rest with today's tools: create the app in the developer console, upload
the manifest, create a dev store, run behind an https tunnel, and install.

With options (after `--`, which npm needs to pass them on):

```bash
npm create tassyir-app@latest my-app -- --handle review-requests --name "Review Requests" --json
```

| Option              | Meaning                                                                               |
| ------------------- | ------------------------------------------------------------------------------------- |
| `--handle <handle>` | The app's handle: permanent and unique on Tassyir. Default: the folder's name.        |
| `--name <name>`     | The display name. Default: the handle in words.                                       |
| `--url <url>`       | The server's public https address (`hosting.url`). Default: a placeholder to replace. |
| `--template <name>` | `external` (default). `hosted` (Tassyir Hosting) is not available yet.                |
| `--install`         | Runs `npm install` in the new folder.                                                 |
| `--json`            | Prints one JSON document, the result or the error, and never asks anything.           |
| `-y`, `--yes`       | Never asks: uses the defaults.                                                        |

The handle, name and URL are checked with the manifest's own rules
(`@tassyir/app-manifest`, the Tassyir API's validator) before anything is
written, and nothing is ever written into a folder that is not empty.

## The project

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

The generated `package.json` names the `@tassyir/*` versions released with
this version of `create-tassyir-app`, and pins every other dependency to an
exact version.

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

Codes: `TEMPLATE_UNKNOWN`, `TEMPLATE_NOT_AVAILABLE`, `TARGET_NOT_EMPTY`,
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

## Tassyir Hosting

A second template, an app on Tassyir Hosting (Hono and React, no server to
run), comes once Tassyir Hosting opens. Until then `--template hosted`
answers `TEMPLATE_NOT_AVAILABLE`. Apps made from the external template move
to it with the same manifest, API and webhooks: their routes are
Web-standard.

## Contributing

In a clone of [tassyir/apps-sdk](https://github.com/tassyir/apps-sdk), CI
generates a project with the packed CLI and checks it whole
(`npm run check:template`). The page is also checked in a real browser,
locally:

```bash
npm run build && npm run check:template -- --keep
```

```bash
npm run browser-check -w create-tassyir-app -- <the folder it kept> --out shots
```

It starts the project's own server (its real Content-Security-Policy),
frames the page in a fake dashboard at `https://app.tassyir.io` that answers
App Bridge, answers the page's `/api` calls with sample orders, and drives a
headless Chrome over the DevTools protocol. It checks the page in Arabic and
English, light and dark, at 390 and 1440 px (`lang`, `dir` and theme, the
frame's width, no error and no CSP violation, the title bar), then the save
bar, a field error, a save with a fresh ID token, Open, a live change of
language and theme, and the empty state, with a screenshot of each in
`--out`. It needs `openssl`; `CHROME_PATH` names a Chrome other than macOS
Google Chrome.

## License

MIT
