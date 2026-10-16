/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- manifests are edited as loose JSON to build invalid documents */
import { describe, expect, it } from 'vitest';
import { manifestJsonSchema } from './manifest-schema.js';
import {
  FIXTURE_VOCABULARY,
  STOREFRONT_VOCABULARY,
  codes,
  externalManifest,
  hostedManifest,
  schemaViolations,
} from './manifest.test-harness.js';
import {
  DASHBOARD_APP_ROUTE_HANDLES,
  MANIFEST_LIMITS,
  RESERVED_HANDLES,
} from './manifest-limits.js';
import { MANIFEST_ERROR_CODES } from './manifest-types.js';
import type {
  ManifestError,
  ManifestErrorCode,
  ManifestVocabulary,
} from './manifest-types.js';
import {
  validateManifest,
  validateManifestField,
} from './validate-manifest.js';

/**
 * The manifest v1 validator's rules (tassyir/backend
 * docs/APPS_PLATFORM_PLAN.md §3.2), against a fixture vocabulary. Ported from
 * the backend's `validate-manifest.spec.ts` (AP-B1.2): same cases, same
 * expectations. The shipped vocabulary is tested in `vocabulary.test.ts`.
 */

// Loose JSON, written as the TOML reads (`doc.access.scopes`). `any`, not
// `Record<string, any>`: the strict config refuses dotted access on a Record.
type Doc = any;

function edit(base: Doc, change: (doc: Doc) => void): Doc {
  const doc = structuredClone(base);
  change(doc);
  return doc;
}

/** Every code a test below saw: the last test checks all were seen. */
const seen = new Set<ManifestErrorCode>();

function errorsOf(
  doc: unknown,
  vocabulary: ManifestVocabulary = FIXTURE_VOCABULARY,
): ManifestError[] {
  const result = validateManifest(doc, vocabulary);
  if (result.ok) return [];
  for (const error of result.errors) seen.add(error.code);
  return result.errors;
}

function expectErrors(
  doc: unknown,
  expected: string[],
  vocabulary?: ManifestVocabulary,
): ManifestError[] {
  const errors = errorsOf(doc, vocabulary);
  expect(codes(errors)).toEqual(expected);
  return errors;
}

const hosted = (change: (doc: Doc) => void) => edit(hostedManifest(), change);
const external = (change: (doc: Doc) => void) =>
  edit(externalManifest(), change);

describe('validateManifest', () => {
  describe('a valid manifest', () => {
    it('is accepted and normalised: catalogue order, defaults, manifest key order', () => {
      const result = validateManifest(hostedManifest(), FIXTURE_VOCABULARY);
      expect(result).toEqual({
        ok: true,
        manifest: {
          name: 'Review Requests',
          handle: 'review-requests',
          api_version: '2026-10',
          access: {
            scopes: ['read_orders', 'read_products'],
            optional_scopes: ['read_customer_contact'],
            scope_reasons: {
              read_orders: 'Find delivered orders to ask for a review',
              read_products: 'Show the product in the review request',
              read_customer_contact: "Send the request to the buyer's phone",
            },
          },
          hosting: { mode: 'tassyir', allowed_hosts: ['graph.facebook.com'] },
          admin: { page: '/' },
          webhooks: [
            {
              topics: ['orders/delivered', 'app/uninstalled'],
              uri: '/webhooks',
            },
          ],
          data: {
            definitions: [
              {
                owner: 'product',
                key: 'rating',
                type: 'json',
                visibility: 'storefront',
              },
            ],
          },
          storefront: { blocks: [] },
        },
      });
      if (!result.ok) return;
      expect(Object.keys(result.manifest)).toEqual([
        'name',
        'handle',
        'api_version',
        'access',
        'hosting',
        'admin',
        'webhooks',
        'data',
        'storefront',
      ]);
    });

    it('accepts an external app; `auth` kept, `admin` absent, hosts sorted for hosted apps', () => {
      const result = validateManifest(externalManifest(), FIXTURE_VOCABULARY);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.manifest.hosting).toEqual({
        mode: 'external',
        url: 'https://sync.example.com/tassyir',
      });
      expect(result.manifest.auth).toEqual({
        callback_url: 'https://sync.example.com/tassyir/callback',
      });
      expect('admin' in result.manifest).toBe(false);

      const sorted = validateManifest(
        hosted((doc) => {
          doc.hosting.allowed_hosts = ['b.example.com', '*.a.example.com'];
        }),
        FIXTURE_VOCABULARY,
      );
      expect(sorted.ok && sorted.manifest.hosting).toEqual({
        mode: 'tassyir',
        allowed_hosts: ['*.a.example.com', 'b.example.com'],
      });
    });

    it('needs only name, handle, api_version and hosting', () => {
      const result = validateManifest(
        {
          name: 'Bare',
          handle: 'bare',
          api_version: '2026-07',
          hosting: { mode: 'tassyir', allowed_hosts: [] },
        },
        FIXTURE_VOCABULARY,
      );
      expect(result).toEqual({
        ok: true,
        manifest: {
          name: 'Bare',
          handle: 'bare',
          api_version: '2026-07',
          access: { scopes: [], optional_scopes: [], scope_reasons: {} },
          hosting: { mode: 'tassyir', allowed_hosts: [] },
          webhooks: [],
          data: { definitions: [] },
          storefront: { blocks: [] },
        },
      });
    });

    it('validating the normalised manifest returns it unchanged', () => {
      for (const doc of [hostedManifest(), externalManifest()]) {
        const first = validateManifest(doc, FIXTURE_VOCABULARY);
        expect(first.ok).toBe(true);
        if (!first.ok) continue;
        const again = validateManifest(
          JSON.parse(JSON.stringify(first.manifest)),
          FIXTURE_VOCABULARY,
        );
        expect(again).toEqual(first);
      }
    });

    it('never returns the input object or shares its arrays', () => {
      const doc = hostedManifest();
      const result = validateManifest(doc, FIXTURE_VOCABULARY);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.manifest).not.toBe(doc);
      expect(result.manifest.webhooks[0]?.topics).not.toBe(
        (doc as Doc).webhooks[0].topics,
      );
    });
  });

  describe('the document', () => {
    it.each([
      ['null', null],
      ['an array', []],
      ['a string', 'name = "x"'],
      ['a number', 1],
      ['a date', new Date(0)],
      ['a Map', new Map()],
    ])('refuses %s as a whole', (_label, input) => {
      expectErrors(input, ['MANIFEST_NOT_A_TABLE ']);
    });

    it('refuses a cycle', () => {
      const doc: Doc = hostedManifest();
      doc.data.self = doc;
      expectErrors(doc, ['MANIFEST_NOT_DATA ']);
    });

    it(`refuses more than ${MANIFEST_LIMITS.maxBytes} bytes, and checks nothing else`, () => {
      const doc = hosted((d) => {
        d.name = 'x'.repeat(MANIFEST_LIMITS.maxBytes);
        d.handle = 'BAD';
      });
      expectErrors(doc, ['MANIFEST_TOO_LARGE ']);
    });

    it('accepts a table without a prototype', () => {
      const doc = Object.assign(Object.create(null), hostedManifest());
      expect(validateManifest(doc, FIXTURE_VOCABULARY).ok).toBe(true);
    });

    it('a `__proto__` key is an unknown field and pollutes nothing', () => {
      const doc = JSON.parse(
        JSON.stringify(hostedManifest()).replace(
          '{',
          '{"__proto__":{"polluted":true},',
        ),
      );
      expectErrors(doc, ['MANIFEST_FIELD_UNKNOWN __proto__']);
      expect(({} as Doc).polluted).toBeUndefined();
    });

    it('never throws, whatever it is given', () => {
      const weird: unknown[] = [
        undefined,
        Symbol('x'),
        () => 1,
        { name: 1n, handle: Symbol('h'), api_version: [], hosting: 7 },
        { access: { scopes: { 0: 'read_orders' } } },
        { webhooks: [null, 1, 'x', [], { topics: null, uri: {} }] },
        { data: { definitions: [{}, null] } },
        { storefront: { blocks: 'x' } },
        { hosting: { mode: 'tassyir', allowed_hosts: [null, 1, {}] } },
        JSON.parse('{"access":{"scope_reasons":{"constructor":"x"}}}'),
        { access: { scope_reasons: ['x'] } },
      ];
      let deep: Doc = {};
      const root = deep;
      for (let i = 0; i < 10_000; i++) deep = deep.x = {};
      weird.push(root);
      for (const input of weird) {
        expect(() => validateManifest(input, FIXTURE_VOCABULARY)).not.toThrow();
        expect(validateManifest(input, FIXTURE_VOCABULARY).ok).toBe(false);
      }
    });
  });

  describe('fields', () => {
    it('names every missing required field, with what to write', () => {
      const errors = expectErrors(
        hosted((doc) => {
          delete doc.name;
          delete doc.handle;
          delete doc.api_version;
          delete doc.hosting;
        }),
        [
          'MANIFEST_FIELD_REQUIRED name',
          'MANIFEST_FIELD_REQUIRED handle',
          'MANIFEST_FIELD_REQUIRED api_version',
          'MANIFEST_FIELD_REQUIRED hosting',
        ],
      );
      expect(errors[0]?.fix).toBe(
        'Add name = "Review Requests" to the top level of tassyir.app.toml.',
      );
      expect(errors[2]?.fix).toBe(
        'Add api_version = "2026-10" to the top level of tassyir.app.toml.',
      );
    });

    it('names missing fields inside tables and arrays of tables', () => {
      const errors = expectErrors(
        hosted((doc) => {
          delete doc.hosting.mode;
          delete doc.webhooks[0].uri;
          delete doc.data.definitions[0].visibility;
        }),
        [
          'MANIFEST_FIELD_REQUIRED hosting.mode',
          'MANIFEST_FIELD_REQUIRED webhooks[0].uri',
          'MANIFEST_FIELD_REQUIRED data.definitions[0].visibility',
        ],
      );
      expect(errors[1]?.fix).toBe(
        'Add uri = "/webhooks" to the [[webhooks]] entry `webhooks[0]`.',
      );
    });

    it('refuses wrong types, in TOML words', () => {
      const errors = expectErrors(
        hosted((doc) => {
          doc.name = new Date(0);
          doc.access.scopes = 'read_orders';
          doc.hosting.allowed_hosts = [5];
          doc.webhooks = { topics: [] };
        }),
        [
          'MANIFEST_FIELD_TYPE name',
          'MANIFEST_FIELD_TYPE access.scopes',
          'MANIFEST_FIELD_TYPE hosting.allowed_hosts[0]',
          'MANIFEST_FIELD_TYPE webhooks',
        ],
      );
      expect(errors[0]?.message).toBe('`name` is a date; it must be a string.');
      expect(errors[1]?.fix).toBe(
        'Write `access.scopes` as an array, e.g. scopes = ["read_orders"].',
      );
      expect(errors[3]?.message).toBe(
        '`webhooks` is a table; it must be an array.',
      );
    });

    it('refuses unknown fields, suggesting the near one', () => {
      const errors = expectErrors(
        hosted((doc) => {
          doc.version = '1.0.0';
          doc.access.scope = ['read_orders'];
          doc.webhooks[0].url = '/x';
        }),
        [
          'MANIFEST_FIELD_UNKNOWN access.scope',
          'MANIFEST_FIELD_UNKNOWN webhooks[0].url',
          'MANIFEST_FIELD_UNKNOWN version',
        ],
      );
      expect(errors[0]?.fix).toBe('Rename `scope` to `scopes`, or remove it.');
      expect(errors[2]?.fix).toBe(
        'Remove `version` from the top level of tassyir.app.toml; it accepts: name, handle, api_version, access, hosting, auth, admin, webhooks, data, storefront, app_proxy.',
      );
    });

    it('caps list sizes and refuses an empty topic list', () => {
      expectErrors(
        hosted((doc) => {
          doc.hosting.allowed_hosts = Array.from(
            { length: MANIFEST_LIMITS.allowedHostsMax + 1 },
            (_, i) => `h${i}.example.com`,
          );
          doc.webhooks[0].topics = [];
        }),
        [
          'MANIFEST_LIST_TOO_LONG hosting.allowed_hosts',
          'MANIFEST_LIST_EMPTY webhooks[0].topics',
        ],
      );
    });

    it('refuses an enum value outside its list, suggesting the near one', () => {
      const errors = expectErrors(
        hosted((doc) => {
          doc.data.definitions[0].owner = 'products';
          doc.data.definitions[0].type = 'text';
          doc.hosting.mode = 'self';
        }),
        [
          'MANIFEST_VALUE_NOT_ALLOWED hosting.mode',
          'MANIFEST_VALUE_NOT_ALLOWED data.definitions[0].owner',
          'MANIFEST_VALUE_NOT_ALLOWED data.definitions[0].type',
        ],
      );
      expect(errors[0]?.fix).toBe(
        'Set `hosting.mode` to one of "tassyir", "external".',
      );
      expect(errors[1]?.fix).toBe(
        'Set `data.definitions[0].owner` to "product".',
      );
    });
  });

  describe('name and handle', () => {
    it.each([
      ['empty', ''],
      ['a leading space', ' Review'],
      ['a line break', 'Review\nRequests'],
      ['a right-to-left override', 'Review ‮steuqer'],
      ['a zero-width space', 'Review​Requests'],
      ['too long', 'x'.repeat(MANIFEST_LIMITS.nameMaxLength + 1)],
    ])('refuses a name with %s', (_label, name) => {
      expectErrors(
        hosted((doc) => {
          doc.name = name;
        }),
        ['MANIFEST_NAME_INVALID name'],
      );
    });

    it('accepts Arabic and emoji names', () => {
      for (const name of ['طلبات التقييم', 'Reviews ⭐️']) {
        expect(
          validateManifest(
            hosted((doc) => {
              doc.name = name;
            }),
            FIXTURE_VOCABULARY,
          ).ok,
        ).toBe(true);
      }
    });

    it.each([
      'AB',
      'ab',
      'Review_Requests',
      '-reviews',
      'reviews-',
      're--views',
      'reviews.app',
      'x'.repeat(41),
    ])('refuses the handle %j', (handle) => {
      expectErrors(
        hosted((doc) => {
          doc.handle = handle;
        }),
        ['MANIFEST_HANDLE_INVALID handle'],
      );
    });

    it('suggests a handle made from the input', () => {
      const [error] = expectErrors(
        hosted((doc) => {
          doc.handle = 'Review_Requests';
        }),
        ['MANIFEST_HANDLE_INVALID handle'],
      );
      expect(error?.fix).toBe(
        'Set `handle` to a handle of that form, e.g. "review-requests".',
      );
    });

    it.each(['www', 'api', 'tassyir', 'dispatch'])(
      'refuses the reserved handle %j',
      (handle) => {
        expectErrors(
          hosted((doc) => {
            doc.handle = handle;
          }),
          ['MANIFEST_HANDLE_RESERVED handle'],
        );
      },
    );

    // The dashboard's folders next to `apps/[handle]` (AP-B1.9): a static
    // segment would win over the app's own page.
    it.each(['google-sheets', 'components', 'hooks'])(
      'refuses %j, a dashboard route next to the app page',
      (handle) => {
        const [error] = expectErrors(
          hosted((doc) => {
            doc.handle = handle;
          }),
          ['MANIFEST_HANDLE_RESERVED handle'],
        );
        expect(error?.fix).toContain(`"${handle}-app"`);
        expect(validateManifestField('handle', handle)?.code).toBe(
          'MANIFEST_HANDLE_RESERVED',
        );
      },
    );

    it('keeps the dashboard route list inside the reserved list, each a valid handle', () => {
      for (const handle of DASHBOARD_APP_ROUTE_HANDLES) {
        expect(RESERVED_HANDLES).toContain(handle);
        expect(handle).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      }
      expect([...DASHBOARD_APP_ROUTE_HANDLES].sort()).toEqual([
        'components',
        'google-sheets',
        'hooks',
      ]);
    });

    it('accepts 3 and 40 characters, digits and single hyphens', () => {
      for (const handle of ['abc', 'a'.repeat(40), '1-2-3', 'review2go']) {
        expect(
          validateManifest(
            hosted((doc) => {
              doc.handle = handle;
            }),
            FIXTURE_VOCABULARY,
          ).ok,
        ).toBe(true);
      }
    });

    it('refuses an unsupported api_version, naming the supported ones', () => {
      const [error] = expectErrors(
        hosted((doc) => {
          doc.api_version = '2025-01';
        }),
        ['MANIFEST_API_VERSION_UNSUPPORTED api_version'],
      );
      expect(error?.message).toBe(
        '`api_version` is "2025-01"; supported versions: 2026-07, 2026-10.',
      );
      expect(error?.fix).toBe('Set api_version = "2026-10".');
    });
  });

  describe('scopes', () => {
    it('refuses an unknown scope, suggesting the near one', () => {
      const errors = expectErrors(
        hosted((doc) => {
          doc.access.scopes = ['read_order', 'read_products'];
          doc.access.optional_scopes = ['manage_everything'];
          doc.access.scope_reasons = {
            read_products: 'Show the product in the review request',
          };
          doc.webhooks[0].topics = ['app/uninstalled'];
        }),
        [
          'MANIFEST_SCOPE_UNKNOWN access.scopes[0]',
          'MANIFEST_SCOPE_UNKNOWN access.optional_scopes[0]',
        ],
      );
      expect(errors[0]?.fix).toBe('Replace it with "read_orders".');
      expect(errors[1]?.fix).toBe(
        'Use one of: read_orders, write_orders, read_products, read_customers, read_customer_contact.',
      );
    });

    it('refuses a scope apps cannot request yet; its reason is not reported twice', () => {
      const [error] = expectErrors(
        hosted((doc) => {
          doc.access.scopes.push('write_storefront');
          doc.access.scope_reasons.write_storefront =
            'Show stars on the product page';
        }),
        ['MANIFEST_SCOPE_NOT_AVAILABLE access.scopes[2]'],
      );
      expect(error?.fix).toBe(
        'Remove "write_storefront" from the manifest; storefront blocks arrive in Phase 2.',
      );
    });

    it('refuses duplicates and a scope in both lists', () => {
      expectErrors(
        hosted((doc) => {
          doc.access.scopes = ['read_orders', 'read_products', 'read_orders'];
          doc.access.optional_scopes = [
            'read_customer_contact',
            'read_products',
            'read_customer_contact',
          ];
        }),
        [
          'MANIFEST_SCOPE_DUPLICATE access.scopes[2]',
          'MANIFEST_SCOPE_REQUIRED_AND_OPTIONAL access.optional_scopes[1]',
          'MANIFEST_SCOPE_DUPLICATE access.optional_scopes[2]',
        ],
      );
    });

    it('refuses an optional scope that a required one already implies', () => {
      const [error] = expectErrors(
        external((doc) => {
          doc.access.optional_scopes = ['read_orders'];
          doc.access.scope_reasons.read_orders = 'Read the orders it created';
        }),
        ['MANIFEST_SCOPE_ALREADY_IMPLIED access.optional_scopes[0]'],
      );
      expect(error?.message).toBe(
        '"read_orders" is optional, but "write_orders" in `access.scopes` already includes it.',
      );
    });

    it('refuses a scope that opens nothing without another', () => {
      const reasons = {
        read_customer_contact: "Send the request to the buyer's phone",
        read_orders: 'Find delivered orders to ask for a review',
        read_customers: 'Skip buyers who already left a review',
      };
      const access = (scopes: string[], optional: string[]) =>
        hosted((doc) => {
          doc.access = {
            scopes,
            optional_scopes: optional,
            scope_reasons: Object.fromEntries(
              Object.entries(reasons).filter(([scope]) =>
                [...scopes, ...optional].includes(scope),
              ),
            ),
          };
          doc.webhooks[0].topics = ['app/uninstalled'];
        });
      expectErrors(access(['read_customer_contact'], []), [
        'MANIFEST_SCOPE_NEEDS_ANOTHER access.scopes[0]',
      ]);
      // Required contact needs a REQUIRED way to read orders.
      expectErrors(access(['read_customer_contact'], ['read_orders']), [
        'MANIFEST_SCOPE_NEEDS_ANOTHER access.scopes[0]',
      ]);
      // Optional contact may rely on an optional scope; implication counts.
      expect(
        errorsOf(access([], ['read_customer_contact', 'read_customers'])),
      ).toEqual([]);
      expect(
        errorsOf(access(['read_customers', 'read_customer_contact'], [])),
      ).toEqual([]);
    });

    it('needs a reason for every requested scope, and none for others', () => {
      const errors = expectErrors(
        hosted((doc) => {
          delete doc.access.scope_reasons.read_orders;
          delete doc.access.scope_reasons.read_customer_contact;
          doc.access.scope_reasons.write_orders = 'Create orders from rows';
          doc.access.scope_reasons.read_ordrs = 'A typo of a requested scope';
          doc.access.scope_reasons.everything = 'Not a scope at all, really';
        }),
        [
          'MANIFEST_SCOPE_REASON_UNUSED access.scope_reasons.everything',
          'MANIFEST_SCOPE_REASON_MISSING access.scope_reasons.read_customer_contact',
          'MANIFEST_SCOPE_REASON_MISSING access.scope_reasons.read_orders',
          'MANIFEST_SCOPE_REASON_UNUSED access.scope_reasons.read_ordrs',
          'MANIFEST_SCOPE_REASON_UNUSED access.scope_reasons.write_orders',
        ],
      );
      expect(errors.map((error) => error.fix)).toEqual([
        'Remove `access.scope_reasons.everything`: reasons are keyed by the scopes the manifest requests.',
        'Add read_customer_contact = "<one sentence on why the app needs it>" to `access.scope_reasons`.',
        'Add read_orders = "<one sentence on why the app needs it>" to `access.scope_reasons`.',
        'Rename the key to "read_orders" (and request "read_orders"), or remove it.',
        'Remove `access.scope_reasons.write_orders`, or add "write_orders" to `access.scopes` or `access.optional_scopes`.',
      ]);
    });

    it.each([
      ['too short', 'Reviews'],
      ['too long', 'x'.repeat(MANIFEST_LIMITS.scopeReasonMaxLength + 1)],
      ['on two lines', 'Find delivered orders\nto ask for a review'],
      ['with a bidi control', 'Find delivered ‫spam‬ orders'],
    ])('refuses a reason %s', (_label, reason) => {
      expectErrors(
        hosted((doc) => {
          doc.access.scope_reasons.read_orders = reason;
        }),
        ['MANIFEST_SCOPE_REASON_INVALID access.scope_reasons.read_orders'],
      );
    });

    it('needs no [access] table when nothing needs a scope', () => {
      expect(
        errorsOf(
          hosted((doc) => {
            delete doc.access;
            doc.webhooks[0].topics = ['app/uninstalled', 'customers/redact'];
          }),
        ),
      ).toEqual([]);
    });
  });

  describe('hosting', () => {
    it('an external app needs `url` and may not list `allowed_hosts`', () => {
      expectErrors(
        external((doc) => {
          delete doc.hosting.url;
          doc.hosting.allowed_hosts = ['api.example.com'];
        }),
        [
          'MANIFEST_FIELD_REQUIRED hosting.url',
          'MANIFEST_FIELD_NOT_FOR_MODE hosting.allowed_hosts',
        ],
      );
    });

    it('a hosted app needs `allowed_hosts` (empty is fine) and may not have a url, a callback or an absolute webhook', () => {
      expectErrors(
        hosted((doc) => {
          delete doc.hosting.allowed_hosts;
        }),
        ['MANIFEST_FIELD_REQUIRED hosting.allowed_hosts'],
      );
      expect(
        errorsOf(
          hosted((doc) => {
            doc.hosting.allowed_hosts = [];
          }),
        ),
      ).toEqual([]);
      // One error per field the mode does not use, whatever its format.
      expectErrors(
        hosted((doc) => {
          doc.hosting.url = 'http://not-even-https';
          doc.auth = { callback_url: 'https://x.example.com/cb' };
          doc.webhooks[0].uri = 'https://hooks.example.com/tassyir';
        }),
        [
          'MANIFEST_FIELD_NOT_FOR_MODE hosting.url',
          'MANIFEST_FIELD_NOT_FOR_MODE auth.callback_url',
          'MANIFEST_FIELD_NOT_FOR_MODE webhooks[0].uri',
        ],
      );
    });

    const urlCases: Array<[string, ManifestErrorCode]> = [
      ['http://sync.example.com', 'MANIFEST_URL_INVALID'],
      ['sync.example.com', 'MANIFEST_URL_INVALID'],
      ['HTTPS://sync.example.com', 'MANIFEST_URL_INVALID'],
      ['https://user:pw@sync.example.com', 'MANIFEST_URL_INVALID'],
      ['https://sync.example.com:8443', 'MANIFEST_URL_INVALID'],
      ['https://sync.example.com:443', 'MANIFEST_URL_INVALID'],
      ['https://sync.example.com?x=1', 'MANIFEST_URL_INVALID'],
      ['https://sync.example.com#top', 'MANIFEST_URL_INVALID'],
      ['https://Sync.Example.com', 'MANIFEST_URL_INVALID'],
      ['https://sync.example.com/', 'MANIFEST_URL_INVALID'],
      ['https://sync.example.com/a/../b', 'MANIFEST_URL_INVALID'],
      ['https://sync.example.com/a/%2e%2e/b', 'MANIFEST_URL_INVALID'],
      ['https://sync.example.com/a//b', 'MANIFEST_URL_INVALID'],
      ['https://sync.example.com/a%2Fb', 'MANIFEST_URL_INVALID'],
      ['https://sync.example.com/a b', 'MANIFEST_URL_INVALID'],
      ['https://sync.example.com/a\\b', 'MANIFEST_URL_INVALID'],
      [`https://sync.example.com/${'a'.repeat(520)}`, 'MANIFEST_URL_INVALID'],
      ['https://127.0.0.1', 'MANIFEST_URL_HOST_NOT_ALLOWED'],
      ['https://10.0.0.1/app', 'MANIFEST_URL_HOST_NOT_ALLOWED'],
      ['https://0x7f.1', 'MANIFEST_URL_HOST_NOT_ALLOWED'],
      ['https://[::1]', 'MANIFEST_URL_HOST_NOT_ALLOWED'],
      ['https://localhost', 'MANIFEST_URL_HOST_NOT_ALLOWED'],
      ['https://app.local', 'MANIFEST_URL_HOST_NOT_ALLOWED'],
      ['https://app.internal', 'MANIFEST_URL_HOST_NOT_ALLOWED'],
      ['https://shop.tassyir.io', 'MANIFEST_URL_HOST_NOT_ALLOWED'],
      ['https://tassyir.io', 'MANIFEST_URL_HOST_NOT_ALLOWED'],
      ['https://other-app.tassyir-apps.com', 'MANIFEST_URL_HOST_NOT_ALLOWED'],
      ['https://store.tassyir.shop', 'MANIFEST_URL_HOST_NOT_ALLOWED'],
    ];
    it.each(urlCases)('refuses hosting.url %j (%s)', (url, code) => {
      expectErrors(
        external((doc) => {
          doc.hosting.url = url;
        }),
        [`${code} hosting.url`],
      );
    });

    it.each([
      'https://sync.example.com',
      'https://sync.example.com/base',
      'https://a-b.sync.example.co.uk/x_y~z/%20',
      'https://notassyir.io',
    ])('accepts hosting.url %j', (url) => {
      expect(
        errorsOf(
          external((doc) => {
            doc.hosting.url = url;
          }),
        ),
      ).toEqual([]);
    });

    it('tells the developer the one thing to change', () => {
      const fixFor = (url: string) =>
        errorsOf(
          external((doc) => {
            doc.hosting.url = url;
          }),
        )[0]?.fix;
      expect(fixFor('https://sync.example.com/')).toBe(
        'Remove the trailing "/" from `hosting.url`.',
      );
      expect(fixFor('https://Sync.example.com/x')).toBe(
        'Write the hostname of `hosting.url` in lowercase: "https://sync.example.com/x".',
      );
      expect(fixFor('https://sync.example.com:8443')).toBe(
        'Remove the port from `hosting.url`; Tassyir calls HTTPS on port 443 only.',
      );
    });

    it('callback and webhook URLs may end with "/"', () => {
      expect(
        errorsOf(
          external((doc) => {
            doc.auth.callback_url = 'https://sync.example.com/';
            doc.webhooks[1].uri = 'https://compliance.example.com/';
          }),
        ),
      ).toEqual([]);
    });

    const hostCases: Array<[string, ManifestErrorCode]> = [
      ['https://api.example.com', 'MANIFEST_HOST_INVALID'],
      ['api.example.com/v1', 'MANIFEST_HOST_INVALID'],
      ['api.example.com:443', 'MANIFEST_HOST_INVALID'],
      ['API.example.com', 'MANIFEST_HOST_INVALID'],
      ['api.example.com.', 'MANIFEST_HOST_INVALID'],
      ['api.*.example.com', 'MANIFEST_HOST_INVALID'],
      ['**.example.com', 'MANIFEST_HOST_INVALID'],
      ['*', 'MANIFEST_HOST_INVALID'],
      ['*.com', 'MANIFEST_HOST_INVALID'],
      ['intranetbox', 'MANIFEST_HOST_INVALID'],
      ['example', 'MANIFEST_HOST_NOT_ALLOWED'],
      ['-api.example.com', 'MANIFEST_HOST_INVALID'],
      ['api_v1.example.com', 'MANIFEST_HOST_INVALID'],
      ['1.2.3.4', 'MANIFEST_HOST_NOT_ALLOWED'],
      ['::1', 'MANIFEST_HOST_NOT_ALLOWED'],
      ['[::1]', 'MANIFEST_HOST_NOT_ALLOWED'],
      ['localhost', 'MANIFEST_HOST_NOT_ALLOWED'],
      ['printer.local', 'MANIFEST_HOST_NOT_ALLOWED'],
      ['*.corp', 'MANIFEST_HOST_NOT_ALLOWED'],
      ['api.tassyir.io', 'MANIFEST_HOST_NOT_ALLOWED'],
      ['*.tassyir-apps.com', 'MANIFEST_HOST_NOT_ALLOWED'],
      ['tassyir.shop', 'MANIFEST_HOST_NOT_ALLOWED'],
    ];
    it.each(hostCases)('refuses the allowed host %j (%s)', (host, code) => {
      expectErrors(
        hosted((doc) => {
          doc.hosting.allowed_hosts = ['graph.facebook.com', host];
        }),
        [`${code} hosting.allowed_hosts[1]`],
      );
    });

    it('accepts hostnames and one leading wildcard label; refuses repeats', () => {
      expectErrors(
        hosted((doc) => {
          doc.hosting.allowed_hosts = [
            '*.example.com',
            'api.example.co',
            'a-b.c.example.com',
            'api.example.co',
          ];
        }),
        ['MANIFEST_HOST_DUPLICATE hosting.allowed_hosts[3]'],
      );
    });
  });

  describe('admin page and webhook uris', () => {
    it.each([
      'settings',
      '//evil.example.com',
      'https://x.example.com/page',
      'javascript:alert(1)',
      '/a?tab=1',
      '/a#x',
      '/a/../b',
      '/a/./b',
      '/a//b',
      '/a\\b',
      '/a b',
      `/${'a'.repeat(MANIFEST_LIMITS.pathMaxLength)}`,
    ])('refuses admin.page %j', (page) => {
      expectErrors(
        hosted((doc) => {
          doc.admin.page = page;
        }),
        ['MANIFEST_PATH_INVALID admin.page'],
      );
    });

    it('accepts paths, with or without a trailing "/"', () => {
      for (const page of ['/', '/settings', '/a/b/', '/a-b_c~d/%20']) {
        expect(
          errorsOf(
            hosted((doc) => {
              doc.admin.page = page;
            }),
          ),
        ).toEqual([]);
      }
    });

    it('a webhook uri is a path, or an https URL for an external app', () => {
      expectErrors(
        external((doc) => {
          doc.webhooks[0].uri = 'http://hooks.example.com';
          doc.webhooks[1].uri = '//hooks.example.com';
        }),
        [
          'MANIFEST_URL_INVALID webhooks[0].uri',
          'MANIFEST_PATH_INVALID webhooks[1].uri',
        ],
      );
      expectErrors(
        external((doc) => {
          doc.webhooks[0].uri = 'ftp://hooks.example.com/x';
          doc.webhooks[1].uri = 'https://192.168.1.10/x';
        }),
        [
          'MANIFEST_URL_INVALID webhooks[0].uri',
          'MANIFEST_URL_HOST_NOT_ALLOWED webhooks[1].uri',
        ],
      );
    });
  });

  describe('paths the dispatcher keeps on a hosted origin (/.tassyir/)', () => {
    it.each(['/.tassyir', '/.tassyir/', '/.tassyir/launch', '/.tassyir/a/b/'])(
      'refuses admin.page %j for a hosted app',
      (page) => {
        expectErrors(
          hosted((doc) => {
            doc.admin.page = page;
          }),
          ['MANIFEST_PATH_RESERVED admin.page'],
        );
      },
    );

    it('says what is reserved and where to move it', () => {
      const [error] = expectErrors(
        hosted((doc) => {
          doc.admin.page = '/.tassyir/settings';
        }),
        ['MANIFEST_PATH_RESERVED admin.page'],
      );
      expect(error).toEqual({
        code: 'MANIFEST_PATH_RESERVED',
        path: 'admin.page',
        message:
          '`admin.page` is "/.tassyir/settings", under "/.tassyir/", which Tassyir keeps for itself on a hosted app\'s origin.',
        fix: 'Move it to a path outside "/.tassyir/", e.g. "/".',
      });
    });

    it('refuses a hosted webhook uri there, in manifest order', () => {
      const errors = expectErrors(
        hosted((doc) => {
          doc.admin.page = '/.tassyir';
          doc.webhooks[0].uri = '/.tassyir/webhooks';
        }),
        [
          'MANIFEST_PATH_RESERVED admin.page',
          'MANIFEST_PATH_RESERVED webhooks[0].uri',
        ],
      );
      expect(errors[1]?.fix).toBe(
        'Move it to a path outside "/.tassyir/", e.g. "/webhooks".',
      );
    });

    it.each([
      '/.tassyir-app',
      '/.tassyirx/a',
      '/.Tassyir/a',
      '/.TASSYIR',
      '/a/.tassyir/b',
      '/%2etassyir/a',
    ])('takes %j: the dispatcher keeps only "/.tassyir" and below', (page) => {
      expect(
        errorsOf(
          hosted((doc) => {
            doc.admin.page = page;
            doc.webhooks[0].uri = page;
          }),
        ),
      ).toEqual([]);
    });

    it('lets an external app use the path: its origin is its own', () => {
      expect(
        errorsOf(
          external((doc) => {
            doc.admin = { page: '/.tassyir/settings' };
            doc.webhooks[0].uri = '/.tassyir/hooks';
            doc.webhooks[1].uri =
              'https://compliance.example.com/.tassyir/redact';
          }),
        ),
      ).toEqual([]);
    });

    it('a path that breaks the path rules is only MANIFEST_PATH_INVALID', () => {
      expectErrors(
        hosted((doc) => {
          doc.admin.page = '/.tassyir//x';
          doc.webhooks[0].uri = '/.tassyir/../x';
        }),
        [
          'MANIFEST_PATH_INVALID admin.page',
          'MANIFEST_PATH_INVALID webhooks[0].uri',
        ],
      );
    });

    it('a normalised hosted manifest never holds such a path', () => {
      const result = validateManifest(hostedManifest(), FIXTURE_VOCABULARY);
      expect(result.ok).toBe(true);
    });
  });

  describe('topics', () => {
    it('refuses an unknown topic, suggesting the near one', () => {
      const [error] = expectErrors(
        hosted((doc) => {
          doc.webhooks[0].topics = ['orders/create'];
        }),
        ['MANIFEST_TOPIC_UNKNOWN webhooks[0].topics[0]'],
      );
      expect(error?.fix).toBe('Replace it with "orders/created".');
    });

    it('a topic is subscribed once in the whole manifest', () => {
      expectErrors(
        hosted((doc) => {
          doc.webhooks = [
            { topics: ['orders/created', 'orders/created'], uri: '/a' },
            { topics: ['app/uninstalled', 'orders/created'], uri: '/b' },
          ];
        }),
        [
          'MANIFEST_TOPIC_DUPLICATE webhooks[0].topics[1]',
          'MANIFEST_TOPIC_DUPLICATE webhooks[1].topics[1]',
        ],
      );
    });

    it('a topic needs the scope that reads its resource, required, optional or implied', () => {
      const [error] = expectErrors(
        external((doc) => {
          doc.webhooks[0].topics = ['orders/created', 'products/updated'];
        }),
        ['MANIFEST_TOPIC_SCOPE_MISSING webhooks[0].topics[1]'],
      );
      expect(error?.fix).toBe(
        'Add "read_products" to `access.scopes` (or `access.optional_scopes`), or remove "products/updated".',
      );
      // `orders/created` needs read_orders: write_orders implies it.
      expect(errorsOf(externalManifest())).toEqual([]);
      expect(
        errorsOf(
          external((doc) => {
            doc.webhooks[0].topics = ['products/updated'];
            doc.access.optional_scopes = ['read_products'];
            doc.access.scope_reasons.read_products =
              'Copy product names into the sheet';
          }),
        ),
      ).toEqual([]);
    });
  });

  describe('app data', () => {
    it.each(['Rating', '1rating', 'star-rating', 'a'.repeat(65), ''])(
      'refuses the key %j',
      (key) => {
        expectErrors(
          hosted((doc) => {
            doc.data.definitions[0].key = key;
          }),
          ['MANIFEST_DATA_KEY_INVALID data.definitions[0].key'],
        );
      },
    );

    it('a key is unique per owner', () => {
      expectErrors(
        hosted((doc) => {
          doc.data.definitions.push(
            {
              owner: 'order',
              key: 'rating',
              type: 'integer',
              visibility: 'app',
            },
            {
              owner: 'product',
              key: 'rating',
              type: 'number',
              visibility: 'merchant',
            },
          );
        }),
        ['MANIFEST_DATA_KEY_DUPLICATE data.definitions[2].key'],
      );
    });
  });

  describe('storefront blocks (D9)', () => {
    const block = {
      handle: 'star-rating',
      template: 'blocks/star-rating.liquid',
    };
    const withStorefront: ManifestVocabulary = {
      ...FIXTURE_VOCABULARY,
      scopes: FIXTURE_VOCABULARY.scopes.map((scope) =>
        scope.name === 'write_storefront'
          ? { name: scope.name, implies: [], available: true }
          : scope,
      ),
    };

    it('are refused while the storefront scope is not available', () => {
      const [error] = expectErrors(
        hosted((doc) => {
          doc.storefront = { blocks: [block] };
        }),
        ['MANIFEST_BLOCKS_NOT_AVAILABLE storefront.blocks'],
      );
      expect(error?.fix).toBe(
        'Remove the [[storefront.blocks]] tables; storefront blocks arrive in Phase 2.',
      );
    });

    it('need the storefront scope once it is', () => {
      const doc = hosted((d) => {
        d.storefront = { blocks: [block] };
      });
      expectErrors(
        doc,
        ['MANIFEST_BLOCKS_SCOPE_MISSING storefront.blocks'],
        withStorefront,
      );
      const granted = edit(doc, (d) => {
        d.access.scopes.push('write_storefront');
        d.access.scope_reasons.write_storefront =
          'Show the stars next to each product';
      });
      expect(errorsOf(granted, withStorefront)).toEqual([]);
    });

    it.each([
      'script',
      'js',
      'javascript',
      'onload',
      'html',
      'src',
      'inline_js',
    ])('refuse a `%s` key: declarative only, no scripts', (key) => {
      expectErrors(
        hosted((doc) => {
          doc.storefront = { blocks: [{ ...block, [key]: 'alert(1)' }] };
        }),
        [
          'MANIFEST_BLOCKS_NOT_AVAILABLE storefront.blocks',
          `MANIFEST_BLOCK_SCRIPT_NOT_ALLOWED storefront.blocks[0].${key}`,
        ],
      );
    });

    it('check the template path and the handles', () => {
      expectErrors(
        hosted((doc) => {
          doc.storefront = {
            blocks: [
              { handle: 'star-rating', template: 'blocks/star.js' },
              { handle: 'star-rating', template: '../secrets.liquid' },
              { handle: 'Stars', template: '/abs/star.liquid' },
            ],
          };
        }),
        [
          'MANIFEST_BLOCKS_NOT_AVAILABLE storefront.blocks',
          'MANIFEST_BLOCK_TEMPLATE_INVALID storefront.blocks[0].template',
          'MANIFEST_BLOCK_HANDLE_DUPLICATE storefront.blocks[1].handle',
          'MANIFEST_BLOCK_TEMPLATE_INVALID storefront.blocks[1].template',
          'MANIFEST_BLOCK_HANDLE_INVALID storefront.blocks[2].handle',
          'MANIFEST_BLOCK_TEMPLATE_INVALID storefront.blocks[2].template',
        ],
      );
    });
  });

  describe('Phase 2: storefront blocks, settings, the app proxy, admin actions', () => {
    const V = STOREFRONT_VOCABULARY;
    const at = (doc: Doc) => codes(errorsOf(doc, V));

    const ratingBlock = (): Doc => ({
      handle: 'product-rating',
      template: 'blocks/product-rating.liquid',
      stylesheet: 'blocks/product-rating.css',
      name: { ar: 'تقييم المنتج', en: 'Product rating' },
      target: 'product',
      data: ['store.theme', 'product.rating'],
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
          options: [
            { value: 'grid', label: { ar: 'شبكة', en: 'Grid' } },
            { value: 'list', label: { ar: 'قائمة', en: 'List' } },
          ],
          default: 'grid',
        },
        {
          key: 'stars',
          type: 'integer',
          label: { ar: 'عدد النجوم', en: 'Stars' },
          min: 1,
          max: 10,
          default: 5,
        },
        {
          key: 'threshold',
          type: 'number',
          label: { ar: 'الحد الأدنى', en: 'Lowest rating shown' },
          min: 0,
          max: 5,
          default: 4.5,
        },
        {
          key: 'heading',
          type: 'string',
          label: { ar: 'العنوان', en: 'Heading' },
          max_length: 60,
          default: { ar: 'آراء الزبائن', en: 'What buyers say' },
        },
        {
          key: 'note',
          type: 'text',
          label: { ar: 'ملاحظة', en: 'Note' },
          default: 'Line one\nLine two',
        },
        {
          key: 'accent',
          type: 'color',
          label: { ar: 'اللون', en: 'Accent' },
          default: '#1A7F5A',
        },
        {
          key: 'more',
          type: 'url',
          label: { ar: 'المزيد', en: 'More link' },
          default: '/collections/new',
        },
        {
          key: 'badge',
          type: 'image',
          label: { ar: 'الشارة', en: 'Badge' },
        },
        {
          key: 'pick',
          type: 'product',
          label: { ar: 'منتج', en: 'Product' },
        },
        {
          key: 'shelf',
          type: 'collection',
          label: { ar: 'تصنيف', en: 'Collection' },
        },
      ],
    });

    const printAction = (): Doc => ({
      handle: 'print-labels',
      target: 'orders.selection',
      label: { ar: 'طباعة الملصقات', en: 'Print labels' },
      path: '/actions/print',
    });

    /** A hosted app with every Phase 2 field, valid for {@link V}. */
    const app = (change: (doc: Doc) => void = () => undefined): Doc =>
      hosted((doc) => {
        doc.access.scopes.push('write_storefront');
        doc.access.scope_reasons.write_storefront =
          'Show the stars on product pages';
        doc.data.definitions[0].label = { ar: 'التقييم', en: 'Rating' };
        doc.data.definitions.push({
          owner: 'store',
          key: 'theme',
          type: 'json',
          visibility: 'storefront',
        });
        doc.storefront = { blocks: [ratingBlock()] };
        doc.admin.actions = [printAction()];
        doc.app_proxy = { path: '/proxy' };
        change(doc);
      });
    const setting = (doc: Doc, key: string): Doc =>
      doc.storefront.blocks[0].settings.find((s: Doc) => s.key === key);

    it('accepts every new field and normalises them', () => {
      const result = validateManifest(app(), V);
      expect(result.ok ? [] : codes(result.errors)).toEqual([]);
      if (!result.ok) return;
      const manifest: Doc = result.manifest;
      expect(Object.keys(manifest).slice(-4)).toEqual([
        'webhooks',
        'data',
        'storefront',
        'app_proxy',
      ]);
      expect(manifest.admin).toEqual({
        page: '/',
        actions: [printAction()],
      });
      expect(manifest.app_proxy).toEqual({ path: '/proxy' });
      expect(manifest.data.definitions).toEqual([
        {
          owner: 'product',
          key: 'rating',
          type: 'json',
          visibility: 'storefront',
          label: { ar: 'التقييم', en: 'Rating' },
        },
        {
          owner: 'store',
          key: 'theme',
          type: 'json',
          visibility: 'storefront',
        },
      ]);
      const [block] = manifest.storefront.blocks;
      expect(Object.keys(block)).toEqual([
        'handle',
        'template',
        'stylesheet',
        'name',
        'target',
        'data',
        'settings',
      ]);
      // `data` is a set: sorted, like allowed_hosts.
      expect(block.data).toEqual(['product.rating', 'store.theme']);
      expect(block.settings).toEqual(ratingBlock().settings);
      expect(block.settings.map((s: Doc) => Object.keys(s))).toEqual([
        ['key', 'type', 'label', 'default'],
        ['key', 'type', 'label', 'default', 'options'],
        ['key', 'type', 'label', 'default', 'min', 'max'],
        ['key', 'type', 'label', 'default', 'min', 'max'],
        ['key', 'type', 'label', 'default', 'max_length'],
        ['key', 'type', 'label', 'default'],
        ['key', 'type', 'label', 'default'],
        ['key', 'type', 'label', 'default'],
        ['key', 'type', 'label'],
        ['key', 'type', 'label'],
        ['key', 'type', 'label'],
      ]);
      const again = validateManifest(JSON.parse(JSON.stringify(manifest)), V);
      expect(again).toEqual(result);
    });

    it('fills a block\'s defaults: target "any", no data, no settings', () => {
      const result = validateManifest(
        app((doc) => {
          doc.storefront.blocks = [
            { handle: 'banner', template: 'blocks/banner.liquid' },
          ];
        }),
        V,
      );
      expect(result.ok && result.manifest.storefront.blocks).toEqual([
        {
          handle: 'banner',
          template: 'blocks/banner.liquid',
          target: 'any',
          data: [],
          settings: [],
        },
      ]);
    });

    it('keeps a manifest without the new fields exactly as before', () => {
      const result = validateManifest(hostedManifest(), V);
      expect(result.ok && Object.keys(result.manifest)).toEqual([
        'name',
        'handle',
        'api_version',
        'access',
        'hosting',
        'admin',
        'webhooks',
        'data',
        'storefront',
      ]);
      expect(result.ok && result.manifest.admin).toEqual({ page: '/' });
    });

    describe('labels ({ ar, en })', () => {
      it.each([
        ['', 'is empty'],
        ['x'.repeat(51), 'the limit is 50'],
        ['Rat​ing', 'U+200B'],
        [' Rating', 'starts or ends with a space'],
      ])('refuses %j, with the code of the field', (text, words) => {
        const errors = expectErrors(
          app((doc) => {
            doc.data.definitions[0].label.en = text;
            doc.storefront.blocks[0].name.ar = text;
            setting(doc, 'layout').label.en = text;
            setting(doc, 'layout').options[1].label.ar = text;
            doc.admin.actions[0].label.en = text;
          }),
          [
            'MANIFEST_ACTION_LABEL_INVALID admin.actions[0].label.en',
            'MANIFEST_DATA_LABEL_INVALID data.definitions[0].label.en',
            'MANIFEST_BLOCK_NAME_INVALID storefront.blocks[0].name.ar',
            'MANIFEST_BLOCK_SETTING_LABEL_INVALID storefront.blocks[0].settings[1].label.en',
            'MANIFEST_BLOCK_SETTING_LABEL_INVALID storefront.blocks[0].settings[1].options[1].label.ar',
          ],
          V,
        );
        for (const error of errors) expect(error.message).toContain(words);
        if (text === '') {
          expect(errors[1]?.fix).toBe(
            'Write the English text merchants read, 50 characters at most.',
          );
          expect(errors[2]?.fix).toMatch(/^Write the Arabic text/);
        }
      });

      it('needs both languages, and only them', () => {
        expectErrors(
          app((doc) => {
            doc.data.definitions[0].label = { ar: 'التقييم' };
            doc.storefront.blocks[0].name = {
              ar: 'تقييم',
              en: 'Rating',
              fr: 'Note',
            };
            doc.admin.actions[0].label = 'Print labels';
          }),
          [
            'MANIFEST_FIELD_TYPE admin.actions[0].label',
            'MANIFEST_FIELD_REQUIRED data.definitions[0].label.en',
            'MANIFEST_FIELD_UNKNOWN storefront.blocks[0].name.fr',
          ],
          V,
        );
      });
    });

    describe('a block', () => {
      it('checks its stylesheet and its target', () => {
        const errors = expectErrors(
          app((doc) => {
            doc.storefront.blocks[0].stylesheet = 'blocks/rating.scss';
            doc.storefront.blocks[0].target = 'products';
          }),
          [
            'MANIFEST_BLOCK_STYLESHEET_INVALID storefront.blocks[0].stylesheet',
            'MANIFEST_VALUE_NOT_ALLOWED storefront.blocks[0].target',
          ],
          V,
        );
        expect(errors[1]?.fix).toBe(
          'Set `storefront.blocks[0].target` to "product".',
        );
      });

      it('still refuses code, whatever else it holds', () => {
        expectErrors(
          app((doc) => {
            doc.storefront.blocks[0].script = 'alert(1)';
          }),
          ['MANIFEST_BLOCK_SCRIPT_NOT_ALLOWED storefront.blocks[0].script'],
          V,
        );
      });

      it('takes at most 20 settings and 20 data keys', () => {
        expectErrors(
          app((doc) => {
            const block = doc.storefront.blocks[0];
            block.settings = Array.from({ length: 21 }, (_, i) => ({
              key: `s${i}`,
              type: 'boolean',
              label: { ar: 'خيار', en: 'Option' },
            }));
            block.data = Array.from({ length: 21 }, (_, i) => `store.k${i}`);
          }),
          [
            'MANIFEST_LIST_TOO_LONG storefront.blocks[0].data',
            ...Array.from(
              { length: 21 },
              (_, i) =>
                `MANIFEST_BLOCK_DATA_NOT_DECLARED storefront.blocks[0].data[${i}]`,
            ),
            'MANIFEST_LIST_TOO_LONG storefront.blocks[0].settings',
          ],
          V,
        );
      });
    });

    describe("a block's data", () => {
      it('is "<owner>.<key>", never order or customer data', () => {
        const errors = expectErrors(
          app((doc) => {
            doc.storefront.blocks[0].data = [
              'rating',
              'order.notes',
              'Product.rating',
            ];
          }),
          [
            'MANIFEST_BLOCK_DATA_INVALID storefront.blocks[0].data[0]',
            'MANIFEST_BLOCK_DATA_INVALID storefront.blocks[0].data[1]',
            'MANIFEST_BLOCK_DATA_INVALID storefront.blocks[0].data[2]',
          ],
          V,
        );
        expect(errors[1]?.message).toBe(
          '`storefront.blocks[0].data[1]` is "order.notes"; order data holds buyer data, which never reaches a store page.',
        );
        expect(errors[1]?.fix).toBe(
          'Remove "order.notes" from the block\'s `data`; a block reads "business", "store", "product" data only.',
        );
      });

      it('is declared with storefront visibility, once', () => {
        const errors = expectErrors(
          app((doc) => {
            doc.data.definitions[1].visibility = 'merchant';
            doc.storefront.blocks[0].data = [
              'product.rating',
              'business.plan',
              'store.theme',
              'product.rating',
            ];
          }),
          [
            'MANIFEST_BLOCK_DATA_NOT_DECLARED storefront.blocks[0].data[1]',
            'MANIFEST_BLOCK_DATA_NOT_STOREFRONT storefront.blocks[0].data[2]',
            'MANIFEST_BLOCK_DATA_DUPLICATE storefront.blocks[0].data[3]',
          ],
          V,
        );
        expect(errors[0]?.fix).toBe(
          'Declare it: add a [[data.definitions]] entry with owner = "business", key = "plan" and visibility = "storefront", or remove "business.plan".',
        );
        expect(errors[1]?.fix).toBe(
          'Set visibility = "storefront" on the "store.theme" definition, or remove "store.theme" from the block.',
        );
      });

      it('reads product data only on the product page; store data anywhere', () => {
        const errors = expectErrors(
          app((doc) => {
            delete doc.storefront.blocks[0].target;
          }),
          ['MANIFEST_BLOCK_DATA_TARGET_MISMATCH storefront.blocks[0].data[1]'],
          V,
        );
        expect(errors[0]?.fix).toBe(
          'Set target = "product" on `storefront.blocks[0]`, or read business or store data instead.',
        );
        expect(
          at(
            app((doc) => {
              doc.storefront.blocks[0].target = 'any';
              doc.storefront.blocks[0].data = ['store.theme'];
            }),
          ),
        ).toEqual([]);
      });

      it('is not judged against definitions that cannot be read', () => {
        expectErrors(
          app((doc) => {
            doc.data = { definitions: 'rating' };
          }),
          ['MANIFEST_FIELD_TYPE data.definitions'],
          V,
        );
      });
    });

    describe("a block's settings", () => {
      it('need a key, a type and a label; keys are unique', () => {
        const errors = expectErrors(
          app((doc) => {
            const settings = doc.storefront.blocks[0].settings;
            settings[0].key = 'Show Count';
            settings[1].key = 'stars';
            settings[3].type = 'float';
            delete settings[4].label;
            settings[5].hint = 'x';
          }),
          [
            'MANIFEST_BLOCK_SETTING_KEY_INVALID storefront.blocks[0].settings[0].key',
            'MANIFEST_BLOCK_SETTING_KEY_DUPLICATE storefront.blocks[0].settings[2].key',
            'MANIFEST_VALUE_NOT_ALLOWED storefront.blocks[0].settings[3].type',
            'MANIFEST_FIELD_REQUIRED storefront.blocks[0].settings[4].label',
            'MANIFEST_FIELD_UNKNOWN storefront.blocks[0].settings[5].hint',
          ],
          V,
        );
        expect(errors[0]?.fix).toBe(
          'Set `storefront.blocks[0].settings[0].key` to a key of that form, e.g. "show_count".',
        );
        expect(errors[3]?.fix).toBe(
          'Add label = { ar = "عرض العدد", en = "Show the count" } to the [[storefront.blocks.settings]] entry `storefront.blocks[0].settings[4]`.',
        );
      });

      it('take each field only on the types that use it', () => {
        expectErrors(
          app((doc) => {
            setting(doc, 'show_count').options = setting(doc, 'layout').options;
            setting(doc, 'heading').min = 1;
            setting(doc, 'stars').max_length = 10;
          }),
          [
            'MANIFEST_BLOCK_SETTING_FIELD_NOT_FOR_TYPE storefront.blocks[0].settings[0].options',
            'MANIFEST_BLOCK_SETTING_FIELD_NOT_FOR_TYPE storefront.blocks[0].settings[2].max_length',
            'MANIFEST_BLOCK_SETTING_FIELD_NOT_FOR_TYPE storefront.blocks[0].settings[4].min',
          ],
          V,
        );
      });

      it('a select needs 2 to 20 options, each value once', () => {
        expectErrors(
          app((doc) => {
            delete setting(doc, 'layout').options;
          }),
          ['MANIFEST_FIELD_REQUIRED storefront.blocks[0].settings[1].options'],
          V,
        );
        const errors = expectErrors(
          app((doc) => {
            setting(doc, 'layout').options.length = 1;
          }),
          ['MANIFEST_LIST_TOO_SHORT storefront.blocks[0].settings[1].options'],
          V,
        );
        expect(errors[0]).toMatchObject({
          message:
            '`storefront.blocks[0].settings[1].options` has 1 entry; it needs at least 2.',
          fix: 'List at least 2 entries in `storefront.blocks[0].settings[1].options`.',
        });
        expectErrors(
          app((doc) => {
            const options = setting(doc, 'layout').options;
            options[1].value = 'grid';
            options.push({
              value: 'Big Cards',
              label: { ar: 'بطاقات', en: 'Cards' },
            });
            options.push(
              ...Array.from({ length: 18 }, (_, i) => ({
                value: `o${i}`,
                label: { ar: 'خيار', en: 'Option' },
              })),
            );
          }),
          [
            'MANIFEST_LIST_TOO_LONG storefront.blocks[0].settings[1].options',
            'MANIFEST_BLOCK_SETTING_OPTION_DUPLICATE storefront.blocks[0].settings[1].options[1].value',
            'MANIFEST_BLOCK_SETTING_OPTION_INVALID storefront.blocks[0].settings[1].options[2].value',
            // The default is judged against the valid options only.
          ],
          V,
        );
      });

      it('check their range: whole numbers for an integer, min at most max', () => {
        expectErrors(
          app((doc) => {
            setting(doc, 'stars').min = 1.5;
            setting(doc, 'threshold').min = 4;
            setting(doc, 'threshold').max = 3;
            setting(doc, 'heading').max_length = 0;
          }),
          [
            'MANIFEST_BLOCK_SETTING_RANGE_INVALID storefront.blocks[0].settings[2].min',
            'MANIFEST_BLOCK_SETTING_RANGE_INVALID storefront.blocks[0].settings[3].max',
            'MANIFEST_BLOCK_SETTING_RANGE_INVALID storefront.blocks[0].settings[4].max_length',
          ],
          V,
        );
      });

      it.each([
        ['max_length', 2000],
        ['max_length', 1.5],
        ['max_length', Infinity],
        ['min', Infinity],
        ['min', Number.NaN],
        ['min', BigInt(1)],
      ])('explain a refused number: %s = %s', (field, value) => {
        const key = field === 'min' ? 'stars' : 'heading';
        const index = key === 'stars' ? 2 : 4;
        const errors = expectErrors(
          app((doc) => {
            setting(doc, key)[field] = value;
          }),
          [
            `MANIFEST_BLOCK_SETTING_RANGE_INVALID storefront.blocks[0].settings[${index}].${field}`,
          ],
          V,
        );
        expect(errors[0]?.fix).toMatch(/^Set `/);
      });

      it('refuse a number written as a string', () => {
        expectErrors(
          app((doc) => {
            setting(doc, 'stars').max = '10';
            setting(doc, 'heading').max_length = '60';
          }),
          [
            'MANIFEST_FIELD_TYPE storefront.blocks[0].settings[2].max',
            'MANIFEST_FIELD_TYPE storefront.blocks[0].settings[4].max_length',
          ],
          V,
        );
      });
    });

    describe("a setting's default", () => {
      const refused = (key: string, value: unknown, expected: string[]) => {
        const errors = expectErrors(
          app((doc) => {
            setting(doc, key).default = value;
          }),
          expected,
          V,
        );
        return errors[0];
      };
      const index = (key: string) =>
        ratingBlock().settings.findIndex((s: Doc) => s.key === key);
      const path = (key: string) =>
        `storefront.blocks[0].settings[${index(key)}].default`;

      it.each([
        ['show_count', 'yes'],
        ['stars', 2.5],
        ['stars', 11],
        ['stars', '5'],
        ['threshold', -1],
        ['threshold', Number.NaN],
        ['layout', 'cards'],
        ['accent', 'red'],
        ['accent', '#12345'],
        ['more', 'javascript:alert(1)'],
        ['more', '//evil.example.com'],
        ['more', 'http://example.com'],
        ['more', 'https://example.com/a b'],
        ['heading', 'a\nb'],
        ['heading', 'x'.repeat(61)],
        ['heading', { ar: 'عنوان' }],
        ['heading', ['x']],
        ['note', 'x'.repeat(1001)],
        ['note', 'a‮b'],
        ['badge', 'https://cdn.tassyir.io/x.png'],
        ['pick', '123'],
        ['shelf', '123'],
      ])('refuses %s = %j', (key, value) => {
        const error = refused(key, value, [
          `MANIFEST_BLOCK_SETTING_DEFAULT_INVALID ${path(key)}`,
        ]);
        expect(error?.fix).toMatch(/^(Set|Remove|Shorten) /);
      });

      it('names the language of a { ar, en } default that fails', () => {
        refused('heading', { ar: 'a‮b', en: 'Reviews' }, [
          `MANIFEST_BLOCK_SETTING_DEFAULT_INVALID ${path('heading')}.ar`,
        ]);
        const error = refused('heading', { ar: 'آراء', en: 7 }, [
          `MANIFEST_BLOCK_SETTING_DEFAULT_INVALID ${path('heading')}.en`,
        ]);
        expect(error?.fix).toBe(
          `Write \`${path('heading')}.en\` as a quoted string.`,
        );
      });

      it('lists the options of a select', () => {
        const error = refused('layout', 'cards', [
          `MANIFEST_BLOCK_SETTING_DEFAULT_INVALID ${path('layout')}`,
        ]);
        expect(error?.fix).toBe(
          `Set \`${path('layout')}\` to one of "grid", "list".`,
        );
      });

      it('says why an image, product or collection takes none', () => {
        const error = refused('badge', 'x', [
          `MANIFEST_BLOCK_SETTING_DEFAULT_INVALID ${path('badge')}`,
        ]);
        expect(error?.message).toBe(
          `\`${path('badge')}\` is set, but an image setting takes no default: the merchant picks one from their own store.`,
        );
      });

      it.each([
        ['show_count', false],
        ['stars', 1],
        ['threshold', 0],
        ['layout', 'list'],
        ['accent', '#abcdef'],
        ['more', 'https://example.com/help?topic=reviews#top'],
        ['more', '/'],
        ['heading', ''],
        ['heading', 'x'.repeat(60)],
        ['note', 'x'.repeat(1000)],
        ['note', { ar: 'سطر\nسطر', en: 'Line\nline' }],
      ])('accepts %s = %j', (key, value) => {
        expect(
          at(
            app((doc) => {
              setting(doc, key).default = value;
            }),
          ),
        ).toEqual([]);
      });

      it('is judged by its type only when its fields fit the type', () => {
        expectErrors(
          app((doc) => {
            setting(doc, 'show_count').max_length = 5;
            setting(doc, 'show_count').default = 'x';
          }),
          [
            'MANIFEST_BLOCK_SETTING_FIELD_NOT_FOR_TYPE storefront.blocks[0].settings[0].max_length',
          ],
          V,
        );
      });
    });

    describe('the app proxy', () => {
      it('is refused while the platform has not opened it', () => {
        const errors = expectErrors(
          hosted((doc) => {
            doc.app_proxy = { path: '/proxy' };
          }),
          ['MANIFEST_PROXY_NOT_AVAILABLE app_proxy'],
        );
        expect(errors[0]?.fix).toBe(
          'Remove the [app_proxy] table; the app proxy opens later.',
        );
      });

      it('needs the storefront scope once it is open', () => {
        const errors = expectErrors(
          hosted((doc) => {
            doc.app_proxy = { path: '/proxy' };
          }),
          ['MANIFEST_PROXY_SCOPE_MISSING app_proxy'],
          V,
        );
        expect(errors[0]?.fix).toBe(
          'Add "write_storefront" to `access.scopes`, or remove the [app_proxy] table.',
        );
        expect(
          at(
            hosted((doc) => {
              doc.access.optional_scopes.push('write_storefront');
              doc.access.scope_reasons.write_storefront =
                'Answer the review form on the store';
              doc.app_proxy = { path: '/proxy' };
            }),
          ),
        ).toEqual([]);
      });

      it("takes a path on the app's origin, outside /.tassyir/ when hosted", () => {
        expectErrors(
          app((doc) => {
            doc.app_proxy = { path: 'proxy' };
          }),
          ['MANIFEST_PATH_INVALID app_proxy.path'],
          V,
        );
        expectErrors(
          app((doc) => {
            doc.app_proxy = {};
          }),
          ['MANIFEST_FIELD_REQUIRED app_proxy.path'],
          V,
        );
        expectErrors(
          app((doc) => {
            doc.app_proxy = { path: '/.tassyir/proxy' };
          }),
          ['MANIFEST_PATH_RESERVED app_proxy.path'],
          V,
        );
        expect(
          at(
            external((doc) => {
              doc.access.scopes.push('write_storefront');
              doc.access.scope_reasons.write_storefront =
                'Answer the review form on the store';
              doc.app_proxy = { path: '/.tassyir/proxy' };
            }),
          ),
        ).toEqual([]);
      });
    });

    describe('admin actions', () => {
      it('check their handle, target, path, and handles once', () => {
        const errors = expectErrors(
          app((doc) => {
            doc.admin.actions = [
              { ...printAction(), handle: 'Print Labels' },
              { ...printAction(), target: 'order' },
              { ...printAction(), handle: 'export', path: 'actions/export' },
              { ...printAction(), handle: 'export' },
            ];
          }),
          [
            'MANIFEST_ACTION_HANDLE_INVALID admin.actions[0].handle',
            'MANIFEST_VALUE_NOT_ALLOWED admin.actions[1].target',
            'MANIFEST_PATH_INVALID admin.actions[2].path',
            'MANIFEST_ACTION_HANDLE_DUPLICATE admin.actions[3].handle',
          ],
          V,
        );
        expect(errors[0]?.fix).toBe(
          'Set `admin.actions[0].handle` to a handle of that form, e.g. "print-labels".',
        );
      });

      it('need the read scope of their resource (optional and implied count)', () => {
        const errors = expectErrors(
          app((doc) => {
            doc.admin.actions = [
              { ...printAction(), handle: 'a', target: 'customer.details' },
            ];
            doc.admin.actions[0].handle = 'customer-card';
          }),
          ['MANIFEST_ACTION_SCOPE_MISSING admin.actions[0].target'],
          V,
        );
        expect(errors[0]?.fix).toBe(
          'Add "read_customers" to `access.scopes` (or `access.optional_scopes`), or remove `admin.actions[0]`.',
        );
        expect(
          at(
            app((doc) => {
              doc.access.optional_scopes = ['read_customers'];
              doc.access.scope_reasons.read_customers =
                "Show the buyer's review history";
              delete doc.access.scope_reasons.read_customer_contact;
              doc.admin.actions[0].target = 'customer.details';
            }),
          ),
        ).toEqual([]);
        expect(
          at(
            app((doc) => {
              doc.access.scopes = [
                'write_orders',
                'read_products',
                'write_storefront',
              ];
              doc.access.scope_reasons.write_orders = 'Mark the orders printed';
              delete doc.access.scope_reasons.read_orders;
              doc.admin.actions[0].target = 'order.details';
            }),
          ),
        ).toEqual([]);
      });

      it('may stand without a page, and at most 10', () => {
        const result = validateManifest(
          app((doc) => {
            delete doc.admin.page;
          }),
          V,
        );
        expect(result.ok && result.manifest.admin).toEqual({
          actions: [printAction()],
        });
        expectErrors(
          app((doc) => {
            doc.admin.actions = Array.from({ length: 11 }, (_, i) => ({
              ...printAction(),
              handle: `action-${i}`,
            }));
          }),
          ['MANIFEST_LIST_TOO_LONG admin.actions'],
          V,
        );
      });

      it("keep a hosted app's paths out of /.tassyir/", () => {
        expectErrors(
          app((doc) => {
            doc.admin.actions[0].path = '/.tassyir/print';
          }),
          ['MANIFEST_PATH_RESERVED admin.actions[0].path'],
          V,
        );
      });
    });

    it('the new fields are in the published shape', () => {
      const schema = manifestJsonSchema(V);
      const doc = app();
      expect(schemaViolations(doc, schema)).toEqual([]);
      const result = validateManifest(doc, V);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(
          schemaViolations(JSON.parse(JSON.stringify(result.manifest)), schema),
        ).toEqual([]);
      }
      const broken = app((d) => {
        setting(d, 'stars').max_length = 0;
        setting(d, 'layout').options.length = 1;
        d.admin.actions[0].target = 'order';
      });
      expect(schemaViolations(broken, schema)).toEqual([
        '$.admin.actions[0].target: "order" not in enum',
        '$.storefront.blocks[0].settings[1].options: fewer than 2 items',
        '$.storefront.blocks[0].settings[2].max_length: below 1',
      ]);
    });
  });

  describe('the error list', () => {
    const broken = () =>
      hosted((doc) => {
        doc.storefront = { blocks: [{ handle: 'x', template: 'x' }] };
        doc.zzz = 1;
        doc.webhooks[0].topics = ['orders/create', 'products/updated'];
        doc.access.scopes = ['read_order'];
        doc.handle = 'X';
        doc.name = '';
        doc.aaa = 2;
      });

    it('is in manifest order, then index, whatever order the keys came in', () => {
      const expected = [
        'MANIFEST_NAME_INVALID name',
        'MANIFEST_HANDLE_INVALID handle',
        'MANIFEST_SCOPE_UNKNOWN access.scopes[0]',
        'MANIFEST_SCOPE_NEEDS_ANOTHER access.optional_scopes[0]',
        'MANIFEST_SCOPE_REASON_UNUSED access.scope_reasons.read_orders',
        'MANIFEST_SCOPE_REASON_UNUSED access.scope_reasons.read_products',
        'MANIFEST_TOPIC_UNKNOWN webhooks[0].topics[0]',
        'MANIFEST_TOPIC_SCOPE_MISSING webhooks[0].topics[1]',
        'MANIFEST_BLOCKS_NOT_AVAILABLE storefront.blocks',
        'MANIFEST_BLOCK_HANDLE_INVALID storefront.blocks[0].handle',
        'MANIFEST_BLOCK_TEMPLATE_INVALID storefront.blocks[0].template',
        'MANIFEST_FIELD_UNKNOWN aaa',
        'MANIFEST_FIELD_UNKNOWN zzz',
      ];
      const doc = broken();
      expect(codes(errorsOf(doc))).toEqual(expected);
      const reversed = Object.fromEntries(Object.entries(doc).reverse());
      expect(errorsOf(reversed)).toEqual(errorsOf(doc));
      expect(errorsOf(doc)).toEqual(errorsOf(broken()));
    });

    it('every error is coded, located, and fixed in one sentence', () => {
      const zodWords =
        /Invalid input|Invalid option|Invalid string|Too small|Too big|Unrecognized key|expected one of|received/;
      for (const error of errorsOf(broken())) {
        expect(MANIFEST_ERROR_CODES).toContain(error.code);
        expect(typeof error.path).toBe('string');
        expect(error.message).toMatch(/^\S[^\n]*\.$/);
        expect(error.fix).toMatch(/^[A-Z][^\n]*\.$/);
        expect(error.fix).not.toMatch(/\.\s+[A-Z]/);
        expect(`${error.message} ${error.fix}`).not.toMatch(zodWords);
      }
    });

    it(`stops at ${MANIFEST_LIMITS.maxErrors} errors and says how many it left out`, () => {
      const doc = hosted((d) => {
        d.webhooks = Array.from(
          { length: MANIFEST_LIMITS.webhooksMax },
          () => ({
            topics: ['a/1', 'b/2', 'c/3', 'd/4', 'e/5', 'f/6'],
            uri: '/x',
          }),
        );
      });
      const errors = errorsOf(doc);
      expect(errors).toHaveLength(MANIFEST_LIMITS.maxErrors + 1);
      expect(errors[MANIFEST_LIMITS.maxErrors]).toEqual({
        code: 'MANIFEST_TOO_MANY_ERRORS',
        path: '',
        // 60 unknown topics + 10 lists longer than the 5 topics there are.
        message: '20 more errors were not listed.',
        fix: 'Fix the errors listed, then validate again to see the rest.',
      });
      // A list's own error comes before its items'.
      expect(codes(errors.slice(0, 2))).toEqual([
        'MANIFEST_LIST_TOO_LONG webhooks[0].topics',
        'MANIFEST_TOPIC_UNKNOWN webhooks[0].topics[0]',
      ]);
    });
  });

  it('every value the schema refuses is explained by its own field check', () => {
    // The zod schema carries the single-field rules as patterns for the
    // published JSON Schema; the field checks write the message. A refusal
    // only the pattern catches would fall back to a generic error.
    const corpus = [
      '',
      ' x',
      'x ',
      'X',
      'a b',
      'a\u202Eb',
      'a\nb',
      '*',
      '*.x',
      '-a',
      'a--b',
      'a_b',
      '1',
      'x'.repeat(70),
      'x'.repeat(600),
      'http://x.example.com',
      'https://x.example.com/',
      'https://X.example.com',
      'https://x.example.com:1',
      'ftp://x.example.com',
      '//x.example.com',
      '/a//b',
      '/../a',
      'a/b.liquid',
      'b.js',
      '1.2.3.4',
      'orders/created',
      'read_orders',
      'tassyir',
    ];
    const leaves: Array<(doc: Doc, value: string) => void> = [
      (d, v) => (d.name = v),
      (d, v) => (d.handle = v),
      (d, v) => (d.api_version = v),
      (d, v) => (d.access.scopes[0] = v),
      (d, v) => (d.access.optional_scopes[0] = v),
      (d, v) => (d.access.scope_reasons.read_orders = v),
      (d, v) => (d.access.scope_reasons[v] = 'A reason long enough'),
      (d, v) => (d.hosting.mode = v),
      (d, v) => (d.hosting.allowed_hosts[0] = v),
      (d, v) => (d.admin.page = v),
      (d, v) => (d.webhooks[0].topics[0] = v),
      (d, v) => (d.webhooks[0].uri = v),
      (d, v) => (d.data.definitions[0].owner = v),
      (d, v) => (d.data.definitions[0].key = v),
      (d, v) => (d.data.definitions[0].type = v),
      (d, v) => (d.data.definitions[0].visibility = v),
      (d, v) => (d.storefront = { blocks: [{ handle: v, template: v }] }),
      (d, v) => (d.data.definitions[0].label = { ar: v, en: v }),
      (d, v) =>
        (d.storefront = {
          blocks: [
            {
              handle: 'block-1',
              template: 'blocks/b.liquid',
              stylesheet: v,
              name: { ar: v, en: v },
              target: v,
              data: [v],
              settings: [
                {
                  key: v,
                  type: v,
                  label: { ar: v, en: v },
                  options: [
                    { value: v, label: { ar: v, en: v } },
                    { value: 'x', label: { ar: 'x', en: 'x' } },
                  ],
                },
              ],
            },
          ],
        }),
      (d, v) =>
        (d.admin.actions = [
          { handle: v, target: v, label: { ar: v, en: v }, path: v },
        ]),
      (d, v) => (d.app_proxy = { path: v }),
    ];
    const externalLeaves: Array<(doc: Doc, value: string) => void> = [
      (d, v) => (d.hosting.url = v),
      (d, v) => (d.auth.callback_url = v),
      (d, v) => (d.webhooks[0].uri = v),
    ];
    const generic: string[] = [];
    const check = (doc: Doc) => {
      for (const error of errorsOf(doc)) {
        if (error.message.includes('which the manifest schema refuses')) {
          generic.push(`${error.path} ${error.message}`);
        }
      }
    };
    for (const value of corpus) {
      for (const set of leaves) {
        check(
          hosted((doc) => {
            set(doc, value);
          }),
        );
      }
      for (const set of externalLeaves) {
        check(
          external((doc) => {
            set(doc, value);
          }),
        );
      }
    }
    expect(generic).toEqual([]);
  });

  // Last on purpose: the cases above must exercise every published code.
  it('every error code is produced by a case above', () => {
    expect(MANIFEST_ERROR_CODES.filter((code) => !seen.has(code))).toEqual([]);
  });
});

// Known gaps, kept on purpose: the package must answer what the API answers
// (AP-K1.2 moved the validator without changing it). zod reads any non-array
// object as a table, and an own `undefined` counts as present. JSON (the
// API's input) carries neither; a TOML date (or a JS caller) does. To fix in
// the package and the backend together (tassyir/backend plan §10, AP-K1.2);
// these cases then flip.
describe('known gaps (the same in the API)', () => {
  it.each([
    ['a date', new Date(0)],
    ['a Map', new Map()],
  ])(
    '`access` as %s reads as an empty table, so topic scopes go unchecked',
    (_label, value) => {
      const result = validateManifest(
        hosted((doc) => {
          doc.access = value;
        }),
        FIXTURE_VOCABULARY,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.manifest.access).toEqual({
        scopes: [],
        optional_scopes: [],
        scope_reasons: {},
      });
      // ...and the normalised manifest does not validate.
      expect(
        codes(errorsOf(JSON.parse(JSON.stringify(result.manifest)))),
      ).toEqual(['MANIFEST_TOPIC_SCOPE_MISSING webhooks[0].topics[0]']);
    },
  );

  it('`hosting.url` given as undefined passes, and the normalised form has no url', () => {
    const result = validateManifest(
      external((doc) => {
        doc.hosting.url = undefined;
      }),
      FIXTURE_VOCABULARY,
    );
    expect(result.ok && result.manifest.hosting).toEqual({ mode: 'external' });
  });
});

describe('validateManifestField (one field, the manifest rule)', () => {
  it('passes what the manifest accepts', () => {
    expect(validateManifestField('handle', 'review-requests')).toBeNull();
    expect(validateManifestField('name', 'Review Requests')).toBeNull();
  });

  it('gives the code, message and fix the manifest would', () => {
    for (const [field, value, code] of [
      ['handle', 'Review_Requests', 'MANIFEST_HANDLE_INVALID'],
      ['handle', 'tassyir', 'MANIFEST_HANDLE_RESERVED'],
      ['name', ' padded ', 'MANIFEST_NAME_INVALID'],
    ] as const) {
      const inManifest = validateManifest(
        { ...externalManifest(), [field]: value },
        FIXTURE_VOCABULARY,
      );
      expect(inManifest.ok).toBe(false);
      const same = !inManifest.ok
        ? inManifest.errors.find((e) => e.path === field)
        : undefined;
      expect(same?.code).toBe(code);
      expect(validateManifestField(field, value)).toEqual(same);
    }
  });

  it("names the caller's own field in path, message and fix", () => {
    const error = validateManifestField('name', '', 'nameEn');
    expect(error).toMatchObject({
      code: 'MANIFEST_NAME_INVALID',
      path: 'nameEn',
    });
    expect(error?.message).toContain('`nameEn`');
  });

  it('refuses a value that is not a string', () => {
    expect(validateManifestField('handle', 42)).toMatchObject({
      code: 'MANIFEST_FIELD_TYPE',
      path: 'handle',
    });
  });
});
