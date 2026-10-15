import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hex, parseColor } from './color.test-harness.js';
import {
  breakpoints,
  colors,
  fonts,
  fontSizes,
  fontWeights,
  lineHeights,
  radii,
  shadows,
  space,
  type ColorToken,
  type Theme,
} from './tokens.js';

/**
 * This package against the dashboard's own design (AP-K1.5). Skipped unless
 * TASSYIR_FRONTEND_DIR names a tassyir/frontend clone; the frontend repo is
 * private, so CI cannot run it:
 *
 *   git -C ../frontend fetch origin
 *   TASSYIR_FRONTEND_DIR=../frontend npm run parity -w @tassyir/ui
 *
 * It reads TASSYIR_FRONTEND_REF (default `origin/main`) with `git show` (the
 * checkout is never switched) and checks:
 *  - every colour token equals, string for string, the raw palette variable
 *    it copies in both blocks of `app/[locale]/globals.css` (DESIGN.md names
 *    them the only place the colours live), and the button's per-theme fills
 *    follow the classes `components/ui/button.tsx` uses;
 *  - DESIGN.md's front matter: colours (as sRGB), radii, spacing, type, and
 *    the button, input and card dimensions; its one known stale colour is
 *    listed below and must still be stale;
 *  - the facts of the dashboard's primitives each element mirrors (heights,
 *    radii, the pill's mix, the page title, the fonts, the breakpoints).
 */

const FRONTEND_DIR = process.env['TASSYIR_FRONTEND_DIR'];
const FRONTEND_REF = process.env['TASSYIR_FRONTEND_REF'] ?? 'origin/main';

if (
  FRONTEND_DIR === undefined &&
  process.env['npm_lifecycle_event'] === 'parity'
) {
  throw new Error(
    'TASSYIR_FRONTEND_DIR is not set. Set it to a tassyir/frontend clone (git fetch origin first), e.g. TASSYIR_FRONTEND_DIR=../frontend npm run parity -w @tassyir/ui.',
  );
}

function frontend(path: string): string {
  if (FRONTEND_DIR === undefined) throw new Error('no frontend');
  return execFileSync(
    'git',
    ['-C', FRONTEND_DIR, 'show', `${FRONTEND_REF}:${path}`],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
}

function own(file: string): string {
  return readFileSync(new URL(file, import.meta.url), 'utf8');
}

/** `--name: value;` declarations of the first block whose selector is `selector`. */
function block(css: string, selector: RegExp): Map<string, string> {
  const start = css.search(selector);
  if (start === -1) throw new Error(`no ${String(selector)} block`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('\n}', open);
  const body = css.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, '');
  const declarations = new Map<string, string>();
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const [, name = '', value = ''] = match;
    declarations.set(name, value.trim());
  }
  return declarations;
}

/** Replaces `var(--x)` with the block's own value of `--x`. */
function resolve(value: string, scope: Map<string, string>): string {
  return value.replace(/var\((--[\w-]+)\)/g, (whole, name: string) => {
    const found = scope.get(name);
    return found === undefined ? whole : resolve(found, scope);
  });
}

function normal(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),/])\s*/g, '$1')
    .trim();
}

/** Each colour token and the raw palette variable of globals.css it copies. */
const PALETTE: Partial<Record<ColorToken, string>> = {
  ink: '--gray-dark',
  'ink-secondary': '--gray-dark-medium',
  'ink-tertiary': '--gray-dark-light',
  paper: '--ui-paper',
  'paper-sunken': '--gray-bg-light',
  'muted-fill': '--ui-muted',
  'accent-fill': '--ui-accent',
  hairline: '--gray-bg-medium',
  field: '--ui-field',
  'on-ink': '--ui-on-ink',
  skeleton: '--ui-skeleton',
  success: '--ui-success',
  'success-soft': '--ui-success-soft',
  warning: '--ui-warning',
  'warning-ink': '--ui-warning-foreground',
  'warning-soft': '--ui-warning-soft',
  info: '--ui-info',
  'info-soft': '--ui-info-soft',
  destructive: '--ui-destructive',
  'destructive-on': '--ui-destructive-foreground',
  'destructive-soft': '--ui-destructive-soft',
  purple: '--ui-purple',
  'pill-surface': '--ui-pill-surface',
  'pill-ink': '--ui-pill-ink',
};

/**
 * DESIGN.md front-matter colours known to lag its own §2 and globals.css.
 * Each must still differ: when the frontend fixes it, drop the entry.
 */
const KNOWN_DESIGN_MD_DRIFT: Partial<Record<string, string>> = {
  success:
    'the front matter keeps the green of before 2026-08-10 (3.39:1); §2 and globals.css darkened it to oklch(0.545 0.151 150), #00873C',
};

/** DESIGN.md front-matter colour name → the token it describes (light theme). */
const DESIGN_COLORS: Record<string, ColorToken> = {
  ink: 'ink',
  'ink-secondary': 'ink-secondary',
  'ink-tertiary': 'ink-tertiary',
  paper: 'paper',
  'paper-sunken': 'paper-sunken',
  'muted-fill': 'muted-fill',
  hairline: 'hairline',
  'brand-cyan': 'brand-cyan',
  success: 'success',
  'success-soft': 'success-soft',
  warning: 'warning',
  'warning-ink': 'warning-ink',
  'warning-soft': 'warning-soft',
  info: 'info',
  'info-soft': 'info-soft',
  destructive: 'destructive',
  'destructive-soft': 'destructive-soft',
  purple: 'purple',
};

/** A small reader for DESIGN.md's front matter: nested `key: value` maps. */
function frontMatter(
  markdown: string,
): Record<string, Record<string, unknown>> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  if (!match?.[1]) throw new Error('DESIGN.md has no front matter');
  const root: Record<string, unknown> = {};
  const stack: { indent: number; node: Record<string, unknown> }[] = [
    { indent: -1, node: root },
  ];
  for (const line of match[1].split('\n')) {
    if (line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    const [, key = '', rest = ''] = /^\s*([\w-]+):\s*(.*)$/.exec(line) ?? [];
    while ((stack.at(-1)?.indent ?? -1) >= indent) stack.pop();
    const parent = stack.at(-1)?.node ?? root;
    if (rest === '') {
      const child: Record<string, unknown> = {};
      parent[key] = child;
      stack.push({ indent, node: child });
    } else {
      parent[key] = rest.replace(/^"(.*)"$/, '$1');
    }
  }
  return root as Record<string, Record<string, unknown>>;
}

describe.skipIf(FRONTEND_DIR === undefined)(
  `@tassyir/ui against tassyir/frontend ${FRONTEND_REF}`,
  () => {
    const globals = FRONTEND_DIR ? frontend('app/[locale]/globals.css') : '';
    const palettes: Record<Theme, Map<string, string>> = {
      light: FRONTEND_DIR
        ? block(globals, /^:root,\s*\n\.theme-light\s*\{/m)
        : new Map<string, string>(),
      dark: FRONTEND_DIR
        ? block(globals, /^\.dark\s*\{/m)
        : new Map<string, string>(),
    };

    it('copies every palette colour from globals.css, in both themes', () => {
      for (const theme of ['light', 'dark'] as const) {
        const palette = palettes[theme];
        for (const [token, variable] of Object.entries(PALETTE)) {
          const theirs = palette.get(variable);
          expect(theirs, `${variable} in the ${theme} block`).toBeDefined();
          expect(
            normal(colors[theme][token as ColorToken]),
            `${token} (${theme}) copies ${variable}`,
          ).toBe(normal(resolve(theirs ?? '', palette)));
        }
      }
      expect(normal(colors.light['brand-cyan'])).toBe(
        normal(/--color-brand-cyan:\s*([^;]+);/.exec(globals)?.[1] ?? ''),
      );
      expect(colors.dark['brand-cyan']).toBe(colors.light['brand-cyan']);
    });

    it("derives the button's fills the way button.tsx's classes do", () => {
      const button = frontend('components/ui/button.tsx');
      for (const used of [
        'hover:bg-accent',
        'dark:hover:bg-input/50',
        'dark:hover:bg-accent/50',
        'bg-destructive',
        'dark:bg-destructive/60',
        'dark:bg-input/30',
      ]) {
        expect(button, `button.tsx uses ${used}`).toContain(used);
      }
      const light = palettes.light;
      const dark = palettes.dark;
      const mix = (value: string, percent: number): string =>
        normal(
          `color-mix(in oklab, ${value} ${String(percent)}%, transparent)`,
        );
      expect(normal(colors.light['control-hover'])).toBe(
        normal(light.get('--ui-accent') ?? ''),
      );
      expect(normal(colors.light['ghost-hover'])).toBe(
        normal(light.get('--ui-accent') ?? ''),
      );
      expect(normal(colors.light['destructive-fill'])).toBe(
        normal(light.get('--ui-destructive') ?? ''),
      );
      expect(normal(colors.dark['control-hover'])).toBe(
        mix(dark.get('--gray-bg-medium') ?? '', 50),
      );
      expect(normal(colors.dark['ghost-hover'])).toBe(
        mix(dark.get('--ui-accent') ?? '', 50),
      );
      expect(normal(colors.dark['destructive-fill'])).toBe(
        mix(dark.get('--ui-destructive') ?? '', 60),
      );
      // The outline button's dark fill (bg-input/30) is the field's.
      expect(normal(colors.dark.field)).toBe(
        mix(dark.get('--gray-bg-medium') ?? '', 30),
      );
    });

    it("lifts paper the way the Card's shadow-sm shadow-gray-bg-light/95 does", () => {
      expect(frontend('components/ui/card.tsx')).toContain(
        'shadow-sm shadow-gray-bg-light/95',
      );
      for (const theme of ['light', 'dark'] as const) {
        const sunken = palettes[theme].get('--gray-bg-light') ?? '';
        expect(shadows[theme].paper).toContain(
          `color-mix(in oklab, ${sunken} 95%, transparent)`,
        );
      }
    });

    it("agrees with DESIGN.md's front matter", () => {
      const design = frontMatter(frontend('DESIGN.md'));
      const designColors = design['colors'] as Record<string, string>;
      for (const [name, token] of Object.entries(DESIGN_COLORS)) {
        const written = designColors[name];
        expect(written, `DESIGN.md colors.${name}`).toBeDefined();
        const theirs = hex(parseColor(written ?? ''));
        const ours = hex(parseColor(colors.light[token]));
        const drift = KNOWN_DESIGN_MD_DRIFT[name];
        if (drift) {
          expect(
            theirs,
            `still stale (${drift}); drop it from KNOWN_DESIGN_MD_DRIFT`,
          ).not.toBe(ours);
        } else {
          expect(ours, `${token} vs DESIGN.md colors.${name}`).toBe(theirs);
        }
      }
      expect(design['rounded']).toEqual(radii);
      const designSpace = design['spacing'] as Record<string, string>;
      for (const name of ['hug', 'cluster', 'grid', 'section'] as const) {
        expect(space[name], `spacing.${name}`).toBe(designSpace[name]);
      }
      const type = design['typography'] as Record<
        string,
        Record<string, string>
      >;
      for (const name of ['body', 'label', 'title', 'headline'] as const) {
        expect(fontSizes[name], `typography.${name}.fontSize`).toBe(
          type[name]?.['fontSize'],
        );
        expect(lineHeights[name], `typography.${name}.lineHeight`).toBe(
          type[name]?.['lineHeight'],
        );
      }
      expect(type['body']?.['fontWeight']).toBe(fontWeights.regular);
      expect(type['label']?.['fontWeight']).toBe(fontWeights.medium);
      expect(type['title']?.['fontWeight']).toBe(fontWeights.semibold);

      const components = design['components'] as Record<
        string,
        Record<string, string>
      >;
      const button = own('./button.ts');
      const field = own('./text-field.ts');
      const card = own('./card.ts');
      for (const name of [
        'button-primary',
        'button-outline',
        'button-destructive',
      ]) {
        expect(components[name]?.['height']).toBe('36px');
        expect(components[name]?.['padding']).toBe('8px 16px');
        expect(components[name]?.['rounded']).toBe('{rounded.control}');
      }
      expect(button).toContain('height:36px;margin:0;padding:0 16px;');
      expect(button).toContain('border-radius:var(--tsy-radius-control)');
      expect(components['input']?.['height']).toBe('36px');
      expect(components['input']?.['padding']).toBe('8px 12px');
      expect(field).toContain('min-height:36px;padding:0 12px;');
      expect(components['card']?.['padding']).toBe('16px');
      expect(card).toContain('.body{padding:16px;');
    });

    it("mirrors the dashboard's primitives", () => {
      const facts: [
        file: string,
        theirs: string,
        ours: string,
        ourFile: string,
      ][] = [
        [
          'components/ui/button.tsx',
          'h-9 px-4',
          'height:36px;margin:0;padding:0 16px',
          './button.ts',
        ],
        [
          'components/ui/button.tsx',
          'h-8 rounded-xl gap-1.5 px-3',
          'height:32px;padding:0 12px;gap:6px',
          './button.ts',
        ],
        [
          'components/ui/button.tsx',
          'h-10 rounded-xl px-6',
          'height:40px;padding:0 24px',
          './button.ts',
        ],
        [
          'components/ui/button.tsx',
          'active:scale-[0.98]',
          'transform:scale(0.98)',
          './button.ts',
        ],
        [
          'components/ui/button.tsx',
          'hover:!bg-gray-dark/90',
          'var(--tsy-color-ink) 90%',
          './button.ts',
        ],
        [
          'components/ui/input.tsx',
          'bg-field',
          'background:var(--tsy-color-field)',
          './text-field.ts',
        ],
        [
          'components/ui/input.tsx',
          'hover:!bg-primary/[2%]',
          'var(--tsy-color-ink) 2%',
          './text-field.ts',
        ],
        [
          'components/ui/input.tsx',
          'text-base',
          'font-size:1rem',
          './text-field.ts',
        ],
        [
          'components/ui/input.tsx',
          'md:text-sm',
          '@media (min-width:768px){.box{font-size:var(--tsy-font-size-body)}}',
          './text-field.ts',
        ],
        [
          'components/ui/input.tsx',
          'focus-visible:ring-ring/50 focus-visible:ring-[3px]',
          'var(--tsy-color-ink-tertiary) 50%',
          './element.ts',
        ],
        [
          'components/ui/checkbox.tsx',
          'h-4 w-4 shrink-0 rounded-sm border border-primary',
          'width:16px;height:16px;margin:0;border:1px solid var(--tsy-color-ink);border-radius:4px',
          './checkbox.ts',
        ],
        [
          'components/ui/status-pill.tsx',
          '${base} 12%, var(--ui-pill-surface)',
          'var(--base) 12%,var(--tsy-color-pill-surface)',
          './status-pill.ts',
        ],
        [
          'components/ui/status-pill.tsx',
          'var(--ui-pill-ink) 30%',
          'var(--tsy-color-pill-ink) 30%',
          './status-pill.ts',
        ],
        [
          'components/ui/status-pill.tsx',
          'neutral: "var(--gray-dark-medium)"',
          "neutral: 'var(--tsy-color-ink-secondary)'",
          './status-pill.ts',
        ],
        [
          'components/ui/status-pill.tsx',
          'size-1.5 shrink-0 rounded-full',
          'width:6px;height:6px',
          './status-pill.ts',
        ],
        [
          'components/ui/skeleton.tsx',
          'animate-pulse rounded-md bg-skeleton',
          'background:var(--tsy-color-skeleton)',
          './skeleton.ts',
        ],
        [
          'components/ui/stat-card.tsx',
          'min-h-[44px] items-center justify-between gap-2 px-4 py-2.5',
          'min-height:44px;padding:10px 16px',
          './card.ts',
        ],
        [
          'components/ui/stat-card.tsx',
          'truncate text-sm font-medium text-muted-foreground',
          'color:var(--tsy-color-ink-secondary);font-size:var(--tsy-font-size-label);font-weight:var(--tsy-font-weight-medium)',
          './card.ts',
        ],
        [
          'components/ui/stat-card.tsx',
          'bg-background ring-1 ring-border',
          'box-shadow:0 0 0 1px var(--tsy-color-hairline)',
          './card.ts',
        ],
        [
          'components/ui/data-table.tsx',
          'group-hover:bg-gray-bg-light/70',
          'var(--tsy-color-paper-sunken) 70%',
          './table.ts',
        ],
        [
          'components/ui/data-table.tsx',
          'bg-background border-border/70 border-b',
          'border-bottom:1px solid color-mix(in oklab,var(--tsy-color-hairline) 70%,transparent)',
          './table.ts',
        ],
        [
          'components/ui/data-table-shell.tsx',
          'gap-0 overflow-hidden bg-muted/20 p-0',
          'var(--tsy-color-muted-fill) 20%',
          './table.ts',
        ],
        [
          'components/ui/empty.tsx',
          'gap-6 rounded-lg border-dashed p-6 text-center text-balance md:p-12',
          'gap:24px;min-width:0;padding:24px',
          './empty-state.ts',
        ],
        [
          'components/page-header.tsx',
          'border-b border-gray-dark-medium/20 pb-5',
          'padding-bottom:20px;border-bottom:1px solid color-mix(in oklab,var(--tsy-color-ink-secondary) 20%,transparent)',
          './page-header.ts',
        ],
      ];
      for (const [file, theirs, ours, ourFile] of facts) {
        expect(frontend(file), `${file} still has ${theirs}`).toContain(theirs);
        expect(own(ourFile), `${ourFile} mirrors ${theirs}`).toContain(ours);
      }
    });

    it('sets the page title, the fonts and the breakpoints as the dashboard does', () => {
      expect(globals).toMatch(
        /\.heading-page \{\s*font-weight: 700;\s*font-size: 1\.5rem;/,
      );
      expect(fontSizes['page-title']).toBe('1.5rem');
      expect(globals).toMatch(
        /html\[dir="rtl"\] \.heading-page \{[^}]*font-size: 1\.375rem;/,
      );
      expect(fontSizes['page-title-rtl']).toBe('1.375rem');
      expect(own('./page-header.ts')).toContain(
        'font-weight:var(--tsy-font-weight-bold)',
      );

      const layout = frontend('app/[locale]/layout.tsx');
      expect(layout).toContain('Geist');
      expect(layout).toContain('IBM_Plex_Sans_Arabic');
      expect(fonts.sans.startsWith('"Geist", "IBM Plex Sans Arabic"')).toBe(
        true,
      );

      for (const [name, px] of Object.entries(breakpoints)) {
        expect(globals).toContain(`--breakpoint-${name}: ${String(px)}px;`);
      }
      expect(own('./page-header.ts')).toContain(
        `@media (min-width:${String(breakpoints.sm)}px)`,
      );
    });
  },
);
