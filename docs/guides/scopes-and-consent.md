---
title: Scopes and consent
description: Choose the scopes your app asks for, and understand what a merchant consents to on install and on every new version.
order: 40
---

# Scopes and consent

A scope is a right your app asks a merchant for: `read_orders`,
`write_products`, `read_customer_contact`. The merchant sees every scope, with
your reason for it, before installing. Ask for the fewest scopes your app
needs: each one is something a merchant must trust you with, and adding one
later means asking every merchant again.

## The scopes

The "checks" column is the permission the API checks for each route the scope
opens. A refusal names it (`PERMISSION_DENIED`, with `permission` and a `fix`
naming the scope).

| Scope                   | Gives                                                                                                                       | Checks                                                                                                                 | Implies                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `read_orders`           | Every order of the business, and its tracking                                                                               | `orders:read`, `orders:read-all`, `ordersTracking:read`, `ordersTracking:read-all`                                     |                               |
| `write_orders`          | Create, edit, confirm, cancel and schedule orders, and comment on them                                                      | `orders:create`, `orders:update`, `orders:confirm`, `orders:cancel`, `orders:schedule`, `orders:add-comment`           | `read_orders`                 |
| `dispatch_orders`       | Hand orders to a real carrier and print labels (**danger**)                                                                 | `orders:dispatch`, `orders:generate-labels`                                                                            | `read_orders`                 |
| `read_returns`          | Returned orders                                                                                                             | `orders:read-returns`                                                                                                  |                               |
| `write_returns`         | Return orders and process returns                                                                                           | `orders:return-order`, `orders:process-returns`                                                                        | `read_returns`, `read_orders` |
| `read_products`         | Products, variants and collections                                                                                          | `products:read`, `categories:read`                                                                                     |                               |
| `write_products`        | Create and change products and collections, upload images                                                                   | `products:create`, `products:update`, `products:delete`, `categories:create`, `categories:update`, `categories:delete` | `read_products`               |
| `read_inventory`        | Stock levels                                                                                                                | `inventory:read`                                                                                                       |                               |
| `write_inventory`       | Correct stock counts                                                                                                        | `inventory:create`, `inventory:update`                                                                                 | `read_inventory`              |
| `read_costs`            | Buy prices (**sensitive**)                                                                                                  | `inventory:view-price`                                                                                                 | `read_inventory`              |
| `read_customers`        | Customers: order counts and delivery record, no contact fields                                                              | `customers:read`                                                                                                       | `read_orders`                 |
| `read_customer_contact` | Buyers' names, phones, email, address and order notes, on orders, customers and webhooks (**sensitive**, every read logged) | no permission: a field grant                                                                                           |                               |
| `read_offers`           | The merchant's pricing offers: their rules, dates and number of codes, never a code or a buyer                              | `offers:read`                                                                                                          |                               |
| `write_offers`          | Create, change, publish, pause and archive the offers the app owns, and their codes; read their redemptions                 | `offers:create`, `offers:update`, `offers:delete`                                                                      | `read_offers`                 |
| `read_analytics`        | Analytics                                                                                                                   | `analytics:read`                                                                                                       |                               |
| `read_finance`          | Finance (**sensitive**)                                                                                                     | `finance:read`                                                                                                         |                               |
| `read_stores`           | The business's stores                                                                                                       | `stores:read`                                                                                                          |                               |
| `read_delivery`         | Delivery agents and delivery prices, never carrier credentials                                                              | `delivery-agents:read`, `delivery-fees:read`                                                                           |                               |
| `write_storefront`      | Storefront blocks: refused until they open                                                                                  | no permission                                                                                                          |                               |

- **Implied scopes come with the scope.** `write_orders` brings
  `read_orders`; `read_customers` brings `read_orders`; `write_offers` brings
  `read_offers`. The install screen
  shows the whole set, implied scopes included, and a token's `scope` lists it.
- **`read_customer_contact` opens nothing alone.** It needs `read_orders`:
  among the required scopes when it is required, among all requested scopes
  when it is optional. Without it, contact fields are left out of every answer
  and webhook (the keys are absent, not `null`). See
  [Customers and contact data](customers.md).
- **Some scopes have no API routes yet.** `dispatch_orders`, `read_returns`,
  `write_returns`, `read_analytics` and `read_finance` grant permissions that
  no route of API version `2026-10` uses yet. Do not ask for them before you
  need them.
- **Never grantable to an app:** the team and its roles, the business's
  settings and billing, domains, integrations, WhatsApp, and publishing the
  store.

## What an app may do: scopes, stores, plan

What a call may do is the intersection of:

1. **The installation's scopes**, those the merchant granted (required, plus
   the optional ones they ticked), with the scopes they imply.
2. **For an online token, the person's own permissions.** An online token acts
   for one dashboard user, so it can never do more than that person could
   ([Tokens](tokens.md#online-tokens-acting-for-a-person)).
3. **The installation's stores.** The merchant gives an app every store of the
   business or selected ones. A store outside them answers HTTP **460**
   `STORE_SCOPE_FORBIDDEN` when your request names it, and a resource of
   another store reads as `404 NOT_FOUND`.
4. **The merchant's plan.** No plan is needed to install an app or call the
   API, but a plan limit refuses an app as it refuses the merchant, with the
   same code (`PLAN_FEATURE_REQUIRED`, `ORDER_LIMIT_REACHED`,
   `SUBSCRIPTION_REQUIRED`).

## The install screen

When a merchant installs your app, the dashboard shows:

- your app's name, the developer's name, website and support email (set when
  you turn on developer mode), and the host of your pages ("by
  reviews.example.com");
- each required scope, with your reason from `access.scope_reasons`, and the
  scopes it implies; sensitive and danger scopes are marked;
- each optional scope, unticked, with its reason;
- **every host your app's data can reach**: `hosting.url`, any absolute
  webhook `uri` and `auth.callback_url`;
- the stores to give the app: all, or selected ones.

Write each reason for the merchant, in one sentence that says what your app
does with the access ("Send the review request to the buyer's phone").

**Who may install.** A member who may manage the business's apps, and only
with scopes whose permissions that member holds: a member cannot open data to
an app that they cannot see themselves. The owner may grant everything.
`read_customer_contact` needs someone who sees every order.

**Where a custom app installs.** On a business whose owner is the app's
developer (your own businesses and [dev stores](dev-stores.md)), and on the
one other business you name for the app in the console. Anywhere else, the
install screen says the app is not available.

After the install, the dashboard opens your page if the app has one
(`admin.page`). A headless app with an `auth.callback_url` receives an install
code there instead ([Tokens](tokens.md#headless-apps-the-install-code)).
Your app receives `app/installed` if it subscribes to it.

## New versions and updates

An installation is **pinned** to the version its merchant accepted. When you
upload a new version, each installation is offered an update in the dashboard
(**Apps**, **Installed apps**), and stays where it is until a member accepts
it.

- **No consent screen** when the version asks for nothing new: a plain
  confirm.
- **A consent screen** when it adds a scope the installation would hold, or a
  host your data would reach (a new `hosting.url` included). Scopes it drops
  are listed too, and optional scopes new in this version are offered
  unticked.
- **When the granted scopes change, every token of the installation is
  revoked.** Your app receives `app/scopes_updated` (if subscribed). The next
  page view exchanges a new ID token for a token with the new scopes; a
  headless app receives a new install code at its `auth.callback_url`.
- **When only the version changes**, tokens are kept, and the new version's
  webhook topics and addresses apply from the next delivery.

Changing which optional scopes are granted, on the same version, follows the
same rules.

So a version that adds a scope works only on installations that accepted it.
Read the installation's granted scopes from the token response (`scope`) or
from `app/installed` and `app/scopes_updated`, and keep working within them.

## Uninstall

A merchant can uninstall your app at any time. Every token is revoked at
once, and your app receives `app/uninstalled` (if subscribed). The data it
kept in Tassyir is deleted 48 hours later. See
[Compliance and uninstall](compliance-and-uninstall.md).
