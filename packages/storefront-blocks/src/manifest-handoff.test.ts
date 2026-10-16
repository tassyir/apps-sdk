import { validateManifest } from '@tassyir/app-manifest';
import { describe, expect, it } from 'vitest';
import type { BlockDeclaration } from './index.js';
import { renderBlock, sampleBlockContext, validateBlock } from './index.js';

/**
 * The hand-off the API and the builder make: `@tassyir/app-manifest`
 * validates tassyir.app.toml, and each normalised `[[storefront.blocks]]`
 * entry goes to this package unchanged as the block's declaration. The names
 * must line up: `target`, `data`, and each setting's `key`, `type`,
 * `default`, `options[].value`, `min`, `max`, `max_length`.
 */

const MANIFEST = {
  name: 'Review Requests',
  handle: 'review-requests',
  api_version: '2026-10',
  access: {
    scopes: ['read_products', 'write_storefront'],
    scope_reasons: {
      read_products: 'Show the product in the review request',
      write_storefront: 'Show the stars on product pages',
    },
  },
  hosting: { mode: 'tassyir', allowed_hosts: [] },
  data: {
    definitions: [
      {
        owner: 'product',
        key: 'rating',
        type: 'json',
        visibility: 'storefront',
        label: { ar: 'التقييم', en: 'Rating' },
      },
    ],
  },
  storefront: {
    blocks: [
      {
        handle: 'product-rating',
        template: 'blocks/product-rating.liquid',
        stylesheet: 'blocks/product-rating.css',
        name: { ar: 'تقييم المنتج', en: 'Product rating' },
        target: 'product',
        data: ['product.rating'],
        settings: [
          {
            key: 'show_count',
            type: 'boolean',
            label: { ar: 'عرض العدد', en: 'Show the count' },
            default: true,
          },
          {
            key: 'layout',
            type: 'select',
            label: { ar: 'الشكل', en: 'Layout' },
            default: 'grid',
            options: [
              { value: 'grid', label: { ar: 'شبكة', en: 'Grid' } },
              { value: 'list', label: { ar: 'قائمة', en: 'List' } },
            ],
          },
          {
            key: 'stars',
            type: 'integer',
            label: { ar: 'عدد النجوم', en: 'Stars' },
            default: 5,
            min: 1,
            max: 10,
          },
          {
            key: 'heading',
            type: 'string',
            label: { ar: 'العنوان', en: 'Heading' },
            default: { ar: 'آراء الزبائن', en: 'What buyers say' },
            max_length: 60,
          },
          {
            key: 'accent_color',
            type: 'color',
            label: { ar: 'اللون', en: 'Colour' },
            default: '#0b6e4f',
          },
        ],
      },
    ],
  },
};

const TEMPLATE = [
  '<section class="rating rating-{{ block.settings.layout }}">',
  '  <h3>{{ block.settings.heading | t }}</h3>',
  '  {%- assign rating = app.data.product.rating -%}',
  '  {%- if rating %}',
  '  <p>{{ rating.average | stars: block.settings.stars }}{% if block.settings.show_count %} ({{ rating.count }}){% endif %}</p>',
  '  {%- endif %}',
  '</section>',
].join('\n');

describe('the normalised manifest as a block declaration', () => {
  const result = validateManifest(MANIFEST);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2));
  const [block] = result.manifest.storefront.blocks;
  if (!block) throw new Error('no block in the normalised manifest');
  // Assignable as it is: no mapping layer between the two packages.
  const declaration: BlockDeclaration = block;

  it('validates the block against it', () => {
    expect(
      validateBlock({
        template: TEMPLATE,
        stylesheet: '.rating { color: var(--block-accent-color); }',
        declaration,
      }),
    ).toEqual({ ok: true });
  });

  it('renders with its defaults and refuses what it does not declare', () => {
    const rendered = renderBlock(
      TEMPLATE,
      sampleBlockContext(declaration, {
        language: 'en',
        appData: { product: { rating: { average: 4, count: 12 } } },
      }),
      declaration,
    );
    expect(rendered.ok && rendered.html).toBe(
      '<section class="rating rating-grid">\n  <h3>What buyers say</h3>\n  <p><span class="tsy-stars" role="img" aria-label="Rated 4 out of 5">★★★★☆</span> (12)</p>\n</section>',
    );
    expect(
      validateBlock({
        template: '{{ block.settings.missing }}{{ app.data.store.x }}',
        declaration,
      }),
    ).toMatchObject({
      ok: false,
      errors: [
        { code: 'BLOCK_SETTING_UNDECLARED' },
        { code: 'BLOCK_DATA_KEY_UNDECLARED' },
      ],
    });
  });
});
