---
'tassyir': minor
---

`tassyir deploy` follows the API's hosting rules at backend `46a49b6b`. A bundle path is "in more than 9 folders" (the same limit, named by what it counts), and `HOSTED_BUNDLE_LIMITS.maxPathDepth` is now `maxFolders: 9` (breaking for code that reads it). A `node:` import and an entry with no `fetch` handler are the scan's own rules now; a default re-exported from another module (`export { default } from './app.js'`) passes, as in the scan. A `CLOUDFLARE_REJECTED` version prints what Cloudflare answered (`refusal`: its code and cleaned message) in the error and under the uploads of `tassyir app version`, and a hosted upload refused 413 keeps the API's own `fix` (`hostingAvailable`, `limitBytes`). `BUNDLE_TASSYIR_HOST`'s fix names `ctx.props.TASSYIR`. The developer API types carry `refusal` on every deploy state. The manifest check refuses a hosted app's page or webhook under `/.tassyir/` (`MANIFEST_PATH_RESERVED`).
