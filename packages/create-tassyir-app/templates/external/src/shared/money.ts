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
