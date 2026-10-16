---
title: Compliance and uninstall
description: What happens when a merchant uninstalls your app, and how to honour buyer data requests and the deletion that follows an uninstall.
order: 160
---

# Compliance and uninstall

A merchant can uninstall your app at any time, and buyers can ask for their
data to be exported or erased. Tassyir tells your app through webhooks, and
your app must do its part: stop using the business's data, and delete or
export what it holds.

## Subscribe to the compliance topics

```toml
[[webhooks]]
topics = ["app/uninstalled", "customers/data_request", "customers/redact", "business/redact"]
uri    = "/webhooks"
```

The compliance topics need no scope. A custom app is not required to
subscribe to them; an app in the marketplace is (the review checks it:
[Publishing to the marketplace](publishing.md#the-review-checklist)). Subscribe anyway
if your app keeps any data about a business or its buyers: Tassyir deletes
the data it holds for your app either way, but only your app can delete what
your servers hold.

## Uninstall

When a merchant uninstalls your app:

1. **Every token is revoked at once.** The next Admin API call is 401
   `APP_TOKEN_INVALID`, and a refresh is refused.
2. **`app/uninstalled`** is sent to that installation (`data.installation`,
   with `status: "uninstalled"` and `uninstalledAt`). Forget its tokens, stop
   its jobs, and stop calling the API for it.
3. **48 hours later**, Tassyir deletes every [app data](app-data.md) value
   the installation kept, and sends **`business/redact`** to that installation
   (`data.business.id`). Delete everything your servers still hold about the
   business for it.

On [Tassyir Hosting](tassyir-hosting.md#webhooks), the installation's own
database (`ctx.props.STORAGE`) is deleted with its app data, and both
deliveries reach your code with `ctx.props.TASSYIR` refused
(`HOSTED_CALL_REFUSED`).

```ts
import type { VerifiedWebhook } from '@tassyir/app';

// Called with a verified delivery (see Webhooks).
export async function onLifecycle(delivery: VerifiedWebhook): Promise<void> {
  switch (delivery.event.type) {
    case 'app/uninstalled':
      await tassyir.tokens.forget(delivery.installationId);
      // Stop scheduled work for this installation.
      break;
    case 'business/redact':
      // Delete what you keep for this installation of delivery.businessId.
      break;
  }
}
```

[Webhooks](webhooks.md#verify-every-delivery) shows how to verify a delivery.

- A **reinstall** is a new installation, with a new id, a new consent and no
  data, even within the 48 hours. The old installation's `business/redact`
  still comes, naming the old installation id: delete by installation, not
  by business.
- `business/redact` reaches only the uninstalled installation it names, and
  is redelivered like any webhook: answer 200 when you already handled it,
  even though the installation is gone.

## Buyer data requests

`customers/data_request` and `customers/redact` are sent when Tassyir exports
or erases a buyer's data for a business.

```json
{
  "id": "evt_741000000000000002",
  "type": "customers/redact",
  "apiVersion": "2026-10",
  "createdAt": "2026-10-12T10:00:00.000Z",
  "businessId": "632000000000000001",
  "storeId": null,
  "appId": "741000000000000900",
  "installationId": "755000000000000001",
  "changed": [],
  "data": {
    "customer": { "id": "741000000000001000", "phone": "+213555123456" },
    "orderIds": ["741000000000000001", "741000000000000002"]
  }
}
```

- `data.customer.id` is the customer ([Customers](customers.md));
  `data.customer.phone` is there only with `read_customer_contact`, and reads
  `**********` when the plan hides phones or when every order it names was
  waiting. `data.orderIds` are the buyer's orders your installation could
  see.
- An installation limited to selected stores is told only about orders in its
  stores, and gets no delivery when none is left: it never saw this buyer.
- **`customers/redact`**: delete or anonymise everything your app holds about
  that buyer and those orders. Tassyir has already erased the buyer from the
  orders; the orders themselves stay, as the merchant's records.
- **`customers/data_request`**: gather what your app holds about that buyer
  and make it available to the merchant.

These bodies are built from what Tassyir recorded when the request was made,
so a replay within 7 days carries the same buyer even though the data is
gone.

## Suspension

Tassyir can suspend an installation, or a whole app. Its tokens are revoked,
its page cannot be opened, and its webhooks are skipped until it is resumed.

## A checklist

- Subscribe to `app/uninstalled`, `customers/data_request`,
  `customers/redact` and `business/redact`.
- On `app/uninstalled`: forget the tokens and stop the installation's work.
- On `customers/redact`: erase the buyer from your systems.
- On `customers/data_request`: be able to tell the merchant what you hold.
- On `business/redact`: delete what you hold for that installation.
- Deduplicate on `webhook-id`, and answer 2xx to a delivery you already
  handled.
