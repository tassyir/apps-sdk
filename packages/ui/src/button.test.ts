// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, pick, reset, shadow } from './dom.test-harness.js';
import './index.js';
import type { TsyButton } from './button.js';

afterEach(reset);

function inner(button: TsyButton): HTMLButtonElement | HTMLAnchorElement {
  return pick(shadow(button), '[part="control"]');
}

describe('<tsy-button>', () => {
  it('is an outline button by default, the ink button only when asked', () => {
    const button = mount<TsyButton>('<tsy-button>Save</tsy-button>');
    expect(button.variant).toBe('outline');
    const control = inner(button);
    expect(control).toBeInstanceOf(HTMLButtonElement);
    expect((control as HTMLButtonElement).type).toBe('button');
    button.variant = 'primary';
    expect(button.getAttribute('variant')).toBe('primary');
  });

  it('reads an unknown variant as outline', () => {
    const button = mount<TsyButton>(
      '<tsy-button variant="neon">Save</tsy-button>',
    );
    expect(button.variant).toBe('outline');
  });

  it('shows its content through a slot', () => {
    const button = mount<TsyButton>('<tsy-button>Save order</tsy-button>');
    const slot = pick<HTMLSlotElement>(inner(button), 'slot');
    expect(slot.assignedNodes().map((n) => n.textContent)).toEqual([
      'Save order',
    ]);
  });

  it('passes its accessible name and state to the inner control', () => {
    const button = mount<TsyButton>(
      '<tsy-button aria-label="More actions" aria-expanded="false">⋯</tsy-button>',
    );
    expect(inner(button).getAttribute('aria-label')).toBe('More actions');
    expect(inner(button).getAttribute('aria-expanded')).toBe('false');
  });

  it('disables the inner button and swallows clicks', () => {
    const button = mount<TsyButton>('<tsy-button disabled>Save</tsy-button>');
    const heard = vi.fn();
    button.addEventListener('click', heard);
    button.click();
    expect(heard).not.toHaveBeenCalled();
    expect((inner(button) as HTMLButtonElement).disabled).toBe(true);
  });

  it('while loading, stays focusable, says it is busy and swallows clicks', () => {
    const button = mount<TsyButton>('<tsy-button loading>Save</tsy-button>');
    const control = inner(button) as HTMLButtonElement;
    expect(control.disabled).toBe(false);
    expect(control.getAttribute('aria-disabled')).toBe('true');
    expect(control.getAttribute('aria-busy')).toBe('true');
    expect(pick(control, '.spin').hasAttribute('hidden')).toBe(false);
    const heard = vi.fn();
    button.addEventListener('click', heard);
    button.click();
    expect(heard).not.toHaveBeenCalled();
    button.loading = false;
    expect(control.hasAttribute('aria-busy')).toBe(false);
    expect(pick(control, '.spin').hasAttribute('hidden')).toBe(true);
  });

  it('submits the form around it after the click, unless a listener prevents it', async () => {
    const form = mount<HTMLFormElement>(
      '<form><tsy-button type="submit">Send</tsy-button></form>',
    );
    const submit = vi.fn((event: Event) => {
      event.preventDefault();
    });
    form.addEventListener('submit', submit);
    const button = pick<TsyButton>(form, 'tsy-button');

    button.click();
    expect(submit).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(submit).toHaveBeenCalledTimes(1);

    button.addEventListener('click', (event) => {
      event.preventDefault();
    });
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('resets the form with type="reset"', async () => {
    const form = mount<HTMLFormElement>(
      '<form><tsy-button type="reset">Reset</tsy-button></form>',
    );
    const resetSpy = vi.spyOn(form, 'reset');
    pick<TsyButton>(form, 'tsy-button').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resetSpy).toHaveBeenCalledTimes(1);
  });

  it('with href is a link, and a disabled one has no address', () => {
    const button = mount<TsyButton>(
      '<tsy-button href="/orders" target="_blank">Orders</tsy-button>',
    );
    let control = inner(button);
    expect(control).toBeInstanceOf(HTMLAnchorElement);
    expect(control.getAttribute('href')).toBe('/orders');
    expect(control.getAttribute('target')).toBe('_blank');
    expect(pick<HTMLSlotElement>(control, 'slot').assignedNodes()).toHaveLength(
      1,
    );

    button.disabled = true;
    expect(control.hasAttribute('href')).toBe(false);
    expect(control.getAttribute('aria-disabled')).toBe('true');
    expect(control.getAttribute('role')).toBe('link');

    button.removeAttribute('href');
    control = inner(button);
    expect(control).toBeInstanceOf(HTMLButtonElement);
    expect(pick<HTMLSlotElement>(control, 'slot').assignedNodes()).toHaveLength(
      1,
    );
  });
});
