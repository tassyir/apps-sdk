import {
  JWKS_PATH,
  TASSYIR_API_ORIGIN,
  WEBHOOK_KEYS_PATH,
} from './constants.js';
import { importEd25519PublicKey } from './ed25519.js';
import type { VerificationKey } from './ed25519.js';
import { base64Decode, base64UrlDecode } from './encoding.js';
import { TassyirError } from './errors.js';
import type { FetchLike } from './http.js';
import {
  isRecord,
  readJson,
  resolveFetch,
  resolveOrigin,
  send,
} from './http.js';

// Tassyir's public keys: the ID-token JWKS (`GET /apps/.well-known/jwks.json`)
// and the webhook keys (`GET /apps/webhook-keys`). Both are fetched once,
// cached for the answer's max-age (an hour), and fetched again when a token
// names a kid we do not hold or no key verifies a delivery: that is how a key
// published for a rotation reaches a running app. The cool-down bounds how
// often garbage can make us fetch.

export interface KeySourceOptions {
  /** Default `https://api.tassyir.io`. */
  apiOrigin?: string;
  fetch?: FetchLike;
  /**
   * The longest a fetched document is trusted, in ms. Default one hour; a
   * shorter `Cache-Control: max-age` on the answer wins.
   */
  maxAgeMs?: number;
  /**
   * The shortest time between two fetches caused by an unknown `kid` or a
   * signature no key verifies, in ms. Default 30 seconds.
   */
  refetchCooldownMs?: number;
  /** Default 10 seconds. */
  timeoutMs?: number;
  /** The clock, in ms. Default `Date.now`. */
  now?: () => number;
}

const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000;
const DEFAULT_COOLDOWN_MS = 30 * 1000;
const DEFAULT_TIMEOUT_MS = 10 * 1000;

interface Loaded<K> {
  keys: K;
  maxAgeMs: number | undefined;
}

/** A key document fetched on demand, single-flight, with a cool-down. */
class KeyDocument<K> {
  private keys: K | undefined;
  private expiresAt = 0;
  private fetchedAt = Number.NEGATIVE_INFINITY;
  private inflight: Promise<K> | undefined;

  constructor(
    private readonly load: () => Promise<Loaded<K>>,
    private readonly maxAgeMs: number,
    private readonly cooldownMs: number,
    private readonly now: () => number,
  ) {}

  async current(): Promise<K> {
    if (this.keys !== undefined && this.now() < this.expiresAt)
      return this.keys;
    return this.fetch();
  }

  /** Fetches again unless a fetch started less than the cool-down ago. */
  async refresh(): Promise<boolean> {
    if (this.inflight) {
      await this.inflight;
      return true;
    }
    if (this.now() - this.fetchedAt < this.cooldownMs) return false;
    await this.fetch();
    return true;
  }

  private fetch(): Promise<K> {
    this.inflight ??= (async () => {
      this.fetchedAt = this.now();
      try {
        const loaded = await this.load();
        this.keys = loaded.keys;
        this.expiresAt =
          this.now() +
          Math.min(this.maxAgeMs, loaded.maxAgeMs ?? this.maxAgeMs);
        return loaded.keys;
      } finally {
        this.inflight = undefined;
      }
    })();
    return this.inflight;
  }
}

function maxAgeOf(response: Response): number | undefined {
  const match = /(?:^|,)\s*max-age=(\d+)/i.exec(
    response.headers.get('cache-control') ?? '',
  );
  return match?.[1] === undefined ? undefined : Number(match[1]) * 1000;
}

function keyDocumentUrl(options: KeySourceOptions, path: string): string {
  return `${resolveOrigin(options.apiOrigin, TASSYIR_API_ORIGIN)}${path}`;
}

async function fetchKeyDocument(
  options: KeySourceOptions,
  url: string,
  what: string,
): Promise<{ body: unknown; maxAgeMs: number | undefined }> {
  const fetchImpl = resolveFetch(options.fetch);
  let response: Response;
  try {
    response = await send(
      fetchImpl,
      url,
      { method: 'GET', headers: { accept: 'application/json' } },
      { timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS },
    );
  } catch (error) {
    throw new TassyirError(
      'KEYS_UNAVAILABLE',
      `Could not fetch ${what} from ${url}`,
      {
        fix: 'Retry shortly; check that apiOrigin is reachable from this server.',
        cause: error,
      },
    );
  }
  const body = await readJson(response);
  if (
    response.status === 503 &&
    isRecord(body) &&
    body['code'] === 'APPS_KEYS_NOT_CONFIGURED'
  ) {
    throw new TassyirError(
      'KEYS_NOT_CONFIGURED',
      `${url} says this Tassyir environment has no ${what} configured`,
      {
        fix: 'Check that apiOrigin points at the environment your app is registered on (production: https://api.tassyir.io).',
      },
    );
  }
  if (!response.ok) {
    throw new TassyirError(
      'KEYS_UNAVAILABLE',
      `Fetching ${what} from ${url} answered ${String(response.status)}`,
      { fix: 'Retry shortly; check that apiOrigin is the Tassyir API.' },
    );
  }
  return { body, maxAgeMs: maxAgeOf(response) };
}

function invalidKeys(what: string, detail: string): TassyirError {
  return new TassyirError('KEYS_INVALID', `Invalid ${what}: ${detail}`, {
    fix: 'Pass the document exactly as the Tassyir API serves it, or use the remote key source.',
  });
}

/** One JWK of the ID-token key set (RFC 8037). */
export interface IdTokenJwk {
  kty: string;
  crv: string;
  x: string;
  kid: string;
  alg?: string;
  use?: string;
}

async function parseJwks(
  document: unknown,
): Promise<Map<string, VerificationKey>> {
  const what = 'ID-token key set (JWKS)';
  if (!isRecord(document) || !Array.isArray(document['keys'])) {
    throw invalidKeys(what, 'expected { "keys": [...] }');
  }
  const keys = new Map<string, VerificationKey>();
  for (const entry of document['keys'] as unknown[]) {
    // Keys of another type are skipped, not refused: a later key type must
    // not break apps that only know Ed25519.
    if (
      !isRecord(entry) ||
      entry['kty'] !== 'OKP' ||
      entry['crv'] !== 'Ed25519' ||
      typeof entry['kid'] !== 'string' ||
      typeof entry['x'] !== 'string' ||
      (entry['alg'] !== undefined && entry['alg'] !== 'EdDSA') ||
      (entry['use'] !== undefined && entry['use'] !== 'sig') ||
      keys.has(entry['kid'])
    ) {
      continue;
    }
    const raw = base64UrlDecode(entry['x']);
    if (raw?.length !== 32) continue;
    keys.set(entry['kid'], await importEd25519PublicKey(raw));
  }
  return keys;
}

/**
 * The public keys that verify ID tokens, chosen by `kid`.
 * `IdTokenKeys.remote()` in production; `IdTokenKeys.fromJwks()` for tests
 * or a document you fetched yourself.
 */
export class IdTokenKeys {
  private constructor(
    private readonly document: KeyDocument<Map<string, VerificationKey>>,
  ) {}

  /** Fetches `GET /apps/.well-known/jwks.json`, cached, refetched on an unknown kid. */
  static remote(options: KeySourceOptions = {}): IdTokenKeys {
    const url = keyDocumentUrl(options, JWKS_PATH);
    const load = async (): Promise<Loaded<Map<string, VerificationKey>>> => {
      const { body, maxAgeMs } = await fetchKeyDocument(
        options,
        url,
        'ID-token keys',
      );
      return { keys: await parseJwks(body), maxAgeMs };
    };
    return new IdTokenKeys(
      new KeyDocument(
        load,
        options.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
        options.refetchCooldownMs ?? DEFAULT_COOLDOWN_MS,
        options.now ?? Date.now,
      ),
    );
  }

  /** A fixed key set: a JWKS document (`{ keys: [...] }`). Never fetches. */
  static fromJwks(document: { keys: readonly IdTokenJwk[] }): IdTokenKeys {
    return new IdTokenKeys(
      new KeyDocument(
        async () => ({ keys: await parseJwks(document), maxAgeMs: undefined }),
        Number.POSITIVE_INFINITY,
        Number.POSITIVE_INFINITY,
        Date.now,
      ),
    );
  }

  /** The key named `kid`, fetching the set again once if it is unknown. */
  async get(kid: string): Promise<VerificationKey | undefined> {
    const key = (await this.document.current()).get(kid);
    if (key) return key;
    if (!(await this.document.refresh())) return undefined;
    return (await this.document.current()).get(kid);
  }
}

/** One entry of `GET /apps/webhook-keys`. */
export interface WebhookKeyEntry {
  kid: string;
  scheme: string;
  publicKey: string;
}

const WEBHOOK_PUBLIC_KEY_PREFIX = 'whpk_';

async function importWebhookKey(
  publicKey: string,
): Promise<VerificationKey | null> {
  if (!publicKey.startsWith(WEBHOOK_PUBLIC_KEY_PREFIX)) return null;
  const raw = base64Decode(publicKey.slice(WEBHOOK_PUBLIC_KEY_PREFIX.length));
  if (raw?.length !== 32) return null;
  return importEd25519PublicKey(raw);
}

async function parseWebhookKeys(document: unknown): Promise<VerificationKey[]> {
  const what = 'webhook key set';
  if (!isRecord(document) || !Array.isArray(document['keys'])) {
    throw invalidKeys(what, 'expected { "keys": [...] }');
  }
  const keys: VerificationKey[] = [];
  for (const entry of document['keys'] as unknown[]) {
    if (
      !isRecord(entry) ||
      entry['scheme'] !== 'v1a' ||
      typeof entry['publicKey'] !== 'string'
    ) {
      continue;
    }
    const key = await importWebhookKey(entry['publicKey']);
    if (key) keys.push(key);
  }
  return keys;
}

/**
 * The public keys that verify webhook deliveries. `WebhookKeys.remote()` in
 * production; `WebhookKeys.fromPublicKeys(['whpk_…'])` for tests or keys you
 * pinned yourself.
 */
export class WebhookKeys {
  private constructor(
    private readonly document: KeyDocument<VerificationKey[]>,
  ) {}

  /** Fetches `GET /apps/webhook-keys`, cached, refetched when no key verifies a delivery. */
  static remote(options: KeySourceOptions = {}): WebhookKeys {
    const url = keyDocumentUrl(options, WEBHOOK_KEYS_PATH);
    const load = async (): Promise<Loaded<VerificationKey[]>> => {
      const { body, maxAgeMs } = await fetchKeyDocument(
        options,
        url,
        'webhook keys',
      );
      return { keys: await parseWebhookKeys(body), maxAgeMs };
    };
    return new WebhookKeys(
      new KeyDocument(
        load,
        options.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
        options.refetchCooldownMs ?? DEFAULT_COOLDOWN_MS,
        options.now ?? Date.now,
      ),
    );
  }

  /**
   * A fixed key set: `whpk_…` strings, or the `{ keys: [...] }` document.
   * Never fetches. The first verification throws `KEYS_INVALID` when a key
   * is not `whpk_` + the base64 of 32 bytes.
   */
  static fromPublicKeys(
    keys: readonly string[] | { keys: readonly WebhookKeyEntry[] },
  ): WebhookKeys {
    const parse = (): Promise<VerificationKey[]> =>
      Array.isArray(keys)
        ? Promise.all(
            (keys as readonly unknown[]).map(async (publicKey) => {
              const key =
                typeof publicKey === 'string'
                  ? await importWebhookKey(publicKey)
                  : null;
              if (!key) {
                throw invalidKeys(
                  'webhook public key',
                  'expected whpk_ + the base64 of 32 bytes',
                );
              }
              return key;
            }),
          )
        : parseWebhookKeys(keys);
    return new WebhookKeys(
      new KeyDocument(
        async () => ({ keys: await parse(), maxAgeMs: undefined }),
        Number.POSITIVE_INFINITY,
        Number.POSITIVE_INFINITY,
        Date.now,
      ),
    );
  }

  /** Every published key. */
  async all(): Promise<readonly VerificationKey[]> {
    return this.document.current();
  }

  /** Fetches the keys again unless that happened less than the cool-down ago. */
  async refresh(): Promise<boolean> {
    return this.document.refresh();
  }
}
