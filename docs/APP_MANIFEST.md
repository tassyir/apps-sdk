# `@tassyir/app-manifest` and the Tassyir API

The Tassyir API (`tassyir/backend`) validates every uploaded manifest. A
developer validates the same manifest with this package, in the CLI, an editor
or an agent's tool. The two must give the same answer: the same normalised
manifest, or the same errors in the same order. This page says what must stay
equal and how this repo proves it.

## What must stay equal

| What                      | In the backend                                                                             | In this package                                      |
| ------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| The validator             | `src/app-platform/registry/manifest/` (pure: zod and its own files)                        | `packages/app-manifest/src/`                         |
| The vocabulary            | `appManifestVocabulary()`, built from the scope and event catalogues and `event-scopes.ts` | `MANIFEST_VOCABULARY` (`src/vocabulary.ts`), data    |
| The published JSON Schema | `docs/api/apps/manifest.<version>.schema.json`                                             | `schemas/manifest.<version>.schema.json`, same bytes |

The validator was moved from the backend by AP-K1.2 without changing its
behaviour. Until **AP-K1.2b** (the backend pins this package) the backend keeps
its own copy. After it, the backend imports the package and deletes its copy,
so there is one validator. The vocabulary stays in both places for good: the
API passes its live one (`validateManifest(input, appManifestVocabulary())`),
and everyone else gets the shipped one by default.

## The parity check

```bash
TASSYIR_BACKEND_DIR=../backend npm run parity -w @tassyir/app-manifest
```

`TASSYIR_BACKEND_DIR` is a `tassyir/backend` checkout on `master` with its
dependencies installed. A worktree created inside the main checkout's folder
works too: it resolves the main checkout's `node_modules`. The check
(`src/backend-parity.test.ts`) runs the backend's own code with the backend's
own toolchain (its ts-node, TypeScript and zod, in that checkout) and compares,
as JSON with key order:

- `MANIFEST_VOCABULARY` with `appManifestVocabulary()`;
- this package's schema files with the backend's generated and committed ones,
  byte for byte;
- every constant of the two `manifest-limits.ts` and `manifest-types.ts`
  (limits, reserved handles and domains, patterns, error codes);
- the export names: the package exports all of the backend folder's, plus
  `MANIFEST_VOCABULARY`;
- about 25,000 manifests (`src/manifest-corpus.test-harness.ts`): every field
  given every value the specs use, every key removed, retyped or joined by an
  unknown one, every scope and topic combination, the limits, odd inputs and
  seeded random combinations. The package's default call is compared with the
  backend's `validateAppManifest`, and both pure validators with two fixture
  vocabularies (one with storefront blocks available). The normalised
  manifests' helpers (`manifestVersionColumns`, `resolveManifestUri`) are
  compared too. The corpus must produce every error code.

Without `TASSYIR_BACKEND_DIR` the spec is skipped, so `npm test` and CI never
need the backend. CI cannot run it: the backend is private and this repo holds
no token. Run it before each release of `@tassyir/app-manifest`, and in every
PR that changes the package's behaviour, vocabulary or schema. After AP-K1.2b,
the backend adds the permanent guard on its side: a spec that its live
vocabulary and schema files equal those of the pinned package, so a new scope,
topic or API version fails the backend's CI until a package release ships it
and the pin moves.

## Changing the manifest

1. The contract first: `tassyir/backend` `docs/APPS_PLATFORM_PLAN.md` §3.2.
2. Before AP-K1.2b, change both validators (one PR in each repo) and keep the
   parity check green against the backend branch. After it, change the package,
   release it, then bump the backend's pin.
3. A new scope, topic or API version: the backend's catalogues change first.
   Then edit `src/vocabulary.ts` to match `appManifestVocabulary()` exactly
   (key order included), regenerate the schema with
   `npm run schemas -w @tassyir/app-manifest`, run the parity check, and add a
   changeset.

A developer on an older package version sees new names refused until they
update; the API, with its live vocabulary, accepts them. That is the contract
(§3.2, "Versioning"): within an API version only new optional fields and names
are added.

## Known gap, the same on both sides

The validator reads any non-array object as a table: a TOML date or a JS `Map`
where a table goes (`access = 1979-05-27`) passes as an empty table, and an own
key set to `undefined` counts as present (`hosting.url`). For `access` this
skips the topic-scope rule, and the normalised manifest then fails validation.
JSON, the API's input, carries none of these; a TOML parser's dates and JS
callers do. It is kept on purpose (the API answers the same), pinned by
`validate-manifest.test.ts` ("known gaps") and recorded in the plan's §10, to be
fixed in the package and the backend together.
