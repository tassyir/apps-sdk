import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { context } from 'esbuild';
import { pageBuild } from './page-build.ts';

// `npm run dev`: rebuilds the page on every change, and restarts the server
// (node --watch) when its files change. .env is read at each start.

const root = join(import.meta.dirname, '..');
const page = await context(pageBuild);
await page.watch();

const server = spawn(
  process.execPath,
  ['--watch', '--env-file-if-exists=.env', join('src', 'server.ts')],
  { cwd: root, stdio: 'inherit' },
);

async function stop(code: number): Promise<never> {
  server.kill('SIGTERM');
  await page.dispose();
  process.exit(code);
}

process.on('SIGINT', () => void stop(0));
process.on('SIGTERM', () => void stop(0));
server.on('exit', (code) => void stop(code ?? 0));
