---
'@tassyir/dev-mcp': minor
---

`validate_block` and `run_review_checks` are live (no longer `TOOL_NOT_AVAILABLE`). `validate_block` checks a storefront block offline with `@tassyir/storefront-blocks`, the API's upload check: every `[[storefront.blocks]]` entry of `tassyir.app.toml` with its files (or one, `block`), or a template given as text (`template`, `stylesheet`, `declaration`), each problem with its `code`, `path` (`file:line:column`) and `fix`; `preview` adds the sample render's HTML. `run_review_checks` runs the marketplace review's checklist as a dry run on the draft listing and latest version (the sign-in of `tassyir login`), waits up to `waitSeconds` and answers `passed`, the failed hard checks with their fix and every result; `runId` reads a run again. It never submits. `tail_logs` stays a seam.
