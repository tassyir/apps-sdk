import { defineConfig } from 'tsdown';

// Browser only, so ESM only (AGENTS.md, "Why CJS too"): no backend installs
// it. `tokens` is its own entry: data with no DOM, importable on a server.
export default defineConfig({
  entry: ['src/index.ts', 'src/tokens.ts'],
  format: ['esm'],
  platform: 'browser',
  target: 'es2022',
  dts: true,
  clean: true,
});
