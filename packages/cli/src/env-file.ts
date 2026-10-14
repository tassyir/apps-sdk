import { randomBytes } from 'node:crypto';
import { open, readFile, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { CliError, EXIT_CODES } from './errors.js';

// `tassyir secrets create --write-env`: the only place the CLI writes a client
// secret, and only when asked. It never replaces a value silently: the file is
// checked BEFORE the secret is minted (a refusal afterwards would lose a secret
// that is shown once), and a real value is replaced only with --force. The
// starter's .env.example placeholders (`app_your-client-id`, …) are not real
// values: they are filled in. Values are never echoed.

/** `KEY=value`, `export KEY=value`, with optional quotes; comments ignored. */
const LINE = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/;

export interface EnvWriteResult {
  file: string;
  /** Keys written. */
  keys: string[];
  /** Keys whose earlier real value was replaced (--force). */
  replaced: string[];
  created: boolean;
}

function unquote(raw: string): string {
  const value = raw.trim();
  if (
    value.length >= 2 &&
    (value.startsWith('"') || value.startsWith("'")) &&
    value.endsWith(value.charAt(0))
  ) {
    return value.slice(1, -1);
  }
  return value.replace(/\s+#.*$/, '');
}

/** A value the starter's .env.example ships, meant to be replaced. */
export function isPlaceholder(value: string): boolean {
  return value.includes('your-');
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new CliError({
      code: 'ENV_FILE_UNREADABLE',
      message: `Could not read ${path} (${(error as NodeJS.ErrnoException).code ?? 'error'})`,
      fix: 'Check the path given to --env-file and that you can read it.',
      exitCode: EXIT_CODES.FAILED,
    });
  }
}

function currentValues(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = LINE.exec(line);
    if (match?.[2] !== undefined) values.set(match[2], unquote(match[4] ?? ''));
  }
  return values;
}

/**
 * Refuses before anything is minted when `path` holds a real value for one of
 * `keys` that would change (`undefined` = a new value, unknown yet), unless
 * `force`. Returns the keys that will be replaced.
 */
export async function checkEnvFile(
  path: string,
  keys: Readonly<Record<string, string | undefined>>,
  force: boolean,
): Promise<string[]> {
  const text = await readText(path);
  if (text === undefined) {
    // The starter's `npm run setup` writes .env from .env.example with a new
    // TOKEN_STORE_KEY, and never touches an existing .env: one made here
    // first would leave the server without its key.
    const example = join(dirname(path), '.env.example');
    if ((await readText(example)) !== undefined) {
      throw new CliError({
        code: 'ENV_FILE_MISSING',
        message: `${basename(path)} does not exist yet, and ${basename(example)} is next to it; nothing was minted or written`,
        fix: 'Run `npm run setup` first (it writes .env with a new TOKEN_STORE_KEY), or create the file yourself, then run this again.',
        exitCode: EXIT_CODES.USAGE,
        details: { file: path },
      });
    }
    return [];
  }
  const existing = currentValues(text);
  const conflicts = Object.entries(keys)
    .filter(([key, next]) => {
      const value = existing.get(key);
      return (
        value !== undefined &&
        value !== '' &&
        !isPlaceholder(value) &&
        value !== next
      );
    })
    .map(([key]) => key);
  if (conflicts.length > 0 && !force) {
    throw new CliError({
      code: 'ENV_VALUE_EXISTS',
      message: `${basename(path)} already sets ${conflicts.join(', ')}; nothing was minted or written`,
      fix: `Pass --force to replace ${conflicts.length === 1 ? 'it' : 'them'} (the new secret is shown nowhere else), or leave out --write-env to have the secret printed once instead.`,
      exitCode: EXIT_CODES.USAGE,
      details: { file: path, keys: conflicts },
    });
  }
  return conflicts;
}

/** Sets `entries` in `path` (in place, else appended), atomically; 0600 when new. */
export async function writeEnvFile(
  path: string,
  entries: Readonly<Record<string, string>>,
  replaced: readonly string[],
): Promise<EnvWriteResult> {
  const text = await readText(path);
  const written = new Set<string>();
  const output: string[] = [];
  const source = text === undefined ? [] : text.split(/\r?\n/);
  if (source.at(-1) === '') source.pop();
  for (const line of source) {
    const match = LINE.exec(line);
    const key = match?.[2];
    if (match && key !== undefined && Object.hasOwn(entries, key)) {
      if (written.has(key)) continue; // a later duplicate would win: drop it
      output.push(
        `${match[1] ?? ''}${key}${match[3] ?? '='}${entries[key] ?? ''}`,
      );
      written.add(key);
    } else {
      output.push(line);
    }
  }
  for (const [key, value] of Object.entries(entries)) {
    if (!written.has(key)) output.push(`${key}=${value}`);
  }

  let mode = 0o600;
  if (text !== undefined) {
    mode = (await stat(path)).mode & 0o777;
  }
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`,
  );
  try {
    const handle = await open(temporary, 'wx', mode);
    try {
      await handle.writeFile(`${output.join('\n')}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw new CliError({
      code: 'ENV_FILE_UNWRITABLE',
      message: `Could not write ${path} (${(error as NodeJS.ErrnoException).code ?? 'error'})`,
      fix: 'The secret above was minted but not saved: copy it now, or revoke it and mint another once the file is writable.',
      exitCode: EXIT_CODES.FAILED,
    });
  }
  return {
    file: path,
    keys: Object.keys(entries),
    replaced: [...replaced],
    created: text === undefined,
  };
}
