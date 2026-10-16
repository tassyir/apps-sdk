import type { DefaultTreeAdapterMap } from 'parse5';
import { parseFragment } from 'parse5';
import { describe, expect, it } from 'vitest';
import {
  MARKUP_VECTORS,
  STYLESHEET_ACCEPTED,
  STYLESHEET_VECTORS,
  buildCorpus,
  createRandom,
  runCorpus,
} from './fuzz-corpus.test-harness.js';
import {
  BLOCK_HTML_ALLOWLIST,
  BLOCK_LIMITS,
  compileBlockTemplate,
  isBlockImageSource,
  linkKind,
  renderCompiledBlock,
  sanitizeBlockHtml,
  validateBlockStylesheet,
} from './index.js';

/**
 * The proof the ticket asks for: whatever a template and its data hold, the
 * HTML a block renders, once a real HTML parser builds it, has only allowed
 * elements and attributes. parse5 implements the standard's tree builder:
 * foster parenting, implied end tags, adoption agency, and the foreign
 * content rules (an `<img>` inside `<svg>` breaks out to HTML) that most
 * sanitiser bypasses rely on. The fragment is parsed in a `<div>`, as the
 * storefront inserts it.
 */

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
type ParentNode = DefaultTreeAdapterMap['parentNode'];

const HTML_NS = 'http://www.w3.org/1999/xhtml';
const SVG_NS = 'http://www.w3.org/2000/svg';
const BIDI_CONTROLS = new RegExp(
  `[${String.fromCharCode(0x202a)}-${String.fromCharCode(0x202e)}${String.fromCharCode(0x2066)}-${String.fromCharCode(0x2069)}]`,
);

/** A URL the way the browser's URL parser reads it: controls and spaces
 * around it and tabs and newlines inside it removed. */
function withoutControls(value: string): string {
  return Array.from(value)
    .filter((char) => (char.codePointAt(0) ?? 0) > 0x20)
    .join('');
}
const SCRIPT_URL = /^(?:javascript|data|vbscript):/i;

const context = parseFragment('<div></div>').childNodes[0] as Element;

function isElement(node: Node): node is Element {
  return 'tagName' in node;
}

/** Every reason the parsed HTML breaks the allowlist; [] when it does not. */
function violations(html: string): string[] {
  const found: string[] = [];
  const fragment = parseFragment(context, html, { scriptingEnabled: true });
  const walk = (parent: ParentNode, depth: number): void => {
    for (const node of parent.childNodes) {
      if (node.nodeName === '#comment') found.push('a comment');
      if (node.nodeName === '#documentType') found.push('a doctype');
      if (
        node.nodeName === '#text' &&
        'value' in node &&
        BIDI_CONTROLS.test(node.value)
      )
        found.push('a bidi control in text');
      if (!isElement(node)) continue;
      const name = node.tagName;
      let allowed: readonly string[] | undefined;
      const ns: string = node.namespaceURI;
      if (ns === HTML_NS) allowed = BLOCK_HTML_ALLOWLIST.html[name];
      else if (ns === SVG_NS) allowed = BLOCK_HTML_ALLOWLIST.svg[name];
      if (!allowed) {
        found.push(`<${name}> in ${node.namespaceURI}`);
        continue;
      }
      const computed = BLOCK_HTML_ALLOWLIST.computed[name] ?? [];
      for (const attribute of node.attrs) {
        if (attribute.namespace)
          found.push(
            `namespaced attribute ${attribute.prefix ?? ''}:${attribute.name}`,
          );
        if (
          !allowed.includes(attribute.name) &&
          !computed.includes(attribute.name)
        ) {
          found.push(`<${name} ${attribute.name}>`);
        }
        if (attribute.name.toLowerCase().startsWith('on'))
          found.push(`handler ${attribute.name}`);
        if (attribute.name === 'href') {
          if (linkKind(attribute.value) === null)
            found.push(`href ${JSON.stringify(attribute.value)}`);
          if (SCRIPT_URL.test(withoutControls(attribute.value))) {
            found.push(`script href ${JSON.stringify(attribute.value)}`);
          }
        }
        if (
          name === 'img' &&
          attribute.name === 'src' &&
          !isBlockImageSource(attribute.value)
        ) {
          found.push(`img src ${JSON.stringify(attribute.value)}`);
        }
      }
      if (name === 'img' && !node.attrs.some((a) => a.name === 'src'))
        found.push('an <img> without src');
      if (depth > BLOCK_LIMITS.htmlNesting + 8)
        found.push(`nesting depth ${depth.toString()}`);
      walk(node, depth + 1);
    }
  };
  walk(fragment, 1);
  return found;
}

describe('the fuzzed corpus', () => {
  const cases = buildCorpus();
  const result = runCorpus(
    {
      compileBlockTemplate,
      renderCompiledBlock,
      sanitizeBlockHtml,
      validateBlockStylesheet,
    },
    cases,
  );

  it('is large and mostly renders', () => {
    expect(cases.length).toBeGreaterThan(1500);
    const rendered = result.cases.filter((c) => c.html !== null).length;
    expect(rendered).toBeGreaterThan(cases.length * 0.9);
  });

  it('never renders a forbidden element or attribute, a script URL or a comment', () => {
    const failures: string[] = [];
    for (const output of result.cases) {
      if (output.html === null) continue;
      const problems = violations(output.html);
      if (problems.length > 0)
        failures.push(
          `${output.id}: ${problems.join(', ')}\n  ${output.html.slice(0, 300)}`,
        );
    }
    expect(failures).toEqual([]);
  });

  it('renders HTML that sanitising again leaves unchanged', () => {
    const changed = result.cases
      .filter((c) => c.html !== null && sanitizeBlockHtml(c.html) !== c.html)
      .map((c) => c.id);
    expect(changed).toEqual([]);
  });

  it('refuses at upload every template that plants a forbidden construct', () => {
    // Each markup vector that holds a forbidden element, handler, style,
    // script URL or foreign host must fail the upload check on its own.
    const accepted = MARKUP_VECTORS.filter(
      (vector) => compileBlockTemplate(vector, {}).ok,
    );
    // What is left is text, comments, harmless nesting and allowed markup.
    expect(accepted).toEqual([
      '<p title="&quot; onmouseover=&quot;alert(1)">x</p>',
      `<p title='" onmouseover="alert(1)'>x</p>`,
      '<!--<script>alert(1)</script>-->',
      '<![CDATA[<script>alert(1)</script>]]>',
      '&lt;script&gt;alert(1)&lt;/script&gt;',
      '&#60;script&#62;alert(1)&#60;/script&#62;',
      '&#x3C;img src=x onerror=alert(1)&#x3E;',
      '&#0000060script&#0000062;',
      '&lt&gt&amp',
      '&amp;lt;script&amp;gt;',
      '<ul><li>one<li>two</ul></li></ul></div></div>',
      '<a href="/products/x"><a href="/products/y">nested</a></a>',
      '<p><div>block in p</div></p>',
      '<meter value="4" min="0" max="5">4</meter><progress value="2" max="5"></progress>',
      '<time datetime="2026-10-16T10:00:00Z">today</time>',
      '<span lang="ar" dir="rtl" role="img" aria-label="x">x</span>',
      '<svg viewbox="0 0 24 24" aria-hidden="true"><path d="M12 2l3 7h7l-5.5 4 2 7-6.5-4.5L5.5 20l2-7L2 9h7z" fill="currentColor"/></svg>',
    ]);
  });
});

describe('random markup through the HTML gate', () => {
  const ALPHABET = [
    '<',
    '>',
    '/',
    '"',
    "'",
    '=',
    '&',
    ';',
    '#',
    '!',
    '-',
    ' ',
    '\n',
    'a',
    'x',
    's',
    'v',
    'g',
    '1',
    ':',
    'script',
    'img',
    'svg',
    'math',
    'style',
    'title',
    'textarea',
    'noscript',
    'template',
    'iframe',
    'a',
    'p',
    'div',
    'table',
    'td',
    'href',
    'src',
    'onerror',
    'onclick',
    'style',
    'javascript:',
    'data:',
    'https://cdn.tassyir.io/images/x/public',
    '<!--',
    '-->',
    '<![CDATA[',
    ']]>',
    '&lt;',
    '&#60;',
    '&#x3c',
    '&amp;',
    String.fromCharCode(0),
    String.fromCharCode(0x202e),
    String.fromCharCode(0x200b),
    'path',
    'foreignObject',
    'xlink:href',
    'title',
    '</',
    '/>',
    'class',
    'id',
    'name',
  ];

  it('5,000 random strings: never a forbidden element or attribute, always idempotent', () => {
    const random = createRandom(7);
    const failures: string[] = [];
    for (let n = 0; n < 5000; n++) {
      let input = '';
      const length = 1 + Math.floor(random() * 60);
      for (let i = 0; i < length; i++)
        input += ALPHABET[Math.floor(random() * ALPHABET.length)] ?? '';
      const output = sanitizeBlockHtml(input);
      const problems = violations(output);
      if (problems.length > 0)
        failures.push(
          `${JSON.stringify(input)} → ${output}: ${problems.join(', ')}`,
        );
      if (sanitizeBlockHtml(output) !== output)
        failures.push(`not idempotent: ${JSON.stringify(input)} → ${output}`);
    }
    expect(failures.slice(0, 20)).toEqual([]);
  });

  it('every markup vector, sanitised alone', () => {
    const failures = MARKUP_VECTORS.map(
      (vector) => [vector, sanitizeBlockHtml(vector)] as const,
    )
      .filter(
        ([, output]) =>
          violations(output).length > 0 || sanitizeBlockHtml(output) !== output,
      )
      .map(([vector, output]) => `${vector} → ${output}`);
    expect(failures).toEqual([]);
  });
});

describe('the stylesheet corpus', () => {
  it('refuses every planted escape', () => {
    const accepted = STYLESHEET_VECTORS.filter(
      (css) => validateBlockStylesheet(css).length === 0,
    );
    expect(accepted).toEqual([]);
  });

  it('accepts ordinary block styles', () => {
    const refused = STYLESHEET_ACCEPTED.map(
      (css) => [css, validateBlockStylesheet(css)] as const,
    ).filter(([, errors]) => errors.length > 0);
    expect(refused).toEqual([]);
  });
});
