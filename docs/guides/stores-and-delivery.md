---
title: Stores and delivery
description: Read a business's stores, the carriers it ships with and what it charges buyers for delivery to each wilaya.
order: 130
---

# Stores and delivery

A business has one or more stores (storefronts), and orders, products and
stock each carry a `storeId`. It ships through delivery agents (carrier
accounts or its own couriers) at the delivery prices it sets per wilaya. An
app reads all of these to name a store, quote a delivery price, or follow a
parcel. None of these routes writes, and no route ever reaches a carrier.

| Route                                                       | Scope           |
| ----------------------------------------------------------- | --------------- |
| `GET /stores`, `GET /stores/{id}`                           | `read_stores`   |
| `GET /delivery-agents`, `GET /delivery-agents/{id}`         | `read_delivery` |
| `GET /delivery-fee-groups`, `GET /delivery-fee-groups/{id}` | `read_delivery` |

## Stores

```json
{
  "id": "741000000000000100",
  "name": "Dar Amina",
  "description": "Handmade in Tlemcen",
  "logo": "https://cdn.tassyir.io/images/aa11/public",
  "status": "active",
  "language": "ar",
  "subdomain": "dar-amina",
  "delivery": {
    "feeGroupId": "741000000000003000",
    "deliveryAgentId": "741000000000004000",
    "speeds": "both",
    "defaultSpeed": "standard"
  },
  "createdAt": "2026-01-02T03:04:05.000Z",
  "updatedAt": "2026-10-11T09:12:44.120Z"
}
```

- `language` is the storefront's language as the merchant chose it, or
  `null` when they never chose.
- `subdomain` is the store's address on Tassyir's storefront domain. Custom
  domains are not here yet.
- `delivery.feeGroupId` is the delivery fee group that prices this store's
  checkout; `delivery.deliveryAgentId` the store's default carrier; `speeds`
  is `standard`, `economy` or `both`.
- An installation limited to selected stores lists only those; another store
  named by id is 460 `STORE_SCOPE_FORBIDDEN`.
- A store's ad and conversion-tracking settings and tokens are never sent.

## Delivery agents

An agent is one carrier account of the business, or a private courier (a
team member who delivers).

```json
{
  "id": "741000000000004000",
  "carrier": "Yalidine",
  "name": "Yalidine",
  "label": "Main account",
  "image": "https://cdn.tassyir.io/images/yalidine/public",
  "privateCourier": false,
  "status": "active",
  "deletedAt": null,
  "createdAt": "2026-03-01T08:00:00.000Z",
  "updatedAt": "2026-10-01T08:00:00.000Z"
}
```

- `name` is what the dashboard shows: the carrier, or a private courier's
  label or name. `image` is the carrier's logo.
- `deletedAt` is set once the merchant removed the agent. The list leaves
  removed agents out, but `GET /delivery-agents/{id}` still reads one, since
  orders keep naming it (`delivery.deliveryAgentId`).
- Agents have no store: every installation reads the business's agents.
- **Carrier credentials never leave Tassyir**: no route answers an account's
  keys, tokens, secrets, balance or settings.

## Delivery fee groups

A fee group is what the business charges a buyer for delivery, per wilaya and
method. A store prices its checkout with one group.

```json
{
  "id": "741000000000003000",
  "name": "Yalidine prices",
  "storeId": "741000000000000100",
  "deliveryAgentId": "741000000000004000",
  "isDefault": true,
  "chargeOverweight": false,
  "currency": "DZD",
  "fees": [
    {
      "provinceCode": 16,
      "deliverable": true,
      "stopdeskAvailable": true,
      "homeFee": "500.00",
      "stopdeskFee": "350.00",
      "economyHomeFee": null,
      "economyStopdeskFee": null
    }
  ]
}
```

- **`id` is opaque**: digits for most groups, a name-like string for older
  ones.
- `storeId` is `null` for a business-wide group. `deliveryAgentId` names the
  carrier whose prices it holds, if any. `chargeOverweight` adds the carrier's
  overweight surcharge to the buyer's price.
- `fees` has one entry per wilaya (`provinceCode` 1 to 58): the standard
  speed's `homeFee` and `stopdeskFee`, and the economy speed's (`null` when
  not offered), as decimal strings.
- `GET /delivery-fee-groups` lists every active group **without `fees`**, and
  is **not paged** (`{ "data": [...] }`, a business holds a handful). Read one
  group for its fees. Filter with `storeId` (that store's groups only, the
  business-wide ones left out).
- An installation limited to selected stores reads its stores' groups and the
  business-wide ones.

```ts
// The home-delivery price of a store's checkout for one wilaya.
export async function homeFee(storeId: string, provinceCode: number) {
  const { data: store } = await admin.get('/stores/{id}', {
    path: { id: storeId },
  });
  const groupId = store.delivery.feeGroupId;
  if (groupId === null) return null;
  const { data: group } = await admin.get('/delivery-fee-groups/{id}', {
    path: { id: groupId },
  });
  const fee = group.fees?.find((entry) => entry.provinceCode === provinceCode);
  return fee?.deliverable
    ? { amount: fee.homeFee, currency: group.currency }
    : null;
}
```
