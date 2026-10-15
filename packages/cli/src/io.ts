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
  /**
   * Start it and let it run on its own (a browser): no pipes, not waited
   * for, never keeping the CLI alive. `code` is 0 once it started.
   */
  detached?: boolean;
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
  /** Resolves after `ms`, or as soon as `signal` aborts. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  /** Runs a program without a shell. */
  exec(
    command: string,
    args: readonly string[],
    options?: ExecOptions,
  ): Promise<ExecResult>;
  /** Resolves when the person presses Enter; `cancel` stops listening. */
  waitForEnter(): { promise: Promise<void>; cancel(): void };
  /**
   * Calls `listener` on Ctrl-C (SIGINT) instead of ending the process, until
   * the returned function is called. Without it, Ctrl-C ends the process.
   */
  onInterrupt?(listener: () => void): () => void;
}
