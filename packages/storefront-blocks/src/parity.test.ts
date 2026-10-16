import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { runCorpus } from './fuzz-corpus.test-harness.js';
import * as blocks from './index.js';

/**
 * The same templates render byte for byte alike in Node and in a browser
 * bundle. The package is bundled the way a browser app bundles it (one
 * script, browser platform) and run in an empty context: ECMAScript
 * built-ins only, no Node, no DOM, no console. Its corpus output must equal
 * the one Node computes from the source.
 *
 * Real browser engines (Chrome's V8, Safari's JavaScriptCore) run the same
 * bundle in `npm run browser-parity -w @tassyir/storefront-blocks`, a local
 * check like @tassyir/ui's browser check.
 */

const FOLDER = dirname(fileURLToPath(import.meta.url));

/** The browser bundle of the package and the corpus, as one IIFE. */
async function browserBundle(): Promise<string> {
  const result = await build({
    stdin: {
      contents:
        "export * from './index.ts';\nexport { runCorpus } from './fuzz-corpus.test-harness.ts';\n",
      resolveDir: FOLDER,
      loader: 'ts',
      sourcefile: 'parity-entry.ts',
    },
    bundle: true,
    format: 'iife',
    globalName: 'TassyirBlocks',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  });
  return result.outputFiles[0]?.text ?? '';
}

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

describe('Node and a browser bundle', () => {
  it('render the fuzzed corpus byte for byte alike', async () => {
    const bundle = await browserBundle();
    expect(bundle).not.toMatch(/\brequire\(|\bprocess\.|\bBuffer\b/);

    const sandbox = createContext({});
    runInContext(bundle, sandbox);
    const inBundle = runInContext(
      'JSON.stringify(TassyirBlocks.runCorpus(TassyirBlocks))',
      sandbox,
    ) as string;
    const inNode = JSON.stringify(runCorpus(blocks));

    expect(inBundle.length).toBe(inNode.length);
    expect(hash(inBundle)).toBe(hash(inNode));
  });
});
