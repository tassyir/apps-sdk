import { defineConfig } from 'tsdown';

// A Node CLI and its library entry, ESM only (AGENTS.md, "Why CJS too": no
// Tassyir repo installs it). The workspace packages it uses stay imports of
// the published packages (dependencies are external).
export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  // .js and .d.ts, as package.json names them ("type": "module").
  fixedExtension: false,
  dts: true,
  clean: true,
});
