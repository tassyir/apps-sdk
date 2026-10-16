import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MANIFEST_VOCABULARY } from '@tassyir/app-manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONTENT, createHarness } from './harness.test-helpers.js';
import type { Harness } from './harness.test-helpers.js';

// search_docs, fetch_doc, get_api_operation and get_event_schema over the
// repo's own guides and OpenAPI documents, through the MCP SDK's client.

let harness: Harness;
beforeAll(async () => {
  harness = await createHarness();
});
afterAll(async () => {
  await harness.close();
});

interface Result {
  kind: string;
  title: string;
  snippet: string;
  open: { tool: string; arguments: Record<string, string> };
}

async function searchFor(query: string, limit?: number): Promise<Result[]> {
  const answer = await harness.ok('search_docs', {
    query,
    ...(limit === undefined ? {} : { limit }),
  });
  return answer['results'] as Result[];
}

async function guideSlugs(): Promise<string[]> {
  return (await readdir(CONTENT.guides))
    .filter((file) => file.endsWith('.md') && file !== 'README.md')
    .map((file) => file.slice(0, -3));
}

interface Document {
  paths: Record<string, Record<string, { operationId?: string }>>;
  webhooks: Record<string, unknown>;
  components: { schemas: Record<string, unknown> };
}

const OPENAPI = JSON.parse(await readFile(CONTENT.openapi, 'utf8')) as Document;
const DEVELOPER_OPENAPI = JSON.parse(
  await readFile(CONTENT.developerOpenapi ?? '', 'utf8'),
) as Document;

function operationIdsOf(document: Document): string[] {
  return Object.values(document.paths).flatMap((item) =>
    Object.values(item).flatMap((operation) =>
      operation.operationId ? [operation.operationId] : [],
    ),
  );
}

describe('search_docs', () => {
  it.each([
    [
      'verify webhook signature',
      'fetch_doc',
      { slug: 'webhooks', section: 'verify-every-delivery' },
    ],
    [
      'refresh token',
      'fetch_doc',
      { slug: 'tokens', section: 'refresh-safely' },
    ],
    [
      'create an order',
      'fetch_doc',
      { slug: 'orders', section: 'create-an-order' },
    ],
    ['orders/created', 'get_event_schema', { topic: 'orders/created' }],
    ['bulk export', 'get_api_operation', { operation: 'createBulkExport' }],
    [
      'dev store',
      'fetch_doc',
      { slug: 'getting-started', section: '4-create-a-dev-store' },
    ],
  ])('finds "%s" first', async (query, tool, args) => {
    const [first] = await searchFor(query);
    expect(first?.open).toEqual({ tool, arguments: args });
    expect(first?.snippet.length ?? 0).toBeGreaterThan(20);
    expect(first?.snippet.length ?? 0).toBeLessThanOrEqual(242);
  });

  it('finds an error code in the error reference and the operations that answer it', async () => {
    const results = await searchFor('BULK_EXPORT_RATE_LIMITED', 5);
    expect(results.map((result) => result.open.tool)).toContain('fetch_doc');
    expect(
      results.map((result) => result.open.arguments['operation']),
    ).toContain('createBulkExport');
  });

  it('answers the same query the same way, and respects limit', async () => {
    const once = await searchFor('webhook retries', 7);
    const twice = await searchFor('webhook retries', 7);
    expect(once).toEqual(twice);
    expect(once).toHaveLength(7);
    expect(await searchFor('webhook retries')).toEqual(once.slice(0, 5));
  });

  it('refuses a query made of common words only', async () => {
    const error = await harness.refused('search_docs', {
      query: 'how do I do it',
    });
    expect(error.code).toBe('QUERY_EMPTY');
    expect(error.fix).toMatch(/specific words/);
  });

  it('answers an empty list when nothing matches', async () => {
    expect(await searchFor('xylophonequasar')).toEqual([]);
  });

  it("every result's `open` reads it", async () => {
    for (const query of ['scopes', 'app data', 'stock adjust', 'uninstall']) {
      for (const result of await searchFor(query, 10)) {
        await harness.ok(result.open.tool, result.open.arguments);
      }
    }
  });
});

describe('fetch_doc', () => {
  it('lists every guide without a slug, README.md left out', async () => {
    const answer = await harness.ok('fetch_doc');
    const guides = answer['guides'] as {
      slug: string;
      title: string;
      description: string;
    }[];
    expect(guides.map((guide) => guide.slug).sort()).toEqual(
      (await guideSlugs()).sort(),
    );
    expect(guides[0]?.slug).toBe('index');
    for (const guide of guides) {
      expect(guide.title).not.toBe('');
      expect(guide.description).toMatch(/\.$/);
    }
  });

  it('reads every page of every guide, all of the guide, each under the size limit', async () => {
    for (const slug of await guideSlugs()) {
      const source = await readFile(join(CONTENT.guides, `${slug}.md`), 'utf8');
      let read = '';
      let pages = 1;
      for (let page = 1; page <= pages; page += 1) {
        const answer = await harness.ok('fetch_doc', { slug, page });
        pages = answer['pages'] as number;
        expect(answer['source']).toBe(
          slug === 'index'
            ? 'https://developers.tassyir.io/guides'
            : `https://developers.tassyir.io/guides/${slug}`,
        );
        if (page === 1) expect(answer['outline']).toBeDefined();
        else expect(answer['outline']).toBeUndefined();
        read += `${answer['markdown'] as string}\n`;
      }
      // Every word of the body is there, in order (tables lose their padding).
      const words = (text: string) =>
        text.replace(/-{3,}/g, '---').split(/\s+/).filter(Boolean);
      const body = source.replace(/^---\n[\s\S]*?\n---\n/, '');
      expect([slug, words(read)]).toEqual([slug, words(body)]);
    }
  });

  it('reads one section, and every link between guides names a section it can read', async () => {
    const answer = await harness.ok('fetch_doc', {
      slug: 'webhooks',
      section: 'topics',
    });
    expect(answer['section']).toEqual({ anchor: 'topics', title: 'Topics' });
    expect(answer['markdown']).toMatch(/^## Topics\n/);
    expect(answer['markdown']).toContain('bulk/finished');
    expect(answer['source']).toBe(
      'https://developers.tassyir.io/guides/webhooks#topics',
    );

    let checked = 0;
    for (const slug of await guideSlugs()) {
      const source = await readFile(join(CONTENT.guides, `${slug}.md`), 'utf8');
      for (const match of source.matchAll(
        /\]\(([a-z0-9-]+)\.md#([^)\s]+)\)/g,
      )) {
        const [, target = '', section = ''] = match;
        const read = await harness.ok('fetch_doc', { slug: target, section });
        expect(read['slug']).toBe(target);
        checked += 1;
      }
      for (const match of source.matchAll(/\]\(#([^)\s]+)\)/g)) {
        await harness.ok('fetch_doc', { slug, section: match[1] ?? '' });
        checked += 1;
      }
      for (const match of source.matchAll(/\]\(([a-z0-9-]+)\.md\)/g)) {
        await harness.ok('fetch_doc', { slug: match[1] ?? '' });
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(60);
  });

  it('refuses an unknown guide, section or page with what exists', async () => {
    const guide = await harness.refused('fetch_doc', { slug: 'webhook' });
    expect(guide.code).toBe('DOC_NOT_FOUND');
    expect(guide.fix).toContain('webhooks');
    const section = await harness.refused('fetch_doc', {
      slug: 'webhooks',
      section: 'nope',
    });
    expect(section.code).toBe('SECTION_NOT_FOUND');
    expect(section.fix).toContain('verify-every-delivery');
    const page = await harness.refused('fetch_doc', {
      slug: 'stock',
      page: 99,
    });
    expect(page.code).toBe('PAGE_OUT_OF_RANGE');
  });
});

describe('get_api_operation', () => {
  const operationIds = operationIdsOf(OPENAPI);

  it('lists every operation with no argument', async () => {
    const answer = await harness.ok('get_api_operation');
    expect(answer['api']).toBe('admin');
    const operations = answer['operations'] as {
      id: string;
      sdkPath: string;
    }[];
    expect(operations.map((operation) => operation.id)).toEqual(operationIds);
    expect(
      operations.find((operation) => operation.id === 'createBulkExport')
        ?.sdkPath,
    ).toBe('/bulk/exports');
  });

  it('renders every operation under the size limit, naming only schemas that exist', async () => {
    for (const id of operationIds) {
      const answer = await harness.ok('get_api_operation', { operation: id });
      expect((answer['operation'] as { id: string }).id).toBe(id);
      expect(answer['api']).toBe('admin');
      for (const name of answer['schemas'] as string[]) {
        expect([id, name in OPENAPI.components.schemas]).toEqual([id, true]);
      }
      expect(JSON.stringify(answer)).not.toMatch(/docs\/api\/apps/);
    }
  });

  it('answers the scope, the body and every error code of an operation', async () => {
    const answer = await harness.ok('get_api_operation', {
      operation: 'POST /bulk/exports',
    });
    const operation = answer['operation'] as Record<string, unknown>;
    expect(operation).toMatchObject({
      id: 'createBulkExport',
      method: 'POST',
      path: '/apps/2026-10/bulk/exports',
      sdkPath: '/bulk/exports',
      access: {
        'permission-by-resource': {
          orders: 'orders:read',
          products: 'products:read',
          customers: 'customers:read',
        },
      },
      requestBody: { required: true, schemaName: 'CreateBulkExportInput' },
    });
    expect(operation['errors']).toContainEqual({
      status: '429',
      codes: [
        'BULK_EXPORT_RATE_LIMITED',
        'BUSINESS_RATE_LIMITED',
        'RATE_LIMITED',
      ],
    });
    expect(operation['parameters']).toContainEqual(
      expect.objectContaining({
        name: 'Idempotency-Key',
        in: 'header',
      }) as unknown,
    );
    expect(answer['schemas']).toContain('BulkExport');
  });

  it.each([
    ['getOrder', 'getOrder'],
    ['GETORDER', 'getOrder'],
    ['GET /orders/{id}', 'getOrder'],
    ['GET /orders/741000000000032000', 'getOrder'],
    ['GET /apps/2026-10/orders/:id', 'getOrder'],
    ['POST /apps/oauth/token', 'requestAccessToken'],
    [
      'POST https://api.tassyir.io/apps/2026-10/bulk/exports',
      'createBulkExport',
    ],
    ['GET /bulk/exports/', 'listBulkExports'],
  ])('finds %s', async (asked, id) => {
    const answer = await harness.ok('get_api_operation', { operation: asked });
    expect((answer['operation'] as { id: string }).id).toBe(id);
  });

  it('refuses an unknown or ambiguous operation with the close ones', async () => {
    const unknown = await harness.refused('get_api_operation', {
      operation: 'createBulkExports',
    });
    expect(unknown.code).toBe('OPERATION_NOT_FOUND');
    expect(unknown.fix).toContain('createBulkExport');
    const ambiguous = await harness.refused('get_api_operation', {
      operation: '/orders/{id}',
    });
    expect(ambiguous.code).toBe('OPERATION_AMBIGUOUS');
    expect(ambiguous.fix).toContain('getOrder');
    const both = await harness.refused('get_api_operation', {
      operation: 'getOrder',
      schema: 'Order',
    });
    expect(both.code).toBe('INVALID_ARGUMENT');
  });

  it('renders every component schema under the size limit', async () => {
    for (const name of Object.keys(OPENAPI.components.schemas)) {
      const answer = await harness.ok('get_api_operation', { schema: name });
      expect((answer['schema'] as { name: string }).name).toBe(name);
      for (const ref of answer['schemas'] as string[]) {
        expect(ref in OPENAPI.components.schemas).toBe(true);
      }
    }
    const order = await harness.ok('get_api_operation', { schema: 'order' });
    expect((order['schema'] as { name: string }).name).toBe('Order');
    const missing = await harness.refused('get_api_operation', {
      schema: 'OrderLine',
    });
    expect(missing.code).toBe('SCHEMA_NOT_FOUND');
  });
});

describe('get_api_operation, developer API', () => {
  const operationIds = operationIdsOf(DEVELOPER_OPENAPI);

  it('lists every developer operation with api "developer"', async () => {
    const answer = await harness.ok('get_api_operation', { api: 'developer' });
    expect(answer['api']).toBe('developer');
    const operations = answer['operations'] as {
      id: string;
      sdkPath: string;
    }[];
    expect(operations.map((operation) => operation.id)).toEqual(operationIds);
    expect(operationIds.length).toBeGreaterThanOrEqual(30);
    expect(
      operations.find((operation) => operation.id === 'listDeveloperApps')
        ?.sdkPath,
    ).toBe('/developer/apps');
  });

  it('renders every developer operation under the size limit, naming only its own schemas', async () => {
    for (const id of operationIds) {
      // Found by id without naming the API: ids never repeat across the two.
      const answer = await harness.ok('get_api_operation', { operation: id });
      expect([id, answer['api']]).toEqual([id, 'developer']);
      expect((answer['operation'] as { id: string }).id).toBe(id);
      for (const name of answer['schemas'] as string[]) {
        expect([id, name in DEVELOPER_OPENAPI.components.schemas]).toEqual([
          id,
          true,
        ]);
      }
      expect(JSON.stringify(answer)).not.toMatch(/docs\/api\/apps/);
    }
  });

  it('answers the credential, every code and the bodies without a code', async () => {
    const answer = await harness.ok('get_api_operation', {
      operation: 'POST /developer/apps',
    });
    const operation = answer['operation'] as Record<string, unknown>;
    expect(operation).toMatchObject({
      id: 'createDeveloperApp',
      method: 'POST',
      path: '/developer/apps',
      sdkPath: null,
      auth: ['dashboardSession (HTTP bearer)', 'developerToken (HTTP bearer)'],
      access: { auth: 'developer' },
      requestBody: { required: true, schemaName: 'CreateDeveloperAppInput' },
    });
    expect(operation['errors']).toContainEqual({
      status: '400',
      codes: [
        'APP_CUSTOM_BUSINESS_NOT_FOUND',
        'APP_FIELDS_INVALID',
        'APP_HOSTING_NOT_AVAILABLE',
        'BAD_REQUEST',
      ],
      shapes: ['DeveloperError', 'ValidationError'],
    });
    expect(operation['errors']).toContainEqual({
      status: '429',
      codes: ['DEVELOPER_TOKEN_RATE_LIMITED'],
      shapes: ['DeveloperError', 'RateLimitError'],
    });
    expect(answer['schemas']).toEqual(
      expect.arrayContaining([
        'DeveloperApp',
        'DeveloperError',
        'RateLimitError',
        'ValidationError',
      ]) as unknown,
    );

    const poll = await harness.ok('get_api_operation', {
      operation: 'pollCliToken',
    });
    expect(poll['operation']).toMatchObject({
      auth: [],
      access: { auth: 'none' },
      requestBody: {
        contentType: 'application/x-www-form-urlencoded',
        schemaName: 'DeviceTokenRequest',
      },
    });
    expect((poll['operation'] as { errors: unknown[] }).errors).toContainEqual({
      status: '429',
      codes: ['slow_down'],
      shapes: ['OAuthError', 'RateLimitError'],
    });
  });

  it.each([
    ['listDeveloperApps', {}, 'listDeveloperApps'],
    ['GET /developer/apps/{appId}', {}, 'getDeveloperApp'],
    ['GET /developer/apps/741000000000032000', {}, 'getDeveloperApp'],
    ['DELETE /developer/cli/tokens/current', {}, 'revokeCurrentCliToken'],
    ['DELETE /developer/cli/tokens/42', {}, 'revokeCliToken'],
    [
      'POST https://api.tassyir.io/developer/dev-stores',
      { api: 'developer' },
      'createDevStore',
    ],
  ])('finds %s', async (asked, extra, id) => {
    const answer = await harness.ok('get_api_operation', {
      operation: asked,
      ...extra,
    });
    expect((answer['operation'] as { id: string }).id).toBe(id);
    expect(answer['api']).toBe('developer');
  });

  it('keeps each API to its own operations when asked for one', async () => {
    const admin = await harness.refused('get_api_operation', {
      operation: 'listDeveloperApps',
      api: 'admin',
    });
    expect(admin.code).toBe('OPERATION_NOT_FOUND');
    expect(admin.message).toMatch(/^No Admin API operation/);
    const developer = await harness.refused('get_api_operation', {
      operation: 'GET /orders/{id}',
      api: 'developer',
    });
    expect(developer.code).toBe('OPERATION_NOT_FOUND');
    expect(developer.fix).toContain('{ "api": "developer" }');
    const neither = await harness.refused('get_api_operation', {
      operation: 'createDeveloperApps',
    });
    expect(neither.message).toMatch(/^No Admin API or developer API operation/);
    expect(neither.fix).toContain('createDeveloperApp');
  });

  it('renders every developer schema; a name in both documents is the Admin API one unless asked', async () => {
    for (const name of Object.keys(DEVELOPER_OPENAPI.components.schemas)) {
      const answer = await harness.ok('get_api_operation', {
        schema: name,
        api: 'developer',
      });
      expect((answer['schema'] as { name: string }).name).toBe(name);
      for (const ref of answer['schemas'] as string[]) {
        expect(ref in DEVELOPER_OPENAPI.components.schemas).toBe(true);
      }
      expect(JSON.stringify(answer)).not.toMatch(/docs\/api\/apps/);
    }
    const app = await harness.ok('get_api_operation', {
      schema: 'DeveloperApp',
    });
    expect(app['api']).toBe('developer');
    const shared = Object.keys(DEVELOPER_OPENAPI.components.schemas).filter(
      (name) => name in OPENAPI.components.schemas,
    );
    expect(shared).toContain('ServerError');
    for (const name of shared) {
      const plain = await harness.ok('get_api_operation', { schema: name });
      expect([name, plain['api']]).toEqual([name, 'admin']);
      const developer = await harness.ok('get_api_operation', {
        schema: name,
        api: 'developer',
      });
      expect([name, developer['api']]).toEqual([name, 'developer']);
    }
  });
});

describe('get_event_schema', () => {
  it("lists the topics of the manifest's vocabulary, each the API documents", async () => {
    const answer = await harness.ok('get_event_schema');
    const topics = answer['topics'] as {
      topic: string;
      scope: string | null;
    }[];
    const vocabulary = MANIFEST_VOCABULARY.topics;
    expect(topics.map((topic) => topic.topic).sort()).toEqual(
      vocabulary.map((topic) => topic.name).sort(),
    );
    expect(Object.keys(OPENAPI.webhooks).sort()).toEqual(
      vocabulary.map((topic) => topic.name).sort(),
    );
    for (const topic of topics) {
      expect([topic.topic, topic.scope]).toEqual([
        topic.topic,
        vocabulary.find((entry) => entry.name === topic.topic)?.scope,
      ]);
    }
  });

  it('renders every topic: headers, envelope, resource and the answer to give', async () => {
    for (const { name } of MANIFEST_VOCABULARY.topics) {
      const answer = await harness.ok('get_event_schema', { topic: name });
      const event = answer['event'] as Record<string, unknown>;
      expect(event['topic']).toBe(name);
      expect(
        (event['headers'] as { name: string }[]).map((header) => header.name),
      ).toContain('webhook-signature');
      expect(event['body']).toMatchObject({
        schemaName: expect.stringMatching(/^Webhook/) as unknown,
      });
      expect(Object.keys(event['answer'] as object)).toContain('2XX');
    }
    const finished = await harness.ok('get_event_schema', {
      topic: 'bulk/finished',
    });
    expect(finished['schemas']).toContain('BulkExport');
  });

  it('refuses an unknown topic with the list', async () => {
    const error = await harness.refused('get_event_schema', {
      topic: 'orders/exploded',
    });
    expect(error.code).toBe('TOPIC_NOT_FOUND');
    expect(error.fix).toContain('bulk/finished');
  });
});

describe('the seams', () => {
  it.each(['tail_logs'])(
    '%s answers TOOL_NOT_AVAILABLE with what to do instead',
    async (name) => {
      for (const args of [{}, { anything: 'goes' }]) {
        const error = await harness.refused(name, args);
        expect(error.code).toBe('TOOL_NOT_AVAILABLE');
        expect(error.message).toMatch(
          new RegExp(`^${name} is not available yet: `),
        );
        expect(error.fix.length).toBeGreaterThan(20);
      }
    },
  );
});
