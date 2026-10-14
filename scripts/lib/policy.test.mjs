import { describe, expect, it } from 'vitest';
import {
  PLANNED_PUBLIC_PACKAGES,
  REPOSITORY_URL,
  devDependencyProblems,
  mirrorsToGitHubPackages,
  npmrcProblems,
  publicPackageProblems,
} from './policy.mjs';

/** @returns {import('./policy.mjs').PackageJson} */
const ready = () => ({
  name: '@tassyir/app-manifest',
  version: '0.1.0',
  license: 'MIT',
  repository: {
    type: 'git',
    url: REPOSITORY_URL,
    directory: 'packages/app-manifest',
  },
  publishConfig: { access: 'public' },
  files: ['dist'],
  exports: { '.': './dist/index.js' },
  engines: { node: '>=22' },
});

describe('PLANNED_PUBLIC_PACKAGES', () => {
  it('is exactly the plan list of AP-K1.2 to AP-K1.8', () => {
    expect(PLANNED_PUBLIC_PACKAGES).toEqual({
      '@tassyir/app-manifest': 'AP-K1.2',
      '@tassyir/app': 'AP-K1.3',
      '@tassyir/app-bridge': 'AP-K1.4',
      '@tassyir/ui': 'AP-K1.5',
      tassyir: 'AP-K1.6',
      'create-tassyir-app': 'AP-K1.7',
      '@tassyir/dev-mcp': 'AP-K1.8',
    });
    expect(Object.isFrozen(PLANNED_PUBLIC_PACKAGES)).toBe(true);
  });
});

describe('mirrorsToGitHubPackages', () => {
  it('mirrors the @tassyir scope only', () => {
    expect(mirrorsToGitHubPackages('@tassyir/app-manifest')).toBe(true);
    expect(mirrorsToGitHubPackages('tassyir')).toBe(false);
    expect(mirrorsToGitHubPackages('create-tassyir-app')).toBe(false);
    expect(mirrorsToGitHubPackages('@tassyir-x/app')).toBe(false);
  });
});

describe('publicPackageProblems', () => {
  it('accepts a package ready to publish', () => {
    expect(publicPackageProblems(ready(), 'app-manifest', 'MIT')).toEqual([]);
  });

  it('ignores a private package, whatever its name', () => {
    expect(
      publicPackageProblems(
        { name: '@tassyir/pipeline-check', private: true },
        'pipeline-check',
        'MIT',
      ),
    ).toEqual([]);
  });

  it('refuses a public name outside the plan', () => {
    const problems = publicPackageProblems(
      {
        ...ready(),
        name: '@tassyir/utils',
        repository: { url: REPOSITORY_URL, directory: 'packages/utils' },
      },
      'utils',
      'MIT',
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(
      /"@tassyir\/utils" is public but not a planned/,
    );
  });

  it('refuses a repository that trusted publishing would reject', () => {
    expect(
      publicPackageProblems(
        { ...ready(), repository: 'tassyir/apps-sdk' },
        'app-manifest',
        'MIT',
      ),
    ).toEqual([expect.stringMatching(/"repository" must be/)]);
    expect(
      publicPackageProblems(ready(), 'manifest', 'MIT').join('\n'),
    ).toMatch(/"directory": "packages\/manifest"/);
  });

  it('wants public access and no registry or provenance pin', () => {
    const problems = publicPackageProblems(
      {
        ...ready(),
        publishConfig: {
          registry: 'https://npm.pkg.github.com',
          provenance: true,
        },
      },
      'app-manifest',
      'MIT',
    );
    expect(problems).toEqual([
      expect.stringMatching(/publishConfig.access/),
      expect.stringMatching(/remove "publishConfig.registry"/),
      expect.stringMatching(/remove "publishConfig.provenance"/),
    ]);
  });

  it('wants the repo license, a version, files, exports and engines', () => {
    const problems = publicPackageProblems(
      {
        name: '@tassyir/app',
        repository: { url: REPOSITORY_URL, directory: 'packages/app' },
        publishConfig: { access: 'public' },
        license: 'ISC',
      },
      'app',
      'MIT',
    );
    expect(problems).toEqual([
      expect.stringMatching(/"version"/),
      expect.stringMatching(/"license" must be "MIT"/),
      expect.stringMatching(/"files"/),
      expect.stringMatching(/"exports"/),
      expect.stringMatching(/"engines.node"/),
    ]);
  });
});

describe('devDependencyProblems', () => {
  it('accepts exact versions, prereleases included', () => {
    expect(
      devDependencyProblems(
        { devDependencies: { a: '1.2.3', b: '0.0.1-rc.1' } },
        'package.json',
      ),
    ).toEqual([]);
  });

  it.each(['^1.2.3', '~1.2.3', '>=1', '1.x', '*', 'latest', 'workspace:*'])(
    'refuses %s',
    (spec) => {
      expect(
        devDependencyProblems({ devDependencies: { a: spec } }, 'package.json'),
      ).toEqual([expect.stringMatching(/devDependency a is/)]);
    },
  );
});

describe('npmrcProblems', () => {
  it('accepts settings and comments', () => {
    expect(
      npmrcProblems(
        '# registry=x\nsave-exact=true\n; _authToken\nfund=false\n',
      ),
    ).toEqual([]);
  });

  it.each([
    'registry=https://example.com/',
    '@tassyir:registry=https://npm.pkg.github.com',
    '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}',
    '//registry.npmjs.org/:_auth=abc',
    'email=a@b.c',
  ])('refuses %s', (line) => {
    expect(npmrcProblems(`save-exact=true\n${line}\n`)).toEqual([
      expect.stringMatching(/^\.npmrc:2:/),
    ]);
  });
});
