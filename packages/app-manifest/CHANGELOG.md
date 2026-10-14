# @tassyir/app-manifest

## 0.1.0

### Minor Changes

- 0ccfe1d: First release: the schema and validator of `tassyir.app.toml` (manifest v1, API version 2026-10). It is the Tassyir API's own validator, unchanged: the same normalised manifest and the same errors (`code`, `path`, `message`, `fix`) in the same order. Ships the 2026-10 vocabulary (`MANIFEST_VOCABULARY`), used when `validateManifest` is given none, and the published JSON Schema (`@tassyir/app-manifest/schemas/manifest.2026-10.schema.json`). ESM and CommonJS, named exports only.
