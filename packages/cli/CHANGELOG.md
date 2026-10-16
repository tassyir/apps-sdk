# tassyir

## 0.4.0

### Minor Changes

- 0cfc8d0: `tassyir deploy --dry-run` runs every check `deploy` runs before it uploads, with no sign-in and nothing sent: for an app on Tassyir Hosting the bundle built and held to the API's upload rules and the scan's code checks, for an app on your own server the manifest. Exit 0 when `deploy` would upload, 4 when it would refuse (`BUNDLE_INVALID`, `BUNDLE_BUILD_FAILED`, `MANIFEST_INVALID`); `--json` prints one document with `"dryRun": true` (and, hosted, `entry`, `main`, `bytes`, `lockfile`, `warnings`). `tassyir app init --template hosted` prints the hosted project's next steps (`npm run check`, `tassyir app create`, `npm run deploy`, `tassyir store create`) instead of the external starter's, and `tassyir app create` for a hosted app leaves `tassyir secrets create` out of its next steps (a hosted app needs no client secret). The `tassyir-host` finding and the `manifest_hosts` fix name `ctx.props.TASSYIR`, as the scan now does.

### Patch Changes

- Updated dependencies [0cfc8d0]
- Updated dependencies [0cfc8d0]
  - create-tassyir-app@0.2.2
  - @tassyir/app-manifest@0.3.1

## 0.3.1

### Patch Changes

- Updated dependencies [492bb64]
- Updated dependencies [492bb64]
  - @tassyir/app-manifest@0.3.0
  - create-tassyir-app@0.2.1

## 0.3.0

### Minor Changes

- 86ab80c: `tassyir deploy` follows the API's hosting rules at backend `46a49b6b`. A bundle path is "in more than 9 folders" (the same limit, named by what it counts), and `HOSTED_BUNDLE_LIMITS.maxPathDepth` is now `maxFolders: 9` (breaking for code that reads it). A `node:` import and an entry with no `fetch` handler are the scan's own rules now; a default re-exported from another module (`export { default } from './app.js'`) passes, as in the scan. A `CLOUDFLARE_REJECTED` version prints what Cloudflare answered (`refusal`: its code and cleaned message) in the error and under the uploads of `tassyir app version`, and a hosted upload refused 413 keeps the API's own `fix` (`hostingAvailable`, `limitBytes`). `BUNDLE_TASSYIR_HOST`'s fix names `ctx.props.TASSYIR`. The developer API types carry `refusal` on every deploy state. The manifest check refuses a hosted app's page or webhook under `/.tassyir/` (`MANIFEST_PATH_RESERVED`).

### Patch Changes

- Updated dependencies [acb578f]
- Updated dependencies [86ab80c]
- Updated dependencies [86ab80c]
- Updated dependencies [0834ea6]
  - create-tassyir-app@0.2.0
  - @tassyir/app-manifest@0.2.0

## 0.2.0

### Minor Changes

- 2c0bbe7: The developer API client is typed from the API's own OpenAPI document (`developer/*`, vendored at backend `08da6223`) instead of hand-written types. The commands, their flags, their `--json` output and exit codes are unchanged; a refusal without a code still reads as `BAD_REQUEST`, `RATE_LIMITED` or `SERVER_ERROR` by status. For code that imports the library entry, the exported types are now the document's: `DeveloperApp.status` and `hostingMode` are strings, a replay's `outcome` may be `missing`, a dev store's `store.subdomain` may be null, `testWebhook` and `listDeliveries` take a `WebhookTopic`, and `SignInRequest.locale` is `'ar' | 'en'`. New exports: `WebhookTopic`, `AppVersionDetail`, `DeveloperApiErrorBody`, and the generated `DeveloperApiPaths`, `DeveloperApiOperations` and `DeveloperApiComponents`.
- 7ad6134: `tassyir deploy` deploys an app on Tassyir Hosting (`hosting.mode = "tassyir"`). It builds the bundle with esbuild (0.28.2, now a dependency): one ES module from `--entry` or the first of `src/worker.ts`, `src/worker.js`, `src/index.ts`, `src/index.js`, ES2022, `.html` and `.css` imported as text. It checks it before anything is sent, by the API's own upload rules (the `BUNDLE_*` codes: text files of the allowed types, 100 files and 3 MB, safe paths, a `main` ES module, a lockfile of 1 MB) and the scan's code checks (no `node:` import, no `import()` of a run-time name, no code from strings, no request to a Tassyir domain or to a host outside `hosting.allowed_hosts`, a `fetch` handler exported), refusing with `BUNDLE_INVALID` (exit 4) and each problem's place in your source. It then uploads `{ manifest, bundle }` with the project's lockfile, and follows the version's scan until it is released (exit 0), held for a person (`in_review`, exit 0), failed with its findings (`VERSION_SCAN_FAILED`), or ended without a verdict (`SCAN_TIMED_OUT`, `SCAN_INCOMPLETE`, `SCAN_DISPATCH_FAILED`, `SCAN_RESULT_INVALID`, exit 5: upload the same bundle again). `--timeout <seconds>` (default 1800, `0` answers at once); Ctrl-C stops waiting and never the scan. With `--json` it prints the uploaded version first (`"step": "uploaded"`), then the verdict, with the version as the API reports it. `APP_VERSION_UNCHANGED` answers with that version's state; `APP_VERSION_CONFLICT`, `APP_HOSTING_NOT_AVAILABLE`, `APP_HOSTING_NOT_CONFIGURED` and `PAYLOAD_TOO_LARGE` come with a fix that names what to run. New command `tassyir app version [n]` shows one version (a hosted one with every check, finding and the AI review), `--follow` waits for its verdict. Exit code 4 now also means a bundle that does not build or pass, 5 a scan still running. The developer API types follow its OpenAPI document at backend `e6f930db` (`bundle` on an upload, `hosting` on every version, the hosting codes; the rate limit's bare-string refusal is the `RateLimitError` schema, formerly `ThrottlerError`, in `DeveloperApiErrorBody`). The library entry exports `validateHostedBundle`, `checkBundleCode` and `buildHostedBundle`; `CliIo` gains an optional `onInterrupt`, and `sleep` an optional `AbortSignal`.

### Patch Changes

- Updated dependencies [f5a07cb]
- Updated dependencies [b146c8c]
  - create-tassyir-app@0.1.1

## 0.1.0

### Minor Changes

- 7e69b87: First release: the Tassyir developer CLI. `tassyir login` signs in with the OAuth device grant (a code you approve in the dashboard) and keeps a developer token, valid on the developer API only, in the OS keychain when one answers (macOS `security`, Linux `secret-tool`) or else in a 0600 file; the token is never printed, and `TASSYIR_TOKEN` serves CI. Then `logout`, `whoami`, `app init` (the create-tassyir-app starter), `app create`, `app list`, `validate` (the API's own validator, offline), `deploy` (the manifest as a new version), `secrets list | create | rotate | revoke` (a secret is shown once, or written to `.env` with `--write-env`, never replacing a value silently), `store create | list` (seeded dev stores), `webhook trigger | deliveries | replay`, and `dev` (the checklist). `logs --tail` and `submit` answer `COMMAND_NOT_AVAILABLE` until Tassyir Hosting and the marketplace open. `--json` on every command; errors carry `{ code, message, fix }` and documented exit codes.

### Patch Changes

- Updated dependencies [0ccfe1d]
- Updated dependencies [fcd2e73]
  - @tassyir/app-manifest@0.1.0
  - create-tassyir-app@0.1.0
