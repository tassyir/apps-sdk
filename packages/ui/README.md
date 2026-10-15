# @tassyir/ui

Web components that make your app's page look like the
[Tassyir](https://tassyir.io) dashboard it runs in: ink on paper, hairline
borders, one cyan highlighter, Arabic right to left and English left to
right, light and dark. Assemble your page from these elements instead of
inventing styles, and it reads as part of the dashboard.

They are custom elements, so they work in any framework (React, Vue,
Svelte, Hono JSX) or none. Browser only, ESM only, no runtime dependency.
The package collects no analytics, uses no browser storage and makes no
network request. About 13 kB gzipped for every element.

## Install

```bash
npm install @tassyir/ui @tassyir/app-bridge
```

## Example

Your manifest's `admin.page`, as plain HTML and TypeScript:

```html
<!doctype html>
<html lang="en" dir="ltr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script type="module" src="/page.js"></script>
  </head>
  <body>
    <main>
      <tsy-page-header heading="Review requests">
        <span slot="meta">12 sent this week</span>
        <tsy-button slot="actions" variant="primary" id="send"
          >Send requests</tsy-button
        >
      </tsy-page-header>

      <tsy-banner tone="warning" heading="SMS credit is low" dismissible>
        120 messages left.
      </tsy-banner>

      <tsy-table heading="Pending orders" count="2">
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th data-align="end">Total</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>#00001042</td>
              <td data-align="end">9.000 دج</td>
              <td><tsy-status-pill tone="warning">Pending</tsy-status-pill></td>
            </tr>
          </tbody>
        </table>
      </tsy-table>

      <tsy-card heading="Settings">
        <form id="settings">
          <tsy-text-field
            name="sender"
            label="Sender name"
            hint="Shown at the top of the SMS."
            required
          ></tsy-text-field>
          <tsy-select name="delay" label="Send after" value="2">
            <option value="1">1 day</option>
            <option value="2">2 days</option>
          </tsy-select>
          <tsy-checkbox name="skipReturns" checked
            >Skip buyers who returned an order</tsy-checkbox
          >
          <tsy-button type="submit">Save</tsy-button>
        </form>
      </tsy-card>
    </main>
  </body>
</html>
```

```ts
import { createAppBridge } from '@tassyir/app-bridge';
import { followDashboardContext } from '@tassyir/ui'; // also defines every element

const bridge = createAppBridge();

// The dashboard's language, direction and theme, on <html>, now and on
// every change. The elements and the tokens follow.
followDashboardContext(bridge);

document
  .querySelector<HTMLFormElement>('#settings')!
  .addEventListener('submit', async (event) => {
    event.preventDefault();
    const settings = Object.fromEntries(
      new FormData(event.currentTarget as HTMLFormElement),
    );
    // send `settings` to your server with a fresh ID token, then:
    await bridge.toast.show({ message: 'Settings saved', tone: 'success' });
  });
```

The fields submit with the `<form>` around them like native ones:
`new FormData(form)` holds `sender`, `delay` and `skipReturns`.

## The dashboard's rules

The elements keep DESIGN.md, the dashboard's design law. Your page keeps the
rest:

- **One ink button per view.** `variant="primary"` is the dashboard's dark
  call to action; put the view's one primary in the page header's actions.
  Everything else is `outline` (the default), `ghost` or `destructive`.
- **Status is a `<tsy-status-pill>`**, never a coloured word or a badge of
  your own.
- **No new colour.** Use the tokens (`var(--tsy-color-…)`), never a hex code.
  Cyan (`--tsy-color-brand-cyan`) is a highlighter: selection, progress,
  charts; never a button or a status.
- **14px is the floor** for any text, and type is the dashboard's sans.
- **Logical CSS only** (`margin-inline-start`, `padding-inline`,
  `text-align: start`), so the same rules serve Arabic and English.
- **Money and dates** read as the dashboard writes them: `9.000 دج` in
  Arabic, `DZD 9,000` in English; dates `yyyy-MM-dd` (`yyyy-MM-dd HH:mm`).
- **Modals, toasts, resource pickers, the save bar and the page title are
  not elements here.** They are App Bridge calls (`modal.open`, `toast.show`,
  `resource.pick`, `saveBar.show`, `titleBar.set`): the dashboard draws them,
  signed with your app's name. See
  [`@tassyir/app-bridge`](https://github.com/tassyir/apps-sdk/tree/main/packages/app-bridge#readme).

## Language, direction and theme

Your page runs in the dashboard's frame and cannot see its settings: App
Bridge sends them (`context.changed`: `locale`, `dir`, `theme`).
`followDashboardContext(bridge)` applies the current context at once and
every change after it, and returns the function that stops. It sets three
attributes on `<html>`:

- `lang`: `ar` or `en`. The elements' own words follow it ("Back",
  "Loading", "Dismiss", "(opens in a new tab)": Arabic for `ar`, English
  otherwise).
- `dir`: `rtl` or `ltr`. Every element is drawn with logical properties;
  arrows and carets mirror; arrow keys in a radio group follow the reading
  direction.
- `data-theme`: `light` or `dark`. The tokens switch, with `color-scheme`.

`applyDashboardContext({ locale, dir, theme }, root?)` sets them yourself,
for example in a page opened outside the dashboard. Light is the default. A
subtree with its own `data-theme` keeps that theme inside a page of the other
one.

The helpers take `@tassyir/app-bridge`'s bridge as it is but do not import
it: any object with `context.current` and `on('context.changed', …)` works.

## Elements

Importing `@tassyir/ui` defines every element (in a browser; on a server it
only exports, so server rendering can import it). An attribute that takes a
value ignores one it does not know and uses its default.

### `<tsy-button>`

The dashboard's button: 36px, 12px corners, a 14px medium label.

```html
<tsy-button variant="primary" type="submit">Save</tsy-button>
<tsy-button href="/settings">Settings</tsy-button>
<tsy-button square aria-label="More actions">⋯</tsy-button>
```

| Attribute                   | Values                                                 | Meaning                                                                       |
| --------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `variant`                   | `outline` (default), `primary`, `ghost`, `destructive` | `primary` is the ink button, one per view.                                    |
| `size`                      | `md` (default, 36px), `sm` (32px), `lg` (40px)         |                                                                               |
| `type`                      | `button` (default), `submit`, `reset`                  | `submit` submits the form around it, `reset` resets it.                       |
| `disabled`                  | boolean                                                | Dimmed, out of the tab order, clicks swallowed.                               |
| `loading`                   | boolean                                                | A spinner before the label; stays focusable, `aria-busy`, clicks swallowed.   |
| `href`                      | URL                                                    | A link that looks like a button. `target`, `rel` and `download` pass through. |
| `target`, `rel`, `download` | as on `<a>`                                            | With `href` only.                                                             |
| `full-width`                | boolean                                                | Fills its container's width.                                                  |
| `square`                    | boolean                                                | As wide as it is high, for one glyph. Give it an `aria-label`.                |

`aria-label`, `aria-pressed` and `aria-expanded` are passed to the inner
control. A submit or reset acts after every `click` listener ran, unless one
called `preventDefault()`. Slot: the label (a 16px `<svg>` may sit beside it).

### `<tsy-link>`

An underlined link in the colour of the text around it, ink on hover.

```html
Questions?
<tsy-link href="https://developers.tassyir.io" external>Read the guide</tsy-link
>.
```

| Attribute                   | Values      | Meaning                                                                                     |
| --------------------------- | ----------- | ------------------------------------------------------------------------------------------- |
| `href`                      | URL         | The address.                                                                                |
| `external`                  | boolean     | Opens in a new tab with `rel="noopener noreferrer"`, shows ↗ and says so to screen readers. |
| `target`, `rel`, `download` | as on `<a>` |                                                                                             |

`aria-label` passes to the inner `<a>`. In the dashboard, your app moving to
another of its pages is `bridge.navigate({ path })`; leaving for a dashboard
page is `bridge.navigate({ dashboard })`.

### `<tsy-text-field>`

A labelled input, or a text area with `multiline`.

```html
<tsy-text-field
  name="minimum"
  type="number"
  label="Minimum order total"
  suffix="DZD"
  hint="Orders below it get no request."
></tsy-text-field>
```

| Attribute                                                                                                                           | Values                                                                  | Meaning                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `label`                                                                                                                             | text                                                                    | The field's label. Always give one.                                                   |
| `label-hidden`                                                                                                                      | boolean                                                                 | Keeps the label for screen readers only (a search box).                               |
| `name`                                                                                                                              | text                                                                    | The form field's name.                                                                |
| `value`                                                                                                                             | text                                                                    | The default value; the `value` property is the current one.                           |
| `type`                                                                                                                              | `text` (default), `email`, `number`, `password`, `search`, `tel`, `url` | `email`, `password`, `tel` and `url` are typed left to right in an Arabic page too.   |
| `hint`                                                                                                                              | text                                                                    | A muted line under the field.                                                         |
| `error`                                                                                                                             | text                                                                    | The field's error, in red under it; marks the field invalid for assistive technology. |
| `prefix`, `suffix`                                                                                                                  | text                                                                    | A short unit inside the field, such as `DZD` or `دج`.                                 |
| `required`, `disabled`, `readonly`                                                                                                  | boolean                                                                 |                                                                                       |
| `multiline`                                                                                                                         | boolean                                                                 | A text area.                                                                          |
| `rows`                                                                                                                              | number                                                                  | With `multiline`.                                                                     |
| `placeholder`, `autocomplete`, `inputmode`, `minlength`, `maxlength`, `min`, `max`, `step`, `pattern`, `spellcheck`, `enterkeyhint` | as on `<input>`                                                         | Passed to the inner control.                                                          |

Properties: `value`, `form`, `validity`, `validationMessage`; methods
`select()`, `checkValidity()`, `reportValidity()`, `setCustomValidity()`.
Events: `input` and `change`, from the element.

### `<tsy-select>`

A labelled native select: on a phone, the phone's own picker opens. Write
its `<option>` and `<optgroup>` elements inside it.

```html
<tsy-select name="wilaya" label="Wilaya" placeholder="All wilayas">
  <option value="16">16 · Alger</option>
  <option value="31">31 · Oran</option>
</tsy-select>
```

| Attribute               | Values           | Meaning                                                                  |
| ----------------------- | ---------------- | ------------------------------------------------------------------------ |
| `label`, `label-hidden` |                  | As on `<tsy-text-field>`.                                                |
| `name`                  | text             | The form field's name.                                                   |
| `value`                 | text             | The default choice; else the `selected` option, else the first one.      |
| `placeholder`           | text             | An empty first choice that cannot be picked back; `required` refuses it. |
| `hint`, `error`         | text             | As on `<tsy-text-field>`.                                                |
| `required`, `disabled`  | boolean          |                                                                          |
| `autocomplete`          | as on `<select>` |                                                                          |

The options are mirrored into the inner select whenever they change.
Properties: `value`, `options`, `selectedIndex`, `form`, `validity`. Events:
`input`, `change`.

### `<tsy-checkbox>`

A checkbox with its label as content.

```html
<tsy-checkbox name="notify" checked>Notify the buyer</tsy-checkbox>
```

| Attribute              | Values      | Meaning                                                           |
| ---------------------- | ----------- | ----------------------------------------------------------------- |
| `name`                 | text        | The form field's name.                                            |
| `checked`              | boolean     | Checked by default; the `checked` property is the current state.  |
| `value`                | text (`on`) | What it submits while checked.                                    |
| `indeterminate`        | boolean     | Neither (a "select all" over part of a list); cleared by a click. |
| `hint`, `error`        | text        | Under the label.                                                  |
| `required`, `disabled` | boolean     |                                                                   |

`aria-label` names a checkbox without content (a table's row selection).
Events: `input`, `change`.

### `<tsy-radio-group>` and `<tsy-radio>`

A labelled set of choices. Arrow keys move and choose (mirrored right to
left); the group is one Tab stop.

```html
<tsy-radio-group name="channel" label="Channel" value="sms">
  <tsy-radio value="sms">SMS</tsy-radio>
  <tsy-radio value="whatsapp" hint="Needs a connected number"
    >WhatsApp</tsy-radio
  >
  <tsy-radio value="email" disabled>Email</tsy-radio>
</tsy-radio-group>
```

`<tsy-radio-group>`:

| Attribute              | Values                             | Meaning                                        |
| ---------------------- | ---------------------------------- | ---------------------------------------------- |
| `label`                | text                               | The group's label.                             |
| `name`                 | text                               | The form field's name.                         |
| `value`                | text                               | The default choice; `value` property: current. |
| `hint`, `error`        | text                               | Under the choices.                             |
| `required`, `disabled` | boolean                            | `required` refuses an empty choice.            |
| `orientation`          | `vertical` (default), `horizontal` | Choices in a column, or in a wrapping row.     |

`<tsy-radio>`:

| Attribute  | Values  | Meaning                                         |
| ---------- | ------- | ----------------------------------------------- |
| `value`    | text    | What the group submits when this one is chosen. |
| `hint`     | text    | A muted line under the label.                   |
| `disabled` | boolean | Cannot be chosen, skipped by the arrow keys.    |

Events (from the group): `input`, `change`.

### `<tsy-card>`

The dashboard's content card. With a `heading` it is the layered card: a
tinted header bar with the title in the quiet label style, an optional
count, actions at the end, over a paper body. Without, a plain paper card.

```html
<tsy-card heading="Answers" count="4">
  <tsy-button slot="actions" variant="ghost" size="sm">Export</tsy-button>
  …
</tsy-card>
```

| Attribute       | Values               | Meaning                                                  |
| --------------- | -------------------- | -------------------------------------------------------- |
| `heading`       | text                 | The card's title.                                        |
| `heading-level` | `2` (default) to `6` | The title is an `<h2>` unless you say otherwise.         |
| `count`         | text                 | A count chip beside the title.                           |
| `flush`         | boolean              | No padding in the body (a list or a table edge to edge). |

Slots: the body; `actions`. Never put a card inside a card.

### `<tsy-page-header>`

The page's title, its one `<h1>`, with an optional back link, a muted line
of facts and the page's actions.

```html
<tsy-page-header heading="Order #00001042" back-href="/orders">
  <span slot="meta">Sara Bensalem · Oran</span>
  <tsy-button slot="actions" variant="primary">Confirm</tsy-button>
</tsy-page-header>
```

| Attribute    | Values | Meaning                                                |
| ------------ | ------ | ------------------------------------------------------ |
| `heading`    | text   | The page's title (24px; 22px right to left).           |
| `back-href`  | URL    | Shows a back link above the title.                     |
| `back-label` | text   | The back link's words (default "Back", Arabic «رجوع»). |

Slots: `meta`, `actions`. The dashboard's title bar already shows your app's
name; `bridge.titleBar.set({ title })` adds the page's title beside it.

### `<tsy-table>`

The dashboard's table frame around a native `<table>` you write inside it:
a tinted frame, an optional header bar, a toolbar strip, the rows as a paper
panel that scrolls sideways on a phone, and a footer. The table keeps its
native semantics.

```html
<tsy-table heading="Orders" count="128">
  <tsy-text-field
    slot="toolbar"
    type="search"
    label="Search orders"
    label-hidden
  ></tsy-text-field>
  <table>
    <thead>
      <tr>
        <th>Order</th>
        <th data-align="end">Total</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>#00001042</td>
        <td data-align="end">DZD 9,000</td>
      </tr>
    </tbody>
  </table>
  <div slot="footer">1–20 of 128</div>
</tsy-table>
```

| Attribute       | Values                             | Meaning                                                                                                                  |
| --------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `heading`       | text                               | The frame's title; also the table's name for screen readers, unless it has a caption, `aria-label` or `aria-labelledby`. |
| `heading-level` | `2` (default) to `6`               |                                                                                                                          |
| `count`         | text                               | A count chip beside the title.                                                                                           |
| `density`       | `compact` (default), `comfortable` | Roomier rows.                                                                                                            |

Slots: the `<table>`; `actions`, `toolbar`, `footer`. On cells:
`data-align="end"` aligns a number to the end, `data-wrap` lets a cell wrap.
A row with `aria-selected="true"` is tinted. The table's styles are adopted
into the document (or the shadow root it lives in), in the `tassyir-ui`
cascade layer.

### `<tsy-status-pill>`

The dashboard's only status treatment: a dot, a 12% tint of the tone, the
words in the tone pushed toward ink.

```html
<tsy-status-pill tone="success">Delivered</tsy-status-pill>
<tsy-status-pill color="#e11d48">Called twice</tsy-status-pill>
```

| Attribute  | Values                                                                     | Meaning                                                               |
| ---------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `tone`     | `neutral` (default), `success`, `warning`, `destructive`, `info`, `purple` | The semantic hue.                                                     |
| `color`    | a CSS colour                                                               | A merchant's own status colour, mixed the same way; overrides `tone`. |
| `size`     | `sm` (default), `md`                                                       |                                                                       |
| `hide-dot` | boolean                                                                    | No dot.                                                               |

Slot `icon`: a 16px glyph in place of the dot (a lock, say).

### `<tsy-banner>`

A quiet tinted notice: a glyph, an optional heading, the message and
actions.

```html
<tsy-banner tone="critical" heading="Could not reach 2 buyers">
  The carrier refused their phone numbers.
  <tsy-button slot="actions" size="sm">See who</tsy-button>
</tsy-banner>
```

| Attribute     | Values                                             | Meaning                                                                                         |
| ------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `tone`        | `info` (default), `success`, `warning`, `critical` | `warning` and `critical` are announced (`role="alert"`), the others politely (`role="status"`). |
| `heading`     | text                                               | A bold first line.                                                                              |
| `dismissible` | boolean                                            | A close button.                                                                                 |

Slots: the message; `actions`. Closing fires `tsy-dismiss` (bubbles,
cancelable); unless a listener prevents it, the banner hides. `dismiss()`
does the same from code. A passing confirmation ("Saved") is a toast:
`bridge.toast.show`.

### `<tsy-empty-state>`

What a list says when it has nothing yet. Keep it for a surface with
something to teach; in a form, a plain button says more.

```html
<tsy-empty-state heading="No answers yet">
  Answers appear here once buyers reply.
  <tsy-button slot="actions">Send a test request</tsy-button>
</tsy-empty-state>
```

| Attribute       | Values     | Meaning                                                                     |
| --------------- | ---------- | --------------------------------------------------------------------------- |
| `heading`       | text       | The title.                                                                  |
| `heading-level` | `1` to `6` | Makes the title a heading for assistive technology (it is not, by default). |

Slots: `media` (a glyph), the sentence, `actions`.

### `<tsy-skeleton>`

A loading placeholder in the shape of what is coming. The dashboard shows
skeletons, not spinners, while a page or a card loads.

```html
<tsy-card heading="Orders" aria-busy="true">
  <tsy-skeleton lines="3"></tsy-skeleton>
</tsy-card>
```

| Attribute | Values                              | Meaning                                            |
| --------- | ----------------------------------- | -------------------------------------------------- |
| `shape`   | `line` (default), `block`, `circle` |                                                    |
| `lines`   | number (1 to 20)                    | Lines of text, the last one shorter (`line` only). |
| `width`   | a CSS length (a number is pixels)   |                                                    |
| `height`  | a CSS length (a number is pixels)   |                                                    |

It is hidden from assistive technology; mark the region it stands in
`aria-busy="true"` and clear it when the content arrives. The pulse stops
under reduced motion.

### `<tsy-spinner>`

In-place loading: a button, a row.

```html
<tsy-spinner size="sm" label="Loading orders"></tsy-spinner>
```

| Attribute | Values                                         | Meaning                                                               |
| --------- | ---------------------------------------------- | --------------------------------------------------------------------- |
| `size`    | `md` (default, 24px), `sm` (16px), `lg` (32px) |                                                                       |
| `label`   | text                                           | What screen readers hear (default "Loading", in the page's language). |

## Forms

`<tsy-text-field>`, `<tsy-select>`, `<tsy-checkbox>`, `<tsy-radio-group>` and
`<tsy-button>` are form-associated custom elements: they submit with the
native `<form>` around them (`FormData`, a normal submit), take part in its
validation (`required`, the input's own constraints, `setCustomValidity`),
are reset with it and follow a disabled `<fieldset>`. Enter in a one-line
field does what it does in a native one: it clicks the form's first submit
button (nothing happens while that button is disabled or `loading`, so a
save in flight is not sent twice); with no submit button, it submits a form
that has only that one field.

- Label every field with its `label` attribute. A `<label for>` outside the
  element does not reach the input inside it.
- `error` shows a message and marks the field invalid for assistive
  technology, but does not block the form: it is for your server's answer.
  To block, call `setCustomValidity(message)`.
- In the dashboard, saving a form the merchant edits is the dashboard's save
  bar: `bridge.saveBar.show()` and its `saveBar.save` / `saveBar.discard`
  events.

## Tokens

Importing the package adopts the tokens into the document. Use them in your
own CSS:

```css
.summary {
  padding: var(--tsy-space-grid);
  border: 1px solid var(--tsy-color-hairline);
  border-radius: var(--tsy-radius-control);
  color: var(--tsy-color-ink-secondary);
}
```

- Colours, both themes: `--tsy-color-ink`, `-ink-secondary`, `-ink-tertiary`,
  `-paper`, `-paper-sunken`, `-muted-fill`, `-accent-fill`, `-hairline`,
  `-field`, `-on-ink`, `-skeleton`, `-brand-cyan`, `-success`,
  `-success-soft`, `-warning`, `-warning-ink`, `-warning-soft`, `-info`,
  `-info-soft`, `-destructive`, `-destructive-on`, `-destructive-soft`,
  `-purple`, `-pill-surface`, `-pill-ink`, `-control-hover`, `-ghost-hover`,
  `-destructive-fill`; shadows `--tsy-shadow-paper`, `--tsy-shadow-control`.
- Type: `--tsy-font-sans`, `--tsy-font-mono`; sizes `--tsy-font-size-body`,
  `-label` (14px), `-title` (18px), `-headline` (20px), `-page-title` (24px),
  `-page-title-rtl` (22px); weights `--tsy-font-weight-regular` (400),
  `-medium` (500), `-semibold` (600), `-bold` (700, the page title only);
  `--tsy-line-height-*`.
- Space: `--tsy-space-hint` (6px), `-hug` (8px), `-cluster` (12px), `-grid`
  (16px), `-section` (24px). Radii: `--tsy-radius-control` (12px), `-nested`
  (8px), `-pill`.

The same values are data in `@tassyir/ui/tokens` (no DOM, safe on a server:
`colors.dark.ink`, `breakpoints.sm`, …) and a stylesheet in
`@tassyir/ui/tokens.css` for a page that wants the tokens without the
elements. They sit in the `tassyir-ui` cascade layer, with the page's
defaults (paper background, ink text, the Tassyir type, 14px body) at zero
specificity, so any rule of yours wins.

## Fonts

The dashboard sets Geist (Latin) and IBM Plex Sans Arabic. This package loads
no font, so nothing leaves your page; the type falls back to the system's
sans. To show the exact faces, serve them yourself (both are under the SIL
Open Font License) under those family names:

```css
@font-face {
  font-family: 'Geist';
  src: url('/fonts/geist.woff2') format('woff2');
  font-weight: 100 900;
}
@font-face {
  font-family: 'IBM Plex Sans Arabic';
  src: url('/fonts/ibm-plex-sans-arabic-500.woff2') format('woff2');
  font-weight: 500;
}
```

## Styling

Every element draws in its own shadow root, so your CSS cannot break it by
accident, and the tokens reach inside. To adjust one, style the element
itself (`tsy-card { margin-block: 24px }`) or a part:
`tsy-text-field::part(box)`. Parts: `base`, `control`, `label`, `hint`,
`error`, `box`, `prefix`, `suffix`, `row`, `heading`, `count`, `actions`,
`body`, `header`, `meta`, `back`, `toolbar`, `footer`, `scroll`, `dot`,
`media`, `dismiss`, `bar`, `link`, `options`. To hide elements until they
are defined, add `:not(:defined) { visibility: hidden }`.

## Accessibility

Built in: a label on every field, its hint and error read with it, a
visible focus ring on every control, the arrow-key radio group, a 32px close
button, live regions for banners and spinners, text pairs measured at 4.5:1
or more in both themes (a spec measures every pair the elements paint), and
motion stopped or slowed under `prefers-reduced-motion`. Your page's part:
the one `<h1>` is `<tsy-page-header>`'s; give icon-only buttons an
`aria-label`; mark loading regions `aria-busy`.

## Content-Security-Policy, Trusted Types, server rendering

The elements write no `<style>` element and no `style` attribute (styles are
constructable stylesheets; colours set through the CSSOM) and never assign
HTML (`createElement` only). A page served with `style-src 'self'`,
`script-src 'self'` and `require-trusted-types-for 'script'` works; the demo
is served that way. Importing the package on a server defines nothing and
throws nothing.

## Size

Minified and gzipped, as an app's bundler ships it (`npm run size -w @tassyir/ui`):

| Import                                         | Minified | Gzipped |
| ---------------------------------------------- | -------- | ------- |
| everything (`@tassyir/ui`)                     | 50.9 kB  | 13.0 kB |
| the shared core (base class, tokens)           | 5.0 kB   | 2.0 kB  |
| `tsy-button` alone, with the core              | 11.8 kB  | 4.2 kB  |
| `tsy-link` alone, with the core                | 8.3 kB   | 3.4 kB  |
| `tsy-text-field` alone, with the core          | 11.9 kB  | 4.2 kB  |
| `tsy-select` alone, with the core              | 16.1 kB  | 5.3 kB  |
| `tsy-checkbox` alone, with the core            | 11.3 kB  | 4.1 kB  |
| `tsy-radio-group` + `tsy-radio`, with the core | 12.5 kB  | 4.5 kB  |
| `tsy-card` alone, with the core                | 7.7 kB   | 2.8 kB  |
| `tsy-page-header` alone, with the core         | 9.4 kB   | 3.7 kB  |
| `tsy-table` alone, with the core               | 10.9 kB  | 3.6 kB  |
| `tsy-status-pill` alone, with the core         | 7.1 kB   | 2.8 kB  |
| `tsy-banner` alone, with the core              | 10.1 kB  | 3.9 kB  |
| `tsy-empty-state` alone, with the core         | 7.1 kB   | 2.7 kB  |
| `tsy-skeleton` alone, with the core            | 6.6 kB   | 2.7 kB  |
| `tsy-spinner` alone, with the core             | 7.6 kB   | 3.2 kB  |

Most of it is CSS. The package is one entry today (`import '@tassyir/ui'`
defines every element).

## Checking against the dashboard

`src/frontend-parity.test.ts` compares this package with the dashboard's own
design in the private `tassyir/frontend` repository: every colour token
against the palette blocks of `app/[locale]/globals.css`, string for string
in both themes; DESIGN.md's front matter (colours, radii, spacing, type, the
button, input and card); and the classes of the dashboard's primitives each
element mirrors. CI cannot reach that repository, so it runs locally:

```bash
TASSYIR_FRONTEND_DIR=../frontend npm run parity -w @tassyir/ui
```

It reads `origin/main` (or `TASSYIR_FRONTEND_REF`) with `git show`; run
`git -C ../frontend fetch origin` first.

`npm run browser-check -w @tassyir/ui` (after `npm run build`) runs the demo
in a headless Chrome under a strict Content-Security-Policy: real form
submission and validity, the keyboard, the accessibility tree, and the demo
in Arabic and English, light and dark, at 390 and 1440 px, with a screenshot
of each (`--out <dir>`). `npm run demo -w @tassyir/ui` serves the demo at
http://localhost:4178/demo/.

## Not here yet

React and JSX typings for the elements, a `custom-elements.json` manifest
for editors, per-element entry points, and more elements (tabs, a stat card,
a popover) come in later releases.
