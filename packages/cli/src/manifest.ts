import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import {
  formatManifestPath,
  MANIFEST_FILE_NAME,
  validateManifest,
} from '@tassyir/app-manifest';
import type { AppManifest } from '@tassyir/app-manifest';
import { parse, TomlDate, TomlError } from 'smol-toml';
import { CliError, EXIT_CODES } from './errors.js';
import type { CliProblem } from './errors.js';

// tassyir.app.toml: read, parsed (TOML is the CLI's job, plan §3.2), and
// checked by @tassyir/app-manifest, the Tassyir API's own validator, so a
// manifest the CLI passes is one the API takes, with the same errors.
//
// One check of the CLI's own comes on top (plan §10, AP-K1.2's known gap):
// the validator reads a TOML date where a table goes as an empty table, and
// the API, which receives JSON, would see a string there. No field of the
// manifest takes a date, so the CLI refuses every TOML date or time that the
// validator did not already name, in the validator's shape and words.

export interface LoadedManifest {
  /** Absolute path of the file. */
  path: string;
  /** The path as the developer would type it, from the working folder. */
  display: string;
  /** What smol-toml returned: what `deploy` uploads, once it passed. */
  parsed: Record<string, unknown>;
}

export type ManifestCheck =
  { ok: true; manifest: AppManifest } | { ok: false; errors: CliProblem[] };

/** Reads and parses the manifest; a missing file or bad TOML is a CliError (exit 4). */
export async function loadManifest(
  cwd: string,
  file?: string,
): Promise<LoadedManifest> {
  const path = resolve(cwd, file ?? MANIFEST_FILE_NAME);
  const display = relative(cwd, path) || path;
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code;
    throw new CliError({
      code: reason === 'ENOENT' ? 'MANIFEST_NOT_FOUND' : 'MANIFEST_UNREADABLE',
      message:
        reason === 'ENOENT'
          ? `${display} does not exist`
          : `Could not read ${display} (${reason ?? 'error'})`,
      fix:
        reason === 'ENOENT'
          ? `Run the command in your app's folder (the one holding ${MANIFEST_FILE_NAME}), pass its path, or start an app with \`tassyir app init\`.`
          : `Check that you can read ${display}.`,
      exitCode: EXIT_CODES.MANIFEST,
    });
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = parse(text);
  } catch (error) {
    const line = error instanceof TomlError ? error.line : undefined;
    const column = error instanceof TomlError ? error.column : undefined;
    const where =
      line === undefined
        ? ''
        : `, line ${String(line)} column ${String(column)}`;
    const first =
      error instanceof Error ? (error.message.split('\n')[0] ?? '') : '';
    throw new CliError({
      code: 'MANIFEST_TOML_INVALID',
      message: `${display} is not valid TOML${where}: ${first}`,
      fix: 'Fix the TOML syntax at that line (quotes, brackets, one key per line), then run `tassyir validate`.',
      exitCode: EXIT_CODES.MANIFEST,
      details: { file: display, line, column },
    });
  }
  return { path, display, parsed };
}

/** The validator's verdict, plus the CLI's refusal of TOML dates. */
export function checkManifest(parsed: Record<string, unknown>): ManifestCheck {
  const result = validateManifest(parsed);
  const named = result.ok ? [] : result.errors.map((error) => error.path);
  const dates = findDates(parsed)
    .filter(
      (path) =>
        !named.some(
          (other) =>
            other === path ||
            path.startsWith(`${other}.`) ||
            path.startsWith(`${other}[`),
        ),
    )
    .map((path): CliProblem => ({
      code: 'MANIFEST_FIELD_TYPE',
      path,
      message: `\`${path}\` is a date; no field of the manifest takes a date or a time.`,
      fix: `Replace the value of \`${path}\` with what the field takes (a string in quotes, a table or a list): see the manifest reference.`,
    }));
  if (result.ok && dates.length === 0) {
    return { ok: true, manifest: result.manifest };
  }
  return {
    ok: false,
    errors: [...(result.ok ? [] : result.errors), ...dates],
  };
}

/** A manifest that does not pass, as one CliError (exit 4) listing every problem. */
export function manifestInvalid(
  display: string,
  errors: readonly CliProblem[],
): CliError {
  const first = errors[0];
  return new CliError({
    code: 'MANIFEST_INVALID',
    message: `${display} has ${String(errors.length)} problem${errors.length === 1 ? '' : 's'}${first ? `; the first: ${first.message}` : ''}`,
    fix: first
      ? `${first.fix} Then fix the others listed and run \`tassyir validate\` again.`
      : 'Run `tassyir validate` for the list.',
    exitCode: EXIT_CODES.MANIFEST,
    errors,
  });
}

/** The manifest's `handle`, if it reads as a string, without validating the rest. */
export function handleOf(parsed: Record<string, unknown>): string | undefined {
  const handle = parsed['handle'];
  return typeof handle === 'string' && handle !== '' ? handle : undefined;
}

/** Every TOML date or time in the document, as validator paths, in file order. */
function findDates(value: unknown, path: (string | number)[] = []): string[] {
  if (value instanceof TomlDate || value instanceof Date) {
    return [formatManifestPath(path)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findDates(item, [...path, index]));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) =>
      findDates(item, [...path, key]),
    );
  }
  return [];
}
