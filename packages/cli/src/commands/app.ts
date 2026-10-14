import { resolve } from 'node:path';
import { createProject, isCreateError, TEMPLATES } from 'create-tassyir-app';
import type { CreateAppBody } from '../api-types.js';
import { cell, lines, stringValue, table } from '../command.js';
import type { Command } from '../command.js';
import { CliError, EXIT_CODES } from '../errors.js';
import { handleOf, loadManifest } from '../manifest.js';

// app init (create-tassyir-app's createProject), app create, app list.

export const appInitCommand: Command = {
  name: 'app init',
  summary: 'Start a new app in a new folder (the create-tassyir-app starter)',
  usage: 'tassyir app init [folder] [options]',
  description: [
    'Writes a Tassyir app that runs on your own server: tassyir.app.toml, a Node server,',
    'an embedded page, webhooks, specs, AGENTS.md and CLAUDE.md. Nothing is created on',
    'Tassyir: run `tassyir app create` in the new folder next.',
  ].join('\n'),
  positionals: { min: 0, max: 1, names: '[folder]' },
  options: {
    handle: {
      type: 'string',
      value: 'handle',
      description:
        "The app's handle: permanent and unique on Tassyir. Default: the folder's name.",
    },
    name: {
      type: 'string',
      value: 'name',
      description: 'The display name. Default: the handle in words.',
    },
    url: {
      type: 'string',
      value: 'https-url',
      description:
        "Your server's public address (hosting.url). Default: a placeholder.",
    },
    template: {
      type: 'string',
      value: 'name',
      description: `${TEMPLATES.map((template) => `${template.name}${template.available ? '' : ' (not available yet)'}`).join(', ')}. Default external.`,
    },
  },
  async run(context, { values, positionals }) {
    const folder = positionals[0] ?? 'my-tassyir-app';
    let result: Awaited<ReturnType<typeof createProject>>;
    try {
      result = await createProject({
        directory: resolve(context.io.cwd, folder),
        template: stringValue(values['template']),
        handle: stringValue(values['handle']),
        name: stringValue(values['name']),
        url: stringValue(values['url']),
      });
    } catch (error) {
      if (!isCreateError(error)) throw error;
      const usage =
        error.code === 'INVALID_ARGUMENT' || error.code === 'TEMPLATE_UNKNOWN';
      throw new CliError({
        code: error.code,
        message: error.message,
        fix: error.fix,
        exitCode: usage
          ? EXIT_CODES.USAGE
          : error.code.startsWith('MANIFEST_')
            ? EXIT_CODES.MANIFEST
            : EXIT_CODES.FAILED,
        details: { path: error.path },
        ...(error.problems.length > 1 ? { errors: error.problems } : {}),
      });
    }
    const cd = /^[\w./-]+$/.test(folder)
      ? folder
      : `'${folder.replaceAll("'", `'\\''`)}'`;
    const next = [
      `cd ${cd}`,
      'npm install',
      'npm run setup',
      'tassyir app create',
      'tassyir secrets create --write-env',
      'tassyir deploy',
      'tassyir dev',
    ];
    return {
      data: { ...result, next },
      text: lines(
        `✓ Created ${result.app.name} (handle ${result.app.handle}) in ${result.directory}`,
        '  The handle is permanent once the app exists on Tassyir.',
        '',
        'Next:',
        ...next.map((step) => `  ${step}`),
      ),
    };
  },
};

export const appCreateCommand: Command = {
  name: 'app create',
  summary: 'Create the app on Tassyir (handle and name from tassyir.app.toml)',
  usage: 'tassyir app create [options]',
  description: [
    'Creates the app in your developer account: its permanent handle and its client id.',
    'It has no version and no secret yet: `tassyir secrets create`, then `tassyir deploy`.',
  ].join('\n'),
  options: {
    handle: {
      type: 'string',
      value: 'handle',
      description: 'Default: `handle` in tassyir.app.toml.',
    },
    name: {
      type: 'string',
      value: 'name',
      description: 'The English name. Default: `name` in tassyir.app.toml.',
    },
    'name-ar': {
      type: 'string',
      value: 'name',
      description: 'The Arabic name. Default: the English one.',
    },
    'custom-business': {
      type: 'string',
      value: 'id',
      description:
        'The one other business this custom app may be installed on.',
    },
    manifest: {
      type: 'string',
      value: 'path',
      description: 'Default ./tassyir.app.toml.',
    },
  },
  async run(context, { values }) {
    let handle = stringValue(values['handle']);
    let name = stringValue(values['name']);
    let hostingMode: CreateAppBody['hostingMode'];
    const manifestFile = stringValue(values['manifest']);
    if (handle === undefined || name === undefined || manifestFile) {
      const manifest = await loadManifest(context.io.cwd, manifestFile).catch(
        (error: unknown) => {
          if (handle !== undefined && name !== undefined) return undefined;
          throw error instanceof CliError && error.code === 'MANIFEST_NOT_FOUND'
            ? new CliError({
                code: 'APP_FIELDS_REQUIRED',
                message:
                  'No --handle and --name were given, and there is no tassyir.app.toml to read them from',
                fix: "Run it in your app's folder, or pass --handle and --name.",
                exitCode: EXIT_CODES.USAGE,
              })
            : error;
        },
      );
      if (manifest) {
        handle ??= handleOf(manifest.parsed);
        const manifestName = manifest.parsed['name'];
        if (typeof manifestName === 'string') name ??= manifestName;
        const hosting = manifest.parsed['hosting'];
        const mode =
          typeof hosting === 'object' && hosting !== null
            ? (hosting as Record<string, unknown>)['mode']
            : undefined;
        if (mode === 'external' || mode === 'tassyir') hostingMode = mode;
      }
    }
    if (handle === undefined || name === undefined) {
      throw new CliError({
        code: 'APP_FIELDS_REQUIRED',
        message: `The app needs a handle and a name; ${handle === undefined ? 'handle' : 'name'} is missing`,
        fix: 'Set `handle` and `name` in tassyir.app.toml, or pass --handle and --name.',
        exitCode: EXIT_CODES.USAGE,
      });
    }
    const body: CreateAppBody = { handle, nameEn: name };
    const nameAr = stringValue(values['name-ar']);
    if (nameAr !== undefined) body.nameAr = nameAr;
    // A hosted app is sent as it is: the API answers APP_HOSTING_NOT_AVAILABLE
    // until Tassyir Hosting opens (AP-B1.14).
    if (hostingMode !== undefined) body.hostingMode = hostingMode;
    const customBusiness = stringValue(values['custom-business']);
    if (customBusiness !== undefined) body.customBusinessId = customBusiness;

    const { api } = await context.api();
    const app = (await api.createApp(body)).data;
    return {
      data: {
        app,
        next: [
          `tassyir secrets create --app ${app.handle} --write-env`,
          'tassyir deploy',
        ],
      },
      text: lines(
        `✓ Created ${app.nameEn} on Tassyir.`,
        `  handle     ${app.handle} (permanent)`,
        `  app id     ${app.id} (TASSYIR_APP_ID: webhooks name it)`,
        `  client id  ${app.clientId}`,
        '',
        'Next:',
        `  tassyir secrets create --app ${app.handle} --write-env`,
        '  tassyir deploy',
      ),
    };
  },
};

export const appListCommand: Command = {
  name: 'app list',
  summary: 'Your apps',
  usage: 'tassyir app list [options]',
  options: {},
  async run(context) {
    const { api } = await context.api();
    const apps = (await api.listApps()).data;
    return {
      data: { apps },
      text:
        apps.length === 0
          ? lines('No apps yet: `tassyir app init`, then `tassyir app create`.')
          : lines(
              table(
                ['ID', 'HANDLE', 'NAME', 'STATUS', 'VERSION', 'CLIENT ID'],
                apps.map((app) => [
                  app.id,
                  app.handle,
                  app.nameEn,
                  app.status,
                  cell(app.currentVersion),
                  app.clientId,
                ]),
              ),
            ),
    };
  },
};
