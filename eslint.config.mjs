// @ts-check
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/.pack/**',
      // A generated project's files, with its own dependencies and
      // tsconfig: npm run check:template installs and checks them.
      'packages/create-tassyir-app/templates/**',
    ],
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
    // @tassyir/app-bridge runs in the browser, inside the dashboard's iframe:
    // its library code uses web APIs only. Specs and their harness may use
    // Node (the frontend cross-check reads a git checkout).
    files: ['packages/app-bridge/src/**/*.ts'],
    ignores: [
      'packages/app-bridge/src/**/*.test.ts',
      'packages/app-bridge/src/**/*.test-harness.ts',
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
                'Library code runs in the browser: use web APIs (postMessage, URL, crypto).',
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
        // No browser storage (document.cookie included) and no analytics
        // (AP-K1.4); the bridge never touches the page itself.
        'localStorage',
        'sessionStorage',
        'indexedDB',
        'document',
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
