import {
  GLYPHS,
  h,
  icon,
  setOptional,
  setText,
  stringsFor,
  TsyElement,
} from './element.js';

const STYLES = `
:host{display:block}
.header{display:flex;flex-direction:column;gap:16px;padding-bottom:20px;border-bottom:1px solid color-mix(in oklab,var(--tsy-color-ink-secondary) 20%,transparent)}
.titles{display:flex;flex-direction:column;gap:4px;min-width:0}
.back{display:inline-flex;align-items:center;gap:4px;width:fit-content;margin-block:-6px;padding-block:6px;border-radius:6px;color:var(--tsy-color-ink-secondary);font-size:var(--tsy-font-size-label);font-weight:var(--tsy-font-weight-medium);line-height:1.25rem;text-decoration:none;outline:none;transition:color 150ms ease-in-out}
.back:hover{color:var(--tsy-color-ink)}
.back:focus-visible{box-shadow:0 0 0 3px color-mix(in oklab,var(--tsy-color-ink-tertiary) 50%,transparent)}
:host(:dir(rtl)) .back .icon{transform:scaleX(-1)}
h1{margin:0;color:var(--tsy-color-ink);font-size:var(--tsy-font-size-page-title);font-weight:var(--tsy-font-weight-bold);line-height:var(--tsy-line-height-page-title);overflow-wrap:anywhere}
:host(:dir(rtl)) h1{font-size:var(--tsy-font-size-page-title-rtl)}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;color:var(--tsy-color-ink-secondary);font-size:var(--tsy-font-size-body);line-height:1.25rem}
.actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
@media (min-width:520px){.header{flex-direction:row;align-items:center;justify-content:space-between}.actions{flex-shrink:0;justify-content:flex-end}}
@media (prefers-reduced-motion:reduce){.back{transition:none}}
`;

/**
 * `<tsy-page-header>`: the page's title (its one `<h1>`), an optional back
 * link, a muted `meta` line of facts, and the page's actions, where its one
 * ink primary button belongs.
 */
export class TsyPageHeader extends TsyElement {
  static readonly observedAttributes = ['heading', 'back-href', 'back-label'];

  readonly #back = h('a', { part: 'back', class: 'back' });
  readonly #backLabel = h('span', {});
  readonly #title = h('h1', { part: 'heading' });
  readonly #meta = h('div', { part: 'meta', class: 'meta' });
  readonly #metaSlot = h('slot', { name: 'meta' });
  readonly #actions = h('div', { part: 'actions', class: 'actions' });
  readonly #actionsSlot = h('slot', { name: 'actions' });

  constructor() {
    super(STYLES);
    this.#back.append(icon(GLYPHS.caretStart), this.#backLabel);
    this.#meta.append(this.#metaSlot);
    this.#actions.append(this.#actionsSlot);
    this.shadow.append(
      h(
        'div',
        { part: 'base', class: 'header' },
        h('div', { class: 'titles' }, this.#back, this.#title, this.#meta),
        this.#actions,
      ),
    );
    for (const slot of [this.#metaSlot, this.#actionsSlot]) {
      slot.addEventListener('slotchange', () => {
        this.refresh();
      });
    }
  }

  refresh(): void {
    setText(this.#title, this.getAttribute('heading') ?? '');
    const back = this.getAttribute('back-href');
    this.#back.hidden = back === null;
    setOptional(this.#back, 'href', back);
    this.#backLabel.textContent =
      this.getAttribute('back-label') ?? stringsFor(this).back;
    this.#meta.hidden = this.#metaSlot.assignedNodes().length === 0;
    this.#actions.hidden = this.#actionsSlot.assignedElements().length === 0;
  }
}
