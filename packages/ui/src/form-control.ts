import { TsyElement } from './element.js';

/**
 * A form-associated element (ElementInternals): it submits with the native
 * `<form>` around it under its `name`, takes part in the form's validation,
 * follows a disabled `<fieldset>`, and is reset with the form.
 */
export abstract class TsyFormControl extends TsyElement {
  static readonly formAssociated = true;

  protected readonly internals: ElementInternals | null;
  /** Disabled by an ancestor `<fieldset disabled>`. */
  protected formDisabled = false;

  constructor(styles: string, options: { delegatesFocus?: boolean } = {}) {
    super(styles, options);
    this.internals =
      typeof this.attachInternals === 'function'
        ? this.attachInternals()
        : null;
  }

  /** The form this element submits with, or null. */
  get form(): HTMLFormElement | null {
    return this.internals?.form ?? null;
  }

  get name(): string {
    return this.getAttribute('name') ?? '';
  }

  set name(value: string) {
    this.setAttribute('name', value);
  }

  get disabled(): boolean {
    return this.hasAttribute('disabled');
  }

  set disabled(value: boolean) {
    this.flag('disabled', value);
  }

  get required(): boolean {
    return this.hasAttribute('required');
  }

  set required(value: boolean) {
    this.flag('required', value);
  }

  /** Disabled by its own attribute or by a disabled fieldset. */
  protected get isDisabled(): boolean {
    return this.disabled || this.formDisabled;
  }

  get validity(): ValidityState | undefined {
    return this.internals?.validity;
  }

  get validationMessage(): string {
    return this.internals?.validationMessage ?? '';
  }

  get willValidate(): boolean {
    return this.internals?.willValidate ?? false;
  }

  checkValidity(): boolean {
    return this.internals?.checkValidity() ?? true;
  }

  reportValidity(): boolean {
    return this.internals?.reportValidity() ?? true;
  }

  formDisabledCallback(disabled: boolean): void {
    this.formDisabled = disabled;
    this.refresh();
  }

  abstract formResetCallback(): void;

  /** Submits the form the way pressing Enter in a native field does. */
  protected submitForm(): void {
    const form = this.form;
    if (!form) return;
    form.requestSubmit();
  }

  /** Fires `change` from the element (the inner control's does not leave the shadow root). */
  protected emitChange(): void {
    this.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** Fires `input` from the element. */
  protected emitInput(): void {
    this.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  }
}

/** Copies a native control's validity into the element's internals. */
export function mirrorValidity(
  internals: ElementInternals | null,
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
): void {
  if (!internals) return;
  const v = control.validity;
  const flags: ValidityStateFlags = {
    valueMissing: v.valueMissing,
    typeMismatch: v.typeMismatch,
    patternMismatch: v.patternMismatch,
    tooLong: v.tooLong,
    tooShort: v.tooShort,
    rangeUnderflow: v.rangeUnderflow,
    rangeOverflow: v.rangeOverflow,
    stepMismatch: v.stepMismatch,
    badInput: v.badInput,
    customError: v.customError,
  };
  if (Object.values(flags).some(Boolean)) {
    internals.setValidity(flags, control.validationMessage, control);
  } else {
    internals.setValidity({});
  }
}
