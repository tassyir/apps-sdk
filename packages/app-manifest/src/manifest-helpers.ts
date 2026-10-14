import { HOSTED_APPS_DOMAIN } from './manifest-limits.js';
import type { AppManifest, ManifestVocabulary } from './manifest-types.js';
import { MANIFEST_VOCABULARY } from './vocabulary.js';

/**
 * Readers of a NORMALISED manifest (the output of `validateManifest`), so
 * the API's registry, installer and webhook relay, the CLI and an app
 * resolve URLs and sets one way.
 */

/** The columns of an `app_versions` row that repeat the manifest (plan §4). */
export interface ManifestVersionColumns {
  apiVersion: string;
  scopes: string[];
  optionalScopes: string[];
  /** Every subscribed topic, once, in catalogue order. */
  webhookTopics: string[];
  /** Tassyir Hosting's egress allowlist; empty for an external app. */
  allowedHosts: string[];
}

export function manifestVersionColumns(
  manifest: AppManifest,
  vocabulary: ManifestVocabulary = MANIFEST_VOCABULARY,
): ManifestVersionColumns {
  const subscribed = new Set(manifest.webhooks.flatMap((hook) => hook.topics));
  return {
    apiVersion: manifest.api_version,
    scopes: [...manifest.access.scopes],
    optionalScopes: [...manifest.access.optional_scopes],
    webhookTopics: vocabulary.topics
      .map((topic) => topic.name)
      .filter((topic) => subscribed.has(topic)),
    allowedHosts:
      manifest.hosting.mode === 'tassyir'
        ? [...manifest.hosting.allowed_hosts]
        : [],
  };
}

/** The origin a hosted app is served from (D2). */
export function hostedAppOrigin(handle: string): string {
  return `https://${handle}.${HOSTED_APPS_DOMAIN}`;
}

export interface ResolvedManifestUri {
  /** `hosted`: reached through the Tassyir dispatcher (AP-B1.15/16). */
  via: 'hosted' | 'external';
  url: string;
}

/**
 * The absolute URL of `admin.page` or a webhook `uri`. A path is joined to
 * the app's base: `https://{handle}.tassyir-apps.com` for a hosted app, or
 * `hosting.url` (its own path kept, it never ends with "/") for an external
 * one. An absolute URL (external apps only) is used as written.
 */
export function resolveManifestUri(
  manifest: AppManifest,
  uri: string,
): ResolvedManifestUri {
  if (manifest.hosting.mode === 'tassyir') {
    return { via: 'hosted', url: `${hostedAppOrigin(manifest.handle)}${uri}` };
  }
  if (uri.startsWith('https://')) return { via: 'external', url: uri };
  return { via: 'external', url: `${manifest.hosting.url}${uri}` };
}
