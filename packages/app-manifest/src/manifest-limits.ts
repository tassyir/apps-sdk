/**
 * The manifest v1 limits and fixed vocabularies (tassyir/backend
 * docs/APPS_PLATFORM_PLAN.md §3.2 lists the same numbers; change both
 * together, the plan first).
 */

export const MANIFEST_FILE_NAME = 'tassyir.app.toml';

/** Hosted apps are served from `https://{handle}.tassyir-apps.com` (D2). */
export const HOSTED_APPS_DOMAIN = 'tassyir-apps.com';

/**
 * The paths of a hosted app's origin that Tassyir's dispatcher keeps for
 * itself (its launch, `/.tassyir/launch`; anything else there is a 404): no
 * page and no webhook of a hosted app may live there. The dispatcher's own
 * test, case-sensitive: the prefix, or `/.tassyir` itself.
 */
export const HOSTED_RESERVED_PATH_PREFIX = '/.tassyir/';

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
  /** Each language of a `{ ar, en }` label: the `name` rule. */
  labelMaxLength: 50,
  /** App data keys one block reads (`<owner>.<key>`). */
  blockDataMax: 20,
  blockSettingsMax: 20,
  settingKeyMaxLength: 40,
  settingOptionsMin: 2,
  settingOptionsMax: 20,
  settingOptionValueMaxLength: 40,
  /** The longest `string` or `text` value, and `max_length`'s ceiling. */
  settingTextMaxLength: 1000,
  /** A `url` setting's default. */
  settingUrlMaxLength: 512,
  adminActionsMax: 10,
  /** `[[offers.types]]`: the offer types one app may declare. */
  offerTypesMax: 10,
  /** The longest `offers.types[].path`: the API's own reader refuses more. */
  offerTypePathMaxLength: 200,
  /** Each language of an offer type's optional `description`. */
  offerTypeDescriptionMaxLength: 200,
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
 * The owners of app data a storefront block may read: never `order` or
 * `customer`, which hold buyer data (Phase 2 rule 3).
 */
export const BLOCK_DATA_OWNERS = ['business', 'store', 'product'] as const;

/**
 * Where a block may be placed: `product`, the product page (its template
 * reads the page's `product`), or `any` builder page but the order form's
 * (no `product`). `any` is the default.
 */
export const BLOCK_TARGETS = ['product', 'any'] as const;

/**
 * The merchant settings field types: one list for storefront blocks and,
 * later, for the other extensions (which add their own types).
 */
export const SETTING_TYPES = [
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
] as const;

/**
 * Where an admin action appears in the dashboard: the order, product or
 * customer page, or a selection in the orders or products list.
 */
export const ADMIN_ACTION_TARGETS = [
  'order.details',
  'orders.selection',
  'product.details',
  'products.selection',
  'customer.details',
] as const;

/** The scope an admin action's target needs: the read scope of its resource. */
export const ADMIN_ACTION_TARGET_SCOPES: Readonly<
  Record<(typeof ADMIN_ACTION_TARGETS)[number], string>
> = {
  'order.details': 'read_orders',
  'orders.selection': 'read_orders',
  'product.details': 'read_products',
  'products.selection': 'read_products',
  'customer.details': 'read_customers',
};

/**
 * The classes of offer an app-owned offer type prices (docs/OFFERS_PLAN.md
 * §11): what its declarative rule may do. `product` takes money off lines or
 * adds a gift, `order` takes money off the goods, `delivery` waives the
 * delivery fee.
 */
export const OFFER_TYPE_CLASSES = ['product', 'order', 'delivery'] as const;

/**
 * The scope an app needs to declare offer types, and to create the offers of
 * those types through the Admin API. It implies `read_offers`.
 */
export const OFFER_TYPES_SCOPE = 'write_offers';

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
 * through `ctx.props.TASSYIR`, never through its egress allowlist.
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

/**
 * An offer type's handle: lowercase letters, digits and hyphens, at most 40,
 * starting with a letter or digit. Exactly the pattern the API reads it with.
 */
export const OFFER_TYPE_HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

export const DATA_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/** A file of the hosted bundle, lowercase segments, a `.liquid` template. */
export const TEMPLATE_PATTERN = /^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*\.liquid$/;

/** A block's stylesheet: the template's rule, a `.css` file. */
export const STYLESHEET_PATTERN = /^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*\.css$/;

/** The app data a block reads: `<owner>.<key>`, a key of `[[data.definitions]]`. */
export const BLOCK_DATA_PATTERN =
  /^(?:business|store|product)\.[a-z][a-z0-9_]{0,63}$/;

/** A setting's key, as a template reads it: `block.settings.<key>`. */
export const SETTING_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

/** A `select` option's value: lowercase letters, digits, "_" and "-". */
export const SETTING_OPTION_VALUE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** A `color` setting's value: `#rrggbb`. */
export const SETTING_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
