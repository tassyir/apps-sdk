// The repo's publishing rules, as pure functions over parsed files.
// scripts/check-repo.mjs applies them; policy.test.mjs proves them.

/** The `repository.url` every package carries. npm trusted publishing and
 * provenance compare it with the workflow's repository, and GitHub Packages
 * links the package to the repo through it. */
export const REPOSITORY_URL = 'git+https://github.com/tassyir/apps-sdk.git';

/**
 * The only names this repo may publish, with the ticket that ships each one
 * (tassyir/backend docs/APPS_PLATFORM_PLAN.md §8). A name on public npm is
 * permanent, so a new name is a decision for the plan first, then this list.
 * @type {Readonly<Record<string, string>>}
 */
export const PLANNED_PUBLIC_PACKAGES = Object.freeze({
  '@tassyir/app-manifest': 'AP-K1.2',
  '@tassyir/app': 'AP-K1.3',
  '@tassyir/app-bridge': 'AP-K1.4',
  '@tassyir/ui': 'AP-K1.5',
  tassyir: 'AP-K1.6',
  'create-tassyir-app': 'AP-K1.7',
  '@tassyir/dev-mcp': 'AP-K1.8',
  '@tassyir/storefront-blocks': 'AP-K2.2',
});

/** The scope that GitHub Packages also receives (D11). GitHub Packages only
 * takes packages scoped to the owning organisation, so the unscoped CLI and
 * starter go to npm only; no Tassyir repo installs them. */
export const GITHUB_PACKAGES_SCOPE = '@tassyir';

/** @param {string} name */
export function mirrorsToGitHubPackages(name) {
  return name.startsWith(`${GITHUB_PACKAGES_SCOPE}/`);
}

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * @typedef {{
 *   name?: string,
 *   version?: string,
 *   description?: string,
 *   private?: boolean,
 *   license?: string,
 *   repository?: string | { type?: string, url?: string, directory?: string },
 *   publishConfig?: Record<string, unknown>,
 *   files?: string[],
 *   exports?: unknown,
 *   engines?: Record<string, string>,
 *   dependencies?: Record<string, string>,
 *   devDependencies?: Record<string, string>,
 * }} PackageJson
 */

/**
 * Every dev dependency is pinned to one exact version (AGENTS.md, "Adding a
 * dependency"). Runtime dependencies of a published package may use ranges.
 * @param {PackageJson} manifest
 * @param {string} where
 * @returns {string[]}
 */
export function devDependencyProblems(manifest, where) {
  return Object.entries(manifest.devDependencies ?? {})
    .filter(([, spec]) => !EXACT_VERSION.test(spec))
    .map(
      ([name, spec]) =>
        `${where}: devDependency ${name} is "${spec}"; pin one exact version (npm install -D -E ${name}@<version>)`,
    );
}

/**
 * What a package needs before Changesets may publish it.
 * @param {PackageJson} manifest
 * @param {string} folder the folder under packages/
 * @param {string} license the root package.json license
 * @returns {string[]}
 */
export function publicPackageProblems(manifest, folder, license) {
  if (manifest.private === true) return [];
  const where = `packages/${folder}`;
  /** @type {string[]} */
  const problems = [];
  const name = manifest.name ?? '';
  if (!Object.hasOwn(PLANNED_PUBLIC_PACKAGES, name)) {
    problems.push(
      `${where}: "${name}" is public but not a planned package name (${Object.keys(PLANNED_PUBLIC_PACKAGES).join(', ')}). A name on public npm is permanent: add it to the plan first, or set "private": true`,
    );
  }
  if (!manifest.version || !EXACT_VERSION.test(manifest.version)) {
    problems.push(`${where}: "version" must be a semver version`);
  }
  if (manifest.license !== license) {
    problems.push(`${where}: "license" must be "${license}", as the repo's`);
  }
  const repository =
    typeof manifest.repository === 'object' ? manifest.repository : undefined;
  if (
    repository?.url !== REPOSITORY_URL ||
    repository.directory !== `packages/${folder}`
  ) {
    problems.push(
      `${where}: "repository" must be { "type": "git", "url": "${REPOSITORY_URL}", "directory": "packages/${folder}" } (trusted publishing and provenance check it)`,
    );
  }
  const publishConfig = manifest.publishConfig ?? {};
  if (publishConfig['access'] !== 'public') {
    problems.push(
      `${where}: "publishConfig.access" must be "public" (a scoped package is restricted otherwise)`,
    );
  }
  for (const key of ['registry', 'provenance']) {
    if (Object.hasOwn(publishConfig, key)) {
      problems.push(
        `${where}: remove "publishConfig.${key}": the same tarball goes to npm and to GitHub Packages, and the release workflow sets both registries`,
      );
    }
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    problems.push(
      `${where}: "files" must list what the tarball ships (usually ["dist"])`,
    );
  }
  if (manifest.exports === undefined) {
    problems.push(`${where}: "exports" is required`);
  }
  if (!manifest.engines?.['node']) {
    problems.push(`${where}: "engines.node" is required`);
  }
  return problems;
}

/**
 * The repo's .npmrc may hold settings, never a registry or a credential: the
 * repo is public, and every dependency comes from the public npm registry.
 * @param {string} text
 * @returns {string[]}
 */
export function npmrcProblems(text) {
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line !== '' && !/^[#;]/.test(line))
    .filter(({ line }) =>
      /(?:^|:)registry\s*=|_auth|_password|token|username|email/i.test(line),
    )
    .map(
      ({ number }) =>
        `.npmrc:${number}: no registry, credential or account setting in this public repo`,
    );
}

/** The starter: the projects it makes name the @tassyir packages' versions. */
export const STARTER_PACKAGE = 'create-tassyir-app';

/**
 * The releases a changeset file asks for: package name → bump.
 * @param {string} text the file, front matter first
 * @returns {Record<string, string>}
 */
export function changesetReleases(text) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
  /** @type {Record<string, string>} */
  const releases = {};
  for (const line of front.split(/\r?\n/)) {
    const match =
      /^\s*(['"]?)([^'":\s]+)\1\s*:\s*(major|minor|patch|none)\s*$/.exec(line);
    if (match?.[2] && match[3]) releases[match[2]] = match[3];
  }
  return releases;
}

/**
 * A project made by create-tassyir-app names `^<version>` of each @tassyir
 * package its template depends on. A minor or major release of one leaves
 * that range (under 0.x a minor does), so the starter is released with it;
 * otherwise new projects keep naming the old version.
 * @param {Array<{ file: string, releases: Record<string, string> }>} changesets
 * @param {readonly string[]} starterDependencies this repo's packages its templates depend on (isWorkspacePackageName)
 * @returns {string[]}
 */
export function starterChangesetProblems(changesets, starterDependencies) {
  const releases = changesets.flatMap(({ releases: entries }) =>
    Object.entries(entries),
  );
  if (releases.some(([name]) => name === STARTER_PACKAGE)) return [];
  const leaving = [
    ...new Set(
      releases
        .filter(
          ([name, bump]) =>
            starterDependencies.includes(name) &&
            (bump === 'minor' || bump === 'major'),
        )
        .map(([name, bump]) => `${name} (${bump})`),
    ),
  ];
  if (leaving.length === 0) return [];
  return [
    `.changeset: ${leaving.join(', ')} ${leaving.length === 1 ? 'leaves' : 'leave'} the version range that ${STARTER_PACKAGE} writes into new projects, and ${STARTER_PACKAGE} has no changeset. Add one (npx changeset, ${STARTER_PACKAGE}, patch) so new projects name the new version`,
  ];
}
