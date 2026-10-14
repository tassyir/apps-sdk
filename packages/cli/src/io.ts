import type { FetchLike } from './api.js';

// Everything the CLI needs from the outside world. `src/cli.ts` wires the
// real process; specs pass their own (a fake API behind `fetch`, a clock that
// never sleeps, a keychain that is a Map).

export interface ExecResult {
  /** The exit code; null when the program could not start or was stopped. */
  code: number | null;
  stdout: string;
  stderr: string;
  /** `ENOENT` when the program is not installed, `TIMEOUT` when it was stopped. */
  failure?: 'ENOENT' | 'TIMEOUT' | 'ERROR';
}

export interface ExecOptions {
  /** Written to the program's stdin, then closed. Secrets travel here, never in argv. */
  input?: string;
  /** Default 30 seconds. */
  timeoutMs?: number;
}

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
  env: Readonly<Record<string, string | undefined>>;
  /** The folder relative paths are resolved from. */
  cwd: string;
  platform: NodeJS.Platform;
  homedir: string;
  hostname: string;
  /** `process.versions.node`. */
  nodeVersion: string;
  /** The CLI's own version. */
  version: string;
  /** stdin and stdout are a terminal: the CLI may offer to open a browser. */
  interactive: boolean;
  fetch: FetchLike;
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Runs a program without a shell. */
  exec(
    command: string,
    args: readonly string[],
    options?: ExecOptions,
  ): Promise<ExecResult>;
  /** Resolves when the person presses Enter; `cancel` stops listening. */
  waitForEnter(): { promise: Promise<void>; cancel(): void };
}
