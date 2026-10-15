---
'@tassyir/app': minor
---

Tassyir Hosting: `readHostedProps(ctx)` reads and checks `ctx.props` (`installation`, `viewer`, `STORAGE`, `TASSYIR`; `HOSTED_PROPS_MISSING` elsewhere), `hostedAdmin(props)` is the typed Admin API client sending its requests through `ctx.props.TASSYIR` with no token, and `verifyHostedWebhook(request, props)` checks a delivery Tassyir's dispatcher ran with no viewer by every rule of `verifyWebhook` (unchanged), the signature too when `keys` are given. `HOSTED_BINDING_ERRORS` lists the binding's own problem codes; the client never retries `RESPONSE_TOO_LARGE` or `TASSYIR_BINDING_NOT_AVAILABLE`. New verification code `WEBHOOK_NOT_A_DELIVERY`.
