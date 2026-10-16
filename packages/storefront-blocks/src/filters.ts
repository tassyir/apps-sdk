import { escapeHtml } from './html/escape.js';
import { formatMoney } from './money.js';
import type { FilterRuntime } from './runtime.js';
import {
  chargeWork,
  checkArrayLength,
  checkStringLength,
  readSteps,
  sizeSteps,
} from './runtime.js';
import { imageUrl } from './urls.js';
import type { Value, ValueArray, Work } from './values.js';
import {
  SafeHtml,
  asNumber,
  compareStrings,
  formatNumber,
  isArray,
  isEmptyValue,
  isMap,
  textLength,
  toInteger,
  trimAsciiEnd,
  trimAsciiStart,
  toNumber,
  toText,
  valuesEqual,
} from './values.js';

type FilterFn = (
  input: Value,
  args: readonly Value[],
  rt: FilterRuntime,
) => Value;

interface FilterSpec {
  /** Fewest and most positional arguments. */
  args: readonly [number, number];
  fn: FilterFn;
}

/** Charges a filter: 1 step and one more per 256 characters or items read. */
function charge(rt: FilterRuntime, ...values: Value[]): void {
  rt.spend(1 + readSteps(...values));
}

/** The text of a value, refused before it is built when it is too long. */
function text(value: Value): string {
  checkStringLength(textLength(value));
  return toText(value);
}

function joinTexts(a: string, b: string): string {
  checkStringLength(a.length + b.length);
  return a + b;
}

function onText(
  rt: FilterRuntime,
  input: Value,
  change: (s: string) => string,
): string {
  charge(rt, input);
  return change(text(input));
}

function spendOne(rt: FilterRuntime, input: Value): Value {
  charge(rt);
  return input;
}

function arithmetic(rt: FilterRuntime, n: number): Value {
  charge(rt);
  return finite(n);
}

function sortItems(
  input: Value,
  key: Value | undefined,
  rt: FilterRuntime,
  fold: (v: Value) => Value,
): Value {
  const items = asArray(input);
  rt.spend(
    1 +
      sizeSteps(
        items.length * Math.max(1, Math.ceil(Math.log2(items.length + 1))),
      ),
  );
  const k = key === undefined ? null : text(key);
  const pick = (item: Value): Value =>
    fold(k === null ? item : property(item, k));
  // Comparisons are charged as they run: a sort of long strings stops at the
  // budget, not after it.
  const work: Work = { n: 0 };
  const sorted = [...items].sort((a, b) => {
    const order = compareValues(pick(a), pick(b), work);
    chargeWork(rt, work);
    return order;
  });
  chargeWork(rt, work, true);
  return Object.freeze(sorted);
}

function codePoints(value: string): string[] {
  return Array.from(value);
}

/** Replaces `find` with `by`: every occurrence, or the first or last one.
 * The result's length is checked before it is built. */
function replaceText(
  input: string,
  find: string,
  by: string,
  which: 'all' | 'first' | 'last',
): string {
  // An empty search string finds nothing to replace.
  if (find === '') return input;
  if (which === 'first') {
    const at = input.indexOf(find);
    if (at === -1) return input;
    checkStringLength(input.length - find.length + by.length);
    return input.slice(0, at) + by + input.slice(at + find.length);
  }
  if (which === 'last') {
    const at = input.lastIndexOf(find);
    if (at === -1) return input;
    checkStringLength(input.length - find.length + by.length);
    return input.slice(0, at) + by + input.slice(at + find.length);
  }
  const parts = input.split(find);
  checkStringLength(
    input.length + (parts.length - 1) * (by.length - find.length),
  );
  return parts.join(by);
}

/** Liquid's `strip_html`, in one pass: script and style blocks with their
 * content, comments, then every tag. Linear in the input. */
function stripHtml(input: string): string {
  const lower = input.toLowerCase();
  let out = '';
  let i = 0;
  const missing = new Set<string>();
  while (i < input.length) {
    const lt = input.indexOf('<', i);
    if (lt === -1) {
      out += input.slice(i);
      break;
    }
    out += input.slice(i, lt);
    let skipTo = -1;
    for (const [open, close] of [
      ['<script', '</script>'],
      ['<style', '</style>'],
      ['<!--', '-->'],
    ] as const) {
      if (lower.startsWith(open, lt) && !missing.has(close)) {
        const end = lower.indexOf(close, lt + open.length);
        if (end === -1) missing.add(close);
        else skipTo = end + close.length;
        break;
      }
    }
    if (skipTo === -1) {
      const gt = input.indexOf('>', lt + 1);
      if (gt === -1) {
        out += input.slice(lt);
        break;
      }
      skipTo = gt + 1;
    }
    i = skipTo;
  }
  return out;
}

/** `url_encode`, as Liquid's (Ruby's CGI.escape): letters, digits and
 * `_.-~` stay, a space becomes `+`, everything else is UTF-8 percent-encoded. */
function urlEncode(input: string): string {
  let out = '';
  for (let i = 0; i < input.length;) {
    let code = input.codePointAt(i) ?? 0;
    const width = code > 0xffff ? 2 : 1;
    i += width;
    if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    const c = String.fromCodePoint(code);
    if (/^[A-Za-z0-9_.~-]$/.test(c)) out += c;
    else if (code === 0x20) out += '+';
    else {
      const bytes: number[] =
        code < 0x80
          ? [code]
          : code < 0x800
            ? [0xc0 | (code >> 6), 0x80 | (code & 63)]
            : code < 0x10000
              ? [
                  0xe0 | (code >> 12),
                  0x80 | ((code >> 6) & 63),
                  0x80 | (code & 63),
                ]
              : [
                  0xf0 | (code >> 18),
                  0x80 | ((code >> 12) & 63),
                  0x80 | ((code >> 6) & 63),
                  0x80 | (code & 63),
                ];
      for (const byte of bytes)
        out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return out;
}

/** A finite number, or nil: arithmetic never yields NaN or Infinity. */
function finite(n: number): Value {
  return Number.isFinite(n) ? (Object.is(n, -0) ? 0 : n) : null;
}

function bothIntegers(a: number, b: number): boolean {
  return Number.isInteger(a) && Number.isInteger(b);
}

/** Ruby's modulo: the result takes the divisor's sign. */
function floorMod(a: number, b: number): number {
  return a - b * Math.floor(a / b);
}

/** Round half away from zero to `digits` decimals. */
function roundTo(n: number, digits: number): number {
  const factor = 10 ** digits;
  return (Math.sign(n) * Math.round(Math.abs(n) * factor)) / factor;
}

function property(item: Value, key: string): Value {
  return isMap(item) ? (item.get(key) ?? null) : null;
}

function asArray(value: Value): ValueArray {
  if (isArray(value)) return value;
  return value === null ? [] : [value];
}

/** Sort order for mixed values: numbers, then strings, then the rest; nil last. */
function compareValues(a: Value, b: Value, work: Work): number {
  work.n += 1;
  const rank = (v: Value): number =>
    typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : v === null ? 3 : 2;
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') {
    work.n += Math.min(a.length, b.length);
    return compareStrings(a, b);
  }
  return 0;
}

/** The text a `t` filter picks from `{ ar, fr, en }`. */
function pickLanguage(value: Value, language: string): string {
  if (typeof value === 'string') return value;
  if (!isMap(value)) return '';
  for (const key of [language, 'ar', 'en', 'fr']) {
    const candidate = value.get(key);
    if (typeof candidate === 'string' && candidate !== '') return candidate;
  }
  return '';
}

/** The accessible name of a star rating, in the store's language. */
function starLabel(language: string, rating: string, max: string): string {
  if (language === 'ar') return `التقييم ${rating} من ${max}`;
  if (language === 'fr') return `Note : ${rating} sur ${max}`;
  return `Rated ${rating} out of ${max}`;
}

function stars(input: Value, args: readonly Value[], rt: FilterRuntime): Value {
  const maxArg = args.length > 0 ? toInteger(args[0] ?? null) : 5;
  const max = Math.min(10, Math.max(1, maxArg));
  const rating = Math.min(max, Math.max(0, toNumber(input)));
  const full = Math.round(rating);
  const glyphs = '★'.repeat(full) + '☆'.repeat(max - full);
  let shown = formatNumber(roundTo(rating, 1));
  if (rt.language === 'fr') shown = shown.replace('.', ',');
  const label = starLabel(rt.language, shown, String(max));
  return new SafeHtml(
    `<span class="tsy-stars" role="img" aria-label="${escapeHtml(label)}">${glyphs}</span>`,
    glyphs,
  );
}

/**
 * Every filter a template may use, with how many positional arguments it
 * takes. The list is fixed: there is no way to add one from a template.
 */
export const FILTERS: Readonly<Record<string, FilterSpec>> = {
  // Text
  append: {
    args: [1, 1],
    fn: (i, [a], rt) => {
      charge(rt, i, a ?? null);
      return joinTexts(text(i), text(a ?? null));
    },
  },
  prepend: {
    args: [1, 1],
    fn: (i, [a], rt) => {
      charge(rt, i, a ?? null);
      return joinTexts(text(a ?? null), text(i));
    },
  },
  capitalize: {
    args: [0, 0],
    fn: (i, _, rt) => {
      charge(rt, i);
      const s = text(i);
      return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    },
  },
  downcase: {
    args: [0, 0],
    fn: (i, _, rt) => onText(rt, i, (s) => s.toLowerCase()),
  },
  upcase: {
    args: [0, 0],
    fn: (i, _, rt) => onText(rt, i, (s) => s.toUpperCase()),
  },
  strip: {
    args: [0, 0],
    fn: (i, _, rt) => onText(rt, i, (s) => trimAsciiEnd(trimAsciiStart(s))),
  },
  lstrip: {
    args: [0, 0],
    fn: (i, _, rt) => onText(rt, i, trimAsciiStart),
  },
  rstrip: {
    args: [0, 0],
    fn: (i, _, rt) => onText(rt, i, trimAsciiEnd),
  },
  strip_newlines: {
    args: [0, 0],
    fn: (i, _, rt) => onText(rt, i, (s) => s.replace(/\r?\n|\r/g, '')),
  },
  strip_html: { args: [0, 0], fn: (i, _, rt) => onText(rt, i, stripHtml) },
  replace: {
    args: [2, 2],
    fn: (i, [a, b], rt) =>
      onText(rt, i, (s) =>
        replaceText(s, text(a ?? null), text(b ?? null), 'all'),
      ),
  },
  replace_first: {
    args: [2, 2],
    fn: (i, [a, b], rt) =>
      onText(rt, i, (s) =>
        replaceText(s, text(a ?? null), text(b ?? null), 'first'),
      ),
  },
  replace_last: {
    args: [2, 2],
    fn: (i, [a, b], rt) =>
      onText(rt, i, (s) =>
        replaceText(s, text(a ?? null), text(b ?? null), 'last'),
      ),
  },
  remove: {
    args: [1, 1],
    fn: (i, [a], rt) =>
      onText(rt, i, (s) => replaceText(s, text(a ?? null), '', 'all')),
  },
  remove_first: {
    args: [1, 1],
    fn: (i, [a], rt) =>
      onText(rt, i, (s) => replaceText(s, text(a ?? null), '', 'first')),
  },
  remove_last: {
    args: [1, 1],
    fn: (i, [a], rt) =>
      onText(rt, i, (s) => replaceText(s, text(a ?? null), '', 'last')),
  },
  truncate: {
    args: [0, 2],
    fn: (i, [n, e], rt) => {
      charge(rt, i);
      const chars = codePoints(text(i));
      const length = Math.max(0, n === undefined ? 50 : toInteger(n));
      const ellipsis = e === undefined ? '...' : text(e);
      if (chars.length <= length) return chars.join('');
      const keep = Math.max(0, length - codePoints(ellipsis).length);
      return joinTexts(chars.slice(0, keep).join(''), ellipsis);
    },
  },
  truncatewords: {
    args: [0, 2],
    fn: (i, [n, e], rt) => {
      charge(rt, i);
      const words = text(i)
        .split(/[ \t\n\r]+/)
        .filter((w) => w !== '');
      const count = Math.max(1, n === undefined ? 15 : toInteger(n));
      const ellipsis = e === undefined ? '...' : text(e);
      if (words.length <= count) return words.join(' ');
      return joinTexts(words.slice(0, count).join(' '), ellipsis);
    },
  },
  slice: {
    args: [1, 2],
    fn: (i, [s, l], rt) => {
      charge(rt, i);
      const items: readonly Value[] = isArray(i) ? i : codePoints(text(i));
      let start = toInteger(s ?? null);
      const length = l === undefined ? 1 : Math.max(0, toInteger(l));
      if (start < 0) start = Math.max(0, items.length + start);
      const part = items.slice(start, start + length);
      return isArray(i) ? Object.freeze(part) : part.map(toText).join('');
    },
  },
  split: {
    args: [1, 1],
    fn: (i, [sep], rt) => {
      charge(rt, i);
      const s = text(i);
      const separator = text(sep ?? null);
      const parts = separator === '' ? codePoints(s) : s.split(separator);
      checkArrayLength(parts.length);
      return Object.freeze(parts);
    },
  },
  url_encode: {
    args: [0, 0],
    fn: (i, _, rt) => {
      charge(rt, i);
      const out = urlEncode(text(i));
      checkStringLength(out.length);
      return out;
    },
  },
  // Every output is escaped; these two are accepted for templates written for
  // Liquid elsewhere, and change nothing.
  escape: { args: [0, 0], fn: (i, _, rt) => spendOne(rt, i) },
  escape_once: { args: [0, 0], fn: (i, _, rt) => spendOne(rt, i) },
  default: {
    args: [1, 1],
    fn: (i, [d], rt) => {
      charge(rt);
      return i === null || i === false || isEmptyValue(i) ? (d ?? null) : i;
    },
  },

  // Lists (and the size of anything)
  size: {
    args: [0, 0],
    fn: (i, _, rt) => {
      charge(rt, i);
      if (typeof i === 'string') return codePoints(i).length;
      if (isArray(i)) return i.length;
      if (isMap(i)) return i.size;
      return 0;
    },
  },
  first: {
    args: [0, 0],
    fn: (i, _, rt) => {
      charge(rt, i);
      if (isArray(i)) return i[0] ?? null;
      return typeof i === 'string' ? (codePoints(i)[0] ?? null) : null;
    },
  },
  last: {
    args: [0, 0],
    fn: (i, _, rt) => {
      charge(rt, i);
      if (isArray(i)) return i[i.length - 1] ?? null;
      if (typeof i === 'string') {
        const chars = codePoints(i);
        return chars[chars.length - 1] ?? null;
      }
      return null;
    },
  },
  join: {
    args: [0, 1],
    fn: (i, [sep], rt) => {
      const items = asArray(i);
      charge(rt, items);
      const separator = sep === undefined ? ' ' : text(sep);
      let length = separator.length * Math.max(0, items.length - 1);
      for (const item of items) length += textLength(item);
      checkStringLength(length);
      return items.map(toText).join(separator);
    },
  },
  reverse: {
    args: [0, 0],
    fn: (i, _, rt) => {
      charge(rt, i);
      return isArray(i) ? Object.freeze([...i].reverse()) : i;
    },
  },
  sort: { args: [0, 1], fn: (i, [key], rt) => sortItems(i, key, rt, (v) => v) },
  sort_natural: {
    args: [0, 1],
    fn: (i, [key], rt) =>
      sortItems(i, key, rt, (v) =>
        typeof v === 'string' ? v.toLowerCase() : v,
      ),
  },
  map: {
    args: [1, 1],
    fn: (i, [key], rt) => {
      const items = asArray(i);
      charge(rt, items);
      const k = text(key ?? null);
      return Object.freeze(items.map((item) => property(item, k)));
    },
  },
  where: {
    args: [1, 2],
    fn: (i, [key, value], rt) => {
      const items = asArray(i);
      charge(rt, items);
      const k = text(key ?? null);
      const work: Work = { n: 0 };
      const kept = items.filter((item) => {
        const v = property(item, k);
        const keep =
          value === undefined
            ? v !== null && v !== false
            : valuesEqual(v, value, work);
        chargeWork(rt, work);
        return keep;
      });
      chargeWork(rt, work, true);
      return Object.freeze(kept);
    },
  },
  uniq: {
    args: [0, 1],
    fn: (i, [key], rt) => {
      const items = asArray(i);
      charge(rt, items);
      const k = key === undefined ? null : text(key);
      const pick = (item: Value): Value =>
        k === null ? item : property(item, k);
      const work: Work = { n: 0 };
      const kept: Value[] = [];
      for (const item of items) {
        const probe = pick(item);
        const seen = kept.some((other) => {
          const equal = valuesEqual(pick(other), probe, work);
          chargeWork(rt, work);
          return equal;
        });
        if (!seen) kept.push(item);
      }
      chargeWork(rt, work, true);
      return Object.freeze(kept);
    },
  },
  compact: {
    args: [0, 1],
    fn: (i, [key], rt) => {
      const items = asArray(i);
      charge(rt, items);
      const k = key === undefined ? null : text(key);
      return Object.freeze(
        items.filter(
          (item) => (k === null ? item : property(item, k)) !== null,
        ),
      );
    },
  },
  concat: {
    args: [1, 1],
    fn: (i, [other], rt) => {
      const a = asArray(i);
      const b = asArray(other ?? null);
      charge(rt, a, b);
      checkArrayLength(a.length + b.length);
      return Object.freeze([...a, ...b]);
    },
  },
  sum: {
    args: [0, 1],
    fn: (i, [key], rt) => {
      const items = asArray(i);
      charge(rt, items);
      const k = key === undefined ? null : text(key);
      let total = 0;
      for (const item of items)
        total += asNumber(k === null ? item : property(item, k)) ?? 0;
      return finite(total);
    },
  },

  // Numbers
  plus: {
    args: [1, 1],
    fn: (i, [a], rt) => arithmetic(rt, toNumber(i) + toNumber(a ?? null)),
  },
  minus: {
    args: [1, 1],
    fn: (i, [a], rt) => arithmetic(rt, toNumber(i) - toNumber(a ?? null)),
  },
  times: {
    args: [1, 1],
    fn: (i, [a], rt) => arithmetic(rt, toNumber(i) * toNumber(a ?? null)),
  },
  divided_by: {
    args: [1, 1],
    fn: (i, [a], rt) => {
      charge(rt);
      const x = toNumber(i);
      const y = toNumber(a ?? null);
      if (y === 0) return null;
      return finite(bothIntegers(x, y) ? Math.floor(x / y) : x / y);
    },
  },
  modulo: {
    args: [1, 1],
    fn: (i, [a], rt) => {
      charge(rt);
      const y = toNumber(a ?? null);
      return y === 0 ? null : finite(floorMod(toNumber(i), y));
    },
  },
  abs: {
    args: [0, 0],
    fn: (i, _, rt) => arithmetic(rt, Math.abs(toNumber(i))),
  },
  ceil: {
    args: [0, 0],
    fn: (i, _, rt) => arithmetic(rt, Math.ceil(toNumber(i))),
  },
  floor: {
    args: [0, 0],
    fn: (i, _, rt) => arithmetic(rt, Math.floor(toNumber(i))),
  },
  round: {
    args: [0, 1],
    fn: (i, [d], rt) => {
      const digits = Math.min(
        6,
        Math.max(0, d === undefined ? 0 : toInteger(d)),
      );
      return arithmetic(rt, roundTo(toNumber(i), digits));
    },
  },
  at_least: {
    args: [1, 1],
    fn: (i, [a], rt) =>
      arithmetic(rt, Math.max(toNumber(i), toNumber(a ?? null))),
  },
  at_most: {
    args: [1, 1],
    fn: (i, [a], rt) =>
      arithmetic(rt, Math.min(toNumber(i), toNumber(a ?? null))),
  },

  // Tassyir
  money: {
    args: [0, 0],
    fn: (i, _, rt) => {
      charge(rt);
      return typeof i === 'number' || typeof i === 'string'
        ? formatMoney(i, rt.currency, rt.language)
        : '';
    },
  },
  image_url: {
    args: [1, 1],
    fn: (i, [w], rt) => {
      charge(rt);
      return typeof i === 'string' ? imageUrl(i, toInteger(w ?? null)) : '';
    },
  },
  stars: {
    args: [0, 1],
    fn: (i, args, rt) => {
      charge(rt);
      return stars(i, args, rt);
    },
  },
  t: {
    args: [0, 0],
    fn: (i, _, rt) => {
      charge(rt, i);
      return pickLanguage(i, rt.language);
    },
  },
};

/** Liquid filters storefront blocks do not have, with the fix for each. */
export const FILTERS_NOT_SUPPORTED: Readonly<Record<string, string>> = {
  raw: 'Every output is escaped and there is no unescaped output; build the markup in the template.',
  date: 'A block has no clock: format the date in your app and store it as text in app data.',
  json: 'Output the values you need one by one.',
  inspect: 'Output the values you need one by one.',
  newline_to_br: 'Split the text and wrap each line in the template instead.',
  base64_encode: 'Not available in storefront blocks.',
  base64_decode: 'Not available in storefront blocks.',
  base64_url_safe_encode: 'Not available in storefront blocks.',
  base64_url_safe_decode: 'Not available in storefront blocks.',
  md5: 'Not available in storefront blocks.',
  sha1: 'Not available in storefront blocks.',
  sha256: 'Not available in storefront blocks.',
  hmac_sha1: 'Not available in storefront blocks.',
  hmac_sha256: 'Not available in storefront blocks.',
  img_url: 'Use image_url: <width>.',
  image_tag:
    'Write the <img> yourself with src="{{ … | image_url: <width> }}".',
  img_tag: 'Write the <img> yourself with src="{{ … | image_url: <width> }}".',
  asset_url:
    "A block has no asset files: use images on Tassyir's CDN through image_url.",
  asset_img_url:
    "A block has no asset files: use images on Tassyir's CDN through image_url.",
  file_url:
    "A block has no asset files: use images on Tassyir's CDN through image_url.",
  script_tag: 'Storefront blocks run no JavaScript.',
  stylesheet_tag: "Put the styles in the block's stylesheet file.",
  link_to: 'Write the <a> yourself.',
  money_with_currency: 'Use money.',
  money_without_currency: 'Use money.',
  money_without_trailing_zeros: 'Use money.',
  url_decode: 'Store the text decoded instead.',
};

/** The supported filter names, sorted. */
export const BLOCK_FILTERS = Object.freeze(Object.keys(FILTERS).sort());
