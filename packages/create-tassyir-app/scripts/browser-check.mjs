// The real-browser check of the starter's embedded page (the external
// template's src/page), local only, like @tassyir/ui's
// (packages/ui/scripts/browser-check.mjs). It takes a project that
// `npm run check:template -- --keep` generated, installed and built:
//   - the project's own server (node src/server.ts, throwaway settings)
//     serves the page with its real Content-Security-Policy;
//   - a fake dashboard at https://app.tassyir.io (Chrome maps the name to a
//     local https server with a self-signed certificate) frames the page and
//     answers App Bridge in the dashboard's shapes (§3.9);
//   - a headless Chrome, driven over the DevTools protocol (no dependency),
//     reaches the page's out-of-process frame and answers its /api calls
//     with sample orders and settings: nothing reaches Tassyir.
// It checks the page in ar/en × light/dark × 390/1440 px (lang, dir and
// theme on <html>, the frame the screen's width, no error and no CSP
// violation, the title bar), then the save bar, a field error, a save with a
// fresh ID token, Open, a live context change and the empty state, with a
// screenshot of each.
// Usage:
//   npm run build && npm run check:template -- --keep
//   npm run browser-check -w create-tassyir-app -- <kept folder> [--out <dir>]
//   CHROME_PATH (default: macOS Google Chrome); needs openssl.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * @typedef {{ method: string, sessionId?: string, params: Record<string, unknown> }} CdpEvent
 * @typedef {{ id?: number, error?: unknown, result?: unknown, method?: string, sessionId?: string, params?: Record<string, unknown> }} CdpMessage
 * @typedef {{ type: string, payload: Record<string, unknown> }} BridgeCall
 * @typedef {{ method: string, path: string, token: string, body: string }} ApiCall
 * @typedef {{ id: string, orderNumber: string, total: string, currency: string, createdAt: string }} Order
 */

const CHROME =
  process.env['CHROME_PATH'] ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/** The only site the page lets frame it (frame-ancestors). */
const DASHBOARD_ORIGIN = 'https://app.tassyir.io';
/** How long one DevTools call, or one wait for the page, may take. */
const TIMEOUT_MS = 30_000;
/** The folder check:template generates the project in. */
const GENERATED_FOLDER = 'my-tassyir-app';
const USAGE =
  'npm run browser-check -w create-tassyir-app -- <project> [--out <dir>]';

// npm runs a workspace script in the package's folder: paths on the command
// line are relative to where it was typed.
const here = process.env['INIT_CWD'] ?? process.cwd();
const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const OUT = resolve(
  here,
  outFlag === -1
    ? join(tmpdir(), 'tassyir-starter-screenshots')
    : (args[outFlag + 1] ?? '.'),
);
const given = args.find(
  (arg, index) =>
    !arg.startsWith('--') && (outFlag === -1 || index !== outFlag + 1),
);
if (given === undefined) {
  stop(
    'Which generated project? None was given.',
    `Run npm run build && npm run check:template -- --keep, then ${USAGE} with the folder it kept.`,
  );
}
const PROJECT = projectIn(resolve(here, given));
if (!existsSync(join(PROJECT, 'dist', 'public', 'app.js'))) {
  stop(
    `${PROJECT} has no built page (dist/public/app.js).`,
    `Run npm run build in ${PROJECT}, or generate it again with npm run check:template -- --keep.`,
  );
}
if (!existsSync(CHROME)) {
  stop(
    `No Chrome at ${CHROME}.`,
    'Set CHROME_PATH to a Chrome or Chromium binary.',
  );
}

const TITLES = { en: 'Pending orders', ar: 'الطلبات المعلّقة' };
/** @type {Order[]} */
const ORDERS = [
  {
    id: '741000000000032001',
    orderNumber: '00001042',
    total: '7500.00',
    currency: 'DZD',
    createdAt: '2026-10-15T08:12:00.000Z',
  },
  {
    id: '741000000000032002',
    orderNumber: '00001041',
    total: '12900.00',
    currency: 'DZD',
    createdAt: '2026-10-15T07:40:00.000Z',
  },
  {
    id: '741000000000032003',
    orderNumber: '00001040',
    total: '2450.50',
    currency: 'DZD',
    createdAt: '2026-10-14T19:05:00.000Z',
  },
  {
    id: '741000000000032004',
    orderNumber: '00001039',
    total: '31000.00',
    currency: 'DZD',
    createdAt: '2026-10-14T16:51:00.000Z',
  },
];
/** What the page's /api calls get; the steps below change it. */
const sample = {
  settings: /** @type {{ highlightFrom: string | null }} */ ({
    highlightFrom: '10000.00',
  }),
  orders: { orders: ORDERS, more: true },
};
/** @type {ApiCall[]} */
const apiCalls = [];

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
/** @param {number} ms */
const sleep = (ms) =>
  new Promise((done) => {
    setTimeout(done, ms);
  });

const work = mkdtempSync(join(tmpdir(), 'tassyir-starter-check-'));

// The project's own server, with throwaway settings in the right shapes.
const appPort = await freePort();
const server = spawn(process.execPath, ['src/server.ts'], {
  cwd: PROJECT,
  env: {
    ...process.env,
    TASSYIR_CLIENT_ID: 'app_check',
    TASSYIR_CLIENT_SECRET: 'tsy_cs_check',
    TASSYIR_APP_ID: '1',
    TOKEN_STORE_KEY: randomBytes(32).toString('base64'),
    PORT: String(appPort),
    DATA_DIR: join(work, 'data'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
server.stdout.on('data', (chunk) => (serverOutput += String(chunk)));
server.stderr.on('data', (chunk) => (serverOutput += String(chunk)));
const APP = `http://127.0.0.1:${String(appPort)}`;

// The fake dashboard, served as https://app.tassyir.io.
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '1',
    '-subj',
    '/CN=app.tassyir.io',
    '-keyout',
    join(work, 'key.pem'),
    '-out',
    join(work, 'cert.pem'),
  ],
  { stdio: 'ignore' },
);
const dashboardPort = await freePort();
const dashboard = createHttpsServer(
  {
    key: readFileSync(join(work, 'key.pem')),
    cert: readFileSync(join(work, 'cert.pem')),
  },
  (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(dashboardPage(APP));
  },
);
await new Promise((done) => {
  dashboard.listen(dashboardPort, '127.0.0.1', () => {
    done(undefined);
  });
});

const profile = join(work, 'chrome');
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
    '--ignore-certificate-errors',
    `--host-resolver-rules=MAP app.tassyir.io 127.0.0.1:${String(dashboardPort)}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

try {
  await waitForHealth(`${APP}/health`);
  const policy =
    (await fetch(`${APP}/`)).headers.get('content-security-policy') ?? '';
  record(
    policy.includes("script-src 'self'") &&
      policy.includes("style-src 'self'") &&
      policy.includes(`frame-ancestors ${DASHBOARD_ORIGIN}`),
    'the page is served with its strict Content-Security-Policy',
    policy,
  );

  // Chrome writes its port into the profile once it listens.
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i += 1) await sleep(100);
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
  const { sessionId: top } = /** @type {{ sessionId: string }} */ (
    await send('Target.attachToTarget', { targetId, flatten: true })
  );
  /** The dashboard's tab. @param {string} method @param {object} [params] */
  const dashboardTab = (method, params) => send(method, params, top);

  // The page's frame is another process (another site): Chrome attaches it
  // paused, so the check can intercept its first /api call.
  /** @type {string | undefined} */
  let frame;
  /** Errors, warnings and CSP violations, of the dashboard or the page. @type {string[]} */
  let problems = [];
  /** @param {CdpEvent} event */
  const onEvent = async (event) => {
    if (event.method === 'Target.attachedToTarget') {
      const { sessionId, targetInfo } =
        /** @type {{ sessionId: string, targetInfo: { type: string } }} */ (
          event.params
        );
      if (targetInfo.type === 'iframe') {
        frame = sessionId;
        await send(
          'Fetch.enable',
          {
            patterns: [{ urlPattern: `${APP}/api/*`, requestStage: 'Request' }],
          },
          sessionId,
        );
        await send('Runtime.enable', {}, sessionId);
        await send('Log.enable', {}, sessionId);
      }
      await send('Runtime.runIfWaitingForDebugger', {}, sessionId);
      return;
    }
    if (event.sessionId !== top && event.sessionId !== frame) return;
    if (event.method === 'Fetch.requestPaused') {
      await answerApi(event.params, event.sessionId);
    } else if (event.method === 'Runtime.exceptionThrown') {
      const { exceptionDetails } =
        /** @type {{ exceptionDetails: { text: string, exception?: { description?: string } } }} */ (
          event.params
        );
      problems.push(
        exceptionDetails.exception?.description ?? exceptionDetails.text,
      );
    } else if (event.method === 'Runtime.consoleAPICalled') {
      const { type, args: values } =
        /** @type {{ type: string, args: { value?: unknown, description?: string }[] }} */ (
          event.params
        );
      if (type === 'error' || type === 'warning') {
        problems.push(
          `console.${type}: ${values.map((value) => value.description ?? String(value.value)).join(' ')}`,
        );
      }
    } else if (event.method === 'Log.entryAdded') {
      const { entry } =
        /** @type {{ entry: { level: string, text: string } }} */ (
          event.params
        );
      if (entry.level === 'error' || entry.level === 'warning') {
        problems.push(entry.text);
      }
    }
  };
  listeners.push((event) => {
    void onEvent(event).catch((/** @type {unknown} */ error) => {
      problems.push(`the check itself: ${String(error)}`);
    });
  });

  /**
   * Answers one of the page's /api calls with the sample data, as this
   * app's server would once it has the Admin API's answer.
   * @param {Record<string, unknown>} params
   * @param {string} [sessionId]
   */
  const answerApi = async (params, sessionId) => {
    const { requestId, request } =
      /** @type {{ requestId: string, request: { url: string, method: string, headers: Record<string, string>, postData?: string } }} */ (
        params
      );
    const path = new URL(request.url).pathname;
    const body = request.postData ?? '';
    apiCalls.push({
      method: request.method,
      path,
      token:
        request.headers['Authorization'] ??
        request.headers['authorization'] ??
        '',
      body,
    });
    /** @type {[number, unknown]} */
    let answer = [
      404,
      {
        code: 'NOT_FOUND',
        message: 'No such API route',
        fix: 'Check the method and path.',
      },
    ];
    if (path === '/api/settings' && request.method === 'GET') {
      answer = [200, sample.settings];
    } else if (path === '/api/settings' && request.method === 'PUT') {
      /** @type {unknown} */
      const saved = JSON.parse(body);
      sample.settings = /** @type {{ highlightFrom: string | null }} */ (saved);
      answer = [200, sample.settings];
    } else if (path === '/api/orders' && request.method === 'GET') {
      answer = [200, sample.orders];
    }
    await send(
      'Fetch.fulfillRequest',
      {
        requestId,
        responseCode: answer[0],
        responseHeaders: [{ name: 'content-type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify(answer[1])).toString('base64'),
      },
      sessionId,
    );
  };

  await dashboardTab('Page.enable');
  await dashboardTab('Runtime.enable');
  await dashboardTab('Log.enable');
  await dashboardTab('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: true,
  });

  /** @returns {string} */
  const pageFrame = () => {
    if (frame === undefined) throw new Error('the page is not framed yet');
    return frame;
  };
  /**
   * @param {string} sessionId
   * @param {string} expression
   * @returns {Promise<unknown>}
   */
  const evaluate = async (sessionId, expression) => {
    const { result, exceptionDetails } =
      /** @type {{ result: { value?: unknown }, exceptionDetails?: { text: string, exception?: { description?: string } } }} */ (
        await send(
          'Runtime.evaluate',
          { expression, awaitPromise: true, returnByValue: true },
          sessionId,
        )
      );
    if (exceptionDetails) {
      throw new Error(
        exceptionDetails.exception?.description ?? exceptionDetails.text,
      );
    }
    return result.value;
  };
  /** @param {string} expression */
  const inPage = (expression) => evaluate(pageFrame(), expression);
  /** @param {string} expression */
  const inDashboard = (expression) => evaluate(top, expression);
  /**
   * Whether the condition comes true in time.
   * @param {() => Promise<unknown> | unknown} condition
   */
  const becomes = async (condition) => {
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await Promise.resolve(condition()).catch(() => false)) return true;
      await sleep(100);
    }
    return false;
  };
  /**
   * Waits for what the next steps need, or stops the check.
   * @param {() => Promise<unknown> | unknown} condition
   * @param {string} what
   */
  const until = async (condition, what) => {
    if (await becomes(condition)) return;
    throw new Error(
      `timed out waiting for ${what}${problems.length > 0 ? `: ${problems.join(' | ')}` : ''}`,
    );
  };
  /** The App Bridge calls the page made since the dashboard loaded. */
  const bridgeCalls = async () =>
    /** @type {BridgeCall[]} */ (await inDashboard('window.__calls'));
  /** @param {string} type @param {object} [payload] */
  const dashboardSends = (type, payload = {}) =>
    inDashboard(
      `window.__send(${JSON.stringify(type)}, ${JSON.stringify(payload)})`,
    );
  /** @param {string} name */
  const screenshot = async (name) => {
    const { data } = /** @type {{ data: string }} */ (
      await dashboardTab('Page.captureScreenshot', { format: 'png' })
    );
    writeFileSync(
      join(OUT, `starter-${name}.png`),
      Buffer.from(data, 'base64'),
    );
  };
  /**
   * A real click, at the middle of the page's element: the frame fills the
   * dashboard's tab, so the page's coordinates are the tab's.
   * @param {string} selector
   */
  const click = async (selector) => {
    const { x, y } = /** @type {{ x: number, y: number }} */ (
      await inPage(`(() => {
        const box = ${selector}.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      })()`)
    );
    for (const type of ['mousePressed', 'mouseReleased']) {
      await dashboardTab('Input.dispatchMouseEvent', {
        type,
        x,
        y,
        button: 'left',
        clickCount: 1,
      });
    }
  };
  /** Replaces the setting field's text, typed as a person does. @param {string} text */
  const typeAmount = async (text) => {
    await click(
      "document.querySelector('tsy-text-field').shadowRoot.querySelector('input')",
    );
    await dashboardTab('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      commands: ['selectAll'],
    });
    await dashboardTab('Input.insertText', { text });
  };

  /** @param {'en' | 'ar'} locale @param {'light' | 'dark'} theme @param {number} width */
  const open = async (locale, theme, width) => {
    frame = undefined;
    problems = [];
    await dashboardTab('Emulation.setDeviceMetricsOverride', {
      width,
      height: width < 768 ? 844 : 900,
      deviceScaleFactor: 2,
      mobile: width < 768,
    });
    await dashboardTab('Page.navigate', {
      url: `${DASHBOARD_ORIGIN}/?locale=${locale}&theme=${theme}`,
    });
    await until(() => frame !== undefined, 'the dashboard to frame the page');
  };
  /** Until the page has drawn its data, its fonts loaded. @param {string} what */
  const drawn = async (what) => {
    await until(
      () =>
        inPage(
          "!!document.querySelector('tsy-text-field') && (!!document.querySelector('tsy-table tbody tr') || !!document.querySelector('tsy-empty-state'))",
        ),
      what,
    );
    await inPage(
      'document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 300)))',
    );
  };

  mkdirSync(OUT, { recursive: true });

  // 1. The matrix.
  say('\nThe page in both languages, both themes, at 390 and 1440 px');
  for (const locale of /** @type {const} */ (['ar', 'en'])) {
    for (const theme of /** @type {const} */ (['light', 'dark'])) {
      for (const width of [390, 1440]) {
        const label = `${locale}-${theme}-${String(width)}`;
        await open(locale, theme, width);
        await drawn(`${label}: the orders and the setting`);
        const facts =
          /** @type {{ lang: string, dir: string, theme: string, pageWidth: number, viewWidth: number, rows: number, pills: number, field: string, sheets: number, adopted: number, undefinedTags: string[] }} */ (
            await inPage(`(() => {
              const html = document.documentElement;
              return {
                lang: html.lang,
                dir: html.dir,
                theme: html.dataset.theme,
                pageWidth: html.scrollWidth,
                viewWidth: innerWidth,
                rows: document.querySelectorAll('tsy-table tbody tr').length,
                pills: document.querySelectorAll('tsy-status-pill').length,
                field: document.querySelector('tsy-text-field').value,
                sheets: document.styleSheets.length,
                adopted: document.adoptedStyleSheets.length,
                undefinedTags: [...document.querySelectorAll('*')]
                  .map((element) => element.localName)
                  .filter((tag) => tag.startsWith('tsy-') && !customElements.get(tag)),
              };
            })()`)
          );
        const title = (await bridgeCalls())
          .filter((call) => call.type === 'titleBar.set')
          .at(-1)?.payload['title'];
        record(
          facts.lang === locale &&
            facts.dir === (locale === 'ar' ? 'rtl' : 'ltr') &&
            facts.theme === theme,
          `${label}: <html> follows the dashboard's language and theme`,
          `${facts.lang} ${facts.dir} ${facts.theme}`,
        );
        record(
          facts.viewWidth === width && facts.pageWidth <= width,
          `${label}: the frame is the screen's width, never scrolls sideways`,
          `${String(facts.pageWidth)} px in ${String(facts.viewWidth)}`,
        );
        record(
          facts.rows === ORDERS.length && facts.pills === 2,
          `${label}: the orders, the two from 10000.00 highlighted`,
          `${String(facts.rows)} rows, ${String(facts.pills)} pills`,
        );
        record(
          facts.field === '10000.00',
          `${label}: the setting loaded`,
          facts.field,
        );
        record(
          facts.undefinedTags.length === 0 &&
            facts.sheets === 0 &&
            facts.adopted >= 2,
          `${label}: every element defined, no stylesheet file, the tokens and layout adopted`,
          `${String(facts.sheets)} sheets, ${String(facts.adopted)} adopted${facts.undefinedTags.length > 0 ? `; not defined: ${facts.undefinedTags.join(' ')}` : ''}`,
        );
        record(
          title === TITLES[locale],
          `${label}: the title bar`,
          String(title),
        );
        record(
          problems.length === 0,
          `${label}: no error, no CSP violation`,
          problems.join(' | '),
        );
        await screenshot(label);
      }
    }
  }

  // 2. The setting, through the dashboard's save bar.
  say('\nThe save bar (en, light, 1440 px)');
  await open('en', 'light', 1440);
  await drawn('the setting');
  await inDashboard('window.__calls.length = 0');
  await typeAmount('abc');
  record(
    await becomes(async () =>
      (await bridgeCalls()).some((call) => call.type === 'saveBar.show'),
    ),
    'a change shows the save bar',
  );
  await dashboardSends('saveBar.save');
  await until(
    () =>
      inPage(
        "document.querySelector('tsy-text-field').getAttribute('error') !== null",
      ),
    'the field error',
  );
  record(
    (await bridgeCalls()).some(
      (call) => call.type === 'toast.show' && call.payload['tone'] === 'error',
    ) && !apiCalls.some((call) => call.method === 'PUT'),
    'an invalid amount is refused on the field and in a toast, never sent',
  );
  await inPage('new Promise((r) => setTimeout(r, 200))');
  await screenshot('en-light-1440-invalid');

  await typeAmount('5000');
  await inDashboard('window.__calls.length = 0');
  await dashboardSends('saveBar.save');
  await until(
    async () =>
      (await bridgeCalls()).some(
        (call) =>
          call.type === 'toast.show' && call.payload['tone'] === 'success',
      ),
    'the saved toast',
  );
  const put = apiCalls.find((call) => call.method === 'PUT');
  const issued = /** @type {string[]} */ (await inDashboard('window.__tokens'));
  const putToken = put?.token.replace(/^Bearer /, '') ?? '';
  record(
    put?.body === '{"highlightFrom":"5000.00"}',
    'a valid amount is saved, as a decimal string',
    put?.body,
  );
  record(
    issued.includes(putToken) &&
      apiCalls.filter((call) => call.token === put?.token).length === 1,
    'the save carries a fresh ID token, asked for it and used once',
  );
  const calls = await bridgeCalls();
  record(
    calls.some((call) => call.type === 'saveBar.hide') &&
      !calls.some(
        (call) =>
          call.type === 'toast.show' && call.payload['tone'] === 'error',
      ),
    'the save bar hides, a success toast shows',
  );
  record(
    (await inPage("document.querySelectorAll('tsy-status-pill').length")) === 3,
    'the highlight follows the saved amount (three from 5000.00)',
  );
  record(
    problems.length === 0,
    'no error, no CSP violation',
    problems.join(' | '),
  );

  // 3. Open: the dashboard's own order page.
  say('\nOpen (en, light, 1440 px)');
  sample.orders = { orders: ORDERS, more: false };
  await open('en', 'light', 1440);
  await drawn('the orders');
  await inDashboard('window.__calls.length = 0');
  const openButton = "document.querySelector('tsy-table tbody tsy-button')";
  const openLabel = await inPage(`${openButton}.getAttribute('aria-label')`);
  record(
    openLabel === 'Open order #00001042',
    'each Open button names its order',
    String(openLabel),
  );
  await click(openButton);
  await until(
    async () => (await bridgeCalls()).some((call) => call.type === 'navigate'),
    'the navigate call',
  );
  const navigate = (await bridgeCalls()).find(
    (call) => call.type === 'navigate',
  );
  record(
    navigate?.payload['dashboard'] === 'order' &&
      navigate.payload['id'] === ORDERS[0]?.id,
    'Open asks the dashboard for the order',
    JSON.stringify(navigate?.payload),
  );

  // 4. The dashboard switches language and theme while the page is open.
  say('\nA live context change (en light → ar dark)');
  await dashboardSends('context.changed', {
    locale: 'ar',
    dir: 'rtl',
    theme: 'dark',
    storeId: null,
  });
  await until(
    () => inPage("document.documentElement.dataset.theme === 'dark'"),
    'the dark theme',
  );
  const html = /** @type {{ lang: string, dir: string }} */ (
    await inPage(
      '({ lang: document.documentElement.lang, dir: document.documentElement.dir })',
    )
  );
  const header = await inPage(
    "document.querySelector('tsy-table').getAttribute('heading')",
  );
  record(
    html.lang === 'ar' && html.dir === 'rtl' && header === TITLES.ar,
    'the page follows it without a reload: lang, dir, theme, its own words',
    `${html.lang} ${html.dir} ${String(header)}`,
  );
  record(
    (await bridgeCalls()).some(
      (call) =>
        call.type === 'titleBar.set' && call.payload['title'] === TITLES.ar,
    ),
    'and sets the title bar again',
  );
  record(
    problems.length === 0,
    'no error, no CSP violation',
    problems.join(' | '),
  );

  // 5. No pending order.
  say('\nThe empty state (dark, 390 px)');
  sample.orders = { orders: [], more: false };
  for (const locale of /** @type {const} */ (['ar', 'en'])) {
    await open(locale, 'dark', 390);
    await drawn(`${locale}: the empty state`);
    record(
      (await inPage("!!document.querySelector('tsy-empty-state')")) === true,
      `${locale}: no pending order shows the empty state`,
    );
    record(
      problems.length === 0,
      `${locale}: no error, no CSP violation`,
      problems.join(' | '),
    );
    await screenshot(`${locale}-dark-390-empty`);
  }

  // 6. The check would see a violation: an inline style, refused by the CSP.
  say('\nThe check itself');
  await inPage(
    "document.head.append(Object.assign(document.createElement('style'), { textContent: 'body{}' }))",
  );
  record(
    await becomes(() =>
      problems.some((problem) => problem.includes('Content Security Policy')),
    ),
    'an inline style is refused, and the check sees it',
    problems.join(' | '),
  );

  record(
    apiCalls.length > 0 &&
      apiCalls.every((call) => /^Bearer id-token-/.test(call.token)) &&
      new Set(apiCalls.map((call) => call.token)).size === apiCalls.length,
    'every /api call carried its own ID token from the dashboard',
    `${String(apiCalls.length)} calls`,
  );
  say(`\nScreenshots: ${OUT}`);
  socket.close();
} finally {
  await new Promise((done) => {
    if (chrome.exitCode !== null) {
      done(undefined);
      return;
    }
    chrome.once('exit', done);
    chrome.kill();
  });
  server.kill('SIGTERM');
  dashboard.close();
  rmSync(work, { recursive: true, force: true, maxRetries: 5 });
}

if (failures.length > 0) {
  console.error(
    `\n${String(failures.length)} check(s) failed.\n--- the project's server ---\n${serverOutput}`,
  );
  process.exit(1);
}
say('\nAll browser checks passed.');

/**
 * The dashboard's side of App Bridge, as little of it as the page uses: it
 * frames the page, answers every call (§3.9: `{ tsy: 1, re, ok: true,
 * payload }`) and keeps them in window.__calls; window.__send sends an event.
 * Each ID token it hands out is new, and kept in window.__tokens.
 * @param {string} appOrigin
 */
function dashboardPage(appOrigin) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Fake dashboard</title>
    <style>
      html, body { margin: 0; height: 100%; }
      iframe { display: block; width: 100%; height: 100%; border: 0; }
    </style>
  </head>
  <body>
    <iframe id="app" src="${appOrigin}/"></iframe>
    <script>
      const APP_ORIGIN = ${JSON.stringify(appOrigin)};
      const query = new URLSearchParams(location.search);
      const locale = query.get('locale') === 'ar' ? 'ar' : 'en';
      const context = {
        locale,
        dir: locale === 'ar' ? 'rtl' : 'ltr',
        theme: query.get('theme') === 'dark' ? 'dark' : 'light',
        storeId: null,
      };
      const frame = document.getElementById('app');
      const load = Math.random().toString(36).slice(2);
      window.__calls = [];
      window.__tokens = [];
      addEventListener('message', (event) => {
        if (event.source !== frame.contentWindow || event.origin !== APP_ORIGIN) return;
        const message = event.data;
        if (!message || message.tsy !== 1 || typeof message.id !== 'string') return;
        window.__calls.push({ type: message.type, payload: message.payload || {} });
        let payload = {};
        if (message.type === 'context.get') payload = context;
        if (message.type === 'idToken') {
          payload = { token: 'id-token-' + load + '-' + String(window.__tokens.length + 1) };
          window.__tokens.push(payload.token);
        }
        frame.contentWindow.postMessage({ tsy: 1, re: message.id, ok: true, payload }, APP_ORIGIN);
      });
      window.__send = (type, payload) => {
        frame.contentWindow.postMessage({ tsy: 1, type, payload }, APP_ORIGIN);
      };
    </script>
  </body>
</html>
`;
}

/**
 * The generated project in `dir`: the project itself, or the folder
 * `check:template -- --keep` kept.
 * @param {string} dir
 * @returns {string}
 */
function projectIn(dir) {
  for (const candidate of [dir, join(dir, GENERATED_FOLDER)]) {
    if (existsSync(join(candidate, 'src', 'server.ts'))) return candidate;
  }
  return stop(
    `${dir} is not a generated project (no src/server.ts, nor ${GENERATED_FOLDER}/src/server.ts).`,
    `Pass the folder npm run check:template -- --keep printed ("Kept …"): ${USAGE}`,
  );
}

/**
 * @param {string} message
 * @param {string} fix
 * @returns {never}
 */
function stop(message, fix) {
  console.error(`${message}\nFix: ${fix}`);
  process.exit(1);
}

/** @returns {Promise<number>} */
function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => {
        resolvePort(port);
      });
    });
  });
}

/** @param {string} url */
async function waitForHealth(url) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) break;
    if (
      await fetch(url).then(
        (response) => response.ok,
        () => false,
      )
    )
      return;
    await sleep(200);
  }
  throw new Error(
    `The project's server did not answer ${url} within 15 s.\n${serverOutput}`,
  );
}
