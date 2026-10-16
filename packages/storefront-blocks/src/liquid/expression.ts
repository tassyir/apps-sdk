import { BLOCK_LIMITS } from '../limits.js';
import type {
  CompareOp,
  Condition,
  Expr,
  FilterCall,
  Pipeline,
  Segment,
} from './ast.js';

/** A syntax problem at an offset of the template. */
export class LiquidSyntaxError extends Error {
  constructor(
    message: string,
    readonly at: number,
    readonly code:
      | 'BLOCK_LIQUID_SYNTAX'
      | 'BLOCK_FILTER_ARGUMENTS'
      | 'BLOCK_FILTER_CHAIN_TOO_LONG' = 'BLOCK_LIQUID_SYNTAX',
  ) {
    super(message);
  }
}

type TokenKind = 'string' | 'number' | 'ident' | 'punct' | 'end';

interface Token {
  kind: TokenKind;
  text: string;
  at: number;
}

const PUNCT = [
  '..',
  '==',
  '!=',
  '<>',
  '<=',
  '>=',
  '<',
  '>',
  '=',
  '.',
  '[',
  ']',
  '(',
  ')',
  '|',
  ':',
  ',',
];
const IDENT = /^[A-Za-z_][A-Za-z0-9_-]*\??/;
const NUMBER = /^-?\d+(?:\.\d+)?/;

function tokenize(markup: string, base: number): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < markup.length) {
    const c = markup[i] ?? '';
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    const at = base + i;
    if (c === '"' || c === "'") {
      const end = markup.indexOf(c, i + 1);
      if (end === -1)
        throw new LiquidSyntaxError('This string is never closed.', at);
      tokens.push({ kind: 'string', text: markup.slice(i + 1, end), at });
      i = end + 1;
      continue;
    }
    const rest = markup.slice(i);
    const number = NUMBER.exec(rest);
    // `-` starts a number only where a value can start; `a-b` is one name.
    if (
      number &&
      (c !== '-' ||
        !tokens.length ||
        tokens[tokens.length - 1]?.kind === 'punct')
    ) {
      tokens.push({ kind: 'number', text: number[0], at });
      i += number[0].length;
      continue;
    }
    const ident = IDENT.exec(rest);
    if (ident) {
      tokens.push({ kind: 'ident', text: ident[0], at });
      i += ident[0].length;
      continue;
    }
    const punct = PUNCT.find((p) => rest.startsWith(p));
    if (punct) {
      tokens.push({ kind: 'punct', text: punct, at });
      i += punct.length;
      continue;
    }
    throw new LiquidSyntaxError(`Unexpected character "${c}".`, at);
  }
  tokens.push({ kind: 'end', text: '', at: base + markup.length });
  return tokens;
}

const COMPARE_OPS: Readonly<Record<string, CompareOp>> = {
  '==': '==',
  '!=': '!=',
  '<>': '!=',
  '<': '<',
  '>': '>',
  '<=': '<=',
  '>=': '>=',
  contains: 'contains',
};

/**
 * Reads the expressions inside one tag or output. Liquid has no parentheses
 * (only ranges), no arithmetic operators and no function calls, so the
 * grammar is flat: a value, an optional comparison, conditions joined by
 * `and`/`or`, and a filter chain.
 */
export class ExpressionParser {
  private readonly tokens: Token[];
  private index = 0;

  constructor(markup: string, base: number) {
    this.tokens = tokenize(markup, base);
  }

  private peek(offset = 0): Token {
    return (
      this.tokens[Math.min(this.index + offset, this.tokens.length - 1)] ?? {
        kind: 'end',
        text: '',
        at: 0,
      }
    );
  }

  private take(): Token {
    const token = this.peek();
    if (token.kind !== 'end') this.index++;
    return token;
  }

  private isPunct(text: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token.kind === 'punct' && token.text === text;
  }

  private isWord(text: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token.kind === 'ident' && token.text === text;
  }

  private expectPunct(text: string): Token {
    const token = this.take();
    if (token.kind !== 'punct' || token.text !== text) {
      throw new LiquidSyntaxError(
        `Expected "${text}" ${describe(token)}.`,
        token.at,
      );
    }
    return token;
  }

  get atEnd(): boolean {
    return this.peek().kind === 'end';
  }

  get position(): number {
    return this.peek().at;
  }

  expectEnd(): void {
    const token = this.peek();
    if (token.kind !== 'end') {
      throw new LiquidSyntaxError(`Unexpected ${describe(token)}.`, token.at);
    }
  }

  /** A plain variable name (`assign`, `capture`, `for`). */
  name(): { name: string; at: number } {
    const token = this.take();
    if (token.kind !== 'ident' || token.text.endsWith('?')) {
      throw new LiquidSyntaxError(
        `Expected a variable name ${describe(token)}.`,
        token.at,
      );
    }
    return { name: token.text, at: token.at };
  }

  /** `capture` accepts a quoted name too, as Liquid does. */
  captureName(): { name: string; at: number } {
    const token = this.peek();
    if (token.kind === 'string') {
      this.take();
      return { name: token.text, at: token.at };
    }
    return this.name();
  }

  word(text: string): boolean {
    if (!this.isWord(text)) return false;
    this.take();
    return true;
  }

  punct(text: string): boolean {
    if (!this.isPunct(text)) return false;
    this.take();
    return true;
  }

  value(): Expr {
    const token = this.peek();
    if (token.kind === 'string') {
      this.take();
      return { type: 'literal', value: token.text, at: token.at };
    }
    if (token.kind === 'number') {
      this.take();
      return { type: 'literal', value: Number(token.text), at: token.at };
    }
    if (token.kind === 'punct' && token.text === '(') {
      this.take();
      const from = this.value();
      this.expectPunct('..');
      const to = this.value();
      this.expectPunct(')');
      return { type: 'range', from, to, at: token.at };
    }
    if (token.kind === 'punct' && token.text === '[') {
      // A bracketed root: `['key']` reads a variable by name.
      return this.path();
    }
    if (token.kind === 'ident') {
      switch (token.text) {
        case 'true':
          this.take();
          return { type: 'literal', value: true, at: token.at };
        case 'false':
          this.take();
          return { type: 'literal', value: false, at: token.at };
        case 'nil':
        case 'null':
          this.take();
          return { type: 'literal', value: null, at: token.at };
        case 'empty':
        case 'blank':
          if (!this.isPunct('.', 1) && !this.isPunct('[', 1)) {
            this.take();
            return { type: 'special', name: token.text, at: token.at };
          }
          break;
        default:
          break;
      }
      return this.path();
    }
    throw new LiquidSyntaxError(
      `Expected a value ${describe(token)}.`,
      token.at,
    );
  }

  private path(): Expr {
    const first = this.peek();
    let root: string;
    const segments: Segment[] = [];
    if (first.kind === 'punct' && first.text === '[') {
      this.take();
      const key = this.take();
      if (key.kind !== 'string') {
        throw new LiquidSyntaxError('Expected a quoted variable name.', key.at);
      }
      this.expectPunct(']');
      root = key.text;
    } else {
      root = this.take().text;
    }
    for (;;) {
      if (this.isPunct('.')) {
        const dot = this.take();
        const name = this.take();
        if (name.kind !== 'ident') {
          throw new LiquidSyntaxError(
            `Expected a property name after "." ${describe(name)}.`,
            dot.at,
          );
        }
        segments.push({ kind: 'name', name: name.text, at: name.at });
      } else if (this.isPunct('[')) {
        const open = this.take();
        const expr = this.value();
        this.expectPunct(']');
        segments.push({ kind: 'index', expr, at: open.at });
      } else break;
    }
    return { type: 'path', root, segments, at: first.at };
  }

  /** A value followed by its filters: an output, or an `assign`'s value. */
  pipeline(): Pipeline {
    const at = this.position;
    const expr = this.value();
    const filters: FilterCall[] = [];
    while (this.isPunct('|')) {
      this.take();
      const name = this.take();
      if (name.kind !== 'ident') {
        throw new LiquidSyntaxError(
          `Expected a filter name after "|" ${describe(name)}.`,
          name.at,
        );
      }
      const args: Expr[] = [];
      if (this.punct(':')) {
        do {
          if (this.peek().kind === 'ident' && this.isPunct(':', 1)) {
            throw new LiquidSyntaxError(
              `Filter "${name.text}" was given the named argument "${this.peek().text}"; storefront blocks take positional arguments only.`,
              this.peek().at,
              'BLOCK_FILTER_ARGUMENTS',
            );
          }
          args.push(this.value());
        } while (this.punct(','));
      }
      filters.push({ name: name.text, args, at: name.at });
      if (filters.length > BLOCK_LIMITS.filtersPerExpression) {
        throw new LiquidSyntaxError(
          `More than ${BLOCK_LIMITS.filtersPerExpression.toString()} filters in one expression.`,
          name.at,
          'BLOCK_FILTER_CHAIN_TOO_LONG',
        );
      }
    }
    return { expr, filters, at };
  }

  /**
   * Conditions joined by `and`/`or`. Liquid has no precedence and reads them
   * from the right: `a or b and c` is `a or (b and c)`, and so is
   * `a and b or c` → `a and (b or c)`.
   */
  condition(): Condition {
    const tests: Condition[] = [this.test()];
    const joins: ('and' | 'or')[] = [];
    while (this.isWord('and') || this.isWord('or')) {
      joins.push(this.take().text as 'and' | 'or');
      tests.push(this.test());
      if (tests.length > BLOCK_LIMITS.conditionTerms) {
        throw new LiquidSyntaxError(
          `More than ${BLOCK_LIMITS.conditionTerms.toString()} conditions in one tag.`,
          this.position,
        );
      }
    }
    let result = tests[tests.length - 1] as Condition;
    for (let i = joins.length - 1; i >= 0; i--) {
      const left = tests[i] as Condition;
      result = { type: joins[i] ?? 'and', left, right: result, at: left.at };
    }
    return result;
  }

  private test(): Condition {
    const left = this.value();
    const token = this.peek();
    const op =
      (token.kind === 'punct' || token.kind === 'ident') &&
      Object.hasOwn(COMPARE_OPS, token.text)
        ? COMPARE_OPS[token.text]
        : undefined;
    if (!op) return { type: 'test', left, op: null, right: null, at: left.at };
    this.take();
    const right = this.value();
    return { type: 'test', left, op, right, at: left.at };
  }
}

function describe(token: Token): string {
  if (token.kind === 'end') return 'at the end of the tag';
  if (token.kind === 'string') return `but found the string "${token.text}"`;
  return `but found "${token.text}"`;
}
