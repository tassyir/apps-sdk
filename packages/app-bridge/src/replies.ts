// What the dashboard sends back, read through named fields: an app only ever
// receives the shapes §3.9 documents, never whatever else a message carries.

import {
  BRIDGE_EVENTS,
  BRIDGE_PROTOCOL_VERSION,
  type BridgeCall,
  type BridgeContext,
  type BridgeEvent,
} from './protocol.js';

type Fields = Record<string, unknown>;

export const isFields = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** An envelope id: 1-64 characters of `[A-Za-z0-9_-]` (a uuid fits). */
export const MESSAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type Incoming =
  | { kind: 'reply'; re: string; ok: true; payload: Fields }
  | { kind: 'reply'; re: string; ok: false; code: string }
  | { kind: 'event'; type: BridgeEvent; payload: Fields };

/**
 * One message from the dashboard's window, or null to ignore it: anything but
 * a plain object, another `tsy`, a reply without `re` and `ok`, or an event
 * this SDK does not know.
 */
export function readIncoming(data: unknown): Incoming | null {
  if (!isFields(data) || data['tsy'] !== BRIDGE_PROTOCOL_VERSION) return null;
  const re = data['re'];
  if (re !== undefined) {
    if (typeof re !== 'string' || !MESSAGE_ID.test(re)) return null;
    if (data['ok'] === true) {
      const payload = data['payload'] === undefined ? {} : data['payload'];
      return isFields(payload)
        ? { kind: 'reply', re, ok: true, payload }
        : null;
    }
    if (data['ok'] === false) {
      const error = data['error'];
      const code = isFields(error) ? error['code'] : undefined;
      return typeof code === 'string' && code !== ''
        ? { kind: 'reply', re, ok: false, code }
        : null;
    }
    return null;
  }
  const type = data['type'];
  if (
    typeof type !== 'string' ||
    !(BRIDGE_EVENTS as readonly string[]).includes(type)
  ) {
    return null;
  }
  const payload = data['payload'] === undefined ? {} : data['payload'];
  return isFields(payload)
    ? { kind: 'event', type: type as BridgeEvent, payload }
    : null;
}

/** The context, as its four fields, or null when it is not one. */
export function readContext(payload: Fields): BridgeContext | null {
  const { locale, dir, theme, storeId } = payload;
  if (locale !== 'ar' && locale !== 'en') return null;
  if (dir !== 'rtl' && dir !== 'ltr') return null;
  if (theme !== 'light' && theme !== 'dark') return null;
  if (storeId !== null && (typeof storeId !== 'string' || storeId === '')) {
    return null;
  }
  return Object.freeze({ locale, dir, theme, storeId });
}

export const sameContext = (a: BridgeContext | null, b: BridgeContext) =>
  a !== null &&
  a.locale === b.locale &&
  a.dir === b.dir &&
  a.theme === b.theme &&
  a.storeId === b.storeId;

const nullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

function readPicked(item: unknown): Fields | null {
  if (!isFields(item) || typeof item['id'] !== 'string') return null;
  const out: Fields = { id: item['id'] };
  if ('name' in item) {
    if (!nullableString(item['name'])) return null;
    out['name'] = item['name'];
  }
  if ('image' in item) {
    if (!nullableString(item['image'])) return null;
    out['image'] = item['image'];
  }
  if ('provinceCode' in item) {
    const code = item['provinceCode'];
    if (code !== null && !Number.isInteger(code)) return null;
    out['provinceCode'] = code;
  }
  if ('phone' in item) {
    if (!nullableString(item['phone'])) return null;
    out['phone'] = item['phone'];
  }
  return out;
}

/**
 * A successful reply's payload as the call's result, or undefined when it is
 * not the shape §3.9 gives that call (the SDK then fails `INVALID_REPLY`).
 * Calls answered `{}` resolve with nothing.
 */
export function readResult(
  call: BridgeCall,
  payload: Fields,
): { value: unknown } | undefined {
  switch (call) {
    case 'idToken': {
      const token = payload['token'];
      return typeof token === 'string' && token !== ''
        ? { value: { token } }
        : undefined;
    }
    case 'modal.open': {
      const closedBy = payload['closedBy'];
      return closedBy === 'app' || closedBy === 'merchant'
        ? { value: { closedBy } }
        : undefined;
    }
    case 'resource.pick': {
      const selection = payload['selection'];
      if (!Array.isArray(selection)) return undefined;
      const items: Fields[] = [];
      for (const item of selection as unknown[]) {
        const read = readPicked(item);
        if (!read) return undefined;
        items.push(read);
      }
      return { value: { selection: items } };
    }
    case 'context.get': {
      const context = readContext(payload);
      return context ? { value: context } : undefined;
    }
    default:
      return { value: undefined };
  }
}
