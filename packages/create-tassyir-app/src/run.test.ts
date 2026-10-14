import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from './run.js';
import type { CliIo } from './run.js';

let scratch: string;
beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'create-tassyir-app-cli-'));
});
afterEach(() => rm(scratch, { recursive: true, force: true }));

function io(overrides: Partial<CliIo> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const value: CliIo = {
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    cwd: scratch,
    nodeVersion: '22.18.0',
    prompt: undefined,
    install: () => Promise.resolve({ ok: true, output: '' }),
    version: '0.0.0-test',
    ...overrides,
  };
  return { io: value, out, err };
}

describe('create-tassyir-app', () => {
  it('--json prints one document: what it made and what to do next', async () => {
    const { io: cli, out, err } = io();
    expect(await runCli(['shop', '--json', '--handle', 'my-shop'], cli)).toBe(
      0,
    );
    expect(err).toEqual([]);
    const result = JSON.parse(out.join('')) as Record<string, unknown>;
    expect(result).toMatchObject({
      ok: true,
      template: 'external',
      app: { handle: 'my-shop', name: 'My Shop' },
      installed: false,
      next: [
        'cd shop',
        'npm install',
        'npm run setup',
        expect.stringContaining('README.md') as string,
      ],
    });
    expect(result['files']).toEqual(
      expect.arrayContaining(['tassyir.app.toml', 'AGENTS.md']),
    );
  });

  it('--json prints a refusal as { ok: false, error: { code, path, message, fix } }', async () => {
    const { io: cli, out, err } = io();
    expect(await runCli(['shop', '--json', '--handle', 'API'], cli)).toBe(1);
    expect(err).toEqual([]);
    expect(JSON.parse(out.join(''))).toMatchObject({
      ok: false,
      error: {
        code: 'MANIFEST_HANDLE_INVALID',
        path: '--handle',
        fix: expect.any(String) as string,
      },
    });
    expect(await readdir(scratch)).toEqual([]);
  });

  it('prints a refusal and its fix on stderr', async () => {
    const { io: cli, out, err } = io();
    expect(await runCli(['shop', '--template', 'hosted'], cli)).toBe(1);
    expect(out).toEqual([]);
    expect(err.join('')).toMatch(
      /^✗ TEMPLATE_NOT_AVAILABLE \(--template\): .+\n {2}Fix: Use --template external/,
    );
  });

  it('refuses unknown options, extra folders and an old Node', async () => {
    expect(JSON.parse(await jsonOf(['--json', '--colour']))).toMatchObject({
      error: { code: 'INVALID_ARGUMENT' },
    });
    expect(JSON.parse(await jsonOf(['--json', 'a', 'b']))).toMatchObject({
      error: { code: 'INVALID_ARGUMENT' },
    });
    expect(
      JSON.parse(await jsonOf(['--json'], { nodeVersion: '22.17.1' })),
    ).toMatchObject({
      error: {
        code: 'NODE_VERSION_UNSUPPORTED',
        fix: expect.stringContaining('22.18') as string,
      },
    });
  });

  it('asks for the folder only in a terminal, never with --json or --yes', async () => {
    const prompt = vi.fn(() => Promise.resolve('asked'));
    expect(await runCli([], io({ prompt }).io)).toBe(0);
    expect(prompt).toHaveBeenCalledWith('Project folder', 'my-tassyir-app');
    expect(await readdir(scratch)).toEqual(['asked']);

    prompt.mockClear();
    expect(await runCli(['--yes'], io({ prompt }).io)).toBe(0);
    expect(await runCli(['other', '--json'], io({ prompt }).io)).toBe(0);
    expect(prompt).not.toHaveBeenCalled();
    expect((await readdir(scratch)).sort()).toEqual([
      'asked',
      'my-tassyir-app',
      'other',
    ]);
  });

  it('--install runs npm install in the new folder, and says when it failed', async () => {
    const install = vi.fn(() => Promise.resolve({ ok: true, output: '' }));
    const { io: cli, out } = io({ install });
    expect(await runCli(['one', '--install', '--json'], cli)).toBe(0);
    expect(install).toHaveBeenCalledWith(join(scratch, 'one'), true);
    expect(JSON.parse(out.join(''))).toMatchObject({
      installed: true,
      next: ['cd one', 'npm run setup', expect.any(String) as string],
    });

    const failing = io({
      install: () => Promise.resolve({ ok: false, output: 'E404' }),
    });
    expect(await runCli(['two', '--install', '--json'], failing.io)).toBe(1);
    expect(JSON.parse(failing.out.join(''))).toMatchObject({
      error: { code: 'INSTALL_FAILED' },
    });
  });

  it('quotes a folder with spaces in the next steps', async () => {
    const { io: cli, out } = io();
    expect(await runCli(["Ali's Shop", '--json'], cli)).toBe(0);
    expect(JSON.parse(out.join(''))).toMatchObject({
      app: { handle: 'ali-s-shop' },
      next: [
        `cd 'Ali'\\''s Shop'`,
        'npm install',
        'npm run setup',
        expect.any(String) as string,
      ],
    });
  });

  it('prints its help and version', async () => {
    const help = io();
    expect(await runCli(['--help'], help.io)).toBe(0);
    expect(help.out.join('')).toContain('--template <name>');
    const version = io();
    expect(await runCli(['-v'], version.io)).toBe(0);
    expect(version.out).toEqual(['0.0.0-test\n']);
  });
});

async function jsonOf(
  argv: string[],
  overrides: Partial<CliIo> = {},
): Promise<string> {
  const { io: cli, out } = io(overrides);
  await runCli(argv, cli);
  return out.join('');
}
