// Reads a source map (v3) just enough to say where a line of the bundle came
// from: `src/worker.ts:12` rather than `worker.js:4180`. The map stays on this
// machine: a bundle never carries one (the API refuses source maps).

export interface SourcePosition {
  /** The source's path as the map names it (relative to the bundle). */
  source: string;
  /** 1-based. */
  line: number;
  /** 0-based. */
  column: number;
}

const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DIGITS = new Map(
  Array.from({ length: BASE64.length }, (_, index) => [
    BASE64.charAt(index),
    index,
  ]),
);

/** One segment's base64 VLQ fields, or null when malformed. */
function decodeSegment(text: string): number[] | null {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const character of text) {
    const digit = DIGITS.get(character);
    if (digit === undefined) return null;
    value += (digit & 31) * 2 ** shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    values.push(value % 2 === 1 ? -Math.floor(value / 2) : value / 2);
    value = 0;
    shift = 0;
  }
  return shift === 0 ? values : null;
}

/** [generated column, source index, source line, source column], per generated line. */
type Segment = readonly [number, number, number, number];

function decodeMappings(mappings: string): Segment[][] {
  const lines: Segment[][] = [];
  let source = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  for (const text of mappings.split(';')) {
    const segments: Segment[] = [];
    let column = 0;
    for (const part of text.split(',')) {
      if (part === '') continue;
      const fields = decodeSegment(part);
      if (!fields || fields.length === 0) continue;
      column += fields[0] ?? 0;
      if (fields.length < 4) continue;
      source += fields[1] ?? 0;
      sourceLine += fields[2] ?? 0;
      sourceColumn += fields[3] ?? 0;
      segments.push([column, source, sourceLine, sourceColumn]);
    }
    lines.push(segments);
  }
  return lines;
}

/**
 * A lookup from a position in the generated file (line 1-based, column
 * 0-based) to its source, or null when the map says nothing about it.
 */
export function sourceLocator(
  mapText: string,
): (line: number, column: number) => SourcePosition | null {
  let sources: string[] = [];
  let lines: Segment[][] = [];
  try {
    const map = JSON.parse(mapText) as {
      sources?: unknown;
      mappings?: unknown;
    };
    if (Array.isArray(map.sources) && typeof map.mappings === 'string') {
      sources = map.sources.map((source) =>
        typeof source === 'string' ? source : '',
      );
      lines = decodeMappings(map.mappings);
    }
  } catch {
    // An unreadable map locates nothing.
  }
  return (line, column) => {
    const segments = lines[line - 1];
    if (!segments || segments.length === 0) return null;
    let found = segments[0];
    for (const segment of segments) {
      if (segment[0] > column) break;
      found = segment;
    }
    const source = found ? sources[found[1]] : undefined;
    if (!found || !source) return null;
    return { source, line: found[2] + 1, column: found[3] };
  };
}
