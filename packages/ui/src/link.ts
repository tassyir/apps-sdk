import {
  GLYPHS,
  h,
  icon,
  setOptional,
  stringsFor,
  TsyElement,
} from './element.js';

const STYLES = `
:host{display:inline}
a{position:relative;color:inherit;font:inherit;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:4px;border-radius:4px;outline:none;cursor:pointer;transition:color 150ms ease-in-out}
a:hover{color:var(--tsy-color-ink)}
a:focus-visible{box-shadow:0 0 0 3px color-mix(in oklab,var(--tsy-color-ink-tertiary) 50%,transparent)}
.icon{display:inline-block;width:16px;height:16px;margin-inline-start:2px;vertical-align:-3px}
:host(:dir(rtl)) .icon{transform:scaleX(-1)}
@media (prefers-reduced-motion:reduce){a{transition:none}}
`;

/**
 * `<tsy-link>`: an underlined link in the surrounding text's colour, ink on
 * hover. `external` opens it in a new tab (`noopener noreferrer`) and says so
 * to screen readers.
 */
export class TsyLink extends TsyElement {
  static readonly observedAttributes = [
    'href',
    'target',
    'rel',
    'external',
    'download',
    'aria-label',
  ];

  readonly #anchor = h('a', { part: 'link' });
  readonly #external = icon(GLYPHS.external);
  readonly #newTab = h('span', { class: 'sr-only' });

  constructor() {
    super(STYLES, { delegatesFocus: true });
    this.#anchor.append(
      document.createElement('slot'),
      this.#external,
      this.#newTab,
    );
    this.shadow.append(this.#anchor);
  }

  get href(): string {
    return this.getAttribute('href') ?? '';
  }

  set href(value: string) {
    setOptional(this, 'href', value);
  }

  refresh(): void {
    const external = this.hasAttribute('external');
    setOptional(this.#anchor, 'href', this.getAttribute('href'));
    setOptional(this.#anchor, 'download', this.getAttribute('download'));
    setOptional(this.#anchor, 'aria-label', this.getAttribute('aria-label'));
    setOptional(
      this.#anchor,
      'target',
      external ? '_blank' : this.getAttribute('target'),
    );
    setOptional(
      this.#anchor,
      'rel',
      external ? 'noopener noreferrer' : this.getAttribute('rel'),
    );
    this.#external.toggleAttribute('hidden', !external);
    this.#newTab.textContent = external ? ` ${stringsFor(this).newTab}` : '';
  }
}
