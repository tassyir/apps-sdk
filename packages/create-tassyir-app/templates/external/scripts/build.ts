import { build } from 'esbuild';
import { pageBuild } from './page-build.ts';

// `npm run build`: bundles the embedded page into dist/public. The server
// needs no build: Node 22 runs src/*.ts as they are.
await build(pageBuild);
