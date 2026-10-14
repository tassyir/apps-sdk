// The App Bridge contract as data and types: tassyir/backend
// docs/APPS_PLATFORM_PLAN.md §3.9, the dashboard's side of which is the
// frontend's lib/apps/bridge-protocol.ts. Change §3.9 first, then this file.

/** `tsy` in every envelope. */
export const BRIDGE_PROTOCOL_VERSION = 1;

/** Where the dashboard runs. Messages go to this origin only, never `*`. */
export const DEFAULT_DASHBOARD_ORIGIN = 'https://app.tassyir.io';

/** The calls an app page may make. */
export const BRIDGE_CALLS = [
  'idToken',
  'toast.show',
  'modal.open',
  'modal.close',
  'navigate',
  'saveBar.show',
  'saveBar.hide',
  'titleBar.set',
  'resource.pick',
  'context.get',
] as const;
export type BridgeCall = (typeof BRIDGE_CALLS)[number];

/** The calls an app's modal (a page opened with `modal.open`) may make. */
export const MODAL_FRAME_CALLS: readonly BridgeCall[] = [
  'idToken',
  'toast.show',
  'modal.close',
  'resource.pick',
  'context.get',
];

/** What the dashboard sends without being asked. */
export const BRIDGE_EVENTS = [
  'context.changed',
  'saveBar.save',
  'saveBar.discard',
] as const;
export type BridgeEvent = (typeof BRIDGE_EVENTS)[number];

/** Why the dashboard refused a call (`error.code` in its reply). */
export const DASHBOARD_ERROR_CODES = [
  'INVALID_PAYLOAD',
  'RATE_LIMITED',
  'ID_TOKEN_UNAVAILABLE',
  'APP_UNAVAILABLE',
  'PERMISSION_DENIED',
  'SCOPE_REQUIRED',
  'STORE_NOT_ALLOWED',
  'NO_STORE',
  'BUSY',
  'NO_MODAL',
  'NOT_ALLOWED_HERE',
  'INVALID_DESTINATION',
  'FAILED',
] as const;
export type DashboardErrorCode = (typeof DASHBOARD_ERROR_CODES)[number];

/** Dashboard pages `navigate` may open. `order` and `customer` take an `id`. */
export const DASHBOARD_DESTINATIONS = [
  'home',
  'orders',
  'order',
  'customers',
  'customer',
  'tracking',
  'inventory',
  'products',
  'apps',
] as const;
export type DashboardDestination = (typeof DASHBOARD_DESTINATIONS)[number];
export type DashboardRecordDestination = 'order' | 'customer';

export const PICK_TYPES = ['product', 'collection', 'customer'] as const;
export type PickType = (typeof PICK_TYPES)[number];

export const TOAST_TONES = ['info', 'success', 'error'] as const;
export type ToastTone = (typeof TOAST_TONES)[number];

export const MODAL_SIZES = ['small', 'medium', 'large'] as const;
export type ModalSize = (typeof MODAL_SIZES)[number];

/** The caps §3.9 sets on what an app sends and receives. */
export const BRIDGE_LIMITS = {
  /** Text (`message`, `title`) longer than this, as sent, is refused. */
  textMaxLength: 2000,
  /** A toast shows at most this many characters; longer text is cut with "…". */
  toastShownLength: 150,
  /** A title (title bar, modal) shows at most this many characters. */
  titleShownLength: 80,
  /** An app path, query included. */
  pathMaxLength: 2048,
  /** An app path before its `?`. */
  pathBeforeQueryMaxLength: 1024,
  /** A `?query` as the dashboard writes it back (`URLSearchParams`), `?` included. */
  queryMaxLength: 1024,
  /** An envelope id, and a dashboard destination's record id: `[A-Za-z0-9_-]`. */
  idMaxLength: 64,
  /** Items in one `resource.pick` answer. */
  pickMaxItems: 50,
} as const;

/** Calls per installation over a sliding minute (§3.9 "Rate limits"). */
export const BRIDGE_RATE_LIMITS: Readonly<Record<BridgeCall, number>> = {
  idToken: 30,
  'toast.show': 20,
  'modal.open': 10,
  'modal.close': 30,
  navigate: 30,
  'saveBar.show': 60,
  'saveBar.hide': 60,
  'titleBar.set': 60,
  'resource.pick': 10,
  'context.get': 60,
};

/** Messages of any kind per minute; past it the dashboard drops them unanswered. */
export const BRIDGE_TOTAL_RATE_LIMIT = 240;

// ── Payloads (what an app sends) ───────────────────────────────────────────

export interface ToastShowPayload {
  /** Shown as text: control and bidi characters become spaces, cut to 150 characters. */
  message: string;
  /** Default `info`. */
  tone?: ToastTone;
}

export interface ModalOpenPayload {
  /** An app path (see `navigate`), shown in a dashboard modal. */
  path: string;
  /** Beside the app's name in the modal's header; cut to 80 characters. */
  title?: string | null;
  /** Default `medium`. */
  size?: ModalSize;
}

export interface NavigateToAppPath {
  /**
   * Another page of the app, relative to its `admin.page`: `/reviews/2?tab=sent`.
   * Starts with `/`; no scheme, `//`, backslash, white space, control character,
   * fragment, or `.`, `..` or empty segment.
   */
  path: string;
  /** Replace the dashboard's history entry instead of adding one. */
  replace?: boolean;
}

export interface NavigateToDashboardRecord {
  dashboard: DashboardRecordDestination;
  /** 1-64 characters of `[A-Za-z0-9_-]`. */
  id: string;
}

export interface NavigateToDashboardPage {
  dashboard: Exclude<DashboardDestination, DashboardRecordDestination>;
}

export type NavigatePayload =
  NavigateToAppPath | NavigateToDashboardRecord | NavigateToDashboardPage;

export interface SaveBarShowPayload {
  /** Shows the bar busy (saving). */
  saving?: boolean;
}

export interface TitleBarSetPayload {
  /** Beside the app's name in the title bar, cut to 80 characters; `null` or `""` clears it. */
  title: string | null;
}

export interface ResourcePickPayload<T extends PickType = PickType> {
  type: T;
  /** Let the merchant pick several (at most 50). Default one. */
  multiple?: boolean;
}

// ── Replies and events (what the dashboard sends) ──────────────────────────

/** The dashboard's state an app page cannot see by itself. */
export interface BridgeContext {
  locale: 'ar' | 'en';
  dir: 'rtl' | 'ltr';
  theme: 'light' | 'dark';
  /** The dashboard's current store, or null (none, or one the installation is not limited to). */
  storeId: string | null;
}

export interface IdTokenResult {
  /** A 60-second ID token. Send it to your server once; never keep it. */
  token: string;
}

export interface ModalOpenResult {
  /** `app`: `modal.close`; `merchant`: the merchant closed it. */
  closedBy: 'app' | 'merchant';
}

export interface PickedProduct {
  id: string;
  name: string;
  /** An https URL, or null. */
  image: string | null;
}

export interface PickedCollection {
  id: string;
  name: string;
}

export interface PickedCustomer {
  id: string;
  /** The wilaya, or null. */
  provinceCode: number | null;
  /** Only when the installation holds `read_customer_contact`. */
  name?: string | null;
  /** Only with `read_customer_contact`; masked while the plan hides phones. */
  phone?: string | null;
}

export interface PickedByType {
  product: PickedProduct;
  collection: PickedCollection;
  customer: PickedCustomer;
}

export interface ResourcePickResult<T extends PickType = PickType> {
  /** Empty when the merchant cancelled; one item unless `multiple`. */
  selection: PickedByType[T][];
}

/** Each event's payload. */
export interface BridgeEventPayloads {
  'context.changed': BridgeContext;
  'saveBar.save': Record<string, never>;
  'saveBar.discard': Record<string, never>;
}
