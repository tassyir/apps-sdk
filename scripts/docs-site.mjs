// Writes the generated parts of the docs site (site/, developers.tassyir.io)
// from their sources: the guides, the error pages, the package pages, the
// OpenAPI copies, and docs.json's navigation, colours and face
// (scripts/lib/docs-site.mjs says what comes from where). It first brings
// docs/guides/errors.md in step with the OpenAPI document, as
// `npm run guides:errors` does, since the error pages are built from both.
// scripts/docs-site.test.mjs fails while anything here is stale, so run this
// after adding or changing a guide, a package README or the vendored OpenAPI
// file. Files in the generated folders that nothing generates are deleted.
// Usage: npm run docs:sync

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { colors, fonts } from '../packages/ui/src/tokens.ts';
import {
  ERRORS_GUIDE,
  OPENAPI_DOCUMENT,
  expectedErrorsGuide,
} from './guides-errors.mjs';
import {
  GENERATED_DIRS,
  GENERATED_KEYS,
  OPENAPI_SOURCES,
  errorPages,
  guidePage,
  navigation,
  packagePage,
  themeSettings,
} from './lib/docs-site.mjs';
import {
  documentedCodes,
  guideSetProblems,
  parseGuide,
} from './lib/guides.mjs';
import { ROOT, readJson, workspaces } from './lib/workspace.mjs';

export const SITE_DIR = join(ROOT, 'site');
export const DOCS_JSON = join(SITE_DIR, 'docs.json');
export const GUIDES_DIR = join(ROOT, 'docs', 'guides');

/** The guides of docs/guides (README.md is for their authors), by file. */
export function readGuides() {
  return readdirSync(GUIDES_DIR)
    .filter((file) => file.endsWith('.md') && file !== 'README.md')
    .sort()
    .map((file) =>
      parseGuide(
        file.slice(0, -3),
        readFileSync(join(GUIDES_DIR, file), 'utf8'),
      ),
    );
}

/** The public packages and their READMEs, by folder. */
export function publicPackages() {
  return workspaces()
    .filter(({ manifest }) => manifest.private !== true)
    .map(({ dir, folder, manifest }) => ({
      folder,
      name: manifest.name ?? folder,
      description: manifest.description ?? '',
      readme: readFileSync(join(dir, 'README.md'), 'utf8'),
    }));
}

/**
 * What `npm run docs:sync` owns: every generated file (its path in site/ →
 * its content) and docs.json's generated keys.
 */
export function expectedSite() {
  const guides = readGuides();
  const problems = guideSetProblems(guides);
  if (problems.length > 0) throw new Error(problems.join('\n'));
  const document = /** @type {import('./lib/guides.mjs').OpenApiDocument} */ (
    readJson(OPENAPI_DOCUMENT)
  );
  const codes = documentedCodes(document);
  const packages = publicPackages();
  const [admin] = OPENAPI_SOURCES;
  if (!admin) throw new Error('OPENAPI_SOURCES is empty');

  /** @type {Map<string, string>} */
  const files = new Map();
  for (const guide of guides) {
    files.set(
      `guides/${guide.slug}.mdx`,
      guidePage(guide, guide.slug === 'errors' ? new Set(codes) : undefined),
    );
  }
  const errorsGuide = readFileSync(ERRORS_GUIDE, 'utf8');
  for (const [path, content] of errorPages(
    document,
    errorsGuide,
    admin.directory,
  )) {
    files.set(path, content);
  }
  for (const pkg of packages) {
    files.set(`packages/${pkg.folder}.mdx`, packagePage(pkg));
  }
  for (const { source } of OPENAPI_SOURCES) {
    files.set(
      `openapi/${posix.basename(source)}`,
      readFileSync(join(ROOT, source), 'utf8'),
    );
  }
  return {
    files,
    keys: {
      ...themeSettings({ colors, fonts }),
      navigation: navigation({ guides, codes, packages }),
    },
  };
}

/**
 * docs.json with its generated keys replaced (in place, so the file keeps
 * its order), formatted as `npm run format` formats it.
 * @param {string} current
 * @param {Record<string, unknown>} keys
 * @returns {Promise<string>}
 */
export async function expectedDocsJson(current, keys) {
  /** @type {unknown} */
  const parsed = JSON.parse(current);
  const config = /** @type {Record<string, unknown>} */ (parsed);
  for (const key of GENERATED_KEYS) config[key] = keys[key];
  const options = (await resolveConfig(DOCS_JSON)) ?? {};
  return format(JSON.stringify(config), { ...options, filepath: DOCS_JSON });
}

/**
 * The files now in site/'s generated folders (path in site/ → content).
 * @returns {Map<string, string>}
 */
export function generatedFilesOnDisk() {
  /** @type {Map<string, string>} */
  const files = new Map();
  for (const folder of GENERATED_DIRS) {
    const dir = join(SITE_DIR, folder);
    /** @type {string[]} */
    let entries;
    try {
      entries = readdirSync(dir, { recursive: true, encoding: 'utf8' });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(dir, entry);
      try {
        files.set(
          relative(SITE_DIR, path).split('\\').join('/'),
          readFileSync(path, 'utf8'),
        );
      } catch {
        // a folder
      }
    }
  }
  return files;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const errors = readFileSync(ERRORS_GUIDE, 'utf8');
  const expectedErrors = await expectedErrorsGuide(errors);
  if (expectedErrors !== errors) {
    writeFileSync(ERRORS_GUIDE, expectedErrors);
    console.log('✓ wrote docs/guides/errors.md');
  }

  const { files, keys } = expectedSite();
  const onDisk = generatedFilesOnDisk();
  let changed = 0;
  for (const [path, content] of files) {
    if (onDisk.get(path) === content) continue;
    mkdirSync(dirname(join(SITE_DIR, path)), { recursive: true });
    writeFileSync(join(SITE_DIR, path), content);
    changed += 1;
  }
  for (const path of onDisk.keys()) {
    if (files.has(path)) continue;
    rmSync(join(SITE_DIR, path));
    console.log(`✓ deleted site/${path}`);
    changed += 1;
  }
  const docsJson = readFileSync(DOCS_JSON, 'utf8');
  const expectedJson = await expectedDocsJson(docsJson, keys);
  if (expectedJson !== docsJson) {
    writeFileSync(DOCS_JSON, expectedJson);
    changed += 1;
  }
  console.log(
    changed === 0
      ? `✓ site/ is up to date (${String(files.size)} generated files)`
      : `✓ wrote ${String(changed)} file(s) of site/ (${String(files.size)} generated files)`,
  );
}
