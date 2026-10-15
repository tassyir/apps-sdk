import {
  h,
  headingLevel,
  setOptional,
  setText,
  TsyElement,
} from './element.js';

const STYLES = `
:host{display:block}
.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;min-width:0;padding:24px;color:var(--tsy-color-ink);text-align:center;text-wrap:balance}
.media{display:flex;align-items:center;justify-content:center;margin-bottom:-8px;color:var(--tsy-color-ink-secondary)}
::slotted(svg){width:24px;height:24px}
.header{display:flex;flex-direction:column;align-items:center;gap:8px;max-width:24rem}
.heading{margin:0;font-size:var(--tsy-font-size-title);font-weight:var(--tsy-font-weight-medium);line-height:var(--tsy-line-height-title);letter-spacing:-0.01em}
.body{color:var(--tsy-color-ink-secondary);font-size:var(--tsy-font-size-body);line-height:1.625}
.actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px;max-width:24rem}
@media (min-width:768px){.empty{padding:48px}}
`;

/**
 * `<tsy-empty-state>`: what a list says when it has nothing yet: optional
 * `media` (a glyph), a `heading`, a sentence as content and `actions`. Keep
 * it for a surface with something to teach; inside a form, a plain button
 * says more (DESIGN.md).
 */
export class TsyEmptyState extends TsyElement {
  static readonly observedAttributes = ['heading', 'heading-level'];

  readonly #media = h('div', { part: 'media', class: 'media' });
  readonly #mediaSlot = h('slot', { name: 'media' });
  readonly #heading = h('p', { part: 'heading', class: 'heading' });
  readonly #actions = h('div', { part: 'actions', class: 'actions' });
  readonly #actionsSlot = h('slot', { name: 'actions' });

  constructor() {
    super(STYLES);
    this.#media.append(this.#mediaSlot);
    this.#actions.append(this.#actionsSlot);
    this.shadow.append(
      h(
        'div',
        { part: 'base', class: 'empty' },
        this.#media,
        h(
          'div',
          { class: 'header' },
          this.#heading,
          h(
            'div',
            { part: 'body', class: 'body' },
            document.createElement('slot'),
          ),
        ),
        this.#actions,
      ),
    );
    for (const slot of [this.#mediaSlot, this.#actionsSlot]) {
      slot.addEventListener('slotchange', () => {
        this.refresh();
      });
    }
  }

  refresh(): void {
    setText(this.#heading, this.getAttribute('heading') ?? '');
    const level = this.getAttribute('heading-level');
    setOptional(this.#heading, 'role', level === null ? null : 'heading');
    setOptional(
      this.#heading,
      'aria-level',
      level === null ? null : String(headingLevel(level, 2)),
    );
    this.#media.hidden = this.#mediaSlot.assignedElements().length === 0;
    this.#actions.hidden = this.#actionsSlot.assignedElements().length === 0;
  }
}
