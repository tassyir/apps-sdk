// Serves the demo page (demo/) and the built package (dist/) on localhost,
// under the strictest Content-Security-Policy an app might send: no inline
// style or script, Trusted Types required. The elements must work under it.
// Usage: npm run build -w @tassyir/ui && npm run demo -w @tassyir/ui
//   PORT (default 4178); TASSYIR_UI_DEMO_GEIST=<a Geist .woff2> to show the
//   dashboard's Latin face (the package itself loads no font).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SERVED = ['demo', 'dist'];

/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

/** The policy the demo runs under: everything from this origin, nothing inline. */
export const DEMO_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "require-trusted-types-for 'script'",
  'trusted-types tassyir-ui-demo',
].join('; ');

/**
 * Starts the server and resolves with its address.
 * @param {number} port
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export function startDemoServer(port) {
  const geist = process.env['TASSYIR_UI_DEMO_GEIST'];
  const server = createServer((request, response) => {
    void (async () => {
      const path = decodeURIComponent(
        new URL(request.url ?? '/', 'http://localhost').pathname,
      );
      if (path === '/favicon.ico') {
        response.writeHead(204);
        response.end();
        return;
      }
      if (path === '/fonts.css') {
        // The @font-face for Geist only when a font file was given, so a
        // run without one has no failed request (the browser check counts
        // console errors).
        response.writeHead(200, {
          'Content-Type': 'text/css; charset=utf-8',
          'Content-Security-Policy': DEMO_CSP,
          'Cache-Control': 'no-store',
        });
        response.end(
          geist
            ? "@font-face{font-family:'Geist';src:url('/fonts/geist.woff2') format('woff2');font-weight:100 900;font-display:swap}\n"
            : '/* No demo font: TASSYIR_UI_DEMO_GEIST is not set. */\n',
        );
        return;
      }
      if (path === '/' || path === '/demo') {
        response.writeHead(302, { Location: '/demo/' });
        response.end();
        return;
      }
      let file;
      if (path === '/fonts/geist.woff2') {
        file = geist;
      } else {
        const relative = normalize(
          path.endsWith('/') ? `${path}index.html` : path,
        ).replace(/^[/\\]+/, '');
        const top = relative.split(sep)[0] ?? '';
        if (SERVED.includes(top) && !relative.includes('..')) {
          file = `${ROOT}${relative}`;
        }
      }
      try {
        if (!file) throw new Error('not served');
        const body = await readFile(file);
        response.writeHead(200, {
          'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
          'Content-Security-Policy': DEMO_CSP,
          'Cache-Control': 'no-store',
        });
        response.end(body);
      } catch {
        response.writeHead(404, { 'Content-Type': 'text/plain' });
        response.end('Not found');
      }
    })();
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const bound =
        typeof address === 'object' && address ? address.port : port;
      resolve({
        url: `http://localhost:${String(bound)}`,
        close: () =>
          new Promise((done) => {
            server.close(() => {
              done();
            });
          }),
      });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await startDemoServer(Number(process.env['PORT'] ?? 4178));
  console.log(`Demo: ${url}/demo/  (?locale=ar|en&theme=light|dark)`);
  console.log(`Checks: ${url}/demo/checks.html`);
}
