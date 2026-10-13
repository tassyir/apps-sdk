# Tassyir Apps SDK

Packages for building apps on [Tassyir](https://tassyir.io): apps that merchants install, which call the Tassyir Admin API, receive signed webhooks and show pages inside the Tassyir dashboard.

**Status: in development. Nothing is published yet.**

## Planned packages

| Package | What it is |
|---|---|
| `@tassyir/app-manifest` | The `tassyir.app.toml` manifest schema and validator |
| `@tassyir/app` | Typed Admin API client, token handling, webhook and ID-token verification |
| `@tassyir/app-bridge` | The embedded page's side of the dashboard bridge |
| `@tassyir/ui` | Web components that match the Tassyir dashboard (RTL, dark mode) |
| `tassyir` | The CLI: `app init`, `dev`, `validate`, `deploy`, `logs`, `webhook trigger` |
| `create-tassyir-app` | Starter templates |
| `@tassyir/dev-mcp` | An MCP server with the Tassyir developer docs and tools |

Packages will be published to the public npm registry under the `@tassyir` scope.
