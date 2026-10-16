# tassyir

The [Tassyir](https://tassyir.io) developer CLI. It signs you in from a
terminal, creates your apps, validates and deploys `tassyir.app.toml`,
manages client secrets, creates seeded dev stores and sends test webhooks.
For the marketplace, it previews storefront blocks, keeps your listing in a
file and submits the app to review.
Every command prints `--json`, and every refusal has a stable `code`, a
`message` and a one-sentence `fix`, so an AI coding agent can drive it as
well as you can.

An app runs on **your own server** (`hosting.mode = "external"`) or on
**Tassyir Hosting** (`hosting.mode = "tassyir"`), where `deploy` builds the
code, checks it by the API's rules before uploading it, and follows Tassyir's
scan of it to the verdict ([below](#tassyir-hosting)). The production API
keeps Tassyir Hosting switched off until hosted apps can be reached, and
answers a hosted deploy `APP_HOSTING_NOT_AVAILABLE`. `logs --tail` comes
later; its command already exists and says so.

## Install

Node 22.18 or later:

```bash
npm install -g tassyir
```

Or run it without installing: `npx tassyir@latest <command>`.

## Example: from nothing to a test webhook

```bash
tassyir login                       # approve the code in the dashboard
tassyir app init review-requests    # the starter (create-tassyir-app)
cd review-requests
npm install
npm run setup                       # .env with a new TOKEN_STORE_KEY
tassyir app create                  # handle and name from tassyir.app.toml
tassyir secrets create --write-env  # client id, secret and app id into .env
tassyir dev                         # the checklist: server, tunnel, hosting.url
tassyir deploy                      # validate, then upload as a new version
tassyir store create                # a dev store with products and orders
# install the app on the dev store from the developer console, then:
tassyir webhook trigger orders/created
```

The same with `--json`, as an agent would run it (the CLI prints each
document on one line; here they are spread out to read):

```bash
tassyir deploy --json
```

```json
{
  "ok": true,
  "app": { "id": "741…", "handle": "review-requests" },
  "unchanged": false,
  "version": {
    "version": 2,
    "current": true,
    "scopes": ["read_orders"],
    "webhookTopics": ["orders/created"],
    "…": "…"
  },
  "warnings": []
}
```

```bash
tassyir deploy --json   # the same manifest again
```

```json
{
  "ok": true,
  "app": { "id": "741…", "handle": "review-requests" },
  "unchanged": true,
  "version": { "version": 2 },
  "warnings": []
}
```

## Commands

| Command                           | What it does                                                   |
| --------------------------------- | -------------------------------------------------------------- |
| `tassyir login`                   | Sign in: a one-time code to approve in the dashboard           |
| `tassyir logout`                  | Revoke this machine's token on Tassyir, then forget it         |
| `tassyir whoami`                  | Who you are signed in as, and the token's state                |
| `tassyir app init [folder]`       | Start an app in a new folder (`create-tassyir-app`)            |
| `tassyir app create`              | Create the app on Tassyir (handle and name from the manifest)  |
| `tassyir app list`                | Your apps                                                      |
| `tassyir validate [path]`         | Check `tassyir.app.toml` with the API's own validator, offline |
| `tassyir deploy`                  | Validate the manifest, then upload it as the app's new version |
| `tassyir deploy --dry-run`        | Every check `deploy` runs before it uploads; no sign-in        |
| `tassyir block preview [handle]`  | Render a storefront block with sample data, offline            |
| `tassyir app version [n]`         | One version (default the latest), a hosted one with its scan   |
| `tassyir secrets list`            | An app's client secrets (never the secrets)                    |
| `tassyir secrets create`          | Mint the app's first client secret, shown once                 |
| `tassyir secrets rotate`          | Mint a new one; the current ones keep working 24 hours         |
| `tassyir secrets revoke <id>`     | Revoke one secret now                                          |
| `tassyir store create`            | A dev store, seeded with products, orders and buyers           |
| `tassyir store list`              | Your dev stores                                                |
| `tassyir webhook trigger <topic>` | A test event of one topic, sent to an installation's endpoint  |
| `tassyir webhook deliveries`      | The app's delivery log (30 days), with filters                 |
| `tassyir webhook replay <id>`     | Send one delivery again, now                                   |
| `tassyir listing pull`            | Write the draft marketplace listing to `tassyir.listing.json`  |
| `tassyir listing push`            | Save that file as the draft listing; what is still missing     |
| `tassyir submit`                  | Submit to the marketplace review, its checks followed          |
| `tassyir submit --checks-only`    | The review's checklist as a dry run; nothing submitted         |
| `tassyir submissions [id]`        | The app's reviews, or one with its checks and decision         |
| `tassyir dev`                     | The checklist to run your app against a dev store              |
| `tassyir logs --tail`             | Not available yet: needs Tassyir Hosting                       |

`tassyir <command> --help` explains each one and its options.
`tassyir --help --json` is the whole catalogue as data. The commands that act
on an app take `--app <handle or id>`, and otherwise use the handle in
`./tassyir.app.toml`.

## Signing in

`tassyir login` uses the OAuth 2.0 Device Authorization Grant
([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)):

1. It asks Tassyir for a code and prints it with the approval page,
   `https://app.tassyir.io/{ar|en}/developers/cli?code=XXXX-XXXX`. In a
   terminal it offers to open the page (press Enter); it always prints the
   code, so you can check that the page shows the same one.
2. You approve on the page, signed in to the dashboard with developer mode
   on. Approve only a sign-in you started yourself.
3. Meanwhile the CLI asks every `interval` seconds (5), slowing down by 5
   seconds each time the API says `slow_down`. It stops on a denial, when the
   code expires (10 minutes), or when the API no longer knows the sign-in.

It then holds a **developer token** (`tsy_dt_…`). The token works on the
developer API only: it cannot read a business, place an order or approve
another sign-in. It lapses after 90 days without use and after 365 days in
any case, and stops working when you change your password. Signing in again
replaces this machine's token and revokes the old one. `tassyir logout`
revokes it on Tassyir (at once) and forgets it. Signing out of the dashboard
does not sign the CLI out.

The CLI never prints the token or the sign-in's device code, in any mode,
with `TASSYIR_DEBUG` too; as a last resort, anything shaped like one is
replaced by `tsy_dt_[redacted]` before it is printed. Control characters
in text from the API (escape sequences) are dropped the same way.

### Where the token is stored

| Order | Where                    | When                                                                                                                               |
| ----- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `TASSYIR_TOKEN`          | Set it in CI to a token from a `tassyir login`. It is never stored, and `logout` never revokes it.                                 |
| 2     | The OS keychain          | macOS: the login keychain, through `/usr/bin/security`. Linux: the Secret Service (GNOME Keyring, KWallet), through `secret-tool`. |
| 3     | A file only you can read | `credentials.json` (mode 0600) in a folder only you can open (0700).                                                               |

Why this choice: a keychain keeps the token encrypted at rest and out of
backups and dotfile repositories, as `gh` does. The CLI talks to the
keychain through the programs the OS ships, so it needs no native module and
no install script; the token goes to them on stdin, never as an argument, so
no process listing shows it. When no keychain answers (a server without a
desktop session, a locked keychain, a container), the token goes to the
file, and `login` says so. On Windows the CLI uses the file, in
`%APPDATA%\tassyir`, a folder only your account can read: Credential Manager
has no command that gives a secret back without PowerShell, and that path is
not built yet.

`credentials.json` also holds what is not secret, per API origin: the email,
the user id and the token's id. So `whoami` can say who you are, and a
staging sign-in (`--api-origin`) sits next to production.

| Variable                   | Effect                                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `TASSYIR_TOKEN`            | A developer token to use instead of the stored one (CI).                                                                          |
| `TASSYIR_CREDENTIAL_STORE` | `keychain` (refuse when none answers) or `file`. Unset: the keychain, else the file.                                              |
| `TASSYIR_CONFIG_DIR`       | The folder of `credentials.json`. Default `$XDG_CONFIG_HOME/tassyir`, else `~/.config/tassyir` (`%APPDATA%\tassyir` on Windows).  |
| `TASSYIR_API_ORIGIN`       | Another Tassyir API (staging, a local one). https only; http only on `localhost`, `127.0.0.1` or `[::1]`. Same as `--api-origin`. |
| `TASSYIR_DEBUG`            | `1` prints each request's method, path, status and duration on stderr. Never a header or a body.                                  |

## Client secrets

A client secret (`tsy_cs_…`) is shown **once**: Tassyir keeps only its hash.

- `secrets create` mints the app's first secret and prints it with the client
  id and the app id. It refuses when the app already has a live secret:
  `secrets rotate` is the rotation, which gives the current secrets 24 more
  hours so a deployed server keeps working while you roll the new one out.
- With `--write-env` (or `--env-file <path>`), the three values go to `.env`
  and the secret is not printed. A value the file already holds is never
  replaced silently: the file is checked **before** the secret is minted, and
  only `--force` replaces it. The starter's placeholders
  (`app_your-client-id`, …) are filled in. A new file is created 0600; in a
  starter project, run `npm run setup` first (the CLI refuses otherwise,
  since setup never touches an existing `.env`). A folder that does not
  exist or cannot be written is refused before minting too.
- If writing `.env` still fails after the secret was minted, the error shows
  the three values once (`reveal` in `--json`): the secret is never lost.
- The CLI writes a secret nowhere else, ever.

## `--json`, errors and exit codes

With `--json`, a command prints one JSON document on one line on stdout:
`{"ok":true,…}`, or `{"ok":false,"error":{…}}`. `login` prints two lines:
first the code to approve (`"step":"authorize"`, `userCode`,
`verificationUriComplete`), then the result. A hosted `deploy` that waits
for its scan prints two too: first the uploaded version
(`"step":"uploaded"`, `next`), then the verdict. The result is always the
last line. Without `--json`, results go to stdout and refusals to stderr.

An error has a stable `code`, a `message` and a one-sentence `fix`, and when
they apply `status` (the API's HTTP status), `requestId`,
`retryAfterSeconds`, `errors` (every manifest or bundle problem, or scan
finding: `code`, `path`, `message`, `fix`), `details` (what the refusal is about: `limit`,
`handle`, …) and `reveal` (values you must see although the command failed,
such as a secret minted before its `.env` write broke). The API's own codes are passed on as they are. For example,
`tassyir validate` on a manifest with `handle = "API"` and no reason for its
scope (exit code 4):

```text
✗ MANIFEST_INVALID: tassyir.app.toml has 2 problems; the first: `handle` is "API"; a handle is 3 to 40 lowercase letters, digits and single hyphens, starting and ending with a letter or digit.
  Fix: Set `handle` to a handle of that form, e.g. "api". Then fix the others listed and run `tassyir validate` again.
  - MANIFEST_HANDLE_INVALID at handle: `handle` is "API"; a handle is 3 to 40 lowercase letters, digits and single hyphens, starting and ending with a letter or digit.
    Fix: Set `handle` to a handle of that form, e.g. "api".
  - MANIFEST_SCOPE_REASON_MISSING at access.scope_reasons.read_orders: "read_orders" is requested but `access.scope_reasons` does not explain it.
    Fix: Add read_orders = "<one sentence on why the app needs it>" to `access.scope_reasons`.
```

With `--json`, the same (on one line when printed):

```json
{
  "ok": false,
  "error": {
    "code": "MANIFEST_INVALID",
    "message": "tassyir.app.toml has 2 problems; the first: …",
    "fix": "Set `handle` to a handle of that form, e.g. \"api\". Then fix the others listed and run `tassyir validate` again.",
    "errors": [
      {
        "code": "MANIFEST_HANDLE_INVALID",
        "path": "handle",
        "message": "…",
        "fix": "…"
      },
      {
        "code": "MANIFEST_SCOPE_REASON_MISSING",
        "path": "access.scope_reasons.read_orders",
        "message": "…",
        "fix": "…"
      }
    ]
  }
}
```

| Exit code | Meaning                                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0         | Done.                                                                                                                                                                           |
| 1         | Failed: the API refused, or something else went wrong. The `code` says what.                                                                                                    |
| 2         | Usage: an unknown command or option, a missing or malformed argument.                                                                                                           |
| 3         | Sign in again: not signed in, the token was refused, or the sign-in was denied or expired.                                                                                      |
| 4         | The manifest is missing, not TOML, or invalid, or a hosted app's bundle does not build or pass its checks. Nothing was uploaded.                                                |
| 5         | Try again later: rate limited, or the API is busy or unreachable (`retryAfterSeconds` when known); a hosted version still being scanned, or whose scan ended without a verdict. |

Codes of the CLI's own (the API's pass through as they are):
`NOT_LOGGED_IN`, `LOGIN_DENIED`, `LOGIN_EXPIRED`, `LOGIN_INVALID_GRANT`,
`LOGIN_RATE_LIMITED`, `LOGIN_FAILED`, `TOKEN_ENV_INVALID`, `TOKEN_FROM_ENV`,
`CREDENTIALS_UNAVAILABLE`, `CREDENTIALS_UNREADABLE`, `CREDENTIALS_UNWRITABLE`,
`KEYCHAIN_UNAVAILABLE`, `MANIFEST_NOT_FOUND`, `MANIFEST_UNREADABLE`,
`MANIFEST_TOML_INVALID`, `MANIFEST_INVALID`, `BUNDLE_ENTRY_NOT_FOUND`,
`BUNDLE_BUILD_FAILED`, `BUNDLE_INVALID`, `VERSION_SCAN_FAILED`,
`VERSION_REJECTED`, `VERSION_IN_PROGRESS`, `APP_REQUIRED`, `APP_NOT_FOUND`,
`APP_FIELDS_REQUIRED`, `APP_SECRET_EXISTS`, `ENV_VALUE_EXISTS`,
`ENV_FILE_MISSING`, `ENV_FILE_UNREADABLE`, `ENV_FILE_UNWRITABLE`,
`INSTALLATION_REQUIRED`, `WEBHOOK_ENDPOINT_FAILED`, `WEBHOOK_REPLAY_SKIPPED`,
`COMMAND_NOT_AVAILABLE`, `UNKNOWN_COMMAND`, `INVALID_ARGUMENT`,
`API_ORIGIN_INVALID`, `API_REDIRECTED`, `NETWORK_ERROR`, `TIMEOUT`,
`SERVER_ERROR`, `INVALID_RESPONSE`,
`NODE_VERSION_UNSUPPORTED`, `INTERNAL_ERROR`. A refusal the API sends
without a code (a malformed request, the throttler) reads as `BAD_REQUEST`,
`RATE_LIMITED`, `SERVER_ERROR`, …, by status.

## The manifest

`validate` and `deploy` parse `tassyir.app.toml` and check it with
[`@tassyir/app-manifest`](../app-manifest), the Tassyir API's own validator:
the same normalised manifest, and the same errors in the same order. One
check comes on top: no field of the manifest takes a TOML date or time, so
the CLI refuses one wherever it is (the validator would read a date where a
table goes as an empty table, and the API would see a string there).
`deploy` uploads only a manifest that passed, and the same manifest twice is
answered `unchanged` (exit 0). A hosted app also needs its bundle: see
[Tassyir Hosting](#tassyir-hosting).

## Storefront blocks

Not live yet: blocks open with the marketplace. For each
`[[storefront.blocks]]` entry, `validate` and `deploy` read the template and
the stylesheet (paths from the manifest's folder, never outside it) and hold
them to [`@tassyir/storefront-blocks`](../storefront-blocks)' `validateBlock`,
the check the API runs at upload: the template against its declaration, the
stylesheet, sample renders in Arabic, French and English. Every problem comes
at once as `BLOCKS_INVALID` (exit 4), each with its `code`, its place
(`blocks/product-rating.liquid:3:7`) and a `fix`. A version's block files
weigh 100 KB at most together.

`deploy` then uploads them with the version: an app on your own server sends
them next to the manifest as the version's `assets`
(`{ files: [{ path, content }] }`); a hosted app carries them in its bundle as
text modules, at the manifest's paths. An API that does not take block files
yet answers `BLOCK_ASSETS_NOT_ACCEPTED`.

`tassyir block preview [handle]` renders one block on your machine with the
package's sample data: the store "Dar Amina", a product for target
`product`, each setting at its default. `--lang ar|fr|en` (default `ar`),
`--settings <file.json>` (values as a merchant saves them), `--data
<file.json>` (app data by owner: `{ "product": { "rating": … } }`). It prints
the HTML as the store shows it (stdout holds the HTML alone) and warns about
values the render drops; `--out preview.html` writes a page with the
stylesheet, where no script can run.

## The marketplace

Not open yet: these commands drive the API's listing and review routes.

- `tassyir listing pull` writes the draft listing to `./tassyir.listing.json`
  (`--file`; `--force` to overwrite), and lists what it still needs and the
  app's images by id. `tassyir listing push` sends the file back as the whole
  draft: refused with every problem (`LISTING_INVALID`) only for what is never
  right; what is missing is saved and listed. Images are uploaded in the
  developer console.
- `tassyir submit --distribution public|unlisted [--note <text>]` refuses a
  draft that still misses something (`LISTING_INCOMPLETE`), then submits and
  follows the review's automated checklist (`--timeout`, default 180 s; 0
  answers at once). Exit 0 once the review waits for a person, 1 when a hard
  check failed (`SUBMISSION_CHECKS_FAILED`, each check with its fix), 5 when
  it stopped waiting (never submit again then: `tassyir submissions <id>
--follow`). The developer terms are accepted in the console, never by the
  CLI.
- `tassyir submit --checks-only` runs the same checklist as a dry run,
  without submitting (5 runs per app per hour: it sends test webhooks to your
  endpoints).
- `tassyir submissions [id] [--follow]` lists the reviews, or shows one: its
  state, why a person reviews it, the turnaround, each check, the decision.

The guide: [Publishing to the marketplace](https://developers.tassyir.io/guides/publishing).

## Tassyir Hosting

For `hosting.mode = "tassyir"`, `deploy` does four things, and stops at the
first that fails. `deploy --dry-run` does the first two only (below).

`tassyir app init --template hosted` starts such a project (a Worker on Hono
and a React page, `create-tassyir-app`'s `hosted` template), and prints its
own next steps: `npm run check`, `tassyir app create`, `npm run deploy` (the
page's build, then `deploy`) and `tassyir store create`. A hosted app needs
no client secret: `tassyir app create` says so by leaving
`tassyir secrets create` out of its next steps.

**1. Build.** esbuild (0.28.2, a dependency of the CLI) bundles the Worker's
entry into one ES module, `worker.js`: `--entry <file>`, or the first of
`src/worker.ts`, `src/worker.js`, `src/index.ts`, `src/index.js` in the
manifest's folder. Target ES2022, the `workerd` / `worker` / `browser` export
conditions, `.html` and `.css` imported as text (`import page from
'./page.html'` is a string). `cloudflare:*` and `node:*` stay imports, so the
checks can name them. The source map stays on your machine: the checks use
it to point at your source, and a bundle never carries one. A build error
is `BUNDLE_BUILD_FAILED` (exit 4) with each of esbuild's errors in `errors`
(a package that is not installed, a Node.js built-in, a binary file).

**2. Check, before anything is sent.** The same rules the API applies, so a
bundle the CLI passes is one the API takes:

- the API's upload rules (`BUNDLE_*` codes, exactly the API's): 1 to 100
  files, at most 3 MB of UTF-8 together; text only (ES modules `.js` /
  `.mjs`, text `.html` `.css` `.txt` `.json` `.svg` `.liquid`), no
  WebAssembly, source map or binary; paths of letters, digits, `.`, `_`, `-`
  that never start with `.`, at most 200 characters and in at most 9
  folders (`a/b/c.js` is in 2); `main` one of the ES modules; a lockfile of
  at most 1 MB;
- the code checks of the scan that do not need Tassyir's data: `eval` or
  `new Function` over code built at run time, a string timer,
  `.constructor.constructor()`, `import()` of a name built at run time, an
  import of a URL, of `cloudflare:sockets` or of anything outside the
  bundle (`BUNDLE_DYNAMIC_IMPORT`, `BUNDLE_EVAL`, …), a `node:` import
  (`BUNDLE_NODE_IMPORT`: a hosted Worker has no Node.js compatibility), a
  `main` that surely exports no `fetch` handler (`BUNDLE_NO_FETCH_HANDLER`;
  a default built at run time, inherited or re-exported passes), and every
  `fetch` / `new Request` / `new WebSocket` / `new EventSource` to a literal
  host: a Tassyir domain (`BUNDLE_TASSYIR_HOST`: call Tassyir through
  `ctx.props.TASSYIR`), a host outside `hosting.allowed_hosts`
  (`BUNDLE_HOST_NOT_ALLOWED`; `*.x.com` is the subdomains of `x.com`, never
  `x.com`), or http.

Every problem at once is `BUNDLE_INVALID` (exit 4), each in `errors` with its
place in your source (`src/worker.ts:12`). What the scan would only warn
about (`eval("…")` of a literal, a host built at run time, WebAssembly) is
printed and does not stop the deploy. The scan's other checks (invisible
Unicode, Admin API calls against the requested scopes, Semgrep, Gitleaks,
OSV on the lockfile, the AI review) run on Tassyir's side only.

**`--dry-run` stops here.** It builds and checks exactly as above, with no
sign-in and nothing sent: exit 0 when `deploy` would upload the bundle, 4
when it would refuse it (`BUNDLE_INVALID`, `BUNDLE_BUILD_FAILED`, or the
manifest's own `MANIFEST_INVALID`). `--app` and `--timeout` are not used
(a warning says so). The hosted template's `npm run deploy:check` is the
page's build, then `tassyir deploy --dry-run`. For an app on your own server,
`--dry-run` checks the manifest only.

```bash
tassyir deploy --dry-run --json
```

```json
{
  "ok": true,
  "dryRun": true,
  "uploaded": false,
  "app": { "handle": "review-requests" },
  "hosting": "tassyir",
  "entry": "src/worker.ts",
  "main": "worker.js",
  "bytes": 398412,
  "lockfile": "package-lock.json",
  "warnings": [],
  "next": "tassyir deploy"
}
```

**3. Upload** `{ manifest, bundle: { main, files, lockfile } }` to
`POST developer/apps/{appId}/versions`. The lockfile is the project's
`package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock` or
`bun.lock` (the first found, in that order), scanned for known
vulnerabilities and malicious packages, never deployed. Without one the scan
warns that the dependencies were not checked.

**4. Follow the scan.** Every 10 seconds the CLI reads the version
(`GET developer/apps/{appId}/versions/{n}`) until it settles, or `--timeout`
seconds pass (default 1800, the time the API gives a scan; `0` answers at
once). A busy or unreachable API is asked again. Ctrl-C stops waiting, never
the scan. Then:

| The version                                    | `deploy`                                                                                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Released (`approved`): scanned, on Cloudflare  | exit 0, `"released": true`, the findings that only warned                                                                                 |
| Held for a person (`in_review`)                | exit 0, `"released": false`, `"state": "in_review"`: the checks passed, the AI review asked for a look                                    |
| Failed its scan (`scan_failed`, on findings)   | exit 1, `VERSION_SCAN_FAILED`, every failing finding and review concern in `errors`                                                       |
| Its scan ended without a verdict               | exit 5, the API's code (`SCAN_TIMED_OUT`, `SCAN_INCOMPLETE`, `SCAN_DISPATCH_FAILED`, `SCAN_RESULT_INVALID`): upload the same bundle again |
| Scanned, but the upload to Cloudflare failed   | exit 1, the API's code (`CLOUDFLARE_REJECTED`, …) and, when it sent one, Cloudflare's own code and message (`refusal`)                    |
| Rejected by a person at Tassyir                | exit 1, `VERSION_REJECTED` with the reason                                                                                                |
| Still scanning at `--timeout`, or after Ctrl-C | exit 5, `VERSION_IN_PROGRESS`: `tassyir app version <n> --follow` picks it up                                                             |

Every answer carries the whole version as the API sent it (`version`, or
`error.details.version`): the scan's `status` and `reasons`, each check with
its findings (`rule`, `severity`, `file`, `line`, `message`), the AI review,
and both uploads. `tassyir app version [n]` shows it again; with `--follow`
it waits and exits as `deploy` does.

```bash
tassyir deploy --json
```

```json
{ "ok": true, "step": "uploaded", "app": { "id": "741…", "handle": "review-requests" }, "unchanged": false, "version": { "version": 3, "reviewState": "scanning", "scan": "pending" }, "next": "tassyir app version 3 --follow --app review-requests" }
{ "ok": true, "released": true, "state": "released", "unchanged": false, "app": { "…": "…" }, "version": { "version": 3, "reviewState": "approved", "current": true, "hosting": { "scan": { "status": "passed", "…": "…" }, "checks": ["…"], "review": null, "…": "…" } }, "warnings": [] }
```

The same manifest and bundle as the latest version are not a new version
(`APP_VERSION_UNCHANGED`): `deploy` answers with that version's state, and
follows it if its scan is still running. After a scan that ended without a
verdict, the same bundle is scanned again as a new version. The API's
refusals of a hosted upload, with the CLI's fix:

| Code                         | Why, and what to do                                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `APP_HOSTING_NOT_AVAILABLE`  | Tassyir Hosting is off on this API (production, for now): run the app on your own server, or use `--api-origin`.                    |
| `APP_HOSTING_NOT_CONFIGURED` | On, but not ready to take uploads; nothing was stored (exit 5): try again later.                                                    |
| `APP_VERSION_CONFLICT`       | Another upload of the app took the version number first: run `tassyir deploy` again.                                                |
| `APP_HOSTING_BUSY`           | Tassyir scanned all it can for today (exit 5, `retryAfterSeconds`).                                                                 |
| `DEVELOPER_RATE_LIMITED`     | 10 hosted versions per developer per 24 hours (each is a scan), 30 versions an hour.                                                |
| `APP_BUNDLE_INVALID`         | The API refused what the CLI's check passed (exit 4, `errors`): update the CLI.                                                     |
| `PAYLOAD_TOO_LARGE`          | An upload is at most 128 KB where Tassyir Hosting is off, 8 MB + 128 KB where it is on: the API's `fix` and `limitBytes` say which. |

## From code

The package's entry runs a command line in-process, with your own I/O (the
specs do this against a fake API):

```ts
import { runCli } from 'tassyir';

const exitCode = await runCli(['validate', '--json'], io);
```

`io` is a `CliIo`: stdout, stderr, the environment, the working folder,
`fetch`, a clock, how to run a program and, optionally, Ctrl-C
(`onInterrupt`). The hosted bundle's checks are exported too:
`validateHostedBundle` (the API's upload rules), `checkBundleCode` (the
scan's code checks) and `buildHostedBundle`; and the block files' check,
`checkBlocks` (what `validate` runs on `[[storefront.blocks]]`). `DeveloperApi` is the typed
developer-API client the commands use. Its routes, bodies and answers are
typed from the developer API's OpenAPI document, vendored in `openapi/` at a
recorded backend commit (`SOURCE.json`); the package exports the types
(`DeveloperApp`, `Installation`, `Delivery`, `WebhookTopic`, …, and the raw
`DeveloperApiPaths`, `DeveloperApiOperations`, `DeveloperApiComponents`). In
this repo, with a clone of `tassyir/backend` in `TASSYIR_BACKEND_DIR`,
`npm run openapi:check -w tassyir` compares the copy with the backend's and
`npm run openapi:update -w tassyir` vendors the new file and regenerates the
types.

## License

MIT
