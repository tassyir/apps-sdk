---
'@tassyir/dev-mcp': patch
---

`get_api_operation` also answers the developer API, what the `tassyir` CLI calls (apps, versions, client secrets, dev stores, the webhook console, the CLI sign-in), from its OpenAPI document shipped in the package. An operation is found by its id or by `METHOD /developer/…` as before; `api: "developer"` lists the developer operations or reads one of its schemas, and every answer names its `api`. A status whose body may be one of several lists them (`shapes`), so an agent knows when a refusal can come without a `code`. Fixed: `seed_dev_store` accepts a dev store whose store has no subdomain yet (`null`), as the API documents.
