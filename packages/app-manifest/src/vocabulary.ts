import type { ManifestVocabulary } from './manifest-types.js';

/**
 * The platform's vocabulary for API version 2026-10, as data: what
 * `validateManifest` checks a manifest against when it is given no other.
 *
 * It equals what the Tassyir API builds from its live catalogues
 * (tassyir/backend `appManifestVocabulary()`): the scope catalogue in
 * consent-screen order with its implications (plan §3.3), the scopes not
 * requestable yet, the scopes that need another, and the webhook topics in
 * catalogue order with the scope that reads each topic's resource (plan
 * §3.7, `event-scopes.ts`). The API keeps passing its live vocabulary; this
 * copy is for everyone without a backend. `backend-parity.test.ts` compares
 * the two against a backend checkout (`TASSYIR_BACKEND_DIR`), so change this
 * file only to match the backend.
 */

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** The vocabulary of this release: API version 2026-10. Frozen. */
export const MANIFEST_VOCABULARY: ManifestVocabulary =
  deepFreeze<ManifestVocabulary>({
    apiVersions: ['2026-10'],
    scopes: [
      { name: 'read_orders', implies: [], available: true },
      { name: 'write_orders', implies: ['read_orders'], available: true },
      { name: 'dispatch_orders', implies: ['read_orders'], available: true },
      { name: 'read_returns', implies: [], available: true },
      {
        name: 'write_returns',
        implies: ['read_returns', 'read_orders'],
        available: true,
      },
      { name: 'read_products', implies: [], available: true },
      { name: 'write_products', implies: ['read_products'], available: true },
      { name: 'read_inventory', implies: [], available: true },
      { name: 'write_inventory', implies: ['read_inventory'], available: true },
      { name: 'read_costs', implies: ['read_inventory'], available: true },
      { name: 'read_customers', implies: ['read_orders'], available: true },
      {
        name: 'read_customer_contact',
        implies: [],
        available: true,
        needsOneOf: ['read_orders'],
      },
      { name: 'read_analytics', implies: [], available: true },
      { name: 'read_finance', implies: [], available: true },
      { name: 'read_stores', implies: [], available: true },
      { name: 'read_delivery', implies: [], available: true },
      {
        name: 'write_storefront',
        implies: [],
        available: false,
        unavailableReason:
          'storefront blocks arrive in Phase 2, and until then the scope grants nothing',
      },
    ],
    topics: [
      { name: 'orders/created', scope: 'read_orders' },
      { name: 'abandoned_checkouts/created', scope: 'read_orders' },
      { name: 'orders/confirmed', scope: 'read_orders' },
      { name: 'orders/cancelled', scope: 'read_orders' },
      { name: 'orders/dispatched', scope: 'read_orders' },
      { name: 'orders/delivered', scope: 'read_orders' },
      { name: 'orders/returned', scope: 'read_orders' },
      { name: 'orders/updated', scope: 'read_orders' },
      { name: 'products/created', scope: 'read_products' },
      { name: 'products/updated', scope: 'read_products' },
      { name: 'products/deleted', scope: 'read_products' },
      { name: 'inventory_levels/updated', scope: 'read_inventory' },
      { name: 'customers/updated', scope: 'read_customers' },
      { name: 'app/installed', scope: null },
      { name: 'app/uninstalled', scope: null },
      { name: 'app/scopes_updated', scope: null },
      { name: 'customers/data_request', scope: null },
      { name: 'customers/redact', scope: null },
      { name: 'business/redact', scope: null },
      { name: 'bulk/finished', scope: null },
    ],
    storefrontBlocksScope: 'write_storefront',
  });
