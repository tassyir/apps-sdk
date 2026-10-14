import { describe, expect, it } from 'vitest';
import {
  base64Decode,
  base64Encode,
  base64UrlDecode,
  base64UrlEncode,
  utf8Decode,
} from './encoding.js';

const bytes = (...values: number[]) => new Uint8Array(values);

describe('base64', () => {
  it('round-trips every length', () => {
    for (let length = 0; length < 40; length += 1) {
      const data = Uint8Array.from(
        { length },
        (_, i) => (i * 37 + length) % 256,
      );
      expect(base64Decode(base64Encode(data))).toEqual(data);
      expect(base64UrlDecode(base64UrlEncode(data))).toEqual(data);
    }
  });

  it('matches Node for a 32-byte key', () => {
    const key = Uint8Array.from({ length: 32 }, (_, i) => 255 - i * 7);
    expect(base64Encode(key)).toBe(Buffer.from(key).toString('base64'));
    expect(base64UrlEncode(key)).toBe(Buffer.from(key).toString('base64url'));
  });

  it.each([
    'QQ',
    'QQ=',
    'Q===',
    'QR==',
    'Q Q==',
    'QQ==\n',
    'Q-_=',
    '====',
    'QUJDé',
  ])('refuses the non-canonical or invalid base64 %j', (value) => {
    expect(base64Decode(value)).toBeNull();
  });

  it.each(['QQ==', 'Q', 'QR', 'Q+', 'Q/', 'QUJD=', 'a b'])(
    'refuses the base64url %j',
    (value) => {
      expect(base64UrlDecode(value)).toBeNull();
    },
  );

  it('accepts canonical values', () => {
    expect(base64Decode('QQ==')).toEqual(bytes(0x41));
    expect(base64UrlDecode('QQ')).toEqual(bytes(0x41));
    expect(base64UrlDecode('-_8')).toEqual(bytes(0xfb, 0xff));
  });
});

describe('utf8Decode', () => {
  it('decodes Arabic and refuses invalid sequences', () => {
    expect(utf8Decode(new TextEncoder().encode('أمينة'))).toBe('أمينة');
    expect(utf8Decode(bytes(0xc3, 0x28))).toBeNull();
  });
});
