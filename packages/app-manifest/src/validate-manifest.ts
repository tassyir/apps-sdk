import type { z } from 'zod';
import type { Problem } from './manifest-format.js';
import {
  allowedHostProblem,
  blockDataProblem,
  closestMatch,
  dataKeyProblem,
  describeType,
  handleProblem,
  httpsUrlProblem,
  labelProblem,
  nameProblem,
  offerTypeDescriptionProblem,
  offerTypeHandleProblem,
  optionValueProblem,
  quote,
  relativePathProblem,
  scopeReasonProblem,
  settingDefaultProblem,
  settingKeyProblem,
  stylesheetProblem,
  templateProblem,
} from './manifest-format.js';
import {
  ADMIN_ACTION_TARGETS,
  ADMIN_ACTION_TARGET_SCOPES,
  BLOCK_DATA_PATTERN,
  BLOCK_TARGETS,
  DATA_OWNERS,
  DATA_TYPES,
  DATA_VISIBILITIES,
  HOSTED_RESERVED_PATH_PREFIX,
  HOSTING_MODES,
  MANIFEST_FILE_NAME,
  MANIFEST_LIMITS,
  OFFER_TYPE_CLASSES,
  OFFER_TYPES_SCOPE,
  SETTING_KEY_PATTERN,
  SETTING_OPTION_VALUE_PATTERN,
  SETTING_TYPES,
} from './manifest-limits.js';
import { buildManifestSchema } from './manifest-schema.js';
import type {
  AppManifest,
  ManifestAdminAction,
  ManifestDataDefinition,
  ManifestError,
  ManifestErrorCode,
  ManifestLabel,
  ManifestOfferType,
  ManifestSetting,
  ManifestStorefrontBlock,
  ManifestValidationResult,
  ManifestVocabulary,
} from './manifest-types.js';
import { MANIFEST_VOCABULARY } from './vocabulary.js';

/**
 * The manifest v1 validator (tassyir/backend docs/APPS_PLATFORM_PLAN.md
 * §3.2).
 *
 * Takes the PARSED manifest (the CLI parses `tassyir.app.toml`; the API
 * receives JSON) and returns either the normalised manifest that the API
 * stores (`app_versions.manifest`), or every error at once, each with a
 * stable `code`, a `path`, a `message` and a one-sentence `fix`.
 *
 * Three passes:
 *  1. the zod schema (the published JSON Schema's source): types, required
 *     fields, unknown fields, list sizes;
 *  2. one check per value (`manifest-format.ts`): what a field may hold, with
 *     the most specific message;
 *  3. rules across fields: hosting mode, scope reasons, implied scopes,
 *     topics needing a scope, duplicates, storefront blocks and their
 *     settings, the app proxy, admin actions, offer types.
 *
 * Deterministic: errors are sorted by field (manifest order, then array
 * index), then code, so the same document always gives the same list, in the
 * same order, whatever order its keys came in.
 */

type Segment = string | number;
type Path = readonly Segment[];

const L = MANIFEST_LIMITS;

// ── Paths ───────────────────────────────────────────────────────────────────

/** `webhooks[0].topics[1]`; keys TOML cannot write bare are quoted. */
export function formatManifestPath(path: Path): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      out += `[${segment}]`;
    } else {
      const key = /^[A-Za-z0-9_-]+$/.test(segment)
        ? segment
        : JSON.stringify(segment);
      out += out === '' ? key : `.${key}`;
    }
  }
  return out;
}

/** `webhooks[].uri`: a path with its indices dropped, to look rules up. */
function shapeOf(path: Path): string {
  return path
    .map((segment) => (typeof segment === 'number' ? '[]' : `.${segment}`))
    .join('')
    .replace(/^\./, '')
    .replace(/\.\[\]/g, '[]');
}

/** Where a key lives, in TOML words. */
function tableOf(parent: Path): string {
  if (parent.length === 0) return `the top level of ${MANIFEST_FILE_NAME}`;
  const last = parent[parent.length - 1];
  if (typeof last === 'number') {
    const table = formatManifestPath(
      parent.filter((segment) => typeof segment === 'string'),
    );
    return `the [[${table}]] entry \`${formatManifestPath(parent)}\``;
  }
  if (shapeOf(parent) === 'access.scope_reasons') {
    return '`access.scope_reasons`';
  }
  return `[${formatManifestPath(parent)}]`;
}

/** Every key the manifest knows, in manifest order: the sort order. */
const KEY_ORDER = [
  'name',
  'handle',
  'api_version',
  'access',
  'scopes',
  'optional_scopes',
  'scope_reasons',
  'hosting',
  'mode',
  'url',
  'allowed_hosts',
  'auth',
  'callback_url',
  'admin',
  'page',
  'actions',
  'webhooks',
  'topics',
  'uri',
  'data',
  'definitions',
  'owner',
  'key',
  'type',
  'visibility',
  'storefront',
  'blocks',
  'template',
  'stylesheet',
  'target',
  'class',
  'settings',
  'value',
  'label',
  'description',
  'default',
  'options',
  'min',
  'max',
  'max_length',
  'offers',
  'types',
  'path',
  'app_proxy',
  'ar',
  'en',
];
const KEY_RANK = new Map(KEY_ORDER.map((key, rank) => [key, rank]));

function compareSegments(a: Segment, b: Segment): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'number') return -1;
  if (typeof b === 'number') return 1;
  const rankA = KEY_RANK.get(a) ?? KEY_ORDER.length;
  const rankB = KEY_RANK.get(b) ?? KEY_ORDER.length;
  if (rankA !== rankB) return rankA - rankB;
  return a < b ? -1 : a > b ? 1 : 0;
}

interface Collected {
  path: Path;
  error: ManifestError;
}

function compareCollected(a: Collected, b: Collected): number {
  const length = Math.min(a.path.length, b.path.length);
  for (let i = 0; i < length; i++) {
    const segmentA = a.path[i];
    const segmentB = b.path[i];
    // Both exist: `i` is below both lengths.
    if (segmentA === undefined || segmentB === undefined) break;
    const order = compareSegments(segmentA, segmentB);
    if (order !== 0) return order;
  }
  if (a.path.length !== b.path.length) return a.path.length - b.path.length;
  if (a.error.code !== b.error.code)
    return a.error.code < b.error.code ? -1 : 1;
  return a.error.message < b.error.message
    ? -1
    : a.error.message > b.error.message
      ? 1
      : 0;
}

// ── Reading the input safely ────────────────────────────────────────────────

/**
 * A plain table: `{}` or `Object.create(null)`, from any realm (a parser in a
 * worker, another vm context). Arrays, dates, maps and class instances are
 * not tables.
 */
function isTable(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  if (Object.prototype.toString.call(value) !== '[object Object]') {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === null || Object.getPrototypeOf(proto) === null;
}

/** Own keys only: `constructor`, `toString` and `__proto__` are data here. */
function hasOwn(table: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(table, key);
}

function own(table: Record<string, unknown>, key: string): unknown {
  return hasOwn(table, key) ? table[key] : undefined;
}

function has(table: unknown, key: string): boolean {
  return isTable(table) && hasOwn(table, key);
}

/** The input's value at a path, or undefined. Own properties only. */
function valueAt(root: unknown, path: Path): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
    } else {
      if (!isTable(current)) return undefined;
      current = own(current, segment);
    }
  }
  return current;
}

function tableAt(root: unknown, path: Path): Record<string, unknown> | null {
  const value = valueAt(root, path);
  return isTable(value) ? value : null;
}

function listAt(root: unknown, path: Path): unknown[] | null {
  const value = valueAt(root, path);
  return Array.isArray(value) ? value : null;
}

/** UTF-8 length of the manifest as JSON; null when it is not plain data. */
function jsonBytes(input: unknown): number | null {
  let json: string;
  try {
    json = JSON.stringify(input, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
  } catch {
    return null;
  }
  let bytes = 0;
  for (let i = 0; i < json.length; i++) {
    const unit = json.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

// ── The vocabulary ──────────────────────────────────────────────────────────

interface Lookup {
  vocabulary: ManifestVocabulary;
  scopeOrder: string[];
  availableScopes: string[];
  scopes: Map<string, ManifestVocabulary['scopes'][number]>;
  topicOrder: string[];
  topics: Map<string, ManifestVocabulary['topics'][number]>;
  schema: ReturnType<typeof buildManifestSchema>;
}

const LOOKUPS = new WeakMap<ManifestVocabulary, Lookup>();

function lookupFor(vocabulary: ManifestVocabulary): Lookup {
  const cached = LOOKUPS.get(vocabulary);
  if (cached) return cached;
  const lookup: Lookup = {
    vocabulary,
    scopeOrder: vocabulary.scopes.map((scope) => scope.name),
    availableScopes: vocabulary.scopes
      .filter((scope) => scope.available)
      .map((scope) => scope.name),
    scopes: new Map(vocabulary.scopes.map((scope) => [scope.name, scope])),
    topicOrder: vocabulary.topics.map((topic) => topic.name),
    topics: new Map(vocabulary.topics.map((topic) => [topic.name, topic])),
    schema: buildManifestSchema(vocabulary),
  };
  LOOKUPS.set(vocabulary, lookup);
  return lookup;
}

/** The scopes held: these plus every scope they imply, transitively. */
function closeScopes(lookup: Lookup, scopes: Iterable<string>): Set<string> {
  const held = new Set<string>();
  const pending = [...scopes];
  while (pending.length > 0) {
    const scope = pending.pop() as string;
    if (held.has(scope)) continue;
    const term = lookup.scopes.get(scope);
    if (!term) continue;
    held.add(scope);
    pending.push(...term.implies);
  }
  return held;
}

function inOrder(values: Iterable<string>, order: readonly string[]): string[] {
  const set = new Set(values);
  return order.filter((value) => set.has(value));
}

// ── One value ───────────────────────────────────────────────────────────────

/** `'covered'`: the problem is reported by a rule on another field. */
type LeafVerdict = Problem | null | 'covered';

const ENUMS: Record<string, readonly string[]> = {
  'hosting.mode': HOSTING_MODES,
  'data.definitions[].owner': DATA_OWNERS,
  'data.definitions[].type': DATA_TYPES,
  'data.definitions[].visibility': DATA_VISIBILITIES,
  'storefront.blocks[].target': BLOCK_TARGETS,
  'storefront.blocks[].settings[].type': SETTING_TYPES,
  'admin.actions[].target': ADMIN_ACTION_TARGETS,
  'offers.types[].class': OFFER_TYPE_CLASSES,
};

/** The `{ ar, en }` labels, by the shape of the table that holds them. */
const LABEL_CODES: Record<string, ManifestErrorCode> = {
  'data.definitions[].label': 'MANIFEST_DATA_LABEL_INVALID',
  'storefront.blocks[].name': 'MANIFEST_BLOCK_NAME_INVALID',
  'storefront.blocks[].settings[].label':
    'MANIFEST_BLOCK_SETTING_LABEL_INVALID',
  'storefront.blocks[].settings[].options[].label':
    'MANIFEST_BLOCK_SETTING_LABEL_INVALID',
  'admin.actions[].label': 'MANIFEST_ACTION_LABEL_INVALID',
  'offers.types[].label': 'MANIFEST_OFFER_TYPE_LABEL_INVALID',
};

/** The numeric fields of a setting, checked by {@link numberProblem}. */
const SETTING_NUMBERS = new Set([
  'storefront.blocks[].settings[].min',
  'storefront.blocks[].settings[].max',
  'storefront.blocks[].settings[].max_length',
]);

function enumProblem(
  value: string,
  path: string,
  allowed: readonly string[],
): Problem | null {
  if (allowed.includes(value)) return null;
  const match = closestMatch(value, allowed);
  const list = allowed.map((v) => `"${v}"`).join(', ');
  return {
    code: 'MANIFEST_VALUE_NOT_ALLOWED',
    message: `\`${path}\` is ${quote(value)}; it must be one of ${list}.`,
    fix: match
      ? `Set \`${path}\` to "${match}".`
      : `Set \`${path}\` to one of ${list}.`,
  };
}

function scopeProblem(
  lookup: Lookup,
  value: string,
  path: string,
): Problem | null {
  const term = lookup.scopes.get(value);
  if (!term) {
    const match = closestMatch(value, lookup.availableScopes);
    return {
      code: 'MANIFEST_SCOPE_UNKNOWN',
      message: `\`${path}\` is ${quote(value)}, which is not a Tassyir scope.`,
      fix: match
        ? `Replace it with "${match}".`
        : `Use one of: ${lookup.availableScopes.join(', ')}.`,
    };
  }
  if (!term.available) {
    return {
      code: 'MANIFEST_SCOPE_NOT_AVAILABLE',
      message: `\`${path}\` is "${value}", which apps cannot request yet.`,
      fix: term.unavailableReason
        ? `Remove "${value}" from the manifest; ${term.unavailableReason}.`
        : `Remove "${value}" from the manifest.`,
    };
  }
  return null;
}

function topicProblem(
  lookup: Lookup,
  value: string,
  path: string,
): Problem | null {
  if (lookup.topics.has(value)) return null;
  const match = closestMatch(value, lookup.topicOrder);
  return {
    code: 'MANIFEST_TOPIC_UNKNOWN',
    message: `\`${path}\` is ${quote(value)}, which is not a Tassyir webhook topic.`,
    fix: match
      ? `Replace it with "${match}".`
      : `Use one of: ${lookup.topicOrder.join(', ')}.`,
  };
}

function apiVersionProblem(
  lookup: Lookup,
  value: string,
  path: string,
): Problem | null {
  const versions = lookup.vocabulary.apiVersions;
  if (versions.includes(value)) return null;
  const latest = versions[versions.length - 1];
  return {
    code: 'MANIFEST_API_VERSION_UNSUPPORTED',
    message: `\`${path}\` is ${quote(value)}; supported versions: ${versions.join(', ')}.`,
    fix: `Set api_version = "${latest}".`,
  };
}

function webhookUriProblem(value: string, path: string): Problem | null {
  return /^[a-z][a-z0-9+.-]*:/i.test(value)
    ? httpsUrlProblem(value, path, {
        trailingSlash: true,
        example: 'https://example.com/webhooks',
      })
    : relativePathProblem(value, path, '/webhooks');
}

/**
 * An offer type's `path`: a path on the app's origin like a page's, at most
 * as long as the API's reader accepts (shorter than a page path).
 */
function offerTypePathProblem(value: string, path: string): Problem | null {
  if (value.length > L.offerTypePathMaxLength) {
    return {
      code: 'MANIFEST_PATH_INVALID',
      message: `\`${path}\` is ${value.length} characters long; the limit is ${L.offerTypePathMaxLength}.`,
      fix: `Shorten \`${path}\` to ${L.offerTypePathMaxLength} characters or fewer.`,
    };
  }
  return relativePathProblem(value, path, '/offers/mix-match');
}

/** The check for the value at `path`, chosen by the field it is. */
function leafProblem(lookup: Lookup, path: Path, value: string): LeafVerdict {
  const at = formatManifestPath(path);
  const shape = shapeOf(path);
  switch (shape) {
    case 'name':
      return nameProblem(value, at);
    case 'handle':
      return handleProblem(value, at, 'app');
    case 'api_version':
      return apiVersionProblem(lookup, value, at);
    case 'access.scopes[]':
    case 'access.optional_scopes[]':
      return scopeProblem(lookup, value, at);
    case 'hosting.url':
      return httpsUrlProblem(value, at, {
        trailingSlash: false,
        example: 'https://example.com',
      });
    case 'hosting.allowed_hosts[]':
      return allowedHostProblem(value, at);
    case 'auth.callback_url':
      return httpsUrlProblem(value, at, {
        trailingSlash: true,
        example: 'https://example.com/tassyir/callback',
      });
    case 'admin.page':
      return relativePathProblem(value, at, '/');
    case 'webhooks[].topics[]':
      return topicProblem(lookup, value, at);
    case 'webhooks[].uri':
      return webhookUriProblem(value, at);
    case 'data.definitions[].key':
      return dataKeyProblem(value, at);
    case 'storefront.blocks[].handle':
      return handleProblem(value, at, 'block');
    case 'storefront.blocks[].template':
      return templateProblem(value, at);
    case 'storefront.blocks[].stylesheet':
      return stylesheetProblem(value, at);
    case 'storefront.blocks[].data[]':
      return blockDataProblem(value, at);
    case 'storefront.blocks[].settings[].key':
      return settingKeyProblem(value, at);
    case 'storefront.blocks[].settings[].options[].value':
      return optionValueProblem(value, at);
    case 'admin.actions[].handle':
      return handleProblem(value, at, 'action');
    case 'admin.actions[].path':
      return relativePathProblem(value, at, '/actions/print');
    case 'offers.types[].handle':
      return offerTypeHandleProblem(value, at);
    case 'offers.types[].path':
      return offerTypePathProblem(value, at);
    case 'offers.types[].description.ar':
    case 'offers.types[].description.en':
      return offerTypeDescriptionProblem(value, at);
    case 'app_proxy.path':
      return relativePathProblem(value, at, '/proxy');
  }
  const allowed = ENUMS[shape];
  if (allowed) return enumProblem(value, at, allowed);
  const labelCode = /\.(?:ar|en)$/.test(shape)
    ? LABEL_CODES[shape.slice(0, -3)]
    : undefined;
  if (labelCode) return labelProblem(value, at, labelCode);
  if (shape.startsWith('access.scope_reasons.') && path.length === 3) {
    const scope = String(path[2]);
    return lookup.scopes.has(scope)
      ? scopeReasonProblem(value, at, scope)
      : null;
  }
  return null;
}

/** A setting's `min`, `max` or `max_length` that zod refused as a number. */
function numberProblem(path: Path, value: number | bigint): Problem | null {
  const at = formatManifestPath(path);
  const field = path[path.length - 1];
  const shown = typeof value === 'bigint' ? `${String(value)}n` : String(value);
  if (field === 'max_length') {
    return {
      code: 'MANIFEST_BLOCK_SETTING_RANGE_INVALID',
      message: `\`${at}\` is ${shown}; \`max_length\` is a whole number from 1 to ${L.settingTextMaxLength}.`,
      fix: `Set \`${at}\` to a whole number from 1 to ${L.settingTextMaxLength}.`,
    };
  }
  if (typeof value === 'bigint' || !Number.isFinite(value)) {
    return {
      code: 'MANIFEST_BLOCK_SETTING_RANGE_INVALID',
      message: `\`${at}\` is ${shown}, not a number a setting can hold.`,
      fix: `Set \`${at}\` to a finite number, or remove it.`,
    };
  }
  return null;
}

/**
 * A key of `access.scope_reasons` that is not an available scope. A reason
 * for a scope that is requested but unavailable is covered by that scope's
 * own error.
 */
function reasonKeyProblem(
  lookup: Lookup,
  root: unknown,
  key: string,
  path: string,
): Problem | 'covered' {
  if (lookup.scopes.has(key) && requestedScopes(root).has(key)) {
    return 'covered';
  }
  const match = lookup.scopes.has(key)
    ? null
    : closestMatch(key, lookup.availableScopes);
  return {
    code: 'MANIFEST_SCOPE_REASON_UNUSED',
    message: lookup.scopes.has(key)
      ? `\`${path}\` explains "${key}", which the manifest does not request.`
      : `\`${path}\` names ${quote(key)}, which is not a Tassyir scope.`,
    fix: match
      ? `Rename the key to "${match}" (and request "${match}"), or remove it.`
      : lookup.scopes.has(key)
        ? `Remove \`${path}\`, or add "${key}" to \`access.scopes\` or \`access.optional_scopes\`.`
        : `Remove \`${path}\`: reasons are keyed by the scopes the manifest requests.`,
  };
}

function requestedScopes(root: unknown): Set<string> {
  const names = new Set<string>();
  for (const list of ['scopes', 'optional_scopes']) {
    for (const value of listAt(root, ['access', list]) ?? []) {
      if (typeof value === 'string') names.add(value);
    }
  }
  return names;
}

// ── Pass 1: the schema ──────────────────────────────────────────────────────

const EXPECTED: Record<string, string> = {
  string: 'a string',
  array: 'an array',
  object: 'a table',
  number: 'a number',
  boolean: 'a boolean',
};

/** What to write when a field is missing or mistyped, in TOML. */
const EXAMPLES: Record<string, string> = {
  name: 'name = "Review Requests"',
  handle: 'handle = "review-requests"',
  access: '[access] table',
  'access.scopes': 'scopes = ["read_orders"]',
  'access.optional_scopes': 'optional_scopes = ["read_customer_contact"]',
  'access.scope_reasons':
    'scope_reasons = { read_orders = "Find delivered orders to ask for a review" }',
  hosting:
    '[hosting] table: mode = "tassyir" with allowed_hosts = [], or mode = "external" with url = "https://example.com"',
  'hosting.mode': 'mode = "tassyir" (or "external")',
  'hosting.url': 'url = "https://example.com"',
  'hosting.allowed_hosts': 'allowed_hosts = ["api.example.com"]',
  auth: '[auth] table',
  'auth.callback_url': 'callback_url = "https://example.com/tassyir/callback"',
  admin: '[admin] table',
  'admin.page': 'page = "/"',
  webhooks: '[[webhooks]] table',
  'webhooks[]': '[[webhooks]] table',
  'webhooks[].topics': 'topics = ["orders/created"]',
  'webhooks[].uri': 'uri = "/webhooks"',
  data: '[data] table',
  'data.definitions': '[[data.definitions]] table',
  'data.definitions[]': '[[data.definitions]] table',
  'data.definitions[].owner': 'owner = "product"',
  'data.definitions[].key': 'key = "rating"',
  'data.definitions[].type': 'type = "json"',
  'data.definitions[].visibility': 'visibility = "app"',
  storefront: '[storefront] table',
  'storefront.blocks': '[[storefront.blocks]] table',
  'storefront.blocks[]': '[[storefront.blocks]] table',
  'storefront.blocks[].handle': 'handle = "star-rating"',
  'storefront.blocks[].template': 'template = "blocks/star-rating.liquid"',
  'data.definitions[].label': 'label = { ar = "التقييم", en = "Rating" }',
  'storefront.blocks[].stylesheet': 'stylesheet = "blocks/star-rating.css"',
  'storefront.blocks[].name':
    'name = { ar = "تقييم المنتج", en = "Product rating" }',
  'storefront.blocks[].target': 'target = "product"',
  'storefront.blocks[].data': 'data = ["product.rating"]',
  'storefront.blocks[].settings': '[[storefront.blocks.settings]] table',
  'storefront.blocks[].settings[]': '[[storefront.blocks.settings]] table',
  'storefront.blocks[].settings[].key': 'key = "show_count"',
  'storefront.blocks[].settings[].type': 'type = "boolean"',
  'storefront.blocks[].settings[].label':
    'label = { ar = "عرض العدد", en = "Show the count" }',
  'storefront.blocks[].settings[].options':
    'options = [{ value = "grid", label = { ar = "شبكة", en = "Grid" } }, { value = "list", label = { ar = "قائمة", en = "List" } }]',
  'storefront.blocks[].settings[].options[]':
    '{ value = "grid", label = { ar = "شبكة", en = "Grid" } }',
  'storefront.blocks[].settings[].options[].value': 'value = "grid"',
  'storefront.blocks[].settings[].options[].label':
    'label = { ar = "شبكة", en = "Grid" }',
  'storefront.blocks[].settings[].min': 'min = 0',
  'storefront.blocks[].settings[].max': 'max = 5',
  'storefront.blocks[].settings[].max_length': 'max_length = 120',
  'admin.actions': '[[admin.actions]] table',
  'admin.actions[]': '[[admin.actions]] table',
  'admin.actions[].handle': 'handle = "print-labels"',
  'admin.actions[].target': 'target = "orders.selection"',
  'admin.actions[].label':
    'label = { ar = "طباعة الملصقات", en = "Print labels" }',
  'admin.actions[].path': 'path = "/actions/print"',
  offers: '[offers] table',
  'offers.types': '[[offers.types]] table',
  'offers.types[]': '[[offers.types]] table',
  'offers.types[].handle': 'handle = "mix-match"',
  'offers.types[].class': 'class = "product"',
  'offers.types[].path': 'path = "/offers/mix-match"',
  'offers.types[].label': 'label = { ar = "اخلط واختر", en = "Mix and match" }',
  'offers.types[].description':
    'description = { ar = "اختر قطعًا من تشكيلة", en = "Pick pieces from a range" }',
  app_proxy: '[app_proxy] table',
  'app_proxy.path': 'path = "/proxy"',
};

function exampleFor(lookup: Lookup, path: Path): string | undefined {
  const shape = shapeOf(path);
  if (shape === 'api_version') {
    const versions = lookup.vocabulary.apiVersions;
    return `api_version = "${versions[versions.length - 1]}"`;
  }
  if (shape.endsWith('.ar')) return 'ar = "<the Arabic text>"';
  if (shape.endsWith('.en')) return 'en = "<the English text>"';
  return EXAMPLES[shape];
}

/** A zod schema's `def`, or undefined for anything else. */
function defOf(schema: unknown): Record<string, unknown> | undefined {
  if (typeof schema !== 'object' || schema === null) return undefined;
  return (schema as { def?: Record<string, unknown> }).def;
}

/** Keys of the strict table the schema expects at `path`. */
function keysAt(schema: z.ZodType, path: Path): string[] {
  let current: unknown = schema;
  for (const segment of path) {
    current = unwrap(current);
    const def = defOf(current);
    if (!def) return [];
    if (typeof segment === 'number' && def['type'] === 'array') {
      current = def['element'];
    } else if (typeof segment === 'string' && def['type'] === 'object') {
      current = (def['shape'] as Record<string, unknown>)[segment];
    } else {
      return [];
    }
  }
  const def = defOf(unwrap(current));
  return def?.['type'] === 'object' ? Object.keys(def['shape'] as object) : [];
}

function unwrap(schema: unknown): unknown {
  let current = schema;
  let def = defOf(current);
  while (def?.['type'] === 'optional') {
    current = def['innerType'];
    def = defOf(current);
  }
  return current;
}

/** Keys that try to put code on the storefront (D9). */
const SCRIPT_KEY =
  /script|javascript|^js$|^js_|_js$|^on[a-z]+$|html|module|^src$|inline/i;

function unknownKeyError(
  lookup: Lookup,
  parent: Path,
  key: string,
): ManifestError {
  const at = formatManifestPath([...parent, key]);
  const table = tableOf(parent);
  if (shapeOf(parent) === 'storefront.blocks[]' && SCRIPT_KEY.test(key)) {
    return {
      code: 'MANIFEST_BLOCK_SCRIPT_NOT_ALLOWED',
      path: at,
      message: `\`${at}\` would add code to the storefront; storefront blocks are declarative templates only.`,
      fix: `Remove \`${key}\`; render the block from its .liquid template, without JavaScript.`,
    };
  }
  const accepted = keysAt(lookup.schema, parent);
  const match = closestMatch(key, accepted);
  return {
    code: 'MANIFEST_FIELD_UNKNOWN',
    path: at,
    message: `\`${at}\` is not a manifest field.`,
    fix: match
      ? `Rename \`${key}\` to \`${match}\`, or remove it.`
      : accepted.length > 0
        ? `Remove \`${key}\` from ${table}; it accepts: ${accepted.join(', ')}.`
        : `Remove \`${key}\` from ${table}.`,
  };
}

function issueErrors(
  lookup: Lookup,
  root: unknown,
  issue: z.core.$ZodIssue,
): Array<{ path: Path; error: ManifestError | null }> {
  const path = issue.path as Segment[];
  const at = formatManifestPath(path);
  const actual = valueAt(root, path);

  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((key) => ({
      path: [...path, key],
      error: unknownKeyError(lookup, path, key),
    }));
  }

  if (issue.code === 'invalid_key') {
    const key = String(path[path.length - 1]);
    const verdict = reasonKeyProblem(lookup, root, key, at);
    return [
      { path, error: verdict === 'covered' ? null : fromProblem(at, verdict) },
    ];
  }

  // A key the table does not have (zod reports a missing enum as a bad
  // value, a missing string as a bad type).
  const parent = path.slice(0, -1);
  const last = path[path.length - 1];
  if (
    typeof last === 'string' &&
    isTable(valueAt(root, parent)) &&
    !has(valueAt(root, parent), last)
  ) {
    const example = exampleFor(lookup, path);
    return [
      {
        path,
        error: {
          code: 'MANIFEST_FIELD_REQUIRED',
          path: at,
          message: `\`${at}\` is required.`,
          fix: example
            ? `Add ${example} to ${tableOf(parent)}.`
            : `Add \`${at}\`.`,
        },
      },
    ];
  }

  // A setting's number: zod says "invalid" or "too big", the check says why.
  if (
    (typeof actual === 'number' || typeof actual === 'bigint') &&
    SETTING_NUMBERS.has(shapeOf(path))
  ) {
    const found = numberProblem(path, actual);
    if (found) return [{ path, error: fromProblem(at, found) }];
  }

  if (issue.code === 'invalid_type') {
    const example = exampleFor(lookup, path);
    const expected = EXPECTED[issue.expected] ?? issue.expected;
    return [
      {
        path,
        error: {
          code: 'MANIFEST_FIELD_TYPE',
          path: at,
          message: `\`${at}\` is ${describeType(actual)}; it must be ${expected}.`,
          fix: example
            ? `Write \`${at}\` as ${expected}, e.g. ${example}.`
            : `Write \`${at}\` as ${expected}.`,
        },
      },
    ];
  }

  if (
    (issue.code === 'too_big' || issue.code === 'too_small') &&
    issue.origin === 'array'
  ) {
    const length = Array.isArray(actual) ? actual.length : 0;
    if (issue.code === 'too_small' && Number(issue.minimum) > 1) {
      return [
        {
          path,
          error: {
            code: 'MANIFEST_LIST_TOO_SHORT',
            path: at,
            message: `\`${at}\` has ${length} ${length === 1 ? 'entry' : 'entries'}; it needs at least ${String(issue.minimum)}.`,
            fix: `List at least ${String(issue.minimum)} entries in \`${at}\`.`,
          },
        },
      ];
    }
    if (issue.code === 'too_small') {
      return [
        {
          path,
          error: {
            code: 'MANIFEST_LIST_EMPTY',
            path: at,
            message: `\`${at}\` is empty.`,
            fix: `List at least ${String(issue.minimum)} value in \`${at}\`, or remove its table.`,
          },
        },
      ];
    }
    return [
      {
        path,
        error: {
          code: 'MANIFEST_LIST_TOO_LONG',
          path: at,
          message: `\`${at}\` has ${length} entries; the limit is ${String(issue.maximum)}.`,
          fix: `Keep at most ${String(issue.maximum)} entries in \`${at}\`.`,
        },
      },
    ];
  }

  // A value the field does not accept: the field's own check says why.
  if (typeof actual !== 'string') {
    return [
      {
        path,
        error: {
          code: 'MANIFEST_FIELD_TYPE',
          path: at,
          message: `\`${at}\` is ${describeType(actual)}; it must be a string.`,
          fix: `Write \`${at}\` as a quoted string.`,
        },
      },
    ];
  }
  const verdict = leafProblem(lookup, path, actual);
  if (verdict === 'covered') return [{ path, error: null }];
  return [
    {
      path,
      error: fromProblem(
        at,
        verdict ?? {
          code: 'MANIFEST_VALUE_NOT_ALLOWED',
          message: `\`${at}\` is ${quote(actual)}, which the manifest schema refuses.`,
          fix: `Change \`${at}\` to a value the published manifest JSON Schema accepts.`,
        },
      ),
    },
  ];
}

function fromProblem(path: string, problem: Problem): ManifestError {
  return {
    code: problem.code,
    path,
    message: problem.message,
    fix: problem.fix,
  };
}

// ── Pass 2 and 3: values and rules across fields ────────────────────────────

class Report {
  readonly collected: Collected[] = [];
  /** Paths the schema already refused: their values are not checked again. */
  readonly refused = new Set<string>();

  add(path: Path, error: ManifestError | null): void {
    if (!error) return;
    this.collected.push({ path, error });
  }

  problem(path: Path, problem: Problem | null): void {
    if (!problem) return;
    this.add(path, fromProblem(formatManifestPath(path), problem));
  }

  error(path: Path, code: ManifestErrorCode, message: string, fix: string) {
    this.add(path, { code, path: formatManifestPath(path), message, fix });
  }
}

/** Every string leaf the schema accepted gets its field's check. */
function checkValues(lookup: Lookup, root: unknown, report: Report): void {
  const visit = (value: unknown, path: Path) => {
    if (typeof value === 'string') {
      if (report.refused.has(formatManifestPath(path))) return;
      const verdict = leafProblem(lookup, path, value);
      if (verdict && verdict !== 'covered') report.problem(path, verdict);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        visit(item, [...path, index]);
      });
    } else if (isTable(value)) {
      // zod reads `__proto__` as a known key; every other unknown key is
      // already refused by the schema (the duplicate is dropped).
      const accepted = new Set(keysAt(lookup.schema, path));
      for (const key of Object.keys(value)) {
        if (accepted.size > 0 && !accepted.has(key)) {
          report.add([...path, key], unknownKeyError(lookup, path, key));
          continue;
        }
        visit(value[key], [...path, key]);
      }
    }
  };
  visit(root, []);
}

function checkScopes(lookup: Lookup, root: unknown, report: Report): void {
  const access = tableAt(root, ['access']);
  if (has(root, 'access') && !access) return;
  const required = access ? own(access, 'scopes') : undefined;
  const optional = access ? own(access, 'optional_scopes') : undefined;
  const reasons = access ? own(access, 'scope_reasons') : undefined;
  if (required !== undefined && !Array.isArray(required)) return;
  if (optional !== undefined && !Array.isArray(optional)) return;

  /** Valid, available names of a list, reporting duplicates. */
  const valid = (list: unknown[] | undefined, key: string): string[] => {
    const seen = new Set<string>();
    const names: string[] = [];
    (list ?? []).forEach((value, index) => {
      if (typeof value !== 'string') return;
      const term = lookup.scopes.get(value);
      if (!term || !term.available) return;
      if (seen.has(value)) {
        report.error(
          ['access', key, index],
          'MANIFEST_SCOPE_DUPLICATE',
          `\`access.${key}[${index}]\` repeats "${value}".`,
          `Remove the second "${value}" from \`access.${key}\`.`,
        );
        return;
      }
      seen.add(value);
      names.push(value);
    });
    return names;
  };
  const requiredNames = valid(required as unknown[] | undefined, 'scopes');
  const optionalNames = valid(
    optional as unknown[] | undefined,
    'optional_scopes',
  );
  const requiredSet = new Set(requiredNames);
  const heldIfRequired = closeScopes(lookup, requiredNames);

  const optionalList = (optional as unknown[] | undefined) ?? [];
  for (const name of optionalNames) {
    const index = optionalList.indexOf(name);
    const path = ['access', 'optional_scopes', index];
    if (requiredSet.has(name)) {
      report.error(
        path,
        'MANIFEST_SCOPE_REQUIRED_AND_OPTIONAL',
        `"${name}" is in both \`access.scopes\` and \`access.optional_scopes\`.`,
        `Keep "${name}" in one list: \`scopes\` if the app cannot work without it, \`optional_scopes\` otherwise.`,
      );
    } else if (heldIfRequired.has(name)) {
      const through = requiredNames.find((scope) =>
        closeScopes(lookup, [scope]).has(name),
      );
      report.error(
        path,
        'MANIFEST_SCOPE_ALREADY_IMPLIED',
        `"${name}" is optional, but "${String(through)}" in \`access.scopes\` already includes it.`,
        `Remove "${name}" from \`access.optional_scopes\`.`,
      );
    }
  }

  const everyName = [...new Set([...requiredNames, ...optionalNames])];
  const heldAtMost = closeScopes(lookup, everyName);
  for (const name of everyName) {
    const term = lookup.scopes.get(name);
    if (!term?.needsOneOf?.length) continue;
    const isRequired = requiredSet.has(name);
    const base = isRequired ? heldIfRequired : heldAtMost;
    if (term.needsOneOf.some((scope) => base.has(scope))) continue;
    const list = isRequired ? 'scopes' : 'optional_scopes';
    const index = ((isRequired ? required : optional) as unknown[]).indexOf(
      name,
    );
    const needed = term.needsOneOf.map((scope) => `"${scope}"`).join(' or ');
    report.error(
      ['access', list, index],
      'MANIFEST_SCOPE_NEEDS_ANOTHER',
      `"${name}" opens nothing without ${needed}.`,
      `Add ${needed} to \`access.${list}\`, or remove "${name}".`,
    );
  }

  if (reasons !== undefined && !isTable(reasons)) return;
  for (const name of inOrder(everyName, lookup.scopeOrder)) {
    if (reasons && has(reasons, name)) continue;
    report.error(
      ['access', 'scope_reasons', name],
      'MANIFEST_SCOPE_REASON_MISSING',
      `"${name}" is requested but \`access.scope_reasons\` does not explain it.`,
      `Add ${name} = "<one sentence on why the app needs it>" to \`access.scope_reasons\`.`,
    );
  }
  if (!reasons) return;
  // Unknown and unavailable keys are refused by the schema (invalid_key).
  for (const key of Object.keys(reasons)) {
    if (!lookup.scopes.get(key)?.available) continue;
    const verdict = reasonKeyProblem(
      lookup,
      root,
      key,
      formatManifestPath(['access', 'scope_reasons', key]),
    );
    if (verdict !== 'covered') {
      report.problem(['access', 'scope_reasons', key], verdict);
    }
  }
}

function hostingMode(root: unknown): 'tassyir' | 'external' | null {
  const mode = valueAt(root, ['hosting', 'mode']);
  return mode === 'tassyir' || mode === 'external' ? mode : null;
}

function checkHosting(root: unknown, report: Report): void {
  const hosting = tableAt(root, ['hosting']);
  const mode = hostingMode(root);
  if (!hosting || !mode) return;

  const notForMode = (
    path: Path,
    field: string,
    other: string,
    fix: string,
  ) => {
    report.error(
      path,
      'MANIFEST_FIELD_NOT_FOR_MODE',
      `\`${field}\` applies to hosting.mode = "${other}"; this app is "${mode}".`,
      fix,
    );
  };

  if (mode === 'external') {
    if (!has(hosting, 'url')) {
      report.error(
        ['hosting', 'url'],
        'MANIFEST_FIELD_REQUIRED',
        '`hosting.url` is required when hosting.mode = "external".',
        'Add url = "https://example.com" (your app\'s base URL) to [hosting].',
      );
    }
    if (has(hosting, 'allowed_hosts')) {
      notForMode(
        ['hosting', 'allowed_hosts'],
        'hosting.allowed_hosts',
        'tassyir',
        'Remove `allowed_hosts`: an external app calls other services from its own server.',
      );
    }
  } else {
    if (!has(hosting, 'allowed_hosts')) {
      report.error(
        ['hosting', 'allowed_hosts'],
        'MANIFEST_FIELD_REQUIRED',
        '`hosting.allowed_hosts` is required when hosting.mode = "tassyir".',
        'Add allowed_hosts = [] to [hosting], listing the hostnames the app calls (empty if none).',
      );
    }
    if (has(hosting, 'url')) {
      notForMode(
        ['hosting', 'url'],
        'hosting.url',
        'external',
        'Remove `url`: a hosted app is served from https://{handle}.tassyir-apps.com.',
      );
    }
    if (has(tableAt(root, ['auth']), 'callback_url')) {
      notForMode(
        ['auth', 'callback_url'],
        'auth.callback_url',
        'external',
        'Remove `auth.callback_url`: a hosted app receives its installation from the dispatcher, not an install code.',
      );
    }
    (listAt(root, ['webhooks']) ?? []).forEach((entry, index) => {
      const uri = isTable(entry) ? own(entry, 'uri') : undefined;
      if (typeof uri === 'string' && /^[a-z][a-z0-9+.-]*:/i.test(uri)) {
        notForMode(
          ['webhooks', index, 'uri'],
          `webhooks[${index}].uri`,
          'external',
          'Write `uri` as a path such as "/webhooks": a hosted app receives webhooks through the Tassyir dispatcher.',
        );
      }
    });
    checkHostedReservedPaths(root, report);
  }

  const hosts = own(hosting, 'allowed_hosts');
  if (Array.isArray(hosts)) {
    const seen = new Set<string>();
    hosts.forEach((host, index) => {
      if (typeof host !== 'string') return;
      if (seen.has(host)) {
        report.error(
          ['hosting', 'allowed_hosts', index],
          'MANIFEST_HOST_DUPLICATE',
          `\`hosting.allowed_hosts[${index}]\` repeats "${host}".`,
          `Remove the second "${host}" from \`hosting.allowed_hosts\`.`,
        );
      }
      seen.add(host);
    });
  }
}

/** Whether the dispatcher keeps `path` for itself on a hosted app's origin. */
function isHostedReservedPath(path: string): boolean {
  return (
    path === HOSTED_RESERVED_PATH_PREFIX.slice(0, -1) ||
    path.startsWith(HOSTED_RESERVED_PATH_PREFIX)
  );
}

/**
 * A hosted app's page, action, webhook and proxy paths outside
 * `/.tassyir/`, which the
 * dispatcher answers itself on every hosted origin: a page there never loads
 * and a delivery there is never made. Only for hosted apps: an external app's
 * origin is its own, Tassyir serves nothing there. A path that breaks the
 * path rules already has its MANIFEST_PATH_INVALID and is not judged here.
 */
function checkHostedReservedPaths(root: unknown, report: Report): void {
  const reserved = (path: Path, value: unknown, example: string) => {
    if (typeof value !== 'string' || !isHostedReservedPath(value)) return;
    const at = formatManifestPath(path);
    if (relativePathProblem(value, at, example)) return;
    report.error(
      path,
      'MANIFEST_PATH_RESERVED',
      `\`${at}\` is ${quote(value)}, under "${HOSTED_RESERVED_PATH_PREFIX}", which Tassyir keeps for itself on a hosted app's origin.`,
      `Move it to a path outside "${HOSTED_RESERVED_PATH_PREFIX}", e.g. "${example}".`,
    );
  };
  reserved(['admin', 'page'], valueAt(root, ['admin', 'page']), '/');
  (listAt(root, ['admin', 'actions']) ?? []).forEach((entry, index) => {
    if (!isTable(entry)) return;
    reserved(
      ['admin', 'actions', index, 'path'],
      own(entry, 'path'),
      '/actions/print',
    );
  });
  (listAt(root, ['offers', 'types']) ?? []).forEach((entry, index) => {
    if (!isTable(entry)) return;
    reserved(
      ['offers', 'types', index, 'path'],
      own(entry, 'path'),
      '/offers/mix-match',
    );
  });
  (listAt(root, ['webhooks']) ?? []).forEach((entry, index) => {
    if (!isTable(entry)) return;
    reserved(['webhooks', index, 'uri'], own(entry, 'uri'), '/webhooks');
  });
  reserved(
    ['app_proxy', 'path'],
    valueAt(root, ['app_proxy', 'path']),
    '/proxy',
  );
}

function checkTopics(lookup: Lookup, root: unknown, report: Report): void {
  const webhooks = listAt(root, ['webhooks']);
  if (!webhooks) return;
  const access = valueAt(root, ['access']);
  const listsReadable =
    (access === undefined || isTable(access)) &&
    ['scopes', 'optional_scopes'].every((key) => {
      const list = valueAt(root, ['access', key]);
      return list === undefined || Array.isArray(list);
    });
  const held = closeScopes(lookup, requestedScopes(root));
  const seen = new Map<string, string>();
  webhooks.forEach((entry, index) => {
    const topics = isTable(entry) ? own(entry, 'topics') : undefined;
    if (!Array.isArray(topics)) return;
    topics.forEach((topic, position) => {
      if (typeof topic !== 'string') return;
      const term = lookup.topics.get(topic);
      if (!term) return;
      const path = ['webhooks', index, 'topics', position];
      const first = seen.get(topic);
      if (first) {
        report.error(
          path,
          'MANIFEST_TOPIC_DUPLICATE',
          `"${topic}" is already subscribed at \`${first}\`.`,
          `Remove "${topic}" from \`${formatManifestPath(path.slice(0, 3))}\`; a topic goes to one uri.`,
        );
        return;
      }
      seen.set(topic, formatManifestPath(path));
      if (listsReadable && term.scope && !held.has(term.scope)) {
        report.error(
          path,
          'MANIFEST_TOPIC_SCOPE_MISSING',
          `"${topic}" carries data that needs the "${term.scope}" scope, which the manifest does not request.`,
          `Add "${term.scope}" to \`access.scopes\` (or \`access.optional_scopes\`), or remove "${topic}".`,
        );
      }
    });
  });
}

function checkData(root: unknown, report: Report): void {
  const seen = new Map<string, number>();
  (listAt(root, ['data', 'definitions']) ?? []).forEach((entry, index) => {
    if (!isTable(entry)) return;
    const owner = own(entry, 'owner');
    const key = own(entry, 'key');
    if (typeof owner !== 'string' || typeof key !== 'string') return;
    const id = `${owner}\u0000${key}`;
    const first = seen.get(id);
    if (first !== undefined) {
      report.error(
        ['data', 'definitions', index, 'key'],
        'MANIFEST_DATA_KEY_DUPLICATE',
        `"${key}" is already defined for owner "${owner}" at \`data.definitions[${first}]\`.`,
        `Remove \`data.definitions[${index}]\`, or give it another key.`,
      );
      return;
    }
    seen.set(id, index);
  });
}

function checkBlocks(lookup: Lookup, root: unknown, report: Report): void {
  const blocks = listAt(root, ['storefront', 'blocks']);
  if (!blocks || blocks.length === 0) return;
  const scope = lookup.vocabulary.storefrontBlocksScope;
  const term = lookup.scopes.get(scope);
  if (!term || !term.available) {
    report.error(
      ['storefront', 'blocks'],
      'MANIFEST_BLOCKS_NOT_AVAILABLE',
      'Storefront blocks cannot be published yet.',
      term?.unavailableReason
        ? `Remove the [[storefront.blocks]] tables; ${term.unavailableReason}.`
        : 'Remove the [[storefront.blocks]] tables.',
    );
  } else if (!closeScopes(lookup, requestedScopes(root)).has(scope)) {
    report.error(
      ['storefront', 'blocks'],
      'MANIFEST_BLOCKS_SCOPE_MISSING',
      `Storefront blocks need the "${scope}" scope, which the manifest does not request.`,
      `Add "${scope}" to \`access.scopes\`, or remove the [[storefront.blocks]] tables.`,
    );
  }
  const seen = new Map<string, number>();
  blocks.forEach((block, index) => {
    const handle = isTable(block) ? own(block, 'handle') : undefined;
    if (typeof handle !== 'string') return;
    const first = seen.get(handle);
    if (first !== undefined) {
      report.error(
        ['storefront', 'blocks', index, 'handle'],
        'MANIFEST_BLOCK_HANDLE_DUPLICATE',
        `"${handle}" is already the handle of \`storefront.blocks[${first}]\`.`,
        `Give \`storefront.blocks[${index}]\` another handle.`,
      );
      return;
    }
    seen.set(handle, index);
  });

  const definitions = storefrontDefinitions(root);
  blocks.forEach((block, index) => {
    if (!isTable(block)) return;
    checkBlockData(block, index, definitions, report);
    checkSettings(
      own(block, 'settings'),
      ['storefront', 'blocks', index, 'settings'],
      report,
    );
  });
}

/** A declared key whose visibility is not a known value: judged there. */
const UNKNOWN_VISIBILITY = '';

/**
 * Every declared app data key (`owner\0key` → visibility), or null when the
 * definitions cannot be read (their own error says why).
 */
function storefrontDefinitions(root: unknown): Map<string, string> | null {
  const data = valueAt(root, ['data']);
  if (data === undefined) return new Map();
  if (!isTable(data)) {
    // A date or a Map passes the schema as an empty table (the known gap,
    // docs/APP_MANIFEST.md): it declares nothing, as its normalised form.
    return typeof data === 'object' && data !== null && !Array.isArray(data)
      ? new Map()
      : null;
  }
  const list = own(data, 'definitions');
  if (list === undefined) return new Map();
  if (!Array.isArray(list)) return null;
  const found = new Map<string, string>();
  for (const entry of list) {
    if (!isTable(entry)) continue;
    const owner = own(entry, 'owner');
    const key = own(entry, 'key');
    const visibility = own(entry, 'visibility');
    if (typeof owner !== 'string' || typeof key !== 'string') continue;
    const id = `${owner}\u0000${key}`;
    if (found.has(id)) continue;
    found.set(
      id,
      typeof visibility === 'string' &&
        (DATA_VISIBILITIES as readonly string[]).includes(visibility)
        ? visibility
        : UNKNOWN_VISIBILITY,
    );
  }
  return found;
}

/**
 * A block's `data`: each `<owner>.<key>` once, declared in
 * `[[data.definitions]]` with storefront visibility, and product data only on
 * a block placed on the product page.
 */
function checkBlockData(
  block: Record<string, unknown>,
  index: number,
  definitions: Map<string, string> | null,
  report: Report,
): void {
  const data = own(block, 'data');
  if (!Array.isArray(data)) return;
  const target = own(block, 'target');
  const placed =
    target === undefined
      ? 'any'
      : typeof target === 'string' &&
          (BLOCK_TARGETS as readonly string[]).includes(target)
        ? target
        : null;
  const seen = new Map<string, number>();
  data.forEach((ref, position) => {
    if (typeof ref !== 'string' || !BLOCK_DATA_PATTERN.test(ref)) return;
    const path = ['storefront', 'blocks', index, 'data', position];
    const at = formatManifestPath(path);
    const first = seen.get(ref);
    if (first !== undefined) {
      report.error(
        path,
        'MANIFEST_BLOCK_DATA_DUPLICATE',
        `"${ref}" is already listed at \`storefront.blocks[${index}].data[${first}]\`.`,
        `Remove the second "${ref}" from \`storefront.blocks[${index}].data\`.`,
      );
      return;
    }
    seen.set(ref, position);
    const dot = ref.indexOf('.');
    const owner = ref.slice(0, dot);
    const key = ref.slice(dot + 1);
    const visibility = definitions?.get(`${owner}\u0000${key}`);
    if (definitions && visibility === undefined) {
      report.error(
        path,
        'MANIFEST_BLOCK_DATA_NOT_DECLARED',
        `\`${at}\` reads "${ref}", which no [[data.definitions]] entry declares.`,
        `Declare it: add a [[data.definitions]] entry with owner = "${owner}", key = "${key}" and visibility = "storefront", or remove "${ref}".`,
      );
      return;
    }
    if (
      visibility !== undefined &&
      visibility !== UNKNOWN_VISIBILITY &&
      visibility !== 'storefront'
    ) {
      report.error(
        path,
        'MANIFEST_BLOCK_DATA_NOT_STOREFRONT',
        `\`${at}\` reads "${ref}", declared with visibility "${visibility}": only storefront values reach a store page.`,
        `Set visibility = "storefront" on the "${ref}" definition, or remove "${ref}" from the block.`,
      );
      return;
    }
    if (owner === 'product' && placed !== null && placed !== 'product') {
      report.error(
        path,
        'MANIFEST_BLOCK_DATA_TARGET_MISMATCH',
        `\`${at}\` reads product data, but the block's target is "${placed}": only the product page has a product.`,
        `Set target = "product" on \`storefront.blocks[${index}]\`, or read business or store data instead.`,
      );
    }
  });
}

const NUMERIC_SETTINGS = new Set(['integer', 'number']);
const TEXT_SETTINGS = new Set(['string', 'text']);

/** Which optional fields a setting type takes. */
const FIELD_TYPES: Record<string, (type: string) => boolean> = {
  options: (type) => type === 'select',
  min: (type) => NUMERIC_SETTINGS.has(type),
  max: (type) => NUMERIC_SETTINGS.has(type),
  max_length: (type) => TEXT_SETTINGS.has(type),
};

const FIELD_TYPE_NAMES: Record<string, string> = {
  options: 'select',
  min: 'integer and number',
  max: 'integer and number',
  max_length: 'string and text',
};

/**
 * Merchant settings across their fields: keys once, each field on the types
 * that take it, a select's options, a range, the default of the type. Shared
 * by every kind of extension that takes settings.
 */
function checkSettings(list: unknown, base: Path, report: Report): void {
  if (!Array.isArray(list)) return;
  const keys = new Map<string, number>();
  list.forEach((setting, index) => {
    if (!isTable(setting)) return;
    const at = [...base, index];
    const key = own(setting, 'key');
    if (typeof key === 'string' && SETTING_KEY_PATTERN.test(key)) {
      const first = keys.get(key);
      if (first !== undefined) {
        report.error(
          [...at, 'key'],
          'MANIFEST_BLOCK_SETTING_KEY_DUPLICATE',
          `"${key}" is already the key of \`${formatManifestPath([...base, first])}\`.`,
          `Give \`${formatManifestPath(at)}\` another key.`,
        );
      } else {
        keys.set(key, index);
      }
    }
    const type = own(setting, 'type');
    if (
      typeof type !== 'string' ||
      !(SETTING_TYPES as readonly string[]).includes(type)
    ) {
      return;
    }

    let fieldsFit = true;
    for (const field of Object.keys(FIELD_TYPES)) {
      if (!hasOwn(setting, field) || FIELD_TYPES[field]?.(type)) continue;
      fieldsFit = false;
      report.error(
        [...at, field],
        'MANIFEST_BLOCK_SETTING_FIELD_NOT_FOR_TYPE',
        `\`${formatManifestPath([...at, field])}\` applies to ${FIELD_TYPE_NAMES[field] ?? ''} settings; this one is "${type}".`,
        `Remove \`${field}\` from \`${formatManifestPath(at)}\`, or change its type.`,
      );
    }

    const values: string[] = [];
    if (type === 'select') {
      const options = own(setting, 'options');
      if (options === undefined) {
        report.error(
          [...at, 'options'],
          'MANIFEST_FIELD_REQUIRED',
          `\`${formatManifestPath([...at, 'options'])}\` is required for a select setting.`,
          `Add ${String(EXAMPLES['storefront.blocks[].settings[].options'])} to \`${formatManifestPath(at)}\`.`,
        );
      }
      const seen = new Map<string, number>();
      (Array.isArray(options) ? options : []).forEach((option, position) => {
        const value = isTable(option) ? own(option, 'value') : undefined;
        if (
          typeof value !== 'string' ||
          !SETTING_OPTION_VALUE_PATTERN.test(value)
        ) {
          return;
        }
        const first = seen.get(value);
        if (first !== undefined) {
          report.error(
            [...at, 'options', position, 'value'],
            'MANIFEST_BLOCK_SETTING_OPTION_DUPLICATE',
            `"${value}" is already the value of \`${formatManifestPath([...at, 'options', first])}\`.`,
            `Give \`${formatManifestPath([...at, 'options', position])}\` another value.`,
          );
          return;
        }
        seen.set(value, position);
        values.push(value);
      });
    }

    let min: number | undefined;
    let max: number | undefined;
    if (NUMERIC_SETTINGS.has(type)) {
      const whole = type === 'integer';
      for (const field of ['min', 'max'] as const) {
        const value = own(setting, field);
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        if (whole && !Number.isSafeInteger(value)) {
          report.error(
            [...at, field],
            'MANIFEST_BLOCK_SETTING_RANGE_INVALID',
            `\`${formatManifestPath([...at, field])}\` is ${String(value)}; an integer setting's ${field} is a whole number.`,
            `Set \`${formatManifestPath([...at, field])}\` to a whole number.`,
          );
          continue;
        }
        if (field === 'min') min = value;
        else max = value;
      }
      if (min !== undefined && max !== undefined && min > max) {
        report.error(
          [...at, 'max'],
          'MANIFEST_BLOCK_SETTING_RANGE_INVALID',
          `\`${formatManifestPath([...at, 'max'])}\` is ${String(max)}, below \`min\` (${String(min)}).`,
          `Set \`max\` to a number at least ${String(min)}, or lower \`min\`.`,
        );
        min = max = undefined;
      }
    }

    // A default is judged once the setting's own fields are sound: against
    // a wrong type, or a select without valid options, it would be noise.
    if (!hasOwn(setting, 'default') || !fieldsFit) return;
    if (type === 'select' && values.length === 0) return;
    const maxLength = own(setting, 'max_length');
    const where = [...at, 'default'];
    const found = settingDefaultProblem(
      own(setting, 'default'),
      formatManifestPath(where),
      {
        type,
        options: values,
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
        ...(typeof maxLength === 'number' &&
        Number.isSafeInteger(maxLength) &&
        maxLength >= 1 &&
        maxLength <= L.settingTextMaxLength
          ? { maxLength }
          : {}),
      },
    );
    if (found) {
      report.problem(
        found.language ? [...where, found.language] : where,
        found.problem,
      );
    }
  });
}

/** `[app_proxy]`: open on the platform, and the storefront scope requested. */
function checkProxy(lookup: Lookup, root: unknown, report: Report): void {
  if (!isTable(valueAt(root, ['app_proxy']))) return;
  const scope = lookup.vocabulary.storefrontBlocksScope;
  const term = lookup.scopes.get(scope);
  // A vocabulary from before the proxy (a JavaScript caller) keeps it closed.
  const gate = lookup.vocabulary.appProxy as
    ManifestVocabulary['appProxy'] | undefined;
  if (gate?.available !== true || !term?.available) {
    const reason = gate?.available
      ? term?.unavailableReason
      : gate?.unavailableReason;
    report.error(
      ['app_proxy'],
      'MANIFEST_PROXY_NOT_AVAILABLE',
      'The app proxy cannot be declared yet.',
      reason
        ? `Remove the [app_proxy] table; ${reason}.`
        : 'Remove the [app_proxy] table.',
    );
  } else if (!closeScopes(lookup, requestedScopes(root)).has(scope)) {
    report.error(
      ['app_proxy'],
      'MANIFEST_PROXY_SCOPE_MISSING',
      `The app proxy needs the "${scope}" scope, which the manifest does not request.`,
      `Add "${scope}" to \`access.scopes\`, or remove the [app_proxy] table.`,
    );
  }
}

/** `[[admin.actions]]`: handles once, and the read scope of each target. */
function checkActions(lookup: Lookup, root: unknown, report: Report): void {
  const actions = listAt(root, ['admin', 'actions']);
  if (!actions) return;
  const access = valueAt(root, ['access']);
  const listsReadable =
    (access === undefined || isTable(access)) &&
    ['scopes', 'optional_scopes'].every((key) => {
      const list = valueAt(root, ['access', key]);
      return list === undefined || Array.isArray(list);
    });
  const held = closeScopes(lookup, requestedScopes(root));
  const seen = new Map<string, number>();
  actions.forEach((action, index) => {
    if (!isTable(action)) return;
    const handle = own(action, 'handle');
    if (typeof handle === 'string') {
      const first = seen.get(handle);
      if (first !== undefined) {
        report.error(
          ['admin', 'actions', index, 'handle'],
          'MANIFEST_ACTION_HANDLE_DUPLICATE',
          `"${handle}" is already the handle of \`admin.actions[${first}]\`.`,
          `Give \`admin.actions[${index}]\` another handle.`,
        );
      } else {
        seen.set(handle, index);
      }
    }
    const target = own(action, 'target');
    if (
      !listsReadable ||
      typeof target !== 'string' ||
      !hasOwn(ADMIN_ACTION_TARGET_SCOPES, target)
    ) {
      return;
    }
    const scope =
      ADMIN_ACTION_TARGET_SCOPES[
        target as keyof typeof ADMIN_ACTION_TARGET_SCOPES
      ];
    if (held.has(scope)) return;
    report.error(
      ['admin', 'actions', index, 'target'],
      'MANIFEST_ACTION_SCOPE_MISSING',
      `An action on "${target}" needs the "${scope}" scope, which the manifest does not request.`,
      `Add "${scope}" to \`access.scopes\` (or \`access.optional_scopes\`), or remove \`admin.actions[${index}]\`.`,
    );
  });
}

/**
 * `[[offers.types]]`: the scope that makes them usable, and each handle once.
 * The scope is `write_offers` (it implies `read_offers`): the API lists a type
 * "from your apps" only for an installation that holds it.
 */
function checkOfferTypes(lookup: Lookup, root: unknown, report: Report): void {
  const types = listAt(root, ['offers', 'types']);
  if (!types || types.length === 0) return;
  const term = lookup.scopes.get(OFFER_TYPES_SCOPE);
  if (!term || !term.available) {
    report.error(
      ['offers', 'types'],
      'MANIFEST_OFFER_TYPES_NOT_AVAILABLE',
      'Offer types cannot be declared yet.',
      term?.unavailableReason
        ? `Remove the [[offers.types]] tables; ${term.unavailableReason}.`
        : 'Remove the [[offers.types]] tables.',
    );
  } else if (
    !closeScopes(lookup, requestedScopes(root)).has(OFFER_TYPES_SCOPE)
  ) {
    report.error(
      ['offers', 'types'],
      'MANIFEST_OFFER_TYPES_SCOPE_MISSING',
      `Offer types need the "${OFFER_TYPES_SCOPE}" scope, which the manifest does not request.`,
      `Add "${OFFER_TYPES_SCOPE}" to \`access.scopes\` (or \`access.optional_scopes\`), or remove the [[offers.types]] tables.`,
    );
  }
  const seen = new Map<string, number>();
  types.forEach((entry, index) => {
    const handle = isTable(entry) ? own(entry, 'handle') : undefined;
    if (typeof handle !== 'string') return;
    const first = seen.get(handle);
    if (first !== undefined) {
      report.error(
        ['offers', 'types', index, 'handle'],
        'MANIFEST_OFFER_TYPE_HANDLE_DUPLICATE',
        `"${handle}" is already the handle of \`offers.types[${first}]\`.`,
        `Give \`offers.types[${index}]\` another handle.`,
      );
      return;
    }
    seen.set(handle, index);
  });
}

// ── Normalisation ───────────────────────────────────────────────────────────

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function tables(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isTable) : [];
}

/** A `{ ar, en }` label, as a new table in that key order. */
function labelOf(value: unknown): ManifestLabel {
  const table = isTable(value) ? value : {};
  return { ar: own(table, 'ar') as string, en: own(table, 'en') as string };
}

function normaliseSetting(entry: Record<string, unknown>): ManifestSetting {
  const setting: ManifestSetting = {
    key: entry['key'] as string,
    type: entry['type'] as ManifestSetting['type'],
    label: labelOf(entry['label']),
  };
  if (hasOwn(entry, 'default')) {
    const value = entry['default'];
    setting.default = isTable(value)
      ? labelOf(value)
      : (value as Exclude<ManifestSetting['default'], ManifestLabel>);
  }
  if (Array.isArray(entry['options'])) {
    setting.options = tables(entry['options']).map((option) => ({
      value: option['value'] as string,
      label: labelOf(option['label']),
    }));
  }
  for (const field of ['min', 'max', 'max_length'] as const) {
    const value = entry[field];
    if (typeof value === 'number') setting[field] = value;
  }
  return setting;
}

function normaliseBlock(
  entry: Record<string, unknown>,
): ManifestStorefrontBlock {
  const block: Partial<ManifestStorefrontBlock> = {
    handle: entry['handle'] as string,
    template: entry['template'] as string,
  };
  if (typeof entry['stylesheet'] === 'string') {
    block.stylesheet = entry['stylesheet'];
  }
  if (isTable(entry['name'])) block.name = labelOf(entry['name']);
  block.target = entry['target'] === 'product' ? 'product' : ('any' as const);
  block.data = [...strings(entry['data'])].sort();
  block.settings = tables(entry['settings']).map(normaliseSetting);
  return block as ManifestStorefrontBlock;
}

function normaliseAction(entry: Record<string, unknown>): ManifestAdminAction {
  return {
    handle: entry['handle'] as string,
    target: entry['target'] as ManifestAdminAction['target'],
    label: labelOf(entry['label']),
    path: entry['path'] as string,
  };
}

function normaliseOfferType(entry: Record<string, unknown>): ManifestOfferType {
  const type: ManifestOfferType = {
    handle: entry['handle'] as string,
    class: entry['class'] as ManifestOfferType['class'],
    path: entry['path'] as string,
    label: labelOf(entry['label']),
  };
  if (isTable(entry['description'])) {
    type.description = labelOf(entry['description']);
  }
  return type;
}

/** The stored form of a manifest that passed every check. */
function normalise(lookup: Lookup, root: Record<string, unknown>): AppManifest {
  const access = tableAt(root, ['access']) ?? {};
  const scopes = inOrder(strings(own(access, 'scopes')), lookup.scopeOrder);
  const optionalScopes = inOrder(
    strings(own(access, 'optional_scopes')),
    lookup.scopeOrder,
  );
  const reasonsIn = tableAt(root, ['access', 'scope_reasons']) ?? {};
  const scopeReasons: Record<string, string> = {};
  for (const scope of inOrder(
    [...scopes, ...optionalScopes],
    lookup.scopeOrder,
  )) {
    scopeReasons[scope] = own(reasonsIn, scope) as string;
  }

  const hosting = tableAt(root, ['hosting']) ?? {};
  const callbackUrl = valueAt(root, ['auth', 'callback_url']);
  const page = valueAt(root, ['admin', 'page']);

  const manifest: AppManifest = {
    name: root['name'] as string,
    handle: root['handle'] as string,
    api_version: root['api_version'] as string,
    access: {
      scopes,
      optional_scopes: optionalScopes,
      scope_reasons: scopeReasons,
    },
    hosting:
      own(hosting, 'mode') === 'external'
        ? { mode: 'external', url: own(hosting, 'url') as string }
        : {
            mode: 'tassyir',
            allowed_hosts: [...strings(own(hosting, 'allowed_hosts'))].sort(),
          },
    webhooks: [],
    data: { definitions: [] },
    storefront: { blocks: [] },
  };
  if (typeof callbackUrl === 'string') {
    manifest.auth = { callback_url: callbackUrl };
  }
  const actions = tables(valueAt(root, ['admin', 'actions'])).map(
    normaliseAction,
  );
  if (typeof page === 'string' || actions.length > 0) {
    manifest.admin = {};
    if (typeof page === 'string') manifest.admin.page = page;
    if (actions.length > 0) manifest.admin.actions = actions;
  }
  manifest.webhooks = tables(root['webhooks']).map((entry) => ({
    topics: inOrder(strings(entry['topics']), lookup.topicOrder),
    uri: entry['uri'] as string,
  }));
  manifest.data.definitions = tables(
    valueAt(root, ['data', 'definitions']),
  ).map((entry) => {
    const definition: ManifestDataDefinition = {
      owner: entry['owner'] as ManifestDataDefinition['owner'],
      key: entry['key'] as string,
      type: entry['type'] as ManifestDataDefinition['type'],
      visibility: entry['visibility'] as ManifestDataDefinition['visibility'],
    };
    if (isTable(entry['label'])) definition.label = labelOf(entry['label']);
    return definition;
  });
  manifest.storefront.blocks = tables(
    valueAt(root, ['storefront', 'blocks']),
  ).map(normaliseBlock);
  const offerTypes = tables(valueAt(root, ['offers', 'types'])).map(
    normaliseOfferType,
  );
  if (offerTypes.length > 0) manifest.offers = { types: offerTypes };
  const proxyPath = valueAt(root, ['app_proxy', 'path']);
  if (typeof proxyPath === 'string') {
    manifest.app_proxy = { path: proxyPath };
  }
  // Key order is part of the stored form: rebuild in manifest order.
  const ordered: Record<string, unknown> = {};
  for (const key of [
    'name',
    'handle',
    'api_version',
    'access',
    'hosting',
    'auth',
    'admin',
    'webhooks',
    'data',
    'storefront',
    'offers',
    'app_proxy',
  ]) {
    if (key in manifest) ordered[key] = manifest[key as keyof AppManifest];
  }
  return ordered as unknown as AppManifest;
}

// ── Entry point ─────────────────────────────────────────────────────────────

const failure = (
  code: ManifestErrorCode,
  message: string,
  fix: string,
): ManifestValidationResult => ({
  ok: false,
  errors: [{ code, path: '', message, fix }],
});

/**
 * Validate a parsed manifest against a vocabulary: by default the one this
 * package ships (`MANIFEST_VOCABULARY`); the API passes the one it builds
 * from its live catalogues. Never throws on any input.
 */
export function validateManifest(
  input: unknown,
  vocabulary: ManifestVocabulary = MANIFEST_VOCABULARY,
): ManifestValidationResult {
  if (!isTable(input)) {
    return failure(
      'MANIFEST_NOT_A_TABLE',
      `The manifest is ${describeType(input)}; it must be a table of fields.`,
      `Send the parsed ${MANIFEST_FILE_NAME} as one object, starting with name, handle and api_version.`,
    );
  }
  const bytes = jsonBytes(input);
  if (bytes === null) {
    return failure(
      'MANIFEST_NOT_DATA',
      'The manifest holds a value that is not plain data (a cycle or a value JSON cannot carry).',
      `Send the manifest exactly as parsed from ${MANIFEST_FILE_NAME}, with strings, arrays and tables only.`,
    );
  }
  if (bytes > L.maxBytes) {
    return failure(
      'MANIFEST_TOO_LARGE',
      `The manifest is ${bytes} bytes as JSON; the limit is ${L.maxBytes}.`,
      'Shorten the manifest: fewer webhook, data or block entries, or shorter texts.',
    );
  }

  const lookup = lookupFor(vocabulary);
  const report = new Report();
  const parsed = lookup.schema.safeParse(input, { reportInput: false });
  if (!parsed.success) {
    // zod keeps checking a value after its type failed (an array's `max` on
    // a string): one error per value is enough.
    const mistyped = new Set(
      parsed.error.issues
        .filter((issue) => issue.code === 'invalid_type')
        .map((issue) => formatManifestPath(issue.path as Segment[])),
    );
    for (const issue of parsed.error.issues) {
      const at = formatManifestPath(issue.path as Segment[]);
      if (issue.code !== 'invalid_type' && mistyped.has(at)) continue;
      for (const { path, error } of issueErrors(lookup, input, issue)) {
        report.refused.add(formatManifestPath(path));
        report.add(path, error);
      }
    }
  }
  checkValues(lookup, input, report);
  checkScopes(lookup, input, report);
  checkHosting(input, report);
  checkTopics(lookup, input, report);
  checkData(input, report);
  checkBlocks(lookup, input, report);
  checkProxy(lookup, input, report);
  checkActions(lookup, input, report);
  checkOfferTypes(lookup, input, report);

  if (report.collected.length === 0) {
    return { ok: true, manifest: normalise(lookup, input) };
  }

  // A field the hosting mode does not use gets one error: remove it. Its
  // format is not worth fixing.
  const notForMode = report.collected
    .filter((item) => item.error.code === 'MANIFEST_FIELD_NOT_FOR_MODE')
    .map((item) => item.error.path);
  const kept = report.collected.filter(
    (item) =>
      item.error.code === 'MANIFEST_FIELD_NOT_FOR_MODE' ||
      !notForMode.some(
        (path) =>
          item.error.path === path ||
          item.error.path.startsWith(`${path}.`) ||
          item.error.path.startsWith(`${path}[`),
      ),
  );

  const unique = new Map<string, Collected>();
  for (const item of kept.sort(compareCollected)) {
    const key = `${item.error.path}\u0000${item.error.code}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  const errors = [...unique.values()].map((item) => item.error);
  if (errors.length <= L.maxErrors) return { ok: false, errors };
  const hidden = errors.length - L.maxErrors;
  return {
    ok: false,
    errors: [
      ...errors.slice(0, L.maxErrors),
      {
        code: 'MANIFEST_TOO_MANY_ERRORS',
        path: '',
        message: `${hidden} more error${hidden === 1 ? ' was' : 's were'} not listed.`,
        fix: 'Fix the errors listed, then validate again to see the rest.',
      },
    ],
  };
}

/**
 * One field checked on its own, with the manifest's own rule, code and `fix`:
 * the registry checks an app's handle and names when the app is created,
 * before any manifest exists (AP-B1.1), and a console or CLI can check a
 * handle as it is typed. `path` names the field in the caller's own input
 * (`nameEn` for the registry's English name). Uniqueness is not checked here.
 */
export function validateManifestField(
  field: 'handle' | 'name',
  value: unknown,
  path: string = field,
): ManifestError | null {
  if (typeof value !== 'string') {
    return {
      code: 'MANIFEST_FIELD_TYPE',
      path,
      message: `\`${path}\` is ${describeType(value)}; it must be a string.`,
      fix: `Set \`${path}\` to a string.`,
    };
  }
  const found =
    field === 'handle'
      ? handleProblem(value, path, 'app')
      : nameProblem(value, path);
  return found ? { ...found, path } : null;
}
