import { readFile, realpath, stat } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { BuildFailure, Message } from 'esbuild';
import { LOCKFILE_NAMES } from './bundle-rules.js';
import type { BundleFile, HostedBundle } from './bundle-rules.js';
import { CliError, EXIT_CODES } from './errors.js';
import type { CliProblem } from './errors.js';
import { sourceLocator } from './source-map.js';

// A hosted app's bundle, built by esbuild the way Tassyir Hosting runs it
// (plan §10, AP-B1.14's notes for the CLI): one ES module, `bundle: true`,
// target ES2022, HTML and CSS imported as text, for the Workers runtime
// (`workerd` and `worker` export conditions). `cloudflare:*` and `node:*`
// stay imports, so the checks can name them. The source map is kept in
// memory to point findings at the source; it is never uploaded.

/** Where `tassyir deploy` looks for the Worker's entry, in order. */
export const DEFAULT_ENTRIES = [
  'src/worker.ts',
  'src/worker.js',
  'src/index.ts',
  'src/index.js',
] as const;

/** The bundle's one module. */
export const BUNDLE_MAIN = 'worker.js';

export interface BuiltBundle {
  bundle: HostedBundle;
  /** The entry, as the developer would type it. */
  entry: string;
  /** esbuild's warnings, one line each. */
  warnings: string[];
  /** A bundle position's source, `src/worker.ts:12`, or null. */
  locate(file: string, line: number, column: number): string | null;
}

function display(cwd: string, path: string): string {
  return relative(cwd, path) || path;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function findEntry(
  cwd: string,
  root: string,
  entry: string | undefined,
): Promise<string> {
  if (entry !== undefined) {
    const path = resolve(cwd, entry);
    if (await isFile(path)) return path;
    throw new CliError({
      code: 'BUNDLE_ENTRY_NOT_FOUND',
      message: `--entry ${entry}: no such file`,
      fix: "Pass the module that exports the Worker's fetch handler, e.g. --entry src/worker.ts.",
      exitCode: EXIT_CODES.MANIFEST,
    });
  }
  for (const candidate of DEFAULT_ENTRIES) {
    const path = join(root, candidate);
    if (await isFile(path)) return path;
  }
  throw new CliError({
    code: 'BUNDLE_ENTRY_NOT_FOUND',
    message: `A hosted app needs its Worker's entry, and none of ${DEFAULT_ENTRIES.join(', ')} is in ${relative(cwd, root) || '.'}`,
    fix: 'Create src/worker.ts exporting `export default { async fetch(request, env) { … } }`, or pass --entry <file>.',
    exitCode: EXIT_CODES.MANIFEST,
  });
}

/** The project's lockfile (the API's names, in its order), if one is there. */
export async function readLockfile(
  root: string,
): Promise<HostedBundle['lockfile']> {
  for (const name of LOCKFILE_NAMES) {
    const path = join(root, name);
    if (!(await isFile(path))) continue;
    try {
      return { name, content: await readFile(path, 'utf8') };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function isBuildFailure(error: unknown): error is BuildFailure {
  return (
    error instanceof Error &&
    Array.isArray((error as Partial<BuildFailure>).errors)
  );
}

/** `src/worker.ts:3:7` from the working folder, or '' (esbuild names files from `root`). */
type Where = (message: Message) => string;

function whereFrom(cwd: string, root: string): Where {
  return (message) => {
    const location = message.location;
    if (!location) return '';
    const file = display(cwd, resolve(root, location.file));
    return `${file}:${String(location.line)}:${String(location.column)}`;
  };
}

/** One esbuild error as a problem, with a fix for the usual ones. */
function buildProblem(message: Message, where: Where): CliProblem {
  const unresolved = /^Could not resolve "([^"]+)"/.exec(message.text)?.[1];
  if (unresolved !== undefined && isBuiltin(unresolved)) {
    return {
      code: 'BUNDLE_NODE_IMPORT',
      path: where(message),
      message: `"${unresolved}" is a Node.js built-in, which hosted apps do not have`,
      fix: 'Hosted apps run without Node.js built-ins: use the Web APIs (fetch, crypto.subtle, TextEncoder, …) or a package that does not import them.',
    };
  }
  if (unresolved !== undefined) {
    return {
      code: 'BUNDLE_BUILD_ERROR',
      path: where(message),
      message: message.text,
      fix: `Install the package (npm install ${unresolved}) or fix the import's path, then run \`tassyir deploy\` again.`,
    };
  }
  if (/^No loader is configured for/.test(message.text)) {
    return {
      code: 'BUNDLE_FILE_TYPE_NOT_ALLOWED',
      path: where(message),
      message: message.text,
      fix: 'Hosted apps ship text only: import .html and .css as text, inline small images as data: URLs in CSS or HTML, and serve larger ones from a host in hosting.allowed_hosts.',
    };
  }
  return {
    code: 'BUNDLE_BUILD_ERROR',
    path: where(message),
    message: message.text,
    fix: 'Fix the code at that place, then run `tassyir deploy` again.',
  };
}

function warningLine(message: Message, where: Where): string {
  const at = where(message);
  return `${at ? `${at}: ` : ''}${message.text} (esbuild)`;
}

/**
 * Builds the bundle of the app in `root` (the manifest's folder) from
 * `entry` (relative to `cwd`) or the first of {@link DEFAULT_ENTRIES}, with
 * the project's lockfile when it has one. A build error is a CliError (exit 4).
 */
export async function buildHostedBundle(options: {
  cwd: string;
  root: string;
  entry?: string | undefined;
}): Promise<BuiltBundle> {
  // Real paths: esbuild resolves symlinks (macOS's /var is /private/var),
  // and every path it names must read from the same folders.
  const cwd = await realpath(options.cwd).catch(() => options.cwd);
  const root = await realpath(options.root).catch(() => options.root);
  const entryPath = await realpath(await findEntry(cwd, root, options.entry));
  const entry = display(cwd, entryPath);
  const where = whereFrom(cwd, root);
  const esbuild = await import('esbuild');
  let result: Awaited<ReturnType<typeof esbuild.build>>;
  try {
    result = await esbuild.build({
      absWorkingDir: root,
      entryPoints: [{ in: entryPath, out: 'worker' }],
      outdir: root,
      write: false,
      bundle: true,
      format: 'esm',
      target: 'es2022',
      platform: 'browser',
      conditions: ['workerd', 'worker', 'browser'],
      mainFields: ['browser', 'module', 'main'],
      loader: { '.html': 'text', '.css': 'text' },
      external: ['cloudflare:*', 'node:*'],
      sourcemap: 'external',
      sourcesContent: false,
      logLevel: 'silent',
    });
  } catch (error) {
    if (!isBuildFailure(error)) throw error;
    const errors = error.errors.map((message) => buildProblem(message, where));
    const first = errors[0];
    throw new CliError({
      code: 'BUNDLE_BUILD_FAILED',
      message: `esbuild could not build ${entry}: ${String(errors.length)} error${errors.length === 1 ? '' : 's'}${first ? `; the first: ${first.path ? `${first.path}: ` : ''}${first.message}` : ''}`,
      fix:
        first?.fix ??
        'Fix the code esbuild names, then run `tassyir deploy` again.',
      exitCode: EXIT_CODES.MANIFEST,
      errors,
    });
  }

  const files: BundleFile[] = [];
  const maps = new Map<string, ReturnType<typeof sourceLocator>>();
  for (const output of result.outputFiles ?? []) {
    const path = relative(root, output.path).split(sep).join('/');
    if (path.endsWith('.map')) {
      maps.set(path.slice(0, -'.map'.length), sourceLocator(output.text));
    } else {
      files.push({ path, content: output.text });
    }
  }
  const lockfile = await readLockfile(root);
  return {
    bundle: {
      main: BUNDLE_MAIN,
      files,
      ...(lockfile ? { lockfile } : {}),
    },
    entry,
    warnings: result.warnings.map((message) => warningLine(message, where)),
    locate(file, line, column) {
      const position = maps.get(file)?.(line, column);
      if (!position) return null;
      // The map names sources from the bundle's folder (the project's root).
      const source = isAbsolute(position.source)
        ? display(cwd, position.source)
        : display(cwd, resolve(root, position.source));
      return `${source}:${String(position.line)}`;
    },
  };
}
