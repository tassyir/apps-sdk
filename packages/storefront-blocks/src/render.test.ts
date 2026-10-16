import { describe, expect, it } from 'vitest';
import type { BlockDeclaration, BlockRenderContext } from './index.js';
import {
  compileBlockTemplate,
  renderBlock,
  sampleBlockContext,
} from './index.js';

const PRODUCT: BlockDeclaration = {
  target: 'product',
  settings: [
    { key: 'title', type: 'text', default: { ar: 'العنوان', en: 'Title' } },
    { key: 'show_count', type: 'boolean', default: true },
    { key: 'count', type: 'integer', default: 3 },
  ],
  data: ['product.rating', 'store.badges', 'business.since'],
};

function context(
  overrides: Partial<BlockRenderContext> = {},
): BlockRenderContext {
  return { ...sampleBlockContext(PRODUCT, { language: 'en' }), ...overrides };
}

/** Renders and returns the HTML, failing the test on any error. */
function html(
  template: string,
  ctx: BlockRenderContext = context(),
  declaration: BlockDeclaration = PRODUCT,
): string {
  const result = renderBlock(template, ctx, declaration);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2));
  return result.html;
}

describe('outputs', () => {
  it('escapes every output, whatever the data holds', () => {
    const ctx = context({
      appData: { product: { rating: '<img src=x onerror=alert(1)>"\'&' } },
    });
    expect(html('<p>{{ app.data.product.rating }}</p>', ctx)).toBe(
      '<p>&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;</p>',
    );
  });

  it('keeps an escaped value inside its quoted attribute', () => {
    const ctx = context({
      appData: { product: { rating: '" onmouseover="alert(1)' } },
    });
    expect(html('<p title="{{ app.data.product.rating }}">x</p>', ctx)).toBe(
      '<p title="&quot; onmouseover=&quot;alert(1)">x</p>',
    );
  });

  it('prints nil as nothing, numbers as Liquid does, arrays joined, records as nothing', () => {
    const ctx = context({
      appData: {
        store: { badges: ['a', 'b'] },
        business: { since: { year: 2020 } },
      },
    });
    expect(
      html(
        '{{ nil }}|{{ 3 }}|{{ 2.5 }}|{{ -0 }}|{{ true }}|{{ app.data.store.badges }}|{{ app.data.business.since }}|',
        ctx,
      ),
    ).toBe('|3|2.5|0|true|ab||');
  });

  it('reads settings, the product and the store', () => {
    expect(
      html(
        '{{ block.settings.title | t }} {{ block.settings.count }} {{ product.name }} {{ store.name }} {{ store.locale }}',
      ),
    ).toBe('Title 3 Embroidered kaftan Dar Amina en');
  });

  it('reads size, first and last of a list and a string', () => {
    const ctx = context({ appData: { store: { badges: ['x', 'y', 'z'] } } });
    expect(
      html(
        '{{ app.data.store.badges.size }}{{ app.data.store.badges.first }}{{ app.data.store.badges.last }}{{ app.data.store.badges[1] }}{{ app.data.store.badges[-1] }}{{ product.name.size }}',
        ctx,
      ),
    ).toBe('3xzyz18');
  });

  it('never reaches a prototype, a method or a getter', () => {
    const data = JSON.parse(
      '{"__proto__": {"x": "polluted"}, "constructor": "c", "ok": "yes"}',
    ) as Record<string, unknown>;
    const ctx = context({ appData: { store: { badges: data } } });
    // The upload check refuses `store.toString`; the render must hold anyway.
    const compiled = compileBlockTemplate(
      "{{ app.data.store.badges.ok }}|{{ app.data.store.badges.__proto__ }}|{{ app.data.store.badges.constructor }}|{{ app.data.store.badges['__proto__'] }}|{{ store.name.constructor }}|{{ store.toString }}|{{ app.data.store.badges.hasOwnProperty }}|{{ app.data.store.badges.x }}",
      PRODUCT,
      { checks: 'syntax' },
    );
    if (!compiled.ok) throw new Error('compile');
    const result = renderBlock(compiled.template, ctx);
    expect(result.ok && result.html).toBe('yes|||||||');
    expect(({} as Record<string, unknown>)['x']).toBeUndefined();
  });

  it('refuses unknown properties at upload', () => {
    const ctx = context();
    expect(() =>
      html(
        "{{ app.data.store.badges.ok }}|{{ app.data.store.badges.__proto__ }}|{{ app.data.store.badges.constructor }}|{{ app.data.store.badges['__proto__'] }}|{{ store.name.constructor }}|{{ store.toString }}|{{ app.data.store.badges.hasOwnProperty }}|{{ app.data.store.badges.x }}",
        ctx,
      ),
    ).toThrow(/BLOCK_PROPERTY_UNKNOWN/);
  });

  it('drops functions, class instances and non-finite numbers from data', () => {
    const ctx = context({
      appData: {
        store: {
          badges: [
            () => 'fn',
            new Date(0),
            Number.NaN,
            Number.POSITIVE_INFINITY,
            1n as unknown as number,
            Symbol('s') as unknown as number,
            'kept',
          ],
        },
      },
    });
    expect(
      html('{% for b in app.data.store.badges %}[{{ b }}]{% endfor %}', ctx),
    ).toBe('[][][][][][][kept]');
  });
});

describe('tags', () => {
  it('if / elsif / else / unless', () => {
    const t =
      '{% if product.available and block.settings.show_count %}A{% elsif false %}B{% else %}C{% endif %}{% unless product.available %}U{% else %}N{% endunless %}';
    expect(html(t)).toBe('AN');
  });

  it('reads and/or from the right, as Liquid does', () => {
    expect(
      html('{% if true or false and false %}yes{% else %}no{% endif %}'),
    ).toBe('yes');
    expect(
      html('{% if false and false or true %}yes{% else %}no{% endif %}'),
    ).toBe('no');
  });

  it('compares numbers, decimal strings, strings, empty and blank', () => {
    const t =
      "{% if product.price > 4000 %}a{% endif %}{% if product.price == '4500.00' %}b{% endif %}{% if 'b' > 'a' %}c{% endif %}{% if '' == empty %}d{% endif %}{% if '  ' == blank %}e{% endif %}{% if nil == blank %}f{% endif %}{% if 'abc' contains 'b' %}g{% endif %}{% if 1 < 'x' %}h{% endif %}";
    expect(html(t)).toBe('abcdefg');
  });

  it('case / when with commas and or', () => {
    const t =
      "{% case store.locale %}{% when 'fr', 'en' %}latin{% when 'ar' or 'kab' %}arabic{% else %}other{% endcase %}";
    expect(html(t)).toBe('latin');
    expect(html(t, sampleBlockContext(PRODUCT, { language: 'ar' }))).toBe(
      'arabic',
    );
  });

  it('for: limit, offset, reversed, else, forloop, break, continue', () => {
    const t =
      '{% for i in (1..10) limit: 4 offset: 2 reversed %}{{ i }}{% if forloop.last %}.{% endif %}{% endfor %}|' +
      '{% for i in (1..5) %}{% if i == 2 %}{% continue %}{% endif %}{% if i == 4 %}{% break %}{% endif %}{{ forloop.index }}/{{ forloop.length }} {% endfor %}|' +
      '{% for i in app.data.store.badges %}x{% else %}none{% endfor %}';
    expect(html(t)).toBe('6543.|1/5 3/5 |none');
  });

  it('runs a loop at most 50 times, whatever the range or limit', () => {
    const ctx = context({
      appData: { store: { badges: Array.from({ length: 200 }, (_, i) => i) } },
    });
    expect(
      html(
        '{% for i in app.data.store.badges limit: block.settings.count %}{% endfor %}{% for i in app.data.store.badges %}x{% endfor %}',
        ctx,
      ),
    ).toBe('x'.repeat(50));
    const big = {
      ...PRODUCT,
      settings: [{ key: 'count', type: 'integer', default: 1_000_000_000 }],
    };
    expect(
      html(
        '{% for i in (1..block.settings.count) %}x{% endfor %}',
        sampleBlockContext(big),
        big,
      ),
    ).toBe('x'.repeat(50));
  });

  it('iterates a record as [key, value] pairs', () => {
    const ctx = context({ appData: { business: { since: { a: 1, b: 2 } } } });
    expect(
      html(
        '{% for pair in app.data.business.since %}{{ pair[0] }}={{ pair[1] }};{% endfor %}',
        ctx,
      ),
    ).toBe('a=1;b=2;');
  });

  it('assign and capture; a captured string is escaped like any other', () => {
    expect(
      html(
        '{% assign n = 2 | plus: 3 %}{% capture tag %}<b>{{ n }}</b>{% endcapture %}{{ tag }}{{ n }}',
      ),
    ).toBe('&lt;b&gt;5&lt;/b&gt;5');
  });

  it('scopes the loop variable to its loop', () => {
    expect(
      html(
        '{% assign i = "outer" %}{% for i in (1..2) %}{{ i }}{% endfor %}{{ i }}',
      ),
    ).toBe('12outer');
  });

  it('applies whitespace control and skips comments', () => {
    expect(
      html(
        '<p>  {{- product.name -}}  </p>{% comment %}{{ secret }} {% if %}{% endcomment %}{% # note %}<i>\n  {%- if true -%}\n x \n{%- endif -%}\n</i>',
      ),
    ).toBe('<p>Embroidered kaftan</p><i>x</i>');
  });

  it('reads `}}` inside a quoted string', () => {
    expect(html("{{ '}}' | append: 'x' }}")).toBe('}}x');
  });
});

describe('Tassyir filters', () => {
  it('money: the storefront format in the store language', () => {
    expect(
      html(
        '{{ product.price | money }}|{{ 1234567.891 | money }}|{{ "0.1" | money }}|{{ "x" | money }}',
      ),
    ).toBe(`4\u202F500 DA|1\u202F234\u202F567,891 DA|0,1 DA|`);
    expect(
      html(
        '{{ product.price | money }}',
        sampleBlockContext(PRODUCT, { language: 'ar' }),
      ),
    ).toBe('4\u202F500 دج');
  });

  it('image_url: only Tassyir images, at an allowed width', () => {
    expect(
      html('<img src="{{ product.image | image_url: 300 }}" alt="">'),
    ).toBe(
      '<img src="https://cdn.tassyir.io/cdn-cgi/image/w=320,q=80,fit=scale-down,f=auto/images/sample-kaftan/public" alt="" loading="lazy" decoding="async">',
    );
    expect(
      html(
        '{{ "https://evil.example/images/x/public" | image_url: 300 }}|{{ product.image | image_url: 5000 }}',
      ),
    ).toBe(
      '|https://cdn.tassyir.io/cdn-cgi/image/w=1600,q=80,fit=scale-down,f=auto/images/sample-kaftan/public',
    );
  });

  it('stars: an accessible rating in the store language', () => {
    expect(html('{{ 4.4 | stars }}')).toBe(
      '<span class="tsy-stars" role="img" aria-label="Rated 4.4 out of 5">★★★★☆</span>',
    );
    expect(
      html(
        '{{ 2.5 | stars: 3 }}',
        sampleBlockContext(PRODUCT, { language: 'ar' }),
      ),
    ).toBe(
      '<span class="tsy-stars" role="img" aria-label="التقييم 2.5 من 3">★★★</span>',
    );
    expect(html('{{ 9 | stars }}{{ "x" | stars | size }}')).toContain(
      '★★★★★</span>5',
    );
  });

  it('t: picks the store language, then Arabic, then English', () => {
    const fr = sampleBlockContext(PRODUCT, { language: 'fr' });
    expect(html('{{ block.settings.title | t }}', fr)).toBe('العنوان');
    expect(html("{{ 'plain' | t }}")).toBe('plain');
  });
});

describe('compiled templates', () => {
  it('are reusable and frozen', () => {
    const compiled = compileBlockTemplate('<p>{{ store.name }}</p>', PRODUCT);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(Object.isFrozen(compiled.template)).toBe(true);
    const a = renderBlock(
      compiled.template,
      sampleBlockContext(PRODUCT, { language: 'ar' }),
    );
    const b = renderBlock(
      compiled.template,
      sampleBlockContext(PRODUCT, { language: 'en' }),
    );
    expect(a.ok && a.html).toBe('<p>دار أمينة</p>');
    expect(b.ok && b.html).toBe('<p>Dar Amina</p>');
  });

  it('give no product to a block whose target is any', () => {
    const any = compileBlockTemplate('{{ store.name }}', { target: 'any' });
    if (!any.ok) throw new Error('compile');
    const result = renderBlock(any.template, context());
    expect(result.ok && result.html).toBe('Dar Amina');
  });

  it('reports a context without a store, never throws', () => {
    const compiled = compileBlockTemplate('x');
    if (!compiled.ok) throw new Error('compile');
    const result = renderBlock(compiled.template, {} as BlockRenderContext);
    expect(result).toMatchObject({
      ok: false,
      errors: [
        { code: 'BLOCK_RENDER_CONTEXT_INVALID', source: 'render', line: 0 },
      ],
    });
  });

  it('render the same output for the same input, every time', () => {
    const template =
      '{% for i in (1..5) %}<li>{{ i | times: 1.5 | money }}</li>{% endfor %}';
    const outputs = new Set(Array.from({ length: 5 }, () => html(template)));
    expect(outputs.size).toBe(1);
  });
});
