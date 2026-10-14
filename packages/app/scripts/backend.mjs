// Read-only access to a local clone of tassyir/backend, named by
// TASSYIR_BACKEND_DIR. Files are read with `git show <ref>:<path>`, so the
// clone's checkout, branch and working tree are never touched.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const DEFAULT_BACKEND_REF = 'origin/master';

/** @returns {string} */
export function backendDir() {
  const dir = process.env['TASSYIR_BACKEND_DIR'];
  if (!dir) {
    console.error(
      '✗ TASSYIR_BACKEND_DIR is not set.\n  Fix: point it at a local clone of tassyir/backend, e.g. TASSYIR_BACKEND_DIR=~/src/backend (run `git -C "$TASSYIR_BACKEND_DIR" fetch origin` first).',
    );
    process.exit(2);
  }
  return dir;
}

/**
 * @param {string} dir
 * @param {string[]} args
 * @returns {string}
 */
function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * The full commit id a ref names.
 * @param {string} dir
 * @param {string} ref
 */
export function resolveCommit(dir, ref) {
  return git(dir, ['rev-parse', '--verify', `${ref}^{commit}`]).trim();
}

/**
 * A file's content at a commit.
 * @param {string} dir
 * @param {string} commit
 * @param {string} path
 */
export function showFile(dir, commit, path) {
  return git(dir, ['show', `${commit}:${path}`]);
}

/** @param {string} text */
export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * `--ref <value>` from argv, or the default.
 * @param {string[]} argv
 */
export function refArgument(argv) {
  const index = argv.indexOf('--ref');
  const value = index === -1 ? undefined : argv[index + 1];
  return value ?? DEFAULT_BACKEND_REF;
}
