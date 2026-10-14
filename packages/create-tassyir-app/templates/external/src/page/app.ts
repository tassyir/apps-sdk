import { createAppBridge, isAppBridgeError } from '@tassyir/app-bridge';
import type { BridgeContext } from '@tassyir/app-bridge';
import { normalizeAmount, toCents } from '../shared/money.ts';

// The page the Tassyir dashboard shows in its frame (admin.page in
// tassyir.app.toml). It never holds a Tassyir credential: for each call to
// this app's server it asks App Bridge for a NEW ID token (60 seconds, one
// use) and the server verifies it. Nothing in this page's address (path or
// query) says who is looking; the verified ID token is the only proof.

const MESSAGES = {
  en: {
    title: 'Pending orders',
    notEmbedded:
      'Open this page from the Tassyir dashboard: Apps, then this app.',
    loading: 'Loading…',
    empty: 'No pending orders.',
    more: 'Showing the 20 newest.',
    open: 'Open',
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
    loading: 'جارٍ التحميل…',
    empty: 'لا توجد طلبات معلّقة.',
    more: 'يُعرض أحدث 20 طلبًا.',
    open: 'فتح',
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

// Create the bridge once, as early as the page loads: its first message is
// what tells the dashboard the page is up.
const bridge = createAppBridge();
const root = document.querySelector<HTMLElement>('#app');

let locale: Locale = 'en';
let orders: Order[] = [];
let more = false;
let settings: Settings = { highlightFrom: null };
let draft = '';
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

/** The dashboard's language, direction and theme: the frame cannot see them. */
function applyContext(context: BridgeContext): void {
  locale = context.locale in MESSAGES ? context.locale : 'en';
  document.documentElement.lang = context.locale;
  document.documentElement.dir = context.dir;
  document.documentElement.dataset['theme'] = context.theme;
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
    root.replaceChildren(el('p', { class: 'muted' }, t().loading));
    return;
  }
  const list =
    orders.length === 0
      ? el('p', { class: 'muted' }, t().empty)
      : el('ul', { class: 'orders' }, ...orders.map(orderRow));

  const input = el('input', {
    id: 'highlight-from',
    inputmode: 'decimal',
    autocomplete: 'off',
    value: draft,
  });
  input.addEventListener('input', () => {
    draft = input.value;
    setSaveBar(draft.trim() !== (settings.highlightFrom ?? ''));
  });

  root.replaceChildren(
    el(
      'section',
      { class: 'card' },
      list,
      more ? el('p', { class: 'muted' }, t().more) : null,
    ),
    el(
      'section',
      { class: 'card' },
      el('h2', {}, t().settings),
      el('label', { for: 'highlight-from' }, t().highlightLabel),
      input,
      el('p', { class: 'muted' }, t().highlightHint),
    ),
  );
}

function orderRow(order: Order): HTMLElement {
  const open = el('button', { type: 'button' }, t().open);
  open.addEventListener('click', () => {
    void bridge.navigate({ dashboard: 'order', id: order.id }).catch(report);
  });
  return el(
    'li',
    {},
    el('span', { class: 'number' }, `#${order.orderNumber}`),
    // An amount reads left to right in Arabic too ("7500.00 DZD"), isolated
    // so the row keeps the page's direction.
    el(
      'span',
      { class: 'total' },
      el('bdi', { dir: 'ltr' }, `${order.total ?? '—'} ${order.currency}`),
    ),
    isHighValue(order) ? el('span', { class: 'pill' }, t().highValue) : null,
    open,
  );
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
  if (tag === 'input' && 'value' in attributes) {
    (node as HTMLInputElement).value = attributes['value'] ?? '';
  }
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
    el('p', {}, MESSAGES.en.notEmbedded),
    el('p', { dir: 'rtl', lang: 'ar' }, MESSAGES.ar.notEmbedded),
  );
} else {
  bridge.on('context.changed', applyContext);
  bridge.on('saveBar.save', () => {
    void save().catch(report);
  });
  bridge.on('saveBar.discard', discard);
  render();
  void bridge.context.get().then(applyContext).then(load).catch(report);
}
