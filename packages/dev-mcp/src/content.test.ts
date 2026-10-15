import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compactTables,
  defaultContentPaths,
  loadContent,
  paginate,
  parseGuide,
} from './content.js';
import { ToolError } from './errors.js';
import { CONTENT, REPO } from './harness.test-helpers.js';
import { errorResult, MAX_RESULT_BYTES, successResult } from './tool.js';

describe('content', () => {
  it('reads the repo itself when it runs from a checkout', () => {
    expect(defaultContentPaths()).toEqual(CONTENT);
  });

  it('loads every guide but README.md, by order, and the API reference', async () => {
    const content = await loadContent(CONTENT);
    expect(content.guides.map((guide) => guide.slug)).not.toContain('README');
    const orders = content.guides.map((guide) => guide.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(content.api.version).toBe('2026-10');
    expect(content.api.operations.length).toBeGreaterThan(40);
  });

  it('answers CONTENT_UNAVAILABLE when the files are missing', async () => {
    const missing = loadContent({
      guides: join(REPO, 'no-such-folder'),
      openapi: CONTENT.openapi,
    });
    await expect(missing).rejects.toMatchObject({
      code: 'CONTENT_UNAVAILABLE',
    });
  });
});

describe('parseGuide', () => {
  const source = [
    '---',
    'title: Webhooks',
    'description: "Signed: every delivery."',
    'order: 70',
    '---',
    '',
    '# Webhooks',
    '',
    'Intro text.',
    '',
    '## Topics',
    'Table.',
    '### `orders/created`',
    'Created.',
    '```toml',
    '# not a heading',
    '## nor this',
    '```',
    '## Topics',
    'Again.',
    '#1042 is an order number, not a heading.',
  ].join('\n');

  it('reads the front matter, the intro and the sections with GitHub anchors', () => {
    const guide = parseGuide('webhooks', source);
    expect(guide).toMatchObject({
      slug: 'webhooks',
      title: 'Webhooks',
      description: 'Signed: every delivery.',
      order: 70,
      intro: 'Intro text.',
    });
    expect(
      guide.sections.map((section) => [section.anchor, section.level]),
    ).toEqual([
      ['webhooks', 1],
      ['topics', 2],
      ['orderscreated', 3],
      ['topics-1', 2],
    ]);
    const [, topics, created, again] = guide.sections;
    expect(topics?.text).toBe(
      '## Topics\nTable.\n### `orders/created`\nCreated.\n```toml\n# not a heading\n## nor this\n```',
    );
    expect(topics?.own).toBe('Table.');
    expect(created?.own).toContain('# not a heading');
    expect(again?.own).toBe('Again.\n#1042 is an order number, not a heading.');
  });
});

describe('paginate', () => {
  const block = (index: number) =>
    `Paragraph ${String(index)} ${'word '.repeat(30).trim()}.`;

  it('cuts between blocks, keeps every character, and never exceeds the size', () => {
    const text = Array.from({ length: 40 }, (_, index) => block(index)).join(
      '\n\n',
    );
    const pages = paginate(text, 1_000);
    expect(pages.length).toBeGreaterThan(5);
    for (const page of pages) {
      expect(page.length).toBeLessThanOrEqual(1_000);
      expect(page).toMatch(/^Paragraph \d+/);
      expect(page).toMatch(/\.$/);
    }
    expect(pages.join('\n\n')).toBe(text);
  });

  it('keeps a code sample whole when it fits a page', () => {
    const fence = [
      '```ts',
      ...Array.from(
        { length: 20 },
        (_, index) => `const a${String(index)} = ${String(index)};`,
      ),
      '```',
    ].join('\n');
    const text = [block(1), block(2), fence, block(3)].join('\n\n');
    const pages = paginate(text, fence.length + 10);
    expect(pages.some((page) => page === fence)).toBe(true);
  });

  it('splits a block longer than a page between lines, and a line longer than a page anywhere', () => {
    const long = Array.from(
      { length: 50 },
      (_, index) => `line ${String(index)}`,
    ).join('\n');
    for (const page of paginate(long, 100))
      expect(page.length).toBeLessThanOrEqual(100);
    expect(paginate('x'.repeat(250), 100)).toEqual([
      'x'.repeat(100),
      'x'.repeat(100),
      'x'.repeat(50),
    ]);
    expect(paginate('', 100)).toEqual(['']);
  });
});

describe('compactTables', () => {
  it('drops the padding of table rows only', () => {
    expect(
      compactTables(
        [
          '| A      | B   |',
          '| ------ | --- |',
          '| x      | y   |',
          'Text   with  spaces',
          '```',
          '| code   |',
          '```',
        ].join('\n'),
      ),
    ).toBe(
      [
        '| A | B |',
        '| --- | --- |',
        '| x | y |',
        'Text   with  spaces',
        '```',
        '| code   |',
        '```',
      ].join('\n'),
    );
  });
});

describe('answers', () => {
  it('turns an answer over the limit into RESULT_TOO_LARGE', () => {
    const result = successResult({ text: 'x'.repeat(MAX_RESULT_BYTES) }, false);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code: 'RESULT_TOO_LARGE' },
    });
  });

  it('keeps an oversized refusal to its code, message, fix and first problems', () => {
    const problems = Array.from({ length: 200 }, (_, index) => ({
      code: 'MANIFEST_FIELD_UNKNOWN',
      path: `x${String(index)}`,
      message: 'm'.repeat(80),
      fix: 'f'.repeat(80),
    }));
    const result = errorResult(
      new ToolError({ code: 'X', message: 'many', fix: 'fix them', problems }),
      false,
    );
    const text = (result.content[0] as { text: string }).text;
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(
      MAX_RESULT_BYTES,
    );
    expect(result.structuredContent).toMatchObject({
      error: { code: 'X', problemCount: 200 },
    });
  });

  it('never shows the text of an unexpected failure', () => {
    const result = errorResult(
      new Error('ECONNRESET at /Users/amina/secret/path'),
      false,
    );
    expect(JSON.stringify(result)).not.toContain('/Users/amina');
    expect(result.structuredContent).toMatchObject({
      error: { code: 'INTERNAL_ERROR' },
    });
  });
});
