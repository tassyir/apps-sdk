---
'@tassyir/app-manifest': patch
---

The 2026-10 vocabulary gains the webhook topic `bulk/finished` (a bulk export your installation asked for is done or failed; no scope needed), as the Tassyir API accepts it, and the published JSON Schema follows (`webhooks[].topics` lists 20 topics).
