import { h, TsyElement } from './element.js';

export const PILL_TONES = [
  'neutral',
  'success',
  'warning',
  'destructive',
  'info',
  'purple',
] as const;
export type PillTone = (typeof PILL_TONES)[number];

/** Each tone's base hue: the semantic tokens, so a pill and the rest never disagree. */
const TONE_COLOR: Readonly<Record<PillTone, string>> = {
  neutral: 'var(--tsy-color-ink-secondary)',
  success: 'var(--tsy-color-success)',
  warning: 'var(--tsy-color-warning)',
  destructive: 'var(--tsy-color-destructive)',
  info: 'var(--tsy-color-info)',
  purple: 'var(--tsy-color-purple)',
};

/**
 * A CSS colour as written (`#e11d48`, `rgb(…)`, `oklch(…)`, a name), or null:
 * only the characters a colour needs, then the browser's own verdict.
 */
function colorValue(value: string | null): string | null {
  if (value === null || !/^[#a-z0-9(),.%\s/+-]+$/i.test(value)) return null;
  return typeof CSS === 'undefined' || CSS.supports('color', value)
    ? value
    : null;
}

const STYLES = `
:host{display:inline-flex;max-width:100%;vertical-align:middle}
.pill{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:2px 8px;border-radius:var(--tsy-radius-pill);background:color-mix(in srgb,var(--base) 12%,var(--tsy-color-pill-surface));color:color-mix(in srgb,var(--base),var(--tsy-color-pill-ink) 30%);font-size:var(--tsy-font-size-body);font-weight:var(--tsy-font-weight-medium);line-height:1.25rem;white-space:nowrap}
:host([size="md"]) .pill{padding:4px 10px}
.dot{width:6px;height:6px;flex-shrink:0;border-radius:50%;background:var(--base)}
.icon{display:inline-flex;margin-inline-start:-2px}
.icon.empty{display:none}
::slotted(svg){width:16px;height:16px}
.label{overflow:hidden;text-overflow:ellipsis}
`;

/**
 * `<tsy-status-pill>`: the dashboard's only status treatment: a dot, a 12%
 * tint of the tone and the tone pushed toward ink for the words. `tone` is
 * one of the semantic hues; `color` takes any CSS colour (a merchant's own
 * status colour) and mixes the same way. An `icon` slot replaces the dot.
 */
export class TsyStatusPill extends TsyElement {
  static readonly observedAttributes = ['tone', 'color', 'size', 'hide-dot'];

  readonly #pill = h('span', { part: 'base', class: 'pill' });
  readonly #dot = h('span', {
    part: 'dot',
    class: 'dot',
    'aria-hidden': 'true',
  });
  readonly #icon = h('span', { class: 'icon empty', 'aria-hidden': 'true' });
  readonly #iconSlot = h('slot', { name: 'icon' });

  constructor() {
    super(STYLES);
    this.#icon.append(this.#iconSlot);
    this.#pill.append(
      this.#dot,
      this.#icon,
      h(
        'span',
        { part: 'label', class: 'label' },
        document.createElement('slot'),
      ),
    );
    this.shadow.append(this.#pill);
    this.#iconSlot.addEventListener('slotchange', () => {
      this.refresh();
    });
  }

  get tone(): PillTone {
    return this.choice('tone', PILL_TONES, 'neutral');
  }

  set tone(value: PillTone) {
    this.setAttribute('tone', value);
  }

  refresh(): void {
    const custom = colorValue(this.getAttribute('color'));
    this.#pill.style.setProperty('--base', custom ?? TONE_COLOR[this.tone]);
    const hasIcon = this.#iconSlot.assignedElements().length > 0;
    this.#icon.classList.toggle('empty', !hasIcon);
    this.#dot.hidden = hasIcon || this.hasAttribute('hide-dot');
  }
}
