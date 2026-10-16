// Runs the dev MCP server from this checkout's TypeScript, without a build:
//
//   node --import ./packages/dev-mcp/scripts/from-source.mjs packages/dev-mcp/src/cli.ts
//
// Node 22.18+ strips the types itself. This hook resolves the workspace
// packages to their sources (their dist/ only exists after `npm run build`)
// and a relative `./x.js` import of a TypeScript file to `./x.ts`. The stdio
// spec starts the server this way; MCP clients can too, for a local try-out.

import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../../../', import.meta.url);

/** @type {Readonly<Record<string, string>>} */
const SOURCES = {
  '@tassyir/app-manifest': 'packages/app-manifest/src/index.ts',
  '@tassyir/storefront-blocks': 'packages/storefront-blocks/src/index.ts',
  'create-tassyir-app': 'packages/create-tassyir-app/src/index.ts',
  tassyir: 'packages/cli/src/index.ts',
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    const source = SOURCES[specifier];
    if (source) return { url: new URL(source, ROOT).href, shortCircuit: true };
    const parent = context.parentURL;
    if (
      /^\.\.?\//.test(specifier) &&
      specifier.endsWith('.js') &&
      parent?.endsWith('.ts')
    ) {
      const candidate = new URL(`${specifier.slice(0, -3)}.ts`, parent);
      if (existsSync(fileURLToPath(candidate))) {
        return { url: candidate.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});
