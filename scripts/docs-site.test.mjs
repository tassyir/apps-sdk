// The developer docs site (site/, published at developers.tassyir.io by
// Mintlify): every generated page and docs.json's generated keys in step with
// their sources (`npm run docs:sync` repairs them), nothing published by
// accident, one page per problem code, the API reference from the vendored
// OpenAPI file, a playground that sends no token anywhere, and one pinned
// Mintlify CLI. `npm run docs:check` runs Mintlify's own build checks.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DOCS_JSON,
  SITE_DIR,
  expectedDocsJson,
  expectedSite,
  generatedFilesOnDisk,
  publicPackages,
  readGuides,
} from './docs-site.mjs';
import { OPENAPI_DOCUMENT } from './guides-errors.mjs';
import {
  GENERATED_DIRS,
  HAND_WRITTEN_GROUPS,
  MINT_BEFORE,
  MINT_VERSION,
  OPENAPI_SOURCES,
  PROBLEM_TYPE_BASE,
  errorRoute,
  kebab,
  navigationPages,
} from './lib/docs-site.mjs';
import { problemCodes } from './lib/guides.mjs';
import { MARKETPLACE_JSON } from './lib/plugin.mjs';
import { ROOT, readJson } from './lib/workspace.mjs';

const SYNC = 'run npm run docs:sync';
const { files, keys } = expectedSite();
const docsJsonText = readFileSync(DOCS_JSON, 'utf8');
/**
 * @typedef {{
 *   navigation: { tabs: unknown[] },
 *   api: { playground: unknown },
 *   contextual: { options: string[] },
 * }} DocsJson
 */
/** @type {unknown} */
const parsedDocsJson = JSON.parse(docsJsonText);
const docsJson = /** @type {DocsJson} */ (parsedDocsJson);
const pages = navigationPages(docsJson.navigation);

/** Every file under site/, relative to it. */
const siteFiles = readdirSync(SITE_DIR, { recursive: true, encoding: 'utf8' })
  .filter((entry) => statSync(join(SITE_DIR, entry)).isFile())
  .map((entry) =>
    relative(SITE_DIR, join(SITE_DIR, entry)).split('\\').join('/'),
  )
  .sort();
const ignored = readFileSync(join(SITE_DIR, '.mintignore'), 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '' && !line.startsWith('#'));
/**
 * Whether .mintignore keeps a file off the site (a pattern without a slash
 * matches a file of that name in any folder, as in .gitignore).
 * @param {string} path
 */
const isIgnored = (path) =>
  ignored.some(
    (pattern) =>
      pattern === path ||
      (!pattern.includes('/') && path.split('/').pop() === pattern),
  );
/** The files Mintlify publishes as pages. */
const published = siteFiles.filter(
  (path) => /\.mdx?$/.test(path) && !isIgnored(path),
);

describe('site/ in step with its sources', () => {
  it('has every generated page and OpenAPI copy as docs:sync writes it', () => {
    const onDisk = generatedFilesOnDisk();
    const missing = [...files.keys()].filter((path) => !onDisk.has(path));
    const stale = [...files].filter(
      ([path, content]) => onDisk.has(path) && onDisk.get(path) !== content,
    );
    const extra = [...onDisk.keys()].filter((path) => !files.has(path));
    expect(
      { missing, stale: stale.map(([path]) => path), extra },
      SYNC,
    ).toEqual({ missing: [], stale: [], extra: [] });
  });

  it("has docs.json's navigation, colours, background and face as docs:sync writes them", async () => {
    expect(await expectedDocsJson(docsJsonText, keys), SYNC).toBe(docsJsonText);
  });

  it('lists every guide once, in front-matter order, before the hand-written pages', () => {
    const guides = readGuides().sort(
      (a, b) => (a.frontMatter?.order ?? 0) - (b.frontMatter?.order ?? 0),
    );
    const [guidesTab] = docsJson.navigation.tabs;
    expect(navigationPages(guidesTab), SYNC).toEqual([
      ...guides.map((guide) => `guides/${guide.slug}`),
      ...HAND_WRITTEN_GROUPS.flatMap(({ pages: list }) => list),
    ]);
  });
});

describe('nothing becomes a page by accident', () => {
  it('publishes exactly the navigation: every page file is listed, every listed page exists', () => {
    expect(published.map((path) => path.replace(/\.mdx?$/, '')).sort()).toEqual(
      [...pages].sort(),
    );
    for (const page of pages) {
      expect(existsSync(join(SITE_DIR, `${page}.mdx`)), page).toBe(true);
    }
  });

  it("keeps the guides' authoring rules and the release notes off the site", () => {
    expect(ignored).toContain('README.md');
    expect(isIgnored('README.md')).toBe(true);
    expect(
      published.filter((path) =>
        /README|RELEASING|APP_MANIFEST|AGENTS|CLAUDE/.test(path),
      ),
    ).toEqual([]);
    expect(files.has('guides/README.mdx')).toBe(false);
  });

  it('holds only pages, its config, the logos and the OpenAPI copies', () => {
    const folders = GENERATED_DIRS.filter((dir) => dir !== 'openapi').join('|');
    const allowed = new RegExp(
      `^(?:\\.mintignore|README\\.md|docs\\.json|(?:(?:${folders})/)?[a-z0-9-]+\\.mdx|logo/[a-z0-9-]+\\.svg|openapi/[a-z0-9.-]+\\.json)$`,
    );
    expect(siteFiles.filter((path) => !allowed.test(path))).toEqual([]);
  });
});

describe('error codes', () => {
  const document = /** @type {import('./lib/guides.mjs').OpenApiDocument} */ (
    readJson(OPENAPI_DOCUMENT)
  );
  const codes = [...problemCodes(document).codes.keys()];

  it('gives every problem code a page at its type URL', () => {
    expect(codes.length).toBeGreaterThan(50);
    for (const code of codes) {
      const route = errorRoute(code);
      expect(`${PROBLEM_TYPE_BASE}${kebab(code)}`).toBe(
        `https://developers.tassyir.io${route}`,
      );
      expect(files.has(`${route.slice(1)}.mdx`), code).toBe(true);
      expect(pages).toContain(route.slice(1));
    }
  });

  it('matches the type the guides show for PERMISSION_DENIED', () => {
    const errorsGuide = readFileSync(
      join(ROOT, 'docs', 'guides', 'errors.md'),
      'utf8',
    );
    expect(errorsGuide).toContain(
      `"type": "${PROBLEM_TYPE_BASE}permission-denied"`,
    );
    expect(files.get('errors/permission-denied.mdx')).toContain(
      'title: "PERMISSION_DENIED"',
    );
  });
});

describe('API reference', () => {
  it('shows each vendored OpenAPI document, byte for byte', () => {
    expect(OPENAPI_SOURCES.map(({ source }) => source)).toContain(
      'packages/app/openapi/openapi.2026-10.json',
    );
    for (const { source } of OPENAPI_SOURCES) {
      const copy = join(SITE_DIR, 'openapi', source.split('/').pop() ?? '');
      expect(
        readFileSync(copy).equals(readFileSync(join(ROOT, source))),
        SYNC,
      ).toBe(true);
    }
  });

  it('sends no token anywhere: no request builder, no proxy', () => {
    // The interactive playground would send an app or developer token
    // either through Mintlify's proxy or from the browser to
    // api.tassyir.io, whose CORS does not admit the docs domain.
    expect(docsJson.api.playground).toEqual({
      display: 'simple',
      proxy: false,
    });
  });

  it('uses no paid Mintlify feature', () => {
    expect(docsJson.contextual.options).not.toContain('assistant');
    expect(docsJson).not.toHaveProperty('integrations');
  });
});

describe('the pages written by hand', () => {
  it('installs the Claude Code plugin the marketplace lists', () => {
    const marketplace =
      /** @type {{ name: string, plugins: { name: string }[] }} */ (
        readJson(MARKETPLACE_JSON)
      );
    const page = readFileSync(join(SITE_DIR, 'claude-code.mdx'), 'utf8');
    expect(page).toContain('/plugin marketplace add tassyir/apps-sdk');
    for (const { name } of marketplace.plugins) {
      expect(page).toContain(`/plugin install ${name}@${marketplace.name}`);
    }
  });

  it('gives every public package a page', () => {
    for (const { folder } of publicPackages()) {
      expect(pages).toContain(`packages/${folder}`);
    }
  });
});

describe('the Mintlify CLI', () => {
  it('is one exact version, its dependencies resolved by date', () => {
    expect(MINT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(MINT_BEFORE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const ci = readFileSync(
      join(ROOT, '.github', 'workflows', 'ci.yml'),
      'utf8',
    );
    expect(ci).toContain('npm run docs:check');
  });
});
