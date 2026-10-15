import { MANIFEST_VOCABULARY } from '@tassyir/app-manifest';
import { CredentialStore, DeveloperApi, loadManifest } from 'tassyir';
import type { DeveloperApp, Installation } from 'tassyir';
import * as z from 'zod';
import { ToolError } from '../errors.js';
import { defineTool, fromCliError } from '../tool.js';
import type { ToolContext } from '../tool.js';

// The developer API (`developer/*`), as the `tassyir` CLI calls it and with
// the CLI's own client, signed in with the developer token `tassyir login`
// stored on this machine (TASSYIR_TOKEN, else the OS keychain, else the CLI's
// 0600 credentials file). The token is read for each call and sent only to
// the API origin (TASSYIR_API_ORIGIN, else https://api.tassyir.io); it is
// never part of an answer, an error or a log line. This server never signs
// in itself: a sign-in needs the developer's approval in the dashboard.

const DASHBOARD = 'https://app.tassyir.io/en';

const TOPICS = MANIFEST_VOCABULARY.topics.map((topic) => topic.name) as [
  string,
  ...string[],
];

/** A client of the developer API with the stored developer token. */
async function developerApi(context: ToolContext): Promise<DeveloperApi> {
  if (typeof context.apiOrigin !== 'string') throw context.apiOrigin;
  const origin = context.apiOrigin;
  let resolved;
  try {
    resolved = await new CredentialStore(context.io).resolve(origin);
  } catch (error) {
    throw fromCliError(error) ?? error;
  }
  if (!resolved) {
    throw new ToolError({
      code: 'NOT_LOGGED_IN',
      message: `Not signed in to ${origin} on this machine`,
      fix: 'Ask your user to run `npx tassyir login` in a terminal and approve the code in the Tassyir dashboard, then call this tool again (in CI: set TASSYIR_TOKEN). Never ask them for the token itself.',
    });
  }
  return new DeveloperApi({
    apiOrigin: origin,
    fetch: context.io.fetch,
    userAgent: context.userAgent,
    token: resolved.token,
    debug: context.debug,
  });
}

/** Runs a developer API call, its refusals as tool errors. */
async function call<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    throw fromCliError(error) ?? error;
  }
}

/** `app` (a handle or numeric id), else the handle of ./tassyir.app.toml. */
async function resolveApp(
  context: ToolContext,
  api: DeveloperApi,
  app: string | undefined,
): Promise<DeveloperApp> {
  let reference = app;
  if (reference === undefined) {
    const handle = await loadManifest(context.cwd)
      .then(({ parsed }) => parsed['handle'])
      .catch(() => undefined);
    if (typeof handle !== 'string' || handle === '') {
      throw new ToolError({
        code: 'APP_REQUIRED',
        message:
          "Which app? No `app` was given, and no tassyir.app.toml with a handle is in this server's working folder",
        fix: "Pass `app` with the app's handle (the handle in its tassyir.app.toml) or numeric id.",
      });
    }
    reference = handle;
  }
  const apps = (await call(() => api.listApps())).data;
  const found =
    apps.find((candidate) => candidate.handle === reference) ??
    apps.find((candidate) => candidate.id === reference);
  if (found) return found;
  throw new ToolError({
    code: 'APP_NOT_FOUND',
    message: `The signed-in developer has no app with the handle or id "${reference}"`,
    fix:
      apps.length > 0
        ? `Use one of: ${apps.map((candidate) => candidate.handle).join(', ')}; or create this one with \`tassyir app create\` in its folder.`
        : 'Create the app first: `tassyir app create` in its folder (it reads the handle and name from tassyir.app.toml).',
    details: { app: reference },
  });
}

/** What a failed test delivery's errorClass asks of the developer (as `tassyir webhook trigger`). */
function failureFix(
  errorClass: string | null,
  statusCode: number | null,
): string {
  switch (errorClass) {
    case 'http':
      return `Your endpoint answered ${statusCode === null ? '-' : String(statusCode)}: it must answer 2xx within 10 seconds once the signature checks out. Read your server's log for this webhook-id.`;
    case 'timeout':
      return 'Your endpoint took more than 10 seconds: answer 2xx first, then do the work.';
    case 'network':
      return "Tassyir could not connect: is the server (and its tunnel) up, on https and port 443, at the manifest's hosting.url?";
    case 'refused':
      return 'The address resolves to a private or reserved IP, which Tassyir never calls: use a public https host.';
    default:
      return "Read the delivery's error, fix your endpoint, then trigger the test again.";
  }
}

const devStore = z.looseObject({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  dashboardPath: z.string(),
  dashboardUrl: z.string(),
});

export const triggerTestWebhook = defineTool({
  name: 'trigger_test_webhook',
  title: 'Send a test webhook to your app',
  description: [
    "Ask Tassyir to send a test event of one topic to your app's webhook endpoint (the",
    "developer console's test delivery): synthetic sample data, never a merchant's, signed",
    'like a real delivery and marked `tassyir-test: true`, never logged or retried. Answers',
    'what your endpoint replied, and a fix when it was not 2xx. Needs the app installed on',
    'a dev store and the developer signed in on this machine with `tassyir login` (this',
    'server uses that sign-in and never shows the token). `app` defaults to the handle in',
    "./tassyir.app.toml; `installation` to the app's only active installation.",
  ].join(' '),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  remote: true,
  input: z.strictObject({
    topic: z
      .enum(TOPICS)
      .describe(
        "The topic to send; the installation's version must subscribe to it.",
      ),
    app: z
      .string()
      .regex(/^(?:[a-z0-9]+(?:-[a-z0-9]+)*|\d{1,24})$/)
      .max(64)
      .optional()
      .describe(
        "The app's handle or numeric id. Default: the handle in ./tassyir.app.toml.",
      ),
    installation: z
      .string()
      .regex(/^\d{1,24}$/)
      .optional()
      .describe(
        "The installation to send it to. Default: the app's only active installation.",
      ),
  }),
  output: z.object({
    app: z.object({ id: z.string(), handle: z.string() }),
    delivery: z.looseObject({
      webhookId: z.string(),
      installationId: z.string(),
      topic: z.string(),
      status: z.string(),
      statusCode: z.number().nullable(),
      durationMs: z.number().nullable(),
    }),
  }),
  async run({ topic, app: appReference, installation }, context) {
    const api = await developerApi(context);
    const app = await resolveApp(context, api, appReference);
    let installationId = installation;
    if (installationId === undefined) {
      const active: Installation[] = (
        await call(() =>
          api.listInstallations(app.id, { status: 'active', limit: 100 }),
        )
      ).data;
      const only = active[0];
      if (active.length !== 1 || only === undefined) {
        throw new ToolError({
          code: 'INSTALLATION_REQUIRED',
          message:
            active.length === 0
              ? `${app.handle} has no active installation`
              : `${app.handle} has ${String(active.length)} active installations: which one?`,
          fix:
            active.length === 0
              ? 'Install the app on a dev store first (seed_dev_store, then the install link in the developer console), then call this tool again.'
              : `Pass \`installation\` with one of: ${active.map((candidate) => `${candidate.id} (business ${candidate.businessId})`).join(', ')}.`,
          details: { installations: active.map((candidate) => candidate.id) },
        });
      }
      installationId = only.id;
    }
    const target = installationId;
    const delivery = (await call(() => api.testWebhook(app.id, target, topic)))
      .data;
    if (delivery.status !== 'delivered') {
      throw new ToolError({
        code: 'WEBHOOK_ENDPOINT_FAILED',
        message: `The test ${topic} event reached no 2xx: ${delivery.error ?? 'failed'}${delivery.statusCode === null ? '' : ` (HTTP ${String(delivery.statusCode)})`}`,
        fix: failureFix(delivery.errorClass, delivery.statusCode),
        details: { delivery },
      });
    }
    return {
      app: { id: app.id, handle: app.handle },
      delivery: { ...delivery },
    };
  },
});

export const seedDevStore = defineTool({
  name: 'seed_dev_store',
  title: 'Create a seeded dev store',
  description: [
    'Create a dev store for the signed-in developer: a Tassyir business made to build and',
    'test apps on, seeded with about 30 products with variants, 200 orders in every state',
    'across the 58 wilayas and buyers with fake phones (`empty: true` for none). Nothing it',
    'does reaches a carrier, a customer or a payment provider. A developer has at most 3 and',
    'they cannot be deleted yet: call list_dev_stores first, and ask your user before',
    'creating one. Needs `tassyir login` on this machine.',
  ].join(' '),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  remote: true,
  input: z.strictObject({
    name: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[^\r\n]*\S[^\r\n]*$/)
      .optional()
      .describe('1-60 characters on one line. Default "Dev store".'),
    empty: z
      .boolean()
      .optional()
      .describe('True for no seed data: one store, no products or orders.'),
  }),
  output: z.object({
    store: devStore.extend({
      store: z.object({ id: z.string(), subdomain: z.string() }).nullable(),
      seed: z.record(z.string(), z.number()).nullable(),
      seedError: z.string().nullable(),
    }),
    next: z.string(),
  }),
  async run({ name, empty }, context) {
    const api = await developerApi(context);
    const created = (
      await call(() =>
        api.createDevStore({
          ...(name === undefined ? {} : { name: name.trim() }),
          ...(empty === true ? { seed: false } : {}),
        }),
      )
    ).data;
    return {
      store: {
        ...created,
        dashboardUrl: `${DASHBOARD}${created.dashboardPath}`,
      },
      next: 'Install your app on it from the developer console (its install link), then call trigger_test_webhook.',
    };
  },
});

export const listDevStores = defineTool({
  name: 'list_dev_stores',
  title: 'List your dev stores',
  description:
    "The signed-in developer's dev stores (at most 3), with their dashboard links. Needs `tassyir login` on this machine.",
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
    idempotentHint: true,
  },
  remote: true,
  input: z.strictObject({}),
  output: z.object({ stores: z.array(devStore) }),
  async run(_args, context) {
    const api = await developerApi(context);
    const stores = (await call(() => api.listDevStores())).data;
    return {
      stores: stores.map((store) => ({
        ...store,
        dashboardUrl: `${DASHBOARD}${store.dashboardPath}`,
      })),
    };
  },
});
