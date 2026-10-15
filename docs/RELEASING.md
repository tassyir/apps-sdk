# Releasing

Each public package has its own version, managed by [Changesets](https://changesets.dev).
A release publishes the package to **public npm** under `@tassyir`, with
provenance, and the **same tarball** to **GitHub Packages**
(`npm.pkg.github.com`). The second copy exists because the backend's `.npmrc`
sends every `@tassyir/*` install to GitHub Packages (plan decision D11).
`tassyir` and `create-tassyir-app` are unscoped, and GitHub Packages only takes
packages scoped to its owner, so those two go to npm only. No Tassyir repo
installs them.

Nothing here uses an npm token. npm accepts the publish through **trusted
publishing**: GitHub Actions proves which repo, workflow and environment is
asking (OIDC), and npm adds provenance on its own. GitHub Packages gets the
workflow's own `GITHUB_TOKEN`.

## How a release runs

1. A pull request changes a package and adds a changeset (`npx changeset`:
   package, bump, one line for the changelog). CI runs on it.
2. On merge, [`release.yml`](../.github/workflows/release.yml) opens or updates
   the **Version Packages** PR: new versions and changelogs.
3. Merging that PR runs `release.yml` again, which:
   - runs every CI gate on the exact commit (`npm run verify`). A PR opened by
     the workflow gets no CI run of its own; close and reopen it to get one;
   - packs each package whose version is not on npm yet;
   - publishes those tarballs to npm (job `publish-npm`, environment `npm`),
     pushes the `name@version` tags and creates the GitHub releases;
   - mirrors each public `@tassyir/*` package's current version to GitHub
     Packages. It downloads the tarball npm serves, publishes it, and checks that
     both registries report the same integrity. npm's CDN can serve the old
     package metadata for a few minutes after a publish, so the mirror checks
     again, with backoff, for up to 10 minutes. If npm still does not serve a
     version the workspace names, the job fails with `NOT_ON_NPM`; it never
     skips a version in silence.
4. To use a new version in the backend, bump its exact pin in
   `tassyir/backend/package.json` (as for `@tassyir/builder-core`) and run
   `npm install`.

The mirror skips versions GitHub Packages already has. If it fails, rerun
`release.yml` (Actions → Release → Run workflow) and it publishes only what is
missing. A version is never republished: to fix a bad release, ship a new
version.

## One-time setup (owner)

Nothing below is a secret, and no secret is added to this repo.

### GitHub: `tassyir/apps-sdk`

- [ ] **Settings → Actions → General**: tick _Allow GitHub Actions to create and
      approve pull requests_. Changesets needs it to open the Version Packages PR.
- [ ] **Settings → Environments → New environment** `npm`. Under _Deployment
      branches and tags_, allow `main` only. Optional: add yourself as a
      _required reviewer_, so every npm publish waits for your approval.
- [ ] **Settings → Rules**: protect `main` (PR required, status check
      `Lint, typecheck, test, build, pack`).
- [ ] **Settings → Code security**: check that _Secret scanning_ and _Push
      protection_ are on. They are on by default for public repos.

### GitHub organisation `tassyir`: GitHub Packages

- [ ] **Organisation settings → Member privileges → Package creation**: allow
      the visibility you want for the mirrored packages. Public is recommended,
      because the same code is public on npm. The first mirror creates each
      package with the workflow's `GITHUB_TOKEN`, which also gives
      `tassyir/apps-sdk` admin access to it.
- [ ] **After a package's first release** (`@tassyir/app-manifest` first, from
      AP-K1.2), open its page under github.com/orgs/tassyir/packages →
      _Package settings_:
  - _Manage Actions access_: add **`tassyir/backend` (Read)**. The backend's
    deploy runs `npm ci` with its own `GITHUB_TOKEN`, as for builder-core.
    Without this grant, the deploy's install fails and the old container keeps
    running. Add **`tassyir/frontend` (Read)** too if the frontend will install
    the package. Keep `tassyir/apps-sdk` at Admin or Write: the mirror publishes
    every later version with it.
  - Do this **before** merging the backend PR that pins the package.
- [ ] Laptops already have a `read:packages` token in `~/.npmrc` for
      builder-core. The same token reads the new packages.

### npm organisation `tassyir`: once per new package name

npm sets up a trusted publisher only on a package that already exists, and a
new trusted publisher expires unless it publishes within 2 days. So each new
name is first published by hand as a `0.0.0` stub, then CI publishes every
real version. Do this for `@tassyir/app-manifest` when AP-K1.2's Version
Packages PR is ready, and for each later package when its turn comes. Only use
names listed in `PLANNED_PUBLIC_PACKAGES` ([scripts/lib/policy.mjs](../scripts/lib/policy.mjs)).
A name on public npm is permanent.

- [ ] Use an npm account with 2FA that may publish in the `tassyir` org.
- [ ] Publish the stub. **Pin the registry on the command line**: your
      `~/.npmrc` sends `@tassyir` to GitHub Packages, and without the flags the
      stub would land there.

  ```bash
  mkdir stub && cd stub
  cat > package.json <<'JSON'
  {
    "name": "@tassyir/app-manifest",
    "version": "0.0.0",
    "description": "Reserved for the Tassyir Apps SDK: https://github.com/tassyir/apps-sdk",
    "license": "MIT",
    "repository": { "type": "git", "url": "git+https://github.com/tassyir/apps-sdk.git", "directory": "packages/app-manifest" }
  }
  JSON
  npm publish --access public --registry=https://registry.npmjs.org/ --@tassyir:registry=https://registry.npmjs.org/
  npm deprecate @tassyir/app-manifest@0.0.0 "Placeholder. Use 0.1.0 or later." --registry=https://registry.npmjs.org/ --@tassyir:registry=https://registry.npmjs.org/
  ```

- [ ] Add the trusted publisher. Either use npmjs.com → the package →
      _Settings → Trusted publishing → GitHub Actions_ with organisation
      `tassyir`, repository `apps-sdk`, workflow `release.yml`, environment
      `npm`, allowed action **`npm publish`** (Changesets cannot use staged
      publishing yet), or run the same from npm 11.15 or later:

  ```bash
  npm trust github @tassyir/app-manifest --repo tassyir/apps-sdk --file release.yml --env npm --allow-publish --registry=https://registry.npmjs.org/
  ```

  For an unscoped name (`create-tassyir-app`, `tassyir`), use the same steps
  with that name, `"directory": "packages/<folder>"`, and only
  `--registry=https://registry.npmjs.org/` on the `npm publish`, `npm deprecate`
  and `npm trust` commands.

- [ ] _Settings → Publishing access_: **Require two-factor authentication and
      disallow tokens**.
- [ ] Within 2 days, merge the Version Packages PR. The first CI publish
      validates the trusted publisher.

Why no `NPM_TOKEN`: trusted publishing works for org-scoped packages. npm write
tokens now last 90 days at most, and npm is retiring 2FA-bypass tokens for
publishing. A long-lived publish secret in a public repo's Actions is the
risk this setup avoids.

## Dry runs

None of these publishes anything.

```bash
npm run verify                     # every CI gate, as the release runs them
npx changeset publish-plan         # what npm would receive now
node scripts/mirror-to-github-packages.mjs --dry-run --from-workspace --include-private
```

CI runs the last two on every pull request. Without `--from-workspace`, a dry
run downloads from npm and checks it once, without waiting: a version npm does
not serve fails it with `NOT_ON_NPM`. To rehearse a whole release, work
in a scratch copy of the repo (never in your checkout) with a pending
changeset, then run
`npx changeset version`, `npx changeset publish-plan --output plan.json`,
`npx changeset pack --from-publish-plan plan.json --out-dir pack`, and
`npm publish pack/packages/*.tgz --dry-run --registry=https://registry.npmjs.org/ --@tassyir:registry=https://registry.npmjs.org/`.
Never run `changeset publish` by hand: it publishes.
