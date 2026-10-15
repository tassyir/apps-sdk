import { describe, expect, it } from 'vitest';
import {
  bundlePathProblem,
  HOSTED_BUNDLE_LIMITS,
  LOCKFILE_NAMES,
  moduleKindOf,
  validateHostedBundle,
} from './bundle-rules.js';
import type { CliProblem } from './errors.js';

// The backend's own spec of its bundle validator (tassyir/backend
// `src/app-platform/hosting/hosted-bundle.spec.ts`, the `validateHostedBundle`
// and `bundlePathProblem` blocks), run against the CLI's copy: the copy
// passes exactly what the API passes. Only the imports and the strict-index
// guards (`errors[0]?.`) differ. Characters that tools may mangle are built
// with `String.fromCharCode`.

const WORKER = 'export default { fetch() { return new Response("ok"); } };\n';

function bundle(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    main: 'worker.js',
    files: [{ path: 'worker.js', content: WORKER }],
    ...overrides,
  };
}

function okOf(input: unknown) {
  const result = validateHostedBundle(input);
  if (!result.ok) {
    throw new Error(
      `expected a valid bundle: ${JSON.stringify(result.errors)}`,
    );
  }
  return result;
}

function errorsOf(input: unknown): CliProblem[] {
  const result = validateHostedBundle(input);
  if (result.ok) throw new Error('expected the bundle to be refused');
  return result.errors;
}

function codesOf(input: unknown): string[] {
  return errorsOf(input).map((error) => error.code);
}

/** A second file next to worker.js; `content` defaults to 'x' only when omitted. */
function withFile(path: unknown, ...content: [unknown?]) {
  return bundle({
    files: [
      { path: 'worker.js', content: WORKER },
      { path, content: content.length > 0 ? content[0] : 'x' },
    ],
  });
}

describe('validateHostedBundle', () => {
  describe('the document', () => {
    it('accepts the smallest bundle', () => {
      const result = okOf(bundle());
      expect(result.bundle).toEqual({
        main: 'worker.js',
        files: [{ path: 'worker.js', content: WORKER, kind: 'esm' }],
        lockfile: null,
      });
      expect(result.bytes).toBe(Buffer.byteLength(WORKER));
    });

    it.each([null, undefined, 'bundle', 42, true, []])(
      'refuses %p as not an object',
      (input) => {
        const errors = errorsOf(input);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
          code: 'BUNDLE_NOT_A_TABLE',
          path: 'bundle',
        });
      },
    );

    it('names an unknown bundle field, in sorted order', () => {
      const errors = errorsOf(bundle({ zeta: 1, alpha: 2 }));
      expect(
        errors
          .filter((error) => error.code === 'BUNDLE_FIELD_UNKNOWN')
          .map((error) => error.path),
      ).toEqual(['bundle.alpha', 'bundle.zeta']);
    });

    it('treats an own "__proto__" key as an unknown field', () => {
      const input = JSON.parse(
        `{"main":"worker.js","files":[{"path":"worker.js","content":"x"}],"__proto__":{"main":"x"}}`,
      ) as unknown;
      expect(errorsOf(input).map((error) => error.path)).toContain(
        'bundle.__proto__',
      );
    });

    it('never reads main or files through the prototype chain', () => {
      const inherited = Object.create({
        main: 'worker.js',
        files: [{ path: 'worker.js', content: WORKER }],
      }) as unknown;
      expect(codesOf(inherited)).toEqual(
        expect.arrayContaining(['BUNDLE_FILES_INVALID', 'BUNDLE_MAIN_INVALID']),
      );
    });

    it('echoes an unknown key without control characters', () => {
      const key = `bad${String.fromCharCode(7)}key${String.fromCharCode(0x1b)}`;
      const errors = errorsOf(bundle({ [key]: 1 }));
      const unknown = errors.find(
        (error) => error.code === 'BUNDLE_FIELD_UNKNOWN',
      );
      expect(unknown?.path).toBe('bundle.bad?key?');
      expect(unknown?.message).toBe('"bad?key?" is not a bundle field');
    });
  });

  describe('the file list', () => {
    it.each([
      ['no files key', bundle({ files: undefined })],
      ['not an array', bundle({ files: 'worker.js' })],
      ['an object', bundle({ files: {} })],
      ['zero files', bundle({ files: [] })],
    ])('refuses %s', (_name, input) => {
      const errors = errorsOf(input);
      expect(errors[0]).toMatchObject({
        code: 'BUNDLE_FILES_INVALID',
        path: 'bundle.files',
      });
      // With no modules, main cannot name one either.
      expect(errors.map((error) => error.code)).toContain(
        'BUNDLE_MAIN_INVALID',
      );
    });

    it('accepts 100 files and refuses 101', () => {
      const many = (count: number) =>
        bundle({
          main: 'm0.js',
          files: Array.from({ length: count }, (_value, index) => ({
            path: `m${index}.js`,
            content: 'x',
          })),
        });
      expect(
        okOf(many(HOSTED_BUNDLE_LIMITS.maxFiles)).bundle.files,
      ).toHaveLength(100);
      expect(
        errorsOf(many(HOSTED_BUNDLE_LIMITS.maxFiles + 1))[0],
      ).toMatchObject({
        code: 'BUNDLE_FILES_INVALID',
      });
    });

    it.each([null, 'worker.js', 7, [], undefined])(
      'refuses a file that is %p',
      (file) => {
        const errors = errorsOf(
          bundle({ files: [{ path: 'worker.js', content: 'x' }, file] }),
        );
        expect(errors).toEqual([
          expect.objectContaining({
            code: 'BUNDLE_FILE_INVALID',
            path: 'bundle.files[1]',
          }),
        ]);
      },
    );

    it('names an unknown file field and keeps validating the file', () => {
      const errors = errorsOf(
        bundle({ files: [{ path: 'worker.js', content: 'x', mode: 'rw' }] }),
      );
      expect(errors).toEqual([
        expect.objectContaining({
          code: 'BUNDLE_FIELD_UNKNOWN',
          path: 'bundle.files[0].mode',
        }),
      ]);
    });
  });

  describe('paths', () => {
    it.each([
      ['a parent folder', '../x.js'],
      ['an absolute path', '/a.js'],
      ['a dotfile', '.env'],
      ['a dot segment', './a.js'],
      ['an empty segment', 'a//b.js'],
      ['a trailing slash', 'a/b.js/'],
      ['a space', 'my worker.js'],
      ['a backslash', 'a\\b.js'],
      ['a non-ASCII letter', 'café.js'],
      ['a name starting with a dot', 'a/.hidden.js'],
      ['a name starting with a hyphen', '-a.js'],
    ])('refuses %s (%s)', (_name, path) => {
      const errors = errorsOf(withFile(path));
      expect(errors).toEqual([
        expect.objectContaining({
          code: 'BUNDLE_PATH_INVALID',
          path: 'bundle.files[1].path',
        }),
      ]);
      expect(errors[0]?.message).toContain('uses a character other than');
    });

    it.each([[''], [42], [null], [undefined], [['a.js']]])(
      'refuses the non-path %p',
      (path) => {
        const errors = errorsOf(withFile(path));
        expect(errors[0]).toMatchObject({ code: 'BUNDLE_PATH_INVALID' });
        expect(errors[0]?.message).toContain('is not a path');
      },
    );

    it('allows 200 characters and refuses 201', () => {
      const exact = `${'a'.repeat(197)}.js`;
      expect(exact).toHaveLength(200);
      expect(okOf(withFile(exact)).bundle.files.map((f) => f.path)).toContain(
        exact,
      );
      const errors = errorsOf(withFile(`${'a'.repeat(198)}.js`));
      expect(errors[0]?.code).toBe('BUNDLE_PATH_INVALID');
      expect(errors[0]?.message).toContain('is longer than 200 characters');
    });

    it('allows a file in 9 folders and refuses one in 10', () => {
      const nine = `${'a/'.repeat(9)}x.js`;
      expect(nine.split('/')).toHaveLength(10);
      okOf(withFile(nine));
      const ten = `${'a/'.repeat(10)}x.js`;
      const errors = errorsOf(withFile(ten));
      expect(errors[0]?.code).toBe('BUNDLE_PATH_INVALID');
      expect(errors[0]?.message).toBe(
        `The path "${ten}" is in more than 9 folders`,
      );
    });

    it('echoes a long or odd path shortened and without control characters', () => {
      const path = `${'a'.repeat(100)}${String.fromCharCode(0)}.js`;
      const [error] = errorsOf(withFile(path));
      expect(error?.message).toContain('...');
      // eslint-disable-next-line no-control-regex
      expect(error?.message).not.toMatch(/[\u0000-\u001f]/);
    });

    it('reports the failing path of the right file only', () => {
      const errors = errorsOf(
        bundle({
          files: [
            { path: 'worker.js', content: WORKER },
            { path: 'ok.json', content: '{}' },
            { path: '../bad.js', content: 'x' },
          ],
        }),
      );
      expect(errors.map((error) => error.path)).toEqual([
        'bundle.files[2].path',
      ]);
    });
  });

  describe('file types', () => {
    it.each([
      ['.wasm', 'module.wasm'],
      ['.map', 'worker.js.map'],
      ['no extension', 'worker'],
      ['.ts', 'worker.ts'],
      ['.png', 'logo.png'],
      ['a trailing dot', 'worker.'],
    ])('refuses %s (%s)', (_name, path) => {
      expect(errorsOf(withFile(path))).toEqual([
        expect.objectContaining({
          code: 'BUNDLE_FILE_TYPE_NOT_ALLOWED',
          path: 'bundle.files[1].path',
        }),
      ]);
    });

    it.each([
      ['a.js', 'esm'],
      ['a.mjs', 'esm'],
      ['a.html', 'text'],
      ['a.css', 'text'],
      ['a.txt', 'text'],
      ['a.json', 'text'],
      ['a.svg', 'text'],
      ['a.liquid', 'text'],
      ['deep/er/a.min.js', 'esm'],
    ])('types %s as %s', (path, kind) => {
      expect(moduleKindOf(path)).toBe(kind);
      const result = okOf(withFile(path));
      expect(result.bundle.files.find((file) => file.path === path)?.kind).toBe(
        kind,
      );
    });

    it('has no kind for a folder named like a module or an unknown extension', () => {
      expect(moduleKindOf('a.js/readme')).toBeNull();
      expect(moduleKindOf('.js')).toBeNull();
      expect(moduleKindOf('a.wasm')).toBeNull();
    });
  });

  describe('duplicates', () => {
    it('refuses a path listed twice, ignoring case', () => {
      const errors = errorsOf(
        bundle({
          files: [
            { path: 'worker.js', content: WORKER },
            { path: 'Assets/Page.html', content: 'a' },
            { path: 'assets/page.html', content: 'b' },
          ],
        }),
      );
      expect(errors).toEqual([
        expect.objectContaining({
          code: 'BUNDLE_PATH_DUPLICATE',
          path: 'bundle.files[2].path',
        }),
      ]);
    });

    it('refuses the exact same path twice', () => {
      expect(codesOf(withFile('worker.js'))).toEqual(['BUNDLE_PATH_DUPLICATE']);
    });

    it('treats two paths that differ in more than case as different', () => {
      okOf(withFile('worker2.js'));
    });
  });

  describe('content', () => {
    it.each([
      ['a number', 123],
      ['null', null],
      ['undefined', undefined],
      ['an array', ['x']],
      ['an object', { a: 1 }],
    ])('refuses content that is %s', (_name, content) => {
      const errors = errorsOf(withFile('extra.js', content));
      expect(errors).toEqual([
        expect.objectContaining({
          code: 'BUNDLE_CONTENT_INVALID',
          path: 'bundle.files[1].content',
        }),
      ]);
      expect(errors[0]?.message).toContain('is not a string');
    });

    it('refuses a lone high surrogate, a lone low surrogate and a swapped pair', () => {
      const high = String.fromCharCode(0xd800);
      const low = String.fromCharCode(0xdc00);
      for (const content of [
        `a${high}b`,
        `a${low}b`,
        high,
        low,
        `${low}${high}`,
        `end${high}`,
      ]) {
        const errors = errorsOf(withFile('extra.js', content));
        expect(errors).toEqual([
          expect.objectContaining({ code: 'BUNDLE_CONTENT_INVALID' }),
        ]);
        expect(errors[0]?.message).toContain('holds a lone surrogate');
      }
    });

    it('accepts a surrogate PAIR (an emoji)', () => {
      const emoji = String.fromCodePoint(0x1f600);
      const result = okOf(withFile('extra.js', `const s = "${emoji}";`));
      expect(
        result.bundle.files.find((file) => file.path === 'extra.js')?.content,
      ).toContain(emoji);
    });

    it('refuses a NUL character', () => {
      const nul = String.fromCharCode(0);
      const errors = errorsOf(withFile('extra.js', `a${nul}b`));
      expect(errors).toEqual([
        expect.objectContaining({ code: 'BUNDLE_CONTENT_INVALID' }),
      ]);
      expect(errors[0]?.message).toContain('holds a NUL character');
    });

    it('accepts empty content', () => {
      okOf(withFile('empty.txt', ''));
    });
  });

  describe('size', () => {
    it('allows exactly 3 MiB of modules and refuses one byte more', () => {
      const exact = 'a'.repeat(HOSTED_BUNDLE_LIMITS.maxBytes);
      const result = okOf(
        bundle({ files: [{ path: 'worker.js', content: exact }] }),
      );
      expect(result.bytes).toBe(HOSTED_BUNDLE_LIMITS.maxBytes);

      const errors = errorsOf(
        bundle({ files: [{ path: 'worker.js', content: `${exact}a` }] }),
      );
      expect(errors).toEqual([
        expect.objectContaining({
          code: 'BUNDLE_TOO_LARGE',
          path: 'bundle.files',
        }),
      ]);
      expect(errors[0]?.message).toContain(
        String(HOSTED_BUNDLE_LIMITS.maxBytes + 1),
      );
    });

    it('counts UTF-8 bytes, not characters', () => {
      // Fewer characters than the limit, more bytes than it.
      const content = 'é'.repeat(1_700_000);
      expect(content.length).toBeLessThan(HOSTED_BUNDLE_LIMITS.maxBytes);
      expect(
        codesOf(bundle({ files: [{ path: 'worker.js', content }] })),
      ).toEqual(['BUNDLE_TOO_LARGE']);
    });

    it('adds every file up', () => {
      const half = 'a'.repeat(HOSTED_BUNDLE_LIMITS.maxBytes / 2 + 1);
      expect(
        codesOf(
          bundle({
            files: [
              { path: 'worker.js', content: half },
              { path: 'other.js', content: half },
            ],
          }),
        ),
      ).toEqual(['BUNDLE_TOO_LARGE']);
    });

    it('does not count the lockfile in the modules', () => {
      const exact = 'a'.repeat(HOSTED_BUNDLE_LIMITS.maxBytes);
      okOf(
        bundle({
          files: [{ path: 'worker.js', content: exact }],
          lockfile: { name: 'package-lock.json', content: '{}' },
        }),
      );
    });
  });

  describe('main', () => {
    it.each([
      ['missing', undefined],
      ['not a string', 7],
      ['null', null],
      ['not one of the files', 'other.js'],
      ['a different case than the file', 'Worker.js'],
      ['a text module', 'page.html'],
    ])('refuses a main that is %s', (_name, main) => {
      const errors = errorsOf(
        bundle({
          main,
          files: [
            { path: 'worker.js', content: WORKER },
            { path: 'page.html', content: '<p></p>' },
          ],
        }),
      );
      expect(errors).toEqual([
        expect.objectContaining({
          code: 'BUNDLE_MAIN_INVALID',
          path: 'bundle.main',
        }),
      ]);
    });

    it('accepts an .mjs main and a main in a folder', () => {
      okOf(
        bundle({
          main: 'dist/index.mjs',
          files: [{ path: 'dist/index.mjs', content: WORKER }],
        }),
      );
    });

    it('refuses a main whose file was itself refused', () => {
      expect(
        codesOf(
          bundle({
            main: '../x.js',
            files: [{ path: '../x.js', content: WORKER }],
          }),
        ),
      ).toEqual(['BUNDLE_PATH_INVALID', 'BUNDLE_MAIN_INVALID']);
    });
  });

  describe('lockfile', () => {
    it.each(LOCKFILE_NAMES)('accepts %s', (name) => {
      const result = okOf(bundle({ lockfile: { name, content: 'lock' } }));
      expect(result.bundle.lockfile).toEqual({ name, content: 'lock' });
    });

    it.each([undefined, null])('takes %p as no lockfile', (lockfile) => {
      expect(okOf(bundle({ lockfile })).bundle.lockfile).toBeNull();
    });

    it.each([
      ['an unknown name', { name: 'composer.lock', content: 'x' }],
      ['a path as the name', { name: 'sub/package-lock.json', content: 'x' }],
      ['a name in another case', { name: 'Package-Lock.json', content: 'x' }],
      ['no name', { content: 'x' }],
      ['no content', { name: 'yarn.lock' }],
      ['content that is not a string', { name: 'yarn.lock', content: 5 }],
      ['an extra key', { name: 'yarn.lock', content: 'x', integrity: 'y' }],
      [
        'a NUL in the content',
        { name: 'yarn.lock', content: `a${String.fromCharCode(0)}` },
      ],
      [
        'a lone surrogate in the content',
        { name: 'yarn.lock', content: `a${String.fromCharCode(0xd800)}` },
      ],
      ['a string', 'package-lock.json'],
      ['an array', []],
      ['a number', 3],
    ])('refuses a lockfile with %s', (_name, lockfile) => {
      expect(errorsOf(bundle({ lockfile }))).toEqual([
        expect.objectContaining({
          code: 'BUNDLE_LOCKFILE_INVALID',
          path: 'bundle.lockfile',
        }),
      ]);
    });

    it('allows 1 MiB of lockfile and refuses one byte more', () => {
      const name = 'package-lock.json';
      const exact = 'a'.repeat(HOSTED_BUNDLE_LIMITS.maxLockfileBytes);
      okOf(bundle({ lockfile: { name, content: exact } }));
      expect(
        errorsOf(bundle({ lockfile: { name, content: `${exact}a` } })),
      ).toEqual([
        expect.objectContaining({
          code: 'BUNDLE_LOCKFILE_INVALID',
          path: 'bundle.lockfile.content',
        }),
      ]);
    });
  });

  describe('errors', () => {
    it('carries a code, a path, a message and a fix, all non-empty strings', () => {
      const errors = errorsOf({
        extra: 1,
        main: 'nope.js',
        files: [
          { path: '../a.js', content: 'x' },
          { path: 'b.wasm', content: 'x' },
          { path: 'c.js', content: 1 },
          { path: 'd.js', content: 'x', mode: 1 },
        ],
        lockfile: { name: 'x', content: 'y' },
      });
      expect(new Set(errors.map((error) => error.code))).toEqual(
        new Set([
          'BUNDLE_FIELD_UNKNOWN',
          'BUNDLE_PATH_INVALID',
          'BUNDLE_FILE_TYPE_NOT_ALLOWED',
          'BUNDLE_CONTENT_INVALID',
          'BUNDLE_MAIN_INVALID',
          'BUNDLE_LOCKFILE_INVALID',
        ]),
      );
      for (const error of errors) {
        for (const field of ['code', 'path', 'message', 'fix'] as const) {
          expect(typeof error[field]).toBe('string');
          expect(error[field].length).toBeGreaterThan(0);
        }
      }
    });

    it('lists every error at once, in a stable order', () => {
      const input = {
        extra: 1,
        main: 'gone.js',
        files: [
          { path: '../a.js', content: 'x' },
          { path: 'b.wasm', content: 'x' },
        ],
        lockfile: 'x',
      };
      const first = codesOf(input);
      expect(first).toEqual([
        'BUNDLE_FIELD_UNKNOWN',
        'BUNDLE_PATH_INVALID',
        'BUNDLE_FILE_TYPE_NOT_ALLOWED',
        'BUNDLE_MAIN_INVALID',
        'BUNDLE_LOCKFILE_INVALID',
      ]);
      expect(codesOf(input)).toEqual(first);
    });

    it('stops at 50 errors', () => {
      const files = Array.from({ length: 60 }, () => ({
        path: '../bad.js',
        content: 'x',
      }));
      const errors = errorsOf(bundle({ files }));
      expect(errors).toHaveLength(50);
      expect(
        errors.every((error) => error.code === 'BUNDLE_PATH_INVALID'),
      ).toBe(true);
      expect(errors[49]?.path).toBe('bundle.files[49].path');
    });
  });

  describe('success', () => {
    it('sorts files by path (UTF-16 code units), not as given', () => {
      const result = okOf(
        bundle({
          main: 'worker.js',
          files: [
            { path: 'worker.js', content: WORKER },
            { path: 'z/c.css', content: 'c' },
            { path: 'a.json', content: '{}' },
            { path: 'Z.txt', content: 'z' },
            { path: 'a/b.html', content: '<p></p>' },
          ],
        }),
      );
      // Upper case sorts before lower case; "a.json" before "a/b.html" (. < /).
      expect(result.bundle.files.map((file) => file.path)).toEqual([
        'Z.txt',
        'a.json',
        'a/b.html',
        'worker.js',
        'z/c.css',
      ]);
    });

    it('answers the module bytes as UTF-8 of all files', () => {
      const result = okOf(
        bundle({
          files: [
            { path: 'worker.js', content: 'é' },
            { path: 'a.txt', content: String.fromCodePoint(0x1f600) },
          ],
        }),
      );
      expect(result.bytes).toBe(2 + 4);
    });

    it('does not keep fields the rules did not name', () => {
      const result = okOf(bundle());
      expect(Object.keys(result.bundle).sort()).toEqual([
        'files',
        'lockfile',
        'main',
      ]);
      expect(Object.keys(result.bundle.files[0] ?? {}).sort()).toEqual([
        'content',
        'kind',
        'path',
      ]);
    });
  });
});

describe('bundlePathProblem', () => {
  it('is null for a storable path', () => {
    for (const path of ['worker.js', 'a/b/c.json', 'A_b-c.1/x.js', '_a.js']) {
      expect(bundlePathProblem(path)).toBeNull();
    }
  });

  it('names the problem otherwise', () => {
    expect(bundlePathProblem(undefined)).toBe('is not a path');
    expect(bundlePathProblem('')).toBe('is not a path');
    expect(bundlePathProblem('a'.repeat(201))).toBe(
      'is longer than 200 characters',
    );
    expect(bundlePathProblem('a/'.repeat(9) + 'x')).toBeNull();
    expect(bundlePathProblem('a/'.repeat(10) + 'x')).toBe(
      'is in more than 9 folders',
    );
    expect(bundlePathProblem('../x')).toContain('uses a character other than');
  });
});
