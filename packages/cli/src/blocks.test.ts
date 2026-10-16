import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupHarnesses, createHarness } from './cli.test-helpers.js';
import type { Harness } from './cli.test-helpers.js';

// Storefront blocks in the CLI (AP-K2.3): `tassyir validate` and `deploy`
// read each [[storefront.blocks]] file and hold it to @tassyir/storefront-
// blocks' upload check; an external version uploads them as `assets`
// (AP-B2.4's field, Phase 2 §6.1); `tassyir block preview` renders one with
// sample data. On the fake developer API, never the real one.

afterEach(cleanupHarnesses);

export const BLOCK_MANIFEST = `name        = "Review Requests"
handle      = "review-requests"
api_version = "2026-10"

[access]
scopes = ["read_products", "write_storefront"]

[access.scope_reasons]
read_products    = "Show each product's rating"
write_storefront = "Add the rating block to your product pages"

[hosting]
mode = "external"
url  = "https://reviews.acme-apps.dz"

[[data.definitions]]
owner      = "product"
key        = "rating"
type       = "json"
visibility = "storefront"
label      = { ar = "التقييم", en = "Rating" }

[[storefront.blocks]]
handle     = "product-rating"
template   = "blocks/product-rating.liquid"
stylesheet = "blocks/product-rating.css"
name       = { ar = "تقييم المنتج", en = "Product rating" }
target     = "product"
data       = ["product.rating"]

  [[storefront.blocks.settings]]
  key     = "show_count"
  type    = "boolean"
  label   = { ar = "عرض عدد التقييمات", en = "Show the number of ratings" }
  default = true

  [[storefront.blocks.settings]]
  key     = "heading"
  type    = "string"
  label   = { ar = "العنوان", en = "Heading" }
  default = { ar = "آراء الزبائن", en = "What buyers say" }

  [[storefront.blocks.settings]]
  key     = "accent_color"
  type    = "color"
  label   = { ar = "اللون", en = "Colour" }
  default = "#c0392b"
`;

export const BLOCK_TEMPLATE = `<div class="rating">
  <h2>{{ block.settings.heading | t }}</h2>
  <p>{{ product.name }}: {{ product.price | money }}</p>
  {% assign rating = app.data.product.rating %}
  {% if rating %}
    {{ rating.average | stars }}
    {% if block.settings.show_count %}<span class="count">{{ rating.count }}</span>{% endif %}
  {% else %}
    <p class="empty">{% if store.locale == "ar" %}لا تقييم بعد{% else %}No rating yet{% endif %}</p>
  {% endif %}
</div>
`;

export const BLOCK_STYLESHEET = `.rating { padding: var(--st-space); border-radius: var(--st-radius); }
.rating h2 { color: var(--block-accent-color); }
`;

/** Writes the manifest and the block's files, with `changes` on top (`null` removes one). */
async function app(
  harness: Harness,
  changes: Record<string, string | null> = {},
): Promise<void> {
  const files: Record<string, string | null> = {
    'tassyir.app.toml': BLOCK_MANIFEST,
    'blocks/product-rating.liquid': BLOCK_TEMPLATE,
    'blocks/product-rating.css': BLOCK_STYLESHEET,
    ...changes,
  };
  for (const [path, content] of Object.entries(files)) {
    if (content === null) continue;
    const target = join(harness.cwd, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

function uploads(harness: Harness) {
  return harness.fake.requests.filter(
    (request) =>
      request.method === 'POST' && request.path.endsWith('/versions'),
  );
}

describe('tassyir validate: the block files', () => {
  it('passes a block whose template and stylesheet pass the upload check, offline', async () => {
    const harness = await createHarness();
    await app(harness);
    const result = await harness.run('validate', '--json');
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({
      ok: true,
      valid: true,
      blocks: [
        {
          handle: 'product-rating',
          template: 'blocks/product-rating.liquid',
          stylesheet: 'blocks/product-rating.css',
          target: 'product',
          bytes: expect.any(Number) as number,
        },
      ],
    });
    expect(harness.fake.requests).toEqual([]);
    const text = await harness.run('validate');
    expect(text.stdout).toContain(
      "1 storefront block (product-rating) pass the upload's check",
    );
  });

  it('names the file, line and column of each problem, template first, then stylesheet (exit 4)', async () => {
    const harness = await createHarness();
    await app(harness, {
      'blocks/product-rating.liquid':
        '<div>\n  {% include "other" %}\n  <script>alert(1)</script>\n</div>\n',
      'blocks/product-rating.css': '.rating { position: fixed; }\n',
    });
    const result = await harness.run('validate', '--json');
    expect(result.code).toBe(4);
    const error = result.json()['error'] as {
      code: string;
      errors: { code: string; path: string; message: string; fix: string }[];
    };
    expect(error.code).toBe('BLOCKS_INVALID');
    const paths = error.errors.map((problem) => problem.path);
    expect(paths[0]).toMatch(/^blocks\/product-rating\.liquid:2:\d+$/);
    expect(paths.at(-1)).toMatch(/^blocks\/product-rating\.css:1:\d+$/);
    expect(error.errors.map((problem) => problem.code)).toEqual([
      'BLOCK_TAG_NOT_SUPPORTED',
      'BLOCK_HTML_TAG_NOT_ALLOWED',
      'BLOCK_CSS_DECLARATION_NOT_ALLOWED',
    ]);
    for (const problem of error.errors) {
      expect(problem.message).toMatch(/^Block "product-rating": /);
      expect(problem.fix).not.toBe('');
    }
    const text = await harness.run('validate');
    expect(text.stderr).toContain('✗ BLOCKS_INVALID');
    expect(text.stderr).toContain('at blocks/product-rating.liquid:2:');
  });

  it('refuses a missing file and a link that leaves the app', async () => {
    const harness = await createHarness();
    await app(harness, {
      'blocks/product-rating.liquid': null,
      'blocks/product-rating.css': null,
    });
    const outside = join(harness.root, 'outside.liquid');
    await writeFile(outside, BLOCK_TEMPLATE);
    await mkdir(join(harness.cwd, 'blocks'), { recursive: true });
    await symlink(outside, join(harness.cwd, 'blocks/product-rating.liquid'));
    const result = await harness.run('validate', '--json');
    expect(result.code).toBe(4);
    const error = result.json()['error'] as {
      errors: { code: string; path: string }[];
    };
    expect(error.errors).toEqual([
      expect.objectContaining({
        code: 'BLOCK_FILE_OUTSIDE_APP',
        path: 'storefront.blocks[0].template',
      }),
      expect.objectContaining({
        code: 'BLOCK_FILE_NOT_FOUND',
        path: 'storefront.blocks[0].stylesheet',
      }),
    ]);
  });

  it("counts the version's block files: at most 100 KB together", async () => {
    const harness = await createHarness();
    const filler = `{% comment %}${'x'.repeat(15_000)}{% endcomment %}`;
    const blocks = Array.from(
      { length: 7 },
      (_, index) => `
[[storefront.blocks]]
handle   = "note-${String(index)}"
template = "blocks/note-${String(index)}.liquid"
name     = { ar = "ملاحظة", en = "Note" }
`,
    ).join('');
    const manifest = `${BLOCK_MANIFEST.split('[[storefront.blocks]]')[0] ?? ''}${blocks}`;
    const files: Record<string, string> = { 'tassyir.app.toml': manifest };
    for (let index = 0; index < 7; index += 1) {
      files[`blocks/note-${String(index)}.liquid`] =
        `<p>{{ store.name }}</p>${filler}`;
    }
    await app(harness, files);
    const result = await harness.run('validate', '--json');
    expect(result.code).toBe(4);
    expect(result.json()['error']).toMatchObject({
      code: 'BLOCKS_INVALID',
      errors: [
        expect.objectContaining({
          code: 'BLOCK_FILES_TOO_LARGE',
          path: 'storefront.blocks',
        }),
      ],
    });
  });
});

describe('tassyir deploy: an external version with blocks', () => {
  async function signedIn(): Promise<Harness> {
    const harness = await createHarness();
    await harness.signIn();
    harness.fake.seedApp();
    await app(harness);
    return harness;
  }

  it("uploads the block files as the version's assets, next to the manifest", async () => {
    const harness = await signedIn();
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({
      ok: true,
      unchanged: false,
      version: { version: 1 },
      blocks: [{ handle: 'product-rating' }],
    });
    const body = JSON.parse(uploads(harness)[0]?.body ?? '{}') as Record<
      string,
      unknown
    >;
    expect(Object.keys(body)).toEqual(['manifest', 'assets']);
    expect(body['assets']).toEqual({
      files: [
        { path: 'blocks/product-rating.liquid', content: BLOCK_TEMPLATE },
        { path: 'blocks/product-rating.css', content: BLOCK_STYLESHEET },
      ],
    });
    expect(harness.fake.assets).toHaveLength(1);
    expect((await harness.run('deploy')).stdout).toContain('Nothing to deploy');
  });

  it('sends no assets for a version without blocks', async () => {
    const harness = await createHarness();
    await harness.signIn();
    harness.fake.seedApp();
    await writeFile(
      join(harness.cwd, 'tassyir.app.toml'),
      (BLOCK_MANIFEST.split('[[data.definitions]]')[0] ?? '')
        .replace(', "write_storefront"', '')
        .replace(
          'write_storefront = "Add the rating block to your product pages"\n',
          '',
        ),
    );
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(0);
    const body = JSON.parse(uploads(harness)[0]?.body ?? '{}') as Record<
      string,
      unknown
    >;
    expect(Object.keys(body)).toEqual(['manifest']);
    expect(result.json()['blocks']).toEqual([]);
  });

  it('checks the blocks before signing in: nothing is sent for an invalid one', async () => {
    const harness = await signedIn();
    await writeFile(
      join(harness.cwd, 'blocks/product-rating.liquid'),
      '{{ product.secret }}',
    );
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(4);
    expect(result.json()['error']).toMatchObject({
      code: 'BLOCKS_INVALID',
      fix: expect.stringContaining('run `tassyir deploy` again') as string,
    });
    expect(harness.fake.requests).toEqual([]);
  });

  it('--dry-run lists the assets it would upload, with no sign-in', async () => {
    const harness = await createHarness();
    await app(harness);
    const result = await harness.run('deploy', '--dry-run', '--json');
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({
      dryRun: true,
      uploaded: false,
      hosting: 'external',
      assets: ['blocks/product-rating.liquid', 'blocks/product-rating.css'],
      blocks: [{ handle: 'product-rating' }],
    });
    expect(harness.fake.requests).toEqual([]);
  });

  it('says so when the API does not take block files yet (before AP-B2.4)', async () => {
    const harness = await signedIn();
    harness.fake.acceptsAssets = false;
    const result = await harness.run('deploy', '--json');
    expect(result.code).toBe(1);
    expect(result.json()['error']).toMatchObject({
      code: 'BLOCK_ASSETS_NOT_ACCEPTED',
      status: 400,
      fix: expect.stringContaining('tassyir block preview') as string,
    });
  });
});

describe('tassyir block preview', () => {
  it('prints the HTML the store would show, in Arabic by default; the rest on stderr', async () => {
    const harness = await createHarness();
    await app(harness);
    const result = await harness.run('block', 'preview');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('<h2>آراء الزبائن</h2>');
    expect(result.stdout).toContain('قفطان مطرز');
    expect(result.stdout).toContain('لا تقييم بعد');
    expect(result.stdout).not.toContain('✓');
    expect(result.stderr).toMatch(
      /✓ product-rating in ar: \d+ steps, \d+ bytes\./,
    );
    expect(harness.fake.requests).toEqual([]);
  });

  it('takes the language, settings values and app data; --json answers the HTML and its stats', async () => {
    const harness = await createHarness();
    await app(harness, {
      'settings.json': JSON.stringify({
        heading: { en: 'Reviews', ar: 'التقييمات' },
        show_count: 'yes',
        unknown: 1,
      }),
      'data.json': JSON.stringify({
        product: { rating: { average: 4, count: 12 }, other: 1 },
        order: { secret: 1 },
      }),
    });
    const result = await harness.run(
      'block',
      'preview',
      'product-rating',
      '--lang',
      'en',
      '--settings',
      'settings.json',
      '--data',
      'data.json',
      '--json',
    );
    expect(result.code).toBe(0);
    const answer = result.json();
    expect(answer).toMatchObject({
      ok: true,
      block: { handle: 'product-rating', target: 'product' },
      language: 'en',
      stats: { steps: expect.any(Number) as number },
      cssVariables: { '--block-accent-color': '#c0392b' },
      file: null,
    });
    const html = String(answer['html']);
    expect(html).toContain('<h2>Reviews</h2>');
    expect(html).toContain('class="tsy-stars"');
    expect(html).toContain('<span class="count">12</span>');
    expect(answer['warnings']).toEqual([
      'Setting "unknown" is not declared by the block: the render drops it.',
      'App data "product.other" is not in the block\'s data list: the render drops it.',
      'App data owner "order" never reaches a block (only product, store and business): dropped.',
      'Setting "show_count" does not fit its declaration: the store would use the default instead.',
    ]);
  });

  it('--out writes a page with the stylesheet, where no script can run', async () => {
    const harness = await createHarness();
    await app(harness);
    const result = await harness.run(
      'block',
      'preview',
      '--lang',
      'fr',
      '--out',
      'preview.html',
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(
      /^✓ Wrote preview\.html: product-rating in fr/,
    );
    const page = await readFile(join(harness.cwd, 'preview.html'), 'utf8');
    expect(page).toContain('<html lang="fr" dir="ltr">');
    expect(page).toContain("default-src 'none'");
    expect(page).toContain(BLOCK_STYLESHEET.trim());
    expect(page).toContain('--block-accent-color: #c0392b;');
    expect(page).not.toContain('<script');
  });

  it('refuses an unknown block, and an invalid one with every problem', async () => {
    const harness = await createHarness();
    await app(harness);
    const unknown = await harness.run('block', 'preview', 'nope', '--json');
    expect(unknown.code).toBe(2);
    expect(unknown.json()['error']).toMatchObject({
      code: 'BLOCK_NOT_FOUND',
      fix: 'Use one of: product-rating.',
    });
    const language = await harness.run('block', 'preview', '--lang', 'de');
    expect(language.code).toBe(2);
    await writeFile(
      join(harness.cwd, 'blocks/product-rating.liquid'),
      '{% for i in (1..500) %}{{ i }}{% endfor %}',
    );
    const invalid = await harness.run('block', 'preview', '--json');
    expect(invalid.code).toBe(4);
    expect(invalid.json()['error']).toMatchObject({ code: 'BLOCKS_INVALID' });
  });

  it('asks which block when the manifest declares several', async () => {
    const harness = await createHarness();
    await app(harness, {
      'tassyir.app.toml': `${BLOCK_MANIFEST}
[[storefront.blocks]]
handle   = "store-note"
template = "blocks/store-note.liquid"
name     = { ar = "ملاحظة", en = "Note" }
`,
      'blocks/store-note.liquid': '<p>{{ store.name }}</p>',
    });
    const result = await harness.run('block', 'preview', '--json');
    expect(result.code).toBe(2);
    expect(result.json()['error']).toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: expect.stringContaining('product-rating, store-note') as string,
    });
    const note = await harness.run('block', 'preview', 'store-note');
    expect(note.stdout).toBe('<p>دار أمينة</p>\n');
  });
});
