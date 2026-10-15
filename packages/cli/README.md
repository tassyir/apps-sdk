# tassyir

The [Tassyir](https://tassyir.io) developer CLI. It signs you in from a
terminal, creates your apps, validates and deploys `tassyir.app.toml`,
manages client secrets, creates seeded dev stores and sends test webhooks.
Every command prints `--json`, and every refusal has a stable `code`, a
`message` and a one-sentence `fix`, so an AI coding agent can drive it as
well as you can.

Phase 1 serves apps on **your own server** (`hosting.mode = "external"`).
Tassyir Hosting, `logs --tail` and `submit` come later; their commands
already exist and say so.

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
| `tassyir secrets list`            | An app's client secrets (never the secrets)                    |
| `tassyir secrets create`          | Mint the app's first client secret, shown once                 |
| `tassyir secrets rotate`          | Mint a new one; the current ones keep working 24 hours         |
| `tassyir secrets revoke <id>`     | Revoke one secret now                                          |
| `tassyir store create`            | A dev store, seeded with products, orders and buyers           |
| `tassyir store list`              | Your dev stores                                                |
| `tassyir webhook trigger <topic>` | A test event of one topic, sent to an installation's endpoint  |
| `tassyir webhook deliveries`      | The app's delivery log (30 days), with filters                 |
| `tassyir webhook replay <id>`     | Send one delivery again, now                                   |
| `tassyir dev`                     | The checklist to run your app against a dev store              |
| `tassyir logs --tail`             | Not available yet: needs Tassyir Hosting                       |
| `tassyir submit`                  | Not available yet: public listing comes with the marketplace   |

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
`verificationUriComplete`), then the result. Without `--json`, results go to
stdout and refusals to stderr.

An error has a stable `code`, a `message` and a one-sentence `fix`, and when
they apply `status` (the API's HTTP status), `requestId`,
`retryAfterSeconds`, `errors` (every manifest problem: `code`, `path`,
`message`, `fix`), `details` (what the refusal is about: `limit`,
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

| Exit code | Meaning                                                                                            |
| --------- | -------------------------------------------------------------------------------------------------- |
| 0         | Done.                                                                                              |
| 1         | Failed: the API refused, or something else went wrong. The `code` says what.                       |
| 2         | Usage: an unknown command or option, a missing or malformed argument.                              |
| 3         | Sign in again: not signed in, the token was refused, or the sign-in was denied or expired.         |
| 4         | The manifest is missing, not TOML, or invalid. Nothing was uploaded.                               |
| 5         | Try again later: rate limited, or the API is busy or unreachable (`retryAfterSeconds` when known). |

Codes of the CLI's own (the API's pass through as they are):
`NOT_LOGGED_IN`, `LOGIN_DENIED`, `LOGIN_EXPIRED`, `LOGIN_INVALID_GRANT`,
`LOGIN_RATE_LIMITED`, `LOGIN_FAILED`, `TOKEN_ENV_INVALID`, `TOKEN_FROM_ENV`,
`CREDENTIALS_UNAVAILABLE`, `CREDENTIALS_UNREADABLE`, `CREDENTIALS_UNWRITABLE`,
`KEYCHAIN_UNAVAILABLE`, `MANIFEST_NOT_FOUND`, `MANIFEST_UNREADABLE`,
`MANIFEST_TOML_INVALID`, `MANIFEST_INVALID`, `APP_REQUIRED`, `APP_NOT_FOUND`,
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
answered `unchanged` (exit 0). A hosted app (`hosting.mode = "tassyir"`) is
answered by the API: `APP_HOSTING_NOT_AVAILABLE` until Tassyir Hosting opens.

## From code

The package's entry runs a command line in-process, with your own I/O (the
specs do this against a fake API):

```ts
import { runCli } from 'tassyir';

const exitCode = await runCli(['validate', '--json'], io);
```

`io` is a `CliIo`: stdout, stderr, the environment, the working folder,
`fetch`, a clock, and how to run a program. `DeveloperApi` is the typed
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
