/**
 * An HTML tokenizer following the tag, attribute, comment and raw-text rules
 * of the HTML standard's tokenizer (§13.2.5), as far as a block needs them.
 *
 * It does not have to agree with a browser on every malformed input to be
 * safe: the sanitiser never passes input through. It rebuilds the output from
 * these tokens, with only allowed elements and attributes and every text and
 * value escaped, so the browser parses the sanitiser's canonical HTML, not the
 * template's. Where this tokenizer and a browser disagree, the cost is which
 * text survives, never what runs.
 */

export interface HtmlAttribute {
  /** ASCII-lowercased, as the browser stores it. */
  name: string;
  /** As written: character references not decoded yet. */
  rawValue: string;
  /** `"`, `'`, or '' for an unquoted (or missing) value. */
  quote: string;
  nameStart: number;
  valueStart: number;
  hasValue: boolean;
}

export type HtmlToken =
  | { type: 'text'; raw: string; start: number; end: number }
  | {
      type: 'start';
      name: string;
      attributes: HtmlAttribute[];
      selfClosing: boolean;
      start: number;
      end: number;
    }
  | { type: 'end'; name: string; start: number; end: number }
  | { type: 'comment'; start: number; end: number }
  | { type: 'eof'; start: number; end: number };

const isSpace = (c: string | undefined): boolean =>
  c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r';
const isAsciiLetter = (c: string | undefined): boolean =>
  c !== undefined && /^[A-Za-z]$/.test(c);
const asciiLower = (s: string): string =>
  s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** Elements whose content the browser does not parse as markup (in HTML). */
export const RAW_TEXT_ELEMENTS: ReadonlySet<string> = new Set([
  'script',
  'style',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'noscript',
  'textarea',
  'title',
  'plaintext',
]);

export class HtmlTokenizer {
  private pos = 0;
  private lower: string | undefined;
  private dashClose = -2;
  private bangClose = -2;

  constructor(private readonly src: string) {}

  /**
   * Skips the content of a raw-text element whose start tag was just read,
   * through its end tag. `plaintext` has no end: it takes the rest.
   */
  skipRawText(name: string): void {
    if (name === 'plaintext') {
      this.pos = this.src.length;
      return;
    }
    this.lower ??= asciiLower(this.src);
    const lower = this.lower;
    let at = this.pos;
    for (;;) {
      const found = lower.indexOf(`</${name}`, at);
      if (found === -1) {
        this.pos = this.src.length;
        return;
      }
      const after = this.src[found + 2 + name.length];
      if (
        after === undefined ||
        isSpace(after) ||
        after === '/' ||
        after === '>'
      ) {
        const close = this.src.indexOf('>', found);
        this.pos = close === -1 ? this.src.length : close + 1;
        return;
      }
      at = found + 1;
    }
  }

  next(): HtmlToken {
    const src = this.src;
    const start = this.pos;
    if (start >= src.length) return { type: 'eof', start, end: start };

    if (src[start] !== '<') {
      const lt = src.indexOf('<', start);
      const end = lt === -1 ? src.length : lt;
      this.pos = end;
      return { type: 'text', raw: src.slice(start, end), start, end };
    }

    const c1 = src[start + 1];
    if (isAsciiLetter(c1)) return this.tag(start, start + 1, false);
    if (c1 === '/') {
      const c2 = src[start + 2];
      if (isAsciiLetter(c2)) return this.tag(start, start + 2, true);
      if (c2 === '>') {
        this.pos = start + 3;
        return { type: 'comment', start, end: this.pos };
      }
      if (c2 === undefined) {
        this.pos = src.length;
        return { type: 'text', raw: '</', start, end: this.pos };
      }
      return this.bogusComment(start);
    }
    if (c1 === '!') {
      if (src.startsWith('<!--', start)) return this.comment(start);
      return this.bogusComment(start);
    }
    if (c1 === '?') return this.bogusComment(start);
    // A lone `<` is text.
    this.pos = start + 1;
    return { type: 'text', raw: '<', start, end: this.pos };
  }

  private bogusComment(start: number): HtmlToken {
    const close = this.src.indexOf('>', start);
    this.pos = close === -1 ? this.src.length : close + 1;
    return { type: 'comment', start, end: this.pos };
  }

  private comment(start: number): HtmlToken {
    const src = this.src;
    const body = start + 4;
    // `<!-->` and `<!--->` end at once.
    if (src[body] === '>') {
      this.pos = body + 1;
      return { type: 'comment', start, end: this.pos };
    }
    if (src[body] === '-' && src[body + 1] === '>') {
      this.pos = body + 2;
      return { type: 'comment', start, end: this.pos };
    }
    // The next `-->` and `--!>` are found again only once passed, so a run of
    // comments stays linear.
    if (this.dashClose !== -1 && this.dashClose < body)
      this.dashClose = src.indexOf('-->', body);
    if (this.bangClose !== -1 && this.bangClose < body)
      this.bangClose = src.indexOf('--!>', body);
    const a = this.dashClose;
    const b = this.bangClose;
    let end: number;
    if (a === -1 && b === -1) end = src.length;
    else if (a === -1) end = b + 4;
    else if (b === -1) end = a + 3;
    else end = a < b ? a + 3 : b + 4;
    this.pos = end;
    return { type: 'comment', start, end };
  }

  private tag(start: number, nameStart: number, isEnd: boolean): HtmlToken {
    const src = this.src;
    let i = nameStart;
    while (
      i < src.length &&
      !isSpace(src[i]) &&
      src[i] !== '/' &&
      src[i] !== '>'
    )
      i++;
    const name = asciiLower(src.slice(nameStart, i)).replace(/\0/g, '\uFFFD');
    const attributes: HtmlAttribute[] = [];
    let selfClosing = false;

    for (;;) {
      while (isSpace(src[i])) i++;
      const c = src[i];
      if (c === undefined) {
        // End of input inside a tag: the browser drops the tag.
        this.pos = src.length;
        return { type: 'eof', start, end: this.pos };
      }
      if (c === '>') {
        i++;
        break;
      }
      if (c === '/') {
        if (src[i + 1] === '>') {
          selfClosing = true;
          i += 2;
          break;
        }
        i++;
        continue;
      }
      // An attribute name: `=` counts as its first character, as in browsers.
      const attrStart = i;
      i++;
      while (
        i < src.length &&
        !isSpace(src[i]) &&
        src[i] !== '/' &&
        src[i] !== '>' &&
        src[i] !== '='
      )
        i++;
      const attrName = asciiLower(src.slice(attrStart, i)).replace(
        /\0/g,
        '\uFFFD',
      );
      while (isSpace(src[i])) i++;
      let rawValue = '';
      let quote = '';
      let valueStart = i;
      let hasValue = false;
      if (src[i] === '=') {
        hasValue = true;
        i++;
        while (isSpace(src[i])) i++;
        const q = src[i];
        if (q === '"' || q === "'") {
          quote = q;
          valueStart = i + 1;
          const close = src.indexOf(q, i + 1);
          if (close === -1) {
            this.pos = src.length;
            return { type: 'eof', start, end: this.pos };
          }
          rawValue = src.slice(i + 1, close);
          i = close + 1;
        } else {
          valueStart = i;
          while (i < src.length && !isSpace(src[i]) && src[i] !== '>') i++;
          rawValue = src.slice(valueStart, i);
        }
      }
      if (!isEnd) {
        attributes.push({
          name: attrName,
          rawValue,
          quote,
          nameStart: attrStart,
          valueStart,
          hasValue,
        });
      }
    }

    this.pos = i;
    if (isEnd) return { type: 'end', name, start, end: i };
    return { type: 'start', name, attributes, selfClosing, start, end: i };
  }
}
