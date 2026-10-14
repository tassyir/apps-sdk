import { resolve } from 'node:path';
import type {
  AppCredential,
  DeveloperApp,
  MintCredentialResponse,
} from '../api-types.js';
import { cell, lines, resolveApp, stringValue, table } from '../command.js';
import type {
  Command,
  CommandResult,
  Context,
  ParsedArgs,
} from '../command.js';
import { checkEnvFile, writeEnvFile } from '../env-file.js';
import type { EnvWriteResult } from '../env-file.js';
import { CliError, EXIT_CODES, isCliError } from '../errors.js';

// secrets list | create | rotate | revoke: an app's client secrets
// (`tsy_cs_…`). A new secret is shown ONCE (Tassyir keeps only its hash) and
// written nowhere unless --write-env asks for it; then it is not printed.

const APP_OPTION = {
  app: {
    type: 'string',
    value: 'handle|id',
    description: 'Default: the handle in ./tassyir.app.toml.',
  },
} as const;

const WRITE_OPTIONS = {
  ...APP_OPTION,
  'write-env': {
    type: 'boolean',
    description:
      'Write TASSYIR_CLIENT_ID, TASSYIR_CLIENT_SECRET and TASSYIR_APP_ID into ./.env instead of printing the secret.',
  },
  'env-file': {
    type: 'string',
    value: 'path',
    description:
      'The file --write-env writes (implies --write-env). Default ./.env.',
  },
  force: {
    type: 'boolean',
    description: 'Let --write-env replace values the file already holds.',
  },
} as const;

function live(credential: AppCredential): boolean {
  return credential.state === 'active' || credential.state === 'expiring';
}

async function mint(
  context: Context,
  { values }: ParsedArgs,
  rotation: boolean,
): Promise<CommandResult> {
  const { api } = await context.api();
  const app = await resolveApp(context, api, stringValue(values['app']));
  const envFileOption = stringValue(values['env-file']);
  const envFile =
    values['write-env'] === true || envFileOption !== undefined
      ? resolve(context.io.cwd, envFileOption ?? '.env')
      : undefined;

  if (!rotation) {
    const existing = (await api.listCredentials(app.id)).data.filter(live);
    if (existing.length > 0) {
      throw new CliError({
        code: 'APP_SECRET_EXISTS',
        message: `${app.handle} already has ${String(existing.length)} live secret${existing.length === 1 ? '' : 's'} (${existing.map((credential) => credential.secretPrefix).join(', ')})`,
        fix: `Run \`tassyir secrets rotate --app ${app.handle}\` for a new one: the current ones keep working 24 hours, then stop.`,
        exitCode: EXIT_CODES.FAILED,
        details: {
          appId: app.id,
          live: existing.map((credential) => credential.id),
        },
      });
    }
  }

  // Checked before minting: a refusal afterwards would lose the secret.
  let replaced: string[] = [];
  if (envFile) {
    replaced = await checkEnvFile(
      envFile,
      {
        TASSYIR_CLIENT_ID: app.clientId,
        TASSYIR_CLIENT_SECRET: undefined,
        TASSYIR_APP_ID: app.id,
      },
      values['force'] === true,
    );
  }

  const minted: MintCredentialResponse = await api.mintCredential(app.id);
  const { secret, ...credential } = minted.data;

  let written: EnvWriteResult | undefined;
  if (envFile) {
    try {
      written = await writeEnvFile(
        envFile,
        {
          TASSYIR_CLIENT_ID: app.clientId,
          TASSYIR_CLIENT_SECRET: secret,
          TASSYIR_APP_ID: app.id,
        },
        replaced,
      );
    } catch (error) {
      // The secret exists now and is shown once: here, since the file failed.
      throw new CliError({
        code: isCliError(error) ? error.code : 'ENV_FILE_UNWRITABLE',
        message: `${isCliError(error) ? error.message : `Could not write ${envFile}`}; the secret was minted, so here it is, once`,
        fix: "Copy these values into your server's environment now (Tassyir keeps only the secret's hash); or revoke it (`tassyir secrets revoke`) and mint another.",
        exitCode: EXIT_CODES.FAILED,
        details: { credentialId: credential.id, file: envFile },
        reveal: {
          TASSYIR_CLIENT_ID: app.clientId,
          TASSYIR_CLIENT_SECRET: secret,
          TASSYIR_APP_ID: app.id,
        },
      });
    }
  }

  const rotated = minted.rotated;
  const data: Record<string, unknown> = {
    app: appSummary(app),
    credential,
    rotated,
    ...(written ? { written } : { secret }),
  };
  return {
    data,
    text: lines(
      `✓ New client secret for ${app.handle} (credential ${credential.id}).`,
      ...(written
        ? [
            `  Written to ${written.file}: ${written.keys.join(', ')}${written.replaced.length ? ` (replaced ${written.replaced.join(', ')})` : ''}.`,
            "  It is not printed. Keep that file out of git (the starter's .gitignore does).",
          ]
        : [
            `  TASSYIR_CLIENT_ID=${app.clientId}`,
            `  TASSYIR_CLIENT_SECRET=${secret}`,
            `  TASSYIR_APP_ID=${app.id}`,
            "  The secret is shown this once: Tassyir keeps only its hash. Put it in your server's environment now.",
          ]),
      ...rotated.map(
        (old) =>
          `  ${old.secretPrefix} keeps working until ${cell(old.expiresAt)}, then stops (rotation overlap).`,
      ),
    ),
  };
}

function appSummary(app: DeveloperApp) {
  return { id: app.id, handle: app.handle, clientId: app.clientId };
}

export const secretsListCommand: Command = {
  name: 'secrets list',
  summary: "An app's client secrets (never the secrets themselves)",
  usage: 'tassyir secrets list [options]',
  options: APP_OPTION,
  async run(context, { values }) {
    const { api } = await context.api();
    const app = await resolveApp(context, api, stringValue(values['app']));
    const credentials = (await api.listCredentials(app.id)).data;
    return {
      data: { app: appSummary(app), credentials },
      text:
        credentials.length === 0
          ? lines(
              `${app.handle} has no secret yet: \`tassyir secrets create --app ${app.handle}\`.`,
            )
          : lines(
              table(
                ['ID', 'PREFIX', 'STATE', 'CREATED', 'EXPIRES', 'REVOKED'],
                credentials.map((credential) => [
                  credential.id,
                  credential.secretPrefix,
                  credential.state,
                  credential.createdAt,
                  cell(credential.expiresAt),
                  cell(credential.revokedAt),
                ]),
              ),
            ),
    };
  },
};

export const secretsCreateCommand: Command = {
  name: 'secrets create',
  summary: "Mint the app's first client secret (shown once)",
  usage: 'tassyir secrets create [options]',
  description: [
    'Refuses when the app already has a live secret: rotating is `tassyir secrets rotate`.',
    'The secret is printed once, or, with --write-env, written to .env and not printed;',
    'a value .env already holds is only replaced with --force (checked before minting).',
  ].join('\n'),
  options: WRITE_OPTIONS,
  run: (context, args) => mint(context, args, false),
};

export const secretsRotateCommand: Command = {
  name: 'secrets rotate',
  summary: 'Mint a new client secret; the current ones keep working 24 hours',
  usage: 'tassyir secrets rotate [options]',
  description: [
    'Every live secret gets an end 24 hours from now, so a deployed server keeps working',
    'while the new one rolls out. At most 3 live secrets per app.',
  ].join('\n'),
  options: WRITE_OPTIONS,
  run: (context, args) => mint(context, args, true),
};

export const secretsRevokeCommand: Command = {
  name: 'secrets revoke',
  summary: 'Revoke one client secret now',
  usage: 'tassyir secrets revoke <credential-id> [options]',
  description: [
    'The token endpoint refuses it from now on. Access tokens it already obtained live out',
    'their hour. `tassyir secrets list` shows the ids.',
  ].join('\n'),
  positionals: { min: 1, max: 1, names: '<credential-id>' },
  options: APP_OPTION,
  async run(context, { values, positionals }) {
    const { api } = await context.api();
    const app = await resolveApp(context, api, stringValue(values['app']));
    const credentialId = positionals[0] ?? '';
    const credential = (await api.revokeCredential(app.id, credentialId)).data;
    return {
      data: { app: appSummary(app), credential },
      text: lines(
        `✓ Revoked ${credential.secretPrefix} (credential ${credential.id}) of ${app.handle} at ${cell(credential.revokedAt)}.`,
      ),
    };
  },
};
