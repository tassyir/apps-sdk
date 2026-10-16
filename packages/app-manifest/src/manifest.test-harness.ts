import type { ManifestError, ManifestVocabulary } from './manifest-types.js';

/**
 * Test helpers for the manifest validator, ported from the backend's
 * `manifest.test-harness.ts` (AP-B1.2). Not part of the published package.
 */

/**
 * A small vocabulary with the shapes the real one has: an implying scope, a
 * scope that needs another, an unavailable scope, topics with and without a
 * scope, the app proxy closed. The shipped vocabulary is tested in
 * `vocabulary.test.ts`.
 */
export const FIXTURE_VOCABULARY: ManifestVocabulary = {
  apiVersions: ['2026-07', '2026-10'],
  scopes: [
    { name: 'read_orders', implies: [], available: true },
    { name: 'write_orders', implies: ['read_orders'], available: true },
    { name: 'read_products', implies: [], available: true },
    { name: 'read_customers', implies: ['read_orders'], available: true },
    {
      name: 'read_customer_contact',
      implies: [],
      available: true,
      needsOneOf: ['read_orders'],
    },
    {
      name: 'write_storefront',
      implies: [],
      available: false,
      unavailableReason: 'storefront blocks arrive in Phase 2',
    },
  ],
  topics: [
    { name: 'orders/created', scope: 'read_orders' },
    { name: 'orders/delivered', scope: 'read_orders' },
    { name: 'products/updated', scope: 'read_products' },
    { name: 'app/uninstalled', scope: null },
    { name: 'customers/redact', scope: null },
  ],
  storefrontBlocksScope: 'write_storefront',
  appProxy: {
    available: false,
    unavailableReason: 'the app proxy opens later',
  },
};

/**
 * The Phase 2 shape of {@link FIXTURE_VOCABULARY}: `write_storefront`
 * requestable and the app proxy open.
 */
export const STOREFRONT_VOCABULARY: ManifestVocabulary = {
  ...FIXTURE_VOCABULARY,
  scopes: FIXTURE_VOCABULARY.scopes.map((scope) =>
    scope.name === FIXTURE_VOCABULARY.storefrontBlocksScope
      ? { name: scope.name, implies: [], available: true }
      : scope,
  ),
  appProxy: { available: true },
};

/** A valid hosted manifest, as parsed from TOML. */
export function hostedManifest(): Record<string, unknown> {
  return {
    name: 'Review Requests',
    handle: 'review-requests',
    api_version: '2026-10',
    access: {
      scopes: ['read_products', 'read_orders'],
      optional_scopes: ['read_customer_contact'],
      scope_reasons: {
        read_orders: 'Find delivered orders to ask for a review',
        read_products: 'Show the product in the review request',
        read_customer_contact: "Send the request to the buyer's phone",
      },
    },
    hosting: { mode: 'tassyir', allowed_hosts: ['graph.facebook.com'] },
    admin: { page: '/' },
    webhooks: [
      { topics: ['orders/delivered', 'app/uninstalled'], uri: '/webhooks' },
    ],
    data: {
      definitions: [
        {
          owner: 'product',
          key: 'rating',
          type: 'json',
          visibility: 'storefront',
        },
      ],
    },
  };
}

/**
 * A valid hosted manifest with every marketplace field (storefront blocks and
 * their settings, a data label, an admin action, the app proxy), valid for
 * {@link STOREFRONT_VOCABULARY}.
 */
export function storefrontManifest(): Record<string, unknown> {
  const doc = hostedManifest();
  const access = doc['access'] as {
    scopes: string[];
    scope_reasons: Record<string, string>;
  };
  access.scopes.push('write_storefront');
  access.scope_reasons['write_storefront'] = 'Show the stars on product pages';
  (doc['admin'] as Record<string, unknown>)['actions'] = [
    {
      handle: 'ask-for-reviews',
      target: 'orders.selection',
      label: { ar: 'اطلب التقييمات', en: 'Ask for reviews' },
      path: '/actions/ask',
    },
  ];
  const [rating] = (doc['data'] as { definitions: Record<string, unknown>[] })
    .definitions;
  if (rating) rating['label'] = { ar: 'التقييم', en: 'Rating' };
  doc['storefront'] = {
    blocks: [
      {
        handle: 'product-rating',
        template: 'blocks/product-rating.liquid',
        stylesheet: 'blocks/product-rating.css',
        name: { ar: 'تقييم المنتج', en: 'Product rating' },
        target: 'product',
        data: ['product.rating'],
        settings: [
          {
            key: 'show_count',
            type: 'boolean',
            label: { ar: 'عرض العدد', en: 'Show the count' },
            default: true,
          },
          {
            key: 'layout',
            type: 'select',
            label: { ar: 'الشكل', en: 'Layout' },
            default: 'grid',
            options: [
              { value: 'grid', label: { ar: 'شبكة', en: 'Grid' } },
              { value: 'list', label: { ar: 'قائمة', en: 'List' } },
            ],
          },
          {
            key: 'stars',
            type: 'integer',
            label: { ar: 'عدد النجوم', en: 'Stars' },
            default: 5,
            min: 1,
            max: 10,
          },
          {
            key: 'heading',
            type: 'string',
            label: { ar: 'العنوان', en: 'Heading' },
            default: { ar: 'آراء الزبائن', en: 'What buyers say' },
            max_length: 60,
          },
        ],
      },
    ],
  };
  doc['app_proxy'] = { path: '/proxy' };
  return doc;
}

/** A valid external manifest. */
export function externalManifest(): Record<string, unknown> {
  return {
    name: 'Sheets Sync',
    handle: 'sheets-sync',
    api_version: '2026-10',
    access: {
      scopes: ['write_orders'],
      scope_reasons: {
        write_orders: 'Create orders from the rows of your sheet',
      },
    },
    hosting: { mode: 'external', url: 'https://sync.example.com/tassyir' },
    auth: { callback_url: 'https://sync.example.com/tassyir/callback' },
    webhooks: [
      { topics: ['orders/created'], uri: '/hooks/orders' },
      {
        topics: ['customers/redact'],
        uri: 'https://compliance.example.com/redact',
      },
    ],
  };
}

/** `CODE path` per error, for compact assertions. */
export function codes(errors: readonly ManifestError[]): string[] {
  return errors.map((error) => `${error.code} ${error.path}`);
}

type JsonSchema = Record<string, unknown>;

/** The keywords {@link schemaViolations} understands. */
export const CHECKED_KEYWORDS = new Set([
  '$schema',
  'title',
  'description',
  'type',
  'properties',
  'required',
  'additionalProperties',
  'propertyNames',
  'items',
  'enum',
  'const',
  'minLength',
  'maxLength',
  'pattern',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minimum',
  'maximum',
]);

/** Every keyword the schema uses, at any depth. */
export function schemaKeywords(schema: unknown, out = new Set<string>()) {
  if (!schema || typeof schema !== 'object') return out;
  const node = schema as JsonSchema;
  for (const key of Object.keys(node)) out.add(key);
  for (const child of Object.values(
    (node['properties'] as Record<string, unknown> | undefined) ?? {},
  )) {
    schemaKeywords(child, out);
  }
  for (const key of ['items', 'additionalProperties', 'propertyNames']) {
    if (node[key] && typeof node[key] === 'object') {
      schemaKeywords(node[key], out);
    }
  }
  return out;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A JSON Schema 2020-12 check covering exactly {@link CHECKED_KEYWORDS}
 * (patterns with the `u` flag, lengths in code points, as JSON Schema
 * validators do). The project has no JSON Schema validator dependency.
 */
export function schemaViolations(
  value: unknown,
  schema: JsonSchema,
  path = '$',
): string[] {
  const errors: string[] = [];
  const type = schema['type'];
  if (type === 'object' && !isObject(value)) return [`${path}: not object`];
  if (type === 'array' && !Array.isArray(value)) return [`${path}: not array`];
  if (type === 'string' && typeof value !== 'string') {
    return [`${path}: not string`];
  }
  if (type === 'boolean' && typeof value !== 'boolean') {
    return [`${path}: not boolean`];
  }
  if (type === 'number' && typeof value !== 'number') {
    return [`${path}: not number`];
  }
  if (
    type === 'integer' &&
    (typeof value !== 'number' || !Number.isInteger(value))
  ) {
    return [`${path}: not integer`];
  }
  const { minimum, maximum } = schema;
  if (typeof value === 'number') {
    if (typeof minimum === 'number' && value < minimum) {
      errors.push(`${path}: below ${minimum}`);
    }
    if (typeof maximum === 'number' && value > maximum) {
      errors.push(`${path}: above ${maximum}`);
    }
  }
  const constant = schema['const'];
  if ('const' in schema && value !== constant) {
    errors.push(`${path}: not ${JSON.stringify(constant)}`);
  }
  const allowed = schema['enum'];
  if (Array.isArray(allowed) && !allowed.includes(value)) {
    errors.push(`${path}: ${JSON.stringify(value)} not in enum`);
  }
  const { minLength, maxLength, pattern, minItems, maxItems } = schema;
  if (typeof value === 'string') {
    // JSON Schema counts code points, which is what spreading a string gives.
    // eslint-disable-next-line @typescript-eslint/no-misused-spread
    const length = [...value].length;
    if (typeof minLength === 'number' && length < minLength) {
      errors.push(`${path}: shorter than ${minLength}`);
    }
    if (typeof maxLength === 'number' && length > maxLength) {
      errors.push(`${path}: longer than ${maxLength}`);
    }
    if (typeof pattern === 'string' && !new RegExp(pattern, 'u').test(value)) {
      errors.push(`${path}: fails ${pattern}`);
    }
  }
  if (Array.isArray(value)) {
    if (typeof minItems === 'number' && value.length < minItems) {
      errors.push(`${path}: fewer than ${minItems} items`);
    }
    if (typeof maxItems === 'number' && value.length > maxItems) {
      errors.push(`${path}: more than ${maxItems} items`);
    }
    if (schema['uniqueItems'] === true) {
      const seen = value.map((item) => JSON.stringify(item));
      if (new Set(seen).size !== seen.length) {
        errors.push(`${path}: duplicate items`);
      }
    }
    const items = schema['items'];
    if (isObject(items)) {
      value.forEach((item, i) => {
        errors.push(...schemaViolations(item, items, `${path}[${i}]`));
      });
    }
  }
  if (isObject(value)) {
    const properties = (schema['properties'] ?? {}) as Record<
      string,
      JsonSchema
    >;
    const { propertyNames, additionalProperties } = schema;
    for (const key of Object.keys(value)) {
      if (isObject(propertyNames)) {
        errors.push(...schemaViolations(key, propertyNames, `${path}{${key}}`));
      }
      if (key in properties) {
        errors.push(
          ...schemaViolations(
            value[key],
            properties[key] as JsonSchema,
            `${path}.${key}`,
          ),
        );
      } else if (additionalProperties === false) {
        errors.push(`${path}.${key}: not allowed`);
      } else if (isObject(additionalProperties)) {
        errors.push(
          ...schemaViolations(
            value[key],
            additionalProperties,
            `${path}.${key}`,
          ),
        );
      }
    }
    for (const key of (schema['required'] as string[] | undefined) ?? []) {
      if (!(key in value)) errors.push(`${path}.${key}: required`);
    }
  }
  return errors;
}

/** The ```toml blocks of a Markdown text. */
export function tomlBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```toml\n([\s\S]*?)```/g)].map(
    ([, block]) => block ?? '',
  );
}

/**
 * The manifests of this package's README, parsed: the hosted example, then
 * the external one (a block that parses to nothing, such as the `#:schema`
 * line, is skipped).
 */
export function readmeExamples(readme: string): Record<string, unknown>[] {
  return tomlBlocks(readme)
    .map((block) => parseTomlSubset(block))
    .filter((parsed) => Object.keys(parsed).length > 0);
}

/**
 * The subset of TOML the manifest examples use: comments, `[table]`,
 * `[[array.of.tables]]`, `key = value` with bare keys, basic strings, arrays
 * and inline tables on one line. Anything else throws, so an example that
 * leaves the subset fails loudly instead of being misread. The real parser is
 * the CLI's (AP-K1.6).
 */
export function parseTomlSubset(source: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let current = root;

  const tableAt = (path: string[], create: boolean) => {
    let node: Record<string, unknown> = root;
    for (const key of path) {
      let next = node[key];
      if (Array.isArray(next)) next = next[next.length - 1] as unknown;
      if (next === undefined && create) node[key] = next = {};
      if (!isObject(next)) throw new Error(`TOML subset: bad table ${key}`);
      node = next;
    }
    return node;
  };

  for (const rawLine of source.split('\n')) {
    const line = stripComment(rawLine).trim();
    if (line === '') continue;
    const arrayTable = /^\[\[([A-Za-z0-9_.-]+)\]\]$/.exec(line);
    if (arrayTable) {
      const path = (arrayTable[1] ?? '').split('.');
      const parent = tableAt(path.slice(0, -1), true);
      const key = path[path.length - 1] ?? '';
      const list = (parent[key] ??= []) as unknown[];
      if (!Array.isArray(list)) throw new Error(`TOML subset: ${key}`);
      current = {};
      list.push(current);
      continue;
    }
    const table = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
    if (table) {
      current = tableAt((table[1] ?? '').split('.'), true);
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    const [, key = '', text = ''] = pair ?? [];
    if (!pair) throw new Error(`TOML subset: cannot read "${line}"`);
    const [value, end] = parseValue(text, 0);
    if (text.slice(end).trim() !== '') {
      throw new Error(`TOML subset: trailing text in "${line}"`);
    }
    if (key in current) throw new Error(`TOML subset: ${key} twice`);
    current[key] = value;
  }
  return root;
}

function stripComment(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '\\' && inString) i++;
    else if (char === '"') inString = !inString;
    else if (char === '#' && !inString) return line.slice(0, i);
  }
  return line;
}

function skipSpaces(text: string, i: number): number {
  while (text[i] === ' ' || text[i] === '\t') i++;
  return i;
}

function parseValue(text: string, start: number): [unknown, number] {
  let i = skipSpaces(text, start);
  if (text[i] === '"') {
    let out = '';
    i++;
    while (text[i] !== '"') {
      if (i >= text.length) throw new Error('TOML subset: open string');
      if (text[i] === '\\') {
        const escape = text[i + 1] ?? '';
        const simple: Record<string, string> = {
          '"': '"',
          '\\': '\\',
          n: '\n',
          t: '\t',
        };
        const unescaped = simple[escape];
        if (unescaped !== undefined) {
          out += unescaped;
          i += 2;
        } else if (escape === 'u') {
          out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
          i += 6;
        } else {
          throw new Error(`TOML subset: escape \\${escape}`);
        }
      } else {
        out += text[i++] ?? '';
      }
    }
    return [out, i + 1];
  }
  if (text[i] === '[') {
    const list: unknown[] = [];
    i = skipSpaces(text, i + 1);
    while (text[i] !== ']') {
      const [item, next] = parseValue(text, i);
      list.push(item);
      i = skipSpaces(text, next);
      if (text[i] === ',') i = skipSpaces(text, i + 1);
      else if (text[i] !== ']') throw new Error('TOML subset: bad array');
    }
    return [list, i + 1];
  }
  if (text[i] === '{') {
    const table: Record<string, unknown> = {};
    i = skipSpaces(text, i + 1);
    while (text[i] !== '}') {
      const key = /^([A-Za-z0-9_-]+)\s*=\s*/.exec(text.slice(i));
      if (!key) throw new Error('TOML subset: bad inline table');
      const [value, next] = parseValue(text, i + key[0].length);
      table[key[1] ?? ''] = value;
      i = skipSpaces(text, next);
      if (text[i] === ',') i = skipSpaces(text, i + 1);
      else if (text[i] !== '}')
        throw new Error('TOML subset: bad inline table');
    }
    return [table, i + 1];
  }
  if (text.startsWith('true', i)) return [true, i + 4];
  if (text.startsWith('false', i)) return [false, i + 5];
  throw new Error(`TOML subset: cannot read value "${text.slice(i)}"`);
}
