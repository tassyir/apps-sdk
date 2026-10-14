import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as published from './index.js';
import { MANIFEST_ERROR_CODES } from './manifest-types.js';

/**
 * The package README is what an agent reads in node_modules: its error-code
 * table and its API table must match the code. (Its TOML examples are
 * validated in `vocabulary.test.ts`.)
 */

const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

/** The text of one `## ` section. */
function section(title: string): string {
  const start = README.indexOf(`\n## ${title}\n`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = README.indexOf('\n## ', start + 1);
  return README.slice(start, end === -1 ? undefined : end);
}

describe('README.md', () => {
  it('lists exactly the error codes, in order', () => {
    const documented = [
      ...section('What you get back').matchAll(
        /^\| `(MANIFEST_[A-Z_]+)` +\|/gm,
      ),
    ].map(([, code]) => code);
    expect(documented).toEqual([...MANIFEST_ERROR_CODES]);
  });

  it('names only real exports in its API table', () => {
    const named = [
      ...section('API').matchAll(/^\| `([A-Za-z_]+)[(`]/gm),
      ...section('API').matchAll(/, `([A-Z_]+)`/g),
    ].map(([, name]) => name ?? '');
    expect(named.length).toBeGreaterThan(8);
    expect(named.filter((name) => !(name in published))).toEqual([]);
  });
});
