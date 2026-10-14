// Every refusal is an AppBridgeError: a stable `code` to act on, a `message`
// for people and a one-sentence `fix` an agent can follow. The dashboard's
// own replies carry a code and nothing else (§3.9), so their message and fix
// come from here.

import type { BridgeCall, DashboardErrorCode } from './protocol.js';

/** Raised by this SDK, never sent by the dashboard. */
export const SDK_ERROR_CODES = [
  'NOT_EMBEDDED',
  'TIMEOUT',
  'ABORTED',
  'DESTROYED',
  'INVALID_REPLY',
  'NOT_IN_BROWSER',
  'INVALID_ARGUMENT',
] as const;
export type SdkErrorCode = (typeof SDK_ERROR_CODES)[number];

export type AppBridgeErrorCode = DashboardErrorCode | SdkErrorCode;

const FIXES: Readonly<Record<AppBridgeErrorCode, string>> = {
  INVALID_PAYLOAD:
    "Send the payload the README gives for this call (the error's path names the field); the SDK checks most rules before posting.",
  RATE_LIMITED:
    'Call less often: the dashboard takes a limited number of each call per minute (README, "Limits"); try again after a pause.',
  ID_TOKEN_UNAVAILABLE:
    'Tassyir cannot sign ID tokens right now and the dashboard tells the merchant so; offer a retry later.',
  APP_UNAVAILABLE:
    'Stop: the installation can no longer be opened (uninstalled, suspended, or no admin page), and the dashboard shows its own state.',
  PERMISSION_DENIED:
    'The signed-in member may not do this; tell them to ask the business owner for access, and do not retry.',
  SCOPE_REQUIRED:
    "Add the scope that reads this resource to the manifest's access scopes (read_products for products and collections, read_customers for customers), then have the merchant accept the update.",
  STORE_NOT_ALLOWED:
    "The installation is limited to selected stores and the dashboard is on another one; ask the merchant to switch to one of the app's stores.",
  NO_STORE:
    "Collections come from the dashboard's current store; ask the merchant to open one of their stores first.",
  BUSY: 'Wait until the open modal or picker closes (its call resolves then); a page cannot pick while its own modal is open.',
  NO_MODAL: 'No modal is open, so there is nothing to close.',
  NOT_ALLOWED_HERE:
    'A modal may only call idToken, toast.show, modal.close, resource.pick and context.get; make this call from the page.',
  INVALID_DESTINATION:
    'The dashboard cannot open that place now (products needs a current store; a path must stay short once encoded); choose another destination.',
  FAILED: 'Something failed on the dashboard side; try again.',
  NOT_EMBEDDED:
    'Open the page from the Tassyir dashboard (Apps, then your app): the bridge only works inside its frame.',
  TIMEOUT:
    'Make sure the page is open inside the Tassyir dashboard and dashboardOrigin is unset (or the exact local dashboard origin), then try again.',
  ABORTED:
    "The call's AbortSignal fired; nothing to fix unless that was unexpected.",
  DESTROYED:
    'This bridge was destroyed: create a new one with createAppBridge().',
  INVALID_REPLY:
    'Update @tassyir/app-bridge: the dashboard answered in a shape this version does not read.',
  NOT_IN_BROWSER:
    'Create the bridge in the browser (in an effect or a client-only module), never while rendering on a server.',
  INVALID_ARGUMENT:
    'Check the argument against the README: dashboardOrigin an exact origin, timeoutMs a positive number, on() an event the dashboard sends.',
};

export interface AppBridgeErrorOptions {
  call?: BridgeCall | null;
  /** `dashboard`: the dashboard's reply; `sdk`: refused or failed before an answer. */
  source: 'dashboard' | 'sdk';
  /** The payload field at fault (INVALID_PAYLOAD from the SDK's own checks). */
  path?: string | null;
  fix?: string;
  cause?: unknown;
}

export class AppBridgeError extends Error {
  /** Stable and machine-readable: act on it, never on `message`. */
  readonly code: AppBridgeErrorCode;
  /** The call that failed, or null (the bridge itself). */
  readonly call: BridgeCall | null;
  /** Who refused: the dashboard's reply, or this SDK before or instead of one. */
  readonly source: 'dashboard' | 'sdk';
  /** The payload field at fault, when the SDK's own check names one. */
  readonly path: string | null;
  /** One sentence saying how to fix it. */
  readonly fix: string;

  constructor(
    code: AppBridgeErrorCode,
    message: string,
    options: AppBridgeErrorOptions,
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'AppBridgeError';
    this.code = code;
    this.call = options.call ?? null;
    this.source = options.source;
    this.path = options.path ?? null;
    this.fix = options.fix ?? FIXES[code];
  }
}

/** The fix sentence for a code. */
export function appBridgeFix(code: AppBridgeErrorCode): string {
  return FIXES[code];
}

/** Narrows an unknown error, optionally to one code. */
export function isAppBridgeError(
  error: unknown,
  code?: AppBridgeErrorCode,
): error is AppBridgeError {
  return (
    error instanceof AppBridgeError &&
    (code === undefined || error.code === code)
  );
}
