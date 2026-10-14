// @tassyir/app-bridge: the embedded app page's side of the Tassyir App Bridge
// (tassyir/backend docs/APPS_PLATFORM_PLAN.md §3.9). Browser only, ESM only,
// no runtime dependency.

export { createAppBridge, DEFAULT_TIMEOUT_MS } from './bridge.js';
export type {
  AppBridge,
  AppBridgeOptions,
  BridgeEventListener,
  CallOptions,
} from './bridge.js';

export {
  AppBridgeError,
  SDK_ERROR_CODES,
  appBridgeFix,
  isAppBridgeError,
} from './errors.js';
export type {
  AppBridgeErrorCode,
  AppBridgeErrorOptions,
  SdkErrorCode,
} from './errors.js';

export {
  BRIDGE_CALLS,
  BRIDGE_EVENTS,
  BRIDGE_LIMITS,
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_RATE_LIMITS,
  BRIDGE_TOTAL_RATE_LIMIT,
  DASHBOARD_DESTINATIONS,
  DASHBOARD_ERROR_CODES,
  DEFAULT_DASHBOARD_ORIGIN,
  MODAL_FRAME_CALLS,
  MODAL_SIZES,
  PICK_TYPES,
  TOAST_TONES,
} from './protocol.js';
export type {
  BridgeCall,
  BridgeContext,
  BridgeEvent,
  BridgeEventPayloads,
  DashboardDestination,
  DashboardErrorCode,
  DashboardRecordDestination,
  IdTokenResult,
  ModalOpenPayload,
  ModalOpenResult,
  ModalSize,
  NavigatePayload,
  NavigateToAppPath,
  NavigateToDashboardPage,
  NavigateToDashboardRecord,
  PickType,
  PickedByType,
  PickedCollection,
  PickedCustomer,
  PickedProduct,
  ResourcePickPayload,
  ResourcePickResult,
  SaveBarShowPayload,
  TitleBarSetPayload,
  ToastShowPayload,
  ToastTone,
} from './protocol.js';
