import { describe, expect, it } from 'vitest';
import type { BlockRenderContext, BlockRenderResult } from './index.js';
import {
  BLOCK_LIMITS,
  compileBlockTemplate,
  renderCompiledBlock,
  sampleBlockContext,
  sanitizeBlockHtml,
} from './index.js';

/**
 * Every limit stops its runaway case, with its own code, at the same point on
 * every machine. Render time is bounded by steps, so the costliest templates
 * the budget allows still finish quickly.
 */

const DATA = { data: ['store.items', 'store.text', 'store.deep'] };

function render(
  template: string,
  appData: BlockRenderContext['appData'] = {},
): BlockRenderResult {
  // Render even what the upload check would refuse: the limits hold anyway.
  const compiled = compileBlockTemplate(template, DATA, { checks: 'syntax' });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.errors));
  return renderCompiledBlock(compiled.template, {
    ...sampleBlockContext(),
    appData,
  });
}

function codeOf(result: BlockRenderResult): string {
  return result.ok ? 'ok' : (result.errors[0]?.code ?? '');
}

describe('render limits', () => {
  it('steps: loops inside loops stop at the budget, at the same step every time', () => {
    const template =
      '{% for a in (1..50) %}{% for b in (1..50) %}{% for c in (1..50) %}{% for d in (1..50) %}{% endfor %}{% endfor %}{% endfor %}{% endfor %}';
    const results = [render(template), render(template)];
    expect(results.map(codeOf)).toEqual([
      'BLOCK_RENDER_STEP_LIMIT',
      'BLOCK_RENDER_STEP_LIMIT',
    ]);
    expect(results[0]).toEqual(results[1]);
  });

  it('steps: a filter on a long string costs more than one on a word', () => {
    const word = render('{{ "word" | upcase }}');
    const long = render(`{{ app.data.store.text | upcase }}`, {
      store: { text: 'x'.repeat(25_000) },
    });
    expect(word.ok && long.ok).toBe(true);
    if (word.ok && long.ok)
      expect(long.stats.steps - word.stats.steps).toBeGreaterThan(100);
  });

  it('steps: filters on the longest strings run out of budget, not memory', () => {
    const template = `{% for a in (1..50) %}{% for b in (1..50) %}{% assign t = app.data.store.text | replace: 'x', 'y' | upcase | split: 'q' | join: '' %}{% endfor %}{% endfor %}`;
    expect(
      codeOf(render(template, { store: { text: 'x'.repeat(30_000) } })),
    ).toBe('BLOCK_RENDER_STEP_LIMIT');
  });

  it('output: stops past 32 KB of HTML', () => {
    expect(
      codeOf(
        render(
          `{% for a in (1..50) %}{% for b in (1..50) %}<p>${'é'.repeat(60)}</p>{% endfor %}{% endfor %}`,
        ),
      ),
    ).toBe('BLOCK_RENDER_OUTPUT_LIMIT');
  });

  it('output: measured after the HTML gate too (escaping can grow it)', () => {
    // 4,000 quotes are 4 KB of data and 24 KB once escaped as &quot;.
    const quotes = '"'.repeat(4000);
    const result = render(
      '{% for i in (1..2) %}{{ app.data.store.text }}{% endfor %}',
      { store: { text: quotes } },
    );
    expect(codeOf(result)).toBe('BLOCK_RENDER_OUTPUT_LIMIT');
  });

  it('strings: doubling with append or capture stops at 32,768 characters, before it is built', () => {
    expect(
      codeOf(
        render(
          "{% assign s = 'ab' %}{% for i in (1..30) %}{% assign s = s | append: s %}{% endfor %}",
        ),
      ),
    ).toBe('BLOCK_RENDER_STRING_LIMIT');
    expect(
      codeOf(
        render(
          "{% assign s = 'ab' %}{% for i in (1..30) %}{% capture s %}{{ s }}{{ s }}{% endcapture %}{% endfor %}",
        ),
      ),
    ).toBe('BLOCK_RENDER_STRING_LIMIT');
    expect(
      codeOf(
        render(
          `{{ app.data.store.text | replace: 'x', '${'y'.repeat(200)}' }}`,
          { store: { text: 'x'.repeat(1000) } },
        ),
      ),
    ).toBe('BLOCK_RENDER_STRING_LIMIT');
  });

  it('strings: a list of long strings cannot be joined past the limit', () => {
    const template =
      "{% assign l = app.data.store.items %}{% for i in (1..8) %}{% assign l = l | concat: l %}{% endfor %}{{ l | join: '' }}";
    expect(
      codeOf(render(template, { store: { items: ['x'.repeat(1000)] } })),
    ).toBe('BLOCK_RENDER_STRING_LIMIT');
    expect(
      codeOf(
        render(
          '{% assign l = app.data.store.items %}{% for i in (1..8) %}{% assign l = l | concat: l %}{% endfor %}{{ l }}',
          { store: { items: ['x'.repeat(1000)] } },
        ),
      ),
    ).toBe('BLOCK_RENDER_STRING_LIMIT');
  });

  it('lists: split and concat stop at 500 items', () => {
    expect(
      codeOf(render(`{{ '${'a,'.repeat(600)}' | split: ',' | size }}`)),
    ).toBe('BLOCK_RENDER_ARRAY_LIMIT');
    expect(
      codeOf(
        render(
          "{% assign l = 'a,b' | split: ',' %}{% for i in (1..10) %}{% assign l = l | concat: l %}{% endfor %}",
        ),
      ),
    ).toBe('BLOCK_RENDER_ARRAY_LIMIT');
  });

  it('data: too large, too deep or too long a list', () => {
    expect(
      codeOf(
        render('{{ app.data.store.text }}', {
          store: { text: 'x'.repeat(BLOCK_LIMITS.dataBytes) },
        }),
      ),
    ).toBe('BLOCK_RENDER_DATA_TOO_LARGE');
    let deep: unknown = 'bottom';
    for (let i = 0; i < 20; i++) deep = { deep };
    expect(
      codeOf(render('{{ app.data.store.deep }}', { store: { deep } })),
    ).toBe('BLOCK_RENDER_DATA_TOO_LARGE');
    expect(
      codeOf(
        render('{{ app.data.store.items.size }}', {
          store: { items: Array.from({ length: 501 }, () => 1) },
        }),
      ),
    ).toBe('BLOCK_RENDER_DATA_TOO_LARGE');
  });

  it('loops: a range or a list runs at most 50 times, without building the range', () => {
    const result = render(
      '{% for i in (1..999999999999) %}{{ forloop.length }}{% endfor %}',
    );
    expect(result.ok && result.html).toBe('50'.repeat(50));
    const offset = render(
      '{% for i in (1..999999999999) offset: 999999999990 %}{{ i }},{% endfor %}',
    );
    expect(offset.ok && offset.html).toBe(
      '999999999991,999999999992,999999999993,999999999994,999999999995,999999999996,999999999997,999999999998,999999999999,',
    );
  });

  it('nesting: hundreds of nested tags are refused, without exhausting the stack', () => {
    const deep = '{% if true %}'.repeat(600) + 'x' + '{% endif %}'.repeat(600);
    const result = compileBlockTemplate(deep);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.map((e) => e.code)).toContain(
        'BLOCK_NESTING_TOO_DEEP',
      );
  });

  it('nesting: the HTML gate keeps at most 32 elements open', () => {
    const html = sanitizeBlockHtml('<div>'.repeat(200) + 'x');
    expect(html).toBe(
      '<div>'.repeat(BLOCK_LIMITS.htmlNesting) +
        'x' +
        '</div>'.repeat(BLOCK_LIMITS.htmlNesting),
    );
  });

  it('size: the template, the stylesheet', () => {
    expect(
      compileBlockTemplate('é'.repeat(BLOCK_LIMITS.templateBytes / 2 + 1)),
    ).toMatchObject({
      ok: false,
      errors: [{ code: 'BLOCK_TEMPLATE_TOO_LARGE' }],
    });
    expect(
      compileBlockTemplate('é'.repeat(BLOCK_LIMITS.templateBytes / 2)).ok,
    ).toBe(true);
  });

  it('time: the costliest renders the budget allows finish quickly', () => {
    const heavy = [
      `{% for a in (1..50) %}{% for b in (1..50) %}{% assign t = app.data.store.text | upcase | replace: 'X', 'y' | split: 'q' | join: '' | url_encode %}{% endfor %}{% endfor %}`,
      '{% for a in (1..50) %}{% assign s = app.data.store.items | uniq | sort | reverse | sort_natural %}{% endfor %}',
      '{% for a in (1..50) %}{% for b in (1..50) %}{% for c in (1..50) %}{% if a == b and b == c or a contains b %}{{ a | plus: b | times: c | money }}{% endif %}{% endfor %}{% endfor %}{% endfor %}',
      `{{ app.data.store.text | strip_html }}{{ app.data.store.text | truncatewords: 5000 }}`,
    ];
    const appData = {
      store: {
        // Just under the 32 KB of data a block may read.
        text: '<script>'.repeat(2000) + ' x'.repeat(1500),
        items: Array.from({ length: 500 }, (_, i) => (i * 7919) % 500),
      },
    };
    for (const template of heavy) {
      const started = performance.now();
      const result = render(template, appData);
      const ms = performance.now() - started;
      expect([
        'ok',
        'BLOCK_RENDER_STEP_LIMIT',
        'BLOCK_RENDER_OUTPUT_LIMIT',
      ]).toContain(codeOf(result));
      // Generous for slow CI machines; about 10–60 ms on a laptop.
      expect(ms).toBeLessThan(1500);
    }
  });
  it('time: operations that touch long values are charged for what they touch', () => {
    // Twice 15,000 characters: under the 32 KB of data a block reads.
    const text = 'x'.repeat(15_000);
    const loops = (body: string): string =>
      `{% for a in (1..50) %}{% for b in (1..50) %}{% for c in (1..50) %}${body}{% endfor %}{% endfor %}{% endfor %}`;
    // A list of 256 references to one 15,000-character string.
    const big =
      '{% assign l = app.data.store.items %}{% for i in (1..8) %}{% assign l = l | concat: l %}{% endfor %}';
    const costly = [
      loops('{% if app.data.store.text == app.data.store.text %}{% endif %}'),
      loops('{% assign n = app.data.store.text.size %}'),
      loops("{% if app.data.store.text contains 'y' %}{% endif %}"),
      loops("{% if app.data.store.text < 'y' %}{% endif %}"),
      loops("{% assign r = 'x' | replace: 'x', app.data.store.text %}"),
      loops(
        '{% case app.data.store.text %}{% when app.data.store.text %}{% endcase %}',
      ),
      `${big}${loops('{% assign s = l | sort %}')}`,
      `${big}${loops('{% assign s = l | uniq %}')}`,
      `${big}${loops("{% assign s = l | where: 'k', app.data.store.text %}")}`,
      `${big}${loops('{% if l contains app.data.store.text %}{% endif %}')}`,
    ];
    for (const template of costly) {
      const started = performance.now();
      const result = render(template, { store: { text, items: [text] } });
      const ms = performance.now() - started;
      expect(codeOf(result), template).toBe('BLOCK_RENDER_STEP_LIMIT');
      expect(ms, template).toBeLessThan(1500);
    }
  });
  it('time: the validator and the HTML gate stay linear on adversarial input', () => {
    const spaces = ' '.repeat(16_000);
    const templates = [
      `${spaces}x{{- store.name }}`,
      `{{ '${"'".repeat(8000)}`,
      `{% if true %}${"{{ ' }}".repeat(1500)}{% endif %}`,
      '{% assign a = 1 %}'.repeat(900),
      '<p '.repeat(5000),
      `<a href="${'&#'.repeat(7000)}">`,
      '{% comment %}'.repeat(1200),
      `${'<'.repeat(8000)}${'{{'.repeat(4000)}`,
    ];
    for (const template of templates) {
      const started = performance.now();
      compileBlockTemplate(template.slice(0, BLOCK_LIMITS.templateBytes));
      expect(performance.now() - started, template.slice(0, 40)).toBeLessThan(
        1000,
      );
    }
    const html = [
      '<!-- --!>'.repeat(4000),
      '<!--'.repeat(8000),
      '<script>'.repeat(4000),
      '<a x="'.repeat(5000),
      '<svg><title>'.repeat(2500),
      '&#x41;&amp'.repeat(3000),
      `<p title="${' '.repeat(30_000)}x">`,
    ];
    for (const input of html) {
      const started = performance.now();
      sanitizeBlockHtml(input);
      expect(performance.now() - started, input.slice(0, 40)).toBeLessThan(
        1000,
      );
    }
    const rstrip = `{{ app.data.store.text | rstrip | size }}|{{ app.data.store.text | strip | size }}`;
    const started = performance.now();
    const result = render(rstrip, {
      store: { text: `${' '.repeat(30_000)}x` },
    });
    expect(result.ok && result.html).toBe('30001|1');
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
