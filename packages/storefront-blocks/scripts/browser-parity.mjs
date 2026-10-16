// The real-engine check of @tassyir/storefront-blocks (AP-K2.2), local only,
// like @tassyir/ui's browser check. It takes the BUILT package (dist/, what
// npm ships), bundles it for the browser with the fuzzed corpus, and runs
// the corpus in:
//   - Node (dist/index.js, as a server imports it),
//   - headless Chrome (V8, Blink's HTML parser), driven over the DevTools
//     protocol with no dependency,
//   - JavaScriptCore (Safari's engine), through macOS's `jsc` when present.
// Every engine's output must be byte for byte the same. In Chrome, every
// rendered block is then parsed by the browser's own HTML parser, in a
// <div>, and checked against the package's allowlist: no element, attribute,
// URL or comment it does not allow.
// Usage:
//   npm run build -w @tassyir/storefront-blocks
//   npm run browser-parity -w @tassyir/storefront-blocks
//   CHROME_PATH (default: macOS Google Chrome), JSC_PATH (default: macOS jsc).
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE = join(HERE, '..');
const DIST = join(PACKAGE, 'dist', 'index.js');
const CHROME =
  process.env['CHROME_PATH'] ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const JSC =
  process.env['JSC_PATH'] ??
  '/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc';
const TIMEOUT_MS = 60_000;

if (!existsSync(DIST)) {
  console.error(
    'No dist/: run npm run build -w @tassyir/storefront-blocks first.',
  );
  process.exit(1);
}

/** @param {string} text */
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** @type {string[]} */
const failures = [];
/** @param {boolean} ok @param {string} name @param {string} [detail] */
function record(ok, name, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
}

// One IIFE: the built package and the corpus, as a browser app bundles them.
const bundled = await build({
  stdin: {
    contents:
      "export * from '../dist/index.js';\nexport { runCorpus } from '../src/fuzz-corpus.test-harness.ts';\n",
    resolveDir: HERE,
    loader: 'ts',
    sourcefile: 'browser-parity-entry.ts',
  },
  bundle: true,
  format: 'iife',
  globalName: 'TassyirBlocks',
  platform: 'browser',
  target: 'es2022',
  write: false,
  logLevel: 'silent',
});
const bundle = bundled.outputFiles[0]?.text ?? '';
const RUN = 'JSON.stringify(TassyirBlocks.runCorpus(TassyirBlocks))';

// Node, from dist/ as a server imports it (the corpus harness is plain
// TypeScript that Node 22.18+ runs as it is).
const harness = await import('../src/fuzz-corpus.test-harness.ts');
// Imported by URL: dist/ has no types before a build, and must not need any.
/** @type {unknown} */
const built = await import(pathToFileURL(DIST).href);
const api = /** @type {Parameters<typeof harness.runCorpus>[0]} */ (built);
const started = performance.now();
const inNode = JSON.stringify(harness.runCorpus(api));
const nodeMs = performance.now() - started;
/** @type {unknown} */
const decoded = JSON.parse(inNode);
const parsed = /** @type {{ cases: { html: string | null }[] }} */ (decoded);
const rendered = parsed.cases.filter((c) => c.html !== null).length;
console.log(
  `Node ${process.version}: ${parsed.cases.length.toString()} cases, ${rendered.toString()} rendered, ${nodeMs.toFixed(0)} ms, sha256 ${sha256(inNode).slice(0, 16)}`,
);

// JavaScriptCore.
if (existsSync(JSC)) {
  const folder = mkdtempSync(join(tmpdir(), 'tassyir-blocks-jsc-'));
  const file = join(folder, 'run.js');
  writeFileSync(file, `${bundle}\nprint(${RUN});\n`);
  const inJsc = execFileSync(JSC, [file], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  }).replace(/\n$/, '');
  rmSync(folder, { recursive: true, force: true });
  record(
    inJsc === inNode,
    'JavaScriptCore: the same bytes as Node',
    `sha256 ${sha256(inJsc).slice(0, 16)}`,
  );
} else {
  console.log(`- JavaScriptCore skipped: no jsc at ${JSC} (set JSC_PATH)`);
}

// Chrome.
if (!existsSync(CHROME)) {
  console.error(
    `No Chrome at ${CHROME}. Set CHROME_PATH to a Chrome or Chromium binary.`,
  );
  process.exit(1);
}
const profile = mkdtempSync(join(tmpdir(), 'tassyir-blocks-chrome-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

try {
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
  /** @type {Map<number, (message: { error?: unknown, result?: unknown }) => void>} */
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    /** @type {unknown} */
    const data = JSON.parse(String(event.data));
    const message =
      /** @type {{ id?: number, error?: unknown, result?: unknown }} */ (data);
    if (message.id !== undefined) {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });
  /**
   * @param {string} method
   * @param {object} [params]
   * @param {string} [sessionId]
   * @returns {Promise<unknown>}
   */
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method}: no answer in ${String(TIMEOUT_MS)} ms`));
      }, TIMEOUT_MS);
      pending.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

  const { targetId } = /** @type {{ targetId: string }} */ (
    await send('Target.createTarget', { url: 'about:blank' })
  );
  const { sessionId } = /** @type {{ sessionId: string }} */ (
    await send('Target.attachToTarget', { targetId, flatten: true })
  );
  /** @param {string} expression @returns {Promise<unknown>} */
  const evaluate = async (expression) => {
    const result =
      /** @type {{ exceptionDetails?: unknown, result: { value: unknown } }} */ (
        await send(
          'Runtime.evaluate',
          { expression, returnByValue: true, awaitPromise: true },
          sessionId,
        )
      );
    if (result.exceptionDetails)
      throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const version = /** @type {{ product: string }} */ (
    await send('Browser.getVersion')
  );
  await evaluate(`${bundle};0`);
  const chromeStarted = Date.now();
  const inChrome = String(await evaluate(RUN));
  const chromeMs = Date.now() - chromeStarted;
  record(
    inChrome === inNode,
    `${version.product}: the same bytes as Node`,
    `${chromeMs.toString()} ms, sha256 ${sha256(inChrome).slice(0, 16)}`,
  );

  // Every rendered block, parsed by Blink's HTML parser in a <div>.
  const violations = /** @type {string[]} */ (
    await evaluate(`(() => {
    const B = TassyirBlocks;
    const out = JSON.parse(${RUN});
    const HTML = 'http://www.w3.org/1999/xhtml';
    const SVG = 'http://www.w3.org/2000/svg';
    const BIDI = /[\\u202A-\\u202E\\u2066-\\u2069]/;
    const doc = document.implementation.createHTMLDocument('');
    const problems = [];
    const check = (id, html) => {
      const div = doc.createElement('div');
      div.innerHTML = html;
      const walk = (node, depth) => {
        for (const child of node.childNodes) {
          if (child.nodeType === 8) problems.push(id + ': a comment');
          if (child.nodeType === 3 && BIDI.test(child.data)) problems.push(id + ': a bidi control');
          if (child.nodeType !== 1) continue;
          const name = child.localName;
          const list = child.namespaceURI === HTML ? B.BLOCK_HTML_ALLOWLIST.html[name]
            : child.namespaceURI === SVG ? B.BLOCK_HTML_ALLOWLIST.svg[name] : undefined;
          if (!list) { problems.push(id + ': <' + name + '> in ' + child.namespaceURI); continue; }
          const computed = B.BLOCK_HTML_ALLOWLIST.computed[name] || [];
          for (const attr of child.attributes) {
            if (attr.namespaceURI) problems.push(id + ': namespaced ' + attr.name);
            if (!list.includes(attr.name) && !computed.includes(attr.name)) problems.push(id + ': <' + name + ' ' + attr.name + '>');
            if (attr.name === 'href' && B.linkKind(attr.value) === null) problems.push(id + ': href ' + attr.value);
            if (name === 'img' && attr.name === 'src' && !B.isBlockImageSource(attr.value)) problems.push(id + ': src ' + attr.value);
          }
          if (child.href && /^(javascript|data|vbscript):/i.test(child.href)) problems.push(id + ': resolved href ' + child.href);
          if (depth > 40) problems.push(id + ': depth ' + depth);
          walk(child, depth + 1);
        }
      };
      walk(div, 1);
    };
    for (const c of out.cases) if (c.html !== null) check(c.id, c.html);
    out.sanitized.forEach((html, i) => check('vector' + i, html));
    return problems.slice(0, 50);
  })()`)
  );
  record(
    violations.length === 0,
    "Chrome's HTML parser finds only allowed elements, attributes and URLs in every rendered block",
    violations.length === 0
      ? `${rendered.toString()} blocks`
      : violations.join('; '),
  );
} finally {
  const exited = new Promise((done) => chrome.once('exit', done));
  chrome.kill();
  await exited;
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
}

if (failures.length > 0) {
  console.error(`\n${failures.length.toString()} check(s) failed.`);
  process.exit(1);
}
console.log('\nEvery engine rendered the corpus alike.');
