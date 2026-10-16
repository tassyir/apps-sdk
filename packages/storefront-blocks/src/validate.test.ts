import { describe, expect, it } from 'vitest';
import type { BlockDeclaration, BlockError, BlockErrorCode } from './index.js';
import {
  BLOCK_ERROR_CODES,
  BLOCK_LIMITS,
  blockErrorFix,
  compileBlockTemplate,
  renderBlock,
  sampleBlockContext,
  validateBlock,
  validateBlockStylesheet,
} from './index.js';

const RLO = String.fromCharCode(0x202e);
const PRODUCT: BlockDeclaration = { target: 'product', settings: [], data: [] };

function templateErrors(
  template: unknown,
  declaration: BlockDeclaration = PRODUCT,
): BlockError[] {
  const result = compileBlockTemplate(template, declaration);
  return result.ok ? [] : result.errors;
}

/** Every code, with the smallest input that raises it and where. */
const CASES: Record<
  BlockErrorCode,
  () => { errors: BlockError[]; at?: [number, number] }
> = {
  BLOCK_TEMPLATE_NOT_TEXT: () => ({ errors: templateErrors(42) }),
  BLOCK_TEMPLATE_EMPTY: () => ({ errors: templateErrors('  \n ') }),
  BLOCK_TEMPLATE_TOO_LARGE: () => ({
    errors: templateErrors('x'.repeat(BLOCK_LIMITS.templateBytes + 1)),
  }),
  BLOCK_STYLESHEET_TOO_LARGE: () => ({
    errors: validateBlockStylesheet('a{}'.repeat(3000)),
  }),
  BLOCK_CHARACTER_NOT_ALLOWED: () => ({
    errors: templateErrors(`<p>ok</p>\n<p>${RLO}x</p>`),
    at: [2, 4],
  }),
  BLOCK_LIQUID_UNTERMINATED: () => ({
    errors: templateErrors('<p>{{ store.name </p>'),
    at: [1, 4],
  }),
  BLOCK_LIQUID_SYNTAX: () => ({
    errors: templateErrors('{{ store.name | }}'),
    at: [1, 16],
  }),
  BLOCK_TAG_UNKNOWN: () => ({
    errors: templateErrors('\n  {% tablerows %}'),
    at: [2, 6],
  }),
  BLOCK_TAG_NOT_SUPPORTED: () => ({
    errors: templateErrors("{% include 'x' %}"),
    at: [1, 4],
  }),
  BLOCK_TAG_UNCLOSED: () => ({
    errors: templateErrors('{% if true %}x'),
    at: [1, 4],
  }),
  BLOCK_TAG_UNEXPECTED: () => ({
    errors: templateErrors('x{% endif %}'),
    at: [1, 5],
  }),
  BLOCK_NESTING_TOO_DEEP: () => ({
    errors: templateErrors(
      '{% if true %}'.repeat(11) + '{% endif %}'.repeat(11),
    ),
  }),
  BLOCK_LOOP_NESTING_TOO_DEEP: () => ({
    errors: templateErrors(
      '{% for a in (1..2) %}{% for b in (1..2) %}{% for c in (1..2) %}{% for d in (1..2) %}{% endfor %}{% endfor %}{% endfor %}{% endfor %}',
    ),
  }),
  BLOCK_LOOP_LIMIT_TOO_HIGH: () => ({
    errors: templateErrors('{% for i in (1..51) %}{% endfor %}'),
    at: [1, 13],
  }),
  BLOCK_FILTER_UNKNOWN: () => ({
    errors: templateErrors('{{ store.name | shout }}'),
    at: [1, 17],
  }),
  BLOCK_FILTER_NOT_SUPPORTED: () => ({
    errors: templateErrors("{{ 'now' | date: '%Y' }}"),
    at: [1, 12],
  }),
  BLOCK_FILTER_ARGUMENTS: () => ({
    errors: templateErrors('{{ store.name | append }}'),
    at: [1, 17],
  }),
  BLOCK_FILTER_CHAIN_TOO_LONG: () => ({
    errors: templateErrors(`{{ store.name${' | upcase'.repeat(11)} }}`),
  }),
  BLOCK_VARIABLE_UNKNOWN: () => ({
    errors: templateErrors('{{ shop.name }}'),
    at: [1, 4],
  }),
  BLOCK_OBJECT_NOT_AVAILABLE: () => ({
    errors: templateErrors('{{ product.name }}', { target: 'any' }),
    at: [1, 4],
  }),
  BLOCK_PROPERTY_UNKNOWN: () => ({
    errors: templateErrors('{{ store.phone }}'),
    at: [1, 10],
  }),
  BLOCK_SETTING_UNDECLARED: () => ({
    errors: templateErrors('{{ block.settings.title }}'),
    at: [1, 19],
  }),
  BLOCK_DATA_KEY_UNDECLARED: () => ({
    errors: templateErrors('{{ app.data.product.rating }}'),
    at: [1, 21],
  }),
  BLOCK_DATA_OWNER_UNKNOWN: () => ({
    errors: templateErrors('{{ app.data.order.total }}'),
    at: [1, 13],
  }),
  BLOCK_ASSIGN_RESERVED: () => ({
    errors: templateErrors('{% assign store = 1 %}'),
    at: [1, 1],
  }),
  BLOCK_TOO_MANY_VARIABLES: () => ({
    errors: templateErrors(
      Array.from(
        { length: 65 },
        (_, i) => `{% assign v${i.toString()} = ${i.toString()} %}`,
      ).join(''),
    ),
  }),
  BLOCK_HTML_TAG_NOT_ALLOWED: () => ({
    errors: templateErrors('<p>\n<script>x</script></p>'),
    at: [2, 1],
  }),
  BLOCK_HTML_ATTRIBUTE_NOT_ALLOWED: () => ({
    errors: templateErrors('<div id="price">x</div>'),
    at: [1, 6],
  }),
  BLOCK_HTML_STYLE_ATTRIBUTE: () => ({
    errors: templateErrors('<div style="color: red">x</div>'),
    at: [1, 6],
  }),
  BLOCK_HTML_EVENT_HANDLER: () => ({
    errors: templateErrors('<div onclick="x()">x</div>'),
    at: [1, 6],
  }),
  BLOCK_HTML_URL_NOT_ALLOWED: () => ({
    errors: templateErrors('<a href="javascript:alert(1)">x</a>'),
    at: [1, 10],
  }),
  BLOCK_HTML_IMAGE_SOURCE: () => ({
    errors: templateErrors('<img src="https://evil.example/x.png" alt="">'),
    at: [1, 11],
  }),
  BLOCK_HTML_ATTRIBUTE_VALUE: () => ({
    errors: templateErrors('<p dir="up">x</p>'),
    at: [1, 9],
  }),
  BLOCK_HTML_DYNAMIC_TAG: () => ({
    errors: templateErrors('<{{ store.name }}>x'),
    at: [1, 1],
  }),
  BLOCK_HTML_DYNAMIC_ATTRIBUTE: () => ({
    errors: templateErrors('<div {{ store.name }}>x</div>'),
    at: [1, 6],
  }),
  BLOCK_HTML_UNQUOTED_ATTRIBUTE: () => ({
    errors: templateErrors('<div title={{ store.name }}>x</div>'),
    at: [1, 6],
  }),
  BLOCK_HTML_UNTERMINATED_TAG: () => ({
    errors: templateErrors('<p>x</p><div title="x"'),
    at: [1, 9],
  }),
  BLOCK_HTML_TOO_DEEP: () => ({ errors: templateErrors('<div>'.repeat(33)) }),
  BLOCK_HTML_ENTITY_UNKNOWN: () => ({
    errors: templateErrors('<p>5 &dzd;</p>'),
    at: [1, 6],
  }),
  BLOCK_CSS_SYNTAX: () => ({
    errors: validateBlockStylesheet('.a {\n  color: red;\n'),
    at: [1, 4],
  }),
  BLOCK_CSS_AT_RULE_NOT_ALLOWED: () => ({
    errors: validateBlockStylesheet('\n@import "x.css";'),
    at: [2, 1],
  }),
  BLOCK_CSS_URL_NOT_ALLOWED: () => ({
    errors: validateBlockStylesheet(
      '.a { background: url(https://x.example/a.png); }',
    ),
    at: [1, 18],
  }),
  BLOCK_CSS_FUNCTION_NOT_ALLOWED: () => ({
    errors: validateBlockStylesheet('.a { width: expression(1); }'),
    at: [1, 13],
  }),
  BLOCK_CSS_DECLARATION_NOT_ALLOWED: () => ({
    errors: validateBlockStylesheet('.a { position: fixed; }'),
    at: [1, 6],
  }),
  BLOCK_CSS_ESCAPE_NOT_ALLOWED: () => ({
    errors: validateBlockStylesheet('.a { color: r\\65 d; }'),
    at: [1, 14],
  }),
  BLOCK_CSS_THEME_VARIABLE_UNKNOWN: () => ({
    errors: validateBlockStylesheet('.a { color: var(--st-accent); }'),
    at: [1, 17],
  }),
  BLOCK_RENDER_CONTEXT_INVALID: () => {
    const result = renderBlock('x', {} as never, {});
    return { errors: result.ok ? [] : result.errors };
  },
  BLOCK_RENDER_STEP_LIMIT: () => {
    const result = renderBlock(
      '{% for a in (1..50) %}{% for b in (1..50) %}{% for c in (1..50) %}.{% endfor %}{% endfor %}{% endfor %}',
      sampleBlockContext(),
    );
    return { errors: result.ok ? [] : result.errors };
  },
  BLOCK_RENDER_OUTPUT_LIMIT: () => {
    const result = renderBlock(
      `{% for a in (1..50) %}{% for b in (1..50) %}<p>${'x'.repeat(100)}</p>{% endfor %}{% endfor %}`,
      sampleBlockContext(),
    );
    return { errors: result.ok ? [] : result.errors };
  },
  BLOCK_RENDER_STRING_LIMIT: () => {
    const result = renderBlock(
      "{% assign s = 'xxxxxxxxxx' %}{% for i in (1..20) %}{% assign s = s | append: s %}{% endfor %}{{ s.size }}",
      sampleBlockContext(),
    );
    return { errors: result.ok ? [] : result.errors };
  },
  BLOCK_RENDER_ARRAY_LIMIT: () => {
    const result = renderBlock(
      `{{ '${'x'.repeat(600)}' | split: '' | size }}`,
      sampleBlockContext(),
    );
    return { errors: result.ok ? [] : result.errors };
  },
  BLOCK_RENDER_DATA_TOO_LARGE: () => {
    const result = renderBlock(
      '{{ app.data.store.big }}',
      {
        ...sampleBlockContext(),
        appData: { store: { big: 'x'.repeat(40_000) } },
      },
      { data: ['store.big'] },
    );
    return { errors: result.ok ? [] : result.errors };
  },
  BLOCK_RENDER_FAILED: () => {
    const store = {
      get name(): string {
        throw new Error('a getter that throws');
      },
    };
    const result = renderBlock('{{ store.name }}', { store });
    return { errors: result.ok ? [] : result.errors };
  },
};

describe('error codes', () => {
  it('every code has a case here', () => {
    expect(Object.keys(CASES).sort()).toEqual([...BLOCK_ERROR_CODES].sort());
  });

  for (const code of BLOCK_ERROR_CODES) {
    it(code, () => {
      const { errors, at } = CASES[code]();
      const error = errors.find((e) => e.code === code);
      expect(error, JSON.stringify(errors, null, 2)).toBeDefined();
      if (!error) return;
      expect(error.fix).toMatch(/^[A-Z'"{<].*[.)]$/s);
      expect(error.message.length).toBeGreaterThan(5);
      if (at) expect([error.line, error.column]).toEqual(at);
      if (error.source === 'render')
        expect([error.line, error.column]).toEqual([0, 0]);
    });
  }

  it('every default fix is one sentence', () => {
    for (const code of BLOCK_ERROR_CODES)
      expect(blockErrorFix(code)).toMatch(/^[^\n]+[.]$/);
  });
});

describe('validateBlock', () => {
  const declaration: BlockDeclaration = {
    target: 'product',
    settings: [
      {
        key: 'title',
        type: 'text',
        default: { ar: 'آراء الزبائن', en: 'Reviews' },
      },
      { key: 'accent_color', type: 'color', default: '#0b6e4f' },
      { key: 'show_count', type: 'boolean', default: true },
    ],
    data: ['product.rating'],
  };
  const template = [
    '<section class="rating">',
    '  <h3>{{ block.settings.title | t }}</h3>',
    '  {% assign rating = app.data.product.rating %}',
    '  {% if rating %}',
    '    {{ rating.average | stars }}',
    '    {% if block.settings.show_count %}<small>({{ rating.count }})</small>{% endif %}',
    '  {% else %}',
    '    <p>{{ product.name }}</p>',
    '  {% endif %}',
    '  <img src="{{ product.image | image_url: 240 }}" alt="{{ product.name }}">',
    '</section>',
  ].join('\n');
  const stylesheet =
    '.rating { color: var(--block-accent-color); border-radius: var(--st-radius); }';

  it('accepts a block that only reads what it declares', () => {
    expect(validateBlock({ template, stylesheet, declaration })).toEqual({
      ok: true,
    });
  });

  it('reports template, then stylesheet, then render errors, each sorted by position', () => {
    const result = validateBlock({
      template: '<div onclick="x">{{ shop.name }}</div>\n<script></script>',
      stylesheet: '.a { color: var(--block-nope); }\n@import "x";',
      declaration,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.errors.map(
        (e) =>
          `${e.source}:${e.code}@${e.line.toString()}:${e.column.toString()}`,
      ),
    ).toEqual([
      'template:BLOCK_HTML_EVENT_HANDLER@1:6',
      'template:BLOCK_VARIABLE_UNKNOWN@1:21',
      'template:BLOCK_HTML_TAG_NOT_ALLOWED@2:1',
      'stylesheet:BLOCK_SETTING_UNDECLARED@1:17',
      'stylesheet:BLOCK_CSS_AT_RULE_NOT_ALLOWED@2:1',
    ]);
  });

  it('catches a template that only breaks with data: the sample render', () => {
    const result = validateBlock({
      template:
        '{% for a in (1..50) %}{% for b in (1..50) %}{% for c in (1..50) %}{{ c }}{% endfor %}{% endfor %}{% endfor %}',
    });
    expect(result).toMatchObject({
      ok: false,
      errors: [{ code: 'BLOCK_RENDER_STEP_LIMIT', source: 'render' }],
    });
  });

  it('refuses stars inside an attribute', () => {
    expect(
      templateErrors('<div title="{{ 4 | stars }}">x</div>').map((e) => e.code),
    ).toEqual(['BLOCK_HTML_ATTRIBUTE_VALUE']);
  });

  it('accepts Liquid around attributes and inside quoted values', () => {
    expect(
      templateErrors(
        '<a href="{{ product.url }}" class="link {% if product.available %}on{% endif %}" {% if true %}target="_blank"{% endif %}>{{ product.name }}</a>',
      ),
    ).toEqual([]);
  });

  it('refuses an image that does not go through image_url, even partly', () => {
    expect(
      templateErrors('<img src="{{ product.image }}" alt="">').map(
        (e) => e.code,
      ),
    ).toEqual(['BLOCK_HTML_IMAGE_SOURCE']);
    expect(
      templateErrors(
        '<img src="x{{ product.image | image_url: 80 }}" alt="">',
      ).map((e) => e.code),
    ).toEqual(['BLOCK_HTML_IMAGE_SOURCE']);
    expect(templateErrors('<img alt="">').map((e) => e.code)).toEqual([
      'BLOCK_HTML_IMAGE_SOURCE',
    ]);
  });

  it('refuses SVG outside <svg>, HTML inside it, and markup inside an SVG <title>', () => {
    expect(templateErrors('<path d="M0 0"></path>').map((e) => e.code)).toEqual(
      ['BLOCK_HTML_TAG_NOT_ALLOWED'],
    );
    expect(
      templateErrors('<svg><div>x</div></svg>').map((e) => e.code),
    ).toEqual(['BLOCK_HTML_TAG_NOT_ALLOWED']);
    expect(
      templateErrors('<svg><title><path d="M0 0"/></title></svg>').map(
        (e) => e.code,
      ),
    ).toEqual(['BLOCK_HTML_TAG_NOT_ALLOWED']);
  });

  it('caps the error list and says how many more there were', () => {
    const errors = templateErrors('<div id="x"></div>'.repeat(80));
    expect(errors).toHaveLength(BLOCK_LIMITS.errors);
    expect(errors[errors.length - 1]?.message).toMatch(
      /\(30 more errors not shown\)$/,
    );
  });

  it('gives the same errors in the same order every time', () => {
    const input = {
      template: '{{ a }}<b onclick=1>{% foo %}',
      stylesheet: '@layer x {}',
    };
    expect(validateBlock(input)).toEqual(validateBlock(input));
  });

  it('never throws, whatever it is given', () => {
    for (const template of [
      null,
      undefined,
      0,
      {},
      [],
      'a\0b',
      Symbol.for('x'),
    ]) {
      expect(() =>
        validateBlock({ template, stylesheet: template }),
      ).not.toThrow();
    }
  });
  it("reads a block entry of the normalised manifest as it is (@tassyir/app-manifest's names)", () => {
    // The shape `validateManifest` returns for one [[storefront.blocks]]
    // entry: snake_case keys, labels, and fields this package does not read.
    const manifestBlock = {
      handle: 'product-rating',
      template: 'blocks/product-rating.liquid',
      stylesheet: 'blocks/product-rating.css',
      name: { ar: 'تقييم المنتج', en: 'Product rating' },
      target: 'product' as const,
      data: ['product.rating'],
      settings: [
        {
          key: 'title',
          type: 'text' as const,
          label: { ar: 'العنوان', en: 'Title' },
          default: { ar: 'آراء', en: 'Reviews' },
          max_length: 40,
        },
        {
          key: 'accent_color',
          type: 'color' as const,
          label: { ar: 'اللون', en: 'Colour' },
          default: '#0b6e4f',
        },
        {
          key: 'size',
          type: 'select' as const,
          label: { ar: 'الحجم', en: 'Size' },
          default: 'm',
          options: [
            { value: 's', label: { ar: 'ص', en: 'S' } },
            { value: 'm', label: { ar: 'م', en: 'M' } },
          ],
        },
      ],
    };
    const result = validateBlock({
      template:
        '<p class="size-{{ block.settings.size }}">{{ block.settings.title | t }} {{ app.data.product.rating.average }}</p>',
      stylesheet: '.size-m { color: var(--block-accent-color); }',
      declaration: manifestBlock,
    });
    expect(result).toEqual({ ok: true });
  });
});
