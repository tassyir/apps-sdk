import type { ErrorList } from './errors.js';

/**
 * Characters a template or stylesheet may not contain. Each makes code read
 * differently from how it runs ("Trojan Source", CVE-2021-42574), hides text,
 * or smuggles it:
 * - C0 and C1 controls (tab, line feed and carriage return excepted), DEL;
 * - bidirectional embeddings, overrides and isolates (U+202A–U+202E,
 *   U+2066–U+2069). The marks Arabic text needs stay allowed: LRM, RLM, ALM,
 *   and the joiners ZWJ and ZWNJ;
 * - invisible separators and fillers (zero-width space, word joiner, a byte
 *   order mark after the first character, invisible operators, Hangul
 *   fillers, the Mongolian vowel separator), line and paragraph separators;
 * - Unicode tag characters and the supplementary variation selectors, which
 *   carry hidden ASCII;
 * - private-use characters (the validator uses some as markers) and lone
 *   surrogates.
 */
export function disallowedCharacter(
  code: number,
  offset: number,
): string | undefined {
  if (code === 0x09 || code === 0x0a || code === 0x0d) return undefined;
  if (code < 0x20 || (code >= 0x7f && code <= 0x9f))
    return 'a control character';
  if (code >= 0x202a && code <= 0x202e) return 'a bidirectional override';
  if (code >= 0x2066 && code <= 0x2069) return 'a bidirectional isolate';
  if (code === 0xfeff) return offset === 0 ? undefined : 'a byte order mark';
  if (
    code === 0x200b ||
    code === 0x2060 ||
    code === 0x180e ||
    (code >= 0x2061 && code <= 0x2064) ||
    code === 0x115f ||
    code === 0x1160 ||
    code === 0x3164 ||
    code === 0xffa0 ||
    (code >= 0xfff9 && code <= 0xfffb)
  ) {
    return 'an invisible character';
  }
  if (code === 0x2028 || code === 0x2029)
    return 'a line or paragraph separator';
  if (code >= 0xe0000 && code <= 0xe007f) return 'a Unicode tag character';
  if (code >= 0xe0100 && code <= 0xe01ef) return 'a variation selector';
  if (
    (code >= 0xe000 && code <= 0xf8ff) ||
    (code >= 0xf0000 && code <= 0x10ffff)
  ) {
    return 'a private-use character';
  }
  if (code >= 0xd800 && code <= 0xdfff) return 'a lone surrogate';
  return undefined;
}

/** `U+202E` for an error message. */
export function codePointLabel(code: number): string {
  return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * Reports every disallowed character of `text` (at most one error per line,
 * so a pasted run of them does not flood the list).
 */
export function checkCharacters(
  text: string,
  errors: ErrorList,
  what: string,
): void {
  let lastLine = -1;
  let line = 0;
  for (let i = 0; i < text.length;) {
    const code = text.codePointAt(i) ?? 0;
    if (code === 0x0a) line++;
    const why = disallowedCharacter(code, i);
    if (why !== undefined && line !== lastLine) {
      lastLine = line;
      errors.add(
        'BLOCK_CHARACTER_NOT_ALLOWED',
        i,
        `The ${what} contains ${why} (${codePointLabel(code)}).`,
      );
    }
    i += code > 0xffff ? 2 : 1;
  }
}

/**
 * Text as it may appear in a rendered block: the same characters removed, so
 * data cannot reorder or hide the text around it. Tab, line feed and carriage
 * return stay; so do the marks and joiners Arabic needs.
 */
export function cleanRenderedText(text: string): string {
  let out = '';
  let from = 0;
  for (let i = 0; i < text.length;) {
    const code = text.codePointAt(i) ?? 0;
    const width = code > 0xffff ? 2 : 1;
    // A byte order mark is invisible wherever it lands in rendered text.
    if (code === 0xfeff || disallowedCharacter(code, i) !== undefined) {
      out += text.slice(from, i);
      from = i + width;
    }
    i += width;
  }
  return from === 0 ? text : out + text.slice(from);
}
