---
title: Stock
description: Read the stock of the merchant's products, follow it with webhooks, and correct a count with a reason.
order: 110
---

# Stock

An app reads how many units of each variant the business holds (to sync
another channel, or warn before a product runs out) and corrects a count the
way a team member does on the dashboard's Stock page.

| Route                                | Does                | Scope             |
| ------------------------------------ | ------------------- | ----------------- |
| `GET /inventory-levels`              | List stock items    | `read_inventory`  |
| `GET /inventory-levels/{id}`         | Read one stock item | `read_inventory`  |
| `POST /inventory-levels/{id}/adjust` | Correct a count     | `write_inventory` |
| the unit cost in any answer          |                     | `read_costs`      |

Stock needs the merchant's plan to include it: a business with no usable
subscription answers 422 `SUBSCRIPTION_REQUIRED`, as the dashboard does.

## The stock item

One item is the stock of one variant across the business, with its levels at
each location:

```json
{
  "inventoryItemId": "741000000000000800",
  "variantId": "741000000000000501",
  "productId": "741000000000000500",
  "onHand": 12,
  "inTransit": 3,
  "damaged": 1,
  "low": false,
  "lowStockThreshold": 5,
  "locations": [
    {
      "locationId": "741000000000000901",
      "onHand": 8,
      "inTransit": 2,
      "damaged": 1
    },
    {
      "locationId": "741000000000000902",
      "onHand": 4,
      "inTransit": 1,
      "damaged": 0
    }
  ],
  "updatedAt": "2026-10-11T11:00:00.000Z",
  "currency": "DZD",
  "unitCost": "1234.50"
}
```

- Its id is `inventoryItemId` (there is no `id` field); `fields` always keeps
  it.
- `onHand` is the sellable units of every location. **It can be negative**
  after a dispatch shortfall (the business shipped more than it held), and is
  shown as it is. "Available" (on hand minus what confirmed orders will take)
  is not stored, so it is not here.
- `inTransit` and `damaged` are the item's other buckets; `low` is its
  low-stock flag, and `lowStockThreshold` the threshold the merchant set.
- `currency` and `unitCost` (the average cost of the units on hand, a decimal
  string, `null` when unknown) are present **only with `read_costs`**. Webhook
  bodies never carry them.
- Packs have no stock of their own, and packaging stock is not here.

## List and follow

`GET /inventory-levels` lists the items of every product your installation
may read, active or not, newest item first. Filters: `productId` (its
variants' items) and `storeId`.

There is no "changed since" filter: an item's levels can move without the
item changing (a transfer between locations). Subscribe to
`inventory_levels/updated` instead. It is sent once per item per change, with
`changed` empty: the body is the item's whole stock, so replace what you hold
with it.

```ts
for await (const item of admin.paginate('/inventory-levels', {
  query: { productId: '741000000000000500' },
})) {
  console.log(item.variantId, item.onHand, item.low ? '(low)' : '');
}
```

## Correct a count

`POST /inventory-levels/{id}/adjust` is the dashboard's **Adjust**: it moves
units and records why. It never records a purchase, a cost or a payment.

```ts
const { data: item } = await admin.post('/inventory-levels/{id}/adjust', {
  path: { id: '741000000000000800' },
  body: { delta: -2, reason: 'damaged', note: 'Torn in the warehouse' },
  idempotencyKey: 'count-2026-10-11-RK-01-M',
});
console.log(item.onHand, item.damaged);
```

| Field        | Rule                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `delta`      | Required. A whole number of units, not 0, from -1,000,000 to 1,000,000. Positive adds, negative removes.                                                      |
| `reason`     | Required. `received`, `correction`, `counted`, `damaged`, `theft_or_loss` or `promotion`. `damaged` must be negative: it moves units from on hand to damaged. |
| `note`       | Optional, up to 500 characters, kept with the stock history.                                                                                                  |
| `locationId` | Optional. The location to correct; the default location when absent. Needs a plan with full inventory: 403 `PLAN_FEATURE_REQUIRED` otherwise.                 |

- A count never goes below zero here: 409 `INSUFFICIENT_AT_LOCATION`, with
  the figures.
- A pack is 400 (it has no stock of its own); an unknown or inactive location
  is `LOCATION_NOT_FOUND`.
- **Send an `Idempotency-Key`**: a retry then answers the stored result and
  never moves the stock twice.
- The answer is the item read again. The adjustment is recorded in the stock
  history and the activity log under your app's name, and sends
  `inventory_levels/updated`, which your app hears like any other.

Receiving stock at a cost, transfers between locations, the low-stock
threshold, starting or stopping tracking, and the list of locations are not
in API version `2026-10`.
