import { FIELD_CSS, GLYPHS, h, icon, setOptional, setText } from './element.js';
import { mirrorValidity, TsyFormControl } from './form-control.js';

/** The row a checkbox or a radio sits in: its mark, then its label. */
export const CHOICE_CSS = `
.row{display:inline-flex;align-items:flex-start;gap:8px;min-height:24px;padding-block:2px;color:var(--tsy-color-ink);font-size:var(--tsy-font-size-label);font-weight:var(--tsy-font-weight-medium);line-height:1.25rem;cursor:pointer}
.mark-box{position:relative;display:inline-flex;flex-shrink:0;width:16px;height:16px;margin-top:2px}
.row.disabled{opacity:0.5;cursor:not-allowed}
.hint,.error{margin-top:2px;padding-inline-start:24px}
`;

const STYLES = `
:host{display:block}
${FIELD_CSS}
${CHOICE_CSS}
.control{appearance:none;-webkit-appearance:none;width:16px;height:16px;margin:0;border:1px solid var(--tsy-color-ink);border-radius:4px;background:transparent;cursor:inherit;outline:none;transition:background-color 150ms ease-in-out,box-shadow 150ms ease-in-out}
.control:checked,.control:indeterminate{background:var(--tsy-color-ink)}
.control:focus-visible{box-shadow:0 0 0 2px var(--tsy-color-paper),0 0 0 4px var(--tsy-color-ink-tertiary)}
.control[aria-invalid="true"]{border-color:var(--tsy-color-destructive)}
.mark{position:absolute;inset:0;color:var(--tsy-color-on-ink);opacity:0;pointer-events:none}
.control:checked:not(:indeterminate)~.check,.control:indeterminate~.dash{opacity:1}
@media (prefers-reduced-motion:reduce){.control{transition:none}}
`;

/**
 * `<tsy-checkbox>`: a checkbox with its label as content. It submits `value`
 * (default `on`) under `name` while checked.
 */
export class TsyCheckbox extends TsyFormControl {
  static readonly observedAttributes = [
    'checked',
    'indeterminate',
    'value',
    'hint',
    'error',
    'required',
    'disabled',
    'aria-label',
  ];

  readonly #control = h('input', {
    type: 'checkbox',
    part: 'control',
    class: 'control',
    id: 'control',
  });
  readonly #row = h('label', { part: 'row', class: 'row', for: 'control' });
  readonly #hint = h('p', { part: 'hint', class: 'hint', id: 'hint' });
  readonly #error = h('p', { part: 'error', class: 'error', id: 'error' });
  #dirty = false;

  constructor() {
    super(STYLES, { delegatesFocus: true });
    this.#row.append(
      h(
        'span',
        { class: 'mark-box' },
        this.#control,
        icon(GLYPHS.check, 'mark check'),
        icon(GLYPHS.dash, 'mark dash'),
      ),
      h('span', { part: 'label' }, document.createElement('slot')),
    );
    this.shadow.append(
      h('div', { part: 'base' }, this.#row, this.#hint, this.#error),
    );
    // The form value follows on `input`, which fires before `change`, so a
    // page's `input` listener already reads the new state.
    this.#control.addEventListener('input', () => {
      this.#dirty = true;
      this.toggleAttribute('indeterminate', false);
      this.#sync();
    });
    this.#control.addEventListener('change', () => {
      this.#dirty = true;
      this.#sync();
      this.emitChange();
    });
  }

  get checked(): boolean {
    return this.#control.checked;
  }

  set checked(value: boolean) {
    this.#control.checked = value;
    this.#dirty = true;
    this.#sync();
  }

  /** Neither checked nor unchecked (a "select all" over a partial selection). */
  get indeterminate(): boolean {
    return this.#control.indeterminate;
  }

  set indeterminate(value: boolean) {
    this.flag('indeterminate', value);
  }

  get value(): string {
    return this.getAttribute('value') ?? 'on';
  }

  set value(value: string) {
    this.setAttribute('value', value);
  }

  setCustomValidity(message: string): void {
    this.#control.setCustomValidity(message);
    this.#sync();
  }

  formResetCallback(): void {
    this.#dirty = false;
    this.#control.checked = this.hasAttribute('checked');
    this.#sync();
  }

  formStateRestoreCallback(state: unknown): void {
    this.checked = typeof state === 'string';
  }

  refresh(): void {
    const control = this.#control;
    if (!this.#dirty) control.checked = this.hasAttribute('checked');
    control.indeterminate = this.hasAttribute('indeterminate');
    control.required = this.required;
    control.disabled = this.isDisabled;
    setOptional(control, 'aria-label', this.getAttribute('aria-label'));
    const hint = this.getAttribute('hint') ?? '';
    const error = this.getAttribute('error') ?? '';
    setText(this.#hint, hint);
    setText(this.#error, error);
    setOptional(
      control,
      'aria-describedby',
      [hint ? 'hint' : '', error ? 'error' : ''].filter(Boolean).join(' '),
    );
    setOptional(control, 'aria-invalid', error ? 'true' : null);
    this.#row.classList.toggle('disabled', this.isDisabled);
    this.#sync();
  }

  #sync(): void {
    this.internals?.setFormValue(this.#control.checked ? this.value : null);
    mirrorValidity(this.internals, this.#control);
  }
}
