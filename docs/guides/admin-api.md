---
title: Admin API conventions
description: How every Admin API route behaves, from versions, money and cursors to idempotent writes, errors and rate limits.
order: 80
---

# Admin API conventions

The Admin API is the versioned REST API your app calls to read and change a
business. Every route follows the conventions on this page, so learn them
once: how lists page, how a write is made safe to retry, how errors read and
how fast you may call.

## Calling it

`https://api.tassyir.io/apps/2026-10/<resource>`, with an access token:

```bash
curl https://api.tassyir.io/apps/2026-10/business \
  -H "Authorization: Bearer $TASSYIR_ACCESS_TOKEN"
```

```json
{
  "data": {
    "id": "741939488313319175",
    "name": "Dar Amina",
    "currency": "DZD",
    "country": "DZ",
    "timezone": "Africa/Algiers",
    "createdAt": "2026-01-02T03:04:05.000Z"
  }
}
```

The business comes from the token: no route takes a business id.
`GET /business` needs no scope; every other route needs the scope its guide
names. With `@tassyir/app`, paths are relative to `/apps/2026-10`, and paths,
parameters, bodies and answers are typed:

```ts
const { data: business } = await admin.get('/business');
const { data: order } = await admin.get('/orders/{id}', {
  path: { id: '741000000000000001' },
  query: { fields: ['orderNumber', 'status', 'total', 'currency'] },
});
console.log(business.timezone, order.status, order.total);
```

| Resource                                           | Guide                                                   |
| -------------------------------------------------- | ------------------------------------------------------- |
| `orders`, `cancel-reasons`                         | [Orders](orders.md)                                     |
| `products`, `collections`, `images`                | [Products and collections](products-and-collections.md) |
| `inventory-levels`                                 | [Stock](stock.md)                                       |
| `customers`                                        | [Customers and contact data](customers.md)              |
| `stores`, `delivery-agents`, `delivery-fee-groups` | [Stores and delivery](stores-and-delivery.md)           |
| `data`                                             | [App data](app-data.md)                                 |

## Versions

The version is in the path: `2026-10` is the first and, today, the only one.
Within a version, fields may be added, never renamed, retyped or removed, so
ignore fields you do not know. A version that does not exist answers 404.

Versions are released quarterly and supported for 12 months. Tassyir emails
you 90 days before a version you use is retired; once it is, its requests are
answered by the oldest supported version, with the headers
`Tassyir-Api-Version-Served` and `Deprecation`.

## Values

- JSON fields are **camelCase**. Ids are **strings**: never parse them as
  numbers. Times are ISO 8601 in UTC (`2026-10-11T09:12:44.120Z`).
- **Money is a decimal string** with two decimals (`"2500.00"`) next to a
  `currency` field (`DZD` today), never a number. Keep it a string; for
  arithmetic, use a decimal library or integer cents, never `parseFloat`. An
  amount Tassyir does not know is `null`, never `"0.00"`. When you send money
  (a product's price), send a decimal string too.
- Open vocabularies (an order's `status`, a carrier's status) are strings,
  not enums: a merchant or a carrier can add values.
- **Contact fields** (a buyer's name, phones, email, address, an order's
  notes) are present only with `read_customer_contact`. Without it the keys
  are **absent**, not `null` ([Customers and contact data](customers.md)).

## One resource, and lists

A single resource is `{ "data": { … } }`. A list is
`{ "data": [ … ], "nextCursor": "…" | null }`:

| Parameter | Rule                                                                           |
| --------- | ------------------------------------------------------------------------------ |
| `limit`   | 1 to 100, default 50. Anything else is 400 `VALIDATION_FAILED`, never clamped. |
| `cursor`  | The previous page's `nextCursor`, unchanged. Omit it for the first page.       |
| `fields`  | Trims each item ([below](#fields)).                                            |

- Lists are **newest first** and **keyset-paged**: a row added while you walk
  a list never shifts the pages to come, and no row is repeated or skipped.
  New rows appear on a new walk from the first page.
- `nextCursor` is **opaque**: never build or edit one. It belongs to its list
  and its filters; with another list or other filters it is 400
  `INVALID_CURSOR`. `nextCursor: null` is the last page.
- A page can hold fewer than `limit` items while `nextCursor` is set (app data
  drops values whose owner you can no longer read). Stop on `null`, not on a
  short page.
- **Unknown parameters are refused** (400 `VALIDATION_FAILED`, naming them): a
  misspelt filter never silently returns everything.

`admin.paginate` walks every page for you:

```ts
let pending = 0;
for await (const order of admin.paginate('/orders', {
  query: { status: 'pending', limit: 100, fields: ['id'] },
})) {
  pending += 1;
}
console.log(`${pending} pending orders`);
```

## Fields

`?fields=status,total,buyer` trims each resource to the named **top-level**
fields; `id` is always kept. An unknown name is 400 `INVALID_FIELDS`, with the
`allowedFields`. Trimming happens after masking: naming a field your
installation may not read returns nothing for it. With the SDK, `fields` is a
typed list: `fields: ['status', 'total']`.

## Idempotent writes

Every write (`POST`, `PUT`, `PATCH`, `DELETE`) accepts an `Idempotency-Key`
header: 1 to 255 visible ASCII characters, usually a UUID. Send one, and a
retry of the same write never runs it twice. Keys belong to your
installation and are kept 24 hours.

| Situation                                   | Answer                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| First use                                   | The write runs. A success is stored for 24 hours; a failure is not, so you can retry. |
| Same key, same method, path, query and body | The stored answer and status, with `Idempotent-Replayed: true`. Nothing runs again.   |
| Same key, anything else different           | 422 `IDEMPOTENCY_KEY_REUSED`                                                          |
| Same key while the first request still runs | 409 `IDEMPOTENCY_KEY_IN_USE` (a key whose request died is freed within 100 seconds)   |
| A malformed key                             | 400 `IDEMPOTENCY_KEY_INVALID`                                                         |
| Tassyir cannot check keys right now         | 503 `IDEMPOTENCY_UNAVAILABLE`, with `Retry-After`. The write was **not** attempted.   |

`@tassyir/app` sends a new key with every write and reuses it for its own
retries. Pass your own when a retry may come from elsewhere (a job that can
run twice), or `false` to send none:

```ts
await admin.post('/orders/{id}/confirm', {
  path: { id: '741000000000000001' },
  idempotencyKey: 'confirm-741000000000000001',
});
```

## Errors

Every error under `/apps/2026-10/` is `application/problem+json`
([RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)):

```json
{
  "type": "https://developers.tassyir.io/errors/permission-denied",
  "title": "Permission denied",
  "status": 403,
  "detail": "You do not have permission: orders:read",
  "code": "PERMISSION_DENIED",
  "permission": "orders:read",
  "fix": "Request the read_orders scope in the app's manifest; it applies once the merchant consents to the new version.",
  "requestId": "a1b2c3"
}
```

- **Act on `code`**, never on `detail` or `title`: `code` is stable.
- **`fix`** is one sentence saying what to do, when there is one.
- Other members name what was refused: `permission`, `storeId`, `limit`,
  `errors`, `allowedFields`, …
- **`requestId`** (also the `X-Request-Id` header) names the request: quote it
  when you ask Tassyir for help.
- A 5xx never carries an internal message: retry with backoff.

`@tassyir/app` turns a problem into a `TassyirApiError`, with `code`, `fix`,
`status`, `requestId`, `retryAfterSeconds` and the whole `problem`. The codes
each call can answer are typed:

```ts
import { TassyirApiError, type AdminApiErrorCode } from '@tassyir/app';

type ConfirmError = AdminApiErrorCode<'post', '/orders/{id}/confirm'>;

export async function confirm(
  id: string,
): Promise<'confirmed' | 'waiting' | ConfirmError> {
  try {
    await admin.post('/orders/{id}/confirm', { path: { id } });
    return 'confirmed';
  } catch (error) {
    if (!(error instanceof TassyirApiError)) throw error;
    if (error.code === 'ORDER_LIMIT_REACHED') return 'waiting'; // past the plan's allowance
    console.warn(error.code, error.fix, error.requestId);
    return error.code as ConfirmError;
  }
}
```

[Errors](errors.md) lists every code, with what to do about the common ones.
The token endpoint is the one exception: it answers OAuth errors
([Tokens](tokens.md#the-token-endpoint-without-the-sdk)).

### Stores: 460, and 404

An installation reaches only the stores its merchant gave it. A store your
request names (a `storeId` filter or field) outside them is **HTTP 460
`STORE_SCOPE_FORBIDDEN`**. A resource of another store, named by its id,
reads as **404 `NOT_FOUND`**: the API never says it exists.

## Rate limits

Every answer carries your installation's bucket:

| Header                | Meaning                                |
| --------------------- | -------------------------------------- |
| `RateLimit-Limit`     | The bucket's size                      |
| `RateLimit-Remaining` | Requests accepted right now            |
| `RateLimit-Reset`     | Seconds until the bucket is full again |

- **Your installation's bucket**: by default 40 requests at once, refilled at
  4 a second. Past it: **429 `RATE_LIMITED`**, with `Retry-After` (seconds
  until one more request fits). Online and offline tokens of an installation
  share one bucket.
- **The business's ceiling**: all the apps of one business share, by
  default, 20 requests at once and 20 a second. Past it: **429
  `BUSINESS_RATE_LIMITED`**, with `Retry-After`; then other apps of the
  business are using the room, so spread your calls out.
- **A busy API**: when the API is already running its maximum of app
  requests, it answers **503 `API_BUSY`** with `Retry-After: 1`, having done
  **nothing**: any call, a write included, can be retried as it was.
- Image uploads have their own daily quota
  ([Products and collections](products-and-collections.md#limits)).

The numbers are defaults Tassyir may tune: read the headers rather than
hard-coding them. Retries are off by default in `@tassyir/app`; with
`retries: 3` it waits `Retry-After` and retries 429 and 503 `API_BUSY` (writes
included), any other 503, network errors, 502 and 504 for calls safe to
repeat (reads, and writes with a key), and 500 for reads only.

## Plans

No plan is needed to install an app or call the API. A plan's limits still
apply to what your app does, as they apply to the merchant: the service
refuses with the code the dashboard would show (`PLAN_FEATURE_REQUIRED`,
`ORDER_LIMIT_REACHED`, `SUBSCRIPTION_REQUIRED`).

## Masking

- Without `read_customer_contact`, contact fields are absent.
- When the merchant's plan hides phones (no active subscription, or a billing
  grace that hides them), phones read `**********`.
- A **waiting** order (past the plan's order allowance, `waiting: true`) is
  masked whatever your scopes: phones `**********` and notes `null`, until it
  unlocks (`orders/updated` with `waiting`).

## Caching

Every answer is `Cache-Control: no-store`: it is a merchant's private data.
Cache only what your app needs, and drop it on `app/uninstalled`.
