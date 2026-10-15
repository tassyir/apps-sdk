---
'@tassyir/app-bridge': minor
---

React bindings at `@tassyir/app-bridge/react` (React 18 or 19, an optional peer dependency): `AppBridgeProvider` (creates the page's bridge in an effect, or takes the one you made), `useAppBridge`, `useBridgeContext`, `useBridgeEvent`, `useTitleBar` and `useSaveBar` (they call the dashboard from effects and return a refusal as state), `useModal` and `useResourcePicker` (with whether their dialog is open), `useToast`, `useNavigate`, `useIdToken`. They add React state and nothing else. New SDK error code `NO_PROVIDER` (a hook outside the provider).
