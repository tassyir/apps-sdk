import {
  isTassyirError,
  TassyirApiError,
  TassyirError,
  TassyirVerificationError,
} from '@tassyir/app';
import type { AdminClient, TassyirApp, VerifiedIdToken } from '@tassyir/app';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Log } from './log.ts';
import { normalizeAmount } from './shared/money.ts';
import type { AppStore } from './store.ts';
import { receiveWebhook, WEBHOOK_PATH } from './webhooks.ts';

// The app's HTTP surface, on Web-standard Request/Response (Hono): the same
// code runs on Node (src/server.ts) and on Workers-like runtimes.
//
//   GET  /health         liveness, for your host
//   POST /webhooks       signed deliveries from Tassyir (src/webhooks.ts)
//   GET  /api/orders     the page's data: pending orders (Admin API)
//   GET  /api/settings   the app's settings for this business (app data)
//   PUT  /api/settings
//   GET  /app.js, and every other GET: the embedded page

/** The only site that may frame the page: the Tassyir dashboard. */
export const DASHBOARD_ORIGIN = 'https://app.tassyir.io';

/** The app data key this app keeps per business (`[[data.definitions]]`). */
export const SETTINGS_KEY = 'settings';

export interface Settings {
  /** Orders at or above this total are highlighted ("5000.00"), or none. */
  highlightFrom: string | null;
}

export interface AppDeps {
  tassyir: TassyirApp;
  store: AppStore;
  /**
   * Reads a file of the built page (index.html, app.js), or
   * undefined when it is missing. On Node: `pageFilesIn('dist/public')`.
   */
  pageFile: (name: string) => Promise<Uint8Array<ArrayBuffer> | undefined>;
  log: Log;
}

interface ApiVariables {
  /** Who is looking, from the verified ID token: the only proof of it. */
  session: VerifiedIdToken;
  admin: AdminClient;
}

const PAGE_FILES: Record<string, { file: string; type: string }> = {
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
};

const PAGE_HEADERS = {
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    `frame-ancestors ${DASHBOARD_ORIGIN}`,
  ].join('; '),
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin',
};

export function createApp(deps: AppDeps): Hono<{ Variables: ApiVariables }> {
  const app = new Hono<{ Variables: ApiVariables }>();

  app.get('/health', (c) => c.json({ ok: true }));

  app.post(WEBHOOK_PATH, bodyLimit({ maxSize: 1024 * 1024 }), (c) =>
    receiveWebhook(c.req.raw, deps),
  );

  // Every /api call carries a NEW App Bridge ID token. Verifying it says who
  // is looking (user, business, installation); `authenticate` then reuses the
  // installation's stored offline token, or exchanges the ID token for one.
  app.use('/api/*', bodyLimit({ maxSize: 64 * 1024 }), async (c, next) => {
    const idToken = /^Bearer (\S+)$/.exec(
      c.req.header('authorization') ?? '',
    )?.[1];
    if (idToken === undefined) {
      return problem(401, {
        code: 'ID_TOKEN_REQUIRED',
        message: 'This call needs an App Bridge ID token',
        fix: 'Send Authorization: Bearer <token>, with a new token from bridge.idToken() for each call.',
      });
    }
    const { idToken: session } = await deps.tassyir.authenticate(idToken);
    await deps.store.recordInstallation(
      session.installationId,
      session.businessId,
    );
    c.set('session', session);
    c.set('admin', deps.tassyir.admin(session.installationId));
    await next();
  });

  app.get('/api/orders', async (c) => {
    const admin = c.get('admin');
    // Lists are newest first and keyset-paged ({ data, nextCursor }); `fields`
    // trims each order to what the page shows.
    const page = await admin.get('/orders', {
      query: {
        status: 'pending',
        limit: 20,
        fields: ['orderNumber', 'total', 'currency', 'createdAt'],
      },
    });
    return c.json({ orders: page.data, more: page.nextCursor !== null });
  });

  app.get('/api/settings', async (c) => {
    const { businessId } = c.get('session');
    try {
      const { data } = await c
        .get('admin')
        .get('/data/{ownerType}/{ownerId}/{key}', {
          path: {
            ownerType: 'business',
            ownerId: businessId,
            key: SETTINGS_KEY,
          },
        });
      return c.json(readSettings(data.value));
    } catch (error) {
      if (isTassyirError(error, 'NOT_FOUND')) return c.json(readSettings(null));
      throw error;
    }
  });

  app.put('/api/settings', async (c) => {
    const { businessId } = c.get('session');
    const body: unknown = await c.req.json().catch(() => null);
    const raw = isRecord(body) ? body['highlightFrom'] : undefined;
    const highlightFrom =
      raw === null
        ? null
        : typeof raw === 'string'
          ? normalizeAmount(raw)
          : undefined;
    if (highlightFrom === undefined) {
      return problem(400, {
        code: 'SETTINGS_INVALID',
        message:
          'highlightFrom must be an amount such as "5000" or "5000.50", or null',
        fix: 'Send { "highlightFrom": "5000.00" }: a decimal string with at most two decimals, never a number.',
      });
    }
    const settings: Settings = { highlightFrom };
    // A write sends an Idempotency-Key (the SDK makes one), so a retry never
    // writes twice.
    await c.get('admin').put('/data/{ownerType}/{ownerId}/{key}', {
      path: { ownerType: 'business', ownerId: businessId, key: SETTINGS_KEY },
      body: { value: settings },
    });
    return c.json(settings);
  });

  app.all('/api/*', () =>
    problem(404, {
      code: 'NOT_FOUND',
      message: 'No such API route',
      fix: 'Check the method and path.',
    }),
  );

  // The embedded page. The dashboard loads admin.page (here "/") plus the app
  // path and its own query string: everything below "/" is the same page.
  app.get('*', async (c) => {
    const asset = PAGE_FILES[c.req.path];
    const file = await deps.pageFile(asset?.file ?? 'index.html');
    if (file === undefined) {
      return asset
        ? c.notFound()
        : c.text(
            'The page is not built yet: run npm run build (or npm run dev).',
            503,
          );
    }
    return new Response(file, {
      headers: {
        ...PAGE_HEADERS,
        'content-type': asset?.type ?? 'text/html; charset=utf-8',
        'cache-control': 'no-cache',
      },
    });
  });

  app.onError((error, c) => {
    if (error instanceof TassyirVerificationError) {
      // The ID token is not genuine, not for this app, or expired.
      return problem(401, {
        code: error.code,
        message: error.message,
        fix: error.fix,
      });
    }
    if (error instanceof TassyirApiError) {
      // A problem+json answer from the Admin API: pass its code and fix on.
      deps.log.warn(
        `${error.operation}: ${String(error.status)} ${error.code} (request ${error.requestId ?? '?'})`,
      );
      const status =
        error.status >= 400 && error.status < 500 && error.status !== 401
          ? error.status
          : 502;
      return problem(status, {
        code: error.code,
        message: error.detail ?? error.message,
        fix: error.fix,
        requestId: error.requestId,
      });
    }
    if (error instanceof TassyirError) {
      // OAuth, token and configuration errors: the code and fix say what to do.
      deps.log.warn(
        `${c.req.method} ${c.req.path}: ${error.code}. ${error.fix ?? ''}`,
      );
      return problem(502, {
        code: error.code,
        message: error.message,
        fix: error.fix,
      });
    }
    deps.log.error(`${c.req.method} ${c.req.path} failed`, error);
    return problem(500, {
      code: 'INTERNAL_ERROR',
      message: 'The server failed',
      fix: "Read the server's log.",
    });
  });

  return app;
}

function readSettings(value: unknown): Settings {
  const raw = isRecord(value) ? value['highlightFrom'] : null;
  return {
    highlightFrom: typeof raw === 'string' ? normalizeAmount(raw) : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function problem(
  status: number,
  body: {
    code: string;
    message: string;
    fix: string | undefined;
    requestId?: string | undefined;
  },
): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}
