---
title: App data
description: Keep your app's values in Tassyir, next to the business, its stores, products, orders and customers, under keys your manifest declares.
order: 140
---

# App data

Your app often needs to remember something about a merchant's resource: a
product's review rating, an order's sync state with another system, a
customer's loyalty points, a setting for the whole business. App data keeps
those values in Tassyir, next to the resource, so your app needs no database
of its own for them.

## Declare the keys

Every key is declared in the manifest:

```toml
[[data.definitions]]
owner      = "product"   # business | store | product | order | customer
key        = "rating"    # [a-z][a-z0-9_]{0,63}, unique per owner
type       = "json"      # string | number | integer | boolean | json
visibility = "app"       # app | merchant | storefront
```

- **The installation's version decides.** A key your new version adds can be
  written on an installation only once its merchant accepts that version.
- **The type is checked on every write.** The visibility comes from the
  declaration, never from the request.
- `visibility`: `app` values are read by your app only. `merchant` values
  are meant for the dashboard and `storefront` values for the store's pages;
  neither is shown there yet, so declare them only for values you would be
  happy to see shown.
- **A key a newer version drops** keeps its values: still readable
  (`declared: false`) and deletable, never writable. A key whose type changes
  keeps its old values; the next write must match the new type.

## Owners and scopes

Reading or writing a value needs the scope that reads its owner. Writing a
value changes nothing about the owner, so no `write_*` scope is needed.

| Owner      | Scope            | Owner id                    |
| ---------- | ---------------- | --------------------------- |
| `business` | none             | the installation's business |
| `store`    | `read_stores`    | a store                     |
| `product`  | `read_products`  | a product                   |
| `order`    | `read_orders`    | an order                    |
| `customer` | `read_customers` | a customer                  |

The owner is read first, as `GET /products/{id}` (or the others) would read
it: an owner your token cannot read is 404 `NOT_FOUND`, a store outside your
installation's is 460. So an online token never touches a value about
something its person cannot see.

## Write, read, delete

```ts
const owner = {
  ownerType: 'product',
  ownerId: '741000000000000500',
  key: 'rating',
} as const;

// PUT writes the whole value: 201 when it is new, 200 when it replaced one.
await admin.put('/data/{ownerType}/{ownerId}/{key}', {
  path: owner,
  body: { value: { average: 4.5, count: 12 } },
});

const { data: rating } = await admin.get('/data/{ownerType}/{ownerId}/{key}', {
  path: owner,
});
console.log(rating.value, rating.visibility, rating.updatedAt);

await admin.delete('/data/{ownerType}/{ownerId}/{key}', { path: owner });
```

```json
{
  "id": "9500000000000000001",
  "ownerType": "product",
  "ownerId": "741000000000000500",
  "key": "rating",
  "value": { "average": 4.5, "count": 12 },
  "visibility": "app",
  "declared": true,
  "createdAt": "2026-10-14T08:00:00.000Z",
  "updatedAt": "2026-10-14T09:30:00.000Z"
}
```

- The body is `{ "value": … }` and nothing else. A value is never `null`:
  remove one with `DELETE`.
- A missing value answers 404 `NOT_FOUND` (its `detail` says whether the
  owner or the value is missing).
- `GET /data` lists your installation's values, newest first. Filters:
  `ownerType`, `ownerId` (with `ownerType`), `key`. Values whose owner you can
  no longer read are left out, so **a page can be shorter than `limit` while
  `nextCursor` is set**: keep reading until it is `null`.

```ts
for await (const value of admin.paginate('/data', {
  query: { ownerType: 'product', key: 'rating' },
})) {
  console.log(value.ownerId, value.value);
}
```

## Values

| Type      | Accepted                                                    |
| --------- | ----------------------------------------------------------- |
| `string`  | a JSON string                                               |
| `number`  | a finite JSON number                                        |
| `integer` | a safe integer, -(2^53 - 1) to 2^53 - 1                     |
| `boolean` | `true` or `false`                                           |
| `json`    | any JSON value: an object, array, string, number or boolean |

- At most **16,384 bytes** of compact JSON in UTF-8 (an Arabic letter is two
  bytes): 400 `APP_DATA_VALUE_TOO_LARGE`.
- Refused with 400 `APP_DATA_VALUE_INVALID` and a `reason`: `wrong_type`,
  `not_finite`, `nul_character`, `lone_surrogate`, `reserved_key` (an object
  key `__proto__`, `constructor` or `prototype`), `too_deep` (more than 32
  levels).
- An object's keys come back in the order Tassyir stores them (shorter
  keys first), not the order you sent.
- A key the version does not declare for that owner is 400
  `APP_DATA_KEY_NOT_DECLARED`.

## Limits

An installation holds at most **50,000 values**, whatever their owners.
Writing a new key past that is 409 `APP_DATA_LIMIT_REACHED` (`limit`,
`used`); rewriting a value that exists is never refused, and `DELETE` frees a
slot. Values of keys a version dropped count until you delete them.

## When values go away

- Values stay when their owner is deleted, until you delete them; they drop
  out of lists and reads.
- When the merchant uninstalls your app, its values are deleted 48 hours
  later, and your app receives `business/redact`. A reinstall, even within
  those 48 hours, is a new installation that starts empty, and an uninstalled
  installation can no longer read its values: if a value must survive a
  reinstall, keep your own copy
  ([Compliance and uninstall](compliance-and-uninstall.md)).
