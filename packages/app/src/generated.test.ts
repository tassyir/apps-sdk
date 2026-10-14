// The vendored OpenAPI document and the types generated from it stay in
// step: editing either by hand, or vendoring without regenerating, fails
// here. `npm run openapi:check` compares the vendored file with the backend.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');
const sha256 = (text: string) =>
  createHash('sha256').update(text, 'utf8').digest('hex');

const vendored = read('../openapi/openapi.2026-10.json');
const source = JSON.parse(read('../openapi/SOURCE.json')) as {
  repository: string;
  path: string;
  commit: string;
  sha256: string;
};
const generated = read('./generated/admin-api.2026-10.ts');

describe('the vendored OpenAPI document', () => {
  it('is the file recorded in SOURCE.json', () => {
    expect(source).toMatchObject({
      repository: 'tassyir/backend',
      path: 'docs/api/apps/openapi.2026-10.json',
    });
    expect(source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(sha256(vendored)).toBe(source.sha256);
  });

  it('is the source of the generated types', () => {
    expect(generated).toContain(`${source.repository} ${source.commit},`);
    expect(generated).toContain(`sha256 ${source.sha256}.`);
  });

  it('describes version 2026-10, and every Admin API path is in the types', () => {
    const document = JSON.parse(vendored) as {
      info: { version: string };
      paths: Record<string, unknown>;
    };
    expect(document.info.version).toBe('2026-10');
    const paths = Object.keys(document.paths).filter((path) =>
      path.startsWith('/apps/2026-10/'),
    );
    expect(paths.length).toBeGreaterThan(20);
    for (const path of paths) expect(generated).toContain(`'${path}': {`);
  });
});
