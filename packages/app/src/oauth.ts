import {
  GRANT_TYPE_TOKEN_EXCHANGE,
  TASSYIR_API_ORIGIN,
  TOKEN_ENDPOINT_PATH,
  TOKEN_TYPE_ID_TOKEN,
  TOKEN_TYPE_OFFLINE,
  TOKEN_TYPE_ONLINE,
} from './constants.js';
import { TassyirError, TassyirOAuthError } from './errors.js';
import type { OAuthErrorCode } from './errors.js';
import type { FetchLike } from './http.js';
import {
  isRecord,
  parseRetryAfter,
  readJson,
  resolveFetch,
  resolveOrigin,
  send,
} from './http.js';

// The token endpoint (plan §3.4, backend docs/api/apps/oauth.md):
// `POST /apps/oauth/token`, HTTP Basic client authentication, form-encoded
// parameters, OAuth errors `{ error, error_description }`.

/** An access token, and for offline tokens the refresh token that renews it. */
export interface TokenSet {
  /** `offline` acts as the app; `online` acts for one dashboard user and cannot be refreshed. */
  kind: 'offline' | 'online';
  /** `tsy_at_…`: send as `Authorization: Bearer`. A secret: never log it. */
  accessToken: string;
  /** When the access token expires, ms since the epoch (this machine's clock). */
  expiresAt: number;
  /** `tsy_rt_…`, offline tokens only. Rotated on every refresh. A secret: never log it. */
  refreshToken?: string | undefined;
  /** When the refresh token expires (90 days), ms since the epoch. */
  refreshTokenExpiresAt?: number | undefined;
  /** The installation's granted scopes. */
  scopes: string[];
  installationId: string;
  businessId: string;
  /** Online tokens only: the user the token acts for. */
  userId?: string | undefined;
  /** When this machine received the token set, ms since the epoch. */
  obtainedAt: number;
}

export interface OAuthClientOptions {
  /** Your app's client id, `app_…` (for example `process.env.TASSYIR_CLIENT_ID`). */
  clientId: string;
  /** A live client secret, `tsy_cs_…` (for example `process.env.TASSYIR_CLIENT_SECRET`). Never commit it. */
  clientSecret: string;
  /** Default `https://api.tassyir.io`. */
  apiOrigin?: string;
  fetch?: FetchLike;
  /** Default 15 seconds. */
  timeoutMs?: number;
  /** The clock, in ms. Default `Date.now`. */
  now?: () => number;
}

type Grant = 'token-exchange' | 'authorization_code' | 'refresh_token';

const OAUTH_ERRORS = new Set<string>([
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'unsupported_grant_type',
  'slow_down',
  'temporarily_unavailable',
]);

const CLIENT_ID = /^app_[A-Za-z0-9]{1,64}$/;
const CLIENT_SECRET = /^tsy_cs_[A-Za-z0-9]{1,128}$/;

function oauthFix(error: OAuthErrorCode, grant: Grant): string {
  switch (error) {
    case 'invalid_client':
      return 'Check TASSYIR_CLIENT_ID and TASSYIR_CLIENT_SECRET; a secret revoked, or rotated more than 24 hours ago, no longer works: create a new one in the developer console.';
    case 'invalid_grant':
      if (grant === 'token-exchange') {
        return 'Ask App Bridge for a fresh ID token and exchange it once: ID tokens live 60 seconds, are single use, and must be issued to this client id.';
      }
      if (grant === 'authorization_code') {
        return 'Install codes live 5 minutes and work once: if the first redemption failed, ask the merchant to reinstall the app.';
      }
      return "This installation's refresh token no longer works (uninstalled, revoked, expired, or presented again after rotation): the merchant must re-open the app (embedded) or reinstall it (headless).";
    case 'unauthorized_client':
      return 'The app is suspended or archived on Tassyir: contact Tassyir support.';
    case 'slow_down':
      return 'Wait retryAfterSeconds before calling the token endpoint again, and reuse access tokens for their hour instead of fetching one per request.';
    case 'temporarily_unavailable':
      return 'Retry after retryAfterSeconds.';
    case 'server_error':
      return 'Retry with backoff; quote requestId to Tassyir support if it persists.';
    case 'invalid_request':
    case 'unsupported_grant_type':
      return 'Check the value passed is the token or code Tassyir issued, unchanged; if it is, report it at https://github.com/tassyir/apps-sdk/issues.';
  }
}

function formEncode(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, '+');
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * Calls the token endpoint for one app. Every method returns a `TokenSet`
 * or throws a `TassyirOAuthError` (or a `TassyirError` for a transport
 * failure). Tokens never appear in an error.
 */
export class TassyirOAuthClient {
  readonly clientId: string;
  readonly #authorization: string;
  readonly #url: string;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;
  readonly #now: () => number;

  constructor(options: OAuthClientOptions) {
    if (
      typeof options.clientId !== 'string' ||
      !CLIENT_ID.test(options.clientId)
    ) {
      throw new TassyirError(
        'INVALID_OPTIONS',
        "clientId must be your app's client id (app_…)",
        {
          fix: 'Pass the client id from the developer console, for example process.env.TASSYIR_CLIENT_ID.',
        },
      );
    }
    if (
      typeof options.clientSecret !== 'string' ||
      !CLIENT_SECRET.test(options.clientSecret)
    ) {
      throw new TassyirError(
        'INVALID_OPTIONS',
        'clientSecret must be a client secret (tsy_cs_…)',
        {
          fix: 'Pass a secret from the developer console, for example process.env.TASSYIR_CLIENT_SECRET; never commit it.',
        },
      );
    }
    this.clientId = options.clientId;
    this.#authorization = `Basic ${btoa(`${formEncode(options.clientId)}:${formEncode(options.clientSecret)}`)}`;
    this.#url = `${resolveOrigin(options.apiOrigin, TASSYIR_API_ORIGIN)}${TOKEN_ENDPOINT_PATH}`;
    this.#fetch = resolveFetch(options.fetch);
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Exchanges the ID token App Bridge handed your embedded page. `offline`
   * (default) acts as the app and comes with a refresh token: keep it, and do
   * not exchange again on every page view (at most 25 live refresh tokens per
   * installation). `online` acts for the dashboard user, lasts an hour and is
   * not refreshable. An ID token can be exchanged once.
   */
  async exchangeIdToken(
    idToken: string,
    options: { tokenType?: 'offline' | 'online' } = {},
  ): Promise<TokenSet> {
    const online = options.tokenType === 'online';
    return this.#request('token-exchange', {
      grant_type: GRANT_TYPE_TOKEN_EXCHANGE,
      subject_token: idToken,
      subject_token_type: TOKEN_TYPE_ID_TOKEN,
      requested_token_type: online ? TOKEN_TYPE_ONLINE : TOKEN_TYPE_OFFLINE,
    });
  }

  /**
   * Redeems the install code (`tsy_ic_…`) your `auth.callback_url` received
   * as `?code=` after an install. Five minutes, one use. Returns an offline
   * token set.
   */
  async redeemInstallCode(code: string): Promise<TokenSet> {
    return this.#request('authorization_code', {
      grant_type: 'authorization_code',
      code,
    });
  }

  /**
   * Rotates a refresh token: the answer carries a new refresh token and the
   * one presented is spent. Presenting a spent token more than 60 seconds
   * after its rotation revokes every token of its family. Prefer
   * `TokenManager`, which persists the new token before anything else and
   * never presents a token twice.
   */
  async refresh(refreshToken: string): Promise<TokenSet> {
    return this.#request('refresh_token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
  }

  async #request(
    grant: Grant,
    parameters: Record<string, string>,
  ): Promise<TokenSet> {
    for (const [name, value] of Object.entries(parameters)) {
      if (typeof value !== 'string' || value === '' || value.length > 4096) {
        throw new TassyirError(
          'INVALID_REQUEST',
          `${name} must be a non-empty string of at most 4096 characters`,
          {
            fix: 'Pass the token or code exactly as Tassyir issued it.',
          },
        );
      }
    }
    const response = await send(
      this.#fetch,
      this.#url,
      {
        method: 'POST',
        headers: {
          authorization: this.#authorization,
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: new URLSearchParams(parameters).toString(),
      },
      { timeoutMs: this.#timeoutMs },
    );
    const body = await readJson(response);
    if (response.ok) return this.#tokenSet(body, grant, parameters);
    throw this.#error(response, body, grant);
  }

  #tokenSet(
    body: unknown,
    grant: Grant,
    parameters: Record<string, string>,
  ): TokenSet {
    const now = this.#now();
    if (
      !isRecord(body) ||
      typeof body['access_token'] !== 'string' ||
      body['token_type'] !== 'Bearer' ||
      !positiveInteger(body['expires_in']) ||
      typeof body['scope'] !== 'string' ||
      typeof body['installation_id'] !== 'string' ||
      typeof body['business_id'] !== 'string' ||
      (body['refresh_token'] !== undefined &&
        typeof body['refresh_token'] !== 'string') ||
      (body['refresh_token_expires_in'] !== undefined &&
        !positiveInteger(body['refresh_token_expires_in'])) ||
      (body['user_id'] !== undefined && typeof body['user_id'] !== 'string')
    ) {
      throw new TassyirError(
        'INVALID_TOKEN_RESPONSE',
        'The token endpoint answered 200 with an unexpected body',
        {
          fix: 'Check apiOrigin points at the Tassyir API; report it at https://github.com/tassyir/apps-sdk/issues if it does.',
        },
      );
    }
    const online =
      body['issued_token_type'] === TOKEN_TYPE_ONLINE ||
      (grant === 'token-exchange' &&
        parameters['requested_token_type'] === TOKEN_TYPE_ONLINE);
    const refreshExpiresIn = body['refresh_token_expires_in'];
    return {
      kind: online ? 'online' : 'offline',
      accessToken: body['access_token'],
      expiresAt: now + body['expires_in'] * 1000,
      refreshToken: body['refresh_token'],
      refreshTokenExpiresAt:
        typeof refreshExpiresIn === 'number'
          ? now + refreshExpiresIn * 1000
          : undefined,
      scopes: body['scope'].split(' ').filter((scope) => scope !== ''),
      installationId: body['installation_id'],
      businessId: body['business_id'],
      userId: body['user_id'],
      obtainedAt: now,
    };
  }

  #error(response: Response, body: unknown, grant: Grant): TassyirOAuthError {
    const known =
      isRecord(body) &&
      typeof body['error'] === 'string' &&
      OAUTH_ERRORS.has(body['error']);
    const error: OAuthErrorCode = known
      ? (body['error'] as OAuthErrorCode)
      : 'server_error';
    const description =
      known && typeof body['error_description'] === 'string'
        ? body['error_description']
        : `Unexpected ${String(response.status)} answer`;
    const requestId =
      (isRecord(body) && typeof body['requestId'] === 'string'
        ? body['requestId']
        : undefined) ??
      response.headers.get('x-request-id') ??
      undefined;
    return new TassyirOAuthError({
      status: response.status,
      error,
      errorDescription: description,
      retryAfterSeconds: parseRetryAfter(
        response.headers.get('retry-after'),
        this.#now(),
      ),
      requestId,
      fix: oauthFix(error, grant),
    });
  }
}
