import { HEADER_CSS } from './card.js';
import {
  adopt,
  h,
  headingLevel,
  setText,
  sheet,
  styleRoot,
  TsyElement,
} from './element.js';

const STYLES = `
:host{display:block;min-width:0}
.frame{overflow:hidden;border:1px solid var(--tsy-color-hairline);border-radius:var(--tsy-radius-control);background:color-mix(in oklab,var(--tsy-color-muted-fill) 20%,transparent);box-shadow:var(--tsy-shadow-paper);color:var(--tsy-color-ink)}
${HEADER_CSS}
.toolbar{padding:0 16px 12px}
.toolbar.first{padding-top:12px}
.scroll{overflow-x:auto;padding-bottom:8px}
.frame.has-footer .scroll{padding-bottom:0}
.footer{padding:8px 12px 10px}
`;

/**
 * The light-DOM table inside `<tsy-table>`. A shadow root cannot style the
 * descendants of what it slots, so this sheet is adopted into the table's own
 * tree (the document, or the shadow root the table lives in), in the
 * `tassyir-ui` layer so the app's own rules win.
 */
export const TABLE_CSS = `@layer tassyir-ui{
tsy-table>table{position:relative;width:100%;border-collapse:separate;border-spacing:0;caption-side:bottom;color:var(--tsy-color-ink);font-size:var(--tsy-font-size-body);line-height:1.25rem}
tsy-table>table>caption{margin-top:16px;color:var(--tsy-color-ink-secondary);font-size:var(--tsy-font-size-body)}
tsy-table>table>thead>tr>th,tsy-table>table>tr>th{height:40px;padding:0 8px;background:transparent;color:var(--tsy-color-ink-secondary);font-weight:var(--tsy-font-weight-medium);text-align:start;vertical-align:middle;white-space:nowrap}
tsy-table>table>tbody>tr>td,tsy-table>table>tbody>tr>th{padding:8px;border-bottom:1px solid color-mix(in oklab,var(--tsy-color-hairline) 70%,transparent);background:var(--tsy-color-paper);text-align:start;vertical-align:middle;white-space:nowrap;transition:background-color 150ms ease-in-out}
tsy-table>table>tbody>tr>th{font-weight:var(--tsy-font-weight-medium)}
tsy-table>table>*>tr>:first-child{padding-inline-start:16px}
tsy-table>table>*>tr>:last-child{padding-inline-end:24px}
tsy-table>table>tbody>tr:first-child>*{border-top:1px solid color-mix(in oklab,var(--tsy-color-hairline) 70%,transparent)}
tsy-table>table>tbody>tr>:first-child{border-inline-start:1px solid color-mix(in oklab,var(--tsy-color-hairline) 70%,transparent)}
tsy-table>table>tbody>tr>:last-child{border-inline-end:1px solid color-mix(in oklab,var(--tsy-color-hairline) 70%,transparent)}
tsy-table>table>tbody>tr:first-child>:first-child{border-start-start-radius:var(--tsy-radius-control)}
tsy-table>table>tbody>tr:first-child>:last-child{border-start-end-radius:var(--tsy-radius-control)}
tsy-table>table>tbody>tr:last-child>:first-child{border-end-start-radius:var(--tsy-radius-control)}
tsy-table>table>tbody>tr:last-child>:last-child{border-end-end-radius:var(--tsy-radius-control)}
tsy-table>table>tbody>tr:hover>*{background:color-mix(in oklab,var(--tsy-color-paper-sunken) 70%,transparent)}
tsy-table>table>tbody>tr[aria-selected="true"]>*{background:color-mix(in oklab,var(--tsy-color-muted-fill) 40%,transparent)}
tsy-table>table [data-align="end"]{text-align:end}
tsy-table>table [data-wrap]{white-space:normal}
tsy-table[density="comfortable"]>table>thead>tr>th{height:44px;padding-inline:16px}
tsy-table[density="comfortable"]>table>tbody>tr>*{padding:10px 16px}
@media (prefers-reduced-motion:reduce){tsy-table>table>tbody>tr>*{transition:none}}
}`;

/**
 * `<tsy-table>`: the dashboard's table frame around a native `<table>` you
 * write inside it: a tinted frame with an optional header bar (`heading`,
 * `count`, `actions`), a `toolbar` strip, the rows as a paper panel that
 * scrolls sideways on a phone, and a `footer` (pagination). Native table
 * semantics are kept as they are.
 */
export class TsyTable extends TsyElement {
  static readonly observedAttributes = [
    'heading',
    'heading-level',
    'count',
    'density',
  ];

  readonly #frame = h('div', { part: 'base', class: 'frame' });
  readonly #header = h('div', { part: 'header', class: 'header' });
  readonly #count = h('span', { part: 'count', class: 'count' });
  readonly #actions = h('div', { part: 'actions', class: 'actions' });
  readonly #actionsSlot = h('slot', { name: 'actions' });
  readonly #toolbar = h('div', { part: 'toolbar', class: 'toolbar' });
  readonly #toolbarSlot = h('slot', { name: 'toolbar' });
  readonly #footer = h('div', { part: 'footer', class: 'footer' });
  readonly #footerSlot = h('slot', { name: 'footer' });
  readonly #title = h('div', { class: 'title' });
  readonly #tableSlot = document.createElement('slot');
  #heading: HTMLElement = h('h2', { part: 'heading', class: 'heading' });
  /** The accessible name this element gave the table, to update or remove it. */
  #named: string | null = null;

  constructor() {
    super(STYLES);
    this.#title.append(this.#heading, this.#count);
    this.#actions.append(this.#actionsSlot);
    this.#header.append(this.#title, this.#actions);
    this.#toolbar.append(this.#toolbarSlot);
    this.#footer.append(this.#footerSlot);
    this.#frame.append(
      this.#header,
      this.#toolbar,
      h('div', { part: 'scroll', class: 'scroll' }, this.#tableSlot),
      this.#footer,
    );
    this.shadow.append(this.#frame);
    for (const slot of [
      this.#tableSlot,
      this.#actionsSlot,
      this.#toolbarSlot,
      this.#footerSlot,
    ]) {
      slot.addEventListener('slotchange', () => {
        this.refresh();
      });
    }
  }

  /** The `<table>` this element frames. */
  get table(): HTMLTableElement | null {
    const table = this.querySelector(':scope > table');
    return table instanceof HTMLTableElement ? table : null;
  }

  override connectedCallback(): void {
    const root = styleRoot(this);
    if (root) adopt(root, sheet(TABLE_CSS));
    super.connectedCallback();
  }

  refresh(): void {
    const level = headingLevel(this.getAttribute('heading-level'), 2);
    if (this.#heading.tagName !== `H${String(level)}`) {
      const next = h(`h${String(level)}` as 'h2', {
        part: 'heading',
        class: 'heading',
      });
      this.#heading.replaceWith(next);
      this.#heading = next;
    }
    const heading = this.getAttribute('heading') ?? '';
    setText(this.#heading, heading);
    setText(this.#count, this.getAttribute('count') ?? '');
    const hasActions = this.#actionsSlot.assignedElements().length > 0;
    this.#actions.hidden = !hasActions;
    this.#header.hidden = heading === '' && !hasActions;
    const hasToolbar = this.#toolbarSlot.assignedElements().length > 0;
    this.#toolbar.hidden = !hasToolbar;
    this.#toolbar.classList.toggle('first', this.#header.hidden);
    const hasFooter = this.#footerSlot.assignedElements().length > 0;
    this.#footer.hidden = !hasFooter;
    this.#frame.classList.toggle('has-footer', hasFooter);
    this.#name(heading);
  }

  /**
   * The heading names the table for screen readers, unless the table already
   * has a name of its own (a caption, `aria-label`, `aria-labelledby`).
   */
  #name(heading: string): void {
    const table = this.table;
    if (!table) return;
    const label = table.getAttribute('aria-label');
    const ours = this.#named !== null && label === this.#named;
    if (
      !ours &&
      (label !== null || table.hasAttribute('aria-labelledby') || table.caption)
    ) {
      return;
    }
    if (heading) {
      table.setAttribute('aria-label', heading);
      this.#named = heading;
    } else if (ours) {
      table.removeAttribute('aria-label');
      this.#named = null;
    }
  }
}
