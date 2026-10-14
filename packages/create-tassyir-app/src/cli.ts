#!/usr/bin/env node
// The `create-tassyir-app` command (npm create tassyir-app@latest).
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import packageJson from '../package.json' with { type: 'json' };
import { runCli } from './run.js';

const interactive = process.stdin.isTTY && process.stdout.isTTY;

process.exitCode = await runCli(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  cwd: process.cwd(),
  nodeVersion: process.versions.node,
  version: packageJson.version,
  prompt: interactive
    ? async (question, answer) => {
        const readline = createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        try {
          return await readline.question(`${question} (${answer}): `);
        } finally {
          readline.close();
        }
      }
    : undefined,
  install: (directory, quiet) =>
    new Promise((resolve) => {
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const child = spawn(npm, ['install'], {
        cwd: directory,
        stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
        shell: process.platform === 'win32',
      });
      let output = '';
      child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
      child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
      child.on('error', (error) => {
        resolve({ ok: false, output: error.message });
      });
      child.on('close', (code) => {
        resolve({ ok: code === 0, output });
      });
    }),
});
