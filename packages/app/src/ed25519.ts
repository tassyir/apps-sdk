import type { Bytes } from './encoding.js';
import { TassyirError } from './errors.js';

// Ed25519 through WebCrypto (`crypto.subtle`), the one implementation shared
// by Node 22, Cloudflare Workers, Deno and Bun: no dependency, no Node API.

const ED25519 = { name: 'Ed25519' } as const;

/**
 * An imported Ed25519 public key: a WebCrypto key, typed without naming
 * `CryptoKey`, so the SDK's declarations need no DOM library.
 */
export interface VerificationKey {
  readonly type: string;
  readonly algorithm: { readonly name: string };
}
export const ED25519_PUBLIC_KEY_LENGTH = 32;
export const ED25519_SIGNATURE_LENGTH = 64;

function subtle(): SubtleCrypto {
  const candidate = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!candidate) {
    throw new TassyirError(
      'WEBCRYPTO_UNAVAILABLE',
      'This runtime has no WebCrypto (globalThis.crypto.subtle), which @tassyir/app needs to verify Ed25519 signatures',
      {
        fix: 'Run on Node 22 or later, Cloudflare Workers, Deno or Bun.',
      },
    );
  }
  return candidate;
}

/** Imports a raw 32-byte Ed25519 public key for verification. */
export async function importEd25519PublicKey(
  raw: Bytes,
): Promise<VerificationKey> {
  if (raw.length !== ED25519_PUBLIC_KEY_LENGTH) {
    throw new TypeError('An Ed25519 public key is 32 bytes');
  }
  return subtle().importKey('raw', raw, ED25519, false, ['verify']);
}

/** True when `signature` is a valid Ed25519 signature of `data` under `key`. */
export async function verifyEd25519(
  key: VerificationKey,
  signature: Bytes,
  data: Bytes,
): Promise<boolean> {
  if (signature.length !== ED25519_SIGNATURE_LENGTH) return false;
  try {
    return await subtle().verify(ED25519, key as CryptoKey, signature, data);
  } catch {
    return false;
  }
}
