# Tassyir Apps SDK

Packages for building apps on [Tassyir](https://tassyir.io). Merchants install
these apps. An app calls the Tassyir Admin API, receives signed webhooks, and
shows pages inside the Tassyir dashboard. It runs on the developer's own server
or on Tassyir Hosting. Either way it uses the same manifest, API and events.

**Status: in development. Nothing is published yet.** This repo has its
workspace, CI and release pipeline (AP-K1.1) and its first package,
`@tassyir/app-manifest` (AP-K1.2), whose first release (0.1.0) is pending. The
other packages arrive one ticket at a time.

Packages are published to the public npm registry under the `@tassyir` scope.
Each scoped package is also published, same version and same tarball, to
GitHub Packages, for Tassyir's own repositories. See
[docs/RELEASING.md](docs/RELEASING.md).

## Packages

### `@tassyir/app-manifest`

[`packages/app-manifest`](packages/app-manifest) (AP-K1.2). The schema and
validator for `tassyir.app.toml`, the app manifest (v1, API version
`2026-10`). Give it the parsed manifest. It returns either the normalised
manifest or every error at once. Each error carries a stable `code`, the `path`
of the field, a `message`, and a one-sentence `fix`. The package ships the
published JSON Schema and the vocabulary it validates against (API versions,
scopes, webhook topics). It is the Tassyir API's own validator, so the CLI and
the server agree; [docs/APP_MANIFEST.md](docs/APP_MANIFEST.md) says how that
is checked. Ships as ESM and CommonJS.

### `@tassyir/app`

[`packages/app`](packages/app) (AP-K1.3). The server side of an app. No
runtime dependency: it runs on Node 22 and on Workers-like runtimes. It
provides:

- token exchange (ID token, install code) and refresh, with a store you
  provide and a lock so that only one refresh runs at a time;
- verification of the ID token that the dashboard hands to an embedded page
  (Ed25519, keys from the JWKS);
- webhook verification: Standard Webhooks headers and Ed25519 `v1a`
  signatures, checked against Tassyir's published keys, then the envelope's
  app and installation;
- a typed Admin API client (`https://api.tassyir.io/apps/2026-10/`), generated
  from the API's OpenAPI 3.1 document, with typed errors, opt-in retries,
  idempotency keys and pagination.

Helpers for apps on Tassyir Hosting come once that hosting exists.

### `@tassyir/app-bridge`

_Planned: AP-K1.4._ The embedded page's side of the dashboard bridge. An app
page runs inside the Tassyir dashboard and talks to it through `postMessage`.
With this package it can get an ID token, show toasts and modals, use the save
bar and title bar, navigate, pick products, collections or customers, and
follow locale, direction (RTL or LTR) and theme changes. The dashboard never
sends the page a Tassyir credential.

### `@tassyir/ui`

_Planned: AP-K1.5._ Web components that look like the Tassyir dashboard, built
from its design tokens, with right-to-left layouts and dark mode. They work in
any framework, or none.

### `tassyir`

_Planned: AP-K1.6._ The CLI: `login`, `app init`, `dev`, `validate`, `deploy`,
`logs --tail`, `webhook trigger`, `store seed` and `submit`. Every command can
print `--json`, and every error says how to fix it (RFC 9457 problem details
with a `fix`). Published to npm only.

### `create-tassyir-app`

_Planned: AP-K1.7._ Starter templates, run with `npm create tassyir-app`. One
starter is hosted on Tassyir Hosting (Hono + React). The other runs on your own
server (Node). Each comes with an `AGENTS.md`, a `CLAUDE.md` and a Tassyir skill
for AI coding agents. Published to npm only.

### `@tassyir/dev-mcp`

_Planned: AP-K1.8._ An MCP server for AI coding agents that build Tassyir apps.
It can search and fetch the developer docs, look up an API operation or an
event schema, validate a manifest or a storefront block, scaffold an app,
trigger a test webhook, tail logs, seed a dev store and run the review checks.
It comes with a Claude Code plugin.

The developer docs, with Markdown mirrors, `llms.txt` and `llms-full.txt`,
will be at [developers.tassyir.io](https://developers.tassyir.io) (AP-K1.9).

## Contributing

Read [AGENTS.md](AGENTS.md) first. It covers setup, commands, the module
format, how to add a package, and the rules of a public repo. You need Node 22,
then:

```bash
npm ci
```

```bash
npm run verify
```

## License

[MIT](LICENSE)
