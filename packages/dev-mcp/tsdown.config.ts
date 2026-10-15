import { defineConfig } from 'tsdown';

// An MCP server (src/cli.ts, the `tassyir-dev-mcp` command) and its library
// entry, ESM only (AGENTS.md, "Why CJS too": no Tassyir repo installs it).
// The workspace packages it uses stay imports of the published packages
// (dependencies are external). The guides and the OpenAPI documents of the
// Admin API (@tassyir/app's copy) and the developer API (the tassyir CLI's
// copy) ship inside dist/content/, so the server answers offline and from the
// versions it was released with.
export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  // .js and .d.ts, as package.json names them ("type": "module").
  fixedExtension: false,
  dts: true,
  clean: true,
  copy: [
    {
      // README.md is for the guides' authors, not a guide.
      from: ['../../docs/guides/*.md', '!../../docs/guides/README.md'],
      to: 'dist/content/guides',
    },
    {
      from: [
        '../app/openapi/openapi.2026-10.json',
        '../cli/openapi/openapi.developer.json',
      ],
      to: 'dist/content/openapi',
    },
  ],
});
