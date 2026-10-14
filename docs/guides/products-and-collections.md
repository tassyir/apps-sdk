---
title: Products and collections
description: Read and change the merchant's catalogue, bring images onto the Tassyir CDN, and organise collections.
order: 100
---

# Products and collections

An app manages the catalogue like a team member: it lists and reads products,
creates them, edits their copy, prices, images, options and variants, changes
one variant's price or SKU, and organises collections. Every write runs the
dashboard's own product and collection editors' checks, and is recorded under
your app's name.

| Route                                          | Does                                | Scope            |
| ---------------------------------------------- | ----------------------------------- | ---------------- |
| `GET /products`, `GET /products/{id}`          | List and read products              | `read_products`  |
| `POST /products`                               | Create a product                    | `write_products` |
| `PATCH /products/{id}`                         | Change a product                    | `write_products` |
| `PATCH /products/{id}/variants/{variantId}`    | Change one variant                  | `write_products` |
| `GET /collections`, `GET /collections/{id}`    | List and read collections           | `read_products`  |
| `POST /collections`, `PATCH /collections/{id}` | Create and change a collection      | `write_products` |
| `PATCH /collections/{id}/products`             | Add and remove products             | `write_products` |
| `DELETE /collections/{id}`                     | Delete a collection                 | `write_products` |
| `POST /images`                                 | Bring an image onto the Tassyir CDN | `write_products` |

No route deletes a product: set `active: false` to take one off the store.
Stock is its own resource ([Stock](stock.md)), and so is the buy price
(`read_costs`).

## The product

```json
{
  "id": "741000000000000500",
  "storeId": "741000000000000100",
  "name": "Robe kabyle",
  "slug": "robe-kabyle",
  "description": "<p>Faite main à Tizi Ouzou.</p>",
  "type": "PHYSICAL",
  "active": true,
  "visible": true,
  "currency": "DZD",
  "price": "4500.00",
  "compareAtPrice": "5200.00",
  "sku": "RK-01",
  "barcode": null,
  "image": "https://cdn.tassyir.io/images/0f1e2d3c/public",
  "images": ["https://cdn.tassyir.io/images/0f1e2d3c/public"],
  "weightKg": 0.6,
  "dimensionsCm": { "width": 30, "height": 5, "length": 40 },
  "tracksInventory": true,
  "allowOutOfStockOrders": false,
  "collectionIds": ["741000000000000600"],
  "brandId": null,
  "options": [{ "name": "Taille", "values": ["S", "M"] }],
  "variants": [
    {
      "id": "741000000000000501",
      "name": "M",
      "sku": "RK-01-M",
      "barcode": null,
      "price": "4700.00",
      "compareAtPrice": null,
      "image": null,
      "isDefault": false,
      "hidden": false,
      "options": [{ "name": "Taille", "value": "M" }],
      "createdAt": "2026-10-02T10:00:00.000Z",
      "updatedAt": "2026-10-02T10:00:00.000Z"
    }
  ],
  "createdAt": "2026-10-02T10:00:00.000Z",
  "updatedAt": "2026-10-03T10:00:00.000Z"
}
```

- `type` is `PHYSICAL` or `PACK` (a bundle of other products); an open
  string. `active` is false once the product is taken off the store.
- Every product has a **default variant** (`isDefault`) that follows the
  product's own name, image, SKU, barcode and prices. A product with options
  has one more variant per combination of option values.
- Deleted variants and options are left out.

## List and read

`GET /products` lists every product of your installation's stores, **active
or not**, newest first. Filters: `storeId`, `collectionId` (the collection's
members), `active` (`true` or `false`), `createdSince`, `updatedSince`. A
collection membership change does **not** move `updatedAt`: listen to
`products/updated`, which names `collectionIds`.

## Images on the storefront

A product's images and description are loaded by every buyer's browser on the
store, the page that holds the order form. So an app may only write images
that are:

- **on the Tassyir CDN**: `https://cdn.tassyir.io/…`; or
- **already shown by the same product or collection** (its image, gallery,
  variant images or description images), so rewriting a product keeps the
  merchant's own images.

Anything else is 400 `MEDIA_URL_NOT_ALLOWED` (`field`, `url`).

A **description** is HTML: paragraphs, headings, lists, emphasis, links and
CDN images. Refused with 400 `HTML_NOT_ALLOWED` (`field`, `problems`):
`<script>`, `<style>`, `<link>`, `<meta>`, `<base>`, frames, `<object>`,
`<embed>`, forms and their fields, `<template>`, any `on…` attribute,
`srcdoc`, `ping`, links that are not `http`, `https`, `mailto` or `tel` (or
that start with `//`), and inline CSS that can load something (`url(`,
`@import`, `image-set(`). `null` or `""` clears a description.

### Bring an image onto the CDN

An image from elsewhere (a supplier's feed, another platform) goes through
`POST /images` first. Tassyir downloads it, keeps it only if it is a JPEG,
PNG, GIF or WebP, stores it on its CDN in the merchant's media library, and
answers the URL the catalogue writes accept.

```ts
/**
 * POST /images. This release of @tassyir/app does not type the route yet, so
 * call it with fetch and a token from the token manager. Reuse the same
 * idempotency key when you retry the same image.
 */
export async function uploadImage(
  installationId: string,
  sourceUrl: string,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<string> {
  const accessToken = await tassyir.tokens.getAccessToken(installationId);
  const response = await fetch('https://api.tassyir.io/apps/2026-10/images', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ url: sourceUrl }),
  });
  const body = (await response.json()) as {
    data?: { id: string; url: string };
    code?: string;
    fix?: string;
  };
  if (!response.ok || body.data === undefined) {
    throw new Error(
      `${body.code ?? String(response.status)}: ${body.fix ?? ''}`,
    );
  }
  return body.data.url; // https://cdn.tassyir.io/images/…
}

const image = await uploadImage(
  installationId,
  'https://images.example-shop.com/p/red-shoe.jpg',
);
await admin.post('/products', {
  body: {
    storeId: '741000000000000100',
    name: 'Red shoe',
    price: '3200.00',
    image,
  },
});
```

```json
{
  "data": {
    "id": "741000000000029500",
    "url": "https://cdn.tassyir.io/images/5c1d-77aa/public",
    "contentType": "image/jpeg",
    "sizeBytes": 184213,
    "width": 1200,
    "height": 1600
  }
}
```

Put `url` as it is in a product's `image` or `images`, a variant's `image`, a
collection's `image`, or an `<img src>` of a description. `id` is the image
in the merchant's media library, where it shows your app as its source. An
image already on `https://cdn.tassyir.io/` needs no upload.

| Refusal                      | Why                                                                                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400 `IMAGE_URL_NOT_ALLOWED`  | The address, by its `reason`: `malformed`, `not_https`, `port` (only 443), `credentials`, `host` (an IP address, a single label, a private name), `tassyir_host`. |
| 400 `IMAGE_FETCH_FAILED`     | The download, by its `reason`: `unreachable`, `timeout` (15 seconds), `tls`, `redirects` (more than 3), `http_status` (with `httpStatus`).                        |
| 400 `IMAGE_TYPE_NOT_ALLOWED` | Not a JPEG, PNG, GIF or WebP, judged by the bytes (`detected`). **SVG is always refused**: convert it to PNG. AVIF and HEIC are refused too.                      |
| 400 `IMAGE_TOO_LARGE`        | Over 10 MB, or over 12,000 pixels on a side or 100 megapixels.                                                                                                    |
| 429 `IMAGE_QUOTA_REACHED`    | A quota window is full (below): `per`, `window`, `limit`, `Retry-After`.                                                                                          |
| 503 `SERVICE_UNAVAILABLE`    | Tassyir could not store it now: retry later with the same `Idempotency-Key`.                                                                                      |

#### Limits

| Window                                            | Limit | On a dev store |
| ------------------------------------------------- | ----- | -------------- |
| per installation, per UTC day                     | 1,000 | 100            |
| per business (all its apps together), per UTC day | 2,000 | 200            |
| per installation, per minute                      | 30    | 30             |

A download that was attempted counts, whatever it found. Send an
`Idempotency-Key` per image: a retry with the same key answers the same image
without downloading or counting it again. A raw file upload (multipart) is
not offered yet: host the file somewhere first.

## Create a product

```ts
const { data: product } = await admin.post('/products', {
  body: {
    storeId: '741000000000000100',
    name: 'Robe kabyle',
    price: '4500.00',
    image: 'https://cdn.tassyir.io/images/0f1e2d3c/public',
    description: '<p>Faite main à Tizi Ouzou.</p>',
    options: [{ name: 'Taille', values: ['S', 'M'] }],
    variants: [
      {
        options: [{ name: 'Taille', value: 'S' }],
        price: '4500.00',
        sku: 'RK-01-S',
      },
      {
        options: [{ name: 'Taille', value: 'M' }],
        price: '4700.00',
        sku: 'RK-01-M',
      },
    ],
  },
});
console.log(product.id, product.variants.length);
```

| Field                                        | Rule                                                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `storeId`, `name`, `price`, `image`          | Required. `name` 1 to 255 characters; `image` follows the image rule (the dashboard requires a main image too).                       |
| `price`, `compareAtPrice`                    | Decimal strings, at most two decimals, never negative (`"2500"`, `"2500.50"`), in dinars.                                             |
| `description`                                | HTML, up to 200,000 characters, per the description rule.                                                                             |
| `slug`                                       | The product's URL segment, up to 120 characters; made from the name when omitted. One taken in the store is 409 `PRODUCT_SLUG_TAKEN`. |
| `sku`, `barcode`                             | Up to 100 characters, or `null`.                                                                                                      |
| `images`                                     | The gallery, up to 50, in display order.                                                                                              |
| `weightKg`, `dimensionsCm`                   | Numbers from 0 to 10,000, or `null`; dimensions all three or none.                                                                    |
| `active`, `visible`, `allowOutOfStockOrders` | Booleans, `true` by default.                                                                                                          |
| `brandId`, `collectionIds`                   | A brand of the store; up to 100 collections of the store to pick the product into.                                                    |
| `options`, `variants`                        | Up to 3 options of 1 to 100 values; with options, `variants` has every combination exactly once (up to 200), each with its `price`.   |

Any other field (`tracksInventory`, `type`, `tags`, …) is 400
`VALIDATION_FAILED`. The option and variant rules refuse with their own codes
(`PRODUCT_VARIANT_COUNT_MISMATCH`, `PRODUCT_VARIANT_MISSING_COMBINATIONS`,
`PRODUCT_OPTION_DUPLICATE_VALUE`, …) and `details`. The answer is **201** with the
product read again, and `products/created` is sent.

## Change a product

`PATCH /products/{id}` saves the fields you send (the create's, but not
`storeId` or `collectionIds`); `null` clears the nullable ones.

- **`options` and `variants` replace the product's**, as the dashboard's
  editor saves them: send `options` with every value and `variants` with every
  combination. A variant with an `id` keeps that variant and changes only the
  fields you send; one without `id` is new and needs `price`; a variant left
  out is removed. `variants` alone keeps the options.
- A product may keep the outside images it already shows.

To change **one variant** without sending them all, use
`PATCH /products/{id}/variants/{variantId}` with any of `name`, `sku`,
`barcode`, `price`, `compareAtPrice`, `image`, `hidden`:

```ts
const { data: variant } = await admin.patch(
  '/products/{id}/variants/{variantId}',
  {
    path: { id: '741000000000000500', variantId: '741000000000000501' },
    body: { price: '4900.00', compareAtPrice: null },
  },
);
console.log(variant.price);
```

Two apps changing two variants of one product never overwrite each other. A
variant added or removed meanwhile makes the save fail with
`PRODUCT_VARIANT_COUNT_MISMATCH`: read the product again and retry. The default
variant follows its product: 409 `PRODUCT_DEFAULT_VARIANT`, change the
product instead.

## Collections

A collection holds the products picked by hand, plus those matching its
conditions, minus those excluded by hand. Its page lists them in
`productSort` order.

```json
{
  "id": "741000000000000600",
  "storeId": "741000000000000100",
  "parentId": null,
  "name": "Soldes",
  "description": null,
  "image": null,
  "active": true,
  "sortOrder": 2,
  "productSort": "NEWEST",
  "ruleMatch": "ALL",
  "rules": [
    {
      "field": "ON_SALE",
      "operator": "IS_TRUE",
      "valueRefIds": [],
      "valueNumber": null,
      "valueNumberMax": null,
      "valueText": null
    }
  ],
  "productsCount": 7,
  "createdAt": "2026-10-02T10:00:00.000Z",
  "updatedAt": "2026-10-03T10:00:00.000Z"
}
```

- `parentId` nests a collection under another of the same store.
- `productSort`: `UPDATED`, `NEWEST`, `OLDEST`, `PRICE_ASC`, `PRICE_DESC`,
  `NAME_ASC`, `NAME_DESC` or `MANUAL` (an open string).
- **Conditions:** `ruleMatch` (`ALL` or `ANY`, `null` without rules) and up to
  10 `rules`: `field` `BRAND` or `TAG` (with `valueRefIds`), `PRICE`
  (`valueNumber`, and `valueNumberMax` for `BETWEEN`, in dinars), `ON_SALE`,
  `TITLE` (`valueText`); `operator` `IS`, `IS_NOT`, `LESS_THAN`, `MORE_THAN`,
  `BETWEEN`, `CONTAINS`, `NOT_CONTAINS`, `STARTS_WITH`, `IS_TRUE`, `IS_FALSE`.
- To list its products: `GET /products?collectionId=<id>`.

```ts
const { data: sale } = await admin.post('/collections', {
  body: {
    storeId: '741000000000000100',
    name: 'Soldes',
    ruleMatch: 'ALL',
    rules: [{ field: 'ON_SALE', operator: 'IS_TRUE' }],
  },
});

await admin.patch('/collections/{id}/products', {
  path: { id: sale.id },
  body: { add: ['741000000000000500'], remove: ['741000000000000501'] },
});
```

- `PATCH /collections/{id}/products`: `add` picks products by hand (and lifts
  an exclusion), `remove` takes them out whatever put them there. Up to 250
  ids each, products of the collection's store. Each product that entered or
  left sends `products/updated` with `collectionIds`.
- `DELETE /collections/{id}`: its products stay in the catalogue, and its
  subcollections move up one level.
- Collections send no webhook of their own.

## Errors these routes add

| Status | Code                                 | When                                                                |
| ------ | ------------------------------------ | ------------------------------------------------------------------- |
| 400    | `MEDIA_URL_NOT_ALLOWED`              | An image is not on the Tassyir CDN and not already on the resource. |
| 400    | `HTML_NOT_ALLOWED`                   | A description carries markup apps may not write.                    |
| 409    | `PRODUCT_DEFAULT_VARIANT`            | A write to the variant that follows its product.                    |
| 409    | `PRODUCT_SLUG_TAKEN`                 | Another product of the store has that slug.                         |
| 400    | `IMAGE_*`, 429 `IMAGE_QUOTA_REACHED` | `POST /images` ([above](#bring-an-image-onto-the-cdn)).             |

The catalogue's own codes (options, variants, collections, brands) reach you
unchanged, with their details.
