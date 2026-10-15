import { describe, expect, it } from 'vitest';
import {
  formatAmount,
  fromCents,
  normalizeAmount,
  toCents,
} from '../src/shared/money.ts';

describe('money as decimal strings', () => {
  it('reads amounts as integer cents, never floats', () => {
    expect(toCents('2500.00')).toBe(250_000n);
    expect(toCents('0.1')).toBe(10n);
    expect(toCents('9999999999999.99')).toBe(999_999_999_999_999n);
    expect(toCents('1e3')).toBeNull();
    expect(toCents('-5')).toBeNull();
    expect(toCents('2500.001')).toBeNull();
  });

  it('writes them back as the API does', () => {
    expect(fromCents(250_050n)).toBe('2500.50');
    expect(normalizeAmount('5000')).toBe('5000.00');
    expect(normalizeAmount('abc')).toBeNull();
  });

  it('formats them for people as the dashboard does, exactly', () => {
    // Intl puts a no-break space after the code.
    expect(formatAmount('7500.00', 'DZD', 'en')).toBe('DZD\u00a07,500');
    expect(formatAmount('7500.00', 'DZD', 'ar')).toBe('7.500 دج');
    expect(formatAmount('7500.50', 'DZD', 'ar')).toBe('7.500,5 دج');
    expect(formatAmount('9999999999999.99', 'DZD', 'en')).toBe(
      'DZD\u00a09,999,999,999,999.99',
    );
    expect(formatAmount('12.00', 'EUR', 'en')).toBe('12.00 EUR');
  });
});
