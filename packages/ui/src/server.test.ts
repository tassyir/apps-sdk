// No DOM here: what a server (SSR, a build step) meets when it imports the package.
import { describe, expect, it } from 'vitest';

describe('on a server', () => {
  it('imports without a DOM and exports every element and the tokens', async () => {
    expect(typeof HTMLElement).toBe('undefined');
    const ui = await import('./index.js');
    expect(Object.keys(ui.ELEMENTS)).toEqual([
      'tsy-button',
      'tsy-link',
      'tsy-text-field',
      'tsy-select',
      'tsy-checkbox',
      'tsy-radio-group',
      'tsy-radio',
      'tsy-card',
      'tsy-page-header',
      'tsy-table',
      'tsy-status-pill',
      'tsy-banner',
      'tsy-empty-state',
      'tsy-skeleton',
      'tsy-spinner',
    ]);
    expect(ui.tokensCss()).toContain('--tsy-color-ink:#051F25;');
  });

  it('imports the tokens alone', async () => {
    const tokens = await import('./tokens.js');
    expect(tokens.colors.dark.ink).toBe('oklch(0.955 0 0)');
  });
});
