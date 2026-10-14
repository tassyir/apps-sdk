// Test-only helpers: the backend-signed vectors and a recording fetch.
// Never imported by the library (src/index.ts), so never built or shipped.

import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import type { FetchLike } from './http.js';

export interface IdTokenVector {
  token: string;
  nowMs: number;
  expect: string;
}

export interface WebhookVector {
  headers: Record<string, string>;
  body: string;
  nowMs: number;
  expect: string;
}

export interface BackendVectors {
  backend: { repository: string; commit: string; files: string[] };
  nowMs: number;
  clientId: string;
  appId: string;
  installationId: string;
  jwks: {
    keys: {
      kty: string;
      crv: string;
      x: string;
      kid: string;
      alg: string;
      use: string;
    }[];
  };
  webhookKeys: { keys: { kid: string; scheme: string; publicKey: string }[] };
  idTokens: Record<string, IdTokenVector>;
  webhooks: Record<string, WebhookVector>;
}

export const vectors = JSON.parse(
  readFileSync(
    new URL('../fixtures/backend-vectors.json', import.meta.url),
    'utf8',
  ),
) as BackendVectors;

export interface RecordedCall {
  url: string;
  init: RequestInit;
}

/** A fetch that records each call and answers with `handler`. */
export function recordingFetch(
  handler: (
    url: string,
    init: RequestInit,
    index: number,
  ) => Response | Promise<Response>,
): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init, calls.length - 1);
  };
  return { fetch, calls };
}

export function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function headerOf(
  call: RecordedCall | undefined,
  name: string,
): string | undefined {
  const headers = new Headers(call?.init.headers);
  return headers.get(name) ?? undefined;
}

/** `expect.stringContaining`, typed for use inside object matchers. */
export function containing(text: string): string {
  return expect.stringContaining(text) as string;
}

/** The body a recorded call sent, as text. */
export function bodyOf(call: RecordedCall | undefined): string {
  const body = call?.init.body;
  return typeof body === 'string' ? body : '';
}
