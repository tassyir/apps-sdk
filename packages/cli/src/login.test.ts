import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupHarnesses, createHarness } from './cli.test-helpers.js';
import { FAKE_EMAIL } from './fake-api.test-helpers.js';

afterEach(cleanupHarnesses);

/** The seconds between the token polls the fake API received. */
function pollGaps(
  harness: Awaited<ReturnType<typeof createHarness>>,
): number[] {
  const polls = harness.fake.requests.filter(
    (request) => request.path === '/developer/cli/token',
  );
  return polls
    .slice(1)
    .map((poll, index) => (poll.at - (polls[index]?.at ?? 0)) / 1000);
}

describe('tassyir login: the device grant (RFC 8628)', () => {
  it('prints the code and the page, polls every interval, and stores the token', async () => {
    const harness = await createHarness();
    harness.fake.pollScript = ['pending', 'pending', 'approve'];
    const result = await harness.run('login');
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('Your one-time code: BCDF-GHJK');
    expect(result.stderr).toContain(
      'https://app.tassyir.io/en/developers/cli?code=BCDF-GHJK',
    );
    expect(result.stdout).toContain(
      `Signed in to ${harness.fake.origin} as ${FAKE_EMAIL}`,
    );
    // The first poll waits one interval; each next one interval more.
    expect(harness.clock.sleeps).toEqual([5000, 5000, 5000]);
    expect(pollGaps(harness)).toEqual([5, 5]);

    const [device] = harness.fake.signIns;
    expect(device?.form).toMatchObject({
      client_id: 'tassyir-cli',
      client_version: '0.0.0-test',
      device_name: 'amina-laptop',
      locale: 'en',
    });
    const stored = JSON.parse(
      await readFile(join(harness.configDir, 'credentials.json'), 'utf8'),
    ) as {
      sessions: Record<
        string,
        { storage: string; token: string; email: string }
      >;
    };
    expect(stored.sessions[harness.fake.origin]).toMatchObject({
      storage: 'file',
      token: harness.fake.liveTokens()[0],
      email: FAKE_EMAIL,
    });
  });

  it('adds 5 seconds to the interval on slow_down, and keeps it', async () => {
    const harness = await createHarness();
    harness.fake.pollScript = [
      'pending',
      'slow_down',
      'pending',
      'slow_down',
      'approve',
    ];
    const result = await harness.run('login', '--json');
    expect(result.code).toBe(0);
    expect(harness.clock.sleeps).toEqual([5000, 5000, 10000, 10000, 15000]);
    // Never polled sooner than the API's interval: the fake never had to
    // answer slow_down by itself.
    expect(pollGaps(harness)).toEqual([5, 10, 10, 15]);
  });

  it('stops on access_denied: LOGIN_DENIED, exit 3, nothing stored', async () => {
    const harness = await createHarness();
    harness.fake.pollScript = ['pending', 'deny'];
    const result = await harness.run('login', '--json');
    expect(result.code).toBe(3);
    expect(result.json()).toMatchObject({
      ok: false,
      error: { code: 'LOGIN_DENIED', fix: expect.any(String) as string },
    });
    await expect(
      readFile(join(harness.configDir, 'credentials.json'), 'utf8'),
    ).rejects.toThrow();
  });

  it('stops on expired_token: LOGIN_EXPIRED, exit 3', async () => {
    const harness = await createHarness();
    harness.fake.pollScript = ['pending', 'expire'];
    const result = await harness.run('login');
    expect(result.code).toBe(3);
    expect(result.stderr).toMatch(
      /^✗ LOGIN_EXPIRED: .+\n {2}Fix: Run `tassyir login` again/m,
    );
  });

  it('gives up by itself once expires_in has passed', async () => {
    const harness = await createHarness();
    harness.fake.pollScript = Array.from(
      { length: 500 },
      () => 'pending' as const,
    );
    const result = await harness.run('login', '--json');
    expect(result.code).toBe(3);
    expect(result.json()).toMatchObject({ error: { code: 'LOGIN_EXPIRED' } });
    const polls = harness.fake.requests.filter(
      (request) => request.path === '/developer/cli/token',
    );
    expect(polls.length).toBeLessThanOrEqual(120);
  });

  it('stops on invalid_grant', async () => {
    const harness = await createHarness();
    harness.fake.pollScript = ['invalid_grant'];
    const result = await harness.run('login', '--json');
    expect(result.code).toBe(3);
    expect(result.json()).toMatchObject({
      error: { code: 'LOGIN_INVALID_GRANT' },
    });
  });

  it('keeps polling through a network error or a 5xx, slower', async () => {
    const harness = await createHarness();
    harness.fake.pollScript = ['network', 'server_error', 'approve'];
    const result = await harness.run('login', '--json');
    expect(result.code).toBe(0);
    expect(harness.clock.sleeps).toEqual([5000, 10000, 20000]);
  });

  it('--json prints the code first, as its own line, then the result', async () => {
    const harness = await createHarness();
    harness.fake.pollScript = ['approve'];
    const result = await harness.run('login', '--json');
    expect(result.stderr).toBe('');
    const [authorize, done] = result.jsonLines();
    expect(authorize).toEqual({
      ok: true,
      step: 'authorize',
      userCode: 'BCDF-GHJK',
      verificationUri: 'https://app.tassyir.io/en/developers/cli',
      verificationUriComplete:
        'https://app.tassyir.io/en/developers/cli?code=BCDF-GHJK',
      expiresIn: 600,
      interval: 5,
    });
    expect(done).toMatchObject({
      ok: true,
      step: 'signed_in',
      email: FAKE_EMAIL,
      storage: 'file',
      apiOrigin: harness.fake.origin,
    });
  });

  it('refuses when too many sign-ins were started: LOGIN_RATE_LIMITED, exit 5', async () => {
    const harness = await createHarness();
    harness.fake.deviceCodeStatus = 429;
    const result = await harness.run('login', '--json');
    expect(result.code).toBe(5);
    expect(result.json()).toMatchObject({
      error: {
        code: 'LOGIN_RATE_LIMITED',
        status: 429,
        retryAfterSeconds: 120,
      },
    });
  });

  it('offers the browser only in a terminal, and opens the page on Enter', async () => {
    const harness = await createHarness({
      interactive: true,
      pressEnter: true,
      platform: 'darwin',
    });
    harness.fake.pollScript = ['pending', 'approve'];
    const result = await harness.run('login');
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('Press Enter to open it in your browser');
    expect(harness.execCalls).toContainEqual({
      command: 'open',
      args: ['https://app.tassyir.io/en/developers/cli?code=BCDF-GHJK'],
      input: undefined,
      // No pipes, not waited for: a browser it starts never holds the CLI.
      detached: true,
    });
    // The code is printed whether or not the browser opens.
    expect(result.stderr).toContain('BCDF-GHJK');
  });

  it('never offers the browser with --no-browser, --json, or outside a terminal', async () => {
    for (const [interactive, args] of [
      [true, ['--no-browser']],
      [true, ['--json']],
      [false, []],
    ] as const) {
      const harness = await createHarness({ interactive, pressEnter: true });
      harness.fake.pollScript = ['approve'];
      const result = await harness.run('login', ...args);
      expect(result.code).toBe(0);
      expect(
        harness.execCalls.filter((call) => call.command === 'xdg-open'),
      ).toEqual([]);
    }
  });

  it('never opens a page that is not https', async () => {
    const harness = await createHarness({
      interactive: true,
      pressEnter: true,
    });
    harness.fake.verificationOrigin = 'file:///etc';
    harness.fake.pollScript = ['approve'];
    const result = await harness.run('login');
    expect(result.code).toBe(0);
    expect(
      harness.execCalls.filter((call) => call.command === 'xdg-open'),
    ).toEqual([]);
  });

  it('checks --device-name and --locale; reads the locale from $LANG', async () => {
    const harness = await createHarness({ env: { LANG: 'ar_DZ.UTF-8' } });
    harness.fake.pollScript = ['approve'];
    expect(
      (
        await harness.run(
          'login',
          '--device-name',
          `Amina${String.fromCharCode(0x202e)}phone`,
        )
      ).code,
    ).toBe(2);
    expect((await harness.run('login', '--locale', 'fr')).code).toBe(2);
    const result = await harness.run(
      'login',
      '--device-name',
      'Amina  MacBook (work)',
    );
    expect(result.code).toBe(0);
    expect(harness.fake.signIns[0]?.form).toMatchObject({
      device_name: 'Amina MacBook (work)',
      locale: 'ar',
    });
    expect(result.stderr).toContain(
      'https://app.tassyir.io/ar/developers/cli?code=BCDF-GHJK',
    );
  });

  it('a 5xx starting the sign-in is SERVER_ERROR, exit 5', async () => {
    const harness = await createHarness();
    harness.fake.deviceCodeStatus = 503;
    const result = await harness.run('login', '--json');
    expect(result.code).toBe(5);
    expect(result.json()).toMatchObject({
      error: { code: 'SERVER_ERROR', status: 503 },
    });
  });

  it('a 429 that is not slow_down waits Retry-After, never past 60 s', async () => {
    const harness = await createHarness();
    harness.fake.pollScript = ['throttled', 'approve'];
    const result = await harness.run('login', '--json');
    expect(result.code).toBe(0);
    expect(harness.clock.sleeps).toEqual([5000, 60000]);
  });

  it('refuses a TASSYIR_CREDENTIAL_STORE it cannot honour before any sign-in starts', async () => {
    const harness = await createHarness({
      env: { TASSYIR_CREDENTIAL_STORE: 'vault' },
    });
    const result = await harness.run('login', '--json');
    expect(result.code).toBe(2);
    expect(result.json()).toMatchObject({
      error: { code: 'INVALID_ARGUMENT' },
    });
    expect(harness.fake.requests).toEqual([]);
  });

  it('revokes a new token it could not store, rather than leave it live', async () => {
    const harness = await createHarness();
    // The config folder would sit under a file: the write fails.
    await writeFile(join(harness.root, 'not-a-folder'), 'x');
    harness.env['TASSYIR_CONFIG_DIR'] = join(
      harness.root,
      'not-a-folder',
      'tassyir',
    );
    harness.fake.pollScript = ['approve'];
    const result = await harness.run('login', '--json');
    expect(result.code).toBe(1);
    expect(result.json()).toMatchObject({
      error: {
        code: 'CREDENTIALS_UNWRITABLE',
        message: expect.stringContaining('so it was revoked') as string,
      },
    });
    expect(harness.fake.tokens).toHaveLength(1);
    expect(harness.fake.liveTokens()).toEqual([]);
  });

  it('revokes the token of the sign-in it replaces', async () => {
    const harness = await createHarness();
    const old = await harness.signIn();
    harness.fake.pollScript = ['approve'];
    const result = await harness.run('login', '--json');
    expect(result.json()).toMatchObject({
      ok: true,
      previousTokenRevoked: true,
    });
    const live = harness.fake.liveTokens();
    expect(live).toHaveLength(1);
    expect(live).not.toContain(old);
  });

  it('warns that TASSYIR_TOKEN wins while it is set, and never revokes it', async () => {
    const harness = await createHarness();
    const ci = harness.fake.issueToken();
    harness.env['TASSYIR_TOKEN'] = ci;
    harness.fake.pollScript = ['approve'];
    const result = await harness.run('login', '--json');
    expect(result.json()).toMatchObject({
      ok: true,
      previousTokenRevoked: false,
      warnings: [expect.stringContaining('TASSYIR_TOKEN is set') as string],
    });
    expect(harness.fake.liveTokens()).toContain(ci);
  });
});
