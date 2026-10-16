import { checkCharacters } from './characters.js';
import { validateBlockStylesheet } from './css/validate-stylesheet.js';
import type { BlockDeclaration } from './declaration.js';
import type { BlockError } from './errors.js';
import { ErrorList, LineIndex, utf8Length } from './errors.js';
import { checkTemplateMarkup } from './html/check-markup.js';
import { BLOCK_LIMITS } from './limits.js';
import { analyzeTemplate, outputsByOffset } from './liquid/analyze.js';
import { lexTemplate } from './liquid/lexer.js';
import { TemplateParser } from './liquid/parser.js';
import type {
  BlockRenderContext,
  BlockRenderResult,
  CompiledBlockTemplate,
} from './render.js';
import { renderCompiledBlock } from './render.js';
import type { SampleLanguage } from './sample.js';
import { sampleBlockContext } from './sample.js';

export interface CompileOptions {
  /**
   * `all` (the default, the upload check): size, characters, Liquid, the
   * declaration and the static HTML. `syntax`: only what a render cannot do
   * without (size and Liquid syntax), for a renderer that keeps showing
   * templates an older version of this package accepted. Safety never depends
   * on the checks: every render's HTML goes through the same gate.
   */
  checks?: 'all' | 'syntax';
}

export type CompileResult =
  | { ok: true; template: CompiledBlockTemplate }
  | { ok: false; errors: BlockError[] };

/**
 * Reads and checks a block template: its size and characters, its Liquid
 * (syntax, tags, filters, loops, variables), what it reads against the block's
 * declaration (target, settings, app data keys), and its static HTML. Returns
 * a template to render, or every error with its line, column and fix. Never
 * throws.
 */
export function compileBlockTemplate(
  source: unknown,
  declaration: BlockDeclaration = {},
  options: CompileOptions = {},
): CompileResult {
  if (typeof source !== 'string' || source.includes('\0')) {
    const errors = new ErrorList('template', new LineIndex(''));
    errors.add('BLOCK_TEMPLATE_NOT_TEXT', 0, 'The template is not text.');
    return { ok: false, errors: errors.sorted() };
  }
  const errors = new ErrorList('template', new LineIndex(source));
  const bytes = utf8Length(source);
  if (bytes > BLOCK_LIMITS.templateBytes) {
    errors.add(
      'BLOCK_TEMPLATE_TOO_LARGE',
      0,
      `The template is ${bytes.toString()} bytes; the limit is ${BLOCK_LIMITS.templateBytes.toString()}.`,
    );
    return { ok: false, errors: errors.sorted() };
  }
  if (source.trim() === '') {
    errors.add('BLOCK_TEMPLATE_EMPTY', 0, 'The template is empty.');
    return { ok: false, errors: errors.sorted() };
  }
  const all = options.checks !== 'syntax';
  if (all) checkCharacters(source, errors, 'template');
  const tokens = lexTemplate(source, errors);
  const nodes = new TemplateParser(tokens, errors).parse();
  if (all) {
    analyzeTemplate(nodes, declaration, errors);
    checkTemplateMarkup(source, tokens, outputsByOffset(nodes), errors);
  }
  if (errors.count > 0) return { ok: false, errors: errors.sorted() };
  return {
    ok: true,
    template: Object.freeze({
      target: declaration.target ?? 'any',
      data: declaration.data ? Object.freeze([...declaration.data]) : null,
      settings: declaration.settings
        ? Object.freeze(declaration.settings.map((setting) => setting.key))
        : null,
      nodes: Object.freeze(nodes),
    }),
  };
}

/**
 * Renders a block: a template source (compiled first, its errors returned)
 * or a compiled template, with one context. The HTML is safe to put on a
 * store page as it is; builder-core still passes it through its own gate.
 */
export function renderBlock(
  template: string | CompiledBlockTemplate,
  context: BlockRenderContext,
  declaration: BlockDeclaration = {},
): BlockRenderResult {
  if (typeof template === 'string') {
    const compiled = compileBlockTemplate(template, declaration);
    if (!compiled.ok) return compiled;
    return renderCompiledBlock(compiled.template, context);
  }
  return renderCompiledBlock(template, context);
}

export interface BlockFiles {
  /** The `.liquid` template's source. */
  template: unknown;
  /** The `.css` stylesheet's source, when the block declares one. */
  stylesheet?: unknown;
  /** The block's entry in tassyir.app.toml. */
  declaration?: BlockDeclaration;
}

export type BlockValidationResult =
  { ok: true } | { ok: false; errors: BlockError[] };

const SAMPLE_LANGUAGES: readonly SampleLanguage[] = ['ar', 'fr', 'en'];

/**
 * The upload check of one block: the template compiled against its
 * declaration, the stylesheet checked, and the template rendered with sample
 * data in Arabic, French and English, without app data, so a block that only
 * works with data, or loops past a limit on sample data, is caught here. The
 * Tassyir API runs this exact function; errors come template first, then
 * stylesheet, then render, each sorted by position.
 */
export function validateBlock(files: BlockFiles): BlockValidationResult {
  const declaration = files.declaration ?? {};
  const compiled = compileBlockTemplate(files.template, declaration);
  const errors: BlockError[] = compiled.ok ? [] : [...compiled.errors];
  if (files.stylesheet !== undefined)
    errors.push(...validateBlockStylesheet(files.stylesheet, declaration));
  if (compiled.ok) {
    for (const language of SAMPLE_LANGUAGES) {
      const result = renderCompiledBlock(
        compiled.template,
        sampleBlockContext(declaration, { language }),
      );
      if (!result.ok) {
        errors.push(
          ...result.errors.map((error) => ({
            ...error,
            message: `${error.message} (sample render, ${language})`,
          })),
        );
        break;
      }
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
