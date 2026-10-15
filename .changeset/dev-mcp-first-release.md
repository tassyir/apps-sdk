---
'@tassyir/dev-mcp': minor
---

First release: an MCP server over stdio for the AI agent that builds a Tassyir app (`claude mcp add tassyir -- npx -y @tassyir/dev-mcp`). `search_docs` and `fetch_doc` over the developer guides, `get_api_operation` and `get_event_schema` over the Admin API's OpenAPI document (API version 2026-10, shipped inside the package), `validate_manifest` with the API's own validator, `scaffold` from `create-tassyir-app`, and `trigger_test_webhook`, `seed_dev_store` and `list_dev_stores` through the developer API with the sign-in of `tassyir login` (the token is never in an answer). `validate_block`, `tail_logs` and `run_review_checks` answer `TOOL_NOT_AVAILABLE` until the marketplace and Tassyir Hosting exist. Every tool has a JSON Schema input and output; every answer is at most 8 KB; every refusal is `{ error: { code, message, fix } }`.
