---
'tassyir': minor
---

`tassyir deploy --dry-run` runs every check `deploy` runs before it uploads, with no sign-in and nothing sent: for an app on Tassyir Hosting the bundle built and held to the API's upload rules and the scan's code checks, for an app on your own server the manifest. Exit 0 when `deploy` would upload, 4 when it would refuse (`BUNDLE_INVALID`, `BUNDLE_BUILD_FAILED`, `MANIFEST_INVALID`); `--json` prints one document with `"dryRun": true` (and, hosted, `entry`, `main`, `bytes`, `lockfile`, `warnings`). `tassyir app init --template hosted` prints the hosted project's next steps (`npm run check`, `tassyir app create`, `npm run deploy`, `tassyir store create`) instead of the external starter's, and `tassyir app create` for a hosted app leaves `tassyir secrets create` out of its next steps (a hosted app needs no client secret). The `tassyir-host` finding and the `manifest_hosts` fix name `ctx.props.TASSYIR`, as the scan now does.
