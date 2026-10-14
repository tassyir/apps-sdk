---
title: Customers and contact data
description: Read buyers and their delivery record, and handle buyers' names, phones and addresses with the read_customer_contact scope.
order: 120
---

# Customers and contact data

A customer is a buyer of the business, known by phone number and built from
their orders: they have no account. An app reads customers to see how each
buyer's orders went (a review app skips buyers who returned parcels, a
loyalty app rewards repeat buyers). Buyers' names, phones and addresses are
the most sensitive data a merchant holds, and they have a scope of their own.

| Route                                   | Scope                                       |
| --------------------------------------- | ------------------------------------------- |
| `GET /customers`, `GET /customers/{id}` | `read_customers` (it implies `read_orders`) |
| A buyer's name, phone and address       | `read_customer_contact`                     |

## The customer

```json
{
  "id": "741000000000001000",
  "provinceCode": 16,
  "townOns": 1601,
  "name": "Amina B.",
  "phone": "0555123456",
  "ordersCount": 5,
  "openCount": 1,
  "deliveredCount": 3,
  "returnedCount": 1,
  "canceledCount": 0,
  "currency": "DZD",
  "deliveredValue": "11700.75",
  "firstOrderAt": "2026-06-01T10:00:00.000Z",
  "lastOrderAt": "2026-10-11T07:00:00.000Z",
  "blocked": false,
  "createdAt": "2026-09-26T00:00:00.000Z",
  "updatedAt": "2026-10-11T07:00:20.000Z"
}
```

- **The delivery record is always there:** orders placed (exchanges,
  waiting, archived and abandoned ones left out), open, delivered, returned
  and cancelled; the value of delivered orders (`deliveredValue`, a decimal
  string); the first and last order; whether the merchant blocked the buyer.
- `provinceCode` and `townOns` (the wilaya and commune of their newest order
  that has one) are not contact data.
- **`name` and `phone` need `read_customer_contact`.** A buyer's second phone
  and address are on their orders (`buyer.phone2`, `buyer.address`), under the
  same scope.
- The merchant's private note about a buyer is never sent.
- A customer can be about 20 seconds behind their latest order.

`GET /customers` lists every buyer with at least one counted order, newest
first. `storeId` lists the buyers of one store, **with that store's
counters**. An installation limited to selected stores sees a buyer only
through orders in its stores, and reads those stores' counters summed, never
the whole business's. Search and segments are not offered: page the list,
and follow `customers/updated`.

## `read_customer_contact`

Without it, contact fields are **left out**: the keys are absent, not `null`,
so your app can tell "not granted" from "empty". It covers:

- an order's or checkout's `buyer.name`, `phone`, `phone2`, `email`,
  `address`, `address2`, and the order's `note` and `deliveryNote` (buyers
  type contact details into notes);
- another author's order comments;
- a customer's `name` and `phone`;
- the same fields in webhook bodies, and the customer picker's `name` and
  `phone` ([Embedded pages](embedded-pages.md#pickers)).

The scope is marked **sensitive** on the install screen, every Admin API
answer that carries contact fields is logged, and only a member who sees
every order can grant it. It needs `read_orders`.

Even with it:

- **when the merchant's plan hides phones** (no active subscription, or a
  billing grace that hides them), every phone reads `**********`;
- **a waiting order** (past the plan's order allowance) shows
  `**********` for its phones and `null` for its notes and other authors'
  comments, until it unlocks.

```ts
const { data: customer } = await admin.get('/customers/{id}', {
  path: { id: '741000000000001000' },
});
if (customer.phone === undefined) {
  console.log('no read_customer_contact: ask for it in a new version');
} else if (/^\*+$/.test(customer.phone)) {
  console.log('the phone is hidden right now');
}
```

## Handle buyer data with care

- Ask for `read_customer_contact` only if your app does something with the
  buyer's contact (sending a message, printing a label). Make it optional
  when only some merchants will want that feature.
- Store as little as you can, for as short as you can, and never in logs.
- Honour `customers/redact` and `customers/data_request`, and delete what you
  hold about a business on `business/redact`
  ([Compliance and uninstall](compliance-and-uninstall.md)).
