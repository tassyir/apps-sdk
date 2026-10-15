# Tassyir Apps SDK

Packages for building apps on [Tassyir](https://tassyir.io). Merchants install
these apps. An app calls the Tassyir Admin API, receives signed webhooks, and
shows pages inside the Tassyir dashboard. It runs on the developer's own server
or on Tassyir Hosting. Either way it uses the same manifest, API and events.

**Status: in development.** This repo has its workspace, CI and release
pipeline (AP-K1.1). On npm since 0.1.0: `@tassyir/app-manifest` (AP-K1.2),
`@tassyir/app` (AP-K1.3), `@tassyir/app-bridge` (AP-K1.4), the `tassyir` CLI
(AP-K1.6) and `create-tassyir-app` (AP-K1.7). `@tassyir/dev-mcp` (AP-K1.8)
has its first release, 0.1.0, from the Version Packages PR of 2026-10-15.
Each package's CHANGELOG says what each version changed. The other packages
arrive one ticket at a time.

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

[`packages/app-bridge`](packages/app-bridge) (AP-K1.4). The embedded page's
side of the dashboard bridge. An app page runs inside the Tassyir dashboard
and talks to it through `postMessage`, to the dashboard's exact origin only.
With this package it can get an ID token, show toasts and modals, use the save
bar and title bar, navigate, pick products, collections or customers, and
follow locale, direction (RTL or LTR) and theme changes. Every refusal is a
typed error with a stable code and a fix. The dashboard never sends the page a
Tassyir credential: the ID token, verified on the app's server with
`@tassyir/app`, is the only proof of who is looking. Browser only, ESM only,
no runtime dependency.

### `@tassyir/ui`

_Planned: AP-K1.5._ Web components that look like the Tassyir dashboard, built
from its design tokens, with right-to-left layouts and dark mode. They work in
any framework, or none.

### `tassyir`

[`packages/cli`](packages/cli) (AP-K1.6). The developer CLI. `tassyir login`
signs in with a code you approve in the dashboard (the OAuth device grant)
and keeps a developer token that works on the developer API only, in the OS
keychain when one answers, otherwise in a file only you can read; it is never
printed. Then: `app init` (the starter), `app create`, `app list`, `validate`
(offline, the API's own validator), `deploy` (the manifest as a new version),
`secrets create | rotate | revoke` (a secret is shown once, or written to
`.env` only when asked), `store create | list` (seeded dev stores), and
`webhook trigger | deliveries | replay`. `dev` prints the checklist for now;
`logs --tail` waits for Tassyir Hosting and `submit` for the marketplace.
Every command prints `--json`, every error has a stable `code` and a `fix`,
and the exit codes are documented. Published to npm only.

### `create-tassyir-app`

[`packages/create-tassyir-app`](packages/create-tassyir-app) (AP-K1.7). The
starter: `npm create tassyir-app@latest my-app`. Its one template today,
`external`, is an app on your own server: Node 22 and Hono, the embedded page
on `@tassyir/app-bridge`, token exchange and the Admin API through
`@tassyir/app` with an encrypted file token store, a webhook endpoint that
verifies the raw body, and a `tassyir.app.toml` that `@tassyir/app-manifest`
validates. It comes with an `AGENTS.md`, a `CLAUDE.md` and a `tassyir-app`
Claude Code skill that explains the contract, and with specs against a fake
Tassyir API. The project's README walks the real path: the developer console,
a dev store, an https tunnel, the install. The `hosted` template (Hono and
React on Tassyir Hosting) comes once Tassyir Hosting opens. CI generates a
project with the packed CLI, then installs, typechecks, tests, builds and
starts it (`npm run check:template`). Published to npm only.

### `@tassyir/dev-mcp`

[`packages/dev-mcp`](packages/dev-mcp) (AP-K1.8). An MCP server, over stdio,
for the AI coding agent that builds a Tassyir app:
`claude mcp add tassyir -- npx -y @tassyir/dev-mcp`. Offline, from the guides
and the OpenAPI document it ships with: `search_docs`, `fetch_doc`,
`get_api_operation`, `get_event_schema`, and `validate_manifest` (the API's
own validator). `scaffold` writes a new app from `create-tassyir-app`.
`trigger_test_webhook`, `seed_dev_store` and `list_dev_stores` call the
developer API with the sign-in of `tassyir login`, whose token never appears
in an answer. `validate_block`, `tail_logs` and `run_review_checks` are listed
and answer that they are not available yet (the marketplace, Tassyir
Hosting). Every tool has a JSON Schema input and output, every answer is at
most 8 KB, and every refusal of a well-formed call has a `code` and a `fix`. A Claude Code plugin
comes later.

## Developer guides

[docs/guides](docs/guides/index.md) (AP-B1.17): one guide per topic, from
getting started to webhooks, the Admin API's conventions, every resource, dev
stores and compliance, plus an error reference generated from the OpenAPI
document. Every code sample is typechecked against the packed packages. The
developer docs site, with Markdown mirrors, `llms.txt` and `llms-full.txt`,
will publish them at [developers.tassyir.io](https://developers.tassyir.io)
(AP-K1.9).

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
