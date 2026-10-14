// Payloads with their verdict, written from backend §3.9's rules: the specs
// check this package against them, and the frontend cross-check runs every
// one (and the generated corpora below) through the dashboard's own reader.

import type { BridgeCall } from './protocol.js';

export interface PayloadCase {
  call: BridgeCall;
  input: unknown;
  /** Posted (true) or refused `INVALID_PAYLOAD` (false). */
  valid: boolean;
  /** The field a refusal names (`path` of the error). */
  field?: string | null;
  /**
   * The input holds a field set to `undefined`. The SDK leaves such a field
   * out; a raw message keeping it may read otherwise on the dashboard.
   */
  undefinedField?: true;
  /** Where the dashboard is stricter or more precise than §3.9's words. */
  note?: string;
}

const long = (length: number, char = 'a') => char.repeat(length);

const paths = (call: 'navigate' | 'modal.open'): PayloadCase[] => {
  const ok = (path: string, note?: string): PayloadCase => ({
    call,
    input: { path },
    valid: true,
    ...(note ? { note } : {}),
  });
  const no = (path: unknown, note?: string): PayloadCase => ({
    call,
    input: { path },
    valid: false,
    field: 'path',
    ...(note ? { note } : {}),
  });
  return [
    ok('/'),
    ok('/settings'),
    ok('/reviews/2?tab=sent'),
    ok('/a/', 'one trailing slash is the same page'),
    ok('/a?', 'an empty query'),
    ok('/a?q=a%20b&x'),
    ok('/caf%C3%A9'),
    ok('/café', 'the dashboard percent-encodes it'),
    ok('/a%2Fb', 'an encoded slash stays inside its segment'),
    ok('/%20', 'an encoded space is a segment'),
    ok('/%00', 'a percent-encoded control character is a segment'),
    ok(`/${long(1023)}`, '1,024 characters before the ?'),
    ok(`/a?q=${long(1021, 'x')}`, 'the written query at 1,024 with its ?'),
    no(''),
    no('settings'),
    no('//evil.example/x'),
    no('https://evil.example/x'),
    no('javascript:alert(1)'),
    no('/a//b'),
    no('/./a'),
    no('/a/..'),
    no('/%2e%2e/x'),
    no('/%2E'),
    no('/a b'),
    no('/a\\b'),
    no('/a#top'),
    no('/a?x=1#top'),
    no('/a\tb'),
    no('/a\u0000b'),
    no('/%zz'),
    no('/a/%'),
    no(`/${long(1024)}`, '1,025 characters before the ?'),
    no(`/a?${long(2046, 'x')}`, 'more than 2,048 in all'),
    no(
      '/a‮b',
      'a bidi control: §3.9 names control characters; the dashboard also refuses U+202A-E and U+2066-9 in paths',
    ),
    no(
      `/a?q=${long(1022, 'x')}`,
      'the query is 1,025 with its ? once written by URLSearchParams: §3.9 caps the part before ? and the whole, the dashboard also caps the written query at 1,024',
    ),
    no(`/a?q=${long(400, ' ')}`, 'a space is refused before any normalisation'),
    no(5),
    no(null),
  ];
};

export const PAYLOAD_CASES: readonly PayloadCase[] = [
  // ── toast.show ──
  { call: 'toast.show', input: { message: 'Saved' }, valid: true },
  ...(['info', 'success', 'error'] as const).map((tone): PayloadCase => ({
    call: 'toast.show',
    input: { message: 'Saved', tone },
    valid: true,
  })),
  {
    call: 'toast.show',
    input: { message: 'Saved', tone: null },
    valid: true,
    note: 'a null tone reads as the default',
  },
  {
    call: 'toast.show',
    input: { message: 'Saved', tone: undefined },
    valid: true,
    undefinedField: true,
  },
  {
    call: 'toast.show',
    input: { message: 'Saved', tone: 'warning' },
    valid: false,
    field: 'tone',
  },
  {
    call: 'toast.show',
    input: { message: 'Saved', unknown: { nested: true } },
    valid: true,
    note: 'unknown fields are not sent',
  },
  { call: 'toast.show', input: { message: long(2000) }, valid: true },
  {
    call: 'toast.show',
    input: { message: long(2001) },
    valid: false,
    field: 'message',
  },
  {
    call: 'toast.show',
    input: { message: `${long(1999)}😀` },
    valid: false,
    field: 'message',
    note: 'length as sent counts UTF-16 units: an emoji is 2',
  },
  {
    call: 'toast.show',
    input: { message: 'a\u0000b' },
    valid: true,
    note: 'a control character becomes a space',
  },
  {
    call: 'toast.show',
    input: { message: '‏' },
    valid: true,
    note: 'RLM stays',
  },
  {
    call: 'toast.show',
    input: { message: '' },
    valid: false,
    field: 'message',
  },
  {
    call: 'toast.show',
    input: { message: ' \t\n 　' },
    valid: false,
    field: 'message',
  },
  {
    call: 'toast.show',
    input: { message: '‪‮⁦⁩\u0007' },
    valid: false,
    field: 'message',
  },
  { call: 'toast.show', input: { message: 5 }, valid: false, field: 'message' },
  { call: 'toast.show', input: {}, valid: false, field: 'message' },
  { call: 'toast.show', input: 'Saved', valid: false, field: null },
  { call: 'toast.show', input: ['Saved'], valid: false, field: null },
  { call: 'toast.show', input: null, valid: false, field: null },

  // ── modal.open ──
  ...paths('modal.open'),
  {
    call: 'modal.open',
    input: { path: '/edit', title: 'Edit review', size: 'large' },
    valid: true,
  },
  {
    call: 'modal.open',
    input: { path: '/edit', title: null, size: null },
    valid: true,
  },
  {
    call: 'modal.open',
    input: { path: '/edit', title: long(500) },
    valid: true,
    note: 'cut to 80 when shown',
  },
  {
    call: 'modal.open',
    input: { path: '/edit', title: '' },
    valid: false,
    field: 'title',
    note: 'only null or absent means no title',
  },
  {
    call: 'modal.open',
    input: { path: '/edit', title: '   ' },
    valid: false,
    field: 'title',
  },
  {
    call: 'modal.open',
    input: { path: '/edit', title: long(2001) },
    valid: false,
    field: 'title',
  },
  {
    call: 'modal.open',
    input: { path: '/edit', size: 'huge' },
    valid: false,
    field: 'size',
  },
  { call: 'modal.open', input: {}, valid: false, field: 'path' },

  // ── navigate ──
  ...paths('navigate'),
  { call: 'navigate', input: { path: '/x', replace: true }, valid: true },
  { call: 'navigate', input: { path: '/x', replace: false }, valid: true },
  {
    call: 'navigate',
    input: { path: '/x', replace: 'yes' },
    valid: false,
    field: 'replace',
  },
  {
    call: 'navigate',
    input: { path: '/x', replace: null },
    valid: false,
    field: 'replace',
  },
  ...(
    [
      'home',
      'orders',
      'customers',
      'tracking',
      'inventory',
      'products',
      'apps',
    ] as const
  ).map((dashboard): PayloadCase => ({
    call: 'navigate',
    input: { dashboard },
    valid: true,
  })),
  { call: 'navigate', input: { dashboard: 'order', id: '1234' }, valid: true },
  {
    call: 'navigate',
    input: { dashboard: 'customer', id: 'c_9-Z' },
    valid: true,
  },
  {
    call: 'navigate',
    input: { dashboard: 'order', id: long(64, '7') },
    valid: true,
  },
  {
    call: 'navigate',
    input: { dashboard: 'order', id: long(65, '7') },
    valid: false,
    field: 'id',
  },
  {
    call: 'navigate',
    input: { dashboard: 'order' },
    valid: false,
    field: 'id',
  },
  {
    call: 'navigate',
    input: { dashboard: 'order', id: '12 34' },
    valid: false,
    field: 'id',
  },
  {
    call: 'navigate',
    input: { dashboard: 'order', id: 1234 },
    valid: false,
    field: 'id',
  },
  {
    call: 'navigate',
    input: { dashboard: 'orders', id: '1' },
    valid: false,
    field: 'id',
  },
  {
    call: 'navigate',
    input: { dashboard: 'orders', id: undefined },
    valid: true,
    undefinedField: true,
  },
  {
    call: 'navigate',
    input: { dashboard: 'product', id: '1' },
    valid: false,
    field: 'dashboard',
    note: 'no product destination: a product page needs its store',
  },
  {
    call: 'navigate',
    input: { dashboard: 'settings' },
    valid: false,
    field: 'dashboard',
  },
  {
    call: 'navigate',
    input: { dashboard: null },
    valid: false,
    field: 'dashboard',
  },
  {
    call: 'navigate',
    input: { path: '/x', dashboard: 'orders' },
    valid: false,
    field: 'dashboard',
  },
  {
    call: 'navigate',
    input: { path: '/x', dashboard: undefined },
    valid: true,
    undefinedField: true,
  },
  { call: 'navigate', input: {}, valid: false, field: null },

  // ── saveBar.show ──
  { call: 'saveBar.show', input: undefined, valid: true },
  { call: 'saveBar.show', input: {}, valid: true },
  { call: 'saveBar.show', input: { saving: true }, valid: true },
  {
    call: 'saveBar.show',
    input: { saving: undefined },
    valid: true,
    undefinedField: true,
  },
  {
    call: 'saveBar.show',
    input: { saving: 'yes' },
    valid: false,
    field: 'saving',
  },
  {
    call: 'saveBar.show',
    input: { saving: null },
    valid: false,
    field: 'saving',
  },

  // ── titleBar.set ──
  { call: 'titleBar.set', input: { title: 'Reviews' }, valid: true },
  { call: 'titleBar.set', input: { title: null }, valid: true },
  { call: 'titleBar.set', input: { title: '' }, valid: true },
  {
    call: 'titleBar.set',
    input: { title: long(300) },
    valid: true,
    note: 'cut to 80 when shown',
  },
  { call: 'titleBar.set', input: {}, valid: false, field: 'title' },
  { call: 'titleBar.set', input: { title: 5 }, valid: false, field: 'title' },
  {
    call: 'titleBar.set',
    input: { title: '   ' },
    valid: false,
    field: 'title',
    note: 'only exactly "" clears; blank text is refused',
  },
  {
    call: 'titleBar.set',
    input: { title: long(2001) },
    valid: false,
    field: 'title',
  },

  // ── resource.pick ──
  ...(['product', 'collection', 'customer'] as const).map(
    (type): PayloadCase => ({
      call: 'resource.pick',
      input: { type },
      valid: true,
    }),
  ),
  {
    call: 'resource.pick',
    input: { type: 'product', multiple: true },
    valid: true,
  },
  {
    call: 'resource.pick',
    input: { type: 'order' },
    valid: false,
    field: 'type',
  },
  { call: 'resource.pick', input: {}, valid: false, field: 'type' },
  {
    call: 'resource.pick',
    input: { type: 'product', multiple: 'yes' },
    valid: false,
    field: 'multiple',
  },
  {
    call: 'resource.pick',
    input: { type: 'product', multiple: null },
    valid: false,
    field: 'multiple',
  },

  // ── calls without a payload ──
  ...(['idToken', 'modal.close', 'saveBar.hide', 'context.get'] as const).map(
    (call): PayloadCase => ({ call, input: undefined, valid: true }),
  ),
];

/** A seeded generator (mulberry32): the same corpus on every run. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TEXT_ALPHABET = [
  'a',
  'é',
  'ع',
  ' ',
  '\t',
  '\n',
  '\u0000',
  '\u001f',
  '\u007f',
  '\u0085',
  '\u009f',
  ' ',
  '​',
  '‎',
  '‏',
  ' ',
  '‪',
  '‮',
  '⁦',
  '⁩',
  '﻿',
  '　',
  '😀',
];

/** Text inputs for toasts and titles: short random runs and every length edge. */
export function textCorpus(): string[] {
  const random = seeded(0x7a551);
  const out: string[] = [];
  for (let i = 0; i < 600; i += 1) {
    const length = Math.floor(random() * 6);
    let text = '';
    for (let j = 0; j < length; j += 1) {
      text += TEXT_ALPHABET[Math.floor(random() * TEXT_ALPHABET.length)] ?? '';
    }
    out.push(text);
  }
  for (const length of [79, 80, 81, 149, 150, 151, 1999, 2000, 2001]) {
    out.push(long(length), `${long(length - 1)}😀`, ` ${long(length - 2)} `);
  }
  return out;
}

const PATH_PIECES = [
  '',
  'a',
  'reviews',
  '.',
  '..',
  '%2e',
  '%2E%2e',
  '%2F',
  '%',
  '%zz',
  '%C3%A9',
  '%00',
  '%20',
  'é',
  ' ',
  '\t',
  '\\',
  '#',
  '‮',
  '‏',
  '\u0000',
  ':',
  '@',
  '+',
];

const QUERIES = [
  '',
  '?',
  '?a=1',
  '?a=1&b',
  '?a=1&a=2',
  '?q=a%20b',
  '?q=a+b',
  '?%zz',
  '?a=%E0%A4%A',
  '?a=‮',
  '?a b',
  '?a=é',
  '?=x',
  '?&&',
  `?q=${long(1021, 'x')}`,
  `?q=${long(1022, 'x')}`,
  `?q=${long(400, 'é')}`,
  `?q=${long(1100, 'x')}`,
];

/** App paths: pieces and queries combined, plus seeded random strings. */
export function pathCorpus(): string[] {
  const out = new Set<string>();
  for (const prefix of ['/', '//', '', 'https://h.example/']) {
    for (const first of PATH_PIECES) {
      for (const second of ['', '/', '/a', '/..', '//b']) {
        for (const query of QUERIES) {
          out.add(`${prefix}${first}${second}${query}`);
        }
      }
    }
  }
  for (const length of [1022, 1023, 1024, 1025]) {
    out.add(`/${long(length - 1)}`);
    out.add(`/${long(length - 1)}?a=1`);
    out.add(`/${long(length - 2)}/`);
  }
  for (const total of [2047, 2048, 2049]) {
    out.add(`/a?${long(total - 3, 'x')}`);
  }
  const random = seeded(0xb41d6e);
  const alphabet = [
    '/',
    '?',
    '=',
    '&',
    '%',
    '2',
    'e',
    'E',
    'F',
    '.',
    'a',
    ' ',
    '#',
    '\\',
    'é',
  ];
  for (let i = 0; i < 3000; i += 1) {
    let path = random() < 0.9 ? '/' : '';
    const length = Math.floor(random() * 12);
    for (let j = 0; j < length; j += 1) {
      path += alphabet[Math.floor(random() * alphabet.length)] ?? '';
    }
    out.add(path);
  }
  return [...out];
}
