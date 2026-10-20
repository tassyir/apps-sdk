/**
 * `@tassyir/app-manifest`: the schema and validator of `tassyir.app.toml`,
 * the Tassyir app manifest v1 (tassyir/backend docs/APPS_PLATFORM_PLAN.md
 * §3.2). The Tassyir API validates uploads with the same code, so a manifest
 * this package accepts is one the API accepts, with the same errors.
 *
 * Pure: `zod` and the files of this package only, no I/O, no clock
 * (`manifest-boundary.test.ts`). Named exports only.
 */
export {
  formatManifestPath,
  validateManifest,
  validateManifestField,
} from './validate-manifest.js';
export { buildManifestSchema, manifestJsonSchema } from './manifest-schema.js';
export {
  hostedAppOrigin,
  manifestVersionColumns,
  resolveManifestUri,
} from './manifest-helpers.js';
export type {
  ManifestVersionColumns,
  ResolvedManifestUri,
} from './manifest-helpers.js';
export {
  ADMIN_ACTION_TARGETS,
  ADMIN_ACTION_TARGET_SCOPES,
  BLOCK_DATA_OWNERS,
  BLOCK_TARGETS,
  DATA_KEY_PATTERN,
  DATA_OWNERS,
  DATA_TYPES,
  DATA_VISIBILITIES,
  HOSTED_APPS_DOMAIN,
  HOSTED_RESERVED_PATH_PREFIX,
  MANIFEST_FILE_NAME,
  MANIFEST_LIMITS,
  OFFER_TYPE_CLASSES,
  OFFER_TYPE_HANDLE_PATTERN,
  OFFER_TYPES_SCOPE,
  RESERVED_DOMAINS,
  RESERVED_HANDLES,
  SETTING_KEY_PATTERN,
  SETTING_TYPES,
} from './manifest-limits.js';
export { MANIFEST_ERROR_CODES } from './manifest-types.js';
export type {
  AppManifest,
  ManifestAdminAction,
  ManifestAdminActionTarget,
  ManifestBlockTarget,
  ManifestDataDefinition,
  ManifestDataOwner,
  ManifestDataType,
  ManifestDataVisibility,
  ManifestError,
  ManifestErrorCode,
  ManifestLabel,
  ManifestOfferType,
  ManifestOfferTypeClass,
  ManifestScopeTerm,
  ManifestSetting,
  ManifestSettingOption,
  ManifestSettingType,
  ManifestStorefrontBlock,
  ManifestTopicTerm,
  ManifestValidationResult,
  ManifestVocabulary,
  ManifestWebhook,
} from './manifest-types.js';
export { MANIFEST_VOCABULARY } from './vocabulary.js';
