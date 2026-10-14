import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    // Specs never touch the network or a registry; release scripts are tested
    // through their pure parts only.
    environment: 'node',
  },
});
