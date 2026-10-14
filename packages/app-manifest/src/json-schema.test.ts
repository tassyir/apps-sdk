/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- manifests are edited as loose JSON to build invalid documents */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { manifestJsonSchema } from './manifest-schema.js';
import {
  CHECKED_KEYWORDS,
  readmeExamples,
  schemaKeywords,
  schemaViolations,
} from './manifest.test-harness.js';
import { validateManifest } from './validate-manifest.js';
import { MANIFEST_VOCABULARY } from './vocabulary.js';

/**
 * The published JSON Schema, one file per API version in `schemas/`, shipped
 * in the tarball. Each file is written exactly as the API writes its own copy
 * (tassyir/backend docs/api/apps/manifest.<version>.schema.json), and
 * `backend-parity.test.ts` checks the two are the same bytes. Ported from the
 * backend's `app-manifest.spec.ts` (AP-B1.2).
 *
 * A stale file fails here. Regenerate: npm run schemas -w @tassyir/app-manifest
 */

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

const API_VERSIONS = MANIFEST_VOCABULARY.apiVersions;
const EXAMPLES = readmeExamples(read('../README.md'));

/** A schema file's text: two-space JSON and a final newline, as the API's. */
function schemaFile(apiVersion: string): string {
  return `${JSON.stringify(manifestJsonSchema(MANIFEST_VOCABULARY, apiVersion), null, 2)}\n`;
}

describe('the published JSON Schema', () => {
  it.each(API_VERSIONS)(
    'schemas/manifest.%s.schema.json is up to date (npm run schemas -w @tassyir/app-manifest)',
    async (apiVersion) => {
      await expect(schemaFile(apiVersion)).toMatchFileSnapshot(
        `../schemas/manifest.${apiVersion}.schema.json`,
      );
    },
  );

  // The export key is the file's own path, so a resolver that ignores
  // `exports` (TypeScript's node10, the backend's) finds the same file.
  it('ships one file per API version, each exported under its own path', () => {
    const pkg: any = JSON.parse(read('../package.json'));
    const files = API_VERSIONS.map(
      (version) => `manifest.${version}.schema.json`,
    );
    expect(readdirSync(new URL('../schemas/', import.meta.url)).sort()).toEqual(
      files,
    );
    expect(pkg.files).toContain('schemas');
    expect(
      Object.keys(pkg.exports).filter((key) => key.endsWith('.schema.json')),
    ).toEqual(files.map((file) => `./schemas/${file}`));
    for (const file of files) {
      expect(pkg.exports[`./schemas/${file}`]).toBe(`./schemas/${file}`);
    }
  });

  it('defaults to the shipped vocabulary and its latest API version', () => {
    expect(manifestJsonSchema()).toEqual(
      manifestJsonSchema(MANIFEST_VOCABULARY, API_VERSIONS.at(-1)),
    );
    expect(() =>
      manifestJsonSchema({ ...MANIFEST_VOCABULARY, apiVersions: [] }),
    ).toThrow('The manifest vocabulary has no API version');
  });

  const schema = manifestJsonSchema();

  it('uses only keywords the spec checker understands (so the checks below are real)', () => {
    expect(
      [...schemaKeywords(schema)].filter((key) => !CHECKED_KEYWORDS.has(key)),
    ).toEqual([]);
  });

  it('accepts every example and its normalised form', () => {
    expect(EXAMPLES).toHaveLength(2);
    for (const example of EXAMPLES) {
      expect(schemaViolations(example, schema)).toEqual([]);
      const result = validateManifest(example);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(
          schemaViolations(JSON.parse(JSON.stringify(result.manifest)), schema),
        ).toEqual([]);
      }
    }
  });

  it('refuses what the shape forbids (the checker is not vacuous)', () => {
    const doc: any = structuredClone(EXAMPLES[0]);
    doc.extra = true;
    doc.handle = 'Bad Handle';
    doc.access.scopes.push('read_orders', 'manage_everything');
    doc.webhooks[0].topics = [];
    delete doc.hosting.mode;
    expect(schemaViolations(doc, schema)).toEqual([
      '$.handle: fails ^[a-z0-9]+(?:-[a-z0-9]+)*$',
      '$.access.scopes: duplicate items',
      '$.access.scopes[3]: "manage_everything" not in enum',
      '$.hosting.mode: required',
      '$.webhooks[0].topics: fewer than 1 items',
      '$.extra: not allowed',
    ]);
  });

  it('lists only the scopes a manifest may request', () => {
    const scopes = (schema as any).properties.access.properties.scopes.items
      .enum as string[];
    expect(scopes).toEqual(
      MANIFEST_VOCABULARY.scopes
        .filter((scope) => scope.available)
        .map((scope) => scope.name),
    );
  });
});
