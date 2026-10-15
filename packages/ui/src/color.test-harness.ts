/**
 * Enough CSS colour to measure the tokens' contrast: hex, `rgb()`, `oklch()`,
 * `black`, `white`, `transparent` and `color-mix()` in `srgb` or `oklab`,
 * nested. Colours are gamma-encoded sRGB in 0..1 with alpha; a translucent
 * colour is composited over its ground the way a browser paints it.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Record<string, Rgba> = {
  black: { r: 0, g: 0, b: 0, a: 1 },
  white: { r: 1, g: 1, b: 1, a: 1 },
  transparent: { r: 0, g: 0, b: 0, a: 0 },
};

function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function fromLinear(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.min(1, Math.max(0, v));
}

function oklabToRgb(L: number, A: number, B: number, alpha: number): Rgba {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return {
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a: alpha,
  };
}

function rgbToOklab(c: Rgba): [number, number, number] {
  const r = toLinear(c.r);
  const g = toLinear(c.g);
  const b = toLinear(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Splits `a, b, c` at the commas that are not inside parentheses. */
function topLevel(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of args) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current.trim());
  return parts;
}

function alphaOf(part: string | undefined): number {
  if (part === undefined) return 1;
  const value = part.trim();
  return value.endsWith('%') ? Number(value.slice(0, -1)) / 100 : Number(value);
}

/** Parses one CSS colour into sRGB. */
export function parseColor(input: string): Rgba {
  const text = input.trim().toLowerCase();
  const named = NAMED[text];
  if (named) return { ...named };
  if (text.startsWith('#')) {
    const hex = text.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex;
    if (!/^[0-9a-f]{6}$/.test(full)) throw new Error(`bad hex: ${input}`);
    return {
      r: parseInt(full.slice(0, 2), 16) / 255,
      g: parseInt(full.slice(2, 4), 16) / 255,
      b: parseInt(full.slice(4, 6), 16) / 255,
      a: 1,
    };
  }
  const call = /^([a-z-]+)\((.*)\)$/s.exec(text);
  if (!call) throw new Error(`cannot read colour: ${input}`);
  const [, fn = '', body = ''] = call;
  if (fn === 'rgb' || fn === 'oklch') {
    const [channels = '', alpha] = body.split('/');
    const values = channels.trim().split(/\s+/);
    if (fn === 'rgb') {
      const [r = '0', g = '0', b = '0'] = values;
      return {
        r: Number(r) / 255,
        g: Number(g) / 255,
        b: Number(b) / 255,
        a: alphaOf(alpha),
      };
    }
    const [l = '0', c = '0', h = '0'] = values;
    const L = l.endsWith('%') ? Number(l.slice(0, -1)) / 100 : Number(l);
    const C = Number(c);
    const H = (Number(h) * Math.PI) / 180;
    return oklabToRgb(L, C * Math.cos(H), C * Math.sin(H), alphaOf(alpha));
  }
  if (fn === 'color-mix') {
    const [space = '', first = '', second = ''] = topLevel(body);
    const read = (part: string): { color: Rgba; weight: number | null } => {
      const match = /^(.*?)(?:\s+([\d.]+)%)?$/s.exec(part.trim());
      const color = parseColor(match?.[1] ?? part);
      const weight = match?.[2] === undefined ? null : Number(match[2]) / 100;
      return { color, weight };
    };
    const one = read(first);
    const two = read(second);
    let p1 = one.weight ?? (two.weight === null ? 0.5 : 1 - two.weight);
    let p2 = two.weight ?? 1 - p1;
    const sum = p1 + p2;
    const scale = Math.min(sum, 1);
    p1 /= sum;
    p2 /= sum;
    const alpha = one.color.a * p1 + two.color.a * p2;
    if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
    if (space === 'in srgb') {
      const mix = (x: number, y: number): number =>
        (x * one.color.a * p1 + y * two.color.a * p2) / alpha;
      return {
        r: mix(one.color.r, two.color.r),
        g: mix(one.color.g, two.color.g),
        b: mix(one.color.b, two.color.b),
        a: alpha * scale,
      };
    }
    if (space === 'in oklab') {
      const x = rgbToOklab(one.color);
      const y = rgbToOklab(two.color);
      const mix = (i: 0 | 1 | 2): number =>
        (x[i] * one.color.a * p1 + y[i] * two.color.a * p2) / alpha;
      return oklabToRgb(mix(0), mix(1), mix(2), alpha * scale);
    }
    throw new Error(`unsupported colour space: ${space}`);
  }
  throw new Error(`cannot read colour: ${input}`);
}

/** Paints `top` over an opaque `ground`. */
export function over(top: Rgba, ground: Rgba): Rgba {
  const a = top.a;
  return {
    r: top.r * a + ground.r * (1 - a),
    g: top.g * a + ground.g * (1 - a),
    b: top.b * a + ground.b * (1 - a),
    a: 1,
  };
}

function luminance(c: Rgba): number {
  return (
    0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b)
  );
}

/** WCAG 2 contrast ratio of two opaque colours. */
export function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

/** The colour as #rrggbb (for messages). */
export function hex(c: Rgba): string {
  return `#${[c.r, c.g, c.b]
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}
