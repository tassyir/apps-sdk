---
title: Embedded pages and App Bridge
description: Show your app's page inside the Tassyir dashboard and use App Bridge for ID tokens, toasts, modals, the save bar, navigation and pickers.
order: 60
---

# Embedded pages and App Bridge

Your app can have a page inside the Tassyir dashboard, next to the merchant's
orders and products. The dashboard shows it in a frame and talks to it
through **App Bridge**: your page asks for ID tokens, shows toasts and
modals, uses the dashboard's save bar and title bar, navigates, and opens the
dashboard's pickers. `@tassyir/app-bridge` is the page's side of it.

## How the page is loaded

Set `admin.page` in the manifest (usually `/`). When the merchant opens your
app, the dashboard address is
`https://app.tassyir.io/{locale}/dashboard/{businessId}/apps/{handle}/{path}`,
and your frame loads:

> `hosting.url` + `admin.page` + the app path (`{path}`) + the dashboard's own
> query string

So every path below `admin.page` is your page: serve the same document for
all of them and route on the client.

- Allow the dashboard to frame your page, and nothing else:
  `Content-Security-Policy: frame-ancestors https://app.tassyir.io`.
- The page counts as shown at its frame's `load`, or at its first App Bridge
  call. With neither within 15 seconds, the dashboard shows a "didn't load"
  state with **Try again**.
- **Tassyir vouches for nothing in your page's address.** Never read a
  business, a user or a store from it to decide what to show or allow.
  App Bridge's context is for display only. Who is looking is what a verified
  ID token says ([Tokens](tokens.md#who-is-looking-the-id-token)).
- The dashboard never gives your page a Tassyir credential: the ID token is
  the only one. Your frame's cookies are third-party cookies, which browsers
  often block: do not build a session on them.

## A page

```ts browser
import { createAppBridge, isAppBridgeError } from '@tassyir/app-bridge';

// Create it once, as early as the page loads: its first message tells the
// dashboard the page is up.
const bridge = createAppBridge();

// Each request to your server carries a NEW ID token: never keep one.
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { token } = await bridge.idToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return (await response.json()) as T;
}

// The frame cannot see the dashboard's language, direction or theme.
bridge.on('context.changed', ({ locale, dir, theme }) => {
  document.documentElement.lang = locale;
  document.documentElement.dir = dir;
  document.documentElement.dataset['theme'] = theme;
});

await bridge.titleBar.set({ title: 'Reviews' });
const reviews =
  await api<{ id: string; orderNumber: string }[]>('/api/reviews');
document.querySelector('#count')!.textContent = String(reviews.length);

document.querySelector('#pick')!.addEventListener('click', async () => {
  try {
    const { selection } = await bridge.resource.pick({
      type: 'product',
      multiple: true,
    });
    if (selection.length === 0) return; // the merchant cancelled
    await api('/api/featured', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(selection.map((product) => product.id)),
    });
    await bridge.toast.show({
      message: `${selection.length} products featured`,
      tone: 'success',
    });
  } catch (error) {
    if (!isAppBridgeError(error)) throw error;
    // error.code is stable; error.fix says what to do about it.
    await bridge.toast.show({ message: error.message, tone: 'error' });
  }
});
```

Your server verifies each token with `tassyir.authenticate(idToken)` before
it answers ([Tokens](tokens.md#embedded-apps-one-offline-token-per-installation)).

## Calls

Every call posts one message to the dashboard and resolves with its answer,
or rejects with an `AppBridgeError`. The SDK checks each payload before
posting, so most mistakes are refused without a round trip.

| Call                                  | Does                                                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `idToken()`                           | A new 60-second ID token for this installation and the person looking. Never cached.                 |
| `toast.show({ message, tone? })`      | A toast signed with your app's name. `tone`: `info` (default), `success`, `error`.                   |
| `modal.open({ path, title?, size? })` | One of your pages in a dashboard modal; resolves `{ closedBy: 'app' \| 'merchant' }` when it closes. |
| `modal.close()`                       | Closes the modal, from the page or from the modal itself.                                            |
| `navigate({ path, replace? })`        | Says your app moved to another of its pages; the dashboard's address follows.                        |
| `navigate({ dashboard, id? })`        | Leaves your app for a dashboard page.                                                                |
| `saveBar.show({ saving? })`           | Shows the dashboard's save bar, busy while `saving` is true.                                         |
| `saveBar.hide()`                      | Hides it.                                                                                            |
| `titleBar.set({ title })`             | Your page's title beside your app's name; `null` or `""` clears it.                                  |
| `resource.pick({ type, multiple? })`  | The dashboard's picker for products, collections or customers.                                       |
| `context.get()`                       | The context: locale, direction, theme, current store.                                                |

- **Text** (toasts, modal and page titles) is shown as text: control and
  bidi characters become spaces, white space is folded, and it is cut (150
  characters for a toast, 80 for a title). More than 2,000 characters is
  refused.
- **App paths** (`navigate`, `modal.open`) are relative to `admin.page` and
  start with one `/`, with an optional query: `/reviews/2?tab=sent`. No scheme
  or host, backslash, white space, control or bidi character, fragment, or
  `.`, `..` or empty segment. At most 1,024 characters before the `?` and
  2,048 in all.
- **`navigate({ path })`** does not reload your frame: show the page yourself
  (with your router), and the dashboard's address follows, as a new history
  entry or, with `replace: true`, in place. Back and Forward reload your frame
  at the address they land on.
- **`navigate({ dashboard })`** opens `home`, `orders`, `order` (with `id`),
  `customers`, `customer` (with `id`), `tracking`, `inventory`, `products`
  (the current store's) or `apps`.
- **A modal's page** may call only `idToken`, `toast.show`, `modal.close`,
  `resource.pick` and `context.get`. One modal and one picker at a time.
- `modal.open` and `resource.pick` wait for the merchant as long as the
  dialog is open. Every other call times out after 10 seconds, and every call
  takes an `AbortSignal`.

## The save bar

Show the dashboard's save bar while your page has unsaved changes. Its buttons
send events to your page:

```ts browser
import { createAppBridge } from '@tassyir/app-bridge';

const bridge = createAppBridge();
let draft = { highlightFrom: '5000.00' };

document.querySelector('form')!.addEventListener('input', () => {
  void bridge.saveBar.show();
});

bridge.on('saveBar.save', async () => {
  await bridge.saveBar.show({ saving: true });
  const { token } = await bridge.idToken();
  await fetch('/api/settings', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(draft),
  });
  await bridge.saveBar.hide();
  await bridge.toast.show({ message: 'Saved', tone: 'success' });
});

bridge.on('saveBar.discard', async () => {
  draft = { highlightFrom: '5000.00' };
  await bridge.saveBar.hide();
});
```

The bar does not stop the merchant from leaving the page. When the page goes
away, the SDK hides the bar and clears the title, so neither outlives it.

## Pickers

`resource.pick` resolves when the merchant closes the dashboard's picker:
`selection` is empty when they cancelled, holds one item unless `multiple` is
true, and at most 50.

| `type`       | Each item                                                                    | Your installation needs |
| ------------ | ---------------------------------------------------------------------------- | ----------------------- |
| `product`    | `{ id, name, image }` (`image` an https URL or `null`)                       | `read_products`         |
| `collection` | `{ id, name }`, from the current store                                       | `read_products`         |
| `customer`   | `{ id, provinceCode }`, plus `name` and `phone` with `read_customer_contact` | `read_customers`        |

The person looking must also be allowed to read what the picker shows. An
installation limited to selected stores picks from the current store only,
which must be one of its stores.

## Context

```ts browser
const stop = bridge.on('context.changed', ({ locale, dir, theme, storeId }) => {
  console.log(locale, dir, theme, storeId);
});
console.log(bridge.context.current); // null until the dashboard has sent it
stop();
```

The context is `{ locale: 'ar' | 'en', dir: 'rtl' | 'ltr', theme: 'light' |
'dark', storeId }`. `storeId` is the dashboard's current store, or `null`
when there is none or your installation is limited to other stores. Follow
`locale`, `dir` and `theme` so your page reads like the dashboard: Arabic
pages run right to left. The context is for display; it proves nothing.

## Errors

An `AppBridgeError` has a stable `code`, the `call` that failed, a `source`
(`dashboard` or `sdk`), a `message` for people and a `fix`.
`isAppBridgeError(error, code?)` narrows an unknown error.

| Code                   | Meaning                                                                          |
| ---------------------- | -------------------------------------------------------------------------------- |
| `INVALID_PAYLOAD`      | The payload breaks the call's rules.                                             |
| `RATE_LIMITED`         | Over the call's limit for the minute.                                            |
| `ID_TOKEN_UNAVAILABLE` | Tassyir cannot sign ID tokens right now; the dashboard tells the merchant.       |
| `APP_UNAVAILABLE`      | The installation cannot be opened any more (uninstalled, suspended, or no page). |
| `PERMISSION_DENIED`    | The person looking may not do this.                                              |
| `SCOPE_REQUIRED`       | Your installation lacks the scope a pick needs.                                  |
| `STORE_NOT_ALLOWED`    | Your installation is limited to other stores than the current one.               |
| `NO_STORE`             | A collection pick with no current store.                                         |
| `BUSY`                 | A modal or a picker is already open.                                             |
| `NO_MODAL`             | `modal.close` with no modal open.                                                |
| `NOT_ALLOWED_HERE`     | A call a modal's page may not make.                                              |
| `INVALID_DESTINATION`  | A place the dashboard cannot open now.                                           |
| `FAILED`               | Anything else; try again.                                                        |
| `NOT_EMBEDDED`         | The page is not inside the dashboard's frame (`source: 'sdk'`).                  |
| `TIMEOUT`              | No answer in time (`source: 'sdk'`).                                             |

The [`@tassyir/app-bridge` README](https://github.com/tassyir/apps-sdk/tree/main/packages/app-bridge#errors)
lists the SDK's other codes.

## Limits

The dashboard counts calls per installation over a sliding minute, and
answers `RATE_LIMITED` past a call's limit. Past 240 messages a minute in all,
it drops messages without answering. The SDK counts what your page sends and
refuses first, so your page sees `RATE_LIMITED` rather than a timeout.

| Call            | Per minute |
| --------------- | ---------- |
| `idToken`       | 30         |
| `toast.show`    | 20         |
| `modal.open`    | 10         |
| `modal.close`   | 30         |
| `navigate`      | 30         |
| `saveBar.show`  | 60         |
| `saveBar.hide`  | 60         |
| `titleBar.set`  | 60         |
| `resource.pick` | 10         |
| `context.get`   | 60         |

A reloaded frame does not reset them: they last as long as the dashboard tab.
