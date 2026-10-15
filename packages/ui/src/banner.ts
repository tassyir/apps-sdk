import { GLYPHS, h, icon, setText, stringsFor, TsyElement } from './element.js';

export const BANNER_TONES = ['info', 'success', 'warning', 'critical'] as const;
export type BannerTone = (typeof BANNER_TONES)[number];

const STYLES = `
:host{display:block}
.banner{display:flex;align-items:flex-start;gap:8px;padding:10px 12px;border:1px solid transparent;border-radius:var(--tsy-radius-control);background:var(--tsy-color-info-soft);color:var(--tsy-color-ink);font-size:var(--tsy-font-size-body);line-height:1.25rem}
.glyph{margin-top:2px;color:var(--tsy-color-info)}
:host([tone="success"]) .banner{background:var(--tsy-color-success-soft)}
:host([tone="success"]) .glyph{color:var(--tsy-color-success)}
:host([tone="warning"]) .banner{background:var(--tsy-color-warning-soft);color:var(--tsy-color-warning-ink)}
:host([tone="warning"]) .glyph{color:var(--tsy-color-warning-ink)}
:host([tone="critical"]) .banner{border-color:color-mix(in oklab,var(--tsy-color-destructive) 25%,transparent);background:var(--tsy-color-destructive-soft)}
:host([tone="critical"]) .glyph{color:var(--tsy-color-destructive)}
.content{display:flex;flex:1;flex-wrap:wrap;align-items:center;gap:8px 12px;min-width:0}
.text{flex:1 1 14rem;min-width:0}
.heading{margin:0;font-weight:var(--tsy-font-weight-semibold)}
.body{overflow-wrap:anywhere}
.actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.dismiss{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:32px;height:32px;margin:-6px;margin-inline-start:0;padding:0;border:0;border-radius:var(--tsy-radius-nested);background:transparent;color:inherit;cursor:pointer;outline:none;transition:background-color 150ms ease-in-out}
.dismiss:hover{background:color-mix(in oklab,currentColor 10%,transparent)}
.dismiss:focus-visible{box-shadow:0 0 0 3px color-mix(in oklab,var(--tsy-color-ink-tertiary) 50%,transparent)}
@media (prefers-reduced-motion:reduce){.dismiss{transition:none}}
`;

const GLYPH: Readonly<Record<BannerTone, readonly string[]>> = {
  info: GLYPHS.info,
  success: GLYPHS.success,
  warning: GLYPHS.warning,
  critical: GLYPHS.critical,
};

/**
 * `<tsy-banner>`: a quiet tinted notice: a glyph, an optional `heading`,
 * the message as content and `actions` at the end. `tone` is `info` (the
 * default), `success`, `warning` or `critical`; warning and critical are
 * announced (`role="alert"`), the others politely (`role="status"`).
 * `dismissible` adds a close button that fires `tsy-dismiss` (cancelable)
 * and then hides the banner.
 */
export class TsyBanner extends TsyElement {
  static readonly observedAttributes = ['tone', 'heading', 'dismissible'];

  readonly #banner = h('div', { part: 'base', class: 'banner' });
  readonly #heading = h('p', { part: 'heading', class: 'heading' });
  readonly #actions = h('div', { part: 'actions', class: 'actions' });
  readonly #actionsSlot = h('slot', { name: 'actions' });
  readonly #dismiss = h('button', {
    part: 'dismiss',
    class: 'dismiss',
    type: 'button',
  });
  #glyph: SVGSVGElement = icon(GLYPHS.info, 'glyph');
  #tone: BannerTone | null = null;

  constructor() {
    super(STYLES);
    this.#actions.append(this.#actionsSlot);
    this.#dismiss.append(icon(GLYPHS.close));
    this.#banner.append(
      this.#glyph,
      h(
        'div',
        { class: 'content' },
        h(
          'div',
          { class: 'text' },
          this.#heading,
          h(
            'div',
            { part: 'body', class: 'body' },
            document.createElement('slot'),
          ),
        ),
        this.#actions,
      ),
      this.#dismiss,
    );
    this.shadow.append(this.#banner);
    this.#actionsSlot.addEventListener('slotchange', () => {
      this.refresh();
    });
    this.#dismiss.addEventListener('click', () => {
      this.dismiss();
    });
  }

  get tone(): BannerTone {
    return this.choice('tone', BANNER_TONES, 'info');
  }

  set tone(value: BannerTone) {
    this.setAttribute('tone', value);
  }

  /** Fires `tsy-dismiss`; hides the banner unless a listener prevents it. */
  dismiss(): void {
    const event = new CustomEvent('tsy-dismiss', {
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    if (this.dispatchEvent(event)) this.hidden = true;
  }

  refresh(): void {
    const tone = this.tone;
    if (tone !== this.#tone) {
      const glyph = icon(GLYPH[tone], 'glyph');
      this.#glyph.replaceWith(glyph);
      this.#glyph = glyph;
      this.#tone = tone;
    }
    this.#banner.setAttribute(
      'role',
      tone === 'warning' || tone === 'critical' ? 'alert' : 'status',
    );
    setText(this.#heading, this.getAttribute('heading') ?? '');
    this.#actions.hidden = this.#actionsSlot.assignedElements().length === 0;
    this.#dismiss.hidden = !this.hasAttribute('dismissible');
    this.#dismiss.setAttribute('aria-label', stringsFor(this).dismiss);
  }
}
