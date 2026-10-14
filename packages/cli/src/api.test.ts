import { describe, expect, it } from 'vitest';
import { apiError, DeveloperApi } from './api.js';
import type { FetchLike } from './api.js';
import { EXIT_CODES } from './errors.js';

function response(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function client(fetch: FetchLike) {
  return new DeveloperApi({
    apiOrigin: 'https://api.tassyir.test',
    fetch,
    userAgent: 'tassyir-cli/test',
    // Made at run time: no token-shaped literal in the repo.
    token: `tsy_dt_${'0'.repeat(43)}`,
  });
}

describe('apiError: a developer-API refusal as { code, message, fix }', () => {
  it("keeps the API's code, fix, subject and request id", () => {
    const error = apiError(
      response(429, {
        statusCode: 429,
        code: 'DEVELOPER_RATE_LIMITED',
        message: 'Too many secrets minted this hour',
        fix: 'Wait for the hour to pass.',
        limit: 10,
        windowSeconds: 3600,
        retryAfterSeconds: 1200,
        requestId: 'req-1',
      }),
      {
        statusCode: 429,
        code: 'DEVELOPER_RATE_LIMITED',
        message: 'Too many secrets minted this hour',
        fix: 'Wait for the hour to pass.',
        limit: 10,
        windowSeconds: 3600,
        retryAfterSeconds: 1200,
        requestId: 'req-1',
      },
    );
    expect(error.toJSON()).toEqual({
      code: 'DEVELOPER_RATE_LIMITED',
      message: 'Too many secrets minted this hour',
      fix: 'Wait for the hour to pass.',
      status: 429,
      requestId: 'req-1',
      retryAfterSeconds: 1200,
      details: { limit: 10, windowSeconds: 3600, retryAfterSeconds: 1200 },
    });
    expect(error.exitCode).toBe(EXIT_CODES.TRY_LATER);
  });

  it('gives a refusal without a code (validation, throttler) a generic one and a fix', () => {
    const validation = apiError(response(400, {}), {
      statusCode: 400,
      message: [
        'name must be shorter than or equal to 60 characters',
        'seed must be a boolean value',
      ],
      error: 'Bad Request',
    });
    expect(validation.code).toBe('BAD_REQUEST');
    expect(validation.message).toBe(
      'name must be shorter than or equal to 60 characters; seed must be a boolean value',
    );
    expect(validation.fix).toContain('--help');
    expect(validation.exitCode).toBe(EXIT_CODES.FAILED);

    const throttled = apiError(response(429, {}, { 'retry-after': '30' }), {
      statusCode: 429,
      message: 'ThrottlerException: Too Many Requests',
    });
    expect(throttled).toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: 30,
      exitCode: EXIT_CODES.TRY_LATER,
    });

    const down = apiError(response(503, {}), {
      statusCode: 503,
      message: 'Service temporarily unavailable, please retry.',
    });
    expect(down).toMatchObject({
      code: 'SERVER_ERROR',
      exitCode: EXIT_CODES.TRY_LATER,
    });
  });

  it('401 is exit 3 with how to sign in again; a manifest refusal is exit 4 with its errors', () => {
    const invalid = apiError(response(401, {}), {
      statusCode: 401,
      code: 'DEVELOPER_TOKEN_INVALID',
      message: 'The developer token is not valid',
    });
    expect(invalid).toMatchObject({
      exitCode: EXIT_CODES.AUTH,
      fix: expect.stringContaining('tassyir login') as string,
    });
    const manifest = apiError(response(400, {}), {
      statusCode: 400,
      code: 'APP_MANIFEST_INVALID',
      message: 'The manifest is not valid',
      errors: [
        {
          code: 'MANIFEST_HANDLE_INVALID',
          path: 'handle',
          message: 'm',
          fix: 'f',
        },
      ],
    });
    expect(manifest).toMatchObject({
      exitCode: EXIT_CODES.MANIFEST,
      errors: [
        {
          code: 'MANIFEST_HANDLE_INVALID',
          path: 'handle',
          message: 'm',
          fix: 'f',
        },
      ],
    });
  });

  it('reads an RFC 9457 problem the same way', () => {
    const problem = apiError(response(409, {}), {
      type: 'https://developers.tassyir.io/errors/app-read-only',
      title: 'Conflict',
      status: 409,
      detail: 'The app is suspended',
      code: 'APP_READ_ONLY',
      fix: 'Ask Tassyir why the app was suspended.',
    });
    expect(problem).toMatchObject({
      code: 'APP_READ_ONLY',
      message: 'The app is suspended',
      fix: 'Ask Tassyir why the app was suspended.',
    });
  });
});

describe('DeveloperApi transport', () => {
  it('sends JSON with the bearer token, never follows a redirect, names network failures', async () => {
    const seen: RequestInit[] = [];
    const api = client((_input, init) => {
      seen.push(init);
      return Promise.resolve(response(200, { data: [] }));
    });
    await api.listApps();
    expect(seen[0]).toMatchObject({ method: 'GET', redirect: 'error' });
    expect(new Headers(seen[0]?.headers).get('authorization')).toMatch(
      /^Bearer tsy_dt_/,
    );

    const offline = client(() =>
      Promise.reject(
        new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }),
      ),
    );
    await expect(offline.listApps()).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: 'Could not reach https://api.tassyir.test (ECONNREFUSED)',
      exitCode: EXIT_CODES.TRY_LATER,
    });
    const slow = client(() =>
      Promise.reject(
        new DOMException('The operation timed out.', 'TimeoutError'),
      ),
    );
    await expect(slow.listApps()).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it("an answer that is not the API's is INVALID_RESPONSE, and never echoes a token", async () => {
    const api = client(() =>
      Promise.resolve(response(200, '<html>login</html>')),
    );
    await expect(api.listApps()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    const odd = client(() =>
      Promise.resolve(
        response(200, { access_token: 'not-a-developer-token', token_id: '1' }),
      ),
    );
    const poll = odd.pollSignIn('tsy_dc_x');
    await expect(poll).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(poll).rejects.not.toMatchObject({
      message: expect.stringContaining('not-a-developer-token') as string,
    });
  });
});
