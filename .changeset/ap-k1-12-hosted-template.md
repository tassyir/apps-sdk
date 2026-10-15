---
'create-tassyir-app': minor
---

The `hosted` template is available (`--template hosted`): an app on Tassyir Hosting, a Cloudflare Worker (Hono) that reads its installation, its own SQLite storage and the Admin API from `ctx.props`, a React page on `@tassyir/app-bridge/react` and `@tassyir/ui` (ar/en, right to left, dark), webhooks through `verifyHostedWebhook`, specs in workerd with stand-in `ctx.props`, `npm run deploy:check` (the checks `tassyir deploy` runs before it uploads) and `npm run deploy`. `--url` is refused for it (`OPTION_NOT_FOR_TEMPLATE`), a hosted project names `tassyir` among its dependencies, the `tassyir-app` skill covers both hosting modes, and `createProject`'s `dependencies` name only what the template's `package.json` does.
