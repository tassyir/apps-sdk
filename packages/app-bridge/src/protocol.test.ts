import { describe, expect, it } from 'vitest';
import { DASHBOARD_ERROR_CODES as CODES_FROM_INDEX } from './index.js';
import { SDK_ERROR_CODES, appBridgeFix } from './errors.js';
import { SPEC } from './fake-host.test-harness.js';
import {
  BRIDGE_CALLS,
  BRIDGE_EVENTS,
  BRIDGE_LIMITS,
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_RATE_LIMITS,
  BRIDGE_TOTAL_RATE_LIMIT,
  DASHBOARD_DESTINATIONS,
  DASHBOARD_ERROR_CODES,
  DEFAULT_DASHBOARD_ORIGIN,
  MODAL_FRAME_CALLS,
  MODAL_SIZES,
  PICK_TYPES,
  TOAST_TONES,
} from './protocol.js';

describe('the package states §3.9', () => {
  it('names the calls, events, codes, destinations and choices', () => {
    expect(BRIDGE_PROTOCOL_VERSION).toBe(1);
    expect(DEFAULT_DASHBOARD_ORIGIN).toBe('https://app.tassyir.io');
    expect(BRIDGE_CALLS).toEqual(SPEC.calls);
    expect(MODAL_FRAME_CALLS).toEqual(SPEC.modalCalls);
    expect(BRIDGE_EVENTS).toEqual(SPEC.events);
    expect(DASHBOARD_ERROR_CODES).toEqual(SPEC.errorCodes);
    expect(CODES_FROM_INDEX).toBe(DASHBOARD_ERROR_CODES);
    expect(DASHBOARD_DESTINATIONS).toEqual(SPEC.destinations);
    expect(PICK_TYPES).toEqual(SPEC.pickTypes);
    expect(TOAST_TONES).toEqual(SPEC.tones);
    expect(MODAL_SIZES).toEqual(SPEC.sizes);
  });

  it('holds its caps and rate limits', () => {
    expect(BRIDGE_RATE_LIMITS).toEqual(SPEC.rateLimits);
    expect(BRIDGE_TOTAL_RATE_LIMIT).toBe(SPEC.totalRateLimit);
    expect(BRIDGE_LIMITS).toEqual({
      textMaxLength: SPEC.textMax,
      toastShownLength: SPEC.toastShown,
      titleShownLength: SPEC.titleShown,
      pathMaxLength: SPEC.pathMax,
      pathBeforeQueryMaxLength: SPEC.pathBeforeQueryMax,
      queryMaxLength: 1024,
      idMaxLength: 64,
      pickMaxItems: SPEC.pickMax,
    });
  });

  it('has a fix sentence for every code, its own and the dashboard’s', () => {
    const codes = [...DASHBOARD_ERROR_CODES, ...SDK_ERROR_CODES];
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(appBridgeFix(code)).toMatch(/^[A-Z].*\.$/);
  });
});
