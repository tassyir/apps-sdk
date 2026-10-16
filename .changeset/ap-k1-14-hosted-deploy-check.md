---
'create-tassyir-app': patch
---

The hosted template's `npm run deploy:check` builds the page, then runs `tassyir deploy --dry-run` (the checks `tassyir deploy` runs before it uploads, no sign-in, nothing sent); its `scripts/deploy-check.ts` is gone.
