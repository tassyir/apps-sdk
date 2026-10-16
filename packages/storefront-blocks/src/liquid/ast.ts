import type { Value } from '../values.js';

/** Every offset (`at`) is into the template source. */

export type Segment =
  | { kind: 'name'; name: string; at: number }
  | { kind: 'index'; expr: Expr; at: number };

export type Expr =
  | { type: 'literal'; value: Value; at: number }
  | { type: 'special'; name: 'empty' | 'blank'; at: number }
  | { type: 'path'; root: string; segments: Segment[]; at: number }
  | { type: 'range'; from: Expr; to: Expr; at: number };

export interface FilterCall {
  name: string;
  args: Expr[];
  at: number;
}

/** A value and the filters applied to it, left to right. */
export interface Pipeline {
  expr: Expr;
  filters: FilterCall[];
  at: number;
}

export type CompareOp = '==' | '!=' | '<' | '>' | '<=' | '>=' | 'contains';

export type Condition =
  | {
      type: 'test';
      left: Expr;
      op: CompareOp | null;
      right: Expr | null;
      at: number;
    }
  | { type: 'and' | 'or'; left: Condition; right: Condition; at: number };

export interface Branch {
  condition: Condition;
  body: Node[];
}

export type Node =
  | { type: 'text'; value: string; at: number }
  | { type: 'output'; pipeline: Pipeline; at: number }
  | {
      type: 'if';
      /** `unless` negates the first condition only, as in Liquid. */
      negateFirst: boolean;
      branches: Branch[];
      elseBody: Node[] | null;
      at: number;
    }
  | {
      type: 'case';
      subject: Expr;
      whens: { values: Expr[]; body: Node[] }[];
      elseBody: Node[] | null;
      at: number;
    }
  | {
      type: 'for';
      variable: string;
      collection: Expr;
      limit: Expr | null;
      skip: Expr | null;
      reversed: boolean;
      body: Node[];
      elseBody: Node[] | null;
      at: number;
    }
  | { type: 'break' | 'continue'; at: number }
  | { type: 'assign'; name: string; pipeline: Pipeline; at: number }
  | { type: 'capture'; name: string; body: Node[]; at: number };
