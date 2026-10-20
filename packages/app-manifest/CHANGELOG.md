# @tassyir/app-manifest

## 0.4.0

### Minor Changes

- 79d20f8: The `read_offers` scope (it implies no other) and the webhook topics `offers/created`, `offers/updated` and `offers/deleted`, which `read_offers` opens. `MANIFEST_VOCABULARY` and the published JSON Schema carry them (`access.scopes` and `access.optional_scopes` may now hold 18 names, and `webhooks[].topics` 23). Equal to the Tassyir API's catalogues: a manifest that asks for the scope or subscribes to a topic validates, and a topic without `read_offers` is `MANIFEST_TOPIC_SCOPE_MISSING`.
- 1b2ca05: `write_offers` (it implies `read_offers`, and comes right after it in the scope order) and the `[[offers.types]]` section: the offer types an app lets the merchant create from it, each with a `handle` (`[a-z0-9][a-z0-9-]{0,39}`, unique), a `class` (`product`, `order` or `delivery`), a `path` (your page that configures one offer, at most 200 characters), a `label` and an optional `description` (`{ ar, en }`). At most 10, and declaring any needs `write_offers` (`MANIFEST_OFFER_TYPES_SCOPE_MISSING`). New error codes `MANIFEST_OFFER_TYPES_NOT_AVAILABLE`, `MANIFEST_OFFER_TYPES_SCOPE_MISSING`, `MANIFEST_OFFER_TYPE_HANDLE_INVALID`, `MANIFEST_OFFER_TYPE_HANDLE_DUPLICATE` and `MANIFEST_OFFER_TYPE_LABEL_INVALID`; the types `ManifestOfferType` and `ManifestOfferTypeClass` and the constants `OFFER_TYPE_CLASSES`, `OFFER_TYPE_HANDLE_PATTERN` and `OFFER_TYPES_SCOPE` are exported. The normalised manifest has an `offers` table only when it holds a type, and `MANIFEST_VOCABULARY` and the published JSON Schema carry the scope (`access.scopes` and `access.optional_scopes` may now hold 19 names) and the section.

## 0.3.1

### Patch Changes

- 0cfc8d0: `MANIFEST_HOST_NOT_ALLOWED`'s fix for a Tassyir host says a hosted app calls Tassyir through `ctx.props.TASSYIR` (a hosted Worker's `env` is empty).

## 0.3.0

### Minor Changes

- 492bb64: The marketplace's manifest fields (not live yet: the Tassyir API refuses them until the marketplace opens). `write_storefront` is now requestable (`MANIFEST_VOCABULARY`), and `[[storefront.blocks]]` takes `stylesheet`, `name`, `target` (`product` or `any`, default `any`), `data` (the app data keys the template reads, `<owner>.<key>`, declared with `storefront` visibility) and `[[storefront.blocks.settings]]` (`key`, `type` from `SETTING_TYPES`, `label`, and by type `default`, `options`, `min`, `max`, `max_length`). `[[data.definitions]]` takes a `label`, and `[[admin.actions]]` (`handle`, `target` from `ADMIN_ACTION_TARGETS`, `label`, `path`, at most 10) adds menu entries in the dashboard. `[app_proxy]` (`path`) is part of the shape but refused until the platform opens it (`MANIFEST_PROXY_NOT_AVAILABLE`): the vocabulary gains `appProxy: { available, unavailableReason? }` (a required field of `ManifestVocabulary`). Every label is `{ ar, en }` with the `name` rules. 23 new error codes, each with a `fix` (`MANIFEST_LIST_TOO_SHORT`, `MANIFEST_DATA_LABEL_INVALID`, `MANIFEST_BLOCK_*`, `MANIFEST_PROXY_*`, `MANIFEST_ACTION_*`); the JSON Schema is regenerated. The normalised manifest of a version without these fields is unchanged; a block always carries `target`, `data` (sorted) and `settings`, `admin.page` became optional (an app may have actions without a page), and `app_proxy` comes last. `MANIFEST_HOST_NOT_ALLOWED`'s `fix` now names `ctx.props.TASSYIR`.

## 0.2.0

### Minor Changes

- 86ab80c: A hosted app (`hosting.mode = "tassyir"`) may not put `admin.page` or a webhook `uri` at `/.tassyir` or below it: on every hosted origin Tassyir answers those paths itself, so a page there would never load and a delivery there would never be made. The new error code is `MANIFEST_PATH_RESERVED` (`fix`: move it to a path outside `/.tassyir/`), and the prefix is exported as `HOSTED_RESERVED_PATH_PREFIX`. An app on its own server keeps the path (its origin is its own), and the JSON Schema is unchanged.

## 0.1.1

### Patch Changes

- cc6d0c2: The 2026-10 vocabulary gains the webhook topic `bulk/finished` (a bulk export your installation asked for is done or failed; no scope needed), as the Tassyir API accepts it, and the published JSON Schema follows (`webhooks[].topics` lists 20 topics).

## 0.1.0

### Minor Changes

- 0ccfe1d: First release: the schema and validator of `tassyir.app.toml` (manifest v1, API version 2026-10). It is the Tassyir API's own validator, unchanged: the same normalised manifest and the same errors (`code`, `path`, `message`, `fix`) in the same order. Ships the 2026-10 vocabulary (`MANIFEST_VOCABULARY`), used when `validateManifest` is given none, and the published JSON Schema (`@tassyir/app-manifest/schemas/manifest.2026-10.schema.json`). ESM and CommonJS, named exports only.
