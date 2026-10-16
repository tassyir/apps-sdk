# @tassyir/storefront-blocks

The language of Tassyir's declarative storefront blocks: the HTML an app adds
to a merchant's store pages, written as a template in a subset of
[Liquid](https://shopify.github.io/liquid/) with an optional stylesheet. This
package validates a block (every error with a `code`, a `line`, a `column`
and a `fix`) and renders it. The Tassyir API checks uploads with it, the
store builder previews with it, the storefront renders with it, and the
`tassyir` CLI uses it for `tassyir block preview`: one code, the same answer
everywhere.

**Not live yet.** Storefront blocks open with the Tassyir app marketplace.
Until then the API refuses `[[storefront.blocks]]` in a manifest. The
language is published now so that you can write and test blocks.

It has no dependency and reads no file, clock, network or randomness. It
never uses `Intl`. The same template and data give the same bytes in Node and
in every browser. ESM and CommonJS, named exports only.

## Install

```bash
npm install @tassyir/storefront-blocks
```

## Example

A block that shows a product's rating, read from the app's data:

```ts
import {
  renderBlock,
  sampleBlockContext,
  validateBlock,
} from '@tassyir/storefront-blocks';
import type { BlockDeclaration } from '@tassyir/storefront-blocks';

const declaration: BlockDeclaration = {
  target: 'product',
  settings: [
    {
      key: 'title',
      type: 'text',
      default: { ar: 'آراء الزبائن', en: 'Reviews' },
    },
    { key: 'accent_color', type: 'color', default: '#0b6e4f' },
  ],
  data: ['product.rating'],
};

const template = `<section class="rating">
  <h3>{{ block.settings.title | t }}</h3>
  {%- assign rating = app.data.product.rating -%}
  {%- if rating %}
  <p>{{ rating.average | stars }} <small>({{ rating.count }})</small></p>
  {%- else %}
  <p>{{ product.name }}</p>
  {%- endif %}
</section>`;

const stylesheet = `.rating { color: var(--block-accent-color); border-radius: var(--st-radius); }`;

// The upload check: the template, the stylesheet, and a render with sample data.
const check = validateBlock({ template, stylesheet, declaration });
if (!check.ok) {
  for (const error of check.errors) {
    console.error(
      `${error.code} ${error.source}:${String(error.line)}:${String(error.column)} ${error.message} ${error.fix}`,
    );
  }
  process.exit(1);
}

// A preview with sample data and your own app data.
const result = renderBlock(
  template,
  sampleBlockContext(declaration, {
    language: 'en',
    appData: { product: { rating: { average: 4.4, count: 128 } } },
  }),
  declaration,
);
if (result.ok) console.log(result.html);
```

Rendered (byte for byte, the README's spec checks it):

```text
<section class="rating">
  <h3>Reviews</h3>
  <p><span class="tsy-stars" role="img" aria-label="Rated 4.4 out of 5">★★★★☆</span> <small>(128)</small></p>
</section>
```

The full language (objects, tags, filters, HTML and CSS rules) is in the
[storefront blocks guide](https://developers.tassyir.io/guides/storefront-blocks).

## What you get back

`validateBlock`, `compileBlockTemplate` and `renderBlock` never throw. They
return `{ ok: true, … }` or `{ ok: false, errors }`. Each error has this shape:

```ts
interface BlockError {
  code: BlockErrorCode; // stable: switch on it
  source: 'template' | 'stylesheet' | 'render';
  line: number; // 1-based; 0 for a render limit
  column: number; // 1-based, in UTF-16 code units, as editors count
  message: string;
  fix: string; // one sentence to act on
}
```

Errors are sorted by position, at most 50 per file (the last one says how
many more there were). The same input always gives the same errors in the same
order.

| Code                                | When                                                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `BLOCK_TEMPLATE_NOT_TEXT`           | The template (or stylesheet) is not a string, or holds a NUL character.                         |
| `BLOCK_TEMPLATE_EMPTY`              | The template is empty or only spaces.                                                           |
| `BLOCK_TEMPLATE_TOO_LARGE`          | Over 16 KB.                                                                                     |
| `BLOCK_STYLESHEET_TOO_LARGE`        | Over 8 KB.                                                                                      |
| `BLOCK_CHARACTER_NOT_ALLOWED`       | A bidi override or isolate, an invisible or control character, `<` in a stylesheet.             |
| `BLOCK_LIQUID_UNTERMINATED`         | `{{` or `{%` never closed.                                                                      |
| `BLOCK_LIQUID_SYNTAX`               | An expression the language cannot read.                                                         |
| `BLOCK_TAG_UNKNOWN`                 | A tag Liquid does not have.                                                                     |
| `BLOCK_TAG_NOT_SUPPORTED`           | A Liquid tag blocks do not have (`include`, `render`, `raw`, `form`, `schema`, …).              |
| `BLOCK_TAG_UNCLOSED`                | `if`, `for`, `case`, `capture` or `comment` without its end tag.                                |
| `BLOCK_TAG_UNEXPECTED`              | An end, `else`, `elsif`, `when`, `break` or `continue` outside its block.                       |
| `BLOCK_NESTING_TOO_DEEP`            | More than 10 Liquid blocks inside one another.                                                  |
| `BLOCK_LOOP_NESTING_TOO_DEEP`       | More than 3 `for` loops inside one another.                                                     |
| `BLOCK_LOOP_LIMIT_TOO_HIGH`         | A literal `limit:` or range over 50.                                                            |
| `BLOCK_FILTER_UNKNOWN`              | A filter that does not exist.                                                                   |
| `BLOCK_FILTER_NOT_SUPPORTED`        | A Liquid filter blocks do not have (`raw`, `date`, `json`, `img_url`, …).                       |
| `BLOCK_FILTER_ARGUMENTS`            | The wrong number of arguments, or a named argument.                                             |
| `BLOCK_FILTER_CHAIN_TOO_LONG`       | More than 10 filters in one expression.                                                         |
| `BLOCK_VARIABLE_UNKNOWN`            | A name that is neither a block object nor a variable the template assigns.                      |
| `BLOCK_OBJECT_NOT_AVAILABLE`        | `product` (or product app data) in a block whose target is not `product`.                       |
| `BLOCK_PROPERTY_UNKNOWN`            | A property the object does not have (`store.phone`).                                            |
| `BLOCK_SETTING_UNDECLARED`          | A setting (`block.settings.x`, `var(--block-x)`) the block does not declare.                    |
| `BLOCK_DATA_KEY_UNDECLARED`         | App data the block does not list in its `data`.                                                 |
| `BLOCK_DATA_OWNER_UNKNOWN`          | App data of an owner blocks cannot read (`order`, `customer`).                                  |
| `BLOCK_ASSIGN_RESERVED`             | Assigning `block`, `product`, `store`, `app` or `forloop`.                                      |
| `BLOCK_TOO_MANY_VARIABLES`          | More than 64 variables.                                                                         |
| `BLOCK_HTML_TAG_NOT_ALLOWED`        | An element blocks cannot use (`script`, `style`, `form`, `iframe`, `h1`, …).                    |
| `BLOCK_HTML_ATTRIBUTE_NOT_ALLOWED`  | An attribute blocks cannot use (`id`, `data-*`, …).                                             |
| `BLOCK_HTML_STYLE_ATTRIBUTE`        | A `style` attribute.                                                                            |
| `BLOCK_HTML_EVENT_HANDLER`          | An `on…` attribute.                                                                             |
| `BLOCK_HTML_URL_NOT_ALLOWED`        | A link that is not `https://`, a store path or a `#fragment`.                                   |
| `BLOCK_HTML_IMAGE_SOURCE`           | An `<img>` whose `src` is not one `{{ … \| image_url: <width> }}`.                              |
| `BLOCK_HTML_ATTRIBUTE_VALUE`        | A value the attribute does not accept, or `stars` inside an attribute.                          |
| `BLOCK_HTML_DYNAMIC_TAG`            | An element name made by Liquid (`<{{ x }}>`).                                                   |
| `BLOCK_HTML_DYNAMIC_ATTRIBUTE`      | An attribute name made by Liquid.                                                               |
| `BLOCK_HTML_UNQUOTED_ATTRIBUTE`     | Liquid in an attribute value without quotes.                                                    |
| `BLOCK_HTML_UNTERMINATED_TAG`       | A tag never closed with `>`.                                                                    |
| `BLOCK_HTML_TOO_DEEP`               | More than 32 elements inside one another.                                                       |
| `BLOCK_HTML_ENTITY_UNKNOWN`         | A named character reference the language does not know.                                         |
| `BLOCK_CSS_SYNTAX`                  | An unclosed string, comment, bracket or block, a nested rule.                                   |
| `BLOCK_CSS_AT_RULE_NOT_ALLOWED`     | An at-rule other than `@media`, `@supports` and `@keyframes <name>`.                            |
| `BLOCK_CSS_URL_NOT_ALLOWED`         | A `url()` outside `https://cdn.tassyir.io/`.                                                    |
| `BLOCK_CSS_FUNCTION_NOT_ALLOWED`    | A CSS function blocks cannot use (`expression()`, `image-set()`, …).                            |
| `BLOCK_CSS_DECLARATION_NOT_ALLOWED` | `position` not one written `static`/`relative`/`absolute`/`sticky`; `behavior`, `-moz-binding`. |
| `BLOCK_CSS_ESCAPE_NOT_ALLOWED`      | A backslash escape outside a quoted string.                                                     |
| `BLOCK_CSS_THEME_VARIABLE_UNKNOWN`  | A `--st-*` variable that is not published.                                                      |
| `BLOCK_RENDER_CONTEXT_INVALID`      | The render context has no store.                                                                |
| `BLOCK_RENDER_STEP_LIMIT`           | The render used more than 20,000 steps.                                                         |
| `BLOCK_RENDER_OUTPUT_LIMIT`         | The rendered HTML is over 32 KB.                                                                |
| `BLOCK_RENDER_STRING_LIMIT`         | A string the template builds is over 32,768 characters.                                         |
| `BLOCK_RENDER_ARRAY_LIMIT`          | A list the template builds has more than 500 items.                                             |
| `BLOCK_RENDER_DATA_TOO_LARGE`       | The data is over 32 KB, nested deeper than 16, or holds a list of more than 500 items.          |
| `BLOCK_RENDER_FAILED`               | The renderer stopped on an error it does not name (report it).                                  |

## Limits

All in `BLOCK_LIMITS`, the same everywhere:

| Limit                                    | Value        |
| ---------------------------------------- | ------------ |
| Template                                 | 16 KB        |
| Stylesheet                               | 8 KB         |
| Blocks per app version                   | 20           |
| Block files per version                  | 100 KB       |
| Rendered HTML                            | 32 KB        |
| App data one render reads                | 32 KB        |
| Render work                              | 20,000 steps |
| Iterations of one `for` loop             | 50           |
| `for` loops inside one another           | 3            |
| Liquid blocks inside one another         | 10           |
| HTML elements inside one another         | 32           |
| Filters in one expression                | 10           |
| Variables                                | 64           |
| Items in a list a template builds        | 500          |
| Characters in a string a template builds | 32,768       |

Render time is counted in **steps**, never measured with a clock: every text
run, output, tag, loop iteration and condition costs a step, and every filter
and comparison one more per 256 characters or items it touches. The same
template and data always finish, or always stop at the same step. The heaviest
render the budget allows takes a few milliseconds.

## How it stays safe

A block runs on the page that holds the store's order form, so the language
is built to make anything else impossible:

- **Every output is escaped.** There is no `raw` filter and no way to turn
  escaping off. Only Tassyir's own `stars` filter makes markup, from fixed
  parts.
- **No prototype, method or getter is reachable.** The data a render is given
  is copied into maps and frozen arrays; a template reads own keys and indexes
  only.
- **The HTML is rebuilt, not filtered.** Every render's output is parsed and
  written out again from an allowlist (`BLOCK_HTML_ALLOWLIST`): allowed
  elements and attributes only, every value checked and quoted, every text
  escaped, comments and raw-text elements removed, SVG shapes only inside
  `<svg>`. The browser parses that canonical HTML, never the template's.
  Sanitising the output again leaves it unchanged.
- **Only declared data reaches the template.** A compiled template keeps its
  declaration's app data keys and setting keys, and a render passes the
  template only those, through every alias (`{% assign d = app.data.store %}`).
- **Execution is bounded by counting**, never by a clock, so the bound holds
  on every machine and cannot be raced.
- **The box is the host's.** This package decides what the HTML and the
  stylesheet may say; it cannot keep a block's pixels inside its section. The
  page that renders a block must contain it: `contain: paint` (and
  `isolation: isolate`) on the block's section. The stylesheet check refuses
  `position: fixed` in every spelling, but `position: absolute`, transforms
  and the page's own utility classes are ordinary CSS that only containment
  keeps in the box.
- **Nothing differs between machines**: no `Intl`, no clock, no randomness, no
  locale method, no Unicode property table.

Why not a Liquid engine with features switched off: an engine brings its
tags (file includes among them), its filters (the clock, locale formatting)
and its options to keep switched off release after release. Its time limit is
a wall clock checked between renders, not inside a loop. This package has
only what blocks need, so there is nothing to switch off.

The proof is in the specs: a seeded corpus of more than 1,600 templates and
data planted with known sanitiser bypasses (tag and attribute smuggling,
raw-text and SVG/MathML parser switches, `javascript:` and `data:` URLs in
their encodings, character-reference tricks, bidi and zero-width characters,
CSS `url()` and `expression()`, deep nesting, huge loops), each rendered and
parsed by a spec-compliant HTML parser. Not one forbidden element, attribute
or URL comes out. Every limit stops its runaway case. The browser bundle
renders the corpus to the same bytes as Node.

## API

| Export                                                   | What it does                                                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `validateBlock({ template, stylesheet?, declaration? })` | The upload check: compile, stylesheet, sample render in Arabic, French and English.                          |
| `compileBlockTemplate(source, declaration?, options?)`   | Checks a template and returns a reusable, frozen compiled template. `checks: 'syntax'` skips all but syntax. |
| `renderBlock(template, context, declaration?)`           | Renders a source or a compiled template with one context: the gated HTML and its stats.                      |
| `renderCompiledBlock(template, context)`                 | The same, for a compiled template.                                                                           |
| `validateBlockStylesheet(css, declaration?)`             | Checks a stylesheet.                                                                                         |
| `sanitizeBlockHtml(html)`                                | The HTML gate every render goes through.                                                                     |
| `resolveBlockSettings(settings, values)`                 | The setting values a block renders with: valid values, else defaults.                                        |
| `blockCssVariables(settings, values)`                    | The `--block-<key>` CSS variables of colour settings, for the block's section.                               |
| `sampleBlockContext(declaration?, options?)`             | A complete render context with sample data, for previews.                                                    |
| `imageUrl(url, width)`                                   | What the `image_url` filter returns.                                                                         |
| `linkKind(url)`                                          | `external`, `store`, `fragment`, or null for a link blocks cannot have.                                      |
| `isBlockImageSource(url)`                                | Whether an `<img src>` is one `image_url` makes.                                                             |
| `formatMoney(amount, currency, language)`                | What the `money` filter returns.                                                                             |
| `blockErrorFix(code)`                                    | The default fix of a code.                                                                                   |
| `blockSettingVariable(key)`                              | The CSS variable of a colour setting.                                                                        |

Constants: `BLOCK_LIMITS`, `BLOCK_ERROR_CODES`, `BLOCK_FILTERS`,
`BLOCK_HTML_ALLOWLIST`, `BLOCK_ROLES`, `BLOCK_NAMED_ENTITIES`,
`STOREFRONT_THEME_VARIABLES`, `BLOCK_PRODUCT_FIELDS`, `BLOCK_STORE_FIELDS`,
`BLOCK_FORLOOP_FIELDS`, `BLOCK_OBJECTS`, `BLOCK_DATA_OWNERS`,
`IMAGE_URL_WIDTHS`, `IMAGE_CDN_ORIGIN`, `RENDER_STEP_COSTS`,
`BLOCK_DIALECT_VERSION`.

## Checking it in real browsers

The specs run the browser bundle in an empty JavaScript context. To run it in
real engines (local, needs Chrome; macOS's JavaScriptCore when present):

```bash
npm run build -w @tassyir/storefront-blocks
npm run browser-parity -w @tassyir/storefront-blocks
```

It renders the corpus from the built package in Node, headless Chrome and
JavaScriptCore, compares the bytes, and checks every rendered block with
Chrome's own HTML parser.
