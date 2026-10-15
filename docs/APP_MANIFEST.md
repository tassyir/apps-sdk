# `@tassyir/app-manifest` and the Tassyir API

The Tassyir API (`tassyir/backend`) validates every uploaded manifest. A
developer validates the same manifest with this package, in the CLI, an editor
or an agent's tool. The two must give the same answer: the same normalised
manifest, or the same errors in the same order. This page says what must stay
equal and how this repo proves it.

## What must stay equal

| What                      | In the backend                                                                             | In this package                                      |
| ------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| The validator             | none of its own: it pins this package, exact (`package.json`)                              | `packages/app-manifest/src/`                         |
| The vocabulary            | `appManifestVocabulary()`, built from the scope and event catalogues and `event-scopes.ts` | `MANIFEST_VOCABULARY` (`src/vocabulary.ts`), data    |
| The published JSON Schema | `docs/api/apps/manifest.<version>.schema.json`                                             | `schemas/manifest.<version>.schema.json`, same bytes |

The validator was moved from the backend by AP-K1.2 without changing its
behaviour, and since AP-K1.2b the backend runs the published package: there
is one validator. Its door (`src/app-platform/registry/app-manifest.ts`)
passes the live vocabulary (`validateManifest(input, appManifestVocabulary())`),
and everyone else gets the shipped one by default. The backend's
`app-manifest.package.spec.ts` holds its live vocabulary and committed schema
files to the PINNED package, so a new scope, topic or API version fails the
backend's CI until a release of this package ships it and the pin moves.

## The parity check

```bash
TASSYIR_BACKEND_DIR=../backend npm run parity -w @tassyir/app-manifest
```

`TASSYIR_BACKEND_DIR` is a `tassyir/backend` checkout on `master` with its
dependencies installed. A worktree created inside the main checkout's folder
works too: it resolves the main checkout's `node_modules`. The script builds
the package, then the check (`src/backend-parity.test.ts`) runs the backend's
door with the backend's own toolchain (its ts-node, TypeScript and zod), with
`@tassyir/app-manifest` resolved to THIS build (and the build's zod to the
backend's): the backend as it would be with its pin moved here. It compares,
as JSON with key order:

- `MANIFEST_VOCABULARY` with `appManifestVocabulary()`;
- this package's schema files with the ones the door generates, byte for
  byte (a difference from the backend's committed file is printed: the pin
  move then runs `npm run apps:manifest-schema` too);
- about 25,000 manifests (`src/manifest-corpus.test-harness.ts`): every field
  given every value the specs use, every key removed, retyped or joined by an
  unknown one, every scope and topic combination, the limits, odd inputs and
  seeded random combinations. The door's `validateAppManifest` (live
  vocabulary) is compared with the package's default call (shipped
  vocabulary), and the build with the source on two fixture vocabularies (one
  with storefront blocks available). The normalised manifests' helpers
  (`manifestVersionColumns`, `resolveManifestUri`) are compared too. The
  corpus must produce every error code.

Without `TASSYIR_BACKEND_DIR` the spec is skipped, so `npm test` and CI never
need the backend. CI cannot run it: the backend is private and this repo holds
no token. Run it before each release of `@tassyir/app-manifest`, and in every
PR that changes the package's behaviour, vocabulary or schema.

## Changing the manifest

1. The contract first: `tassyir/backend` `docs/APPS_PLATFORM_PLAN.md` §3.2.
2. A rule: change the package, run the parity check, add a changeset (a new
   rule or code is a `minor`, and a `create-tassyir-app` changeset goes with
   it), release. Then the backend moves its pin in its own PR:
   `npm install --save-exact @tassyir/app-manifest@<version>` with a
   `read:packages` token, `npm run prisma:generate` again (the install prunes
   the generated clients), `npm run apps:manifest-schema` when the schema
   changed, and its manifest reference (`docs/api/apps/manifest.md`) for a new
   code.
3. A new scope, topic or API version: the backend's catalogue change and its
   pin move are one backend PR, after this package's release. Here first:
   edit `src/vocabulary.ts` to match what `appManifestVocabulary()` will
   return exactly (key order included), regenerate the schema with
   `npm run schemas -w @tassyir/app-manifest`, run the parity check against a
   backend branch that carries the catalogue change, and add a changeset.

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
callers do. It is kept on purpose (the API answers the same: it runs this package), pinned
by `validate-manifest.test.ts` ("known gaps") and recorded in the plan's §10.
The fix is now one change here, then the backend's pin move.
