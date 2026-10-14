// The app page's side of the App Bridge (tassyir/backend
// docs/APPS_PLATFORM_PLAN.md §3.9): postMessage to the dashboard's exact
// origin, replies matched by id, a timeout per call, refusals as
// AppBridgeError, and the duties §3.9 gives an SDK.

import { AppBridgeError, type AppBridgeErrorCode } from './errors.js';
import { buildPayload } from './payloads.js';
import {
  BRIDGE_EVENTS,
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_RATE_LIMITS,
  BRIDGE_TOTAL_RATE_LIMIT,
  DASHBOARD_ERROR_CODES,
  DEFAULT_DASHBOARD_ORIGIN,
  type BridgeCall,
  type BridgeContext,
  type BridgeEvent,
  type BridgeEventPayloads,
  type IdTokenResult,
  type ModalOpenPayload,
  type ModalOpenResult,
  type NavigatePayload,
  type PickType,
  type ResourcePickPayload,
  type ResourcePickResult,
  type SaveBarShowPayload,
  type TitleBarSetPayload,
  type ToastShowPayload,
} from './protocol.js';
import {
  readContext,
  readIncoming,
  readResult,
  sameContext,
  type Incoming,
} from './replies.js';

/** How long a call waits for the dashboard's answer, by default. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * How long the bridge keeps saying hello (`context.get`) on its own until the
 * dashboard answers: §3.9's 15 s "ready" window. A call made later says hello
 * again.
 */
const CONNECT_WINDOW_MS = 15_000;
const FIRST_RETRY_MS = 50;
const MAX_RETRY_MS = 1_000;
const MINUTE_MS = 60_000;

/**
 * Answered when the merchant closes the dialog, however long that takes: the
 * timeout covers reaching the dashboard, not the answer.
 */
const WAITS_FOR_MERCHANT: ReadonlySet<BridgeCall> = new Set([
  'modal.open',
  'resource.pick',
]);

export interface AppBridgeOptions {
  /**
   * The dashboard's origin. Leave it unset: apps run inside
   * `https://app.tassyir.io`. Set it only to run against a dashboard on your
   * own machine or a staging dashboard (`http://localhost:3000`), and never
   * from the page's address or query string. Must be an exact origin: https,
   * or http on localhost. Never `*`.
   */
  dashboardOrigin?: string;
  /** Default timeout of each call, in ms. Default 10,000. */
  timeoutMs?: number;
}

export interface CallOptions {
  /**
   * Overrides the bridge's timeout for this call. For `modal.open` and
   * `resource.pick` it covers reaching the dashboard only: once posted they
   * wait for the merchant.
   */
  timeoutMs?: number;
  /** Stop waiting (the call rejects `ABORTED`); the dashboard is not told. */
  signal?: AbortSignal;
}

export type BridgeEventListener<E extends BridgeEvent> = (
  payload: BridgeEventPayloads[E],
) => void;

/**
 * The App Bridge of one app page. Each call posts one message to the
 * dashboard and resolves with its reply's payload, or rejects with an
 * `AppBridgeError` carrying the refusal's code.
 */
export interface AppBridge {
  /** False when the page is not inside a frame: every call then rejects `NOT_EMBEDDED`. */
  readonly embedded: boolean;
  /** True once the dashboard has answered or spoken: it is listening. */
  readonly connected: boolean;
  /** The origin every message goes to and every accepted message comes from. */
  readonly dashboardOrigin: string;

  /**
   * A new 60-second ID token for this installation and the signed-in member,
   * minted on every call and never cached. Send it to your server, where
   * `@tassyir/app` verifies it or exchanges it (once: the token endpoint
   * accepts each ID token one time). It is the only proof of who is looking.
   * Refusals: `ID_TOKEN_UNAVAILABLE`, `APP_UNAVAILABLE`, `PERMISSION_DENIED`,
   * `FAILED`, `RATE_LIMITED` (30 a minute).
   */
  idToken(options?: CallOptions): Promise<IdTokenResult>;

  toast: {
    /** A toast signed with the app's name. 20 a minute. */
    show(payload: ToastShowPayload, options?: CallOptions): Promise<void>;
  };

  modal: {
    /**
     * One of the app's pages in a dashboard modal; resolves when the modal
     * closes. Refusals: `BUSY` (a modal or picker is open),
     * `INVALID_DESTINATION`, `NOT_ALLOWED_HERE` (from a modal). 10 a minute.
     */
    open(
      payload: ModalOpenPayload,
      options?: CallOptions,
    ): Promise<ModalOpenResult>;
    /** Closes the modal, from the page or the modal itself. `NO_MODAL` when none is open. */
    close(options?: CallOptions): Promise<void>;
  };

  /**
   * `{ path }`: the app moved to another of its own pages (the frame is not
   * reloaded; the dashboard's address follows). `{ dashboard, id? }`: leave
   * the app for a dashboard page. Refusals: `INVALID_DESTINATION`,
   * `NOT_ALLOWED_HERE`. 30 a minute.
   */
  navigate(payload: NavigatePayload, options?: CallOptions): Promise<void>;

  saveBar: {
    /** Shows the dashboard's save bar; its buttons send `saveBar.save` / `saveBar.discard` (see `on`). */
    show(payload?: SaveBarShowPayload, options?: CallOptions): Promise<void>;
    hide(options?: CallOptions): Promise<void>;
  };

  titleBar: {
    /** The page's title beside the app's name; `{ title: null }` clears it. */
    set(payload: TitleBarSetPayload, options?: CallOptions): Promise<void>;
  };

  resource: {
    /**
     * Opens the dashboard's picker; resolves when the merchant closes it
     * (`selection` empty when cancelled). Refusals: `SCOPE_REQUIRED`,
     * `PERMISSION_DENIED`, `STORE_NOT_ALLOWED`, `NO_STORE`, `BUSY`. 10 a minute.
     */
    pick<T extends PickType>(
      payload: ResourcePickPayload<T>,
      options?: CallOptions,
    ): Promise<ResourcePickResult<T>>;
  };

  context: {
    /** Asks the dashboard for its context (locale, direction, theme, store). */
    get(options?: CallOptions): Promise<BridgeContext>;
    /** The latest context the dashboard sent, or null before the first. */
    readonly current: BridgeContext | null;
  };

  /**
   * Listens to what the dashboard sends: `context.changed` (only when the
   * context really changed), `saveBar.save`, `saveBar.discard`. Returns the
   * function that stops listening.
   */
  on<E extends BridgeEvent>(
    event: E,
    listener: BridgeEventListener<E>,
  ): () => void;

  /** Stops listening and rejects every waiting call with `DESTROYED`. */
  destroy(): void;
}

interface Pending {
  call: BridgeCall;
  resolve: (value: unknown) => void;
  reject: (error: AppBridgeError) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
  stopAbort: (() => void) | undefined;
}

interface Queued {
  id: string;
  call: BridgeCall;
  payload: Record<string, unknown>;
}

const LOOPBACK_HOST = /^(?:localhost|[^.]+\.localhost|127\.0\.0\.1|\[::1\])$/;

/** The dashboard origin to use, or why the option is refused. */
function dashboardOriginOf(value: unknown): string {
  if (value === undefined) return DEFAULT_DASHBOARD_ORIGIN;
  const refuse = (why: string) =>
    new AppBridgeError('INVALID_ARGUMENT', `dashboardOrigin ${why}.`, {
      source: 'sdk',
      fix: 'Leave dashboardOrigin unset in production; for a local or staging dashboard pass its exact origin, like http://localhost:3000.',
    });
  if (typeof value !== 'string') throw refuse('must be a string');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw refuse(`"${value}" is not an origin ("*" is never accepted)`);
  }
  if (url.origin !== value) {
    throw refuse(
      `"${value}" is not an exact origin (scheme and host, no path or trailing slash)`,
    );
  }
  if (url.protocol === 'https:') return value;
  if (url.protocol === 'http:' && LOOPBACK_HOST.test(url.hostname)) {
    return value;
  }
  throw refuse(`"${value}" must be https (http only on localhost)`);
}

/** A timeout in ms, or the error that refuses it. */
function timeoutOf(
  value: unknown,
  fallback: number,
  what: string,
): number | AppBridgeError {
  if (value === undefined) return fallback;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  return new AppBridgeError(
    'INVALID_ARGUMENT',
    `${what} must be a positive number of milliseconds.`,
    {
      source: 'sdk',
      fix: 'Pass timeoutMs as a positive number, or leave it out.',
    },
  );
}

let fallbackCounter = 0;

/**
 * An envelope id: a uuid where the page is a secure context (`randomUUID`
 * exists only there), else random base 36 plus a counter. Ids only need to
 * be unique: the origin and window checks decide who may answer.
 */
function newMessageId(): string {
  const webCrypto = globalThis.crypto as Partial<Crypto> | undefined;
  if (webCrypto?.randomUUID) return webCrypto.randomUUID();
  const bytes = new Uint8Array(12);
  if (webCrypto?.getRandomValues) webCrypto.getRandomValues(bytes);
  else bytes.forEach((_, index) => (bytes[index] = Math.random() * 256));
  fallbackCounter += 1;
  return `m${Array.from(bytes, (byte) => byte.toString(36)).join('')}${fallbackCounter.toString(36)}`;
}

/**
 * Messages this page posted that the dashboard counted, per call and in all,
 * over the last minute: never more than the dashboard counts, so a refusal
 * here is one the dashboard would make too.
 */
function createLimiter() {
  const sent = new Map<string, number[]>();
  const recent = (key: string, now: number) => {
    const times = (sent.get(key) ?? []).filter((at) => now - at < MINUTE_MS);
    sent.set(key, times);
    return times;
  };
  return {
    /** Records one message, or says which limit it would break. */
    take(call: BridgeCall, now: number): 'ok' | 'call' | 'total' {
      const all = recent('*', now);
      if (all.length >= BRIDGE_TOTAL_RATE_LIMIT) return 'total';
      const mine = recent(call, now);
      if (mine.length >= BRIDGE_RATE_LIMITS[call]) return 'call';
      all.push(now);
      mine.push(now);
      return 'ok';
    },
    /** Counts a message sent at `at` outside `take` (an answered hello). */
    record(call: BridgeCall, at: number) {
      sent.set('*', [...(sent.get('*') ?? []), at]);
      sent.set(call, [...(sent.get(call) ?? []), at]);
    },
  };
}

/** The dashboard's window, or null when the page is not framed (or detached). */
function parentOf(page: Window): Window | null {
  const parent = page.parent as Window | null;
  return parent && parent !== page ? parent : null;
}

const KNOWN_DASHBOARD_CODES: ReadonlySet<string> = new Set(
  DASHBOARD_ERROR_CODES,
);

/**
 * Creates the bridge for this page. Create it once, as early as the page
 * loads: its first message tells the dashboard the page is ready, and it
 * learns the dashboard's context.
 */
export function createAppBridge(options: AppBridgeOptions = {}): AppBridge {
  if (typeof window === 'undefined') {
    throw new AppBridgeError(
      'NOT_IN_BROWSER',
      'createAppBridge() needs a browser window.',
      { source: 'sdk' },
    );
  }
  const dashboardOrigin = dashboardOriginOf(options.dashboardOrigin);
  const defaultTimeout = timeoutOf(
    options.timeoutMs,
    DEFAULT_TIMEOUT_MS,
    'timeoutMs',
  );
  if (defaultTimeout instanceof AppBridgeError) throw defaultTimeout;
  const page = window;
  const parent = parentOf(page);
  const embedded = parent !== null;

  const pending = new Map<string, Pending>();
  const queue: Queued[] = [];
  /** Hellos not answered yet, with when each was sent. */
  const hellos = new Map<string, number>();
  const listeners = new Map<BridgeEvent, Set<(payload: unknown) => void>>();
  const limiter = createLimiter();
  let current: BridgeContext | null = null;
  let connected = false;
  let destroyed = false;
  let helloTimer: ReturnType<typeof setTimeout> | undefined;
  let helloStarted = 0;
  let helloAttempt = 0;
  let saying = false;

  const post = (message: unknown) => {
    // Only ever to the dashboard's exact origin: never "*".
    parent?.postMessage(message, dashboardOrigin);
  };

  const emit = (event: BridgeEvent, payload: unknown) => {
    for (const listener of [...(listeners.get(event) ?? [])]) {
      try {
        listener(payload);
      } catch (error) {
        // One listener's failure must not stop the others or the bridge.
        setTimeout(() => {
          throw error;
        });
      }
    }
  };

  const applyContext = (context: BridgeContext) => {
    if (sameContext(current, context)) return;
    current = context;
    emit('context.changed', context);
  };

  const settle = (
    id: string,
    outcome: { value: unknown } | { error: AppBridgeError },
  ) => {
    const waiting = pending.get(id);
    if (!waiting) return;
    pending.delete(id);
    clearTimeout(waiting.timer);
    waiting.stopAbort?.();
    const queued = queue.findIndex((entry) => entry.id === id);
    if (queued !== -1) queue.splice(queued, 1);
    if ('error' in outcome) waiting.reject(outcome.error);
    else waiting.resolve(outcome.value);
  };

  const sdkError = (
    code: AppBridgeErrorCode,
    call: BridgeCall | null,
    message: string,
    extra: { path?: string | null; fix?: string; cause?: unknown } = {},
  ) => new AppBridgeError(code, message, { call, source: 'sdk', ...extra });

  const send = ({ id, call, payload }: Queued) => {
    const verdict = limiter.take(call, Date.now());
    if (verdict !== 'ok') {
      settle(id, {
        error: sdkError(
          'RATE_LIMITED',
          call,
          verdict === 'total'
            ? `${call} not sent: this page already sent ${BRIDGE_TOTAL_RATE_LIMIT} messages in the last minute, and the dashboard drops more without answering.`
            : `${call} not sent: the dashboard takes at most ${BRIDGE_RATE_LIMITS[call]} a minute from an app.`,
        ),
      });
      return;
    }
    try {
      post({ tsy: BRIDGE_PROTOCOL_VERSION, id, type: call, payload });
    } catch (cause) {
      settle(id, {
        error: sdkError('FAILED', call, `${call} could not be posted.`, {
          fix: 'Try again; if it keeps failing, reload the page.',
          cause,
        }),
      });
      return;
    }
    const waiting = pending.get(id);
    if (waiting && WAITS_FOR_MERCHANT.has(call)) {
      clearTimeout(waiting.timer);
      waiting.timer = undefined;
    }
  };

  const onConnected = () => {
    if (connected) return;
    connected = true;
    saying = false;
    clearTimeout(helloTimer);
    // Hellos still unanswered stay known: a late answer still counts.
    for (const entry of queue.splice(0)) send(entry);
  };

  // Says hello (`context.get`) until the dashboard answers: a message posted
  // before the dashboard listens is lost, and its first context.changed may
  // come before this page listened.
  const hello = () => {
    helloTimer = undefined;
    if (connected || destroyed) {
      saying = false;
      return;
    }
    if (Date.now() - helloStarted >= CONNECT_WINDOW_MS && queue.length === 0) {
      saying = false;
      return;
    }
    const id = newMessageId();
    hellos.set(id, Date.now());
    try {
      post({
        tsy: BRIDGE_PROTOCOL_VERSION,
        id,
        type: 'context.get',
        payload: {},
      });
    } catch {
      // The next hello tries again.
    }
    helloTimer = setTimeout(
      hello,
      Math.min(FIRST_RETRY_MS * 2 ** helloAttempt, MAX_RETRY_MS),
    );
    helloAttempt += 1;
  };

  const connect = () => {
    if (connected || saying || destroyed || !embedded) return;
    saying = true;
    helloStarted = Date.now();
    helloAttempt = 0;
    hello();
  };

  const onReply = (reply: Extract<Incoming, { kind: 'reply' }>) => {
    const helloSentAt = hellos.get(reply.re);
    if (helloSentAt !== undefined) {
      // The dashboard counted this hello toward its limits: so do we.
      hellos.delete(reply.re);
      limiter.record('context.get', helloSentAt);
      if (reply.ok) {
        const context = readContext(reply.payload);
        if (context) applyContext(context);
      }
      return;
    }
    const waiting = pending.get(reply.re);
    if (!waiting) return;
    const { call } = waiting;
    if (!reply.ok) {
      const known = KNOWN_DASHBOARD_CODES.has(reply.code);
      const code = (known ? reply.code : 'FAILED') as AppBridgeErrorCode;
      settle(reply.re, {
        error: new AppBridgeError(
          code,
          known
            ? `The dashboard refused ${call}: ${code}.`
            : `The dashboard refused ${call} with a code this version does not know (${reply.code}).`,
          {
            call,
            source: 'dashboard',
            ...(known
              ? {}
              : {
                  fix: 'Update @tassyir/app-bridge to read the new code; meanwhile treat it as a failure and try again.',
                }),
          },
        ),
      });
      return;
    }
    const result = readResult(call, reply.payload);
    if (!result) {
      settle(reply.re, {
        error: sdkError(
          'INVALID_REPLY',
          call,
          `The dashboard answered ${call} in a shape this version does not read.`,
        ),
      });
      return;
    }
    if (call === 'context.get') applyContext(result.value as BridgeContext);
    settle(reply.re, result);
  };

  const onMessage = (event: MessageEvent) => {
    // Both checks, every time: the dashboard's window AND its exact origin.
    if (
      parent === null ||
      event.source !== parent ||
      event.origin !== dashboardOrigin
    ) {
      return;
    }
    const incoming = readIncoming(event.data);
    if (!incoming) return;
    if (incoming.kind === 'reply') {
      onReply(incoming);
    } else if (incoming.type === 'context.changed') {
      const context = readContext(incoming.payload);
      if (context) applyContext(context);
    } else {
      emit(incoming.type, {});
    }
    // Anything it sends proves the dashboard listens.
    onConnected();
  };

  // §3.9: a title and a save bar outlive the document that set them when the
  // app loads another of its pages in the same frame, so clear both on the
  // way out. Not when the page is kept in the back/forward cache: an iframe
  // is kept only with the whole dashboard, which keeps its bar with it.
  const onPageHide = (event: PageTransitionEvent) => {
    if (event.persisted || destroyed || !embedded) return;
    const leaving: Queued[] = [
      { id: newMessageId(), call: 'titleBar.set', payload: { title: null } },
      { id: newMessageId(), call: 'saveBar.hide', payload: {} },
    ];
    for (const message of leaving) {
      if (limiter.take(message.call, Date.now()) !== 'ok') continue;
      try {
        post({
          tsy: BRIDGE_PROTOCOL_VERSION,
          id: message.id,
          type: message.call,
          payload: message.payload,
        });
      } catch {
        // The document is going away; nothing else to do.
      }
    }
  };

  page.addEventListener('message', onMessage);
  page.addEventListener('pagehide', onPageHide);
  connect();

  const call = <R>(
    type: BridgeCall,
    input: unknown,
    callOptions: CallOptions = {},
  ): Promise<R> =>
    new Promise<R>((resolve, reject) => {
      if (destroyed) {
        reject(
          sdkError('DESTROYED', type, `${type}: the bridge was destroyed.`),
        );
        return;
      }
      if (!embedded) {
        reject(
          sdkError(
            'NOT_EMBEDDED',
            type,
            `${type}: this page is not inside the Tassyir dashboard (it has no parent frame).`,
          ),
        );
        return;
      }
      const timeoutMs = timeoutOf(
        callOptions.timeoutMs,
        defaultTimeout,
        `${type}: timeoutMs`,
      );
      if (timeoutMs instanceof AppBridgeError) {
        reject(timeoutMs);
        return;
      }
      const built = buildPayload(type, input);
      if (!built.ok) {
        reject(
          sdkError('INVALID_PAYLOAD', type, built.message, {
            path: built.path,
            fix: built.fix,
          }),
        );
        return;
      }
      const { signal } = callOptions;
      if (signal?.aborted) {
        reject(sdkError('ABORTED', type, `${type}: the signal was aborted.`));
        return;
      }

      const id = newMessageId();
      const waiting: Pending = {
        call: type,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer: setTimeout(() => {
          settle(id, {
            error: sdkError(
              'TIMEOUT',
              type,
              connected
                ? `The dashboard did not answer ${type} within ${timeoutMs} ms.`
                : `The dashboard never answered (no reply to the bridge's hello within ${timeoutMs} ms), so ${type} was not sent.`,
            ),
          });
        }, timeoutMs),
        stopAbort: undefined,
      };
      if (signal) {
        const onAbort = () => {
          settle(id, {
            error: sdkError(
              'ABORTED',
              type,
              `${type}: the signal was aborted.`,
            ),
          });
        };
        signal.addEventListener('abort', onAbort, { once: true });
        waiting.stopAbort = () => {
          signal.removeEventListener('abort', onAbort);
        };
      }
      pending.set(id, waiting);
      const entry: Queued = { id, call: type, payload: built.payload };
      if (connected) {
        send(entry);
      } else {
        queue.push(entry);
        connect();
      }
    });

  return {
    embedded,
    get connected() {
      return connected;
    },
    dashboardOrigin,
    idToken: (callOptions) => call('idToken', undefined, callOptions),
    toast: {
      show: (payload, callOptions) => call('toast.show', payload, callOptions),
    },
    modal: {
      open: (payload, callOptions) => call('modal.open', payload, callOptions),
      close: (callOptions) => call('modal.close', undefined, callOptions),
    },
    navigate: (payload, callOptions) => call('navigate', payload, callOptions),
    saveBar: {
      show: (payload, callOptions) =>
        call('saveBar.show', payload, callOptions),
      hide: (callOptions) => call('saveBar.hide', undefined, callOptions),
    },
    titleBar: {
      set: (payload, callOptions) => call('titleBar.set', payload, callOptions),
    },
    resource: {
      pick: (payload, callOptions) =>
        call('resource.pick', payload, callOptions),
    },
    context: {
      get: (callOptions) => call('context.get', undefined, callOptions),
      get current() {
        return current;
      },
    },
    on(event, listener) {
      if (!(BRIDGE_EVENTS as readonly string[]).includes(event)) {
        throw new AppBridgeError(
          'INVALID_ARGUMENT',
          `on(): "${event}" is not an event the dashboard sends.`,
          {
            source: 'sdk',
            fix: `Listen to one of ${BRIDGE_EVENTS.join(', ')}.`,
          },
        );
      }
      const set = listeners.get(event) ?? new Set();
      listeners.set(event, set);
      const wrapped = listener as (payload: unknown) => void;
      set.add(wrapped);
      return () => {
        set.delete(wrapped);
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      page.removeEventListener('message', onMessage);
      page.removeEventListener('pagehide', onPageHide);
      clearTimeout(helloTimer);
      queue.length = 0;
      for (const [id, waiting] of [...pending]) {
        settle(id, {
          error: sdkError(
            'DESTROYED',
            waiting.call,
            `${waiting.call}: the bridge was destroyed before the dashboard answered.`,
          ),
        });
      }
      listeners.clear();
    },
  };
}
