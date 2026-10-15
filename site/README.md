# The developer docs site

The source of [developers.tassyir.io](https://developers.tassyir.io), a
[Mintlify](https://mintlify.com) site whose root is this folder (Mintlify's
monorepo path `/site`). This file is for its maintainers; it is not a page
(`.mintignore`).

## What is written here, and what is generated

| Path                    | What it is                                                          | Source                                                      |
| ----------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------- |
| `docs.json`             | Mintlify's config: theme, logo, navbar, playground, contextual menu | Written here                                                |
| `docs.json` (4 keys)    | `navigation`, `colors`, `background`, `fonts`                       | Generated: the guides' `order`, `@tassyir/ui`'s tokens      |
| `claude-code.mdx`       | The Claude Code plugin's install lines                              | Written here (a spec checks them against the marketplace)   |
| `logo/`                 | The ink and white logos and the app icon                            | The dashboard's public `brand/` assets                      |
| `guides/<slug>.mdx`     | One page per guide                                                  | Generated from [`docs/guides/<slug>.md`](../docs/guides)    |
| `errors/<code>.mdx`     | One page per problem code, at its `type` URL                        | Generated from the OpenAPI file and `docs/guides/errors.md` |
| `packages/<folder>.mdx` | One page per public package                                         | Generated from `packages/<folder>/README.md`                |
| `openapi/*.json`        | The API reference, rendered by Mintlify                             | Copied byte for byte from `packages/app/openapi/`           |

Never edit a generated file: edit its source, then run `npm run docs:sync`.
`scripts/docs-site.test.mjs` (in `npm test` and CI) fails while one is stale,
or when a page file is missing from the navigation.

Why the guides are copied rather than published where they are: Mintlify
parses `.md` as MDX (an HTML comment, `{` or `<` in prose breaks the build),
keeps a `webhooks.md` link as it is (and `/guides/webhooks.md` is that page's
Markdown mirror, not the page), and prints the front matter's title above the
guide's own `# Title`. The copies fix those three things and nothing else.

## Commands

| Command              | What it does                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `npm run docs:sync`  | Rewrites every generated file and `docs.json`'s generated keys (and `errors.md`'s table)     |
| `npm run docs:dev`   | The local preview at http://localhost:3000 (`-- --port 3333 --no-open` passes through)       |
| `npm run docs:check` | What CI runs: `mint validate`, `mint broken-links` with anchors, and the built routes listed |

The two `mint` commands install the pinned Mintlify CLI (`MINT_VERSION` in
`scripts/lib/docs-site.mjs`) into a scratch folder on first use, without
install scripts and with telemetry off. They need the network.

## What only the hosted site has

The local build has the pages and the API reference. The hosted site adds
`/llms.txt`, `/llms-full.txt`, the Markdown mirror of every page (`<page>.md`,
or `Accept: text/markdown`), the search index, the MCP server (`/mcp`), the
sitemap and the contextual menu (copy as Markdown, open in Claude or ChatGPT,
connect the MCP server). None of them answers on `mint dev`.
