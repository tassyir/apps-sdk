---
'tassyir': minor
---

The developer API client is typed from the API's own OpenAPI document (`developer/*`, vendored at backend `08da6223`) instead of hand-written types. The commands, their flags, their `--json` output and exit codes are unchanged; a refusal without a code still reads as `BAD_REQUEST`, `RATE_LIMITED` or `SERVER_ERROR` by status. For code that imports the library entry, the exported types are now the document's: `DeveloperApp.status` and `hostingMode` are strings, a replay's `outcome` may be `missing`, a dev store's `store.subdomain` may be null, `testWebhook` and `listDeliveries` take a `WebhookTopic`, and `SignInRequest.locale` is `'ar' | 'en'`. New exports: `WebhookTopic`, `AppVersionDetail`, `DeveloperApiErrorBody`, and the generated `DeveloperApiPaths`, `DeveloperApiOperations` and `DeveloperApiComponents`.
