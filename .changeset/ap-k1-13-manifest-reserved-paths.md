---
'@tassyir/app-manifest': minor
---

A hosted app (`hosting.mode = "tassyir"`) may not put `admin.page` or a webhook `uri` at `/.tassyir` or below it: on every hosted origin Tassyir answers those paths itself, so a page there would never load and a delivery there would never be made. The new error code is `MANIFEST_PATH_RESERVED` (`fix`: move it to a path outside `/.tassyir/`), and the prefix is exported as `HOSTED_RESERVED_PATH_PREFIX`. An app on its own server keeps the path (its origin is its own), and the JSON Schema is unchanged.
