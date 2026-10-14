import type { TokenSet } from './oauth.js';

/**
 * Where an app keeps each installation's offline token set. You provide it:
 * a table, Redis, a KV namespace. Requirements:
 *
 * - `set` is durable when it resolves: the SDK writes the rotated refresh
 *   token before it uses the new access token, and the old refresh token
 *   revokes the installation's tokens if it is presented again later.
 * - `get` returns the latest `set` (read your writes; no stale replica).
 * - Values hold secrets: encrypt them at rest, never log them.
 *
 * A `TokenSet` is plain JSON (strings, numbers, a string array), so
 * `JSON.stringify` / `JSON.parse` store it as is.
 */
export interface TokenStore {
  get(
    installationId: string,
  ): Promise<TokenSet | undefined> | TokenSet | undefined;
  set(installationId: string, tokens: TokenSet): Promise<void> | void;
  delete(installationId: string): Promise<void> | void;
}

/**
 * Keeps tokens in this process's memory: tests, scripts and single-process
 * prototypes only. Every token is lost on restart, and other processes do
 * not see it.
 */
export class MemoryTokenStore implements TokenStore {
  readonly #tokens = new Map<string, TokenSet>();

  get(installationId: string): TokenSet | undefined {
    const tokens = this.#tokens.get(installationId);
    return tokens && structuredClone(tokens);
  }

  set(installationId: string, tokens: TokenSet): void {
    this.#tokens.set(installationId, structuredClone(tokens));
  }

  delete(installationId: string): void {
    this.#tokens.delete(installationId);
  }
}
