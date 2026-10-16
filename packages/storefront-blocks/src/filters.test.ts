import { describe, expect, it } from 'vitest';
import {
  BLOCK_FILTERS,
  formatMoney,
  renderBlock,
  sampleBlockContext,
} from './index.js';
import { FILTERS, FILTERS_NOT_SUPPORTED } from './filters.js';

function out(template: string): string {
  const result = renderBlock(
    template,
    sampleBlockContext({}, { language: 'en' }),
  );
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.html;
}

describe('money', () => {
  it('matches the storefront (toLocaleString fr-DZ) for prices', () => {
    const amounts = [
      0, 1, 12, 999, 1000, 1500, 4500, 12_345, 99_999.5, 123_456.78,
      1_234_567.891, 0.1, 0.005, 0.0005, 2.675, 10_000_000,
    ];
    for (const amount of amounts) {
      expect(formatMoney(amount, 'DZD', 'fr')).toBe(
        `${amount.toLocaleString('fr-DZ')} DA`,
      );
      expect(formatMoney(amount.toString(), 'DZD', 'fr')).toBe(
        `${amount.toLocaleString('fr-DZ')} DA`,
      );
    }
  });

  it('reads decimal strings exactly, names the currency, refuses what is not an amount', () => {
    expect(formatMoney('4500.00', 'DZD', 'ar')).toBe('4\u202F500 دج');
    expect(formatMoney('0.9995', 'DZD', 'en')).toBe('1 DA');
    expect(formatMoney('-1500', 'DZD', 'en')).toBe('-1\u202F500 DA');
    expect(formatMoney('12', 'eur', 'fr')).toBe('12 EUR');
    for (const bad of ['', 'x', '1e5', '1,5', ' ', 'NaN', '1'.repeat(16)])
      expect(formatMoney(bad, 'DZD', 'fr')).toBe('');
    expect(formatMoney(Number.POSITIVE_INFINITY, 'DZD', 'fr')).toBe('');
  });
});

describe('text filters', () => {
  it('as Liquid does', () => {
    expect(
      out(
        "{{ 'hello world' | capitalize }}|{{ 'ABC' | downcase }}|{{ ' a ' | strip }}|{{ 'a,b' | split: ',' | join: '-' }}",
      ),
    ).toBe('Hello world|abc|a|a-b');
    expect(
      out(
        "{{ 'abcabc' | replace: 'b', 'x' }}|{{ 'abcabc' | replace_first: 'b', 'x' }}|{{ 'abcabc' | replace_last: 'b', 'x' }}|{{ 'abcabc' | remove: 'c' }}",
      ),
    ).toBe('axcaxc|axcabc|abcaxc|abab');
    expect(
      out(
        "{{ 'Ground control to Major Tom.' | truncate: 20 }}|{{ 'one two three' | truncatewords: 2, '…' }}|{{ 'قفطان مطرز' | slice: 0, 5 }}|{{ 'abc' | slice: -2, 2 }}",
      ),
    ).toBe('Ground control to...|one two…|قفطان|bc');
    expect(
      out("{{ '<p>a</p><script>b</script><!-- c -->d' | strip_html }}"),
    ).toBe('ad');
    expect(
      out(
        "{{ nil | default: 'x' }}|{{ '' | default: 'y' }}|{{ 0 | default: 'z' }}",
      ),
    ).toBe('x|y|0');
  });

  it('url_encode: Ruby CGI.escape, UTF-8, never throws on a lone surrogate', () => {
    expect(out("{{ 'a b&c=d/é' | url_encode }}")).toBe('a+b%26c%3Dd%2F%C3%A9');
    const runtime = {
      language: 'en' as const,
      currency: 'DZD',
      spend: () => undefined,
    };
    expect(
      FILTERS['url_encode']?.fn(String.fromCharCode(0xd800), [], runtime),
    ).toBe('%EF%BF%BD');
  });

  it('escape is accepted and does not escape twice', () => {
    expect(out("{{ '<b>' | escape }}|{{ '&amp;' | escape_once }}")).toBe(
      '&lt;b&gt;|&amp;amp;',
    );
  });
});

describe('list filters', () => {
  const items = "{% assign items = 'c,a,B,a' | split: ',' %}";
  it('sort, sort_natural, uniq, reverse, first, last, size, compact, concat', () => {
    expect(
      out(
        `${items}{{ items | sort | join }}|{{ items | sort_natural | join }}|{{ items | uniq | join }}|{{ items | reverse | join }}|{{ items | first }}{{ items | last }}{{ items | size }}`,
      ),
    ).toBe('B a a c|a a B c|c a B|a B a c|ca4');
    expect(out(`${items}{{ items | concat: items | size }}`)).toBe('8');
  });
});

describe('number filters', () => {
  // Numbers have one type: 7.0 is 7, so dividing two whole numbers floors.
  it('as Liquid does: integer division floors, modulo takes the divisor sign, nil on 0', () => {
    expect(
      out(
        '{{ 7 | divided_by: 2 }}|{{ 7.0 | divided_by: 2 }}|{{ -7 | divided_by: 2 }}|{{ -7 | modulo: 3 }}|{{ 7 | modulo: -3 }}|{{ 1 | divided_by: 0 }}|{{ 1 | modulo: 0 }}',
      ),
    ).toBe('3|3|-4|2|-2||');
    expect(
      out(
        "{{ 2.5 | round }}|{{ -2.5 | round }}|{{ 3.14159 | round: 2 }}|{{ '4.6' | floor }}|{{ 4.1 | ceil }}|{{ -3 | abs }}|{{ 5 | at_most: 3 }}|{{ 1 | at_least: 3 }}|{{ 'x' | plus: 1 }}",
      ),
    ).toBe('3|-3|3.14|4|5|3|3|3|1');
    expect(
      out(
        '{{ 0.1 | plus: 0.2 }}|{% assign big = 1 %}{% for i in (1..38) %}{% assign big = big | times: 100000000 %}{% endfor %}{{ big | times: 100000000 }}',
      ),
    ).toBe('0.30000000000000004|');
  });
});

describe('the filter list', () => {
  it('is fixed, and no supported filter is also listed as not supported', () => {
    expect(BLOCK_FILTERS).toContain('money');
    expect(
      BLOCK_FILTERS.filter((name) =>
        Object.hasOwn(FILTERS_NOT_SUPPORTED, name),
      ),
    ).toEqual([]);
    expect(BLOCK_FILTERS).not.toContain('raw');
    expect(BLOCK_FILTERS).not.toContain('date');
  });
});
