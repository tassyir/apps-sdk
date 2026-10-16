/**
 * What a block's HTML may contain: a strict subset of the builder's
 * `custom_html` gate (DOMPurify's html + svg profiles minus its forbidden
 * tags and attributes), so the builder's own sanitiser never removes what this
 * package kept. Exported as data so the frontend can prove the subset.
 *
 * Left out on purpose:
 * - script, style, iframe, object, embed, form and every form control,
 *   template, noscript, link, meta, base: code, other documents, forms;
 * - `h1`: the page's own heading;
 * - `id` and `name`: an element with an id becomes a global (`window.fbq`),
 *   which can switch off a tracking pixel or a page script (DOM clobbering);
 * - `style`: styles live in the block's stylesheet, scoped to the block;
 * - every `on*` handler, `data-*`, `srcset`, `form`, `formaction`, `ping`,
 *   `srcdoc`, `xlink:*`: code, other forms, other requests;
 * - SVG beyond plain shapes: no `use`, `image`, `a`, `foreignObject`,
 *   animation, filter or gradient (their `url(#id)` needs an id).
 */

export type AttributeRule =
  | { kind: 'text' }
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'integer'; min: number; max: number }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'classes' }
  | { kind: 'link' }
  | { kind: 'image' }
  | { kind: 'language' }
  | { kind: 'datetime' }
  | { kind: 'svg-path' }
  | { kind: 'svg-points' }
  | { kind: 'svg-viewbox' }
  | { kind: 'svg-length' }
  | { kind: 'svg-paint' }
  | { kind: 'svg-transform' }
  | { kind: 'svg-dasharray' }
  | { kind: 'svg-aspect' }
  | { kind: 'fixed'; value: string };

type AttributeRules = Readonly<Record<string, AttributeRule>>;

const TEXT: AttributeRule = { kind: 'text' };
const NUMBER: AttributeRule = { kind: 'number' };
const SVG_LENGTH: AttributeRule = { kind: 'svg-length' };
const SVG_PAINT: AttributeRule = { kind: 'svg-paint' };

/** ARIA roles a block may give an element. */
export const BLOCK_ROLES = Object.freeze([
  'article',
  'definition',
  'figure',
  'group',
  'heading',
  'img',
  'list',
  'listitem',
  'meter',
  'none',
  'note',
  'presentation',
  'progressbar',
  'region',
  'separator',
  'status',
  'term',
]);

/** Attributes every HTML element may have. */
const HTML_GLOBAL: AttributeRules = {
  class: { kind: 'classes' },
  title: TEXT,
  lang: { kind: 'language' },
  dir: { kind: 'enum', values: ['ltr', 'rtl', 'auto'] },
  translate: { kind: 'enum', values: ['yes', 'no'] },
  hidden: { kind: 'boolean' },
  role: { kind: 'enum', values: BLOCK_ROLES },
  'aria-label': TEXT,
  'aria-hidden': { kind: 'enum', values: ['true', 'false'] },
  'aria-level': { kind: 'integer', min: 1, max: 6 },
  'aria-roledescription': TEXT,
  'aria-valuemin': NUMBER,
  'aria-valuemax': NUMBER,
  'aria-valuenow': NUMBER,
  'aria-valuetext': TEXT,
};

const NONE: AttributeRules = {};

/** HTML elements, with the attributes each adds to the global ones. */
const HTML_ELEMENTS: Readonly<Record<string, AttributeRules>> = {
  a: {
    href: { kind: 'link' },
    target: { kind: 'enum', values: ['_blank', '_self'] },
  },
  abbr: NONE,
  article: NONE,
  aside: NONE,
  b: NONE,
  bdi: NONE,
  bdo: NONE,
  blockquote: NONE,
  br: NONE,
  caption: NONE,
  cite: NONE,
  code: NONE,
  dd: NONE,
  del: { datetime: { kind: 'datetime' } },
  details: { open: { kind: 'boolean' } },
  dfn: NONE,
  div: NONE,
  dl: NONE,
  dt: NONE,
  em: NONE,
  figcaption: NONE,
  figure: NONE,
  footer: NONE,
  h2: NONE,
  h3: NONE,
  h4: NONE,
  h5: NONE,
  h6: NONE,
  header: NONE,
  hr: NONE,
  i: NONE,
  img: {
    src: { kind: 'image' },
    alt: TEXT,
    width: { kind: 'integer', min: 1, max: 4000 },
    height: { kind: 'integer', min: 1, max: 4000 },
  },
  ins: { datetime: { kind: 'datetime' } },
  kbd: NONE,
  li: { value: { kind: 'integer', min: -1_000_000, max: 1_000_000 } },
  mark: NONE,
  meter: {
    value: NUMBER,
    min: NUMBER,
    max: NUMBER,
    low: NUMBER,
    high: NUMBER,
    optimum: NUMBER,
  },
  ol: {
    start: { kind: 'integer', min: -1_000_000, max: 1_000_000 },
    reversed: { kind: 'boolean' },
    type: { kind: 'enum', values: ['1', 'a', 'A', 'i', 'I'] },
  },
  p: NONE,
  pre: NONE,
  progress: { value: NUMBER, max: NUMBER },
  q: NONE,
  s: NONE,
  samp: NONE,
  section: NONE,
  small: NONE,
  span: NONE,
  strong: NONE,
  sub: NONE,
  summary: NONE,
  sup: NONE,
  table: NONE,
  tbody: NONE,
  td: {
    colspan: { kind: 'integer', min: 1, max: 50 },
    rowspan: { kind: 'integer', min: 1, max: 100 },
  },
  tfoot: NONE,
  th: {
    colspan: { kind: 'integer', min: 1, max: 50 },
    rowspan: { kind: 'integer', min: 1, max: 100 },
    scope: { kind: 'enum', values: ['row', 'col', 'rowgroup', 'colgroup'] },
  },
  thead: NONE,
  time: { datetime: { kind: 'datetime' } },
  tr: NONE,
  u: NONE,
  ul: NONE,
  var: NONE,
  wbr: NONE,
};

/** Elements with no end tag. */
export const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  'br',
  'hr',
  'img',
  'wbr',
]);

/** Attributes every SVG element may have (presentation and accessibility). */
const SVG_GLOBAL: AttributeRules = {
  class: { kind: 'classes' },
  role: { kind: 'enum', values: BLOCK_ROLES },
  'aria-label': TEXT,
  'aria-hidden': { kind: 'enum', values: ['true', 'false'] },
  fill: SVG_PAINT,
  stroke: SVG_PAINT,
  'stroke-width': SVG_LENGTH,
  'stroke-linecap': { kind: 'enum', values: ['butt', 'round', 'square'] },
  'stroke-linejoin': { kind: 'enum', values: ['miter', 'round', 'bevel'] },
  'stroke-dasharray': { kind: 'svg-dasharray' },
  'stroke-dashoffset': SVG_LENGTH,
  'stroke-opacity': SVG_LENGTH,
  'fill-opacity': SVG_LENGTH,
  'fill-rule': { kind: 'enum', values: ['nonzero', 'evenodd'] },
  'clip-rule': { kind: 'enum', values: ['nonzero', 'evenodd'] },
  opacity: SVG_LENGTH,
  transform: { kind: 'svg-transform' },
};

/** SVG elements, allowed inside `<svg>` only, never outside it. */
const SVG_ELEMENTS: Readonly<Record<string, AttributeRules>> = {
  svg: {
    xmlns: { kind: 'fixed', value: 'http://www.w3.org/2000/svg' },
    viewbox: { kind: 'svg-viewbox' },
    width: SVG_LENGTH,
    height: SVG_LENGTH,
    preserveaspectratio: { kind: 'svg-aspect' },
  },
  g: NONE,
  path: { d: { kind: 'svg-path' } },
  circle: { cx: SVG_LENGTH, cy: SVG_LENGTH, r: SVG_LENGTH },
  ellipse: { cx: SVG_LENGTH, cy: SVG_LENGTH, rx: SVG_LENGTH, ry: SVG_LENGTH },
  line: { x1: SVG_LENGTH, y1: SVG_LENGTH, x2: SVG_LENGTH, y2: SVG_LENGTH },
  polygon: { points: { kind: 'svg-points' } },
  polyline: { points: { kind: 'svg-points' } },
  rect: {
    x: SVG_LENGTH,
    y: SVG_LENGTH,
    width: SVG_LENGTH,
    height: SVG_LENGTH,
    rx: SVG_LENGTH,
    ry: SVG_LENGTH,
  },
  title: NONE,
};

/** SVG attribute names as the browser writes them (the parser fixes their
 * case in foreign content; the sanitiser writes them already fixed). */
export const SVG_ATTRIBUTE_CASE: Readonly<Record<string, string>> = {
  viewbox: 'viewBox',
  preserveaspectratio: 'preserveAspectRatio',
};

/**
 * Where an element is: HTML, inside `<svg>`, or inside an SVG `<title>`.
 * An SVG `title` is an HTML integration point: the browser parses what is
 * inside it as HTML, so a shape there would become an HTML element. It holds
 * text only.
 */
export type Namespace = 'html' | 'svg' | 'text';

/** The namespace of an allowed element's content. */
export function childNamespace(name: string, ns: Namespace): Namespace {
  if (name === 'svg' && ns === 'html') return 'svg';
  if (name === 'title' && ns === 'svg') return 'text';
  return ns;
}

/** The element's attribute rules, or undefined when the element is not
 * allowed in that namespace. `svg` itself opens from HTML. */
export function elementRules(
  name: string,
  ns: Namespace,
): AttributeRules | undefined {
  if (ns === 'text') return undefined;
  if (ns === 'svg')
    return name !== 'svg' && Object.hasOwn(SVG_ELEMENTS, name)
      ? SVG_ELEMENTS[name]
      : undefined;
  if (name === 'svg') return SVG_ELEMENTS['svg'];
  return Object.hasOwn(HTML_ELEMENTS, name) ? HTML_ELEMENTS[name] : undefined;
}

/** The rule for one attribute of an allowed element, or undefined. */
export function attributeRule(
  element: string,
  attribute: string,
  ns: Namespace,
): AttributeRule | undefined {
  const own = elementRules(element, ns);
  if (!own) return undefined;
  if (Object.hasOwn(own, attribute)) return own[attribute];
  const isSvg = ns !== 'html' || element === 'svg';
  const global = isSvg ? SVG_GLOBAL : HTML_GLOBAL;
  return Object.hasOwn(global, attribute) ? global[attribute] : undefined;
}

/**
 * The allowlist as plain data: elements and their attributes, by namespace.
 * `npm` consumers (the builder's parity spec) compare it with DOMPurify's.
 */
export const BLOCK_HTML_ALLOWLIST = Object.freeze({
  html: Object.freeze(
    Object.fromEntries(
      Object.entries(HTML_ELEMENTS).map(([name, rules]) => [
        name,
        Object.freeze(
          [...Object.keys(rules), ...Object.keys(HTML_GLOBAL)].sort(),
        ),
      ]),
    ),
  ),
  svg: Object.freeze(
    Object.fromEntries(
      Object.entries(SVG_ELEMENTS).map(([name, rules]) => [
        name,
        Object.freeze(
          [...Object.keys(rules), ...Object.keys(SVG_GLOBAL)]
            .map((attr) => SVG_ATTRIBUTE_CASE[attr] ?? attr)
            .sort(),
        ),
      ]),
    ),
  ),
  /** Attributes the sanitiser writes itself, whatever the template says. */
  computed: Object.freeze({
    a: Object.freeze(['rel']),
    img: Object.freeze(['loading', 'decoding']),
  }),
}) as {
  readonly html: Readonly<Record<string, readonly string[]>>;
  readonly svg: Readonly<Record<string, readonly string[]>>;
  readonly computed: Readonly<Record<string, readonly string[]>>;
};
