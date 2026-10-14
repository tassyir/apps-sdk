import { describe, expect, it } from 'vitest';
import {
  GENERATED_END,
  GENERATED_START,
  anchorOf,
  codeBlocks,
  explainedCodes,
  generatedBlock,
  guideSetProblems,
  headingAnchors,
  leakProblems,
  linkProblems,
  oauthErrors,
  parseGuide,
  problemCodes,
  renderErrorReference,
  withGeneratedBlock,
} from './guides.mjs';

/**
 * @param {string} title
 * @param {number} order
 * @param {string} body
 */
const guide = (title, order, body = '') =>
  `---\ntitle: ${title}\ndescription: What it is for.\norder: ${String(order)}\n---\n\n# ${title}\n${body}`;

describe('parseGuide', () => {
  it('reads the front matter and where the body starts', () => {
    const parsed = parseGuide('webhooks', guide('Webhooks', 70, '\nText.\n'));
    expect(parsed.frontMatter).toEqual({
      title: 'Webhooks',
      description: 'What it is for.',
      order: 70,
    });
    expect(parsed.problems).toEqual([]);
    expect(parsed.bodyLine).toBe(6);
    expect(parsed.body.split('\n')[1]).toBe('# Webhooks');
  });

  it('accepts quoted values', () => {
    const parsed = parseGuide(
      'a',
      '---\ntitle: "A: b"\ndescription: \'One: two.\'\norder: 1\n---\n# A: b\n',
    );
    expect(parsed.problems).toEqual([]);
    expect(parsed.frontMatter?.title).toBe('A: b');
  });

  it('names what is missing or wrong', () => {
    expect(parseGuide('a', '# A\n').problems).toEqual([
      'a.md: starts without front matter (---)',
    ]);
    expect(
      parseGuide(
        'a',
        '---\ntitle: A\ndescription: no full stop\norder: x\nslug: a\n---\n# B\n',
      ).problems,
    ).toEqual([
      'a.md: front matter key "slug" is not one of title, description, order',
      'a.md: the description is one sentence of at most 200 characters, ending with "."',
      'a.md: front matter "order" is not a whole number',
      'a.md: the body must start with "# A"',
    ]);
  });
});

describe('guideSetProblems', () => {
  it('refuses a bad slug and a shared order or title', () => {
    const guides = [
      parseGuide('one', guide('One', 10)),
      parseGuide('Two_2', guide('One', 10)),
    ];
    expect(guideSetProblems(guides)).toEqual([
      'Two_2.md: the file name (the slug) is lowercase words joined by "-"',
      "Two_2.md: order 10 is also one.md's",
      'Two_2.md: title "One" is also one.md\'s',
    ]);
  });
});

describe('codeBlocks', () => {
  it('returns each fence with its language, meta and first line', () => {
    const body =
      'Text\n```ts browser\nconst a = 1;\n```\n\n```toml\nb = 2\n```\n';
    expect(codeBlocks(body, 10)).toEqual([
      { lang: 'ts', meta: 'browser', code: 'const a = 1;', line: 12 },
      { lang: 'toml', meta: '', code: 'b = 2', line: 16 },
    ]);
  });

  it('closes a fence by CommonMark rules: same character, a run at least as long', () => {
    const body = [
      '````md',
      '```ts',
      'inner',
      '```',
      '````  ',
      '~~~toml',
      'a = 1',
      '```',
      '~~~',
      '  ```json',
      '  {}',
      '  ```',
      '``` not`a fence',
    ].join('\n');
    expect(codeBlocks(body, 1)).toEqual([
      { lang: 'md', meta: '', code: '```ts\ninner\n```', line: 2 },
      { lang: 'toml', meta: '', code: 'a = 1\n```', line: 7 },
      { lang: 'json', meta: '', code: '{}', line: 11 },
    ]);
    expect([
      ...headingAnchors('````md\n```\n## Inside\n````\n## Out\n'),
    ]).toEqual(['out']);
  });

  it('throws on a fence that never closes', () => {
    expect(() => codeBlocks('```ts\nx\n', 1)).toThrow(/never closes/);
  });
});

describe('headingAnchors', () => {
  it('slugs headings the way GitHub does, outside code', () => {
    expect(anchorOf('Embedded apps: one offline token')).toBe(
      'embedded-apps-one-offline-token',
    );
    expect(anchorOf('`PERMISSION_DENIED`')).toBe('permission_denied');
    expect(anchorOf('Stores: 460, and 404')).toBe('stores-460-and-404');
    expect([
      ...headingAnchors(
        '# A\n## Errors\n```md\n## Not a heading\n```\n## Errors\n',
      ),
    ]).toEqual(['a', 'errors', 'errors-1']);
  });
});

describe('linkProblems', () => {
  const guides = [
    parseGuide(
      'one',
      guide(
        'One',
        10,
        [
          '',
          '## Part',
          '[ok](two.md#more) [here](#part) [web](https://tassyir.io)',
          '[code `x](nope.md)` is ignored',
          '```md',
          '[in code](nope.md)',
          '```',
          '[missing](three.md) [anchor](two.md#none) [http](http://example.com)',
          '[private](https://github.com/tassyir/backend/blob/master/x.md)',
          '[sdk](https://github.com/tassyir/apps-sdk/tree/main/packages/app)',
        ].join('\n'),
      ),
    ),
    parseGuide('two', guide('Two', 20, '\n## More\n')),
  ];

  it('names every broken, insecure or private link', () => {
    expect(linkProblems(guides)).toEqual([
      'one.md:15: "three.md" is not a guide (link another guide as "<slug>.md")',
      'one.md:15: "two.md#none": two.md has no heading #none',
      'one.md:15: "http://example.com" is not an https link',
      'one.md:16: "https://github.com/tassyir/backend/blob/master/x.md" is a private repository',
    ]);
  });
});

describe('leakProblems', () => {
  it('flags what names Tassyir internals', () => {
    expect(
      leakProblems(
        'x.md',
        [
          'Fine: the Admin API answers 429 RATE_LIMITED.',
          'See src/app-platform/api and AppAuthGuard.',
          'Stored in app_installations under apps:tok:<hash>.',
          'Set APPS_WEBHOOK_KEYS (AP-B0.8).',
        ].join('\n'),
      ),
    ).toEqual([
      'x.md:2: "src/app-platform" names a backend source path',
      'x.md:2: "AppAuthGuard" names a backend class',
      'x.md:3: "app_installations" names a database table',
      'x.md:3: "apps:tok" names a cache key',
      'x.md:4: "APPS_WEBHOOK_KEYS" names an environment variable',
      'x.md:4: "AP-B0" names a ticket id',
    ]);
  });
});

/** A small OpenAPI document: two operations, a shared response, the token endpoint. */
const DOCUMENT = {
  info: { version: '2026-10' },
  paths: {
    '/apps/2026-10/orders': {
      get: {
        responses: {
          200: { description: 'ok' },
          403: problem(['PERMISSION_DENIED']),
          429: { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/apps/2026-10/orders/{id}/confirm': {
      post: {
        responses: {
          403: problem(['ORDER_LIMIT_REACHED', 'PERMISSION_DENIED']),
          429: { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/apps/oauth/token': {
      post: {
        responses: {
          400: {
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/OAuthError' },
                    { properties: { error: { enum: ['invalid_grant'] } } },
                  ],
                },
              },
            },
          },
          401: {
            content: {
              'application/json': {
                schema: { properties: { error: { enum: ['invalid_client'] } } },
              },
            },
          },
        },
      },
    },
  },
  components: { responses: { RateLimited: problem(['RATE_LIMITED']) } },
};

/** @param {string[]} codes */
function problem(codes) {
  return {
    content: {
      'application/problem+json': {
        schema: {
          allOf: [
            { $ref: '#/components/schemas/Problem' },
            { properties: { code: { enum: codes } } },
          ],
        },
      },
    },
  };
}

describe('the error reference', () => {
  it('collects every code with its statuses and operations', () => {
    const { codes, operations } = problemCodes(DOCUMENT);
    expect(operations).toBe(2);
    expect([...codes.keys()].sort()).toEqual([
      'ORDER_LIMIT_REACHED',
      'PERMISSION_DENIED',
      'RATE_LIMITED',
    ]);
    expect(codes.get('ORDER_LIMIT_REACHED')).toEqual({
      statuses: new Set([403]),
      operations: new Set(['POST /orders/{id}/confirm']),
    });
    expect(oauthErrors(DOCUMENT)).toEqual(
      new Map([
        ['invalid_grant', new Set([400])],
        ['invalid_client', new Set([401])],
      ]),
    );
  });

  it('renders the generated block, every operation summarised', () => {
    const block = renderErrorReference(DOCUMENT);
    expect(block.startsWith(GENERATED_START)).toBe(true);
    expect(block.endsWith(GENERATED_END)).toBe(true);
    expect(block).toContain(
      '| `ORDER_LIMIT_REACHED` | 403 | `POST /orders/{id}/confirm` |',
    );
    expect(block).toContain('| `PERMISSION_DENIED` | 403 | every operation |');
    expect(block).toContain('| `invalid_client` | 401 |');
  });

  it('replaces only the generated block, and reads the explained codes', () => {
    const file = `# Errors\n\n### \`RATE_LIMITED\`\n\nWait.\n\n${GENERATED_START}\nold\n${GENERATED_END}\n`;
    const next = withGeneratedBlock(
      file,
      `${GENERATED_START}\nnew\n${GENERATED_END}`,
    );
    expect(next).toBe(file.replace('old', 'new'));
    expect(generatedBlock(next)).toBe(
      `${GENERATED_START}\nnew\n${GENERATED_END}`,
    );
    expect(explainedCodes(next)).toEqual(['RATE_LIMITED']);
    expect(() => withGeneratedBlock('# Errors\n', 'x')).toThrow(/no "/);
  });
});
