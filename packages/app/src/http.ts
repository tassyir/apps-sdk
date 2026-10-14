import { TassyirError } from './errors.js';

/**
 * The fetch the SDK calls. `globalThis.fetch` by default; pass your own to
 * add a proxy, logging or a test double. It is also the transport seam a
 * Tassyir Hosting runtime would fill (AP-B1.16, not built yet).
 */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export function resolveFetch(fetchImpl: FetchLike | undefined): FetchLike {
  if (fetchImpl) return fetchImpl;
  const global = (globalThis as { fetch?: FetchLike }).fetch;
  if (typeof global !== 'function') {
    throw new TassyirError(
      'FETCH_UNAVAILABLE',
      'This runtime has no global fetch',
      { fix: 'Run on Node 22 or later, or pass { fetch } in the options.' },
    );
  }
  return (url, init) => global(url, init);
}

/** `https://api.tassyir.io` style: an http(s) origin, no path, no trailing slash. */
export function resolveOrigin(
  origin: string | undefined,
  fallback: string,
): string {
  const value = origin ?? fallback;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidOrigin();
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw invalidOrigin();
  }
  return url.origin;
}

function invalidOrigin(): TassyirError {
  return new TassyirError(
    'INVALID_OPTIONS',
    'apiOrigin must be an https origin such as https://api.tassyir.io (http only for localhost)',
    {
      fix: 'Pass the origin only, without a path or a trailing slash, or omit apiOrigin for production.',
    },
  );
}

export interface SendOptions {
  timeoutMs: number;
  signal?: AbortSignal | undefined;
}

/**
 * Calls fetch and turns a transport failure into a TassyirError
 * (`NETWORK_ERROR`, `TIMEOUT`). An abort by the caller's own signal is
 * rethrown as it is.
 */
export async function send(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  options: SendOptions,
): Promise<Response> {
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  try {
    return await fetchImpl(url, { ...init, signal });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (timeout.aborted) {
      throw new TassyirError(
        'TIMEOUT',
        `No answer from ${new URL(url).origin} within ${String(options.timeoutMs)} ms`,
        { fix: 'Retry later, or raise timeoutMs.', cause: error },
      );
    }
    throw new TassyirError(
      'NETWORK_ERROR',
      `Could not reach ${new URL(url).origin}`,
      {
        fix: 'Check the network and apiOrigin, then retry.',
        cause: error,
      },
    );
  }
}

/** Seconds from a `Retry-After` header (delta-seconds or an HTTP date). */
export function parseRetryAfter(
  value: string | null,
  nowMs: number,
): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - nowMs) / 1000));
}

/** Waits `ms`, or rejects when `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason as Error);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason as Error);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Reads a JSON body, or `undefined` when it is not JSON. */
export async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
