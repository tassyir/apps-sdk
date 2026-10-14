import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {import('./policy.mjs').PackageJson} PackageJson */
/** @typedef {{ dir: string, folder: string, manifest: PackageJson }} Workspace */

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * @param {string} path
 * @returns {unknown}
 */
export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** @typedef {{ filename: string, integrity: string }} Packed */

/**
 * The tarball described by `npm pack --json`.
 * @param {string} stdout
 * @returns {Packed}
 */
export function packedTarball(stdout) {
  /** @type {unknown} */
  const parsed = JSON.parse(stdout);
  const [packed] = /** @type {Packed[]} */ (parsed);
  if (!packed?.filename || !packed.integrity) {
    throw new Error(`npm pack printed no tarball: ${stdout}`);
  }
  return packed;
}

/**
 * The packages of the `packages/*` workspace, sorted by folder.
 * @returns {Workspace[]}
 */
export function workspaces() {
  const parent = join(ROOT, 'packages');
  if (!existsSync(parent)) return [];
  return readdirSync(parent, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(parent, entry.name, 'package.json')),
    )
    .map((entry) => ({
      dir: join(parent, entry.name),
      folder: entry.name,
      manifest: /** @type {PackageJson} */ (
        readJson(join(parent, entry.name, 'package.json'))
      ),
    }))
    .sort((a, b) => a.folder.localeCompare(b.folder));
}

/**
 * Runs a command without a shell. Throws with its output when it fails,
 * unless `allowFailure` is set.
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, allowFailure?: boolean, env?: NodeJS.ProcessEnv }} [options]
 */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    encoding: 'utf8',
    env: options.env ?? process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const output = {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
  if (output.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${command} ${args.join(' ')} exited with ${output.status}\n${output.stdout}${output.stderr}`,
    );
  }
  return output;
}
