---
title: The manifest
description: Describe your app in tassyir.app.toml, validate it with the API's own validator, and upload it as a version.
order: 30
---

# The manifest

Your app is described by one file, `tassyir.app.toml`: its name and handle,
the scopes it asks for and why, where it runs, its page in the dashboard, the
webhooks it receives and the values it keeps in Tassyir. You upload the file
as a **version**; merchants consent to a version, and their installation
stays on it until they accept a newer one.

## An example

An app on your own server with a page in the dashboard:

```toml
name        = "Review Requests"
handle      = "review-requests"
api_version = "2026-10"

[access]
scopes          = ["read_orders", "read_products"]
optional_scopes = ["read_customer_contact"]

[access.scope_reasons]
read_orders           = "Find delivered orders to ask for a review"
read_products         = "Show the product in the review request"
read_customer_contact = "Send the review request to the buyer's phone"

[hosting]
mode = "external"
url  = "https://reviews.example.com"

[admin]
page = "/"

[[webhooks]]
topics = ["orders/delivered", "app/uninstalled"]
uri    = "/webhooks"

[[webhooks]]
topics = ["customers/data_request", "customers/redact", "business/redact"]
uri    = "/webhooks/privacy"

[[data.definitions]]
owner      = "product"
key        = "rating"
type       = "json"
visibility = "app"
```

A headless app (no page) gets its first tokens from an install code sent to
its `auth.callback_url`, and may send a webhook to another host:

```toml
name        = "Sheets Sync"
handle      = "sheets-sync"
api_version = "2026-10"

[access]
scopes        = ["write_orders", "read_products"]
scope_reasons = { write_orders = "Create orders from the rows of your sheet", read_products = "Match sheet rows to your products" }

[hosting]
mode = "external"
url  = "https://sync.example.com/tassyir"

[auth]
callback_url = "https://sync.example.com/tassyir/callback"

[[webhooks]]
topics = ["orders/created", "products/updated"]
uri    = "/hooks"

[[webhooks]]
topics = ["customers/data_request", "customers/redact", "business/redact"]
uri    = "https://privacy.example.com/tassyir"
```

## Fields

| Field                      | Rule                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                     | Required. 1 to 50 characters on one line: no control, line-break or invisible characters (bidi controls, zero-width), no spaces around it. Arabic and English listing names are set in the console.                                                                                                                                                             |
| `handle`                   | Required. 3 to 40 lowercase letters and digits, in runs joined by single hyphens. Unique on Tassyir, never changes, and must equal the handle of the app in the console. Some names are reserved (`www`, `api`, `tassyir`, …).                                                                                                                                  |
| `api_version`              | Required. `2026-10`.                                                                                                                                                                                                                                                                                                                                            |
| `access.scopes`            | The scopes the app needs ([Scopes and consent](scopes-and-consent.md)). Each once.                                                                                                                                                                                                                                                                              |
| `access.optional_scopes`   | Scopes the merchant may tick. Never also in `scopes`, and never one a required scope already implies.                                                                                                                                                                                                                                                           |
| `access.scope_reasons`     | One sentence per requested scope, required and optional, shown on the install screen: 10 to 200 characters, the `name` text rules. No reason for a scope you do not request.                                                                                                                                                                                    |
| `hosting.mode`             | Required. `external`: the app runs on your server. `tassyir`: the app runs on [Tassyir Hosting](tassyir-hosting.md), whose uploads are refused until it opens.                                                                                                                                                                                                  |
| `hosting.url`              | Required for `external`. `https://host` or `https://host/path`, at most 512 characters: no port (443 only), no user or password, no query, fragment or trailing `/`. The host is a public lowercase hostname: no IP address, no private name (`localhost`, `.local`, `.test`, …), nothing on Tassyir's domains.                                                 |
| `hosting.allowed_hosts`    | Required for `tassyir` (an empty list when the code calls no other service), refused for `external`. At most 20 hosts the app's code calls, each once: a lowercase hostname of two labels or more, or `*.` + one for its subdomains. No scheme, port, path, IP address, private name or Tassyir domain: a hosted app calls Tassyir through `ctx.props.TASSYIR`. |
| `auth.callback_url`        | Optional, `external` only. Where a headless app receives its install code ([Tokens](tokens.md#headless-apps-the-install-code)). The `hosting.url` rules, but a trailing `/` is allowed.                                                                                                                                                                         |
| `admin.page`               | Optional. Your page in the dashboard: a path on `hosting.url` (on a hosted app, its own address), starting with `/` (not `//`), at most 256 characters, no query, fragment, backslash, space, `.` / `..` / empty segment or encoded slash; on a hosted app, never `/.tassyir` or below. Omit it for a headless app.                                             |
| `webhooks`                 | At most 10 entries, each `topics` (one or more) and `uri`. A topic is subscribed once in the whole manifest, and needs the scope that reads its resource ([Webhooks](webhooks.md#topics)). `uri` is a path on `hosting.url` (the `admin.page` rules), or for an external app an absolute https URL (the `hosting.url` rules).                                   |
| `data.definitions`         | At most 50 keys of [app data](app-data.md): `owner` (`business`, `store`, `product`, `order`, `customer`), `key` (`[a-z][a-z0-9_]{0,63}`, unique per owner), `type` (`string`, `number`, `integer`, `boolean`, `json`), `visibility` (`app`, `merchant`, `storefront`).                                                                                         |
| `data.definitions[].label` | Optional, `{ ar = "…", en = "…" }`: the name the dashboard shows next to a value. Not live yet, see [Marketplace fields](#marketplace-fields-not-live-yet).                                                                                                                                                                                                     |
| `storefront.blocks`        | Storefront blocks: see [Marketplace fields](#marketplace-fields-not-live-yet). Not live yet.                                                                                                                                                                                                                                                                    |
| `offers.types`             | Offer types a merchant can create from your app: see [Offer types](#offer-types). Needs `write_offers`.                                                                                                                                                                                                                                                         |
| `admin.actions`            | Menu entries in the dashboard: see [Marketplace fields](#marketplace-fields-not-live-yet). Not live yet.                                                                                                                                                                                                                                                        |
| `app_proxy`                | Part of the format, refused until the app proxy opens.                                                                                                                                                                                                                                                                                                          |

- **Every table is strict:** a key that is not a manifest field is an error,
  and the error's `fix` names the field you probably meant.
- **Size:** at most 64 KB once parsed into JSON. Lengths count UTF-16 code
  units.
- **Paths are joined to `hosting.url`**, its own path kept: with
  `url = "https://sync.example.com/tassyir"`, `uri = "/hooks"` is
  `https://sync.example.com/tassyir/hooks`. A hosted app's paths are joined
  to its own address, `https://{handle}.tassyir-apps.com`.
- **Every host your data reaches** (`hosting.url`, an absolute webhook `uri`,
  `auth.callback_url`) is shown to the merchant on the install screen.

## Offer types

An app that runs offers of its own ([Write offers and codes](write-offers.md))
can declare **kinds of offer** the merchant creates from your app, under "From
your apps" on the Offers page:

```toml
[[offers.types]]
handle      = "mix-match"
class       = "product"
path        = "/offers/mix-match"
label       = { ar = "اخلط واختر", en = "Mix and match" }
description = { ar = "القطعة الثالثة مجانًا", en = "The third piece free" }
```

At most 10 types, each with:

| Field         | Rule                                                                                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handle`      | Required. 1 to 40 lowercase letters, digits and hyphens, starting with a letter or digit. Once per manifest (`MANIFEST_OFFER_TYPE_HANDLE_DUPLICATE`)                                     |
| `class`       | Required. `product`, `order` or `delivery`: the step the offers of the type price in                                                                                                     |
| `path`        | Required. The page of your app that configures one offer of the type: a path on your origin (the `admin.page` rules, at most 200 characters; on a hosted app never `/.tassyir` or below) |
| `label`       | Required. `{ ar = "…", en = "…" }`, 1 to 50 characters each (the `name` text rules)                                                                                                      |
| `description` | Optional. `{ ar, en }`, 1 to 200 characters each                                                                                                                                         |

Declaring any type needs the `write_offers` scope, in `scopes` or in
`optional_scopes` (`MANIFEST_OFFER_TYPES_SCOPE_MISSING`). The type declares
what the merchant can pick; the rule that prices each offer is written through
the Admin API, with `kind = "app"` ([Your own offer
types](write-offers.md#your-own-offer-types)).

## Marketplace fields (not live yet)

These fields belong to the marketplace, which is **not live yet**. The
validator in `@tassyir/app-manifest` already checks them, so you can prepare
a manifest now, but the API refuses an upload that uses any of them until the
marketplace opens: the fields are unknown to it, or `write_storefront` is not
offered yet. This page will say when that changes.

```toml
name        = "Review Stars"
handle      = "review-stars"
api_version = "2026-10"

[access]
scopes = ["read_orders", "read_products", "write_storefront"]

[access.scope_reasons]
read_orders      = "Find delivered orders to ask for a review"
read_products    = "Show each product's rating"
write_storefront = "Add the rating block to your product pages"

[hosting]
mode = "external"
url  = "https://stars.example.com"

[admin]
page = "/"

[[admin.actions]]
handle = "ask-for-reviews"
target = "orders.selection"
label  = { ar = "اطلب التقييمات", en = "Ask for reviews" }
path   = "/actions/ask"

[[data.definitions]]
owner      = "product"
key        = "rating"
type       = "json"
visibility = "storefront"
label      = { ar = "التقييم", en = "Rating" }

[[storefront.blocks]]
handle     = "product-rating"
template   = "blocks/product-rating.liquid"
stylesheet = "blocks/product-rating.css"
name       = { ar = "تقييم المنتج", en = "Product rating" }
target     = "product"
data       = ["product.rating"]

  [[storefront.blocks.settings]]
  key     = "show_count"
  type    = "boolean"
  label   = { ar = "عرض عدد التقييمات", en = "Show the number of ratings" }
  default = true

  [[storefront.blocks.settings]]
  key     = "heading"
  type    = "string"
  label   = { ar = "العنوان", en = "Heading" }
  default = { ar = "آراء الزبائن", en = "What buyers say" }
```

### Labels

Text a merchant reads in the dashboard or the store builder is a table with
both languages, `{ ar = "…", en = "…" }`: a block's `name`, a setting's and an
option's `label`, an admin action's `label` and a data definition's `label`.
Each language follows the `name` rules (1 to 50 characters on one line, no
invisible character, no spaces around it), and no other key is accepted.

### Storefront blocks

A block is a template that Tassyir renders on the store's pages, where the
merchant places it from the store builder. It runs no JavaScript: a block
holds no script, and any key that would add code (`script`, `html`, `src`,
`on…`) is refused. Blocks need the `write_storefront` scope, at most 20 a
version.

| Field        | Rule                                                                                                                                                                                                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handle`     | Required. The `handle` rules; unique among the app's blocks.                                                                                                                                                                                                                            |
| `template`   | Required. A `.liquid` file of the app's files: a relative path of lowercase letters, digits, `_` and `-`, at most 200 characters.                                                                                                                                                       |
| `stylesheet` | Optional. A `.css` file, the same path rules.                                                                                                                                                                                                                                           |
| `name`       | Optional label: how the block is listed in the store builder. Write it: the review asks for one.                                                                                                                                                                                        |
| `target`     | `product` (the product page; the template can read the page's product) or `any` (any page but the order form's, without a product). Default `any`.                                                                                                                                      |
| `data`       | At most 20 app data keys the template reads, each once, as `<owner>.<key>`: declared in `[[data.definitions]]` with `visibility = "storefront"`, the owner `business`, `store` or `product`. Order and customer data never reach a store page. Product data needs `target = "product"`. |
| `settings`   | At most 20 `[[storefront.blocks.settings]]`: what the merchant sets for the block.                                                                                                                                                                                                      |

### Block settings

The template reads a setting as `block.settings.<key>`. The store builder
draws the form from the declaration and checks every value against it.

| Field        | Rule                                                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `key`        | Required. 1 to 40 lowercase letters, digits and underscores, starting with a letter; unique in the block.                              |
| `type`       | Required. `string`, `text`, `boolean`, `integer`, `number`, `select`, `color`, `image`, `url`, `product` or `collection`.              |
| `label`      | Required label: the field's name in the store builder.                                                                                 |
| `default`    | Optional, a value of the type (below).                                                                                                 |
| `options`    | `select` only, and required there: 2 to 20 `{ value, label }`. A `value` is 1 to 40 lowercase letters, digits, `_` and `-`, each once. |
| `min`, `max` | `integer` and `number` only: the range, `min` at most `max`; whole numbers for an `integer`.                                           |
| `max_length` | `string` and `text` only: 1 to 1,000 characters (1,000 when absent).                                                                   |

| Type                             | `default`                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `string`                         | One line of text, or `{ ar = "…", en = "…" }` for each language, within `max_length`.          |
| `text`                           | The same, line breaks allowed.                                                                 |
| `boolean`                        | `true` or `false`.                                                                             |
| `integer`, `number`              | A whole number (`integer`) or a number, within `min` and `max`.                                |
| `select`                         | The `value` of one of its options.                                                             |
| `color`                          | `"#rrggbb"`.                                                                                   |
| `url`                            | An `https://` link or a path of the store starting with `/`, at most 512 characters, no space. |
| `image`, `product`, `collection` | None: the merchant picks one from their own store.                                             |

```toml
[[storefront.blocks.settings]]
key     = "layout"
type    = "select"
label   = { ar = "الشكل", en = "Layout" }
default = "grid"
options = [
  { value = "grid", label = { ar = "شبكة", en = "Grid" } },
  { value = "list", label = { ar = "قائمة", en = "List" } },
]
```

### Admin actions

`[[admin.actions]]` adds a menu entry on an order, product or customer page,
or on a selection in the orders or products list. Choosing it opens one of
the app's pages in the dashboard's app window, with the ids added to its
address (`?id=` or `?ids=`, at most 50): read them again through the Admin
API, where your scopes and the installation's stores apply. At most 10.

| Field    | Rule                                                                                                                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handle` | Required. The `handle` rules; unique among the app's actions.                                                                                                                                              |
| `target` | Required. `order.details`, `orders.selection`, `product.details`, `products.selection` or `customer.details`. It needs the read scope of its resource: `read_orders`, `read_products` or `read_customers`. |
| `label`  | Required label: the menu entry.                                                                                                                                                                            |
| `path`   | Required. The page it opens: the `admin.page` rules.                                                                                                                                                       |

An app with actions does not need `admin.page`.

### The app proxy

`[app_proxy]` names the path on your app where Tassyir forwards requests made
to the store's own address, `https://{store}/apps/{handle}/…`. It needs the
`write_storefront` scope, and its `path` follows the `admin.page` rules. It is
part of the format but refused until the app proxy opens
(`MANIFEST_PROXY_NOT_AVAILABLE`), even by the validator.

```toml
[app_proxy]
path = "/proxy"
```

## Validate before you upload

`@tassyir/app-manifest` is the validator the Tassyir API runs on every upload,
so a manifest it accepts is one the API accepts, with the same errors in the
same order. Parse the TOML with any TOML 1.0 parser, then validate:

```ts
import { readFileSync } from 'node:fs';
import { parse } from 'smol-toml';
import { validateManifest } from '@tassyir/app-manifest';

const result = validateManifest(
  parse(readFileSync('tassyir.app.toml', 'utf8')),
);

if (!result.ok) {
  for (const error of result.errors) {
    console.error(
      `${error.code} at ${error.path || '(document)'}: ${error.fix}`,
    );
  }
  process.exit(1);
}

console.log(result.manifest.access.scopes); // in catalogue order
```

A project made with `create-tassyir-app` runs this as `npm run validate`
(`-- --json` for tools).

It returns every error at once, never throws, and reads no file, clock or
network. Each error has:

| Field     | Meaning                                                                          |
| --------- | -------------------------------------------------------------------------------- |
| `code`    | Stable: `MANIFEST_TOPIC_SCOPE_MISSING`, `MANIFEST_URL_INVALID`, … Never renamed. |
| `path`    | The field in the file: `webhooks[0].topics[1]`, `""` for the whole document.     |
| `message` | What is wrong, quoting at most 60 characters of your input.                      |
| `fix`     | One sentence saying what to change.                                              |

```json
{
  "code": "MANIFEST_TOPIC_SCOPE_MISSING",
  "path": "webhooks[0].topics[1]",
  "message": "\"products/updated\" carries data that needs the \"read_products\" scope, which the manifest does not request.",
  "fix": "Add \"read_products\" to `access.scopes` (or `access.optional_scopes`), or remove \"products/updated\"."
}
```

The same document always gives the same errors in the same order, whatever
the order of its keys: one per field, at most 50, then
`MANIFEST_TOO_MANY_ERRORS`. The package README lists every
[error code](https://github.com/tassyir/apps-sdk/tree/main/packages/app-manifest#what-you-get-back).

To check one field as it is typed (a handle in a form, say), use
`validateManifestField('handle', value)`.

### In your editor

The JSON Schema of the manifest ships with the package. In an editor that
reads schema directives (Taplo, Even Better TOML), start the file with:

```toml
#:schema ./node_modules/@tassyir/app-manifest/schemas/manifest.2026-10.schema.json
```

The schema states the shape; the validator also checks the rules across
fields and the exact URL and hostname rules, so a file the schema accepts can
still be refused.

## Upload a version

In the developer console, open your app's **Versions** tab and upload the
file. The console sends the parsed manifest to the API, which validates it
again and:

- refuses it with every validator error (`APP_MANIFEST_INVALID`, each error in
  the shape above);
- refuses a `handle` other than the app's (`APP_MANIFEST_HANDLE_MISMATCH`), a
  manifest identical to the latest version (`APP_VERSION_UNCHANGED`), and
  `hosting.mode = "tassyir"` while hosting is closed
  (`APP_HOSTING_NOT_AVAILABLE`);
- otherwise numbers it (`1`, `2`, …) and makes it current at once. Custom
  apps are not reviewed: they install only on your own businesses and the one
  business you name.

Limits per developer account: 50 apps (apps are never deleted), 30 version
uploads an hour, and an upload of at most 128 KB.

A hosted version also carries its code: `tassyir deploy` builds it, checks
it and uploads both, then follows the scan every hosted version goes through
([Tassyir Hosting](tassyir-hosting.md#deploy-with-the-cli)).

**Installations do not move by themselves.** A new version is offered to each
installation as an update, and applies only when a member of that business
accepts it. A version that adds a scope or a new host asks for consent again.
See [Scopes and consent](scopes-and-consent.md#new-versions-and-updates).

## Versions of the format

The manifest's shape belongs to an API version. Within a version, only new
optional fields can be added; a release of `@tassyir/app-manifest` ships them,
and an older release refuses them until you update it.
