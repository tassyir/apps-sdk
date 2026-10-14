// A fake dashboard host for the specs, built from backend §3.9 and nothing
// of this package (so the specs are not this package checking itself). The
// host's reader, reply builders, limiter and views are a `HostProtocol`:
// `SPEC_PROTOCOL` below is written from §3.9's text, and the frontend
// cross-check (`frontend-crosscheck.test.ts`) plugs in the dashboard's real
// `lib/apps/bridge-protocol.ts`. The state machine around them (modal, picker,
// save bar, title) follows `components/apps/AppBridgeHost.tsx`.
//
// It runs inside happy-dom: the page under test is `window`, and its parent
// is replaced by the host's own window object.

type Fields = Record<string, unknown>;

export const DASHBOARD_ORIGIN = 'https://app.tassyir.io';
export const APP_ORIGIN = 'https://reviews.example.com';

/** §3.9, copied from its text: the specs compare the package with these. */
export const SPEC = {
  calls: [
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
  ],
  modalCalls: [
    'idToken',
    'toast.show',
    'modal.close',
    'resource.pick',
    'context.get',
  ],
  events: ['context.changed', 'saveBar.save', 'saveBar.discard'],
  errorCodes: [
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
  ],
  destinations: [
    'home',
    'orders',
    'order',
    'customers',
    'customer',
    'tracking',
    'inventory',
    'products',
    'apps',
  ],
  pickTypes: ['product', 'collection', 'customer'],
  tones: ['info', 'success', 'error'],
  sizes: ['small', 'medium', 'large'],
  rateLimits: {
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
  } as Record<string, number>,
  totalRateLimit: 240,
  textMax: 2000,
  toastShown: 150,
  titleShown: 80,
  pathMax: 2048,
  pathBeforeQueryMax: 1024,
  pickMax: 50,
} as const;

export type HostParse =
  | { kind: 'call'; request: { id: string; type: string; payload: Fields } }
  | { kind: 'invalid'; id: string; type: string }
  | { kind: 'drop' };

export type RateVerdict = 'ok' | 'limited' | 'flood';

/** The pure half of a host: what reads a message and builds every answer. */
export interface HostProtocol {
  accepted(
    event: { source: unknown; origin: unknown },
    frames: { page: unknown; modal: unknown },
    appOrigin: string,
  ): 'page' | 'modal' | null;
  parse(data: unknown): HostParse;
  reply(re: string, payload: unknown): unknown;
  error(re: string, code: string): unknown;
  event(type: string, payload: unknown, id: string): unknown;
  createLimiter(): { take(call: string | null, now: number): RateVerdict };
  modalCalls: ReadonlySet<string>;
  pickSelection(type: string, rows: Fields[], contact: boolean): unknown[];
  context(input: {
    locale: string;
    theme: string;
    storeId: string | null;
  }): unknown;
  /** The token handed over for the n-th mint, or null when it may not be. */
  mintIdToken(n: number, now: number): string | null;
}

const isPlain = (value: unknown): value is Fields =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

/**
 * §3.9's host, from its text. Its reader checks the envelope and that a
 * payload is an object; the payload rules themselves are this package's
 * (`payloads.test.ts`) and are proven equal to the dashboard's by the
 * cross-check.
 */
export const SPEC_PROTOCOL: HostProtocol = {
  accepted(event, frames, appOrigin) {
    if (typeof event.origin !== 'string' || event.origin !== appOrigin) {
      return null;
    }
    if (!event.source) return null;
    if (event.source === frames.page) return 'page';
    if (event.source === frames.modal) return 'modal';
    return null;
  },
  parse(data) {
    if (!isPlain(data) || data['tsy'] !== 1 || 're' in data) {
      return { kind: 'drop' };
    }
    const { id, type } = data;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      return { kind: 'drop' };
    }
    if (typeof type !== 'string' || !SPEC.calls.includes(type as never)) {
      return { kind: 'drop' };
    }
    const payload = data['payload'] === undefined ? {} : data['payload'];
    if (!isPlain(payload)) return { kind: 'invalid', id, type };
    return { kind: 'call', request: { id, type, payload } };
  },
  reply: (re, payload) => ({ tsy: 1, re, ok: true, payload }),
  error: (re, code) => ({ tsy: 1, re, ok: false, error: { code } }),
  event: (type, payload, id) => ({ tsy: 1, id, type, payload }),
  createLimiter() {
    const seen = new Map<string, number[]>();
    const admit = (key: string, limit: number, now: number) => {
      const times = (seen.get(key) ?? []).filter((at) => now - at < 60_000);
      const ok = times.length < limit;
      if (ok) times.push(now);
      seen.set(key, times);
      return ok;
    };
    return {
      take(call, now) {
        if (!admit('*', SPEC.totalRateLimit, now)) return 'flood';
        if (call && !admit(call, SPEC.rateLimits[call] ?? 0, now)) {
          return 'limited';
        }
        return 'ok';
      },
    };
  },
  modalCalls: new Set(SPEC.modalCalls),
  pickSelection(type, rows, contact) {
    return rows.slice(0, SPEC.pickMax).map((row) => {
      if (type === 'product') {
        return {
          id: row['id'],
          name: row['name'],
          image: row['image'] ?? null,
        };
      }
      if (type === 'collection') return { id: row['id'], name: row['name'] };
      const customer: Fields = {
        id: row['id'],
        provinceCode: row['provinceCode'] ?? null,
      };
      if (contact) {
        customer['name'] = row['name'] ?? null;
        customer['phone'] = row['phone'] ?? null;
      }
      return customer;
    });
  },
  context: ({ locale, theme, storeId }) => {
    const lang = locale === 'en' ? 'en' : 'ar';
    return {
      locale: lang,
      dir: lang === 'ar' ? 'rtl' : 'ltr',
      theme: theme === 'dark' ? 'dark' : 'light',
      storeId,
    };
  },
  mintIdToken: (n) => `eyJhbGciOiJFZERTQSJ9.eyJqdGkiOiJ${n}In0.c2ln${n}`,
};

/** What a responder may answer a call with; `undefined` keeps the default. */
export type Answer = { ok: Fields } | { error: string } | 'hold' | 'drop';
export type Responder = (request: {
  id: string;
  type: string;
  payload: Fields;
  frame: 'page' | 'modal';
}) => Answer | undefined;

interface HostWindow {
  postMessage(data: unknown, targetOrigin: string): void;
}

export interface FakeHostOptions {
  protocol?: HostProtocol;
  /** Which of the app's frames the page under test is. Default `page`. */
  frame?: 'page' | 'modal';
  /** Whether the host listens from the start. Default true. */
  listening?: boolean;
}

/** A held call (a modal or a picker), answered later. */
interface Held {
  id: string;
  frame: 'page' | 'modal';
  payload: Fields;
}

/**
 * The dashboard, as the page under test sees it through `window.parent`.
 * Messages both ways are structured-cloned and delivered asynchronously,
 * like `postMessage`.
 */
export class FakeHost {
  readonly protocol: HostProtocol;
  readonly frame: 'page' | 'modal';
  /** The dashboard's window: the page's `window.parent`. */
  readonly window: HostWindow;
  /** The app's other frame (the page behind a modal, or the modal). */
  readonly otherFrame: HostWindow = { postMessage: () => undefined };
  listening: boolean;
  /** Everything the page posted, with the target origin it named. */
  readonly posted: { data: unknown; targetOrigin: string }[] = [];
  /** Posted while the host did not listen: lost, as in a browser. */
  readonly lost: unknown[] = [];
  /** What the host's reader made of each message it received. */
  readonly read: { parse: HostParse; verdict: RateVerdict }[] = [];
  /** Every message the host sent the page. */
  readonly sent: unknown[] = [];
  readonly toasts: Fields[] = [];
  readonly navigations: Fields[] = [];
  readonly minted: string[] = [];
  title: unknown = null;
  saveBar: { saving: boolean } | null = null;
  modal: Held | null = null;
  pick: Held | null = null;
  ready = false;
  contact = false;
  context = {
    locale: 'ar',
    theme: 'light',
    storeId: 'store_1' as string | null,
  };
  readonly #responders = new Map<string, Responder>();
  readonly #held = new Map<string, Held>();
  #limiter: { take(call: string | null, now: number): RateVerdict };

  constructor(options: FakeHostOptions = {}) {
    this.protocol = options.protocol ?? SPEC_PROTOCOL;
    this.frame = options.frame ?? 'page';
    this.listening = options.listening ?? true;
    this.#limiter = this.protocol.createLimiter();
    this.window = {
      postMessage: (data, targetOrigin) => {
        this.#receive(data, targetOrigin);
      },
    };
    Object.defineProperty(window, 'parent', {
      value: this.window,
      configurable: true,
    });
    if (this.frame === 'modal') {
      // The page behind opened the modal the page under test is.
      this.modal = { id: 'opened-by-page', frame: 'page', payload: {} };
    }
  }

  /** Puts `window.parent` back. */
  remove(): void {
    Object.defineProperty(window, 'parent', {
      value: window,
      configurable: true,
    });
  }

  /** The host starts listening and pushes its context, as §3.9 says. */
  listen(): void {
    this.listening = true;
    this.pushContext();
  }

  /** Answer `type` calls with `responder` (return undefined for the default). */
  respond(type: string, responder: Responder): void {
    this.#responders.set(type, responder);
  }

  /** Counts messages another document of the app already sent this minute. */
  preload(call: string | null, count: number): void {
    for (let i = 0; i < count; i += 1) this.#limiter.take(call, Date.now());
  }

  pushContext(): void {
    this.push('context.changed', this.protocol.context(this.context));
  }

  setContext(change: Partial<FakeHost['context']>): void {
    this.context = { ...this.context, ...change };
    this.pushContext();
  }

  /** An event from the host, to the page under test. */
  push(type: string, payload: unknown): void {
    this.#send(
      this.protocol.event(type, payload, `h${String(this.sent.length)}`),
      this.frame,
    );
  }

  /** A raw message to the page, from any origin and window. */
  deliver(
    data: unknown,
    from: { origin?: string; source?: unknown } = {},
  ): void {
    const message = structuredClone(data);
    queueMicrotask(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: message,
          origin: from.origin ?? DASHBOARD_ORIGIN,
          source: ('source' in from ? from.source : this.window) as Window,
        }),
      );
    });
  }

  /** The merchant closes the open modal. */
  closeModal(by: 'app' | 'merchant' = 'merchant'): void {
    const modal = this.modal;
    if (!modal) throw new Error('no modal is open');
    this.modal = null;
    this.answer(modal.id, { ok: { closedBy: by } });
  }

  /** The merchant closes the picker with these rows (none: cancelled). */
  settlePick(rows: Fields[] = []): void {
    const pick = this.pick;
    if (!pick) throw new Error('no picker is open');
    this.pick = null;
    const type = String(pick.payload['type'] ?? pick.payload['resource']);
    this.answer(pick.id, {
      ok: {
        selection: this.protocol.pickSelection(type, rows, this.contact),
      },
    });
  }

  /** Answers a held call. */
  answer(id: string, answer: { ok: Fields } | { error: string }): void {
    const held = this.#held.get(id);
    if (!held) throw new Error(`no held call ${id}`);
    this.#held.delete(id);
    this.#send(
      'ok' in answer
        ? this.protocol.reply(id, answer.ok)
        : this.protocol.error(id, answer.error),
      held.frame,
    );
  }

  /** The calls the host took (read as calls), by type. */
  callsOf(type: string): Fields[] {
    return this.read.flatMap(({ parse }) =>
      parse.kind === 'call' && parse.request.type === type
        ? [parse.request.payload]
        : [],
    );
  }

  #frames() {
    const modalOpen = this.modal !== null;
    return this.frame === 'page'
      ? { page: window, modal: modalOpen ? this.otherFrame : null }
      : { page: this.otherFrame, modal: modalOpen ? window : null };
  }

  #send(message: unknown, to: 'page' | 'modal'): void {
    this.sent.push(message);
    // Only the page under test is a real window; the other frame hears nothing here.
    if (to === this.frame) this.deliver(message);
  }

  #receive(data: unknown, targetOrigin: string): void {
    const message = structuredClone(data);
    this.posted.push({ data: message, targetOrigin });
    // A browser delivers only to the origin named.
    if (targetOrigin !== DASHBOARD_ORIGIN) return;
    queueMicrotask(() => {
      if (!this.listening) {
        this.lost.push(message);
        return;
      }
      this.#handle(message);
    });
  }

  #handle(data: unknown): void {
    const frame = this.protocol.accepted(
      { source: window, origin: APP_ORIGIN },
      this.#frames(),
      APP_ORIGIN,
    );
    if (!frame) return;
    const parse = this.protocol.parse(data);
    const call =
      parse.kind === 'call'
        ? parse.request.type
        : parse.kind === 'invalid'
          ? parse.type
          : null;
    const verdict = this.#limiter.take(call, Date.now());
    this.read.push({ parse, verdict });
    if (verdict === 'flood' || parse.kind === 'drop') return;
    if (frame === 'page') this.ready = true;
    const reply = (answer: { ok: Fields } | { error: string }, id: string) => {
      this.#send(
        'ok' in answer
          ? this.protocol.reply(id, answer.ok)
          : this.protocol.error(id, answer.error),
        frame,
      );
    };
    if (parse.kind === 'invalid') {
      reply({ error: 'INVALID_PAYLOAD' }, parse.id);
      return;
    }
    const { id, type, payload } = parse.request;
    if (verdict === 'limited') {
      reply({ error: 'RATE_LIMITED' }, id);
      return;
    }
    if (frame === 'modal' && !this.protocol.modalCalls.has(type)) {
      reply({ error: 'NOT_ALLOWED_HERE' }, id);
      return;
    }
    const custom = this.#responders.get(type)?.({ id, type, payload, frame });
    const answer = custom ?? this.#default(id, type, payload, frame);
    if (answer === 'drop') return;
    if (answer === 'hold') {
      this.#held.set(id, { id, frame, payload });
      return;
    }
    reply(answer, id);
  }

  #default(
    id: string,
    type: string,
    payload: Fields,
    frame: 'page' | 'modal',
  ): Answer {
    switch (type) {
      case 'context.get':
        return { ok: this.protocol.context(this.context) as Fields };
      case 'idToken': {
        const token = this.protocol.mintIdToken(
          this.minted.length + 1,
          Date.now(),
        );
        if (!token) return { error: 'FAILED' };
        this.minted.push(token);
        return { ok: { token } };
      }
      case 'toast.show':
        this.toasts.push(payload);
        return { ok: {} };
      case 'titleBar.set':
        this.title = payload['title'];
        return { ok: {} };
      case 'saveBar.show':
        this.saveBar = { saving: payload['saving'] === true };
        return { ok: {} };
      case 'saveBar.hide':
        this.saveBar = null;
        return { ok: {} };
      case 'navigate':
        this.navigations.push(payload);
        return { ok: {} };
      case 'modal.open':
        if (this.modal || this.pick) return { error: 'BUSY' };
        this.modal = { id, frame, payload };
        return 'hold';
      case 'modal.close': {
        const modal = this.modal;
        if (!modal) return { error: 'NO_MODAL' };
        this.modal = null;
        if (this.#held.has(modal.id)) {
          this.answer(modal.id, { ok: { closedBy: 'app' } });
        }
        return { ok: {} };
      }
      case 'resource.pick':
        if (this.pick || (this.modal && frame === 'page')) {
          return { error: 'BUSY' };
        }
        this.pick = { id, frame, payload };
        return 'hold';
      default:
        throw new Error(`no default for ${type}`);
    }
  }
}
