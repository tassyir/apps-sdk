import { describe, expect, it } from 'vitest';
import {
  contrast,
  hex,
  over,
  parseColor,
  type Rgba,
} from './color.test-harness.js';
import {
  colors,
  COLOR_TOKENS,
  cssVariable,
  fonts,
  fontSizes,
  radii,
  shadows,
  space,
  tokensCss,
  type ColorToken,
  type Theme,
} from './tokens.js';

const THEMES: readonly Theme[] = ['light', 'dark'];

function color(theme: Theme, token: ColorToken): Rgba {
  return parseColor(colors[theme][token]);
}

/** A token painted on the page (paper), as the eye meets it. */
function onPaper(theme: Theme, value: Rgba): Rgba {
  return over(value, color(theme, 'paper'));
}

describe('tokens', () => {
  it('give every colour token a value in both themes', () => {
    for (const theme of THEMES) {
      expect(Object.keys(colors[theme]).sort()).toEqual(
        [...COLOR_TOKENS].sort(),
      );
      for (const token of COLOR_TOKENS) {
        expect(() => parseColor(colors[theme][token])).not.toThrow();
      }
    }
  });

  it('write every token into the stylesheet, light on :root, dark on [data-theme="dark"]', () => {
    const css = tokensCss();
    expect(css.startsWith('@layer tassyir-ui{')).toBe(true);
    const light = /:root,\[data-theme="light"\]\{([^}]*)\}/.exec(css)?.[1];
    const dark = /\[data-theme="dark"\]\{([^}]*)\}/.exec(css)?.[1];
    expect(light).toContain('color-scheme:light;');
    expect(dark).toContain('color-scheme:dark;');
    for (const token of COLOR_TOKENS) {
      expect(light).toContain(
        `${cssVariable('color', token)}:${colors.light[token]};`,
      );
      expect(dark).toContain(
        `${cssVariable('color', token)}:${colors.dark[token]};`,
      );
    }
    for (const [name, value] of Object.entries(shadows.dark)) {
      expect(dark).toContain(`--tsy-shadow-${name}:${value};`);
    }
    for (const [group, values] of [
      ['font', fonts],
      ['font-size', fontSizes],
      ['space', space],
      ['radius', radii],
    ] as const) {
      for (const [name, value] of Object.entries(values)) {
        expect(css).toContain(`--tsy-${group}-${name}:${value};`);
      }
    }
  });

  it('keep the 14px floor', () => {
    for (const size of Object.values(fontSizes)) {
      expect(Number.parseFloat(size) * 16).toBeGreaterThanOrEqual(14);
    }
  });

  it('keep the neutrals uncoloured (chroma 0)', () => {
    const neutrals: ColorToken[] = [
      'paper',
      'paper-sunken',
      'muted-fill',
      'accent-fill',
      'hairline',
    ];
    for (const theme of THEMES) {
      for (const token of neutrals) {
        expect(colors[theme][token]).toMatch(/^oklch\([\d.]+ 0 0\)$/);
      }
    }
  });
});

/**
 * Every text pair the elements paint, measured on its real ground (WCAG AA,
 * 4.5:1 for body text). DESIGN.md: "Every text pair was measured".
 */
describe('contrast', () => {
  const pairs: {
    name: string;
    text: (theme: Theme) => Rgba;
    ground: (theme: Theme) => Rgba;
  }[] = [
    {
      name: 'ink on paper',
      text: (t) => color(t, 'ink'),
      ground: (t) => color(t, 'paper'),
    },
    {
      name: 'secondary ink on paper (hints, meta)',
      text: (t) => color(t, 'ink-secondary'),
      ground: (t) => color(t, 'paper'),
    },
    {
      name: 'secondary ink on a tinted header (card, table)',
      text: (t) => color(t, 'ink-secondary'),
      ground: (t) =>
        onPaper(
          t,
          parseColor(
            `color-mix(in oklab, ${colors[t]['muted-fill']} 20%, transparent)`,
          ),
        ),
    },
    {
      name: 'secondary ink as a placeholder in a field',
      text: (t) => color(t, 'ink-secondary'),
      ground: (t) => onPaper(t, color(t, 'field')),
    },
    {
      name: 'the primary button (on-ink on ink)',
      text: (t) => color(t, 'on-ink'),
      ground: (t) => color(t, 'ink'),
    },
    {
      name: 'the destructive button (destructive-on on its fill)',
      text: (t) => color(t, 'destructive-on'),
      ground: (t) => onPaper(t, color(t, 'destructive-fill')),
    },
    {
      name: 'ink on the muted fill (count chips)',
      text: (t) => color(t, 'ink'),
      ground: (t) => color(t, 'muted-fill'),
    },
    {
      name: 'an error message (destructive on paper)',
      text: (t) => color(t, 'destructive'),
      ground: (t) => color(t, 'paper'),
    },
    {
      name: 'success text on paper',
      text: (t) => color(t, 'success'),
      ground: (t) => color(t, 'paper'),
    },
    {
      name: 'ink on the info banner',
      text: (t) => color(t, 'ink'),
      ground: (t) => color(t, 'info-soft'),
    },
    {
      name: 'ink on the success banner',
      text: (t) => color(t, 'ink'),
      ground: (t) => color(t, 'success-soft'),
    },
    {
      name: 'warning ink on the warning banner',
      text: (t) => color(t, 'warning-ink'),
      ground: (t) => color(t, 'warning-soft'),
    },
    {
      name: 'ink on the critical banner',
      text: (t) => color(t, 'ink'),
      ground: (t) => color(t, 'destructive-soft'),
    },
  ];

  it("measures what DESIGN.md measured (the engine's calibration)", () => {
    // "#00873C at 4.63:1" on white; dark: "ink 16:1 on paper, secondary ink
    // 7.4:1", "the tertiary ink (placeholder level) is 3.9:1".
    expect(
      contrast(color('light', 'success'), color('light', 'paper')),
    ).toBeCloseTo(4.63, 1);
    expect(hex(color('light', 'success'))).toBe('#00873c');
    expect(contrast(color('dark', 'ink'), color('dark', 'paper'))).toBeCloseTo(
      16,
      0,
    );
    expect(
      contrast(color('dark', 'ink-secondary'), color('dark', 'paper')),
    ).toBeCloseTo(7.4, 1);
    expect(
      contrast(color('dark', 'ink-tertiary'), color('dark', 'paper')),
    ).toBeCloseTo(3.9, 1);
    expect(
      contrast(color('light', 'warning'), color('light', 'paper')),
    ).toBeLessThan(3);
  });

  for (const theme of THEMES) {
    for (const pair of pairs) {
      it(`${theme}: ${pair.name} is at least 4.5:1`, () => {
        const text = pair.text(theme);
        const ground = pair.ground(theme);
        const ratio = contrast(text, ground);
        expect(
          ratio,
          `${hex(text)} on ${hex(ground)} is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      });
    }

    for (const tone of [
      'ink-secondary',
      'success',
      'warning',
      'destructive',
      'info',
      'purple',
    ] as const) {
      it(`${theme}: a ${tone} status pill's words are at least 4.5:1 on its tint`, () => {
        const base = colors[theme][tone];
        const fill = parseColor(
          `color-mix(in srgb, ${base} 12%, ${colors[theme]['pill-surface']})`,
        );
        const words = parseColor(
          `color-mix(in srgb, ${base}, ${colors[theme]['pill-ink']} 30%)`,
        );
        const ratio = contrast(words, onPaper(theme, fill));
        expect(
          ratio,
          `${hex(words)} on ${hex(fill)} is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
