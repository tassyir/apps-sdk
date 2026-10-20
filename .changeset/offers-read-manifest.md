---
'@tassyir/app-manifest': minor
---

The `read_offers` scope (it implies no other) and the webhook topics `offers/created`, `offers/updated` and `offers/deleted`, which `read_offers` opens. `MANIFEST_VOCABULARY` and the published JSON Schema carry them (`access.scopes` and `access.optional_scopes` may now hold 18 names, and `webhooks[].topics` 23). Equal to the Tassyir API's catalogues: a manifest that asks for the scope or subscribes to a topic validates, and a topic without `read_offers` is `MANIFEST_TOPIC_SCOPE_MISSING`.
