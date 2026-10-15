import type { CliProblem } from './errors.js';

// A hosted version's bundle, checked by the rules the Tassyir API applies to
// an upload, so `tassyir deploy` refuses before uploading what the API would
// refuse. A COPY of the backend's validator, tassyir/backend
// `src/app-platform/hosting/hosted-bundle.ts` (`validateHostedBundle`): the
// same codes, paths, messages and fixes, in the same order, and the same
// normalised result; bundle-rules.test.ts is the backend's spec of it. When
// the backend changes a rule, change it here too (docs/api/apps/developer.md
// "Hosted versions" is the reference).
//
//   { "main": "worker.js",
//     "files": [{ "path": "worker.js", "content": "export default {…}" }],
//     "lockfile": { "name": "package-lock.json", "content": "…" } }

export const HOSTED_BUNDLE_LIMITS = Object.freeze({
  /** Modules in one bundle. */
  maxFiles: 100,
  /** All modules together, UTF-8 bytes. */
  maxBytes: 3 * 1024 * 1024,
  /** The lockfile, UTF-8 bytes (scanned only, never uploaded to Cloudflare). */
  maxLockfileBytes: 1024 * 1024,
  maxPathLength: 200,
  /**
   * Folders above a module's file: `a/b/c.js` has 2. Nine, so a path has at
   * most 10 names with the file (the API's rule since it took bundles; its
   * message named it "10 folders" until AP-B1.23 named it by what it counts).
   */
  maxFolders: 9,
});

export type HostedModuleKind = 'esm' | 'text';

const MODULE_KINDS: Readonly<Record<string, HostedModuleKind>> = {
  '.js': 'esm',
  '.mjs': 'esm',
  '.html': 'text',
  '.css': 'text',
  '.txt': 'text',
  '.json': 'text',
  '.svg': 'text',
  '.liquid': 'text',
};

/** The lockfiles the API takes, in the order the CLI looks for them. */
export const LOCKFILE_NAMES = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
] as const;
export type LockfileName = (typeof LOCKFILE_NAMES)[number];

export interface BundleFile {
  path: string;
  content: string;
}

/** What `POST developer/apps/:appId/versions` takes as `bundle`. */
export interface HostedBundle {
  main: string;
  files: BundleFile[];
  lockfile?: { name: LockfileName; content: string };
}

/** One path segment: no leading dot, so never `.`, `..` or a dotfile. */
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const MAX_ERRORS = 50;

/** A UTF-16 surrogate without its pair: not encodable as UTF-8. */
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function own(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}

/** Echoed input, short and never carrying control characters. */
function echo(value: string): string {
  const cleaned = value.replace(/\p{Cc}/gu, '?');
  return cleaned.length > 60 ? `${cleaned.slice(0, 57)}...` : cleaned;
}

export function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/** The module kind a path's extension gives, or null when not allowed. */
export function moduleKindOf(path: string): HostedModuleKind | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return MODULE_KINDS[name.slice(dot)] ?? null;
}

/** Null when `path` is a storable module name, else why not. */
export function bundlePathProblem(path: unknown): string | null {
  if (typeof path !== 'string' || path.length === 0) return 'is not a path';
  if (path.length > HOSTED_BUNDLE_LIMITS.maxPathLength) {
    return `is longer than ${String(HOSTED_BUNDLE_LIMITS.maxPathLength)} characters`;
  }
  const segments = path.split('/');
  if (segments.length - 1 > HOSTED_BUNDLE_LIMITS.maxFolders) {
    return `is in more than ${String(HOSTED_BUNDLE_LIMITS.maxFolders)} folders`;
  }
  if (!segments.every((segment) => SEGMENT.test(segment))) {
    return 'uses a character other than letters, digits, ".", "_", "-" and "/" between names, or a name starting with "."';
  }
  return null;
}

/** Null when `content` is text the scanners and Cloudflare read alike. */
function contentProblem(content: unknown): string | null {
  if (typeof content !== 'string') return 'is not a string';
  if (LONE_SURROGATE.test(content)) {
    return 'holds a lone surrogate (not UTF-8 text)';
  }
  if (content.includes('\u0000')) return 'holds a NUL character';
  return null;
}

/** A bundle as the API reads it: each file typed, sorted by path. */
export interface NormalisedBundle {
  main: string;
  /** Sorted by path (UTF-16 code units), unique case-insensitively. */
  files: (BundleFile & { kind: HostedModuleKind })[];
  lockfile: { name: LockfileName; content: string } | null;
}

export type BundleValidation =
  | { ok: true; bundle: NormalisedBundle; bytes: number }
  | { ok: false; errors: CliProblem[] };

/**
 * The API's upload rules over a bundle: every error at once (at most 50), in
 * a stable order; on success the normalised bundle and its modules' UTF-8
 * bytes.
 */
export function validateHostedBundle(input: unknown): BundleValidation {
  const errors: CliProblem[] = [];
  const add = (code: string, path: string, message: string, fix: string) => {
    if (errors.length < MAX_ERRORS) errors.push({ code, path, message, fix });
  };

  if (!isRecord(input)) {
    add(
      'BUNDLE_NOT_A_TABLE',
      'bundle',
      'The bundle is not an object',
      'Send "bundle": { "main": "worker.js", "files": [{ "path", "content" }] } next to "manifest".',
    );
    return { ok: false, errors };
  }
  for (const key of Object.keys(input).sort()) {
    if (key !== 'main' && key !== 'files' && key !== 'lockfile') {
      add(
        'BUNDLE_FIELD_UNKNOWN',
        `bundle.${echo(key)}`,
        `"${echo(key)}" is not a bundle field`,
        'Keep only "main", "files" and "lockfile" in the bundle.',
      );
    }
  }

  const files: NormalisedBundle['files'] = [];
  let bytes = 0;
  const rawFiles = own(input, 'files');
  if (
    !Array.isArray(rawFiles) ||
    rawFiles.length === 0 ||
    rawFiles.length > HOSTED_BUNDLE_LIMITS.maxFiles
  ) {
    add(
      'BUNDLE_FILES_INVALID',
      'bundle.files',
      `"files" must list 1 to ${String(HOSTED_BUNDLE_LIMITS.maxFiles)} modules`,
      'Bundle the app (esbuild, `bundle: true`) so it ships as a few modules.',
    );
  } else {
    const seen = new Set<string>();
    rawFiles.forEach((raw: unknown, index) => {
      const at = `bundle.files[${String(index)}]`;
      if (!isRecord(raw)) {
        add(
          'BUNDLE_FILE_INVALID',
          at,
          'A file is not an object',
          'Give each file as { "path": "worker.js", "content": "…" }.',
        );
        return;
      }
      const extra = Object.keys(raw)
        .filter((key) => key !== 'path' && key !== 'content')
        .sort();
      for (const key of extra) {
        add(
          'BUNDLE_FIELD_UNKNOWN',
          `${at}.${echo(key)}`,
          `"${echo(key)}" is not a file field`,
          'Keep only "path" and "content" in a file.',
        );
      }
      const path = own(raw, 'path');
      const pathProblem = bundlePathProblem(path);
      if (pathProblem !== null || typeof path !== 'string') {
        add(
          'BUNDLE_PATH_INVALID',
          `${at}.path`,
          `The path ${typeof path === 'string' ? `"${echo(path)}" ` : ''}${pathProblem ?? 'is not a path'}`,
          'Use a relative path such as "worker.js" or "assets/page.html".',
        );
        return;
      }
      const kind = moduleKindOf(path);
      if (!kind) {
        add(
          'BUNDLE_FILE_TYPE_NOT_ALLOWED',
          `${at}.path`,
          `"${echo(path)}" is not an allowed file type`,
          'Ship .js or .mjs modules and .html, .css, .txt, .json, .svg or .liquid text; no source maps, WebAssembly or binary files.',
        );
        return;
      }
      const folded = path.toLowerCase();
      if (seen.has(folded)) {
        add(
          'BUNDLE_PATH_DUPLICATE',
          `${at}.path`,
          `"${echo(path)}" is listed twice (case does not count)`,
          'Give every file its own path.',
        );
        return;
      }
      seen.add(folded);
      const content = own(raw, 'content');
      const problem = contentProblem(content);
      if (problem !== null || typeof content !== 'string') {
        add(
          'BUNDLE_CONTENT_INVALID',
          `${at}.content`,
          `The content of "${echo(path)}" ${problem ?? 'is not a string'}`,
          'Send each file as UTF-8 text, exactly as the bundler wrote it.',
        );
        return;
      }
      bytes += utf8Bytes(content);
      files.push({ path, content, kind });
    });
    if (bytes > HOSTED_BUNDLE_LIMITS.maxBytes) {
      add(
        'BUNDLE_TOO_LARGE',
        'bundle.files',
        `The modules weigh ${String(bytes)} bytes, over ${String(HOSTED_BUNDLE_LIMITS.maxBytes)}`,
        'Minify the bundle and leave out what the Worker does not import.',
      );
    }
  }

  const main = own(input, 'main');
  const mainFile =
    typeof main === 'string'
      ? files.find((file) => file.path === main)
      : undefined;
  if (typeof main !== 'string' || mainFile?.kind !== 'esm') {
    add(
      'BUNDLE_MAIN_INVALID',
      'bundle.main',
      '"main" must name one of the .js or .mjs files',
      'Set "main" to the path of the module that exports the fetch handler.',
    );
  }

  let lockfile: NormalisedBundle['lockfile'] = null;
  const rawLock = own(input, 'lockfile');
  if (rawLock !== undefined && rawLock !== null) {
    const name = isRecord(rawLock) ? own(rawLock, 'name') : undefined;
    const content = isRecord(rawLock) ? own(rawLock, 'content') : undefined;
    const known =
      typeof name === 'string' &&
      (LOCKFILE_NAMES as readonly string[]).includes(name);
    const extra = isRecord(rawLock)
      ? Object.keys(rawLock).some((key) => key !== 'name' && key !== 'content')
      : true;
    const problem = contentProblem(content);
    if (!known || extra || problem !== null || typeof content !== 'string') {
      add(
        'BUNDLE_LOCKFILE_INVALID',
        'bundle.lockfile',
        'The lockfile is not { "name", "content" } with a known lockfile name and text content',
        `Send the project's lockfile as { "name": one of ${LOCKFILE_NAMES.join(', ')}, "content": its text }, or leave "lockfile" out.`,
      );
    } else if (utf8Bytes(content) > HOSTED_BUNDLE_LIMITS.maxLockfileBytes) {
      add(
        'BUNDLE_LOCKFILE_INVALID',
        'bundle.lockfile.content',
        `The lockfile is over ${String(HOSTED_BUNDLE_LIMITS.maxLockfileBytes)} bytes`,
        'Send the lockfile of the app only (not of a whole monorepo), or leave "lockfile" out.',
      );
    } else {
      lockfile = { name: name as LockfileName, content };
    }
  }

  if (errors.length > 0 || typeof main !== 'string') {
    return { ok: false, errors };
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { ok: true, bundle: { main, files, lockfile }, bytes };
}
