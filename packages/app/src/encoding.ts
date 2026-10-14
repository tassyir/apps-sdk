// Byte helpers on the web platform only (atob, btoa, TextEncoder): no Buffer,
// so the same code runs on Node and on Workers-like runtimes. Decoders are
// strict: one value has exactly one accepted spelling.

export type Bytes = Uint8Array<ArrayBuffer>;

const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const BASE64URL = /^[A-Za-z0-9_-]*$/;

const encoder = new TextEncoder();

export function utf8Encode(text: string): Bytes {
  return encoder.encode(text);
}

/** Decodes UTF-8, refusing invalid sequences instead of replacing them. */
export function utf8Decode(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** A copy backed by a plain ArrayBuffer (what WebCrypto accepts). */
export function toBytes(data: Uint8Array | ArrayBuffer): Bytes {
  return new Uint8Array(data instanceof ArrayBuffer ? data.slice(0) : data);
}

export function concatBytes(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function fromBinary(binary: string): Bytes {
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function toBinary(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return binary;
}

/** Standard base64 with padding, canonical only. `null` when it is not. */
export function base64Decode(value: string): Bytes | null {
  if (!BASE64.test(value)) return null;
  const bytes = fromBinary(atob(value));
  return base64Encode(bytes) === value ? bytes : null;
}

export function base64Encode(bytes: Uint8Array): string {
  return btoa(toBinary(bytes));
}

/** base64url without padding (RFC 7515), canonical only. `null` when it is not. */
export function base64UrlDecode(value: string): Bytes | null {
  if (!BASE64URL.test(value) || value.length % 4 === 1) return null;
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = fromBinary(
    atob(padded + '='.repeat((4 - (padded.length % 4)) % 4)),
  );
  return base64UrlEncode(bytes) === value ? bytes : null;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  return base64Encode(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
