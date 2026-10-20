import { z } from 'zod';
import {
  ADMIN_ACTION_TARGETS,
  ALLOWED_HOST_PATTERN,
  BLOCK_DATA_PATTERN,
  BLOCK_TARGETS,
  DATA_KEY_PATTERN,
  DATA_OWNERS,
  DATA_TYPES,
  DATA_VISIBILITIES,
  HANDLE_PATTERN,
  HOSTED_APPS_DOMAIN,
  HOSTING_MODES,
  HTTPS_URL_HINT,
  MANIFEST_FILE_NAME,
  MANIFEST_LIMITS,
  OFFER_TYPE_CLASSES,
  OFFER_TYPE_HANDLE_PATTERN,
  RELATIVE_PATH_HINT,
  SETTING_KEY_PATTERN,
  SETTING_OPTION_VALUE_PATTERN,
  SETTING_TYPES,
  STYLESHEET_PATTERN,
  TEMPLATE_PATTERN,
  TEXT_PATTERN,
} from './manifest-limits.js';
import type { ManifestVocabulary } from './manifest-types.js';
import { MANIFEST_VOCABULARY } from './vocabulary.js';

/**
 * The manifest v1 shape as a zod 4 schema: strict tables, types, required
 * fields, enums, list sizes and single-field patterns. It is what the
 * published JSON Schema is generated from. Rules that span fields (hosting
 * mode, scope reasons, topics needing a scope, duplicates) and the precise
 * URL and hostname rules are in `validate-manifest.ts`: the JSON Schema is
 * necessary, the validator is what decides.
 */

const L = MANIFEST_LIMITS;

/** `uniqueItems` is a published hint; duplicates are refused by the validator. */
const UNIQUE = { uniqueItems: true } as const;

function nonEmpty(
  values: readonly string[],
  what: string,
): [string, ...string[]] {
  if (values.length === 0) {
    throw new Error(`The manifest vocabulary has no ${what}`);
  }
  return [...values] as [string, ...string[]];
}

function displayText(min: number, max: number) {
  return z.string().min(min).max(max).regex(TEXT_PATTERN);
}

function httpsUrl() {
  return z.string().max(L.urlMaxLength).regex(HTTPS_URL_HINT);
}

function relativePath(max: number = L.pathMaxLength) {
  return z.string().max(max).regex(RELATIVE_PATH_HINT);
}

/** Text shown to merchants in both dashboard languages. */
function label(description: string, max: number = L.labelMaxLength) {
  return z
    .strictObject({
      ar: displayText(1, max),
      en: displayText(1, max),
    })
    .describe(description);
}

function handle() {
  return z
    .string()
    .min(L.handleMinLength)
    .max(L.handleMaxLength)
    .regex(HANDLE_PATTERN);
}

/**
 * The merchant settings of a block (one schema for every kind of extension
 * that takes settings): the field rules here, the rules across fields (which
 * keys go with which type, `default` of the type) in the validator.
 */
function settings() {
  return z
    .array(
      z.strictObject({
        key: z
          .string()
          .max(L.settingKeyMaxLength)
          .regex(SETTING_KEY_PATTERN)
          .describe(
            'Unique in the block; the template reads block.settings.<key>.',
          ),
        type: z.enum(SETTING_TYPES),
        label: label('The field label the merchant reads in the builder.'),
        default: z
          .unknown()
          .describe(
            'Optional: a value of the type. string and text: a string or { ar, en }; select: an option value; color: "#rrggbb"; url: https or a path of the store. image, product and collection take none.',
          )
          .optional(),
        options: z
          .array(
            z.strictObject({
              value: z
                .string()
                .max(L.settingOptionValueMaxLength)
                .regex(SETTING_OPTION_VALUE_PATTERN),
              label: label('The choice as the merchant reads it.'),
            }),
          )
          .min(L.settingOptionsMin)
          .max(L.settingOptionsMax)
          .describe('select only (required there): the choices.')
          .optional(),
        min: z.number().describe('integer and number only.').optional(),
        max: z.number().describe('integer and number only.').optional(),
        max_length: z
          .int()
          .min(1)
          .max(L.settingTextMaxLength)
          .describe('string and text only.')
          .optional(),
      }),
    )
    .max(L.blockSettingsMax)
    .describe('What the merchant sets for the block in the store builder.');
}

/**
 * The manifest schema for a vocabulary (by default the one this package
 * ships). `apiVersion` pins `api_version` to one value (the published
 * per-version file); without it any supported version is accepted.
 */
export function buildManifestSchema(
  vocabulary: ManifestVocabulary = MANIFEST_VOCABULARY,
  apiVersion?: string,
) {
  const scopeNames = nonEmpty(
    vocabulary.scopes.filter((scope) => scope.available).map((s) => s.name),
    'available scope',
  );
  const topicNames = nonEmpty(
    vocabulary.topics.map((topic) => topic.name),
    'topic',
  );
  const scope = z.enum(scopeNames);
  const scopeList = (description: string) =>
    z.array(scope).max(scopeNames.length).meta(UNIQUE).describe(description);

  return z
    .strictObject({
      name: displayText(1, L.nameMaxLength).describe(
        "The app's display name. The ar/en listing copy lives in the developer console.",
      ),
      handle: z
        .string()
        .min(L.handleMinLength)
        .max(L.handleMaxLength)
        .regex(HANDLE_PATTERN)
        .describe(
          `Unique, never changes. A hosted app is served from https://{handle}.${HOSTED_APPS_DOMAIN}.`,
        ),
      api_version: (apiVersion
        ? z.literal(apiVersion)
        : z.enum(nonEmpty(vocabulary.apiVersions, 'API version'))
      ).describe('The Admin API and webhook version the app is built for.'),
      access: z
        .strictObject({
          scopes: scopeList(
            'Scopes the merchant must grant to install the app.',
          ).optional(),
          optional_scopes: scopeList(
            'Scopes the merchant may grant or refuse at install.',
          ).optional(),
          scope_reasons: z
            .partialRecord(
              scope,
              displayText(L.scopeReasonMinLength, L.scopeReasonMaxLength),
            )
            .describe(
              'One sentence per requested scope (required and optional), shown on the consent screen.',
            )
            .optional(),
        })
        .describe('What the app asks the merchant for.')
        .optional(),
      hosting: z
        .strictObject({
          mode: z
            .enum(HOSTING_MODES)
            .describe(
              '"tassyir": Tassyir Hosting (Cloudflare Workers). "external": your own server.',
            ),
          url: httpsUrl()
            .describe(
              'external only: the app base URL (https, port 443, no trailing "/", no query or fragment).',
            )
            .optional(),
          allowed_hosts: z
            .array(z.string().max(L.hostMaxLength).regex(ALLOWED_HOST_PATTERN))
            .max(L.allowedHostsMax)
            .meta(UNIQUE)
            .describe(
              'tassyir only (required there, may be empty): hostnames the app may call. One leading "*." wildcard label allowed; no IPs, ports or paths.',
            )
            .optional(),
        })
        .describe('Where the app runs.'),
      auth: z
        .strictObject({
          callback_url: httpsUrl()
            .describe(
              'external only: where the install code is delivered after an install (https).',
            )
            .optional(),
        })
        .optional(),
      admin: z
        .strictObject({
          page: relativePath()
            .describe(
              "The embedded dashboard page: a path on the app's origin. Omit for a headless app.",
            )
            .optional(),
          actions: z
            .array(
              z.strictObject({
                handle: handle().describe('Unique among the actions.'),
                target: z
                  .enum(ADMIN_ACTION_TARGETS)
                  .describe(
                    'Where the menu entry appears. Needs the read scope of its resource.',
                  ),
                label: label('The menu entry as the merchant reads it.'),
                path: relativePath().describe(
                  "The app's page the entry opens in the dashboard's app window, with ?id= or ?ids= added.",
                ),
              }),
            )
            .max(L.adminActionsMax)
            .describe(
              'Menu entries on the order, product and customer pages and lists.',
            )
            .optional(),
        })
        .optional(),
      webhooks: z
        .array(
          z.strictObject({
            topics: z
              .array(z.enum(topicNames))
              .min(1)
              .max(topicNames.length)
              .meta(UNIQUE)
              .describe(
                'Topics delivered to `uri`. A topic appears once in the manifest.',
              ),
            uri: z
              .string()
              .max(L.urlMaxLength)
              .regex(
                new RegExp(
                  `${RELATIVE_PATH_HINT.source}|${HTTPS_URL_HINT.source}`,
                ),
              )
              .describe(
                'A path on the app\'s origin ("/webhooks"), or for an external app an absolute https URL.',
              ),
          }),
        )
        .max(L.webhooksMax)
        .describe('Webhook subscriptions.')
        .optional(),
      data: z
        .strictObject({
          definitions: z
            .array(
              z.strictObject({
                owner: z
                  .enum(DATA_OWNERS)
                  .describe('What a value is attached to.'),
                key: z
                  .string()
                  .max(L.dataKeyMaxLength)
                  .regex(DATA_KEY_PATTERN)
                  .describe('Unique per owner.'),
                type: z.enum(DATA_TYPES),
                visibility: z
                  .enum(DATA_VISIBILITIES)
                  .describe(
                    '"app": the app only. "merchant": also shown in the dashboard. "storefront": also readable by the app\'s storefront blocks.',
                  ),
                label: label(
                  'Optional: the name the dashboard shows next to a merchant or storefront value.',
                ).optional(),
              }),
            )
            .max(L.dataDefinitionsMax)
            .optional(),
        })
        .describe('App data keys the app may write.')
        .optional(),
      storefront: z
        .strictObject({
          blocks: z
            .array(
              z.strictObject({
                handle: handle(),
                template: z
                  .string()
                  .max(L.templateMaxLength)
                  .regex(TEMPLATE_PATTERN)
                  .describe(
                    'A .liquid file of the app bundle. Declarative only: no scripts.',
                  ),
                stylesheet: z
                  .string()
                  .max(L.templateMaxLength)
                  .regex(STYLESHEET_PATTERN)
                  .describe('Optional: a .css file of the app bundle.')
                  .optional(),
                name: label(
                  'The block as the merchant reads it in the store builder.',
                ).optional(),
                target: z
                  .enum(BLOCK_TARGETS)
                  .describe(
                    '"product": the product page (the template reads `product`). "any" (the default): any page but the order form\'s.',
                  )
                  .optional(),
                data: z
                  .array(z.string().regex(BLOCK_DATA_PATTERN))
                  .max(L.blockDataMax)
                  .meta(UNIQUE)
                  .describe(
                    'App data the template reads: "<owner>.<key>" of a [[data.definitions]] entry with storefront visibility.',
                  )
                  .optional(),
                settings: settings().optional(),
              }),
            )
            .max(L.storefrontBlocksMax)
            .describe(
              'Declarative storefront blocks: they need the write_storefront scope.',
            )
            .optional(),
        })
        .optional(),
      offers: z
        .strictObject({
          types: z
            .array(
              z.strictObject({
                handle: z
                  .string()
                  .regex(OFFER_TYPE_HANDLE_PATTERN)
                  .describe(
                    'Unique among the types: lowercase letters, digits and hyphens, at most 40.',
                  ),
                class: z
                  .enum(OFFER_TYPE_CLASSES)
                  .describe(
                    'What the offers of this type do: "product" (money off lines, a gift), "order" (money off the goods) or "delivery" (a waived fee). Every rule of the type uses this class.',
                  ),
                path: relativePath(L.offerTypePathMaxLength).describe(
                  "The app's page that configures one offer of this type: a path on the app's origin.",
                ),
                label: label(
                  'The type as the merchant reads it in "From your apps".',
                ),
                description: label(
                  'Optional: one sentence under the name.',
                  L.offerTypeDescriptionMaxLength,
                ).optional(),
              }),
            )
            .max(L.offerTypesMax)
            .describe(
              'Offer types the merchant can create from the app: they need the write_offers scope.',
            )
            .optional(),
        })
        .optional(),
      app_proxy: z
        .strictObject({
          path: relativePath().describe(
            "Where Tassyir forwards https://{store}/apps/{handle}/…: a path on the app's origin.",
          ),
        })
        .describe(
          'The app proxy: needs the write_storefront scope. Answers are JSON, text, XML or images, never HTML.',
        )
        .optional(),
    })
    .meta({
      title: `Tassyir app manifest${apiVersion ? ` (${apiVersion})` : ''}`,
      description: `The parsed ${MANIFEST_FILE_NAME}. Field names are the TOML keys.`,
    });
}

function latestApiVersion(vocabulary: ManifestVocabulary): string {
  const latest = vocabulary.apiVersions[vocabulary.apiVersions.length - 1];
  if (latest === undefined) {
    throw new Error('The manifest vocabulary has no API version');
  }
  return latest;
}

/**
 * The published JSON Schema (draft 2020-12) of the manifest for one API
 * version (by default the vocabulary's latest). This package ships it as
 * `@tassyir/app-manifest/schemas/manifest.<version>.schema.json`, and the API as
 * tassyir/backend docs/api/apps/manifest.<version>.schema.json: the same
 * bytes.
 */
export function manifestJsonSchema(
  vocabulary: ManifestVocabulary = MANIFEST_VOCABULARY,
  apiVersion: string = latestApiVersion(vocabulary),
): Record<string, unknown> {
  return z.toJSONSchema(buildManifestSchema(vocabulary, apiVersion), {
    target: 'draft-2020-12',
  });
}
