import { isTassyirError, TassyirVerificationError } from '@tassyir/app';
import type { TassyirApp, VerifiedWebhook } from '@tassyir/app';
import type { Log } from './log.ts';
import type { AppStore } from './store.ts';

/** Where Tassyir sends deliveries: `uri` of `[[webhooks]]` in tassyir.app.toml. */
export const WEBHOOK_PATH = '/webhooks';

export interface WebhookDeps {
  tassyir: TassyirApp;
  store: AppStore;
  log: Log;
}

/**
 * POST /webhooks. Tassyir signs every delivery (Standard Webhooks headers,
 * an Ed25519 `v1a` signature) over the RAW body, so the bytes are verified as
 * they arrived: never parse the JSON and serialise it again first. After the
 * signature, the SDK checks the timestamp (5 minutes), the envelope's appId
 * (TASSYIR_APP_ID) and that the installation is ours.
 *
 * Delivery is at least once and in no particular order: a delivery already
 * handled (same webhook-id) is answered 200 and skipped. Answer within 10
 * seconds; move slow work to a queue. Anything but a 2xx is retried for
 * about 3 days, then the installation's webhooks are disabled; a 410 disables
 * them at once.
 */
export async function receiveWebhook(
  request: Request,
  deps: WebhookDeps,
): Promise<Response> {
  // Read here, trusted only inside the installation check below, which the
  // SDK runs once the signature (which covers webhook-id) has verified.
  const webhookId = request.headers.get('webhook-id') ?? '';
  let delivery: VerifiedWebhook;
  try {
    delivery = await deps.tassyir.verifyWebhook(request, {
      // An installation is ours once app/installed or a page visit recorded
      // it. A delivery that overtakes app/installed is refused (400) and
      // Tassyir delivers it again later. A delivery already handled passes,
      // so it is acknowledged below: business/redact deletes the
      // installation, and its redelivery must not be refused for 3 days.
      installationId: (installationId, event) =>
        event.type === 'app/installed' ||
        deps.store.hasHandled(webhookId) ||
        deps.store.installation(installationId) !== undefined,
      // "Send test" in the developer console: verified, then acknowledged.
      testDeliveries: 'accept',
    });
  } catch (error) {
    if (isTassyirError(error, 'KEYS_UNAVAILABLE')) {
      // Tassyir's keys could not be fetched: ask Tassyir to try again later.
      deps.log.warn('webhook: KEYS_UNAVAILABLE, answered 503');
      return new Response(null, { status: 503 });
    }
    if (error instanceof TassyirVerificationError) {
      deps.log.warn(`webhook refused: ${error.code}. ${error.fix ?? ''}`);
      return new Response(null, { status: 400 });
    }
    throw error;
  }

  if (delivery.test) {
    deps.log.info(`webhook: test delivery of ${delivery.topic}, verified`);
    return new Response(null, { status: 200 });
  }
  if (deps.store.hasHandled(delivery.id)) {
    return new Response(null, { status: 200 });
  }
  await handleEvent(delivery, deps);
  await deps.store.markHandled(delivery.id);
  return new Response(null, { status: 200 });
}

/** `event.type` narrows `event.data` to the topic's 2026-10 body. */
async function handleEvent(
  { event, installationId, businessId }: VerifiedWebhook,
  deps: WebhookDeps,
): Promise<void> {
  switch (event.type) {
    case 'app/installed':
      await deps.store.recordInstallation(installationId, businessId);
      break;
    case 'app/scopes_updated':
      // Tassyir revoked the installation's tokens with the new grant: the
      // next page view exchanges a new ID token for a token with the scopes.
      await deps.tassyir.tokens.forget(installationId);
      break;
    case 'app/uninstalled':
      await deps.tassyir.tokens.forget(installationId);
      await deps.store.markUninstalled(installationId);
      break;
    case 'business/redact':
      // 48 hours after the uninstall: Tassyir deleted this app's app data;
      // delete everything this server still holds about the business.
      await deps.store.forgetInstallation(installationId);
      break;
    case 'customers/data_request':
    case 'customers/redact':
      // This app keeps nothing about buyers. One that does must export or
      // erase what it holds about event.data.customer here.
      deps.log.info(`webhook: ${event.type}, nothing held about buyers`);
      break;
    case 'orders/created': {
      const { order } = event.data;
      // Money is a decimal string ("2500.00") with its currency.
      deps.log.info(
        `webhook: order ${order.orderNumber} created, total ${order.total ?? 'unknown'} ${order.currency}`,
      );
      break;
    }
    default:
      // A topic this version does not handle (the manifest decides which
      // ones arrive).
      break;
  }
}
