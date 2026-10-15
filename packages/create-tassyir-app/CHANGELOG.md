# create-tassyir-app

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
