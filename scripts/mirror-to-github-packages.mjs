// Mirrors every public @tassyir/* package of this repo, at its current
// version, from npm to GitHub Packages (D11: the backend's .npmrc sends every
// @tassyir/* install to npm.pkg.github.com). It publishes the tarball npm
// serves, byte for byte, and checks that GitHub Packages then reports the
// same integrity. Safe to rerun: a version GitHub Packages already has is
// skipped, so the next run of the release workflow repairs a failed mirror.
//
// It runs seconds after the npm publish, when npm's CDN may still serve the
// old packument. So a version the workspace names that npm does not serve yet
// is checked again, with backoff, for up to NPM_WAIT_MS (10 minutes); then the
// run fails with NOT_ON_NPM. It never passes over a version in silence.
//
// Usage (the release workflow's last job):
//   NODE_AUTH_TOKEN=<token with packages:write> node scripts/mirror-to-github-packages.mjs
// Dry runs, which publish nothing (and check npm once, without waiting):
//   node scripts/mirror-to-github-packages.mjs --dry-run
//   node scripts/mirror-to-github-packages.mjs --dry-run --from-workspace --include-private
//     --from-workspace   pack the workspace instead of downloading from npm
//     --include-private  include private packages (the pipeline placeholder)

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { mirrorsToGitHubPackages } from './lib/policy.mjs';
import {
  GITHUB_REGISTRY,
  NPM_REGISTRY,
  NPM_WAIT_MS,
  formatProblem,
  mirrorDistTag,
  notOnNpmProblem,
  packNotServed,
  pollUntil,
  readViewResult,
} from './lib/registry.mjs';
import { ROOT, packedTarball, run, workspaces } from './lib/workspace.mjs';

const FLAGS = ['--dry-run', '--from-workspace', '--include-private'];
const flags = process.argv.slice(2);
const unknown = flags.filter((flag) => !FLAGS.includes(flag));
if (unknown.length > 0) {
  console.error(
    `Unknown option(s): ${unknown.join(' ')}. Known: ${FLAGS.join(' ')}`,
  );
  process.exit(2);
}
const dryRun = flags.includes('--dry-run');
const fromWorkspace = flags.includes('--from-workspace');
const includePrivate = flags.includes('--include-private');
if ((fromWorkspace || includePrivate) && !dryRun) {
  console.error('--from-workspace and --include-private need --dry-run.');
  process.exit(2);
}
const token = process.env['NODE_AUTH_TOKEN'];
if (!token && !dryRun) {
  console.error(
    'NODE_AUTH_TOKEN must hold a GitHub token with packages:write.',
  );
  process.exit(2);
}

const candidates = workspaces().filter(
  ({ manifest }) =>
    mirrorsToGitHubPackages(manifest.name ?? '') &&
    (manifest.private !== true || includePrivate),
);
if (candidates.length === 0) {
  console.log('Nothing to mirror: no public @tassyir/* package in packages/.');
  process.exit(0);
}

// One budget for the whole run: packages published together appear together.
const started = Date.now();
const npmDeadline = started + (dryRun ? 0 : NPM_WAIT_MS);

const scratch = mkdtempSync(join(tmpdir(), 'tassyir-sdk-mirror-'));
// npm reads the token from the environment when it runs; it is never written.
const userconfig = join(scratch, 'npmrc');
writeFileSync(
  userconfig,
  token ? '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n' : '',
);

/**
 * npm against one registry, whatever ~/.npmrc or setup-node configured, and
 * never from npm's local cache, which may hold a packument for 5 minutes.
 * @param {string[]} args
 * @param {string} registry
 */
function npm(args, registry) {
  return run(
    'npm',
    [
      ...args,
      `--registry=${registry}`,
      `--@tassyir:registry=${registry}`,
      `--userconfig=${userconfig}`,
      '--prefer-online',
    ],
    { cwd: scratch, allowFailure: true },
  );
}

/**
 * @param {ReturnType<typeof run>} result
 * @param {string} what
 */
function ok(result, what) {
  if (result.status !== 0) {
    throw new Error(`${what} failed:\n${result.stdout}${result.stderr}`);
  }
  return result;
}

/**
 * The tarball npm serves for `spec`, checked against the integrity npm
 * reports, and npm's dist-tags; undefined while npm does not serve `spec`.
 * @param {string} spec
 * @returns {{ packed: import('./lib/workspace.mjs').Packed, distTags: Record<string, string> | undefined } | undefined}
 */
function fromNpm(spec) {
  const onNpm = readViewResult(
    npm(['view', spec, 'dist.integrity', 'dist-tags', '--json'], NPM_REGISTRY),
  );
  if ('error' in onNpm) throw new Error(`npm view on npm: ${onNpm.error}`);
  if (!onNpm.found) return undefined;
  const view =
    /** @type {{ 'dist.integrity'?: string, 'dist-tags'?: Record<string, string> }} */ (
      onNpm.value
    );
  const pack = npm(
    ['pack', spec, '--pack-destination', scratch, '--json'],
    NPM_REGISTRY,
  );
  if (packNotServed(pack)) return undefined;
  const packed = packedTarball(ok(pack, 'npm pack').stdout);
  if (packed.integrity !== view['dist.integrity']) {
    throw new Error(
      `the tarball downloaded from npm has integrity ${packed.integrity}, npm reports ${String(view['dist.integrity'])}`,
    );
  }
  return { packed, distTags: view['dist-tags'] };
}

/** @type {string[]} */
const failures = [];
try {
  for (const { dir, manifest } of candidates) {
    const spec = `${String(manifest.name)}@${String(manifest.version)}`;
    try {
      /** @type {import('./lib/workspace.mjs').Packed} */
      let packed;
      /** @type {Record<string, string> | undefined} */
      let npmDistTags;
      if (fromWorkspace) {
        packed = packedTarball(
          ok(
            run('npm', ['pack', dir, '--pack-destination', scratch, '--json']),
            'npm pack',
          ).stdout,
        );
      } else {
        const served = await pollUntil(() => fromNpm(spec), {
          deadline: npmDeadline,
          now: Date.now,
          sleep,
          onWait: (_, ms) => {
            console.log(
              `… ${spec}: npm does not serve it yet; checking again in ${Math.round(ms / 1000)} s`,
            );
          },
        });
        if (served.value === undefined) {
          failures.push(
            `✗ ${spec}: ${formatProblem(
              notOnNpmProblem({
                spec,
                path: join(relative(ROOT, dir), 'package.json'),
                attempts: served.attempts,
                waitedMs: Date.now() - started,
                dryRun,
              }),
            )}`,
          );
          continue;
        }
        ({ packed, distTags: npmDistTags } = served.value);
      }

      const onGitHub = readViewResult(
        npm(['view', spec, 'dist.integrity', '--json'], GITHUB_REGISTRY),
      );
      if ('error' in onGitHub) {
        if (!dryRun)
          throw new Error(`npm view on GitHub Packages: ${onGitHub.error}`);
        console.log(
          `! ${spec}: GitHub Packages not readable here (${onGitHub.error}); the release job reads it with GITHUB_TOKEN`,
        );
      } else if (onGitHub.found) {
        if (onGitHub.value !== packed.integrity) {
          throw new Error(
            `GitHub Packages already holds ${spec} with integrity ${String(onGitHub.value)}, not npm's ${packed.integrity}. A version cannot be republished: release a new version`,
          );
        }
        console.log(`= ${spec}: already on GitHub Packages, same tarball`);
        continue;
      }

      const tag = mirrorDistTag(String(manifest.version), npmDistTags);
      ok(
        npm(
          [
            'publish',
            join(scratch, packed.filename),
            '--tag',
            tag,
            // Provenance is npm's; GitHub Packages gets the attested bytes.
            '--provenance=false',
            '--ignore-scripts',
            ...(dryRun ? ['--dry-run'] : []),
          ],
          GITHUB_REGISTRY,
        ),
        'npm publish to GitHub Packages',
      );
      if (dryRun) {
        console.log(
          `~ ${spec}: would publish ${packed.filename} (${packed.integrity}) to GitHub Packages, tag ${tag} (dry run)`,
        );
        continue;
      }

      // The registry may answer a moment after the upload.
      for (let attempt = 1; ; attempt += 1) {
        const check = readViewResult(
          npm(['view', spec, 'dist.integrity', '--json'], GITHUB_REGISTRY),
        );
        if ('found' in check && check.found && check.value === packed.integrity)
          break;
        if (attempt === 5) {
          throw new Error(
            `published, but GitHub Packages does not report integrity ${packed.integrity}: ${JSON.stringify(check)}`,
          );
        }
        await sleep(3000 * attempt);
      }
      console.log(
        `+ ${spec}: published to GitHub Packages, tag ${tag}, same integrity as npm`,
      );
    } catch (error) {
      failures.push(
        `✗ ${spec}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
