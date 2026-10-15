// @vitest-environment happy-dom
import { act, createElement, Component, StrictMode } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppBridge } from './bridge.js';
import type { AppBridge } from './bridge.js';
import { AppBridgeError, isAppBridgeError } from './errors.js';
import { FakeHost } from './fake-host.test-harness.js';
import type { BridgeContext } from './protocol.js';
import {
  AppBridgeProvider,
  useAppBridge,
  useBridgeContext,
  useBridgeEvent,
  useIdToken,
  useModal,
  useNavigate,
  useResourcePicker,
  useSaveBar,
  useTitleBar,
  useToast,
} from './react.js';
import type { ModalControls, ResourcePickerControls } from './react.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let host: FakeHost | undefined;
let root: Root | undefined;
let container: HTMLElement | undefined;
const owned: AppBridge[] = [];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = new FakeHost();
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  container?.remove();
  for (const bridge of owned.splice(0)) bridge.destroy();
  host?.remove();
  host = undefined;
});

/** Lets postMessage deliveries (microtasks) and React's updates run. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 30; i += 1) await Promise.resolve();
  });
}

async function render(node: ReactNode): Promise<void> {
  root ??= createRoot(container as HTMLElement);
  act(() => {
    root?.render(node);
  });
  await settle();
}

function fakeHost(): FakeHost {
  if (!host) throw new Error('no host');
  return host;
}

/** A bridge the test owns (destroyed after it). */
function ownBridge(): AppBridge {
  const bridge = createAppBridge();
  owned.push(bridge);
  return bridge;
}

/** Renders `use()` inside a provider and keeps its latest value. */
function probe<T>(use: () => T): { current: T | undefined; renders: number } {
  const seen: { current: T | undefined; renders: number } = {
    current: undefined,
    renders: 0,
  };
  function Probe(): ReactNode {
    seen.current = use();
    seen.renders += 1;
    return null;
  }
  return Object.assign(seen, { Probe });
}

/** A new element each time, so React renders the probe again. */
function element(seen: object): ReactNode {
  return createElement((seen as { Probe: () => ReactNode }).Probe);
}

describe('AppBridgeProvider', () => {
  it('creates one bridge when it mounts, shows the fallback until then, and destroys it when it unmounts', async () => {
    const html = renderToString(
      createElement(
        AppBridgeProvider,
        { fallback: 'loading' },
        createElement('p', null, 'app'),
      ),
    );
    // On a server: the fallback, and no bridge (nothing posted).
    expect(html).toBe('loading');
    expect(fakeHost().posted).toHaveLength(0);

    const seen = probe(useAppBridge);
    await render(createElement(AppBridgeProvider, null, element(seen)));
    const bridge = seen.current;
    expect(bridge?.embedded).toBe(true);
    // Its hello (a context.get) reached the dashboard, and it answered.
    expect(fakeHost().callsOf('context.get').length).toBeGreaterThan(0);
    expect(bridge?.connected).toBe(true);

    act(() => {
      root?.unmount();
    });
    root = undefined;
    const late = await bridge?.toast.show({ message: 'after' }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(isAppBridgeError(late, 'DESTROYED')).toBe(true);
  });

  it('uses the bridge it is given and never destroys it', async () => {
    const bridge = ownBridge();
    const seen = probe(useAppBridge);
    await render(createElement(AppBridgeProvider, { bridge }, element(seen)));
    expect(seen.current).toBe(bridge);
    act(() => {
      root?.unmount();
    });
    root = undefined;
    await expect(bridge.toast.show({ message: 'still here' })).resolves.toBe(
      undefined,
    );
  });

  it('works under StrictMode: one live bridge, the one the children get', async () => {
    const seen = probe(useAppBridge);
    await render(
      createElement(
        StrictMode,
        null,
        createElement(AppBridgeProvider, null, element(seen)),
      ),
    );
    await expect(seen.current?.toast.show({ message: 'strict' })).resolves.toBe(
      undefined,
    );
    expect(fakeHost().toasts).toEqual([{ message: 'strict' }]);
  });
});

describe('useAppBridge', () => {
  it('throws NO_PROVIDER, with a fix, outside the provider', async () => {
    let caught: unknown;
    class Boundary extends Component<
      { children: ReactNode },
      { failed: boolean }
    > {
      override state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      override componentDidCatch(error: unknown) {
        caught = error;
      }
      override render() {
        return this.state.failed ? null : this.props.children;
      }
    }
    const seen = probe(useAppBridge);
    const quiet = console.error;
    console.error = () => undefined;
    try {
      await render(createElement(Boundary, null, element(seen)));
    } finally {
      console.error = quiet;
    }
    expect(caught).toBeInstanceOf(AppBridgeError);
    const error = caught as AppBridgeError;
    expect(error.code).toBe('NO_PROVIDER');
    expect(error.source).toBe('sdk');
    expect(error.fix).toContain('<AppBridgeProvider>');
  });
});

describe('useBridgeContext', () => {
  it("is null until the dashboard's context arrives, then follows every real change", async () => {
    const bridge = ownBridge();
    const seen = probe(useBridgeContext);
    await render(createElement(AppBridgeProvider, { bridge }, element(seen)));
    expect(seen.current).toEqual<BridgeContext>({
      locale: 'ar',
      dir: 'rtl',
      theme: 'light',
      storeId: 'store_1',
    });

    fakeHost().setContext({ locale: 'en', theme: 'dark' });
    await settle();
    expect(seen.current).toMatchObject({
      locale: 'en',
      dir: 'ltr',
      theme: 'dark',
    });

    // The same context again is not a change: no new render.
    const renders = seen.renders;
    fakeHost().pushContext();
    await settle();
    expect(seen.renders).toBe(renders);
  });
});

describe('useBridgeEvent', () => {
  it('calls the latest listener while mounted, and stops when unmounted', async () => {
    const bridge = ownBridge();
    const heard: string[] = [];
    function Listener({ label }: { label: string }): ReactNode {
      useBridgeEvent('saveBar.save', () => {
        heard.push(label);
      });
      return null;
    }
    await render(
      createElement(
        AppBridgeProvider,
        { bridge },
        createElement(Listener, { label: 'first' }),
      ),
    );
    fakeHost().push('saveBar.save', {});
    await settle();
    await render(
      createElement(
        AppBridgeProvider,
        { bridge },
        createElement(Listener, { label: 'second' }),
      ),
    );
    fakeHost().push('saveBar.save', {});
    await settle();
    await render(createElement(AppBridgeProvider, { bridge }, null));
    fakeHost().push('saveBar.save', {});
    await settle();
    expect(heard).toEqual(['first', 'second']);
  });
});

describe('useTitleBar', () => {
  it('sets the title on mount and on change, and returns a refusal as state', async () => {
    const bridge = ownBridge();
    let title: string | null = 'Reviews';
    const seen = probe(() => useTitleBar(title));
    await render(createElement(AppBridgeProvider, { bridge }, element(seen)));
    expect(fakeHost().title).toBe('Reviews');
    expect(seen.current).toBeNull();

    title = null;
    await render(createElement(AppBridgeProvider, { bridge }, element(seen)));
    expect(fakeHost().title).toBeNull();

    fakeHost().respond('titleBar.set', () => ({ error: 'NOT_ALLOWED_HERE' }));
    title = 'Settings';
    await render(createElement(AppBridgeProvider, { bridge }, element(seen)));
    expect(seen.current?.code).toBe('NOT_ALLOWED_HERE');
    expect(fakeHost().callsOf('titleBar.set')).toHaveLength(3);
  });
});

describe('useSaveBar', () => {
  it('shows and hides the bar only when that changes, busy while saving, and hides it on unmount', async () => {
    const bridge = ownBridge();
    const events: string[] = [];
    let state = { dirty: false, saving: false };
    const seen = probe(() =>
      useSaveBar({
        ...state,
        onSave: () => events.push('save'),
        onDiscard: () => events.push('discard'),
      }),
    );
    const view = () =>
      render(createElement(AppBridgeProvider, { bridge }, element(seen)));
    const shows = () => fakeHost().callsOf('saveBar.show');
    const hides = () => fakeHost().callsOf('saveBar.hide');

    await view();
    expect(shows()).toHaveLength(0);
    expect(hides()).toHaveLength(0);

    state = { dirty: true, saving: false };
    await view();
    await view(); // another render, same state: no call
    expect(shows()).toEqual([{}]);
    expect(fakeHost().saveBar).toEqual({ saving: false });

    fakeHost().push('saveBar.save', {});
    fakeHost().push('saveBar.discard', {});
    await settle();
    expect(events).toEqual(['save', 'discard']);

    state = { dirty: true, saving: true };
    await view();
    expect(fakeHost().saveBar).toEqual({ saving: true });

    state = { dirty: false, saving: false };
    await view();
    expect(hides()).toHaveLength(1);
    expect(fakeHost().saveBar).toBeNull();
    expect(shows()).toEqual([{}, { saving: true }]);

    state = { dirty: true, saving: false };
    await view();
    await render(createElement(AppBridgeProvider, { bridge }, null));
    expect(hides()).toHaveLength(2);
    expect(fakeHost().saveBar).toBeNull();
    expect(seen.current).toBeNull();
  });

  it('returns a refusal as state', async () => {
    const bridge = ownBridge();
    fakeHost().respond('saveBar.show', () => ({ error: 'NOT_ALLOWED_HERE' }));
    const seen = probe(() =>
      useSaveBar({
        dirty: true,
        onSave: () => undefined,
        onDiscard: () => undefined,
      }),
    );
    await render(createElement(AppBridgeProvider, { bridge }, element(seen)));
    expect(seen.current?.code).toBe('NOT_ALLOWED_HERE');
  });
});

describe('useModal and useResourcePicker', () => {
  it('say whether their dialog is open, and resolve with the dashboard’s answer', async () => {
    const bridge = ownBridge();
    const modal = probe(useModal);
    const picker = probe(useResourcePicker);
    await render(
      createElement(
        AppBridgeProvider,
        { bridge },
        element(modal),
        element(picker),
      ),
    );
    const controls = () => modal.current as ModalControls;
    expect(controls().isOpen).toBe(false);

    let opened: Promise<unknown> | undefined;
    act(() => {
      opened = controls().open({ path: '/reviews/new', title: 'New review' });
    });
    await settle();
    expect(controls().isOpen).toBe(true);
    expect(fakeHost().modal?.payload).toEqual({
      path: '/reviews/new',
      title: 'New review',
    });
    fakeHost().closeModal('merchant');
    await settle();
    await expect(opened).resolves.toEqual({ closedBy: 'merchant' });
    expect(controls().isOpen).toBe(false);

    const pick = () => picker.current as ResourcePickerControls;
    let picked: Promise<unknown> | undefined;
    act(() => {
      picked = pick().pick({ type: 'product', multiple: true });
    });
    await settle();
    expect(pick().isPicking).toBe(true);
    fakeHost().settlePick([
      { id: 'p1', name: 'Cap', image: null },
      { id: 'p2', name: 'Bag', image: 'https://cdn.tassyir.io/bag.jpg' },
    ]);
    await settle();
    await expect(picked).resolves.toEqual({
      selection: [
        { id: 'p1', name: 'Cap', image: null },
        { id: 'p2', name: 'Bag', image: 'https://cdn.tassyir.io/bag.jpg' },
      ],
    });
    expect(pick().isPicking).toBe(false);
  });

  it('close the open state when the call is refused', async () => {
    const bridge = ownBridge();
    fakeHost().respond('resource.pick', () => ({ error: 'SCOPE_REQUIRED' }));
    const picker = probe(useResourcePicker);
    await render(createElement(AppBridgeProvider, { bridge }, element(picker)));
    let refusal: unknown;
    await act(async () => {
      refusal = await (picker.current as ResourcePickerControls)
        .pick({ type: 'customer' })
        .catch((error: unknown) => error);
    });
    await settle();
    expect(isAppBridgeError(refusal, 'SCOPE_REQUIRED')).toBe(true);
    expect((picker.current as ResourcePickerControls).isPicking).toBe(false);
  });
});

describe('useToast, useNavigate and useIdToken', () => {
  it('are the bridge’s calls, as stable functions', async () => {
    const bridge = ownBridge();
    const seen = probe(() => ({
      toast: useToast(),
      navigate: useNavigate(),
      idToken: useIdToken(),
    }));
    await render(createElement(AppBridgeProvider, { bridge }, element(seen)));
    const first = seen.current;
    await render(createElement(AppBridgeProvider, { bridge }, element(seen)));
    expect(seen.current?.toast).toBe(first?.toast);
    expect(seen.current?.navigate).toBe(first?.navigate);
    expect(seen.current?.idToken).toBe(first?.idToken);

    await seen.current?.toast({ message: 'Saved', tone: 'success' });
    await seen.current?.navigate({ dashboard: 'order', id: '7100' });
    const { token } = (await seen.current?.idToken()) ?? { token: '' };
    expect(fakeHost().toasts).toEqual([{ message: 'Saved', tone: 'success' }]);
    expect(fakeHost().navigations).toEqual([
      { dashboard: 'order', id: '7100' },
    ]);
    expect(fakeHost().minted).toEqual([token]);
  });
});
