import { CHOICE_CSS } from './checkbox.js';
import {
  FIELD_CSS,
  h,
  isRtl,
  setOptional,
  setText,
  stringsFor,
  TsyElement,
} from './element.js';
import { TsyFormControl } from './form-control.js';

const RADIO_STYLES = `
:host{display:block;border-radius:6px;outline:none}
${CHOICE_CSS}
.circle{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border:1px solid var(--tsy-color-ink);border-radius:50%;transition:box-shadow 150ms ease-in-out}
.dot{width:8px;height:8px;border-radius:50%;background:var(--tsy-color-ink);opacity:0}
:host([aria-checked="true"]) .dot{opacity:1}
:host(:focus-visible) .circle{box-shadow:0 0 0 2px var(--tsy-color-paper),0 0 0 4px var(--tsy-color-ink-tertiary)}
:host([aria-disabled="true"]) .row{opacity:0.5;cursor:not-allowed}
.hint{display:block;margin:0;padding-inline-start:24px;color:var(--tsy-color-ink-secondary);font-size:var(--tsy-font-size-body);font-weight:var(--tsy-font-weight-regular);line-height:1.25rem}
@media (prefers-reduced-motion:reduce){.circle{transition:none}}
`;

/**
 * `<tsy-radio>`: one choice of a `<tsy-radio-group>`, its label as content.
 * The group manages it: checked state, focus and keyboard.
 */
export class TsyRadio extends TsyElement {
  static readonly observedAttributes = ['value', 'hint', 'disabled'];

  readonly #hint = h('span', {
    part: 'hint',
    class: 'hint',
    'aria-hidden': 'true',
  });

  constructor() {
    super(RADIO_STYLES);
    this.shadow.append(
      h(
        'span',
        { part: 'row', class: 'row' },
        h(
          'span',
          { part: 'control', class: 'circle mark-box' },
          h('span', { class: 'dot' }),
        ),
        h('span', { part: 'label' }, document.createElement('slot')),
      ),
      this.#hint,
    );
  }

  get value(): string {
    return this.getAttribute('value') ?? '';
  }

  set value(value: string) {
    this.setAttribute('value', value);
  }

  get disabled(): boolean {
    return this.hasAttribute('disabled');
  }

  set disabled(value: boolean) {
    this.flag('disabled', value);
  }

  /** Whether the group has chosen this radio. */
  get checked(): boolean {
    return this.getAttribute('aria-checked') === 'true';
  }

  /** Chooses this radio in its group (or unchooses it), without events. */
  set checked(value: boolean) {
    const group = this.#group();
    if (!group) {
      this.setAttribute('aria-checked', value ? 'true' : 'false');
    } else if (value) {
      group.value = this.value;
    } else if (this.checked) {
      group.value = '';
    }
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'radio');
    if (!this.hasAttribute('aria-checked')) {
      this.setAttribute('aria-checked', 'false');
    }
    this.#group()?.refresh();
  }

  refresh(): void {
    const hint = this.getAttribute('hint') ?? '';
    setText(this.#hint, hint);
    setOptional(this, 'aria-description', hint);
    this.#group()?.arrange();
  }

  #group(): TsyRadioGroup | null {
    const parent = this.parentElement;
    return parent instanceof TsyRadioGroup ? parent : null;
  }
}

const GROUP_STYLES = `
:host{display:block}
${FIELD_CSS}
.options{display:flex;flex-direction:column;gap:var(--tsy-space-hug)}
:host([orientation="horizontal"]) .options{flex-direction:row;flex-wrap:wrap;column-gap:var(--tsy-space-grid)}
`;

/**
 * `<tsy-radio-group>`: a labelled set of `<tsy-radio>` choices. Arrow keys
 * move and choose (mirrored in right-to-left pages), Tab enters and leaves
 * the group. It submits the chosen `value` under `name`.
 */
export class TsyRadioGroup extends TsyFormControl {
  static readonly observedAttributes = [
    'label',
    'value',
    'hint',
    'error',
    'required',
    'disabled',
    'orientation',
  ];

  readonly #label = h('div', { part: 'label', class: 'label', id: 'label' });
  readonly #group = h('div', {
    part: 'base',
    role: 'radiogroup',
    'aria-labelledby': 'label',
  });
  readonly #hint = h('p', { part: 'hint', class: 'hint', id: 'hint' });
  readonly #error = h('p', { part: 'error', class: 'error', id: 'error' });
  readonly #slot = document.createElement('slot');
  #value: string | null = null;
  #dirty = false;
  /** The message of setCustomValidity, or `''`. */
  #custom = '';

  constructor() {
    super(GROUP_STYLES);
    this.#group.append(
      this.#label,
      h('div', { part: 'options', class: 'options' }, this.#slot),
      this.#hint,
      this.#error,
    );
    this.shadow.append(this.#group);
    // A radio added or removed later (a filtered list) re-arranges the
    // group: the choice, the Tab stop and the form value follow.
    this.#slot.addEventListener('slotchange', () => {
      this.arrange();
    });
    this.addEventListener('click', (event) => {
      const radio = this.#radioOf(event.target);
      if (radio) this.#choose(radio, true);
    });
    this.addEventListener('keydown', (event) => {
      this.#onKey(event);
    });
  }

  /** The chosen radio's value, or `''` when none is chosen. */
  get value(): string {
    const radios = this.radios;
    if (radios.length === 0) return this.#value ?? '';
    return radios.find((radio) => radio.checked)?.value ?? '';
  }

  set value(value: string) {
    this.#value = value;
    this.#dirty = true;
    this.arrange();
  }

  get radios(): TsyRadio[] {
    return Array.from(this.children).filter(
      (child): child is TsyRadio => child instanceof TsyRadio,
    );
  }

  /** Blocks the form with `message` until it is called with `''`. */
  setCustomValidity(message: string): void {
    this.#custom = message;
    this.arrange();
  }

  formResetCallback(): void {
    this.#dirty = false;
    this.#value = this.getAttribute('value');
    this.arrange();
  }

  formStateRestoreCallback(state: unknown): void {
    if (typeof state === 'string') this.value = state;
  }

  override focus(options?: FocusOptions): void {
    const radios = this.radios;
    (radios.find((r) => r.tabIndex === 0) ?? radios[0])?.focus(options);
  }

  refresh(): void {
    const label = this.getAttribute('label') ?? '';
    setText(this.#label, label);
    const hint = this.getAttribute('hint') ?? '';
    const error = this.getAttribute('error') ?? '';
    setText(this.#hint, hint);
    setText(this.#error, error);
    setOptional(
      this.#group,
      'aria-describedby',
      [hint ? 'hint' : '', error ? 'error' : ''].filter(Boolean).join(' '),
    );
    setOptional(this.#group, 'aria-invalid', error ? 'true' : null);
    setOptional(this.#group, 'aria-required', this.required ? 'true' : null);
    setOptional(this.#group, 'aria-disabled', this.isDisabled ? 'true' : null);
    setOptional(
      this.#group,
      'aria-orientation',
      this.getAttribute('orientation') === 'horizontal' ? 'horizontal' : null,
    );
    if (!this.#dirty) this.#value = this.getAttribute('value');
    this.arrange();
  }

  /** Brings every radio's state, focus order, form value and validity in line. */
  arrange(): void {
    const radios = this.radios;
    const off = this.isDisabled;
    const chosen = radios.find(
      (r) => this.#value !== null && r.value === this.#value,
    );
    const enabled = radios.filter((r) => !off && !r.disabled);
    const tabStop = chosen && enabled.includes(chosen) ? chosen : enabled[0];
    for (const radio of radios) {
      radio.setAttribute('aria-checked', radio === chosen ? 'true' : 'false');
      setOptional(
        radio,
        'aria-disabled',
        off || radio.disabled ? 'true' : null,
      );
      radio.tabIndex = radio === tabStop ? 0 : -1;
    }
    const value = chosen ? chosen.value : null;
    this.internals?.setFormValue(value);
    const anchor = tabStop ?? radios[0];
    if (this.#custom) {
      this.internals?.setValidity({ customError: true }, this.#custom, anchor);
    } else if (this.required && !chosen) {
      this.internals?.setValidity(
        { valueMissing: true },
        stringsFor(this).chooseOption,
        anchor,
      );
    } else {
      this.internals?.setValidity({});
    }
  }

  #radioOf(target: EventTarget | null): TsyRadio | null {
    if (!(target instanceof Element)) return null;
    const radio = target.closest('tsy-radio');
    return radio instanceof TsyRadio && radio.parentElement === this
      ? radio
      : null;
  }

  #choose(radio: TsyRadio, fromUser: boolean): void {
    if (this.isDisabled || radio.disabled) return;
    const changed = this.#value !== radio.value || !radio.checked;
    this.#value = radio.value;
    this.#dirty = true;
    this.arrange();
    if (fromUser && changed) {
      this.emitInput();
      this.emitChange();
    }
  }

  #onKey(event: KeyboardEvent): void {
    const current = this.#radioOf(event.target);
    if (!current) return;
    if (event.key === ' ') {
      event.preventDefault();
      this.#choose(current, true);
      return;
    }
    const rtl = isRtl(this);
    const steps: Record<string, number> = {
      ArrowDown: 1,
      ArrowUp: -1,
      ArrowRight: rtl ? -1 : 1,
      ArrowLeft: rtl ? 1 : -1,
    };
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const enabled = this.radios.filter((r) => !r.disabled);
    if (this.isDisabled || enabled.length === 0) return;
    const at = enabled.indexOf(current);
    const next = enabled[(at + step + enabled.length) % enabled.length];
    if (!next) return;
    this.#choose(next, true);
    next.focus();
  }
}
