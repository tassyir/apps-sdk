# Developer guides

The public guides for building Tassyir apps, in Markdown. The docs site at
`developers.tassyir.io` publishes them from here ([site](../../site/README.md)).
Start reading at [index.md](index.md). This file is for people and agents who
write the guides; it is not a guide itself.

## The rules

- **One guide per topic**, each starting from what the developer wants to
  do. English first.
- **Front matter**, exactly these three keys:

  ```yaml
  ---
  title: Webhooks
  description: One sentence, at most 200 characters, ending with a full stop.
  order: 70
  ---
  ```

  `order` places the guide in the site's navigation (steps of 10 leave room
  for new guides); titles and orders are unique. Quote a description that
  holds `: `. The body's first line of text is `# <title>`.

- **The file name is the slug** (`webhooks.md` → `/guides/webhooks`):
  lowercase words joined by `-`. Never rename a guide; the site, `llms.txt`
  and other guides link to it.
- **Links between guides are relative** (`[Webhooks](webhooks.md#topics)`),
  and every anchor must exist. Links outside are https, and never to a
  private repository.
- **Public content only.** A guide describes the contract an app sees, never
  how Tassyir implements it: no source paths, class names, tables, cache
  keys, environment variables, infrastructure, internal hosts or ticket ids.
  `scripts/guides.test.mjs` refuses the common ones (`LEAK_PATTERNS` in
  `scripts/lib/guides.mjs`); a reviewer catches the rest.
- **Money is a decimal string** in every sample, and samples never hold a real
  secret, token, phone number or customer.

## Code samples

Every fenced block is checked:

| Fence        | Check                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| `ts`         | Server code: typechecked as an ES module against the **packed** packages, Node 22 types, no DOM.        |
| `ts browser` | Page code: typechecked against the packed packages with the DOM, no Node.                               |
| `toml`       | Parsed. A whole manifest (it has `api_version`) must pass `@tassyir/app-manifest`'s `validateManifest`. |
| `json`       | Parsed.                                                                                                 |
| others       | Not checked (`bash`, `http`, `yaml`).                                                                   |

A sample may use, without declaring them, the names the guides set up once:
`tassyir` (a `TassyirApp`), `admin` (an `AdminClient`), `installationId` (a
string) and, in page code, `bridge` (an `AppBridge`). Anything else it
declares or imports itself.

## Commands

| Command                 | What it does                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`              | `scripts/guides.test.mjs`: front matter, links, leaks, TOML and JSON samples, and errors.md up to date                          |
| `npm run check:guides`  | Packs the packages, installs them in a scratch project and typechecks every `ts` sample (needs `npm run build` and the network) |
| `npm run guides:errors` | Rewrites the generated part of [errors.md](errors.md) from the OpenAPI document `@tassyir/app` is typed from                    |
| `npm run docs:sync`     | Rewrites the docs site's page of each guide and its navigation (`order`); a test fails until you do                             |

[errors.md](errors.md) lists every code of that OpenAPI document; it moves
with the document. After `npm run openapi:update -w @tassyir/app`, run
`npm run guides:errors`. Its "Common errors" headings must name codes the
document has.
