---
title: Orders
description: Read a business's orders, keep them in sync, and create, edit, confirm, cancel, schedule and comment on them like a team member.
order: 90
---

# Orders

An app works orders the way a team member does: it reads them, creates
orders from its own channel, fixes the buyer's details, confirms, cancels
with a reason, schedules a call back and leaves comments. Every write runs the
same checks as the dashboard button that does the same thing, and the
dashboard shows your app's name on it ("Review Requests confirmed order
#1042").

| Route                             | Does                               | Scope          |
| --------------------------------- | ---------------------------------- | -------------- |
| `GET /orders`, `GET /orders/{id}` | List and read orders               | `read_orders`  |
| `GET /orders/{id}/comments`       | Read an order's comments           | `read_orders`  |
| `GET /cancel-reasons`             | The business's cancel reasons      | `read_orders`  |
| `POST /orders`                    | Create an order                    | `write_orders` |
| `PATCH /orders/{id}`              | Edit the buyer, delivery and notes | `write_orders` |
| `POST /orders/{id}/confirm`       | Confirm                            | `write_orders` |
| `POST /orders/{id}/cancel`        | Cancel, with an optional reason    | `write_orders` |
| `POST /orders/{id}/schedule`      | Schedule a call back               | `write_orders` |
| `POST /orders/{id}/comments`      | Add a comment                      | `write_orders` |

Dispatching to a carrier, labels and returns are not in API version
`2026-10`.

## The order

```json
{
  "id": "741000000000000001",
  "orderNumber": "1042",
  "storeId": "741000000000000100",
  "status": "confirmed",
  "waiting": false,
  "archived": false,
  "dispatched": false,
  "delivered": false,
  "returned": false,
  "currency": "DZD",
  "total": "5000.00",
  "shippingPrice": "500.00",
  "subtotal": "5000.00",
  "discountTotal": "500.00",
  "discounts": [
    {
      "title": "Autumn sale",
      "code": null,
      "class": "product",
      "source": "offer",
      "amount": "500.00",
      "offerId": "741000000000000800"
    }
  ],
  "buyer": {
    "provinceCode": 16,
    "townOns": 1601,
    "name": "Amina B.",
    "phone": "+213555123456"
  },
  "delivery": {
    "method": "home",
    "speed": "standard",
    "deliveryAgentId": null,
    "trackingNumber": null,
    "carrierStatus": null
  },
  "items": [
    {
      "id": "741000000000000011",
      "productId": "741000000000000500",
      "variantId": "741000000000000501",
      "packParentItemId": null,
      "name": "Robe kabyle",
      "variantName": "M",
      "sku": "RK-01-M",
      "quantity": 1,
      "unitPrice": "4500.00",
      "totalPrice": "4500.00",
      "originalPrice": "5000.00",
      "discountAmount": "500.00",
      "discounts": [
        {
          "title": "Autumn sale",
          "code": null,
          "class": "product",
          "source": "offer",
          "amount": "500.00",
          "offerId": "741000000000000800"
        }
      ]
    }
  ],
  "source": "app:review-requests",
  "confirmedAt": "2026-10-11T09:12:44.120Z",
  "createdAt": "2026-10-11T08:00:00.000Z",
  "updatedAt": "2026-10-11T09:12:44.120Z"
}
```

- **State:** `status` is the pipeline status, built in (`pending`,
  `confirmed`, `scheduled`, `canceled`, …) or one the merchant named: treat it
  as an open string. The flags `dispatched`, `delivered`, `returned`,
  `archived` and `waiting` say the rest. **A returned order keeps its status**
  (usually `pending`): read `returned`.
- **Money:** `total`, `shippingPrice`, `subtotal`, `discountTotal`, and each
  line's `unitPrice`, `totalPrice`, `originalPrice` and `discountAmount` are
  decimal strings in `currency`; `discounts[]` says which offers priced the
  order ([Order money](#order-money)).
- **Buyer:** `provinceCode` (the wilaya, 1 to 58) and `townOns` (the commune)
  always; `name`, `phone`, `phone2`, `email`, `address`, `address2`, and the
  order's `note` and `deliveryNote`, only with `read_customer_contact`.
- **Delivery:** `method` (`home` or `stopdesk`), `speed`, the delivery agent,
  the tracking number and `carrierStatus`, the carrier's own wording.
- **Lines:** `items[]`; a pack's component lines carry `packParentItemId`.
- **Where it came from:** `source` (`shopify:<domain>`, `app:<handle>` for an
  order an app created, `null` for the storefront and the dashboard),
  `landingPageId`, `utm { source, medium, campaign, content }`.
- **Other:** `exchangeOfOrderId`, `cancellation { reasonId, reasonLabel,
source }`, and the times `scheduledFor`, `confirmedAt`, `dispatchedAt`,
  `deliveredAt`, `returnedAt`, `canceledAt`, `createdAt`, `updatedAt`.

**Waiting orders.** An order past the plan's order allowance is created
`waiting: true` and masked whatever your scopes (phones `**********`, notes
`null`) until it unlocks, which sends `orders/updated` with `waiting`. You may
read, edit, cancel, schedule and comment on it; confirming it is 403
`ORDER_LIMIT_REACHED`.

## Order money

Read an order's money in this order: the goods before any offer, what the
offers took off, what the buyer pays for delivery, and what the courier
collects.

| Field                    | Meaning                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subtotal`               | The goods before every offer. Always present. An order with no discount data (older orders, exchanges, orders synced from another channel) reads `total − shippingPrice`. |
| `discountTotal`          | What the product and order discounts took off. `"0.00"` when none. It **leaves out** a delivery waiver.                                                                   |
| `shippingPrice`          | What the buyer pays for delivery: `"0.00"` when it was waived.                                                                                                            |
| `total`                  | What the courier collects: `subtotal − discountTotal + shippingPrice`.                                                                                                    |
| `discounts[]`            | Every discount the order got, one entry per title, code, class and source.                                                                                                |
| `items[].originalPrice`  | The catalogue unit price before any offer. `null` on a line no discount was worked out for (older orders, exchanges, synced orders).                                      |
| `items[].discountAmount` | The line's share of the product and order discounts. `"0.00"` when none.                                                                                                  |
| `items[].discounts[]`    | The `product` entries that priced this line.                                                                                                                              |

A `discounts[]` entry is `{ title, code, class, source, amount, offerId }`:

- `title` is the offer or code's name, frozen when the order was placed: it
  does not follow a later rename.
- `class` is `product` (taken off lines), `order` (taken off the whole order)
  or `delivery` (the delivery waiver, which is **not** part of `discountTotal`).
- `source` is `offer`, `code`, `manual`, `app` or `import`; treat it as an open
  string. `code` is the code the buyer typed, if any.
- `offerId` is `null` for a manual, imported or older quantity-tier discount.
  Read the offer through [Offers](offers.md) when it is set.

**Lines are net.** A line's `unitPrice` and `totalPrice` are what was charged
after the discounts; `originalPrice` is the gross unit price. For an order
priced with discounts, `totalPrice = originalPrice × quantity − discountAmount`,
`unitPrice = totalPrice / quantity`, and `discountTotal` is the sum of the
lines' `discountAmount`. A discount that covers several lines is spread over
them, so a line's `totalPrice` is its own amount, never the whole offer's.

**"You saved"** is `discountTotal` plus the `amount` of the entries with
`class: "delivery"`. Add them with a decimal library, never `parseFloat`.

```ts
const { data: order } = await admin.get('/orders/{id}', {
  path: { id: '741000000000000001' },
});

for (const item of order.items) {
  if (item.discountAmount === '0.00') continue;
  const offers = item.discounts.map((discount) => discount.title).join(', ');
  console.log(
    `${item.name}: ${item.originalPrice ?? '?'} → ${item.unitPrice ?? '?'} (${offers})`,
  );
}
console.log('goods', order.subtotal, 'off', order.discountTotal);
```

The fields come with or without `read_customer_contact`, and on a waiting
order: money carries no contact data. `fields` accepts `subtotal`,
`discountTotal` and `discounts`. The `orders/*` webhook bodies carry the same
fields, and a change to one of them (a discount added or removed on an edit)
sends `orders/updated` with `changed` naming `subtotal`, `discountTotal` or
`discounts`: if you switch over `changed`, keep a default branch. An abandoned
checkout's lines carry `originalPrice`, `discountAmount` and `discounts`, but
the checkout itself has no order-level money fields.

## Which orders you can reach

`GET /orders` lists every order of the business your token may read: every
stage, archived ones included, newest first. Not listed: abandoned checkouts
still waiting for the merchant (they are `abandoned_checkouts/created`, and
become orders when recovered) and the collected-goods rows Tassyir keeps
for an exchange. Orders of stores outside your installation's are left out.

Every route that names an order reads it that way first: any other id is
**404 `NOT_FOUND`**, before anything is written. With an online token whose
person may see only the orders assigned to them, you reach only those.

## List and sync

| Filter         | Rule                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------- |
| `status`       | One status or several, comma-separated (`confirmed,scheduled`): 1 to 20, custom statuses by name. |
| `createdSince` | ISO 8601 (`2026-10-01T00:00:00Z`; a date alone is midnight UTC): created at or after it.          |
| `updatedSince` | Changed at or after it, carrier tracking included.                                                |
| `storeId`      | One of your installation's stores; another is 460.                                                |

Filters only narrow, and the cursor is bound to them. The list stays ordered
by creation, so to sync **walk every page and keep the largest `updatedAt`
you saw**, then start the next sync from it:

```ts
export async function syncOrders(since: string): Promise<string> {
  let newest = since;
  for await (const order of admin.paginate('/orders', {
    query: { updatedSince: since, limit: 100 },
  })) {
    // Upsert the order in your own store here, by id.
    if (order.updatedAt > newest) newest = order.updatedAt;
  }
  return newest; // where the next sync starts
}
```

Between syncs, the `orders/*` webhooks tell you what changed
([Webhooks](webhooks.md#how-events-are-recorded)).

## Create an order

```ts
const created = await admin.request('post', '/orders', {
  body: {
    storeId: '741000000000000100',
    buyer: {
      name: 'Amina B.',
      phone: '+213555123456',
      provinceCode: 16,
      townOns: 1601,
      address: '12 rue Didouche Mourad',
    },
    items: [
      {
        productId: '741000000000000500',
        variantId: '741000000000000501',
        quantity: 2,
      },
    ],
    delivery: { method: 'home', speed: 'standard' },
    note: 'Call after 6pm',
  },
  // One key per order of your channel: a retry never creates it twice.
  idempotencyKey: 'sheet-row-128',
});

if (created.status === 201)
  console.log('created', created.data.data.orderNumber);
else
  console.log(
    'the same buyer already ordered these items',
    created.data.data.id,
  );
```

| Field                  | Rule                                                                                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storeId`              | Optional for an installation with one store or every store (then resolved from the items). Required with several selected stores (400 `STORE_REQUIRED`).                                                                      |
| `buyer`                | Required, may be `{}`. `phone`, `phone2`: `+213`, then 5, 6 or 7, then 8 digits. `provinceCode` 1 to 58, `townOns` a commune code, `name` up to 200, `address` and `address2` up to 500, `email`.                             |
| `items`                | 1 to 50 lines of `productId`, optional `variantId`, `quantity` 1 to 999. Each product must be one you can list; same lines are merged.                                                                                        |
| `delivery`             | Optional. `method`: `home` (default) or `stopdesk` (the desk of the buyer's commune). `speed`: `standard` (default) or `economy`.                                                                                             |
| `codes`                | Optional, **one offer code at most** (`["SARA10"]`). A code that does not apply never fails the order: it is listed in `rejectedCodes` beside `data` ([Write offers and codes](write-offers.md#applying-a-code-to-an-order)). |
| `note`, `deliveryNote` | Optional, up to 1,000 characters.                                                                                                                                                                                             |

Anything else is refused, on purpose: an order is created `pending` (confirm
it with the route below), priced from the catalogue and the business's
delivery prices, never from your numbers, and carries no carrier, tracking,
payment or attribution of your choosing.

What happens is what happens to an order a merchant types in the dashboard:

- **The duplicate rule.** A second order for the same phone and the same
  items, within 24 hours and not yet dispatched, is folded into the first:
  **200** with that order, nothing created. If you cannot read that order,
  409 `ORDER_DUPLICATE`.
- **An abandoned checkout becomes the order.** When the buyer (same phone)
  left a checkout sharing a product, the order takes the checkout's id.
- **The business's distribution assigns it** to a team member, once.
- **The plan's allowance admits it**: past it, the order is created
  `waiting`, and your answer is masked.
- Its `source` is `app:<your handle>`, and `orders/created` is sent once.
- The storefront's anti-spam checks do not apply: your app is an
  authenticated member of the business, not a buyer's browser.

Answers: **201** for a new order (or a recovered checkout), **200** for an
existing one. With an `Idempotency-Key`, a retry replays the stored answer
and its status.

## Edit, confirm, cancel, schedule

```ts
const id = '741000000000000001';

await admin.patch('/orders/{id}', {
  path: { id },
  body: { buyer: { townOns: 1602 }, deliveryNote: null },
});

const { data: reasons } = await admin.get('/cancel-reasons');
const noAnswer = reasons.find((reason) => !reason.requireNote);

await admin.post('/orders/{id}/schedule', {
  path: { id },
  body: { scheduledFor: '2026-10-20T09:00:00Z' },
});

await admin.post('/orders/{id}/cancel', {
  path: { id },
  body: noAnswer
    ? { reasonId: noAnswer.id }
    : { note: 'Buyer cancelled by phone' },
});
```

- **`PATCH`** changes `buyer` (only the keys you send), `delivery` (`method`,
  `speed`), `note` and `deliveryNote` (`null` clears one). Not the status, the
  store or the items. A new commune, method or speed re-prices the delivery.
  A dispatched, delivered or returned order is 409 `ORDER_NOT_EDITABLE`. It
  sends `orders/updated`.
- **`confirm`** (no body) checks the buyer's details for a carrier: a missing
  phone, wilaya or commune is a 400 naming `missingFields`. An empty address
  is filled from the commune. Sends `orders/confirmed`. Refusals: 403
  `ORDER_LIMIT_REACHED` (a waiting order), 409 `ORDER_STATUS_CONFLICT` (its
  status does not allow it, already confirmed included).
- **`cancel`** takes an optional `reasonId` (from `GET /cancel-reasons`) and
  `note` (up to 500). An archived or unknown reason is 400
  `CANCEL_REASON_INVALID`; a reason that requires a note, without one, 400
  `CANCEL_NOTE_REQUIRED`. Sends `orders/cancelled`.
- **`schedule`** takes `scheduledFor`, in the future: the status becomes
  `scheduled`. An order already scheduled is 409 `ORDER_STATUS_CONFLICT`.
  Sends `orders/updated`.

Every answer is the order, read again (`fields` trims it).

## Comments

`GET /orders/{id}/comments` lists the team's notes on the order, newest
first; `POST` adds one from your app (`{ "body": "…" }`, 1 to 1,000
characters).

```json
{
  "id": "741000000000007002",
  "orderId": "741000000000000001",
  "byThisApp": true,
  "body": "Risk score 12/100",
  "createdAt": "2026-10-12T08:00:00.000Z",
  "updatedAt": "2026-10-12T08:00:00.000Z"
}
```

`byThisApp` marks your own comments; who else wrote one is not said. The team
often types phone numbers into comments, so another author's `body` follows
the notes rule: present only with `read_customer_contact`, and `null` while
the order is waiting. Your own comments always carry their body. Comments
send no webhook.

## Attribution

Every write is recorded in the activity log under your app's name, whatever
the token kind. An app's write never counts as a team member working the
order, and earns no commission.

## Errors these routes add

| Status | Code                                            | When                                            |
| ------ | ----------------------------------------------- | ----------------------------------------------- |
| 409    | `ORDER_NOT_EDITABLE`                            | The order is dispatched, delivered or returned. |
| 409    | `ORDER_STATUS_CONFLICT`                         | Its status does not allow the move.             |
| 409    | `ORDER_DUPLICATE`                               | A create folded into an order you cannot read.  |
| 403    | `ORDER_LIMIT_REACHED`                           | Confirming a waiting order.                     |
| 400    | `STORE_REQUIRED`                                | Several selected stores and no `storeId`.       |
| 400    | `CANCEL_REASON_INVALID`, `CANCEL_NOTE_REQUIRED` | The cancel reason rules.                        |
| 400    | `DELIVERY_SPEED_UNAVAILABLE`                    | Economy is not priced for that destination.     |

See [Errors](errors.md) for the codes every route shares.
