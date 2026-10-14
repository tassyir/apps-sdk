import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupHarnesses, createHarness } from './cli.test-helpers.js';
import type { Harness } from './cli.test-helpers.js';
import { redact } from './run.js';

// The developer token (and the sign-in's device code) never appear in any
// output or log: not in stdout, not in stderr, not in TASSYIR_DEBUG's request
// log, not in a program's arguments, whatever the command and the mode.

afterEach(cleanupHarnesses);

const MANIFEST = `name = "Review Requests"
handle = "review-requests"
api_version = "2026-10"

[access]
scopes = ["read_orders"]

[access.scope_reasons]
read_orders = "Find delivered orders to ask for a review"

[hosting]
mode = "external"
url = "https://reviews.acme-apps.dz"

[[webhooks]]
topics = ["orders/created"]
uri = "/webhooks"
`;

/** Every command, successes and refusals both. */
const COMMAND_LINES: string[][] = [
  ['whoami'],
  ['app', 'list'],
  ['app', 'create', '--handle', 'second-app', '--name', 'Second App'],
  ['app', 'create'],
  ['validate'],
  ['deploy'],
  ['deploy'],
  ['secrets', 'create', '--write-env'],
  ['secrets', 'rotate'],
  ['secrets', 'list'],
  ['secrets', 'revoke', '999'],
  ['store', 'create'],
  ['store', 'list'],
  ['webhook', 'trigger', 'orders/created'],
  ['webhook', 'deliveries', '--status', 'failed'],
  ['webhook', 'replay', '8001'],
  ['webhook', 'replay', '404'],
  ['dev'],
  ['logs', '--tail'],
  ['nope'],
  ['--help'],
];

function secretsIn(harness: Harness): string[] {
  return [
    ...harness.fake.tokens.map((row) => row.token),
    ...harness.fake.signIns.map((signIn) => signIn.deviceCode),
  ];
}

function expectNothingLeaked(harness: Harness): void {
  const printed = harness.printed.join('');
  const argv = harness.execCalls
    .map((call) => `${call.command} ${call.args.join(' ')}`)
    .join('\n');
  const secrets = secretsIn(harness);
  expect(secrets.length).toBeGreaterThan(0);
  for (const secret of secrets) {
    expect(printed).not.toContain(secret);
    expect(argv).not.toContain(secret);
    // Not even its random part (a prefix match would still be a leak).
    expect(printed).not.toContain(secret.slice(7, 27));
  }
}

describe('the developer token is never printed', () => {
  for (const json of [false, true]) {
    it(`in any command's output or debug log${json ? ' (--json)' : ''}`, async () => {
      const harness = await createHarness({
        env: { TASSYIR_DEBUG: '1', TASSYIR_CREDENTIAL_STORE: undefined },
      });
      await writeFile(join(harness.cwd, 'tassyir.app.toml'), MANIFEST);
      harness.fake.seedApp();
      harness.fake.pollScript = ['pending', 'slow_down', 'pending', 'approve'];
      const flag = json ? ['--json'] : [];

      expect((await harness.run('login', ...flag)).code).toBe(0);
      for (const line of COMMAND_LINES) await harness.run(...line, ...flag);
      // Signing in again revokes the first token with it.
      harness.fake.pollScript = ['approve'];
      expect((await harness.run('login', ...flag)).code).toBe(0);
      expect((await harness.run('logout', ...flag)).code).toBe(0);
      // Refusals after logout, with a dead token in the environment.
      harness.env['TASSYIR_TOKEN'] = harness.fake.tokens[0]?.token;
      await harness.run('whoami', ...flag);
      await harness.run('logout', ...flag);

      // The debug log ran: requests are named, never their credentials.
      expect(harness.printed.join('')).toContain(
        '[debug] → POST /developer/cli/token',
      );
      expect(harness.printed.join('')).toContain(
        '[debug] ← 200 GET /developer/apps',
      );
      expectNothingLeaked(harness);
      // ...and not because the last-resort redaction caught it: the CLI's
      // own code never tried to print one.
      expect(harness.printed.join('')).not.toContain('[redacted]');
    });
  }

  it('the token travels only in the Authorization header, the device code only in the form body', async () => {
    const harness = await createHarness();
    harness.fake.pollScript = ['approve'];
    await harness.run('login');
    await harness.run('whoami');
    const token = harness.fake.tokens[0]?.token ?? '';
    const deviceCode = harness.fake.signIns[0]?.deviceCode ?? '';
    for (const request of harness.fake.requests) {
      expect(request.path + request.query.toString()).not.toContain(token);
      expect(request.path + request.query.toString()).not.toContain(deviceCode);
      if (request.path === '/developer/cli/token') {
        expect(request.body).toContain(`device_code=${deviceCode}`);
        expect(request.headers.get('authorization')).toBeNull();
      } else if (request.path.startsWith('/developer/cli/device-code')) {
        expect(request.headers.get('authorization')).toBeNull();
      } else {
        expect(request.headers.get('authorization')).toBe(`Bearer ${token}`);
        expect(request.body ?? '').not.toContain(token);
      }
    }
  });

  it('even an API that echoes the token in an error has it redacted', async () => {
    const harness = await createHarness();
    const token = await harness.signIn();
    harness.fake.seedApp();
    harness.fake.echoInErrors = `you sent ${token}`;
    for (const flag of [[], ['--json']]) {
      const result = await harness.run(
        'secrets',
        'revoke',
        '999',
        '--app',
        'review-requests',
        ...flag,
      );
      expect(result.code).toBe(1);
      expect(result.stdout + result.stderr).toContain('tsy_dt_[redacted]');
    }
    expectNothingLeaked(harness);
  });

  it('the credentials file is the one place the token is written (file store)', async () => {
    const harness = await createHarness();
    harness.fake.pollScript = ['approve'];
    await harness.run('login');
    const token = harness.fake.tokens[0]?.token ?? '';
    expect(
      await readFile(join(harness.configDir, 'credentials.json'), 'utf8'),
    ).toContain(token);
    expectNothingLeaked(harness);
  });

  it('drops terminal control characters an API sends (ESC sequences, carriage returns)', async () => {
    const harness = await createHarness();
    await harness.signIn();
    harness.fake.seedApp();
    const escape = String.fromCharCode(0x1b);
    harness.fake.echoInErrors = `${escape}[2J${escape}]0;owned${String.fromCharCode(7)}\rfake prompt`;
    const result = await harness.run(
      'secrets',
      'revoke',
      '999',
      '--app',
      'review-requests',
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('[2J]0;ownedfake prompt');
    expect(result.stderr).not.toContain(escape);
    expect(result.stderr).not.toContain('\r');
    // JSON escapes them anyway.
    const json = await harness.run(
      'secrets',
      'revoke',
      '999',
      '--app',
      'review-requests',
      '--json',
    );
    expect(json.stdout).not.toContain(escape);
  });

  it('redact() covers developer tokens and device codes, not client secrets', () => {
    expect(redact('a tsy_dt_abcDEF123 b tsy_dc_XYZ789 c')).toBe(
      'a tsy_dt_[redacted] b tsy_dc_[redacted] c',
    );
    // A client secret is shown once on purpose (`secrets create`).
    expect(redact('tsy_cs_abc')).toBe('tsy_cs_abc');
  });
});
