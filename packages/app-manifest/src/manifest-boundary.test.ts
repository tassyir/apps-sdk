import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The validator is run by third-party developers, in Node and in browsers,
 * and by the Tassyir API. The library must stay pure: `zod` and its own
 * files, no Node built-ins, no I/O, and nothing that makes the same input
 * give a different answer (clock, randomness). Specs and test harnesses are
 * exempt. Ported from the backend's `manifest-boundary.spec.ts` (AP-B1.2).
 */

const FOLDER = dirname(fileURLToPath(import.meta.url));
const ALLOWED_PACKAGES = new Set(['zod']);

const sources = readdirSync(FOLDER)
  .filter((file) => file.endsWith('.ts'))
  .filter((file) => !/\.(test|test-harness)\.ts$/.test(file))
  .sort();

/** Every module specifier: import/export from, require(), import(). */
function specifiers(code: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const [, specifier] of code.matchAll(pattern)) {
      if (specifier !== undefined) found.push(specifier);
    }
  }
  return found;
}

/** Code without comments, so prose may name what code may not use. */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const FORBIDDEN: [RegExp, string][] = [
  [/\bprocess\.\w/, 'process (environment, exit)'],
  [/\bBuffer\b/, 'Buffer (Node only)'],
  [/\brequire\s*\(/, 'require()'],
  [/\bimport\s*\(/, 'dynamic import()'],
  [/__dirname|__filename|import\.meta/, 'file system paths'],
  [/\bconsole\.\w/, 'console'],
  [/\bfetch\s*\(|XMLHttpRequest|WebSocket/, 'network'],
  [/\bDate\.now\s*\(|new Date\s*\(\s*\)/, 'the clock'],
  [/\bMath\.random\b|\bcrypto\.\w/, 'randomness'],
  [/\bsetTimeout\b|\bsetInterval\b|\bsetImmediate\b/, 'timers'],
  [/\beval\s*\(|new Function\s*\(/, 'eval'],
];

describe('the library boundary (what @tassyir/app-manifest is made of)', () => {
  it('has the files the package is made of', () => {
    expect(sources).toEqual([
      'index.ts',
      'manifest-format.ts',
      'manifest-helpers.ts',
      'manifest-limits.ts',
      'manifest-schema.ts',
      'manifest-types.ts',
      'validate-manifest.ts',
      'vocabulary.ts',
    ]);
  });

  it.each(sources)('%s imports only zod and files of this folder', (file) => {
    const code = readFileSync(join(FOLDER, file), 'utf8');
    for (const specifier of specifiers(code)) {
      if (ALLOWED_PACKAGES.has(specifier)) continue;
      expect(specifier).toMatch(/^\.\.?\//);
      const target = normalize(join(FOLDER, specifier));
      expect(relative(FOLDER, target).startsWith('..')).toBe(false);
    }
  });

  it.each(sources)(
    '%s uses no I/O, clock, randomness or runtime globals',
    (file) => {
      const code = stripComments(readFileSync(join(FOLDER, file), 'utf8'));
      const used = FORBIDDEN.filter(([pattern]) => pattern.test(code)).map(
        ([, what]) => what,
      );
      expect(used).toEqual([]);
    },
  );

  it('the specifier scan is not vacuous', () => {
    expect(
      specifiers(
        "import { a } from 'src/x';\nimport type { B } from '../y';\nexport { c } from './z';\nconst d = require('fs');\nawait import('ioredis');",
      ),
    ).toEqual(['src/x', '../y', './z', 'fs', 'ioredis']);
    const code = readFileSync(join(FOLDER, 'validate-manifest.ts'), 'utf8');
    expect(specifiers(code)).toContain('zod');
  });
});
