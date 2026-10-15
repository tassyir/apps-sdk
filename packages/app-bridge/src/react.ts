// @tassyir/app-bridge/react: React bindings over App Bridge (AP-K1.12). One
// provider and a few hooks. They add React state and nothing else: every
// call is the bridge's own, with its checks, limits and errors, and nothing
// here touches the network, storage or the page. React is an optional peer
// dependency: only this entry imports it.

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';
import { createAppBridge } from './bridge.js';
import type {
  AppBridge,
  AppBridgeOptions,
  BridgeEventListener,
  CallOptions,
} from './bridge.js';
import { AppBridgeError, isAppBridgeError } from './errors.js';
import type {
  BridgeContext,
  BridgeEvent,
  IdTokenResult,
  ModalOpenPayload,
  ModalOpenResult,
  NavigatePayload,
  PickType,
  ResourcePickPayload,
  ResourcePickResult,
  ToastShowPayload,
} from './protocol.js';

const AppBridgeContext = createContext<AppBridge | null>(null);

export interface AppBridgeProviderProps {
  /**
   * A bridge you created yourself with `createAppBridge()`, as early as the
   * page loads. The provider never destroys it. Without it, the provider
   * creates one when it mounts and destroys it when it unmounts.
   */
  bridge?: AppBridge;
  /**
   * The options of the bridge the provider creates (`dashboardOrigin`,
   * `timeoutMs`). Read once, when it mounts. Ignored with `bridge`.
   */
  options?: AppBridgeOptions;
  /**
   * Shown instead of `children` until the provider's own bridge exists: one
   * commit after it mounts, and always while rendering on a server, where a
   * bridge cannot exist. Default nothing.
   */
  fallback?: ReactNode;
  children?: ReactNode;
}

/**
 * Gives its children the page's App Bridge. Put it at the root of the page,
 * once: the bridge's first message is what tells the dashboard the page is
 * up, and a second bridge would only add messages.
 */
export function AppBridgeProvider({
  bridge,
  options,
  fallback = null,
  children,
}: AppBridgeProviderProps): ReactNode {
  const [own, setOwn] = useState<AppBridge | null>(null);
  // The options as they were when the provider mounted.
  const initialOptions = useRef(options);
  useEffect(() => {
    if (bridge !== undefined) return undefined;
    // In an effect, never while rendering: a bridge needs a browser window
    // (createAppBridge throws NOT_IN_BROWSER on a server).
    const created = createAppBridge(initialOptions.current);
    setOwn(created);
    return () => {
      created.destroy();
    };
  }, [bridge]);
  const value = bridge ?? own;
  if (value === null) return fallback;
  return createElement(AppBridgeContext.Provider, { value }, children);
}

/**
 * The page's App Bridge. Throws `NO_PROVIDER` outside `<AppBridgeProvider>`.
 */
export function useAppBridge(): AppBridge {
  const bridge = useContext(AppBridgeContext);
  if (bridge === null) {
    throw new AppBridgeError(
      'NO_PROVIDER',
      'A Tassyir App Bridge hook ran outside <AppBridgeProvider>.',
      { source: 'sdk' },
    );
  }
  return bridge;
}

/**
 * The dashboard's context (`locale`, `dir`, `theme`, `storeId`), or null
 * until the dashboard has sent it. Re-renders on every real change. For
 * display only: it proves nothing about who is looking.
 */
export function useBridgeContext(): BridgeContext | null {
  const bridge = useAppBridge();
  const subscribe = useCallback(
    (onChange: () => void) => bridge.on('context.changed', onChange),
    [bridge],
  );
  return useSyncExternalStore(
    subscribe,
    () => bridge.context.current,
    () => null,
  );
}

/**
 * Listens to an event the dashboard sends (`context.changed`, `saveBar.save`,
 * `saveBar.discard`) while the component is mounted. The latest `listener`
 * is called: it may change on every render without listening again.
 */
export function useBridgeEvent<E extends BridgeEvent>(
  event: E,
  listener: BridgeEventListener<E>,
): void {
  const bridge = useAppBridge();
  const latest = useLatest(listener);
  useEffect(
    () =>
      bridge.on(event, (payload) => {
        latest.current(payload);
      }),
    [bridge, event, latest],
  );
}

/**
 * Sets the page's title beside the app's name in the dashboard, whenever
 * `title` changes; `null` or `''` clears it. Returns the last call's
 * refusal (`AppBridgeError`), or null.
 */
export function useTitleBar(title: string | null): AppBridgeError | null {
  const bridge = useAppBridge();
  const [error, setError] = useState<AppBridgeError | null>(null);
  useEffect(() => {
    let current = true;
    bridge.titleBar.set({ title }).then(
      () => {
        if (current) setError(null);
      },
      (reason: unknown) => {
        if (current) setError(asBridgeError(reason));
      },
    );
    return () => {
      current = false;
    };
  }, [bridge, title]);
  return error;
}

export interface SaveBarOptions {
  /** True while the page holds changes that are not saved: the bar shows. */
  dirty: boolean;
  /** True while a save runs: the bar shows, busy. Default false. */
  saving?: boolean;
  /** The bar's Save button. */
  onSave: () => void;
  /** The bar's Discard button. */
  onDiscard: () => void;
}

/**
 * The dashboard's save bar, shown while `dirty` or `saving`, busy while
 * `saving`. The bar is asked to show or hide only when that changes (the
 * dashboard takes 60 of each a minute: never one per key stroke), and hidden
 * when the component unmounts. The bar does not stop the merchant leaving
 * the page. Returns the last call's refusal, or null.
 */
export function useSaveBar({
  dirty,
  saving = false,
  onSave,
  onDiscard,
}: SaveBarOptions): AppBridgeError | null {
  const bridge = useAppBridge();
  const [error, setError] = useState<AppBridgeError | null>(null);
  useBridgeEvent('saveBar.save', () => {
    onSave();
  });
  useBridgeEvent('saveBar.discard', () => {
    onDiscard();
  });

  const shown = dirty || saving;
  // What this hook last asked the dashboard for: null = nothing yet.
  const asked = useRef<{ shown: boolean; saving: boolean } | null>(null);
  useEffect(() => {
    const before = asked.current;
    if (before === null && !shown) return; // never shown: nothing to hide
    if (before?.shown === shown && (!shown || before.saving === saving)) return;
    asked.current = { shown, saving };
    const call = shown
      ? bridge.saveBar.show(saving ? { saving: true } : {})
      : bridge.saveBar.hide();
    call.then(
      () => {
        setError(null);
      },
      (reason: unknown) => {
        setError(asBridgeError(reason));
      },
    );
  }, [bridge, shown, saving]);
  useEffect(
    () => () => {
      if (asked.current?.shown) {
        asked.current = null;
        bridge.saveBar.hide().catch(() => undefined);
      }
    },
    [bridge],
  );
  return error;
}

/** `bridge.toast.show`: a toast signed with the app's name. */
export function useToast(): (
  payload: ToastShowPayload,
  options?: CallOptions,
) => Promise<void> {
  const bridge = useAppBridge();
  return useCallback(
    (payload, options) => bridge.toast.show(payload, options),
    [bridge],
  );
}

/** `bridge.navigate`: to another page of the app, or out to the dashboard. */
export function useNavigate(): (
  payload: NavigatePayload,
  options?: CallOptions,
) => Promise<void> {
  const bridge = useAppBridge();
  return useCallback(
    (payload, options) => bridge.navigate(payload, options),
    [bridge],
  );
}

/**
 * `bridge.idToken`: a new 60-second ID token on every call, for an app on
 * its own server (a hosted app's server knows who is looking without one).
 */
export function useIdToken(): (
  options?: CallOptions,
) => Promise<IdTokenResult> {
  const bridge = useAppBridge();
  return useCallback((options) => bridge.idToken(options), [bridge]);
}

export interface ModalControls {
  /** `bridge.modal.open`: resolves when the modal closes. */
  open(
    payload: ModalOpenPayload,
    options?: CallOptions,
  ): Promise<ModalOpenResult>;
  /** `bridge.modal.close`. */
  close(options?: CallOptions): Promise<void>;
  /** True from `open` until its modal closed (or the call failed). */
  isOpen: boolean;
}

/** The dashboard's modal, with whether this component's modal is open. */
export function useModal(): ModalControls {
  const bridge = useAppBridge();
  const [pending, setPending] = useState(0);
  const open = useCallback(
    async (payload: ModalOpenPayload, options?: CallOptions) => {
      setPending((count) => count + 1);
      try {
        return await bridge.modal.open(payload, options);
      } finally {
        setPending((count) => count - 1);
      }
    },
    [bridge],
  );
  const close = useCallback(
    (options?: CallOptions) => bridge.modal.close(options),
    [bridge],
  );
  return { open, close, isOpen: pending > 0 };
}

export interface ResourcePickerControls {
  /** `bridge.resource.pick`: resolves when the merchant closes the picker. */
  pick<T extends PickType>(
    payload: ResourcePickPayload<T>,
    options?: CallOptions,
  ): Promise<ResourcePickResult<T>>;
  /** True from `pick` until the picker closed (or the call failed). */
  isPicking: boolean;
}

/** The dashboard's resource picker, with whether this component's picker is open. */
export function useResourcePicker(): ResourcePickerControls {
  const bridge = useAppBridge();
  const [pending, setPending] = useState(0);
  const pick = useCallback(
    async <T extends PickType>(
      payload: ResourcePickPayload<T>,
      options?: CallOptions,
    ): Promise<ResourcePickResult<T>> => {
      setPending((count) => count + 1);
      try {
        return await bridge.resource.pick(payload, options);
      } finally {
        setPending((count) => count - 1);
      }
    },
    [bridge],
  );
  return { pick, isPicking: pending > 0 };
}

/** A ref that always holds the latest value (written after each render). */
function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** A refusal as an AppBridgeError; anything else is wrapped as FAILED. */
function asBridgeError(reason: unknown): AppBridgeError {
  if (isAppBridgeError(reason)) return reason;
  return new AppBridgeError('FAILED', 'The call failed.', {
    source: 'sdk',
    cause: reason,
  });
}
