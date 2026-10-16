/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- both sides' outputs are compared as loose JSON */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import * as published from './index.js';
import {
  DECODE_SOURCE,
  EVALUATE_SOURCE,
  PATH_CORPUS,
  fieldCorpus,
  parityCorpus,
} from './manifest-corpus.test-harness.js';
import {
  manifestVersionColumns,
  resolveManifestUri,
} from './manifest-helpers.js';
import { manifestJsonSchema } from './manifest-schema.js';
import {
  FIXTURE_VOCABULARY,
  STOREFRONT_VOCABULARY,
  externalManifest,
  hostedManifest,
  readmeExamples,
  storefrontManifest,
} from './manifest.test-harness.js';
import * as types from './manifest-types.js';
import type { ManifestVocabulary } from './manifest-types.js';
import {
  formatManifestPath,
  validateManifest,
  validateManifestField,
} from './validate-manifest.js';
import { MANIFEST_VOCABULARY } from './vocabulary.js';

/**
 * This package against the backend that runs it (AP-K1.2, reworked after
 * AP-K1.2b). Skipped unless TASSYIR_BACKEND_DIR names a tassyir/backend
 * checkout (on master, its dependencies installed: a worktree inside the
 * main checkout resolves the main checkout's node_modules):
 *
 *   TASSYIR_BACKEND_DIR=../backend npm run parity -w @tassyir/app-manifest
 *
 * Since AP-K1.2b the backend has no validator of its own: it pins this
 * package and its door (`src/app-platform/registry/app-manifest.ts`) passes
 * the live vocabulary, built from its scope and event catalogues. So the
 * check asks "what would the backend answer if it pinned THIS build?": the
 * backend side runs in the backend's toolchain (its ts-node, TypeScript and
 * zod) with `@tassyir/app-manifest` resolved to this package's `dist/` (the
 * script builds it first) and the package's own imports (zod) resolved from
 * the backend, as an installed copy would be. Compared, as JSON with key
 * order: the door's vocabulary with `MANIFEST_VOCABULARY`; the schema files
 * the door generates with `schemas/`, byte for byte; the door's
 * `validateAppManifest` (live vocabulary) with this package's DEFAULT call
 * (shipped vocabulary) over the corpus; and the built package with the
 * source on two fixture vocabularies (one with storefront blocks available,
 * the Phase 2 shape), the field checks, paths and origins. Both sides run
 * the same corpus through the same evaluator
 * (`manifest-corpus.test-harness.ts`), and the outputs must be the same
 * JSON, key order included.
 */

const BACKEND_DIR = process.env['TASSYIR_BACKEND_DIR'];

if (
  BACKEND_DIR === undefined &&
  process.env['npm_lifecycle_event'] === 'parity'
) {
  throw new Error(
    'TASSYIR_BACKEND_DIR is not set. Set it to a tassyir/backend checkout on master with its dependencies installed, e.g. TASSYIR_BACKEND_DIR=../backend npm run parity -w @tassyir/app-manifest.',
  );
}

const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const [readmeHosted, readmeExternal] = readmeExamples(README);
const clone = (value: unknown): any => JSON.parse(JSON.stringify(value));

/** The vocabularies a corpus case may name besides the shipped one. */
const VOCABULARIES: Record<string, ManifestVocabulary> = {
  fixture: FIXTURE_VOCABULARY,
  // The Phase 2 shape: storefront blocks requestable, the app proxy open.
  storefront: STOREFRONT_VOCABULARY,
};

const FIXTURE_BASES = {
  hosted: hostedManifest,
  external: externalManifest,
  bare: () => ({
    name: 'Bare',
    handle: 'bare',
    api_version: '2026-07',
    hosting: { mode: 'tassyir', allowed_hosts: [] },
  }),
};

/** The corpus and the other inputs, as the JSON both sides read. */
function buildInput(): string {
  return JSON.stringify({
    cases: parityCorpus(
      {
        ...FIXTURE_BASES,
        vocabulary: VOCABULARIES['fixture'] as ManifestVocabulary,
      },
      {
        ...FIXTURE_BASES,
        marketplace: storefrontManifest,
        vocabulary: VOCABULARIES['storefront'] as ManifestVocabulary,
      },
      {
        hosted: () => clone(readmeHosted),
        external: () => clone(readmeExternal),
        bare: () => ({
          name: 'Bare',
          handle: 'bare',
          api_version: '2026-10',
          hosting: { mode: 'tassyir', allowed_hosts: [] },
        }),
        // The shipped vocabulary keeps the app proxy closed.
        marketplace: () => {
          const doc = storefrontManifest();
          delete doc['app_proxy'];
          return doc;
        },
        vocabulary: MANIFEST_VOCABULARY,
      },
    ),
    fields: fieldCorpus(),
    paths: PATH_CORPUS,
    handles: ['review-requests', 'a', 'x-y-z'],
    vocabularies: VOCABULARIES,
  });
}

// Built only when the comparison runs: ~20,000 documents.
const INPUT_TEXT = BACKEND_DIR === undefined ? '{}' : buildInput();

/** This package's CommonJS build, which the backend side loads. */
const PACKAGE_ENTRY = fileURLToPath(
  new URL('../dist/index.cjs', import.meta.url),
);

/**
 * The backend side: run in the backend checkout, by its own toolchain, with
 * `@tassyir/app-manifest` resolved to this package's build and the build's
 * own bare imports (zod) resolved from the backend.
 */
const RUNNER = `
'use strict';
const Module = require('module');
const path = require('path');
const entry = process.env.TASSYIR_MANIFEST_PACKAGE_ENTRY;
const packageDir = path.dirname(entry);
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === '@tassyir/app-manifest') return entry;
  if (
    parent && parent.filename && parent.filename.startsWith(packageDir) &&
    !request.startsWith('.') && !request.startsWith('node:')
  ) {
    return require.resolve(request, { paths: [process.cwd()] });
  }
  return resolveFilename.call(this, request, parent, ...rest);
};
${DECODE_SOURCE}
${EVALUATE_SOURCE}
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const door = require('./src/app-platform/registry/app-manifest');
const pure = require('@tassyir/app-manifest');
const api = {
  validate: (doc, kind) =>
    kind === 'shipped'
      ? door.validateAppManifest(doc)
      : pure.validateManifest(doc, input.vocabularies[kind]),
  columns: (manifest, kind) =>
    kind === 'shipped'
      ? door.appManifestVersionColumns(manifest)
      : pure.manifestVersionColumns(manifest, input.vocabularies[kind]),
  resolve: (manifest, uri) => pure.resolveManifestUri(manifest, uri),
  field: (...args) => pure.validateManifestField(...args),
  path: (path) => pure.formatManifestPath(path),
  origin: (handle) => pure.hostedAppOrigin(handle),
  schema: (vocabulary, version) => pure.manifestJsonSchema(vocabulary, version),
};
process.stdout.write(JSON.stringify({
  versions: {
    zod: require('zod/package.json').version,
    typescript: require('typescript/package.json').version,
  },
  pinned: require('./package.json').dependencies['@tassyir/app-manifest'] ?? null,
  loaded: require.resolve('@tassyir/app-manifest'),
  vocabulary: door.appManifestVocabulary(),
  schemaDocuments: door.appManifestSchemaDocuments(),
  evaluation: evaluate(api, input),
}));
`;

// The evaluator is shared AS TEXT with the backend runner above: one
// implementation of the comparison for both sides.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const shared = new Function(
  `${DECODE_SOURCE}\n${EVALUATE_SOURCE}\nreturn { evaluate, constantsOf };`,
)();

// Each vocabulary is passed as the decoded JSON object, as on the backend
// side; the shipped one is the package's DEFAULT (no second argument).
const PACKAGE_API = {
  validate: (doc: unknown, kind: string) =>
    kind === 'shipped'
      ? validateManifest(doc)
      : validateManifest(doc, VOCABULARIES[kind]),
  columns: (manifest: any, kind: string) =>
    kind === 'shipped'
      ? manifestVersionColumns(manifest)
      : manifestVersionColumns(manifest, VOCABULARIES[kind]),
  resolve: resolveManifestUri,
  field: validateManifestField,
  path: formatManifestPath,
  origin: published.hostedAppOrigin,
  schema: manifestJsonSchema,
};

function runBackend(dir: string): any {
  const run = spawnSync(
    process.execPath,
    ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register', '-e', RUNNER],
    {
      cwd: dir,
      input: INPUT_TEXT,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 1024,
      env: {
        ...process.env,
        TS_NODE_TRANSPILE_ONLY: 'true',
        TS_NODE_PROJECT: join(dir, 'tsconfig.json'),
        TASSYIR_MANIFEST_PACKAGE_ENTRY: PACKAGE_ENTRY,
      },
    },
  );
  if (run.error) throw run.error;
  if (run.status !== 0) {
    throw new Error(
      `The backend side failed in ${dir} (exit ${String(run.status)}). It needs the backend's dependencies (ts-node, tsconfig-paths, zod): run npm ci there, or use a worktree inside a checkout that has them.\n${run.stderr.slice(0, 4000)}`,
    );
  }
  return JSON.parse(run.stdout);
}

function gitHead(dir: string): string {
  const run = spawnSync('git', ['-C', dir, 'log', '-1', '--format=%h %s'], {
    encoding: 'utf8',
  });
  return run.status === 0 ? run.stdout.trim() : 'unknown commit';
}

/** The first differences between two lists, compared as JSON text. */
function differences(
  ours: unknown[],
  theirs: unknown[],
  labelOf: (index: number) => string,
) {
  const found: { label: string; package: unknown; backend: unknown }[] = [];
  let count = 0;
  ours.forEach((value, index) => {
    if (JSON.stringify(value) === JSON.stringify(theirs[index])) return;
    count++;
    if (found.length < 3) {
      found.push({
        label: labelOf(index),
        package: value,
        backend: theirs[index],
      });
    }
  });
  if (ours.length !== theirs.length) count++;
  return { count, first: found };
}

describe.runIf(BACKEND_DIR !== undefined)(
  `parity with the backend (TASSYIR_BACKEND_DIR)`,
  () => {
    const dir = resolve(BACKEND_DIR ?? '.');
    const input = JSON.parse(INPUT_TEXT);
    const head = BACKEND_DIR === undefined ? '' : gitHead(dir);
    let backend: any;
    let ours: any;

    beforeAll(() => {
      expect(
        existsSync(join(dir, 'src/app-platform/registry/app-manifest.ts')),
        `${dir} is not a tassyir/backend checkout with the manifest validator`,
      ).toBe(true);
      expect(
        existsSync(PACKAGE_ENTRY),
        'dist/index.cjs is missing: run npm run build -w @tassyir/app-manifest (npm run parity builds it first)',
      ).toBe(true);
      backend = runBackend(dir);
      ours = shared.evaluate(PACKAGE_API, input);
    }, 600_000);

    it(`runs against ${head}`, () => {
      const zod = createRequire(import.meta.url)('zod/package.json').version;
      expect(backend.versions.zod.split('.')[0]).toBe('4');
      expect(
        `backend zod ${backend.versions.zod}, TypeScript ${backend.versions.typescript}; package zod ${zod}`,
      ).toMatch(/^backend zod 4\./);
    });

    it("loads this package's build in place of the backend's pinned copy", () => {
      expect(backend.loaded).toBe(PACKAGE_ENTRY);
      // The backend pins an exact version (AP-K1.2b): moving it to this
      // package's next release is the backend's own change.
      expect(backend.pinned).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('ships the vocabulary the backend builds from its catalogues, key order included', () => {
      expect(MANIFEST_VOCABULARY).toEqual(backend.vocabulary);
      expect(JSON.stringify(MANIFEST_VOCABULARY)).toBe(
        JSON.stringify(backend.vocabulary),
      );
    });

    it('ships the JSON Schema files the backend publishes, byte for byte', () => {
      const documents: { file: string; content: string }[] =
        backend.schemaDocuments;
      expect(documents.map(({ file }) => file)).toEqual(
        MANIFEST_VOCABULARY.apiVersions.map(
          (version) => `docs/api/apps/manifest.${version}.schema.json`,
        ),
      );
      for (const { file, content } of documents) {
        const name = file.split('/').pop() ?? '';
        const shipped = readFileSync(
          new URL(`../schemas/${name}`, import.meta.url),
          'utf8',
        );
        expect(
          shipped,
          `schemas/${name} = the file the backend's door generates with this build`,
        ).toBe(content);
        // The backend's own spec holds its committed file to its PINNED
        // package; a schema change here makes its pin move regenerate it
        // (npm run apps:manifest-schema). Said, not failed: the backend
        // cannot move before this package is released.
        if (readFileSync(join(dir, file), 'utf8') !== content) {
          console.warn(
            `The backend's committed ${file} differs from this build's: moving its pin to this release must run npm run apps:manifest-schema.`,
          );
        }
      }
    });

    it(`gives the same result for each of the ${String(input.cases?.length)} corpus documents`, () => {
      expect(
        differences(
          ours.results,
          backend.evaluation.results,
          (index) => input.cases[index].label,
        ),
      ).toEqual({ count: 0, first: [] });
    });

    it('gives the same field checks, paths, origins and fixture schemas', () => {
      expect(ours.fixtureSchemas).toHaveLength(4);
      for (const key of ['fields', 'paths', 'origins', 'fixtureSchemas']) {
        expect(
          differences(
            ours[key],
            backend.evaluation[key],
            (index) =>
              `${key}[${String(index)}] ${JSON.stringify(input[key === 'origins' ? 'handles' : key]?.[index]).slice(0, 80)}`,
          ),
          key,
        ).toEqual({ count: 0, first: [] });
      }
    });

    it('the corpus is not vacuous: it hits every error code and many valid manifests', () => {
      const seen = new Set<string>();
      let valid = 0;
      for (const { result } of ours.results) {
        if (result.ok) valid++;
        else for (const error of result.errors) seen.add(error.code);
      }
      expect(
        types.MANIFEST_ERROR_CODES.filter((code) => !seen.has(code)),
      ).toEqual([]);
      expect(valid).toBeGreaterThan(500);
    });

    it('every valid manifest re-validates to itself, but for the known gap', () => {
      // The known gap (validate-manifest.test.ts, "known gaps"): `access` as
      // a date or a Map, or `hosting.url` as undefined, passes, and its
      // normalised form does not. Same in the backend; fixed in both later.
      const KNOWN_GAP =
        / (access = \{"\$corpus":"(date|map)"\}|hosting\.url = \{"\$corpus":"undefined"\})$/;
      const unstable = ours.results
        .map((item: any, index: number) =>
          item.result.ok && !item.stable ? input.cases[index].label : null,
        )
        .filter((label: string | null) => label !== null);
      expect(
        unstable.filter((label: string) => !KNOWN_GAP.test(label)),
      ).toEqual([]);
    });
  },
);

describe.skipIf(BACKEND_DIR !== undefined)('parity with the backend', () => {
  it.skip('set TASSYIR_BACKEND_DIR=<a tassyir/backend checkout> to run it (npm run parity -w @tassyir/app-manifest)', () => {
    // Documentation only: see the header of this file.
  });
});
