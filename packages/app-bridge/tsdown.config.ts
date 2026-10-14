import { defineConfig } from 'tsdown';

// Browser only, so ESM only (AGENTS.md, "Why CJS too"): no backend installs it.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'browser',
  target: 'es2022',
  dts: true,
  clean: true,
});
