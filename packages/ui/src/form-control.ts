import { setOptional, TsyElement } from './element.js';

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
  // eslint-disable-next-line @typescript-eslint/related-getter-setter-pairs -- as on the platform: the property reads the form, the attribute names it by id
  get form(): HTMLFormElement | null {
    return this.internals?.form ?? null;
  }

  /**
   * Sets the `form` attribute (the id of a form elsewhere on the page), as
   * frameworks that set properties do (React 19 assigns `form="…"` here).
   */
  set form(id: string | null) {
    setOptional(this, 'form', id);
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

  /** Submits the form around the element (validation first, then `submit`). */
  protected submitForm(): void {
    this.form?.requestSubmit();
  }

  /**
   * What Enter does in a native one-line field (HTML's implicit
   * submission): it clicks the form's first submit button, which does
   * nothing while that button is disabled (or a `<tsy-button>` is loading);
   * with no submit button, it submits only a form with one such field.
   */
  protected submitImplicitly(): void {
    const form = this.form;
    if (!form) return;
    const fields = ownedBy(form);
    const button = fields.find(isSubmitButton);
    if (button) {
      button.click();
      return;
    }
    if (fields.filter(takesEnter).length <= 1) form.requestSubmit();
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

/**
 * The controls a form owns, in tree order: `form.elements` (which a browser
 * fills with form-associated custom elements too, and with controls tied by
 * `form="…"`), plus this package's elements that name the form, for a DOM
 * that does not list them.
 */
function ownedBy(form: HTMLFormElement): HTMLElement[] {
  const owned = new Set<Element>(Array.from(form.elements));
  for (const element of form.ownerDocument.querySelectorAll(
    'tsy-button, tsy-text-field',
  )) {
    if (element instanceof TsyFormControl && element.form === form) {
      owned.add(element);
    }
  }
  return [...owned]
    .filter((element): element is HTMLElement => element instanceof HTMLElement)
    .sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
}

/** A form's submit buttons, native or ours, in the order HTML picks its default one. */
function isSubmitButton(element: HTMLElement): boolean {
  if (element instanceof HTMLButtonElement) return element.type === 'submit';
  if (element instanceof HTMLInputElement) {
    return element.type === 'submit' || element.type === 'image';
  }
  return (
    element.localName === 'tsy-button' &&
    element.getAttribute('type') === 'submit'
  );
}

/** The input types that take Enter (HTML's fields that block implicit submission). */
const TAKES_ENTER = new Set([
  'text',
  'search',
  'url',
  'tel',
  'email',
  'password',
  'date',
  'month',
  'week',
  'time',
  'datetime-local',
  'number',
]);

function takesEnter(element: HTMLElement): boolean {
  if (element instanceof HTMLInputElement) return TAKES_ENTER.has(element.type);
  return (
    element.localName === 'tsy-text-field' && !element.hasAttribute('multiline')
  );
}

/** Copies a native control's validity into the element's internals. */
export function mirrorValidity(
  internals: ElementInternals | null,
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
): void {
  if (!internals) return;
  // A disabled or read-only control is barred from validation: its
  // validationMessage is empty, and setValidity refuses a flag without one.
  if (!control.willValidate) {
    internals.setValidity({});
    return;
  }
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
