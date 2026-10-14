// The pure parts of scripts/check-template.mjs, proved by template.test.mjs.

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
 * The same package.json with each @tassyir/* dependency installed from a
 * packed tarball of this repo instead of the registry (the packages may not
 * be published yet). Only the check's copy changes; the generated file keeps
 * the real versions.
 * @param {ProjectManifest} manifest
 * @param {Record<string, string>} tarballs name → absolute path of its .tgz
 * @returns {ProjectManifest}
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
  };
}
