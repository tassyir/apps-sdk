// Runs the Mintlify CLI on the docs site (site/), at the one version this repo
// pins (MINT_VERSION in scripts/lib/docs-site.mjs). The CLI is installed once
// into a scratch folder, its dependency tree resolved no newer than
// MINT_BEFORE, without install scripts, from the public registry; telemetry
// is off. It is not a dev dependency (scripts/lib/docs-site.mjs says why).
//
// Usage:
//   npm run docs:dev            the local preview (mint dev; extra arguments
//                               pass through, e.g. -- --port 3333 --no-open)
//   npm run docs:check          what CI runs: mint validate, then mint
//                               broken-links with anchors and redirects, then
//                               mint export, whose routes must be exactly the
//                               navigation plus the API reference; prints
//                               every route
// Needs the network: npm, and Mintlify's preview client the CLI downloads.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DOCS_JSON, SITE_DIR } from './docs-site.mjs';
import {
  MINT_BEFORE,
  MINT_VERSION,
  OPENAPI_SOURCES,
  navigationPages,
} from './lib/docs-site.mjs';
import { ROOT, readJson, run } from './lib/workspace.mjs';

const TOOL_DIR = join(tmpdir(), `tassyir-mint-${MINT_VERSION}`);
const ENV = {
  ...process.env,
  MINTLIFY_TELEMETRY_DISABLED: '1',
  DO_NOT_TRACK: '1',
};

/** The pinned CLI's binary, installed on first use. */
function mint() {
  const bin = join(TOOL_DIR, 'node_modules', '.bin', 'mint');
  if (existsSync(bin)) return bin;
  console.log(
    `… installing mint@${MINT_VERSION} (dependencies as of ${MINT_BEFORE})`,
  );
  mkdirSync(TOOL_DIR, { recursive: true });
  writeFileSync(join(TOOL_DIR, 'package.json'), '{ "private": true }\n');
  run(
    'npm',
    [
      'install',
      `mint@${MINT_VERSION}`,
      '--save-exact',
      `--before=${MINT_BEFORE}`,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--registry=https://registry.npmjs.org/',
    ],
    { cwd: TOOL_DIR, env: ENV },
  );
  return bin;
}

/**
 * Runs the CLI in site/, its output on this terminal; exits on failure.
 * @param {string[]} args
 */
function runMint(args) {
  const result = spawnSync(mint(), args, {
    cwd: SITE_DIR,
    env: ENV,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(
      `✗ mint ${args.join(' ')} exited with ${String(result.status)}`,
    );
    process.exit(result.status ?? 1);
  }
}

/**
 * The routes of a `mint export` archive: each `<route>/index.html`.
 * @param {string} archive
 * @returns {string[]}
 */
function exportedRoutes(archive) {
  return run('unzip', ['-Z1', archive])
    .stdout.split('\n')
    .filter((entry) => entry === 'index.html' || entry.endsWith('/index.html'))
    .filter((entry) => !entry.startsWith('_next/'))
    .map((entry) => `/${entry.replace(/\/?index\.html$/, '')}`)
    .sort();
}

/** The number of operations and webhooks of an OpenAPI document. */
function apiPageCount(/** @type {string} */ source) {
  const document =
    /** @type {{ paths?: Record<string, Record<string, unknown>>, webhooks?: Record<string, unknown> }} */ (
      readJson(join(ROOT, source))
    );
  const methods = ['get', 'put', 'post', 'patch', 'delete'];
  const operations = Object.values(document.paths ?? {}).flatMap((item) =>
    methods.filter((method) => method in item),
  ).length;
  return operations + Object.keys(document.webhooks ?? {}).length;
}

function check() {
  runMint(['validate']);
  runMint(['broken-links', '--check-anchors', '--check-redirects']);

  const scratch = mkdtempSync(join(tmpdir(), 'tassyir-site-'));
  try {
    const archive = join(scratch, 'site.zip');
    runMint(['export', '--output', archive]);
    const routes = exportedRoutes(archive);
    const config = /** @type {{ navigation: unknown }} */ (readJson(DOCS_JSON));
    const pages = navigationPages(config.navigation).map((page) => `/${page}`);
    const api = routes.filter((route) => route.startsWith('/api-reference/'));
    const expectedApi = OPENAPI_SOURCES.reduce(
      (sum, { source }) => sum + apiPageCount(source),
      0,
    );
    const problems = [
      ...pages
        .filter((page) => !routes.includes(page))
        .map((page) => `${page} is in the navigation but not built`),
      ...routes
        .filter(
          (route) =>
            route !== '/' &&
            !route.startsWith('/api-reference/') &&
            !pages.includes(route),
        )
        .map((route) => `${route} is built but not in the navigation`),
      ...(api.length === expectedApi
        ? []
        : [
            `${String(api.length)} API reference pages built, not ${String(expectedApi)} (every operation and webhook)`,
          ]),
    ];
    console.log(`\nRoutes built (${String(routes.length)}):`);
    console.log(routes.map((route) => `  ${route}`).join('\n'));
    if (problems.length > 0) {
      console.error(problems.map((problem) => `✗ ${problem}`).join('\n'));
      process.exit(1);
    }
    console.log(
      `✓ every route is a navigation page or an API reference page (${String(api.length)})`,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const [command = '', ...rest] = process.argv.slice(2);
if (command === 'dev') {
  runMint(['dev', ...rest]);
} else if (command === 'check') {
  check();
} else {
  console.error('Usage: node scripts/docs-mint.mjs dev|check');
  process.exit(2);
}
