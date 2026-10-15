import { fileURLToPath } from 'node:url';
// The versions the generated package.json names, read from this repo's
// packages when this one is built (and from the files themselves in tests),
// so a release of create-tassyir-app always names the versions released with
// it.
import appPackage from '../../app/package.json' with { type: 'json' };
import appBridgePackage from '../../app-bridge/package.json' with { type: 'json' };
import appManifestPackage from '../../app-manifest/package.json' with { type: 'json' };
import cliPackage from '../../cli/package.json' with { type: 'json' };
import uiPackage from '../../ui/package.json' with { type: 'json' };

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
    name: 'hosted',
    available: true,
    description:
      'An app on Tassyir Hosting: a Cloudflare Worker (Hono) and a React page with App Bridge, its own SQLite storage and the Admin API, no server to run.',
  },
]);

/**
 * The versions of this repo's packages a generated project depends on (a
 * template names the ones it uses: the hosted one adds the `tassyir` CLI,
 * which `npm run deploy` runs).
 */
export const TEMPLATE_DEPENDENCIES: Readonly<Record<string, string>> =
  Object.freeze({
    '@tassyir/app': `^${appPackage.version}`,
    '@tassyir/app-bridge': `^${appBridgePackage.version}`,
    '@tassyir/app-manifest': `^${appManifestPackage.version}`,
    '@tassyir/ui': `^${uiPackage.version}`,
    tassyir: `^${cliPackage.version}`,
  });

/** Where a template's files are: templates/<name> next to dist/ (and src/). */
export function templateDirectory(name: TemplateName): string {
  return fileURLToPath(new URL(`../templates/${name}/`, import.meta.url));
}
