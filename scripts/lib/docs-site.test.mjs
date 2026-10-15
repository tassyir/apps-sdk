import { describe, expect, it } from 'vitest';
import { GENERATED_END, GENERATED_START, parseGuide } from './guides.mjs';
import {
  codeExplanations,
  errorPages,
  escapeMdx,
  guideLink,
  guidePage,
  hexOf,
  kebab,
  mapProse,
  navigation,
  navigationPages,
  operationRoute,
  packageLink,
  packagePage,
  themeSettings,
} from './docs-site.mjs';

/**
 * @param {string} slug
 * @param {string} title
 * @param {number} order
 * @param {string} body
 */
const guide = (slug, title, order, body = '') =>
  parseGuide(
    slug,
    `---\ntitle: ${title}\ndescription: What it is for.\norder: ${String(order)}\n---\n\n# ${title}\n${body}`,
  );

/** @type {import('./guides.mjs').OpenApiDocument} */
const DOCUMENT = {
  info: { version: '2026-10' },
  paths: {
    '/apps/2026-10/orders': {
      get: {
        tags: ['Orders'],
        summary: 'List orders',
        responses: { 401: { $ref: '#/components/responses/Unauthorized' } },
      },
    },
    '/apps/2026-10/orders/{id}/comments': {
      get: {
        tags: ['Orders'],
        summary: "List an order's comments",
        responses: {
          401: { $ref: '#/components/responses/Unauthorized' },
          403: problem(['PERMISSION_DENIED']),
        },
      },
    },
  },
  components: {
    responses: { Unauthorized: problem(['APP_TOKEN_REQUIRED']) },
  },
  'x-tassyir-errors': {
    APP_TOKEN_REQUIRED: {
      title: 'Token required',
      statuses: [401],
      fix: 'Send the access token as Authorization: Bearer {token}.',
    },
    CONFLICT: {
      title: 'Conflict',
      statuses: [409],
      fix: 'Read the resource again.',
      fallback: 'A refusal with HTTP 409 that carries no more specific code.',
    },
    PERMISSION_DENIED: { title: 'Permission denied', statuses: [403] },
  },
};

/** @param {string[]} codes */
function problem(codes) {
  return {
    content: {
      'application/problem+json': {
        schema: { properties: { code: { enum: codes } } },
      },
    },
  };
}

describe('kebab', () => {
  it('turns a code into the end of its problem type, as the API does', () => {
    expect(kebab('PERMISSION_DENIED')).toBe('permission-denied');
    expect(kebab('API_BUSY')).toBe('api-busy');
  });
});

describe('escapeMdx and mapProse', () => {
  it('escapes what MDX would read as an expression or a tag', () => {
    expect(escapeMdx('a {b} < c')).toBe('a \\{b\\} \\< c');
    expect(escapeMdx('kept \\{ and \\<')).toBe('kept \\{ and \\<');
  });

  it('drops HTML comments and turns autolinks into links', () => {
    expect(escapeMdx('<!-- note -->x <https://tassyir.io/a>')).toBe(
      'x [https://tassyir.io/a](https://tassyir.io/a)',
    );
  });

  it('leaves fenced code and code spans byte for byte', () => {
    const markdown = [
      'Use `{ data }` or ``a ` {b}`` here {c}.',
      '',
      '```ts',
      'const x = { a: 1 } < 2;',
      '```',
      'and {d}',
    ].join('\n');
    expect(mapProse(markdown, escapeMdx)).toBe(
      [
        'Use `{ data }` or ``a ` {b}`` here \\{c\\}.',
        '',
        '```ts',
        'const x = { a: 1 } < 2;',
        '```',
        'and \\{d\\}',
      ].join('\n'),
    );
  });

  it('reads a code span across a line break but not across paragraphs', () => {
    expect(mapProse('`a\n{b}` {c}', escapeMdx)).toBe('`a\n{b}` \\{c\\}');
    expect(mapProse('`a\n\n{b}` x', escapeMdx)).toBe('`a\n\n\\{b\\}` x');
  });
});

describe('guideLink', () => {
  it('makes a link to another guide a site path', () => {
    expect(guideLink('webhooks.md')).toBe('/guides/webhooks');
    expect(guideLink('webhooks.md#topics')).toBe('/guides/webhooks#topics');
    expect(guideLink('index.md')).toBe('/guides');
  });

  it('keeps same-page anchors, unless the text moves to another page', () => {
    expect(guideLink('#the-shape')).toBe('#the-shape');
    expect(guideLink('#the-shape', 'errors')).toBe('/guides/errors#the-shape');
  });

  it('keeps absolute links and refuses anything else', () => {
    expect(guideLink('https://tassyir.io')).toBe('https://tassyir.io');
    expect(() => guideLink('../RELEASING.md')).toThrow(/not a link to a guide/);
  });
});

describe('packageLink', () => {
  it('links packages to their pages and the rest of the repo to GitHub', () => {
    expect(packageLink('../cli', 'dev-mcp')).toBe('/packages/cli');
    expect(packageLink('../app-manifest#install', 'cli')).toBe(
      '/packages/app-manifest#install',
    );
    expect(packageLink('../../docs/guides/tokens.md', 'app')).toBe(
      '/guides/tokens',
    );
    expect(packageLink('LICENSE', 'ui')).toBe(
      'https://github.com/tassyir/apps-sdk/blob/main/packages/ui/LICENSE',
    );
    expect(packageLink('../../docs/APP_MANIFEST.md', 'app-manifest')).toBe(
      'https://github.com/tassyir/apps-sdk/blob/main/docs/APP_MANIFEST.md',
    );
    expect(packageLink('#tools', 'dev-mcp')).toBe('#tools');
  });

  it('refuses a link that leaves the repository', () => {
    expect(() => packageLink('../../../x', 'ui')).toThrow(/leaves/);
  });
});

describe('guidePage', () => {
  it('keeps the title and description, drops the # title, rewrites links', () => {
    const page = guidePage(
      guide(
        'tokens',
        'Tokens',
        50,
        '\nSee [Webhooks](webhooks.md#topics), `{ id }` and {x}.\n',
      ),
    );
    expect(page).toBe(
      [
        '---',
        'title: "Tokens"',
        'description: "What it is for."',
        '---',
        '',
        '{/* Generated by `npm run docs:sync` from docs/guides/tokens.md: edit that, not this file. */}',
        '',
        'See [Webhooks](/guides/webhooks#topics), `{ id }` and \\{x\\}.',
        '',
      ].join('\n'),
    );
  });

  it("links the error guide's table rows to the codes' pages", () => {
    const page = guidePage(
      guide(
        'errors',
        'Errors',
        170,
        `\n${GENERATED_START}\n\n| \`API_BUSY\` | 503 |\n| \`OTHER\`    | 400 |\n\n${GENERATED_END}\n`,
      ),
      new Set(['API_BUSY']),
    );
    expect(page).toContain('| [`API_BUSY`](/errors/api-busy) | 503 |');
    expect(page).toContain('| `OTHER`    | 400 |');
    expect(page).not.toContain('<!--');
  });

  it('refuses a guide with problems', () => {
    expect(() => guidePage(parseGuide('a', '# A\n'))).toThrow(/front matter/);
  });
});

describe('error pages', () => {
  const guideSource = [
    '# Errors',
    '',
    '### `PERMISSION_DENIED`',
    '',
    'HTTP 403. See [Scopes](scopes-and-consent.md) and [below](#token-endpoint-errors).',
    '',
    '## Other',
    '',
    GENERATED_START,
    '### `APP_TOKEN_REQUIRED`',
    'generated, not an explanation',
    GENERATED_END,
  ].join('\n');

  it('reads the hand-written explanations only', () => {
    expect([...codeExplanations(guideSource)]).toEqual([
      [
        'PERMISSION_DENIED',
        'HTTP 403. See [Scopes](scopes-and-consent.md) and [below](#token-endpoint-errors).',
      ],
    ]);
  });

  it('routes an operation the way Mintlify slugs it', () => {
    expect(
      operationRoute(
        DOCUMENT,
        'GET /orders/{id}/comments',
        'api-reference/admin',
      ),
    ).toBe('/api-reference/admin/orders/list-an-orders-comments');
    expect(() =>
      operationRoute(DOCUMENT, 'GET /nope', 'api-reference/admin'),
    ).toThrow(/no tag or summary/);
  });

  it('writes one page per code, at its type URL, with what to do', () => {
    const pages = errorPages(DOCUMENT, guideSource, 'api-reference/admin');
    expect([...pages.keys()]).toEqual([
      'errors/app-token-required.mdx',
      'errors/conflict.mdx',
      'errors/hosted-path-not-allowed.mdx',
      'errors/permission-denied.mdx',
      'errors/response-too-large.mdx',
      'errors/tassyir-binding-not-available.mdx',
    ]);
    const denied = pages.get('errors/permission-denied.mdx') ?? '';
    expect(denied).toContain('title: "PERMISSION_DENIED"');
    expect(denied).toContain(
      'description: "HTTP 403, from GET /orders/{id}/comments."',
    );
    expect(denied).toContain(
      '`https://developers.tassyir.io/errors/permission-denied`',
    );
    expect(denied).toContain(
      'See [Scopes](/guides/scopes-and-consent) and [below](/guides/errors#token-endpoint-errors).',
    );
    expect(denied).toContain(
      '- [`GET /orders/{id}/comments`](/api-reference/admin/orders/list-an-orders-comments)',
    );
    expect(denied).toContain('its `title`: Permission denied.');
    expect(denied).not.toContain("The answer's `fix`");
    const required = pages.get('errors/app-token-required.mdx') ?? '';
    expect(required).toContain(
      'description: "HTTP 401, from every operation of the Admin API."',
    );
    // No guide text: the catalogue's fix, braces escaped for MDX.
    expect(required).toContain(
      'Send the access token as Authorization: Bearer \\{token\\}.',
    );
  });

  it("writes the catalogue's fallback codes no operation lists", () => {
    const pages = errorPages(DOCUMENT, guideSource, 'api-reference/admin');
    const conflict = pages.get('errors/conflict.mdx') ?? '';
    expect(conflict).toContain(
      'description: "A refusal with HTTP 409 that carries no more specific code."',
    );
    expect(conflict).toContain('Read the resource again.');
    expect(conflict).toContain(
      'The code of a refusal with HTTP 409 that carries no more specific code. Any operation may answer it.',
    );
  });

  it("writes the hosted binding's own codes, which the document never lists", () => {
    const pages = errorPages(DOCUMENT, guideSource, 'api-reference/admin');
    const path = pages.get('errors/hosted-path-not-allowed.mdx') ?? '';
    expect(path).toContain(
      'description: "HTTP 400, from a hosted app\'s TASSYIR binding, before the Admin API."',
    );
    expect(path).toContain('its `title`: Not an Admin API path.');
    expect(path).toContain("Read the answer's `fix`");
    expect(path).toContain(
      '[Tassyir Hosting](/guides/tassyir-hosting#call-the-admin-api)',
    );
    expect(pages.get('errors/response-too-large.mdx')).toContain('HTTP 502');
  });
});

describe('packagePage', () => {
  it('titles the page with the package name and drops the README heading', () => {
    expect(
      packagePage({
        folder: 'cli',
        name: 'tassyir',
        description: 'The CLI.',
        readme: '# tassyir\n\nUses [the validator](../app-manifest) {here}.\n',
      }),
    ).toBe(
      [
        '---',
        'title: "tassyir"',
        'description: "The CLI."',
        '---',
        '',
        '{/* Generated by `npm run docs:sync` from packages/cli/README.md: edit that, not this file. */}',
        '',
        'Uses [the validator](/packages/app-manifest) \\{here\\}.',
        '',
      ].join('\n'),
    );
  });

  it('refuses a README that does not start with the package name', () => {
    expect(() =>
      packagePage({
        folder: 'ui',
        name: '@tassyir/ui',
        description: '',
        readme: '# UI\n',
      }),
    ).toThrow(/# @tassyir\/ui/);
  });
});

describe('navigation', () => {
  it('lists the guides in front-matter order, then every code and package', () => {
    const nav = navigation({
      guides: [guide('b', 'B', 20), guide('index', 'A', 10)],
      codes: ['RATE_LIMITED', 'API_BUSY'],
      packages: [
        { folder: 'cli', name: 'tassyir', description: '', readme: '' },
        { folder: 'app', name: '@tassyir/app', description: '', readme: '' },
      ],
    });
    expect(navigationPages(nav)).toEqual([
      'guides/index',
      'guides/b',
      'claude-code',
      'errors/api-busy',
      'errors/rate-limited',
      'packages/app',
      'packages/cli',
    ]);
    expect(JSON.stringify(nav)).toContain(
      '"openapi":{"source":"/openapi/openapi.2026-10.json","directory":"api-reference/admin"}',
    );
  });
});

describe('colours', () => {
  it('converts hex and oklch to the hex Mintlify takes', () => {
    expect(hexOf('#051f25')).toBe('#051F25');
    expect(hexOf('#abc')).toBe('#AABBCC');
    expect(hexOf('oklch(1 0 0)')).toBe('#FFFFFF');
    expect(hexOf('oklch(0.955 0 0)')).toBe('#F0F0F0');
    expect(hexOf('oklch(0.195 0 0)')).toBe('#151515');
    // The light theme's success green, a chromatic colour (as @tassyir/ui's
    // colour harness converts it).
    expect(hexOf('oklch(0.545 0.151 150)')).toBe('#00873C');
    expect(() => hexOf('black')).toThrow(/neither hex nor oklch/);
  });

  it('takes ink on paper and the first face of the stack', () => {
    expect(
      themeSettings({
        colors: {
          light: { ink: '#051F25', paper: 'oklch(1 0 0)' },
          dark: { ink: 'oklch(0.955 0 0)', paper: 'oklch(0.195 0 0)' },
        },
        fonts: { sans: '"Geist", "IBM Plex Sans Arabic", sans-serif' },
      }),
    ).toEqual({
      colors: { primary: '#051F25', light: '#F0F0F0', dark: '#051F25' },
      background: { color: { light: '#FFFFFF', dark: '#151515' } },
      fonts: { family: 'Geist' },
    });
  });
});
