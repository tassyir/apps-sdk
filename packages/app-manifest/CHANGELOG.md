# @tassyir/app-manifest

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
