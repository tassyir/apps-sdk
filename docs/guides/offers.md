---
title: Offers
description: Read the merchant's pricing offers with read_offers, follow them with the offers/* webhooks, and handle new kinds, store limits and codes you cannot see.
order: 125
---

# Offers

An offer is a price rule a merchant sets on one of their stores: "buy 2 and
save 900", free delivery over a threshold, a percentage off a product. It
applies by itself, or when the buyer types one of its codes. An app reads the
merchant's offers (a reports app that lines orders up with the offer that
priced them, an ads app that shows the live deal in a campaign, an assistant
that explains why a cart total is lower) and follows them with webhooks.

In API version `2026-10` offers are **read-only**: an app cannot create or
change an offer or its codes, and cannot apply an offer to an order.

| Route                              | Does                | Scope         |
| ---------------------------------- | ------------------- | ------------- |
| `GET /offers`                      | List offers         | `read_offers` |
| `GET /offers/{id}`                 | Read one offer      | `read_offers` |
| `offers/created`, `offers/updated` | Webhooks (an offer) | `read_offers` |
| `offers/deleted`                   | Webhook (an id)     | `read_offers` |

Reading offers needs no particular plan of the merchant (the plan limits how
many offers can be live, not who can read them). `read_offers` is a normal
scope and implies no other. Like any scope added after an app was installed,
an installation does not hold it until the merchant accepts a version of your
app that asks for it ([Scopes and consent](scopes-and-consent.md)). A call
without it answers 403 `PERMISSION_DENIED`, with a `fix` that names the scope.

## The offer

```json
{
  "id": "741000000000002000",
  "storeId": "741000000000000100",
  "kind": "quantity",
  "method": "automatic",
  "title": "Buy 2, save 900",
  "label": { "ar": "عرض الكمية", "fr": null, "en": null },
  "status": "active",
  "currency": "DZD",
  "quantity": {
    "priceMode": "total",
    "tiers": [
      {
        "pieces": 2,
        "label": { "ar": "قطعتان", "fr": null, "en": null },
        "total": "8900.00",
        "percentOff": null,
        "amountOffEach": null,
        "preselected": true,
        "freeDelivery": false
      }
    ]
  },
  "freeDelivery": null,
  "productDiscount": null,
  "combinesWith": { "product": false, "order": true, "delivery": true },
  "eligibility": {
    "audience": "everyone",
    "channels": [],
    "wilayas": [],
    "deliveryMethods": []
  },
  "targets": [{ "role": "buy", "type": "product", "id": "741000000000000500" }],
  "codeCount": 0,
  "totalUsageLimit": null,
  "perBuyerLimit": 1,
  "startsAt": "2026-10-01T00:00:00.000Z",
  "endsAt": null,
  "publishedAt": "2026-10-01T00:00:00.000Z",
  "pausedAt": null,
  "archivedAt": null,
  "appOwned": false,
  "createdAt": "2026-09-30T10:00:00.000Z",
  "updatedAt": "2026-10-02T10:00:00.000Z"
}
```

- **`method`** is `automatic` (applies by itself) or `code` (the buyer types one
  of the offer's codes).
- **`status`** is `draft` (never published), `scheduled` (starts later),
  `active`, `paused` or `ended` (past `endsAt`, or archived). It is worked out
  when the body is built, so a webhook body that is minutes old can be out of
  date: read the offer again when it matters.
- **`label`** is what the buyer reads, per language (`ar`, `fr`, `en`; a
  language the merchant did not fill is `null`). `title` is the merchant's own
  name for the offer.
- **`targets`** holds `{ role, type, id }` entries: `role` `buy` is what the
  offer applies to, and `type` is `all` (then `id` is `null`), `product`,
  `variant` or `collection`. Read a collection's products with
  `GET /products?collectionId=`
  ([Products and collections](products-and-collections.md)).
- **`combinesWith`** says whether the offer may stack with other product,
  order and delivery offers.
- **`eligibility`** limits who and where: `audience` is `everyone`,
  `first_order` or `returning`; `channels` are among `store`, `landing`,
  `shopify`, `dashboard` and `apps`, and `wilayas` and `deliveryMethods`
  (`home`, `desk`) narrow it further. **An empty list means no limit.**
- **`totalUsageLimit`** and **`perBuyerLimit`** are the limits the merchant
  set (`null` = none).
- **`appOwned`** is true for an offer that belongs to an installed app. Which
  installation is never shown.
- Money is a decimal string next to `currency` (`DZD`). Timestamps are ISO 8601
  in UTC.

## The kinds

`kind` says which one of three fields holds the rule. The other two are
`null`:

| `kind`             | Field             | Reads                                                                                                                                                                                                                                                                                   |
| ------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quantity`         | `quantity`        | `priceMode` `total` (each tier's `total` is the whole price of `pieces` pieces), `percent` (`percentOff` off each piece) or `amount_each` (`amountOffEach` off each piece). Tiers go up by `pieces`; at most one is `preselected`; a tier's `freeDelivery` waives delivery at that tier |
| `free_delivery`    | `freeDelivery`    | The threshold: `thresholdKind` `pieces` (`thresholdPieces`) or `amount` (`thresholdAmount`), `null` while a draft has none; `delivery` `home`, `desk` or `both`; `wilayas` as two-digit codes, empty = every wilaya                                                                     |
| `product_discount` | `productDiscount` | `valueType` `percent` (`percent`, with `maxAmount` capping the saving per unit) or `fixed` (`amount` off each unit); `showCountdown` counts down to `endsAt`                                                                                                                            |

**`kind` can grow.** More kinds exist in the model (`order_discount`, `bxgy`,
`addon`, `app`) and Tassyir adds kinds, and values to the other open fields
(`priceMode`, `valueType`, `audience`, a target's `type`), inside API version
`2026-10`. Write code that **ignores an offer of a kind it does not know**
(all three rule fields are `null` for it) instead of failing, and treat every
field you do not know the same way:

```ts
import type { Offer } from '@tassyir/app';

/** One line for a campaign, or null for a kind this code does not know. */
export function describe(offer: Offer): string | null {
  switch (offer.kind) {
    case 'quantity': {
      const tier = offer.quantity?.tiers.find((t) => t.preselected);
      return tier ? `${String(tier.pieces)} pieces` : null;
    }
    case 'free_delivery':
      return 'Free delivery';
    case 'product_discount':
      return offer.productDiscount?.percent
        ? `${String(offer.productDiscount.percent)}% off`
        : null;
    default:
      // A kind added later.
      return null;
  }
}
```

## Codes and usage

**Codes are not exposed.** `codeCount` is the number of codes that can still
be used, and that is all an app learns about them. Neither is a redemption:
**no buyer, phone or order is ever sent**, and using an offer at checkout
sends no event. To know which orders an offer priced you need the orders
themselves ([Orders](orders.md)), under their own scope.

## List and read

`GET /offers` lists the offers newest first, **drafts and ended offers
included**, in pages
([Admin API conventions](admin-api.md#one-resource-and-lists)). Filters:

| Parameter | Rule                                                                                                  |
| --------- | ----------------------------------------------------------------------------------------------------- |
| `status`  | One of `draft`, `scheduled`, `active`, `paused`, `ended`. Omitted: all of them                        |
| `kind`    | `quantity`, `free_delivery`, `product_discount`, `order_discount`, `bxgy`, `addon` or `app`           |
| `method`  | `automatic` or `code`                                                                                 |
| `storeId` | Only the offers of this store. A store outside the installation's is HTTP 460 `STORE_SCOPE_FORBIDDEN` |

A cursor belongs to the filters it was made with: use the same four on every
page, or `INVALID_CURSOR` answers 400. `GET /offers/{id}` answers one offer;
an id that does not exist, is malformed, or belongs to a store outside the
installation's is 404 `NOT_FOUND`.

```ts
for await (const offer of admin.paginate('/offers', {
  query: { status: 'active', method: 'automatic' },
})) {
  console.log(offer.storeId, offer.title, `${offer.kind}`);
}

const { data: offer } = await admin.get('/offers/{id}', {
  path: { id: '741000000000002000' },
});
console.log(offer.status, offer.endsAt);
```

## Stores

An offer belongs to exactly **one store**. An installation limited to
selected stores reads the offers of those stores only, and the offers of any
other store read as 404. Its webhooks follow the same rule: **every offer
event carries the offer's store**, so a store-limited installation hears the
events of its own stores and no others. An installation with every store
hears them all.

## Webhooks

Subscribe to the topics in the manifest, with the scope that reads them
([Webhooks](webhooks.md)):

```toml
[[webhooks]]
topics = ["offers/created", "offers/updated", "offers/deleted"]
uri    = "/webhooks"
```

- `offers/created` is sent when an offer is created, with `data.offer` (the
  offer above). **A new offer is always a draft**: you hear `offers/updated`,
  with `changed` naming `status` and `publishedAt`, when it goes live.
- `offers/updated` is sent when the offer reads differently: publishing,
  pausing, archiving, its dates, its rules, its targets or its codes.
  `changed` names the top-level fields that differ (`status`, `pausedAt`,
  `endsAt`, `quantity`, `targets`, `codeCount`, …), and `data.offer` is the
  offer as it is now. A change that alters nothing an app can read sends
  nothing.
- `offers/deleted` is sent when an offer is deleted, with
  `data.offer = { "id": … }` and nothing else. Only an offer that was
  **never redeemed** can be deleted: a redeemed one is archived, which is
  `offers/updated` with `status: "ended"` and `archivedAt` set.

Deliveries are at least once and unordered: deduplicate on `webhook-id`, and
when two bodies of one offer arrive out of order, keep the one with the later
`updatedAt`.

```ts
import type { WebhookEvent } from '@tassyir/app';

/** Keeps a local copy of the merchant's offers. */
export async function onOfferEvent(
  event: WebhookEvent,
  store: {
    save(id: string, offer: object): Promise<void>;
    remove(id: string): Promise<void>;
  },
): Promise<void> {
  switch (event.type) {
    case 'offers/created':
    case 'offers/updated': {
      const { offer } = event.data;
      // Keep the body even for a kind you do not understand: it is the truth.
      await store.save(offer.id, offer);
      break;
    }
    case 'offers/deleted':
      await store.remove(event.data.offer.id);
      break;
    default:
      break;
  }
}
```

## What is not here yet

This version reads offers. These come later, under their own scopes, and this
guide will grow a section for each:

- **Writing offers and codes**: creating and changing offers, their codes
  (including codes in bulk) and a list of redemptions, with a `write_offers`
  scope that will imply `read_offers`.
- **The money on orders**: an order's subtotal, total discount and the offers
  that priced each line.
- **Offers that belong to an app**, and an app that prices a cart itself.
