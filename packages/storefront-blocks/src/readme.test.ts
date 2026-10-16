import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as published from './index.js';
import {
  BLOCK_ERROR_CODES,
  renderBlock,
  sampleBlockContext,
  validateBlock,
} from './index.js';

/**
 * The README is what an agent reads in node_modules: its example's output,
 * its error-code table and its API table must match the code.
 */

const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

function section(title: string): string {
  const start = README.indexOf(`\n## ${title}\n`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = README.indexOf('\n## ', start + 1);
  return README.slice(start, end === -1 ? undefined : end);
}

function fenced(text: string, language: string): string[] {
  return [
    ...text.matchAll(new RegExp(`\`\`\`${language}\\n([\\s\\S]*?)\`\`\``, 'g')),
  ].map(([, body]) => body ?? '');
}

describe('README.md', () => {
  it('shows what its example really renders', () => {
    const example = section('Example');
    const code = fenced(example, 'ts')[0] ?? '';
    const template = /const template = `([\s\S]*?)`;/.exec(code)?.[1] ?? '';
    const stylesheet = /const stylesheet = `([\s\S]*?)`;/.exec(code)?.[1] ?? '';
    const declaration = {
      target: 'product' as const,
      settings: [
        {
          key: 'title',
          type: 'text',
          default: { ar: 'آراء الزبائن', en: 'Reviews' },
        },
        { key: 'accent_color', type: 'color', default: '#0b6e4f' },
      ],
      data: ['product.rating'],
    };
    expect(code).toContain("data: ['product.rating']");
    expect(validateBlock({ template, stylesheet, declaration })).toEqual({
      ok: true,
    });
    const result = renderBlock(
      template,
      sampleBlockContext(declaration, {
        language: 'en',
        appData: { product: { rating: { average: 4.4, count: 128 } } },
      }),
      declaration,
    );
    expect(code).toContain('average: 4.4, count: 128');
    expect(result.ok && `${result.html}\n`).toBe(fenced(example, 'text')[0]);
  });

  it('lists exactly the error codes, in order', () => {
    const documented = [
      ...section('What you get back').matchAll(/^\| `(BLOCK_[A-Z_]+)` +\|/gm),
    ].map(([, code]) => code);
    expect(documented).toEqual([...BLOCK_ERROR_CODES]);
  });

  it('names only real exports in its API section', () => {
    const api = section('API');
    const named = [
      ...api.matchAll(/^\| `([A-Za-z_]+)[(`]/gm),
      ...api.matchAll(/`([A-Z][A-Z_]+)`/g),
    ].map(([, name]) => name ?? '');
    expect(named.length).toBeGreaterThan(25);
    expect(named.filter((name) => !(name in published))).toEqual([]);
  });

  it('gives the limits BLOCK_LIMITS holds', () => {
    const L = published.BLOCK_LIMITS;
    const rows: [string, string][] = [
      ['Template', `${String(L.templateBytes / 1024)} KB`],
      ['Stylesheet', `${String(L.stylesheetBytes / 1024)} KB`],
      ['Rendered HTML', `${String(L.outputBytes / 1024)} KB`],
      ['App data one render reads', `${String(L.dataBytes / 1024)} KB`],
      ['Render work', `${L.steps.toLocaleString('en')} steps`],
      ['Iterations of one `for` loop', String(L.loopIterations)],
      ['`for` loops inside one another', String(L.loopNesting)],
      ['Liquid blocks inside one another', String(L.tagNesting)],
      ['HTML elements inside one another', String(L.htmlNesting)],
      ['Filters in one expression', String(L.filtersPerExpression)],
      ['Variables', String(L.variables)],
      ['Items in a list a template builds', String(L.arrayItems)],
      [
        'Characters in a string a template builds',
        L.stringLength.toLocaleString('en'),
      ],
    ];
    const limits = section('Limits');
    for (const [label, value] of rows) {
      expect(limits).toMatch(
        new RegExp(`\\| ${label.replace(/[`()]/g, '\\$&')} +\\| ${value} +\\|`),
      );
    }
  });
});
