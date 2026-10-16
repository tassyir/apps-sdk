/**
 * The storefront theme's CSS variables a block stylesheet may read, so a
 * block can match the store's colours, fonts and shapes. A stable subset of
 * builder-core's `--st-*` variables (set on every store page); the others may
 * change without notice, so the validator refuses them.
 */
export const STOREFRONT_THEME_VARIABLES = Object.freeze({
  '--st-primary': 'The brand colour (buttons, links).',
  '--st-on-primary': 'Text on the brand colour.',
  '--st-primary-text':
    'The brand colour when it is used as text on the page background.',
  '--st-secondary': 'The second brand colour.',
  '--st-bg': 'The page background.',
  '--st-surface': 'The background of cards and panels.',
  '--st-text': 'The main text colour.',
  '--st-muted': 'Secondary text (captions, hints).',
  '--st-border': 'Borders and dividers.',
  '--st-font': 'The body font family.',
  '--st-heading-font': 'The heading font family.',
  '--st-heading-weight': 'The heading font weight.',
  '--st-body-size': 'The body font size.',
  '--st-radius': 'The corner radius of cards and panels.',
  '--st-space': 'The base spacing unit.',
  '--st-shadow': 'The card shadow.',
} as const);

export type StorefrontThemeVariable = keyof typeof STOREFRONT_THEME_VARIABLES;

/** The CSS variable a `color` setting is published as on the block's
 * section: `accent_color` → `--block-accent-color`. */
export function blockSettingVariable(key: string): string {
  return `--block-${key.replace(/_/g, '-')}`;
}
