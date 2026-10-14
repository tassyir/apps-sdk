// Writes each create-tassyir-app template's package-lock.json: every
// dependency but the @tassyir/* packages, resolved no newer than 14 days ago
// (AGENTS.md, "Dependencies"), from the public npm registry. A generated
// project then installs that exact tree, and npm adds the @tassyir/*
// packages, which the generator names and which may not be published yet.
// Run it after changing a template's package.json. Usage:
//   npm run template:lock [-- --before=YYYY-MM-DD]

import {
  copyFileSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withoutWorkspaceDependencies } from './lib/template.mjs';
import { ROOT, readJson, run } from './lib/workspace.mjs';

const NPM_REGISTRY = 'https://registry.npmjs.org/';
const DAY_MS = 24 * 60 * 60 * 1000;

const argument = process.argv.find((arg) => arg.startsWith('--before='));
const before =
  argument?.slice('--before='.length) ??
  new Date(Date.now() - 14 * DAY_MS).toISOString().slice(0, 10);

const templates = join(ROOT, 'packages', 'create-tassyir-app', 'templates');
for (const template of readdirSync(templates)) {
  const dir = join(templates, template);
  const scratch = mkdtempSync(join(tmpdir(), 'tassyir-template-lock-'));
  try {
    const manifest =
      /** @type {import('./lib/template.mjs').ProjectManifest} */ (
        readJson(join(dir, 'package.json'))
      );
    writeFileSync(
      join(scratch, 'package.json'),
      `${JSON.stringify(withoutWorkspaceDependencies(manifest), null, 2)}\n`,
    );
    run(
      'npm',
      [
        'install',
        '--package-lock-only',
        `--before=${before}`,
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        `--registry=${NPM_REGISTRY}`,
      ],
      { cwd: scratch },
    );
    copyFileSync(
      join(scratch, 'package-lock.json'),
      join(dir, 'package-lock.json'),
    );
    console.log(`✓ templates/${template}/package-lock.json (before ${before})`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
