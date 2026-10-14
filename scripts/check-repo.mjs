// Fails when the repo breaks a publishing rule (scripts/lib/policy.mjs):
// a public package outside the plan's list, a package not ready to publish,
// a dev dependency that is not pinned, or a registry or credential in .npmrc.
// Usage: npm run check:repo

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  devDependencyProblems,
  npmrcProblems,
  publicPackageProblems,
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

if (problems.length > 0) {
  console.error(problems.map((problem) => `✗ ${problem}`).join('\n'));
  process.exit(1);
}
console.log(`✓ repo rules hold (${workspaces().length} workspace packages)`);
