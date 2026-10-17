/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- manifests are edited as loose JSON to build invalid documents */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  hostedAppOrigin,
  manifestVersionColumns,
  resolveManifestUri,
} from './manifest-helpers.js';
import { codes, readmeExamples } from './manifest.test-harness.js';
import { validateManifest } from './validate-manifest.js';
import { MANIFEST_VOCABULARY } from './vocabulary.js';

/**
 * The vocabulary this package ships (`MANIFEST_VOCABULARY`) and the rules
 * that depend on it, ported from the backend's `app-manifest.spec.ts`
 * (AP-B1.2). That it EQUALS the API's live vocabulary is
 * `backend-parity.test.ts` (needs a backend checkout).
 */

const vocabulary = MANIFEST_VOCABULARY;
const scopeNames = vocabulary.scopes.map((scope) => scope.name);
const topicNames = vocabulary.topics.map((topic) => topic.name);
const EXAMPLES = readmeExamples(
  readFileSync(new URL('../README.md', import.meta.url), 'utf8'),
);

type Doc = any;
const base = (): Doc => structuredClone(EXAMPLES[0]);

describe('MANIFEST_VOCABULARY', () => {
  it('is the 2026-10 vocabulary', () => {
    expect(vocabulary.apiVersions).toEqual(['2026-10']);
  });

  it('is frozen, all the way down', () => {
    expect(Object.isFrozen(vocabulary)).toBe(true);
    expect(Object.isFrozen(vocabulary.scopes)).toBe(true);
    expect(Object.isFrozen(vocabulary.scopes[0])).toBe(true);
    expect(Object.isFrozen(vocabulary.scopes[0]?.implies)).toBe(true);
    expect(Object.isFrozen(vocabulary.topics[0])).toBe(true);
  });

  it('names each scope and each topic once, and refers only to its own scopes', () => {
    expect(new Set(scopeNames).size).toBe(scopeNames.length);
    expect(new Set(topicNames).size).toBe(topicNames.length);
    for (const scope of vocabulary.scopes) {
      for (const other of [...scope.implies, ...(scope.needsOneOf ?? [])]) {
        expect([scope.name, scopeNames]).toEqual([
          scope.name,
          expect.arrayContaining([other]),
        ]);
      }
    }
    for (const topic of vocabulary.topics) {
      if (topic.scope !== null) expect(scopeNames).toContain(topic.scope);
    }
    expect(scopeNames).toContain(vocabulary.storefrontBlocksScope);
  });

  it('offers every scope, write_storefront included (Phase 2)', () => {
    expect(
      vocabulary.scopes.filter((scope) => !scope.available).map((s) => s.name),
    ).toEqual([]);
    expect(
      vocabulary.scopes.filter((scope) => 'unavailableReason' in scope),
    ).toEqual([]);
    expect(vocabulary.storefrontBlocksScope).toBe('write_storefront');
  });

  it('keeps the app proxy closed, with a reason that ends a fix sentence', () => {
    expect(vocabulary.appProxy.available).toBe(false);
    expect(vocabulary.appProxy.unavailableReason).toMatch(/^[a-z][^.]*[^.]$/);
    expect(Object.isFrozen(vocabulary.appProxy)).toBe(true);
  });

  it('is the default of validateManifest', () => {
    for (const doc of [...EXAMPLES, { name: 'x' }]) {
      expect(validateManifest(doc)).toEqual(validateManifest(doc, vocabulary));
    }
  });
});

describe('the README examples', () => {
  it('are two: a hosted app and an external one', () => {
    expect(EXAMPLES.map((example) => (example['hosting'] as Doc).mode)).toEqual(
      ['tassyir', 'external'],
    );
  });

  it.each(EXAMPLES.map((example, i) => [i, example]))(
    'example %i is a valid manifest',
    (_i, example) => {
      const result = validateManifest(example);
      expect(result.ok ? [] : codes(result.errors)).toEqual([]);
    },
  );
});

describe('rules that depend on the shipped vocabulary', () => {
  it('read_customer_contact alone reads nothing', () => {
    const doc = base();
    doc.access = {
      scopes: ['read_customer_contact'],
      scope_reasons: {
        read_customer_contact: "Send the request to the buyer's phone",
      },
    };
    doc.webhooks = [{ topics: ['app/uninstalled'], uri: '/webhooks' }];
    const result = validateManifest(doc);
    expect(result.ok ? [] : codes(result.errors)).toEqual([
      'MANIFEST_SCOPE_NEEDS_ANOTHER access.scopes[0]',
    ]);
  });

  it('write_storefront can be requested, and a block with its settings passes', () => {
    const doc = base();
    doc.access.scopes.push('write_storefront');
    doc.access.scope_reasons.write_storefront =
      'Show the stars on product pages';
    doc.storefront = {
      blocks: [
        {
          handle: 'stars',
          template: 'blocks/stars.liquid',
          name: { ar: 'النجوم', en: 'Stars' },
          target: 'product',
          data: ['product.rating'],
          settings: [
            {
              key: 'show_count',
              type: 'boolean',
              label: { ar: 'عرض العدد', en: 'Show the count' },
              default: true,
            },
          ],
        },
      ],
    };
    doc.admin.actions = [
      {
        handle: 'ask-for-reviews',
        target: 'orders.selection',
        label: { ar: 'اطلب التقييمات', en: 'Ask for reviews' },
        path: '/actions/ask',
      },
    ];
    const result = validateManifest(doc);
    expect(result.ok ? [] : codes(result.errors)).toEqual([]);
  });

  it('the app proxy is refused, saying why', () => {
    const doc = base();
    doc.access.scopes.push('write_storefront');
    doc.access.scope_reasons.write_storefront =
      'Answer the review form on the store';
    doc.app_proxy = { path: '/proxy' };
    const result = validateManifest(doc);
    expect(result.ok ? [] : result.errors).toEqual([
      {
        code: 'MANIFEST_PROXY_NOT_AVAILABLE',
        path: 'app_proxy',
        message: 'The app proxy cannot be declared yet.',
        fix: 'Remove the [app_proxy] table; the app proxy is not open yet, and until then Tassyir forwards no store request to an app.',
      },
    ]);
  });

  it('every topic needs its own scope; `app/*` and compliance topics none', () => {
    const doc = base();
    delete doc.access;
    delete doc.data;
    doc.webhooks = [{ topics: [...topicNames], uri: '/webhooks' }];
    const result = validateManifest(doc);
    const missing = result.ok
      ? []
      : result.errors.filter(
          (error) => error.code === 'MANIFEST_TOPIC_SCOPE_MISSING',
        );
    expect(missing.map((error) => error.message.split('"')[1])).toEqual(
      vocabulary.topics
        .filter((topic) => topic.scope !== null)
        .map((topic) => topic.name),
    );
    expect(
      vocabulary.topics
        .filter((topic) => topic.scope === null)
        .map((topic) => topic.name),
    ).toEqual([
      'app/installed',
      'app/uninstalled',
      'app/scopes_updated',
      'customers/data_request',
      'customers/redact',
      'business/redact',
      'bulk/finished',
    ]);
  });

  it('read_offers opens the three offers topics and implies nothing', () => {
    expect(vocabulary.scopes.find((s) => s.name === 'read_offers')).toEqual({
      name: 'read_offers',
      implies: [],
      available: true,
    });
    expect(
      vocabulary.topics.filter((topic) => topic.name.startsWith('offers/')),
    ).toEqual([
      { name: 'offers/created', scope: 'read_offers' },
      { name: 'offers/updated', scope: 'read_offers' },
      { name: 'offers/deleted', scope: 'read_offers' },
    ]);

    const doc = base();
    doc.access.scopes.push('read_offers');
    doc.access.scope_reasons.read_offers = 'Show the live offer in a campaign';
    doc.webhooks.push({
      topics: ['offers/created', 'offers/updated', 'offers/deleted'],
      uri: '/webhooks/offers',
    });
    const granted = validateManifest(doc);
    expect(granted.ok ? [] : codes(granted.errors)).toEqual([]);

    delete doc.access.scope_reasons.read_offers;
    doc.access.scopes.pop();
    const refused = validateManifest(doc);
    expect(refused.ok ? [] : codes(refused.errors)).toEqual([
      'MANIFEST_TOPIC_SCOPE_MISSING webhooks[1].topics[0]',
      'MANIFEST_TOPIC_SCOPE_MISSING webhooks[1].topics[1]',
      'MANIFEST_TOPIC_SCOPE_MISSING webhooks[1].topics[2]',
    ]);
  });

  it('every requestable scope can be requested on its own', () => {
    for (const scope of vocabulary.scopes) {
      if (!scope.available || scope.needsOneOf) continue;
      const doc = base();
      doc.access = {
        scopes: [scope.name],
        scope_reasons: { [scope.name]: 'A reason the merchant can read' },
      };
      doc.webhooks = [];
      const result = validateManifest(doc);
      expect([scope.name, result.ok ? [] : codes(result.errors)]).toEqual([
        scope.name,
        [],
      ]);
    }
  });
});

describe('normalised manifest helpers', () => {
  const [hosted, external] = EXAMPLES.map((example) => {
    const result = validateManifest(example);
    if (!result.ok) throw new Error('the README examples are valid');
    return result.manifest;
  });
  if (!hosted || !external) throw new Error('the README has two examples');

  it('derive the app_versions columns', () => {
    expect(manifestVersionColumns(external)).toEqual({
      apiVersion: '2026-10',
      scopes: ['write_orders', 'read_products'],
      optionalScopes: [],
      webhookTopics: [
        'orders/created',
        'products/updated',
        'customers/data_request',
        'customers/redact',
        'business/redact',
      ],
      allowedHosts: [],
    });
    expect(manifestVersionColumns(hosted)).toEqual({
      apiVersion: '2026-10',
      scopes: ['read_orders', 'read_products'],
      optionalScopes: ['read_customer_contact'],
      webhookTopics: ['orders/delivered', 'app/uninstalled'],
      allowedHosts: ['*.googleapis.com', 'graph.facebook.com'],
    });
  });

  it('resolve pages and webhook uris against the right origin', () => {
    expect(hostedAppOrigin('review-requests')).toBe(
      'https://review-requests.tassyir-apps.com',
    );
    expect(resolveManifestUri(hosted, '/')).toEqual({
      via: 'hosted',
      url: 'https://review-requests.tassyir-apps.com/',
    });
    expect(resolveManifestUri(external, '/hooks')).toEqual({
      via: 'external',
      url: 'https://sync.example.com/tassyir/hooks',
    });
    expect(
      resolveManifestUri(external, 'https://privacy.example.com/tassyir'),
    ).toEqual({
      via: 'external',
      url: 'https://privacy.example.com/tassyir',
    });
    // An admin action's or the proxy's path resolves like a page.
    expect(resolveManifestUri(external, '/actions/print')).toEqual({
      via: 'external',
      url: 'https://sync.example.com/tassyir/actions/print',
    });
    expect(resolveManifestUri(hosted, '/proxy')).toEqual({
      via: 'hosted',
      url: 'https://review-requests.tassyir-apps.com/proxy',
    });
  });
});
