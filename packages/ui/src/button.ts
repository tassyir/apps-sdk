import { FOCUS_RING, GLYPHS, h, icon, setOptional } from './element.js';
import { TsyFormControl } from './form-control.js';

export const BUTTON_VARIANTS = [
  'primary',
  'outline',
  'ghost',
  'destructive',
] as const;
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];

export const BUTTON_SIZES = ['sm', 'md', 'lg'] as const;
export type ButtonSize = (typeof BUTTON_SIZES)[number];

const STYLES = `
:host{display:inline-block;vertical-align:middle}
:host([full-width]){display:block;width:100%}
.control{display:inline-flex;align-items:center;justify-content:center;gap:4px;width:100%;height:36px;margin:0;padding:0 16px;border:1px solid var(--tsy-color-hairline);border-radius:var(--tsy-radius-control);background:var(--tsy-color-field);box-shadow:var(--tsy-shadow-control);color:var(--tsy-color-ink);font:inherit;font-size:var(--tsy-font-size-body);font-weight:var(--tsy-font-weight-medium);line-height:1.25rem;white-space:nowrap;text-decoration:none;cursor:pointer;outline:none;user-select:none;-webkit-user-select:none;transition-property:color,background-color,border-color,box-shadow,transform;transition-duration:150ms;transition-timing-function:ease-in-out}
.control:hover{background:var(--tsy-color-control-hover)}
.control:active{transform:scale(0.98)}
.control:focus-visible{${FOCUS_RING}}
:host([size="sm"]) .control{height:32px;padding:0 12px;gap:6px}
:host([size="lg"]) .control{height:40px;padding:0 24px}
:host([square]) .control{width:36px;padding:0}
:host([square][size="sm"]) .control{width:32px}
:host([square][size="lg"]) .control{width:40px}
:host([variant="primary"]) .control{border-color:transparent;background:var(--tsy-color-ink);color:var(--tsy-color-on-ink)}
:host([variant="primary"]) .control:hover{background:color-mix(in oklab,var(--tsy-color-ink) 90%,transparent)}
:host([variant="ghost"]) .control{border-color:transparent;background:transparent;box-shadow:none}
:host([variant="ghost"]) .control:hover{background:var(--tsy-color-ghost-hover)}
:host([variant="destructive"]) .control{border-color:transparent;background:var(--tsy-color-destructive-fill);color:var(--tsy-color-destructive-on)}
:host([variant="destructive"]) .control:hover{background:color-mix(in oklab,var(--tsy-color-destructive-fill) 90%,transparent)}
:host([variant="destructive"]) .control:focus-visible{box-shadow:0 0 0 3px color-mix(in oklab,var(--tsy-color-destructive) 20%,transparent)}
.control:disabled,.control[aria-disabled="true"]{opacity:0.5;pointer-events:none;cursor:default}
::slotted(svg){width:16px;height:16px;flex-shrink:0}
.spin{animation:tsy-spin 0.8s linear infinite}
@keyframes tsy-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.control{transition-duration:0s}.control:active{transform:none}.spin{animation-duration:1.6s}}
`;

/**
 * `<tsy-button>`: the dashboard's button. `variant="primary"` is the ink
 * button, ONE per view; everything else is `outline` (the default), `ghost`
 * or `destructive`. With `href` it is a link that looks like a button.
 * `type="submit"` submits the form around it.
 */
export class TsyButton extends TsyFormControl {
  static readonly observedAttributes = [
    'variant',
    'size',
    'type',
    'disabled',
    'loading',
    'href',
    'target',
    'rel',
    'download',
    'aria-label',
    'aria-pressed',
    'aria-expanded',
  ];

  readonly #button = h('button', { part: 'control', class: 'control' });
  readonly #link = h('a', { part: 'control', class: 'control' });
  readonly #spinner = icon(GLYPHS.spinner, 'spin');

  constructor() {
    super(STYLES, { delegatesFocus: true });
    this.#spinner.toggleAttribute('hidden', true);
    this.#button.append(this.#spinner, document.createElement('slot'));
    this.shadow.append(this.#button);
    this.addEventListener('click', (event) => {
      this.#onClick(event);
    });
  }

  get variant(): ButtonVariant {
    return this.choice('variant', BUTTON_VARIANTS, 'outline');
  }

  set variant(value: ButtonVariant) {
    this.setAttribute('variant', value);
  }

  get type(): 'button' | 'submit' | 'reset' {
    return this.choice('type', ['button', 'submit', 'reset'], 'button');
  }

  set type(value: 'button' | 'submit' | 'reset') {
    this.setAttribute('type', value);
  }

  get loading(): boolean {
    return this.hasAttribute('loading');
  }

  set loading(value: boolean) {
    this.flag('loading', value);
  }

  get href(): string {
    return this.getAttribute('href') ?? '';
  }

  set href(value: string) {
    setOptional(this, 'href', value);
  }

  formResetCallback(): void {
    // A button holds no value.
  }

  refresh(): void {
    const isLink = this.hasAttribute('href');
    const control = isLink ? this.#link : this.#button;
    const other = isLink ? this.#button : this.#link;
    if (control.parentNode !== this.shadow) {
      control.replaceChildren(...other.childNodes);
      other.replaceWith(control);
    }
    const off = this.isDisabled;
    const busy = this.loading;
    if (isLink) {
      setOptional(this.#link, 'href', off ? null : this.href);
      setOptional(this.#link, 'target', this.getAttribute('target'));
      setOptional(this.#link, 'rel', this.getAttribute('rel'));
      setOptional(this.#link, 'download', this.getAttribute('download'));
      setOptional(this.#link, 'role', off ? 'link' : null);
      setOptional(this.#link, 'aria-disabled', off || busy ? 'true' : null);
    } else {
      this.#button.type = 'button';
      this.#button.disabled = off;
      setOptional(this.#button, 'aria-disabled', busy ? 'true' : null);
    }
    setOptional(control, 'aria-busy', busy ? 'true' : null);
    for (const name of ['aria-label', 'aria-pressed', 'aria-expanded']) {
      setOptional(control, name, this.getAttribute(name));
    }
    this.#spinner.toggleAttribute('hidden', !busy);
  }

  #onClick(event: MouseEvent): void {
    if (this.isDisabled || this.loading) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (this.hasAttribute('href')) return;
    const type = this.type;
    if (type === 'button') return;
    // A native submit button acts after every listener had its say: wait
    // for the dispatch to end, then act unless a listener prevented it.
    setTimeout(() => {
      if (event.defaultPrevented) return;
      if (type === 'submit') this.submitForm();
      else this.form?.reset();
    }, 0);
  }
}
