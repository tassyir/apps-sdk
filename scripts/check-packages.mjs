// Checks every built workspace package the way a consumer meets it:
//   1. publint --strict: package.json fields agree with the files shipped;
//   2. attw: the types resolve under node10 (the backend: TypeScript with
//      "module": "commonjs"), node16 CJS and ESM, and bundlers. A package may
//      narrow the check with its own .attw.json (an ESM-only browser package:
//      { "profile": "esm-only" });
//   3. the packed tarball, installed into a scratch project, loads with
//      require() and import(), from the files package.json names, and both
//      expose the same exports.
// Usage: npm run build && npm run check:packages

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, packedTarball, run, workspaces } from './lib/workspace.mjs';

const NPM_REGISTRY = 'https://registry.npmjs.org/';
const BIN = join(ROOT, 'node_modules', '.bin');

/**
 * The file a condition of the root export points to, if it does.
 * @param {unknown} exportsField
 * @param {'import' | 'require'} condition
 * @returns {string | undefined}
 */
function rootExportFile(exportsField, condition) {
  if (!isRecord(exportsField)) return undefined;
  const root = exportsField['.'] ?? exportsField;
  if (!isRecord(root)) return undefined;
  const target = root[condition];
  if (typeof target === 'string') return target;
  if (isRecord(target) && typeof target['default'] === 'string') {
    return target['default'];
  }
  return undefined;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

/**
 * Loads the package from the scratch project and reports what it resolved.
 * @param {string} consumer
 * @param {string} name
 * @param {'import' | 'require'} mode
 * @returns {{ file: string, keys: string[] }}
 */
function probe(consumer, name, mode) {
  const code =
    mode === 'require'
      ? `const n = process.env.PROBE; const m = require(n);
         console.log(JSON.stringify({ file: require.resolve(n), keys: Object.keys(m) }));`
      : `const n = process.env.PROBE; const m = await import(n);
         const { fileURLToPath } = await import('node:url');
         console.log(JSON.stringify({ file: fileURLToPath(import.meta.resolve(n)), keys: Object.keys(m) }));`;
  const args =
    mode === 'require' ? ['-e', code] : ['--input-type=module', '-e', code];
  const { stdout } = run(process.execPath, args, {
    cwd: consumer,
    env: { ...process.env, PROBE: name },
  });
  /** @type {unknown} */
  const parsed = JSON.parse(stdout);
  const result = /** @type {{ file: string, keys: string[] }} */ (parsed);
  const keys = result.keys
    .filter((key) => !['default', '__esModule', 'module.exports'].includes(key))
    .sort();
  return { file: result.file, keys };
}

const packages = workspaces();
// realpath: macOS's tmpdir is a symlink, and Node reports resolved paths.
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'tassyir-sdk-check-')));
/** @type {string[]} */
const failures = [];

try {
  for (const { dir, folder, manifest } of packages) {
    const name = manifest.name ?? folder;
    const label = `${name} (packages/${folder})`;
    try {
      if (!existsSync(join(dir, 'dist'))) {
        throw new Error('no dist/: run `npm run build` first');
      }
      run(join(BIN, 'publint'), ['run', '.', '--strict', '--pack', 'npm'], {
        cwd: dir,
      });
      run(join(BIN, 'attw'), ['--pack', '.', '--format', 'ascii'], {
        cwd: dir,
      });

      const packed = packedTarball(
        run('npm', ['pack', dir, '--pack-destination', scratch, '--json'])
          .stdout,
      );
      const consumer = join(scratch, folder);
      mkdirSync(consumer);
      writeFileSync(join(consumer, 'package.json'), '{ "private": true }\n');
      run(
        'npm',
        [
          'install',
          join(scratch, packed.filename),
          '--no-audit',
          '--no-fund',
          '--no-package-lock',
          '--ignore-scripts',
          `--registry=${NPM_REGISTRY}`,
          `--@tassyir:registry=${NPM_REGISTRY}`,
        ],
        { cwd: consumer },
      );

      const installed = join(consumer, 'node_modules', ...name.split('/'));
      /** @type {Record<string, string[]>} */
      const keysByMode = {};
      for (const mode of /** @type {const} */ (['require', 'import'])) {
        const declared = rootExportFile(manifest.exports, mode);
        if (!declared) continue;
        const loaded = probe(consumer, name, mode);
        const expected = join(installed, declared);
        if (loaded.file !== expected) {
          throw new Error(`${mode} loaded ${loaded.file}, not ${expected}`);
        }
        keysByMode[mode] = loaded.keys;
      }
      const modes = Object.keys(keysByMode);
      if (modes.length === 0) {
        throw new Error('exports["."] declares neither "import" nor "require"');
      }
      const [first, second] = Object.values(keysByMode);
      if (second && JSON.stringify(first) !== JSON.stringify(second)) {
        throw new Error(
          `require() exports ${JSON.stringify(keysByMode['require'])} but import() exports ${JSON.stringify(keysByMode['import'])}`,
        );
      }
      console.log(
        `✓ ${label}: publint, attw, ${packed.filename} loads with ${modes.join(' and ')} (${String(first?.length ?? 0)} exports)`,
      );
    } catch (error) {
      failures.push(
        `✗ ${label}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
if (packages.length === 0) console.log('No workspace packages.');
