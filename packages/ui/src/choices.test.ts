// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formState,
  mount,
  pick,
  reset,
  settle,
  shadow,
} from './dom.test-harness.js';
import './index.js';
import type { TsyCheckbox } from './checkbox.js';
import type { TsyRadio, TsyRadioGroup } from './radio.js';

afterEach(reset);

function box(checkbox: TsyCheckbox): HTMLInputElement {
  return pick<HTMLInputElement>(shadow(checkbox), 'input');
}

function press(target: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

describe('<tsy-checkbox>', () => {
  it('labels a native checkbox with its content', () => {
    const checkbox = mount<TsyCheckbox>(
      '<tsy-checkbox name="notify">Notify the buyer</tsy-checkbox>',
    );
    const input = box(checkbox);
    const row = pick<HTMLLabelElement>(shadow(checkbox), 'label');
    expect(row.htmlFor).toBe(input.id);
    expect(input.type).toBe('checkbox');
    const slot = pick<HTMLSlotElement>(row, 'slot');
    expect(slot.assignedNodes()[0]?.textContent).toBe('Notify the buyer');
  });

  it('submits its value only while checked', () => {
    const checkbox = mount<TsyCheckbox>(
      '<tsy-checkbox name="notify" value="yes" checked>Notify</tsy-checkbox>',
    );
    expect(checkbox.checked).toBe(true);
    expect(formState(checkbox).value).toBe('yes');
    checkbox.checked = false;
    expect(formState(checkbox).value).toBeNull();
    const plain = mount<TsyCheckbox>(
      '<tsy-checkbox name="a" checked>A</tsy-checkbox>',
    );
    expect(formState(plain).value).toBe('on');
  });

  it('turns a click into change from the element and clears indeterminate', () => {
    const checkbox = mount<TsyCheckbox>(
      '<tsy-checkbox indeterminate aria-label="Select all"></tsy-checkbox>',
    );
    const input = box(checkbox);
    expect(input.indeterminate).toBe(true);
    expect(input.getAttribute('aria-label')).toBe('Select all');
    const heard = vi.fn();
    checkbox.addEventListener('change', heard);
    input.click();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(checkbox.checked).toBe(true);
    expect(checkbox.indeterminate).toBe(false);
    expect(checkbox.hasAttribute('indeterminate')).toBe(false);
  });

  it('is invalid while required and unchecked', () => {
    const checkbox = mount<TsyCheckbox>(
      '<tsy-checkbox required error="Accept the terms.">I accept</tsy-checkbox>',
    );
    expect(formState(checkbox).flags.valueMissing).toBe(true);
    expect(box(checkbox).getAttribute('aria-describedby')).toBe('error');
    expect(box(checkbox).getAttribute('aria-invalid')).toBe('true');
    checkbox.checked = true;
    expect(formState(checkbox).flags).toEqual({});
  });

  it('resets to its checked attribute', () => {
    const checkbox = mount<TsyCheckbox>(
      '<tsy-checkbox checked>A</tsy-checkbox>',
    );
    checkbox.checked = false;
    checkbox.formResetCallback();
    expect(checkbox.checked).toBe(true);
  });
});

describe('<tsy-radio-group>', () => {
  async function group(attributes = ''): Promise<TsyRadioGroup> {
    const element = mount<TsyRadioGroup>(`
      <tsy-radio-group label="Delivery" name="delivery" ${attributes}>
        <tsy-radio value="home">To the door</tsy-radio>
        <tsy-radio value="desk" disabled>Stop desk</tsy-radio>
        <tsy-radio value="pickup" hint="Free">Pick up</tsy-radio>
      </tsy-radio-group>`);
    await settle();
    return element;
  }

  function radios(element: TsyRadioGroup): TsyRadio[] {
    return element.radios;
  }

  it('is a labelled radio group of radios', async () => {
    const element = await group();
    const base = pick(shadow(element), '[role="radiogroup"]');
    expect(base.getAttribute('aria-labelledby')).toBe('label');
    expect(pick(shadow(element), '#label').textContent).toBe('Delivery');
    for (const radio of radios(element)) {
      expect(radio.getAttribute('role')).toBe('radio');
      expect(radio.getAttribute('aria-checked')).toBe('false');
    }
    expect(radios(element)[1]?.getAttribute('aria-disabled')).toBe('true');
    expect(radios(element)[2]?.getAttribute('aria-description')).toBe('Free');
  });

  it('puts one radio in the tab order: the chosen one, else the first enabled', async () => {
    const element = await group();
    expect(radios(element).map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    element.value = 'pickup';
    expect(radios(element).map((r) => r.tabIndex)).toEqual([-1, -1, 0]);
    expect(radios(element)[2]?.getAttribute('aria-checked')).toBe('true');
  });

  it('chooses on click and says so with input and change', async () => {
    const element = await group();
    const changes = vi.fn();
    const inputs = vi.fn();
    element.addEventListener('change', changes);
    element.addEventListener('input', inputs);
    radios(element)[2]?.click();
    expect(element.value).toBe('pickup');
    expect(formState(element).value).toBe('pickup');
    expect(changes).toHaveBeenCalledTimes(1);
    expect(inputs).toHaveBeenCalledTimes(1);
    radios(element)[2]?.click();
    expect(changes).toHaveBeenCalledTimes(1);
    radios(element)[1]?.click();
    expect(element.value).toBe('pickup');
  });

  it('moves with the arrow keys, skipping disabled radios and wrapping', async () => {
    const element = await group('value="home"');
    const [home, , pickup] = radios(element);
    if (!home || !pickup) throw new Error('radios missing');
    expect(press(home, 'ArrowDown').defaultPrevented).toBe(true);
    expect(element.value).toBe('pickup');
    press(pickup, 'ArrowDown');
    expect(element.value).toBe('home');
    press(home, 'ArrowUp');
    expect(element.value).toBe('pickup');
    press(pickup, 'ArrowLeft');
    expect(element.value).toBe('home');
  });

  it('mirrors left and right in a right-to-left page', async () => {
    document.documentElement.setAttribute('dir', 'rtl');
    const element = await group('value="home"');
    const [home] = radios(element);
    if (!home) throw new Error('radio missing');
    press(home, 'ArrowLeft');
    expect(element.value).toBe('pickup');
    const pickup = radios(element)[2];
    if (!pickup) throw new Error('radio missing');
    press(pickup, 'ArrowRight');
    expect(element.value).toBe('home');
  });

  it('is invalid while required and nothing is chosen, in the page language', async () => {
    document.documentElement.setAttribute('lang', 'ar');
    const element = await group('required');
    expect(formState(element).flags.valueMissing).toBe(true);
    expect(formState(element).message).toBe('اختر خيارًا.');
    expect(formState(element).anchor).toBe(radios(element)[0]);
    element.value = 'home';
    expect(formState(element).flags).toEqual({});
  });

  it('disables every radio when disabled', async () => {
    const element = await group('disabled');
    for (const radio of radios(element)) {
      expect(radio.getAttribute('aria-disabled')).toBe('true');
      expect(radio.tabIndex).toBe(-1);
    }
    radios(element)[0]?.click();
    expect(element.value).toBe('');
  });

  it('resets to its value attribute', async () => {
    const element = await group('value="home"');
    element.value = 'pickup';
    element.formResetCallback();
    expect(element.value).toBe('home');
    expect(radios(element)[0]?.checked).toBe(true);
  });
});
