#!/usr/bin/env node
// The `tassyir` command: the real process behind src/run.ts.
import { spawn } from 'node:child_process';
import { homedir, hostname } from 'node:os';
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';
import packageJson from '../package.json' with { type: 'json' };
import type { ExecOptions, ExecResult } from './io.js';
import { runCli } from './run.js';

function exec(
  command: string,
  args: readonly string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  if (options.detached) {
    return new Promise((resolve) => {
      const child = spawn(command, [...args], {
        stdio: 'ignore',
        detached: true,
        windowsHide: true,
        shell: false,
      });
      child.once('spawn', () => {
        child.unref();
        resolve({ code: 0, stdout: '', stderr: '' });
      });
      child.once('error', (error: NodeJS.ErrnoException) => {
        resolve({
          code: null,
          stdout: '',
          stderr: '',
          failure: error.code === 'ENOENT' ? 'ENOENT' : 'ERROR',
        });
      });
    });
  }
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

function waitForEnter(): { promise: Promise<void>; cancel(): void } {
  const reader = createInterface({ input: process.stdin, terminal: false });
  const stop = () => {
    reader.close();
    process.stdin.pause();
  };
  const promise = new Promise<void>((resolve) => {
    reader.once('line', () => {
      stop();
      resolve();
    });
  });
  return { promise, cancel: stop };
}

process.exitCode = await runCli(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
  cwd: process.cwd(),
  platform: process.platform,
  homedir: homedir(),
  hostname: hostname(),
  nodeVersion: process.versions.node,
  version: packageJson.version,
  interactive: process.stdin.isTTY && process.stdout.isTTY,
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
  sleep: (ms, signal) =>
    sleep(ms, undefined, signal ? { signal } : {}).catch(() => undefined),
  exec,
  waitForEnter,
  onInterrupt: (listener) => {
    process.on('SIGINT', listener);
    return () => {
      process.off('SIGINT', listener);
    };
  },
});
