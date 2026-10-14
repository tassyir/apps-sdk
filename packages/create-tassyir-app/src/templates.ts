import { fileURLToPath } from 'node:url';
// The versions the generated package.json names, read from this repo's
// packages when this one is built (and from the files themselves in tests),
// so a release of create-tassyir-app always names the versions released with
// it.
import appPackage from '../../app/package.json' with { type: 'json' };
import appBridgePackage from '../../app-bridge/package.json' with { type: 'json' };
import appManifestPackage from '../../app-manifest/package.json' with { type: 'json' };

export type TemplateName = 'external' | 'hosted';

export interface TemplateInfo {
  name: TemplateName;
  /** False until the platform side exists: the template is refused with `fix`. */
  available: boolean;
  description: string;
  /** Why it is not available yet, and what to do instead. */
  unavailable?: { reason: string; fix: string };
}

/** The starters. `external` is the default. */
export const TEMPLATES: readonly TemplateInfo[] = Object.freeze([
  {
    name: 'external',
    available: true,
    description:
      'An app on your own server: Node 22 and Hono, an embedded page with App Bridge, signed webhooks and the Admin API.',
  },
  {
    // The seam for Tassyir Hosting: a Hono + React app deployed to Cloudflare
    // Workers for Platforms. It needs the deploy pipeline, the dispatcher and
    // the hosted runtime (AP-B1.14 to AP-B1.16), then its own folder under
    // templates/ and `available: true`.
    name: 'hosted',
    available: false,
    description:
      'An app on Tassyir Hosting: Hono and React on Cloudflare Workers, no server to run.',
    unavailable: {
      reason: 'Tassyir Hosting is not open yet',
      fix: 'Use --template external (your own server) for now; the same manifest, API and webhooks move to Tassyir Hosting when it opens.',
    },
  },
]);

/** The @tassyir/* versions a generated project depends on. */
export const TEMPLATE_DEPENDENCIES: Readonly<Record<string, string>> =
  Object.freeze({
    '@tassyir/app': `^${appPackage.version}`,
    '@tassyir/app-bridge': `^${appBridgePackage.version}`,
    '@tassyir/app-manifest': `^${appManifestPackage.version}`,
  });

/** Where a template's files are: templates/<name> next to dist/ (and src/). */
export function templateDirectory(name: TemplateName): string {
  return fileURLToPath(new URL(`../templates/${name}/`, import.meta.url));
}
