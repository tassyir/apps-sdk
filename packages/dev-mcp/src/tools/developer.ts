import { MANIFEST_VOCABULARY } from '@tassyir/app-manifest';
import { CredentialStore, DeveloperApi, loadManifest } from 'tassyir';
import type { DeveloperApp, Installation, WebhookTopic } from 'tassyir';
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

// The manifest's topics are the developer API's (a spec of the tassyir CLI
// holds them equal).
const TOPICS = MANIFEST_VOCABULARY.topics.map((topic) => topic.name) as [
  WebhookTopic,
  ...WebhookTopic[],
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
      store: z
        .object({ id: z.string(), subdomain: z.string().nullable() })
        .nullable(),
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

/** How often run_review_checks asks for a queued run while it waits. */
const CHECKS_POLL_MS = 5_000;

const checkResult = z.object({
  key: z.string(),
  status: z.enum(['pass', 'fail', 'warning', 'skipped', 'error']),
  hard: z.boolean(),
  message: z.string(),
  fix: z.string().nullable(),
});

export const runReviewChecks = defineTool({
  name: 'run_review_checks',
  title: "Run the marketplace review's checks (a dry run)",
  description: [
    "Run Tassyir's automated review checklist on the app's DRAFT listing and LATEST version,",
    'as a marketplace submission would, without submitting: listing complete, privacy policy',
    'reachable, support and emergency contacts, developer terms accepted, the version',
    'releasable, the compliance topics subscribed, webhook endpoints that refuse a forged',
    'signature, the admin page allowed in a frame, storefront blocks, the API version; then',
    'warnings for the reviewer. Answers `passed` (no hard check failed), the failed checks',
    'with their `fix`, and every result. It fetches the privacy policy and the admin page and',
    'sends two test webhooks (one signed, one forged) to your endpoints, so the API allows 5',
    'runs per app per hour: fix everything a run names before the next. It waits up to',
    '`waitSeconds` (default 60) for the verdict; if still `queued`, call it again with',
    '`runId` (kept 24 hours). Needs `tassyir login` on this machine. To submit, your user',
    'runs `tassyir submit` (submitting is theirs to decide).',
  ].join(' '),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  remote: true,
  input: z.strictObject({
    app: z
      .string()
      .regex(/^(?:[a-z0-9]+(?:-[a-z0-9]+)*|\d{1,24})$/)
      .max(64)
      .optional()
      .describe(
        "The app's handle or numeric id. Default: the handle in ./tassyir.app.toml.",
      ),
    runId: z
      .string()
      .regex(/^rcr_[0-9a-f]{1,64}$/)
      .optional()
      .describe(
        'A run this tool started before: read it instead of starting a new one.',
      ),
    waitSeconds: z
      .number()
      .int()
      .min(0)
      .max(120)
      .optional()
      .describe(
        'How long to wait for the verdict. Default 60; 0 answers at once.',
      ),
  }),
  output: z.object({
    app: z.object({ id: z.string(), handle: z.string() }),
    runId: z.string(),
    status: z.enum(['queued', 'finished']),
    passed: z
      .boolean()
      .nullable()
      .describe('No hard check failed; null while queued.'),
    failed: z
      .array(checkResult)
      .describe('The hard checks that failed: fix each, then run again.'),
    results: z.array(checkResult).describe('Every check, in the API order.'),
    next: z.string(),
  }),
  async run({ app: appReference, runId, waitSeconds }, context) {
    const api = await developerApi(context);
    const app = await resolveApp(context, api, appReference);
    let run = runId
      ? (await call(() => api.getReviewChecks(app.id, runId))).data
      : (await call(() => api.runReviewChecks(app.id))).data;
    const deadline = context.io.now() + (waitSeconds ?? 60) * 1000;
    while (run.status !== 'finished' && context.io.now() < deadline) {
      await context.io.sleep(
        Math.min(CHECKS_POLL_MS, deadline - context.io.now()),
      );
      const current = run.runId;
      run = (await call(() => api.getReviewChecks(app.id, current))).data;
    }
    const results = (run.checks?.results ?? []).map((check) => ({
      key: check.key,
      status: check.status,
      hard: check.hard,
      message: check.message,
      fix: check.fix,
    }));
    const failed = results.filter(
      (check) => check.hard && check.status === 'fail',
    );
    return {
      app: { id: app.id, handle: app.handle },
      runId: run.runId,
      status: run.status,
      passed: run.checks ? run.checks.passed : null,
      failed,
      results,
      next:
        run.status !== 'finished'
          ? `Still queued: call run_review_checks again with { "runId": "${run.runId}" }.`
          : failed.length > 0
            ? 'Fix each failed check (its fix), then run the checks again.'
            : 'Every hard check passes: your user can submit with `tassyir submit --distribution public` (or unlisted).',
    };
  },
});
