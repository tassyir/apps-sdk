import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { createTassyirApp } from '@tassyir/app';
import { createApp } from './app.ts';
import { ConfigError, loadConfig } from './config.ts';
import type { Config } from './config.ts';
import { consoleLog } from './log.ts';
import { pageFilesIn } from './page-files.ts';
import { FileStore } from './store.ts';

// Starts the server on Node 22 (`npm run dev`, `npm start`). Everything
// Node-specific is here, in src/store.ts and src/page-files.ts; src/app.ts
// and src/webhooks.ts are Web-standard.

let config: Config;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.report());
    process.exit(1);
  }
  throw error;
}

const store = await FileStore.open(
  join(config.dataDir, 'store.json'),
  config.tokenStoreKey,
);

const tassyir = createTassyirApp({
  clientId: config.clientId,
  clientSecret: config.clientSecret,
  appId: config.appId,
  tokenStore: store.tokens,
  apiOrigin: config.apiOrigin,
  // Waits Retry-After on 429 RATE_LIMITED / BUSINESS_RATE_LIMITED and 503
  // API_BUSY, and retries what is safe to repeat.
  retries: 3,
});

const app = createApp({
  tassyir,
  store,
  pageFile: pageFilesIn(join(import.meta.dirname, '..', 'dist', 'public')),
  log: consoleLog,
});

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  consoleLog.info(`Listening on http://localhost:${String(info.port)}`);
  consoleLog.info(
    'Tassyir reaches it through your public https address (hosting.url in tassyir.app.toml).',
  );
});

function shutdown(): void {
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
