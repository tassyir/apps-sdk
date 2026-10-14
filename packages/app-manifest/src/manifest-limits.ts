/**
 * The manifest v1 limits and fixed vocabularies (tassyir/backend
 * docs/APPS_PLATFORM_PLAN.md §3.2 lists the same numbers; change both
 * together, the plan first).
 */

export const MANIFEST_FILE_NAME = 'tassyir.app.toml';

/** Hosted apps are served from `https://{handle}.tassyir-apps.com` (D2). */
export const HOSTED_APPS_DOMAIN = 'tassyir-apps.com';

export const MANIFEST_LIMITS = {
  /** The parsed manifest, serialised as JSON. */
  maxBytes: 64 * 1024,
  /** At most this many errors are returned, then MANIFEST_TOO_MANY_ERRORS. */
  maxErrors: 50,
  nameMaxLength: 50,
  handleMinLength: 3,
  handleMaxLength: 40,
  scopeReasonMinLength: 10,
  scopeReasonMaxLength: 200,
  urlMaxLength: 512,
  pathMaxLength: 256,
  allowedHostsMax: 20,
  hostMaxLength: 253,
  webhooksMax: 10,
  dataDefinitionsMax: 50,
  dataKeyMaxLength: 64,
  storefrontBlocksMax: 20,
  templateMaxLength: 200,
} as const;

export const HOSTING_MODES = ['tassyir', 'external'] as const;
export const DATA_OWNERS = [
  'business',
  'store',
  'product',
  'order',
  'customer',
] as const;
export const DATA_TYPES = [
  'string',
  'number',
  'integer',
  'boolean',
  'json',
] as const;
export const DATA_VISIBILITIES = ['app', 'merchant', 'storefront'] as const;

/**
 * The names the dashboard uses NEXT TO its app pages
 * (`/dashboard/{businessId}/apps/{handle}`): a dashboard page with one of
 * these names wins over the app's, so an app with such a handle would open
 * the dashboard's page instead of its own. `google-sheets` is a page today;
 * `components` and `hooks` are reserved for the day they become one. A new
 * name is reserved here (and in the API) before the dashboard uses it.
 */
export const DASHBOARD_APP_ROUTE_HANDLES: readonly string[] = [
  'components',
  'google-sheets',
  'hooks',
];

/**
 * Handles that are labels of the hosting domain's own infrastructure, the
 * platform's name, or a dashboard route next to the app page. Uniqueness among
 * apps is the registry's check (AP-B1.1).
 */
export const RESERVED_HANDLES: readonly string[] = [
  'admin',
  'api',
  'app',
  'apps',
  'assets',
  'auth',
  'cdn',
  'console',
  'dashboard',
  'developer',
  'developers',
  'dispatch',
  'dispatcher',
  'docs',
  'egress',
  'help',
  'login',
  'mail',
  'oauth',
  'sandbox',
  'static',
  'status',
  'support',
  'tassyir',
  'www',
  ...DASHBOARD_APP_ROUTE_HANDLES,
];

/**
 * Tassyir's own domains. An external app may not live on them (the API
 * trusts every `*.tassyir.io` origin with credentials, D2, and another app
 * owns each `*.tassyir-apps.com` origin), and a hosted app reaches Tassyir
 * through `env.TASSYIR`, never through its egress allowlist.
 */
export const RESERVED_DOMAINS: readonly string[] = [
  'tassyir.io',
  'tassyir-apps.com',
  'tassyir.shop',
];

/** Top-level names that never reach the public internet. */
export const PRIVATE_TLDS: readonly string[] = [
  'alt',
  'arpa',
  'corp',
  'example',
  'home',
  'internal',
  'intranet',
  'invalid',
  'lan',
  'local',
  'localdomain',
  'localhost',
  'onion',
  'test',
];

// ── Patterns (published in the JSON Schema) ────────────────────────────────

/**
 * Characters a display string may not hold: control characters, line
 * breaks, and the invisible characters used to make two strings look alike
 * or to reverse what a merchant reads (bidi controls, zero-width characters,
 * fillers). Variation selectors stay allowed: emoji need them.
 */
const INVISIBLE_CLASS =
  '\\u0000-\\u001F\\u007F-\\u009F\\u00AD\\u061C\\u115F\\u1160\\u17B4\\u17B5' +
  '\\u180E\\u200B-\\u200F\\u2028-\\u202E\\u2060-\\u206F\\u3164\\uFEFF' +
  '\\uFFA0\\uFFF0-\\uFFFB';

// The class lists each code point on its own on purpose (the Hangul fillers
// U+115F and U+1160 among them), so the misleading-class rule is off here
// and on TEXT_PATTERN.
// eslint-disable-next-line no-misleading-character-class
export const INVISIBLE_CHARACTER = new RegExp(`[${INVISIBLE_CLASS}]`);

/**
 * One line of visible text, no surrounding whitespace. No lookarounds in the
 * published patterns: TOML editors validate with non-JavaScript engines.
 */
export const TEXT_PATTERN = new RegExp(
  // eslint-disable-next-line no-misleading-character-class
  `^[^\\s${INVISIBLE_CLASS}](?:[^${INVISIBLE_CLASS}]*[^\\s${INVISIBLE_CLASS}])?$`,
);

/**
 * A DNS label (the hosted origin is `{handle}.tassyir-apps.com`): letters
 * and digits in runs joined by single hyphens; 3 to 40 characters is the
 * schema's `minLength` / `maxLength`.
 */
export const HANDLE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';

/** A lowercase hostname of two labels or more. */
export const HOSTNAME_PATTERN = new RegExp(`^${LABEL}(?:\\.${LABEL})+$`);

/** A hostname, or `*.` + a hostname (one leading wildcard label). */
export const ALLOWED_HOST_PATTERN = new RegExp(
  `^(?:\\*\\.)?${LABEL}(?:\\.${LABEL})+$`,
);

/** Shape hint for absolute URLs; the validator checks the rest. */
export const HTTPS_URL_HINT = /^https:\/\/[^/?#\s\\]+(?:\/[^?#\s\\]*)?$/;

/** Shape hint for app-relative paths; the validator checks the rest. */
export const RELATIVE_PATH_HINT = /^\/(?:[^/?#\s\\][^?#\s\\]*)?$/;

export const DATA_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/** A file of the hosted bundle, lowercase segments, a `.liquid` template. */
export const TEMPLATE_PATTERN = /^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*\.liquid$/;
