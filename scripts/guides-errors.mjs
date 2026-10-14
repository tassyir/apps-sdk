// Writes the generated part of docs/guides/errors.md (every Admin API problem
// code, and the token endpoint's OAuth errors) from the OpenAPI document
// @tassyir/app is typed from, packages/app/openapi/openapi.2026-10.json.
// The hand-written part around it is kept. scripts/guides.test.mjs fails
// while the file is stale, so re-run this after `npm run openapi:update -w
// @tassyir/app`.
// Usage: npm run guides:errors

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { renderErrorReference, withGeneratedBlock } from './lib/guides.mjs';
import { ROOT, readJson } from './lib/workspace.mjs';

export const ERRORS_GUIDE = join(ROOT, 'docs', 'guides', 'errors.md');
export const OPENAPI_DOCUMENT = join(
  ROOT,
  'packages',
  'app',
  'openapi',
  'openapi.2026-10.json',
);

/**
 * errors.md as it should be: its generated block rebuilt from the OpenAPI
 * document, formatted the way `npm run format` formats it.
 * @param {string} source the current file
 * @returns {Promise<string>}
 */
export async function expectedErrorsGuide(source) {
  const document = /** @type {import('./lib/guides.mjs').OpenApiDocument} */ (
    readJson(OPENAPI_DOCUMENT)
  );
  const options = (await resolveConfig(ERRORS_GUIDE)) ?? {};
  return format(withGeneratedBlock(source, renderErrorReference(document)), {
    ...options,
    filepath: ERRORS_GUIDE,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const source = readFileSync(ERRORS_GUIDE, 'utf8');
  const expected = await expectedErrorsGuide(source);
  if (expected === source) {
    console.log('✓ docs/guides/errors.md is up to date');
  } else {
    writeFileSync(ERRORS_GUIDE, expected);
    console.log('✓ wrote docs/guides/errors.md');
  }
}
