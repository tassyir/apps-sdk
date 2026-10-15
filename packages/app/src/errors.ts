// Every error the SDK throws is a TassyirError: a stable `code` to act on, a
// `message` for a person, and a `fix` an agent can follow. No message ever
// carries a token, a secret or a request body.

export interface TassyirErrorOptions {
  /** One sentence saying how to fix it. */
  fix?: string | undefined;
  cause?: unknown;
}

export class TassyirError extends Error {
  /** Stable and machine-readable: act on it, never on `message`. */
  readonly code: string;
  /** One sentence saying how to fix it, when there is one. */
  readonly fix: string | undefined;

  constructor(
    code: string,
    message: string,
    options: TassyirErrorOptions = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'TassyirError';
    this.code = code;
    this.fix = options.fix;
  }
}

/** Why an ID token or a webhook delivery was refused. */
export type VerificationErrorCode =
  | 'ID_TOKEN_MALFORMED'
  | 'ID_TOKEN_UNSUPPORTED_HEADER'
  | 'ID_TOKEN_UNKNOWN_KEY'
  | 'ID_TOKEN_BAD_SIGNATURE'
  | 'ID_TOKEN_INVALID_CLAIMS'
  | 'ID_TOKEN_WRONG_ISSUER'
  | 'ID_TOKEN_WRONG_AUDIENCE'
  | 'ID_TOKEN_EXPIRED'
  | 'ID_TOKEN_NOT_YET_VALID'
  | 'WEBHOOK_BODY_NOT_RAW'
  | 'WEBHOOK_HEADER_MISSING'
  | 'WEBHOOK_HEADER_INVALID'
  | 'WEBHOOK_TIMESTAMP_OUT_OF_RANGE'
  | 'WEBHOOK_SIGNATURE_MISSING'
  | 'WEBHOOK_SIGNATURE_INVALID'
  | 'WEBHOOK_BODY_INVALID'
  | 'WEBHOOK_WRONG_APP'
  | 'WEBHOOK_UNKNOWN_INSTALLATION'
  | 'WEBHOOK_HEADER_MISMATCH'
  | 'WEBHOOK_TEST_DELIVERY'
  | 'WEBHOOK_NOT_A_DELIVERY';

/**
 * An ID token or a webhook delivery failed verification. Answer the request
 * with 401 (ID token) or 400 (webhook); never process it.
 */
export class TassyirVerificationError extends TassyirError {
  declare readonly code: VerificationErrorCode;

  constructor(
    code: VerificationErrorCode,
    message: string,
    options: TassyirErrorOptions = {},
  ) {
    super(code, message, options);
    this.name = 'TassyirVerificationError';
  }
}

/** The OAuth `error` values the token endpoint answers (RFC 6749 §5.2). */
export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'slow_down'
  | 'temporarily_unavailable'
  | 'server_error';

export interface TassyirOAuthErrorInit {
  status: number;
  error: OAuthErrorCode;
  errorDescription: string;
  retryAfterSeconds: number | undefined;
  requestId: string | undefined;
  fix: string;
}

/**
 * The token endpoint refused the request. `code` is the OAuth `error` in
 * upper case with an `OAUTH_` prefix (`OAUTH_INVALID_GRANT`); `error` is the
 * value the endpoint sent.
 */
export class TassyirOAuthError extends TassyirError {
  readonly status: number;
  readonly error: OAuthErrorCode;
  readonly errorDescription: string;
  /** Seconds to wait before calling again (429 and 503). */
  readonly retryAfterSeconds: number | undefined;
  readonly requestId: string | undefined;

  constructor(init: TassyirOAuthErrorInit) {
    super(
      `OAUTH_${init.error.toUpperCase()}`,
      `The Tassyir token endpoint refused the request (${String(init.status)} ${init.error}): ${init.errorDescription}`,
      { fix: init.fix },
    );
    this.name = 'TassyirOAuthError';
    this.status = init.status;
    this.error = init.error;
    this.errorDescription = init.errorDescription;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.requestId = init.requestId;
  }
}

/** What the Admin API's `RateLimit-*` headers said on one answer. */
export interface RateLimitInfo {
  /** The bucket size (`RateLimit-Limit`). */
  limit: number | undefined;
  /** Requests accepted right now (`RateLimit-Remaining`). */
  remaining: number | undefined;
  /** Seconds until the bucket is full again (`RateLimit-Reset`). */
  resetSeconds: number | undefined;
}

/** An Admin API problem (RFC 9457), as the API sent it. */
export interface Problem {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  code?: string;
  fix?: string;
  docs?: string;
  requestId?: string;
  errors?: string[];
  [member: string]: unknown;
}

export interface TassyirApiErrorInit {
  status: number;
  code: string;
  problem: Problem;
  requestId: string | undefined;
  retryAfterSeconds: number | undefined;
  rateLimit: RateLimitInfo;
  method: string;
  path: string;
}

/**
 * The Admin API answered an error (`application/problem+json`). Act on
 * `code`; `fix` says what to do; quote `requestId` to Tassyir support.
 */
export class TassyirApiError<
  Code extends string = string,
> extends TassyirError {
  declare readonly code: Code;
  readonly status: number;
  /** The whole problem document, with its subject members (`permission`, `storeId`, `errors`, …). */
  readonly problem: Problem;
  readonly title: string | undefined;
  readonly detail: string | undefined;
  readonly type: string | undefined;
  readonly docs: string | undefined;
  readonly requestId: string | undefined;
  /** Seconds to wait before calling again (`Retry-After`, on 429 and 503). */
  readonly retryAfterSeconds: number | undefined;
  readonly rateLimit: RateLimitInfo;
  /** The request, as `GET /orders/{id}` (the path pattern, never ids or the query). */
  readonly operation: string;

  constructor(init: TassyirApiErrorInit) {
    const detail =
      typeof init.problem.detail === 'string' ? init.problem.detail : undefined;
    super(
      init.code,
      `Tassyir Admin API ${init.method} ${init.path} answered ${String(init.status)} ${init.code}${detail ? `: ${detail}` : ''}${init.requestId ? ` (request ${init.requestId})` : ''}`,
      {
        fix:
          typeof init.problem.fix === 'string'
            ? init.problem.fix
            : defaultApiFix(init.status),
      },
    );
    this.name = 'TassyirApiError';
    this.status = init.status;
    this.problem = init.problem;
    this.title =
      typeof init.problem.title === 'string' ? init.problem.title : undefined;
    this.detail = detail;
    this.type =
      typeof init.problem.type === 'string' ? init.problem.type : undefined;
    this.docs =
      typeof init.problem.docs === 'string' ? init.problem.docs : undefined;
    this.requestId = init.requestId;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.rateLimit = init.rateLimit;
    this.operation = `${init.method} ${init.path}`;
  }
}

function defaultApiFix(status: number): string | undefined {
  if (status === 429) {
    return 'Wait Retry-After seconds, or create the client with { retries: 3 } so the SDK waits for you.';
  }
  if (status >= 500) {
    return 'Retry with backoff (create the client with { retries: 3 }); quote requestId to Tassyir support if it persists.';
  }
  return undefined;
}

/** Why the SDK could not hand out an access token. */
export type TokenErrorCode =
  | 'TOKEN_NOT_FOUND'
  | 'TOKEN_NOT_REFRESHABLE'
  | 'REFRESH_TOKEN_EXPIRED'
  | 'REFRESH_TOKEN_ALREADY_USED'
  | 'TOKEN_STORE_FAILED';

export class TassyirTokenError extends TassyirError {
  declare readonly code: TokenErrorCode;
  readonly installationId: string;

  constructor(
    code: TokenErrorCode,
    installationId: string,
    message: string,
    options: TassyirErrorOptions = {},
  ) {
    super(code, message, options);
    this.name = 'TassyirTokenError';
    this.installationId = installationId;
  }
}

/** True when `error` is a TassyirError, with `code` when one is given. */
export function isTassyirError(
  error: unknown,
  code?: string,
): error is TassyirError {
  return (
    error instanceof TassyirError && (code === undefined || error.code === code)
  );
}
