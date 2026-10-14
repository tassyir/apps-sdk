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
}

export type ManifestHostingMode = 'tassyir' | 'external';
export type ManifestDataOwner =
  'business' | 'store' | 'product' | 'order' | 'customer';
export type ManifestDataType =
  'string' | 'number' | 'integer' | 'boolean' | 'json';
export type ManifestDataVisibility = 'app' | 'merchant' | 'storefront';

export interface ManifestWebhook {
  topics: string[];
  uri: string;
}

export interface ManifestDataDefinition {
  owner: ManifestDataOwner;
  key: string;
  type: ManifestDataType;
  visibility: ManifestDataVisibility;
}

export interface ManifestStorefrontBlock {
  handle: string;
  template: string;
}

/**
 * The normalised manifest: what the Tassyir API stores for an app version
 * (`app_versions.manifest`). Same keys as
 * the TOML file (snake_case). Every list is present (possibly empty); a
 * table that only holds optional values (`auth`, `admin`) is present only
 * when it holds one. Sets (scopes, topics, hosts) are in catalogue or
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
  admin?: { page: string };
  webhooks: ManifestWebhook[];
  data: { definitions: ManifestDataDefinition[] };
  storefront: { blocks: ManifestStorefrontBlock[] };
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
  'MANIFEST_HOST_INVALID',
  'MANIFEST_HOST_NOT_ALLOWED',
  'MANIFEST_HOST_DUPLICATE',
  'MANIFEST_TOPIC_UNKNOWN',
  'MANIFEST_TOPIC_DUPLICATE',
  'MANIFEST_TOPIC_SCOPE_MISSING',
  'MANIFEST_DATA_KEY_INVALID',
  'MANIFEST_DATA_KEY_DUPLICATE',
  'MANIFEST_BLOCKS_NOT_AVAILABLE',
  'MANIFEST_BLOCKS_SCOPE_MISSING',
  'MANIFEST_BLOCK_SCRIPT_NOT_ALLOWED',
  'MANIFEST_BLOCK_HANDLE_INVALID',
  'MANIFEST_BLOCK_HANDLE_DUPLICATE',
  'MANIFEST_BLOCK_TEMPLATE_INVALID',
] as const;

export type ManifestErrorCode = (typeof MANIFEST_ERROR_CODES)[number];
