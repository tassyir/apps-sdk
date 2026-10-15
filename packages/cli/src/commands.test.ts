import { chmodSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupHarnesses, createHarness } from './cli.test-helpers.js';
import type { Harness } from './cli.test-helpers.js';

afterEach(cleanupHarnesses);

const MANIFEST = `name        = "Review Requests"
handle      = "review-requests"
api_version = "2026-10"

[access]
scopes = ["read_orders"]

[access.scope_reasons]
read_orders = "Find delivered orders to ask for a review"

[hosting]
mode = "external"
url  = "https://reviews.acme-apps.dz"

[[webhooks]]
topics = ["orders/created"]
uri    = "/webhooks"
`;

async function withManifest(harness: Harness, text = MANIFEST): Promise<void> {
  await writeFile(join(harness.cwd, 'tassyir.app.toml'), text);
}

function posts(harness: Harness, path: RegExp) {
  return harness.fake.requests.filter(
    (request) => request.method === 'POST' && path.test(request.path),
  );
}

describe('tassyir app init', () => {
  it('writes the starter with create-tassyir-app, offline', async () => {
    const harness = await createHarness();
    const result = await harness.run('app', 'init', 'my-shop', '--json');
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({
      ok: true,
      template: 'external',
      app: { handle: 'my-shop', name: 'My Shop' },
      next: expect.arrayContaining([
        'tassyir app create',
        'tassyir deploy',
      ]) as string[],
    });
    const files = await readdir(join(harness.cwd, 'my-shop'));
    expect(files).toEqual(
      expect.arrayContaining(['tassyir.app.toml', 'AGENTS.md', '.env.example']),
    );
    expect(harness.fake.requests).toEqual([]);
  });

  it('prints the hosted starter’s own next steps: its checks, the app, a deploy, a dev store', async () => {
    const harness = await createHarness();
    const result = await harness.run(
      'app',
      'init',
      'my hosted',
      '--template',
      'hosted',
      '--json',
    );
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({
      ok: true,
      template: 'hosted',
      app: { handle: 'my-hosted' },
      next: [
        "cd 'my hosted'",
        'npm install',
        'npm run check',
        'tassyir app create',
        'npm run deploy',
        'tassyir store create',
      ],
    });
    const files = await readdir(join(harness.cwd, 'my hosted'));
    expect(files).toEqual(
      expect.arrayContaining(['tassyir.app.toml', 'package.json', 'src']),
    );
    // No server, .env or secret in a hosted project: none of their steps.
    expect(files).not.toContain('.env.example');
    const text = await harness.run(
      'app',
      'init',
      'other',
      '--template',
      'hosted',
    );
    expect(text.stdout).toContain(
      'Next:\n  cd other\n  npm install\n  npm run check\n  tassyir app create\n  npm run deploy\n  tassyir store create\n',
    );
    expect(text.stdout).not.toContain('npm run setup');
    expect(text.stdout).not.toContain('secrets create');
    expect(harness.fake.requests).toEqual([]);
  });

  it("passes the starter's refusals on with their code, fix and exit code", async () => {
    const harness = await createHarness();
    const reserved = await harness.run(
      'app',
      'init',
      'shop',
      '--handle',
      'tassyir',
      '--json',
    );
    expect(reserved.code).toBe(4);
    expect(reserved.json()).toMatchObject({
      error: {
        code: 'MANIFEST_HANDLE_RESERVED',
        details: { path: '--handle' },
      },
    });
    const hosted = await harness.run(
      'app',
      'init',
      'shop',
      '--template',
      'hosted',
      '--url',
      'https://x.io',
      '--json',
    );
    expect(hosted.code).toBe(1);
    expect(hosted.json()).toMatchObject({
      error: { code: 'OPTION_NOT_FOR_TEMPLATE' },
    });
    await mkdir(join(harness.cwd, 'full'));
    await writeFile(join(harness.cwd, 'full', 'x'), 'x');
    expect(
      (await harness.run('app', 'init', 'full', '--json')).json(),
    ).toMatchObject({ error: { code: 'TARGET_NOT_EMPTY' } });
  });
});

describe('tassyir app create / app list', () => {
  it("creates the app from tassyir.app.toml's handle and name", async () => {
    const harness = await createHarness();
    await harness.signIn();
    await withManifest(harness);
    const result = await harness.run('app', 'create', '--json');
    expect(result.code).toBe(0);
    const created = posts(harness, /^\/developer\/apps$/)[0];
    expect(JSON.parse(created?.body ?? '{}')).toEqual({
      handle: 'review-requests',
      nameEn: 'Review Requests',
      hostingMode: 'external',
    });
    expect(result.json()).toMatchObject({
      ok: true,
      app: { handle: 'review-requests', status: 'draft' },
    });
    const list = await harness.run('app', 'list');
    expect(list.stdout).toMatch(
      /^ID +HANDLE +NAME +STATUS +VERSION +CLIENT ID\n\d+ +review-requests +Review Requests +draft +- +app_/,
    );
  });

  it('options win over the manifest; without either it says what is missing', async () => {
    const harness = await createHarness();
    await harness.signIn();
    const missing = await harness.run('app', 'create', '--json');
    expect(missing.code).toBe(2);
    expect(missing.json()).toMatchObject({
      error: { code: 'APP_FIELDS_REQUIRED' },
    });
    const result = await harness.run(
      'app',
      'create',
      '--handle',
      'sheets-sync',
      '--name',
      'Sheets Sync',
      '--name-ar',
      'مزامنة',
      '--json',
    );
    expect(result.code).toBe(0);
    expect(
      JSON.parse(posts(harness, /^\/developer\/apps$/)[0]?.body ?? '{}'),
    ).toEqual({
      handle: 'sheets-sync',
      nameEn: 'Sheets Sync',
      nameAr: 'مزامنة',
    });
  });

  it('a hosted app needs no client secret: next is a deploy and a dev store', async () => {
    const harness = await createHarness();
    await harness.signIn();
    harness.fake.hosting = 'on';
    await withManifest(
      harness,
      MANIFEST.replace(
        'mode = "external"\nurl  = "https://reviews.acme-apps.dz"',
        'mode = "tassyir"\nallowed_hosts = []',
      ),
    );
    const result = await harness.run('app', 'create', '--json');
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({
      ok: true,
      app: { handle: 'review-requests' },
      next: ['tassyir deploy', 'tassyir store create'],
    });
    expect(
      JSON.parse(posts(harness, /^\/developer\/apps$/)[0]?.body ?? '{}'),
    ).toMatchObject({ hostingMode: 'tassyir' });
  });

  it('a hosted app is answered by the API: APP_HOSTING_NOT_AVAILABLE', async () => {
    const harness = await createHarness();
    await harness.signIn();
    await withManifest(
      harness,
      MANIFEST.replace(
        'mode = "external"\nurl  = "https://reviews.acme-apps.dz"',
        'mode = "tassyir"\nallowed_hosts = []',
      ),
    );
    const result = await harness.run('app', 'create', '--json');
    expect(result.code).toBe(1);
    expect(result.json()).toMatchObject({
      ok: false,
      error: {
        code: 'APP_HOSTING_NOT_AVAILABLE',
        status: 400,
        details: { hostingMode: 'tassyir' },
      },
    });
  });

  it("relays the API's refusals with its code, fix and subject", async () => {
    const harness = await createHarness();
    await harness.signIn();
    harness.fake.seedApp('review-requests');
    await withManifest(harness);
    const result = await harness.run('app', 'create', '--json');
    expect(result.json()).toMatchObject({
      error: {
        code: 'APP_HANDLE_TAKEN',
        fix: 'Choose another handle.',
        details: { handle: 'review-requests' },
      },
    });
    harness.fake.account = null;
    const off = await harness.run('app', 'list', '--json');
    expect(off.json()).toMatchObject({
      error: { code: 'DEVELOPER_ACCOUNT_NOT_FOUND', status: 404 },
    });
  });
});

describe('tassyir validate', () => {
  it('passes a valid manifest, with the normalised form in --json', async () => {
    const harness = await createHarness();
    await withManifest(harness);
    const result = await harness.run('validate', '--json');
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({
      ok: true,
      file: 'tassyir.app.toml',
      valid: true,
      manifest: { handle: 'review-requests', access: { optional_scopes: [] } },
      warnings: [],
    });
    expect((await harness.run('validate')).stdout).toMatch(
      /^✓ tassyir.app.toml is valid: review-requests/,
    );
  });

  it("lists every problem with the validator's codes; exit 4", async () => {
    const harness = await createHarness();
    await withManifest(
      harness,
      MANIFEST.replace(
        'handle      = "review-requests"',
        'handle = "API"',
      ).replace('read_orders = "Find', 'read_products = "Find'),
    );
    const result = await harness.run('validate', '--json');
    expect(result.code).toBe(4);
    const error = result.json()['error'] as {
      code: string;
      errors: { code: string; path: string; fix: string }[];
    };
    expect(error.code).toBe('MANIFEST_INVALID');
    expect(
      error.errors.map((problem) => `${problem.code} ${problem.path}`),
    ).toEqual(expect.arrayContaining(['MANIFEST_HANDLE_INVALID handle']));
    expect(error.errors.length).toBeGreaterThanOrEqual(2);
    for (const problem of error.errors) expect(problem.fix).not.toBe('');
    const text = await harness.run('validate');
    expect(text.stderr).toContain('- MANIFEST_HANDLE_INVALID at handle:');
  });

  it("names a TOML syntax error's line, and a missing file; exit 4", async () => {
    const harness = await createHarness();
    const missing = await harness.run('validate', '--json');
    expect(missing.code).toBe(4);
    expect(missing.json()).toMatchObject({
      error: { code: 'MANIFEST_NOT_FOUND' },
    });
    await withManifest(harness, 'name = "x"\nhandle = \n');
    const broken = await harness.run('validate', '--json');
    expect(broken.code).toBe(4);
    expect(broken.json()).toMatchObject({
      error: { code: 'MANIFEST_TOML_INVALID', details: { line: 2 } },
    });
  });

  it("refuses a TOML date the validator would read as an empty table (AP-K1.2's gap)", async () => {
    const harness = await createHarness();
    await withManifest(
      harness,
      MANIFEST.replace(
        '[access]\nscopes = ["read_orders"]\n\n[access.scope_reasons]\nread_orders = "Find delivered orders to ask for a review"\n',
        'access = 1979-05-27\n',
      ),
    );
    const result = await harness.run('validate', '--json');
    expect(result.code).toBe(4);
    expect((result.json()['error'] as { errors: unknown[] }).errors).toEqual([
      expect.objectContaining({
        code: 'MANIFEST_FIELD_TYPE',
        path: 'access',
        message:
          '`access` is a date; no field of the manifest takes a date or a time.',
      }),
    ]);
  });

  it("a date where a string goes is the validator's own error, once", async () => {
    const harness = await createHarness();
    await withManifest(
      harness,
      MANIFEST.replace('name        = "Review Requests"', 'name = 1979-05-27'),
    );
    const errors = (
      (await harness.run('validate', '--json')).json()['error'] as {
        errors: { code: string; path: string; message: string }[];
      }
    ).errors;
    expect(errors.filter((problem) => problem.path === 'name')).toEqual([
      expect.objectContaining({
        code: 'MANIFEST_FIELD_TYPE',
        message: '`name` is a date; it must be a string.',
      }),
    ]);
  });

  it("warns about the starter's placeholder URL", async () => {
    const harness = await createHarness();
    await withManifest(
      harness,
      MANIFEST.replace(
        'https://reviews.acme-apps.dz',
        'https://review-requests.example.com',
      ),
    );
    const result = await harness.run('validate', '--json');
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({
      warnings: [expect.stringContaining('placeholder') as string],
    });
  });
});

describe('tassyir deploy', () => {
  it('uploads the parsed manifest as a new version', async () => {
    const harness = await createHarness();
    await harness.signIn();
    const app = harness.fake.seedApp();
    await withManifest(harness);
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({
      ok: true,
      app: { id: app.id, handle: 'review-requests' },
      unchanged: false,
      version: { version: 1, current: true, webhookTopics: ['orders/created'] },
    });
    const upload = posts(harness, /\/versions$/)[0];
    expect(upload?.path).toBe(`/developer/apps/${app.id}/versions`);
    expect(JSON.parse(upload?.body ?? '{}')).toMatchObject({
      manifest: {
        handle: 'review-requests',
        hosting: { mode: 'external', url: 'https://reviews.acme-apps.dz' },
      },
    });
  });

  it('the same manifest twice is `unchanged`, exit 0', async () => {
    const harness = await createHarness();
    await harness.signIn();
    harness.fake.seedApp();
    await withManifest(harness);
    await harness.run('deploy');
    const again = await harness.run('deploy', '--json');
    expect(again.code).toBe(0);
    expect(again.json()).toMatchObject({
      ok: true,
      unchanged: true,
      version: { version: 1 },
    });
    expect((await harness.run('deploy')).stdout).toContain('Nothing to deploy');
  });

  it('never uploads a manifest that does not pass (exit 4, nothing sent)', async () => {
    const harness = await createHarness();
    await harness.signIn();
    harness.fake.seedApp();
    await withManifest(
      harness,
      MANIFEST.replace(
        'scopes = ["read_orders"]',
        'scopes = ["read_everything"]',
      ),
    );
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(4);
    expect(result.json()).toMatchObject({
      error: { code: 'MANIFEST_INVALID' },
    });
    expect(harness.fake.requests).toEqual([]);
  });

  it('a hosted manifest is built first: without its Worker, nothing is sent (deploy-hosted.test.ts has the rest)', async () => {
    const harness = await createHarness();
    await harness.signIn();
    harness.fake.seedApp();
    await withManifest(
      harness,
      MANIFEST.replace(
        'mode = "external"\nurl  = "https://reviews.acme-apps.dz"',
        'mode = "tassyir"\nallowed_hosts = []',
      ),
    );
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(4);
    expect(result.json()).toMatchObject({
      error: { code: 'BUNDLE_ENTRY_NOT_FOUND' },
    });
    expect(posts(harness, /\/versions$/)).toHaveLength(0);
  });

  it('an app that does not exist yet: APP_NOT_FOUND with the way to create it', async () => {
    const harness = await createHarness();
    await harness.signIn();
    await withManifest(harness);
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(1);
    expect(result.json()).toMatchObject({
      error: {
        code: 'APP_NOT_FOUND',
        fix: expect.stringContaining('tassyir app create') as string,
      },
    });
  });

  it("the API's own manifest refusal keeps its errors list (exit 4)", async () => {
    const harness = await createHarness();
    await harness.signIn();
    const app = harness.fake.seedApp('other-app');
    await withManifest(harness);
    const result = await harness.run('deploy', '--app', app.id, '--json');
    expect(result.code).toBe(4);
    expect(result.json()).toMatchObject({
      error: {
        code: 'APP_MANIFEST_HANDLE_MISMATCH',
        details: { appHandle: 'other-app', manifestHandle: 'review-requests' },
      },
    });
  });
});

describe('tassyir secrets', () => {
  async function ready() {
    const harness = await createHarness();
    await harness.signIn();
    const app = harness.fake.seedApp();
    await withManifest(harness);
    return { harness, app };
  }

  it('create prints the secret once, and refuses a second create', async () => {
    const { harness, app } = await ready();
    const result = await harness.run('secrets', 'create');
    expect(result.code).toBe(0);
    const secret = harness.fake.secrets[0] ?? '';
    expect(result.stdout).toContain(`TASSYIR_CLIENT_SECRET=${secret}`);
    expect(result.stdout).toContain(`TASSYIR_CLIENT_ID=${app.clientId}`);
    expect(result.stdout).toContain(`TASSYIR_APP_ID=${app.id}`);
    expect(result.stdout).toContain('shown this once');
    const again = await harness.run('secrets', 'create', '--json');
    expect(again.code).toBe(1);
    expect(again.json()).toMatchObject({
      error: {
        code: 'APP_SECRET_EXISTS',
        fix: expect.stringContaining('secrets rotate') as string,
      },
    });
    expect(harness.fake.secrets).toHaveLength(1);
    expect(await readdir(harness.cwd)).toEqual(['tassyir.app.toml']);
  });

  it('rotate mints another; the old one is expiring', async () => {
    const { harness } = await ready();
    await harness.run('secrets', 'create');
    const result = await harness.run('secrets', 'rotate', '--json');
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({
      ok: true,
      secret: harness.fake.secrets[1],
      rotated: [{ state: 'expiring', expiresAt: expect.any(String) as string }],
    });
    const list = await harness.run('secrets', 'list', '--json');
    expect((list.json()['credentials'] as unknown[]).length).toBe(2);
    expect(list.stdout).not.toContain(harness.fake.secrets[0] ?? 'none');
  });

  it('--write-env writes the three values to .env (0600) and does not print the secret', async () => {
    const { harness, app } = await ready();
    const result = await harness.run(
      'secrets',
      'create',
      '--write-env',
      '--json',
    );
    expect(result.code).toBe(0);
    const secret = harness.fake.secrets[0] ?? '';
    expect(result.stdout).not.toContain(secret);
    expect(result.json()).toMatchObject({
      written: {
        keys: ['TASSYIR_CLIENT_ID', 'TASSYIR_CLIENT_SECRET', 'TASSYIR_APP_ID'],
        created: true,
      },
    });
    expect(result.json()['secret']).toBeUndefined();
    const env = join(harness.cwd, '.env');
    expect(await readFile(env, 'utf8')).toBe(
      `TASSYIR_CLIENT_ID=${app.clientId}\nTASSYIR_CLIENT_SECRET=${secret}\nTASSYIR_APP_ID=${app.id}\n`,
    );
    expect((await stat(env)).mode & 0o777).toBe(0o600);
  });

  it("--write-env fills the starter's placeholders and keeps every other line", async () => {
    const { harness, app } = await ready();
    const env = join(harness.cwd, '.env');
    await writeFile(
      env,
      '# from .env.example\nTASSYIR_CLIENT_ID=app_your-client-id\nTASSYIR_CLIENT_SECRET=tsy_cs_your-client-secret\nTASSYIR_APP_ID=your-app-id\nTOKEN_STORE_KEY=abc=\n# PORT=3000\n',
    );
    const result = await harness.run(
      'secrets',
      'create',
      '--write-env',
      '--json',
    );
    expect(result.code).toBe(0);
    expect(await readFile(env, 'utf8')).toBe(
      `# from .env.example\nTASSYIR_CLIENT_ID=${app.clientId}\nTASSYIR_CLIENT_SECRET=${harness.fake.secrets[0] ?? ''}\nTASSYIR_APP_ID=${app.id}\nTOKEN_STORE_KEY=abc=\n# PORT=3000\n`,
    );
  });

  it('never replaces a real value silently: refused BEFORE minting, unless --force', async () => {
    const { harness } = await ready();
    const env = join(harness.cwd, '.env');
    await writeFile(env, 'TASSYIR_CLIENT_SECRET=tsy_cs_theOneTheServerUses\n');
    const refused = await harness.run(
      'secrets',
      'create',
      '--write-env',
      '--json',
    );
    expect(refused.code).toBe(2);
    expect(refused.json()).toMatchObject({
      error: {
        code: 'ENV_VALUE_EXISTS',
        details: { keys: ['TASSYIR_CLIENT_SECRET'] },
      },
    });
    expect(JSON.stringify(refused.json())).not.toContain('theOneTheServerUses');
    expect(harness.fake.secrets).toEqual([]);
    expect(posts(harness, /\/credentials$/)).toEqual([]);
    expect(await readFile(env, 'utf8')).toBe(
      'TASSYIR_CLIENT_SECRET=tsy_cs_theOneTheServerUses\n',
    );

    const forced = await harness.run(
      'secrets',
      'create',
      '--env-file',
      '.env',
      '--force',
      '--json',
    );
    expect(forced.code).toBe(0);
    expect(forced.json()).toMatchObject({
      written: { replaced: ['TASSYIR_CLIENT_SECRET'] },
    });
    expect(await readFile(env, 'utf8')).toContain(
      `TASSYIR_CLIENT_SECRET=${harness.fake.secrets[0] ?? ''}`,
    );
  });

  it("--write-env waits for the starter's `npm run setup` (no .env yet, .env.example here)", async () => {
    const { harness } = await ready();
    await writeFile(
      join(harness.cwd, '.env.example'),
      'TASSYIR_CLIENT_ID=app_your-client-id\n',
    );
    const result = await harness.run(
      'secrets',
      'create',
      '--write-env',
      '--json',
    );
    expect(result.code).toBe(2);
    expect(result.json()).toMatchObject({
      error: {
        code: 'ENV_FILE_MISSING',
        fix: expect.stringContaining('npm run setup') as string,
      },
    });
    expect(harness.fake.secrets).toEqual([]);
  });

  it('a write that fails after minting still shows the secret, once (text and --json)', async () => {
    for (const json of [false, true]) {
      const { harness, app } = await ready();
      harness.fake.onMint = () => {
        chmodSync(harness.cwd, 0o500);
      };
      try {
        const result = await harness.run(
          'secrets',
          'create',
          '--write-env',
          ...(json ? ['--json'] : []),
        );
        expect(result.code).toBe(1);
        const secret = harness.fake.secrets[0] ?? 'none';
        if (json) {
          expect(result.json()).toMatchObject({
            ok: false,
            error: {
              code: 'ENV_FILE_UNWRITABLE',
              reveal: {
                TASSYIR_CLIENT_ID: app.clientId,
                TASSYIR_CLIENT_SECRET: secret,
                TASSYIR_APP_ID: app.id,
              },
            },
          });
        } else {
          expect(result.stderr).toContain(
            'the secret was minted, so here it is, once',
          );
          expect(result.stderr).toContain(
            `  TASSYIR_CLIENT_SECRET=${secret}\n`,
          );
        }
      } finally {
        chmodSync(harness.cwd, 0o755);
      }
    }
  });

  it('--write-env refuses a folder that does not exist, or a key set twice, before minting', async () => {
    const { harness } = await ready();
    const missing = await harness.run(
      'secrets',
      'create',
      '--env-file',
      'config/.env',
      '--json',
    );
    expect(missing.code).toBe(2);
    expect(missing.json()).toMatchObject({
      error: { code: 'ENV_FILE_UNWRITABLE' },
    });
    // The later, empty line shadows the real value; it is still a real value.
    await writeFile(
      join(harness.cwd, '.env'),
      'TASSYIR_CLIENT_SECRET=tsy_cs_theOneTheServerUses\nTASSYIR_CLIENT_SECRET=\n',
    );
    const twice = await harness.run(
      'secrets',
      'create',
      '--write-env',
      '--json',
    );
    expect(twice.code).toBe(2);
    expect(twice.json()).toMatchObject({ error: { code: 'ENV_VALUE_EXISTS' } });
    expect(harness.fake.secrets).toEqual([]);
  });

  it('finds an app by id or by handle, an all-digit handle included', async () => {
    const harness = await createHarness();
    await harness.signIn();
    const numeric = harness.fake.seedApp('2048');
    const other = harness.fake.seedApp('sheets-sync');
    expect(
      (await harness.run('secrets', 'list', '--app', '2048', '--json')).json(),
    ).toMatchObject({ app: { id: numeric.id } });
    expect(
      (
        await harness.run('secrets', 'list', '--app', other.id, '--json')
      ).json(),
    ).toMatchObject({ app: { handle: 'sheets-sync' } });
  });

  it('revoke takes a credential id; list never shows a secret', async () => {
    const { harness } = await ready();
    const created = await harness.run('secrets', 'create', '--json');
    const id = (created.json()['credential'] as { id: string }).id;
    const result = await harness.run('secrets', 'revoke', id, '--json');
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({
      credential: { id, state: 'revoked' },
    });
    expect(
      (await harness.run('secrets', 'revoke', '999', '--json')).json(),
    ).toMatchObject({ error: { code: 'APP_CREDENTIAL_NOT_FOUND' } });
    expect((await harness.run('secrets', 'revoke', '--json')).code).toBe(2);
  });

  it('needs an app: --app, or a manifest here', async () => {
    const harness = await createHarness();
    await harness.signIn();
    const result = await harness.run('secrets', 'list', '--json');
    expect(result.code).toBe(2);
    expect(result.json()).toMatchObject({ error: { code: 'APP_REQUIRED' } });
    const app = harness.fake.seedApp('sheets-sync');
    expect(
      (await harness.run('secrets', 'list', '--app', 'sheets-sync', '--json'))
        .code,
    ).toBe(0);
    expect(
      (await harness.run('secrets', 'list', '--app', app.id, '--json')).code,
    ).toBe(0);
    expect(
      (await harness.run('secrets', 'list', '--app', 'nope', '--json')).json(),
    ).toMatchObject({ error: { code: 'APP_NOT_FOUND' } });
  });
});

describe('tassyir store', () => {
  it('create seeds a dev store; --empty does not; list shows them', async () => {
    const harness = await createHarness();
    await harness.signIn();
    const seeded = await harness.run(
      'store',
      'create',
      '--name',
      'My test shop',
      '--json',
    );
    expect(seeded.json()).toMatchObject({
      ok: true,
      store: { name: 'My test shop', seed: { products: 30, orders: 180 } },
    });
    const empty = await harness.run('store', 'create', '--empty', '--json');
    expect(empty.json()).toMatchObject({ ok: true, store: { seed: null } });
    expect(JSON.parse(posts(harness, /dev-stores$/)[1]?.body ?? '{}')).toEqual({
      seed: false,
    });
    const list = await harness.run('store', 'list');
    expect(list.stdout).toContain('My test shop');
    expect(list.stdout).toContain('https://app.tassyir.io/en/dashboard/');
  });

  it('relays the cap of 3; refuses a bad name before calling', async () => {
    const harness = await createHarness();
    await harness.signIn();
    for (let index = 0; index < 3; index += 1)
      await harness.run('store', 'create');
    expect(
      (await harness.run('store', 'create', '--json')).json(),
    ).toMatchObject({
      error: { code: 'DEV_STORE_LIMIT_REACHED', details: { limit: 3 } },
    });
    expect(
      (await harness.run('store', 'create', '--name', 'x'.repeat(61))).code,
    ).toBe(2);
  });
});

describe('tassyir webhook', () => {
  async function ready() {
    const harness = await createHarness();
    await harness.signIn();
    const app = harness.fake.seedApp();
    await withManifest(harness);
    return { harness, app };
  }

  it('trigger sends a test event to the only active installation', async () => {
    const { harness, app } = await ready();
    const result = await harness.run(
      'webhook',
      'trigger',
      'orders/created',
      '--json',
    );
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({
      ok: true,
      delivery: {
        status: 'delivered',
        statusCode: 200,
        installationId: '5001',
      },
    });
    const sent = posts(harness, /webhooks\/test$/)[0];
    expect(sent?.path).toBe(
      `/developer/apps/${app.id}/installations/5001/webhooks/test`,
    );
    expect(JSON.parse(sent?.body ?? '{}')).toEqual({ topic: 'orders/created' });
  });

  it('trigger: exit 1 with a fix when the endpoint did not answer 2xx', async () => {
    const { harness } = await ready();
    harness.fake.testResult = {
      status: 'failed',
      statusCode: null,
      error: 'TIMEOUT',
      errorClass: 'timeout',
    };
    const result = await harness.run(
      'webhook',
      'trigger',
      'orders/created',
      '--installation',
      '5001',
      '--json',
    );
    expect(result.code).toBe(1);
    expect(result.json()).toMatchObject({
      error: {
        code: 'WEBHOOK_ENDPOINT_FAILED',
        fix: expect.stringContaining('10 seconds') as string,
        details: { delivery: { error: 'TIMEOUT' } },
      },
    });
  });

  it('trigger refuses an unknown topic, and asks which installation when there are several', async () => {
    const { harness, app } = await ready();
    expect(
      (await harness.run('webhook', 'trigger', 'orders/exploded', '--json'))
        .code,
    ).toBe(2);
    const installations = harness.fake.installations.get(app.id) ?? [];
    const first = installations[0];
    if (first) installations.push({ ...first, id: '5002', businessId: '6002' });
    const result = await harness.run(
      'webhook',
      'trigger',
      'orders/created',
      '--json',
    );
    expect(result.code).toBe(2);
    expect(result.json()).toMatchObject({
      error: {
        code: 'INSTALLATION_REQUIRED',
        details: { installations: ['5001', '5002'] },
      },
    });
  });

  it('deliveries passes the filters as the API names them and prints nextCursor', async () => {
    const { harness, app } = await ready();
    const result = await harness.run(
      'webhook',
      'deliveries',
      '--status',
      'failed',
      '--topic',
      'orders/created',
      '--installation',
      '5001',
      '--since',
      '2026-10-01T00:00:00Z',
      '--limit',
      '10',
      '--json',
    );
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({
      deliveries: [{ id: '8001', status: 'failed' }],
      nextCursor: 'eyJ2IjoxfQ',
    });
    const query = harness.fake.requests.find(
      (request) =>
        request.path === `/developer/apps/${app.id}/webhooks/deliveries`,
    )?.query;
    expect(Object.fromEntries(query ?? [])).toEqual({
      installationId: '5001',
      topic: 'orders/created',
      status: 'failed',
      since: '2026-10-01T00:00:00Z',
      limit: '10',
    });
    const text = await harness.run('webhook', 'deliveries');
    expect(text.stdout).toContain('More: --cursor eyJ2IjoxfQ');
    for (const bad of [
      ['--status', 'lost'],
      ['--limit', '500'],
      ['--since', 'yesterday'],
    ]) {
      expect((await harness.run('webhook', 'deliveries', ...bad)).code).toBe(2);
    }
  });

  it('replay: delivered is exit 0; failed and skipped are exit 1 with why', async () => {
    const { harness } = await ready();
    const delivered = await harness.run('webhook', 'replay', '8001', '--json');
    expect(delivered.json()).toMatchObject({
      ok: true,
      outcome: 'delivered',
      delivery: { status: 'delivered' },
    });
    harness.fake.replayOutcome = 'skipped';
    const skipped = await harness.run('webhook', 'replay', '8001', '--json');
    expect(skipped.code).toBe(1);
    expect(skipped.json()).toMatchObject({
      error: { code: 'WEBHOOK_REPLAY_SKIPPED' },
    });
    expect(
      (await harness.run('webhook', 'replay', '404', '--json')).json(),
    ).toMatchObject({ error: { code: 'WEBHOOK_DELIVERY_NOT_FOUND' } });
  });
});

describe('the commands that wait for the platform', () => {
  it('dev prints the checklist, filled from the manifest, offline', async () => {
    const harness = await createHarness();
    await withManifest(
      harness,
      MANIFEST.replace(
        'https://reviews.acme-apps.dz',
        'https://review-requests.example.com',
      ),
    );
    const result = await harness.run('dev', '--json');
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({
      ok: true,
      available: 'checklist',
      handle: 'review-requests',
      hostingUrl: 'https://review-requests.example.com',
    });
    const steps = result.json()['steps'] as {
      title: string;
      command?: string;
      note?: string;
    }[];
    expect(steps.map((step) => step.command).filter(Boolean)).toEqual([
      'npm run dev',
      'cloudflared tunnel --url http://localhost:3000',
      'tassyir deploy',
      'tassyir store create',
      'tassyir webhook trigger orders/created',
    ]);
    expect(steps[2]?.note).toContain('placeholder');
    expect(harness.fake.requests).toEqual([]);
  });

  it('logs and submit answer COMMAND_NOT_AVAILABLE with a fix', async () => {
    const harness = await createHarness();
    for (const command of [['logs', '--tail'], ['submit']]) {
      const result = await harness.run(...command, '--json');
      expect(result.code).toBe(1);
      expect(result.json()).toMatchObject({
        error: {
          code: 'COMMAND_NOT_AVAILABLE',
          fix: expect.any(String) as string,
        },
      });
    }
  });
});

describe('the command line', () => {
  it('--help lists every command; --json --help is the catalogue as data', async () => {
    const harness = await createHarness();
    const help = await harness.run('--help');
    expect(help.code).toBe(0);
    for (const name of [
      'login',
      'logout',
      'whoami',
      'app init',
      'app create',
      'app list',
      'validate',
      'deploy',
      'secrets create',
      'secrets rotate',
      'secrets revoke',
      'store create',
      'store list',
      'webhook trigger',
      'webhook deliveries',
      'webhook replay',
      'dev',
    ]) {
      expect(help.stdout).toContain(`  ${name} `);
    }
    expect(help.stdout).toMatch(/logs +.+\(not available yet\)/);
    expect(help.stdout).toContain(
      'Exit codes: 0 done, 1 failed, 2 usage, 3 sign in again, 4 manifest or bundle invalid, 5 try again later.',
    );
    const catalogue = (await harness.run('--help', '--json')).json();
    expect(catalogue).toMatchObject({
      ok: true,
      exitCodes: { OK: 0, AUTH: 3, MANIFEST: 4, TRY_LATER: 5 },
    });
    expect((catalogue['commands'] as unknown[]).length).toBe(21);
    expect((await harness.run('deploy', '--help')).stdout).toMatch(
      /^Usage: tassyir deploy \[options\]/,
    );
    expect((await harness.run('app', '--help')).stdout).toContain('app create');
  });

  it('--version, unknown commands and options, wrong arguments', async () => {
    const harness = await createHarness();
    expect((await harness.run('--version')).stdout).toBe('0.0.0-test\n');
    expect((await harness.run('-v', '--json')).json()).toEqual({
      ok: true,
      version: '0.0.0-test',
    });
    const unknown = await harness.run('deploi', '--json');
    expect(unknown.code).toBe(2);
    expect(unknown.json()).toMatchObject({
      error: { code: 'UNKNOWN_COMMAND' },
    });
    expect(
      (await harness.run('app', 'destroy', '--json')).json(),
    ).toMatchObject({
      error: {
        code: 'UNKNOWN_COMMAND',
        fix: expect.stringContaining('tassyir app create') as string,
      },
    });
    expect(
      (await harness.run('whoami', '--colour', '--json')).json(),
    ).toMatchObject({ error: { code: 'INVALID_ARGUMENT' } });
    expect((await harness.run('whoami', 'extra')).code).toBe(2);
    expect((await harness.run('--json', 'app', 'list')).code).toBe(3);
  });

  it('API origins: https, or http on this machine only', async () => {
    const harness = await createHarness();
    await harness.signIn();
    for (const origin of [
      'http://api.tassyir.io',
      'https://api.tassyir.io/v1',
      'ftp://x',
      'nonsense',
      'https://user:pw@api.tassyir.io',
      // macOS asks the DNS server about *.localhost: not this machine.
      'http://api.localhost:3000',
      "https://a'b.tassyir.io",
    ]) {
      const result = await harness.run(
        'whoami',
        '--api-origin',
        origin,
        '--json',
      );
      expect(result.code).toBe(2);
      expect(result.json()).toMatchObject({
        error: { code: 'API_ORIGIN_INVALID' },
      });
    }
    expect(
      (
        await harness.run(
          'whoami',
          '--api-origin',
          'http://localhost:3000',
          '--json',
        )
      ).json(),
    ).toMatchObject({
      error: { code: 'NOT_LOGGED_IN' },
    });
  });

  it('refuses an old Node', async () => {
    const harness = await createHarness();
    const { runCli } = await import('./run.js');
    const out: string[] = [];
    const code = await runCli(['whoami', '--json'], {
      stdout: (text) => out.push(text),
      stderr: () => undefined,
      env: harness.env,
      cwd: harness.cwd,
      platform: 'linux',
      homedir: harness.root,
      hostname: 'x',
      nodeVersion: '20.19.5',
      version: '0.0.0-test',
      interactive: false,
      fetch: harness.fake.fetch,
      now: () => 0,
      sleep: () => Promise.resolve(),
      exec: () => Promise.resolve({ code: 0, stdout: '', stderr: '' }),
      waitForEnter: () => ({
        promise: Promise.resolve(),
        cancel: () => undefined,
      }),
    });
    expect(code).toBe(1);
    expect(out.join('')).toContain('NODE_VERSION_UNSUPPORTED');
  });
});
