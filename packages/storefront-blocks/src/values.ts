import { utf8Length } from './errors.js';
import { BLOCK_LIMITS } from './limits.js';

/**
 * The values a template works with. Records are `Map`s and arrays are frozen,
 * built by `toValue` from the data a render is given: a template can read a
 * record's own keys and an array's items, and nothing else. There is no
 * prototype, method, getter or function anywhere a template can reach.
 */
export type Value =
  null | boolean | number | string | SafeHtml | ValueArray | ValueMap;
export type ValueArray = readonly Value[];
export type ValueMap = ReadonlyMap<string, Value>;

/**
 * Markup made by a Tassyir filter (`stars`) from fixed parts and escaped
 * values: the one kind of value an output does not escape. A template cannot
 * make one; any string operation on it gives back plain (escaped) text.
 */
export class SafeHtml {
  constructor(
    readonly html: string,
    readonly text: string,
  ) {}
}

/** Keys never copied from data: a template could not reach a prototype
 * through a Map anyway, but they are refused so nothing downstream sees them. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainRecord(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/** Raised when data is larger or deeper than a block may read. */
export class DataLimitError extends Error {}

/**
 * Copies JSON-like data into template values: null, booleans, finite numbers,
 * strings, arrays and plain objects. Anything else (functions, class
 * instances, symbols, `undefined`, NaN) becomes nil, and keys are read with
 * `Object.keys` only, so no getter, prototype or symbol is ever touched by a
 * template. `budget` counts the JSON size of what is copied.
 */
export function toValue(
  input: unknown,
  budget: { bytes: number } = { bytes: Number.POSITIVE_INFINITY },
  depth = 0,
): Value {
  if (depth > BLOCK_LIMITS.dataDepth) {
    throw new DataLimitError(
      `data nested deeper than ${BLOCK_LIMITS.dataDepth.toString()} levels`,
    );
  }
  const spend = (n: number): void => {
    budget.bytes -= n;
    if (budget.bytes < 0) throw new DataLimitError('data too large');
  };
  if (input === null || input === undefined) {
    spend(4);
    return null;
  }
  switch (typeof input) {
    case 'boolean':
      spend(5);
      return input;
    case 'number':
      if (!Number.isFinite(input)) {
        spend(4);
        return null;
      }
      spend(String(input).length);
      return input;
    case 'string':
      spend(utf8Length(input) + 2);
      return input;
    case 'object': {
      if (Array.isArray(input)) {
        if (input.length > BLOCK_LIMITS.arrayItems) {
          throw new DataLimitError(
            `an array of more than ${BLOCK_LIMITS.arrayItems.toString()} items`,
          );
        }
        spend(2);
        const items: Value[] = [];
        for (let i = 0; i < input.length; i++) {
          items.push(toValue(input[i], budget, depth + 1));
          spend(1);
        }
        return Object.freeze(items);
      }
      // A SafeHtml in the data is a class instance like any other: nil. Only
      // a Tassyir filter makes markup that skips escaping.
      if (!isPlainRecord(input)) {
        spend(4);
        return null;
      }
      spend(2);
      const map = new Map<string, Value>();
      for (const key of Object.keys(input)) {
        if (FORBIDDEN_KEYS.has(key)) continue;
        spend(utf8Length(key) + 4);
        map.set(key, toValue(input[key], budget, depth + 1));
      }
      return map;
    }
    default:
      spend(4);
      return null;
  }
}

export function isMap(value: Value): value is ValueMap {
  return value instanceof Map;
}

export function isArray(value: Value): value is ValueArray {
  return Array.isArray(value);
}

/** Liquid truthiness: only nil and false are false. */
export function isTruthy(value: Value): boolean {
  return value !== null && value !== false;
}

/** A number as Liquid prints it; integers without a decimal point. */
export function formatNumber(n: number): string {
  if (Object.is(n, -0)) return '0';
  return String(n);
}

/** The text of a value, as an output prints it (before escaping). */
export function toText(value: Value): string {
  if (value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof SafeHtml) return value.text;
  if (isArray(value)) return value.map(toText).join('');
  // A record prints nothing: it has no single text.
  return '';
}

/** The length `toText` would give, computed without building the text, and
 * stopping as soon as it passes `stop`. */
export function textLength(
  value: Value,
  stop: number = BLOCK_LIMITS.stringLength,
): number {
  if (isArray(value)) {
    let length = 0;
    for (const item of value) {
      length += textLength(item, stop);
      if (length > stop) return length;
    }
    return length;
  }
  if (isMap(value)) return 0;
  return toText(value).length;
}

const NUMERIC = /^[ \t]*-?\d+(?:\.\d+)?[ \t]*$/;

/** A number from a value, Liquid's way: a numeric string counts, anything
 * else is 0. */
export function toNumber(value: Value): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && NUMERIC.test(value)) return Number(value);
  return 0;
}

/** A number from a value, or null when it is not one (for comparisons). */
export function asNumber(value: Value): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && NUMERIC.test(value)) return Number(value);
  return null;
}

/** An integer argument (a limit, a width, a count), truncated toward zero. */
export function toInteger(value: Value): number {
  const n = toNumber(value);
  return Math.trunc(n);
}

export function isEmptyValue(value: Value): boolean {
  if (typeof value === 'string') return value === '';
  if (isArray(value)) return value.length === 0;
  if (isMap(value)) return value.size === 0;
  return false;
}

const isAsciiSpace = (code: number): boolean =>
  code === 32 || code === 9 || code === 10 || code === 13;

/** The string without ASCII spaces, tabs and line breaks at its start. In a
 * loop, not a regex: `/\s+$/` takes quadratic time on a long run of spaces. */
export function trimAsciiStart(text: string): string {
  let i = 0;
  while (i < text.length && isAsciiSpace(text.charCodeAt(i))) i++;
  return text.slice(i);
}

/** The string without ASCII spaces, tabs and line breaks at its end. */
export function trimAsciiEnd(text: string): string {
  let i = text.length;
  while (i > 0 && isAsciiSpace(text.charCodeAt(i - 1))) i--;
  return text.slice(0, i);
}

export function isBlankValue(value: Value): boolean {
  if (value === null || value === false) return true;
  if (typeof value === 'string') return trimAsciiStart(value) === '';
  return isEmptyValue(value);
}

/**
 * Work done by comparisons, in characters and items touched, so a caller can
 * charge it in steps: comparing two large records costs what it reads.
 */
export interface Work {
  n: number;
}

/** Liquid's `==` for two values (records and arrays compared by content).
 * Adds what it reads to `work`. */
export function valuesEqual(
  a: Value,
  b: Value,
  work: Work = { n: 0 },
): boolean {
  work.n += 1;
  if (a instanceof SafeHtml) return valuesEqual(a.text, b, work);
  if (b instanceof SafeHtml) return valuesEqual(a, b.text, work);
  if (typeof a === 'string' && typeof b === 'string') {
    work.n += Math.min(a.length, b.length);
    return a === b;
  }
  if (isArray(a) && isArray(b)) {
    return (
      a.length === b.length &&
      a.every((item, i) => valuesEqual(item, b[i] ?? null, work))
    );
  }
  if (isMap(a) && isMap(b)) {
    if (a.size !== b.size) return false;
    for (const [key, item] of a) {
      work.n += key.length;
      if (!b.has(key) || !valuesEqual(item, b.get(key) ?? null, work))
        return false;
    }
    return true;
  }
  return a === b;
}

/**
 * The characters and items in a value, counted to at most `cap`: what an
 * operation over the whole value reads. A list that holds one long string
 * 500 times counts it 500 times.
 */
export function deepSize(value: Value, cap: number): number {
  if (typeof value === 'string') return value.length;
  if (value instanceof SafeHtml) return value.text.length;
  if (isArray(value)) {
    let size = 1;
    for (const item of value) {
      size += deepSize(item, cap - size);
      if (size > cap) return size;
    }
    return size;
  }
  if (isMap(value)) {
    let size = 1;
    for (const [key, item] of value) {
      size += key.length + deepSize(item, cap - size);
      if (size > cap) return size;
    }
    return size;
  }
  return 1;
}

/** Code-unit order of two strings: the same in every engine and locale. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
