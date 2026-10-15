import { FIELD_CSS, FOCUS_RING, h, setOptional, setText } from './element.js';
import { mirrorValidity, TsyFormControl } from './form-control.js';

export const TEXT_FIELD_TYPES = [
  'text',
  'email',
  'number',
  'password',
  'search',
  'tel',
  'url',
] as const;
export type TextFieldType = (typeof TEXT_FIELD_TYPES)[number];

/** Typed left to right whatever the page's direction (DESIGN.md, the doors). */
const LTR_TYPES: readonly TextFieldType[] = ['email', 'password', 'tel', 'url'];

/** Attributes copied as they are onto the inner control. */
const PASSED = [
  'placeholder',
  'autocomplete',
  'inputmode',
  'minlength',
  'maxlength',
  'min',
  'max',
  'step',
  'pattern',
  'spellcheck',
  'enterkeyhint',
] as const;

export const FIELD_BOX_CSS = `
.box{position:relative;display:flex;align-items:center;gap:8px;width:100%;min-height:36px;padding:0 12px;border:1px solid var(--tsy-color-hairline);border-radius:var(--tsy-radius-control);background:var(--tsy-color-field);box-shadow:var(--tsy-shadow-control);color:var(--tsy-color-ink);font-size:1rem;line-height:1.25rem;transition-property:color,background-color,border-color,box-shadow;transition-duration:150ms;transition-timing-function:ease-in-out}
.box:hover{background:color-mix(in oklab,var(--tsy-color-ink) 2%,transparent)}
.box:focus-within{${FOCUS_RING}}
.box.invalid{border-color:var(--tsy-color-destructive)}
.box.invalid:focus-within{box-shadow:0 0 0 3px color-mix(in oklab,var(--tsy-color-destructive) 20%,transparent)}
.box.disabled{opacity:0.5;cursor:not-allowed}
.box.disabled>*{pointer-events:none}
.control{flex:1;min-width:0;height:34px;margin:0;padding:0;border:0;outline:none;background:transparent;color:inherit;font:inherit;font-size:inherit;line-height:inherit}
.control::placeholder{color:var(--tsy-color-ink-secondary);opacity:1}
@media (min-width:768px){.box{font-size:var(--tsy-font-size-body)}}
@media (prefers-reduced-motion:reduce){.box{transition-duration:0s}}
`;

const STYLES = `
:host{display:block}
[part="base"]{position:relative}
${FIELD_CSS}
${FIELD_BOX_CSS}
.affix{flex-shrink:0;color:var(--tsy-color-ink-secondary);font-size:var(--tsy-font-size-body)}
.box.multiline{align-items:stretch;min-height:80px;padding:8px 12px}
textarea.control{height:auto;min-height:62px;resize:vertical}
.control[type="search"]::-webkit-search-cancel-button{cursor:pointer}
.control[type="number"]{-moz-appearance:textfield;appearance:textfield}
.control[type="number"]::-webkit-inner-spin-button,.control[type="number"]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
`;

/**
 * `<tsy-text-field>`: a labelled text input (or `multiline` text area), with
 * an optional hint, an error, and a `prefix` or `suffix` such as a currency.
 * It submits with the form around it under `name`.
 */
export class TsyTextField extends TsyFormControl {
  static readonly observedAttributes = [
    'label',
    'label-hidden',
    'value',
    'type',
    'hint',
    'error',
    'prefix',
    'suffix',
    'required',
    'disabled',
    'readonly',
    'multiline',
    'rows',
    ...PASSED,
  ];

  readonly #label = h('label', {
    part: 'label',
    class: 'label',
    for: 'control',
  });
  readonly #box = h('div', { part: 'box', class: 'box' });
  readonly #prefix = h('span', {
    part: 'prefix',
    class: 'affix',
    id: 'prefix',
  });
  readonly #suffix = h('span', {
    part: 'suffix',
    class: 'affix',
    id: 'suffix',
  });
  readonly #hint = h('p', { part: 'hint', class: 'hint', id: 'hint' });
  readonly #error = h('p', { part: 'error', class: 'error', id: 'error' });
  #control: HTMLInputElement | HTMLTextAreaElement = this.#make('input');
  #dirty = false;

  constructor() {
    super(STYLES, { delegatesFocus: true });
    this.#box.append(this.#prefix, this.#control, this.#suffix);
    this.shadow.append(
      h(
        'div',
        { part: 'base' },
        this.#label,
        this.#box,
        this.#hint,
        this.#error,
      ),
    );
  }

  get value(): string {
    return this.#control.value;
  }

  set value(value: string) {
    this.#control.value = value;
    this.#dirty = true;
    this.#sync();
  }

  get type(): TextFieldType {
    return this.choice('type', TEXT_FIELD_TYPES, 'text');
  }

  set type(value: TextFieldType) {
    this.setAttribute('type', value);
  }

  /**
   * A unit before the value (`prefix` attribute). An accessor, because every
   * element inherits a read-only `prefix` (its XML namespace prefix) that
   * React 19 would otherwise try to assign.
   */
  override get prefix(): string {
    return this.getAttribute('prefix') ?? '';
  }

  override set prefix(value: string) {
    setOptional(this, 'prefix', value);
  }

  /** A unit after the value (`suffix` attribute), such as `DZD`. */
  get suffix(): string {
    return this.getAttribute('suffix') ?? '';
  }

  set suffix(value: string) {
    setOptional(this, 'suffix', value);
  }

  /** Selects the text, as `HTMLInputElement.select()` does. */
  select(): void {
    this.#control.select();
  }

  setCustomValidity(message: string): void {
    this.#control.setCustomValidity(message);
    this.#sync();
  }

  formResetCallback(): void {
    this.#dirty = false;
    this.#control.value = this.getAttribute('value') ?? '';
    this.#sync();
  }

  formStateRestoreCallback(state: unknown): void {
    if (typeof state !== 'string') return;
    this.value = state;
  }

  refresh(): void {
    const multiline = this.hasAttribute('multiline');
    if (multiline !== this.#control instanceof HTMLTextAreaElement) {
      const next = this.#make(multiline ? 'textarea' : 'input');
      next.value = this.#control.value;
      this.#control.replaceWith(next);
      this.#control = next;
    }
    const control = this.#control;
    const label = this.getAttribute('label') ?? '';
    this.#label.textContent = label;
    this.#label.classList.toggle('sr-only', this.hasAttribute('label-hidden'));
    this.#label.hidden = label === '';

    if (control instanceof HTMLInputElement) {
      const type = this.type;
      control.type = type;
      setOptional(control, 'dir', LTR_TYPES.includes(type) ? 'ltr' : null);
    } else {
      setOptional(control, 'rows', this.getAttribute('rows'));
    }
    for (const name of PASSED) {
      setOptional(control, name, this.getAttribute(name));
    }
    control.required = this.required;
    control.readOnly = this.hasAttribute('readonly');
    control.disabled = this.isDisabled;
    if (!this.#dirty) control.value = this.getAttribute('value') ?? '';

    const hint = this.getAttribute('hint') ?? '';
    const error = this.getAttribute('error') ?? '';
    setText(this.#hint, hint);
    setText(this.#error, error);
    setText(this.#prefix, this.getAttribute('prefix') ?? '');
    setText(this.#suffix, this.getAttribute('suffix') ?? '');
    const described = [
      this.#prefix.hidden ? '' : 'prefix',
      this.#suffix.hidden ? '' : 'suffix',
      hint ? 'hint' : '',
      error ? 'error' : '',
    ].filter(Boolean);
    setOptional(control, 'aria-describedby', described.join(' '));
    setOptional(control, 'aria-invalid', error ? 'true' : null);
    this.#box.classList.toggle('invalid', error !== '');
    this.#box.classList.toggle('disabled', this.isDisabled);
    this.#box.classList.toggle('multiline', multiline);
    this.#sync();
  }

  #make(tag: 'input' | 'textarea'): HTMLInputElement | HTMLTextAreaElement {
    const attributes = { part: 'control', class: 'control', id: 'control' };
    const control =
      tag === 'input' ? h('input', attributes) : h('textarea', attributes);
    const target: HTMLElement = control;
    target.addEventListener('input', () => {
      this.#dirty = true;
      this.#sync();
    });
    target.addEventListener('change', () => {
      this.emitChange();
    });
    target.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || tag !== 'input' || event.isComposing) {
        return;
      }
      // In a native field this is the keydown's default action: any
      // listener (the host, the form, a framework's root) may cancel it, so
      // decide once the dispatch is over.
      setTimeout(() => {
        if (!event.defaultPrevented) this.submitImplicitly();
      }, 0);
    });
    return control;
  }

  #sync(): void {
    this.internals?.setFormValue(this.#control.value);
    mirrorValidity(this.internals, this.#control);
  }
}
