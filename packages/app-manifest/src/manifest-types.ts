/**
 * Types of the app manifest v1 (the contract: tassyir/backend
 * docs/APPS_PLATFORM_PLAN.md §3.2).
 *
 * The validator imports nothing but `zod` and its own files
 * (`manifest-boundary.test.ts`). What it needs to know about the platform
 * (API versions, scopes, topics) comes in as a {@link ManifestVocabulary}:
 * the package ships one (`MANIFEST_VOCABULARY`), and the Tassyir API passes
 * the one it builds from its live catalogues.
 */

/** One scope as the manifest sees it (the API's scope catalogue). */
export interface ManifestScopeTerm {
  name: string;
  /** Scopes held whenever this one is (`closeScopes`). */
  implies: readonly string[];
  /** False while the platform does not offer the scope to apps yet. */
  available: boolean;
  /**
   * Why it is not available: a clause (no capital, no final period) that ends
   * the error's one-sentence `fix`.
   */
  unavailableReason?: string;
  /**
   * The scope reads nothing unless the app also holds one of these (after
   * implication): `read_customer_contact` opens fields on orders and
   * customers, so alone it opens nothing.
   */
  needsOneOf?: readonly string[];
}

/** One webhook topic (the API's event catalogue). */
export interface ManifestTopicTerm {
  name: string;
  /**
   * The scope an app must request (in `scopes` or `optional_scopes`, after
   * implication) to subscribe; null for topics every app may receive
   * (installation lifecycle, compliance).
   */
  scope: string | null;
}

/** Everything the validator knows about the platform. Plain data. */
export interface ManifestVocabulary {
  /** Supported API versions, oldest first. */
  apiVersions: readonly string[];
  /** Every scope, in consent-screen order (the normalised order). */
  scopes: readonly ManifestScopeTerm[];
  /** Every topic, in catalogue order (the normalised order). */
  topics: readonly ManifestTopicTerm[];
  /** The scope storefront blocks need (`write_storefront`). */
  storefrontBlocksScope: string;
  /**
   * Whether a manifest may declare `[app_proxy]` (Tassyir forwards store
   * requests to apps), and if not, why: a clause (no capital, no final
   * period) that ends the error's one-sentence `fix`. It also needs
   * {@link storefrontBlocksScope}.
   */
  appProxy: { available: boolean; unavailableReason?: string };
}

export type ManifestHostingMode = 'tassyir' | 'external';
export type ManifestDataOwner =
  'business' | 'store' | 'product' | 'order' | 'customer';
export type ManifestDataType =
  'string' | 'number' | 'integer' | 'boolean' | 'json';
export type ManifestDataVisibility = 'app' | 'merchant' | 'storefront';
export type ManifestBlockTarget = 'product' | 'any';
export type ManifestOfferTypeClass = 'product' | 'order' | 'delivery';
export type ManifestSettingType =
  | 'string'
  | 'text'
  | 'boolean'
  | 'integer'
  | 'number'
  | 'select'
  | 'color'
  | 'image'
  | 'url'
  | 'product'
  | 'collection';
export type ManifestAdminActionTarget =
  | 'order.details'
  | 'orders.selection'
  | 'product.details'
  | 'products.selection'
  | 'customer.details';

/** Text shown to merchants, in Arabic and English: `{ ar = "…", en = "…" }`. */
export interface ManifestLabel {
  ar: string;
  en: string;
}

export interface ManifestWebhook {
  topics: string[];
  uri: string;
}

export interface ManifestDataDefinition {
  owner: ManifestDataOwner;
  key: string;
  type: ManifestDataType;
  visibility: ManifestDataVisibility;
  /** Shown next to a `merchant` or `storefront` value in the dashboard. */
  label?: ManifestLabel;
}

/** One choice of a `select` setting. */
export interface ManifestSettingOption {
  value: string;
  label: ManifestLabel;
}

/**
 * A setting the merchant fills in for a block in the store builder; the
 * template reads it as `block.settings.<key>`. Present only when declared:
 * `default`, `options` (`select`), `min` and `max` (`integer`, `number`),
 * `max_length` (`string`, `text`).
 */
export interface ManifestSetting {
  key: string;
  type: ManifestSettingType;
  label: ManifestLabel;
  /**
   * A value of the type: a string (`string`, `text`, `select`, `color`,
   * `url`; `string` and `text` may give `{ ar, en }` instead), a number
   * (`integer`, `number`) or a boolean. `image`, `product` and `collection`
   * take none.
   */
  default?: string | number | boolean | ManifestLabel;
  options?: ManifestSettingOption[];
  min?: number;
  max?: number;
  max_length?: number;
}

/**
 * A declarative storefront block (D9). `target`, `data` (sorted) and
 * `settings` are always present in the normalised manifest; `stylesheet`
 * and `name` only when declared.
 */
export interface ManifestStorefrontBlock {
  handle: string;
  template: string;
  stylesheet?: string;
  name?: ManifestLabel;
  target: ManifestBlockTarget;
  /** The app data the template reads: `<owner>.<key>`. */
  data: string[];
  settings: ManifestSetting[];
}

/** A menu entry in the dashboard that opens one of the app's pages. */
export interface ManifestAdminAction {
  handle: string;
  target: ManifestAdminActionTarget;
  label: ManifestLabel;
  path: string;
}

/**
 * An offer type the app declares (`[[offers.types]]`): a kind of offer the
 * merchant can create "from your apps", priced by the declarative rule the
 * app writes through the Admin API (needs the `write_offers` scope).
 * `description` only when declared.
 */
export interface ManifestOfferType {
  /** Lowercase letters, digits and hyphens, at most 40; unique in the app. */
  handle: string;
  /** What the type's offers do: the class every rule of the type uses. */
  class: ManifestOfferTypeClass;
  /** The app's page that configures one offer of this type. */
  path: string;
  label: ManifestLabel;
  description?: ManifestLabel;
}

/**
 * The normalised manifest: what the Tassyir API stores for an app version
 * (`app_versions.manifest`). Same keys as
 * the TOML file (snake_case). Every list is present (possibly empty); a
 * table that only holds optional values (`auth`, `admin`, `app_proxy`) is
 * present only when it holds one, and so is `admin.actions`. Sets (scopes, topics, hosts) are in catalogue or
 * alphabetical order; lists of tables keep the file's order. Validating a
 * normalised manifest returns it unchanged.
 */
export interface AppManifest {
  name: string;
  handle: string;
  api_version: string;
  access: {
    scopes: string[];
    optional_scopes: string[];
    scope_reasons: Record<string, string>;
  };
  hosting:
    | { mode: 'external'; url: string }
    | { mode: 'tassyir'; allowed_hosts: string[] };
  auth?: { callback_url: string };
  /** Present when it holds a page or at least one action. */
  admin?: { page?: string; actions?: ManifestAdminAction[] };
  webhooks: ManifestWebhook[];
  data: { definitions: ManifestDataDefinition[] };
  storefront: { blocks: ManifestStorefrontBlock[] };
  /** Present only when it holds at least one type. */
  offers?: { types: ManifestOfferType[] };
  app_proxy?: { path: string };
}

/**
 * One refusal. `code` is stable (the contract), `path` names the field in
 * the parsed file (`webhooks[0].topics[1]`, '' for the whole document),
 * `message` says what is wrong and `fix` is one sentence an AI agent can act
 * on. Never carries anything but the input and the published rules.
 */
export interface ManifestError {
  code: ManifestErrorCode;
  path: string;
  message: string;
  fix: string;
}

export type ManifestValidationResult =
  { ok: true; manifest: AppManifest } | { ok: false; errors: ManifestError[] };

/** Every error code, in the order the reference lists them. The contract. */
export const MANIFEST_ERROR_CODES = [
  'MANIFEST_NOT_A_TABLE',
  'MANIFEST_NOT_DATA',
  'MANIFEST_TOO_LARGE',
  'MANIFEST_TOO_MANY_ERRORS',
  'MANIFEST_FIELD_REQUIRED',
  'MANIFEST_FIELD_UNKNOWN',
  'MANIFEST_FIELD_TYPE',
  'MANIFEST_FIELD_NOT_FOR_MODE',
  'MANIFEST_LIST_TOO_LONG',
  'MANIFEST_LIST_EMPTY',
  'MANIFEST_LIST_TOO_SHORT',
  'MANIFEST_VALUE_NOT_ALLOWED',
  'MANIFEST_NAME_INVALID',
  'MANIFEST_HANDLE_INVALID',
  'MANIFEST_HANDLE_RESERVED',
  'MANIFEST_API_VERSION_UNSUPPORTED',
  'MANIFEST_SCOPE_UNKNOWN',
  'MANIFEST_SCOPE_NOT_AVAILABLE',
  'MANIFEST_SCOPE_DUPLICATE',
  'MANIFEST_SCOPE_REQUIRED_AND_OPTIONAL',
  'MANIFEST_SCOPE_ALREADY_IMPLIED',
  'MANIFEST_SCOPE_NEEDS_ANOTHER',
  'MANIFEST_SCOPE_REASON_MISSING',
  'MANIFEST_SCOPE_REASON_UNUSED',
  'MANIFEST_SCOPE_REASON_INVALID',
  'MANIFEST_URL_INVALID',
  'MANIFEST_URL_HOST_NOT_ALLOWED',
  'MANIFEST_PATH_INVALID',
  'MANIFEST_PATH_RESERVED',
  'MANIFEST_HOST_INVALID',
  'MANIFEST_HOST_NOT_ALLOWED',
  'MANIFEST_HOST_DUPLICATE',
  'MANIFEST_TOPIC_UNKNOWN',
  'MANIFEST_TOPIC_DUPLICATE',
  'MANIFEST_TOPIC_SCOPE_MISSING',
  'MANIFEST_DATA_KEY_INVALID',
  'MANIFEST_DATA_KEY_DUPLICATE',
  'MANIFEST_DATA_LABEL_INVALID',
  'MANIFEST_BLOCKS_NOT_AVAILABLE',
  'MANIFEST_BLOCKS_SCOPE_MISSING',
  'MANIFEST_BLOCK_SCRIPT_NOT_ALLOWED',
  'MANIFEST_BLOCK_HANDLE_INVALID',
  'MANIFEST_BLOCK_HANDLE_DUPLICATE',
  'MANIFEST_BLOCK_TEMPLATE_INVALID',
  'MANIFEST_BLOCK_STYLESHEET_INVALID',
  'MANIFEST_BLOCK_NAME_INVALID',
  'MANIFEST_BLOCK_DATA_INVALID',
  'MANIFEST_BLOCK_DATA_DUPLICATE',
  'MANIFEST_BLOCK_DATA_NOT_DECLARED',
  'MANIFEST_BLOCK_DATA_NOT_STOREFRONT',
  'MANIFEST_BLOCK_DATA_TARGET_MISMATCH',
  'MANIFEST_BLOCK_SETTING_KEY_INVALID',
  'MANIFEST_BLOCK_SETTING_KEY_DUPLICATE',
  'MANIFEST_BLOCK_SETTING_LABEL_INVALID',
  'MANIFEST_BLOCK_SETTING_FIELD_NOT_FOR_TYPE',
  'MANIFEST_BLOCK_SETTING_OPTION_INVALID',
  'MANIFEST_BLOCK_SETTING_OPTION_DUPLICATE',
  'MANIFEST_BLOCK_SETTING_RANGE_INVALID',
  'MANIFEST_BLOCK_SETTING_DEFAULT_INVALID',
  'MANIFEST_PROXY_NOT_AVAILABLE',
  'MANIFEST_PROXY_SCOPE_MISSING',
  'MANIFEST_ACTION_HANDLE_INVALID',
  'MANIFEST_ACTION_HANDLE_DUPLICATE',
  'MANIFEST_ACTION_LABEL_INVALID',
  'MANIFEST_ACTION_SCOPE_MISSING',
  'MANIFEST_OFFER_TYPES_NOT_AVAILABLE',
  'MANIFEST_OFFER_TYPES_SCOPE_MISSING',
  'MANIFEST_OFFER_TYPE_HANDLE_INVALID',
  'MANIFEST_OFFER_TYPE_HANDLE_DUPLICATE',
  'MANIFEST_OFFER_TYPE_LABEL_INVALID',
] as const;

export type ManifestErrorCode = (typeof MANIFEST_ERROR_CODES)[number];
