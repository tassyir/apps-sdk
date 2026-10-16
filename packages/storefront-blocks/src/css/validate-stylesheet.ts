import { checkCharacters } from '../characters.js';
import type { BlockDeclaration } from '../declaration.js';
import type { BlockError } from '../errors.js';
import { ErrorList, LineIndex, utf8Length } from '../errors.js';
import { BLOCK_LIMITS } from '../limits.js';
import { isStylesheetUrl } from '../urls.js';
import {
  STOREFRONT_THEME_VARIABLES,
  blockSettingVariable,
} from './theme-variables.js';

/**
 * The stylesheet check. It refuses what builder-core's scoper would strip or
 * neutralise when the block renders (`sanitizeAndScopeCSS`), so a developer
 * hears about it at upload instead of finding a style silently gone:
 * - only `@media`, `@supports` and `@keyframes <plain name>`; no `@import`,
 *   `@font-face`, `@layer`, `@container`, `@property`, nesting;
 * - `url()` only on `https://cdn.tassyir.io/`, and no other way to load
 *   anything (`image-set()`, `src()`, `image()` are not on the function list);
 * - `position` only as `static`, `relative`, `absolute` or `sticky`, written
 *   as the word (never `fixed`, never through `var()`); `behavior` and
 *   `-moz-binding` refused. Keeping a block inside its box is the host's
 *   containment (`contain: paint` on the section), which this check does not
 *   replace;
 * - backslash escapes only inside quoted strings, no `<` anywhere (a
 *   stylesheet cannot spell `</style>`), no control or bidi characters;
 * - every string, comment, bracket and block closed.
 * The scoper still scopes every selector to the block's section at render.
 */

type CssTokenKind =
  | 'space'
  | 'comment'
  | 'string'
  | 'url'
  | 'function'
  | 'at'
  | 'ident'
  | 'hash'
  | 'number'
  | 'delim';

interface CssToken {
  kind: CssTokenKind;
  start: number;
  end: number;
  /** Lowercased name of a function, at-keyword or ident. */
  name: string;
  broken: boolean;
}

const isSpace = (c: string | undefined): boolean =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
const isDigit = (c: string | undefined): boolean =>
  c !== undefined && c >= '0' && c <= '9';
const isNameStart = (c: string | undefined): boolean =>
  c !== undefined && (/^[A-Za-z_]$/.test(c) || c.charCodeAt(0) >= 0x80);
const isNameChar = (c: string | undefined): boolean =>
  c !== undefined && (isNameStart(c) || isDigit(c) || c === '-');

function nameEnd(css: string, i: number): number {
  while (i < css.length && isNameChar(css[i])) i++;
  return i;
}

function startsIdent(css: string, i: number): boolean {
  if (css[i] === '-') return isNameStart(css[i + 1]) || css[i + 1] === '-';
  return isNameStart(css[i]);
}

function tokenize(css: string): CssToken[] {
  const tokens: CssToken[] = [];
  let i = 0;
  const push = (
    kind: CssTokenKind,
    start: number,
    end: number,
    name = '',
    broken = false,
  ): void => {
    tokens.push({ kind, start, end, name, broken });
    i = end;
  };
  while (i < css.length) {
    const c = css[i];
    const start = i;
    if (isSpace(c)) {
      let j = i;
      while (isSpace(css[j])) j++;
      push('space', start, j);
    } else if (c === '/' && css[i + 1] === '*') {
      const close = css.indexOf('*/', i + 2);
      if (close === -1) push('comment', start, css.length, '', true);
      else push('comment', start, close + 2);
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      let broken = true;
      while (j < css.length) {
        const d = css[j];
        if (d === c) {
          broken = false;
          j++;
          break;
        }
        if (d === '\n' || d === '\r' || d === '\f') break;
        j += d === '\\' ? 2 : 1;
      }
      push('string', start, Math.min(j, css.length), '', broken);
    } else if (startsIdent(css, i)) {
      const end = nameEnd(css, i);
      const name = css.slice(i, end).toLowerCase();
      if (css[end] !== '(') push('ident', start, end, name);
      else if (name === 'url') {
        let j = end + 1;
        while (isSpace(css[j])) j++;
        if (css[j] === '"' || css[j] === "'")
          push('function', start, end + 1, name);
        else {
          let k = j;
          let broken = false;
          while (k < css.length && css[k] !== ')') {
            const d = css[k];
            if (d === '"' || d === "'" || d === '(' || d === '\\' || isSpace(d))
              broken = true;
            k++;
          }
          if (k >= css.length) broken = true;
          push('url', start, Math.min(k + 1, css.length), 'url', broken);
        }
      } else push('function', start, end + 1, name);
    } else if (c === '@' && startsIdent(css, i + 1)) {
      const end = nameEnd(css, i + 1);
      push('at', start, end, css.slice(i + 1, end).toLowerCase());
    } else if (c === '#' && isNameChar(css[i + 1])) {
      push('hash', start, nameEnd(css, i + 1));
    } else if (isDigit(c) || (c === '.' && isDigit(css[i + 1]))) {
      let j = i;
      while (isDigit(css[j]) || css[j] === '.') j++;
      if (css[j] === '%') j++;
      else if (startsIdent(css, j)) j = nameEnd(css, j);
      push('number', start, j);
    } else push('delim', start, i + 1);
  }
  return tokens;
}

/** Functions a selector or an at-rule's prelude may use. */
const SELECTOR_FUNCTIONS: ReadonlySet<string> = new Set([
  'is',
  'where',
  'not',
  'has',
  'nth-child',
  'nth-last-child',
  'nth-of-type',
  'nth-last-of-type',
  'lang',
  'dir',
  'selector',
]);

/** Functions a declaration's value may use. `url()` is checked on its own. */
const VALUE_FUNCTIONS: ReadonlySet<string> = new Set([
  'var',
  'calc',
  'min',
  'max',
  'clamp',
  'round',
  'abs',
  'sign',
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color',
  'color-mix',
  'light-dark',
  'linear-gradient',
  'radial-gradient',
  'conic-gradient',
  'repeating-linear-gradient',
  'repeating-radial-gradient',
  'repeating-conic-gradient',
  'translate',
  'translatex',
  'translatey',
  'translatez',
  'translate3d',
  'rotate',
  'rotatex',
  'rotatey',
  'rotatez',
  'rotate3d',
  'scale',
  'scalex',
  'scaley',
  'scalez',
  'scale3d',
  'skew',
  'skewx',
  'skewy',
  'matrix',
  'matrix3d',
  'perspective',
  'cubic-bezier',
  'steps',
  'linear',
  'blur',
  'brightness',
  'contrast',
  'drop-shadow',
  'grayscale',
  'hue-rotate',
  'invert',
  'opacity',
  'saturate',
  'sepia',
  'minmax',
  'repeat',
  'fit-content',
  'counter',
  'counters',
  'env',
  'inset',
  'circle',
  'ellipse',
  'polygon',
  'rect',
  'xywh',
]);

/** Keyframes names the scoper refuses: CSS-wide and `animation` keywords. */
const RESERVED_KEYFRAMES = new Set([
  'none',
  'initial',
  'inherit',
  'unset',
  'revert',
  'revert-layer',
  'default',
  'auto',
  'normal',
  'reverse',
  'alternate',
  'alternate-reverse',
  'forwards',
  'backwards',
  'both',
  'running',
  'paused',
  'infinite',
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'step-start',
  'step-end',
]);
const KEYFRAME_SELECTOR =
  /^(?:from|to|\d+(?:\.\d+)?%)(?:\s*,\s*(?:from|to|\d+(?:\.\d+)?%))*$/i;
const MAX_AT_RULE_DEPTH = 3;

/** The positions a block's elements may take; never `fixed`. */
const POSITIONS: ReadonlySet<string> = new Set([
  'static',
  'relative',
  'absolute',
  'sticky',
]);

class StylesheetChecker {
  private i = 0;

  constructor(
    private readonly css: string,
    private readonly tokens: readonly CssToken[],
    private readonly errors: ErrorList,
    /** The `--block-*` variables the block's colour settings publish, when
     * the settings are known. */
    private readonly settingVariables: ReadonlySet<string> | null,
  ) {}

  private peek(): CssToken | undefined {
    return this.tokens[this.i];
  }

  private skipSpace(): void {
    while (this.peek()?.kind === 'space' || this.peek()?.kind === 'comment')
      this.i++;
  }

  private isDelim(token: CssToken | undefined, c: string): boolean {
    return token?.kind === 'delim' && this.css[token.start] === c;
  }

  private text(token: CssToken): string {
    return this.css.slice(token.start, token.end);
  }

  /** The tokens up to (not including) a top-level `{`, `;` or `}`. */
  private prelude(): { tokens: CssToken[]; stop: CssToken | undefined } {
    const tokens: CssToken[] = [];
    let parens = 0;
    for (;;) {
      const token = this.peek();
      if (!token) return { tokens, stop: undefined };
      if (token.kind === 'function') parens++;
      else if (this.isDelim(token, '(')) parens++;
      else if (this.isDelim(token, ')')) parens = Math.max(0, parens - 1);
      else if (
        parens === 0 &&
        (this.isDelim(token, '{') ||
          this.isDelim(token, ';') ||
          this.isDelim(token, '}'))
      ) {
        return { tokens, stop: token };
      }
      tokens.push(token);
      this.i++;
    }
  }

  private checkFunctions(
    tokens: readonly CssToken[],
    allowed: ReadonlySet<string>,
    where: string,
  ): void {
    for (let k = 0; k < tokens.length; k++) {
      const token = tokens[k];
      if (!token) continue;
      if (token.kind === 'url') {
        const href = this.text(token).slice(4, -1).trim();
        if (token.broken || where !== 'value' || !isStylesheetUrl(href)) {
          this.errors.add(
            'BLOCK_CSS_URL_NOT_ALLOWED',
            token.start,
            `url(${href}) is not an image on Tassyir's CDN.`,
          );
        }
        continue;
      }
      if (token.kind !== 'function') continue;
      if (token.name === 'url') {
        let j = k + 1;
        while (tokens[j]?.kind === 'space') j++;
        const str = tokens[j];
        const href = str?.kind === 'string' ? this.text(str).slice(1, -1) : '';
        if (
          where !== 'value' ||
          str?.kind !== 'string' ||
          href.includes('\\') ||
          !isStylesheetUrl(href)
        ) {
          this.errors.add(
            'BLOCK_CSS_URL_NOT_ALLOWED',
            token.start,
            `url("${href}") is not an image on Tassyir's CDN.`,
          );
        }
        continue;
      }
      if (!allowed.has(token.name)) {
        this.errors.add(
          'BLOCK_CSS_FUNCTION_NOT_ALLOWED',
          token.start,
          `${token.name}() is not allowed in a block stylesheet${where === 'value' ? '' : ` ${where}`}.`,
        );
        continue;
      }
      if (token.name === 'var') {
        let j = k + 1;
        while (tokens[j]?.kind === 'space' || tokens[j]?.kind === 'comment')
          j++;
        const ref = tokens[j];
        if (
          ref?.kind === 'ident' &&
          ref.name.startsWith('--st-') &&
          !Object.hasOwn(STOREFRONT_THEME_VARIABLES, ref.name)
        ) {
          this.errors.add(
            'BLOCK_CSS_THEME_VARIABLE_UNKNOWN',
            ref.start,
            `${this.text(ref)} is not a published theme variable.`,
          );
        }
        if (
          ref?.kind === 'ident' &&
          ref.name.startsWith('--block-') &&
          this.settingVariables !== null &&
          !this.settingVariables.has(ref.name)
        ) {
          this.errors.add(
            'BLOCK_SETTING_UNDECLARED',
            ref.start,
            `${this.text(ref)} is not published by a colour setting of this block.`,
            'Declare a setting of type "color" whose key gives this variable (accent_color → --block-accent-color), or use your own variable name.',
          );
        }
      }
    }
  }

  /** `prop: value; …` up to the block's `}`. */
  private declarations(open: CssToken): void {
    for (;;) {
      this.skipSpace();
      const token = this.peek();
      if (!token) {
        this.errors.add(
          'BLOCK_CSS_SYNTAX',
          open.start,
          'This block is never closed with "}".',
        );
        return;
      }
      if (this.isDelim(token, '}')) {
        this.i++;
        return;
      }
      if (this.isDelim(token, ';')) {
        this.i++;
        continue;
      }
      const { tokens, stop } = this.prelude();
      if (this.isDelim(stop, '{')) {
        this.errors.add(
          'BLOCK_CSS_SYNTAX',
          stop?.start ?? token.start,
          'Nested rules are not supported: write each rule at the top level.',
        );
        this.i++;
        this.skipBlock();
        continue;
      }
      if (this.isDelim(stop, ';')) this.i++;
      this.declaration(tokens, token);
    }
  }

  private declaration(tokens: readonly CssToken[], first: CssToken): void {
    const property = tokens[0];
    let j = 1;
    while (tokens[j]?.kind === 'space' || tokens[j]?.kind === 'comment') j++;
    if (property?.kind !== 'ident' || !this.isDelim(tokens[j], ':')) {
      this.errors.add(
        'BLOCK_CSS_SYNTAX',
        first.start,
        'Expected a declaration: property: value;',
      );
      return;
    }
    const value = tokens.slice(j + 1);
    const name = property.name;
    if (name === 'behavior' || name === '-moz-binding') {
      this.errors.add(
        'BLOCK_CSS_DECLARATION_NOT_ALLOWED',
        property.start,
        `${name} is not allowed: it runs code in some browsers.`,
      );
      return;
    }
    if (name === 'position') {
      // One literal keyword, never var() or anything that could compute to
      // `fixed`: `--p: fixed; position: var(--p)` would pass a check on the
      // word alone.
      const words = value.filter(
        (t) => t.kind !== 'space' && t.kind !== 'comment',
      );
      const only = words[0];
      const important =
        words.length === 3 &&
        this.isDelim(words[1], '!') &&
        words[2]?.kind === 'ident' &&
        words[2].name === 'important';
      if (
        (words.length !== 1 && !important) ||
        only?.kind !== 'ident' ||
        !POSITIONS.has(only.name)
      ) {
        this.errors.add(
          'BLOCK_CSS_DECLARATION_NOT_ALLOWED',
          property.start,
          'position takes static, relative, absolute or sticky, written as the word itself: a block stays inside its section.',
        );
        return;
      }
    }
    this.checkFunctions(value, VALUE_FUNCTIONS, 'value');
  }

  /** Skips a `{ … }` whose `{` was just consumed. */
  private skipBlock(): void {
    let depth = 1;
    while (depth > 0) {
      const token = this.peek();
      if (!token) return;
      if (this.isDelim(token, '{')) depth++;
      else if (this.isDelim(token, '}')) depth--;
      this.i++;
    }
  }

  private keyframes(open: CssToken): void {
    for (;;) {
      this.skipSpace();
      const token = this.peek();
      if (!token) {
        this.errors.add(
          'BLOCK_CSS_SYNTAX',
          open.start,
          'This @keyframes is never closed with "}".',
        );
        return;
      }
      if (this.isDelim(token, '}')) {
        this.i++;
        return;
      }
      const { tokens, stop } = this.prelude();
      const selector = tokens
        .map((t) => this.text(t))
        .join('')
        .trim();
      if (!this.isDelim(stop, '{')) {
        this.errors.add(
          'BLOCK_CSS_SYNTAX',
          token.start,
          'Expected a keyframe block: from { … }, 50% { … }, to { … }.',
        );
        if (stop) this.i++;
        continue;
      }
      if (!KEYFRAME_SELECTOR.test(selector)) {
        this.errors.add(
          'BLOCK_CSS_SYNTAX',
          token.start,
          `"${selector}" is not a keyframe selector (from, to or a percentage).`,
        );
      }
      this.i++;
      this.declarations(stop ?? token);
    }
  }

  /** A list of rules: the stylesheet, or the inside of @media / @supports. */
  rules(depth: number, open: CssToken | null): void {
    for (;;) {
      this.skipSpace();
      const token = this.peek();
      if (!token) {
        if (open)
          this.errors.add(
            'BLOCK_CSS_SYNTAX',
            open.start,
            'This block is never closed with "}".',
          );
        return;
      }
      if (this.isDelim(token, '}')) {
        this.i++;
        if (open) return;
        this.errors.add(
          'BLOCK_CSS_SYNTAX',
          token.start,
          'This "}" closes nothing.',
        );
        continue;
      }
      if (token.kind === 'at') {
        this.atRule(token, depth);
        continue;
      }
      const { tokens, stop } = this.prelude();
      if (!this.isDelim(stop, '{')) {
        this.errors.add(
          'BLOCK_CSS_SYNTAX',
          token.start,
          'Expected a rule: selector { property: value; }',
        );
        if (this.isDelim(stop, ';')) this.i++;
        continue;
      }
      this.checkFunctions(tokens, SELECTOR_FUNCTIONS, 'selector');
      this.i++;
      this.declarations(stop ?? token);
    }
  }

  private atRule(token: CssToken, depth: number): void {
    this.i++;
    const { tokens, stop } = this.prelude();
    const name = token.name;
    const isBlock = this.isDelim(stop, '{');
    if ((name === 'media' || name === 'supports') && isBlock) {
      if (depth >= MAX_AT_RULE_DEPTH) {
        this.errors.add(
          'BLOCK_CSS_SYNTAX',
          token.start,
          `@${name} is nested more than ${MAX_AT_RULE_DEPTH.toString()} deep.`,
        );
        this.i++;
        this.skipBlock();
        return;
      }
      this.checkFunctions(tokens, SELECTOR_FUNCTIONS, 'condition');
      this.i++;
      this.rules(depth + 1, stop ?? token);
      return;
    }
    if ((name === 'keyframes' || name === '-webkit-keyframes') && isBlock) {
      const keyframesName = tokens.filter(
        (t) => t.kind !== 'space' && t.kind !== 'comment',
      );
      const only = keyframesName[0];
      if (
        depth > 0 ||
        keyframesName.length !== 1 ||
        only?.kind !== 'ident' ||
        RESERVED_KEYFRAMES.has(only.name)
      ) {
        this.errors.add(
          'BLOCK_CSS_AT_RULE_NOT_ALLOWED',
          token.start,
          depth > 0
            ? '@keyframes must be at the top level of the stylesheet.'
            : '@keyframes needs one plain name that is not a CSS keyword.',
        );
        this.i++;
        this.skipBlock();
        return;
      }
      this.i++;
      this.keyframes(stop ?? token);
      return;
    }
    this.errors.add(
      'BLOCK_CSS_AT_RULE_NOT_ALLOWED',
      token.start,
      `@${name} is not allowed in a block stylesheet.`,
    );
    if (isBlock) {
      this.i++;
      this.skipBlock();
    } else if (this.isDelim(stop, ';')) this.i++;
  }
}

/**
 * Every problem of a block stylesheet, or an empty list. With the block's
 * declaration, `var(--block-…)` must name one of its colour settings. Never
 * throws.
 */
export function validateBlockStylesheet(
  css: unknown,
  declaration: BlockDeclaration = {},
): BlockError[] {
  if (typeof css !== 'string') {
    const errors = new ErrorList('stylesheet', new LineIndex(''));
    errors.add(
      'BLOCK_TEMPLATE_NOT_TEXT',
      0,
      'The stylesheet is not text.',
      'Give the stylesheet as a UTF-8 text string.',
    );
    return errors.sorted();
  }
  const errors = new ErrorList('stylesheet', new LineIndex(css));
  if (utf8Length(css) > BLOCK_LIMITS.stylesheetBytes) {
    errors.add(
      'BLOCK_STYLESHEET_TOO_LARGE',
      0,
      `The stylesheet is ${utf8Length(css).toString()} bytes; the limit is ${BLOCK_LIMITS.stylesheetBytes.toString()}.`,
    );
    return errors.sorted();
  }
  checkCharacters(css, errors, 'stylesheet');
  const tokens = tokenize(css);
  for (const token of tokens) {
    if (token.broken && token.kind !== 'url') {
      errors.add(
        'BLOCK_CSS_SYNTAX',
        token.start,
        token.kind === 'comment'
          ? 'This comment is never closed with */.'
          : 'This string is never closed.',
      );
    }
    if (token.kind === 'delim' && css[token.start] === '<') {
      errors.add(
        'BLOCK_CHARACTER_NOT_ALLOWED',
        token.start,
        'A stylesheet may not contain "<".',
        'Remove the "<": a block stylesheet cannot hold markup.',
      );
    }
    if (token.kind === 'delim' && css[token.start] === '\\') {
      errors.add(
        'BLOCK_CSS_ESCAPE_NOT_ALLOWED',
        token.start,
        'A backslash escape outside a quoted string.',
      );
    }
    if (
      (token.kind === 'string' || token.kind === 'comment') &&
      css.slice(token.start, token.end).includes('<')
    ) {
      errors.add(
        'BLOCK_CHARACTER_NOT_ALLOWED',
        token.start,
        'A stylesheet may not contain "<".',
        'Remove the "<": a block stylesheet cannot hold markup.',
      );
    }
  }
  const settingVariables = declaration.settings
    ? new Set(
        declaration.settings
          .filter((s) => s.type === 'color')
          .map((s) => blockSettingVariable(s.key)),
      )
    : null;
  if (errors.count === 0)
    new StylesheetChecker(css, tokens, errors, settingVariables).rules(0, null);
  return errors.sorted();
}
