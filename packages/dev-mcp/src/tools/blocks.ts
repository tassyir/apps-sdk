import { dirname } from 'node:path';
import type {
  BlockDeclaration,
  BlockError,
  SampleLanguage,
} from '@tassyir/storefront-blocks';
import {
  blockDeclaration,
  checkBlocks,
  checkManifest,
  loadManifest,
  readBlock,
} from 'tassyir';
import type { CliProblem, ManifestBlock } from 'tassyir';
import * as z from 'zod';
import { ToolError } from '../errors.js';
import { defineTool, fromCliError } from '../tool.js';

// validate_block: a storefront block checked by @tassyir/storefront-blocks,
// the code the Tassyir API runs when a version with blocks is uploaded, with
// the same errors (code, line, column, fix). Either the blocks of an app's
// tassyir.app.toml (each file read as `tassyir validate` reads it) or a
// template given as text. Offline: nothing leaves this machine.

/** Problems listed in one answer; `errorCount` says how many there were. */
const MAX_PROBLEMS = 20;
/** The preview's HTML in one answer, in characters. */
const MAX_PREVIEW_CHARS = 3_000;

const problem = z.object({
  code: z.string(),
  path: z.string(),
  message: z.string(),
  fix: z.string(),
});

const settingDeclaration = z.looseObject({
  key: z.string(),
  type: z.string(),
  default: z.unknown().optional(),
  options: z.array(z.looseObject({ value: z.string() })).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  max_length: z.number().optional(),
});

/** A text-mode error: `template:3:7` or `stylesheet:1:5`, like a file's. */
function textProblem(error: BlockError): CliProblem {
  const file = error.source === 'stylesheet' ? 'stylesheet' : 'template';
  return {
    code: error.code,
    path:
      error.line > 0
        ? `${file}:${String(error.line)}:${String(error.column)}`
        : file,
    message: error.message,
    fix: error.fix,
  };
}

/** The package, loaded at the first call (the server starts without it). */
const blocksPackage = () => import('@tassyir/storefront-blocks');

async function preview(
  template: string,
  declaration: BlockDeclaration,
  language: SampleLanguage,
  handle: string,
) {
  const { renderBlock, sampleBlockContext } = await blocksPackage();
  const result = renderBlock(
    template,
    sampleBlockContext(declaration, { language }),
    declaration,
  );
  if (!result.ok) return undefined;
  return {
    handle,
    language,
    html: result.html.slice(0, MAX_PREVIEW_CHARS),
    htmlTruncated: result.html.length > MAX_PREVIEW_CHARS,
    steps: result.stats.steps,
    bytes: result.stats.bytes,
  };
}

export const validateBlockTool = defineTool({
  name: 'validate_block',
  title: 'Validate a storefront block',
  description: [
    "Check a storefront block with @tassyir/storefront-blocks, the Tassyir API's own upload",
    'check, offline: the template compiled against its declaration (target, settings, app',
    'data keys), the stylesheet checked, and sample renders in Arabic, French and English.',
    "Without `template`, it checks every [[storefront.blocks]] entry of the app's",
    'tassyir.app.toml (`manifest`, default ./tassyir.app.toml) with its files, as `tassyir',
    "validate` does, and the version's limits. With `template` (and maybe `stylesheet` and",
    "`declaration`, the block's manifest entry), it checks that text. Answers `valid` and",
    'every problem with its `code`, `path` (file:line:column), `message` and `fix`; with',
    '`preview`, the HTML the sample store would show. Validate after every edit of a block.',
    'The guide: fetch_doc { "slug": "storefront-blocks" }.',
  ].join(' '),
  annotations: {
    readOnlyHint: true,
    openWorldHint: false,
    idempotentHint: true,
  },
  input: z.strictObject({
    manifest: z
      .string()
      .min(1)
      .max(1_024)
      .optional()
      .describe(
        "The app's tassyir.app.toml, absolute or relative to the server's working folder.",
      ),
    block: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(64)
      .optional()
      .describe(
        'With the manifest: one block by its handle. Default every block.',
      ),
    template: z
      .string()
      .max(65_536)
      .optional()
      .describe("A block's .liquid template, as text."),
    stylesheet: z
      .string()
      .max(65_536)
      .optional()
      .describe("With `template`: the block's .css stylesheet."),
    declaration: z
      .strictObject({
        target: z.enum(['product', 'any']).optional(),
        data: z.array(z.string().max(100)).max(20).optional(),
        settings: z.array(settingDeclaration).max(20).optional(),
      })
      .optional()
      .describe(
        "With `template`: the block's manifest entry (target, data, settings); without it, a target-any block with no settings and no data.",
      ),
    preview: z
      .enum(['ar', 'fr', 'en'])
      .optional()
      .describe(
        'Also render the block (the named one, the only one, or the text) with sample data in this language.',
      ),
  }),
  output: z.object({
    valid: z.boolean(),
    file: z
      .string()
      .nullable()
      .describe('The manifest read, or null for `template`.'),
    blocks: z
      .array(
        z.object({
          handle: z.string(),
          template: z.string(),
          stylesheet: z.string().nullable(),
          target: z.string(),
        }),
      )
      .describe("The manifest's blocks checked."),
    errors: z
      .array(problem)
      .describe(
        'Every problem, template first, then stylesheet, then render (at most 20 listed).',
      ),
    errorCount: z.number().int(),
    preview: z
      .object({
        handle: z.string(),
        language: z.string(),
        html: z.string(),
        htmlTruncated: z.boolean(),
        steps: z.number().int(),
        bytes: z.number().int(),
      })
      .optional(),
  }),
  async run(args, context) {
    if (args.template !== undefined) {
      if (args.manifest !== undefined || args.block !== undefined) {
        throw new ToolError({
          code: 'INVALID_ARGUMENT',
          message: '`template` was given with `manifest` or `block`',
          fix: "Pass the block's text (`template`, `stylesheet`, `declaration`), or the app's manifest (`manifest`, `block`), not both.",
        });
      }
      const declaration = (args.declaration ?? {}) as BlockDeclaration;
      const { validateBlock } = await blocksPackage();
      const result = validateBlock({
        template: args.template,
        ...(args.stylesheet === undefined
          ? {}
          : { stylesheet: args.stylesheet }),
        declaration,
      });
      const errors = result.ok ? [] : result.errors.map(textProblem);
      const shown =
        result.ok && args.preview
          ? await preview(args.template, declaration, args.preview, 'template')
          : undefined;
      return {
        valid: result.ok,
        file: null,
        blocks: [],
        errors: errors.slice(0, MAX_PROBLEMS),
        errorCount: errors.length,
        ...(shown ? { preview: shown } : {}),
      };
    }
    if (args.stylesheet !== undefined || args.declaration !== undefined) {
      throw new ToolError({
        code: 'INVALID_ARGUMENT',
        message: '`stylesheet` or `declaration` was given without `template`',
        fix: "Pass the template's text as `template` too, or leave them out to check the manifest's blocks.",
      });
    }
    let loaded;
    try {
      loaded = await loadManifest(context.cwd, args.manifest);
    } catch (error) {
      throw fromCliError(error) ?? error;
    }
    const check = checkManifest(loaded.parsed);
    if (!check.ok) {
      throw new ToolError({
        code: 'MANIFEST_INVALID',
        message: `${loaded.display} does not pass validation (${String(check.errors.length)} problem${check.errors.length === 1 ? '' : 's'})`,
        fix: 'Fix the manifest first: validate_manifest lists its problems.',
        problems: check.errors.slice(0, MAX_PROBLEMS),
      });
    }
    const all = check.manifest.storefront.blocks;
    if (all.length === 0) {
      throw new ToolError({
        code: 'BLOCK_NOT_FOUND',
        message: `${loaded.display} declares no storefront block`,
        fix: 'Declare one in [[storefront.blocks]] with "write_storefront" in access.scopes: fetch_doc { "slug": "storefront-blocks" }.',
      });
    }
    const chosen: ManifestBlock[] =
      args.block === undefined
        ? all
        : all.filter((block) => block.handle === args.block);
    if (chosen.length === 0) {
      throw new ToolError({
        code: 'BLOCK_NOT_FOUND',
        message: `${loaded.display} declares no block "${args.block ?? ''}"`,
        fix: `Use one of: ${all.map((block) => block.handle).join(', ')}.`,
      });
    }
    const root = dirname(loaded.path);
    const result = await checkBlocks(root, check.manifest);
    // Every block is checked (the version's limits count them all); a named
    // block keeps its own problems and the version's.
    const own = (found: CliProblem) =>
      chosen.some((block) => {
        const index = all.indexOf(block);
        return (
          found.path === 'storefront.blocks' ||
          found.path.startsWith(`storefront.blocks[${String(index)}]`) ||
          found.message.startsWith(`Block "${block.handle}": `)
        );
      });
    const errors = result.ok ? [] : result.errors.filter(own);
    const target =
      args.preview && errors.length === 0 && chosen.length === 1
        ? chosen[0]
        : undefined;
    let shown;
    if (target && args.preview) {
      const read = await readBlock(root, target, all.indexOf(target));
      if (read.ok) {
        shown = await preview(
          read.template,
          blockDeclaration(target),
          args.preview,
          target.handle,
        );
      }
    }
    return {
      valid: errors.length === 0,
      file: loaded.display,
      blocks: result.blocks
        .filter((block) => chosen.some((one) => one.handle === block.handle))
        .map((block) => ({
          handle: block.handle,
          template: block.template,
          stylesheet: block.stylesheet,
          target: block.target,
        })),
      errors: errors.slice(0, MAX_PROBLEMS),
      errorCount: errors.length,
      ...(shown ? { preview: shown } : {}),
    };
  },
});
