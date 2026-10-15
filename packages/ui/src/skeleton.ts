import { h, TsyElement } from './element.js';

export const SKELETON_SHAPES = ['line', 'block', 'circle'] as const;
export type SkeletonShape = (typeof SKELETON_SHAPES)[number];

const STYLES = `
:host{display:block}
.lines{display:flex;flex-direction:column;gap:8px}
.bar{display:block;width:var(--width,100%);height:var(--height,16px);border-radius:6px;background:var(--tsy-color-skeleton);animation:tsy-pulse 2s cubic-bezier(0.4,0,0.6,1) infinite}
.bar.block{height:var(--height,64px);border-radius:var(--tsy-radius-control)}
.bar.circle{width:var(--width,40px);height:var(--height,var(--width,40px));border-radius:50%}
.bar.last{width:var(--width,60%)}
@keyframes tsy-pulse{50%{opacity:0.5}}
@media (prefers-reduced-motion:reduce){.bar{animation:none}}
`;

/** A length the CSS engine accepts, or null. */
function length(
  property: 'width' | 'height',
  value: string | null,
): string | null {
  if (value === null || value === '') return null;
  const css = /^\d+(\.\d+)?$/.test(value) ? `${value}px` : value;
  return typeof CSS === 'undefined' || CSS.supports(property, css) ? css : null;
}

/**
 * `<tsy-skeleton>`: a loading placeholder in the shape of what is coming:
 * a `line` (the default), a `block` or a `circle`, `lines` lines of text
 * (the last one shorter), sized by `width` and `height`. It is hidden from
 * screen readers: mark the region it stands in `aria-busy="true"`.
 */
export class TsySkeleton extends TsyElement {
  static readonly observedAttributes = ['shape', 'lines', 'width', 'height'];

  readonly #lines = h('div', { part: 'base', class: 'lines' });

  constructor() {
    super(STYLES);
    this.shadow.append(this.#lines);
  }

  override connectedCallback(): void {
    this.setAttribute('aria-hidden', 'true');
    super.connectedCallback();
  }

  refresh(): void {
    const shape = this.choice('shape', SKELETON_SHAPES, 'line');
    const asked = Number(this.getAttribute('lines') ?? '1');
    const count =
      shape === 'line' && Number.isInteger(asked)
        ? Math.min(Math.max(asked, 1), 20)
        : 1;
    const bars: HTMLElement[] = [];
    for (let i = 0; i < count; i += 1) {
      const last = count > 1 && i === count - 1;
      bars.push(
        h('span', {
          part: 'bar',
          class: `bar ${shape}${last ? ' last' : ''}`,
        }),
      );
    }
    const width = length('width', this.getAttribute('width'));
    const height = length('height', this.getAttribute('height'));
    for (const [name, value] of [
      ['--width', width],
      ['--height', height],
    ] as const) {
      if (value === null) this.#lines.style.removeProperty(name);
      else this.#lines.style.setProperty(name, value);
    }
    this.#lines.replaceChildren(...bars);
  }
}
