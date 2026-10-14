// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppBridge, type AppBridge } from './bridge.js';
import { AppBridgeError, appBridgeFix, isAppBridgeError } from './errors.js';
import {
  APP_ORIGIN,
  DASHBOARD_ORIGIN,
  FakeHost,
  SPEC,
} from './fake-host.test-harness.js';

type Fields = Record<string, unknown>;

let host: FakeHost | undefined;
let bridge: AppBridge | undefined;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  bridge?.destroy();
  bridge = undefined;
  host?.remove();
  host = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Lets postMessage deliveries (microtasks) run. */
const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

function start(
  options: ConstructorParameters<typeof FakeHost>[0] = {},
  bridgeOptions: Parameters<typeof createAppBridge>[0] = {},
) {
  const fake = new FakeHost(options);
  host = fake;
  const created = createAppBridge(bridgeOptions);
  bridge = created;
  return { host: fake, bridge: created };
}

function track<T>(promise: Promise<T>) {
  const tracked: {
    state: 'pending' | 'resolved' | 'rejected';
    value?: T;
    error?: unknown;
  } = { state: 'pending' };
  promise.then(
    (value) => {
      tracked.state = 'resolved';
      tracked.value = value;
    },
    (error: unknown) => {
      tracked.state = 'rejected';
      tracked.error = error;
    },
  );
  return tracked;
}

async function refusal(promise: Promise<unknown>): Promise<AppBridgeError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppBridgeError) return error;
    throw error;
  }
  throw new Error('expected a refusal, got an answer');
}

/**
 * `pagehide`. happy-dom's PageTransitionEvent is a plain Event, so
 * `persisted` is set by hand.
 */
function pageHide(persisted = false) {
  const event = new Event('pagehide');
  Object.defineProperty(event, 'persisted', { value: persisted });
  window.dispatchEvent(event);
}

/** What the page posted of one call type. */
const postedOf = (fake: FakeHost, type: string) =>
  fake.posted
    .map(({ data }) => data as Fields)
    .filter((data) => data['type'] === type);

const lastId = (fake: FakeHost, type: string) => {
  const posted = postedOf(fake, type);
  return String(posted[posted.length - 1]?.['id']);
};

describe('transport', () => {
  it('says hello at once (context.get), the first message the dashboard counts as ready', async () => {
    const { host, bridge } = start();
    expect(host.posted).toHaveLength(1);
    const [hello] = host.posted;
    expect(hello?.targetOrigin).toBe(DASHBOARD_ORIGIN);
    expect(hello?.data).toEqual({
      tsy: 1,
      id: (hello?.data as Fields)['id'],
      type: 'context.get',
      payload: {},
    });
    expect((hello?.data as Fields)['id']).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    await flush();
    expect(host.ready).toBe(true);
    expect(bridge.connected).toBe(true);
    expect(bridge.context.current).toEqual({
      locale: 'ar',
      dir: 'rtl',
      theme: 'light',
      storeId: 'store_1',
    });
  });

  it('posts every message to the exact dashboard origin, with a fresh id, never "*"', async () => {
    const { host, bridge } = start();
    await flush();
    await bridge.toast.show({ message: 'Saved' });
    await bridge.titleBar.set({ title: 'Reviews' });
    await bridge.navigate({ dashboard: 'orders' });
    await bridge.idToken();
    pageHide();
    await flush();
    expect(host.posted.length).toBeGreaterThan(5);
    for (const { targetOrigin, data } of host.posted) {
      expect(targetOrigin).toBe(DASHBOARD_ORIGIN);
      expect(Object.keys(data as Fields)).toEqual([
        'tsy',
        'id',
        'type',
        'payload',
      ]);
    }
    const ids = host.posted.map(({ data }) => (data as Fields)['id']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('posts to another origin only when told, for a local or staging dashboard', () => {
    for (const origin of [
      'http://localhost:3000',
      'http://127.0.0.1:8080',
      'http://dash.localhost:3000',
      'http://[::1]:3000',
      'https://staging.example.com',
    ]) {
      const fake = new FakeHost();
      const local = createAppBridge({ dashboardOrigin: origin });
      expect(local.dashboardOrigin).toBe(origin);
      expect(fake.posted[0]?.targetOrigin).toBe(origin);
      local.destroy();
      fake.remove();
    }
  });

  it.each([
    '*',
    'null',
    '',
    'app.tassyir.io',
    'https://app.tassyir.io/',
    'https://app.tassyir.io/en/dashboard',
    'http://app.tassyir.io',
    'file:///tmp/x',
    5,
  ])('refuses dashboardOrigin %j', (origin) => {
    host = new FakeHost();
    let error: unknown;
    try {
      createAppBridge({ dashboardOrigin: origin as string });
    } catch (caught) {
      error = caught;
    }
    expect(isAppBridgeError(error, 'INVALID_ARGUMENT')).toBe(true);
    expect((error as AppBridgeError).fix).toContain('dashboardOrigin');
    expect(host.posted).toHaveLength(0);
  });

  it('takes a message only from the parent window AND the dashboard origin', async () => {
    const { host, bridge } = start();
    host.respond('toast.show', () => 'drop');
    await flush();
    const shown = track(bridge.toast.show({ message: 'Saved' }));
    await flush();
    const re = lastId(host, 'toast.show');
    const answer = { tsy: 1, re, ok: true, payload: {} };
    host.deliver(answer, { origin: 'https://evil.example' });
    host.deliver(answer, { origin: APP_ORIGIN });
    host.deliver(answer, { source: host.otherFrame });
    host.deliver(answer, { source: window });
    host.deliver(answer, { source: null });
    await flush();
    expect(shown.state).toBe('pending');
    host.deliver(answer);
    await flush();
    expect(shown.state).toBe('resolved');
  });

  it('ignores context and events from anywhere but the dashboard', async () => {
    const { host, bridge } = start();
    await flush();
    const saves = vi.fn();
    bridge.on('saveBar.save', saves);
    const dark = { locale: 'en', dir: 'ltr', theme: 'dark', storeId: null };
    for (const from of [
      { origin: 'https://evil.example' },
      { source: host.otherFrame },
    ]) {
      host.deliver(
        { tsy: 1, id: 'e1', type: 'context.changed', payload: dark },
        from,
      );
      host.deliver(
        { tsy: 1, id: 'e2', type: 'saveBar.save', payload: {} },
        from,
      );
    }
    await flush();
    expect(bridge.context.current?.theme).toBe('light');
    expect(saves).not.toHaveBeenCalled();
  });

  it('ignores what is not a reply or an event it knows', async () => {
    const { host, bridge } = start();
    host.respond('toast.show', () => 'drop');
    await flush();
    const shown = track(bridge.toast.show({ message: 'Saved' }));
    await flush();
    const re = lastId(host, 'toast.show');
    for (const junk of [
      null,
      'hello',
      [1],
      { tsy: 2, re, ok: true, payload: {} },
      { tsy: '1', re, ok: true, payload: {} },
      { re, ok: true, payload: {} },
      { tsy: 1, re, payload: {} },
      { tsy: 1, re, ok: 'true', payload: {} },
      { tsy: 1, re, ok: true, payload: [] },
      { tsy: 1, re, ok: false },
      { tsy: 1, re, ok: false, error: { code: '' } },
      { tsy: 1, re: 'not an id!', ok: true, payload: {} },
      { tsy: 1, re: 5, ok: true, payload: {} },
      { tsy: 1, id: 'x', type: 'toast.show', payload: { message: 'hi' } },
      { tsy: 1, id: 'x', type: 'context.changed', payload: { locale: 'fr' } },
    ]) {
      host.deliver(junk);
    }
    await flush();
    expect(shown.state).toBe('pending');
    expect(bridge.context.current?.locale).toBe('ar');
  });

  it('matches replies by re, in any order, and only once', async () => {
    const { host, bridge } = start();
    host.respond('toast.show', () => 'drop');
    host.respond('navigate', () => 'drop');
    await flush();
    const toast = track(bridge.toast.show({ message: 'a' }));
    const nav = track(bridge.navigate({ path: '/b' }));
    await flush();
    const toastId = lastId(host, 'toast.show');
    const navId = lastId(host, 'navigate');
    host.deliver({
      tsy: 1,
      re: navId,
      ok: false,
      error: { code: 'INVALID_DESTINATION' },
    });
    await flush();
    expect(nav.state).toBe('rejected');
    expect(toast.state).toBe('pending');
    host.deliver({ tsy: 1, re: 'never-sent', ok: true, payload: {} });
    host.deliver({ tsy: 1, re: toastId, ok: true, payload: {} });
    host.deliver({ tsy: 1, re: toastId, ok: false, error: { code: 'FAILED' } });
    await flush();
    expect(toast.state).toBe('resolved');
    expect((nav.error as AppBridgeError).code).toBe('INVALID_DESTINATION');
  });

  it('works without a parent frame only to say so (NOT_EMBEDDED), posting nothing', async () => {
    const posts = vi.spyOn(window, 'postMessage');
    bridge = createAppBridge();
    expect(bridge.embedded).toBe(false);
    const error = await refusal(bridge.toast.show({ message: 'x' }));
    expect(error.code).toBe('NOT_EMBEDDED');
    expect(error.source).toBe('sdk');
    expect(error.fix).toContain('dashboard');
    await expect(bridge.idToken()).rejects.toThrow(AppBridgeError);
    vi.advanceTimersByTime(60_000);
    expect(posts).not.toHaveBeenCalled();
    // With no parent, nothing is taken, not even a message without a source.
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          tsy: 1,
          id: 'e',
          type: 'context.changed',
          payload: { locale: 'en', dir: 'ltr', theme: 'dark', storeId: null },
        },
        origin: DASHBOARD_ORIGIN,
        source: null,
      }),
    );
    expect(bridge.context.current).toBeNull();
    expect(bridge.connected).toBe(false);
  });

  it('refuses to start outside a browser (NOT_IN_BROWSER)', () => {
    vi.stubGlobal('window', undefined);
    expect(() => createAppBridge()).toThrow(
      expect.objectContaining({ code: 'NOT_IN_BROWSER' }) as Error,
    );
  });
});

describe('reaching the dashboard', () => {
  it('says hello again until the dashboard listens, then sends what waited, in order', async () => {
    const { host, bridge } = start({ listening: false });
    const toast = track(bridge.toast.show({ message: 'early' }));
    const title = track(bridge.titleBar.set({ title: 'Early' }));
    await vi.advanceTimersByTimeAsync(3_000);
    const hellos = postedOf(host, 'context.get').length;
    // 0, 50, 150, 350, 750, 1550, 2550 ms: backing off to once a second.
    expect(hellos).toBe(7);
    expect(postedOf(host, 'toast.show')).toHaveLength(0);
    expect(bridge.connected).toBe(false);

    host.listen();
    await flush();
    expect(bridge.connected).toBe(true);
    expect(
      host.posted.slice(-2).map(({ data }) => (data as Fields)['type']),
    ).toEqual(['toast.show', 'titleBar.set']);
    await flush();
    expect(toast.state).toBe('resolved');
    expect(title.state).toBe('resolved');
    expect(host.title).toBe('Early');
    expect(bridge.context.current?.storeId).toBe('store_1');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(postedOf(host, 'context.get')).toHaveLength(hellos);
  });

  it('learns the dashboard is there from an answered hello when its first push was missed', async () => {
    const { host, bridge } = start({ listening: false });
    await flush();
    host.listening = true; // listening now, but its context push came too early
    await vi.advanceTimersByTimeAsync(50);
    await flush();
    expect(bridge.connected).toBe(true);
    expect(bridge.context.current?.locale).toBe('ar');
  });

  it('stops saying hello after 15 s with nothing waiting; the next call says it again', async () => {
    const { host, bridge } = start({ listening: false });
    await vi.advanceTimersByTimeAsync(20_000);
    const hellos = postedOf(host, 'context.get').length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(postedOf(host, 'context.get')).toHaveLength(hellos);
    expect(hellos).toBeLessThanOrEqual(20);

    const toast = track(
      bridge.toast.show({ message: 'later' }, { timeoutMs: 30_000 }),
    );
    expect(postedOf(host, 'context.get')).toHaveLength(hellos + 1);
    host.listen();
    await flush();
    await flush();
    expect(toast.state).toBe('resolved');
  });

  it('times out a call the dashboard never took, saying it was never answered', async () => {
    const { host, bridge } = start({ listening: false });
    const pick = refusal(
      bridge.resource.pick({ type: 'product' }, { timeoutMs: 2_000 }),
    );
    await vi.advanceTimersByTimeAsync(2_000);
    const error = await pick;
    expect(error.code).toBe('TIMEOUT');
    expect(error.message).toContain('never answered');
    expect(postedOf(host, 'resource.pick')).toHaveLength(0);
    // A call that timed out is not sent once the dashboard appears.
    host.listen();
    await flush();
    expect(postedOf(host, 'resource.pick')).toHaveLength(0);
  });
});

describe('timeouts', () => {
  it('rejects TIMEOUT after 10 s by default, and ignores a late answer', async () => {
    const { host, bridge } = start();
    host.respond('toast.show', () => 'drop');
    await flush();
    const shown = track(bridge.toast.show({ message: 'Saved' }));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(shown.state).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(shown.state).toBe('rejected');
    const error = shown.error as AppBridgeError;
    expect(error).toMatchObject({
      code: 'TIMEOUT',
      call: 'toast.show',
      source: 'sdk',
    });
    expect(error.message).toBe(
      'The dashboard did not answer toast.show within 10000 ms.',
    );
    host.deliver({
      tsy: 1,
      re: lastId(host, 'toast.show'),
      ok: true,
      payload: {},
    });
    await flush();
    expect(shown.state).toBe('rejected');
  });

  it('takes a timeout per bridge and per call', async () => {
    const { host, bridge } = start({}, { timeoutMs: 1_000 });
    host.respond('idToken', () => 'drop');
    await flush();
    const quick = track(bridge.idToken());
    const slow = track(bridge.idToken({ timeoutMs: 5_000 }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(quick.state).toBe('rejected');
    expect(slow.state).toBe('pending');
    await vi.advanceTimersByTimeAsync(4_000);
    expect(slow.state).toBe('rejected');
  });

  it('refuses a timeout that is not a positive number', async () => {
    const { bridge } = start();
    for (const timeoutMs of [
      0,
      -1,
      Number.NaN,
      Infinity,
      '5' as unknown as number,
    ]) {
      const error = await refusal(
        bridge.toast.show({ message: 'x' }, { timeoutMs }),
      );
      expect(error.code).toBe('INVALID_ARGUMENT');
    }
    expect(() => createAppBridge({ timeoutMs: 0 })).toThrow(AppBridgeError);
  });

  it('lets modal.open and resource.pick wait for the merchant once posted', async () => {
    const { host, bridge } = start();
    await flush();
    const modal = track(
      bridge.modal.open({ path: '/edit' }, { timeoutMs: 1_000 }),
    );
    await vi.advanceTimersByTimeAsync(120_000);
    expect(modal.state).toBe('pending');
    host.closeModal('merchant');
    await flush();
    expect(modal.value).toEqual({ closedBy: 'merchant' });

    const pick = track(bridge.resource.pick({ type: 'collection' }));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(pick.state).toBe('pending');
    host.settlePick([]);
    await flush();
    expect(pick.value).toEqual({ selection: [] });
  });

  it('stops waiting when the caller aborts (ABORTED)', async () => {
    const { host, bridge } = start();
    await flush();
    const controller = new AbortController();
    const modal = refusal(
      bridge.modal.open({ path: '/edit' }, { signal: controller.signal }),
    );
    await flush();
    controller.abort();
    expect((await modal).code).toBe('ABORTED');
    host.closeModal('merchant'); // answered later: ignored
    await flush();

    const before = host.posted.length;
    const aborted = new AbortController();
    aborted.abort();
    const error = await refusal(
      bridge.toast.show({ message: 'x' }, { signal: aborted.signal }),
    );
    expect(error.code).toBe('ABORTED');
    expect(host.posted).toHaveLength(before);
  });
});

describe('calls', () => {
  it('idToken: a new token on every call, never a cached one', async () => {
    const { host, bridge } = start();
    const first = await bridge.idToken();
    const second = await bridge.idToken();
    expect(first.token).not.toBe(second.token);
    expect(host.minted).toEqual([first.token, second.token]);
    expect(Object.keys(first)).toEqual(['token']);
  });

  it('toast.show sends the message and tone only', async () => {
    const { host, bridge } = start();
    await expect(
      bridge.toast.show({ message: 'Saved', tone: 'success' }),
    ).resolves.toBeUndefined();
    await bridge.toast.show({ message: 'Hi' });
    expect(host.toasts).toEqual([
      { message: 'Saved', tone: 'success' },
      { message: 'Hi' },
    ]);
  });

  it('modal.open resolves when the modal closes: by the app (modal.close) or the merchant', async () => {
    const { host, bridge } = start();
    await flush();
    const opened = track(
      bridge.modal.open({ path: '/edit?id=4', title: 'Edit', size: 'large' }),
    );
    await flush();
    expect(host.modal?.payload).toEqual({
      path: '/edit?id=4',
      title: 'Edit',
      size: 'large',
    });
    await expect(bridge.modal.open({ path: '/other' })).rejects.toMatchObject({
      code: 'BUSY',
      source: 'dashboard',
    });
    await bridge.modal.close();
    await flush();
    expect(opened.value).toEqual({ closedBy: 'app' });
    await expect(bridge.modal.close()).rejects.toMatchObject({
      code: 'NO_MODAL',
    });
  });

  it('navigate: an app path or a dashboard page', async () => {
    const { host, bridge } = start();
    await bridge.navigate({ path: '/reviews/2?tab=sent', replace: true });
    await bridge.navigate({ dashboard: 'order', id: '1234' });
    await bridge.navigate({ dashboard: 'products' });
    expect(host.navigations).toEqual([
      { path: '/reviews/2?tab=sent', replace: true },
      { dashboard: 'order', id: '1234' },
      { dashboard: 'products' },
    ]);
  });

  it('saveBar: show, hide, and the save and discard buttons', async () => {
    const { host, bridge } = start();
    const save = vi.fn();
    const discard = vi.fn();
    const stopSave = bridge.on('saveBar.save', save);
    bridge.on('saveBar.discard', discard);
    await bridge.saveBar.show();
    expect(host.saveBar).toEqual({ saving: false });
    await bridge.saveBar.show({ saving: true });
    expect(host.saveBar).toEqual({ saving: true });
    host.push('saveBar.save', {});
    host.push('saveBar.discard', {});
    await flush();
    expect(save).toHaveBeenCalledWith({});
    expect(discard).toHaveBeenCalledTimes(1);
    stopSave();
    host.push('saveBar.save', {});
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
    await bridge.saveBar.hide();
    expect(host.saveBar).toBeNull();
  });

  it('titleBar.set sets and clears the title', async () => {
    const { host, bridge } = start();
    await bridge.titleBar.set({ title: 'Reviews' });
    expect(host.title).toBe('Reviews');
    await bridge.titleBar.set({ title: '' });
    expect(host.title).toBeNull();
  });

  it('resource.pick resolves with ids and display fields when the merchant closes the picker', async () => {
    const { host, bridge } = start();
    await flush();
    const products = track(
      bridge.resource.pick({ type: 'product', multiple: true }),
    );
    await flush();
    await expect(
      bridge.resource.pick({ type: 'customer' }),
    ).rejects.toMatchObject({
      code: 'BUSY',
    });
    host.settlePick([
      {
        id: 'p1',
        name: 'Shirt',
        image: 'https://cdn.example/p1.png',
        price: '2500.00',
      },
      { id: 'p2', name: 'Hat', image: null },
    ]);
    await flush();
    expect(products.value).toEqual({
      selection: [
        { id: 'p1', name: 'Shirt', image: 'https://cdn.example/p1.png' },
        { id: 'p2', name: 'Hat', image: null },
      ],
    });

    const customers = track(bridge.resource.pick({ type: 'customer' }));
    await flush();
    host.settlePick([
      { id: 'c1', provinceCode: 16, name: 'Amina', phone: '0555' },
    ]);
    await flush();
    expect(customers.value).toEqual({
      selection: [{ id: 'c1', provinceCode: 16 }],
    });

    host.contact = true;
    const withContact = track(bridge.resource.pick({ type: 'customer' }));
    await flush();
    host.settlePick([
      { id: 'c1', provinceCode: 16, name: 'Amina', phone: '0555' },
    ]);
    await flush();
    expect(withContact.value).toEqual({
      selection: [{ id: 'c1', provinceCode: 16, name: 'Amina', phone: '0555' }],
    });

    const cancelled = track(bridge.resource.pick({ type: 'collection' }));
    await flush();
    host.settlePick();
    await flush();
    expect(cancelled.value).toEqual({ selection: [] });
  });

  it('context: get, current, and a change listener that hears real changes only', async () => {
    const { host, bridge } = start();
    await flush();
    const changes = vi.fn();
    const stop = bridge.on('context.changed', changes);
    host.pushContext(); // unchanged: not reported
    await flush();
    expect(changes).not.toHaveBeenCalled();

    host.setContext({ locale: 'en', theme: 'dark', storeId: null });
    await flush();
    const english = { locale: 'en', dir: 'ltr', theme: 'dark', storeId: null };
    expect(changes).toHaveBeenCalledWith(english);
    expect(bridge.context.current).toEqual(english);
    expect(Object.isFrozen(bridge.context.current)).toBe(true);

    host.context = { locale: 'ar', theme: 'dark', storeId: 'store_2' };
    await expect(bridge.context.get()).resolves.toEqual({
      locale: 'ar',
      dir: 'rtl',
      theme: 'dark',
      storeId: 'store_2',
    });
    expect(changes).toHaveBeenCalledTimes(2);

    stop();
    host.setContext({ theme: 'light' });
    host.push('context.changed', { locale: 'xx' });
    await flush();
    expect(changes).toHaveBeenCalledTimes(2);
    expect(bridge.context.current?.theme).toBe('light');
  });

  it('keeps one listener failing from stopping the others', async () => {
    const { host, bridge } = start();
    await flush();
    const after = vi.fn();
    bridge.on('saveBar.save', () => {
      throw new Error('boom');
    });
    bridge.on('saveBar.save', after);
    host.push('saveBar.save', {});
    await flush();
    expect(after).toHaveBeenCalledTimes(1);
    // The failure surfaces on its own task, as an uncaught error.
    expect(() => vi.advanceTimersByTime(0)).toThrow('boom');
  });

  it('refuses listening to an event the dashboard does not send', () => {
    const { bridge } = start();
    expect(() => bridge.on('toast.show' as 'saveBar.save', vi.fn())).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }) as Error,
    );
  });
});

describe('refusals', () => {
  it.each(SPEC.errorCodes)(
    'the dashboard answers %s: a typed error with its fix',
    async (code) => {
      const { host, bridge } = start();
      host.respond('toast.show', () => ({ error: code }));
      const error = await refusal(bridge.toast.show({ message: 'x' }));
      expect(error).toBeInstanceOf(AppBridgeError);
      expect(error).toMatchObject({
        name: 'AppBridgeError',
        code,
        call: 'toast.show',
        source: 'dashboard',
        path: null,
        fix: appBridgeFix(code),
      });
      expect(error.message).toBe(`The dashboard refused toast.show: ${code}.`);
      expect(isAppBridgeError(error, code)).toBe(true);
    },
  );

  it('reads a code it does not know as FAILED, naming the code', async () => {
    const { host, bridge } = start();
    host.respond('navigate', () => ({ error: 'SOMETHING_NEW' }));
    const error = await refusal(bridge.navigate({ dashboard: 'home' }));
    expect(error.code).toBe('FAILED');
    expect(error.message).toContain('SOMETHING_NEW');
    expect(error.fix).toContain('Update @tassyir/app-bridge');
  });

  it('fails INVALID_REPLY when an answer is not the shape §3.9 gives', async () => {
    const { host, bridge } = start();
    host.respond('idToken', () => ({ ok: {} }));
    host.respond('modal.open', () => ({ ok: { closedBy: 'nobody' } }));
    host.respond('resource.pick', () => ({
      ok: { selection: [{ name: 'no id' }] },
    }));
    host.respond('context.get', ({ id }) =>
      id === lastId(host, 'context.get') && host.posted.length > 1
        ? { ok: { locale: 'fr' } }
        : undefined,
    );
    for (const call of [
      bridge.idToken(),
      bridge.modal.open({ path: '/x' }),
      bridge.resource.pick({ type: 'product' }),
    ]) {
      expect((await refusal(call)).code).toBe('INVALID_REPLY');
    }
    await flush();
    expect((await refusal(bridge.context.get())).code).toBe('INVALID_REPLY');
  });

  it('refuses a payload the dashboard would refuse before posting it (INVALID_PAYLOAD)', async () => {
    const { host, bridge } = start();
    await flush();
    const before = host.posted.length;
    const error = await refusal(bridge.navigate({ path: '/a/../admin' }));
    expect(error).toMatchObject({
      code: 'INVALID_PAYLOAD',
      call: 'navigate',
      source: 'sdk',
      path: 'path',
    });
    expect(error.fix).toMatch(/\.$/);
    const untyped = (payload: unknown) => bridge.toast.show(payload as never);
    expect((await refusal(untyped({ message: '' }))).path).toBe('message');
    expect(host.posted).toHaveLength(before);
  });

  it('NOT_ALLOWED_HERE: a modal frame may make five calls only', async () => {
    const { host, bridge } = start({ frame: 'modal' });
    await flush();
    expect(bridge.connected).toBe(true);
    expect(host.ready).toBe(false); // only the page's call makes the app ready
    await expect(
      bridge.toast.show({ message: 'From the modal' }),
    ).resolves.toBeUndefined();
    await expect(
      bridge.navigate({ dashboard: 'orders' }),
    ).rejects.toMatchObject({
      code: 'NOT_ALLOWED_HERE',
    });
    await expect(bridge.titleBar.set({ title: 'x' })).rejects.toMatchObject({
      code: 'NOT_ALLOWED_HERE',
    });
    await expect(bridge.modal.close()).resolves.toBeUndefined();
  });

  it('RATE_LIMITED by the dashboard: other documents of the app used the minute', async () => {
    const { host, bridge } = start();
    await flush();
    host.preload('toast.show', 20);
    const error = await refusal(bridge.toast.show({ message: 'x' }));
    expect(error).toMatchObject({ code: 'RATE_LIMITED', source: 'dashboard' });
  });

  it('RATE_LIMITED by the SDK: never sends a call the dashboard would refuse for its rate', async () => {
    const { host, bridge } = start();
    await flush();
    for (let i = 0; i < 20; i += 1)
      await bridge.toast.show({ message: `${i}` });
    const error = await refusal(bridge.toast.show({ message: '21st' }));
    expect(error).toMatchObject({
      code: 'RATE_LIMITED',
      source: 'sdk',
      call: 'toast.show',
    });
    expect(error.message).toContain('at most 20 a minute');
    expect(postedOf(host, 'toast.show')).toHaveLength(20);
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(
      bridge.toast.show({ message: 'next minute' }),
    ).resolves.toBeUndefined();
    expect(host.read.every(({ verdict }) => verdict === 'ok')).toBe(true);
  });

  it('keeps under the 240 messages a minute past which the dashboard answers nothing', async () => {
    const { host, bridge } = start();
    await flush(); // the hello counts: 1
    for (let i = 0; i < 59; i += 1) await bridge.context.get();
    for (let i = 0; i < 60; i += 1) {
      await bridge.saveBar.show();
      await bridge.saveBar.hide();
      await bridge.titleBar.set({ title: `${i}` });
    }
    const error = await refusal(bridge.idToken());
    expect(error).toMatchObject({ code: 'RATE_LIMITED', source: 'sdk' });
    expect(error.message).toContain('240 messages');
    expect(host.read).toHaveLength(240);
    expect(host.read.every(({ verdict }) => verdict === 'ok')).toBe(true);
  });
});

describe('pagehide (§3.9: a title and a save bar must not outlive the page)', () => {
  it('clears the title and hides the save bar when the page goes away', async () => {
    const { host, bridge } = start();
    await bridge.titleBar.set({ title: 'Reviews' });
    await bridge.saveBar.show({ saving: false });
    pageHide(false);
    const leaving = host.posted.slice(-2);
    expect(leaving.map(({ targetOrigin }) => targetOrigin)).toEqual([
      DASHBOARD_ORIGIN,
      DASHBOARD_ORIGIN,
    ]);
    expect(
      leaving.map(({ data }) => {
        const { type, payload } = data as Fields;
        return { type, payload };
      }),
    ).toEqual([
      { type: 'titleBar.set', payload: { title: null } },
      { type: 'saveBar.hide', payload: {} },
    ]);
    await flush();
    expect(host.title).toBeNull();
    expect(host.saveBar).toBeNull();
  });

  it('sends them even before the dashboard answered, and even if the app set neither', () => {
    const { host } = start({ listening: false });
    pageHide();
    expect(postedOf(host, 'titleBar.set')).toHaveLength(1);
    expect(postedOf(host, 'saveBar.hide')).toHaveLength(1);
  });

  it('sends nothing when the page is kept in the back/forward cache with the dashboard', async () => {
    const { host } = start();
    await flush();
    const before = host.posted.length;
    pageHide(true);
    expect(host.posted).toHaveLength(before);
  });

  it('stays inside the rate limits, and stops once destroyed', async () => {
    const { host, bridge } = start();
    await flush();
    for (let i = 0; i < 60; i += 1)
      await bridge.titleBar.set({ title: `${i}` });
    pageHide();
    expect(postedOf(host, 'titleBar.set')).toHaveLength(60);
    expect(postedOf(host, 'saveBar.hide')).toHaveLength(1);
    bridge.destroy();
    pageHide();
    expect(postedOf(host, 'saveBar.hide')).toHaveLength(1);
  });
});

describe('destroy', () => {
  it('rejects waiting calls, refuses new ones and stops listening', async () => {
    const { host, bridge } = start();
    await flush();
    const changes = vi.fn();
    bridge.on('context.changed', changes);
    const modal = refusal(bridge.modal.open({ path: '/edit' }));
    await flush();
    bridge.destroy();
    expect((await modal).code).toBe('DESTROYED');
    expect((await refusal(bridge.toast.show({ message: 'x' }))).code).toBe(
      'DESTROYED',
    );
    host.setContext({ theme: 'dark' });
    await flush();
    expect(changes).not.toHaveBeenCalled();
    bridge.destroy(); // twice is fine
  });
});
