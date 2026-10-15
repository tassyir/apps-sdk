# @tassyir/app-manifest

## 0.1.1

### Patch Changes

- cc6d0c2: The 2026-10 vocabulary gains the webhook topic `bulk/finished` (a bulk export your installation asked for is done or failed; no scope needed), as the Tassyir API accepts it, and the published JSON Schema follows (`webhooks[].topics` lists 20 topics).

## 0.1.0

### Minor Changes

- 0ccfe1d: First release: the schema and validator of `tassyir.app.toml` (manifest v1, API version 2026-10). It is the Tassyir API's own validator, unchanged: the same normalised manifest and the same errors (`code`, `path`, `message`, `fix`) in the same order. Ships the 2026-10 vocabulary (`MANIFEST_VOCABULARY`), used when `validateManifest` is given none, and the published JSON Schema (`@tassyir/app-manifest/schemas/manifest.2026-10.schema.json`). ESM and CommonJS, named exports only.
