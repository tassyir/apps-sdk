---
'@tassyir/app': patch
---

The Admin API types follow the API's OpenAPI document at backend `46a49b6b`: a 401 can carry `HOSTED_CALL_REFUSED` (a hosted app's call through `ctx.props.TASSYIR` that can no longer run as its installation), and `WWW-Authenticate` names the `Tassyir-Hosted` challenge.
