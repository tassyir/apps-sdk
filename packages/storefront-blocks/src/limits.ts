/**
 * Every limit of a storefront block, in one frozen object. The upload check,
 * the builder's preview, the storefront's render and the CLI read these same
 * numbers (tassyir/backend docs/APPS_PHASE2_PLAN.md §6.2).
 *
 * Sizes are UTF-8 bytes. Render time is bounded by `steps`, a count that is the
 * same on every machine, never by a clock: the same template and data always
 * finish, or always stop at the same point with the same error.
 */
export const BLOCK_LIMITS = Object.freeze({
  /** A block's `.liquid` template. */
  templateBytes: 16 * 1024,
  /** A block's `.css` stylesheet. */
  stylesheetBytes: 8 * 1024,
  /** Blocks one app version may declare (the manifest's rule, repeated here). */
  blocksPerVersion: 20,
  /** Every block file of one version together (templates and stylesheets). */
  blockFilesBytes: 100 * 1024,
  /** The HTML one render produces, before and after the HTML gate. */
  outputBytes: 32 * 1024,
  /** The app data one render reads (`app.data`), measured as JSON. */
  dataBytes: 32 * 1024,
  /** Work units one render may spend (see `RENDER_STEP_COSTS`). */
  steps: 20_000,
  /** Iterations of one `for` loop: a longer collection or range stops at 50. */
  loopIterations: 50,
  /** `for` loops open inside one another. */
  loopNesting: 3,
  /** Liquid block tags (`if`, `for`, `case`, `capture`, …) open at once. */
  tagNesting: 10,
  /** HTML elements open at once. */
  htmlNesting: 32,
  /** Filters in one `{{ … }}` or `assign`. */
  filtersPerExpression: 10,
  /** Conditions joined by `and` / `or` in one tag. */
  conditionTerms: 16,
  /** Variables one template may `assign` or `capture`. */
  variables: 64,
  /** Items in one array a template reads or makes (`split`, `concat`, data). */
  arrayItems: 500,
  /** Characters in one string a template makes (`append`, `capture`, …). */
  stringLength: 32 * 1024,
  /** Levels of nesting in the data a template reads. */
  dataDepth: 16,
  /** Characters of one attribute value, a URL included. */
  attributeLength: 2048,
  /** Errors one validation reports; the rest are summarised in the last. */
  errors: 50,
});

export type BlockLimits = typeof BLOCK_LIMITS;

/**
 * What one render spends. A filter or a string operation costs 1 step plus one
 * per `perChars` characters (or array items) it reads, so a filter applied to a
 * long string costs more than one applied to a word.
 */
export const RENDER_STEP_COSTS = Object.freeze({
  /** A text run, an output, a tag, a loop iteration, a condition. */
  node: 1,
  /** A filter call, before its size share. */
  filter: 1,
  /** The size share: one more step per this many characters or items read. */
  perChars: 256,
});

/** The widths `image_url` serves. A requested width is rounded UP to the next
 * one (at most the last): every width is one more image the CDN keeps. */
export const IMAGE_URL_WIDTHS = Object.freeze([
  80, 160, 240, 320, 480, 640, 800, 1080, 1600,
] as const);
