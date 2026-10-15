// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { mount, pick, reset, shadow } from './dom.test-harness.js';
import { ELEMENTS, tokensCss } from './index.js';
import { define, isRtl, sheet, stringsFor } from './element.js';

afterEach(reset);

describe('the elements', () => {
  it('adopt the tokens into the document on import, before any element', () => {
    expect(document.querySelector('*:not(html,head,body)')).toBeNull();
    expect(document.adoptedStyleSheets).toContain(sheet(tokensCss()));
  });

  it('are all defined under their tag names', () => {
    for (const [name, element] of Object.entries(ELEMENTS)) {
      expect(customElements.get(name)).toBe(element);
    }
  });

  it('are defined once: a second copy of the package does not throw', () => {
    expect(() => {
      define('tsy-button', class extends HTMLElement {});
    }).not.toThrow();
    expect(customElements.get('tsy-button')).toBe(ELEMENTS['tsy-button']);
  });

  it('adopt the tokens into the document once', () => {
    mount('<tsy-button>A</tsy-button><tsy-card>B</tsy-card>');
    const tokens = sheet(tokensCss());
    expect(
      document.adoptedStyleSheets.filter((each) => each === tokens),
    ).toHaveLength(1);
  });

  it('style their shadow roots with adopted sheets, never a <style> element', () => {
    for (const name of Object.keys(ELEMENTS)) {
      const element = document.createElement(name);
      document.body.append(element);
      const root = shadow(element);
      expect(root.adoptedStyleSheets.length).toBeGreaterThan(0);
      expect(root.querySelector('style')).toBeNull();
    }
  });

  it('expose a part for each piece an app may restyle', () => {
    const field = mount('<tsy-text-field label="A"></tsy-text-field>');
    for (const part of ['label', 'box', 'control', 'hint', 'error']) {
      expect(pick(shadow(field), `[part="${part}"]`)).toBeTruthy();
    }
  });
});

describe('language and direction', () => {
  it('come from the nearest lang and dir, across shadow roots', () => {
    const outer = mount('<section lang="ar" dir="rtl"><div></div></section>');
    const inner = pick(outer, 'div');
    const host = inner.attachShadow({ mode: 'open' });
    const deep = document.createElement('span');
    host.append(deep);
    expect(stringsFor(deep).back).toBe('رجوع');
    expect(isRtl(deep)).toBe(true);
  });

  it('fall back to English and left to right', () => {
    const element = mount('<span></span>');
    expect(stringsFor(element).back).toBe('Back');
    expect(isRtl(element)).toBe(false);
    document.documentElement.setAttribute('lang', 'ar-DZ');
    expect(stringsFor(element).back).toBe('رجوع');
  });
});
