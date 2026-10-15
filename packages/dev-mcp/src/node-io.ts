import { spawn } from 'node:child_process';
import { homedir, hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import type { CliIo, ExecOptions, ExecResult } from 'tassyir';

// The real process, in the shape the tassyir CLI's credential store and API
// client take. Over stdio, stdout is the MCP connection: nothing here writes
// to it (`stdout` goes to stderr), and nothing waits for a key press.

/** Runs a program without a shell, a secret only ever on its stdin (the keychain's). */
function exec(
  command: string,
  args: readonly string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: ExecResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const child = spawn(command, [...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    const timer = setTimeout(() => {
      child.kill();
      finish({ code: null, stdout, stderr, failure: 'TIMEOUT' });
    }, options.timeoutMs ?? 30_000);
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish({
        code: null,
        stdout,
        stderr,
        failure: error.code === 'ENOENT' ? 'ENOENT' : 'ERROR',
      });
    });
    child.on('close', (code) => {
      finish({ code, stdout, stderr });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(options.input ?? '');
  });
}

export function nodeIo(version: string): CliIo {
  const toStderr = (text: string) => {
    process.stderr.write(text);
  };
  return {
    stdout: toStderr,
    stderr: toStderr,
    env: process.env,
    cwd: process.cwd(),
    platform: process.platform,
    homedir: homedir(),
    hostname: hostname(),
    nodeVersion: process.versions.node,
    version,
    interactive: false,
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    sleep: (ms) => sleep(ms),
    exec,
    waitForEnter: () => ({
      promise: new Promise<void>(() => undefined),
      cancel: () => undefined,
    }),
  };
}
