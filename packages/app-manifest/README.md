# @tassyir/app-manifest

The schema and validator for `tassyir.app.toml`, the manifest of a
[Tassyir](https://tassyir.io) app (manifest v1, API version `2026-10`). Give it
the parsed manifest. It returns either the normalised manifest or every error
at once, each with a stable `code`, the `path` of the field, a `message` and a
one-sentence `fix`. The Tassyir API validates uploads with this same code, so a
manifest this package accepts is one the API accepts, with the same errors in
the same order.

It never throws, reads no file, clock or network, and runs in Node and in
browsers. ESM and CommonJS, named exports only.

## Install

```bash
npm install @tassyir/app-manifest
```

## Example

Parse the TOML with any TOML 1.0 parser ([`smol-toml`](https://www.npmjs.com/package/smol-toml) here), then validate:

```ts
import { readFileSync } from 'node:fs';
import { parse } from 'smol-toml';
import { validateManifest } from '@tassyir/app-manifest';

const result = validateManifest(
  parse(readFileSync('tassyir.app.toml', 'utf8')),
);

if (!result.ok) {
  for (const error of result.errors) {
    console.error(
      `${error.code} at ${error.path || '(document)'}: ${error.message} ${error.fix}`,
    );
  }
  process.exit(1);
}

console.log(result.manifest.access.scopes); // [ 'read_orders', 'read_products' ]
```

A hosted app (Tassyir Hosting):

```toml
name        = "Review Requests"
handle      = "review-requests"
api_version = "2026-10"

[access]
scopes          = ["read_orders", "read_products"]
optional_scopes = ["read_customer_contact"]

[access.scope_reasons]
read_orders           = "Find delivered orders to ask for a review"
read_products         = "Show the product in the review request"
read_customer_contact = "Send the review request to the buyer's phone"

[hosting]
mode          = "tassyir"
allowed_hosts = ["graph.facebook.com", "*.googleapis.com"]

[admin]
page = "/"

[[webhooks]]
topics = ["orders/delivered", "app/uninstalled"]
uri    = "/webhooks"

[[data.definitions]]
owner      = "product"
key        = "rating"
type       = "json"
visibility = "storefront"
```

An app on your own server, headless, with its compliance webhooks on another
host:

```toml
name        = "Sheets Sync"
handle      = "sheets-sync"
api_version = "2026-10"

[access]
scopes        = ["write_orders", "read_products"]
scope_reasons = { write_orders = "Create orders from the rows of your sheet", read_products = "Match sheet rows to your products" }

[hosting]
mode = "external"
url  = "https://sync.example.com/tassyir"

[auth]
callback_url = "https://sync.example.com/tassyir/callback"

[[webhooks]]
topics = ["orders/created", "products/updated"]
uri    = "/hooks"

[[webhooks]]
topics = ["customers/data_request", "customers/redact", "business/redact"]
uri    = "https://privacy.example.com/tassyir"
```

Both examples are validated by this package's tests, so they cannot drift from
the code.

## What you get back

```ts
{ ok: true,  manifest: AppManifest }   // the normalised manifest
{ ok: false, errors: ManifestError[] } // every error at once
```

The **normalised manifest** is what the API stores for a version: the file's
keys in a fixed order (`name`, `handle`, `api_version`, `access`, `hosting`,
`auth`, `admin`, `webhooks`, `data`, `storefront`); every list present (empty
when absent); `auth` and `admin` only when they hold a value; scopes, their
reasons and each webhook's topics in catalogue order, `allowed_hosts` sorted;
lists of tables in file order. Validating a normalised manifest returns it
unchanged.

An **error** looks like this:

```json
{
  "code": "MANIFEST_TOPIC_SCOPE_MISSING",
  "path": "webhooks[0].topics[1]",
  "message": "\"products/updated\" carries data that needs the \"read_products\" scope, which the manifest does not request.",
  "fix": "Add \"read_products\" to `access.scopes` (or `access.optional_scopes`), or remove \"products/updated\"."
}
```

`path` is the field in the parsed file (`""` for the whole document). The list
is sorted by field (manifest order, then array index), then code, so the same
document always gives the same errors in the same order, whatever the order of
its keys. One error per field. At most 50 errors, then
`MANIFEST_TOO_MANY_ERRORS`. A code is never renamed or reused:

| Code                                   | When                                                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `MANIFEST_NOT_A_TABLE`                 | The document is not a table (an array, a string, null, a date, a Map).                                          |
| `MANIFEST_NOT_DATA`                    | The document holds a cycle or a value JSON cannot carry.                                                        |
| `MANIFEST_TOO_LARGE`                   | Larger than 64 KB as JSON. Nothing else is checked.                                                             |
| `MANIFEST_TOO_MANY_ERRORS`             | Last entry when more than 50 errors were found.                                                                 |
| `MANIFEST_FIELD_REQUIRED`              | A required field is missing (`hosting.url` for an external app, `hosting.allowed_hosts` for a hosted one).      |
| `MANIFEST_FIELD_UNKNOWN`               | A key that is not a manifest field. The fix names the near key or lists the accepted ones.                      |
| `MANIFEST_FIELD_TYPE`                  | A value of the wrong type (a string where an array is expected, a TOML date).                                   |
| `MANIFEST_FIELD_NOT_FOR_MODE`          | `hosting.url`, `auth.callback_url` or an absolute webhook `uri` on a hosted app; `allowed_hosts` on external.   |
| `MANIFEST_LIST_TOO_LONG`               | A list over its limit.                                                                                          |
| `MANIFEST_LIST_EMPTY`                  | A webhook entry with no topic.                                                                                  |
| `MANIFEST_VALUE_NOT_ALLOWED`           | A value outside a fixed list (`hosting.mode`, a data definition's `owner`, `type`, `visibility`).               |
| `MANIFEST_NAME_INVALID`                | `name` empty, too long, on two lines, with an invisible character or surrounding spaces.                        |
| `MANIFEST_HANDLE_INVALID`              | `handle` is not 3-40 lowercase letters and digits joined by single hyphens.                                     |
| `MANIFEST_HANDLE_RESERVED`             | `handle` is reserved by Tassyir (`www`, `api`, `tassyir`, `google-sheets`, …).                                  |
| `MANIFEST_API_VERSION_UNSUPPORTED`     | `api_version` is not a supported version.                                                                       |
| `MANIFEST_SCOPE_UNKNOWN`               | Not a scope. The fix names the near scope or lists them.                                                        |
| `MANIFEST_SCOPE_NOT_AVAILABLE`         | A scope apps cannot request yet (`write_storefront`).                                                           |
| `MANIFEST_SCOPE_DUPLICATE`             | A scope listed twice in one list.                                                                               |
| `MANIFEST_SCOPE_REQUIRED_AND_OPTIONAL` | A scope in both `scopes` and `optional_scopes`.                                                                 |
| `MANIFEST_SCOPE_ALREADY_IMPLIED`       | An optional scope a required one already implies.                                                               |
| `MANIFEST_SCOPE_NEEDS_ANOTHER`         | A scope that opens nothing alone (`read_customer_contact` without `read_orders`).                               |
| `MANIFEST_SCOPE_REASON_MISSING`        | A requested scope without a reason.                                                                             |
| `MANIFEST_SCOPE_REASON_UNUSED`         | A reason for a scope the manifest does not request, or for a name that is not a scope.                          |
| `MANIFEST_SCOPE_REASON_INVALID`        | A reason too short, too long, on two lines or with an invisible character.                                      |
| `MANIFEST_URL_INVALID`                 | An absolute URL breaks a URL rule (http, port, credentials, query, fragment, capitals, a bad path).             |
| `MANIFEST_URL_HOST_NOT_ALLOWED`        | Such a URL points at an IP address, a private name or a Tassyir domain.                                         |
| `MANIFEST_PATH_INVALID`                | `admin.page` or a relative webhook `uri` breaks the path rules.                                                 |
| `MANIFEST_PATH_RESERVED`               | A hosted app's `admin.page` or webhook `uri` is `/.tassyir` or below it, which Tassyir keeps on hosted origins. |
| `MANIFEST_HOST_INVALID`                | An `allowed_hosts` entry is not a hostname (a URL, a port, a path, capitals, a misplaced wildcard).             |
| `MANIFEST_HOST_NOT_ALLOWED`            | An `allowed_hosts` entry is an IP address, a private name or a Tassyir domain.                                  |
| `MANIFEST_HOST_DUPLICATE`              | An `allowed_hosts` entry listed twice.                                                                          |
| `MANIFEST_TOPIC_UNKNOWN`               | Not a webhook topic. The fix names the near topic (`orders/create` → `orders/created`).                         |
| `MANIFEST_TOPIC_DUPLICATE`             | A topic subscribed twice in the manifest.                                                                       |
| `MANIFEST_TOPIC_SCOPE_MISSING`         | A topic whose resource needs a scope the manifest does not request.                                             |
| `MANIFEST_DATA_KEY_INVALID`            | A data definition's `key` is not `[a-z][a-z0-9_]{0,63}`.                                                        |
| `MANIFEST_DATA_KEY_DUPLICATE`          | Two data definitions with the same `owner` and `key`.                                                           |
| `MANIFEST_BLOCKS_NOT_AVAILABLE`        | `[[storefront.blocks]]` before they are available (Phase 2).                                                    |
| `MANIFEST_BLOCKS_SCOPE_MISSING`        | Storefront blocks without `write_storefront` (once available).                                                  |
| `MANIFEST_BLOCK_SCRIPT_NOT_ALLOWED`    | A block key that would put code on the storefront (`script`, `js`, `html`, `src`, `on…`).                       |
| `MANIFEST_BLOCK_HANDLE_INVALID`        | A block `handle` breaks the handle rules.                                                                       |
| `MANIFEST_BLOCK_HANDLE_DUPLICATE`      | Two blocks with the same handle.                                                                                |
| `MANIFEST_BLOCK_TEMPLATE_INVALID`      | A block `template` is not a lowercase relative `.liquid` path of the bundle.                                    |

## API

| Export                                                    | What it does                                                                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `validateManifest(input, vocabulary?)`                    | Validates a parsed manifest. The vocabulary defaults to `MANIFEST_VOCABULARY`.                                        |
| `validateManifestField('handle' \| 'name', value, path?)` | Checks one field with its manifest rule, code and fix (a form or a CLI prompt, before a manifest exists).             |
| `manifestJsonSchema(vocabulary?, apiVersion?)`            | The JSON Schema (draft 2020-12) of one API version, as an object.                                                     |
| `buildManifestSchema(vocabulary?, apiVersion?)`           | The zod 4 schema the JSON Schema is generated from.                                                                   |
| `manifestVersionColumns(manifest, vocabulary?)`           | From a normalised manifest: `{ apiVersion, scopes, optionalScopes, webhookTopics, allowedHosts }`.                    |
| `resolveManifestUri(manifest, uri)`                       | The absolute URL of `admin.page` or a webhook `uri`, and whether Tassyir reaches it as `hosted` or `external`.        |
| `hostedAppOrigin(handle)`                                 | `https://{handle}.tassyir-apps.com`.                                                                                  |
| `formatManifestPath(segments)`                            | `['webhooks', 0, 'uri']` → `webhooks[0].uri`, as error paths are written.                                             |
| `MANIFEST_VOCABULARY`                                     | The API versions, scopes (with what each implies) and webhook topics (with the scope each needs) of this release.     |
| `MANIFEST_ERROR_CODES`, `MANIFEST_LIMITS`, …              | The error codes, the limits, the reserved handles, domains and hosted path prefix, and the fixed lists, as constants. |

## JSON Schema

The JSON Schema of each API version ships with the package:
`@tassyir/app-manifest/schemas/manifest.2026-10.schema.json`. It states the shape
(types, required and unknown fields, list sizes, patterns) for editors and
agents. The validator also checks the rules across fields and the precise URL
and hostname rules, so a document the schema accepts can still be refused. In
an editor that reads schema directives (Taplo, Even Better TOML), start
`tassyir.app.toml` with:

```toml
#:schema ./node_modules/@tassyir/app-manifest/schemas/manifest.2026-10.schema.json
```

## The vocabulary, and keeping up with the API

`MANIFEST_VOCABULARY` is the data the validator checks against: supported API
versions, scopes and webhook topics. It equals what the Tassyir API builds from
its live catalogues, and the schema file is byte-for-byte the one the API
publishes. When the API adds a scope, a topic or an API version, a new release
of this package ships it; until you update, the validator refuses the new
names. The API itself passes its live vocabulary
(`validateManifest(input, vocabulary)`).

How the SDK repo proves that equality:
[docs/APP_MANIFEST.md](https://github.com/tassyir/apps-sdk/blob/main/docs/APP_MANIFEST.md).

## License

MIT
