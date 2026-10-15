---
'@tassyir/app-manifest': patch
---

`MANIFEST_HOST_NOT_ALLOWED`'s fix for a Tassyir host says a hosted app calls Tassyir through `ctx.props.TASSYIR` (a hosted Worker's `env` is empty).
