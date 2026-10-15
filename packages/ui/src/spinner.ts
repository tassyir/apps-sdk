import { GLYPHS, h, icon, stringsFor, TsyElement } from './element.js';

export const SPINNER_SIZES = ['sm', 'md', 'lg'] as const;
export type SpinnerSize = (typeof SPINNER_SIZES)[number];

const STYLES = `
:host{display:inline-flex;vertical-align:middle}
.spinner{position:relative;display:inline-flex;color:var(--tsy-color-ink-tertiary)}
.spin{width:24px;height:24px;animation:tsy-spin 0.8s linear infinite}
:host([size="sm"]) .spin{width:16px;height:16px}
:host([size="lg"]) .spin{width:32px;height:32px}
@keyframes tsy-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.spin{animation-duration:1.6s}}
`;

/**
 * `<tsy-spinner>`: in-place loading (a button, a row). It is a polite live
 * region that says `label` (default: "Loading", in the page's language). A
 * page or a card that is loading shows `<tsy-skeleton>` instead.
 */
export class TsySpinner extends TsyElement {
  static readonly observedAttributes = ['size', 'label'];

  readonly #label = h('span', { class: 'sr-only' });

  constructor() {
    super(STYLES);
    this.shadow.append(
      h(
        'span',
        { part: 'base', class: 'spinner', role: 'status' },
        icon(GLYPHS.spinner, 'spin'),
        this.#label,
      ),
    );
  }

  refresh(): void {
    this.#label.textContent =
      this.getAttribute('label') ?? stringsFor(this).loading;
  }
}
