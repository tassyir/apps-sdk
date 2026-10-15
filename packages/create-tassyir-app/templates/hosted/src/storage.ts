import type { HostedSqlStatement, HostedStorage } from '@tassyir/app';
import { normalizeAmount } from './shared/money.ts';

// The installation's own SQLite database, `ctx.props.STORAGE`: one per
// installation, reached only through this capability, never another
// installation's. Tassyir erases it 48 hours after an uninstall.
//
// - Each call is ONE transaction: `batch` runs several statements together
//   (BEGIN and COMMIT are refused), and a failure rolls back the whole call.
// - Every call is a subrequest of the request (50 by default): batch rather
//   than loop.
// - A call answers at most 5,000 rows: page with LIMIT.
// - It holds at most 50 MB: a write past that is refused (`STORAGE_FULL`),
//   reads and deletes still run.
//
// The schema is created by the first call that needs it (CREATE TABLE IF NOT
// EXISTS in the same batch): there is no migration step on Tassyir Hosting.
// To change a table later, add a statement here that is safe to run again.

const SCHEMA: readonly HostedSqlStatement[] = [
  {
    query:
      'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  },
  {
    query:
      'CREATE TABLE IF NOT EXISTS orders_received (order_id TEXT PRIMARY KEY, received_at TEXT NOT NULL)',
  },
];

/** The schema, then `statements`, in one transaction; their results only. */
async function run(
  storage: HostedStorage,
  statements: readonly HostedSqlStatement[],
) {
  const results = await storage.batch([...SCHEMA, ...statements]);
  return results.slice(SCHEMA.length);
}

export interface Settings {
  /** Orders at or above this total are highlighted ("5000.00"), or none. */
  highlightFrom: string | null;
}

export async function readSettings(storage: HostedStorage): Promise<Settings> {
  const [result] = await run(storage, [
    {
      query: 'SELECT value FROM settings WHERE key = ?',
      bindings: ['highlightFrom'],
    },
  ]);
  const value = result?.rows[0]?.['value'];
  return {
    highlightFrom: typeof value === 'string' ? normalizeAmount(value) : null,
  };
}

export async function writeSettings(
  storage: HostedStorage,
  settings: Settings,
): Promise<void> {
  await run(storage, [
    settings.highlightFrom === null
      ? {
          query: 'DELETE FROM settings WHERE key = ?',
          bindings: ['highlightFrom'],
        }
      : {
          query:
            'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
          bindings: ['highlightFrom', settings.highlightFrom],
        },
  ]);
}

/**
 * Records an order the `orders/created` webhook announced. Keyed on the
 * order id, so a delivery Tassyir repeats (deliveries are at least once)
 * records it once.
 */
export async function recordOrderReceived(
  storage: HostedStorage,
  orderId: string,
  at: Date,
): Promise<void> {
  await run(storage, [
    {
      query:
        'INSERT INTO orders_received (order_id, received_at) VALUES (?, ?) ON CONFLICT (order_id) DO NOTHING',
      bindings: [orderId, at.toISOString()],
    },
  ]);
}

/** How many orders the webhook announced since the app was installed. */
export async function countOrdersReceived(
  storage: HostedStorage,
): Promise<number> {
  const [result] = await run(storage, [
    { query: 'SELECT COUNT(*) AS received FROM orders_received' },
  ]);
  const received = result?.rows[0]?.['received'];
  return typeof received === 'number' ? received : 0;
}

/**
 * The code of a STORAGE refusal (`STORAGE_FULL`, `STORAGE_LIMIT`,
 * `STORAGE_INVALID`, `STORAGE_UNAVAILABLE`), or null for any other error.
 */
export function storageErrorCode(error: unknown): string | null {
  const code =
    error instanceof Error ? /^(STORAGE_[A-Z_]+):/.exec(error.message) : null;
  return code?.[1] ?? null;
}
