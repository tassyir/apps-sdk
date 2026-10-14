import type {
  AppCredential,
  AppVersion,
  CliToken,
  CreateAppBody,
  CreatedDevStore,
  Delivery,
  DeliveryFilters,
  DevStore,
  DeveloperAccount,
  DeveloperApp,
  DeveloperTokenResponse,
  DeviceCodeResponse,
  Installation,
  MintCredentialResponse,
  Page,
  ReplayResponse,
  TestDelivery,
} from './api-types.js';
import { CliError, EXIT_CODES } from './errors.js';
import type { ExitCode } from './errors.js';

// A small typed client of the developer API (`developer/*`), written from the
// backend's reference docs: it has no OpenAPI document yet. Two dialects:
// the sign-in routes speak OAuth (form bodies, `{ error, error_description }`),
// every other route JSON with `{ statusCode, code, message, fix, … }`
// refusals. Nothing here prints; `debug` gets method, path and status only,
// never a header or a body.

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** The CLI's OAuth client id: the only one the API knows today. */
export const CLI_CLIENT_ID = 'tassyir-cli';

export const DEFAULT_API_ORIGIN = 'https://api.tassyir.io';

export interface DeveloperApiOptions {
  /** `https://api.tassyir.io`, or another origin (`TASSYIR_API_ORIGIN`). */
  apiOrigin: string;
  fetch: FetchLike;
  /** `tassyir-cli/<version> …`, so the API's logs can tell CLI calls apart. */
  userAgent: string;
  /** The developer token; absent for the public sign-in routes. */
  token?: string | undefined;
  /** Per request. Default 30 seconds. */
  timeoutMs?: number;
  /** One line per request and answer: method, path, status, duration. */
  debug?: ((line: string) => void) | undefined;
}

/** What `startSignIn` sends: RFC 8628 §3.1 plus the API's optional fields. */
export interface SignInRequest {
  clientVersion?: string | undefined;
  deviceName?: string | undefined;
  locale?: string | undefined;
}

/** One poll of `POST /developer/cli/token`. */
export type PollResult =
  | { ok: true; token: DeveloperTokenResponse }
  | {
      ok: false;
      /** An RFC 8628 §3.5 error, or another OAuth error the API sent. */
      error: string;
      description: string | undefined;
      status: number;
      retryAfterSeconds: number | undefined;
    };

/** Codes whose fix the CLI knows better than a generic one, when the API gave none. */
const FALLBACK_FIXES: Readonly<Record<string, string>> = {
  DEVELOPER_TOKEN_INVALID:
    'Run `tassyir login` again: the token was revoked, unused for 90 days, older than 365 days, or your password changed since you signed in.',
  DEVELOPER_TOKEN_RATE_LIMITED:
    'Wait retryAfterSeconds, then try again; if your token keeps being refused, run `tassyir login`.',
  DEVELOPER_ACCOUNT_NOT_FOUND:
    'Turn on developer mode in the dashboard (https://app.tassyir.io/en/developers), then run the command again.',
  PAYLOAD_TOO_LARGE:
    'Make the request smaller: a manifest upload is at most 128 KB.',
};

/** The keys of a refusal body that are not its details. */
const ENVELOPE_KEYS = new Set([
  'statusCode',
  'code',
  'message',
  'fix',
  'requestId',
  'errors',
  'error',
  'path',
  'type',
  'title',
  'status',
  'detail',
]);

export class DeveloperApi {
  readonly apiOrigin: string;
  readonly #fetch: FetchLike;
  readonly #userAgent: string;
  readonly #token: string | undefined;
  readonly #timeoutMs: number;
  readonly #debug: ((line: string) => void) | undefined;

  constructor(options: DeveloperApiOptions) {
    this.apiOrigin = options.apiOrigin;
    this.#fetch = options.fetch;
    this.#userAgent = options.userAgent;
    this.#token = options.token;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#debug = options.debug;
  }

  // ── Sign-in (RFC 8628, public) ───────────────────────────────────────────

  /** `POST /developer/cli/device-code`: a device code and a user code. */
  async startSignIn(request: SignInRequest): Promise<DeviceCodeResponse> {
    const form: Record<string, string> = { client_id: CLI_CLIENT_ID };
    if (request.clientVersion) form['client_version'] = request.clientVersion;
    if (request.deviceName) form['device_name'] = request.deviceName;
    if (request.locale) form['locale'] = request.locale;
    const { response, body } = await this.#send(
      'POST',
      '/developer/cli/device-code',
      { form },
    );
    if (response.ok) return deviceCodeResponse(body);
    const error = oauthError(body);
    const retryAfterSeconds = retryAfterOf(response, body);
    if (response.status >= 500) {
      throw new CliError({
        code: 'SERVER_ERROR',
        message: `The API could not start a sign-in (HTTP ${String(response.status)})`,
        fix: 'Run `tassyir login` again in a minute.',
        exitCode: EXIT_CODES.TRY_LATER,
        status: response.status,
        retryAfterSeconds,
      });
    }
    if (error.error === 'slow_down' || response.status === 429) {
      throw new CliError({
        code: 'LOGIN_RATE_LIMITED',
        message: 'Too many sign-ins were started from this address',
        fix: 'Wait a few minutes (retryAfterSeconds), then run `tassyir login` again.',
        exitCode: EXIT_CODES.TRY_LATER,
        status: response.status,
        retryAfterSeconds,
      });
    }
    throw new CliError({
      code: 'LOGIN_FAILED',
      message: `The API refused to start a sign-in: ${error.error}${error.description ? ` (${error.description})` : ''}`,
      fix:
        error.error === 'invalid_request'
          ? "Check --device-name (letters, digits, spaces and ._-'()@, at most 64) and --locale (ar or en)."
          : 'Update the CLI (npm install -g tassyir@latest), then run `tassyir login` again.',
      status: response.status,
    });
  }

  /** `POST /developer/cli/token`: one poll. Network failures throw. */
  async pollSignIn(deviceCode: string): Promise<PollResult> {
    const { response, body } = await this.#send(
      'POST',
      '/developer/cli/token',
      {
        form: {
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: deviceCode,
          client_id: CLI_CLIENT_ID,
        },
      },
    );
    if (response.ok) return { ok: true, token: tokenResponse(body) };
    const error = oauthError(body);
    return {
      ok: false,
      error: error.error,
      description: error.description,
      status: response.status,
      retryAfterSeconds: retryAfterOf(response, body),
    };
  }

  // ── The caller's CLI tokens ───────────────────────────────────────────────

  listTokens(): Promise<{ data: CliToken[] }> {
    return this.#json('GET', '/developer/cli/tokens');
  }

  /** `tassyir logout`: revokes the token this request is made with. */
  revokeCurrentToken(): Promise<{ data: CliToken }> {
    return this.#json('DELETE', '/developer/cli/tokens/current');
  }

  // ── Account, apps, versions, secrets ─────────────────────────────────────

  getAccount(): Promise<{ data: DeveloperAccount | null }> {
    return this.#json('GET', '/developer/account');
  }

  listApps(): Promise<{ data: DeveloperApp[] }> {
    return this.#json('GET', '/developer/apps');
  }

  getApp(appId: string): Promise<{ data: DeveloperApp }> {
    return this.#json('GET', `/developer/apps/${segment(appId)}`);
  }

  createApp(body: CreateAppBody): Promise<{ data: DeveloperApp }> {
    return this.#json('POST', '/developer/apps', { body });
  }

  listVersions(
    appId: string,
    query: { limit?: number; cursor?: string } = {},
  ): Promise<Page<AppVersion>> {
    return this.#json('GET', `/developer/apps/${segment(appId)}/versions`, {
      query,
    });
  }

  /** The parsed `tassyir.app.toml`, as the API's validator takes it. */
  uploadVersion(
    appId: string,
    manifest: unknown,
  ): Promise<{ data: AppVersion }> {
    return this.#json('POST', `/developer/apps/${segment(appId)}/versions`, {
      body: { manifest },
    });
  }

  listCredentials(appId: string): Promise<{ data: AppCredential[] }> {
    return this.#json('GET', `/developer/apps/${segment(appId)}/credentials`);
  }

  /** Mints a client secret: the app's first, or a rotation. Shown once. */
  mintCredential(appId: string): Promise<MintCredentialResponse> {
    return this.#json('POST', `/developer/apps/${segment(appId)}/credentials`);
  }

  revokeCredential(
    appId: string,
    credentialId: string,
  ): Promise<{ data: AppCredential }> {
    return this.#json(
      'DELETE',
      `/developer/apps/${segment(appId)}/credentials/${segment(credentialId)}`,
    );
  }

  // ── Dev stores ────────────────────────────────────────────────────────────

  listDevStores(): Promise<{ data: DevStore[] }> {
    return this.#json('GET', '/developer/dev-stores');
  }

  createDevStore(body: {
    name?: string;
    seed?: boolean;
  }): Promise<{ data: CreatedDevStore }> {
    return this.#json('POST', '/developer/dev-stores', { body });
  }

  // ── The webhook console ──────────────────────────────────────────────────

  listInstallations(
    appId: string,
    query: { status?: string; limit?: number; cursor?: string } = {},
  ): Promise<Page<Installation>> {
    return this.#json(
      'GET',
      `/developer/apps/${segment(appId)}/installations`,
      { query },
    );
  }

  listDeliveries(
    appId: string,
    filters: DeliveryFilters = {},
  ): Promise<Page<Delivery>> {
    return this.#json(
      'GET',
      `/developer/apps/${segment(appId)}/webhooks/deliveries`,
      { query: { ...filters } },
    );
  }

  replayDelivery(appId: string, deliveryId: string): Promise<ReplayResponse> {
    return this.#json(
      'POST',
      `/developer/apps/${segment(appId)}/webhooks/deliveries/${segment(deliveryId)}/replay`,
    );
  }

  /** The console's test route: a synthetic event of `topic`, signed and sent. */
  testWebhook(
    appId: string,
    installationId: string,
    topic: string,
  ): Promise<{ data: TestDelivery }> {
    return this.#json(
      'POST',
      `/developer/apps/${segment(appId)}/installations/${segment(installationId)}/webhooks/test`,
      { body: { topic } },
    );
  }

  // ── Transport ─────────────────────────────────────────────────────────────

  async #json<T>(
    method: string,
    path: string,
    options: { body?: unknown; query?: Record<string, unknown> } = {},
  ): Promise<T> {
    const { response, body } = await this.#send(method, path, {
      ...options,
      auth: true,
    });
    if (!response.ok) throw apiError(response, body);
    if (!isRecord(body)) throw invalidResponse(path);
    return body as T;
  }

  async #send(
    method: string,
    path: string,
    options: {
      body?: unknown;
      form?: Record<string, string>;
      query?: Record<string, unknown>;
      auth?: boolean;
    },
  ): Promise<{ response: Response; body: unknown }> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': this.#userAgent,
    };
    if (options.auth) {
      if (!this.#token) {
        throw new CliError({
          code: 'NOT_LOGGED_IN',
          message: `Not signed in to ${this.apiOrigin}`,
          fix: 'Run `tassyir login`.',
          exitCode: EXIT_CODES.AUTH,
        });
      }
      headers['authorization'] = `Bearer ${this.#token}`;
    }
    let payload: string | undefined;
    if (options.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      payload = new URLSearchParams(options.form).toString();
    } else if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(options.body);
    }
    const url = `${this.apiOrigin}${path}${queryString(options.query)}`;
    const started = Date.now();
    this.#debug?.(`→ ${method} ${path}`);
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method,
        headers,
        ...(payload === undefined ? {} : { body: payload }),
        redirect: 'error',
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      this.#debug?.(`✗ ${method} ${path}: ${networkReason(error)}`);
      throw networkError(this.apiOrigin, error);
    }
    const text = await response.text().catch(() => '');
    const requestId = response.headers.get('x-request-id') ?? undefined;
    this.#debug?.(
      `← ${String(response.status)} ${method} ${path} ${String(Date.now() - started)}ms${requestId ? ` request ${requestId}` : ''}`,
    );
    let body: unknown = {};
    if (text.trim() !== '') {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        if (response.ok) throw invalidResponse(path);
        body = {};
      }
    }
    if (isRecord(body) && requestId && body['requestId'] === undefined) {
      body = { ...body, requestId };
    }
    return { response, body };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function segment(value: string): string {
  return encodeURIComponent(value);
}

function queryString(query: Record<string, unknown> | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'string') params.set(key, value);
    else if (typeof value === 'number' || typeof value === 'boolean') {
      params.set(key, String(value));
    }
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function invalidResponse(path: string): CliError {
  return new CliError({
    code: 'INVALID_RESPONSE',
    message: `The API's answer to ${path} is not what the CLI expects`,
    fix: 'Check TASSYIR_API_ORIGIN (it must be the Tassyir API), or update the CLI (npm install -g tassyir@latest).',
  });
}

function deviceCodeResponse(body: unknown): DeviceCodeResponse {
  if (
    !isRecord(body) ||
    typeof body['device_code'] !== 'string' ||
    typeof body['user_code'] !== 'string' ||
    typeof body['verification_uri'] !== 'string' ||
    typeof body['verification_uri_complete'] !== 'string'
  ) {
    throw invalidResponse('/developer/cli/device-code');
  }
  const expires = Number(body['expires_in']);
  const interval = Number(body['interval']);
  return {
    device_code: body['device_code'],
    user_code: body['user_code'],
    verification_uri: body['verification_uri'],
    verification_uri_complete: body['verification_uri_complete'],
    expires_in: Number.isFinite(expires) && expires > 0 ? expires : 600,
    interval: Number.isFinite(interval) && interval > 0 ? interval : 5,
  };
}

const TOKEN_SHAPE = /^tsy_dt_[0-9A-Za-z]{20,}$/;

function tokenResponse(body: unknown): DeveloperTokenResponse {
  if (
    !isRecord(body) ||
    typeof body['access_token'] !== 'string' ||
    !TOKEN_SHAPE.test(body['access_token']) ||
    typeof body['token_id'] !== 'string'
  ) {
    // Never echo the body: it may hold a token.
    throw invalidResponse('/developer/cli/token');
  }
  return {
    access_token: body['access_token'],
    token_type: stringOf(body['token_type']) ?? 'Bearer',
    expires_in: Number(body['expires_in']) || 0,
    scope: stringOf(body['scope']) ?? 'developer',
    token_id: body['token_id'],
    user_id: stringOf(body['user_id']) ?? '',
    email: stringOf(body['email']) ?? '',
  };
}

function oauthError(body: unknown): {
  error: string;
  description: string | undefined;
} {
  if (!isRecord(body))
    return { error: 'invalid_response', description: undefined };
  return {
    error: stringOf(body['error']) ?? 'invalid_response',
    description: stringOf(body['error_description']),
  };
}

/** `Retry-After` (seconds or an HTTP date) or the body's `retryAfterSeconds`. */
export function retryAfterOf(
  response: Response,
  body: unknown,
  now: number = Date.now(),
): number | undefined {
  const header = response.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
    const date = Date.parse(header);
    if (Number.isFinite(date)) {
      return Math.max(0, Math.ceil((date - now) / 1000));
    }
  }
  if (isRecord(body)) {
    for (const key of ['retryAfterSeconds', 'retryAfter']) {
      const value = body[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return Math.ceil(value);
      }
    }
  }
  return undefined;
}

/** The generic code of a refusal that carries none (validation, throttler). */
function fallbackCode(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 413:
      return 'PAYLOAD_TOO_LARGE';
    case 429:
      return 'RATE_LIMITED';
    default:
      return status >= 500 ? 'SERVER_ERROR' : `HTTP_${String(status)}`;
  }
}

function fallbackFix(status: number): string {
  if (status === 401) return FALLBACK_FIXES['DEVELOPER_TOKEN_INVALID'] ?? '';
  if (status === 429) {
    return 'Wait a minute (retryAfterSeconds when given), then run the command again.';
  }
  if (status >= 500) {
    return 'Tassyir could not answer: run the command again in a minute; quote the requestId if it keeps failing.';
  }
  if (status === 404) {
    return 'Check the id or handle you passed: only your own apps, installations and deliveries are visible.';
  }
  return "Check the command's options (`tassyir <command> --help`), then run it again.";
}

function exitCodeFor(status: number, code: string): ExitCode {
  if (status === 401) return EXIT_CODES.AUTH;
  if (code.startsWith('APP_MANIFEST_')) return EXIT_CODES.MANIFEST;
  if (status === 429 || status === 502 || status === 503 || status === 504) {
    return EXIT_CODES.TRY_LATER;
  }
  return EXIT_CODES.FAILED;
}

function problemsOf(value: unknown): CliError['errors'] {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord).map((problem) => ({
    code: stringOf(problem['code']) ?? 'UNKNOWN',
    path: typeof problem['path'] === 'string' ? problem['path'] : '',
    message: stringOf(problem['message']) ?? '',
    fix: stringOf(problem['fix']) ?? '',
  }));
}

/** A developer-API refusal as a CliError: its code, message, fix and details. */
export function apiError(response: Response, body: unknown): CliError {
  const record = isRecord(body) ? body : {};
  const status = response.status;
  const code = stringOf(record['code']) ?? fallbackCode(status);
  const rawMessage = record['message'];
  const message =
    (Array.isArray(rawMessage)
      ? rawMessage.filter((part) => typeof part === 'string').join('; ')
      : stringOf(rawMessage)) ??
    stringOf(record['detail']) ??
    stringOf(record['title']) ??
    `The API answered ${String(status)}`;
  const details: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!ENVELOPE_KEYS.has(key)) details[key] = value;
  }
  return new CliError({
    code,
    message,
    fix: stringOf(record['fix']) ?? FALLBACK_FIXES[code] ?? fallbackFix(status),
    exitCode: exitCodeFor(status, code),
    status,
    requestId: stringOf(record['requestId']),
    retryAfterSeconds: retryAfterOf(response, body),
    errors: problemsOf(record['errors']),
    ...(Object.keys(details).length > 0 ? { details } : {}),
  });
}

/** Why a request did not reach the API, without anything the request held. */
function networkReason(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return 'timed out';
    }
    const cause = (error as { cause?: unknown }).cause;
    // Undici refuses a redirect (`redirect: 'error'`) with a cause whose
    // message names it and which has no code.
    const causeMessage =
      cause instanceof Error
        ? cause.message
        : isRecord(cause)
          ? stringOf(cause['message'])
          : undefined;
    if (`${error.message} ${causeMessage ?? ''}`.includes('redirect')) {
      return 'redirected';
    }
    const code = isRecord(cause) ? stringOf(cause['code']) : undefined;
    if (code) return code;
  }
  return 'network error';
}

function networkError(apiOrigin: string, error: unknown): CliError {
  const reason = networkReason(error);
  if (reason === 'redirected') {
    // Never followed (the token would go wherever it points), and retrying
    // will not change it.
    return new CliError({
      code: 'API_REDIRECTED',
      message: `${apiOrigin} answered with a redirect, which the CLI never follows`,
      fix: 'Check TASSYIR_API_ORIGIN / --api-origin: it must be the Tassyir API itself (https://api.tassyir.io).',
      exitCode: EXIT_CODES.FAILED,
    });
  }
  return new CliError({
    code: reason === 'timed out' ? 'TIMEOUT' : 'NETWORK_ERROR',
    message: `Could not reach ${apiOrigin} (${reason})`,
    fix: 'Check your connection (and TASSYIR_API_ORIGIN if you set it), then run the command again.',
    exitCode: EXIT_CODES.TRY_LATER,
  });
}
