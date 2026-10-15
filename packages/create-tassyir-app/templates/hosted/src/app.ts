import {
  hostedAdmin,
  readHostedProps,
  TassyirApiError,
  TassyirError,
} from '@tassyir/app';
import type { HostedProps } from '@tassyir/app';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { normalizeAmount } from './shared/money.ts';
import {
  countOrdersReceived,
  readSettings,
  storageErrorCode,
  writeSettings,
} from './storage.ts';
import type { Settings } from './storage.ts';
import { receiveWebhook, WEBHOOK_PATH } from './webhooks.ts';

// The app's HTTP surface on Tassyir Hosting, on Web-standard Request and
// Response (Hono). Tassyir runs this Worker for every installation, inside
// the merchant's dashboard only: a page request comes from the dashboard's
// frame, with a session Tassyir opened, and carries who is looking in
// ctx.props.viewer.
//
//   POST /webhooks       Tassyir's deliveries (src/webhooks.ts)
//   GET  /api/orders     the page's data: pending orders (the Admin API,
//                        through ctx.props.TASSYIR), and how many orders the
//                        webhook announced (ctx.props.STORAGE)
//   GET  /api/settings   the app's settings for this installation (STORAGE)
//   PUT  /api/settings
//   GET  /app.js, and every other GET: the embedded page
//
// Everything per installation comes from ctx.props, per request. One Worker
// serves every installation pinned to this version, possibly in one
// isolate: never keep per-installation state in a module variable.

/** The only site that frames the page: the Tassyir dashboard. */
export const DASHBOARD_ORIGIN = 'https://app.tassyir.io';

/** The built page (`npm run build`), as text: see src/worker.ts. */
export interface PageFiles {
  html: string;
  script: string;
}

interface AppEnv {
  Variables: { props: HostedProps };
}

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
  'cache-control': 'no-cache',
};

export function createApp(page: PageFiles): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Tassyir Hosting's capabilities for this request: the installation, who
  // is looking, STORAGE and TASSYIR. Outside Tassyir Hosting there are none
  // (HOSTED_PROPS_MISSING).
  app.use(async (c, next) => {
    c.set('props', readHostedProps(c.executionCtx as { props?: unknown }));
    await next();
  });

  app.post(WEBHOOK_PATH, bodyLimit({ maxSize: 1024 * 1024 }), (c) =>
    receiveWebhook(c.req.raw, c.get('props')),
  );

  // The page's calls. Only the page makes them, from the dashboard's frame,
  // so they always have a viewer (a request without one is a delivery).
  app.use('/api/*', bodyLimit({ maxSize: 64 * 1024 }), async (c, next) => {
    if (c.get('props').viewer === null) {
      return problem(403, {
        code: 'VIEWER_REQUIRED',
        message: 'This route answers the app’s page only',
        fix: 'Call it from the page inside the Tassyir dashboard.',
      });
    }
    await next();
  });

  app.get('/api/orders', async (c) => {
    const props = c.get('props');
    // The typed Admin API client, as the installation: its requests go
    // through ctx.props.TASSYIR, which needs no token. Lists are newest
    // first and keyset-paged ({ data, nextCursor }); `fields` trims each
    // order to what the page shows.
    const page = await hostedAdmin(props).get('/orders', {
      query: {
        status: 'pending',
        limit: 20,
        fields: ['orderNumber', 'total', 'currency', 'createdAt'],
      },
    });
    const received = await countOrdersReceived(props.STORAGE);
    return c.json({
      orders: page.data,
      more: page.nextCursor !== null,
      received,
    });
  });

  app.get('/api/settings', async (c) =>
    c.json(await readSettings(c.get('props').STORAGE)),
  );

  app.put('/api/settings', async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const raw = isRecord(body) ? body['highlightFrom'] : undefined;
    // null clears the setting; a string must be an amount ("5000.001" is
    // refused, never read as null).
    const highlightFrom =
      raw === null
        ? null
        : typeof raw === 'string'
          ? (normalizeAmount(raw) ?? undefined)
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
    await writeSettings(c.get('props').STORAGE, settings);
    return c.json(settings);
  });

  app.all('/api/*', () =>
    problem(404, {
      code: 'NOT_FOUND',
      message: 'No such API route',
      fix: 'Check the method and path.',
    }),
  );

  // The embedded page. The dashboard loads admin.page (here "/") plus the
  // app path and its own query string: everything below "/" is the page.
  app.get(
    '/app.js',
    () =>
      new Response(page.script, {
        headers: {
          ...PAGE_HEADERS,
          'content-type': 'text/javascript; charset=utf-8',
        },
      }),
  );
  app.get(
    '*',
    () =>
      new Response(page.html, {
        headers: {
          ...PAGE_HEADERS,
          'content-type': 'text/html; charset=utf-8',
        },
      }),
  );

  app.onError((error, c) => {
    if (error instanceof TassyirApiError) {
      // A problem+json answer of the Admin API (or of ctx.props.TASSYIR
      // itself, such as HOSTED_PATH_NOT_ALLOWED): pass its code and fix on.
      console.warn(
        `${error.operation}: ${String(error.status)} ${error.code} (request ${error.requestId ?? '-'})`,
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
      // HOSTED_PROPS_MISSING, TIMEOUT, …: the code and fix say what to do.
      console.warn(`${c.req.method} ${c.req.path}: ${error.code}`);
      return problem(error.code === 'HOSTED_PROPS_MISSING' ? 500 : 502, {
        code: error.code,
        message: error.message,
        fix: error.fix,
      });
    }
    const storage = storageErrorCode(error);
    if (storage !== null) {
      console.warn(`${c.req.method} ${c.req.path}: ${storage}`);
      return problem(storage === 'STORAGE_FULL' ? 507 : 503, {
        code: storage,
        message: 'The app’s storage refused the call',
        fix:
          storage === 'STORAGE_FULL'
            ? 'Delete rows the app no longer needs: STORAGE holds at most 50 MB.'
            : 'Retry shortly.',
      });
    }
    console.error(`${c.req.method} ${c.req.path} failed`, error);
    return problem(500, {
      code: 'INTERNAL_ERROR',
      message: 'The app failed',
      fix: 'Read the Worker’s log.',
    });
  });

  return app;
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
