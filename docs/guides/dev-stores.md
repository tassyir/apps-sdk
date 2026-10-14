---
title: Dev stores
description: Build and test on businesses seeded with synthetic data, where nothing reaches a carrier, a buyer or a payment provider.
order: 150
---

# Dev stores

A dev store is a business you create from the developer console to build and
test apps on. It looks and works like a merchant's business, in the
dashboard and through the Admin API, with synthetic data. Nothing it does
reaches an outside party or costs money, and it needs no subscription.

You own it, so your custom apps install there like on any business you own.

## Create one

In the developer console, open **Dev stores** and create one, with a name and
seed data (the default) or empty.

| Limit                                         | Value                         |
| --------------------------------------------- | ----------------------------- |
| Dev stores per developer account              | 3, and they cannot be deleted |
| New orders a day (dashboard and API together) | 50, per Algiers day           |
| Stores in a dev store                         | 3                             |
| People in a dev store                         | 5 (invitations are refused)   |

## The seed data

- **30 products**, most with options (size, colour, shoe size, volume) and a
  variant per combination. The first 8 track stock (20 to 80 units each).
  No images and no collections.
- **64 buyers**, every one with a phone in the reserved block
  `+213 500 000 000` to `+213 500 000 999`, and no email. Together they cover
  all 58 wilayas.
- **200 orders** over the last 60 days, in every state: pending, incomplete,
  confirmed, scheduled, cancelled, dispatched, delivered, returned, and
  abandoned checkouts. Shipped orders ride a private courier.

Seeding sends no webhook: the data exists before your app is installed. To
see webhooks, change something after installing (create or confirm an order,
edit a product).

## What is switched off

In the dashboard, an action that would reach an outside party is refused
with **409 `DEV_STORE_RESTRICTED`**, naming the `action` it stopped and a
`fix`:

| `action`              | What it stops                                                                   |
| --------------------- | ------------------------------------------------------------------------------- |
| `carrier`             | Linking a carrier account, and dispatching to a carrier (use a private courier) |
| `integration`         | Connecting other platforms, spreadsheets, ad accounts and conversion tracking   |
| `whatsapp`            | Connecting a WhatsApp number                                                    |
| `email`               | Team invitations                                                                |
| `billing`             | Checkout, plan changes, refunds and credit purchases                            |
| `ai`                  | AI images and pages, product imports and scraping                               |
| `custom_domain`       | Adding a custom domain                                                          |
| `storefront_checkout` | Orders and checkouts from the storefront                                        |
| `cargo`               | Tassyir Cargo                                                                   |

Through the Admin API, the one refusal particular to dev stores is the daily
order cap: `POST /orders` answers **429 `DEV_STORE_ORDER_LIMIT_REACHED`**,
with `retryAfterSeconds` (until the next Algiers day).

The storefront says it is a development store, takes no orders, is hidden
from search engines and carries no tracking pixel.

**Still on:** webhooks to your app (that is the point), image uploads
(`POST /images`, within a tenth of the usual daily quota), and push
notifications to your own devices.

## The plan

A dev store has every plan feature, with the limits above. It
is never billed, has no order allowance (no order is ever `waiting`) and its
phones are never hidden for want of a subscription. To test what an app does
on a smaller plan, or with waiting orders and hidden phones, use a real
business on that plan.
