import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  manifestVersionColumns,
  MANIFEST_FILE_NAME,
} from '@tassyir/app-manifest';
import type { AppManifest } from '@tassyir/app-manifest';
import { createProject, isCreateError, TEMPLATES } from 'create-tassyir-app';
import { parse, TomlError } from 'smol-toml';
import { checkManifest, loadManifest } from 'tassyir';
import * as z from 'zod';
import { ToolError } from '../errors.js';
import type { ToolProblem } from '../errors.js';
import { defineTool, fromCliError } from '../tool.js';

// The developer's own project: tassyir.app.toml checked by the Tassyir API's
// own validator (through the CLI's check, which also refuses TOML dates), and
// a new app written by the starter. Both stay on this machine.

/** A manifest file larger than this is not read (the API takes 64 KB of JSON). */
const MAX_MANIFEST_FILE_BYTES = 256 * 1024;

/** Problems listed in one answer; `errorCount` says how many there were. */
const MAX_PROBLEMS = 20;

const problem = z.object({
  code: z.string(),
  path: z.string(),
  message: z.string(),
  fix: z.string(),
});

/** Things that pass the validator but are almost certainly not meant (as `tassyir validate`). */
function warningsOf(manifest: AppManifest): string[] {
  if (manifest.hosting.mode !== 'external') return [];
  const host = new URL(manifest.hosting.url).hostname;
  return host === 'example.com' || host.endsWith('.example.com')
    ? [
        `hosting.url is ${manifest.hosting.url}, a placeholder: put your server's public https address there (a tunnel's while you develop).`,
      ]
    : [];
}

function tomlProblem(error: unknown): ToolProblem {
  const where =
    error instanceof TomlError
      ? ` at line ${String(error.line)}, column ${String(error.column)}`
      : '';
  const first =
    error instanceof Error ? (error.message.split('\n')[0] ?? '') : '';
  return {
    code: 'MANIFEST_TOML_INVALID',
    path: '',
    message: `The manifest is not valid TOML${where}: ${first}`,
    fix: 'Fix the TOML syntax at that line (quotes, brackets, one key per line), then validate again.',
  };
}

export const validateManifestTool = defineTool({
  name: 'validate_manifest',
  title: 'Validate tassyir.app.toml',
  description: [
    "Validate a Tassyir app manifest (tassyir.app.toml) with the Tassyir API's own validator",
    '(@tassyir/app-manifest), offline: the answer the API gives when the manifest is uploaded.',
    "Pass `toml` (the file's text) or `path` (a .toml file); with neither, ./tassyir.app.toml",
    "in this server's working folder. Answers `valid` and every problem with its `code`, the",
    'field `path`, a `message` and a `fix`; when valid, what the manifest asks for (scopes,',
    'webhook topics, hosts) and warnings. Validate after every edit of the manifest, and before',
    '`tassyir deploy`.',
  ].join(' '),
  annotations: {
    readOnlyHint: true,
    openWorldHint: false,
    idempotentHint: true,
  },
  input: z.strictObject({
    toml: z
      .string()
      .max(65_536)
      .optional()
      .describe("The manifest's TOML text."),
    path: z
      .string()
      .min(1)
      .max(1_024)
      .optional()
      .describe(
        "A .toml file, absolute or relative to the server's working folder.",
      ),
  }),
  output: z.object({
    valid: z.boolean(),
    file: z.string().nullable().describe('The file read, or null for `toml`.'),
    errors: z
      .array(problem)
      .describe(
        'Every problem, in the order the API reports them (at most 20 listed).',
      ),
    errorCount: z.number().int(),
    summary: z
      .object({
        name: z.string(),
        handle: z.string(),
        apiVersion: z.string(),
        hostingMode: z.enum(['external', 'tassyir']),
        url: z.string().nullable(),
        adminPage: z.string().nullable(),
        scopes: z.array(z.string()),
        optionalScopes: z.array(z.string()),
        webhookTopics: z.array(z.string()),
        allowedHosts: z.array(z.string()),
        dataDefinitions: z.number().int(),
      })
      .optional()
      .describe('When valid: what the normalised manifest asks for.'),
    warnings: z.array(z.string()),
  }),
  async run({ toml, path }, context) {
    if (toml !== undefined && path !== undefined) {
      throw new ToolError({
        code: 'INVALID_ARGUMENT',
        message: 'Both toml and path were given',
        fix: "Pass the manifest's text as `toml`, or its file as `path`, not both.",
      });
    }
    let parsed: Record<string, unknown>;
    let file: string | null = null;
    if (toml !== undefined) {
      try {
        parsed = parse(toml);
      } catch (error) {
        const failure = tomlProblem(error);
        return {
          valid: false,
          file,
          errors: [failure],
          errorCount: 1,
          warnings: [],
        };
      }
    } else {
      const target = path ?? MANIFEST_FILE_NAME;
      if (!target.endsWith('.toml')) {
        throw new ToolError({
          code: 'INVALID_ARGUMENT',
          message: `${target.slice(0, 120)} is not a .toml file`,
          fix: 'Pass the path of tassyir.app.toml (or another .toml file), or its text as `toml`.',
        });
      }
      const size = await stat(resolve(context.cwd, target)).then(
        (info) => info.size,
        () => 0,
      );
      if (size > MAX_MANIFEST_FILE_BYTES) {
        throw new ToolError({
          code: 'MANIFEST_FILE_TOO_LARGE',
          message: `${target.slice(0, 120)} is ${String(size)} bytes`,
          fix: 'A manifest is at most 64 KB as JSON: pass the right file.',
        });
      }
      try {
        const loaded = await loadManifest(context.cwd, target);
        parsed = loaded.parsed;
        file = loaded.display;
      } catch (error) {
        const failure = fromCliError(error);
        if (failure?.code === 'MANIFEST_TOML_INVALID') {
          return {
            valid: false,
            file: target,
            errors: [
              {
                code: failure.code,
                path: '',
                message: failure.message,
                fix: failure.fix,
              },
            ],
            errorCount: 1,
            warnings: [],
          };
        }
        if (failure?.code === 'MANIFEST_NOT_FOUND') {
          throw new ToolError({
            code: failure.code,
            message: failure.message,
            fix: "Pass `path` (the app's tassyir.app.toml) or the manifest's text as `toml`; a new app starts with scaffold.",
          });
        }
        throw failure ?? error;
      }
    }
    const check = checkManifest(parsed);
    if (!check.ok) {
      return {
        valid: false,
        file,
        errors: check.errors.slice(0, MAX_PROBLEMS),
        errorCount: check.errors.length,
        warnings: [],
      };
    }
    const manifest = check.manifest;
    const columns = manifestVersionColumns(manifest);
    return {
      valid: true,
      file,
      errors: [],
      errorCount: 0,
      summary: {
        name: manifest.name,
        handle: manifest.handle,
        apiVersion: columns.apiVersion,
        hostingMode: manifest.hosting.mode,
        url: manifest.hosting.mode === 'external' ? manifest.hosting.url : null,
        adminPage: manifest.admin?.page ?? null,
        scopes: columns.scopes,
        optionalScopes: columns.optionalScopes,
        webhookTopics: columns.webhookTopics,
        allowedHosts: columns.allowedHosts,
        dataDefinitions: manifest.data.definitions.length,
      },
      warnings: warningsOf(manifest),
    };
  },
});

export const scaffoldTool = defineTool({
  name: 'scaffold',
  title: 'Start a Tassyir app from the starter',
  description: [
    'Create a new Tassyir app from the official starter (create-tassyir-app): a Node 22 + Hono',
    'server on your own host, an embedded page on App Bridge, signed webhooks, the Admin API',
    'client, tassyir.app.toml, AGENTS.md, CLAUDE.md and a Claude Code skill. Writes into',
    "`directory` (new or empty; relative to this server's working folder), checks the name,",
    "handle and URL with the manifest's own rules first, never overwrites a file and installs",
    'nothing. Answers the files written and the next steps. Ask your user for the handle',
    'before calling it: a handle never changes once the app exists on Tassyir.',
  ].join(' '),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  input: z.strictObject({
    directory: z
      .string()
      .min(1)
      .max(1_024)
      .describe('The folder to create the app in: new, or empty.'),
    handle: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe(
        '3-40 lowercase letters and digits joined by single hyphens; permanent. Default: the folder name.',
      ),
    name: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe(
        'The display name, 1-50 characters. Default: the handle in words.',
      ),
    url: z
      .string()
      .min(1)
      .max(512)
      .optional()
      .describe(
        "The server's public https address (hosting.url). Default a placeholder to replace.",
      ),
    template: z
      .enum(TEMPLATES.map((template) => template.name) as [string, ...string[]])
      .optional()
      .describe(
        `Default external. ${TEMPLATES.map((template) => `${template.name}: ${template.description}${template.available ? '' : ' (not available yet)'}`).join(' ')}`,
      ),
  }),
  output: z.object({
    directory: z.string(),
    template: z.string(),
    app: z.object({ name: z.string(), handle: z.string(), url: z.string() }),
    files: z.array(z.string()),
    dependencies: z.record(z.string(), z.string()),
    next: z.array(z.string()),
  }),
  async run({ directory, handle, name, url, template }, context) {
    try {
      const result = await createProject({
        directory: resolve(context.cwd, directory),
        ...(template === undefined ? {} : { template }),
        ...(handle === undefined ? {} : { handle }),
        ...(name === undefined ? {} : { name }),
        ...(url === undefined ? {} : { url }),
      });
      return {
        directory: result.directory,
        template: result.template,
        app: result.app,
        files: result.files,
        dependencies: { ...result.dependencies },
        next: [
          `cd ${result.directory}`,
          'npm install',
          'npm run setup (writes .env with a new TOKEN_STORE_KEY)',
          "Read the project's AGENTS.md: it says how this app is built and what to change first.",
          `Create the app on Tassyir with the handle ${result.app.handle} (\`tassyir app create\`), put its credentials in .env (\`tassyir secrets create --write-env\`), then \`tassyir deploy\`, \`tassyir store create\` and install it on the dev store.`,
        ],
      };
    } catch (error) {
      if (!isCreateError(error)) throw error;
      throw new ToolError({
        code: error.code,
        message: error.message,
        fix: error.fix,
        problems: error.problems,
        details: { path: error.path },
      });
    }
  },
});
