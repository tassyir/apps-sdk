import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';

// `npm run build`: bundles the page (src/page, React) into dist/page, where
// src/worker.ts imports it as text:
//   dist/page/index.html    the page
//   dist/page/app.js.txt    its script (a .txt file: esbuild, and so
//                           `tassyir deploy`, imports it as a string)
// The Worker itself needs no build here: `tassyir deploy` bundles
// src/worker.ts, with these two files inside, into the one module Tassyir
// Hosting runs.

const root = join(import.meta.dirname, '..');
const out = join(root, 'dist', 'page');

const result = await build({
  entryPoints: [join(root, 'src', 'page', 'main.tsx')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  minify: true,
  // React's production build.
  define: { 'process.env.NODE_ENV': '"production"' },
  write: false,
  outdir: out,
  logLevel: 'warning',
});
const script = result.outputFiles.find((file) => file.path.endsWith('.js'));
if (!script) throw new Error('esbuild wrote no script');

await mkdir(out, { recursive: true });
await writeFile(join(out, 'app.js.txt'), script.text);
await writeFile(
  join(out, 'index.html'),
  await readFile(join(root, 'src', 'page', 'index.html'), 'utf8'),
);
console.log(
  `✓ dist/page: index.html, app.js.txt (${(script.contents.byteLength / 1024).toFixed(1)} KB)`,
);
