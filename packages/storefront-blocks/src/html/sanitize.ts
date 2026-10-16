import { cleanRenderedText } from '../characters.js';
import { BLOCK_LIMITS } from '../limits.js';
import { linkKind } from '../urls.js';
import type { Namespace } from './allowlist.js';
import {
  SVG_ATTRIBUTE_CASE,
  VOID_ELEMENTS,
  attributeRule,
  childNamespace,
  elementRules,
} from './allowlist.js';
import { checkAttributeValue } from './attributes.js';
import { decodeEntities } from './entities.js';
import { escapeHtml } from './escape.js';
import type { HtmlAttribute } from './tokenizer.js';
import { HtmlTokenizer, RAW_TEXT_ELEMENTS } from './tokenizer.js';

interface OpenElement {
  name: string;
  ns: Namespace;
}

/** The attributes of an allowed element, checked and written out. */
function writeAttributes(
  name: string,
  ns: Namespace,
  attributes: readonly HtmlAttribute[],
): string | null {
  const seen = new Set<string>();
  let out = '';
  let href: string | null = null;
  let target: string | null = null;
  let hasSource = false;
  for (const attribute of attributes) {
    // The browser keeps the first of two attributes with one name.
    if (seen.has(attribute.name)) continue;
    seen.add(attribute.name);
    const rule = attributeRule(name, attribute.name, ns);
    if (!rule) continue;
    const value = checkAttributeValue(rule, decodeEntities(attribute.rawValue));
    if (value === null) continue;
    if (name === 'a' && attribute.name === 'href') href = value;
    if (name === 'a' && attribute.name === 'target') target = value;
    if (name === 'img' && attribute.name === 'src') hasSource = true;
    const written =
      ns !== 'html' || name === 'svg'
        ? (SVG_ATTRIBUTE_CASE[attribute.name] ?? attribute.name)
        : attribute.name;
    out += ` ${written}="${escapeHtml(value)}"`;
  }
  if (name === 'img') {
    // An image is only ever one image_url made: without it, nothing.
    if (!hasSource) return null;
    out += ' loading="lazy" decoding="async"';
  }
  if (name === 'a') {
    const kind = href === null ? null : linkKind(href);
    if (kind === 'external') out += ' rel="nofollow noopener noreferrer"';
    else if (target === '_blank') out += ' rel="noopener"';
  }
  return out;
}

/**
 * The HTML gate every rendered block passes through. It parses the HTML and
 * writes a new document from what is allowed:
 * - allowed elements only (`BLOCK_HTML_ALLOWLIST`), SVG shapes only inside
 *   `<svg>`, HTML only outside it, and text only inside an SVG `<title>`
 *   (the browser parses its content as HTML);
 * - allowed attributes only, each value checked against its rule and written
 *   double-quoted and escaped; links get `rel`, images `loading="lazy"`;
 * - text decoded, cleaned of control and bidirectional characters, and
 *   escaped;
 * - comments, doctypes and processing instructions removed; the content of
 *   script, style, textarea, title and the other raw-text elements removed
 *   with them; a forbidden element's other content kept, itself filtered;
 * - every element closed, at most `BLOCK_LIMITS.htmlNesting` deep.
 *
 * The output is canonical: sanitising it again gives the same string.
 */
export function sanitizeBlockHtml(html: string): string {
  const tokenizer = new HtmlTokenizer(html);
  const stack: OpenElement[] = [];
  let out = '';

  const closeTo = (index: number): void => {
    while (stack.length > index) {
      const open = stack.pop();
      if (open) out += `</${open.name}>`;
    }
  };

  for (;;) {
    const token = tokenizer.next();
    if (token.type === 'eof') break;
    if (token.type === 'comment') continue;
    if (token.type === 'text') {
      out += escapeHtml(cleanRenderedText(decodeEntities(token.raw)));
      continue;
    }
    const top = stack[stack.length - 1];
    const ns: Namespace = top?.ns ?? 'html';
    if (token.type === 'start') {
      if (ns === 'html' && RAW_TEXT_ELEMENTS.has(token.name)) {
        tokenizer.skipRawText(token.name);
        continue;
      }
      if (
        !elementRules(token.name, ns) ||
        stack.length >= BLOCK_LIMITS.htmlNesting
      )
        continue;
      const attributes = writeAttributes(token.name, ns, token.attributes);
      if (attributes === null) continue;
      out += `<${token.name}${attributes}>`;
      const childNs = childNamespace(token.name, ns);
      if (ns === 'html' && VOID_ELEMENTS.has(token.name)) continue;
      if (token.selfClosing && childNs !== 'html') {
        out += `</${token.name}>`;
        continue;
      }
      stack.push({ name: token.name, ns: childNs });
      continue;
    }
    // An end tag closes the nearest open element of that name, and every
    // element opened inside it; one with nothing to close is dropped.
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i]?.name === token.name) {
        closeTo(i);
        break;
      }
    }
  }
  closeTo(0);
  return out;
}
