import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore } from './credentials.js';
import {
  assertFakesFollowTheDocument,
  FAKE_EMAIL,
  FAKE_USER_ID,
  FakeDeveloperApi,
  fakeClock,
} from './fake-api.test-helpers.js';
import type { CliIo, ExecOptions, ExecResult } from './io.js';
import { runCli } from './run.js';

// The specs' world: the CLI's real code, with the fake developer API behind
// `fetch`, a clock that never sleeps, a keychain that is a Map behind fake
// `secret-tool` / `security` programs, and scratch folders.

export interface ExecCall {
  command: string;
  args: readonly string[];
  input: string | undefined;
  detached?: boolean;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  /** The last JSON line on stdout. */
  json(): Record<string, unknown>;
  /** Every JSON line on stdout. */
  jsonLines(): Record<string, unknown>[];
}

export interface HarnessOptions {
  platform?: NodeJS.Platform;
  interactive?: boolean;
  /** Press Enter at once when the CLI offers to open the browser. */
  pressEnter?: boolean;
  /** `missing`: the keychain program is not installed; `broken`: it refuses. */
  keychain?: 'working' | 'missing' | 'broken';
  env?: Record<string, string | undefined>;
}

const scratch: string[] = [];

/**
 * Removes every scratch folder, then fails if the fake API received or
 * answered anything the OpenAPI document does not allow (call from afterEach).
 */
export async function cleanupHarnesses(): Promise<void> {
  await Promise.all(
    scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
  assertFakesFollowTheDocument();
}

export async function createHarness(options: HarnessOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tassyir-cli-'));
  scratch.push(root);
  const configDir = join(root, 'config');
  const cwd = join(root, 'work');
  await import('node:fs/promises').then(({ mkdir }) =>
    mkdir(cwd, { recursive: true }),
  );
  const clock = fakeClock();
  const fake = new FakeDeveloperApi(clock);
  const keychain = new Map<string, string>();
  const execCalls: ExecCall[] = [];
  const printed: string[] = [];
  /** Who listens for Ctrl-C right now (`io.onInterrupt`). */
  const interruptListeners = new Set<() => void>();
  const keychainState = options.keychain ?? 'working';
  const env: Record<string, string | undefined> = {
    TASSYIR_CONFIG_DIR: configDir,
    TASSYIR_API_ORIGIN: fake.origin,
    TASSYIR_CREDENTIAL_STORE: 'file',
    ...options.env,
  };

  const exec = (
    command: string,
    args: readonly string[],
    execOptions: ExecOptions = {},
  ): Promise<ExecResult> => {
    execCalls.push({
      command,
      args: [...args],
      input: execOptions.input,
      ...(execOptions.detached ? { detached: true } : {}),
    });
    const ok = (stdout = ''): Promise<ExecResult> =>
      Promise.resolve({ code: 0, stdout, stderr: '' });
    const fail = (code: number, stderr: string): Promise<ExecResult> =>
      Promise.resolve({ code, stdout: '', stderr });
    if (command === 'secret-tool' || command === '/usr/bin/security') {
      if (keychainState === 'missing') {
        return Promise.resolve({
          code: null,
          stdout: '',
          stderr: '',
          failure: 'ENOENT',
        });
      }
      if (keychainState === 'broken')
        return fail(1, 'Cannot autolaunch D-Bus without X11 $DISPLAY');
    }
    if (command === 'secret-tool') {
      const account = args[args.indexOf('account') + 1] ?? '';
      if (args[0] === 'store') {
        keychain.set(account, execOptions.input ?? '');
        return ok();
      }
      if (args[0] === 'lookup') {
        const token = keychain.get(account);
        return token === undefined ? fail(1, '') : ok(token);
      }
      if (args[0] === 'clear') {
        keychain.delete(account);
        return ok();
      }
    }
    if (command === '/usr/bin/security') {
      if (args[0] === '-i') {
        const match =
          /^add-generic-password -U -s '([^']*)' -a '([^']*)' -l '[^']*' -w '([^']*)'\n$/.exec(
            execOptions.input ?? '',
          );
        if (!match?.[2] || match[3] === undefined) return ok(); // -i exits 0 even when a command fails
        keychain.set(match[2], match[3]);
        return ok();
      }
      const account = args[args.indexOf('-a') + 1] ?? '';
      if (args[0] === 'find-generic-password') {
        const token = keychain.get(account);
        return token === undefined
          ? fail(44, 'The specified item could not be found in the keychain.')
          : ok(`${token}\n`);
      }
      if (args[0] === 'delete-generic-password') {
        keychain.delete(account);
        return ok();
      }
    }
    if (['open', 'xdg-open', 'rundll32'].includes(command)) return ok();
    return Promise.resolve({
      code: null,
      stdout: '',
      stderr: '',
      failure: 'ENOENT',
    });
  };

  const io = (stdout: string[], stderr: string[]): CliIo => ({
    stdout: (text) => {
      stdout.push(text);
      printed.push(text);
    },
    stderr: (text) => {
      stderr.push(text);
      printed.push(text);
    },
    env,
    cwd,
    platform: options.platform ?? 'linux',
    homedir: root,
    hostname: 'amina-laptop.local',
    nodeVersion: '22.18.0',
    version: '0.0.0-test',
    interactive: options.interactive ?? false,
    fetch: fake.fetch,
    now: clock.now,
    sleep: clock.sleep,
    exec,
    waitForEnter: () => ({
      promise: options.pressEnter
        ? Promise.resolve()
        : new Promise<void>(() => undefined),
      cancel: () => undefined,
    }),
    onInterrupt: (listener) => {
      interruptListeners.add(listener);
      return () => {
        interruptListeners.delete(listener);
      };
    },
  });

  return {
    fake,
    clock,
    keychain,
    execCalls,
    configDir,
    cwd,
    env,
    root,
    /** Everything the CLI printed so far, in every run. */
    printed,
    interruptListeners,
    /** Ctrl-C, as the process would receive it. */
    interrupt(): void {
      for (const listener of [...interruptListeners]) listener();
    },
    async run(...argv: string[]): Promise<RunResult> {
      const out: string[] = [];
      const err: string[] = [];
      const code = await runCli(argv, io(out, err));
      const stdout = out.join('');
      const jsonLines = () =>
        stdout
          .split('\n')
          .filter((line) => line.trim() !== '')
          .map((line) => JSON.parse(line) as Record<string, unknown>);
      return {
        code,
        stdout,
        stderr: err.join(''),
        jsonLines,
        json: () => jsonLines().at(-1) ?? {},
      };
    },
    /** A token as `tassyir login` leaves it, stored in the credentials file. */
    async signIn(): Promise<string> {
      const token = fake.issueToken();
      const id = fake.tokens.at(-1)?.id ?? '';
      await new CredentialStore(io([], [])).save(fake.origin, token, {
        tokenId: id,
        userId: FAKE_USER_ID,
        email: FAKE_EMAIL,
      });
      return token;
    },
  };
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;
