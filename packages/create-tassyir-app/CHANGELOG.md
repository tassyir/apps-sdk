# create-tassyir-app

## 0.1.0

### Minor Changes

- fcd2e73: First release: `npm create tassyir-app@latest` starts a Tassyir app on the developer's own server (template `external`): a Node 22 server on Hono, the embedded page on `@tassyir/app-bridge`, token exchange and the Admin API through `@tassyir/app` with an encrypted file token store, a webhook endpoint that verifies the raw body, a `tassyir.app.toml` checked by `@tassyir/app-manifest` (a script and a test), `.env.example` with placeholders, specs against a fake Tassyir API, and `AGENTS.md`, `CLAUDE.md` and a `tassyir-app` Claude Code skill. Name, handle and URL are checked with the manifest's own rules before anything is written; `--json` prints the result or the error with its code and fix. The `hosted` template (Tassyir Hosting) answers `TEMPLATE_NOT_AVAILABLE` until Tassyir Hosting opens.

### Patch Changes

- Updated dependencies [0ccfe1d]
  - @tassyir/app-manifest@0.1.0
