import type { BlockErrorCode, ErrorList } from '../errors.js';
import { BLOCK_LIMITS } from '../limits.js';
import type { Branch, Condition, Expr, Node } from './ast.js';
import { ExpressionParser, LiquidSyntaxError } from './expression.js';
import type { LiquidToken } from './lexer.js';

type TagToken = Extract<LiquidToken, { kind: 'tag' }>;

/**
 * Tags Liquid has and storefront blocks do not, each with the fix the error
 * gives. A block tag among them (`form` … `endform`) is skipped whole.
 */
const NOT_SUPPORTED: Readonly<Record<string, { fix: string; block: boolean }>> =
  {
    include: {
      fix: 'A block is one self-contained template: put the markup in it directly.',
      block: false,
    },
    render: {
      fix: 'A block is one self-contained template: put the markup in it directly.',
      block: false,
    },
    section: {
      fix: 'A block is one self-contained template: put the markup in it directly.',
      block: false,
    },
    sections: {
      fix: 'A block is one self-contained template: put the markup in it directly.',
      block: false,
    },
    layout: {
      fix: 'A block is one self-contained template: put the markup in it directly.',
      block: false,
    },
    content_for: {
      fix: 'A block is one self-contained template: put the markup in it directly.',
      block: false,
    },
    block: {
      fix: 'A block is one self-contained template: put the markup in it directly.',
      block: false,
    },
    javascript: {
      fix: 'Storefront blocks run no JavaScript: remove the tag and its code.',
      block: true,
    },
    stylesheet: {
      fix: 'Put the styles in the block\'s stylesheet file (stylesheet = "…" in tassyir.app.toml).',
      block: true,
    },
    style: {
      fix: 'Put the styles in the block\'s stylesheet file (stylesheet = "…" in tassyir.app.toml).',
      block: true,
    },
    schema: {
      fix: 'Declare the settings in tassyir.app.toml under [[storefront.blocks.settings]].',
      block: true,
    },
    form: {
      fix: "A block has no form: the order form is the page's only form.",
      block: true,
    },
    paginate: { fix: 'Use for … limit: instead.', block: true },
    tablerow: {
      fix: 'Use a for loop around <tr> markup instead.',
      block: true,
    },
    ifchanged: {
      fix: 'Compare with a variable you assign instead.',
      block: true,
    },
    doc: { fix: 'Use {% comment %} … {% endcomment %} instead.', block: true },
    cycle: {
      fix: 'Use forloop.index with the modulo filter instead.',
      block: false,
    },
    increment: {
      fix: 'Use assign with the plus filter instead.',
      block: false,
    },
    decrement: {
      fix: 'Use assign with the minus filter instead.',
      block: false,
    },
    echo: { fix: 'Use {{ … }} instead.', block: false },
    liquid: { fix: 'Write each tag in its own {% … %} instead.', block: false },
    raw: {
      fix: "Output the delimiters as strings instead: {{ '{{' }}.",
      block: false,
    },
  };

/** Tags that only make sense inside another tag. */
const INNER_TAGS = new Set([
  'elsif',
  'else',
  'when',
  'endif',
  'endunless',
  'endcase',
  'endfor',
  'endcapture',
]);

const KNOWN_END = /^end([a-z_]+)$/;

interface BodyResult {
  nodes: Node[];
  stop: TagToken | null;
}

/**
 * Builds the syntax tree. Reports every problem it can find and keeps going:
 * a broken tag is skipped, an unclosed block is closed at the end. Liquid tags
 * may nest at most `BLOCK_LIMITS.tagNesting` deep; a deeper block is reported
 * and skipped, so recursion stays bounded whatever the template.
 */
export class TemplateParser {
  private index = 0;
  private loopDepth = 0;
  private reportedDepth = false;

  constructor(
    private readonly tokens: readonly LiquidToken[],
    private readonly errors: ErrorList,
  ) {}

  parse(): Node[] {
    const { nodes, stop } = this.body(0, []);
    if (stop) this.unexpected(stop);
    return nodes;
  }

  private report(
    code: BlockErrorCode,
    at: number,
    message: string,
    fix?: string,
  ): void {
    this.errors.add(code, at, message, fix);
  }

  private syntax(error: unknown, fallbackAt: number): void {
    if (error instanceof LiquidSyntaxError) {
      this.report(error.code, error.at, error.message);
    } else {
      this.report(
        'BLOCK_LIQUID_SYNTAX',
        fallbackAt,
        'This tag cannot be read.',
      );
    }
  }

  private unexpected(tag: TagToken): void {
    this.report(
      'BLOCK_TAG_UNEXPECTED',
      tag.nameStart,
      `{% ${tag.name} %} has no matching opening tag here.`,
    );
  }

  /** Skips tokens up to and including the matching `{% end<name> %}`. */
  private skipBlock(name: string): boolean {
    let depth = 1;
    while (this.index < this.tokens.length) {
      const token = this.tokens[this.index++];
      if (token?.kind !== 'tag') continue;
      if (token.name === name) depth++;
      else if (token.name === `end${name}`) {
        depth--;
        if (depth === 0) return true;
      }
    }
    return false;
  }

  private body(depth: number, stopAt: readonly string[]): BodyResult {
    const nodes: Node[] = [];
    while (this.index < this.tokens.length) {
      const token = this.tokens[this.index++];
      if (!token) break;
      if (token.kind === 'text') {
        nodes.push({ type: 'text', value: token.value, at: token.start });
        continue;
      }
      if (token.kind === 'output') {
        if (token.markup === '') continue;
        try {
          const parser = new ExpressionParser(token.markup, token.markupStart);
          const pipeline = parser.pipeline();
          parser.expectEnd();
          nodes.push({ type: 'output', pipeline, at: token.start });
        } catch (error) {
          this.syntax(error, token.markupStart);
        }
        continue;
      }
      if (stopAt.includes(token.name)) return { nodes, stop: token };
      const node = this.tag(token, depth);
      if (node) nodes.push(node);
    }
    return { nodes, stop: null };
  }

  private tag(token: TagToken, depth: number): Node | null {
    const name = token.name;
    if (name === '#') return null;
    if (name === '') {
      this.report('BLOCK_LIQUID_SYNTAX', token.start, 'This tag has no name.');
      return null;
    }
    const unsupported = NOT_SUPPORTED[name];
    if (unsupported) {
      this.report(
        'BLOCK_TAG_NOT_SUPPORTED',
        token.nameStart,
        `{% ${name} %} is not available in storefront blocks.`,
        unsupported.fix,
      );
      if (unsupported.block) this.skipBlock(name);
      return null;
    }
    if (INNER_TAGS.has(name)) {
      this.unexpected(token);
      return null;
    }
    const isBlock =
      name === 'if' ||
      name === 'unless' ||
      name === 'case' ||
      name === 'for' ||
      name === 'capture';
    if (isBlock && depth >= BLOCK_LIMITS.tagNesting) {
      if (!this.reportedDepth) {
        this.reportedDepth = true;
        this.report(
          'BLOCK_NESTING_TOO_DEEP',
          token.nameStart,
          `Liquid blocks are nested more than ${BLOCK_LIMITS.tagNesting.toString()} deep.`,
        );
      }
      this.skipBlock(name);
      return null;
    }
    try {
      switch (name) {
        case 'if':
        case 'unless':
          return this.ifTag(token, depth);
        case 'case':
          return this.caseTag(token, depth);
        case 'for':
          return this.forTag(token, depth);
        case 'capture':
          return this.captureTag(token, depth);
        case 'assign':
          return this.assignTag(token);
        case 'break':
        case 'continue':
          if (this.loopDepth === 0) {
            this.report(
              'BLOCK_TAG_UNEXPECTED',
              token.nameStart,
              `{% ${name} %} is only allowed inside a for loop.`,
            );
            return null;
          }
          if (token.markup !== '') {
            this.report(
              'BLOCK_LIQUID_SYNTAX',
              token.markupStart,
              `{% ${name} %} takes nothing after its name.`,
            );
          }
          return { type: name, at: token.start };
        default:
          if (KNOWN_END.test(name)) this.unexpected(token);
          else {
            this.report(
              'BLOCK_TAG_UNKNOWN',
              token.nameStart,
              `{% ${name} %} is not a Liquid tag storefront blocks know.`,
            );
          }
          return null;
      }
    } catch (error) {
      this.syntax(error, token.markupStart);
      // Keep the structure in step: a broken opening tag still owns its body.
      if (isBlock) this.skipBlock(name);
      return null;
    }
  }

  private conditionOf(token: TagToken): Condition {
    const parser = new ExpressionParser(token.markup, token.markupStart);
    if (parser.atEnd) {
      throw new LiquidSyntaxError(
        `{% ${token.name} %} needs a condition.`,
        token.markupStart,
      );
    }
    const condition = parser.condition();
    parser.expectEnd();
    return condition;
  }

  private ifTag(open: TagToken, depth: number): Node {
    const end = open.name === 'if' ? 'endif' : 'endunless';
    const branches: Branch[] = [];
    let condition = this.conditionOf(open);
    let elseBody: Node[] | null = null;
    for (;;) {
      const { nodes, stop } = this.body(depth + 1, ['elsif', 'else', end]);
      branches.push({ condition, body: nodes });
      if (!stop) {
        this.unclosed(open, end);
        break;
      }
      if (stop.name === 'elsif') {
        try {
          condition = this.conditionOf(stop);
        } catch (error) {
          this.syntax(error, stop.markupStart);
          condition = {
            type: 'test',
            left: { type: 'literal', value: false, at: stop.start },
            op: null,
            right: null,
            at: stop.start,
          };
        }
        continue;
      }
      if (stop.name === 'else') {
        this.noMarkup(stop);
        const rest = this.body(depth + 1, [end, 'else', 'elsif']);
        elseBody = rest.nodes;
        if (!rest.stop) this.unclosed(open, end);
        else if (rest.stop.name !== end) {
          this.unexpected(rest.stop);
          this.skipToEnd(end, depth);
        }
      }
      break;
    }
    return {
      type: 'if',
      negateFirst: open.name === 'unless',
      branches,
      elseBody,
      at: open.start,
    };
  }

  private caseTag(open: TagToken, depth: number): Node {
    const parser = new ExpressionParser(open.markup, open.markupStart);
    const subject = parser.value();
    parser.expectEnd();
    const whens: { values: Expr[]; body: Node[] }[] = [];
    let elseBody: Node[] | null = null;
    // Anything between {% case %} and the first {% when %} is ignored, as in Liquid.
    let { stop } = this.body(depth + 1, ['when', 'else', 'endcase']);
    while (stop) {
      if (stop.name === 'when') {
        let values: Expr[] = [];
        try {
          const when = new ExpressionParser(stop.markup, stop.markupStart);
          values = [when.value()];
          while (when.punct(',') || when.word('or')) values.push(when.value());
          when.expectEnd();
        } catch (error) {
          this.syntax(error, stop.markupStart);
        }
        const next = this.body(depth + 1, ['when', 'else', 'endcase']);
        whens.push({ values, body: next.nodes });
        stop = next.stop;
        continue;
      }
      if (stop.name === 'else') {
        this.noMarkup(stop);
        const rest = this.body(depth + 1, ['endcase', 'when', 'else']);
        elseBody = rest.nodes;
        if (rest.stop && rest.stop.name !== 'endcase') {
          this.unexpected(rest.stop);
          this.skipToEnd('endcase', depth);
        } else if (!rest.stop) this.unclosed(open, 'endcase');
        return { type: 'case', subject, whens, elseBody, at: open.start };
      }
      return { type: 'case', subject, whens, elseBody, at: open.start };
    }
    this.unclosed(open, 'endcase');
    return { type: 'case', subject, whens, elseBody, at: open.start };
  }

  private forTag(open: TagToken, depth: number): Node {
    const parser = new ExpressionParser(open.markup, open.markupStart);
    const variable = parser.name();
    if (!parser.word('in')) {
      throw new LiquidSyntaxError(
        'Expected "in" after the loop variable: {% for item in items %}.',
        parser.position,
      );
    }
    const collection = parser.value();
    let limit: Expr | null = null;
    let skip: Expr | null = null;
    let reversed = false;
    while (!parser.atEnd) {
      if (parser.word('reversed')) reversed = true;
      else if (parser.word('limit')) {
        if (!parser.punct(':'))
          throw new LiquidSyntaxError(
            'Expected ":" after limit.',
            parser.position,
          );
        limit = parser.value();
      } else if (parser.word('offset')) {
        if (!parser.punct(':'))
          throw new LiquidSyntaxError(
            'Expected ":" after offset.',
            parser.position,
          );
        skip = parser.value();
      } else {
        throw new LiquidSyntaxError(
          'Expected limit:, offset: or reversed.',
          parser.position,
        );
      }
      parser.punct(',');
    }
    this.loopDepth++;
    const { nodes, stop } = this.body(depth + 1, ['else', 'endfor']);
    this.loopDepth--;
    let elseBody: Node[] | null = null;
    if (!stop) this.unclosed(open, 'endfor');
    else if (stop.name === 'else') {
      this.noMarkup(stop);
      const rest = this.body(depth + 1, ['endfor', 'else']);
      elseBody = rest.nodes;
      if (!rest.stop) this.unclosed(open, 'endfor');
      else if (rest.stop.name !== 'endfor') {
        this.unexpected(rest.stop);
        this.skipToEnd('endfor', depth);
      }
    }
    return {
      type: 'for',
      variable: variable.name,
      collection,
      limit,
      skip,
      reversed,
      body: nodes,
      elseBody,
      at: open.start,
    };
  }

  private captureTag(open: TagToken, depth: number): Node {
    const parser = new ExpressionParser(open.markup, open.markupStart);
    const { name } = parser.captureName();
    parser.expectEnd();
    const { nodes, stop } = this.body(depth + 1, ['endcapture']);
    if (!stop) this.unclosed(open, 'endcapture');
    return { type: 'capture', name, body: nodes, at: open.start };
  }

  private assignTag(open: TagToken): Node {
    const parser = new ExpressionParser(open.markup, open.markupStart);
    const { name } = parser.name();
    if (!parser.punct('=')) {
      throw new LiquidSyntaxError(
        'Expected "=" after the variable name: {% assign name = value %}.',
        parser.position,
      );
    }
    const pipeline = parser.pipeline();
    parser.expectEnd();
    return { type: 'assign', name, pipeline, at: open.start };
  }

  private noMarkup(tag: TagToken): void {
    if (tag.markup !== '') {
      this.report(
        'BLOCK_LIQUID_SYNTAX',
        tag.markupStart,
        `{% ${tag.name} %} takes nothing after its name.`,
      );
    }
  }

  private unclosed(open: TagToken, end: string): void {
    this.report(
      'BLOCK_TAG_UNCLOSED',
      open.nameStart,
      `{% ${open.name} %} is never closed with {% ${end} %}.`,
    );
  }

  /** After a misplaced tag, consume up to the block's end so later tags stay paired. */
  private skipToEnd(end: string, depth: number): void {
    this.body(depth + 1, [end]);
  }
}
