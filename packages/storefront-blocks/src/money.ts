import type { BlockLanguage } from './runtime.js';

/**
 * The storefront's price format: the amount as `toLocaleString('fr-DZ')`
 * writes it (groups of three separated by U+202F NARROW NO-BREAK SPACE, a
 * decimal comma, at most three decimals, no trailing zeros), a space, and the
 * currency the store shows: "دج" in Arabic, "DA" in French and English.
 *
 * Written out by hand so it is the same in every engine: `Intl` output depends
 * on the ICU data each runtime ships.
 */
const GROUP = '\u202F';
const DECIMAL_STRING = /^(-?)(\d+)(?:\.(\d+))?$/;
const MAX_INTEGER_DIGITS = 15;

/** The currency label the storefront prints after a price. */
export function currencyLabel(
  currency: string,
  language: BlockLanguage,
): string {
  if (currency === '' || currency.toUpperCase() === 'DZD') {
    return language === 'ar' ? 'دج' : 'DA';
  }
  return currency.toUpperCase();
}

/** Adds one to a string of digits (for rounding up). */
function increment(digits: string): string {
  const out = digits.split('');
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] === '9') out[i] = '0';
    else {
      out[i] = String(Number(out[i]) + 1);
      return out.join('');
    }
  }
  return `1${out.join('')}`;
}

/** A decimal string or a finite number as the storefront prints the amount,
 * or null when it is not an amount. */
export function formatAmount(input: string | number): string | null {
  let text: string;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    text = String(input);
    // An exponent (1e+21, 1e-7) is outside what a price can be.
    if (/e/i.test(text)) return Math.abs(input) < 1 ? '0' : null;
  } else text = input.trim();
  const match = DECIMAL_STRING.exec(text);
  if (!match) return null;
  const negative = match[1] === '-';
  let integer = (match[2] ?? '0').replace(/^0+(?=\d)/, '');
  let fraction = match[3] ?? '';
  if (integer.length > MAX_INTEGER_DIGITS) return null;
  // Round half away from zero to three decimals, as Intl does.
  if (fraction.length > 3) {
    const roundUp = (fraction[3] ?? '0') >= '5';
    fraction = fraction.slice(0, 3);
    if (roundUp) {
      const joined = increment(integer + fraction);
      integer = joined.slice(0, joined.length - 3);
      fraction = joined.slice(joined.length - 3);
    }
  }
  fraction = fraction.replace(/0+$/, '');
  let grouped = '';
  for (let i = integer.length; i > 0; i -= 3) {
    const part = integer.slice(Math.max(0, i - 3), i);
    grouped = grouped === '' ? part : part + GROUP + grouped;
  }
  const isZero = /^0*$/.test(integer) && fraction === '';
  return `${negative && !isZero ? '-' : ''}${grouped}${fraction === '' ? '' : `,${fraction}`}`;
}

/** `{{ price | money }}`: the amount and the store's currency, or '' when the
 * value is not an amount. */
export function formatMoney(
  input: string | number,
  currency: string,
  language: BlockLanguage,
): string {
  const amount = formatAmount(input);
  if (amount === null) return '';
  return `${amount} ${currencyLabel(currency, language)}`;
}
