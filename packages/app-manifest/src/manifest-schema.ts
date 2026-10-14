import { z } from 'zod';
import {
  ALLOWED_HOST_PATTERN,
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
  RELATIVE_PATH_HINT,
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

function relativePath() {
  return z.string().max(L.pathMaxLength).regex(RELATIVE_PATH_HINT);
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
                handle: z
                  .string()
                  .min(L.handleMinLength)
                  .max(L.handleMaxLength)
                  .regex(HANDLE_PATTERN),
                template: z
                  .string()
                  .max(L.templateMaxLength)
                  .regex(TEMPLATE_PATTERN)
                  .describe(
                    'A .liquid file of the app bundle. Declarative only: no scripts.',
                  ),
              }),
            )
            .max(L.storefrontBlocksMax)
            .describe('Storefront blocks (Phase 2: refused until then).')
            .optional(),
        })
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
