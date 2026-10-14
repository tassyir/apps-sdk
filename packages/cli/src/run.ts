import { parseArgs } from 'node:util';
import type { ParseArgsOptionsConfig } from 'node:util';
import { DEFAULT_API_ORIGIN } from './api.js';
import { isLoopback } from './browser.js';
import { Context } from './command.js';
import type { Command, OptionSpec } from './command.js';
import { COMMANDS, GROUPS } from './commands/index.js';
import { CliError, EXIT_CODES, isCliError, usageError } from './errors.js';
import type { CliIo } from './io.js';

// The command line: `tassyir <command> [subcommand] [options]`. Global
// options go anywhere. `--json` prints one JSON document per line on stdout
// (`{ ok: true, … }` or `{ ok: false, error: { code, message, fix, … } }`);
// people get text on stdout and refusals on stderr. Whatever is printed goes
// through `redact`: a developer token or a device code never leaves.

const MINIMUM_NODE = [22, 18, 0] as const;

const GLOBAL_OPTIONS: Readonly<Record<string, OptionSpec>> = {
  json: {
    type: 'boolean',
    description:
      'Print JSON on stdout: { ok: true, … }, or { ok: false, error: { code, message, fix } }.',
  },
  'api-origin': {
    type: 'string',
    value: 'url',
    description: `Another Tassyir API (staging, a local one). Default TASSYIR_API_ORIGIN, else ${DEFAULT_API_ORIGIN}.`,
  },
  help: { type: 'boolean', short: 'h', description: 'Show help.' },
};

/** Developer tokens and device codes: never printed, whatever asks. */
const SECRET = /tsy_(dt|dc)_[0-9A-Za-z]+/g;

/**
 * Control characters but newline and tab are dropped: text from the API (a
 * message, the approval page's address) never moves the cursor or
 * recolours the terminal.
 */
function withoutControls(text: string): string {
  let kept = '';
  for (const character of text) {
    const code = character.charCodeAt(0);
    const control =
      (code < 0x20 && code !== 0x0a && code !== 0x09) ||
      (code >= 0x7f && code <= 0x9f);
    if (!control) kept += character;
  }
  return kept;
}

/** Replaces every developer token and device code in `text`, and drops control characters. */
export function redact(text: string): string {
  return withoutControls(text.replace(SECRET, 'tsy_$1_[redacted]'));
}

/** The API origin: --api-origin, TASSYIR_API_ORIGIN, or the production API. */
export function resolveApiOrigin(value: string | undefined): string {
  const raw = value?.trim();
  if (!raw) return DEFAULT_API_ORIGIN;
  const invalid = (why: string) =>
    new CliError({
      code: 'API_ORIGIN_INVALID',
      message: `The API origin "${raw}" ${why}`,
      fix: `Use an https origin with no path (${DEFAULT_API_ORIGIN}); http only for this machine (http://localhost:3000).`,
      exitCode: EXIT_CODES.USAGE,
    });
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalid('is not a URL');
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw invalid('must be an origin only (no path, query or credentials)');
  }
  if (url.protocol === 'https:') return url.origin;
  if (url.protocol === 'http:' && isLoopback(url.hostname)) return url.origin;
  throw invalid('is not https: a developer token never travels in clear text');
}

function compareVersions(version: string, minimum: readonly number[]): number {
  const parts = version.split('.').map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < minimum.length; index += 1) {
    const difference = (parts[index] ?? 0) - (minimum[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The command words (`app`, `create`) and everything else. Options may come
 * before the command (`tassyir --json app list`); a group's subcommand must
 * follow it directly.
 */
function locate(argv: readonly string[]): {
  words: string[];
  rest: string[];
} {
  const words: string[] = [];
  const rest: string[] = [];
  let index = 0;
  while (index < argv.length) {
    const arg = argv[index] ?? '';
    const inGroup = words.length === 1 && GROUPS.includes(words[0] ?? '');
    if (!arg.startsWith('-')) {
      if (words.length === 0 || inGroup) {
        words.push(arg);
        index += 1;
        continue;
      }
      break;
    }
    if (words.length > 0) break;
    rest.push(arg);
    if (arg === '--api-origin' && index + 1 < argv.length) {
      rest.push(argv[index + 1] ?? '');
      index += 1;
    }
    index += 1;
  }
  rest.push(...argv.slice(index));
  return { words, rest };
}

function optionsConfig(command: Command | undefined): ParseArgsOptionsConfig {
  const config: ParseArgsOptionsConfig = {};
  const all = { ...GLOBAL_OPTIONS, ...(command?.options ?? {}) };
  for (const [name, spec] of Object.entries(all)) {
    config[name] = spec.short
      ? { type: spec.type, short: spec.short }
      : { type: spec.type };
  }
  return config;
}

function optionLines(options: Readonly<Record<string, OptionSpec>>): string[] {
  const rows = Object.entries(options).map(([name, spec]) => [
    `${spec.short ? `-${spec.short}, ` : ''}--${name}${spec.value ? ` <${spec.value}>` : ''}`,
    spec.description,
  ]);
  const width = Math.max(0, ...rows.map(([left]) => (left ?? '').length));
  return rows.map(
    ([left, right]) => `  ${(left ?? '').padEnd(width)}  ${right ?? ''}`,
  );
}

function mainHelp(version: string): string {
  const width = Math.max(...COMMANDS.map((command) => command.name.length));
  return [
    `tassyir ${version}: the Tassyir developer CLI`,
    '',
    'Usage: tassyir <command> [options]',
    '',
    'Commands:',
    ...COMMANDS.map(
      (command) =>
        `  ${command.name.padEnd(width)}  ${command.summary}${command.unavailable ? ' (not available yet)' : ''}`,
    ),
    '',
    'Global options:',
    ...optionLines(GLOBAL_OPTIONS),
    '  -v, --version            Show the version.',
    '',
    'Exit codes: 0 done, 1 failed, 2 usage, 3 sign in again, 4 manifest invalid, 5 try again later.',
    'Environment: TASSYIR_TOKEN (CI), TASSYIR_API_ORIGIN, TASSYIR_CREDENTIAL_STORE (keychain | file),',
    '             TASSYIR_CONFIG_DIR, TASSYIR_DEBUG=1 (requests on stderr, never a token).',
    'Help on one command: tassyir <command> --help',
  ].join('\n');
}

function commandHelp(command: Command): string {
  return [
    `Usage: ${command.usage}`,
    '',
    command.summary +
      (command.unavailable
        ? ` (not available yet: ${command.unavailable.reason})`
        : ''),
    ...(command.description ? ['', command.description] : []),
    ...(Object.keys(command.options).length > 0
      ? ['', 'Options:', ...optionLines(command.options)]
      : []),
    '',
    'Global options:',
    ...optionLines(GLOBAL_OPTIONS),
  ].join('\n');
}

/** The commands as data, for `tassyir --help --json` (an agent's catalogue). */
function helpDocument(version: string): Record<string, unknown> {
  return {
    ok: true,
    version,
    commands: COMMANDS.map((command) => ({
      name: command.name,
      summary: command.summary,
      usage: command.usage,
      available: command.unavailable === undefined,
      options: Object.entries({ ...command.options, ...GLOBAL_OPTIONS }).map(
        ([name, spec]) => ({
          name: `--${name}`,
          type: spec.type,
          description: spec.description,
        }),
      ),
    })),
    exitCodes: EXIT_CODES,
  };
}

function errorText(error: CliError): string {
  const parts = [`✗ ${error.code}: ${error.message}`, `  Fix: ${error.fix}`];
  for (const problem of error.errors ?? []) {
    parts.push(
      `  - ${problem.code}${problem.path ? ` at ${problem.path}` : ''}: ${problem.message}`,
    );
    parts.push(`    Fix: ${problem.fix}`);
  }
  if (error.retryAfterSeconds !== undefined) {
    parts.push(`  Retry after ${String(error.retryAfterSeconds)} s.`);
  }
  if (error.requestId) parts.push(`  Request id: ${error.requestId}`);
  return `${parts.join('\n')}\n`;
}

/** Runs one command line. Returns the process exit code. */
export async function runCli(
  argv: readonly string[],
  rawIo: CliIo,
): Promise<number> {
  const io: CliIo = {
    ...rawIo,
    stdout: (text) => {
      rawIo.stdout(redact(text));
    },
    stderr: (text) => {
      rawIo.stderr(redact(text));
    },
  };
  const json = argv.includes('--json');
  const debug =
    io.env['TASSYIR_DEBUG'] && io.env['TASSYIR_DEBUG'] !== '0'
      ? (line: string) => {
          io.stderr(`[debug] ${line}\n`);
        }
      : undefined;
  const print = (document: Record<string, unknown>) => {
    io.stdout(`${JSON.stringify(document)}\n`);
  };

  try {
    if (compareVersions(io.nodeVersion, MINIMUM_NODE) < 0) {
      throw new CliError({
        code: 'NODE_VERSION_UNSUPPORTED',
        message: `Node ${io.nodeVersion} is too old: the CLI needs Node 22.18 or later`,
        fix: 'Install Node 22.18 or later (for example `nvm install 22`), then run the command again.',
      });
    }
    const { words, rest } = locate(argv);
    const name = words.join(' ');
    const command = COMMANDS.find((candidate) => candidate.name === name);

    if (!command) {
      const wantsHelp = rest.includes('--help') || rest.includes('-h');
      if (words.length === 0) {
        if (rest.includes('--version') || rest.includes('-v')) {
          if (json) print({ ok: true, version: io.version });
          else io.stdout(`${io.version}\n`);
          return EXIT_CODES.OK;
        }
        const unknown = rest.find(
          (arg) => !['--json', '--help', '-h'].includes(arg),
        );
        if (unknown !== undefined && !wantsHelp) {
          throw usageError(`Unknown option ${unknown}`, undefined);
        }
        if (json) print(helpDocument(io.version));
        else io.stdout(`${mainHelp(io.version)}\n`);
        return EXIT_CODES.OK;
      }
      const group = words[0] ?? '';
      const members = COMMANDS.filter((candidate) =>
        candidate.name.startsWith(`${group} `),
      );
      if (members.length > 0 && words.length === 1 && wantsHelp && !json) {
        io.stdout(
          `${[`Usage: tassyir ${group} <command> [options]`, '', ...members.map((member) => `  ${member.name.padEnd(20)}  ${member.summary}`)].join('\n')}\n`,
        );
        return EXIT_CODES.OK;
      }
      throw new CliError({
        code: 'UNKNOWN_COMMAND',
        message: `"${name}" is not a tassyir command`,
        fix:
          members.length > 0
            ? `Use one of: ${members.map((member) => `tassyir ${member.name}`).join(', ')}.`
            : 'Run `tassyir --help` for the commands.',
        exitCode: EXIT_CODES.USAGE,
      });
    }

    const values: Record<string, string | boolean | undefined> = {};
    let positionals: string[];
    try {
      const parsed = parseArgs({
        args: rest,
        options: optionsConfig(command),
        allowPositionals: true,
        strict: true,
      });
      // No option is `multiple`: every value is one string or boolean.
      for (const [key, value] of Object.entries(parsed.values)) {
        if (!Array.isArray(value)) values[key] = value;
      }
      positionals = parsed.positionals;
    } catch (error) {
      throw usageError((error as Error).message, command.name);
    }
    if (values['help'] === true) {
      if (json) {
        const document = helpDocument(io.version);
        print({
          ...document,
          commands: (document['commands'] as { name: string }[]).filter(
            (entry) => entry.name === command.name,
          ),
        });
      } else {
        io.stdout(`${commandHelp(command)}\n`);
      }
      return EXIT_CODES.OK;
    }
    const range = command.positionals ?? { min: 0, max: 0, names: '' };
    if (positionals.length < range.min || positionals.length > range.max) {
      throw usageError(
        range.max === 0
          ? `${command.name} takes no argument, got: ${positionals.join(' ')}`
          : `${command.name} takes ${range.names}, got ${String(positionals.length)} argument${positionals.length === 1 ? '' : 's'}`,
        command.name,
      );
    }
    if (command.unavailable) {
      throw new CliError({
        code: 'COMMAND_NOT_AVAILABLE',
        message: `tassyir ${command.name} is not available yet: ${command.unavailable.reason}`,
        fix: command.unavailable.fix,
        exitCode: EXIT_CODES.FAILED,
      });
    }

    const apiOrigin = resolveApiOrigin(
      typeof values['api-origin'] === 'string'
        ? values['api-origin']
        : io.env['TASSYIR_API_ORIGIN'],
    );
    const context = new Context({ io, json, apiOrigin, debug });
    const result = await command.run(context, { values, positionals });
    if (json) print({ ok: true, ...result.data });
    else io.stdout(result.text);
    return EXIT_CODES.OK;
  } catch (error) {
    const failure = isCliError(error)
      ? error
      : new CliError({
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : String(error),
          fix: 'This is a bug in the tassyir CLI: report it at https://github.com/tassyir/apps-sdk/issues with the command you ran (never your token).',
        });
    if (json) print({ ok: false, error: failure.toJSON() });
    else io.stderr(errorText(failure));
    return failure.exitCode;
  }
}
