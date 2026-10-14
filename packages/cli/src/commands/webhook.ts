import { MANIFEST_VOCABULARY } from '@tassyir/app-manifest';
import type {
  DeliveryFilters,
  DeliveryStatus,
  Installation,
} from '../api-types.js';
import { cell, lines, resolveApp, stringValue, table } from '../command.js';
import type { Command } from '../command.js';
import { CliError, EXIT_CODES, usageError } from '../errors.js';

// webhook trigger | deliveries | replay: the developer console's webhook
// routes (tassyir/backend docs/api/apps/developer-webhooks.md). A test event
// is synthetic (never the merchant's data), marked `tassyir-test: true`,
// signed and sent like any delivery, and never logged or retried.

const APP_OPTION = {
  app: {
    type: 'string',
    value: 'handle|id',
    description: 'Default: the handle in ./tassyir.app.toml.',
  },
} as const;

const TOPICS = MANIFEST_VOCABULARY.topics.map((topic) => topic.name);
const STATUSES: readonly DeliveryStatus[] = [
  'pending',
  'delivered',
  'failed',
  'skipped',
];

/** What a failed attempt's errorClass asks of the developer. */
function failureFix(
  errorClass: string | null,
  statusCode: number | null,
): string {
  switch (errorClass) {
    case 'http':
      return `Your endpoint answered ${cell(statusCode)}: it must answer 2xx within 10 seconds once the signature checks out. Read your server's log for this webhook-id.`;
    case 'timeout':
      return 'Your endpoint took more than 10 seconds: answer 2xx first, then do the work.';
    case 'network':
      return "Tassyir could not connect: is the server (and its tunnel) up, on https and port 443, at the manifest's hosting.url?";
    case 'refused':
      return 'The address resolves to a private or reserved IP, which Tassyir never calls: use a public https host.';
    default:
      return 'Read lastError, fix your endpoint, then replay: `tassyir webhook replay <delivery-id>`.';
  }
}

export const webhookTriggerCommand: Command = {
  name: 'webhook trigger',
  summary: "Send a test event of one topic to an installation's endpoint",
  usage: 'tassyir webhook trigger <topic> [--installation <id>] [options]',
  description: [
    "Tassyir sends a synthetic event (sample data, never the merchant's) to the endpoint",
    "the installation's version subscribes for that topic, signed like a real delivery and",
    'marked `tassyir-test: true`, and reports what your endpoint answered. Exit code 1 when',
    "it did not answer 2xx. Without --installation, the app's only active installation.",
    `Topics: ${TOPICS.join(', ')}.`,
  ].join('\n'),
  positionals: { min: 1, max: 1, names: '<topic>' },
  options: {
    ...APP_OPTION,
    installation: {
      type: 'string',
      value: 'id',
      description:
        'The installation to send it to (`tassyir webhook deliveries` and the console show ids).',
    },
  },
  async run(context, { values, positionals }) {
    const topic = positionals[0] ?? '';
    if (!TOPICS.includes(topic)) {
      throw usageError(
        `"${topic}" is not a webhook topic (${TOPICS.join(', ')})`,
        'webhook trigger',
      );
    }
    const { api } = await context.api();
    const app = await resolveApp(context, api, stringValue(values['app']));
    let installationId = stringValue(values['installation']);
    if (installationId === undefined) {
      const active: Installation[] = (
        await api.listInstallations(app.id, { status: 'active', limit: 100 })
      ).data;
      const only = active[0];
      if (active.length !== 1 || only === undefined) {
        throw new CliError({
          code: 'INSTALLATION_REQUIRED',
          message:
            active.length === 0
              ? `${app.handle} has no active installation`
              : `${app.handle} has ${String(active.length)} active installations: which one?`,
          fix:
            active.length === 0
              ? 'Install the app on a dev store first (`tassyir store create`, then the install link in the developer console).'
              : `Pass --installation with one of: ${active.map((installation) => `${installation.id} (business ${installation.businessId})`).join(', ')}.`,
          exitCode: EXIT_CODES.USAGE,
          details: {
            installations: active.map((installation) => installation.id),
          },
        });
      }
      installationId = only.id;
    }
    const delivery = (await api.testWebhook(app.id, installationId, topic))
      .data;
    if (delivery.status !== 'delivered') {
      throw new CliError({
        code: 'WEBHOOK_ENDPOINT_FAILED',
        message: `The test ${topic} event reached no 2xx: ${delivery.error ?? 'failed'}${delivery.statusCode === null ? '' : ` (HTTP ${String(delivery.statusCode)})`}`,
        fix: failureFix(delivery.errorClass, delivery.statusCode),
        exitCode: EXIT_CODES.FAILED,
        details: { delivery },
      });
    }
    return {
      data: { app: { id: app.id, handle: app.handle }, delivery },
      text: lines(
        `✓ Your endpoint answered ${cell(delivery.statusCode)} to a test ${topic} in ${cell(delivery.durationMs)} ms`,
        `  (installation ${delivery.installationId}, webhook-id ${delivery.webhookId}).`,
      ),
    };
  },
};

export const webhookDeliveriesCommand: Command = {
  name: 'webhook deliveries',
  summary: "The app's delivery log (30 days), newest first",
  usage: 'tassyir webhook deliveries [options]',
  description:
    'Metadata only: Tassyir keeps no body. --cursor takes the nextCursor printed last time (same filters).',
  options: {
    ...APP_OPTION,
    installation: {
      type: 'string',
      value: 'id',
      description: 'One installation.',
    },
    topic: { type: 'string', value: 'topic', description: 'One topic.' },
    status: {
      type: 'string',
      value: 'status',
      description: `${STATUSES.join(', ')}.`,
    },
    since: {
      type: 'string',
      value: 'iso-time',
      description: 'Recorded at or after it.',
    },
    until: {
      type: 'string',
      value: 'iso-time',
      description: 'Recorded before it.',
    },
    limit: { type: 'string', value: '1-100', description: 'Default 50.' },
    cursor: { type: 'string', value: 'cursor', description: 'The next page.' },
  },
  async run(context, { values }) {
    const filters: DeliveryFilters = {};
    const installation = stringValue(values['installation']);
    if (installation !== undefined) filters.installationId = installation;
    const topic = stringValue(values['topic']);
    if (topic !== undefined) {
      if (!TOPICS.includes(topic)) {
        throw usageError(
          `"${topic}" is not a webhook topic`,
          'webhook deliveries',
        );
      }
      filters.topic = topic;
    }
    const status = stringValue(values['status']);
    if (status !== undefined) {
      const known = STATUSES.find((candidate) => candidate === status);
      if (!known) {
        throw usageError(
          `--status is "${status}"; use ${STATUSES.join(', ')}`,
          'webhook deliveries',
        );
      }
      filters.status = known;
    }
    for (const key of ['since', 'until'] as const) {
      const value = stringValue(values[key]);
      if (value === undefined) continue;
      if (!Number.isFinite(Date.parse(value))) {
        throw usageError(
          `--${key} is not an ISO 8601 time (2026-10-14T10:00:00Z)`,
          'webhook deliveries',
        );
      }
      filters[key] = value;
    }
    const limit = stringValue(values['limit']);
    if (limit !== undefined) {
      const parsed = Number(limit);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
        throw usageError(
          '--limit takes a whole number from 1 to 100',
          'webhook deliveries',
        );
      }
      filters.limit = parsed;
    }
    const cursor = stringValue(values['cursor']);
    if (cursor !== undefined) filters.cursor = cursor;

    const { api } = await context.api();
    const app = await resolveApp(context, api, stringValue(values['app']));
    const page = await api.listDeliveries(app.id, filters);
    return {
      data: {
        app: { id: app.id, handle: app.handle },
        deliveries: page.data,
        nextCursor: page.nextCursor,
      },
      text:
        page.data.length === 0
          ? lines('No delivery matches (the log keeps 30 days).')
          : lines(
              table(
                ['ID', 'TOPIC', 'STATUS', 'TRIES', 'LAST', 'ERROR', 'CREATED'],
                page.data.map((delivery) => [
                  delivery.id,
                  delivery.topic,
                  delivery.status,
                  String(delivery.attempts),
                  cell(delivery.lastStatusCode),
                  cell(delivery.lastError),
                  delivery.createdAt,
                ]),
              ),
              page.nextCursor && `More: --cursor ${page.nextCursor}`,
            ),
    };
  },
};

export const webhookReplayCommand: Command = {
  name: 'webhook replay',
  summary:
    'Send one delivery again, now (same webhook-id, body as the resource is now)',
  usage: 'tassyir webhook replay <delivery-id> [options]',
  description: [
    'One more attempt of the same delivery; if it fails, it is final (no retry schedule).',
    'Your endpoint sees the same webhook-id: a receiver that dedupes on it ignores a replay',
    'of a delivery it already processed. Exit code 1 when it was not delivered.',
  ].join('\n'),
  positionals: { min: 1, max: 1, names: '<delivery-id>' },
  options: APP_OPTION,
  async run(context, { values, positionals }) {
    const { api } = await context.api();
    const app = await resolveApp(context, api, stringValue(values['app']));
    const deliveryId = positionals[0] ?? '';
    const { data: delivery, outcome } = await api.replayDelivery(
      app.id,
      deliveryId,
    );
    if (outcome === 'failed' || outcome === 'skipped') {
      throw new CliError({
        code:
          outcome === 'failed'
            ? 'WEBHOOK_ENDPOINT_FAILED'
            : 'WEBHOOK_REPLAY_SKIPPED',
        message:
          outcome === 'failed'
            ? `The replay of ${delivery.id} was not delivered: ${delivery.lastError ?? 'failed'}`
            : `Tassyir did not send ${delivery.id}: ${delivery.lastError ?? 'skipped'}`,
        fix:
          outcome === 'failed'
            ? failureFix(delivery.errorClass, delivery.lastStatusCode)
            : "lastError says why (for example SCOPE_NOT_GRANTED: the installation no longer grants the topic's scope).",
        exitCode: EXIT_CODES.FAILED,
        details: { delivery, outcome },
      });
    }
    const said: Record<string, string> = {
      delivered: `✓ Delivered ${delivery.id} (HTTP ${cell(delivery.lastStatusCode)}, attempt ${String(delivery.attempts)}).`,
      paused: `Tassyir paused sending meanwhile: ${delivery.id} stays pending and goes out when the pause ends.`,
      raced: `Another attempt took ${delivery.id} at the same moment: \`tassyir webhook deliveries\` shows how it went.`,
      not_pending: `Another attempt took ${delivery.id} at the same moment: \`tassyir webhook deliveries\` shows how it went.`,
    };
    return {
      data: { app: { id: app.id, handle: app.handle }, outcome, delivery },
      text: lines(said[outcome] ?? `${outcome}: ${delivery.id}`),
    };
  },
};
