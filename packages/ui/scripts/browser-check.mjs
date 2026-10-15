// The real-browser check of @tassyir/ui (AP-K1.5), local only: a headless
// Chrome driven over the DevTools protocol (no dependency), against the demo
// served under a strict CSP (scripts/demo-server.mjs).
//   1. demo/checks.html: forms, validity, keyboard, direction, CSP;
//   2. the demo page's accessibility tree: every control has a name;
//   3. the keyboard: Tab reaches every kind of control, a radio group once;
//   4. the demo in ar/en × light/dark × 390/1440 px: the page fits the
//      screen, no error, and a full-page screenshot of each.
// Usage: npm run build -w @tassyir/ui && npm run browser-check -w @tassyir/ui -- [--out <dir>]
//   CHROME_PATH (default: macOS Google Chrome); TASSYIR_UI_DEMO_GEIST, see demo-server.mjs.
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startDemoServer } from './demo-server.mjs';

/**
 * @typedef {{ method: string, sessionId?: string, params: Record<string, unknown> }} CdpEvent
 * @typedef {{ id?: number, error?: unknown, result?: unknown, method?: string, sessionId?: string, params?: Record<string, unknown> }} CdpMessage
 * @typedef {{ nodeId: string, ignored: boolean, role?: { value?: string }, name?: { value?: string } }} AxNode
 */

const CHROME =
  process.env['CHROME_PATH'] ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/** How long one DevTools call or one page load may take. */
const TIMEOUT_MS = 30_000;
const outFlag = process.argv.indexOf('--out');
const OUT = resolve(
  outFlag === -1
    ? join(tmpdir(), 'tassyir-ui-screenshots')
    : (process.argv[outFlag + 1] ?? '.'),
);

if (!existsSync(CHROME)) {
  console.error(
    `No Chrome at ${CHROME}. Set CHROME_PATH to a Chrome or Chromium binary.`,
  );
  process.exit(1);
}

/** @type {string[]} */
const failures = [];
/** @param {string} line */
const say = (line) => {
  console.log(line);
};
/** @param {boolean} ok @param {string} name @param {string} [detail] */
function record(ok, name, detail = '') {
  say(`${ok ? '✓' : '✗'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
}

const profile = mkdtempSync(join(tmpdir(), 'tassyir-ui-chrome-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const server = await startDemoServer(0);

try {
  // Chrome writes its port into the profile once it listens.
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i += 1) {
    await new Promise((done) => setTimeout(done, 100));
  }
  if (!existsSync(portFile)) throw new Error('Chrome did not start in 10 s');
  const [port = '', path = ''] = readFileSync(portFile, 'utf8').split('\n');
  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  await new Promise((done, fail) => {
    socket.addEventListener('open', done, { once: true });
    socket.addEventListener('error', fail, { once: true });
  });

  let nextId = 1;
  /** @type {Map<number, { resolve: (value: unknown) => void, reject: (error: Error) => void }>} */
  const pending = new Map();
  /** @type {((event: CdpEvent) => void)[]} */
  const listeners = [];
  socket.addEventListener('message', (event) => {
    /** @type {unknown} */
    const parsed = JSON.parse(String(event.data));
    const message = /** @type {CdpMessage} */ (parsed);
    if (message.id !== undefined) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        waiter?.reject(new Error(JSON.stringify(message.error)));
      } else {
        waiter?.resolve(message.result);
      }
    } else if (message.method) {
      const cdpEvent = /** @type {CdpEvent} */ ({
        method: message.method,
        sessionId: message.sessionId,
        params: message.params ?? {},
      });
      for (const listener of [...listeners]) listener(cdpEvent);
    }
  });
  /**
   * @param {string} method
   * @param {object} [params]
   * @param {string} [sessionId]
   * @returns {Promise<unknown>}
   */
  const send = (method, params = {}, sessionId) =>
    new Promise((resolveCall, rejectCall) => {
      const id = nextId;
      nextId += 1;
      // A stalled Chrome fails the check instead of hanging it.
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectCall(
          new Error(`${method}: no answer in ${String(TIMEOUT_MS)} ms`),
        );
      }, TIMEOUT_MS);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolveCall(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          rejectCall(error);
        },
      });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

  const { targetId } = /** @type {{ targetId: string }} */ (
    await send('Target.createTarget', { url: 'about:blank' })
  );
  const { sessionId } = /** @type {{ sessionId: string }} */ (
    await send('Target.attachToTarget', { targetId, flatten: true })
  );
  /** @param {string} method @param {object} [params] */
  const page = (method, params) => send(method, params, sessionId);

  /** @type {string[]} */
  let problems = [];
  listeners.push((event) => {
    if (event.sessionId !== sessionId) return;
    if (event.method === 'Runtime.exceptionThrown') {
      const { exceptionDetails } =
        /** @type {{ exceptionDetails: { text: string, exception?: { description?: string } } }} */ (
          event.params
        );
      problems.push(
        exceptionDetails.exception?.description ?? exceptionDetails.text,
      );
    }
    if (event.method === 'Runtime.consoleAPICalled') {
      const { type, args } =
        /** @type {{ type: string, args: { value?: unknown, description?: string }[] }} */ (
          event.params
        );
      if (type === 'error') {
        problems.push(
          args.map((arg) => arg.description ?? String(arg.value)).join(' '),
        );
      }
    }
    if (event.method === 'Log.entryAdded') {
      const { entry } =
        /** @type {{ entry: { level: string, text: string } }} */ (
          event.params
        );
      if (entry.level === 'error') problems.push(entry.text);
    }
  });
  await page('Page.enable');
  await page('Runtime.enable');
  await page('Log.enable');
  await page('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });

  /** @param {string} expression @returns {Promise<unknown>} */
  const evaluate = async (expression) => {
    const { result, exceptionDetails } =
      /** @type {{ result: { value?: unknown }, exceptionDetails?: { text: string } }} */ (
        await page('Runtime.evaluate', {
          expression,
          awaitPromise: true,
          returnByValue: true,
        })
      );
    if (exceptionDetails) throw new Error(exceptionDetails.text);
    return result.value;
  };

  /** @param {string} url */
  const open = async (url) => {
    problems = [];
    const loaded = new Promise((done, fail) => {
      const timer = setTimeout(() => {
        fail(new Error(`${url} did not load in ${String(TIMEOUT_MS)} ms`));
      }, TIMEOUT_MS);
      /** @param {CdpEvent} event */
      const listener = (event) => {
        if (
          event.sessionId === sessionId &&
          event.method === 'Page.loadEventFired'
        ) {
          clearTimeout(timer);
          listeners.splice(listeners.indexOf(listener), 1);
          done(undefined);
        }
      };
      listeners.push(listener);
    });
    await page('Page.navigate', { url });
    await loaded;
    await evaluate(
      "Promise.all([customElements.whenDefined('tsy-spinner'), document.fonts.ready]).then(() => new Promise((r) => setTimeout(r, 150)))",
    );
  };

  /** @param {number} width */
  const viewport = (width) =>
    page('Emulation.setDeviceMetricsOverride', {
      width,
      height: width < 768 ? 844 : 900,
      deviceScaleFactor: 2,
      mobile: width < 768,
    });

  // 1. Behaviour in a real browser.
  say('\nBehaviour (demo/checks.html)');
  await viewport(1440);
  await open(`${server.url}/demo/checks.html`);
  const checks =
    /** @type {{ name: string, ok: boolean, detail: string }[]} */ (
      await evaluate('window.__checks')
    );
  for (const each of checks) record(each.ok, each.name, each.detail);
  record(
    problems.length === 0,
    'no error in the console',
    problems.join(' | '),
  );

  // 2. Names in the accessibility tree.
  say('\nAccessibility tree (demo, en)');
  await open(`${server.url}/demo/?locale=en&theme=light`);
  const { nodes } = /** @type {{ nodes: AxNode[] }} */ (
    await page('Accessibility.getFullAXTree')
  );
  const NAMED = [
    'button',
    'link',
    'textbox',
    'searchbox',
    'combobox',
    'checkbox',
    'radio',
    'radiogroup',
    'spinbutton',
    'table',
    'heading',
  ];
  const visible = nodes.filter((node) => !node.ignored);
  const nameless = visible.filter(
    (node) =>
      NAMED.includes(node.role?.value ?? '') &&
      (node.name?.value ?? '').trim() === '',
  );
  const roles = new Set(visible.map((node) => node.role?.value ?? ''));
  record(
    nameless.length === 0,
    'every button, link, field, choice, table and heading has a name',
    nameless.map((node) => node.role?.value ?? '').join(', '),
  );
  record(
    [
      'button',
      'link',
      'textbox',
      'combobox',
      'checkbox',
      'radio',
      'radiogroup',
      'table',
      'heading',
      'status',
      'alert',
    ].every((role) => roles.has(role)),
    'the tree has every role the elements promise',
    [...roles].filter(Boolean).sort().join(' '),
  );

  // 3. The keyboard.
  say('\nKeyboard (demo, en)');
  /** @type {string[]} */
  const stops = [];
  const tab = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 };
  for (let i = 0; i < 60; i += 1) {
    await page('Input.dispatchKeyEvent', { type: 'keyDown', ...tab });
    await page('Input.dispatchKeyEvent', { type: 'keyUp', ...tab });
    stops.push(
      String(
        await evaluate(`(() => {
          let a = document.activeElement;
          while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
          const host = a.getRootNode().host;
          return (host ? host.localName + '>' : '') + a.localName + (a.getAttribute('value') ? '[' + a.getAttribute('value') + ']' : '');
        })()`),
      ),
    );
  }
  /** @param {string} prefix */
  const reached = (prefix) => stops.some((stop) => stop.startsWith(prefix));
  record(
    [
      'tsy-button>button',
      'tsy-button>a',
      'tsy-link>a',
      'tsy-text-field>input',
      'tsy-text-field>textarea',
      'tsy-select>select',
      'tsy-checkbox>input',
      'tsy-radio',
    ].every(reached),
    'Tab reaches buttons, links, fields, selects, checkboxes and radios',
  );
  const radioStops = stops.filter((stop) => stop.startsWith('tsy-radio'));
  record(
    radioStops.length === 1,
    'a radio group is one Tab stop',
    radioStops.join(' '),
  );
  record(
    !stops.some((stop) => stop.includes('[email]')),
    'a disabled radio is never reached',
  );

  // 4. The matrix.
  say('\nThe demo in both languages, both themes, at 390 and 1440 px');
  mkdirSync(OUT, { recursive: true });
  for (const locale of ['ar', 'en']) {
    for (const theme of ['light', 'dark']) {
      for (const width of [390, 1440]) {
        await viewport(width);
        await open(`${server.url}/demo/?locale=${locale}&theme=${theme}`);
        const label = `${locale} ${theme} ${String(width)}`;
        const state =
          /** @type {{ dir: string, scheme: string, pageWidth: number, viewWidth: number, wide: string[], height: number }} */ (
            await evaluate(`(() => {
              // Elements past the screen's edges, shadow roots included; the
              // deepest ones name the culprit when the page is too wide.
              const wide = [];
              const walk = (root) => {
                for (const element of root.querySelectorAll('*')) {
                  const box = element.getBoundingClientRect();
                  if (box.width > 0 && (box.right > ${String(width)} + 1 || box.left < -1)) {
                    const host = element.getRootNode().host;
                    wide.push((host ? host.localName + '>' : '') + element.localName);
                  }
                  if (element.shadowRoot) walk(element.shadowRoot);
                }
              };
              walk(document);
              return {
                dir: document.documentElement.dir,
                scheme: getComputedStyle(document.documentElement).colorScheme,
                pageWidth: document.documentElement.scrollWidth,
                viewWidth: innerWidth,
                wide: wide.slice(-6),
                height: Math.ceil(document.documentElement.scrollHeight),
              };
            })()`)
          );
        record(
          state.dir === (locale === 'ar' ? 'rtl' : 'ltr') &&
            state.scheme === theme,
          `${label}: direction and theme applied`,
          `${state.dir}, ${state.scheme}`,
        );
        record(
          state.pageWidth <= width && state.viewWidth === width,
          `${label}: the page fits the screen, never scrolls sideways`,
          `${String(state.pageWidth)} px wide${state.pageWidth > width ? `; too wide: ${state.wide.join(' ')}` : ''}`,
        );
        record(
          problems.length === 0,
          `${label}: no error`,
          problems.join(' | '),
        );
        const { data } = /** @type {{ data: string }} */ (
          await page('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: true,
            clip: { x: 0, y: 0, width, height: state.height, scale: 1 },
          })
        );
        const file = join(OUT, `${locale}-${theme}-${String(width)}.png`);
        writeFileSync(file, Buffer.from(data, 'base64'));
      }
    }
  }
  say(`\nScreenshots: ${OUT}`);
  socket.close();
} finally {
  await new Promise((done) => {
    chrome.once('exit', done);
    chrome.kill();
  });
  await server.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
}

if (failures.length > 0) {
  console.error(`\n${String(failures.length)} check(s) failed.`);
  process.exit(1);
}
say('\nAll browser checks passed.');
