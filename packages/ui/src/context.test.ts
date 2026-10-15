// @vitest-environment happy-dom
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import type { AppBridge } from '../../app-bridge/src/index.js';
import { mount, pick, reset, settle, shadow } from './dom.test-harness.js';
import './index.js';
import {
  applyDashboardContext,
  followDashboardContext,
  type DashboardContext,
  type DashboardContextSource,
} from './context.js';

afterEach(reset);

/** A stand-in for App Bridge: a current context and a `context.changed` stream. */
function fakeBridge(current: DashboardContext | null): {
  bridge: DashboardContextSource;
  push: (context: DashboardContext) => void;
  listeners: Set<(context: DashboardContext) => void>;
} {
  const listeners = new Set<(context: DashboardContext) => void>();
  return {
    listeners,
    bridge: {
      context: { current },
      on(_event, listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    push: (context) => {
      for (const listener of listeners) listener(context);
    },
  };
}

const html = document.documentElement;

describe('applyDashboardContext', () => {
  it('sets lang, dir and data-theme on <html>', () => {
    applyDashboardContext({ locale: 'ar', dir: 'rtl', theme: 'dark' });
    expect(html.getAttribute('lang')).toBe('ar');
    expect(html.getAttribute('dir')).toBe('rtl');
    expect(html.getAttribute('data-theme')).toBe('dark');
  });

  it('leaves missing or unknown fields alone, and can target another root', () => {
    applyDashboardContext({ locale: 'en', dir: 'ltr', theme: 'light' });
    applyDashboardContext({
      dir: 'sideways' as 'rtl',
      theme: 'sepia' as 'dark',
    });
    expect(html.getAttribute('dir')).toBe('ltr');
    expect(html.getAttribute('data-theme')).toBe('light');
    const panel = mount('<div></div>');
    applyDashboardContext({ theme: 'dark' }, panel);
    expect(panel.getAttribute('data-theme')).toBe('dark');
    expect(html.getAttribute('data-theme')).toBe('light');
  });
});

describe('followDashboardContext', () => {
  it("applies the bridge's current context at once, then every change, until stopped", () => {
    const { bridge, push, listeners } = fakeBridge({
      locale: 'en',
      dir: 'ltr',
      theme: 'light',
    });
    const stop = followDashboardContext(bridge);
    expect(html.getAttribute('lang')).toBe('en');
    push({ locale: 'ar', dir: 'rtl', theme: 'dark' });
    expect(html.getAttribute('dir')).toBe('rtl');
    expect(html.getAttribute('data-theme')).toBe('dark');
    stop();
    expect(listeners.size).toBe(0);
  });

  it('waits for the first context when the bridge has none yet', () => {
    const { bridge, push } = fakeBridge(null);
    followDashboardContext(bridge);
    expect(html.hasAttribute('lang')).toBe(false);
    push({ locale: 'ar', dir: 'rtl', theme: 'light' });
    expect(html.getAttribute('lang')).toBe('ar');
  });

  it("accepts @tassyir/app-bridge's bridge as it is", () => {
    expectTypeOf<AppBridge>().toExtend<DashboardContextSource>();
  });

  it('re-words the elements when the language changes', async () => {
    const spinner = mount('<tsy-spinner></tsy-spinner>');
    const status = pick(shadow(spinner), '[role="status"]');
    expect(status.textContent).toBe('Loading');
    const { bridge, push } = fakeBridge(null);
    followDashboardContext(bridge);
    push({ locale: 'ar', dir: 'rtl', theme: 'dark' });
    await settle();
    expect(status.textContent).toBe('جارٍ التحميل');
  });
});
