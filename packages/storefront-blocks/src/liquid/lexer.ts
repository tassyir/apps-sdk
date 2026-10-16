import type { ErrorList } from '../errors.js';
import { trimAsciiEnd, trimAsciiStart } from '../values.js';

/**
 * The first pass over a template: text, `{{ output }}` and `{% tag %}`, with
 * Liquid's whitespace control (`{{-`, `-}}`, `{%-`, `-%}`) already applied to
 * the text around them. Offsets are into the template, so every later error
 * can name a line and a column.
 */
export type LiquidToken =
  | { kind: 'text'; value: string; start: number; end: number }
  | {
      kind: 'output';
      markup: string;
      markupStart: number;
      start: number;
      end: number;
    }
  | {
      kind: 'tag';
      name: string;
      markup: string;
      nameStart: number;
      markupStart: number;
      start: number;
      end: number;
    };

/** A `{% comment %}` or `{% raw %}` body: skipped whole, nested ones counted. */
const OPAQUE_BLOCKS: Readonly<Record<string, string>> = {
  comment: 'endcomment',
  raw: 'endraw',
};

const SPACE = /[ \t\n\r]/;
const TAG_NAME = /^(#|[A-Za-z_][A-Za-z0-9_]*)/;

/**
 * Where the delimiter `close` starts, skipping a quoted string that closes on
 * the same line (so `{{ "}}" }}` works); -1 if never. A quote that does not
 * close on its line is left to the expression parser to report, and does not
 * hide the delimiter.
 */
function findClose(source: string, from: number, close: string): number {
  for (let i = from; i < source.length; i++) {
    const c = source[i];
    if (c === '"' || c === "'") {
      // Only to the end of the line, so the search stays linear.
      let end = i + 1;
      while (
        end < source.length &&
        source[end] !== c &&
        source[end] !== '\n' &&
        source[end] !== '\r'
      )
        end++;
      if (source[end] === c) {
        i = end;
        continue;
      }
    }
    if (source.startsWith(close, i)) return i;
  }
  return -1;
}

/** One `{{ … }}` or `{% … %}` read at `start`. */
interface Delimited {
  inner: string;
  innerStart: number;
  end: number;
  trimBefore: boolean;
  trimAfter: boolean;
}

function readDelimited(
  source: string,
  start: number,
  close: string,
): Delimited | undefined {
  let innerStart = start + 2;
  const trimBefore = source[innerStart] === '-';
  if (trimBefore) innerStart++;
  const closeAt = findClose(source, innerStart, close);
  if (closeAt === -1) return undefined;
  let innerEnd = closeAt;
  const trimAfter = closeAt > innerStart && source[closeAt - 1] === '-';
  if (trimAfter) innerEnd--;
  return {
    inner: source.slice(innerStart, innerEnd),
    innerStart,
    end: closeAt + 2,
    trimBefore,
    trimAfter,
  };
}

function tagNameOf(d: Delimited): {
  name: string;
  nameStart: number;
  markup: string;
  markupStart: number;
} {
  let i = 0;
  while (i < d.inner.length && SPACE.test(d.inner[i] ?? '')) i++;
  const match = TAG_NAME.exec(d.inner.slice(i));
  const name = match?.[1] ?? '';
  const nameStart = d.innerStart + i;
  let j = i + name.length;
  while (j < d.inner.length && SPACE.test(d.inner[j] ?? '')) j++;
  return {
    name,
    nameStart,
    markup: d.inner.slice(j).trimEnd(),
    markupStart: d.innerStart + j,
  };
}

/**
 * Splits a template into tokens. Reports unterminated delimiters and the
 * opaque blocks it skips; never throws.
 */
export function lexTemplate(source: string, errors: ErrorList): LiquidToken[] {
  const tokens: LiquidToken[] = [];
  let trimNext = false;
  let i = 0;

  const pushText = (from: number, to: number): void => {
    let value = source.slice(from, to);
    if (trimNext) value = trimAsciiStart(value);
    trimNext = false;
    if (value !== '')
      tokens.push({ kind: 'text', value, start: from, end: to });
  };
  const trimPrevious = (): void => {
    const last = tokens[tokens.length - 1];
    if (last?.kind === 'text') {
      last.value = trimAsciiEnd(last.value);
      if (last.value === '') tokens.pop();
    }
  };

  // The next `{{` and `{%`, found again only once passed: a template full of
  // one kind does not rescan for the other at every token.
  let output = -2;
  let tag = -2;
  while (i < source.length) {
    if (output !== -1 && output < i) output = source.indexOf('{{', i);
    if (tag !== -1 && tag < i) tag = source.indexOf('{%', i);
    const next =
      output === -1 ? tag : tag === -1 ? output : Math.min(output, tag);
    if (next === -1) {
      pushText(i, source.length);
      break;
    }
    pushText(i, next);
    const isOutput = next === output;
    const d = readDelimited(source, next, isOutput ? '}}' : '%}');
    if (!d) {
      errors.add(
        'BLOCK_LIQUID_UNTERMINATED',
        next,
        `${isOutput ? '{{' : '{%'} is never closed with ${isOutput ? '}}' : '%}'}.`,
      );
      // The rest cannot be read as Liquid; keep it as text so the HTML
      // check still sees it.
      pushText(next, source.length);
      break;
    }
    if (d.trimBefore) trimPrevious();

    if (isOutput) {
      tokens.push({
        kind: 'output',
        markup: d.inner.trim(),
        markupStart:
          d.innerStart + (d.inner.length - d.inner.trimStart().length),
        start: next,
        end: d.end,
      });
      trimNext = d.trimAfter;
      i = d.end;
      continue;
    }

    const head = tagNameOf(d);
    const closer = OPAQUE_BLOCKS[head.name];
    if (closer === undefined) {
      tokens.push({ kind: 'tag', ...head, start: next, end: d.end });
      trimNext = d.trimAfter;
      i = d.end;
      continue;
    }

    // An opaque block: find its matching end, counting nested ones.
    let depth = 1;
    let j = d.end;
    let after: Delimited | undefined;
    while (depth > 0) {
      const at = source.indexOf('{%', j);
      if (at === -1) break;
      const inner = readDelimited(source, at, '%}');
      if (!inner) break;
      const innerName = tagNameOf(inner).name;
      if (innerName === head.name) depth++;
      else if (innerName === closer) depth--;
      j = inner.end;
      if (depth === 0) after = inner;
    }
    if (!after) {
      errors.add(
        'BLOCK_TAG_UNCLOSED',
        next,
        `{% ${head.name} %} is never closed with {% ${closer} %}.`,
      );
      break;
    }
    if (head.name === 'raw') {
      tokens.push({ kind: 'tag', ...head, start: next, end: after.end });
    }
    if (after.trimBefore) trimPrevious();
    trimNext = after.trimAfter;
    i = after.end;
  }
  return tokens;
}
