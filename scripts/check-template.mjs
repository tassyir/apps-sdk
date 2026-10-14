// Generates a project with create-tassyir-app the way a developer does, then
// installs, validates, typechecks, tests, builds and starts it:
//   1. packs every workspace package (this repo's tarballs);
//   2. installs the create-tassyir-app tarball (with its @tassyir dependency
//      from the tarballs too) in a scratch folder and runs its CLI with
//      --json, so the files npm ships are the files tested;
//   3. checks the generated package.json names this repo's versions, then
//      installs the project with every @tassyir/* package from the tarballs
//      (they may not be on npm yet) and everything else from npm;
//   4. runs the project's validate, typecheck, test and build scripts;
//   5. starts its server with throwaway settings and calls it.
// Needs the network (npm) and `npm run build` first. Usage:
//   npm run build && npm run check:template [-- --keep]

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatedDependencyProblems, withTarballs } from './lib/template.mjs';
import { packedTarball, run, workspaces } from './lib/workspace.mjs';

const NPM_REGISTRY = 'https://registry.npmjs.org/';
const REGISTRY_FLAGS = [
  `--registry=${NPM_REGISTRY}`,
  `--@tassyir:registry=${NPM_REGISTRY}`,
];
const INSTALL_FLAGS = [
  'install',
  '--no-audit',
  '--no-fund',
  '--ignore-scripts',
  ...REGISTRY_FLAGS,
];
/** What a generated project must hold: npm drops some names from a tarball. */
const REQUIRED_FILES = [
  '.gitignore',
  '.npmrc',
  '.env.example',
  'AGENTS.md',
  'CLAUDE.md',
  'README.md',
  '.claude/skills/tassyir-app/SKILL.md',
  'tassyir.app.toml',
  'src/server.ts',
  'src/page/app.ts',
];

/**
 * What `create-tassyir-app --json` prints.
 * @typedef {{
 *   ok: boolean,
 *   directory: string,
 *   files: string[],
 *   dependencies: Record<string, string>,
 * }} Created
 */

/** @typedef {import('./lib/template.mjs').ProjectManifest} ProjectManifest */

const keep = process.argv.includes('--keep');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'tassyir-template-')));
/** @param {string} message */
const step = (message) => {
  console.log(`✓ ${message}`);
};

try {
  // 1. This repo's tarballs.
  const packs = join(scratch, 'packs');
  mkdirSync(packs);
  /** @type {Record<string, string>} */
  const tarballs = {};
  /** @type {Record<string, string>} */
  const versions = {};
  for (const { dir, folder, manifest } of workspaces()) {
    if (!existsSync(join(dir, 'dist'))) {
      throw new Error(
        `packages/${folder} has no dist/: run npm run build first`,
      );
    }
    const name = manifest.name ?? folder;
    const packed = packedTarball(
      run('npm', ['pack', dir, '--pack-destination', packs, '--json']).stdout,
    );
    tarballs[name] = join(packs, packed.filename);
    versions[name] = manifest.version ?? '';
  }
  step(`packed ${Object.keys(tarballs).join(', ')}`);

  // 2. The CLI as npm installs it.
  const cli = join(scratch, 'cli');
  mkdirSync(cli);
  writeFileSync(join(cli, 'package.json'), '{ "private": true }\n');
  const cliTarball = tarballs['create-tassyir-app'];
  if (!cliTarball) throw new Error('create-tassyir-app is not a workspace');
  run(
    'npm',
    [
      ...INSTALL_FLAGS,
      cliTarball,
      ...Object.entries(tarballs)
        .filter(([name]) => name.startsWith('@tassyir/'))
        .map(([, path]) => path),
    ],
    { cwd: cli },
  );
  const bin = join(cli, 'node_modules', 'create-tassyir-app', 'dist', 'cli.js');
  /** @type {unknown} */
  const createdJson = JSON.parse(
    run(process.execPath, [bin, 'my-tassyir-app', '--json'], { cwd: scratch })
      .stdout,
  );
  const created = /** @type {Created} */ (createdJson);
  if (!created.ok) {
    throw new Error(`create-tassyir-app failed: ${JSON.stringify(created)}`);
  }
  const project = created.directory;
  const missing = REQUIRED_FILES.filter(
    (file) => !existsSync(join(project, file)),
  );
  if (missing.length > 0) {
    throw new Error(`the generated project lacks ${missing.join(', ')}`);
  }
  step(`generated ${String(created.files.length)} files with the packed CLI`);

  // 3. The real versions in package.json; tarballs for the install.
  const manifestPath = join(project, 'package.json');
  /** @type {unknown} */
  const manifestJson = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const manifest = /** @type {ProjectManifest} */ (manifestJson);
  const problems = generatedDependencyProblems(manifest, versions);
  for (const name of Object.keys(created.dependencies)) {
    if (!(name in { ...manifest.dependencies, ...manifest.devDependencies })) {
      problems.push(`${name} is missing`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`generated package.json: ${problems.join('; ')}`);
  }
  step(
    `package.json names ${Object.entries(created.dependencies)
      .map(([name, spec]) => `${name}@${spec}`)
      .join(', ')}`,
  );
  writeFileSync(
    manifestPath,
    `${JSON.stringify(withTarballs(manifest, tarballs), null, 2)}\n`,
  );
  run('npm', INSTALL_FLAGS, { cwd: project });
  step('installed (@tassyir/* from the tarballs, the rest from npm)');

  // 4. The project's own checks.
  /** @type {unknown} */
  const validationJson = JSON.parse(
    run('npm', ['run', '--silent', 'validate', '--', '--json'], {
      cwd: project,
    }).stdout,
  );
  const validation = /** @type {{ ok: boolean, errors: unknown[] }} */ (
    validationJson
  );
  if (!validation.ok) {
    throw new Error(`npm run validate: ${JSON.stringify(validation.errors)}`);
  }
  step('npm run validate');
  for (const script of ['typecheck', 'test', 'build']) {
    run('npm', ['run', script], { cwd: project });
    step(`npm run ${script}`);
  }

  // 5. The server starts and answers.
  await bootCheck(project);
  step('the server starts, serves the page and refuses an unsigned webhook');
} finally {
  if (keep) console.log(`Kept ${scratch}`);
  else rmSync(scratch, { recursive: true, force: true });
}

/** @param {string} project */
async function bootCheck(project) {
  const port = await freePort();
  const server = spawn(process.execPath, ['src/server.ts'], {
    cwd: project,
    env: {
      ...process.env,
      // Throwaway values in the right shapes; nothing here reaches Tassyir.
      TASSYIR_CLIENT_ID: 'app_check',
      TASSYIR_CLIENT_SECRET: 'tsy_cs_check',
      TASSYIR_APP_ID: '1',
      TOKEN_STORE_KEY: randomBytes(32).toString('base64'),
      PORT: String(port),
      DATA_DIR: join(project, 'data'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout.on('data', (chunk) => (output += String(chunk)));
  server.stderr.on('data', (chunk) => (output += String(chunk)));
  const base = `http://127.0.0.1:${String(port)}`;
  try {
    await waitFor(`${base}/health`, () => output);
    const page = await fetch(`${base}/`);
    const policy = page.headers.get('content-security-policy') ?? '';
    if (
      page.status !== 200 ||
      !policy.includes('frame-ancestors https://app.tassyir.io')
    ) {
      throw new Error(`GET / answered ${String(page.status)}, CSP "${policy}"`);
    }
    const webhook = await fetch(`${base}/webhooks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (webhook.status !== 400) {
      throw new Error(`an unsigned webhook answered ${String(webhook.status)}`);
    }
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${output}`,
      { cause: error },
    );
  } finally {
    server.kill('SIGTERM');
  }
}

/**
 * @param {string} url
 * @param {() => string} output
 */
async function waitFor(url, output) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${url} did not answer within 15 s\n${output()}`);
}

/** @returns {Promise<number>} */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}
