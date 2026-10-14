import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createProject } from './create.js';
import type { CreateProjectResult } from './create.js';
import { CreateError, isCreateError } from './errors.js';
import { TEMPLATES } from './templates.js';

// The command line: `npm create tassyir-app@latest [folder] -- [options]`.
// Prompts only for the folder, only in a terminal; `--json` prints one JSON
// document (the result, or the error with its code and fix) and never asks.

/** What the CLI needs from the outside world; tests pass their own. */
export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
  /** The folder a relative project folder is resolved from. */
  cwd: string;
  /** Node's version (`process.versions.node`). */
  nodeVersion: string;
  /** Asks a question in a terminal; undefined when there is none. */
  prompt: ((question: string, answer: string) => Promise<string>) | undefined;
  /** Runs `npm install` in the folder. */
  install(
    directory: string,
    quiet: boolean,
  ): Promise<{ ok: boolean; output: string }>;
  version: string;
}

const MINIMUM_NODE = [22, 18, 0] as const;
const DEFAULT_FOLDER = 'my-tassyir-app';

const HELP = `Usage: npm create tassyir-app@latest [folder] -- [options]
       npx create-tassyir-app [folder] [options]

Creates a Tassyir app in a new folder (default ${DEFAULT_FOLDER}).

Options:
  --template <name>  ${TEMPLATES.map((template) => `${template.name}${template.available ? '' : ' (not available yet)'}`).join(', ')}. Default external.
  --handle <handle>  The app's handle: permanent and unique on Tassyir.
                     Default: the folder's name.
  --name <name>      The app's display name. Default: the handle in words.
  --url <https-url>  Your server's public address (hosting.url).
                     Default: a placeholder to replace before you upload.
  --install          Run npm install in the new folder.
  --json             Print the result (or the error) as JSON; never prompt.
  -y, --yes          Never prompt: use the defaults.
  -h, --help         Show this help.
  -v, --version      Show the version.

With npm create, put the options after "--" (npm keeps --json and --yes for itself).`;

export async function runCli(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const json = argv.includes('--json');
  try {
    if (compareVersions(io.nodeVersion, MINIMUM_NODE) < 0) {
      throw new CreateError({
        code: 'NODE_VERSION_UNSUPPORTED',
        path: 'node',
        message: `Node ${io.nodeVersion} is too old: Tassyir apps need Node 22.18 or later`,
        fix: 'Install Node 22.18 or later (for example `nvm install 22`), then run the command again.',
      });
    }
    const { values, positionals } = parseOptions(argv);
    if (values.help) {
      io.stdout(`${HELP}\n`);
      return 0;
    }
    if (values.version) {
      io.stdout(`${io.version}\n`);
      return 0;
    }
    if (positionals.length > 1) {
      throw invalidArgument(
        `Expected one folder, got ${String(positionals.length)}: ${positionals.join(' ')}`,
      );
    }

    let folder = positionals[0];
    if (folder === undefined && !json && !values.yes && io.prompt) {
      folder =
        (await io.prompt('Project folder', DEFAULT_FOLDER)).trim() ||
        DEFAULT_FOLDER;
    }

    const result = await createProject({
      directory: resolve(io.cwd, folder ?? DEFAULT_FOLDER),
      template: values.template,
      handle: values.handle,
      name: values.name,
      url: values.url,
    });

    let installed = false;
    if (values.install) {
      const install = await io.install(result.directory, json);
      if (!install.ok) {
        throw new CreateError({
          code: 'INSTALL_FAILED',
          path: result.directory,
          message: `The project was created, but npm install failed in ${result.directory}`,
          fix: `Run npm install in ${result.directory} and read its error (network, Node version).`,
        });
      }
      installed = true;
    }

    const next = nextSteps(result, folder ?? DEFAULT_FOLDER, installed);
    if (json) {
      io.stdout(
        `${JSON.stringify({ ok: true, ...result, installed, next }, null, 2)}\n`,
      );
    } else {
      io.stdout(report(result, next));
    }
    return 0;
  } catch (error) {
    if (!isCreateError(error)) throw error;
    if (json) {
      io.stdout(
        `${JSON.stringify({ ok: false, error: error.toJSON() }, null, 2)}\n`,
      );
    } else {
      const others = error.problems
        .slice(1)
        .map(
          (problem) =>
            `\n✗ ${problem.code} (${problem.path}): ${problem.message}\n  Fix: ${problem.fix}`,
        );
      io.stderr(
        `✗ ${error.code} (${error.path}): ${error.message}\n  Fix: ${error.fix}${others.join('')}\n`,
      );
    }
    return 1;
  }
}

function parseOptions(argv: readonly string[]) {
  try {
    return parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        template: { type: 'string' },
        handle: { type: 'string' },
        name: { type: 'string' },
        url: { type: 'string' },
        install: { type: 'boolean' },
        json: { type: 'boolean' },
        yes: { type: 'boolean', short: 'y' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error) {
    throw invalidArgument((error as Error).message);
  }
}

function invalidArgument(message: string): CreateError {
  return new CreateError({
    code: 'INVALID_ARGUMENT',
    path: 'argv',
    message,
    fix: 'Run npx create-tassyir-app --help for the options; with npm create, put them after "--".',
  });
}

function nextSteps(
  result: CreateProjectResult,
  folder: string,
  installed: boolean,
): string[] {
  // Quoted for a POSIX shell when the folder needs it ("My App").
  const cd = /^[\w./-]+$/.test(folder)
    ? folder
    : `'${folder.replaceAll("'", `'\\''`)}'`;
  return [
    `cd ${cd}`,
    ...(installed ? [] : ['npm install']),
    'npm run setup',
    'Then follow README.md: create the app in the developer console (https://app.tassyir.io/en/developers) with the handle ' +
      `${result.app.handle}, put its credentials in .env, upload tassyir.app.toml, create a dev store, run npm run dev behind an https tunnel, and install the app.`,
  ];
}

function report(result: CreateProjectResult, next: string[]): string {
  return [
    `✓ Created a Tassyir app in ${result.directory} (template ${result.template})`,
    `  ${result.app.name}, handle ${result.app.handle}: the handle is permanent once the app exists in the developer console.`,
    '',
    'Next:',
    ...next.map((step) => `  ${step}`),
    '',
    'AGENTS.md, CLAUDE.md and .claude/skills/tassyir-app explain the project and the Tassyir contract to AI coding agents.',
    '',
  ].join('\n');
}

function compareVersions(version: string, minimum: readonly number[]): number {
  const parts = version.split('.').map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < minimum.length; index += 1) {
    const difference = (parts[index] ?? 0) - (minimum[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
