import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupHarnesses, createHarness } from './cli.test-helpers.js';
import { FAKE_EMAIL } from './fake-api.test-helpers.js';

afterEach(cleanupHarnesses);

describe('tassyir logout', () => {
  it('revokes the token on Tassyir, then forgets it', async () => {
    const harness = await createHarness();
    const token = await harness.signIn();
    const result = await harness.run('logout', '--json');
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({
      ok: true,
      revoked: true,
      outcome: 'revoked',
      removed: true,
    });
    expect(harness.fake.liveTokens()).not.toContain(token);
    const revoke = harness.fake.requests.find(
      (request) => request.path === '/developer/cli/tokens/current',
    );
    expect(revoke?.method).toBe('DELETE');
    expect((await harness.run('whoami', '--json')).code).toBe(3);
  });

  it('is a no-op when not signed in', async () => {
    const harness = await createHarness();
    const result = await harness.run('logout', '--json');
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({
      ok: true,
      revoked: false,
      removed: false,
    });
  });

  it('forgets a token the API already refuses', async () => {
    const harness = await createHarness();
    const token = await harness.signIn();
    const row = harness.fake.tokens.find(
      (candidate) => candidate.token === token,
    );
    if (row) row.revoked = true;
    const result = await harness.run('logout', '--json');
    expect(result.json()).toMatchObject({
      ok: true,
      revoked: false,
      outcome: 'invalid',
      removed: true,
    });
  });

  it('keeps the token when the API cannot be reached, unless --local', async () => {
    const harness = await createHarness();
    await harness.signIn();
    harness.env['TASSYIR_API_ORIGIN'] = 'https://api.tassyir.test';
    const offline = harness.fake.fetch;
    Object.defineProperty(harness.fake, 'fetch', {
      value: () =>
        Promise.reject(
          new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }),
        ),
    });
    const refused = await harness.run('logout', '--json');
    expect(refused.code).toBe(5);
    expect(refused.json()).toMatchObject({
      ok: false,
      error: { code: 'NETWORK_ERROR' },
    });
    expect(JSON.stringify(refused.json())).toContain('still stored');
    const local = await harness.run('logout', '--local', '--json');
    expect(local.code).toBe(0);
    expect(local.json()).toMatchObject({
      ok: true,
      revoked: false,
      outcome: 'kept',
      removed: true,
    });
    Object.defineProperty(harness.fake, 'fetch', { value: offline });
    expect((await harness.run('whoami')).code).toBe(3);
  });

  it('refuses while TASSYIR_TOKEN is set, and revokes nothing', async () => {
    const harness = await createHarness();
    const ci = harness.fake.issueToken();
    harness.env['TASSYIR_TOKEN'] = ci;
    const result = await harness.run('logout', '--json');
    expect(result.code).toBe(2);
    expect(result.json()).toMatchObject({ error: { code: 'TOKEN_FROM_ENV' } });
    expect(harness.fake.liveTokens()).toContain(ci);
  });
});

describe('tassyir whoami', () => {
  it("says who, from where, and the token's state", async () => {
    const harness = await createHarness();
    await harness.signIn();
    const result = await harness.run('whoami', '--json');
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({
      ok: true,
      apiOrigin: harness.fake.origin,
      email: FAKE_EMAIL,
      storage: 'file',
      token: {
        deviceName: 'test-machine',
        expiresAt: '2027-01-12T10:00:00.000Z',
      },
      developer: { displayName: 'Amina Apps', status: 'active' },
    });
    const text = await harness.run('whoami');
    expect(text.stdout).toContain(
      `Signed in to ${harness.fake.origin} as ${FAKE_EMAIL}`,
    );
  });

  it('says developer mode is off when it is', async () => {
    const harness = await createHarness();
    await harness.signIn();
    harness.fake.account = null;
    const result = await harness.run('whoami');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Developer mode is off');
  });

  it('NOT_LOGGED_IN (exit 3) without a token; DEVELOPER_TOKEN_INVALID (exit 3) with a dead one', async () => {
    const harness = await createHarness();
    const none = await harness.run('whoami', '--json');
    expect(none.code).toBe(3);
    expect(none.json()).toMatchObject({
      error: {
        code: 'NOT_LOGGED_IN',
        fix: expect.stringContaining('tassyir login') as string,
      },
    });

    const token = await harness.signIn();
    const row = harness.fake.tokens.find(
      (candidate) => candidate.token === token,
    );
    if (row) row.revoked = true;
    const dead = await harness.run('whoami', '--json');
    expect(dead.code).toBe(3);
    expect(dead.json()).toMatchObject({
      error: {
        code: 'DEVELOPER_TOKEN_INVALID',
        status: 401,
        requestId: 'req-test-1',
      },
    });
  });

  it('uses TASSYIR_TOKEN when set (CI), and refuses one that is not a developer token', async () => {
    const harness = await createHarness();
    harness.env['TASSYIR_TOKEN'] = harness.fake.issueToken();
    const result = await harness.run('whoami', '--json');
    expect(result.json()).toMatchObject({
      ok: true,
      storage: 'env',
      email: null,
    });
    harness.env['TASSYIR_TOKEN'] = 'eyJhbGciOiJIUzI1NiJ9.dashboard.jwt';
    const wrong = await harness.run('whoami', '--json');
    expect(wrong.code).toBe(3);
    expect(wrong.json()).toMatchObject({
      error: { code: 'TOKEN_ENV_INVALID' },
    });
  });
});

describe('where the token is stored', () => {
  it('the file is 0600 in a 0700 folder, written whole', async () => {
    const harness = await createHarness();
    harness.fake.pollScript = ['approve'];
    expect((await harness.run('login')).code).toBe(0);
    const file = join(harness.configDir, 'credentials.json');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(harness.configDir)).mode & 0o777).toBe(0o700);
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({
      version: 1,
    });
  });

  it('Linux: the Secret Service through secret-tool, the token on stdin only', async () => {
    const harness = await createHarness({
      env: { TASSYIR_CREDENTIAL_STORE: undefined },
    });
    harness.fake.pollScript = ['approve'];
    const result = await harness.run('login', '--json');
    expect(result.json()).toMatchObject({
      ok: true,
      storage: 'keychain',
      storedIn: 'the Secret Service (secret-tool)',
    });
    const token = harness.fake.liveTokens()[0] ?? '';
    expect(harness.keychain.get(harness.fake.origin)).toBe(token);
    const store = harness.execCalls.find((call) => call.args[0] === 'store');
    expect(store).toMatchObject({ command: 'secret-tool', input: token });
    for (const call of harness.execCalls)
      expect(call.args.join(' ')).not.toContain(token);
    // The file holds who, never the token.
    const file = await readFile(
      join(harness.configDir, 'credentials.json'),
      'utf8',
    );
    expect(file).not.toContain(token);
    expect(file).toContain('"storage": "keychain"');

    expect((await harness.run('whoami', '--json')).json()).toMatchObject({
      ok: true,
      storage: 'keychain',
    });
    expect((await harness.run('logout', '--json')).json()).toMatchObject({
      ok: true,
      revoked: true,
    });
    expect(harness.keychain.size).toBe(0);
  });

  it('macOS: the login keychain through `security -i`, the token on stdin only', async () => {
    const harness = await createHarness({
      platform: 'darwin',
      env: { TASSYIR_CREDENTIAL_STORE: undefined },
    });
    harness.fake.pollScript = ['approve'];
    const result = await harness.run('login', '--json');
    expect(result.json()).toMatchObject({
      ok: true,
      storage: 'keychain',
      storedIn: 'the macOS keychain',
    });
    const token = harness.fake.liveTokens()[0] ?? '';
    const add = harness.execCalls.find((call) => call.args[0] === '-i');
    expect(add?.command).toBe('/usr/bin/security');
    expect(add?.input).toBe(
      `add-generic-password -U -s 'tassyir-cli' -a '${harness.fake.origin}' -l 'Tassyir CLI' -w '${token}'\n`,
    );
    for (const call of harness.execCalls)
      expect(call.args.join(' ')).not.toContain(token);
    expect((await harness.run('whoami', '--json')).code).toBe(0);
  });

  it('falls back to the file when the keychain is missing or refuses, and says so', async () => {
    for (const keychain of ['missing', 'broken'] as const) {
      const harness = await createHarness({
        keychain,
        env: { TASSYIR_CREDENTIAL_STORE: undefined },
      });
      harness.fake.pollScript = ['approve'];
      const result = await harness.run('login', '--json');
      expect(result.json()).toMatchObject({
        ok: true,
        storage: 'file',
        warnings: [
          expect.stringContaining('No keychain took the token') as string,
        ],
      });
      expect((await harness.run('whoami', '--json')).code).toBe(0);
    }
  });

  it('Windows uses the file under %APPDATA%', async () => {
    const harness = await createHarness({
      platform: 'win32',
      env: {
        TASSYIR_CREDENTIAL_STORE: undefined,
        TASSYIR_CONFIG_DIR: undefined,
        APPDATA: undefined,
      },
    });
    harness.env['APPDATA'] = join(harness.root, 'AppData', 'Roaming');
    harness.fake.pollScript = ['approve'];
    const result = await harness.run('login', '--json');
    expect(result.json()).toMatchObject({
      ok: true,
      storage: 'file',
      storedIn: join(
        harness.root,
        'AppData',
        'Roaming',
        'tassyir',
        'credentials.json',
      ),
    });
    expect(harness.execCalls).toEqual([]);
  });

  it('TASSYIR_CREDENTIAL_STORE=keychain refuses rather than fall back', async () => {
    const harness = await createHarness({
      keychain: 'broken',
      env: { TASSYIR_CREDENTIAL_STORE: 'keychain' },
    });
    harness.fake.pollScript = ['approve'];
    const result = await harness.run('login', '--json');
    expect(result.code).toBe(1);
    expect(result.json()).toMatchObject({
      error: { code: 'KEYCHAIN_UNAVAILABLE' },
    });
  });

  it('a keychain entry that disappeared asks for a new login (exit 3)', async () => {
    const harness = await createHarness({
      env: { TASSYIR_CREDENTIAL_STORE: undefined },
    });
    harness.fake.pollScript = ['approve'];
    await harness.run('login');
    harness.keychain.clear();
    const result = await harness.run('whoami', '--json');
    expect(result.code).toBe(3);
    expect(result.json()).toMatchObject({
      error: { code: 'CREDENTIALS_UNAVAILABLE' },
    });
  });

  it('a damaged credentials file is named, with how to recover', async () => {
    const harness = await createHarness();
    await harness.signIn();
    await writeFile(join(harness.configDir, 'credentials.json'), '{ not json');
    const result = await harness.run('whoami', '--json');
    expect(result.code).toBe(3);
    expect(result.json()).toMatchObject({
      error: {
        code: 'CREDENTIALS_UNREADABLE',
        fix: expect.stringContaining('Delete') as string,
      },
    });
  });

  it('keeps one session per API origin', async () => {
    const harness = await createHarness();
    await harness.signIn();
    const other = await harness.run(
      'whoami',
      '--api-origin',
      'https://api.staging.tassyir.test',
      '--json',
    );
    expect(other.code).toBe(3);
    expect(other.json()).toMatchObject({
      error: {
        code: 'NOT_LOGGED_IN',
        message: 'Not signed in to https://api.staging.tassyir.test',
      },
    });
    expect((await harness.run('whoami', '--json')).code).toBe(0);
  });
});
