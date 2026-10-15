import { h, headingLevel, setText, TsyElement } from './element.js';

/** The tinted header bar a card or a table frame wears: title, count, actions. */
export const HEADER_CSS = `
.header{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px;min-height:44px;padding:10px 16px}
.title{display:flex;align-items:center;gap:8px;min-width:0}
.heading{margin:0;overflow:hidden;color:var(--tsy-color-ink-secondary);font-size:var(--tsy-font-size-label);font-weight:var(--tsy-font-weight-medium);line-height:1.25rem;text-overflow:ellipsis;white-space:nowrap}
.count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:var(--tsy-radius-pill);background:var(--tsy-color-muted-fill);color:var(--tsy-color-ink);font-size:var(--tsy-font-size-body);font-weight:var(--tsy-font-weight-medium);line-height:1}
.actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-inline-start:auto}
`;

const STYLES = `
:host{display:block;min-width:0}
.card{overflow:hidden;border:1px solid var(--tsy-color-hairline);border-radius:var(--tsy-radius-control);background:var(--tsy-color-paper);box-shadow:var(--tsy-shadow-paper);color:var(--tsy-color-ink)}
.card.layered{background:color-mix(in oklab,var(--tsy-color-muted-fill) 20%,transparent)}
${HEADER_CSS}
.body{padding:16px;color:var(--tsy-color-ink);font-size:var(--tsy-font-size-body);line-height:var(--tsy-line-height-body)}
.layered .body{border-radius:var(--tsy-radius-control);background:var(--tsy-color-paper);box-shadow:0 0 0 1px var(--tsy-color-hairline)}
:host([flush]) .body{padding:0}
`;

/**
 * `<tsy-card>`: the dashboard's content card. With a `heading` (or
 * `actions`) it is the layered card: a tinted header bar with the title in
 * the quiet label style, an optional `count`, actions at the end, over a
 * paper body. Without, a plain paper card. `flush` drops the body's padding
 * (a list or a table that runs edge to edge).
 */
export class TsyCard extends TsyElement {
  static readonly observedAttributes = ['heading', 'heading-level', 'count'];

  readonly #card = h('div', { part: 'base', class: 'card' });
  readonly #header = h('div', { part: 'header', class: 'header' });
  readonly #title = h('div', { class: 'title' });
  readonly #count = h('span', { part: 'count', class: 'count' });
  readonly #actions = h('div', { part: 'actions', class: 'actions' });
  readonly #actionsSlot = h('slot', { name: 'actions' });
  #heading: HTMLElement = h('h2', {
    part: 'heading',
    class: 'heading',
    id: 'heading',
  });

  constructor() {
    super(STYLES);
    this.#actions.append(this.#actionsSlot);
    this.#title.append(this.#heading, this.#count);
    this.#header.append(this.#title, this.#actions);
    this.#card.append(
      this.#header,
      h('div', { part: 'body', class: 'body' }, document.createElement('slot')),
    );
    this.shadow.append(this.#card);
    this.#actionsSlot.addEventListener('slotchange', () => {
      this.refresh();
    });
  }

  refresh(): void {
    const level = headingLevel(this.getAttribute('heading-level'), 2);
    if (this.#heading.tagName !== `H${String(level)}`) {
      const next = h(`h${String(level)}` as 'h2', {
        part: 'heading',
        class: 'heading',
        id: 'heading',
      });
      this.#heading.replaceWith(next);
      this.#heading = next;
    }
    const heading = this.getAttribute('heading') ?? '';
    setText(this.#heading, heading);
    setText(this.#count, this.getAttribute('count') ?? '');
    const hasActions = this.#actionsSlot.assignedElements().length > 0;
    this.#actions.hidden = !hasActions;
    const layered = heading !== '' || hasActions;
    this.#header.hidden = !layered;
    this.#card.classList.toggle('layered', layered);
  }
}
