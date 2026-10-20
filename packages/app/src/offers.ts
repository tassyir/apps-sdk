// The write side of the Offers API (`write_offers`): the declarative rule of
// an app-owned offer type, typed, and a helper for the bulk codes call.
// Nothing here is needed to call the routes (`admin.post('/offers', …)` is
// already typed from the OpenAPI document): it names what the document leaves
// open (`config` is a free-form object there) and spares you the 250-code
// batches.

import type { AdminClient } from './admin-client.js';
import type { OfferCodeInput, OfferCodesBulkResult } from './admin-types.js';

/** Codes one `POST /offers/{id}/codes/bulk` call takes. */
export const OFFER_CODES_BULK_MAX = 250;

/** The limits of an app-owned offer's rule; the API refuses a rule above them. */
export const APP_OFFER_RULE_LIMITS = {
  /** Nesting of `all` / `any`. */
  maxDepth: 3,
  /** Conditions one `all` / `any` holds. */
  maxChildren: 10,
  /** Actions one rule holds (a `label` included). */
  maxActions: 5,
} as const;

/**
 * The step a rule prices in, with the stacking rules of a native offer of that
 * class. Every pricing action of the rule must belong to it:
 * `product` takes `discount.lines`, `discount.cheapest` and `give.item`;
 * `order` takes `discount.order`; `delivery` takes `delivery.waive`.
 */
export type AppOfferClass = 'product' | 'order' | 'delivery';

export type AppOfferChannel =
  'store' | 'landing' | 'shopify' | 'dashboard' | 'apps';

/** A product, variant or collection id (a string of digits), or up to 50. */
export type AppOfferIds = string | string[];

/**
 * One test on the cart. The `lines.*` keys pick lines (every one present must
 * match a line); `quantity.*` and `subtotal.*` measure THOSE lines (the whole
 * cart when the leaf picks none); every other key reads the cart. At least one
 * key. `subtotal.*` is whole dinars.
 */
export type AppOfferLeaf = {
  'lines.product'?: AppOfferIds;
  'lines.variant'?: AppOfferIds;
  'lines.collection'?: AppOfferIds;
  'quantity.gte'?: number;
  'quantity.lte'?: number;
  'subtotal.gte'?: number;
  'subtotal.lte'?: number;
  /** Two-digit wilaya codes, `"01"` to `"69"`. */
  'delivery.wilaya.in'?: string[];
  'delivery.method'?: 'home' | 'desk';
  'channel.in'?: AppOfferChannel[];
  audience?: 'first_order' | 'returning';
  /** Africa/Algiers wall clock, `HH:MM`; `from` after `to` spans midnight. */
  'time.between'?: { from: string; to: string };
};

/** A condition: `{ all }`, `{ any }` or a leaf. */
export type AppOfferCondition =
  { all: AppOfferCondition[] } | { any: AppOfferCondition[] } | AppOfferLeaf;

/** What a satisfied rule does. Each key at most once per rule. */
export type AppOfferAction =
  /** PRODUCT: a percentage, or whole dinars off each piece, of every selected line. */
  | { 'discount.lines': { percent: number } | { amount_each: number } }
  /** PRODUCT: a percentage off the `count` cheapest selected pieces ("the 3rd free"). */
  | { 'discount.cheapest': { percent: number; count: number } }
  /** PRODUCT: a gift line (one of `productId` / `variantId`): suggested when missing, discounted when present. */
  | {
      'give.item': {
        productId?: string;
        variantId?: string;
        /** Default 100. */
        percent?: number;
        /** Default 1. */
        count?: number;
      };
    }
  /** ORDER: a percentage, or whole dinars, off the goods. */
  | { 'discount.order': { percent: number } | { amount: number } }
  /** DELIVERY: the quoted fee is waived. */
  | { 'delivery.waive': Record<string, never> }
  /** Buyer-facing text; prices nothing. */
  | { label: { ar?: string; fr?: string; en?: string } };

/**
 * The declarative rule of an app-owned offer. JSON the pricing engine
 * evaluates: no app code runs at checkout, so it costs nothing and cannot
 * fail an order. `when` absent = always.
 */
export type AppOfferRule = {
  class: AppOfferClass;
  when?: AppOfferCondition;
  then: AppOfferAction[];
};

/**
 * The `config` of a `kind: "app"` offer: one of the `[[offers.types]]` of the
 * app's manifest, and the rule that prices it.
 */
export type AppOfferConfig = {
  typeHandle: string;
  rule: AppOfferRule;
};

/**
 * Adds any number of codes to a `code` offer, 250 per call (the most one call
 * takes), and gathers the answers into one result in the order sent. Partial
 * by design, like the route: a code that cannot be created is reported on its
 * own entry (`taken`, `invalid`, `duplicate_in_request`) and the rest are
 * created. A transport or API error stops at the failing batch and is thrown;
 * the batches before it were applied.
 */
export async function addOfferCodes(
  admin: AdminClient,
  offerId: string,
  codes: readonly OfferCodeInput[],
): Promise<OfferCodesBulkResult> {
  const result: OfferCodesBulkResult = { created: 0, results: [] };
  for (let at = 0; at < codes.length; at += OFFER_CODES_BULK_MAX) {
    const { data } = await admin.post('/offers/{id}/codes/bulk', {
      path: { id: offerId },
      body: { codes: codes.slice(at, at + OFFER_CODES_BULK_MAX) },
    });
    result.created += data.created;
    result.results.push(...data.results);
  }
  return result;
}
