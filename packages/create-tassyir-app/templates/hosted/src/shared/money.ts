// Money in Tassyir is a decimal string with two decimals ("2500.00") next to
// a `currency` field (DZD today), in the Admin API and in webhooks alike.
// Never turn it into a float: compare and add in integer cents (BigInt), and
// format for people only at the edge. Shared by the server and the page.

const AMOUNT = /^(\d{1,13})(?:\.(\d{1,2}))?$/;

/** "2500", "2500.5" or "2500.50" → 250050n cents; anything else → null. */
export function toCents(amount: string): bigint | null {
  const match = AMOUNT.exec(amount.trim());
  if (!match) return null;
  const whole = match[1] ?? '0';
  const fraction = (match[2] ?? '').padEnd(2, '0');
  return BigInt(whole) * 100n + BigInt(fraction);
}

/** 250050n → "2500.50", the API's own spelling. */
export function fromCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const value = cents < 0n ? -cents : cents;
  return `${sign}${String(value / 100n)}.${String(value % 100n).padStart(2, '0')}`;
}

/** "2500.5" → "2500.50"; null when it is not an amount. */
export function normalizeAmount(amount: string): string | null {
  const cents = toCents(amount);
  return cents === null ? null : fromCents(cents);
}

const DZD = {
  // The dashboard's own money voice: "DZD 9,000" in English, "9.000 دج" in
  // Arabic; whole amounts without decimals, others with up to two.
  en: new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'DZD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }),
  ar: new Intl.NumberFormat('ar-DZ', {
    numberingSystem: 'latn',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }),
};

/**
 * An amount for people, as the dashboard writes it: "DZD 7,500" (en),
 * "7.500 دج" (ar). The decimal string goes to Intl as it is (exact, no
 * float). Another currency, or text that is not an amount, reads
 * "<amount> <currency>".
 */
export function formatAmount(
  amount: string,
  currency: string,
  locale: string,
): string {
  if (currency !== 'DZD' || toCents(amount) === null) {
    return `${amount} ${currency}`;
  }
  const value = amount.trim() as `${number}`;
  return locale === 'ar' ? `${DZD.ar.format(value)} دج` : DZD.en.format(value);
}
