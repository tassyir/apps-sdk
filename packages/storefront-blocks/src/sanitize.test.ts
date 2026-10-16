import { describe, expect, it } from 'vitest';
import {
  BLOCK_HTML_ALLOWLIST,
  blockCssVariables,
  linkKind,
  resolveBlockSettings,
  sampleBlockContext,
  sanitizeBlockHtml,
  validateBlockStylesheet,
} from './index.js';

const IMG =
  'https://cdn.tassyir.io/cdn-cgi/image/w=480,q=80,fit=scale-down,f=auto/images/abc-1/public';

describe('the HTML gate', () => {
  it('keeps allowed markup, quoted and closed', () => {
    expect(
      sanitizeBlockHtml(
        '<section class="a  b"><h3>T</h3><p>x<br>y</p><ul><li>1<li>2</ul></section>',
      ),
    ).toBe(
      '<section class="a b"><h3>T</h3><p>x<br>y</p><ul><li>1<li>2</li></li></ul></section>',
    );
  });

  it('removes scripts and raw-text elements with their content, and keeps the content of other refused elements', () => {
    expect(
      sanitizeBlockHtml(
        'a<script>b</script>c<style>d</style>e<textarea>f</textarea>g<form><b>h</b><input>i</form>',
      ),
    ).toBe('aceg<b>h</b>i');
  });

  it('removes comments, doctypes, CDATA and processing instructions', () => {
    expect(
      sanitizeBlockHtml('<!DOCTYPE html>a<!-- b -->c<![CDATA[d]]>e<?x y?>f'),
    ).toBe('acef');
  });

  it('links: https, store paths and fragments only; rel for outside links and new tabs', () => {
    expect(
      sanitizeBlockHtml('<a href="https://example.com/a?b=1&amp;c=2">x</a>'),
    ).toBe(
      '<a href="https://example.com/a?b=1&amp;c=2" rel="nofollow noopener noreferrer">x</a>',
    );
    expect(
      sanitizeBlockHtml(
        '<a href="/collections/all" target="_blank" rel="opener">x</a>',
      ),
    ).toBe('<a href="/collections/all" target="_blank" rel="noopener">x</a>');
    expect(sanitizeBlockHtml('<a href="#reviews">x</a>')).toBe(
      '<a href="#reviews">x</a>',
    );
    for (const href of [
      'javascript:alert(1)',
      'http://example.com',
      '//evil.example',
      '/\\evil.example',
      'mailto:a@b.c',
      'data:text/html,x',
      'relative/path',
      'https://a@evil.example',
      'https://evil.example:444/',
    ]) {
      expect(sanitizeBlockHtml(`<a href="${href}">x</a>`)).toBe('<a>x</a>');
    }
  });

  it('images: only what image_url makes, lazy and async', () => {
    expect(
      sanitizeBlockHtml(
        `<img src="${IMG}" alt="A &amp; B" width="400" height="300" onerror="x" loading="eager">`,
      ),
    ).toBe(
      `<img src="${IMG}" alt="A &amp; B" width="400" height="300" loading="lazy" decoding="async">`,
    );
    expect(
      sanitizeBlockHtml(
        '<img src="https://cdn.tassyir.io/images/abc/public" alt="x">',
      ),
    ).toBe('');
    expect(sanitizeBlockHtml(IMG.replace('w=480', 'w=400'))).toBe(
      IMG.replace('w=480', 'w=400'),
    );
    expect(
      sanitizeBlockHtml(`<img src="${IMG.replace('w=480', 'w=400')}">`),
    ).toBe('');
  });

  it('SVG: shapes inside <svg> only, attribute case fixed, no url() paint', () => {
    expect(
      sanitizeBlockHtml(
        '<svg viewbox="0 0 24 24" preserveaspectratio="xMidYMid meet" aria-hidden="true"><path d="M0 0L24 24" fill="currentColor" stroke="url(#g)"/><title>t</title></svg>',
      ),
    ).toBe(
      '<svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><path d="M0 0L24 24" fill="currentColor"></path><title>t</title></svg>',
    );
    // A refused element's allowed content stays: the nested <svg> goes, its <g> stays.
    expect(
      sanitizeBlockHtml(
        '<path d="M0 0"/><svg><div>x</div><svg><g></g></svg></svg>',
      ),
    ).toBe('<svg>x<g></g></svg>');
  });

  it('drops id, name, style, data-* and every handler', () => {
    expect(
      sanitizeBlockHtml(
        '<div id="fbq" name="x" style="color:red" data-x="1" onclick="x" ONMOUSEOVER="y" class="ok">z</div>',
      ),
    ).toBe('<div class="ok">z</div>');
  });

  it('removes bidi controls and invisible characters from text and values', () => {
    const rlo = String.fromCharCode(0x202e);
    const zwsp = String.fromCharCode(0x200b);
    const rlm = String.fromCharCode(0x200f);
    expect(
      sanitizeBlockHtml(`<p title="a${rlo}b">c${rlo}d${zwsp}e${rlm}f</p>`),
    ).toBe(`<p title="ab">cde${rlm}f</p>`);
  });

  it('closes what is left open and drops end tags with nothing to close', () => {
    expect(sanitizeBlockHtml('</p><b><i>x</b></i></div>')).toBe(
      '<b><i>x</i></b>',
    );
  });

  it('exports its allowlist as data', () => {
    expect(BLOCK_HTML_ALLOWLIST.html['a']).toContain('href');
    expect(BLOCK_HTML_ALLOWLIST.html['h1']).toBeUndefined();
    expect(BLOCK_HTML_ALLOWLIST.svg['svg']).toContain('viewBox');
    expect(Object.keys(BLOCK_HTML_ALLOWLIST.html)).not.toContain('script');
  });
});

describe('linkKind', () => {
  it('names the three kinds of link and refuses the rest', () => {
    expect(
      [
        'https://example.com',
        'https://xn--mgbaa.example/a',
        '/p/قفطان',
        '#x',
        '/',
      ].map(linkKind),
    ).toEqual(['external', 'external', 'store', 'fragment', 'store']);
    expect(
      [
        `/a${String.fromCharCode(0x200b)}`,
        '/a b',
        'https://ex ample.com',
        'https://',
        'HTTPS://EXAMPLE.COM',
      ].map(linkKind),
    ).toEqual([null, null, null, null, 'external']);
  });
});

describe('the stylesheet check', () => {
  it('accepts the theme variables and the block colour variables of its settings', () => {
    const declaration = { settings: [{ key: 'accent_color', type: 'color' }] };
    expect(
      validateBlockStylesheet(
        '.a { color: var(--block-accent-color); background: var(--st-surface); --mine: 1px; }',
        declaration,
      ),
    ).toEqual([]);
    expect(
      validateBlockStylesheet(
        '.a { color: var(--block-other); }',
        declaration,
      ).map((e) => e.code),
    ).toEqual(['BLOCK_SETTING_UNDECLARED']);
  });

  it('refuses nested rules and keyframes inside @media', () => {
    expect(
      validateBlockStylesheet('.a { .b { color: red } }').map((e) => e.code),
    ).toEqual(['BLOCK_CSS_SYNTAX']);
    expect(
      validateBlockStylesheet(
        '@media screen { @keyframes x { to { opacity: 0 } } }',
      ).map((e) => e.code),
    ).toEqual(['BLOCK_CSS_AT_RULE_NOT_ALLOWED']);
  });

  it('takes position only as a written keyword, never fixed or through var()', () => {
    for (const css of [
      '.a { position: absolute; }',
      '.a { position: sticky !important; }',
      '.a { position: RELATIVE; }',
    ]) {
      expect(validateBlockStylesheet(css), css).toEqual([]);
    }
    for (const css of [
      '.a { position: fixed; }',
      '.a { --p: fixed; position: var(--p); }',
      '.a { position: var(--anything, absolute); }',
      '.a { position: /* */ fixed; }',
      '.a { position: absolute fixed; }',
      '.a { position: -webkit-sticky; }',
    ]) {
      expect(
        validateBlockStylesheet(css).map((e) => e.code),
        css,
      ).toEqual(['BLOCK_CSS_DECLARATION_NOT_ALLOWED']);
    }
  });

  it('checks a theme variable behind a comment too', () => {
    expect(
      validateBlockStylesheet('.a { color: var(/* x */ --st-internal); }').map(
        (e) => e.code,
      ),
    ).toEqual(['BLOCK_CSS_THEME_VARIABLE_UNKNOWN']);
  });

  it('accepts escapes inside strings only', () => {
    expect(validateBlockStylesheet('.a::after { content: "\\2605"; }')).toEqual(
      [],
    );
    expect(
      validateBlockStylesheet('.\\61 { color: red; }').map((e) => e.code),
    ).toEqual(['BLOCK_CSS_ESCAPE_NOT_ALLOWED']);
  });
});

describe('settings', () => {
  const settings = [
    { key: 'title', type: 'text', default: 'T', max_length: 5 },
    { key: 'on', type: 'boolean', default: false },
    { key: 'count', type: 'integer', default: 3, min: 1, max: 10 },
    {
      key: 'size',
      type: 'select',
      default: 'm',
      options: [{ value: 's' }, { value: 'm' }],
    },
    { key: 'accent_color', type: 'color', default: '#000000' },
    { key: 'image', type: 'image' },
    { key: 'link', type: 'url', default: '/x' },
    { key: 'product', type: 'product' },
    { key: 'future', type: 'money' },
  ];

  it('keeps values that fit, falls back to the default, drops the undeclared', () => {
    const resolved = resolveBlockSettings(settings, {
      title: 'too long title',
      on: 'yes',
      count: 11,
      size: 's',
      accent_color: '#C0392B',
      image: 'https://evil.example/x.png',
      link: 'javascript:alert(1)',
      product: '700000000000000001',
      future: '1500.00',
      extra: 'dropped',
    });
    expect(resolved).toEqual({
      title: 'T',
      on: false,
      count: 3,
      size: 's',
      accent_color: '#c0392b',
      image: null,
      link: '/x',
      product: '700000000000000001',
      future: '1500.00',
    });
    expect(blockCssVariables(settings, resolved)).toEqual({
      '--block-accent-color': '#c0392b',
    });
  });

  it('accepts bilingual text', () => {
    expect(
      resolveBlockSettings([{ key: 't', type: 'text' }], {
        t: { ar: 'ع', en: 'e', xx: 1 },
      }),
    ).toEqual({ t: { ar: 'ع', en: 'e' } });
  });

  it('builds a sample context for previews', () => {
    const context = sampleBlockContext(
      { target: 'product', settings },
      { language: 'fr' },
    );
    expect(context.store).toMatchObject({
      locale: 'fr',
      direction: 'ltr',
      currency: 'DZD',
    });
    expect(context.product?.price).toBe('4500.00');
    expect(context.settings).toMatchObject({
      image: 'https://cdn.tassyir.io/images/sample-banner/public',
      product: '700000000000000001',
    });
  });
});
