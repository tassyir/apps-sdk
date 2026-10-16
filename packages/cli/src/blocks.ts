import { readFile, realpath } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import type { AppManifest } from '@tassyir/app-manifest';
import type { BlockDeclaration, BlockError } from '@tassyir/storefront-blocks';
import { bundlePathProblem, utf8Bytes } from './bundle-rules.js';
import type { BundleFile } from './bundle-rules.js';
import { CliError, EXIT_CODES } from './errors.js';
import type { CliProblem } from './errors.js';

// A version's storefront blocks (tassyir/backend docs/APPS_PHASE2_PLAN.md
// §6.1-§6.2): each `[[storefront.blocks]]` entry names a `.liquid` template
// and maybe a `.css` stylesheet, as paths from the manifest's folder. The CLI
// reads them and runs `validateBlock` of @tassyir/storefront-blocks on each,
// the exact check the API runs at upload, so `tassyir validate` and `deploy`
// refuse what the upload would. What goes up:
//   - an app on your own server: the files as the version's `assets`
//     (`{ files: [{ path, content }] }`, text only), next to the manifest;
//   - an app on Tassyir Hosting: the files as text modules of the bundle, at
//     the same paths.

/** What the API counts per version (Phase 2 §6.2): the package checks one block. */
export const BLOCK_VERSION_LIMITS = Object.freeze({
  /** `[[storefront.blocks]]` entries (the manifest's own limit too). */
  maxBlocks: 20,
  /** Every block's template and stylesheet together, UTF-8 bytes. */
  maxBytes: 100 * 1024,
});

/** What an external version uploads with its manifest (AP-B2.4). */
export interface VersionAssets {
  files: BundleFile[];
}

export interface CheckedBlock {
  handle: string;
  template: string;
  stylesheet: string | null;
  target: 'product' | 'any';
  /** The template's and the stylesheet's UTF-8 bytes. */
  bytes: number;
}

export type BlockCheck =
  | {
      ok: true;
      blocks: CheckedBlock[];
      /** Every block file once, in manifest order: what is uploaded. */
      files: BundleFile[];
      bytes: number;
    }
  | { ok: false; blocks: CheckedBlock[]; errors: CliProblem[] };

export type ManifestBlock = AppManifest['storefront']['blocks'][number];

/** The entry as @tassyir/storefront-blocks reads it (the normalised manifest's names). */
export function blockDeclaration(block: ManifestBlock): BlockDeclaration {
  return {
    target: block.target,
    data: block.data,
    settings: block.settings,
  };
}

/** `blocks/rating.liquid:3:7`, or the file alone for a render error. */
function where(file: string, error: BlockError): string {
  return error.line > 0
    ? `${file}:${String(error.line)}:${String(error.column)}`
    : file;
}

/** One error of @tassyir/storefront-blocks as a problem, its file named. */
export function blockProblem(
  handle: string,
  files: { template: string; stylesheet: string | null },
  error: BlockError,
): CliProblem {
  const file =
    error.source === 'stylesheet'
      ? (files.stylesheet ?? files.template)
      : files.template;
  return {
    code: error.code,
    path: where(file, error),
    message: `Block "${handle}": ${error.message}`,
    fix: error.fix,
  };
}

/** Reads one block file inside `root`; a problem when it is missing or leaves it. */
async function readBlockFile(
  root: string,
  path: string,
  field: string,
): Promise<{ content: string } | { problem: CliProblem }> {
  const pathProblem = bundlePathProblem(path);
  if (pathProblem !== null) {
    return {
      problem: {
        code: 'BLOCK_FILE_PATH_INVALID',
        path: field,
        message: `${path} ${pathProblem}`,
        fix: 'Name the file with lowercase letters, digits, "-" and "_", in folders of the app (blocks/rating.liquid).',
      },
    };
  }
  const absolute = resolve(root, path);
  let real: string;
  try {
    real = await realpath(absolute);
  } catch {
    return {
      problem: {
        code: 'BLOCK_FILE_NOT_FOUND',
        path: field,
        message: `${path} does not exist (from the manifest's folder)`,
        fix: `Create ${path} next to tassyir.app.toml, or fix \`${field}\`.`,
      },
    };
  }
  const realRoot = await realpath(root).catch(() => root);
  if (real !== realRoot && !real.startsWith(`${realRoot}${sep}`)) {
    return {
      problem: {
        code: 'BLOCK_FILE_OUTSIDE_APP',
        path: field,
        message: `${path} leads outside the app's folder (${relative(realRoot, real)})`,
        fix: "Keep block files inside the app's folder: replace the link with the file itself.",
      },
    };
  }
  try {
    return { content: await readFile(real, 'utf8') };
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code ?? 'error';
    return {
      problem: {
        code: 'BLOCK_FILE_UNREADABLE',
        path: field,
        message: `Could not read ${path} (${reason})`,
        fix: `Check that ${path} is a file you can read.`,
      },
    };
  }
}

/** One block's files, read from the manifest's folder (`index`: its place in the list). */
export async function readBlock(
  root: string,
  block: ManifestBlock,
  index: number,
): Promise<
  | { ok: true; template: string; stylesheet: string | undefined }
  | { ok: false; errors: CliProblem[] }
> {
  const field = `storefront.blocks[${String(index)}]`;
  const template = await readBlockFile(
    root,
    block.template,
    `${field}.template`,
  );
  const stylesheet =
    block.stylesheet === undefined
      ? undefined
      : await readBlockFile(root, block.stylesheet, `${field}.stylesheet`);
  const errors = [template, stylesheet].flatMap((read) =>
    read && 'problem' in read ? [read.problem] : [],
  );
  if ('problem' in template || (stylesheet && 'problem' in stylesheet)) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    template: template.content,
    stylesheet: stylesheet?.content,
  };
}

/**
 * Reads and checks every block of a valid manifest whose folder is `root`:
 * each file present inside the folder, each block through `validateBlock`
 * (template against the declaration, stylesheet, sample renders in ar, fr
 * and en), then the version's limits. Every problem at once, in manifest
 * order. A manifest without blocks passes with nothing to upload.
 */
export async function checkBlocks(
  root: string,
  manifest: AppManifest,
): Promise<BlockCheck> {
  const errors: CliProblem[] = [];
  const blocks: CheckedBlock[] = [];
  const files = new Map<string, string>();
  if (manifest.storefront.blocks.length === 0) {
    return { ok: true, blocks, files: [], bytes: 0 };
  }
  // Loaded when a manifest has blocks, as esbuild is for a hosted build.
  const { validateBlock } = await import('@tassyir/storefront-blocks');
  for (const [index, block] of manifest.storefront.blocks.entries()) {
    const read = await readBlock(root, block, index);
    if (!read.ok) {
      errors.push(...read.errors);
      continue;
    }
    const names = {
      template: block.template,
      stylesheet: block.stylesheet ?? null,
    };
    const result = validateBlock({
      template: read.template,
      ...(read.stylesheet === undefined ? {} : { stylesheet: read.stylesheet }),
      declaration: blockDeclaration(block),
    });
    if (!result.ok) {
      errors.push(
        ...result.errors.map((error) =>
          blockProblem(block.handle, names, error),
        ),
      );
    }
    files.set(block.template, read.template);
    if (read.stylesheet !== undefined && block.stylesheet !== undefined) {
      files.set(block.stylesheet, read.stylesheet);
    }
    blocks.push({
      handle: block.handle,
      template: block.template,
      stylesheet: block.stylesheet ?? null,
      target: block.target,
      bytes:
        utf8Bytes(read.template) +
        (read.stylesheet === undefined ? 0 : utf8Bytes(read.stylesheet)),
    });
  }
  const list = [...files].map(([path, content]) => ({ path, content }));
  const bytes = list.reduce((sum, file) => sum + utf8Bytes(file.content), 0);
  if (manifest.storefront.blocks.length > BLOCK_VERSION_LIMITS.maxBlocks) {
    errors.push({
      code: 'BLOCKS_TOO_MANY',
      path: 'storefront.blocks',
      message: `The version declares ${String(manifest.storefront.blocks.length)} blocks; at most ${String(BLOCK_VERSION_LIMITS.maxBlocks)}`,
      fix: 'Merge blocks that differ only by a setting, or remove the ones you do not need.',
    });
  }
  if (bytes > BLOCK_VERSION_LIMITS.maxBytes) {
    errors.push({
      code: 'BLOCK_FILES_TOO_LARGE',
      path: 'storefront.blocks',
      message: `The block files weigh ${(bytes / 1024).toFixed(1)} KB together; at most ${String(BLOCK_VERSION_LIMITS.maxBytes / 1024)} KB per version`,
      fix: 'Make the templates and stylesheets smaller: share one stylesheet between blocks, and drop markup a setting can replace.',
    });
  }
  return errors.length > 0
    ? { ok: false, blocks, errors }
    : { ok: true, blocks, files: list, bytes };
}

/** The blocks do not pass: one CliError (exit 4) listing every problem. Nothing was uploaded. */
export function blocksInvalid(
  errors: readonly CliProblem[],
  rerun: string,
): CliError {
  const first = errors[0];
  return new CliError({
    code: 'BLOCKS_INVALID',
    message: `The storefront blocks have ${String(errors.length)} problem${errors.length === 1 ? '' : 's'}${first ? `; the first: ${first.path ? `${first.path}: ` : ''}${first.message}` : ''}`,
    fix: first
      ? `${first.fix} Then fix the others listed and run \`${rerun}\` again.`
      : `Run \`${rerun}\` again for the list.`,
    exitCode: EXIT_CODES.MANIFEST,
    errors,
  });
}
