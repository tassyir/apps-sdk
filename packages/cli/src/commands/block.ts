import { readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import type {
  BlockRenderContext,
  SampleLanguage,
} from '@tassyir/storefront-blocks';
import {
  blockDeclaration,
  blockProblem,
  blocksInvalid,
  readBlock,
} from '../blocks.js';
import type { ManifestBlock } from '../blocks.js';
import { lines, stringValue } from '../command.js';
import type { Command } from '../command.js';
import { CliError, EXIT_CODES, usageError } from '../errors.js';
import { checkManifest, loadManifest, manifestInvalid } from '../manifest.js';

// `tassyir block preview`: one storefront block rendered on this machine by
// @tassyir/storefront-blocks, the renderer the storefront and the builder
// run, with its sample data (the store "Dar Amina", a product for target
// `product`, each setting at its default) and, when given, your settings
// values and app data. Nothing is sent anywhere.

const LANGUAGES: readonly SampleLanguage[] = ['ar', 'fr', 'en'];
const DATA_OWNERS = ['product', 'store', 'business'] as const;

/** Neutral values for the theme variables a stylesheet may read (a preview only). */
const PREVIEW_THEME: Readonly<Record<string, string>> = {
  '--st-primary': '#0b6e4f',
  '--st-on-primary': '#ffffff',
  '--st-primary-text': '#0b6e4f',
  '--st-secondary': '#c8963e',
  '--st-bg': '#ffffff',
  '--st-surface': '#f7f5f0',
  '--st-text': '#1f2328',
  '--st-muted': '#646b73',
  '--st-border': '#e3e0d8',
  '--st-font': 'system-ui, sans-serif',
  '--st-heading-font': 'system-ui, sans-serif',
  '--st-heading-weight': '700',
  '--st-body-size': '16px',
  '--st-radius': '12px',
  '--st-space': '8px',
  '--st-shadow': '0 1px 3px rgb(0 0 0 / 0.12)',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** JSON with object keys sorted, to compare two values. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, item: unknown) =>
    isRecord(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}

/** A JSON object from `--settings` or `--data`. */
async function readJsonObject(
  cwd: string,
  file: string,
  option: string,
): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(resolve(cwd, file), 'utf8');
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code ?? 'error';
    throw new CliError({
      code: 'PREVIEW_FILE_UNREADABLE',
      message: `--${option} ${file}: could not read it (${reason})`,
      fix: `Pass a JSON file you can read to --${option}.`,
      exitCode: EXIT_CODES.USAGE,
    });
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    value = undefined;
  }
  if (!isRecord(value)) {
    throw new CliError({
      code: 'PREVIEW_FILE_INVALID',
      message: `--${option} ${file} is not a JSON object`,
      fix:
        option === 'settings'
          ? 'Write the settings as one JSON object: { "<setting key>": <value>, … }.'
          : 'Write the app data as one JSON object by owner: { "product": { "<key>": <value> }, "store": { … }, "business": { … } }.',
      exitCode: EXIT_CODES.USAGE,
    });
  }
  return value;
}

/** The block named, or the only one; usage errors otherwise. */
function pickBlock(
  blocks: readonly ManifestBlock[],
  handle: string | undefined,
): { block: ManifestBlock; index: number } {
  const handles = blocks.map((block) => block.handle);
  if (blocks.length === 0) {
    throw new CliError({
      code: 'BLOCK_NOT_FOUND',
      message: 'tassyir.app.toml declares no storefront block',
      fix: 'Declare one in [[storefront.blocks]] (handle, template, name, target), with "write_storefront" in access.scopes: see https://developers.tassyir.io/guides/storefront-blocks.',
      exitCode: EXIT_CODES.MANIFEST,
    });
  }
  if (handle === undefined) {
    const only = blocks[0];
    if (blocks.length === 1 && only) return { block: only, index: 0 };
    throw usageError(
      `Which block? The manifest declares ${handles.join(', ')}: pass one`,
      'block preview',
    );
  }
  const index = handles.indexOf(handle);
  const block = blocks[index];
  if (!block) {
    throw new CliError({
      code: 'BLOCK_NOT_FOUND',
      message: `tassyir.app.toml declares no block "${handle}"`,
      fix: `Use one of: ${handles.join(', ')}.`,
      exitCode: EXIT_CODES.USAGE,
      details: { handle },
    });
  }
  return { block, index };
}

/** A standalone page around the block: no script can run in it (CSP). */
function previewPage(options: {
  handle: string;
  language: SampleLanguage;
  html: string;
  stylesheet: string | undefined;
  variables: Readonly<Record<string, string>>;
}): string {
  const direction = options.language === 'ar' ? 'rtl' : 'ltr';
  const theme = Object.entries(PREVIEW_THEME)
    .map(([name, value]) => `${name}: ${value};`)
    .join(' ');
  const section = Object.entries(options.variables)
    .map(([name, value]) => `${name}: ${value};`)
    .join(' ');
  return `<!doctype html>
<html lang="${options.language}" dir="${direction}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https://cdn.tassyir.io; style-src 'unsafe-inline'">
<title>${options.handle}: preview</title>
<style>
:root { ${theme} }
body { margin: 0; padding: 24px; background: var(--st-bg); color: var(--st-text); font-family: var(--st-font); font-size: var(--st-body-size); }
.tsy-preview-section { contain: paint; isolation: isolate; max-width: 960px; margin: 0 auto; ${section} }
</style>
${options.stylesheet === undefined ? '' : `<style>\n${options.stylesheet}\n</style>\n`}</head>
<body>
<section class="tsy-preview-section">
${options.html}
</section>
</body>
</html>
`;
}

export const blockPreviewCommand: Command = {
  name: 'block preview',
  summary:
    'Render a storefront block on this machine with sample data (offline)',
  usage: 'tassyir block preview [handle] [options]',
  description: [
    'Renders one [[storefront.blocks]] entry with @tassyir/storefront-blocks, the renderer the',
    'store and the builder run: the sample store "Dar Amina", a sample product for target',
    '"product", each setting at its default, and the app data and settings you pass. Prints',
    'the HTML as the store would show it (after the HTML gate); --out writes a page to open',
    'in a browser, with the stylesheet. The template and stylesheet are checked first, with',
    'every problem at once. Nothing is sent to Tassyir.',
  ].join('\n'),
  positionals: { min: 0, max: 1, names: '[handle]' },
  options: {
    manifest: {
      type: 'string',
      value: 'path',
      description: 'Default ./tassyir.app.toml.',
    },
    lang: {
      type: 'string',
      value: 'ar|fr|en',
      description: "The store's language. Default ar (right to left).",
    },
    settings: {
      type: 'string',
      value: 'file.json',
      description:
        'Settings values as the merchant would save them: { "<key>": <value> }.',
    },
    data: {
      type: 'string',
      value: 'file.json',
      description:
        'App data by owner: { "product": { "<key>": <value> }, "store": {…}, "business": {…} }. Default none: a block must render without it.',
    },
    out: {
      type: 'string',
      value: 'file.html',
      description: 'Write a page with the block and its stylesheet.',
    },
  },
  async run(context, { values, positionals }) {
    const language = stringValue(values['lang']) ?? 'ar';
    if (!LANGUAGES.includes(language as SampleLanguage)) {
      throw usageError(
        `--lang takes ar, fr or en, got ${language}`,
        'block preview',
      );
    }
    const loaded = await loadManifest(
      context.io.cwd,
      stringValue(values['manifest']),
    );
    const check = checkManifest(loaded.parsed);
    if (!check.ok) throw manifestInvalid(loaded.display, check.errors);
    const { block, index } = pickBlock(
      check.manifest.storefront.blocks,
      positionals[0],
    );
    const read = await readBlock(dirname(loaded.path), block, index);
    if (!read.ok) throw blocksInvalid(read.errors, 'tassyir block preview');
    const {
      blockCssVariables,
      compileBlockTemplate,
      renderCompiledBlock,
      resolveBlockSettings,
      sampleBlockContext,
      validateBlockStylesheet,
    } = await import('@tassyir/storefront-blocks');
    const declaration = blockDeclaration(block);
    const names = {
      template: block.template,
      stylesheet: block.stylesheet ?? null,
    };
    const compiled = compileBlockTemplate(read.template, declaration);
    const problems = [
      ...(compiled.ok ? [] : compiled.errors),
      ...(read.stylesheet === undefined
        ? []
        : validateBlockStylesheet(read.stylesheet, declaration)),
    ].map((error) => blockProblem(block.handle, names, error));
    if (!compiled.ok || problems.length > 0) {
      throw blocksInvalid(problems, 'tassyir block preview');
    }

    const warnings: string[] = [];
    const settingsFile = stringValue(values['settings']);
    const dataFile = stringValue(values['data']);
    const given = settingsFile
      ? await readJsonObject(context.io.cwd, settingsFile, 'settings')
      : {};
    const declared = new Set(block.settings.map((setting) => setting.key));
    for (const key of Object.keys(given)) {
      if (!declared.has(key)) {
        warnings.push(
          `Setting "${key}" is not declared by the block: the render drops it.`,
        );
      }
    }
    const appData: NonNullable<BlockRenderContext['appData']> = {};
    if (dataFile) {
      const raw = await readJsonObject(context.io.cwd, dataFile, 'data');
      for (const [owner, entries] of Object.entries(raw)) {
        if (!(DATA_OWNERS as readonly string[]).includes(owner)) {
          warnings.push(
            `App data owner "${owner}" never reaches a block (only product, store and business): dropped.`,
          );
          continue;
        }
        if (!isRecord(entries)) {
          warnings.push(
            `App data "${owner}" is not an object of keys: dropped.`,
          );
          continue;
        }
        for (const key of Object.keys(entries)) {
          if (!block.data.includes(`${owner}.${key}`)) {
            warnings.push(
              `App data "${owner}.${key}" is not in the block's data list: the render drops it.`,
            );
          }
        }
        appData[owner as (typeof DATA_OWNERS)[number]] = entries;
      }
    }

    const renderContext = sampleBlockContext(declaration, {
      language: language as SampleLanguage,
      appData,
    });
    const resolved = resolveBlockSettings(block.settings, given);
    for (const key of Object.keys(given)) {
      if (!declared.has(key)) continue;
      const value = resolved[key];
      if (canonical(value) !== canonical(given[key])) {
        warnings.push(
          `Setting "${key}" does not fit its declaration: the store would use the default instead.`,
        );
        continue;
      }
      renderContext.settings = { ...renderContext.settings, [key]: value };
    }
    const result = renderCompiledBlock(compiled.template, renderContext);
    if (!result.ok) {
      throw new CliError({
        code: 'BLOCK_RENDER_FAILED',
        message: `Block "${block.handle}" stopped while rendering: ${result.errors[0]?.message ?? 'a limit was reached'}`,
        fix:
          result.errors[0]?.fix ??
          'Render less: fewer loop iterations, shorter strings.',
        exitCode: EXIT_CODES.MANIFEST,
        errors: result.errors.map((error) =>
          blockProblem(block.handle, names, error),
        ),
      });
    }
    const variables = blockCssVariables(
      block.settings,
      renderContext.settings ?? {},
    );
    const out = stringValue(values['out']);
    let file: string | null = null;
    if (out !== undefined) {
      const path = resolve(context.io.cwd, out);
      await writeFile(
        path,
        previewPage({
          handle: block.handle,
          language: language as SampleLanguage,
          html: result.html,
          stylesheet: read.stylesheet,
          variables,
        }),
      );
      file = relative(context.io.cwd, path) || path;
    }
    const stats = `${String(result.stats.steps)} steps, ${String(result.stats.bytes)} bytes`;
    if (file === null) {
      // stdout is the HTML alone (`> block.html`); the rest goes to stderr.
      context.progress(`✓ ${block.handle} in ${language}: ${stats}.`);
      for (const warning of warnings) context.progress(`  ! ${warning}`);
    }
    return {
      data: {
        block: {
          handle: block.handle,
          target: block.target,
          template: block.template,
          stylesheet: block.stylesheet ?? null,
        },
        language,
        html: result.html,
        stats: result.stats,
        cssVariables: variables,
        file,
        warnings,
      },
      text:
        file === null
          ? `${result.html}\n`
          : lines(
              `✓ Wrote ${file}: ${block.handle} in ${language} (${stats}). Open it in a browser.`,
              ...warnings.map((warning) => `  ! ${warning}`),
            ),
    };
  },
};
