import { TassyirVerificationError, verifyHostedWebhook } from '@tassyir/app';
import type { HostedProps, HostedVerifiedWebhook } from '@tassyir/app';
import { recordOrderReceived } from './storage.ts';

/** Where Tassyir sends deliveries: `uri` of `[[webhooks]]` in tassyir.app.toml. */
export const WEBHOOK_PATH = '/webhooks';

/**
 * POST /webhooks. On Tassyir Hosting a delivery reaches the Worker only
 * through Tassyir's dispatcher, which takes it from Tassyir's API alone
 * (signed with a key only the two of them hold, each delivery once) and runs
 * the installation's version with `ctx.props.viewer` null. A page request
 * always has a viewer, and nothing else on the internet reaches the Worker.
 * `verifyHostedWebhook` checks all of that, then every rule of a delivery:
 * the envelope names this installation, its business and this app, the
 * timestamp is fresh, a `v1a` signature is there.
 *
 * Deliveries are at least once and in no particular order: every handler
 * below is idempotent (keyed on the resource's id). Answer within 10
 * seconds. Anything but a 2xx is retried for about 3 days, then the
 * installation's webhooks are disabled; a 410 disables them at once.
 */
export async function receiveWebhook(
  request: Request,
  props: HostedProps,
): Promise<Response> {
  let delivery: HostedVerifiedWebhook;
  try {
    delivery = await verifyHostedWebhook(request, props, {
      // "Send test" in the developer console: verified, then acknowledged.
      testDeliveries: 'accept',
    });
  } catch (error) {
    if (error instanceof TassyirVerificationError) {
      console.warn(`webhook refused: ${error.code}. ${error.fix ?? ''}`);
      return new Response(null, { status: 400 });
    }
    throw error;
  }
  if (delivery.test) {
    console.info(`webhook: test delivery of ${delivery.topic}, verified`);
    return new Response(null, { status: 200 });
  }
  await handleEvent(delivery, props);
  return new Response(null, { status: 200 });
}

/** `event.type` narrows `event.data` to the topic's 2026-10 body. */
async function handleEvent(
  { event }: HostedVerifiedWebhook,
  props: HostedProps,
): Promise<void> {
  switch (event.type) {
    case 'orders/created':
      // Money is a decimal string ("2500.00") with its currency; this keeps
      // only the id, to count the orders received since the install.
      await recordOrderReceived(
        props.STORAGE,
        event.data.order.id,
        new Date(event.createdAt),
      );
      break;
    case 'app/uninstalled':
      // Tassyir erases STORAGE 48 hours from now, then sends
      // business/redact. ctx.props.TASSYIR already refuses calls.
      break;
    case 'business/redact':
      // STORAGE is already erased: never write to it here. Delete what the
      // app keeps about the business elsewhere (through allowed_hosts).
      break;
    case 'customers/data_request':
    case 'customers/redact':
      // This app keeps nothing about buyers. One that does must export or
      // erase what it holds about event.data.customer here.
      break;
    default:
      // A topic this version does not handle (the manifest decides which
      // ones arrive).
      break;
  }
}
