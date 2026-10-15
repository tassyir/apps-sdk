---
'@tassyir/app': minor
---

Tassyir Hosting: `readHostedProps(ctx)` reads and checks `ctx.props` (`installation`, `viewer`, `STORAGE`, `TASSYIR`; `HOSTED_PROPS_MISSING` elsewhere), `hostedAdmin(props)` is the typed Admin API client sending its requests through `ctx.props.TASSYIR` with no token, `verifyHostedWebhook(request, props)` checks a delivery by every rule of `verifyWebhook` (unchanged), the signature verified with Tassyir's keys read through `ctx.props.TASSYIR` (`hostedWebhookKeys(props)`, per request; it never skips the signature: unreadable keys are `KEYS_UNAVAILABLE`), the envelope's installation, business and app taken from `ctx.props`, and a request with a viewer refused. `HOSTED_BINDING_ERRORS` lists the binding's own problem codes; the client never retries `RESPONSE_TOO_LARGE` or `TASSYIR_BINDING_NOT_AVAILABLE`. New verification code `WEBHOOK_NOT_A_DELIVERY`.
