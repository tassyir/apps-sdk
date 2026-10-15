// What happy-dom cannot show, checked in a real browser: form-associated
// elements in a real <form> (FormData, validity, reset, a disabled
// fieldset), a label click, submit on Enter and on the button, the arrow
// keys, the direction flip in a shadow root, and no CSP violation. The
// result is window.__checks (scripts/browser-check.mjs reads it) and #results.
import { applyDashboardContext } from '/dist/index.js';

const violations = [];
document.addEventListener('securitypolicyviolation', (event) => {
  violations.push(`${event.violatedDirective}: ${event.blockedURI}`);
});

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail: String(detail) });
}

const $ = (selector) => document.querySelector(selector);
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const inner = (element, selector = '[part="control"]') =>
  element.shadowRoot.querySelector(selector);

async function run() {
  await customElements.whenDefined('tsy-radio');
  await tick();
  const form = $('#form');

  const entries = [...new FormData(form).entries()].map(
    ([k, v]) => `${k}=${v}`,
  );
  check(
    'FormData holds every named element',
    JSON.stringify(entries) ===
      JSON.stringify([
        'name=Dar Amina',
        'note=',
        'wilaya=31',
        'notify=on',
        'channel=sms',
      ]),
    entries.join('&'),
  );

  const name = $('#name');
  name.value = '';
  check('a required empty field makes the form invalid', !form.checkValidity());
  check('its validity says valueMissing', name.validity.valueMissing === true);
  name.value = 'Dar Sara';
  check('filled, the form is valid', form.checkValidity());

  form.reset();
  await tick();
  check(
    'form.reset() brings back the defaults',
    name.value === 'Dar Amina' &&
      $('#channel').value === 'sms' &&
      $('#notify').checked,
  );

  $('#fieldset').disabled = true;
  await tick();
  check(
    'a disabled fieldset disables the inner input',
    inner(name).disabled === true,
  );
  $('#fieldset').disabled = false;
  await tick();

  inner(name, 'label').click();
  check(
    'clicking the label focuses the input',
    name.shadowRoot.activeElement === inner(name) &&
      document.activeElement === name,
  );

  let submits = 0;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submits += 1;
  });
  const enter = (element) =>
    inner(element).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
  enter(name);
  await tick();
  check('Enter in a field clicks the submit button', submits === 1);
  $('#submit').loading = true;
  enter(name);
  await tick();
  check('Enter does nothing while the submit button is loading', submits === 1);
  $('#submit').loading = false;
  enter($('#note'));
  await tick();
  check('Enter in a text area does not submit', submits === 1);
  inner($('#submit')).click();
  await tick();
  check('the submit button submits the form', submits === 2);

  const off = $('#off');
  off.required = true;
  let validOnInput = null;
  off.addEventListener(
    'input',
    () => {
      validOnInput = off.checkValidity();
    },
    { once: true },
  );
  inner(off).click();
  check(
    "a checkbox's validity is up to date in the page's input listener",
    validOnInput === true,
    String(validOnInput),
  );
  off.required = false;
  off.checked = false;

  const select = $('#wilaya');
  select.replaceChildren(
    new Option('Constantine', '25'),
    new Option('Sétif', '19'),
  );
  select.value = '19';
  await tick();
  check(
    'a select keeps a value set while its options are replaced',
    select.value === '19' && new FormData(form).get('wilaya') === '19',
    select.value,
  );

  const radios = $('#channel').radios;
  radios[0].focus();
  radios[0].dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
  );
  check(
    'ArrowDown chooses and focuses the next radio',
    $('#channel').value === 'whatsapp' && document.activeElement === radios[1],
  );
  check(
    'one radio is in the tab order',
    radios.map((r) => r.tabIndex).join() === '-1,0',
  );

  const title = () =>
    getComputedStyle($('#header').shadowRoot.querySelector('h1'));
  const caret = () =>
    getComputedStyle($('#header').shadowRoot.querySelector('.back .icon'))
      .transform;
  const ltrSize = title().fontSize;
  const ltrCaret = caret();
  applyDashboardContext({ locale: 'ar', dir: 'rtl', theme: 'dark' });
  await tick();
  check('the page title is 24px left to right', ltrSize === '24px', ltrSize);
  check(
    'and 22px right to left',
    title().fontSize === '22px',
    title().fontSize,
  );
  check(
    'the back caret flips right to left (:dir() in a shadow root)',
    ltrCaret === 'none' && caret().startsWith('matrix(-1'),
    `${ltrCaret} → ${caret()}`,
  );
  check(
    'the back link is worded in Arabic',
    $('#header').shadowRoot.querySelector('.back').textContent === 'رجوع',
  );
  const background = getComputedStyle(document.documentElement).backgroundColor;
  check(
    'dark: the page turns to dark paper',
    getComputedStyle(document.documentElement).colorScheme === 'dark' &&
      /^(rgb|color|oklch)/.test(background),
    background,
  );
  check(
    'dark: the primary button inverts to a near-white fill',
    getComputedStyle(inner($('#submit'))).color !==
      getComputedStyle(document.body).color,
  );

  check(
    'no Content-Security-Policy violation',
    violations.length === 0,
    violations.join(' | '),
  );
  return results;
}

window.__checks = run().then(
  (all) => {
    $('#results').textContent = all
      .map(
        (r) =>
          `${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ` (${r.detail})` : ''}`,
      )
      .join('\n');
    return all;
  },
  (error) => {
    $('#results').textContent = `ERROR ${error}`;
    return [{ name: 'the checks ran', ok: false, detail: String(error) }];
  },
);
