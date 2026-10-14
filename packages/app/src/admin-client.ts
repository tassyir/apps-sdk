import type {
  HttpMethod,
  ListItem,
  ListPath,
  PathsWithMethod,
  RequestArgs,
  ResponseBody,
} from './admin-types.js';
import { ADMIN_API_VERSION, TASSYIR_API_ORIGIN } from './constants.js';
import { TassyirApiError, TassyirError } from './errors.js';
import type { Problem, RateLimitInfo } from './errors.js';
import type { FetchLike } from './http.js';
import {
  isRecord,
  parseRetryAfter,
  resolveFetch,
  resolveOrigin,
  send,
  sleep,
} from './http.js';

// The Admin API client (plan §3.5, §3.6): typed from the OpenAPI document,
// one error model (problem+json → TassyirApiError), `Idempotency-Key` on every
// write, retries only when asked for, keyset pagination. JSON is parsed as is:
// money stays a decimal string.

/** Where the client gets its bearer token. */
export type AccessTokenProvider =
  | string
  | ((context: {
      rejectedAccessToken: string | undefined;
    }) => string | Promise<string>);

export interface RetryOptions {
  /** Retries after the first attempt. Default 3 when `retries` is an object. */
  maxRetries?: number;
  /** The longest the SDK waits before one retry; a longer `Retry-After` fails at once. Default 30 seconds. */
  maxDelayMs?: number;
  /** The first backoff delay, doubled each retry (with jitter). Default 500 ms. */
  baseDelayMs?: number;
}

/** What one answer said, for logs and metrics. Never a token or a body. */
export interface ResponseInfo {
  operation: string;
  status: number;
  requestId: string | undefined;
  rateLimit: RateLimitInfo;
  attempt: number;
  durationMs: number;
}

export interface AdminClientOptions {
  /**
   * The bearer token: a `tsy_at_…` string, or a function returning one. With
   * a function, a 401 `APP_TOKEN_INVALID` calls it once more with the refused
   * token and repeats the request (`TassyirApp.admin()` wires the
   * TokenManager here).
   */
  accessToken: AccessTokenProvider;
  /** Default `https://api.tassyir.io`. */
  apiOrigin?: string;
  fetch?: FetchLike;
  /**
   * Retries, off by default. `true` or a number of retries turns them on.
   * After `Retry-After`, writes included: 429 `RATE_LIMITED` and
   * `BUSINESS_RATE_LIMITED`, 503 `API_BUSY` and `IDEMPOTENCY_UNAVAILABLE`
   * (nothing was done). For requests safe to repeat (reads, and writes with
   * an `Idempotency-Key`): any other 503, network errors, 502 and 504. Also
   * 409 `IDEMPOTENCY_KEY_IN_USE`, and 500 for reads only. Never 429
   * `IMAGE_QUOTA_REACHED` (`POST /images`): it throws at once, with its
   * `per`, `window` and `retryAfter` in `problem`, for the app to decide.
   */
  retries?: boolean | number | RetryOptions;
  /** Per attempt. Default 30 seconds. */
  timeoutMs?: number;
  /** Called after every answer: rate-limit headers, status, request id. */
  onResponse?: (info: ResponseInfo) => void;
}

/** A success answer with its metadata. */
export interface ApiResponse<T> {
  status: number;
  data: T;
  headers: Headers;
  requestId: string | undefined;
  rateLimit: RateLimitInfo;
  /** `Idempotent-Replayed: true`: a stored answer to an earlier identical write. */
  replayed: boolean;
}

/** `RequestOptions` once the path is no longer known to the compiler. */
interface AnyRequestOptions {
  path?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  idempotencyKey?: string | false;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

interface ResolvedRetries {
  maxRetries: number;
  maxDelayMs: number;
  baseDelayMs: number;
}

const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,255}$/;

function resolveRetries(value: AdminClientOptions['retries']): ResolvedRetries {
  const defaults = { maxRetries: 3, maxDelayMs: 30_000, baseDelayMs: 500 };
  if (value === undefined || value === false || value === 0)
    return { ...defaults, maxRetries: 0 };
  if (value === true) return defaults;
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > 10) {
      throw new TassyirError(
        'INVALID_OPTIONS',
        'retries must be a whole number from 0 to 10',
        {
          fix: 'Pass { retries: 3 }, or omit it to keep retries off.',
        },
      );
    }
    return { ...defaults, maxRetries: value };
  }
  return {
    maxRetries: value.maxRetries ?? defaults.maxRetries,
    maxDelayMs: value.maxDelayMs ?? defaults.maxDelayMs,
    baseDelayMs: value.baseDelayMs ?? defaults.baseDelayMs,
  };
}

function rateLimitOf(headers: Headers): RateLimitInfo {
  const number = (name: string): number | undefined => {
    const value = headers.get(name);
    return value !== null && /^\d+$/.test(value.trim())
      ? Number(value)
      : undefined;
  };
  return {
    limit: number('ratelimit-limit'),
    remaining: number('ratelimit-remaining'),
    resetSeconds: number('ratelimit-reset'),
  };
}

function buildPath(
  pattern: string,
  params: Record<string, unknown> | undefined,
): string {
  return pattern.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = params?.[name];
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new TassyirError(
        'INVALID_REQUEST',
        `Missing path parameter "${name}" for ${pattern}`,
        {
          fix: `Pass { path: { ${name}: '…' } }.`,
        },
      );
    }
    return encodeURIComponent(String(value));
  });
}

function buildQuery(query: Record<string, unknown> | undefined): string {
  if (!query) return '';
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) search.set(name, value.map(String).join(','));
    else if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      search.set(name, String(value));
    } else {
      throw new TassyirError(
        'INVALID_REQUEST',
        `Query parameter "${name}" must be a string, number, boolean or list`,
        {
          fix: 'Pass plain values in query; dates as ISO 8601 strings.',
        },
      );
    }
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

function problemOf(
  body: unknown,
  status: number,
): { code: string; problem: Problem } {
  if (isRecord(body) && typeof body['code'] === 'string') {
    return { code: body['code'], problem: body };
  }
  // Not a problem document (a proxy's HTML page, an empty body).
  return {
    code: status >= 500 ? 'SERVICE_UNAVAILABLE' : `HTTP_${String(status)}`,
    problem: {
      status,
      detail: `The API answered ${String(status)} without a problem document`,
    },
  };
}

/**
 * The Admin API (`/apps/2026-10/`). Paths are relative to the version and
 * typed from the OpenAPI document: `get('/orders/{id}', { path: { id } })`.
 * Every method resolves to the response body or throws `TassyirApiError`.
 */
export class AdminClient {
  readonly apiVersion = ADMIN_API_VERSION;
  readonly #token: AccessTokenProvider;
  readonly #base: string;
  readonly #fetch: FetchLike;
  readonly #retries: ResolvedRetries;
  readonly #timeoutMs: number;
  readonly #onResponse: ((info: ResponseInfo) => void) | undefined;

  constructor(options: AdminClientOptions) {
    if (!(
      typeof options.accessToken === 'function' ||
      (typeof options.accessToken === 'string' && options.accessToken !== '')
    )) {
      throw new TassyirError(
        'INVALID_OPTIONS',
        'accessToken is required: a tsy_at_… token or a function returning one',
        {
          fix: 'Use app.admin(installationId) to get a client that refreshes tokens, or pass { accessToken }.',
        },
      );
    }
    this.#token = options.accessToken;
    this.#base = `${resolveOrigin(options.apiOrigin, TASSYIR_API_ORIGIN)}/apps/${ADMIN_API_VERSION}`;
    this.#fetch = resolveFetch(options.fetch);
    this.#retries = resolveRetries(options.retries);
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#onResponse = options.onResponse;
  }

  get<P extends PathsWithMethod<'get'>>(
    path: P,
    ...args: RequestArgs<'get', P>
  ): Promise<ResponseBody<'get', P>> {
    return this.request('get', path, ...args).then((response) => response.data);
  }

  post<P extends PathsWithMethod<'post'>>(
    path: P,
    ...args: RequestArgs<'post', P>
  ): Promise<ResponseBody<'post', P>> {
    return this.request('post', path, ...args).then(
      (response) => response.data,
    );
  }

  put<P extends PathsWithMethod<'put'>>(
    path: P,
    ...args: RequestArgs<'put', P>
  ): Promise<ResponseBody<'put', P>> {
    return this.request('put', path, ...args).then((response) => response.data);
  }

  patch<P extends PathsWithMethod<'patch'>>(
    path: P,
    ...args: RequestArgs<'patch', P>
  ): Promise<ResponseBody<'patch', P>> {
    return this.request('patch', path, ...args).then(
      (response) => response.data,
    );
  }

  delete<P extends PathsWithMethod<'delete'>>(
    path: P,
    ...args: RequestArgs<'delete', P>
  ): Promise<ResponseBody<'delete', P>> {
    return this.request('delete', path, ...args).then(
      (response) => response.data,
    );
  }

  /**
   * Walks a list from its first page (or `query.cursor`) to its last,
   * yielding each item. Lists are keyset-paged, newest first: a row added
   * during the walk never shifts the pages still to come.
   */
  async *paginate<P extends ListPath>(
    path: P,
    ...args: RequestArgs<'get', P>
  ): AsyncGenerator<ListItem<P>, void> {
    const [options] = args;
    const base = (options ?? {}) as { query?: Record<string, unknown> };
    let cursor = base.query?.['cursor'] as string | undefined;
    do {
      const query = { ...base.query, cursor };
      const page = (
        await this.request(
          'get',
          path,
          ...([{ ...base, query }] as unknown as RequestArgs<'get', P>),
        )
      ).data as { data: ListItem<P>[]; nextCursor: string | null };
      for (const item of page.data) yield item;
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
  }

  /** Any call, with the answer's status and metadata (`201` vs `200` on `POST /orders`, say). */
  async request<M extends HttpMethod, P extends PathsWithMethod<M>>(
    method: M,
    path: P,
    ...args: RequestArgs<M, P>
  ): Promise<ApiResponse<ResponseBody<M, P>>> {
    const options = (args[0] ?? {}) as AnyRequestOptions;
    const verb = method.toUpperCase();
    const operation = `${verb} ${path}`;
    const url = `${this.#base}${buildPath(path, options.path)}${buildQuery(options.query)}`;
    const write = method !== 'get';

    // The caller's headers, except the two the SDK owns.
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      const lower = name.toLowerCase();
      if (lower !== 'authorization' && lower !== 'idempotency-key') {
        headers[lower] = value;
      }
    }
    headers['accept'] = 'application/json';
    if (options.body !== undefined)
      headers['content-type'] = 'application/json';
    let idempotencyKey: string | undefined;
    if (write && options.idempotencyKey !== false) {
      idempotencyKey = options.idempotencyKey ?? crypto.randomUUID();
      if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
        throw new TassyirError(
          'INVALID_REQUEST',
          'idempotencyKey must be 1 to 255 visible ASCII characters',
          {
            fix: 'Use a UUID, or an id of the business action (order-1042-confirm).',
          },
        );
      }
      headers['idempotency-key'] = idempotencyKey;
    }
    const safeToRepeat = !write || idempotencyKey !== undefined;
    const body =
      options.body === undefined ? undefined : JSON.stringify(options.body);

    let rejected: string | undefined;
    let tokenRetried = false;
    for (let attempt = 0; ; attempt += 1) {
      const token =
        typeof this.#token === 'function'
          ? await this.#token({ rejectedAccessToken: rejected })
          : this.#token;
      const started = Date.now();
      let response: Response;
      try {
        response = await send(
          this.#fetch,
          url,
          {
            method: verb,
            headers: { ...headers, authorization: `Bearer ${token}` },
            body,
          },
          { timeoutMs: this.#timeoutMs, signal: options.signal },
        );
      } catch (error) {
        if (
          error instanceof TassyirError &&
          safeToRepeat &&
          attempt < this.#retries.maxRetries
        ) {
          await sleep(this.#backoff(attempt), options.signal);
          continue;
        }
        throw error;
      }

      const rateLimit = rateLimitOf(response.headers);
      let text: string;
      try {
        text = await response.text();
      } catch (error) {
        throw new TassyirError(
          'NETWORK_ERROR',
          `${operation}: the connection closed before the answer was read`,
          {
            fix: 'Retry the call; a write is safe to retry with the same idempotencyKey.',
            cause: error,
          },
        );
      }
      let parsed: unknown;
      try {
        parsed = text === '' ? undefined : JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      const requestId =
        (isRecord(parsed) && typeof parsed['requestId'] === 'string'
          ? parsed['requestId']
          : undefined) ??
        response.headers.get('x-request-id') ??
        undefined;
      this.#onResponse?.({
        operation,
        status: response.status,
        requestId,
        rateLimit,
        attempt,
        durationMs: Date.now() - started,
      });

      if (response.ok) {
        if (parsed === undefined && text !== '') {
          throw new TassyirError(
            'INVALID_RESPONSE',
            `${operation} answered ${String(response.status)} with a body that is not JSON`,
            {
              fix: 'Check apiOrigin points at the Tassyir API.',
            },
          );
        }
        return {
          status: response.status,
          data: parsed as ResponseBody<M, P>,
          headers: response.headers,
          requestId,
          rateLimit,
          replayed: response.headers.get('idempotent-replayed') === 'true',
        };
      }

      const { code, problem } = problemOf(parsed, response.status);
      const error = new TassyirApiError({
        status: response.status,
        code,
        problem,
        requestId,
        retryAfterSeconds: parseRetryAfter(
          response.headers.get('retry-after'),
          Date.now(),
        ),
        rateLimit,
        method: verb,
        path,
      });

      // A refused token: ask the provider for another one, once.
      if (
        response.status === 401 &&
        code === 'APP_TOKEN_INVALID' &&
        typeof this.#token === 'function' &&
        !tokenRetried
      ) {
        tokenRetried = true;
        rejected = token;
        attempt -= 1;
        continue;
      }

      const delay = this.#retryDelay(error, safeToRepeat, write, attempt);
      if (delay === undefined) throw error;
      await sleep(delay, options.signal);
    }
  }

  #backoff(attempt: number): number {
    const ceiling = Math.min(
      this.#retries.maxDelayMs,
      this.#retries.baseDelayMs * 2 ** attempt,
    );
    return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
  }

  /** How long to wait before retrying, or undefined to throw now. */
  #retryDelay(
    error: TassyirApiError,
    safeToRepeat: boolean,
    write: boolean,
    attempt: number,
  ): number | undefined {
    if (attempt >= this.#retries.maxRetries) return undefined;
    const { status, code } = error;
    const retryable =
      // RATE_LIMITED (the installation's bucket) and BUSINESS_RATE_LIMITED
      // (the ceiling the business's apps share) refuse before the route runs.
      // IMAGE_QUOTA_REACHED (POST /images) is left to the app: a daily quota
      // is not worth retrying, and `problem.window` says which one is full.
      (status === 429 && code !== 'IMAGE_QUOTA_REACHED') ||
      // API_BUSY (the process's in-flight cap) and IDEMPOTENCY_UNAVAILABLE
      // refuse before the write is attempted: safe to repeat even without a key.
      (status === 503 &&
        (safeToRepeat ||
          code === 'IDEMPOTENCY_UNAVAILABLE' ||
          code === 'API_BUSY')) ||
      (status === 409 && code === 'IDEMPOTENCY_KEY_IN_USE') ||
      ((status === 502 || status === 504) && safeToRepeat) ||
      (status === 500 && !write);
    if (!retryable) return undefined;
    if (error.retryAfterSeconds !== undefined) {
      const wait = error.retryAfterSeconds * 1000;
      return wait > this.#retries.maxDelayMs ? undefined : wait;
    }
    return this.#backoff(attempt);
  }
}
