import { describe, expect, it } from 'vitest';
import { PAYLOAD_CASES } from './payload-corpus.test-harness.js';
import { buildPayload } from './payloads.js';

const label = (input: unknown) => {
  const text = JSON.stringify(input, (_, value: unknown) =>
    value === undefined ? '<undefined>' : value,
  );
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
};

describe('buildPayload: §3.9 payload rules', () => {
  it.each(PAYLOAD_CASES.map((c) => [c.call, label(c.input), c] as const))(
    '%s %s',
    (_call, _label, { call, input, valid, field }) => {
      const built = buildPayload(call, input);
      expect(built.ok).toBe(valid);
      if (!built.ok) {
        expect(built.path).toBe(field ?? null);
        expect(built.message.startsWith(`${call}:`)).toBe(true);
        expect(built.fix).toMatch(/\.$/);
      }
    },
  );

  it('copies named fields only, and leaves out fields set to undefined', () => {
    expect(
      buildPayload('toast.show', {
        message: 'Saved',
        tone: undefined,
        token: 'secret',
      }),
    ).toEqual({ ok: true, payload: { message: 'Saved' } });
    expect(
      buildPayload('navigate', { dashboard: 'orders', id: undefined }),
    ).toEqual({ ok: true, payload: { dashboard: 'orders' } });
    expect(buildPayload('saveBar.show', { saving: undefined })).toEqual({
      ok: true,
      payload: {},
    });
    expect(
      buildPayload('modal.open', { path: '/a', title: null, size: null }),
    ).toEqual({ ok: true, payload: { path: '/a' } });
  });

  it('sends text and paths as given: the dashboard cleans and normalises them', () => {
    expect(
      buildPayload('toast.show', { message: '  a\u0000b  ', tone: 'error' }),
    ).toEqual({
      ok: true,
      payload: { message: '  a\u0000b  ', tone: 'error' },
    });
    expect(
      buildPayload('navigate', { path: '/café?q=a%20b', replace: true }),
    ).toEqual({ ok: true, payload: { path: '/café?q=a%20b', replace: true } });
  });

  it('clears the title with null whether given null or ""', () => {
    expect(buildPayload('titleBar.set', { title: '' })).toEqual({
      ok: true,
      payload: { title: null },
    });
    expect(buildPayload('titleBar.set', { title: null })).toEqual({
      ok: true,
      payload: { title: null },
    });
  });

  it('gives calls without a payload {} whatever they are handed', () => {
    for (const call of [
      'idToken',
      'modal.close',
      'saveBar.hide',
      'context.get',
    ] as const) {
      expect(buildPayload(call, { anything: 1 })).toEqual({
        ok: true,
        payload: {},
      });
    }
  });

  it('says what is wrong and how to fix it', () => {
    expect(buildPayload('navigate', { path: 'https://evil.example' })).toEqual({
      ok: false,
      path: 'path',
      message:
        'navigate: path must start with a single "/": it is a path inside the app (relative to its admin.page), never a URL.',
      fix: 'Pass the path only, like "/settings", without a scheme or host.',
    });
    expect(buildPayload('toast.show', { message: 'a'.repeat(2001) })).toEqual({
      ok: false,
      path: 'message',
      message:
        'toast.show: message is 2001 characters; the dashboard refuses more than 2000.',
      fix: 'Shorten message: the dashboard shows at most 150 characters.',
    });
  });
});
