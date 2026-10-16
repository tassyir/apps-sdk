import { BLOCK_LIMITS } from './limits.js';

/**
 * Every code a validation or a render can return, with the default `fix`: one
 * sentence an agent can act on. Codes are stable; a fix may be made more
 * precise where the error is raised.
 */
const FIXES = {
  // The file itself
  BLOCK_TEMPLATE_NOT_TEXT:
    'Give the template as a UTF-8 text string with no NUL character.',
  BLOCK_TEMPLATE_EMPTY:
    'Write the markup the block shows; an empty template renders nothing.',
  BLOCK_TEMPLATE_TOO_LARGE: `Keep the template at ${BLOCK_LIMITS.templateBytes / 1024} KB or less: move repeated markup into a loop.`,
  BLOCK_STYLESHEET_TOO_LARGE: `Keep the stylesheet at ${BLOCK_LIMITS.stylesheetBytes / 1024} KB or less.`,
  BLOCK_CHARACTER_NOT_ALLOWED:
    'Delete the character: bidirectional overrides, invisible characters and control characters are refused because they make code read differently from how it runs.',

  // Liquid
  BLOCK_LIQUID_UNTERMINATED:
    'Close the tag: `{{` ends with `}}` and `{%` ends with `%}`.',
  BLOCK_LIQUID_SYNTAX:
    'Rewrite the expression in the supported Liquid syntax (see the storefront blocks guide).',
  BLOCK_TAG_UNKNOWN:
    'Use one of the supported tags: if, elsif, else, unless, case, when, for, break, continue, assign, capture, comment.',
  BLOCK_TAG_NOT_SUPPORTED:
    'Remove the tag: a block is one self-contained template, so put the markup in it directly.',
  BLOCK_TAG_UNCLOSED: 'Add the closing tag (`endif`, `endfor`, …).',
  BLOCK_TAG_UNEXPECTED:
    'Remove the tag, or move it inside the block it belongs to.',
  BLOCK_NESTING_TOO_DEEP: `Keep at most ${BLOCK_LIMITS.tagNesting} Liquid blocks open inside one another.`,
  BLOCK_LOOP_NESTING_TOO_DEEP: `Keep at most ${BLOCK_LIMITS.loopNesting} for loops inside one another.`,
  BLOCK_LOOP_LIMIT_TOO_HIGH: `Loop at most ${BLOCK_LIMITS.loopIterations} times: lower the limit or the range.`,
  BLOCK_FILTER_UNKNOWN:
    'Use a supported filter (see the storefront blocks guide for the list).',
  BLOCK_FILTER_NOT_SUPPORTED:
    'Remove the filter: it is not available in storefront blocks.',
  BLOCK_FILTER_ARGUMENTS:
    'Pass the filter the arguments it takes, positionally: `| name: first, second`.',
  BLOCK_FILTER_CHAIN_TOO_LONG: `Use at most ${BLOCK_LIMITS.filtersPerExpression} filters in one expression; assign an intermediate result.`,
  BLOCK_VARIABLE_UNKNOWN:
    'Read one of the block objects (block, product, store, app) or a variable the template assigns.',
  BLOCK_OBJECT_NOT_AVAILABLE:
    'Set `target = "product"` on the block in tassyir.app.toml, or stop reading the product.',
  BLOCK_PROPERTY_UNKNOWN:
    'Read a property the object has (see the storefront blocks guide).',
  BLOCK_SETTING_UNDECLARED:
    'Declare the setting under [[storefront.blocks.settings]] in tassyir.app.toml, or fix its name.',
  BLOCK_DATA_KEY_UNDECLARED:
    'List the key in the block\'s `data` in tassyir.app.toml (as "<owner>.<key>", declared with storefront visibility).',
  BLOCK_DATA_OWNER_UNKNOWN:
    'Read app data of owner product, store or business: app.data.<owner>.<key>.',
  BLOCK_ASSIGN_RESERVED:
    'Give the variable another name: block, product, store, app and forloop are the block objects.',
  BLOCK_TOO_MANY_VARIABLES: `Use at most ${BLOCK_LIMITS.variables} variables.`,

  // HTML
  BLOCK_HTML_TAG_NOT_ALLOWED:
    'Use an allowed element (see the storefront blocks guide). A block has no script, form, frame or style element.',
  BLOCK_HTML_ATTRIBUTE_NOT_ALLOWED:
    'Remove the attribute: only the attributes the guide lists are kept.',
  BLOCK_HTML_STYLE_ATTRIBUTE:
    "Move the styles to the block's stylesheet and select the element by a class.",
  BLOCK_HTML_EVENT_HANDLER:
    'Remove the handler: storefront blocks run no JavaScript.',
  BLOCK_HTML_URL_NOT_ALLOWED:
    'Link to an https:// address, a path on the store (/…) or a #fragment.',
  BLOCK_HTML_IMAGE_SOURCE:
    'Write the image as src="{{ <image> | image_url: <width> }}": images come from Tassyir\'s CDN only.',
  BLOCK_HTML_ATTRIBUTE_VALUE:
    'Give the attribute a value it accepts (see the storefront blocks guide).',
  BLOCK_HTML_DYNAMIC_TAG:
    'Write the element name in the template; choose between whole elements with if/else instead.',
  BLOCK_HTML_DYNAMIC_ATTRIBUTE:
    'Write the attribute name in the template; put Liquid only inside a quoted value.',
  BLOCK_HTML_UNQUOTED_ATTRIBUTE: 'Quote the attribute value: attr="{{ … }}".',
  BLOCK_HTML_UNTERMINATED_TAG:
    'Close the tag with ">", and close every quoted attribute value.',
  BLOCK_HTML_TOO_DEEP: `Keep at most ${BLOCK_LIMITS.htmlNesting} elements open inside one another.`,
  BLOCK_HTML_ENTITY_UNKNOWN:
    'Write the character itself, or a numeric reference such as &#8364;.',

  // CSS
  BLOCK_CSS_SYNTAX:
    'Fix the stylesheet: close every string, comment, bracket and block, and do not nest rules.',
  BLOCK_CSS_AT_RULE_NOT_ALLOWED:
    'Use only @media, @supports and @keyframes (with a plain name).',
  BLOCK_CSS_URL_NOT_ALLOWED:
    'Load images in CSS from https://cdn.tassyir.io/ only, or use an <img> with image_url.',
  BLOCK_CSS_FUNCTION_NOT_ALLOWED:
    'Use a supported CSS function (see the storefront blocks guide).',
  BLOCK_CSS_DECLARATION_NOT_ALLOWED:
    'Write position as static, relative, absolute or sticky, and remove behavior and -moz-binding: a block stays in its section and runs no code.',
  BLOCK_CSS_ESCAPE_NOT_ALLOWED:
    'Write the characters themselves: backslash escapes are allowed inside quoted strings only.',
  BLOCK_CSS_THEME_VARIABLE_UNKNOWN:
    'Use a published theme variable (STOREFRONT_THEME_VARIABLES) or one of your own that does not start with --st-.',

  // Render
  BLOCK_RENDER_CONTEXT_INVALID:
    'Pass a render context with a store, and a product for a product block.',
  BLOCK_RENDER_STEP_LIMIT:
    'Do less work in the template: fewer loop iterations, fewer filters on long strings.',
  BLOCK_RENDER_OUTPUT_LIMIT: `Keep the rendered HTML at ${BLOCK_LIMITS.outputBytes / 1024} KB or less: show fewer items.`,
  BLOCK_RENDER_STRING_LIMIT: `Keep each string the template builds under ${BLOCK_LIMITS.stringLength.toString()} characters.`,
  BLOCK_RENDER_ARRAY_LIMIT: `Keep each list the template builds at ${BLOCK_LIMITS.arrayItems.toString()} items or fewer.`,
  BLOCK_RENDER_DATA_TOO_LARGE: `Keep the app data a block reads at ${BLOCK_LIMITS.dataBytes / 1024} KB or less, nested at most ${BLOCK_LIMITS.dataDepth.toString()} deep, with lists of at most ${BLOCK_LIMITS.arrayItems.toString()} items.`,
  BLOCK_RENDER_FAILED:
    'Report the template and the data to Tassyir: the renderer stopped on an error it does not name.',
} as const;

/** Every code, in a stable order. */
export const BLOCK_ERROR_CODES = Object.freeze(
  Object.keys(FIXES) as BlockErrorCode[],
);

export type BlockErrorCode = keyof typeof FIXES;

/** Which input an error is about. */
export type BlockErrorSource = 'template' | 'stylesheet' | 'render';

/**
 * One problem, in the shape of the manifest's errors plus a position:
 * `line` and `column` are 1-based (UTF-16 code units in the line, as editors
 * count), and point at the start of what is wrong. A render error has no
 * position: both are 0.
 */
export interface BlockError {
  code: BlockErrorCode;
  source: BlockErrorSource;
  line: number;
  column: number;
  message: string;
  fix: string;
}

/** The default fix of a code. */
export function blockErrorFix(code: BlockErrorCode): string {
  return FIXES[code];
}

/** Turns offsets into 1-based lines and columns. */
export class LineIndex {
  private readonly starts: number[] = [0];

  constructor(text: string) {
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 10) this.starts.push(i + 1);
      else if (c === 13) {
        if (text.charCodeAt(i + 1) === 10) i++;
        this.starts.push(i + 1);
      }
    }
  }

  position(offset: number): { line: number; column: number } {
    let low = 0;
    let high = this.starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((this.starts[mid] ?? 0) <= offset) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: offset - (this.starts[low] ?? 0) + 1 };
  }
}

/** Collects errors for one source, capped at `BLOCK_LIMITS.errors`. */
export class ErrorList {
  readonly errors: BlockError[] = [];
  private dropped = 0;

  constructor(
    private readonly source: BlockErrorSource,
    private readonly lines: LineIndex,
  ) {}

  add(
    code: BlockErrorCode,
    offset: number,
    message: string,
    fix: string = blockErrorFix(code),
  ): void {
    if (this.errors.length >= BLOCK_LIMITS.errors) {
      this.dropped++;
      return;
    }
    const { line, column } = this.lines.position(offset);
    this.errors.push({
      code,
      source: this.source,
      line,
      column,
      message,
      fix,
    });
  }

  get count(): number {
    return this.errors.length + this.dropped;
  }

  /** The errors sorted by position (then code), with the overflow noted. */
  sorted(): BlockError[] {
    const sorted = this.errors
      .map((error) => ({ ...error }))
      .sort(
        (a, b) =>
          a.line - b.line ||
          a.column - b.column ||
          (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
      );
    const last = sorted[sorted.length - 1];
    if (this.dropped > 0 && last) {
      last.message += ` (${this.dropped.toString()} more error${this.dropped === 1 ? '' : 's'} not shown)`;
    }
    return sorted;
  }
}

/** Length of `text` in UTF-8 bytes, without allocating. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}
