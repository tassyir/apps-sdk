import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The renderer runs on the storefront's server, in the builder's browser
 * bundle and in the CLI, and must give the same bytes everywhere. So the
 * library imports nothing but its own files and uses nothing whose answer
 * depends on the machine: no clock, no randomness, no `Intl` or locale
 * method, no Node or DOM API, no dynamic code. Specs and harnesses are exempt.
 */

const FOLDER = dirname(fileURLToPath(import.meta.url));

function files(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    return entry.isDirectory()
      ? files(path)
      : entry.name.endsWith('.ts')
        ? [path]
        : [];
  });
}

const ALL = files(FOLDER).sort();
const LIBRARY = ALL.filter((file) => !/\.(test|test-harness)\.ts$/.test(file));

function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

const FORBIDDEN: [RegExp, string][] = [
  [/\bprocess\b/, 'process'],
  [/\bBuffer\b/, 'Buffer'],
  [/\brequire\s*\(/, 'require()'],
  [/\bimport\s*\(/, 'dynamic import()'],
  [/import\.meta|__dirname|__filename/, 'file paths'],
  [/\bDate\b/, 'the clock'],
  [/\bperformance\b/, 'the clock'],
  [/Math\.random/, 'randomness'],
  [/\bcrypto\b/, 'randomness'],
  [/\bIntl\b/, 'Intl (ICU data differs between runtimes)'],
  [/\.toLocale\w*\(|localeCompare/, 'a locale method'],
  [/\bnormalize\s*\(/, 'Unicode normalisation'],
  [
    /\b(?:window|document|globalThis|navigator|fetch|XMLHttpRequest|setTimeout|setInterval|queueMicrotask)\b/,
    'a host API',
  ],
  [/\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(/, 'dynamic code'],
  [/\\p\{/, 'a Unicode property escape (its tables differ between engines)'],
];

describe('package boundary', () => {
  it('library code imports only its own files', () => {
    const outside: string[] = [];
    for (const file of LIBRARY) {
      const code = readFileSync(file, 'utf8');
      for (const [, specifier] of code.matchAll(
        /\b(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?['"]([^'"]+)['"]/g,
      )) {
        if (!specifier?.startsWith('./') && !specifier?.startsWith('../'))
          outside.push(`${relative(FOLDER, file)}: ${String(specifier)}`);
      }
    }
    expect(outside).toEqual([]);
  });

  it('library code uses nothing that differs between machines', () => {
    const found: string[] = [];
    for (const file of LIBRARY) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const [pattern, what] of FORBIDDEN) {
        if (pattern.test(code))
          found.push(`${relative(FOLDER, file)}: ${what}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('no source file holds a literal invisible, bidi or control character (write them as escapes)', () => {
    const found: string[] = [];
    for (const file of ALL) {
      const code = readFileSync(file, 'utf8');
      code.split('\n').forEach((line, index) => {
        for (const char of line) {
          const n = char.codePointAt(0) ?? 0;
          const invisible =
            (n < 0x20 && n !== 9) ||
            (n >= 0x7f && n <= 0xa0) ||
            n === 0xad ||
            (n >= 0x200b && n <= 0x200f) ||
            (n >= 0x2028 && n <= 0x202f) ||
            (n >= 0x2060 && n <= 0x206f) ||
            n === 0xfeff ||
            (n >= 0xe000 && n <= 0xf8ff) ||
            n >= 0xe0000;
          if (invisible)
            found.push(
              `${relative(FOLDER, file)}:${(index + 1).toString()} U+${n.toString(16).toUpperCase()}`,
            );
        }
      });
    }
    expect(found).toEqual([]);
  });
});
