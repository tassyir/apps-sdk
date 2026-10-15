import { describe, expect, it } from 'vitest';
import { sourceLocator } from './source-map.js';

describe('sourceLocator', () => {
  // Line 1: col 0 → a.ts 1:0, col 6 → a.ts 1:4. Line 2: col 2 → b.ts 10:0.
  // Line 3: nothing.
  const locate = sourceLocator(
    JSON.stringify({
      version: 3,
      sources: ['src/a.ts', 'src/b.ts'],
      mappings: 'AAAA,MAAI;ECSJ;',
    }),
  );

  it('finds the source of a generated position', () => {
    expect(locate(1, 0)).toEqual({ source: 'src/a.ts', line: 1, column: 0 });
    expect(locate(1, 9)).toEqual({ source: 'src/a.ts', line: 1, column: 4 });
    expect(locate(2, 5)).toEqual({ source: 'src/b.ts', line: 10, column: 0 });
  });

  it('takes the line’s first mapping for a column before it', () => {
    expect(locate(2, 0)).toEqual({ source: 'src/b.ts', line: 10, column: 0 });
  });

  it('says nothing about a line the map does not cover', () => {
    expect(locate(3, 0)).toBeNull();
    expect(locate(40, 0)).toBeNull();
  });

  it('locates nothing from a map it cannot read', () => {
    expect(sourceLocator('not json')(1, 0)).toBeNull();
    expect(sourceLocator('{"sources":[],"mappings":"!!"}')(1, 0)).toBeNull();
  });
});
