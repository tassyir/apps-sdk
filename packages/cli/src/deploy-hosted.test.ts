import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupHarnesses, createHarness } from './cli.test-helpers.js';
import type { Harness } from './cli.test-helpers.js';
import { passingChecks } from './fake-api.test-helpers.js';
import type { ScanStep } from './fake-api.test-helpers.js';

// `tassyir deploy` for an app on Tassyir Hosting (AP-K1.11), end to end on
// the fake developer API: a real esbuild build of a project in a scratch
// folder, the local checks, the upload, and the scan followed to every
// state the API can leave a version in. Never the real API.

afterEach(cleanupHarnesses);

const HOSTED = `name        = "Review Requests"
handle      = "review-requests"
api_version = "2026-10"

[access]
scopes = ["read_orders"]

[access.scope_reasons]
read_orders = "Find delivered orders to ask for a review"

[hosting]
mode          = "tassyir"
allowed_hosts = ["graph.facebook.com"]

[admin]
page = "/"

[[webhooks]]
topics = ["orders/created"]
uri    = "/webhooks"
`;

const WORKER = `import page from './page.html';
import style from './style.css';
import { greet } from './lib/greet';

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/') {
      return new Response(page.replace('</head>', \`<style>\${style}</style></head>\`), {
        headers: { 'content-type': 'text/html' },
      });
    }
    const me = await fetch('https://graph.facebook.com/v20.0/me');
    return new Response(greet(await me.text()));
  },
};
`;

const PROJECT: Readonly<Record<string, string>> = {
  'tassyir.app.toml': HOSTED,
  'src/worker.ts': WORKER,
  'src/page.html':
    '<!doctype html><html><head></head><body><h1>Reviews</h1></body></html>',
  'src/style.css': 'h1 { color: teal; }',
  'src/lib/greet.ts':
    'export const greet = (name: string): string => `Hello ${name}`;\n',
  'package-lock.json': '{ "name": "review-requests", "lockfileVersion": 3 }\n',
};

/** The project, with `changes` on top (`null` removes a file). */
async function project(
  harness: Harness,
  changes: Record<string, string | null> = {},
): Promise<void> {
  const files: Record<string, string | null> = { ...PROJECT, ...changes };
  for (const [path, content] of Object.entries(files)) {
    const target = join(harness.cwd, path);
    if (content === null) {
      await rm(target, { force: true });
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

/** Signed in, the app created, Tassyir Hosting on, the project written. */
async function ready(
  options: {
    script?: ScanStep[];
    changes?: Record<string, string | null>;
  } = {},
): Promise<Harness> {
  const harness = await createHarness();
  await harness.signIn();
  harness.fake.seedApp();
  harness.fake.hosting = 'on';
  harness.fake.scanScript = [...(options.script ?? [])];
  await project(harness, options.changes);
  return harness;
}

const RELEASE: ScanStep[] = ['dispatched', 'passed', 'staging', 'released'];

function uploads(harness: Harness) {
  return harness.fake.requests.filter(
    (request) =>
      request.method === 'POST' && request.path.endsWith('/versions'),
  );
}

function reads(harness: Harness) {
  return harness.fake.requests.filter(
    (request) =>
      request.method === 'GET' && /\/versions\/\d+$/.test(request.path),
  );
}

interface SentBody {
  manifest: Record<string, unknown>;
  bundle: {
    main: string;
    files: { path: string; content: string }[];
    lockfile?: { name: string; content: string };
  };
}

function sent(harness: Harness, index = 0): SentBody {
  return JSON.parse(uploads(harness)[index]?.body ?? '{}') as SentBody;
}

describe('tassyir deploy, hosted: build, check, upload', () => {
  it('builds one ES module, uploads it with the manifest and the lockfile, follows the scan to the release', async () => {
    const harness = await ready({ script: RELEASE });
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(0);

    const [uploaded, done, ...rest] = result.jsonLines();
    expect(rest).toEqual([]);
    expect(uploaded).toEqual({
      ok: true,
      step: 'uploaded',
      app: { id: harness.fake.apps[0]?.id, handle: 'review-requests' },
      unchanged: false,
      version: { version: 1, reviewState: 'scanning', scan: 'pending' },
      next: 'tassyir app version 1 --follow --app review-requests',
    });
    expect(done).toMatchObject({
      ok: true,
      released: true,
      state: 'released',
      unchanged: false,
      warnings: [],
      version: {
        version: 1,
        reviewState: 'approved',
        current: true,
        hosting: {
          main: 'worker.js',
          lockfile: 'package-lock.json',
          scan: { status: 'passed' },
          deploy: {
            staging: { status: 'deployed' },
            production: { status: 'deployed' },
          },
          checks: passingChecks(),
        },
      },
    });

    const body = sent(harness);
    expect(body.manifest['hosting']).toEqual({
      mode: 'tassyir',
      allowed_hosts: ['graph.facebook.com'],
    });
    expect(body.bundle.main).toBe('worker.js');
    expect(body.bundle.files.map((file) => file.path)).toEqual(['worker.js']);
    const code = body.bundle.files[0]?.content ?? '';
    // HTML and CSS are text modules; the helper is bundled in; ES2022, ESM.
    expect(code).toContain('<h1>Reviews</h1>');
    expect(code).toContain('h1 { color: teal; }');
    expect(code).toContain('Hello ');
    expect(code).toMatch(/export \{\s*\w+ as default\s*\}/);
    expect(code).not.toContain('sourceMappingURL');
    expect(body.bundle.lockfile).toEqual({
      name: 'package-lock.json',
      content: PROJECT['package-lock.json'],
    });
    // One read per 10 s until it settled: dispatched, passed, staging, released.
    expect(reads(harness)).toHaveLength(4);
    expect(harness.clock.sleeps).toEqual([10_000, 10_000, 10_000, 10_000]);
  });

  it('tells a person what happens, step by step, and the verdict', async () => {
    const harness = await ready({ script: RELEASE });
    const result = await harness.run('deploy');
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('✓ Built src/worker.ts into worker.js (');
    expect(result.stderr).toContain(', with package-lock.json)');
    expect(result.stderr).toContain(
      '… version 1: scan pending (Ctrl-C stops waiting; the scan goes on)',
    );
    expect(result.stderr).toContain('… version 1: scan dispatched');
    expect(result.stderr).toContain(
      '… version 1: scan passed, uploading to staging',
    );
    expect(result.stderr).toContain(
      '… version 1: scan passed, uploading to production',
    );
    expect(result.stdout).toContain(
      '✓ review-requests version 1 passed its scan and is released on Tassyir Hosting (current: new installations get it).',
    );
    expect(result.stdout).toContain(
      '  Passed: bundle, size, unicode, banned_apis, manifest_scopes, manifest_hosts, semgrep, gitleaks, osv',
    );
    expect(result.stdout).toContain(
      '  Uploads: staging deployed, production deployed',
    );
  });

  it('sends no lockfile when the project has none, and the first the API knows when it has several', async () => {
    const none = await ready({
      script: RELEASE,
      changes: { 'package-lock.json': null },
    });
    expect((await none.run('deploy', '--json')).code).toBe(0);
    expect(sent(none).bundle.lockfile).toBeUndefined();

    const several = await ready({
      script: RELEASE,
      changes: {
        'yarn.lock': '# yarn\n',
        'pnpm-lock.yaml': 'lockfileVersion: 9\n',
      },
    });
    expect((await several.run('deploy', '--json')).code).toBe(0);
    expect(sent(several).bundle.lockfile?.name).toBe('package-lock.json');
  });

  it('builds --entry when the Worker is elsewhere', async () => {
    const harness = await ready({
      script: RELEASE,
      changes: {
        'src/worker.ts': null,
        'app/main.js': 'export default { fetch: () => new Response("ok") };\n',
      },
    });
    const result = await harness.run(
      'deploy',
      '--entry',
      'app/main.js',
      '--json',
    );
    expect(result.code).toBe(0);
    expect(sent(harness).bundle.files[0]?.content).toContain(
      'new Response("ok")',
    );
  });

  it('prints what the scan would only warn about, and uploads', async () => {
    const harness = await ready({
      script: RELEASE,
      changes: {
        'src/worker.ts': `export default {
  async fetch(request: Request): Promise<Response> {
    eval("1");
    const host = new URL(request.url).searchParams.get('h') ?? 'x';
    return fetch(\`https://\${host}/feed\`);
  },
};
`,
      },
    });
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(0);
    expect(result.json()['warnings']).toEqual([
      'src/worker.ts:3:4: Using direct eval with a bundler is not recommended and may cause problems (esbuild)',
      'src/worker.ts:3: eval() is not allowed on Workers.',
      'src/worker.ts:5: fetch() to a host built at run time; only allowed_hosts will be reachable.',
    ]);
  });
});

describe('tassyir deploy, hosted: refused before the upload (exit 4, nothing sent)', () => {
  it('refuses the scan’s and the CLI’s rules at once, each pointing at the source', async () => {
    const harness = await ready({
      changes: {
        'src/worker.ts': `import { readFile } from 'node:fs/promises';

export default {
  async fetch(request: Request): Promise<Response> {
    const name = new URL(request.url).pathname.slice(1);
    const plugin = await import(name);
    await fetch('https://api.tassyir.io/apps/2026-10/orders');
    await fetch('https://evil.example.net/collect');
    return new Response(String(plugin) + (await readFile('x')));
  },
};
`,
      },
    });
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(4);
    const error = result.json()['error'] as Record<string, unknown>;
    expect(error).toMatchObject({
      code: 'BUNDLE_INVALID',
      message: expect.stringMatching(
        /^The bundle built from src\/worker\.ts has 4 problems; the first: src\/worker\.ts:1: node:fs\/promises needs Node\.js compatibility.*Nothing was uploaded$/,
      ) as string,
    });
    expect(error['errors']).toEqual([
      expect.objectContaining({
        code: 'BUNDLE_NODE_IMPORT',
        path: 'src/worker.ts:1',
      }),
      expect.objectContaining({
        code: 'BUNDLE_DYNAMIC_IMPORT',
        path: 'src/worker.ts:6',
      }),
      expect.objectContaining({
        code: 'BUNDLE_TASSYIR_HOST',
        path: 'src/worker.ts:7',
        fix: expect.stringContaining('env.TASSYIR') as string,
      }),
      expect.objectContaining({
        code: 'BUNDLE_HOST_NOT_ALLOWED',
        path: 'src/worker.ts:8',
        message:
          'fetch() to evil.example.net, which is not in hosting.allowed_hosts',
      }),
    ]);
    expect(harness.fake.requests).toEqual([]);
  });

  it('refuses a Worker without a fetch handler', async () => {
    const harness = await ready({
      changes: { 'src/worker.ts': 'export default { scheduled() {} };\n' },
    });
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(4);
    expect(result.json()['error']).toMatchObject({
      code: 'BUNDLE_INVALID',
      errors: [{ code: 'BUNDLE_NO_FETCH_HANDLER', path: 'worker.js' }],
    });
    expect(harness.fake.requests).toEqual([]);
  });

  it('runs the API’s bundle rules over what esbuild wrote', async () => {
    // Over 3 MB of modules: the API's BUNDLE_TOO_LARGE, before any upload.
    const big = 'x'.repeat(3 * 1024 * 1024);
    const harness = await ready({
      changes: {
        'src/worker.ts': `const blob = ${JSON.stringify(big)};\nexport default { fetch: () => new Response(blob) };\n`,
      },
    });
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(4);
    expect(result.json()['error']).toMatchObject({
      code: 'BUNDLE_INVALID',
      errors: [
        {
          code: 'BUNDLE_TOO_LARGE',
          path: 'bundle.files',
          fix: 'Minify the bundle and leave out what the Worker does not import.',
        },
      ],
    });
    expect(harness.fake.requests).toEqual([]);
  });

  it('turns esbuild’s errors into problems with a fix: a missing package, a Node built-in, a binary file', async () => {
    const harness = await ready({
      changes: {
        'src/worker.ts': `import { thing } from 'not-installed-pkg';
import { createHash } from 'crypto';
import logo from './logo.png';
export default { fetch: () => new Response(String(thing) + createHash + logo) };
`,
        'src/logo.png': 'PNG',
      },
    });
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(4);
    const error = result.json()['error'] as Record<string, unknown>;
    expect(error['code']).toBe('BUNDLE_BUILD_FAILED');
    expect(error['errors']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'BUNDLE_BUILD_ERROR',
          path: expect.stringMatching(/^src\/worker\.ts:1:\d+$/) as string,
          fix: expect.stringContaining(
            'npm install not-installed-pkg',
          ) as string,
        }),
        expect.objectContaining({
          code: 'BUNDLE_NODE_IMPORT',
          path: expect.stringMatching(/^src\/worker\.ts:2:\d+$/) as string,
        }),
        expect.objectContaining({
          code: 'BUNDLE_FILE_TYPE_NOT_ALLOWED',
          path: expect.stringMatching(/^src\/worker\.ts:3:\d+$/) as string,
        }),
      ]),
    );
    expect(harness.fake.requests).toEqual([]);
  });

  it('asks for the entry when there is none', async () => {
    const harness = await ready({ changes: { 'src/worker.ts': null } });
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(4);
    expect(result.json()['error']).toMatchObject({
      code: 'BUNDLE_ENTRY_NOT_FOUND',
      fix: expect.stringContaining('--entry') as string,
    });
    const missing = await harness.run('deploy', '--entry', 'nope.ts', '--json');
    expect(missing.json()['error']).toMatchObject({
      code: 'BUNDLE_ENTRY_NOT_FOUND',
      message: '--entry nope.ts: no such file',
    });
    expect(harness.fake.requests).toEqual([]);
  });

  it('checks the bundle before asking who you are: signed out, the problems come first', async () => {
    const harness = await createHarness();
    await project(harness, {
      'src/worker.ts': "import('node:fs');\nexport default { fetch() {} };\n",
    });
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(4);
    expect(result.json()['error']).toMatchObject({ code: 'BUNDLE_INVALID' });
    expect(harness.fake.requests).toEqual([]);
  });

  it('refuses a malformed --timeout as usage (exit 2)', async () => {
    const harness = await ready();
    const result = await harness.run('deploy', '--timeout', '5m', '--json');
    expect(result.code).toBe(2);
    expect(result.json()['error']).toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('tassyir deploy, hosted: the verdict', () => {
  it('a failed scan lists every finding as the API sends it, with what to do (exit 1)', async () => {
    const harness = await ready({ script: ['dispatched', 'failed'] });
    harness.fake.scanChecks = passingChecks().map((check) =>
      check.id === 'gitleaks'
        ? {
            ...check,
            status: 'fail',
            summary: '1 secret',
            findings: [
              {
                rule: 'generic-api-key',
                severity: 'error',
                file: 'worker.js',
                line: 12,
                message: 'A generic API key (redacted)',
              },
              {
                rule: 'high-entropy',
                severity: 'warning',
                file: 'worker.js',
                line: 30,
                message: 'A high-entropy string',
              },
            ],
          }
        : check,
    );
    harness.fake.scanReview = {
      status: 'fail',
      model: 'claude-sonnet-5-5',
      summary:
        'The code sends order data to a host the manifest does not explain.',
      concerns: [
        {
          severity: 'high',
          file: 'worker.js',
          message: 'Posts buyer phones to graph.facebook.com',
        },
      ],
      truncated: false,
    };
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(1);
    const error = result.json()['error'] as Record<string, unknown>;
    expect(error).toMatchObject({
      code: 'VERSION_SCAN_FAILED',
      message:
        'review-requests version 1 failed its scan (CHECK_FAILED:gitleaks, REVIEW_FAILED)',
      fix: expect.stringContaining('Remove the secret from the code') as string,
      errors: [
        {
          code: 'generic-api-key',
          path: 'worker.js:12',
          message: 'gitleaks: A generic API key (redacted)',
          fix: 'Remove the secret from the code, and revoke it where it was issued.',
        },
        {
          code: 'review',
          path: 'worker.js',
          message: 'high: Posts buyer phones to graph.facebook.com',
          fix: expect.stringContaining("Read the review's summary") as string,
        },
      ],
    });
    // The whole version, as the API answered it.
    const details = error['details'] as { version: { hosting: unknown } };
    expect(details.version.hosting).toMatchObject({
      checks: harness.fake.scanChecks,
      review: harness.fake.scanReview,
      scan: { status: 'failed' },
    });

    const text = await (await ready({ script: ['failed'] })).run('deploy');
    expect(text.code).toBe(1);
  });

  it('prints a failed scan readably for a person', async () => {
    const harness = await ready({ script: ['failed'] });
    harness.fake.scanChecks = passingChecks().map((check) =>
      check.id === 'semgrep'
        ? {
            ...check,
            status: 'fail',
            summary: '1 finding',
            findings: [
              {
                rule: 'tassyir.crypto-mining',
                severity: 'error',
                file: 'worker.js',
                line: 3,
                message: 'Looks like a miner',
              },
            ],
          }
        : check,
    );
    const result = await harness.run('deploy');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      '✗ VERSION_SCAN_FAILED: review-requests version 1 failed its scan (CHECK_FAILED:semgrep)',
    );
    expect(result.stderr).toContain(
      '  - tassyir.crypto-mining at worker.js:3: semgrep: Looks like a miner',
    );
    expect(result.stderr).toContain('    Fix: Change the code the rule names.');
  });

  it('held for a person (in_review): exit 0, not released, and how to wait for it', async () => {
    const harness = await ready({ script: ['dispatched', 'held'] });
    harness.fake.scanReview = {
      status: 'needs_human',
      model: 'claude-sonnet-5-5',
      summary: 'Reads every order; the manifest explains it.',
      concerns: [],
      truncated: false,
    };
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({
      ok: true,
      released: false,
      state: 'in_review',
      version: { reviewState: 'in_review', current: false },
      next: 'tassyir app version 1 --follow --app review-requests',
    });
    const text = await (await ready({ script: ['held'] })).run('deploy');
    expect(text.stdout).toContain(
      '⏸ review-requests version 1 passed its checks, and the AI review asked a person at Tassyir to look at it',
    );
  });

  it.each([
    ['incomplete', 'SCAN_INCOMPLETE'],
    ['timed_out', 'SCAN_TIMED_OUT'],
    ['dispatch_failed', 'SCAN_DISPATCH_FAILED'],
    ['result_invalid', 'SCAN_RESULT_INVALID'],
  ] as const)(
    'a scan that ended without a verdict (%s) says to upload the same bundle again (exit 5), which works',
    async (step, code) => {
      const harness = await ready({ script: ['dispatched', step] });
      const result = await harness.run('deploy', '--json');
      expect(result.code).toBe(5);
      expect(result.json()['error']).toMatchObject({
        code,
        fix: 'Upload the same bundle again: run `tassyir deploy` (an unchanged bundle whose scan broke is scanned again).',
      });

      harness.fake.scanScript = [...RELEASE];
      const again = await harness.run('deploy', '--json');
      expect(again.code).toBe(0);
      expect(again.json()).toMatchObject({
        unchanged: false,
        released: true,
        version: { version: 2 },
      });
      expect(sent(harness, 1).bundle).toEqual(sent(harness, 0).bundle);
    },
  );

  it('an upload to Cloudflare that failed after the scan passed is its own code (exit 1)', async () => {
    const harness = await ready({
      script: ['dispatched', 'passed', 'deploy_failed'],
    });
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(1);
    expect(result.json()['error']).toMatchObject({
      code: 'CLOUDFLARE_REJECTED',
      message:
        'review-requests version 1 passed its scan, but its upload to Cloudflare (staging) failed: CLOUDFLARE_REJECTED',
      fix: expect.stringContaining('exports fetch') as string,
    });
  });
});

describe('tassyir deploy, hosted: the same bundle again', () => {
  it('APP_VERSION_UNCHANGED stays a success: the latest version is answered, already released', async () => {
    const harness = await ready({ script: RELEASE });
    expect((await harness.run('deploy', '--json')).code).toBe(0);
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(0);
    expect(result.jsonLines()).toHaveLength(1);
    expect(result.json()).toMatchObject({
      ok: true,
      unchanged: true,
      released: true,
      version: { version: 1, reviewState: 'approved' },
    });
    expect(
      harness.fake.versions.get(harness.fake.apps[0]?.id ?? ''),
    ).toHaveLength(1);
    expect((await harness.run('deploy')).stdout).toContain(
      "✓ Nothing to deploy: review-requests's latest version (1) has this manifest and bundle, and it is released.",
    );
  });

  it('follows the latest version when its scan is still running', async () => {
    const harness = await ready();
    expect((await harness.run('deploy', '--timeout', '0', '--json')).code).toBe(
      0,
    );
    harness.fake.scanScript = [...RELEASE];
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({
      unchanged: true,
      released: true,
      version: { version: 1 },
    });
  });

  it('answers by that version’s verdict: a rejected one stays rejected (exit 1)', async () => {
    const harness = await ready({ script: ['held'] });
    expect((await harness.run('deploy', '--json')).code).toBe(0);
    harness.fake.scanScript = ['rejected'];
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(1);
    expect(result.json()['error']).toMatchObject({
      code: 'VERSION_REJECTED',
      message:
        'A person at Tassyir rejected review-requests version 1: The page asks buyers for their card number.',
      details: { unchanged: true },
    });
  });
});

describe('tassyir deploy, hosted: the API’s refusals, each with a fix', () => {
  it('APP_VERSION_CONFLICT: run deploy again', async () => {
    const harness = await ready();
    harness.fake.nextUploadRefusal = {
      status: 409,
      code: 'APP_VERSION_CONFLICT',
      message: 'Another upload of this app took version 2 first',
      fix: 'Upload again.',
      extra: { version: 2 },
    };
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(1);
    expect(result.json()['error']).toMatchObject({
      code: 'APP_VERSION_CONFLICT',
      status: 409,
      fix: expect.stringMatching(/^Run `tassyir deploy` again/) as string,
      details: { version: 2 },
    });
  });

  it('APP_HOSTING_NOT_AVAILABLE (production today): your own server, or an API where hosting is on', async () => {
    const harness = await ready();
    harness.fake.hosting = 'off';
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(1);
    expect(result.json()['error']).toMatchObject({
      code: 'APP_HOSTING_NOT_AVAILABLE',
      fix: expect.stringContaining('hosting.mode = "external"') as string,
    });
    expect((result.json()['error'] as { fix: string }).fix).toContain(
      '--api-origin',
    );
  });

  it('APP_HOSTING_NOT_CONFIGURED: nothing was stored, try later (exit 5)', async () => {
    const harness = await ready();
    harness.fake.hosting = 'unconfigured';
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(5);
    expect(result.json()['error']).toMatchObject({
      code: 'APP_HOSTING_NOT_CONFIGURED',
      status: 503,
      fix: expect.stringContaining('nothing was stored') as string,
    });
  });

  it('APP_BUNDLE_INVALID from the API keeps its errors and says the CLI missed it (exit 4)', async () => {
    const harness = await ready();
    harness.fake.nextUploadRefusal = {
      status: 400,
      code: 'APP_BUNDLE_INVALID',
      message: 'The bundle has 1 error',
      extra: {
        errors: [
          {
            code: 'BUNDLE_PATH_INVALID',
            path: 'bundle.files[0].path',
            message: 'The path "worker.js" is odd',
            fix: 'Use a relative path such as "worker.js" or "assets/page.html".',
          },
        ],
      },
    };
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(4);
    expect(result.json()['error']).toMatchObject({
      code: 'APP_BUNDLE_INVALID',
      errors: [{ code: 'BUNDLE_PATH_INVALID', path: 'bundle.files[0].path' }],
      fix: expect.stringContaining('update the CLI') as string,
    });
  });

  it('PAYLOAD_TOO_LARGE says why a hosted upload can be too large', async () => {
    const harness = await ready();
    harness.fake.nextUploadRefusal = {
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'The request body is too large',
    };
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(1);
    expect(result.json()['error']).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      fix: expect.stringContaining(
        'at most 128 KB while Tassyir Hosting is off',
      ) as string,
    });
  });

  it('APP_HOSTING_BUSY passes on with its retry time (exit 5)', async () => {
    const harness = await ready();
    harness.fake.nextUploadRefusal = {
      status: 503,
      code: 'APP_HOSTING_BUSY',
      message: 'Tassyir Hosting has scanned all the versions it can for today',
      fix: 'Try again in 3600 seconds.',
      extra: { limit: 100, retryAfterSeconds: 3600 },
    };
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(5);
    expect(result.json()['error']).toMatchObject({
      code: 'APP_HOSTING_BUSY',
      retryAfterSeconds: 3600,
      fix: 'Try again in 3600 seconds.',
    });
  });
});

describe('tassyir deploy, hosted: waiting', () => {
  it('--timeout: stops waiting, never the scan, and says how to check later (exit 5)', async () => {
    const harness = await ready();
    const result = await harness.run('deploy', '--timeout', '60', '--json');
    expect(result.code).toBe(5);
    expect(result.json()['error']).toMatchObject({
      code: 'VERSION_IN_PROGRESS',
      message:
        'Waited the whole --timeout: review-requests version 1 is still at "scan pending", and its scan goes on',
      fix: 'Check it later: `tassyir app version 1 --follow --app review-requests`.',
      details: { version: { version: 1, reviewState: 'scanning' } },
    });
    expect(harness.clock.sleeps.reduce((sum, ms) => sum + ms, 0)).toBe(60_000);
  });

  it('--timeout 0 answers at once with the version and the command to follow it', async () => {
    const harness = await ready({ script: RELEASE });
    const result = await harness.run('deploy', '--timeout', '0', '--json');
    expect(result.code).toBe(0);
    expect(result.jsonLines()).toHaveLength(1);
    expect(result.json()).toMatchObject({
      ok: true,
      released: false,
      state: 'scanning',
      version: { version: 1, reviewState: 'scanning' },
      next: 'tassyir app version 1 --follow --app review-requests',
    });
    expect(reads(harness)).toEqual([]);
    expect(harness.clock.sleeps).toEqual([]);
  });

  it('Ctrl-C stops waiting, leaves the scan running and says how to check it later', async () => {
    const harness = await ready();
    let count = 0;
    harness.fake.onVersionRead = () => {
      count += 1;
      if (count === 2) harness.interrupt();
    };
    const result = await harness.run('deploy');
    expect(result.code).toBe(5);
    expect(result.stderr).toContain(
      '✗ VERSION_IN_PROGRESS: Stopped waiting: review-requests version 1 is still at "scan pending", and its scan goes on',
    );
    expect(result.stderr).toContain(
      'Fix: Check it later: `tassyir app version 1 --follow --app review-requests`.',
    );
    expect(reads(harness)).toHaveLength(2);
    // The CLI no longer holds Ctrl-C once it stopped following.
    expect(harness.interruptListeners.size).toBe(0);
  });

  it('keeps following through a busy or unreachable API', async () => {
    const harness = await ready({
      script: ['throttled', 'network', ...RELEASE],
    });
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({ released: true });
    // Retry-After 30 is honoured; a network failure waits the usual 10 s.
    expect(harness.clock.sleeps).toEqual([
      10_000, 30_000, 10_000, 10_000, 10_000, 10_000,
    ]);
  });

  it('stops on a refused token while following (exit 3)', async () => {
    const harness = await ready();
    harness.fake.onVersionRead = () => {
      for (const token of harness.fake.tokens) token.revoked = true;
    };
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(3);
    expect(result.json()['error']).toMatchObject({
      code: 'DEVELOPER_TOKEN_INVALID',
    });
  });
});

describe('tassyir app version', () => {
  it('shows the latest version with its scan report', async () => {
    const harness = await ready({ script: RELEASE });
    await harness.run('deploy', '--json');
    const result = await harness.run('app', 'version', '--json');
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({
      ok: true,
      app: { handle: 'review-requests' },
      released: true,
      state: 'released',
      version: { version: 1, hosting: { checks: passingChecks() } },
    });
    const text = await harness.run('app', 'version', '1');
    expect(text.stdout).toContain(
      'review-requests version 1: approved (scan passed), current (new installations get it).',
    );
    expect(text.stdout).toContain('  Scan: passed');
  });

  it('--follow picks up a version that is still scanning, and exits by its verdict', async () => {
    const harness = await ready();
    await harness.run('deploy', '--timeout', '0', '--json');
    harness.fake.scanScript = ['dispatched', 'failed'];
    harness.fake.scanChecks = passingChecks().map((check) =>
      check.id === 'osv'
        ? {
            ...check,
            status: 'fail',
            summary: '1 malicious package',
            findings: [
              {
                rule: 'MAL-2026-1234',
                severity: 'error',
                file: 'package-lock.json',
                line: null,
                message: 'evil-pkg 1.0.0 is malicious',
              },
            ],
          }
        : check,
    );
    const result = await harness.run(
      'app',
      'version',
      '1',
      '--follow',
      '--json',
    );
    expect(result.code).toBe(1);
    expect(result.json()['error']).toMatchObject({
      code: 'VERSION_SCAN_FAILED',
      errors: [{ code: 'MAL-2026-1234', path: 'package-lock.json' }],
    });
  });

  it('shows an external version too', async () => {
    const harness = await createHarness();
    await harness.signIn();
    harness.fake.seedApp();
    await project(harness, {
      'tassyir.app.toml': HOSTED.replace(
        'mode          = "tassyir"\nallowed_hosts = ["graph.facebook.com"]',
        'mode = "external"\nurl  = "https://reviews.acme-apps.dz"',
      ),
    });
    const deploy = await harness.run(
      'deploy',
      '--entry',
      'src/worker.ts',
      '--json',
    );
    expect(deploy.code).toBe(0);
    expect(deploy.json()['warnings']).toEqual([
      '--entry is for an app on Tassyir Hosting (hosting.mode = "tassyir"); ignored.',
    ]);
    expect(uploads(harness)[0]?.body).not.toContain('"bundle"');
    const result = await harness.run('app', 'version', '1');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      'review-requests version 1: approved, current (new installations get it).',
    );
    expect(result.stdout).toContain(
      'On your own server; scopes: read_orders; webhooks: orders/created.',
    );
  });

  it('refuses a version that does not exist, an app with none, and a malformed number', async () => {
    const harness = await ready();
    const none = await harness.run('app', 'version', '--json');
    expect(none.code).toBe(1);
    expect(none.json()['error']).toMatchObject({
      code: 'APP_VERSION_NOT_FOUND',
      fix: expect.stringContaining('tassyir deploy') as string,
    });
    const missing = await harness.run('app', 'version', '9', '--json');
    expect(missing.code).toBe(1);
    expect(missing.json()['error']).toMatchObject({
      code: 'APP_VERSION_NOT_FOUND',
      status: 404,
    });
    const malformed = await harness.run('app', 'version', 'latest', '--json');
    expect(malformed.code).toBe(2);
  });
});
