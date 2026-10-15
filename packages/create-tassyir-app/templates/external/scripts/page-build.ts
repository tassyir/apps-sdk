import { join } from 'node:path';
import type { BuildOptions } from 'esbuild';

const root = join(import.meta.dirname, '..');

/** Where the built page goes; src/server.ts serves it. */
export const PAGE_OUT_DIR = join(root, 'dist', 'public');

/**
 * The embedded page: src/page → dist/public/app.js, index.html. Its styles
 * come from @tassyir/ui, bundled into app.js (constructable stylesheets).
 */
export const pageBuild: BuildOptions = {
  entryPoints: [
    join(root, 'src', 'page', 'app.ts'),
    join(root, 'src', 'page', 'index.html'),
  ],
  outdir: PAGE_OUT_DIR,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  loader: { '.html': 'copy' },
  logLevel: 'info',
};
