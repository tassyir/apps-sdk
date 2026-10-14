import { describe, expect, it } from 'vitest';
import {
  generatedDependencyProblems,
  withTarballs,
  withoutWorkspaceDependencies,
} from './template.mjs';

const VERSIONS = { '@tassyir/app': '0.1.0', '@tassyir/app-bridge': '0.1.2' };

describe('generatedDependencyProblems', () => {
  it("accepts this repo's versions and exact pins", () => {
    expect(
      generatedDependencyProblems(
        {
          dependencies: { '@tassyir/app': '^0.1.0', hono: '4.13.11' },
          devDependencies: { '@tassyir/app-bridge': '^0.1.2' },
        },
        VERSIONS,
      ),
    ).toEqual([]);
  });

  it('names a stale @tassyir version and a range', () => {
    expect(
      generatedDependencyProblems(
        {
          dependencies: { '@tassyir/app': '^0.0.0', hono: '^4.13.11' },
          devDependencies: { '@tassyir/app-bridge': '*' },
        },
        VERSIONS,
      ),
    ).toEqual([
      '@tassyir/app is "^0.0.0", not "^0.1.0" (this repo\'s version)',
      'hono is "^4.13.11": pin one exact version',
      '@tassyir/app-bridge is "*", not "^0.1.2" (this repo\'s version)',
    ]);
  });
});

describe('withTarballs', () => {
  it('installs the @tassyir/* packages from tarballs and leaves the rest', () => {
    const manifest = {
      name: 'my-app',
      dependencies: { '@tassyir/app': '^0.1.0', hono: '4.13.11' },
      devDependencies: { '@tassyir/app-bridge': '^0.1.2' },
    };
    expect(
      withTarballs(manifest, {
        '@tassyir/app': '/packs/tassyir-app-0.1.0.tgz',
        '@tassyir/app-bridge': '/packs/tassyir-app-bridge-0.1.2.tgz',
      }),
    ).toEqual({
      name: 'my-app',
      dependencies: {
        '@tassyir/app': 'file:/packs/tassyir-app-0.1.0.tgz',
        hono: '4.13.11',
      },
      devDependencies: {
        '@tassyir/app-bridge': 'file:/packs/tassyir-app-bridge-0.1.2.tgz',
      },
    });
    expect(manifest.dependencies['@tassyir/app']).toBe('^0.1.0');
  });
});

describe('withoutWorkspaceDependencies', () => {
  it('drops the @tassyir/* packages, which the lockfile leaves to npm', () => {
    expect(
      withoutWorkspaceDependencies({
        name: 'my-app',
        dependencies: { '@tassyir/app': '*', hono: '4.13.11' },
        devDependencies: { '@tassyir/app-bridge': '*', vitest: '4.1.11' },
      }),
    ).toEqual({
      name: 'my-app',
      dependencies: { hono: '4.13.11' },
      devDependencies: { vitest: '4.1.11' },
    });
  });
});
