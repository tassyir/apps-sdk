---
'@tassyir/app-bridge': minor
---

First release: the embedded page's side of the Tassyir App Bridge. `createAppBridge()` talks to the dashboard over `postMessage` (its exact origin only, replies matched by id, a timeout per call) and offers every call of the protocol, typed: `idToken`, `toast.show`, `modal.open` / `modal.close`, `navigate`, `saveBar.show` / `saveBar.hide`, `titleBar.set`, `resource.pick` and `context.get`, with the `context.changed`, `saveBar.save` and `saveBar.discard` events. Payloads are checked before posting; refusals are `AppBridgeError`s with a stable `code` and a `fix`. Browser only, ESM only, no runtime dependency.
