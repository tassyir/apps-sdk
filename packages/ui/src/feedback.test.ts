// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, pick, reset, settle, shadow } from './dom.test-harness.js';
import './index.js';
import type { TsyBanner } from './banner.js';
import type { TsyLink } from './link.js';
import type { TsySkeleton } from './skeleton.js';
import type { TsySpinner } from './spinner.js';
import type { TsyStatusPill } from './status-pill.js';

afterEach(reset);

describe('<tsy-status-pill>', () => {
  it('mixes its tone from the semantic tokens', () => {
    const pill = mount<TsyStatusPill>(
      '<tsy-status-pill tone="success">Delivered</tsy-status-pill>',
    );
    const base = pick(shadow(pill), '[part="base"]');
    expect(base.style.getPropertyValue('--base')).toBe(
      'var(--tsy-color-success)',
    );
    pill.tone = 'warning';
    expect(base.style.getPropertyValue('--base')).toBe(
      'var(--tsy-color-warning)',
    );
  });

  it('is neutral by default and for an unknown tone', () => {
    const pill = mount<TsyStatusPill>(
      '<tsy-status-pill tone="neon">X</tsy-status-pill>',
    );
    expect(pill.tone).toBe('neutral');
    expect(
      pick(shadow(pill), '[part="base"]').style.getPropertyValue('--base'),
    ).toBe('var(--tsy-color-ink-secondary)');
  });

  it("takes a merchant's own colour, and ignores one that is not a colour", () => {
    const pill = mount<TsyStatusPill>(
      '<tsy-status-pill color="#e11d48" tone="info">Custom</tsy-status-pill>',
    );
    const base = pick(shadow(pill), '[part="base"]');
    expect(base.style.getPropertyValue('--base')).toBe('#e11d48');
    pill.setAttribute('color', 'red; background: url(x)');
    expect(base.style.getPropertyValue('--base')).toBe('var(--tsy-color-info)');
  });

  it('hides its dot on request or when an icon replaces it', async () => {
    const pill = mount<TsyStatusPill>(
      '<tsy-status-pill hide-dot>X</tsy-status-pill>',
    );
    expect(pick(shadow(pill), '[part="dot"]').hidden).toBe(true);
    const withIcon = mount<TsyStatusPill>(
      '<tsy-status-pill><svg slot="icon"></svg>Locked</tsy-status-pill>',
    );
    await settle();
    expect(pick(shadow(withIcon), '[part="dot"]').hidden).toBe(true);
  });
});

describe('<tsy-banner>', () => {
  it('is a polite status for info and success, an alert for warning and critical', () => {
    const banner = mount<TsyBanner>('<tsy-banner>Saved.</tsy-banner>');
    const base = pick(shadow(banner), '[part="base"]');
    expect(banner.tone).toBe('info');
    expect(base.getAttribute('role')).toBe('status');
    banner.tone = 'success';
    expect(base.getAttribute('role')).toBe('status');
    banner.tone = 'warning';
    expect(base.getAttribute('role')).toBe('alert');
    banner.tone = 'critical';
    expect(base.getAttribute('role')).toBe('alert');
  });

  it('shows its heading and changes its glyph with the tone', () => {
    const banner = mount<TsyBanner>(
      '<tsy-banner heading="Payment failed" tone="critical">Try again.</tsy-banner>',
    );
    expect(pick(shadow(banner), '[part="heading"]').textContent).toBe(
      'Payment failed',
    );
    const before = pick(shadow(banner), '.glyph');
    banner.tone = 'info';
    expect(pick(shadow(banner), '.glyph')).not.toBe(before);
  });

  it('dismisses with a labelled button, unless a listener says no', () => {
    document.documentElement.setAttribute('lang', 'ar');
    const banner = mount<TsyBanner>('<tsy-banner dismissible>Hi</tsy-banner>');
    const close = pick<HTMLButtonElement>(shadow(banner), '[part="dismiss"]');
    expect(close.hidden).toBe(false);
    expect(close.getAttribute('aria-label')).toBe('إخفاء');

    const veto = vi.fn((event: Event) => {
      event.preventDefault();
    });
    banner.addEventListener('tsy-dismiss', veto);
    close.click();
    expect(veto).toHaveBeenCalledTimes(1);
    expect(banner.hidden).toBe(false);

    banner.removeEventListener('tsy-dismiss', veto);
    close.click();
    expect(banner.hidden).toBe(true);
  });

  it('has no close button unless dismissible', () => {
    const banner = mount<TsyBanner>('<tsy-banner>Hi</tsy-banner>');
    expect(pick(shadow(banner), '[part="dismiss"]').hidden).toBe(true);
  });
});

describe('<tsy-link>', () => {
  it('is an anchor with the address', () => {
    const link = mount<TsyLink>('<tsy-link href="/help">Help</tsy-link>');
    const anchor = pick<HTMLAnchorElement>(shadow(link), 'a');
    expect(anchor.getAttribute('href')).toBe('/help');
    expect(anchor.hasAttribute('target')).toBe(false);
    expect(pick(shadow(link), '.icon').hasAttribute('hidden')).toBe(true);
  });

  it('opens an external link in a new tab, safely, and says so', () => {
    const link = mount<TsyLink>(
      '<tsy-link href="https://example.com" external>Docs</tsy-link>',
    );
    const anchor = pick<HTMLAnchorElement>(shadow(link), 'a');
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
    expect(pick(shadow(link), '.sr-only').textContent).toBe(
      ' (opens in a new tab)',
    );
    expect(pick(shadow(link), '.icon').hasAttribute('hidden')).toBe(false);
  });
});

describe('<tsy-skeleton>', () => {
  it('is hidden from assistive technology', () => {
    const skeleton = mount<TsySkeleton>('<tsy-skeleton></tsy-skeleton>');
    expect(skeleton.getAttribute('aria-hidden')).toBe('true');
    expect(shadow(skeleton).querySelectorAll('.bar')).toHaveLength(1);
  });

  it('draws lines with a shorter last one, and sizes from width and height', () => {
    const skeleton = mount<TsySkeleton>(
      '<tsy-skeleton lines="3" width="200" height="1rem"></tsy-skeleton>',
    );
    const bars = shadow(skeleton).querySelectorAll('.bar');
    expect(bars).toHaveLength(3);
    expect(bars[2]?.classList.contains('last')).toBe(true);
    const base = pick(shadow(skeleton), '[part="base"]');
    expect(base.style.getPropertyValue('--width')).toBe('200px');
    expect(base.style.getPropertyValue('--height')).toBe('1rem');
  });

  it('draws one circle or block whatever lines says, and caps lines', () => {
    const circle = mount<TsySkeleton>(
      '<tsy-skeleton shape="circle" lines="4"></tsy-skeleton>',
    );
    expect(shadow(circle).querySelectorAll('.bar.circle')).toHaveLength(1);
    const many = mount<TsySkeleton>(
      '<tsy-skeleton lines="500"></tsy-skeleton>',
    );
    expect(shadow(many).querySelectorAll('.bar')).toHaveLength(20);
  });
});

describe('<tsy-spinner>', () => {
  it('is a status that says Loading in the page language, or its label', () => {
    const spinner = mount<TsySpinner>('<tsy-spinner></tsy-spinner>');
    const status = pick(shadow(spinner), '[role="status"]');
    expect(status.textContent).toBe('Loading');
    document.documentElement.setAttribute('lang', 'ar');
    spinner.refresh();
    expect(status.textContent).toBe('جارٍ التحميل');
    spinner.setAttribute('label', 'Loading orders');
    expect(status.textContent).toBe('Loading orders');
  });
});
