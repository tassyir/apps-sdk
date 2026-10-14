// @ts-check
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/.pack/**'],
  },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true },
      ],
    },
  },
  {
    // Repo scripts run on Node and may print.
    files: [
      'scripts/**/*.mjs',
      'packages/*/scripts/**/*.mjs',
      '*.config.*',
      'packages/*/tsdown.config.ts',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    // @tassyir/app also runs on Workers-like runtimes: its library code uses
    // web APIs only (fetch, WebCrypto, atob). Specs and their helpers may use
    // Node.
    files: ['packages/app/src/**/*.ts'],
    ignores: [
      'packages/app/src/**/*.test.ts',
      'packages/app/src/**/*.test-helpers.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex:
                '^(node:|(assert|buffer|child_process|crypto|fs|http|https|net|os|path|stream|url|util|zlib)(/|$))',
              message:
                'Library code must run outside Node: use web APIs (fetch, crypto.subtle, TextEncoder).',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        'Buffer',
        'process',
        'require',
        '__dirname',
        '__filename',
        'global',
      ],
    },
  },
  {
    // Package code is a library: it never prints.
    files: ['packages/*/src/**/*.ts'],
    ignores: ['packages/*/src/**/*.test.ts'],
    rules: { 'no-console': 'error' },
  },
);
