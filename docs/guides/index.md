---
title: Build apps for Tassyir
description: What a Tassyir app is, the parts of the app contract, and where each guide fits.
order: 10
---

# Build apps for Tassyir

[Tassyir](https://tassyir.io) is the back office of e-commerce merchants in
Algeria: orders (mostly cash on delivery), products and stock, delivery
carriers, customers, and several stores per business. An app adds to it. A
merchant installs your app on a business, and the app then reads and changes
that business's data, receives its events, and can show its own pages inside
the dashboard.

## What an app is

**An installed app is a team member of the business.** It acts with exactly
the scopes the merchant granted, only in the stores the merchant gave it, and
under the merchant's plan: a plan limit refuses an app the way it refuses the
merchant. The changes an app makes to orders, the catalogue and stock are
written to the business's activity log under the app's name.

An app runs on **your own server** today (`hosting.mode = "external"` in the
manifest). [Tassyir Hosting](tassyir-hosting.md), where an app runs on
Tassyir with no server to manage, opens later; an app moves there with the
same manifest, API and webhooks.

Apps are **custom apps** for now: one installs on the businesses its
developer owns, and on one other business the developer names. A public
catalogue of apps comes later.

## The parts

| Part                     | What it is                                                                                  | Guide                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Manifest                 | `tassyir.app.toml`: what the app is, the scopes it asks for, its address, page and webhooks | [The manifest](manifest.md)                             |
| Scopes and consent       | What a merchant grants on install, and how a new version asks again                         | [Scopes and consent](scopes-and-consent.md)             |
| Tokens                   | ID tokens, offline and online access tokens, refresh tokens, install codes                  | [Tokens](tokens.md)                                     |
| Embedded pages           | Your page inside the dashboard, talking to it through App Bridge                            | [Embedded pages and App Bridge](embedded-pages.md)      |
| Webhooks                 | Signed deliveries of the business's events                                                  | [Webhooks](webhooks.md)                                 |
| Admin API                | The versioned REST API an app calls                                                         | [Admin API conventions](admin-api.md)                   |
| Orders                   | Read, create, edit, confirm, cancel and comment on orders                                   | [Orders](orders.md)                                     |
| Products and collections | The catalogue, its images and collections                                                   | [Products and collections](products-and-collections.md) |
| Stock                    | Stock levels, and correcting a count                                                        | [Stock](stock.md)                                       |
| Customers                | Buyers and their delivery record, and the contact data scope                                | [Customers and contact data](customers.md)              |
| Stores and delivery      | A business's stores, carriers and delivery prices                                           | [Stores and delivery](stores-and-delivery.md)           |
| App data                 | Values your app keeps in Tassyir, next to the merchant's resources                          | [App data](app-data.md)                                 |
| Dev stores               | Test businesses with synthetic data, where nothing reaches the outside world                | [Dev stores](dev-stores.md)                             |
| Tassyir Hosting          | Running the app on Tassyir: deploying, the scan, what each request receives                 | [Tassyir Hosting](tassyir-hosting.md)                   |
| Compliance and uninstall | What happens when a merchant uninstalls, and the buyer data requests an app must honour     | [Compliance and uninstall](compliance-and-uninstall.md) |
| Errors                   | Every error code, and what to do about the common ones                                      | [Errors](errors.md)                                     |

Start with [Getting started](getting-started.md): it creates an app, runs it
on your machine and installs it on a dev store.

## The packages

| Package                                                                                           | Use it for                                                                               |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [`create-tassyir-app`](https://github.com/tassyir/apps-sdk/tree/main/packages/create-tassyir-app) | `npm create tassyir-app`: a working app to start from                                    |
| [`@tassyir/app`](https://github.com/tassyir/apps-sdk/tree/main/packages/app)                      | Your server: tokens, ID-token and webhook verification, the typed Admin API client       |
| [`@tassyir/app-bridge`](https://github.com/tassyir/apps-sdk/tree/main/packages/app-bridge)        | Your page in the dashboard: ID tokens, toasts, modals, the save bar, navigation, pickers |
| [`@tassyir/app-manifest`](https://github.com/tassyir/apps-sdk/tree/main/packages/app-manifest)    | Validating `tassyir.app.toml` with the same code the Tassyir API runs                    |
| [`tassyir`](https://github.com/tassyir/apps-sdk/tree/main/packages/cli)                           | The command line: sign in, create apps, validate and deploy, follow a hosted version     |

## Addresses

| What                       | Where                                                                         |
| -------------------------- | ----------------------------------------------------------------------------- |
| Admin API                  | `https://api.tassyir.io/apps/2026-10/`                                        |
| Token endpoint             | `POST https://api.tassyir.io/apps/oauth/token`                                |
| ID-token public keys       | `GET https://api.tassyir.io/apps/.well-known/jwks.json`                       |
| Webhook public keys        | `GET https://api.tassyir.io/apps/webhook-keys`                                |
| Your page in the dashboard | `https://app.tassyir.io/{locale}/dashboard/{businessId}/apps/{handle}/{path}` |
| Developer console          | `https://app.tassyir.io/en/developers`                                        |

## Rules every app follows

- **The ID token is the only proof of who is looking.** Your page's address
  says nothing Tassyir vouches for. Verify an ID token on your server
  ([Tokens](tokens.md)).
- **Money is a decimal string** (`"2500.00"`) next to a `currency`. Never turn
  it into a JavaScript number ([Admin API conventions](admin-api.md)).
- **Act on an error's `code`, and read its `fix`.** Every refusal has a stable
  code and one sentence that says what to do ([Errors](errors.md)).
- **Webhooks arrive at least once, in any order.** Verify each one on its raw
  body, and skip a `webhook-id` you already handled ([Webhooks](webhooks.md)).
- **Ask for the fewest scopes.** A merchant sees every scope, and a new one
  needs their consent again ([Scopes and consent](scopes-and-consent.md)).
- **Never put a secret in a page, a URL, a log or a repository.** Client
  secrets and tokens live on your server.

## About the code in these guides

The code is TypeScript on the published packages, and a check compiles every
sample against them. Server code runs on Node 22.18 or later and on
Workers-like runtimes; page code runs in the browser. To keep samples short,
some use names set up once elsewhere:

| Name             | What it is                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| `tassyir`        | Your server's `TassyirApp`, from `createTassyirApp` ([Tokens](tokens.md))                             |
| `admin`          | An Admin API client for one installation, `tassyir.admin(installationId)` ([Admin API](admin-api.md)) |
| `installationId` | The installation your code is working for                                                             |
| `bridge`         | Your page's App Bridge, from `createAppBridge()` ([Embedded pages](embedded-pages.md))                |

Every API version is dated. These guides describe version `2026-10`.
