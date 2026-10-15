import { defineConfig } from 'tsdown';

// Browser only, so ESM only (AGENTS.md, "Why CJS too"): no backend installs it.
// Two entries, one shared chunk: `@tassyir/app-bridge/react` uses the same
// AppBridgeError class as the main entry, and React stays the app's own
// (an optional peer dependency, never bundled).
export default defineConfig({
  entry: ['src/index.ts', 'src/react.ts'],
  format: ['esm'],
  platform: 'browser',
  target: 'es2022',
  dts: true,
  clean: true,
});
