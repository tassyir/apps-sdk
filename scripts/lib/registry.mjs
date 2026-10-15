// Pure helpers of scripts/mirror-to-github-packages.mjs (tested in
// registry.test.mjs; the script itself talks to the registries).

export const NPM_REGISTRY = 'https://registry.npmjs.org/';
export const GITHUB_REGISTRY = 'https://npm.pkg.github.com/';

/**
 * The outcome of `npm view <name>@<version> ... --json`.
 * - exit 0 with output: the version exists;
 * - exit 0 without output: the package exists, the version does not;
 * - E404: the package does not exist (or the token cannot see it: GitHub
 *   Packages answers 404 then too, so a missing read grant looks the same).
 * Anything else (E401, E403, network) is an error the caller must not read as
 * "missing", or a rerun would publish blind.
 * @param {{ status: number, stdout: string, stderr: string }} result
 * @returns {{ found: true, value: unknown } | { found: false } | { error: string }}
 */
export function readViewResult(result) {
  const stdout = result.stdout.trim();
  if (result.status === 0) {
    return stdout === ''
      ? { found: false }
      : { found: true, value: JSON.parse(stdout) };
  }
  const code = npmErrorCode(result);
  if (code === 'E404') return { found: false };
  return {
    error:
      code ??
      (`${result.stdout}\n${result.stderr}`
        .trim()
        .split('\n')
        .slice(-3)
        .join(' ') ||
        'unknown'),
  };
}

/**
 * Whether a failed `npm pack <name>@<version>` means npm does not serve that
 * version yet: E404, or ETARGET when the package's metadata lacks the
 * version. npm pack reads the install metadata, which npm's CDN caches apart
 * from the full packument npm view reads, so it can lag behind npm view.
 * @param {{ status: number, stdout: string, stderr: string }} result
 */
export function packNotServed(result) {
  if (result.status === 0) return false;
  const code = npmErrorCode(result);
  return code === 'E404' || code === 'ETARGET';
}

/**
 * The code (`E404`, `ETARGET`, …) of a failed npm command: in the JSON
 * `--json` prints on stdout, or in the log on stderr.
 * @param {{ stdout: string, stderr: string }} result
 */
function npmErrorCode(result) {
  const text = `${result.stdout}\n${result.stderr}`;
  return (
    /"code":\s*"(E\w+)"/.exec(text)?.[1] ?? /\bcode (E\w+)/.exec(text)?.[1]
  );
}

/**
 * How long a release run waits for npm to serve a version the workspace
 * names. Right after a publish, npm's CDN can serve the old packument for as
 * long as it caches one (`max-age=300`); this is twice that.
 */
export const NPM_WAIT_MS = 10 * 60 * 1000;

/**
 * The pause after the `attempt`-th check: 5 s, doubling, at most 30 s.
 * @param {number} attempt 1 after the first check
 */
export function retryDelay(attempt) {
  return Math.min(5000 * 2 ** (attempt - 1), 30_000);
}

/**
 * Runs `check` until it returns a value, pausing `retryDelay(attempt)`
 * between checks, and gives up once `deadline` (ms since the epoch) has
 * passed. It checks at least once and never sleeps past the deadline.
 * @template T
 * @param {() => T | undefined} check
 * @param {{
 *   deadline: number,
 *   now: () => number,
 *   sleep: (ms: number) => Promise<unknown>,
 *   onWait?: (attempt: number, ms: number) => void,
 * }} options
 * @returns {Promise<{ value: T | undefined, attempts: number }>}
 */
export async function pollUntil(check, { deadline, now, sleep, onWait }) {
  for (let attempt = 1; ; attempt += 1) {
    const value = check();
    if (value !== undefined) return { value, attempts: attempt };
    const left = deadline - now();
    if (left <= 0) return { value: undefined, attempts: attempt };
    const ms = Math.min(retryDelay(attempt), left);
    onWait?.(attempt, ms);
    await sleep(ms);
  }
}

/** @typedef {{ code: string, path: string, message: string, fix: string }} Problem */

/**
 * The failure for a version the workspace names (in `path`) that npm does not
 * serve: after `waitedMs` of a release run, or at once in a dry run, which
 * checks once without waiting.
 * @param {{ spec: string, path: string, attempts: number, waitedMs: number, dryRun: boolean }} options
 * @returns {Problem}
 */
export function notOnNpmProblem({ spec, path, attempts, waitedMs, dryRun }) {
  if (dryRun) {
    return {
      code: 'NOT_ON_NPM',
      path,
      message: `npm does not serve ${spec}, the version ${path} names (a dry run checks once, without waiting).`,
      fix: `Release ${spec} first, or add --from-workspace to rehearse the mirror with the workspace's own tarballs.`,
    };
  }
  const minutes = Math.round(waitedMs / 6000) / 10;
  return {
    code: 'NOT_ON_NPM',
    path,
    message: `npm still does not serve ${spec}, the version ${path} names, after ${minutes} min and ${attempts} checks, so GitHub Packages did not get it.`,
    fix: 'Run release.yml again (Actions → Release → Run workflow, or gh workflow run release.yml --repo tassyir/apps-sdk --ref main): it publishes to npm what npm lacks, then mirrors only what GitHub Packages lacks.',
  };
}

/**
 * A problem as the mirror prints it.
 * @param {Problem} problem
 */
export function formatProblem({ code, path, message, fix }) {
  return `${code} (${path}): ${message}\n  fix: ${fix}`;
}

/**
 * The dist-tag the GitHub Packages copy gets: the tag npm gives this version
 * (`latest` first). A version npm tags nothing gets `latest` only when npm has
 * no `latest` yet, the first prerelease identifier when it is a prerelease
 * (`1.0.0-beta.2` → `beta`), and `untagged` otherwise, so the mirror never
 * moves GitHub's `latest` behind npm's.
 * @param {string} version
 * @param {Record<string, string> | undefined} npmDistTags
 */
export function mirrorDistTag(version, npmDistTags) {
  const tags = Object.entries(npmDistTags ?? {})
    .filter(([, tagged]) => tagged === version)
    .map(([tag]) => tag)
    .sort();
  if (tags.includes('latest')) return 'latest';
  if (tags[0]) return tags[0];
  const prerelease = /^\d+\.\d+\.\d+-([0-9A-Za-z-]+)/.exec(version)?.[1];
  if (prerelease) return /^\d+$/.test(prerelease) ? 'next' : prerelease;
  return npmDistTags?.['latest'] ? 'untagged' : 'latest';
}
