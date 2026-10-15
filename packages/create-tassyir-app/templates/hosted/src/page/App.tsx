import { isAppBridgeError } from '@tassyir/app-bridge';
import {
  useAppBridge,
  useBridgeContext,
  useNavigate,
  useSaveBar,
  useTitleBar,
  useToast,
} from '@tassyir/app-bridge/react';
import { followDashboardContext } from '@tassyir/ui';
import { useCallback, useEffect, useState } from 'react';
import { formatAmount, normalizeAmount, toCents } from '../shared/money.ts';
import { api, ApiError } from './api.ts';
import type { Order, OrdersAnswer, Settings } from './api.ts';
import type { TextFieldElement } from './elements.d.ts';
import { MESSAGES } from './messages.ts';
import type { Locale, Messages } from './messages.ts';

// The page the Tassyir dashboard shows in its frame (admin.page in
// tassyir.app.toml), drawn with @tassyir/ui so it reads as part of the
// dashboard: its elements and tokens, Arabic right to left, light and dark.
// App Bridge (through @tassyir/app-bridge/react) gives the title bar, the
// save bar, toasts and navigation.

export function App() {
  const bridge = useAppBridge();
  const context = useBridgeContext();
  const locale: Locale = context?.locale === 'ar' ? 'ar' : 'en';
  const t = MESSAGES[locale];
  const toast = useToast();

  // lang, dir and data-theme on <html>, now and on every change: the
  // elements follow them (the frame cannot see the dashboard's otherwise).
  useEffect(() => followDashboardContext(bridge), [bridge]);
  useTitleBar(t.title);

  const [orders, setOrders] = useState<OrdersAnswer | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [failed, setFailed] = useState(false);

  /** The code and fix are for you (the console); the merchant gets a toast. */
  const report = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError || isAppBridgeError(error)) {
        console.warn(`${error.code}: ${error.message}`, error.fix ?? '');
      } else {
        console.error(error);
      }
      void toast({ message: t.failed, tone: 'error' }).catch(() => undefined);
    },
    [toast, t.failed],
  );

  useEffect(() => {
    Promise.all([
      api<OrdersAnswer>('/api/orders'),
      api<Settings>('/api/settings'),
    ]).then(
      ([ordersAnswer, settingsAnswer]) => {
        setOrders(ordersAnswer);
        setSettings(settingsAnswer);
      },
      (error: unknown) => {
        setFailed(true);
        report(error);
      },
    );
  }, [report]);

  if (failed) {
    return <tsy-banner tone="critical">{t.failed}</tsy-banner>;
  }
  if (orders === null || settings === null) {
    // The dashboard shows skeletons, not spinners, while a card loads.
    return (
      <tsy-card heading={t.title} aria-busy="true">
        <tsy-skeleton lines="3" />
      </tsy-card>
    );
  }
  return (
    <>
      <OrdersTable
        answer={orders}
        highlightFrom={settings.highlightFrom}
        locale={locale}
        t={t}
        onError={report}
      />
      <SettingsCard
        saved={settings}
        t={t}
        onSaved={setSettings}
        onError={report}
      />
    </>
  );
}

/** Shown when the page is opened outside the dashboard's frame. */
export function NotEmbedded() {
  return (
    <>
      <tsy-banner tone="info">{MESSAGES.en.notEmbedded}</tsy-banner>
      <tsy-banner tone="info" dir="rtl" lang="ar">
        {MESSAGES.ar.notEmbedded}
      </tsy-banner>
    </>
  );
}

function OrdersTable({
  answer,
  highlightFrom,
  locale,
  t,
  onError,
}: {
  answer: OrdersAnswer;
  highlightFrom: string | null;
  locale: Locale;
  t: Messages;
  onError: (error: unknown) => void;
}) {
  const navigate = useNavigate();
  const { orders, more, received } = answer;
  if (orders.length === 0) {
    return (
      <tsy-card heading={t.title}>
        <tsy-empty-state heading={t.empty}>{t.emptyHint}</tsy-empty-state>
      </tsy-card>
    );
  }
  return (
    <tsy-table
      heading={t.title}
      count={more ? `${String(orders.length)}+` : String(orders.length)}
    >
      <table>
        <thead>
          <tr>
            <th>{t.order}</th>
            <th data-align="end">{t.total}</th>
            <th aria-label={t.actions} />
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              {/* data-wrap: on a phone the pill goes under the number. */}
              <td data-wrap="">
                #{order.orderNumber}{' '}
                {/* A status is a pill, never a coloured word of your own. */}
                {isHighValue(order, highlightFrom) ? (
                  <tsy-status-pill tone="info">{t.highValue}</tsy-status-pill>
                ) : null}
              </td>
              {/* Isolated, so an amount keeps its own direction in either language. */}
              <td data-align="end">
                <bdi>
                  {order.total === null
                    ? '—'
                    : formatAmount(order.total, order.currency, locale)}
                </bdi>
              </td>
              <td data-align="end">
                <tsy-button
                  size="sm"
                  aria-label={t.openOrder(order.orderNumber)}
                  onClick={() => {
                    navigate({ dashboard: 'order', id: order.id }).catch(
                      onError,
                    );
                  }}
                >
                  {t.open}
                </tsy-button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div slot="footer">
        {more ? `${t.more} ` : ''}
        {t.received(received)}
      </div>
    </tsy-table>
  );
}

function SettingsCard({
  saved,
  t,
  onSaved,
  onError,
}: {
  saved: Settings;
  t: Messages;
  onSaved: (settings: Settings) => void;
  onError: (error: unknown) => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState(saved.highlightFrom ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = () => {
    const value = draft.trim();
    const highlightFrom = value === '' ? null : normalizeAmount(value);
    if (highlightFrom === null && value !== '') {
      setError(t.invalidAmount);
      void toast({ message: t.invalidAmount, tone: 'error' }).catch(onError);
      return;
    }
    setSaving(true);
    api<Settings>('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ highlightFrom }),
    })
      .then(async (next) => {
        setDraft(next.highlightFrom ?? '');
        setError('');
        onSaved(next);
        await toast({ message: t.saved, tone: 'success' });
      })
      .catch(onError)
      .finally(() => {
        setSaving(false);
      });
  };

  // The save bar follows the draft: shown while it differs from what is
  // saved, busy while saving. Its buttons call save and discard.
  useSaveBar({
    dirty: draft.trim() !== (saved.highlightFrom ?? ''),
    saving,
    onSave: save,
    onDiscard: () => {
      setDraft(saved.highlightFrom ?? '');
      setError('');
    },
  });

  return (
    <tsy-card heading={t.settings}>
      <tsy-text-field
        label={t.highlightLabel}
        hint={t.highlightHint}
        inputMode="decimal"
        autocomplete="off"
        value={draft}
        error={error || undefined}
        onInput={(event) => {
          setDraft((event.currentTarget as TextFieldElement).value);
        }}
      />
      <p>{t.settingsHint}</p>
    </tsy-card>
  );
}

function isHighValue(order: Order, highlightFrom: string | null): boolean {
  if (highlightFrom === null || order.total === null) return false;
  const total = toCents(order.total);
  const from = toCents(highlightFrom);
  return total !== null && from !== null && total >= from;
}
