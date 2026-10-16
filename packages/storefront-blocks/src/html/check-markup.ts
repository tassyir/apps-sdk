import type { ErrorList } from '../errors.js';
import { BLOCK_LIMITS } from '../limits.js';
import type { Pipeline } from '../liquid/ast.js';
import type { LiquidToken } from '../liquid/lexer.js';
import type { Namespace } from './allowlist.js';
import {
  VOID_ELEMENTS,
  attributeRule,
  childNamespace,
  elementRules,
} from './allowlist.js';
import { checkAttributeValue } from './attributes.js';
import { decodeEntities } from './entities.js';
import { HtmlTokenizer, RAW_TEXT_ELEMENTS } from './tokenizer.js';

/** Stands for one character of a `{{ … }}` in the masked template. */
const OUTPUT_MARK = '\uE000';

/**
 * The template with its Liquid blanked out, offsets unchanged: every `{{ … }}`
 * becomes U+E000 characters (a value the render will insert), every
 * `{% … %}` and every comment body becomes spaces, line breaks kept. What is
 * left is the markup the template always writes, which is checked here so the
 * developer hears about a forbidden element at upload, with its line, rather
 * than finding it silently removed at render.
 */
function maskTemplate(
  source: string,
  tokens: readonly LiquidToken[],
): { masked: string; liquid: Uint8Array } {
  const chars = source.replace(/[^\n\r]/g, ' ').split('');
  // 1 where a Liquid tag or comment was (not text, not an output).
  const liquid = new Uint8Array(source.length).fill(1);
  for (const token of tokens) {
    if (token.kind === 'text') {
      for (let i = token.start; i < token.end; i++) {
        chars[i] = source[i] ?? ' ';
        liquid[i] = 0;
      }
    } else if (token.kind === 'output') {
      for (let i = token.start; i < token.end; i++) {
        if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = OUTPUT_MARK;
        liquid[i] = 0;
      }
    }
  }
  return { masked: chars.join(''), liquid };
}

function hasLiquidTag(liquid: Uint8Array, from: number, to: number): boolean {
  for (let i = from; i < to; i++) if (liquid[i] === 1) return true;
  return false;
}

/**
 * Checks the static markup of a template: elements, attributes, the values
 * written in the template, and where Liquid sits inside tags.
 */
export function checkTemplateMarkup(
  source: string,
  tokens: readonly LiquidToken[],
  outputs: ReadonlyMap<number, Pipeline>,
  errors: ErrorList,
): void {
  // `<{{ name }}` or `</{% … %}`: an element whose name is decided by data.
  for (const match of source.matchAll(/<\/?\{[{%]/g)) {
    errors.add(
      'BLOCK_HTML_DYNAMIC_TAG',
      match.index,
      'An element name comes from Liquid.',
    );
  }

  const { masked, liquid } = maskTemplate(source, tokens);
  const tokenizer = new HtmlTokenizer(masked);
  const stack: { name: string; ns: Namespace }[] = [];
  let reportedDepth = false;

  const entities = (raw: string, base: number): string =>
    decodeEntities(raw, (name, offset) => {
      errors.add(
        'BLOCK_HTML_ENTITY_UNKNOWN',
        base + offset,
        `&${name}; is not a character reference blocks know.`,
      );
    });

  for (;;) {
    const token = tokenizer.next();
    if (token.type === 'eof') {
      if (token.start < masked.length) {
        errors.add(
          'BLOCK_HTML_UNTERMINATED_TAG',
          token.start,
          'This tag is never closed with ">": browsers drop it.',
        );
      }
      break;
    }
    if (token.type === 'comment') continue;
    if (token.type === 'text') {
      entities(token.raw, token.start);
      continue;
    }
    if (token.name.includes(OUTPUT_MARK)) {
      errors.add(
        'BLOCK_HTML_DYNAMIC_TAG',
        token.start,
        'An element name comes from Liquid.',
      );
      continue;
    }
    const top = stack[stack.length - 1];
    const ns: Namespace = top?.ns ?? 'html';

    if (token.type === 'end') {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]?.name === token.name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    if (ns === 'html' && RAW_TEXT_ELEMENTS.has(token.name)) {
      errors.add(
        'BLOCK_HTML_TAG_NOT_ALLOWED',
        token.start,
        `<${token.name}> is not allowed in a block.`,
      );
      tokenizer.skipRawText(token.name);
      continue;
    }
    if (!elementRules(token.name, ns)) {
      errors.add(
        'BLOCK_HTML_TAG_NOT_ALLOWED',
        token.start,
        ns === 'svg'
          ? `<${token.name}> is not allowed inside <svg>.`
          : ns === 'text'
            ? `<${token.name}> is not allowed inside an SVG <title>: it holds text only.`
            : `<${token.name}> is not allowed in a block.`,
      );
      continue;
    }

    const seen = new Set<string>();
    for (const attribute of token.attributes) {
      const name = attribute.name;
      if (name.includes(OUTPUT_MARK)) {
        errors.add(
          'BLOCK_HTML_DYNAMIC_ATTRIBUTE',
          attribute.nameStart,
          'An attribute name comes from Liquid.',
        );
        continue;
      }
      if (seen.has(name)) continue;
      seen.add(name);
      const valueEnd = attribute.valueStart + attribute.rawValue.length;
      const dynamic =
        attribute.rawValue.includes(OUTPUT_MARK) ||
        hasLiquidTag(liquid, attribute.valueStart, valueEnd);
      if (
        attribute.hasValue &&
        attribute.quote === '' &&
        (dynamic ||
          hasLiquidTag(
            liquid,
            attribute.nameStart + name.length,
            attribute.valueStart,
          ))
      ) {
        errors.add(
          'BLOCK_HTML_UNQUOTED_ATTRIBUTE',
          attribute.nameStart,
          `The value of ${name} holds Liquid but is not quoted.`,
        );
        continue;
      }
      const rule = attributeRule(token.name, name, ns);
      if (!rule) {
        if (name.startsWith('on')) {
          errors.add(
            'BLOCK_HTML_EVENT_HANDLER',
            attribute.nameStart,
            `${name} is an event handler.`,
          );
        } else if (name === 'style') {
          errors.add(
            'BLOCK_HTML_STYLE_ATTRIBUTE',
            attribute.nameStart,
            'A style attribute is not allowed.',
          );
        } else {
          errors.add(
            'BLOCK_HTML_ATTRIBUTE_NOT_ALLOWED',
            attribute.nameStart,
            `<${token.name}> may not have the attribute ${name}.`,
          );
        }
        continue;
      }
      if (rule.kind === 'image') {
        // The value must be exactly one {{ … | image_url: <width> }}.
        const trimmed = attribute.rawValue.trim();
        const at = attribute.valueStart + attribute.rawValue.indexOf(trimmed);
        const pipeline = outputs.get(at);
        const whole =
          pipeline !== undefined &&
          /^\uE000+$/.test(trimmed) &&
          !hasLiquidTag(liquid, attribute.valueStart, valueEnd);
        const last = pipeline?.filters[pipeline.filters.length - 1];
        if (!whole || last?.name !== 'image_url') {
          errors.add(
            'BLOCK_HTML_IMAGE_SOURCE',
            attribute.valueStart,
            'An <img> src must be one {{ … | image_url: <width> }}.',
          );
        }
        continue;
      }
      if (dynamic) {
        for (const [at, pipeline] of outputs) {
          if (at < attribute.valueStart || at >= valueEnd) continue;
          if (pipeline.filters[pipeline.filters.length - 1]?.name === 'stars') {
            errors.add(
              'BLOCK_HTML_ATTRIBUTE_VALUE',
              at,
              'stars makes markup, which cannot go inside an attribute.',
              'Put {{ … | stars }} between tags, and the number itself in the attribute.',
            );
          }
        }
        continue;
      }
      const value = entities(attribute.rawValue, attribute.valueStart);
      if (rule.kind === 'classes') {
        const bad = value
          .split(/[ \t\n\f\r]+/)
          .find((t) => t !== '' && !/^[A-Za-z0-9_-]{1,64}$/.test(t));
        if (bad !== undefined) {
          errors.add(
            'BLOCK_HTML_ATTRIBUTE_VALUE',
            attribute.valueStart,
            `The class "${bad}" would be dropped: a class name is letters, digits, "_" and "-".`,
          );
          continue;
        }
      }
      if (checkAttributeValue(rule, value) === null) {
        if (rule.kind === 'link') {
          errors.add(
            'BLOCK_HTML_URL_NOT_ALLOWED',
            attribute.valueStart,
            `"${value}" is not an address a block may link to.`,
          );
        } else {
          errors.add(
            'BLOCK_HTML_ATTRIBUTE_VALUE',
            attribute.valueStart,
            `"${value}" is not a value ${name} accepts.`,
          );
        }
      }
    }
    if (token.name === 'img' && !seen.has('src')) {
      errors.add(
        'BLOCK_HTML_IMAGE_SOURCE',
        token.start,
        'An <img> needs src="{{ … | image_url: <width> }}".',
      );
    }

    const childNs = childNamespace(token.name, ns);
    if (
      (ns === 'html' && VOID_ELEMENTS.has(token.name)) ||
      (token.selfClosing && childNs !== 'html')
    )
      continue;
    stack.push({ name: token.name, ns: childNs });
    if (stack.length > BLOCK_LIMITS.htmlNesting && !reportedDepth) {
      reportedDepth = true;
      errors.add(
        'BLOCK_HTML_TOO_DEEP',
        token.start,
        `Elements are nested more than ${BLOCK_LIMITS.htmlNesting.toString()} deep.`,
      );
    }
  }
}
