// The developer API's OpenAPI document, vendored from tassyir/backend, and
// what the CLI builds on it: the generated types, the client's error model
// for the refusals that carry no code, and the fake API the specs run on.
// `npm run openapi:check -w tassyir` compares the vendored file with the
// backend's.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MANIFEST_VOCABULARY } from '@tassyir/app-manifest';
import { afterEach, describe, expect, it } from 'vitest';
import { apiError } from './api.js';
import { cleanupHarnesses, createHarness } from './cli.test-helpers.js';
import { EXIT_CODES } from './errors.js';
import { takeDocumentViolations } from './fake-api.test-helpers.js';
import {
  DEVELOPER_OPENAPI,
  documentedOperations,
  operationFor,
  resolveRef,
  responseProblems,
  schemaProblems,
} from './openapi.test-helpers.js';

afterEach(cleanupHarnesses);

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');
const sha256 = (text: string) =>
  createHash('sha256').update(text, 'utf8').digest('hex');

const vendored = read('../openapi/openapi.developer.json');
const source = JSON.parse(read('../openapi/SOURCE.json')) as {
  repository: string;
  path: string;
  commit: string;
  sha256: string;
};
const generated = read('./generated/developer-api.ts');

type Schemas = Record<string, Record<string, unknown>>;
const schemas = (DEVELOPER_OPENAPI['components'] as { schemas: Schemas })
  .schemas;

function enumOf(schema: string, property: string): unknown {
  const properties = schemas[schema]?.['properties'] as
    Record<string, { enum?: unknown }> | undefined;
  return properties?.[property]?.enum;
}

describe('the vendored OpenAPI document', () => {
  it('is the file recorded in SOURCE.json', () => {
    expect(source).toMatchObject({
      repository: 'tassyir/backend',
      path: 'docs/api/apps/openapi.developer.json',
    });
    expect(source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(sha256(vendored)).toBe(source.sha256);
  });

  it('is the source of the generated types, every path included', () => {
    expect(generated).toContain(`${source.repository} ${source.commit},`);
    expect(generated).toContain(`sha256 ${source.sha256}.`);
    const operations = documentedOperations();
    expect(operations.length).toBeGreaterThanOrEqual(30);
    for (const { path, id } of operations) {
      expect(generated).toContain(`'${path}': {`);
      expect(generated).toContain(`  ${id}: {`);
    }
  });

  it("names the manifest vocabulary's topics, as the CLI checks them before a call", () => {
    const topics = MANIFEST_VOCABULARY.topics.map((topic) => topic.name);
    expect(enumOf('SendWebhookTestInput', 'topic')).toEqual(topics);
    expect(enumOf('WebhookDelivery', 'topic')).toEqual(topics);
    expect(enumOf('WebhookTestResult', 'topic')).toEqual(topics);
  });
});

describe('the refusals without a code, read by status', () => {
  // One body of each code-less shape the document names, checked against it
  // first, then read by the client as K1.6 reads them.
  const cases = [
    {
      shape: 'ValidationError',
      status: 400,
      body: {
        statusCode: 400,
        message: ['limit must not be greater than 100'],
        error: 'Bad Request',
      },
      code: 'BAD_REQUEST',
      exitCode: EXIT_CODES.FAILED,
    },
    {
      shape: 'HttpError',
      status: 401,
      body: { statusCode: 401, message: 'Unauthorized' },
      code: 'UNAUTHORIZED',
      exitCode: EXIT_CODES.AUTH,
    },
    {
      shape: 'RateLimitError',
      status: 429,
      body: 'ThrottlerException: Too Many Requests',
      code: 'RATE_LIMITED',
      exitCode: EXIT_CODES.TRY_LATER,
    },
    {
      shape: 'ServerError',
      status: 503,
      body: {
        statusCode: 503,
        message: 'Service temporarily unavailable, please retry.',
      },
      code: 'SERVER_ERROR',
      exitCode: EXIT_CODES.TRY_LATER,
    },
  ];

  it.each(cases)(
    '$shape ($status) is $code',
    ({ shape, status, body, code, exitCode }) => {
      expect(schemas[shape]?.['properties'] ?? {}).not.toHaveProperty('code');
      expect(
        schemaProblems({ $ref: `#/components/schemas/${shape}` }, body),
      ).toEqual([]);
      const error = apiError(
        new Response(JSON.stringify(body), { status }),
        body,
      );
      expect(error).toMatchObject({ code, exitCode, status });
      expect(error.fix).not.toBe('');
    },
  );

  it('each is one the document says the guarded routes can answer', () => {
    const listApps = operationFor('GET', '/developer/apps');
    const createApp = operationFor('POST', '/developer/apps');
    if (!listApps || !createApp) throw new Error('operations missing');
    for (const [status, body] of [
      [401, { statusCode: 401, message: 'Unauthorized' }],
      [429, 'ThrottlerException: Too Many Requests'],
      [503, { statusCode: 503, message: 'Unavailable' }],
    ] as const) {
      expect(responseProblems(listApps, status, body)).toEqual([]);
    }
    expect(
      responseProblems(createApp, 400, {
        statusCode: 400,
        message: ['nameEn must be a string'],
        error: 'Bad Request',
      }),
    ).toEqual([]);
  });
});

describe('the schema check the fake API runs', () => {
  const app = {
    $ref: '#/components/schemas/DeveloperApp',
  };
  const valid = {
    id: '101',
    handle: 'review-requests',
    clientId: `app_${'A'.repeat(26)}`,
    nameEn: 'Review Requests',
    nameAr: 'Review Requests',
    distribution: 'custom',
    customBusinessId: null,
    hostingMode: 'external',
    status: 'draft',
    suspendedReason: null,
    currentVersion: null,
    installCount: 0,
    createdAt: '2026-10-14T10:00:00.000Z',
    updatedAt: '2026-10-14T10:00:00.000Z',
  };

  it('accepts what the document allows', () => {
    expect(schemaProblems(app, valid)).toEqual([]);
  });

  it.each([
    [
      'a missing property',
      { ...valid, handle: undefined },
      /\.handle: is missing/,
    ],
    [
      'an unknown property',
      { ...valid, extra: 1 },
      /\.extra: is not a property/,
    ],
    [
      'a wrong type',
      { ...valid, installCount: '0' },
      /installCount: is "0", not integer/,
    ],
    ['a pattern', { ...valid, id: 'abc' }, /\.id: "abc" does not match/],
    [
      'a minimum',
      { ...valid, installCount: -1 },
      /installCount: -1 is below 0/,
    ],
    [
      'anyOf',
      { ...valid, currentVersion: 'one' },
      /currentVersion: matches none of anyOf/,
    ],
  ])('refuses %s', (_, value, message) => {
    const json = JSON.parse(JSON.stringify(value)) as unknown;
    expect(schemaProblems(app, json).join('\n')).toMatch(message);
  });

  it('refuses an enum, a const and a length', () => {
    expect(
      schemaProblems(
        { $ref: '#/components/schemas/AppCredential' },
        {
          id: '1',
          secretPrefix: 'tsy_cs_12345678',
          state: 'lost',
          createdAt: '2026-10-14T10:00:00.000Z',
          expiresAt: null,
          revokedAt: null,
        },
      ).join('\n'),
    ).toMatch(/state: "lost" is not one of/);
    const token = resolveRef({
      $ref: '#/components/schemas/DeveloperTokenResponse',
    }) as { properties: Record<string, unknown> };
    expect(
      schemaProblems(token.properties['token_type'], 'MAC').join('\n'),
    ).toMatch(/is not "Bearer"/);
    expect(
      schemaProblems(
        { $ref: '#/components/schemas/CreateDevStoreInput' },
        {
          name: 'x'.repeat(61),
        },
      ).join('\n'),
    ).toMatch(/longer than 60/);
  });

  it('refuses a list outside its minItems and maxItems (a bundle of 1 to 100 files)', () => {
    const upload = { $ref: '#/components/schemas/UploadAppVersionInput' };
    const files = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        path: `m${String(index)}.js`,
        content: 'x',
      }));
    const body = (count: number) => ({
      manifest: {},
      bundle: { main: 'm0.js', files: files(count) },
    });
    expect(schemaProblems(upload, body(1))).toEqual([]);
    expect(schemaProblems(upload, body(100))).toEqual([]);
    expect(schemaProblems(upload, body(0)).join('\n')).toMatch(
      /files: fewer than 1 items/,
    );
    expect(schemaProblems(upload, body(101)).join('\n')).toMatch(
      /files: more than 100 items/,
    );
  });

  it('throws on a keyword it does not implement, never passes it silently', () => {
    expect(() => schemaProblems({ oneOf: [{ type: 'string' }] }, 'x')).toThrow(
      /does not implement/,
    );
  });

  it('names an answer at a status the operation does not list', () => {
    const operation = operationFor('GET', '/developer/apps/101');
    expect(operation?.id).toBe('getDeveloperApp');
    if (!operation) return;
    expect(responseProblems(operation, 418, {}).join('\n')).toMatch(
      /getDeveloperApp answered 418, which the document does not list/,
    );
    expect(
      responseProblems(operation, 404, {
        statusCode: 404,
        code: 'APP_HANDLE_TAKEN',
        message: 'm',
      }).join('\n'),
    ).toMatch(/"APP_HANDLE_TAKEN" is not one of/);
  });

  it('finds a literal route before a templated one', () => {
    expect(operationFor('DELETE', '/developer/cli/tokens/current')?.id).toBe(
      'revokeCurrentCliToken',
    );
    expect(operationFor('DELETE', '/developer/cli/tokens/42')?.id).toBe(
      'revokeCliToken',
    );
    expect(operationFor('GET', '/developer/nothing')).toBeUndefined();
  });
});

describe('the fake API', () => {
  it('reports an answer or a request the document does not allow', async () => {
    const harness = await createHarness();
    await harness.signIn();
    const app = harness.fake.seedApp();
    // A test result the API never sends: no duration.
    harness.fake.testResult = { durationMs: undefined };
    await harness.run('webhook', 'trigger', 'orders/created', '--app', app.id);
    await harness.fake.fetch(`${harness.fake.origin}/developer/apps?limit=5`, {
      method: 'GET',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${harness.fake.liveTokens()[0] ?? ''}`,
      },
    });
    await harness.fake.fetch(`${harness.fake.origin}/developer/nothing`, {
      redirect: 'error',
    });
    const found = takeDocumentViolations().join('\n');
    expect(found).toMatch(/sendTestWebhook 200\.data\.durationMs: is missing/);
    expect(found).toMatch(
      /listDeveloperApps request: \?limit is not a parameter/,
    );
    expect(found).toMatch(/GET \/developer\/nothing is not an operation/);
  });

  it('answers as the document says on every route the CLI calls', async () => {
    const harness = await createHarness();
    const used = new Set<string>();
    harness.fake.pollScript = ['pending', 'approve'];
    await harness.run('login', '--json');
    const app = harness.fake.seedApp();
    for (const argv of [
      ['whoami', '--json'],
      ['app', 'list', '--json'],
      ['store', 'list', '--json'],
      ['store', 'create', '--json'],
      ['secrets', 'list', '--app', app.id, '--json'],
      ['webhook', 'deliveries', '--app', app.id, '--json'],
      ['webhook', 'replay', '8001', '--app', app.id, '--json'],
      ['webhook', 'trigger', 'orders/created', '--app', app.id, '--json'],
      ['logout', '--json'],
    ]) {
      await harness.run(...argv);
    }
    for (const request of harness.fake.requests) {
      const operation = operationFor(request.method, request.path);
      if (operation) used.add(operation.id);
    }
    expect([...used].sort()).toEqual(
      [
        'getDeveloperAccount',
        'listAppInstallations',
        'listAppSecrets',
        'listCliTokens',
        'listDevStores',
        'listDeveloperApps',
        'listWebhookDeliveries',
        'createDevStore',
        'pollCliToken',
        'replayWebhookDelivery',
        'revokeCurrentCliToken',
        'sendTestWebhook',
        'startCliSignIn',
      ].sort(),
    );
    // cleanupHarnesses (afterEach) fails the spec on any difference.
  });
});
