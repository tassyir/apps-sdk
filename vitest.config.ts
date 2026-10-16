import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // A package that imports another workspace package by name is tested
    // against its source: dist/ only exists after `npm run build`.
    alias: {
      '@tassyir/app-manifest': fileURLToPath(
        new URL('./packages/app-manifest/src/index.ts', import.meta.url),
      ),
      '@tassyir/storefront-blocks': fileURLToPath(
        new URL('./packages/storefront-blocks/src/index.ts', import.meta.url),
      ),
      'create-tassyir-app': fileURLToPath(
        new URL('./packages/create-tassyir-app/src/index.ts', import.meta.url),
      ),
      tassyir: fileURLToPath(
        new URL('./packages/cli/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    // Specs never touch the network or a registry; release scripts are tested
    // through their pure parts only.
    environment: 'node',
  },
});
