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
  const text = `${result.stdout}\n${result.stderr}`;
  const code =
    /"code":\s*"(E\w+)"/.exec(text)?.[1] ?? /\bcode (E\w+)/.exec(text)?.[1];
  if (code === 'E404') return { found: false };
  return {
    error: code ?? (text.trim().split('\n').slice(-3).join(' ') || 'unknown'),
  };
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
