---
'@tassyir/dev-mcp': patch
---

New guide, Tassyir Hosting (`fetch_doc tassyir-hosting`): deploying a hosted app, the scan's checks and findings, `ctx.props`, storage, egress and webhooks; the errors guide explains `HOSTED_CALL_REFUSED` and the hosted binding's own codes. `get_api_operation` serves both documents at backend `46a49b6b` (`HOSTED_CALL_REFUSED` on every Admin API 401; `refusal` on every deploy state of a hosted version), and `validate_manifest` refuses a hosted app's page or webhook under `/.tassyir/`.
