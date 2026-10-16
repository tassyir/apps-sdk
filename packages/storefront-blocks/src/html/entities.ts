/**
 * Character references. A block's HTML is decoded here and escaped again when
 * it is written out, so a reference the browser would read differently can
 * only ever show as text: never as markup.
 *
 * Named references: the ones block templates use, terminated by `;`. Any other
 * name is left as written (and its `&` escaped on output); the validator
 * reports it so the developer writes the character instead.
 */
const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00A0',
  ensp: '\u2002',
  emsp: '\u2003',
  thinsp: '\u2009',
  lrm: '\u200E',
  rlm: '\u200F',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  minus: '−',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
  times: '×',
  divide: '÷',
  deg: '°',
  plusmn: '±',
  le: '≤',
  ge: '≥',
  ne: '≠',
  infin: '∞',
  prime: '′',
  Prime: '″',
  euro: '€',
  cent: '¢',
  pound: '£',
  yen: '¥',
  larr: '←',
  rarr: '→',
  uarr: '↑',
  darr: '↓',
  harr: '↔',
  hearts: '♥',
  star: '☆',
  starf: '★',
  check: '✓',
  cross: '✗',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  sup2: '²',
  sup3: '³',
  para: '¶',
  sect: '§',
};

/** Numeric references to 0x80–0x9F mean the Windows-1252 character, as in
 * browsers (HTML §13.2.5.80). */
const WINDOWS_1252: Readonly<Record<number, number>> = {
  0x80: 0x20ac,
  0x82: 0x201a,
  0x83: 0x0192,
  0x84: 0x201e,
  0x85: 0x2026,
  0x86: 0x2020,
  0x87: 0x2021,
  0x88: 0x02c6,
  0x89: 0x2030,
  0x8a: 0x0160,
  0x8b: 0x2039,
  0x8c: 0x0152,
  0x8e: 0x017d,
  0x91: 0x2018,
  0x92: 0x2019,
  0x93: 0x201c,
  0x94: 0x201d,
  0x95: 0x2022,
  0x96: 0x2013,
  0x97: 0x2014,
  0x98: 0x02dc,
  0x99: 0x2122,
  0x9a: 0x0161,
  0x9b: 0x203a,
  0x9c: 0x0153,
  0x9e: 0x017e,
  0x9f: 0x0178,
};

const REFERENCE =
  /&(?:#[xX]([0-9A-Fa-f]{1,8});?|#([0-9]{1,10});?|([A-Za-z][A-Za-z0-9]{0,31});)/g;

function fromCodePoint(code: number): string {
  if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
    return '\uFFFD';
  return String.fromCodePoint(WINDOWS_1252[code] ?? code);
}

/**
 * Decodes the references in `text`. `onUnknown` hears each `&name;` this
 * table does not know (its offset in `text`), which stays as written.
 */
export function decodeEntities(
  text: string,
  onUnknown?: (name: string, offset: number) => void,
): string {
  if (!text.includes('&')) return text;
  return text.replace(
    REFERENCE,
    (
      whole: string,
      hex: string | undefined,
      dec: string | undefined,
      name: string | undefined,
      offset: number,
    ) => {
      if (hex !== undefined) return fromCodePoint(parseInt(hex, 16));
      if (dec !== undefined) return fromCodePoint(Number(dec));
      const decoded = name === undefined ? undefined : NAMED[name];
      if (decoded !== undefined && Object.hasOwn(NAMED, name ?? ''))
        return decoded;
      onUnknown?.(name ?? '', offset);
      return whole;
    },
  );
}

/** The named references a block may use. */
export const BLOCK_NAMED_ENTITIES = Object.freeze(Object.keys(NAMED).sort());
