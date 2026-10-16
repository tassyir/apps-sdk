---
'@tassyir/dev-mcp': patch
---

The Tassyir Hosting guide (`fetch_doc tassyir-hosting`) follows `@tassyir/app`'s hosted helpers: the `hosted` template and `tassyir deploy --dry-run`, `readHostedProps`, the page on `@tassyir/app-bridge/react`, `hostedAdmin` and `HOSTED_BINDING_ERRORS`, and webhooks verified with `verifyHostedWebhook` (Tassyir's keys read through `ctx.props.TASSYIR`, never pinned in the bundle); the errors guide points to the hosted helpers' codes. `scaffold` with `template: "hosted"` answers the hosted project's next steps (`npm run check`, `npm run deploy`; no `npm run setup`, no secret).
