import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Two kinds of specs, no network and no Tassyir account:
//   test/worker: the Worker's handler inside workerd, the Workers runtime,
//     through Cloudflare's Vitest integration. Tassyir Hosting's per-request
//     ctx.props are stand-ins (test/worker/stand-ins.ts): STORAGE a real
//     SQLite Durable Object reached over RPC, as on Tassyir Hosting, and
//     TASSYIR a fake Admin API.
//   test/node: the manifest and the money helpers, on Node.
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({
            main: './test/worker/stand-ins.ts',
            miniflare: {
              // The date Tassyir Hosting uploads every hosted version with.
              compatibilityDate: '2026-10-01',
              durableObjects: {
                STAND_IN_STORAGE: {
                  className: 'StandInStorage',
                  useSQLite: true,
                },
              },
            },
          }),
        ],
        test: { name: 'worker', include: ['test/worker/**/*.test.ts'] },
      },
      {
        test: {
          name: 'node',
          include: ['test/node/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
