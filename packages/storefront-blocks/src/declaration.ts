/**
 * What a template is checked against: the block's entry in
 * `tassyir.app.toml` (`[[storefront.blocks]]`, tassyir/backend
 * docs/APPS_PHASE2_PLAN.md §9.1). `@tassyir/app-manifest` validates the
 * entry itself; this package reads only these fields of it.
 */

/** Where a block can be placed. `product` blocks read the page's product. */
export type BlockTarget = 'product' | 'any';

/** The owners of app data a block may read. */
export const BLOCK_DATA_OWNERS = Object.freeze([
  'product',
  'store',
  'business',
] as const);
export type BlockDataOwner = (typeof BLOCK_DATA_OWNERS)[number];

/**
 * One merchant setting of a block (`[[storefront.blocks.settings]]`), as the
 * normalised manifest of `@tassyir/app-manifest` gives it: pass its block
 * entries here unchanged. Only these fields are read.
 */
export interface BlockSettingDeclaration {
  /** `[a-z][a-z0-9_]{0,39}`: the template reads `block.settings.<key>`. */
  key: string;
  /**
   * `string`, `text`, `boolean`, `integer`, `number`, `select`, `color`
   * (`#rrggbb`), `image`, `url`, `product`, `collection`; a type a later
   * version adds is read as a plain value until this package knows it.
   */
  type: string;
  default?: unknown;
  /** For `select`: the values a merchant may pick. */
  options?: readonly { value: string }[];
  /** For `integer` and `number`. */
  min?: number;
  max?: number;
  /** For `string` and `text` (1,000 when absent). The manifest's name. */
  max_length?: number;
}

export interface BlockDeclaration {
  /** Default `any`, as in the manifest. */
  target?: BlockTarget;
  /** The block's settings. When given, `block.settings.<key>` must name one. */
  settings?: readonly BlockSettingDeclaration[];
  /**
   * The app data the block reads, as `"<owner>.<key>"` (the manifest's
   * `data` list). When given, `app.data.<owner>.<key>` must name one.
   */
  data?: readonly string[];
}

/** The fields of `product` a template may read (target `product` only). */
export const BLOCK_PRODUCT_FIELDS = Object.freeze([
  'id',
  'name',
  'url',
  'price',
  'compareAtPrice',
  'currency',
  'image',
  'available',
] as const);

/** The fields of `store` a template may read. */
export const BLOCK_STORE_FIELDS = Object.freeze([
  'name',
  'url',
  'locale',
  'direction',
  'currency',
] as const);

/** The fields of `forloop` inside a `for` loop. */
export const BLOCK_FORLOOP_FIELDS = Object.freeze([
  'index',
  'index0',
  'rindex',
  'rindex0',
  'first',
  'last',
  'length',
] as const);

/** Names a template reads without declaring them; it may not assign them. */
export const BLOCK_OBJECTS = Object.freeze([
  'block',
  'product',
  'store',
  'app',
  'forloop',
] as const);

/** Properties any value answers: `items.size`, `items.first`, `items.last`. */
export const SPECIAL_PROPERTIES: ReadonlySet<string> = new Set([
  'size',
  'first',
  'last',
]);
