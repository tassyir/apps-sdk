# create-tassyir-app

## 0.2.2

### Patch Changes

- 0cfc8d0: The hosted template's `npm run deploy:check` builds the page, then runs `tassyir deploy --dry-run` (the checks `tassyir deploy` runs before it uploads, no sign-in, nothing sent); its `scripts/deploy-check.ts` is gone.
- Updated dependencies [0cfc8d0]
  - @tassyir/app-manifest@0.3.1

## 0.2.1

### Patch Changes

- 492bb64: New projects name `@tassyir/app-manifest`'s release with the marketplace's manifest fields (storefront blocks and their settings, data labels, admin actions, the app proxy).
- Updated dependencies [492bb64]
  - @tassyir/app-manifest@0.3.0

## 0.2.0

### Minor Changes

- acb578f: The `hosted` template is available (`--template hosted`): an app on Tassyir Hosting, a Cloudflare Worker (Hono) that reads its installation, its own SQLite storage and the Admin API from `ctx.props`, a React page on `@tassyir/app-bridge/react` and `@tassyir/ui` (ar/en, right to left, dark), webhooks through `verifyHostedWebhook`, specs in workerd with stand-in `ctx.props`, `npm run deploy:check` (the checks `tassyir deploy` runs before it uploads) and `npm run deploy`. `--url` is refused for it (`OPTION_NOT_FOR_TEMPLATE`), a hosted project names `tassyir` among its dependencies, the `tassyir-app` skill covers both hosting modes, and `createProject`'s `dependencies` name only what the template's `package.json` does.

### Patch Changes

- 86ab80c: New projects name `@tassyir/app-manifest`'s release with the `MANIFEST_PATH_RESERVED` rule (a hosted app's page or webhook under `/.tassyir/`).
- 0834ea6: The `external` template's `PUT /api/settings` answers 400 `SETTINGS_INVALID` for a `highlightFrom` string that is not an amount (`"5000.001"`, `"abc"`), as the `hosted` template does. It used to read such a string as `null` and clear the saved setting.
- Updated dependencies [86ab80c]
  - @tassyir/app-manifest@0.2.0

## 0.1.1

### Patch Changes

- f5a07cb: The starter's page is drawn with `@tassyir/ui` (a new dev dependency of generated projects, `^0.1.0`), so it reads as part of the dashboard: the pending orders in a `<tsy-table>` with a `<tsy-status-pill>` for the high-value ones, the setting in a `<tsy-card>` with a `<tsy-text-field>` (its error shown on the field), a skeleton while it loads and an empty state. `followDashboardContext` replaces the page's own context code, and the template's `app.css` is gone (the few layout rules are a constructable stylesheet, so the page keeps `style-src 'self'`). Amounts read as the dashboard writes them (`DZD 7,500`, `7.500 دج`) through a new `formatAmount` in `src/shared/money.ts`. `AGENTS.md`, the README and the `tassyir-app` skill say how to build on it.
- b146c8c: New projects point at the docs site, `https://developers.tassyir.io`: `AGENTS.md` lists it (the guides, the Admin API reference, a page per error code and per package, `llms.txt`) in place of the GitHub repository, the `tassyir-app` skill adds it to its addresses and says that a problem's `type` is the error code's page, and the README links it.

## 0.1.0

### Minor Changes

- fcd2e73: First release: `npm create tassyir-app@latest` starts a Tassyir app on the developer's own server (template `external`): a Node 22 server on Hono, the embedded page on `@tassyir/app-bridge`, token exchange and the Admin API through `@tassyir/app` with an encrypted file token store, a webhook endpoint that verifies the raw body, a `tassyir.app.toml` checked by `@tassyir/app-manifest` (a script and a test), `.env.example` with placeholders, specs against a fake Tassyir API, and `AGENTS.md`, `CLAUDE.md` and a `tassyir-app` Claude Code skill. Name, handle and URL are checked with the manifest's own rules before anything is written; `--json` prints the result or the error with its code and fix. The `hosted` template (Tassyir Hosting) answers `TEMPLATE_NOT_AVAILABLE` until Tassyir Hosting opens.

### Patch Changes

- Updated dependencies [0ccfe1d]
  - @tassyir/app-manifest@0.1.0
