import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupHarnesses, createHarness } from './harness.test-helpers.js';
import type { Harness } from './harness.test-helpers.js';

// validate_block (AP-K2.3): @tassyir/storefront-blocks' upload check of a
// block, offline, from an app's manifest and files or from text.

afterEach(cleanupHarnesses);

const MANIFEST = `name        = "Review Requests"
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

[[storefront.blocks]]
handle   = "product-rating"
template = "blocks/product-rating.liquid"
name     = { ar = "تقييم المنتج", en = "Product rating" }
target   = "product"
data     = ["product.rating"]

[[storefront.blocks]]
handle     = "store-note"
template   = "blocks/store-note.liquid"
stylesheet = "blocks/store-note.css"
name       = { ar = "ملاحظة", en = "Note" }
`;

async function app(
  harness: Harness,
  files: Record<string, string> = {},
): Promise<void> {
  const all: Record<string, string> = {
    'tassyir.app.toml': MANIFEST,
    'blocks/product-rating.liquid':
      '<p>{{ product.name }}</p>{% if app.data.product.rating %}{{ app.data.product.rating.average | stars }}{% endif %}',
    'blocks/store-note.liquid': '<p class="note">{{ store.name }}</p>',
    'blocks/store-note.css': '.note { color: var(--st-primary); }',
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    const target = join(harness.cwd, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

describe('validate_block, from the manifest', () => {
  it('checks every block of ./tassyir.app.toml with its files, offline', async () => {
    const harness = await createHarness();
    await app(harness);
    const answer = await harness.ok('validate_block');
    expect(answer).toEqual({
      valid: true,
      file: 'tassyir.app.toml',
      blocks: [
        {
          handle: 'product-rating',
          template: 'blocks/product-rating.liquid',
          stylesheet: null,
          target: 'product',
        },
        {
          handle: 'store-note',
          template: 'blocks/store-note.liquid',
          stylesheet: 'blocks/store-note.css',
          target: 'any',
        },
      ],
      errors: [],
      errorCount: 0,
    });
    expect(harness.fake.requests).toEqual([]);
  });

  it('answers each problem with its file, line, column and fix, and one block alone', async () => {
    const harness = await createHarness();
    await app(harness, {
      'blocks/store-note.liquid': '<p>\n{{ store.secret }}</p>',
      'blocks/store-note.css': '.note { behavior: url(x.htc); }',
    });
    const all = await harness.ok('validate_block');
    expect(all['valid']).toBe(false);
    const errors = all['errors'] as {
      code: string;
      path: string;
      fix: string;
    }[];
    expect(errors[0]?.path).toMatch(/^blocks\/store-note\.liquid:2:\d+$/);
    expect(errors.at(-1)?.path).toMatch(/^blocks\/store-note\.css:1:\d+$/);
    for (const error of errors) expect(error.fix).not.toBe('');
    const rating = await harness.ok('validate_block', {
      block: 'product-rating',
      preview: 'en',
    });
    expect(rating).toMatchObject({
      valid: true,
      blocks: [{ handle: 'product-rating' }],
      errors: [],
      preview: {
        handle: 'product-rating',
        language: 'en',
        html: '<p>Embroidered kaftan</p>',
        htmlTruncated: false,
      },
    });
  });

  it('refuses an unknown block and a manifest that does not validate', async () => {
    const harness = await createHarness();
    await app(harness);
    const unknown = await harness.refused('validate_block', { block: 'nope' });
    expect(unknown).toMatchObject({
      code: 'BLOCK_NOT_FOUND',
      fix: 'Use one of: product-rating, store-note.',
    });
    await writeFile(join(harness.cwd, 'tassyir.app.toml'), 'name = 1\n');
    const invalid = await harness.refused('validate_block');
    expect(invalid.code).toBe('MANIFEST_INVALID');
    expect(invalid.fix).toContain('validate_manifest');
  });
});

describe('validate_block, from text', () => {
  it('checks a template against its declaration and renders it with sample data', async () => {
    const harness = await createHarness();
    const answer = await harness.ok('validate_block', {
      template: '<h2>{{ block.settings.title | t }}</h2>',
      declaration: {
        settings: [
          {
            key: 'title',
            type: 'string',
            default: { ar: 'مرحبا', en: 'Hello' },
          },
        ],
      },
      preview: 'ar',
    });
    expect(answer).toMatchObject({
      valid: true,
      file: null,
      errors: [],
      preview: { handle: 'template', html: '<h2>مرحبا</h2>' },
    });
  });

  it('names template:line:column and stylesheet:line:column', async () => {
    const harness = await createHarness();
    const answer = await harness.ok('validate_block', {
      template: '{{ block.settings.missing }}',
      stylesheet: '.x { position: fixed; }',
      declaration: { settings: [] },
    });
    expect(answer['valid']).toBe(false);
    expect(
      (answer['errors'] as { path: string }[]).map((error) => error.path),
    ).toEqual([
      expect.stringMatching(/^template:1:\d+$/),
      expect.stringMatching(/^stylesheet:1:\d+$/),
    ]);
  });

  it('refuses text and a manifest together', async () => {
    const harness = await createHarness();
    const error = await harness.refused('validate_block', {
      template: '<p></p>',
      block: 'store-note',
    });
    expect(error.code).toBe('INVALID_ARGUMENT');
    const alone = await harness.refused('validate_block', {
      stylesheet: '.x {}',
    });
    expect(alone.code).toBe('INVALID_ARGUMENT');
  });
});
