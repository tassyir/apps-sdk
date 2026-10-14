import type { AppManifest } from '@tassyir/app-manifest';
import { lines, resolveApp, stringValue } from '../command.js';
import type { Command } from '../command.js';
import { isCliError } from '../errors.js';
import { checkManifest, loadManifest, manifestInvalid } from '../manifest.js';

// validate (offline, @tassyir/app-manifest) and deploy (an external app's
// manifest as a new version; a hosted app is answered by the API).

/** Things that pass the validator but are almost certainly not meant. */
function warningsOf(manifest: AppManifest): string[] {
  const warnings: string[] = [];
  const url =
    manifest.hosting.mode === 'external' ? manifest.hosting.url : undefined;
  if (url !== undefined) {
    const host = new URL(url).hostname;
    if (host === 'example.com' || host.endsWith('.example.com')) {
      warnings.push(
        `hosting.url is ${url}, a placeholder: put your server's public https address there (a tunnel's while you develop: \`tassyir dev\`).`,
      );
    }
  }
  return warnings;
}

function summary(manifest: AppManifest): string {
  const where =
    manifest.hosting.mode === 'external'
      ? `your server at ${manifest.hosting.url}`
      : 'Tassyir Hosting';
  const scopes = [
    ...manifest.access.scopes,
    ...manifest.access.optional_scopes,
  ];
  const topics = manifest.webhooks.flatMap((webhook) => webhook.topics);
  return `${manifest.handle}, on ${where}; scopes: ${scopes.join(', ') || 'none'}; webhooks: ${topics.join(', ') || 'none'}`;
}

export const validateCommand: Command = {
  name: 'validate',
  summary:
    "Check tassyir.app.toml with the Tassyir API's own validator (offline)",
  usage: 'tassyir validate [path] [options]',
  description: [
    'Parses the TOML and validates it exactly as the API will: every problem at once, each',
    'with its code, the field and a fix. Exit code 4 when it does not pass.',
  ].join('\n'),
  positionals: { min: 0, max: 1, names: '[path]' },
  options: {},
  async run(context, { positionals }) {
    const loaded = await loadManifest(context.io.cwd, positionals[0]);
    const check = checkManifest(loaded.parsed);
    if (!check.ok) throw manifestInvalid(loaded.display, check.errors);
    const warnings = warningsOf(check.manifest);
    return {
      data: {
        file: loaded.display,
        valid: true,
        manifest: check.manifest,
        warnings,
      },
      text: lines(
        `✓ ${loaded.display} is valid: ${summary(check.manifest)}.`,
        ...warnings.map((warning) => `  ! ${warning}`),
      ),
    };
  },
};

export const deployCommand: Command = {
  name: 'deploy',
  summary: "Validate tassyir.app.toml and upload it as the app's new version",
  usage: 'tassyir deploy [options]',
  description: [
    'For an app on your own server (hosting.mode = "external"): validates the manifest, then',
    'uploads it as a new version, current at once. Installations stay on their version until',
    'a member of the business accepts the update (with a consent screen when it adds scopes',
    'or hosts). The same manifest twice is not a new version: deploy answers `unchanged`.',
    'A hosted app (Tassyir Hosting) is answered APP_HOSTING_NOT_AVAILABLE by the API for now.',
  ].join('\n'),
  options: {
    manifest: {
      type: 'string',
      value: 'path',
      description: 'Default ./tassyir.app.toml.',
    },
    app: {
      type: 'string',
      value: 'handle|id',
      description: "Default: the manifest's handle.",
    },
  },
  async run(context, { values }) {
    const manifestFile = stringValue(values['manifest']);
    const loaded = await loadManifest(context.io.cwd, manifestFile);
    const check = checkManifest(loaded.parsed);
    if (!check.ok) throw manifestInvalid(loaded.display, check.errors);
    const warnings = warningsOf(check.manifest);

    const { api } = await context.api();
    const app = await resolveApp(
      context,
      api,
      stringValue(values['app']) ?? check.manifest.handle,
      manifestFile,
    );
    // The seam for Tassyir Hosting (AP-B1.14): a hosted deploy will build and
    // upload a bundle with the manifest. Until then the API answers a hosted
    // manifest APP_HOSTING_NOT_AVAILABLE, which is relayed as it is.
    try {
      const version = (await api.uploadVersion(app.id, loaded.parsed)).data;
      return {
        data: {
          app: { id: app.id, handle: app.handle },
          unchanged: false,
          version,
          warnings,
        },
        text: lines(
          `✓ Deployed ${app.handle} version ${String(version.version)} (current: new installations get it).`,
          '  Installed businesses keep their version until a member accepts the update',
          '  (Apps → Installed apps → Update), with a consent screen when scopes or hosts were added.',
          ...warnings.map((warning) => `  ! ${warning}`),
        ),
      };
    } catch (error) {
      if (!isCliError(error, 'APP_VERSION_UNCHANGED')) throw error;
      const current = error.details?.['version'];
      return {
        data: {
          app: { id: app.id, handle: app.handle },
          unchanged: true,
          version: { version: typeof current === 'number' ? current : null },
          warnings,
        },
        text: lines(
          `✓ Nothing to deploy: ${loaded.display} equals ${app.handle}'s latest version${typeof current === 'number' ? ` (${String(current)})` : ''}.`,
          ...warnings.map((warning) => `  ! ${warning}`),
        ),
      };
    }
  },
};
