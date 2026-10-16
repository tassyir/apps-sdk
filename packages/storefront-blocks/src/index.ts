/**
 * `@tassyir/storefront-blocks`: the language of Tassyir's declarative
 * storefront blocks (tassyir/backend docs/APPS_PHASE2_PLAN.md §6.2), one code
 * for every party that reads a block: the API's upload check, the builder's
 * preview, the storefront's render, the CLI and dev-mcp.
 *
 * A block is a template in a subset of Liquid and an optional stylesheet. The
 * template is checked at upload with a line, a column and a fix for each
 * error, and rendered on the server: every output escaped, every loop and
 * filter counted in steps (never a clock), and the HTML rebuilt from an
 * allowlist before it leaves. No JavaScript, form, frame or style element can
 * come out of it.
 *
 * Pure: no dependency, no I/O, no clock, no randomness, no `Intl`. The same
 * template and data give the same bytes in Node and in every browser. Named
 * exports only.
 */
export {
  validateBlock,
  compileBlockTemplate,
  renderBlock,
} from './validate.js';
export type {
  BlockFiles,
  BlockValidationResult,
  CompileOptions,
  CompileResult,
} from './validate.js';
export { renderCompiledBlock } from './render.js';
export type {
  BlockProduct,
  BlockRenderContext,
  BlockRenderResult,
  BlockRenderStats,
  BlockStore,
  CompiledBlockTemplate,
} from './render.js';
export { validateBlockStylesheet } from './css/validate-stylesheet.js';
export { sanitizeBlockHtml } from './html/sanitize.js';
export { BLOCK_HTML_ALLOWLIST, BLOCK_ROLES } from './html/allowlist.js';
export { BLOCK_NAMED_ENTITIES } from './html/entities.js';
export { BLOCK_FILTERS } from './filters.js';
export { BLOCK_LIMITS, IMAGE_URL_WIDTHS, RENDER_STEP_COSTS } from './limits.js';
export type { BlockLimits } from './limits.js';
export { BLOCK_ERROR_CODES, blockErrorFix } from './errors.js';
export type { BlockError, BlockErrorCode, BlockErrorSource } from './errors.js';
export {
  BLOCK_DATA_OWNERS,
  BLOCK_FORLOOP_FIELDS,
  BLOCK_OBJECTS,
  BLOCK_PRODUCT_FIELDS,
  BLOCK_STORE_FIELDS,
} from './declaration.js';
export type {
  BlockDataOwner,
  BlockDeclaration,
  BlockSettingDeclaration,
  BlockTarget,
} from './declaration.js';
export { blockCssVariables, resolveBlockSettings } from './settings.js';
export { sampleBlockContext } from './sample.js';
export type { SampleLanguage } from './sample.js';
export {
  STOREFRONT_THEME_VARIABLES,
  blockSettingVariable,
} from './css/theme-variables.js';
export type { StorefrontThemeVariable } from './css/theme-variables.js';
export {
  IMAGE_CDN_ORIGIN,
  imageUrl,
  isBlockImageSource,
  linkKind,
} from './urls.js';
export type { LinkKind } from './urls.js';
export { formatMoney } from './money.js';

/** The version of the block language this package implements. A template
 * that passes under a dialect version renders the same under every later
 * one: later versions add, never change. */
export const BLOCK_DIALECT_VERSION = 1;
