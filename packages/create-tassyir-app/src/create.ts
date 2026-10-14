import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { validateManifest, validateManifestField } from '@tassyir/app-manifest';
import { parse } from 'smol-toml';
import { CreateError } from './errors.js';
import type { CreateProblem } from './errors.js';
import {
  TEMPLATE_DEPENDENCIES,
  TEMPLATES,
  templateDirectory,
} from './templates.js';
import type { TemplateName } from './templates.js';

export interface CreateProjectOptions {
  /** The folder to create the project in: new, or empty. */
  directory: string;
  /** Default `external`. */
  template?: string;
  /**
   * The app's handle: permanent once the app exists in the developer
   * console, and unique on Tassyir. Default: the folder's name, made a handle.
   */
  handle?: string;
  /** The app's display name. Default: the handle in words ("my-app" → "My App"). */
  name?: string;
  /**
   * The server's public https address (`hosting.url`). Default a placeholder
   * on example.com, which `npm run validate` flags until it is replaced.
   */
  url?: string;
}

export interface CreateProjectResult {
  /** Absolute path of the new project. */
  directory: string;
  template: TemplateName;
  app: { name: string; handle: string; url: string };
  /** Every file written, relative to `directory`, sorted. */
  files: string[];
  /** The @tassyir/* versions its package.json names. */
  dependencies: Readonly<Record<string, string>>;
}

/** The literals of the template that become the app's own values. */
const PLACEHOLDER = {
  url: 'https://my-tassyir-app.example.com',
  name: 'My Tassyir App',
  handle: 'my-tassyir-app',
} as const;
const PLACEHOLDERS =
  /https:\/\/my-tassyir-app\.example\.com|My Tassyir App|my-tassyir-app/g;

/** npm leaves these out of a published tarball, so the template renames them. */
const RENAMES: Readonly<Record<string, string>> = {
  gitignore: '.gitignore',
  npmrc: '.npmrc',
  'env.example': '.env.example',
};

/** Entries an otherwise empty target folder may already hold. */
const IGNORED_ENTRIES = new Set(['.git', '.DS_Store']);

/**
 * Writes a new Tassyir app from a template. Checks everything before the
 * first write (the template, the name, handle and URL against the manifest's
 * own rules, an empty target) and never overwrites a file. Throws a
 * CreateError with a code and a fix.
 */
export async function createProject(
  options: CreateProjectOptions,
): Promise<CreateProjectResult> {
  const template = resolveTemplate(options.template ?? 'external');
  const directory = resolve(options.directory);

  const handle = options.handle ?? handleFromFolder(basename(directory));
  checkField(
    'handle',
    handle,
    options.handle === undefined ? 'directory' : '--handle',
  );
  const name = options.name ?? nameFromHandle(handle);
  checkField('name', name, '--name');
  const url = options.url ?? `https://${handle}.example.com`;

  const files = await renderTemplate(template, { handle, name, url });
  checkManifest(files.get('tassyir.app.toml') ?? '');
  await checkTarget(directory);
  await writeFiles(directory, files);

  return {
    directory,
    template,
    app: { name, handle, url },
    files: [...files.keys()].sort(),
    dependencies: TEMPLATE_DEPENDENCIES,
  };
}

/** "My Shop!" → "my-shop": lowercase letters and digits joined by single hyphens. */
export function handleFromFolder(folder: string): string {
  return folder
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** "my-shop" → "My Shop". */
export function nameFromHandle(handle: string): string {
  return handle
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    .slice(0, 50)
    .trim();
}

function resolveTemplate(value: string): TemplateName {
  const template = TEMPLATES.find((candidate) => candidate.name === value);
  if (!template) {
    throw new CreateError({
      code: 'TEMPLATE_UNKNOWN',
      path: '--template',
      message: `"${value}" is not a template`,
      fix: `Use one of: ${TEMPLATES.map((candidate) => candidate.name).join(', ')}.`,
    });
  }
  if (!template.available) {
    throw new CreateError({
      code: 'TEMPLATE_NOT_AVAILABLE',
      path: '--template',
      message: `The ${template.name} template is not available yet: ${template.unavailable?.reason ?? 'it is not built'}`,
      fix: template.unavailable?.fix ?? 'Use --template external.',
    });
  }
  return template.name;
}

/** The manifest's own rule for the field (the Tassyir API's validator). */
function checkField(
  field: 'handle' | 'name',
  value: string,
  path: string,
): void {
  const problem = validateManifestField(field, value);
  if (problem === null) return;
  throw new CreateError({
    code: problem.code,
    path,
    message: problem.message,
    fix:
      path === 'directory'
        ? `Pass --handle with a valid handle (3-40 lowercase letters and digits joined by single hyphens), or rename the folder. ${problem.fix}`
        : problem.fix,
  });
}

/** The generated tassyir.app.toml must pass the Tassyir API's validator. */
function checkManifest(text: string): void {
  const result = validateManifest(parse(text));
  if (result.ok) return;
  const options: Record<string, string> = {
    name: '--name',
    handle: '--handle',
    'hosting.url': '--url',
  };
  const problems: CreateProblem[] = result.errors.map((error) => ({
    code: error.code,
    path: options[error.path] ?? `tassyir.app.toml ${error.path}`,
    message: error.message,
    fix: error.fix,
  }));
  const [first, ...others] = problems;
  if (!first) return;
  throw new CreateError(
    { ...first, code: first.code as `MANIFEST_${string}` },
    others,
  );
}

async function checkTarget(directory: string): Promise<void> {
  let entries: string[];
  try {
    const info = await stat(directory);
    if (!info.isDirectory()) {
      throw new CreateError({
        code: 'TARGET_NOT_A_DIRECTORY',
        path: 'directory',
        message: `${directory} exists and is not a folder`,
        fix: 'Choose another folder name.',
      });
    }
    entries = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const taken = entries.filter((entry) => !IGNORED_ENTRIES.has(entry));
  if (taken.length > 0) {
    throw new CreateError({
      code: 'TARGET_NOT_EMPTY',
      path: 'directory',
      message: `${directory} is not empty (${taken.slice(0, 3).join(', ')}${taken.length > 3 ? ', …' : ''})`,
      fix: 'Choose a new folder, or empty this one: the starter never overwrites a file.',
    });
  }
}

/** Reads the template and fills in the app's values. Keys are relative paths. */
async function renderTemplate(
  template: TemplateName,
  values: { handle: string; name: string; url: string },
): Promise<Map<string, string>> {
  const root = templateDirectory(template);
  const files = new Map<string, string>();
  for (const source of await listFiles(root)) {
    const path = relative(root, source).split(sep).join('/');
    const target = RENAMES[path] ?? path;
    const escape = escaperFor(target);
    let text = (await readFile(source, 'utf8')).replace(
      PLACEHOLDERS,
      (literal) =>
        literal === PLACEHOLDER.url
          ? escape(values.url)
          : literal === PLACEHOLDER.name
            ? escape(values.name)
            : values.handle,
    );
    if (target === 'package.json') text = withDependencies(text);
    files.set(target, text);
  }
  return files;
}

/** The inside of a TOML basic string: backslash, quote and controls escaped. */
function tomlString(value: string): string {
  let escaped = '';
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character === '\\' || character === '"') escaped += `\\${character}`;
    else if (code < 0x20 || code === 0x7f) {
      escaped += `\\u${code.toString(16).padStart(4, '0')}`;
    } else escaped += character;
  }
  return escaped;
}

async function listFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await listFiles(path)));
    else if (entry.isFile() && entry.name !== '.DS_Store') found.push(path);
  }
  return found;
}

/**
 * The display name and the URL land inside a TOML or JSON string, or in
 * HTML. They are escaped so any input stays one string value, which the
 * manifest's validator then judges (a quote never ends the TOML string).
 */
function escaperFor(path: string): (value: string) => string {
  if (path.endsWith('.toml')) return tomlString;
  if (path.endsWith('.json'))
    return (value) => JSON.stringify(value).slice(1, -1);
  if (path.endsWith('.html')) {
    return (value) =>
      value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
  }
  return (value) => value;
}

/** Puts the @tassyir/* versions in place of the template's "*". */
function withDependencies(text: string): string {
  const manifest = JSON.parse(text) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  for (const [name, version] of Object.entries(TEMPLATE_DEPENDENCIES)) {
    for (const group of [manifest.dependencies, manifest.devDependencies]) {
      if (group?.[name] !== undefined) group[name] = version;
    }
  }
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

async function writeFiles(
  directory: string,
  files: Map<string, string>,
): Promise<void> {
  for (const [path, text] of files) {
    const target = join(directory, ...path.split('/'));
    try {
      await mkdir(dirname(target), { recursive: true });
      // `wx`: never overwrite, even a file that appeared since the check.
      await writeFile(target, text, { flag: 'wx' });
    } catch (error) {
      throw new CreateError({
        code: 'WRITE_FAILED',
        path,
        message: `Could not write ${target}: ${(error as Error).message}`,
        fix: 'Check that the folder is writable and empty, then run the command again in a new folder.',
      });
    }
  }
}
