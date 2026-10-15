# @tassyir/app-bridge

## 0.2.0

### Minor Changes

- acb578f: React bindings at `@tassyir/app-bridge/react` (React 18 or 19, an optional peer dependency): `AppBridgeProvider` (creates the page's bridge in an effect, or takes the one you made), `useAppBridge`, `useBridgeContext`, `useBridgeEvent`, `useTitleBar` and `useSaveBar` (they call the dashboard from effects and return a refusal as state), `useModal` and `useResourcePicker` (with whether their dialog is open), `useToast`, `useNavigate`, `useIdToken`. They add React state and nothing else. New SDK error code `NO_PROVIDER` (a hook outside the provider).

## 0.1.0

### Minor Changes

- 5bc0d3c: First release: the embedded page's side of the Tassyir App Bridge. `createAppBridge()` talks to the dashboard over `postMessage` (its exact origin only, replies matched by id, a timeout per call) and offers every call of the protocol, typed: `idToken`, `toast.show`, `modal.open` / `modal.close`, `navigate`, `saveBar.show` / `saveBar.hide`, `titleBar.set`, `resource.pick` and `context.get`, with the `context.changed`, `saveBar.save` and `saveBar.discard` events. Payloads are checked before posting; refusals are `AppBridgeError`s with a stable `code` and a `fix`. Browser only, ESM only, no runtime dependency.
