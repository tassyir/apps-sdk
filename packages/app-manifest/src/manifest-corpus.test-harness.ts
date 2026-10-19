/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call -- the corpus is loose JSON on purpose: most of it is invalid */
import type { ManifestVocabulary } from './manifest-types.js';

/**
 * The corpus `backend-parity.test.ts` runs through this package AND through
 * the backend's own validator: every document of the ported specs' kinds, a
 * mutation of every field with every value the specs use, every structural
 * break, every scope and topic combination, the limits, and seeded random
 * combinations. Deterministic: the same corpus every run.
 *
 * Documents travel to the backend as JSON, so values JSON cannot carry are
 * tagged (`{ $corpus: 'date' }`) and rebuilt on both sides by ONE decoder,
 * {@link DECODE_SOURCE}.
 */

type Doc = any;

/**
 * `shipped`: the package's default call, against the API's door (live
 * vocabulary). The others name a vocabulary of the input's `vocabularies`
 * (`storefront` is the fixture with `write_storefront` available, the
 * Phase 2 shape).
 */
export type CorpusVocabulary = 'fixture' | 'storefront' | 'shipped';

export interface CorpusCase {
  label: string;
  vocabulary: CorpusVocabulary;
  /** JSON, with tagged values (see {@link DECODE_SOURCE}). */
  input: unknown;
}

/**
 * The decoder, as JavaScript source: the backend runner and this package
 * evaluate the same text, so both validate the same objects. Own keys are
 * defined, not assigned, so a `__proto__` key stays an own key.
 */
export const DECODE_SOURCE = `
function decode(value) {
  if (Array.isArray(value)) return value.map(decode);
  if (value === null || typeof value !== 'object') return value;
  switch (value.$corpus) {
    case 'date': return new Date(0);
    case 'map': return new Map();
    case 'undefined': return undefined;
    case 'symbol': return Symbol('x');
    case 'function': return () => 1;
    case 'bigint': return BigInt(1);
    case 'infinity': return Infinity;
    case 'nan': return NaN;
    case 'null-prototype': return copy(Object.create(null), value.value);
    case 'cycle': { const doc = decode(value.value); doc.data.self = doc; return doc; }
    case 'deep': {
      const root = {};
      let node = root;
      for (let i = 0; i < value.depth; i++) node = node.x = {};
      return root;
    }
  }
  return copy({}, value);
}
function copy(target, source) {
  for (const key of Object.keys(source)) {
    Object.defineProperty(target, key, {
      value: decode(source[key]), enumerable: true, writable: true, configurable: true,
    });
  }
  return target;
}
`;

/**
 * What both sides compute from the corpus, as JavaScript source, given an
 * `api` of seven functions bound to one implementation (see
 * `backend-parity.test.ts`). The same text runs on both sides, so a
 * difference in the output is a difference between the implementations.
 */
export const EVALUATE_SOURCE = `
function evaluate(api, input) {
  const results = input.cases.map((item) => {
    const result = api.validate(decode(item.input), item.vocabulary);
    if (!result.ok) return { result };
    const manifest = result.manifest;
    const again = api.validate(JSON.parse(JSON.stringify(manifest)), item.vocabulary);
    const uris = [];
    if (manifest.admin && manifest.admin.page !== undefined) uris.push(manifest.admin.page);
    for (const action of (manifest.admin && manifest.admin.actions) || []) uris.push(action.path);
    for (const type of (manifest.offers && manifest.offers.types) || []) uris.push(type.path);
    for (const hook of manifest.webhooks) uris.push(hook.uri);
    if (manifest.app_proxy) uris.push(manifest.app_proxy.path);
    return {
      result,
      stable: JSON.stringify(again) === JSON.stringify(result),
      columns: api.columns(manifest, item.vocabulary),
      uris: uris.map((uri) => api.resolve(manifest, uri)),
    };
  });
  return {
    results,
    fields: input.fields.map(([field, value, path]) =>
      path === undefined ? api.field(field, decode(value)) : api.field(field, decode(value), path)),
    paths: input.paths.map((path) => api.path(path)),
    origins: input.handles.map((handle) => api.origin(handle)),
    fixtureSchemas: Object.values(input.vocabularies).flatMap((vocabulary) =>
      vocabulary.apiVersions.map((version) => api.schema(vocabulary, version))),
  };
}
function constantsOf(module) {
  return Object.fromEntries(
    Object.keys(module)
      .filter((key) => /^[A-Z][A-Z0-9_]*$/.test(key))
      .sort()
      .map((key) => {
        const value = module[key];
        return [key, value instanceof RegExp ? { regexp: value.source, flags: value.flags } : value];
      }),
  );
}
`;

const tag = (kind: string, extra: Record<string, unknown> = {}) => ({
  $corpus: kind,
  ...extra,
});

/** Values a field may be given (the specs' cases, and their neighbours). */
const VALUES: readonly string[] = [
  ...new Set([
    // the ported spec's "every refused value is explained" corpus
    '',
    ' x',
    'x ',
    'X',
    'a b',
    'a‮b',
    'a\nb',
    '*',
    '*.x',
    '-a',
    'a--b',
    'a_b',
    '1',
    'x'.repeat(70),
    'x'.repeat(600),
    'http://x.example.com',
    'https://x.example.com/',
    'https://X.example.com',
    'https://x.example.com:1',
    'ftp://x.example.com',
    '//x.example.com',
    '/a//b',
    '/../a',
    'a/b.liquid',
    'b.js',
    '1.2.3.4',
    'orders/created',
    'read_orders',
    'tassyir',
    // names and texts
    'Review Requests',
    'طلبات التقييم',
    'Reviews ⭐️',
    'Review​Requests',
    'Review ‮steuqer',
    'Find delivered orders to ask for a review',
    'Find delivered ‫spam‬ orders',
    'Reviews',
    'x'.repeat(50),
    'x'.repeat(51),
    'x'.repeat(200),
    'x'.repeat(201),
    // handles
    'AB',
    'ab',
    'abc',
    'Review_Requests',
    '-reviews',
    'reviews-',
    're--views',
    'reviews.app',
    'review2go',
    '1-2-3',
    'a'.repeat(40),
    'a'.repeat(41),
    'www',
    'api',
    'dispatch',
    'google-sheets',
    'components',
    'hooks',
    'review-requests',
    // URLs
    'http://sync.example.com',
    'sync.example.com',
    'HTTPS://sync.example.com',
    'https://user:pw@sync.example.com',
    'https://sync.example.com:8443',
    'https://sync.example.com:443',
    'https://sync.example.com?x=1',
    'https://sync.example.com#top',
    'https://Sync.Example.com',
    'https://sync.example.com/',
    'https://sync.example.com/a/../b',
    'https://sync.example.com/a/%2e%2e/b',
    'https://sync.example.com/a//b',
    'https://sync.example.com/a%2Fb',
    'https://sync.example.com/a%5cb',
    'https://sync.example.com/a%00b',
    'https://sync.example.com/a b',
    'https://sync.example.com/a\\b',
    `https://sync.example.com/${'a'.repeat(520)}`,
    'https://127.0.0.1',
    'https://10.0.0.1/app',
    'https://0x7f.1',
    'https://[::1]',
    'https://localhost',
    'https://app.local',
    'https://app.internal',
    'https://shop.tassyir.io',
    'https://tassyir.io',
    'https://other-app.tassyir-apps.com',
    'https://store.tassyir.shop',
    'https://sync.example.com',
    'https://sync.example.com/base',
    'https://a-b.sync.example.co.uk/x_y~z/%20',
    'https://notassyir.io',
    'https://compliance.example.com/',
    'https://192.168.1.10/x',
    'https://hooks.example.com/tassyir',
    'mailto:dev@example.com',
    // hosts
    'https://api.example.com',
    'api.example.com/v1',
    'api.example.com:443',
    'API.example.com',
    'api.example.com.',
    'api.*.example.com',
    '**.example.com',
    '*.com',
    'intranetbox',
    'example',
    '-api.example.com',
    'api_v1.example.com',
    '::1',
    '[::1]',
    'localhost',
    'printer.local',
    '*.corp',
    'api.tassyir.io',
    '*.tassyir-apps.com',
    'tassyir.shop',
    '*.example.com',
    'api.example.co',
    'a-b.c.example.com',
    'graph.facebook.com',
    `${'a'.repeat(63)}.example.com`,
    `${'a'.repeat(64)}.example.com`,
    // paths
    '/',
    '/settings',
    '/a/b/',
    '/a-b_c~d/%20',
    'settings',
    '//evil.example.com',
    'javascript:alert(1)',
    '/a?tab=1',
    '/a#x',
    '/a/../b',
    '/a/./b',
    '/a\\b',
    '/a b',
    `/${'a'.repeat(256)}`,
    '/webhooks',
    '/.tassyir',
    '/.tassyir/launch',
    '/.tassyir-app',
    '/.Tassyir/a',
    '/.tassyir//x',
    // topics, scopes, versions
    'orders/create',
    'orders/delivered',
    'products/updated',
    'app/uninstalled',
    'customers/redact',
    'read_order',
    'read_products',
    'write_orders',
    'write_storefront',
    'read_customer_contact',
    'read_customers',
    'manage_everything',
    '2025-01',
    '2026-07',
    '2026-10',
    // data, blocks, enums
    'Rating',
    '1rating',
    'star-rating',
    'rating',
    'a'.repeat(64),
    'a'.repeat(65),
    'products',
    'product',
    'text',
    'json',
    'self',
    'external',
    'app',
    'merchant',
    'storefront',
    'blocks/star-rating.liquid',
    'blocks/star.js',
    '../secrets.liquid',
    '/abs/star.liquid',
    `blocks/${'a'.repeat(200)}.liquid`,
    // marketplace fields: stylesheets, block data, targets, settings, actions
    'blocks/star-rating.css',
    'blocks/star.scss',
    'product.rating',
    'store.theme',
    'business.plan',
    'order.notes',
    'customer.vip',
    'product.Rating',
    'any',
    'boolean',
    'select',
    'integer',
    'color',
    'url',
    'image',
    'show_count',
    'Show Count',
    'grid',
    'list',
    'Big Cards',
    'order.details',
    'orders.selection',
    'customer.details',
    'products.selection',
    '/actions/print',
    // offers: types, classes, handles, paths
    'mix-match',
    'Mix Match',
    'a'.repeat(40),
    'order',
    'delivery',
    'cart',
    '/offers/mix-match',
    `/${'a'.repeat(200)}`,
    `/${'a'.repeat(199)}`,
    'write_offers',
    'read_offers',
    '/proxy',
    '/.tassyir/proxy',
    '#1a7f5a',
    '#ABCDEF',
    '#12345',
    'red',
    '/collections/new',
    'https://example.com/help?topic=reviews#top',
    'a\u0007b',
  ]),
];

/** Values of other types, tagged where JSON cannot carry them. */
const ODD_VALUES: readonly unknown[] = [
  null,
  0,
  1.5,
  5,
  -1,
  1001,
  tag('infinity'),
  true,
  false,
  { ar: 'نص', en: 'Text' },
  [],
  {},
  ['x'],
  { x: 1 },
  tag('date'),
  tag('bigint'),
  tag('undefined'),
  tag('map'),
];

type Segment = string | number;

/** Sets a value at a path, creating the tables and lists on the way. */
function setAt(doc: Doc, path: readonly Segment[], value: unknown): Doc {
  let node = doc;
  path.forEach((segment, i) => {
    const last = i === path.length - 1;
    if (last) {
      Object.defineProperty(node, segment, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      return;
    }
    const next = path[i + 1];
    const existing =
      node !== null && typeof node === 'object'
        ? Object.getOwnPropertyDescriptor(node, segment)?.value
        : undefined;
    if (existing === null || typeof existing !== 'object') {
      const created = typeof next === 'number' ? [] : {};
      Object.defineProperty(node, segment, {
        value: created,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      node = created;
    } else {
      node = existing;
    }
  });
  return doc;
}

/** Every path of a JSON document: tables' keys and lists' items. */
function pathsOf(value: unknown, path: Segment[] = []): Segment[][] {
  const out: Segment[][] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      out.push([...path, index], ...pathsOf(item, [...path, index]));
    });
  } else if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const child = (value as Record<string, unknown>)[key];
      out.push([...path, key], ...pathsOf(child, [...path, key]));
    }
  }
  return out;
}

function removeAt(doc: Doc, path: readonly Segment[]): Doc {
  const parent = path.slice(0, -1).reduce<Doc>((node, key) => node[key], doc);
  const last = path[path.length - 1] as Segment;
  if (Array.isArray(parent)) parent.splice(last as number, 1);
  else Reflect.deleteProperty(parent as object, last);
  return doc;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const name = (path: readonly Segment[]) =>
  path.map((segment) => String(segment)).join('.');

/** mulberry32: a tiny seeded generator, so the random part never changes. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where each leaf of a hosted and an external manifest lives. */
const HOSTED_LEAVES: readonly (readonly Segment[])[] = [
  ['name'],
  ['handle'],
  ['api_version'],
  ['access', 'scopes', 0],
  ['access', 'optional_scopes', 0],
  ['access', 'scope_reasons', 'read_orders'],
  ['hosting', 'mode'],
  ['hosting', 'allowed_hosts', 0],
  ['hosting', 'url'],
  ['auth', 'callback_url'],
  ['admin', 'page'],
  ['webhooks', 0, 'topics', 0],
  ['webhooks', 0, 'uri'],
  ['data', 'definitions', 0, 'owner'],
  ['data', 'definitions', 0, 'key'],
  ['data', 'definitions', 0, 'type'],
  ['data', 'definitions', 0, 'visibility'],
  ['storefront', 'blocks', 0, 'handle'],
  ['storefront', 'blocks', 0, 'template'],
  ['data', 'definitions', 0, 'label', 'ar'],
  ['storefront', 'blocks', 0, 'stylesheet'],
  ['storefront', 'blocks', 0, 'name', 'en'],
  ['storefront', 'blocks', 0, 'target'],
  ['storefront', 'blocks', 0, 'data', 0],
  ['storefront', 'blocks', 0, 'settings', 0, 'key'],
  ['storefront', 'blocks', 0, 'settings', 0, 'type'],
  ['storefront', 'blocks', 0, 'settings', 0, 'label', 'ar'],
  ['storefront', 'blocks', 0, 'settings', 0, 'default'],
  ['storefront', 'blocks', 0, 'settings', 1, 'default'],
  ['storefront', 'blocks', 0, 'settings', 1, 'options', 0, 'value'],
  ['storefront', 'blocks', 0, 'settings', 2, 'default'],
  ['storefront', 'blocks', 0, 'settings', 2, 'min'],
  ['storefront', 'blocks', 0, 'settings', 3, 'default'],
  ['storefront', 'blocks', 0, 'settings', 3, 'max_length'],
  ['admin', 'actions', 0, 'handle'],
  ['admin', 'actions', 0, 'target'],
  ['admin', 'actions', 0, 'label', 'en'],
  ['admin', 'actions', 0, 'path'],
  ['offers', 'types', 0, 'handle'],
  ['offers', 'types', 0, 'class'],
  ['offers', 'types', 0, 'path'],
  ['offers', 'types', 0, 'label', 'ar'],
  ['offers', 'types', 0, 'description', 'en'],
  ['offers', 'types', 1, 'handle'],
  ['app_proxy', 'path'],
];
const EXTERNAL_LEAVES: readonly (readonly Segment[])[] = [
  ['name'],
  ['handle'],
  ['access', 'scopes', 0],
  ['hosting', 'mode'],
  ['hosting', 'url'],
  ['hosting', 'allowed_hosts', 0],
  ['auth', 'callback_url'],
  ['admin', 'page'],
  ['webhooks', 0, 'uri'],
  ['webhooks', 1, 'uri'],
  ['webhooks', 1, 'topics', 0],
  ['admin', 'actions', 0, 'path'],
  ['app_proxy', 'path'],
];

/** Keys to add next to existing ones: unknown, near, prototype, quoted. */
const EXTRA_KEYS = [
  'zzz',
  '__proto__',
  'constructor',
  'toString',
  'a.b',
  'script',
  'onload',
];

export interface CorpusBases {
  /** A hosted and an external manifest valid for the vocabulary. */
  hosted: () => Doc;
  external: () => Doc;
  bare: () => Doc;
  /**
   * A hosted manifest with every marketplace field, valid for the
   * vocabulary when it offers them: its fields are mutated like the others.
   */
  marketplace?: () => Doc;
  vocabulary: ManifestVocabulary;
}

function reasonsFor(scopes: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    scopes.map((scope) => [scope, `Why the app needs ${scope} here`]),
  );
}

function casesFor(kind: CorpusVocabulary, bases: CorpusBases): CorpusCase[] {
  const out: CorpusCase[] = [];
  const add = (label: string, input: unknown) => {
    out.push({ label: `${kind}: ${label}`, vocabulary: kind, input });
  };
  const named: [string, () => Doc][] = [
    ['hosted', bases.hosted],
    ['external', bases.external],
    ['bare', bases.bare],
    ...(bases.marketplace
      ? [['marketplace', bases.marketplace] as [string, () => Doc]]
      : []),
  ];

  // Valid documents, and their key order reversed (deep).
  const reverse = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(reverse)
      : value !== null && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([k, v]) => [k, reverse(v)]),
          )
        : value;
  for (const [label, make] of named) {
    add(`${label} as is`, make());
    add(`${label} keys reversed`, reverse(make()));
    add(
      `${label} without a prototype`,
      tag('null-prototype', { value: make() }),
    );
  }

  // Every leaf, every value.
  for (const [label, make, leaves] of [
    ['hosted', bases.marketplace ?? bases.hosted, HOSTED_LEAVES],
    ['external', bases.external, EXTERNAL_LEAVES],
  ] as const) {
    for (const path of leaves) {
      for (const value of [...VALUES, ...ODD_VALUES]) {
        add(
          `${label} ${name(path)} = ${JSON.stringify(value).slice(0, 40)}`,
          setAt(make(), path, value),
        );
      }
    }
    // A reason keyed by every value (unknown, near, unavailable scopes).
    for (const value of VALUES) {
      add(
        `${label} scope_reasons[${JSON.stringify(value).slice(0, 40)}]`,
        setAt(
          make(),
          ['access', 'scope_reasons', value],
          'A reason long enough',
        ),
      );
    }
  }

  // Every path removed, retyped, or given an unknown sibling.
  for (const [label, make] of named) {
    for (const path of pathsOf(make())) {
      add(`${label} without ${name(path)}`, removeAt(make(), path));
      for (const odd of ODD_VALUES) {
        add(
          `${label} ${name(path)} = ${JSON.stringify(odd)}`,
          setAt(make(), path, odd),
        );
      }
      const parent = path.slice(0, -1);
      const last = path[path.length - 1];
      for (const extra of [
        ...EXTRA_KEYS,
        typeof last === 'string' ? `${last}s` : 'x',
        typeof last === 'string' ? last.slice(0, -1) : 'y',
      ]) {
        const target =
          typeof last === 'number' ? [...path] : [...parent, extra];
        if (typeof last === 'number') target.push(extra);
        add(`${label} ${name(target)} added`, setAt(make(), target, 'x'));
      }
    }
  }

  // Scopes: alone, optional, every pair; and every topic with every scope.
  const scopes = bases.vocabulary.scopes.map((scope) => scope.name);
  const topics = bases.vocabulary.topics.map((topic) => topic.name);
  for (const scope of scopes) {
    for (const [required, optional] of [
      [[scope], []],
      [[], [scope]],
      [[scope, scope], []],
      [[scope], [scope]],
      ...scopes
        .filter((other) => other !== scope)
        .map((other) => [[scope], [other]]),
    ] as [string[], string[]][]) {
      const doc = bases.hosted();
      doc.access = {
        scopes: required,
        optional_scopes: optional,
        scope_reasons: reasonsFor([...required, ...optional]),
      };
      doc.webhooks = [];
      add(`scopes ${required.join('+')} | ${optional.join('+')}`, doc);
    }
    for (const topic of topics) {
      const doc = bases.external();
      doc.access = { scopes: [scope], scope_reasons: reasonsFor([scope]) };
      doc.webhooks = [{ topics: [topic], uri: '/hooks' }];
      add(`topic ${topic} with ${scope}`, doc);
    }
  }
  for (const topic of topics) {
    const doc = bases.hosted();
    delete doc.access;
    doc.webhooks = [{ topics: [topic], uri: '/hooks' }];
    add(`topic ${topic} without access`, doc);
  }
  {
    const doc = bases.hosted();
    delete doc.access;
    doc.webhooks = [{ topics: [...topics], uri: '/hooks' }];
    add('every topic at once', doc);
    const split = bases.hosted();
    split.webhooks = [
      { topics: [...topics], uri: '/a' },
      { topics: [...topics].reverse(), uri: '/b' },
    ];
    add('every topic twice', split);
  }

  // Duplicates and limits.
  const hostsOf = (n: number) =>
    Array.from({ length: n }, (_, i) => `h${i}.example.com`);
  for (const n of [0, 1, 19, 20, 21, 40]) {
    const doc = bases.hosted();
    doc.hosting.allowed_hosts = hostsOf(n);
    add(`${n} allowed hosts`, doc);
  }
  for (const n of [9, 10, 11]) {
    const doc = bases.hosted();
    doc.webhooks = Array.from({ length: n }, (_, i) => ({
      topics: [topics[i % topics.length]],
      uri: `/h${i}`,
    }));
    add(`${n} webhooks`, doc);
  }
  for (const n of [49, 50, 51]) {
    const doc = bases.hosted();
    doc.data = {
      definitions: Array.from({ length: n }, (_, i) => ({
        owner: 'product',
        key: `k${i}`,
        type: 'json',
        visibility: 'app',
      })),
    };
    add(`${n} data definitions`, doc);
  }
  for (const n of [1, 20, 21]) {
    const doc = bases.hosted();
    doc.storefront = {
      blocks: Array.from({ length: n }, (_, i) => ({
        handle: `block-${i}`,
        template: `blocks/b${i}.liquid`,
      })),
    };
    add(`${n} storefront blocks`, doc);
  }
  const market = bases.marketplace ?? bases.hosted;
  const label = (en: string) => ({ ar: 'خيار', en });
  for (const n of [19, 20, 21]) {
    const doc = market();
    doc.storefront = {
      blocks: [
        {
          handle: 'many',
          template: 'blocks/many.liquid',
          data: Array.from({ length: n }, (_, i) => `store.k${i}`),
          settings: Array.from({ length: n }, (_, i) => ({
            key: `s${i}`,
            type: 'boolean',
            label: label(`Option ${i}`),
          })),
        },
      ],
    };
    add(`a block with ${n} data keys and settings`, doc);
  }
  for (const n of [0, 1, 2, 20, 21]) {
    const doc = market();
    doc.storefront = {
      blocks: [
        {
          handle: 'choices',
          template: 'blocks/choices.liquid',
          settings: [
            {
              key: 'pick',
              type: 'select',
              label: label('Pick'),
              options: Array.from({ length: n }, (_, i) => ({
                value: `v${i}`,
                label: label(`Value ${i}`),
              })),
            },
          ],
        },
      ],
    };
    add(`a select with ${n} options`, doc);
  }
  for (const n of [10, 11]) {
    const doc = market();
    doc.admin = {
      actions: Array.from({ length: n }, (_, i) => ({
        handle: `action-${i}`,
        target: 'orders.selection',
        label: label(`Action ${i}`),
        path: `/actions/${i}`,
      })),
    };
    add(`${n} admin actions`, doc);
  }
  for (const n of [10, 11]) {
    const doc = market();
    doc.offers = {
      types: Array.from({ length: n }, (_, i) => ({
        handle: `type-${i}`,
        class: 'order',
        path: `/offers/${i}`,
        label: label(`Type ${i}`),
      })),
    };
    add(`${n} offer types`, doc);
  }
  if (bases.marketplace) {
    const doc = bases.marketplace();
    // The same handle twice, and a type without write_offers.
    doc.offers.types.push({ ...doc.offers.types[0] });
    add('duplicate offer type handles', doc);
    const bare = bases.marketplace();
    bare.access.scopes = bare.access.scopes.filter(
      (scope: string) => scope !== 'write_offers',
    );
    delete bare.access.scope_reasons.write_offers;
    add('offer types without write_offers', bare);
    const optional = bases.marketplace();
    optional.access.scopes = optional.access.scopes.filter(
      (scope: string) => scope !== 'write_offers',
    );
    optional.access.optional_scopes = ['write_offers'];
    add('offer types with write_offers optional', optional);
    const implied = bases.marketplace();
    implied.access.scopes = ['read_offers', 'write_storefront'];
    add('offer types with only read_offers', implied);
  }
  if (bases.marketplace) {
    const doc = bases.marketplace();
    const block = doc.storefront.blocks[0];
    block.data = ['product.rating', 'product.rating'];
    block.settings.push({ ...block.settings[0] });
    block.settings[1].options.push({ ...block.settings[1].options[0] });
    doc.admin.actions.push({ ...doc.admin.actions[0] });
    add('marketplace duplicates everywhere', doc);
  }
  if (bases.marketplace) {
    // Every setting type with every field and a default of every kind.
    const types = [
      'string',
      'text',
      'boolean',
      'integer',
      'number',
      'select',
      'color',
      'image',
      'url',
      'product',
      'collection',
    ];
    const defaults: unknown[] = [
      'x',
      'line\nline',
      true,
      3,
      2.5,
      'v0',
      '#1a7f5a',
      '/collections/new',
      { ar: 'نص', en: 'Text' },
    ];
    for (const type of types) {
      for (const value of defaults) {
        const doc = market();
        doc.storefront.blocks[0].settings = [
          {
            key: 'one',
            type,
            label: label('One'),
            default: value,
            ...(type === 'select'
              ? {
                  options: [
                    { value: 'v0', label: label('Zero') },
                    { value: 'v1', label: label('One') },
                  ],
                }
              : {}),
          },
        ];
        add(`setting ${type} default ${JSON.stringify(value)}`, doc);
      }
      for (const field of ['options', 'min', 'max', 'max_length']) {
        const doc = market();
        doc.storefront.blocks[0].settings = [
          {
            key: 'one',
            type,
            label: label('One'),
            [field]:
              field === 'options'
                ? [
                    { value: 'a', label: label('A') },
                    { value: 'a', label: label('B') },
                  ]
                : 4,
          },
        ];
        add(`setting ${type} with ${field}`, doc);
      }
    }
    for (const [min, max] of [
      [1, 10],
      [10, 1],
      [1.5, 3],
      [0, 0],
    ]) {
      for (const type of ['integer', 'number']) {
        const doc = market();
        doc.storefront.blocks[0].settings = [
          { key: 'n', type, label: label('N'), min, max, default: 5 },
        ];
        add(`setting ${type} min ${String(min)} max ${String(max)}`, doc);
      }
    }
    for (const target of [
      'order.details',
      'orders.selection',
      'product.details',
      'products.selection',
      'customer.details',
    ]) {
      for (const scope of bases.vocabulary.scopes.map((s) => s.name)) {
        const doc = market();
        doc.access = {
          scopes: [scope],
          scope_reasons: reasonsFor([scope]),
        };
        doc.webhooks = [];
        delete doc.storefront;
        delete doc.app_proxy;
        doc.admin.actions[0].target = target;
        add(`action ${target} with ${scope}`, doc);
      }
    }
    for (const data of [
      ['product.rating'],
      ['store.theme'],
      ['business.plan', 'product.rating', 'product.rating'],
    ]) {
      for (const target of [undefined, 'product', 'any']) {
        for (const visibility of ['storefront', 'merchant', 'app', 'shop']) {
          const doc = market();
          doc.data.definitions.push({
            owner: 'store',
            key: 'theme',
            type: 'json',
            visibility,
          });
          const block = doc.storefront.blocks[0];
          block.data = data;
          if (target === undefined) delete block.target;
          else block.target = target;
          add(
            `block data ${data.join('+')} target ${String(target)} store.theme ${visibility}`,
            doc,
          );
        }
      }
    }
  }
  {
    const doc = bases.hosted();
    doc.hosting.allowed_hosts = [
      'a.example.com',
      'b.example.com',
      'a.example.com',
    ];
    doc.data = {
      definitions: [
        { owner: 'product', key: 'rating', type: 'json', visibility: 'app' },
        { owner: 'order', key: 'rating', type: 'json', visibility: 'app' },
        { owner: 'product', key: 'rating', type: 'number', visibility: 'app' },
      ],
    };
    doc.storefront = {
      blocks: [
        { handle: 'stars', template: 'blocks/stars.liquid' },
        { handle: 'stars', template: 'blocks/stars.liquid', script: 'x' },
      ],
    };
    add('duplicates everywhere', doc);
  }
  for (const unknownTopics of [1, 4, 5, 6, 8, 12]) {
    const doc = bases.hosted();
    doc.webhooks = Array.from({ length: 10 }, (_, i) => ({
      topics: Array.from({ length: unknownTopics }, (_, j) => `x${i}/t${j}`),
      uri: '/x',
    }));
    add(`10 webhooks of ${unknownTopics} unknown topics`, doc);
  }
  for (const size of [60_000, 65_536, 70_000]) {
    const doc = bases.hosted();
    doc.name = 'x'.repeat(size);
    add(`a name of ${size} characters`, doc);
  }

  // Seeded random combinations of the mutations above.
  const random = seeded(20261014);
  const pick = <T>(list: readonly T[]): T =>
    list[Math.floor(random() * list.length)] as T;
  for (let i = 0; i < 600; i++) {
    const [baseLabel, make, leaves] = pick([
      ['hosted', bases.hosted, HOSTED_LEAVES],
      ['external', bases.external, EXTERNAL_LEAVES],
    ] as const);
    let doc = make();
    const steps: string[] = [];
    const count = 2 + Math.floor(random() * 4);
    for (let step = 0; step < count; step++) {
      const choice = random();
      if (choice < 0.6) {
        const path = pick(leaves);
        const value = random() < 0.85 ? pick(VALUES) : pick(ODD_VALUES);
        doc = setAt(doc, path, clone(value));
        steps.push(`${name(path)}=${JSON.stringify(value).slice(0, 20)}`);
      } else if (choice < 0.8) {
        const paths = pathsOf(doc);
        if (paths.length === 0) continue;
        const path = pick(paths);
        doc = removeAt(doc, path);
        steps.push(`-${name(path)}`);
      } else {
        const paths = pathsOf(doc).filter(
          (path) => typeof path[path.length - 1] === 'string',
        );
        if (paths.length === 0) continue;
        const path = pick(paths);
        const extra = pick(EXTRA_KEYS);
        doc = setAt(doc, [...path.slice(0, -1), extra], 'x');
        steps.push(`+${name([...path.slice(0, -1), extra])}`);
      }
    }
    add(`random ${i} ${baseLabel}: ${steps.join(' ')}`, doc);
  }
  return out;
}

/** The inputs that are not documents, or not plain data. */
function oddInputs(make: () => Doc): CorpusCase[] {
  const cases: [string, unknown][] = [
    ['null', null],
    ['an array', []],
    ['a string', 'name = "x"'],
    ['a number', 1],
    ['a boolean', true],
    ['a date', tag('date')],
    ['a Map', tag('map')],
    ['undefined', tag('undefined')],
    ['a symbol', tag('symbol')],
    ['a function', tag('function')],
    ['a cycle', tag('cycle', { value: make() })],
    ['10,000 levels deep', tag('deep', { depth: 10_000 })],
    [
      'odd leaves',
      {
        name: tag('bigint'),
        handle: tag('symbol'),
        api_version: [],
        hosting: 7,
      },
    ],
    ['scopes as a table', { access: { scopes: { 0: 'read_orders' } } }],
    [
      'odd webhooks',
      { webhooks: [null, 1, 'x', [], { topics: null, uri: {} }] },
    ],
    ['odd definitions', { data: { definitions: [{}, null] } }],
    ['blocks as a string', { storefront: { blocks: 'x' } }],
    [
      'odd block fields',
      {
        storefront: {
          blocks: [
            {
              handle: 'b-1',
              template: 'b.liquid',
              name: 'x',
              data: 'product.rating',
              settings: [null, 1, { label: [] }, { default: tag('map') }],
            },
          ],
        },
      },
    ],
    [
      'odd actions and proxy',
      { admin: { actions: { 0: {} } }, app_proxy: 'proxy' },
    ],
    [
      'a default holding a cycle-free date',
      {
        storefront: {
          blocks: [
            {
              handle: 'b-1',
              template: 'b.liquid',
              settings: [
                {
                  key: 'a',
                  type: 'string',
                  label: { ar: 'a', en: 'a' },
                  default: tag('date'),
                },
              ],
            },
          ],
        },
      },
    ],
    [
      'odd hosts',
      { hosting: { mode: 'tassyir', allowed_hosts: [null, 1, {}] } },
    ],
    [
      'a constructor reason',
      JSON.parse('{"access":{"scope_reasons":{"constructor":"x"}}}'),
    ],
    ['reasons as a list', { access: { scope_reasons: ['x'] } }],
    [
      'a __proto__ key',
      JSON.parse(
        JSON.stringify(make()).replace('{', '{"__proto__":{"polluted":true},'),
      ),
    ],
  ];
  return cases.map(([label, input]) => ({
    label: `odd: ${label}`,
    vocabulary: 'shipped',
    input,
  }));
}

/** The whole corpus: every vocabulary, then the odd inputs. */
export function parityCorpus(
  fixture: CorpusBases,
  storefront: CorpusBases,
  shipped: CorpusBases,
): CorpusCase[] {
  return [
    ...casesFor('fixture', fixture),
    ...casesFor('storefront', storefront),
    ...casesFor('shipped', shipped),
    ...oddInputs(shipped.hosted),
  ];
}

/** `validateManifestField` inputs: [field, tagged value, path?]. */
export function fieldCorpus(): [string, unknown, string?][] {
  const out: [string, unknown, string?][] = [];
  for (const field of ['handle', 'name']) {
    for (const value of [...VALUES, ...ODD_VALUES, 42]) {
      out.push([field, value]);
      out.push([field, value, 'nameEn']);
    }
  }
  return out;
}

/** `formatManifestPath` inputs. */
export const PATH_CORPUS: Segment[][] = [
  [],
  ['name'],
  ['webhooks', 0, 'topics', 1],
  ['access', 'scope_reasons', 'a.b'],
  ['access', 'scope_reasons', 'read_orders'],
  ['x y', 3],
  [0],
  ['__proto__'],
  ['data', 'definitions', 12, 'key'],
  ['é', 'ok-key', 'under_score', ''],
];
