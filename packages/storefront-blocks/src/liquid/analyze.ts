import type { BlockDeclaration } from '../declaration.js';
import {
  BLOCK_DATA_OWNERS,
  BLOCK_FORLOOP_FIELDS,
  BLOCK_OBJECTS,
  BLOCK_PRODUCT_FIELDS,
  BLOCK_STORE_FIELDS,
  SPECIAL_PROPERTIES,
} from '../declaration.js';
import type { ErrorList } from '../errors.js';
import { FILTERS, FILTERS_NOT_SUPPORTED } from '../filters.js';
import { BLOCK_LIMITS } from '../limits.js';
import type { Condition, Expr, Node, Pipeline } from './ast.js';

const RESERVED: ReadonlySet<string> = new Set(BLOCK_OBJECTS);

function literalInteger(expr: Expr): number | null {
  return expr.type === 'literal' && typeof expr.value === 'number'
    ? Math.trunc(expr.value)
    : null;
}

/** Every name the template assigns or captures, anywhere. */
function assignedNames(
  nodes: readonly Node[],
  into: Map<string, number>,
): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'assign':
      case 'capture':
        if (!into.has(node.name)) into.set(node.name, node.at);
        if (node.type === 'capture') assignedNames(node.body, into);
        break;
      case 'if':
        for (const branch of node.branches) assignedNames(branch.body, into);
        if (node.elseBody) assignedNames(node.elseBody, into);
        break;
      case 'case':
        for (const when of node.whens) assignedNames(when.body, into);
        if (node.elseBody) assignedNames(node.elseBody, into);
        break;
      case 'for':
        assignedNames(node.body, into);
        if (node.elseBody) assignedNames(node.elseBody, into);
        break;
      default:
        break;
    }
  }
}

/**
 * Checks a parsed template against the block's declaration: the objects and
 * properties it reads, the settings and app data keys it names, its filters,
 * its loops and its variables. Everything here is decided from the template
 * alone; what depends on data is the render's job.
 */
export function analyzeTemplate(
  nodes: readonly Node[],
  declaration: BlockDeclaration,
  errors: ErrorList,
): void {
  const target = declaration.target ?? 'any';
  const settings = declaration.settings
    ? new Set(declaration.settings.map((s) => s.key))
    : null;
  const data = declaration.data ? new Set(declaration.data) : null;
  const assigned = new Map<string, number>();
  assignedNames(nodes, assigned);

  for (const [name, at] of assigned) {
    if (RESERVED.has(name)) {
      errors.add(
        'BLOCK_ASSIGN_RESERVED',
        at,
        `"${name}" is a block object and cannot be assigned.`,
      );
    }
  }
  if (assigned.size > BLOCK_LIMITS.variables) {
    const at = [...assigned.values()][BLOCK_LIMITS.variables] ?? 0;
    errors.add(
      'BLOCK_TOO_MANY_VARIABLES',
      at,
      `The template assigns ${assigned.size.toString()} variables; at most ${BLOCK_LIMITS.variables.toString()} are allowed.`,
    );
  }

  const loopVariables: string[] = [];
  let loopDepth = 0;
  let reportedLoopDepth = false;

  const path = (expr: Extract<Expr, { type: 'path' }>): void => {
    const root = expr.root;
    const first = expr.segments[0];
    const firstName = first?.kind === 'name' ? first.name : null;
    for (const segment of expr.segments) {
      if (segment.kind === 'index') value(segment.expr);
    }
    if (
      loopVariables.includes(root) ||
      (assigned.has(root) && !RESERVED.has(root))
    )
      return;
    switch (root) {
      case 'forloop':
        if (loopDepth === 0) {
          errors.add(
            'BLOCK_VARIABLE_UNKNOWN',
            expr.at,
            'forloop exists only inside a for loop.',
          );
        } else if (
          firstName !== null &&
          !(BLOCK_FORLOOP_FIELDS as readonly string[]).includes(firstName)
        ) {
          errors.add(
            'BLOCK_PROPERTY_UNKNOWN',
            first?.at ?? expr.at,
            `forloop has no property "${firstName}".`,
          );
        }
        return;
      case 'product':
        if (target !== 'product') {
          errors.add(
            'BLOCK_OBJECT_NOT_AVAILABLE',
            expr.at,
            'product is only available to a block with target = "product".',
          );
        } else if (
          firstName !== null &&
          !(BLOCK_PRODUCT_FIELDS as readonly string[]).includes(firstName) &&
          !SPECIAL_PROPERTIES.has(firstName)
        ) {
          errors.add(
            'BLOCK_PROPERTY_UNKNOWN',
            first?.at ?? expr.at,
            `product has no property "${firstName}".`,
          );
        }
        return;
      case 'store':
        if (
          firstName !== null &&
          !(BLOCK_STORE_FIELDS as readonly string[]).includes(firstName) &&
          !SPECIAL_PROPERTIES.has(firstName)
        ) {
          errors.add(
            'BLOCK_PROPERTY_UNKNOWN',
            first?.at ?? expr.at,
            `store has no property "${firstName}".`,
          );
        }
        return;
      case 'block': {
        if (firstName === null) return;
        if (firstName !== 'settings') {
          errors.add(
            'BLOCK_PROPERTY_UNKNOWN',
            first?.at ?? expr.at,
            `block has no property "${firstName}"; read block.settings.<key>.`,
          );
          return;
        }
        const key = expr.segments[1];
        if (
          settings &&
          key?.kind === 'name' &&
          !settings.has(key.name) &&
          !SPECIAL_PROPERTIES.has(key.name)
        ) {
          errors.add(
            'BLOCK_SETTING_UNDECLARED',
            key.at,
            `The block declares no setting "${key.name}".`,
          );
        }
        return;
      }
      case 'app': {
        if (firstName === null) return;
        if (firstName !== 'data') {
          errors.add(
            'BLOCK_PROPERTY_UNKNOWN',
            first?.at ?? expr.at,
            `app has no property "${firstName}"; read app.data.<owner>.<key>.`,
          );
          return;
        }
        const owner = expr.segments[1];
        if (owner?.kind !== 'name') return;
        if (!(BLOCK_DATA_OWNERS as readonly string[]).includes(owner.name)) {
          errors.add(
            'BLOCK_DATA_OWNER_UNKNOWN',
            owner.at,
            `"${owner.name}" is not an app data owner a block may read.`,
          );
          return;
        }
        if (owner.name === 'product' && target !== 'product') {
          errors.add(
            'BLOCK_OBJECT_NOT_AVAILABLE',
            owner.at,
            'Product app data is only available to a block with target = "product".',
          );
          return;
        }
        const key = expr.segments[2];
        if (
          data &&
          key?.kind === 'name' &&
          !data.has(`${owner.name}.${key.name}`)
        ) {
          errors.add(
            'BLOCK_DATA_KEY_UNDECLARED',
            key.at,
            `The block does not list "${owner.name}.${key.name}" in its data.`,
          );
        }
        return;
      }
      default:
        errors.add(
          'BLOCK_VARIABLE_UNKNOWN',
          expr.at,
          `"${root}" is not a block object or a variable this template assigns.`,
        );
    }
  };

  const value = (expr: Expr): void => {
    if (expr.type === 'path') path(expr);
    else if (expr.type === 'range') {
      value(expr.from);
      value(expr.to);
    }
  };

  const pipeline = (p: Pipeline): void => {
    value(p.expr);
    for (const filter of p.filters) {
      for (const arg of filter.args) value(arg);
      const spec = Object.hasOwn(FILTERS, filter.name)
        ? FILTERS[filter.name]
        : undefined;
      if (!spec) {
        const fix = Object.hasOwn(FILTERS_NOT_SUPPORTED, filter.name)
          ? FILTERS_NOT_SUPPORTED[filter.name]
          : undefined;
        if (fix !== undefined) {
          errors.add(
            'BLOCK_FILTER_NOT_SUPPORTED',
            filter.at,
            `The filter "${filter.name}" is not available in storefront blocks.`,
            fix,
          );
        } else {
          errors.add(
            'BLOCK_FILTER_UNKNOWN',
            filter.at,
            `"${filter.name}" is not a filter storefront blocks know.`,
          );
        }
        continue;
      }
      const [min, max] = spec.args;
      if (filter.args.length < min || filter.args.length > max) {
        const expected =
          min === max ? String(min) : `${min.toString()} to ${max.toString()}`;
        errors.add(
          'BLOCK_FILTER_ARGUMENTS',
          filter.at,
          `The filter "${filter.name}" takes ${expected} argument${max === 1 ? '' : 's'}; it was given ${filter.args.length.toString()}.`,
        );
      }
    }
  };

  const condition = (c: Condition): void => {
    if (c.type === 'test') {
      value(c.left);
      if (c.right) value(c.right);
    } else {
      condition(c.left);
      condition(c.right);
    }
  };

  const walk = (list: readonly Node[]): void => {
    for (const node of list) {
      switch (node.type) {
        case 'output':
          pipeline(node.pipeline);
          break;
        case 'assign':
          pipeline(node.pipeline);
          break;
        case 'capture':
          walk(node.body);
          break;
        case 'if':
          for (const branch of node.branches) {
            condition(branch.condition);
            walk(branch.body);
          }
          if (node.elseBody) walk(node.elseBody);
          break;
        case 'case':
          value(node.subject);
          for (const when of node.whens) {
            for (const v of when.values) value(v);
            walk(when.body);
          }
          if (node.elseBody) walk(node.elseBody);
          break;
        case 'for': {
          value(node.collection);
          if (node.limit) value(node.limit);
          if (node.skip) value(node.skip);
          if (RESERVED.has(node.variable)) {
            errors.add(
              'BLOCK_ASSIGN_RESERVED',
              node.at,
              `"${node.variable}" is a block object and cannot be a loop variable.`,
            );
          }
          const limit = node.limit ? literalInteger(node.limit) : null;
          if (limit !== null && limit > BLOCK_LIMITS.loopIterations) {
            errors.add(
              'BLOCK_LOOP_LIMIT_TOO_HIGH',
              node.limit?.at ?? node.at,
              `limit: ${limit.toString()} is over ${BLOCK_LIMITS.loopIterations.toString()}.`,
            );
          }
          if (node.collection.type === 'range' && limit === null) {
            const from = literalInteger(node.collection.from);
            const to = literalInteger(node.collection.to);
            if (
              from !== null &&
              to !== null &&
              to - from + 1 > BLOCK_LIMITS.loopIterations
            ) {
              errors.add(
                'BLOCK_LOOP_LIMIT_TOO_HIGH',
                node.collection.at,
                `The range (${from.toString()}..${to.toString()}) has ${(to - from + 1).toString()} items; a loop runs at most ${BLOCK_LIMITS.loopIterations.toString()} times.`,
              );
            }
          }
          loopDepth++;
          if (loopDepth > BLOCK_LIMITS.loopNesting && !reportedLoopDepth) {
            reportedLoopDepth = true;
            errors.add(
              'BLOCK_LOOP_NESTING_TOO_DEEP',
              node.at,
              `for loops are nested more than ${BLOCK_LIMITS.loopNesting.toString()} deep.`,
            );
          }
          loopVariables.push(node.variable);
          walk(node.body);
          loopVariables.pop();
          loopDepth--;
          if (node.elseBody) walk(node.elseBody);
          break;
        }
        default:
          break;
      }
    }
  };

  walk(nodes);
}

/** Every `{{ … }}` of the template by its start offset (for the markup check). */
export function outputsByOffset(nodes: readonly Node[]): Map<number, Pipeline> {
  const map = new Map<number, Pipeline>();
  const walk = (list: readonly Node[]): void => {
    for (const node of list) {
      switch (node.type) {
        case 'output':
          map.set(node.at, node.pipeline);
          break;
        case 'capture':
          walk(node.body);
          break;
        case 'if':
          for (const branch of node.branches) walk(branch.body);
          if (node.elseBody) walk(node.elseBody);
          break;
        case 'case':
          for (const when of node.whens) walk(when.body);
          if (node.elseBody) walk(node.elseBody);
          break;
        case 'for':
          walk(node.body);
          if (node.elseBody) walk(node.elseBody);
          break;
        default:
          break;
      }
    }
  };
  walk(nodes);
  return map;
}
