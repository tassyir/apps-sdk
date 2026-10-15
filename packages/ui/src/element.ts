import { tokensCss } from './tokens.js';

/**
 * The base every Tassyir element extends: an open shadow root styled through
 * constructable stylesheets (no `<style>` element, so a strict
 * `style-src` Content-Security-Policy is fine), DOM built with
 * `createElement` (never `innerHTML`, so Trusted Types are fine), and the
 * tokens adopted into the document once.
 *
 * Importing this module on a server is safe: without a DOM, the base class is
 * an empty class and nothing is defined.
 */

/** Without a DOM (a server), a stand-in so the classes can still be declared. */
class NoDom {
  readonly dom = false;
}

const HTMLElementBase: typeof HTMLElement =
  typeof HTMLElement === 'undefined'
    ? (NoDom as unknown as typeof HTMLElement)
    : HTMLElement;

/** True where custom elements can be defined (a browser, or a test DOM). */
export const canDefine = typeof customElements !== 'undefined';

const sheets = new Map<string, CSSStyleSheet>();

/** One constructable stylesheet per distinct text, shared by every element. */
export function sheet(text: string): CSSStyleSheet {
  let found = sheets.get(text);
  if (!found) {
    found = new CSSStyleSheet();
    found.replaceSync(text);
    sheets.set(text, found);
  }
  return found;
}

/**
 * The document or shadow root a node lives in, when it can adopt sheets.
 * Duck-typed: `instanceof` fails across frames (each has its own classes).
 */
export function styleRoot(node: Node): Document | ShadowRoot | null {
  const root = node.getRootNode();
  return 'adoptedStyleSheets' in root ? (root as Document | ShadowRoot) : null;
}

/** The host of the shadow root a node lives in, or null. */
function hostOf(node: Node): Element | null {
  const root = node.getRootNode();
  return root.nodeType === 11 && 'host' in root
    ? (root as ShadowRoot).host
    : null;
}

/** Adds a sheet to a document or shadow root once (reassigned: Safari 16.4 freezes the array). */
export function adopt(root: Document | ShadowRoot, added: CSSStyleSheet): void {
  if (root.adoptedStyleSheets.includes(added)) return;
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, added];
}

/** Styles every shadow root shares. */
const SHARED = `
:host{box-sizing:border-box;font-family:var(--tsy-font-sans);-webkit-tap-highlight-color:transparent}
:host([hidden]){display:none!important}
*,*::before,*::after{box-sizing:inherit}
[hidden]{display:none!important}
svg{flex-shrink:0}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
`;

/** CSS for a field's label, hint and error, shared by the form controls. */
export const FIELD_CSS = `
.label{display:block;margin:0 0 var(--tsy-space-hug);font-size:var(--tsy-font-size-label);font-weight:var(--tsy-font-weight-medium);line-height:1;color:var(--tsy-color-ink)}
.hint,.error{margin:var(--tsy-space-hint) 0 0;font-size:var(--tsy-font-size-body);line-height:1.25rem}
.hint{color:var(--tsy-color-ink-secondary)}
.error{color:var(--tsy-color-destructive)}
`;

/** The focus ring: an ink-tertiary hairline and a 3px halo at half strength. */
export const FOCUS_RING =
  'border-color:var(--tsy-color-ink-tertiary);box-shadow:0 0 0 3px color-mix(in oklab,var(--tsy-color-ink-tertiary) 50%,transparent)';

type Child = Node | string | null | undefined | false;

/** Creates an element with attributes and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Readonly<Record<string, string>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child);
  }
  return element;
}

const SVG = 'http://www.w3.org/2000/svg';

/**
 * A 16×16 stroked glyph (`currentColor`), hidden from assistive technology.
 * Each string of `paths` is one path's `d`.
 */
export function icon(
  paths: readonly string[],
  className = 'icon',
): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', className);
  for (const d of paths) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** The glyphs the elements draw (16×16, stroked). */
export const GLYPHS = {
  check: ['M3.5 8.5 6.5 11.5 12.5 4.5'],
  dash: ['M4 8h8'],
  caretDown: ['M4 6l4 4 4-4'],
  caretStart: ['M10 3.5 5.5 8l4.5 4.5'],
  spinner: ['M8 1.5a6.5 6.5 0 1 0 6.5 6.5'],
  info: [
    'M8 1.5a6.5 6.5 0 1 1 0 13a6.5 6.5 0 0 1 0-13',
    'M8 7.5v3.5',
    'M8 5h.01',
  ],
  success: [
    'M8 1.5a6.5 6.5 0 1 1 0 13a6.5 6.5 0 0 1 0-13',
    'M5.25 8.25 7 10l3.75-4',
  ],
  warning: ['M8 1.75 14.5 13.25H1.5Z', 'M8 6.25v3', 'M8 11.25h.01'],
  critical: [
    'M8 1.5a6.5 6.5 0 1 1 0 13a6.5 6.5 0 0 1 0-13',
    'M8 4.75v3.75',
    'M8 11h.01',
  ],
  close: ['M4 4l8 8', 'M12 4l-8 8'],
  external: ['M5.5 10.5 11 5', 'M6.5 5H11v4.5'],
} as const;

export interface Strings {
  loading: string;
  back: string;
  dismiss: string;
  newTab: string;
  chooseOption: string;
}

/** The built-in words, in the dashboard's two languages. */
export const STRINGS: Readonly<Record<'en' | 'ar', Readonly<Strings>>> = {
  en: {
    loading: 'Loading',
    back: 'Back',
    dismiss: 'Dismiss',
    newTab: '(opens in a new tab)',
    chooseOption: 'Choose an option.',
  },
  ar: {
    loading: 'جارٍ التحميل',
    back: 'رجوع',
    dismiss: 'إخفاء',
    newTab: '(تُفتح في علامة تبويب جديدة)',
    chooseOption: 'اختر خيارًا.',
  },
};

/**
 * The nearest value of an inherited attribute (`lang`, `dir`), across shadow
 * roots, then on the document element.
 */
function inherited(element: Element, attribute: 'lang' | 'dir'): string {
  let node: Element | null = element;
  while (node) {
    const holder: Element | null = node.closest(`[${attribute}]`);
    const value = holder?.getAttribute(attribute)?.trim();
    if (value) return value.toLowerCase();
    node = hostOf(node);
  }
  return (
    element.ownerDocument.documentElement.getAttribute(attribute) ?? ''
  ).toLowerCase();
}

/** The words for an element: Arabic when its language is Arabic, English otherwise. */
export function stringsFor(element: Element): Strings {
  return inherited(element, 'lang').startsWith('ar') ? STRINGS.ar : STRINGS.en;
}

/** True when the element sits in a right-to-left context. */
export function isRtl(element: Element): boolean {
  return inherited(element, 'dir') === 'rtl';
}

/**
 * Elements that show built-in words or follow the direction are told when
 * the document's `lang` or `dir` changes (what `applyDashboardContext` sets).
 */
const watching = new Set<TsyElement>();
let observer: MutationObserver | undefined;

function watch(element: TsyElement): void {
  watching.add(element);
  if (observer || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver(() => {
    for (const each of watching) each.refresh();
  });
  observer.observe(element.ownerDocument.documentElement, {
    attributes: true,
    attributeFilter: ['lang', 'dir'],
  });
}

export abstract class TsyElement extends HTMLElementBase {
  protected readonly shadow: ShadowRoot;

  constructor(styles: string, options: { delegatesFocus?: boolean } = {}) {
    super();
    adopt(this.ownerDocument, sheet(tokensCss()));
    this.shadow = this.attachShadow({
      mode: 'open',
      delegatesFocus: options.delegatesFocus ?? false,
    });
    this.shadow.adoptedStyleSheets = [sheet(SHARED), sheet(styles)];
  }

  connectedCallback(): void {
    watch(this);
    this.refresh();
  }

  disconnectedCallback(): void {
    watching.delete(this);
  }

  attributeChangedCallback(): void {
    this.refresh();
  }

  /** Brings the shadow DOM in line with the attributes. */
  abstract refresh(): void;

  /** The value of a string attribute, or `fallback`. */
  protected text(name: string, fallback = ''): string {
    return this.getAttribute(name) ?? fallback;
  }

  /** An enumerated attribute: its value when allowed, `fallback` otherwise. */
  protected choice<T extends string>(
    name: string,
    allowed: readonly T[],
    fallback: T,
  ): T {
    const value = this.getAttribute(name);
    return allowed.find((each) => each === value) ?? fallback;
  }

  /** Reflects a boolean property to its attribute. */
  protected flag(name: string, on: boolean): void {
    this.toggleAttribute(name, on);
  }
}

/** Defines an element once: a second copy of this package never throws. */
export function define(name: string, element: CustomElementConstructor): void {
  if (!canDefine || customElements.get(name)) return;
  customElements.define(name, element);
}

/** Sets or removes an attribute. */
export function setOptional(
  element: Element,
  name: string,
  value: string | null | undefined,
): void {
  if (value === null || value === undefined || value === '') {
    element.removeAttribute(name);
  } else {
    element.setAttribute(name, value);
  }
}

/** Shows text in an element and hides it when there is none. */
export function setText(element: HTMLElement, value: string): void {
  element.textContent = value;
  element.hidden = value === '';
}

/** A heading level from an attribute: 1 to 6, `fallback` otherwise. */
export function headingLevel(value: string | null, fallback: number): number {
  const level = Number(value);
  return Number.isInteger(level) && level >= 1 && level <= 6 ? level : fallback;
}
