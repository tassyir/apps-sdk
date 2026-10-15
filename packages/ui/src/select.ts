import { FIELD_CSS, GLYPHS, h, icon, setOptional, setText } from './element.js';
import { mirrorValidity, TsyFormControl } from './form-control.js';
import { FIELD_BOX_CSS } from './text-field.js';

const STYLES = `
:host{display:block}
[part="base"]{position:relative}
${FIELD_CSS}
${FIELD_BOX_CSS}
.box{padding:0}
.control{appearance:none;-webkit-appearance:none;width:100%;height:34px;padding-inline:12px 36px;cursor:pointer;text-overflow:ellipsis}
.control.placeholder{color:var(--tsy-color-ink-secondary)}
.control option{color:var(--tsy-color-ink);background:var(--tsy-color-paper)}
.caret{position:absolute;inset-inline-end:12px;top:50%;margin-top:-8px;color:var(--tsy-color-ink);opacity:0.5;pointer-events:none}
`;

/**
 * `<tsy-select>`: a labelled native select. Write its `<option>` (and
 * `<optgroup>`) elements inside it; they are mirrored into the control, so
 * the phone's own picker opens. `placeholder` adds an empty first choice.
 */
export class TsySelect extends TsyFormControl {
  static readonly observedAttributes = [
    'label',
    'label-hidden',
    'value',
    'placeholder',
    'hint',
    'error',
    'required',
    'disabled',
    'autocomplete',
  ];

  readonly #label = h('label', {
    part: 'label',
    class: 'label',
    for: 'control',
  });
  readonly #control = h('select', {
    part: 'control',
    class: 'control',
    id: 'control',
  });
  readonly #box = h('div', { part: 'box', class: 'box' });
  readonly #hint = h('p', { part: 'hint', class: 'hint', id: 'hint' });
  readonly #error = h('p', { part: 'error', class: 'error', id: 'error' });
  readonly #options =
    typeof MutationObserver === 'undefined'
      ? undefined
      : new MutationObserver(() => {
          this.#mirror();
        });
  /** The value the app or the merchant chose, kept across option changes. */
  #chosen: string | null = null;
  #dirty = false;

  constructor() {
    super(STYLES, { delegatesFocus: true });
    this.#box.append(this.#control, icon(GLYPHS.caretDown, 'caret'));
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
    this.#control.addEventListener('input', () => {
      this.#chosen = this.#control.value;
      this.#dirty = true;
      this.#sync();
    });
    this.#control.addEventListener('change', () => {
      this.emitChange();
    });
  }

  get value(): string {
    this.#flush();
    return this.#control.value;
  }

  /**
   * Chooses an option. Kept when the options change afterwards (set the
   * value, then replace the options, or the other way round): the choice
   * applies as soon as an option has that value.
   */
  set value(value: string) {
    this.#chosen = value;
    this.#dirty = true;
    this.#options?.takeRecords();
    this.#mirror();
  }

  /** The mirrored options, as the inner select holds them. */
  get options(): HTMLOptionsCollection {
    this.#flush();
    return this.#control.options;
  }

  get selectedIndex(): number {
    this.#flush();
    return this.#control.selectedIndex;
  }

  setCustomValidity(message: string): void {
    this.#control.setCustomValidity(message);
    this.#sync();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#mirror();
    this.#options?.observe(this, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#options?.disconnect();
  }

  formResetCallback(): void {
    this.#dirty = false;
    this.#chosen = null;
    this.#mirror();
  }

  formStateRestoreCallback(state: unknown): void {
    if (typeof state !== 'string') return;
    this.value = state;
  }

  refresh(): void {
    const label = this.getAttribute('label') ?? '';
    this.#label.textContent = label;
    this.#label.classList.toggle('sr-only', this.hasAttribute('label-hidden'));
    this.#label.hidden = label === '';
    const control = this.#control;
    control.required = this.required;
    control.disabled = this.isDisabled;
    setOptional(control, 'autocomplete', this.getAttribute('autocomplete'));
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
    this.#box.classList.toggle('invalid', error !== '');
    this.#box.classList.toggle('disabled', this.isDisabled);
    if (this.isConnected) this.#mirror();
  }

  /**
   * Option changes not mirrored yet (the observer reports them later, and
   * only while connected): mirror them now, before a read.
   */
  #flush(): void {
    const pending = this.#options?.takeRecords().length ?? 0;
    if (pending > 0 || !this.isConnected) this.#mirror();
  }

  /** Copies the light-DOM options into the control, keeping the choice. */
  #mirror(): void {
    const control = this.#control;
    const copies: Node[] = [];
    const placeholder = this.getAttribute('placeholder');
    if (placeholder !== null) {
      copies.push(
        h('option', { value: '', disabled: '', hidden: '' }, placeholder),
      );
    }
    for (const child of Array.from(this.children)) {
      if (
        child instanceof HTMLOptionElement ||
        child instanceof HTMLOptGroupElement
      ) {
        copies.push(child.cloneNode(true));
      }
    }
    control.replaceChildren(...copies);
    const wanted = this.#dirty ? this.#chosen : this.getAttribute('value');
    const options = Array.from(control.options);
    const match =
      wanted === null ? undefined : options.find((o) => o.value === wanted);
    const preset = options.find((o) => o.defaultSelected);
    if (match) control.value = match.value;
    else if (preset) control.value = preset.value;
    else if (placeholder !== null) control.selectedIndex = 0;
    this.#sync();
  }

  #sync(): void {
    this.#control.classList.toggle(
      'placeholder',
      this.hasAttribute('placeholder') && this.#control.value === '',
    );
    this.internals?.setFormValue(this.#control.value);
    mirrorValidity(this.internals, this.#control);
  }
}
