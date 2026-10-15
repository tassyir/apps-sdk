/**
 * What the specs need from the DOM that happy-dom lacks: ElementInternals
 * (form-associated custom elements). The stand-in records what an element
 * gives its form (value, validity) so specs can read it; the real browser
 * check (`npm run check:browser -w @tassyir/ui`) proves the real thing.
 */

interface Recorded {
  value: unknown;
  flags: ValidityStateFlags;
  message: string;
  anchor: HTMLElement | undefined;
}

const recorded = new WeakMap<HTMLElement, Recorded>();

class StandInInternals {
  readonly #host: HTMLElement;

  constructor(host: HTMLElement) {
    this.#host = host;
    recorded.set(host, {
      value: null,
      flags: {},
      message: '',
      anchor: undefined,
    });
  }

  get #state(): Recorded {
    const state = recorded.get(this.#host);
    if (!state) throw new Error('no internals state');
    return state;
  }

  get form(): HTMLFormElement | null {
    return this.#host.closest('form');
  }

  get willValidate(): boolean {
    return true;
  }

  get validity(): ValidityState {
    const flags = this.#state.flags;
    return {
      ...flags,
      valid: !Object.values(flags).some(Boolean),
    } as ValidityState;
  }

  get validationMessage(): string {
    return this.#state.message;
  }

  setFormValue(value: unknown): void {
    this.#state.value = value;
  }

  setValidity(
    flags: ValidityStateFlags = {},
    message = '',
    anchor?: HTMLElement,
  ): void {
    const invalid = Object.values(flags).some(Boolean);
    if (invalid && message === '') {
      throw new TypeError('setValidity needs a message when invalid');
    }
    this.#state.flags = { ...flags };
    this.#state.message = invalid ? message : '';
    this.#state.anchor = invalid ? anchor : undefined;
  }

  checkValidity(): boolean {
    return this.validity.valid;
  }

  reportValidity(): boolean {
    return this.validity.valid;
  }
}

if (typeof HTMLElement.prototype.attachInternals !== 'function') {
  HTMLElement.prototype.attachInternals = function attachInternals(
    this: HTMLElement,
  ): ElementInternals {
    return new StandInInternals(this) as unknown as ElementInternals;
  };
}

/** What an element last gave its form. */
export function formState(element: HTMLElement): Recorded {
  const state = recorded.get(element);
  if (!state) throw new Error(`${element.localName} has no internals`);
  return state;
}

/** Parses `html` into a fresh container in the body and returns its first element. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names what it mounted, as with querySelector<T>
export function mount<T extends Element = HTMLElement>(html: string): T {
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.append(container);
  const first = container.firstElementChild;
  if (!first) throw new Error('nothing mounted');
  return first as T;
}

/** The element's shadow root (every Tassyir element has an open one). */
export function shadow(element: Element): ShadowRoot {
  const root = element.shadowRoot;
  if (!root) throw new Error(`${element.localName} has no shadow root`);
  return root;
}

/** A required query inside a root. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- as querySelector<T>
export function pick<T extends Element = HTMLElement>(
  root: ParentNode,
  selector: string,
): T {
  const found = root.querySelector(selector);
  if (!found) throw new Error(`nothing matches ${selector}`);
  return found as T;
}

/** Waits for queued mutation observers and slot changes. */
export async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export function reset(): void {
  document.body.replaceChildren();
  document.documentElement.removeAttribute('lang');
  document.documentElement.removeAttribute('dir');
  document.documentElement.removeAttribute('data-theme');
}
