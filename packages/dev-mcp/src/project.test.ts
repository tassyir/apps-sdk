import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupHarnesses,
  createHarness,
  REPO,
} from './harness.test-helpers.js';

afterEach(cleanupHarnesses);

const STARTER_MANIFEST = await readFile(
  join(
    REPO,
    'packages',
    'create-tassyir-app',
    'templates',
    'external',
    'tassyir.app.toml',
  ),
  'utf8',
);

const REAL_URL = STARTER_MANIFEST.replace(
  'https://my-tassyir-app.example.com',
  'https://review-requests.fly.dev',
);

describe('validate_manifest', () => {
  it("passes the starter's manifest, with what it asks for and the placeholder warning", async () => {
    const harness = await createHarness();
    const answer = await harness.ok('validate_manifest', {
      toml: STARTER_MANIFEST,
    });
    expect(answer).toEqual({
      valid: true,
      file: null,
      errors: [],
      errorCount: 0,
      summary: {
        name: 'My Tassyir App',
        handle: 'my-tassyir-app',
        apiVersion: '2026-10',
        hostingMode: 'external',
        url: 'https://my-tassyir-app.example.com',
        adminPage: '/',
        scopes: ['read_orders'],
        optionalScopes: [],
        webhookTopics: [
          'orders/created',
          'app/installed',
          'app/uninstalled',
          'app/scopes_updated',
          'customers/data_request',
          'customers/redact',
          'business/redact',
        ],
        allowedHosts: [],
        dataDefinitions: 1,
      },
      warnings: [expect.stringContaining('a placeholder') as unknown],
    });
    const real = await harness.ok('validate_manifest', { toml: REAL_URL });
    expect(real['warnings']).toEqual([]);
  });

  it('accepts bulk/finished, which needs no scope (AP-B1.8)', async () => {
    const harness = await createHarness();
    const answer = await harness.ok('validate_manifest', {
      toml: REAL_URL.replace(
        '"business/redact",',
        '"business/redact",\n  "bulk/finished",',
      ),
    });
    expect(answer['valid']).toBe(true);
    expect(
      (answer['summary'] as { webhookTopics: string[] }).webhookTopics.at(-1),
    ).toBe('bulk/finished');
  });

  it('answers every problem with its code, path and fix', async () => {
    const harness = await createHarness();
    const answer = await harness.ok('validate_manifest', {
      toml: REAL_URL.replace(
        'handle      = "my-tassyir-app"',
        'handle = "My App"',
      ).replace('scopes = ["read_orders"]', 'scopes = []'),
    });
    expect(answer['valid']).toBe(false);
    const errors = answer['errors'] as {
      code: string;
      path: string;
      fix: string;
    }[];
    expect(answer['errorCount']).toBe(errors.length);
    expect(errors.map((error) => [error.code, error.path])).toEqual(
      expect.arrayContaining([
        ['MANIFEST_HANDLE_INVALID', 'handle'],
        ['MANIFEST_TOPIC_SCOPE_MISSING', 'webhooks[0].topics[3]'],
      ]) as unknown,
    );
    for (const error of errors) expect(error.fix.length).toBeGreaterThan(10);
  });

  it("refuses a TOML date where the validator would read a table (the CLI's check)", async () => {
    const harness = await createHarness();
    // `admin = <date>` reads as an empty [admin] table to the validator.
    const toml = REAL_URL.replace('[admin]\n', '[unused]\n')
      .replace(
        'api_version = "2026-10"\n',
        'api_version = "2026-10"\nadmin = 2026-10-15\n',
      )
      .replace(/\[unused\]\n(#.*\n)*page = "\/"\n/, '');
    const answer = await harness.ok('validate_manifest', { toml });
    expect(answer['valid']).toBe(false);
    expect(answer['errors']).toEqual([
      expect.objectContaining({
        code: 'MANIFEST_FIELD_TYPE',
        path: 'admin',
        message: expect.stringContaining('is a date') as unknown,
      }),
    ]);
  });

  it('reports bad TOML as a problem at its line', async () => {
    const harness = await createHarness();
    const answer = await harness.ok('validate_manifest', {
      toml: 'name = "unclosed\n',
    });
    expect(answer).toMatchObject({ valid: false, errorCount: 1 });
    expect(
      (answer['errors'] as { code: string; message: string }[])[0],
    ).toMatchObject({
      code: 'MANIFEST_TOML_INVALID',
      message: expect.stringMatching(/line 1/) as unknown,
    });
  });

  it("reads ./tassyir.app.toml by default, or a path, from the server's working folder", async () => {
    const harness = await createHarness();
    const missing = await harness.refused('validate_manifest');
    expect(missing.code).toBe('MANIFEST_NOT_FOUND');
    await writeFile(join(harness.cwd, 'tassyir.app.toml'), REAL_URL);
    expect(await harness.ok('validate_manifest')).toMatchObject({
      valid: true,
      file: 'tassyir.app.toml',
    });
    await mkdir(join(harness.cwd, 'apps', 'two'), { recursive: true });
    await writeFile(
      join(harness.cwd, 'apps', 'two', 'tassyir.app.toml'),
      'name = 1\n',
    );
    const other = await harness.ok('validate_manifest', {
      path: 'apps/two/tassyir.app.toml',
    });
    expect(other).toMatchObject({
      valid: false,
      file: join('apps', 'two', 'tassyir.app.toml'),
    });
  });

  it('refuses a path that is not a .toml file, a huge file, and both arguments', async () => {
    const harness = await createHarness();
    expect(
      (await harness.refused('validate_manifest', { path: '.env' })).code,
    ).toBe('INVALID_ARGUMENT');
    await writeFile(
      join(harness.cwd, 'big.toml'),
      `# ${'x'.repeat(300 * 1024)}\n`,
    );
    expect(
      (await harness.refused('validate_manifest', { path: 'big.toml' })).code,
    ).toBe('MANIFEST_FILE_TOO_LARGE');
    expect(
      (
        await harness.refused('validate_manifest', {
          path: 'a.toml',
          toml: 'x = 1',
        })
      ).code,
    ).toBe('INVALID_ARGUMENT');
  });

  it('lists at most 20 problems and counts them all', async () => {
    const harness = await createHarness();
    const toml = [
      'name = ""',
      'handle = "X"',
      'api_version = "1999-01"',
      '[hosting]',
      'mode = "nope"',
      ...Array.from(
        { length: 30 },
        (_, index) => `unknown_${String(index)} = 1`,
      ),
    ].join('\n');
    const answer = await harness.ok('validate_manifest', { toml });
    expect((answer['errors'] as unknown[]).length).toBe(20);
    expect(answer['errorCount'] as number).toBeGreaterThan(20);
  });
});

describe('scaffold', () => {
  it('writes the starter into a new folder and answers its files and next steps', async () => {
    const harness = await createHarness();
    const answer = await harness.ok('scaffold', {
      directory: 'review-requests',
      name: 'Review Requests',
      url: 'https://review-requests.fly.dev',
    });
    const directory = join(harness.cwd, 'review-requests');
    expect(answer).toMatchObject({
      directory,
      template: 'external',
      app: {
        name: 'Review Requests',
        handle: 'review-requests',
        url: 'https://review-requests.fly.dev',
      },
    });
    const files = answer['files'] as string[];
    expect(files).toEqual(
      expect.arrayContaining([
        'AGENTS.md',
        'CLAUDE.md',
        'tassyir.app.toml',
        '.gitignore',
      ]) as unknown,
    );
    expect((await readdir(directory)).sort()).toEqual(
      [...new Set(files.map((file) => file.split('/')[0] ?? ''))].sort(),
    );
    expect(answer['next']).toContain('npm install');
    const manifest = await readFile(
      join(directory, 'tassyir.app.toml'),
      'utf8',
    );
    expect(
      await harness.ok('validate_manifest', { toml: manifest }),
    ).toMatchObject({ valid: true, warnings: [] });
  });

  it('never writes into a folder that holds files', async () => {
    const harness = await createHarness();
    await mkdir(join(harness.cwd, 'taken'));
    await writeFile(join(harness.cwd, 'taken', 'notes.md'), 'mine\n');
    const error = await harness.refused('scaffold', { directory: 'taken' });
    expect(error.code).toBe('TARGET_NOT_EMPTY');
    expect(await readdir(join(harness.cwd, 'taken'))).toEqual(['notes.md']);
  });

  it("checks the handle, name and URL with the manifest's rules before writing", async () => {
    const harness = await createHarness();
    const error = await harness.refused('scaffold', {
      directory: 'fine',
      handle: 'Not A Handle',
    });
    expect(error).toMatchObject({
      code: 'MANIFEST_HANDLE_INVALID',
      details: { path: '--handle' },
    });
    const url = await harness.refused('scaffold', {
      directory: 'fine',
      url: 'http://x.io',
    });
    expect(url.code).toBe('MANIFEST_URL_INVALID');
    expect(url['problems']).toBeDefined();
    expect(await readdir(harness.cwd)).toEqual([]);
  });

  it('refuses --url with the hosted template (it has no hosting.url)', async () => {
    const harness = await createHarness();
    const error = await harness.refused('scaffold', {
      directory: 'hosted-app',
      template: 'hosted',
      url: 'https://x.io',
    });
    expect(error.code).toBe('OPTION_NOT_FOR_TEMPLATE');
    expect(error.fix).toMatch(/external/);
  });
});
