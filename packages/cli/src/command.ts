import { DeveloperApi } from './api.js';
import type { DeveloperApp } from './api-types.js';
import { CredentialStore } from './credentials.js';
import type { ResolvedToken } from './credentials.js';
import { CliError, EXIT_CODES, notLoggedIn } from './errors.js';
import type { CliIo } from './io.js';
import { handleOf, loadManifest } from './manifest.js';

// What every command gets, and how one is declared. A command returns its
// result once: `data` for `--json` (printed as `{ ok: true, ...data }`) and
// `text` for people. Refusals are thrown CliErrors.

export interface OptionSpec {
  type: 'string' | 'boolean';
  short?: string;
  /** The value's name in the help (`<handle>`). */
  value?: string;
  description: string;
}

export interface ParsedArgs {
  values: Readonly<Record<string, string | boolean | undefined>>;
  positionals: readonly string[];
}

export interface CommandResult {
  data: Record<string, unknown>;
  text: string;
}

export interface Command {
  /** `login`, `app create`, … */
  name: string;
  summary: string;
  /** `tassyir app create [options]` */
  usage: string;
  /** More help, printed under the usage line. */
  description?: string;
  options: Readonly<Record<string, OptionSpec>>;
  /** How many positionals the command takes. Default none. */
  positionals?: { min: number; max: number; names: string };
  /** A seam: shown in the help, answered COMMAND_NOT_AVAILABLE with `fix`. */
  unavailable?: { reason: string; fix: string };
  run(context: Context, args: ParsedArgs): Promise<CommandResult>;
}

export interface ContextInit {
  io: CliIo;
  json: boolean;
  apiOrigin: string;
  debug: ((line: string) => void) | undefined;
}

export class Context {
  readonly io: CliIo;
  readonly json: boolean;
  readonly apiOrigin: string;
  readonly credentials: CredentialStore;
  readonly debug: ((line: string) => void) | undefined;

  constructor(init: ContextInit) {
    this.io = init.io;
    this.json = init.json;
    this.apiOrigin = init.apiOrigin;
    this.debug = init.debug;
    this.credentials = new CredentialStore(init.io);
  }

  get userAgent(): string {
    return `tassyir-cli/${this.io.version} (node ${this.io.nodeVersion}; ${this.io.platform})`;
  }

  /** A client for `token`, or for the public sign-in routes without one. */
  client(token?: string): DeveloperApi {
    return new DeveloperApi({
      apiOrigin: this.apiOrigin,
      fetch: this.io.fetch,
      userAgent: this.userAgent,
      token,
      debug: this.debug,
    });
  }

  /** A client with the developer token; NOT_LOGGED_IN (exit 3) without one. */
  async api(): Promise<{ api: DeveloperApi; token: ResolvedToken }> {
    const token = await this.credentials.resolve(this.apiOrigin);
    if (!token) throw notLoggedIn(this.apiOrigin);
    return { api: this.client(token.token), token };
  }

  /** A line of progress for people: stderr, and nothing in `--json` mode. */
  progress(text: string): void {
    if (!this.json) this.io.stderr(`${text}\n`);
  }

  /** In `--json` mode, one more document before the result (login's code). */
  emit(document: Record<string, unknown>): void {
    if (this.json) this.io.stdout(`${JSON.stringify(document)}\n`);
  }
}

/**
 * The app a command acts on: `--app` (its numeric id or its handle), else
 * the handle of tassyir.app.toml in the working folder.
 */
export async function resolveApp(
  context: Context,
  api: DeveloperApi,
  app: string | undefined,
  manifestFile?: string,
): Promise<DeveloperApp> {
  let reference = app?.trim();
  if (!reference) {
    const handle = await loadManifest(context.io.cwd, manifestFile)
      .then(({ parsed }) => handleOf(parsed))
      .catch(() => undefined);
    if (!handle) {
      throw new CliError({
        code: 'APP_REQUIRED',
        message:
          'Which app? No --app was given, and no tassyir.app.toml with a handle is here',
        fix: "Pass --app <handle or id> (`tassyir app list` shows them), or run the command in your app's folder.",
        exitCode: EXIT_CODES.USAGE,
      });
    }
    reference = handle;
  }
  // One list answers both an id and a handle (a handle may be all digits).
  const apps = (await api.listApps()).data;
  const found =
    apps.find((candidate) => candidate.handle === reference) ??
    apps.find((candidate) => candidate.id === reference);
  if (!found) {
    throw new CliError({
      code: 'APP_NOT_FOUND',
      message: `You have no app with the handle or id "${reference}"`,
      fix: apps.length
        ? `Use one of your apps (${apps.map((candidate) => candidate.handle).join(', ')}), or create this one with \`tassyir app create\`.`
        : 'Create it with `tassyir app create` (it reads the handle and name from tassyir.app.toml).',
      details: { handle: reference },
    });
  }
  return found;
}

/** Columns padded to their widest cell. */
export function table(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? '').length)),
  );
  const line = (cells: readonly string[]) =>
    cells
      .map((cell, column) =>
        column === cells.length - 1 ? cell : cell.padEnd(widths[column] ?? 0),
      )
      .join('  ')
      .trimEnd();
  return [line(headers), ...rows.map(line)].join('\n');
}

/** `null` and `undefined` as a dash, for tables. */
export function cell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

/** Lines joined with a final newline. */
export function lines(
  ...parts: readonly (string | false | null | undefined)[]
): string {
  return `${parts.filter((part) => typeof part === 'string').join('\n')}\n`;
}

/** A string option's value, or undefined (absent, or a boolean). */
export function stringValue(
  value: string | boolean | undefined,
): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
