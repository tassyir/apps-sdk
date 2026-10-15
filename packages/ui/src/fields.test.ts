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
import type { TsySelect } from './select.js';
import type { TsyTextField } from './text-field.js';

afterEach(reset);

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- as querySelector<T>
function control<T extends HTMLElement = HTMLInputElement>(
  element: Element,
): T {
  return pick<T>(shadow(element), '[part="control"]');
}

describe('<tsy-text-field>', () => {
  it('labels its input and describes it with the hint and the error', () => {
    const field = mount<TsyTextField>(
      '<tsy-text-field label="Store name" hint="Shown to buyers."></tsy-text-field>',
    );
    const input = control(field);
    const label = pick<HTMLLabelElement>(shadow(field), 'label');
    expect(label.textContent).toBe('Store name');
    expect(label.htmlFor).toBe(input.id);
    expect(input.getAttribute('aria-describedby')).toBe('hint');
    expect(input.hasAttribute('aria-invalid')).toBe(false);

    field.setAttribute('error', 'Enter a name.');
    expect(input.getAttribute('aria-describedby')).toBe('hint error');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(pick(shadow(field), '#error').textContent).toBe('Enter a name.');
    expect(pick(shadow(field), '.box').classList.contains('invalid')).toBe(
      true,
    );

    field.removeAttribute('error');
    expect(pick(shadow(field), '#error').hidden).toBe(true);
  });

  it('keeps a hidden label for screen readers', () => {
    const field = mount<TsyTextField>(
      '<tsy-text-field label="Search orders" label-hidden type="search"></tsy-text-field>',
    );
    const label = pick(shadow(field), 'label');
    expect(label.classList.contains('sr-only')).toBe(true);
    expect(label.hidden).toBe(false);
  });

  it('submits its value under its name and follows typing', () => {
    const field = mount<TsyTextField>(
      '<tsy-text-field label="Name" name="name" value="Dar Amina"></tsy-text-field>',
    );
    expect(field.value).toBe('Dar Amina');
    expect(formState(field).value).toBe('Dar Amina');

    const input = control(field);
    input.value = 'Dar Sara';
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    expect(field.value).toBe('Dar Sara');
    expect(formState(field).value).toBe('Dar Sara');

    // The default (the attribute) no longer overrides what was typed.
    field.setAttribute('value', 'Other');
    expect(field.value).toBe('Dar Sara');
  });

  it('fires change from the element (the inner one stays in the shadow root)', () => {
    const field = mount<TsyTextField>(
      '<tsy-text-field label="Name"></tsy-text-field>',
    );
    const heard = vi.fn();
    field.addEventListener('change', heard);
    control(field).dispatchEvent(new Event('change', { bubbles: true }));
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('is invalid while required and empty, valid once filled', () => {
    const field = mount<TsyTextField>(
      '<tsy-text-field label="Phone" name="phone" type="tel" required></tsy-text-field>',
    );
    const input = control(field);
    expect(input.required).toBe(true);
    expect(formState(field).flags.valueMissing).toBe(true);
    expect(formState(field).anchor).toBe(input);
    expect(field.checkValidity()).toBe(false);
    field.value = '0555123456';
    expect(formState(field).flags).toEqual({});
    expect(field.checkValidity()).toBe(true);
  });

  it('types email, phone, address and password left to right', () => {
    for (const type of ['email', 'tel', 'url', 'password']) {
      const field = mount<TsyTextField>(
        `<tsy-text-field label="x" type="${type}"></tsy-text-field>`,
      );
      expect(control(field).getAttribute('dir')).toBe('ltr');
    }
    const text = mount<TsyTextField>(
      '<tsy-text-field label="x"></tsy-text-field>',
    );
    expect(control(text).hasAttribute('dir')).toBe(false);
  });

  it('passes the native constraints and hints to the input', () => {
    const field = mount<TsyTextField>(
      '<tsy-text-field label="Qty" type="number" min="1" max="99" step="1" placeholder="1" inputmode="numeric" autocomplete="off"></tsy-text-field>',
    );
    const input = control(field);
    expect(input.type).toBe('number');
    for (const [name, value] of [
      ['min', '1'],
      ['max', '99'],
      ['step', '1'],
      ['placeholder', '1'],
      ['inputmode', 'numeric'],
      ['autocomplete', 'off'],
    ]) {
      expect(input.getAttribute(name ?? '')).toBe(value);
    }
  });

  it('shows a prefix or suffix and reads it with the input', () => {
    const field = mount<TsyTextField>(
      '<tsy-text-field label="Price" suffix="DZD"></tsy-text-field>',
    );
    expect(pick(shadow(field), '#suffix').textContent).toBe('DZD');
    expect(pick(shadow(field), '#prefix').hidden).toBe(true);
    expect(control(field).getAttribute('aria-describedby')).toBe('suffix');
  });

  it('becomes a text area with multiline, keeping its value', () => {
    const field = mount<TsyTextField>(
      '<tsy-text-field label="Note" value="Call after 6pm"></tsy-text-field>',
    );
    field.setAttribute('multiline', '');
    field.setAttribute('rows', '4');
    const area = control<HTMLTextAreaElement>(field);
    expect(area).toBeInstanceOf(HTMLTextAreaElement);
    expect(area.value).toBe('Call after 6pm');
    expect(area.getAttribute('rows')).toBe('4');
  });

  it('submits its form on Enter, like a native field', () => {
    const form = mount<HTMLFormElement>(
      '<form><tsy-text-field label="Name" name="name"></tsy-text-field></form>',
    );
    const submit = vi.fn((event: Event) => {
      event.preventDefault();
    });
    form.addEventListener('submit', submit);
    const field = pick<TsyTextField>(form, 'tsy-text-field');
    control(field).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('goes back to its default on form reset, and follows a disabled fieldset', () => {
    const field = mount<TsyTextField>(
      '<tsy-text-field label="Name" value="A"></tsy-text-field>',
    );
    field.value = 'B';
    field.formResetCallback();
    expect(field.value).toBe('A');
    field.formDisabledCallback(true);
    expect(control(field).disabled).toBe(true);
    expect(pick(shadow(field), '.box').classList.contains('disabled')).toBe(
      true,
    );
  });
});

describe('<tsy-select>', () => {
  it('mirrors its options into a labelled native select', async () => {
    const select = mount<TsySelect>(`
      <tsy-select label="Wilaya" name="wilaya" value="31">
        <option value="16">Alger</option>
        <option value="31">Oran</option>
      </tsy-select>`);
    const inner = control<HTMLSelectElement>(select);
    expect(Array.from(inner.options).map((o) => o.textContent)).toEqual([
      'Alger',
      'Oran',
    ]);
    expect(select.value).toBe('31');
    expect(formState(select).value).toBe('31');
    expect(pick<HTMLLabelElement>(shadow(select), 'label').htmlFor).toBe(
      inner.id,
    );

    select.append(
      Object.assign(document.createElement('option'), {
        value: '25',
        textContent: 'Constantine',
      }),
    );
    await settle();
    expect(inner.options).toHaveLength(3);
    expect(select.value).toBe('31');
  });

  it('starts on its placeholder, which a required select refuses', () => {
    const select = mount<TsySelect>(`
      <tsy-select label="Carrier" placeholder="Choose a carrier" required>
        <option value="yalidine">Yalidine</option>
      </tsy-select>`);
    const inner = control<HTMLSelectElement>(select);
    expect(inner.options[0]?.textContent).toBe('Choose a carrier');
    expect(inner.options[0]?.disabled).toBe(true);
    expect(select.value).toBe('');
    expect(inner.classList.contains('placeholder')).toBe(true);
    expect(formState(select).flags.valueMissing).toBe(true);

    inner.value = 'yalidine';
    inner.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    expect(select.value).toBe('yalidine');
    expect(formState(select).flags).toEqual({});
    expect(inner.classList.contains('placeholder')).toBe(false);
  });

  it('honours a selected option, and resets to it', () => {
    const select = mount<TsySelect>(`
      <tsy-select label="Size">
        <option value="s">S</option>
        <option value="m" selected>M</option>
      </tsy-select>`);
    expect(select.value).toBe('m');
    select.value = 's';
    select.formResetCallback();
    expect(select.value).toBe('m');
  });

  it('fires change from the element and describes its error', () => {
    const select = mount<TsySelect>(
      '<tsy-select label="Size" error="Pick a size."><option>S</option></tsy-select>',
    );
    const heard = vi.fn();
    select.addEventListener('change', heard);
    const inner = control<HTMLSelectElement>(select);
    inner.dispatchEvent(new Event('change', { bubbles: true }));
    expect(heard).toHaveBeenCalledTimes(1);
    expect(inner.getAttribute('aria-invalid')).toBe('true');
    expect(inner.getAttribute('aria-describedby')).toBe('error');
  });
});
