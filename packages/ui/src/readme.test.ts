import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ELEMENTS } from './index.js';
import { COLOR_TOKENS } from './tokens.js';

const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

/** The `### …` section that names the element, up to the next heading of level 2 or 3. */
function section(tag: string): string {
  const parts = README.split(/^(?=##+ )/m);
  const found = parts.find(
    (part) =>
      part.startsWith('### ') && part.split('\n')[0]?.includes(`\`<${tag}>\``),
  );
  if (!found) throw new Error(`README has no section for <${tag}>`);
  return found;
}

/** Every attribute named in the first column of the section's tables. */
function documented(text: string): Set<string> {
  const names = new Set<string>();
  for (const line of text.split('\n')) {
    if (!line.startsWith('| ') || /^\| -/.test(line)) continue;
    const first = line.slice(2).split(' | ')[0] ?? '';
    for (const match of first.matchAll(/`([a-z-]+)`/g)) {
      if (match[1]) names.add(match[1]);
    }
  }
  return names;
}

describe('README', () => {
  it('documents every element, and every attribute each one reads', () => {
    for (const [tag, element] of Object.entries(ELEMENTS)) {
      const names = documented(section(tag));
      const observed = (
        element as unknown as { observedAttributes: string[] }
      ).observedAttributes.filter((name) => !name.startsWith('aria-'));
      for (const name of observed) {
        expect(names.has(name), `<${tag}> ${name}`).toBe(true);
      }
    }
  });

  it('lists every colour token', () => {
    const tokens =
      /- Colours, both themes: ([\s\S]*?);/.exec(README)?.[1] ?? '';
    const listed = [...tokens.matchAll(/`(?:--tsy-color)?-([a-z-]+)`/g)].map(
      (match) => match[1],
    );
    expect(listed.sort()).toEqual([...COLOR_TOKENS].sort());
  });
});
