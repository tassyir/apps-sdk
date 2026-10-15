import { describe, expect, it } from 'vitest';
import {
  generatedDependencyProblems,
  isWorkspacePackageName,
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
  it("installs this repo's packages from tarballs, transitive ones too, and leaves the rest", () => {
    const manifest = {
      name: 'my-app',
      dependencies: { '@tassyir/app': '^0.1.0', hono: '4.13.11' },
      devDependencies: { '@tassyir/app-bridge': '^0.1.2' },
    };
    expect(
      withTarballs(manifest, {
        '@tassyir/app': '/packs/tassyir-app-0.1.0.tgz',
        '@tassyir/app-bridge': '/packs/tassyir-app-bridge-0.1.2.tgz',
        'create-tassyir-app': '/packs/create-tassyir-app-0.1.1.tgz',
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
      overrides: {
        '@tassyir/app': 'file:/packs/tassyir-app-0.1.0.tgz',
        '@tassyir/app-bridge': 'file:/packs/tassyir-app-bridge-0.1.2.tgz',
        'create-tassyir-app': 'file:/packs/create-tassyir-app-0.1.1.tgz',
      },
    });
    expect(manifest.dependencies['@tassyir/app']).toBe('^0.1.0');
  });
});

describe('withoutWorkspaceDependencies', () => {
  it("drops this repo's packages, which the lockfile leaves to npm", () => {
    expect(
      withoutWorkspaceDependencies({
        name: 'my-app',
        dependencies: { '@tassyir/app': '*', hono: '4.13.11' },
        devDependencies: {
          '@tassyir/app-bridge': '*',
          tassyir: '*',
          vitest: '4.1.11',
        },
      }),
    ).toEqual({
      name: 'my-app',
      dependencies: { hono: '4.13.11' },
      devDependencies: { vitest: '4.1.11' },
    });
  });
});

describe('isWorkspacePackageName', () => {
  it("names this repo's packages only", () => {
    for (const name of [
      '@tassyir/app',
      '@tassyir/ui',
      'tassyir',
      'create-tassyir-app',
    ]) {
      expect(isWorkspacePackageName(name), name).toBe(true);
    }
    for (const name of ['hono', 'tassyir-tools', '@tassyirx/app', 'react']) {
      expect(isWorkspacePackageName(name), name).toBe(false);
    }
  });
});
