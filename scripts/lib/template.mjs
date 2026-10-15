// The pure parts of scripts/check-template.mjs, proved by template.test.mjs.

/**
 * A package this repo publishes that a template may name: the @tassyir/*
 * packages, the `tassyir` CLI (the hosted template's `npm run deploy`) and
 * create-tassyir-app (which `tassyir` depends on). A generated project names
 * them at this repo's version; the template's lockfile leaves them to npm.
 * @param {string} name
 * @returns {boolean}
 */
export function isWorkspacePackageName(name) {
  return (
    name.startsWith('@tassyir/') ||
    name === 'tassyir' ||
    name === 'create-tassyir-app'
  );
}

/**
 * @typedef {{
 *   name?: string,
 *   dependencies?: Record<string, string>,
 *   devDependencies?: Record<string, string>,
 * }} ProjectManifest
 */

/**
 * The generated package.json must name each @tassyir/* package at the
 * version this repo releases (`^<workspace version>`), and pin every other
 * dependency to one exact version.
 * @param {ProjectManifest} manifest the generated project's package.json
 * @param {Record<string, string>} workspaceVersions name → version in this repo
 * @returns {string[]}
 */
export function generatedDependencyProblems(manifest, workspaceVersions) {
  /** @type {string[]} */
  const problems = [];
  const all = { ...manifest.dependencies, ...manifest.devDependencies };
  for (const [name, spec] of Object.entries(all)) {
    const workspace = workspaceVersions[name];
    if (workspace !== undefined) {
      if (spec !== `^${workspace}`) {
        problems.push(
          `${name} is "${spec}", not "^${workspace}" (this repo's version)`,
        );
      }
    } else if (!/^\d+\.\d+\.\d+$/.test(spec)) {
      problems.push(`${name} is "${spec}": pin one exact version`);
    }
  }
  return problems;
}

/**
 * The same package.json with each of this repo's packages installed from a
 * packed tarball instead of the registry (they may not be published yet):
 * the direct dependencies, and through `overrides` every one a dependency
 * pulls in (`tassyir` depends on create-tassyir-app). Only the check's copy
 * changes; the generated file keeps the real versions.
 * @param {ProjectManifest} manifest
 * @param {Record<string, string>} tarballs name → absolute path of its .tgz
 * @returns {ProjectManifest & { overrides: Record<string, string> }}
 */
export function withTarballs(manifest, tarballs) {
  /** @param {Record<string, string> | undefined} group */
  const swap = (group) =>
    group &&
    Object.fromEntries(
      Object.entries(group).map(([name, spec]) => [
        name,
        tarballs[name] === undefined ? spec : `file:${tarballs[name]}`,
      ]),
    );
  return {
    ...manifest,
    dependencies: swap(manifest.dependencies),
    devDependencies: swap(manifest.devDependencies),
    overrides: Object.fromEntries(
      Object.entries(tarballs).map(([name, path]) => [name, `file:${path}`]),
    ),
  };
}

/**
 * The template's package.json without this repo's packages
 * (`isWorkspacePackageName`): what its package-lock.json locks
 * (scripts/template-lock.mjs).
 * @param {ProjectManifest} manifest
 * @returns {ProjectManifest}
 */
export function withoutWorkspaceDependencies(manifest) {
  /** @param {Record<string, string> | undefined} group */
  const keep = (group) =>
    group &&
    Object.fromEntries(
      Object.entries(group).filter(([name]) => !isWorkspacePackageName(name)),
    );
  return {
    ...manifest,
    dependencies: keep(manifest.dependencies),
    devDependencies: keep(manifest.devDependencies),
  };
}
