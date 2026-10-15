/**
 * The Tassyir dashboard's design tokens, as data and as CSS custom properties.
 *
 * Source: the frontend's DESIGN.md (the law for the dashboard's look) and the
 * two palette blocks of its `app/[locale]/globals.css`, which DESIGN.md names
 * as the only place the colours live. The values are copied verbatim, so a
 * parity check can compare them string for string
 * (`TASSYIR_FRONTEND_DIR=… npm run parity -w @tassyir/ui`).
 *
 * This module touches no DOM: it is safe to import on a server.
 */

export type Theme = 'light' | 'dark';

/** Every colour token, the same names in both themes. */
export const COLOR_TOKENS = [
  'ink',
  'ink-secondary',
  'ink-tertiary',
  'paper',
  'paper-sunken',
  'muted-fill',
  'accent-fill',
  'hairline',
  'field',
  'on-ink',
  'skeleton',
  'brand-cyan',
  'success',
  'success-soft',
  'warning',
  'warning-ink',
  'warning-soft',
  'info',
  'info-soft',
  'destructive',
  'destructive-on',
  'destructive-soft',
  'purple',
  'pill-surface',
  'pill-ink',
  'control-hover',
  'ghost-hover',
  'destructive-fill',
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

/**
 * Colours per theme. Light is the default; dark is what the dashboard shows
 * when the merchant picks it (App Bridge's `context.theme`).
 *
 * - `ink`: text, titles and the primary button's fill (near-white in dark,
 *   where the primary button inverts). `ink-secondary`: secondary text and
 *   labels. `ink-tertiary`: focus rings, placeholders, disabled hints.
 * - `paper`: the working surface. `paper-sunken`: the page field.
 *   `muted-fill`: soft fills (tinted headers, count chips). `accent-fill`:
 *   hover. `hairline`: every border and divider. `field`: a text field's fill.
 * - `on-ink`: text on an ink fill. `skeleton`: the loading placeholder, a scrim.
 * - Status: `success`, `warning`, `info`, `destructive`, `purple`, each with a
 *   `-soft` fill where the dashboard has one. On `warning-soft`, text is
 *   `warning-ink`. `pill-surface` and `pill-ink` are what a status pill mixes
 *   its hue with.
 * - `brand-cyan`: the highlighter. Selection, progress, charts; never a fill
 *   for buttons or a status.
 * - `control-hover`, `ghost-hover`, `destructive-fill`: the dashboard
 *   button's own hover and fill, which differ per theme.
 */
export const colors: Readonly<
  Record<Theme, Readonly<Record<ColorToken, string>>>
> = {
  light: {
    ink: '#051F25',
    'ink-secondary': '#616669',
    'ink-tertiary': '#8B8E8F',
    paper: 'oklch(1 0 0)',
    'paper-sunken': 'oklch(0.973 0 0)',
    'muted-fill': 'oklch(0.942 0 0)',
    'accent-fill': 'oklch(0.928 0 0)',
    hairline: 'oklch(0.915 0 0)',
    field: 'oklch(1 0 0)',
    'on-ink': 'oklch(0.985 0 0)',
    skeleton: 'rgb(0 0 0 / 0.05)',
    'brand-cyan': '#4ADBF2',
    success: 'oklch(0.545 0.151 150)',
    'success-soft': 'oklch(0.96 0.06 150)',
    warning: 'oklch(0.7 0.17 70)',
    'warning-ink': 'oklch(0.18 0.04 70)',
    'warning-soft': 'oklch(0.96 0.07 85)',
    info: 'oklch(0.6 0.13 230)',
    'info-soft': 'oklch(0.96 0.04 230)',
    destructive: 'oklch(0.577 0.245 27.325)',
    'destructive-on': 'oklch(0.985 0 0)',
    'destructive-soft': 'oklch(0.96 0.04 27.325)',
    purple: '#8b5cf6',
    'pill-surface': 'oklch(1 0 0)',
    'pill-ink': 'black',
    'control-hover': 'oklch(0.928 0 0)',
    'ghost-hover': 'oklch(0.928 0 0)',
    'destructive-fill': 'oklch(0.577 0.245 27.325)',
  },
  dark: {
    ink: 'oklch(0.955 0 0)',
    'ink-secondary': 'oklch(0.72 0 0)',
    'ink-tertiary': 'oklch(0.56 0 0)',
    paper: 'oklch(0.195 0 0)',
    'paper-sunken': 'oklch(0.155 0 0)',
    'muted-fill': 'oklch(0.245 0 0)',
    'accent-fill': 'oklch(0.265 0 0)',
    hairline: 'oklch(0.3 0 0)',
    field: 'color-mix(in oklab, oklch(0.3 0 0) 30%, transparent)',
    'on-ink': '#051F25',
    skeleton: 'rgb(255 255 255 / 0.07)',
    'brand-cyan': '#4ADBF2',
    success: 'oklch(0.72 0.17 150)',
    'success-soft': 'oklch(0.3 0.07 150)',
    warning: 'oklch(0.8 0.15 75)',
    'warning-ink': 'oklch(0.9 0.09 85)',
    'warning-soft': 'oklch(0.31 0.07 75)',
    info: 'oklch(0.72 0.12 235)',
    'info-soft': 'oklch(0.3 0.06 235)',
    destructive: 'oklch(0.68 0.2 25)',
    'destructive-on': 'oklch(0.985 0 0)',
    'destructive-soft': 'oklch(0.27 0.08 25)',
    purple: '#a78bfa',
    'pill-surface': 'oklch(0.195 0 0)',
    'pill-ink': 'white',
    'control-hover': 'color-mix(in oklab, oklch(0.3 0 0) 50%, transparent)',
    'ghost-hover': 'color-mix(in oklab, oklch(0.265 0 0) 50%, transparent)',
    'destructive-fill':
      'color-mix(in oklab, oklch(0.68 0.2 25) 60%, transparent)',
  },
};

/**
 * Shadows. Surfaces rest on hairlines; a shadow is a whisper of paper lift
 * (`paper`, cards and table frames) or control lift (`control`, buttons and
 * fields). Nothing here floats.
 */
export const shadows: Readonly<
  Record<Theme, Readonly<Record<'paper' | 'control', string>>>
> = {
  light: {
    paper:
      '0 1px 3px 0 color-mix(in oklab, oklch(0.973 0 0) 95%, transparent), 0 1px 2px -1px color-mix(in oklab, oklch(0.973 0 0) 95%, transparent)',
    control: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  },
  dark: {
    paper:
      '0 1px 3px 0 color-mix(in oklab, oklch(0.155 0 0) 95%, transparent), 0 1px 2px -1px color-mix(in oklab, oklch(0.155 0 0) 95%, transparent)',
    control: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  },
};

/**
 * Type families. Geist carries Latin, IBM Plex Sans Arabic carries Arabic
 * (the dashboard loads both; DESIGN.md still names the Arabic face's old
 * name, Alexandria, which stays in the stack). This package loads no font:
 * an app that wants the exact faces serves them itself, and the stack falls
 * back to the system's sans otherwise.
 */
export const fonts = {
  sans: '"Geist", "IBM Plex Sans Arabic", "Alexandria", ui-sans-serif, system-ui, sans-serif',
  mono: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
} as const;

/** Sizes. 14px is the floor: no UI text is smaller (DESIGN.md). */
export const fontSizes = {
  body: '0.875rem',
  label: '0.875rem',
  title: '1.125rem',
  headline: '1.25rem',
  'page-title': '1.5rem',
  /** The page title in right-to-left pages, where the Arabic face runs larger. */
  'page-title-rtl': '1.375rem',
} as const;

/** The weight ladder: 400 body, 500 labels, 600 titles, 700 the page title only. */
export const fontWeights = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export const lineHeights = {
  body: '1.5',
  label: '1.4',
  title: '1.3',
  headline: '1.25',
  'page-title': '1.2',
} as const;

/**
 * Spacing. `hint` binds a hint to the control above it, `hug` is label to
 * control, `grid` field to field, `section` section to section (DESIGN.md's
 * field ladder: 6 / 8 / 16 / 24).
 */
export const space = {
  hint: '6px',
  hug: '8px',
  cluster: '12px',
  grid: '16px',
  section: '24px',
} as const;

/** Corners: every control and container `control`, nested pieces `nested`, pills `pill`. */
export const radii = {
  control: '0.75rem',
  nested: '0.5rem',
  pill: '9999px',
} as const;

/**
 * The dashboard's breakpoints in CSS pixels (`sm`, `lg`, `xl`). CSS custom
 * properties cannot be used in media queries, so these are data only.
 */
export const breakpoints = { sm: 520, lg: 1023, xl: 1279 } as const;

/** The name of a token's CSS custom property, e.g. `--tsy-color-ink`. */
export function cssVariable(
  group:
    | 'color'
    | 'shadow'
    | 'font'
    | 'font-size'
    | 'font-weight'
    | 'line-height'
    | 'space'
    | 'radius',
  name: string,
): string {
  return `--tsy-${group}-${name}`;
}

function declarations(
  group: Parameters<typeof cssVariable>[0],
  values: Readonly<Record<string, string>>,
): string {
  return Object.entries(values)
    .map(([name, value]) => `${cssVariable(group, name)}:${value};`)
    .join('');
}

function themeBlock(theme: Theme): string {
  return (
    `color-scheme:${theme};` +
    declarations('color', colors[theme]) +
    declarations('shadow', shadows[theme])
  );
}

/**
 * The tokens as a stylesheet, in the `tassyir-ui` cascade layer, so any
 * unlayered rule of the app wins over it:
 *
 * - light on `:root` and on any `[data-theme="light"]`, dark on any
 *   `[data-theme="dark"]` (with `color-scheme`), so a subtree may switch;
 * - the theme-independent tokens (type, space, radii) on `:root`;
 * - the page's defaults, at zero specificity: paper background, ink text and
 *   the Tassyir type on `html` and on any `[data-theme]` element, 14px body.
 *
 * Importing `@tassyir/ui` adopts this sheet into the document; the same text
 * ships as `@tassyir/ui/tokens.css` for pages that want the tokens without
 * the components.
 */
export function tokensCss(): string {
  return (
    '@layer tassyir-ui{' +
    `:root,[data-theme="light"]{${themeBlock('light')}}` +
    `[data-theme="dark"]{${themeBlock('dark')}}` +
    ':root{' +
    declarations('font', fonts) +
    declarations('font-size', fontSizes) +
    declarations('font-weight', fontWeights) +
    declarations('line-height', lineHeights) +
    declarations('space', space) +
    declarations('radius', radii) +
    '}' +
    ':where(html,[data-theme]){background-color:var(--tsy-color-paper);color:var(--tsy-color-ink)}' +
    ':where(html){font-family:var(--tsy-font-sans)}' +
    ':where(body){font-size:var(--tsy-font-size-body);line-height:var(--tsy-line-height-body)}' +
    '}'
  );
}
