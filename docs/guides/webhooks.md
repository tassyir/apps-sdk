---
title: Webhooks
description: Subscribe to a business's events, verify each signed delivery, handle retries and replays once, and test your endpoint.
order: 70
---

# Webhooks

Tassyir tells your app what happens on the businesses that installed it: an
order created, confirmed or delivered, a product changed, stock moved, the
app uninstalled. Each event is a signed HTTPS `POST` to your server, sent at
least once and in no particular order. Verify every delivery, answer fast,
and handle each one once.

## Subscribe

List the topics in the manifest, each with the address that receives it:

```toml
[[webhooks]]
topics = ["orders/created", "orders/delivered", "app/uninstalled"]
uri    = "/webhooks"
```

`uri` is a path on your `hosting.url`, or an absolute https URL. A topic is
subscribed once in the whole manifest, and needs the scope that reads its
resource. A new topic takes effect on an installation once its merchant
accepts the version that adds it.

## Topics

| Topic                                                                                              | Fires when                                                    | `data`                                        | Needs            |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------- | ---------------- |
| `orders/created`                                                                                   | a real order is created (or a checkout becomes one)           | `order`                                       | `read_orders`    |
| `orders/confirmed`, `orders/cancelled`, `orders/dispatched`, `orders/delivered`, `orders/returned` | the order reaches that stage                                  | `order`                                       | `read_orders`    |
| `orders/updated`                                                                                   | anything else an app can read changes; `changed` names it     | `order`                                       | `read_orders`    |
| `abandoned_checkouts/created`                                                                      | a buyer leaves a checkout unfinished                          | `checkout`                                    | `read_orders`    |
| `products/created`, `products/updated`                                                             | a product is created, or reads differently                    | `product`                                     | `read_products`  |
| `products/deleted`                                                                                 | not sent today: no product is deleted (see below)             | `product`                                     | `read_products`  |
| `inventory_levels/updated`                                                                         | a stock item's levels, low-stock threshold or low flag change | `inventoryLevel`                              | `read_inventory` |
| `customers/updated`                                                                                | a customer reads differently                                  | `customer`                                    | `read_customers` |
| `app/installed`, `app/uninstalled`, `app/scopes_updated`                                           | your installation is created, removed, or its scopes change   | `installation`                                | none             |
| `customers/data_request`, `customers/redact`, `business/redact`                                    | buyer data requests and the deletion after uninstall          | see [Compliance](compliance-and-uninstall.md) | none             |

- **`app/*` and `business/redact` reach only the installation they are
  about**, never another app. Every other topic reaches each active
  installation of the business that subscribes to it and was granted its
  scope.
- **An installation limited to selected stores** receives order, checkout,
  product and stock events of its stores only. Customer events carry that
  installation's stores' counters.
- The resources (`order`, `product`, …) are the same as the Admin API's
  ([Orders](orders.md), [Products and collections](products-and-collections.md),
  [Stock](stock.md), [Customers](customers.md)), masked the same way.

## What you receive

```http
POST /webhooks HTTP/1.1
content-type: application/json
user-agent: Tassyir-Webhooks/1.0 (+https://developers.tassyir.io)
webhook-id: dlv_741939488313319175
webhook-timestamp: 1760173964
webhook-signature: v1a,K5oZfzN95Z9UVu1EsfQmfVNQhnkZ2pj9o9NDN/H/pI4…
tassyir-topic: orders/delivered
tassyir-business-id: 632000000000000001
tassyir-api-version: 2026-10
```

```json
{
  "id": "evt_741000000000000001",
  "type": "orders/delivered",
  "apiVersion": "2026-10",
  "createdAt": "2026-10-11T09:12:44.120Z",
  "businessId": "632000000000000001",
  "storeId": "632000000000000100",
  "appId": "741000000000000900",
  "installationId": "755000000000000001",
  "changed": ["delivered", "deliveredAt"],
  "data": { "order": { "id": "741000000000000500", "orderNumber": "1042" } }
}
```

| Header                | Value                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `webhook-id`          | `dlv_…`: one per event per installation, **the same on every retry and replay**. Deduplicate on it. |
| `webhook-timestamp`   | Unix seconds of this attempt.                                                                       |
| `webhook-signature`   | `v1a,<base64 Ed25519 signature>`; several, space-separated, while Tassyir rotates its keys.         |
| `tassyir-topic`       | The topic.                                                                                          |
| `tassyir-business-id` | The business.                                                                                       |
| `tassyir-api-version` | The API version of the body: the one your installation's version uses.                              |
| `tassyir-test`        | `true` on a test delivery only.                                                                     |

The body is the **envelope**: `id` (`evt_…`), `type`, `apiVersion`,
`createdAt` (when the event happened), `businessId`, `storeId` (may be
`null`), `appId` and `installationId` (check both are yours), `changed` and
`data`, one key per topic.

**`data` is read when the delivery is built**, seconds after the event, so it
can be newer than the event. Reconcile by the resource's `updatedAt`, and read
the resource again through the Admin API when you are unsure. Ignore fields
you do not know: a version may add fields, never rename or remove one.

## Verify every delivery

Tassyir signs `{webhook-id}.{webhook-timestamp}.{body}` with Ed25519 (Standard
Webhooks, scheme `v1a`). Verify the **raw body**, the exact bytes you
received: parsing the JSON and serialising it again breaks the signature.

```ts
import { isTassyirError, TassyirVerificationError } from '@tassyir/app';

/** Where you keep installations and handled deliveries. */
export interface WebhookState {
  isInstallation(installationId: string): Promise<boolean>;
  /** Records a webhook-id; false when it was already recorded. */
  markHandled(webhookId: string): Promise<boolean>;
}

// POST /webhooks
export async function receive(
  request: Request,
  state: WebhookState,
): Promise<Response> {
  let delivery;
  try {
    delivery = await tassyir.verifyWebhook(request, {
      // A delivery can arrive before app/installed: refuse it, Tassyir retries.
      installationId: async (id, event) =>
        event.type === 'app/installed' || (await state.isInstallation(id)),
      testDeliveries: 'accept',
    });
  } catch (error) {
    if (isTassyirError(error, 'KEYS_UNAVAILABLE'))
      return new Response(null, { status: 503 });
    if (error instanceof TassyirVerificationError)
      return new Response(null, { status: 400 });
    throw error;
  }
  if (delivery.test) return new Response(null, { status: 200 });

  // At least once: a webhook-id you already handled is answered and skipped.
  if (!(await state.markHandled(delivery.id)))
    return new Response(null, { status: 200 });

  switch (delivery.event.type) {
    case 'orders/delivered': {
      const { order } = delivery.event.data;
      console.log(
        `order ${order.orderNumber} delivered, ${order.total ?? '?'} ${order.currency}`,
      );
      break;
    }
    case 'app/uninstalled':
      await tassyir.tokens.forget(delivery.installationId);
      break;
  }
  return new Response(null, { status: 200 });
}
```

`tassyir.verifyWebhook` checks, in order:

1. the `v1a` signature, against the keys of
   `GET https://api.tassyir.io/apps/webhook-keys` (cached an hour, fetched
   again when no key verifies). During a key rotation a delivery carries
   several signatures; any one that verifies is enough;
2. the timestamp, within 5 minutes of now;
3. the envelope's `appId` (your numeric app id, `TASSYIR_APP_ID`: not the
   `app_…` client id) and `installationId` (your check);
4. the unsigned `tassyir-*` headers agree with the signed envelope.

`delivery.event` is typed per topic: `switch (delivery.event.type)` narrows
`data`. If the keys cannot be fetched once the cached copy has expired, it
throws `KEYS_UNAVAILABLE`: answer 503, and Tassyir delivers again later.

**Without the SDK:** decode each `whpk_…` key of the keys document (base64 of
the raw 32-byte Ed25519 public key), split `webhook-signature` on spaces,
keep the `v1a,` entries, and accept the delivery when one of them verifies
`{webhook-id}.{webhook-timestamp}.{raw body}` under one of the keys, the
timestamp is within 5 minutes, and `appId` and `installationId` are yours.

## Answer within 10 seconds

- Answer **2xx** as soon as the delivery is verified and recorded; do slow
  work afterwards, from a queue. Tassyir does not read your answer's body.
- Tassyir waits 10 seconds for the connection and your answer's headers, and
  follows no redirect: a 3xx is a failed attempt.
- Your endpoint must be https on port 443, at a public hostname.

## Retries, and disabled endpoints

| Your answer                                            | What Tassyir does                                                                                                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2xx                                                    | Delivered.                                                                                                                                               |
| 410 Gone                                               | Failed, and **disables the installation's webhooks at once**.                                                                                            |
| Anything else: 4xx, 5xx, 3xx, a timeout, no connection | Retries after 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 14 h, 20 h and 24 h (about 3 days), then gives up. A longer `Retry-After` is honoured, up to 24 hours. |

- **Three days of continuous failure** disables the installation's webhooks,
  and Tassyir emails you, at most once a day per app. Any 2xx resets the
  clock.
- Disabling is per installation, for all its topics. Until you re-enable it
  in the developer console, its events are recorded as skipped and never
  sent. Fix your endpoint first: a 410 or three more days of failure
  disables it again. Then replay the skipped deliveries that matter.
- A delivery still pending four days after its event fails.

## Handle each event once

Delivery is **at least once, in no particular order**. The same delivery can
arrive twice (a retry after your answer was lost, a replay), and
`orders/delivered` can arrive before `orders/dispatched`.

- Deduplicate on `webhook-id`: it is the same on every retry and replay of a
  delivery. Keep the ids for at least a week (replays are possible for 7
  days).
- Never rely on order: compare the resource's `updatedAt` with what you
  hold, and read it again when unsure.
- An event for an installation you do not know yet (it overtook
  `app/installed`) can be refused with a 4xx: it is retried.

## How events are recorded

- **One fact, one event.** Confirming, cancelling, dispatching, delivering or
  returning an order sends that topic. `orders/updated` is sent for every
  other change an app can read (the buyer, the items, the delivery and the
  carrier's status, scheduling, archiving, a waiting order unlocking), with
  `changed` naming the order's top-level fields. A write that also changed
  fields outside its topic's own sends `orders/updated` for those too.
- **`orders/created` is sent once per real order.** An abandoned checkout is
  `abandoned_checkouts/created`; when it becomes an order (same id),
  `orders/created` is sent then.
- **A returned order keeps its status** (usually `pending`): read the
  `returned` flag.
- **Carriers.** A carrier's status change is `orders/updated` with `changed`
  naming `delivery` (and `status` when the order's status moved with it). A carrier update that changes nothing sends nothing.
- **Products.** `products/updated` names the product's top-level fields that
  changed (`price`, `variants`, `images`, `active`, `collectionIds`, …). A
  deactivated product is `products/updated` with `active: false`: no product
  is ever deleted, so `products/deleted` is not sent today.
- **Stock.** `inventory_levels/updated` is sent once per stock item per
  change, with `changed` empty: the body is the item's whole stock. Stock can
  be negative after a dispatch shortfall; it is sent as it is.
- **Customers.** `customers/updated` is sent when a customer reads
  differently, never when it was only recomputed.

## Test, replay and read the log

In the developer console:

- **Send a test** (the **Installs** tab): a synthetic event of one topic your
  installation subscribes to, with sample data (order `TEST-1001`, buyer "Test
  Buyer"), signed and sent like a real delivery. It is marked by the header
  `tassyir-test: true`, a `webhook-id` of `dlv_test_…` and the envelope id
  `evt_0`; its `businessId`, `appId` and `installationId` are real. It is
  never retried, never logged, and never disables your endpoint.
  `@tassyir/app` refuses test deliveries (`WEBHOOK_TEST_DELIVERY`) unless you
  pass `testDeliveries: 'accept'`; then `delivery.test` is true.
- **Read the log** (the **Webhook deliveries** tab): every delivery of the
  last 30 days, metadata only (status, HTTP status, error, duration,
  attempts), never a body.
- **Replay** a delivery: one more attempt now, with the **same `webhook-id`**
  and a body rebuilt from the resource as it is now. A failed replay is final
  (no retry follows). A delivery can be replayed while its event is kept, 7
  days.

A delivery's `status` is `pending`, `delivered`, `failed` or `skipped`. The
error codes the log shows:

| Error                                                                                                    | Meaning                                                             |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `HTTP_<status>`, `HTTP_410_GONE`, `HTTP_3xx_REDIRECT_NOT_FOLLOWED`                                       | Your endpoint answered, but not 2xx.                                |
| `TIMEOUT`                                                                                                | No answer within 10 seconds.                                        |
| `DNS_FAILED`, `CONNECTION_REFUSED`, `CONNECTION_RESET`, `HOST_UNREACHABLE`, `TLS_ERROR`, `NETWORK_ERROR` | The connection failed.                                              |
| `BLOCKED_ADDRESS`, `URL_NOT_ALLOWED`                                                                     | Tassyir will not send to that address (a private or reserved one).  |
| `EXPIRED`                                                                                                | Still pending four days after the event.                            |
| `ENDPOINT_DISABLED`                                                                                      | Skipped: the installation's webhooks are disabled.                  |
| `INSTALLATION_INACTIVE`, `APP_SUSPENDED`                                                                 | Skipped: the installation or the app cannot receive now.            |
| `TOPIC_NOT_SUBSCRIBED`, `SCOPE_NOT_GRANTED`, `OUTSIDE_STORE_ACCESS`                                      | Skipped: the installation's version, scopes or stores exclude it.   |
| `NO_BODY`, `EVENT_EXPIRED`                                                                               | Skipped: the resource is gone, or this installation may not see it. |
