// Fails when the repo breaks a publishing rule (scripts/lib/policy.mjs):
// a public package outside the plan's list, a package not ready to publish,
// a dev dependency that is not pinned, a registry or credential in .npmrc, or
// a pending release that new create-tassyir-app projects would not pick up.
// Usage: npm run check:repo

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  STARTER_PACKAGE,
  changesetReleases,
  devDependencyProblems,
  npmrcProblems,
  publicPackageProblems,
  starterChangesetProblems,
} from './lib/policy.mjs';
import { ROOT, readJson, workspaces } from './lib/workspace.mjs';

const root = /** @type {import('./lib/policy.mjs').PackageJson} */ (
  readJson(join(ROOT, 'package.json'))
);
const license = root.license ?? '';

const problems = [...devDependencyProblems(root, 'package.json')];
for (const { folder, manifest } of workspaces()) {
  problems.push(
    ...devDependencyProblems(manifest, `packages/${folder}/package.json`),
    ...publicPackageProblems(manifest, folder, license),
  );
}
const npmrc = join(ROOT, '.npmrc');
if (existsSync(npmrc))
  problems.push(...npmrcProblems(readFileSync(npmrc, 'utf8')));

const changesetDir = join(ROOT, '.changeset');
const changesets = readdirSync(changesetDir)
  .filter((file) => file.endsWith('.md') && file !== 'README.md')
  .map((file) => ({
    file,
    releases: changesetReleases(readFileSync(join(changesetDir, file), 'utf8')),
  }));
const starter = workspaces().find(
  ({ manifest }) => manifest.name === STARTER_PACKAGE,
);
if (starter) {
  const templates = join(starter.dir, 'templates');
  /** @type {string[]} */
  const starterDependencies = [];
  for (const template of readdirSync(templates)) {
    const path = join(templates, template, 'package.json');
    if (!existsSync(path)) continue;
    const manifest = /** @type {import('./lib/policy.mjs').PackageJson} */ (
      readJson(path)
    );
    starterDependencies.push(
      ...Object.keys({
        ...manifest.dependencies,
        ...manifest.devDependencies,
      }).filter((name) => name.startsWith('@tassyir/')),
    );
  }
  problems.push(...starterChangesetProblems(changesets, starterDependencies));
}

if (problems.length > 0) {
  console.error(problems.map((problem) => `✗ ${problem}`).join('\n'));
  process.exit(1);
}
console.log(`✓ repo rules hold (${workspaces().length} workspace packages)`);
