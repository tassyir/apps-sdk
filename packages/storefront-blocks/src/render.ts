import type { BlockTarget } from './declaration.js';
import {
  BLOCK_DATA_OWNERS,
  BLOCK_PRODUCT_FIELDS,
  BLOCK_STORE_FIELDS,
} from './declaration.js';
import type { BlockError } from './errors.js';
import { blockErrorFix, utf8Length } from './errors.js';
import { FILTERS } from './filters.js';
import { escapeHtml } from './html/escape.js';
import { sanitizeBlockHtml } from './html/sanitize.js';
import { BLOCK_LIMITS, RENDER_STEP_COSTS } from './limits.js';
import type { Condition, Expr, Node, Pipeline } from './liquid/ast.js';
import type { BlockLanguage, FilterRuntime } from './runtime.js';
import {
  RenderLimitError,
  StepMeter,
  checkStringLength,
  readSteps,
  sizeSteps,
} from './runtime.js';
import type { Value, ValueMap, Work } from './values.js';
import {
  DataLimitError,
  SafeHtml,
  asNumber,
  compareStrings,
  formatNumber,
  isArray,
  isBlankValue,
  isEmptyValue,
  isMap,
  isTruthy,
  textLength,
  toInteger,
  toText,
  toValue,
  valuesEqual,
} from './values.js';

/** The product of a product page, as the storefront gives it to a block. */
export interface BlockProduct {
  id?: string;
  name?: string;
  url?: string;
  /** A decimal string, as everywhere in Tassyir ("4500.00"). */
  price?: string | number;
  compareAtPrice?: string | number | null;
  currency?: string;
  /** A stored image (`https://cdn.tassyir.io/images/<id>/public`). */
  image?: string | null;
  available?: boolean;
}

export interface BlockStore {
  name?: string;
  url?: string;
  /** `ar`, `fr` or `en`; a block's text and `money` follow it. */
  locale?: string;
  direction?: 'rtl' | 'ltr';
  currency?: string;
}

/** Everything one render reads. Pass JSON data: it is copied, never used as is. */
export interface BlockRenderContext {
  store: BlockStore;
  /** The page's product, for a block with target `product`. */
  product?: BlockProduct | null;
  /** The block's settings values (resolve them with `resolveBlockSettings`). */
  settings?: Record<string, unknown>;
  /** The app's data the block reads, by owner, then key. */
  appData?: Partial<
    Record<'product' | 'store' | 'business', Record<string, unknown>>
  >;
}

export interface BlockRenderStats {
  /** Steps spent, of `BLOCK_LIMITS.steps`. */
  steps: number;
  /** Bytes of the returned HTML. */
  bytes: number;
}

export type BlockRenderResult =
  | { ok: true; html: string; stats: BlockRenderStats }
  | { ok: false; errors: BlockError[] };

type Flow = 'normal' | 'break' | 'continue';

interface OutputBuffer {
  parts: string[];
  length: number;
  bytes: number;
  /** The top-level output (bytes capped) or a capture (characters capped). */
  top: boolean;
}

function languageOf(store: BlockStore): BlockLanguage {
  const locale =
    typeof store.locale === 'string' ? store.locale.toLowerCase() : '';
  if (locale.startsWith('ar')) return 'ar';
  if (locale.startsWith('fr')) return 'fr';
  if (locale.startsWith('en')) return 'en';
  return store.direction === 'rtl' ? 'ar' : 'en';
}

/** Copies only the named fields of a record (the rest never reaches a template). */
function pick(
  record: object,
  fields: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (Object.hasOwn(record, field))
      out[field] = (record as Record<string, unknown>)[field];
  }
  return out;
}

class Interpreter {
  private readonly meter = new StepMeter();
  private readonly locals = new Map<string, Value>();
  private readonly loops: ValueMap[] = [];
  private readonly buffers: OutputBuffer[] = [
    { parts: [], length: 0, bytes: 0, top: true },
  ];
  readonly runtime: FilterRuntime;

  constructor(
    private readonly globals: ReadonlyMap<string, Value>,
    language: BlockLanguage,
    currency: string,
  ) {
    const meter = this.meter;
    this.runtime = {
      language,
      currency,
      spend: (steps) => {
        meter.spend(steps);
      },
    };
  }

  get steps(): number {
    return this.meter.used;
  }

  output(): string {
    return this.buffers[0]?.parts.join('') ?? '';
  }

  private emit(text: string): void {
    if (text === '') return;
    const buffer = this.buffers[this.buffers.length - 1];
    if (!buffer) return;
    if (buffer.top) {
      buffer.bytes += utf8Length(text);
      if (buffer.bytes > BLOCK_LIMITS.outputBytes) {
        throw new RenderLimitError(
          'BLOCK_RENDER_OUTPUT_LIMIT',
          `The block rendered more than ${BLOCK_LIMITS.outputBytes.toString()} bytes of HTML.`,
        );
      }
    } else {
      buffer.length += text.length;
      checkStringLength(buffer.length);
    }
    buffer.parts.push(text);
  }

  run(nodes: readonly Node[]): void {
    this.nodes(nodes);
  }

  private nodes(nodes: readonly Node[]): Flow {
    for (const node of nodes) {
      const flow = this.node(node);
      if (flow !== 'normal') return flow;
    }
    return 'normal';
  }

  private node(node: Node): Flow {
    this.meter.spend(RENDER_STEP_COSTS.node);
    switch (node.type) {
      case 'text':
        this.meter.spend(
          Math.floor(node.value.length / RENDER_STEP_COSTS.perChars),
        );
        this.emit(node.value);
        return 'normal';
      case 'output': {
        const value = this.pipeline(node.pipeline);
        if (value instanceof SafeHtml) this.emit(value.html);
        else {
          const text = this.textOf(value);
          this.meter.spend(
            Math.floor(text.length / RENDER_STEP_COSTS.perChars),
          );
          this.emit(escapeHtml(text));
        }
        return 'normal';
      }
      case 'assign':
        this.assign(node.name, this.pipeline(node.pipeline));
        return 'normal';
      case 'capture': {
        this.buffers.push({ parts: [], length: 0, bytes: 0, top: false });
        const flow = this.nodes(node.body);
        const captured = this.buffers.pop();
        this.assign(node.name, captured ? captured.parts.join('') : '');
        return flow;
      }
      case 'if': {
        for (let b = 0; b < node.branches.length; b++) {
          const branch = node.branches[b];
          if (!branch) continue;
          let pass = this.condition(branch.condition);
          if (b === 0 && node.negateFirst) pass = !pass;
          if (pass) return this.nodes(branch.body);
        }
        return node.elseBody ? this.nodes(node.elseBody) : 'normal';
      }
      case 'case': {
        const subject = this.value(node.subject);
        for (const when of node.whens) {
          for (const candidate of when.values) {
            if (this.equal(subject, this.value(candidate)))
              return this.nodes(when.body);
          }
        }
        return node.elseBody ? this.nodes(node.elseBody) : 'normal';
      }
      case 'for':
        return this.loop(node);
      case 'break':
      case 'continue':
        return node.type;
    }
  }

  /** The text of an output, refused before it is built when too long. */
  private textOf(value: Value): string {
    checkStringLength(textLength(value));
    return toText(value);
  }

  /** `==`, charged for what it compares. */
  private equal(a: Value, b: Value): boolean {
    const work: Work = { n: 0 };
    const equal = valuesEqual(a, b, work);
    this.meter.spend(sizeSteps(work.n));
    return equal;
  }

  private assign(name: string, value: Value): void {
    // A block object cannot be replaced (the validator refuses it too).
    if (this.globals.has(name) || name === 'forloop') return;
    this.locals.set(name, value);
  }

  private loop(node: Extract<Node, { type: 'for' }>): Flow {
    const skip = node.skip ? Math.max(0, toInteger(this.value(node.skip))) : 0;
    const requested = node.limit
      ? toInteger(this.value(node.limit))
      : BLOCK_LIMITS.loopIterations;
    const limit = Math.min(BLOCK_LIMITS.loopIterations, Math.max(0, requested));
    let items: Value[];
    if (node.collection.type === 'range') {
      const from = toInteger(this.value(node.collection.from));
      const to = toInteger(this.value(node.collection.to));
      const count = Math.max(0, Math.min(to - from + 1 - skip, limit));
      items = [];
      for (let k = 0; k < count; k++) items.push(from + skip + k);
    } else {
      const collection = this.value(node.collection);
      let all: readonly Value[];
      if (isArray(collection)) all = collection;
      else if (isMap(collection))
        all = [...collection].map(([key, item]) => Object.freeze([key, item]));
      else if (collection === null || collection === false || collection === '')
        all = [];
      else all = [collection];
      items = all.slice(skip, skip + limit);
    }
    if (node.reversed) items.reverse();

    if (items.length === 0)
      return node.elseBody ? this.nodes(node.elseBody) : 'normal';
    const saved = this.locals.has(node.variable)
      ? this.locals.get(node.variable)
      : undefined;
    const hadSaved = this.locals.has(node.variable);
    const length = items.length;
    try {
      for (let index = 0; index < length; index++) {
        this.meter.spend(RENDER_STEP_COSTS.node);
        this.locals.set(node.variable, items[index] ?? null);
        this.loops.push(
          new Map<string, Value>([
            ['index', index + 1],
            ['index0', index],
            ['rindex', length - index],
            ['rindex0', length - index - 1],
            ['first', index === 0],
            ['last', index === length - 1],
            ['length', length],
          ]),
        );
        const flow = this.nodes(node.body);
        this.loops.pop();
        if (flow === 'break') break;
      }
    } finally {
      if (hadSaved) this.locals.set(node.variable, saved ?? null);
      else this.locals.delete(node.variable);
    }
    return 'normal';
  }

  private pipeline(pipeline: Pipeline): Value {
    let value = this.value(pipeline.expr);
    for (const call of pipeline.filters) {
      const spec = Object.hasOwn(FILTERS, call.name)
        ? FILTERS[call.name]
        : undefined;
      // An unknown filter leaves the value as it is (the validator refuses it).
      if (!spec) continue;
      const args = call.args.map((arg) => this.value(arg));
      // A filter reads markup a Tassyir filter made as its text: what any
      // filter returns from it is plain text, escaped on output.
      if (value instanceof SafeHtml) value = value.text;
      // The arguments and the result are charged by size too: `replace` with
      // a long replacement costs what it builds, not what it reads.
      this.meter.spend(readSteps(...args));
      value = spec.fn(value, args, this.runtime);
      this.meter.spend(readSteps(value));
    }
    return value;
  }

  private condition(condition: Condition): boolean {
    this.meter.spend(1);
    if (condition.type !== 'test') {
      return condition.type === 'and'
        ? this.condition(condition.left) && this.condition(condition.right)
        : this.condition(condition.left) || this.condition(condition.right);
    }
    if (condition.op === null || condition.right === null) {
      // `{% if empty %}` and `{% if blank %}` are true, like any value.
      return (
        condition.left.type === 'special' ||
        isTruthy(this.value(condition.left))
      );
    }
    const left = condition.left;
    const right = condition.right;
    if (condition.op === '==' || condition.op === '!=') {
      let equal: boolean;
      if (right.type === 'special' || left.type === 'special') {
        const special =
          right.type === 'special'
            ? right
            : (left as Extract<Expr, { type: 'special' }>);
        const other = this.value(right.type === 'special' ? left : right);
        equal =
          special.name === 'empty' ? isEmptyValue(other) : isBlankValue(other);
      } else {
        equal = this.equal(this.value(left), this.value(right));
      }
      return condition.op === '==' ? equal : !equal;
    }
    const a = this.value(left);
    const b = this.value(right);
    if (condition.op === 'contains') {
      if (typeof a === 'string') {
        if (b === null) return false;
        const needle = this.textOf(b);
        this.meter.spend(sizeSteps(a.length + needle.length));
        return a.includes(needle);
      }
      if (isArray(a)) return a.some((item) => this.equal(item, b));
      if (isMap(a)) return a.has(this.textOf(b));
      return false;
    }
    let order: number | null = null;
    const x = asNumber(a);
    const y = asNumber(b);
    if (typeof a === 'number' && typeof b === 'number') order = a - b;
    else if (
      x !== null &&
      y !== null &&
      (typeof a === 'number' || typeof b === 'number')
    )
      order = x - y;
    else if (typeof a === 'string' && typeof b === 'string') {
      this.meter.spend(sizeSteps(Math.min(a.length, b.length)));
      order = compareStrings(a, b);
    }
    if (order === null) return false;
    switch (condition.op) {
      case '<':
        return order < 0;
      case '>':
        return order > 0;
      case '<=':
        return order <= 0;
      case '>=':
        return order >= 0;
    }
  }

  private value(expr: Expr): Value {
    switch (expr.type) {
      case 'literal':
        return expr.value;
      case 'special':
        return '';
      case 'range': {
        const from = toInteger(this.value(expr.from));
        const to = toInteger(this.value(expr.to));
        return `${formatNumber(from)}..${formatNumber(to)}`;
      }
      case 'path': {
        this.meter.spend(1);
        let current = this.root(expr.root);
        for (const segment of expr.segments) {
          if (current === null) return null;
          const key =
            segment.kind === 'name' ? segment.name : this.value(segment.expr);
          current = this.property(current, key);
        }
        return current;
      }
    }
  }

  private root(name: string): Value {
    if (this.locals.has(name)) return this.locals.get(name) ?? null;
    if (name === 'forloop') return this.loops[this.loops.length - 1] ?? null;
    return this.globals.get(name) ?? null;
  }

  /** A property of a value: a record's own key, an array's index, or
   * `size` / `first` / `last`. Nothing else is reachable. */
  private property(value: Value, key: Value): Value {
    if (isMap(value)) {
      const name = this.textOf(key);
      if (value.has(name)) return value.get(name) ?? null;
      return name === 'size' ? value.size : null;
    }
    if (isArray(value)) {
      if (typeof key === 'number') {
        const index =
          Math.trunc(key) < 0
            ? value.length + Math.trunc(key)
            : Math.trunc(key);
        return value[index] ?? null;
      }
      if (key === 'size') return value.length;
      if (key === 'first') return value[0] ?? null;
      if (key === 'last') return value[value.length - 1] ?? null;
      return null;
    }
    if (typeof value === 'string') {
      if (key === 'size' || key === 'first' || key === 'last') {
        this.meter.spend(sizeSteps(value.length));
      }
      if (key === 'size') return Array.from(value).length;
      if (key === 'first') return Array.from(value)[0] ?? null;
      if (key === 'last') return Array.from(value).at(-1) ?? null;
    }
    return null;
  }
}

/** A template compiled by `compileBlockTemplate`: opaque, reusable, immutable. */
export interface CompiledBlockTemplate {
  readonly target: BlockTarget;
  /** @internal */
  readonly nodes: readonly Node[];
}

function renderError(
  code: BlockError['code'],
  message: string,
): BlockRenderResult {
  return {
    ok: false,
    errors: [
      {
        code,
        source: 'render',
        line: 0,
        column: 0,
        message,
        fix: blockErrorFix(code),
      },
    ],
  };
}

/**
 * Renders a compiled template with one context: the HTML of the block, gated
 * by `sanitizeBlockHtml`, or the limit it hit. Never throws; the same template
 * and context give the same result on every machine.
 */
export function renderCompiledBlock(
  template: CompiledBlockTemplate,
  context: BlockRenderContext,
): BlockRenderResult {
  try {
    if (typeof context !== 'object' || typeof context.store !== 'object') {
      return renderError(
        'BLOCK_RENDER_CONTEXT_INVALID',
        'The render context has no store.',
      );
    }
    const store = context.store;
    const language = languageOf(store);
    const currency =
      typeof store.currency === 'string' ? store.currency : 'DZD';
    const budget = { bytes: BLOCK_LIMITS.dataBytes };
    const appData = new Map<string, Value>();
    for (const owner of BLOCK_DATA_OWNERS) {
      if (owner === 'product' && template.target !== 'product') continue;
      const data = context.appData?.[owner];
      if (data !== undefined) appData.set(owner, toValue(data, budget));
    }
    // Settings, the store and the product are bounded like app data: each is
    // copied under its own 32 KB budget.
    const own = (): { bytes: number } => ({ bytes: BLOCK_LIMITS.dataBytes });
    const globals = new Map<string, Value>([
      [
        'block',
        new Map<string, Value>([
          ['settings', toValue(context.settings ?? {}, own())],
        ]),
      ],
      ['store', toValue(pick(store, BLOCK_STORE_FIELDS), own())],
      ['app', new Map<string, Value>([['data', appData]])],
    ]);
    if (template.target === 'product' && context.product) {
      globals.set(
        'product',
        toValue(pick(context.product, BLOCK_PRODUCT_FIELDS), own()),
      );
    }
    const interpreter = new Interpreter(globals, language, currency);
    interpreter.run(template.nodes);
    const html = sanitizeBlockHtml(interpreter.output());
    const bytes = utf8Length(html);
    if (bytes > BLOCK_LIMITS.outputBytes) {
      return renderError(
        'BLOCK_RENDER_OUTPUT_LIMIT',
        `The block rendered more than ${BLOCK_LIMITS.outputBytes.toString()} bytes of HTML.`,
      );
    }
    return { ok: true, html, stats: { steps: interpreter.steps, bytes } };
  } catch (error) {
    if (error instanceof RenderLimitError)
      return renderError(error.code, error.message);
    if (error instanceof DataLimitError) {
      return renderError(
        'BLOCK_RENDER_DATA_TOO_LARGE',
        `The app data is too large or too deep: ${error.message}.`,
      );
    }
    return renderError(
      'BLOCK_RENDER_FAILED',
      'The block could not be rendered.',
    );
  }
}
