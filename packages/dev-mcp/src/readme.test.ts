import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupHarnesses, createHarness } from './harness.test-helpers.js';
import { TOOLS } from './index.js';

// The README is what an agent and a developer read first: its tool table and
// its sample refusal must say what the server does.

afterEach(cleanupHarnesses);

const README = await readFile(new URL('../README.md', import.meta.url), 'utf8');

describe('README.md', () => {
  it('lists every tool, in order, the seams as not available yet', () => {
    const rows = [...README.matchAll(/^\| `([a-z_]+)` +\| (.*) \|$/gm)].map(
      ([, name = '', text = '']) => [
        name,
        text.startsWith('Not available yet'),
      ],
    );
    expect(rows).toEqual(
      TOOLS.map((tool) => [
        tool.name,
        tool.description.startsWith('Not available yet'),
      ]),
    );
  });

  it('shows the refusal the server really answers without a sign-in', async () => {
    const sample = /```json\n(\{\n {2}"error"[\s\S]*?)\n```/.exec(README)?.[1];
    const harness = await createHarness({
      env: { TASSYIR_API_ORIGIN: undefined },
    });
    const error = await harness.refused('list_dev_stores');
    expect(JSON.parse(sample ?? '{}')).toEqual({ error });
  });
});
