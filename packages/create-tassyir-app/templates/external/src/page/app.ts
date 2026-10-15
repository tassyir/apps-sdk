import { createAppBridge, isAppBridgeError } from '@tassyir/app-bridge';
import type { BridgeContext } from '@tassyir/app-bridge';
// Importing @tassyir/ui defines its elements (<tsy-table>, <tsy-card>, …)
// and adopts the dashboard's tokens and type into this document.
import { followDashboardContext } from '@tassyir/ui';
import { formatAmount, normalizeAmount, toCents } from '../shared/money.ts';

// The page the Tassyir dashboard shows in its frame (admin.page in
// tassyir.app.toml). It never holds a Tassyir credential: for each call to
// this app's server it asks App Bridge for a NEW ID token (60 seconds, one
// use) and the server verifies it. Nothing in this page's address (path or
// query) says who is looking; the verified ID token is the only proof.
//
// It is drawn with @tassyir/ui, so it reads as part of the dashboard: the
// dashboard's elements and tokens, Arabic right to left, light and dark.

const MESSAGES = {
  en: {
    title: 'Pending orders',
    notEmbedded:
      'Open this page from the Tassyir dashboard: Apps, then this app.',
    empty: 'No pending orders',
    emptyHint: 'Orders waiting for confirmation show up here.',
    more: 'Showing the 20 newest.',
    order: 'Order',
    total: 'Total',
    actions: 'Actions',
    open: 'Open',
    openOrder: (number: string) => `Open order #${number}`,
    highValue: 'High value',
    settings: 'Settings',
    highlightLabel: 'Highlight orders from (amount)',
    highlightHint: 'Leave it empty to highlight none.',
    invalidAmount: 'Enter an amount such as 5000 or 5000.50.',
    saved: 'Settings saved',
    failed: 'Something went wrong. Try again.',
  },
  ar: {
    title: 'الطلبات المعلّقة',
    notEmbedded:
      'افتح هذه الصفحة من لوحة تحكم تسيير: التطبيقات، ثم هذا التطبيق.',
    empty: 'لا توجد طلبات معلّقة',
    emptyHint: 'تظهر هنا الطلبات التي تنتظر التأكيد.',
    more: 'يُعرض أحدث 20 طلبًا.',
    order: 'الطلب',
    total: 'المجموع',
    actions: 'إجراءات',
    open: 'فتح',
    openOrder: (number: string) => `فتح الطلب #${number}`,
    highValue: 'قيمة عالية',
    settings: 'الإعدادات',
    highlightLabel: 'تمييز الطلبات ابتداءً من (المبلغ)',
    highlightHint: 'اتركه فارغًا لعدم تمييز أي طلب.',
    invalidAmount: 'أدخل مبلغًا مثل 5000 أو 5000.50.',
    saved: 'تم حفظ الإعدادات',
    failed: 'حدث خطأ. حاول مرة أخرى.',
  },
} as const;

type Locale = keyof typeof MESSAGES;

interface Order {
  id: string;
  orderNumber: string;
  /** A decimal string ("2500.00"), never a number. */
  total: string | null;
  currency: string;
  createdAt: string;
}

interface Settings {
  highlightFrom: string | null;
}

/** What this app's server answers when a call fails (src/app.ts). */
class ApiError extends Error {
  readonly code: string;
  readonly fix: string | undefined;

  constructor(code: string, message: string, fix: string | undefined) {
    super(message);
    this.code = code;
    this.fix = fix;
  }
}

// The page's own layout: the space between the cards and around them. Every
// other style comes from @tassyir/ui. A constructable stylesheet, like the
// elements' own, so the page keeps its strict Content-Security-Policy
// (style-src 'self': no inline style).
const layout = new CSSStyleSheet();
layout.replaceSync(
  'body{margin:0}' +
    'main{display:grid;gap:var(--tsy-space-section);padding:var(--tsy-space-grid)}',
);
document.adoptedStyleSheets = [...document.adoptedStyleSheets, layout];

// Create the bridge once, as early as the page loads: its first message is
// what tells the dashboard the page is up.
const bridge = createAppBridge();
const root = document.querySelector<HTMLElement>('#app');

let locale: Locale = 'en';
let orders: Order[] = [];
let more = false;
let settings: Settings = { highlightFrom: null };
let draft = '';
let draftError = '';
let loaded = false;
/** Whether this page asked for the save bar: show and hide only on a change. */
let saveBarShown = false;

const t = () => MESSAGES[locale];

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { token } = await bridge.idToken();
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(path, { ...init, headers });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const problem = isRecord(body) ? body : {};
    throw new ApiError(
      typeof problem['code'] === 'string'
        ? problem['code']
        : `HTTP_${String(response.status)}`,
      typeof problem['message'] === 'string'
        ? problem['message']
        : `${path} answered ${String(response.status)}`,
      typeof problem['fix'] === 'string' ? problem['fix'] : undefined,
    );
  }
  return body as T;
}

/**
 * The dashboard's language for this page's own words and title.
 * followDashboardContext (below) puts its lang, dir and theme on <html>,
 * which the elements follow: the frame cannot see them otherwise.
 */
function useContext(context: BridgeContext): void {
  locale = context.locale in MESSAGES ? context.locale : 'en';
  void bridge.titleBar.set({ title: t().title }).catch(report);
  render();
}

async function load(): Promise<void> {
  // One call after the other: the first one may exchange the ID token for
  // the installation's offline token, and the next one reuses it.
  settings = await api<Settings>('/api/settings');
  draft = settings.highlightFrom ?? '';
  const page = await api<{ orders: Order[]; more: boolean }>('/api/orders');
  orders = page.orders;
  more = page.more;
  loaded = true;
  render();
}

async function save(): Promise<void> {
  const value = draft.trim();
  const highlightFrom = value === '' ? null : normalizeAmount(value);
  if (highlightFrom === null && value !== '') {
    draftError = t().invalidAmount;
    render();
    await bridge.toast.show({ message: t().invalidAmount, tone: 'error' });
    return;
  }
  await bridge.saveBar.show({ saving: true });
  try {
    settings = await api<Settings>('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ highlightFrom }),
    });
    draft = settings.highlightFrom ?? '';
    draftError = '';
    saveBarShown = false;
    await bridge.saveBar.hide();
    await bridge.toast.show({ message: t().saved, tone: 'success' });
    render();
  } catch (error) {
    await bridge.saveBar.show();
    report(error);
  }
}

function discard(): void {
  draft = settings.highlightFrom ?? '';
  draftError = '';
  setSaveBar(false);
  render();
}

/** The save bar follows the draft (60 calls a minute: never one per key). */
function setSaveBar(shown: boolean): void {
  if (shown === saveBarShown) return;
  saveBarShown = shown;
  void (shown ? bridge.saveBar.show() : bridge.saveBar.hide()).catch(report);
}

function isHighValue(order: Order): boolean {
  if (settings.highlightFrom === null || order.total === null) return false;
  const total = toCents(order.total);
  const from = toCents(settings.highlightFrom);
  return total !== null && from !== null && total >= from;
}

function render(): void {
  if (!root) return;
  if (!loaded) {
    // The dashboard shows skeletons, not spinners, while a card loads.
    root.replaceChildren(
      el(
        'tsy-card',
        { heading: t().title, 'aria-busy': 'true' },
        el('tsy-skeleton', { lines: '3' }),
      ),
    );
    return;
  }
  root.replaceChildren(ordersView(), settingsView());
}

function ordersView(): HTMLElement {
  if (orders.length === 0) {
    return el(
      'tsy-card',
      { heading: t().title },
      el('tsy-empty-state', { heading: t().empty }, t().emptyHint),
    );
  }
  return el(
    'tsy-table',
    {
      heading: t().title,
      count: more ? `${String(orders.length)}+` : String(orders.length),
    },
    el(
      'table',
      {},
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', {}, t().order),
          el('th', { 'data-align': 'end' }, t().total),
          el('th', { 'aria-label': t().actions }),
        ),
      ),
      el('tbody', {}, ...orders.map(orderRow)),
    ),
    more ? el('div', { slot: 'footer' }, t().more) : null,
  );
}

function orderRow(order: Order): HTMLElement {
  const open = el(
    'tsy-button',
    { size: 'sm', 'aria-label': t().openOrder(order.orderNumber) },
    t().open,
  );
  open.addEventListener('click', () => {
    void bridge.navigate({ dashboard: 'order', id: order.id }).catch(report);
  });
  return el(
    'tr',
    {},
    // data-wrap: on a phone the pill goes under the number.
    el(
      'td',
      { 'data-wrap': '' },
      `#${order.orderNumber} `,
      // A status is a pill, never a coloured word of your own.
      isHighValue(order)
        ? el('tsy-status-pill', { tone: 'info' }, t().highValue)
        : null,
    ),
    // Isolated, so an amount keeps its own direction in either language.
    el(
      'td',
      { 'data-align': 'end' },
      el(
        'bdi',
        {},
        order.total === null
          ? '—'
          : formatAmount(order.total, order.currency, locale),
      ),
    ),
    el('td', { 'data-align': 'end' }, open),
  );
}

function settingsView(): HTMLElement {
  const field = el('tsy-text-field', {
    label: t().highlightLabel,
    hint: t().highlightHint,
    inputmode: 'decimal',
    autocomplete: 'off',
    value: draft,
    ...(draftError ? { error: draftError } : {}),
  });
  field.addEventListener('input', () => {
    draft = field.value;
    setSaveBar(draft.trim() !== (settings.highlightFrom ?? ''));
  });
  return el('tsy-card', { heading: t().settings }, field);
}

/** Builds an element. Strings become text, never HTML. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string>,
  ...children: (Node | string | null)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes))
    node.setAttribute(name, value);
  for (const child of children) if (child !== null) node.append(child);
  return node;
}

function report(error: unknown): void {
  // The code and fix are for you (the console); the merchant gets a toast.
  if (error instanceof ApiError || isAppBridgeError(error)) {
    console.warn(`${error.code}: ${error.message}`, error.fix ?? '');
  } else {
    console.error(error);
  }
  void bridge.toast
    .show({ message: t().failed, tone: 'error' })
    .catch(() => undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

if (!bridge.embedded) {
  root?.replaceChildren(
    el('tsy-banner', { tone: 'info' }, MESSAGES.en.notEmbedded),
    el(
      'tsy-banner',
      { tone: 'info', dir: 'rtl', lang: 'ar' },
      MESSAGES.ar.notEmbedded,
    ),
  );
} else {
  // lang, dir and data-theme on <html>, now and on every change.
  followDashboardContext(bridge);
  bridge.on('context.changed', useContext);
  bridge.on('saveBar.save', () => {
    void save().catch(report);
  });
  bridge.on('saveBar.discard', discard);
  render();
  // The answer also fires context.changed (useContext) when it is new.
  void bridge.context.get().then(load).catch(report);
}
