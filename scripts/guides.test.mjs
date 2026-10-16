// The developer guides (docs/guides) themselves: front matter, links, public
// content only, every TOML, JSON, Liquid and CSS sample, and errors.md in step
// with the OpenAPI document. The TypeScript samples are typechecked against the
// packed packages by `npm run check:guides`.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { validateManifest } from '@tassyir/app-manifest';
import {
  compileBlockTemplate,
  validateBlockStylesheet,
} from '@tassyir/storefront-blocks';
import {
  HOSTED_BINDING_CODES,
  HOSTED_BINDING_SHARED_CODES,
  codeBlocks,
  errorCatalogue,
  explainedCodes,
  guideSetProblems,
  leakProblems,
  linkProblems,
  oauthErrors,
  parseGuide,
  problemCodes,
} from './lib/guides.mjs';
import { ROOT, readJson } from './lib/workspace.mjs';
import {
  ERRORS_GUIDE,
  OPENAPI_DOCUMENT,
  expectedErrorsGuide,
} from './guides-errors.mjs';

const DIR = join(ROOT, 'docs', 'guides');
const files = readdirSync(DIR)
  .filter((file) => file.endsWith('.md'))
  .sort();
const sources = new Map(
  files.map((file) => [file, readFileSync(join(DIR, file), 'utf8')]),
);
const guides = files
  .filter((file) => file !== 'README.md')
  .map((file) => parseGuide(file.slice(0, -3), sources.get(file) ?? ''));

/** Fences a guide may use; `ts` and `ts browser` are typechecked. */
const KNOWN_FENCES = new Set([
  'ts',
  'ts browser',
  'toml',
  'json',
  'liquid',
  'css',
  'bash',
  'http',
  'yaml',
]);

describe('docs/guides', () => {
  it('has the guides the docs site publishes', () => {
    expect(guides.map((guide) => guide.slug)).toContain('index');
    expect(guides.length).toBeGreaterThanOrEqual(15);
  });

  it('gives every guide front matter, a slug, a unique title and order', () => {
    expect(guideSetProblems(guides)).toEqual([]);
  });

  it('links only to guides and headings that exist, and to public pages', () => {
    expect(linkProblems(guides)).toEqual([]);
  });

  it('names nothing internal to Tassyir', () => {
    expect(
      [...sources].flatMap(([file, source]) => leakProblems(file, source)),
    ).toEqual([]);
  });

  it('fences every sample in a checked language', () => {
    const unknown = guides.flatMap((guide) =>
      codeBlocks(guide.body, guide.bodyLine)
        .filter(
          (block) => !KNOWN_FENCES.has(`${block.lang} ${block.meta}`.trim()),
        )
        .map(
          (block) =>
            `${guide.file}:${String(block.line)} ${block.lang} ${block.meta}`,
        ),
    );
    expect(unknown).toEqual([]);
  });

  it('parses every JSON sample', () => {
    for (const guide of guides) {
      for (const block of codeBlocks(guide.body, guide.bodyLine)) {
        if (block.lang !== 'json') continue;
        expect(
          () => {
            JSON.parse(block.code);
          },
          `${guide.file}:${String(block.line)}`,
        ).not.toThrow();
      }
    }
  });

  it('parses every TOML sample, and every whole manifest is valid', () => {
    let manifests = 0;
    for (const guide of guides) {
      for (const block of codeBlocks(guide.body, guide.bodyLine)) {
        if (block.lang !== 'toml') continue;
        const where = `${guide.file}:${String(block.line)}`;
        /** @type {unknown} */
        let parsed;
        expect(() => (parsed = parseToml(block.code)), where).not.toThrow();
        if (!/^api_version\s*=/m.test(block.code)) continue;
        manifests += 1;
        const result = validateManifest(parsed);
        expect(result.ok ? [] : result.errors, where).toEqual([]);
      }
    }
    expect(manifests).toBeGreaterThanOrEqual(2);
  });

  it('compiles every Liquid sample and validates every CSS sample as a storefront block', () => {
    let samples = 0;
    for (const guide of guides) {
      for (const block of codeBlocks(guide.body, guide.bodyLine)) {
        if (block.lang !== 'liquid' && block.lang !== 'css') continue;
        samples += 1;
        const where = `${guide.file}:${String(block.line)}`;
        if (block.lang === 'css') {
          expect(validateBlockStylesheet(block.code), where).toEqual([]);
          continue;
        }
        const result = compileBlockTemplate(block.code, { target: 'product' });
        expect(result.ok ? [] : result.errors, where).toEqual([]);
      }
    }
    expect(samples).toBeGreaterThanOrEqual(2);
  });

  describe('errors.md', () => {
    const source = sources.get('errors.md') ?? '';
    const document = /** @type {import('./lib/guides.mjs').OpenApiDocument} */ (
      readJson(OPENAPI_DOCUMENT)
    );

    it('lists every code of the OpenAPI document (npm run guides:errors)', async () => {
      expect(
        await expectedErrorsGuide(readFileSync(ERRORS_GUIDE, 'utf8')),
      ).toBe(source);
    });

    it('explains only codes the API or the hosted binding answers', () => {
      const known = new Set([
        ...problemCodes(document).codes.keys(),
        ...errorCatalogue(document).keys(),
        ...oauthErrors(document).keys(),
        ...HOSTED_BINDING_CODES.keys(),
      ]);
      const explained = explainedCodes(source);
      expect(explained.length).toBeGreaterThan(10);
      expect(explained.filter((code) => !known.has(code))).toEqual([]);
    });

    it("explains each of the hosted binding's own codes", () => {
      const explained = explainedCodes(source);
      expect(
        [...HOSTED_BINDING_CODES.keys()].filter(
          (code) => !explained.includes(code),
        ),
      ).toEqual([]);
    });
  });

  describe('the error catalogue (x-tassyir-errors)', () => {
    const document = /** @type {import('./lib/guides.mjs').OpenApiDocument} */ (
      readJson(OPENAPI_DOCUMENT)
    );
    const catalogue = errorCatalogue(document);

    it('holds every code an operation lists, with a title', () => {
      expect(catalogue.size).toBeGreaterThan(50);
      expect(
        [...problemCodes(document).codes.keys()].filter(
          (code) => !catalogue.has(code),
        ),
      ).toEqual([]);
      for (const [code, entry] of catalogue) {
        expect(entry.title, code).not.toBe('');
      }
    });

    it("never names the hosted binding's own codes, and names the six it shares", () => {
      expect(
        [...HOSTED_BINDING_CODES.keys()].filter((code) => catalogue.has(code)),
      ).toEqual([]);
      expect(
        HOSTED_BINDING_SHARED_CODES.filter((code) => !catalogue.has(code)),
      ).toEqual([]);
    });
  });
});
