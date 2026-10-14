import { REFRESH_GRACE_SECONDS } from './constants.js';
import {
  TassyirError,
  TassyirOAuthError,
  TassyirTokenError,
} from './errors.js';
import { sleep } from './http.js';
import type { TassyirOAuthClient, TokenSet } from './oauth.js';
import type { TokenStore } from './token-store.js';

// Hands out each installation's access token and refreshes it before it
// expires. The danger it is built around (plan §3.4): every refresh rotates
// the refresh token, and the spent one presented again more than 60 seconds
// after its rotation revokes the whole family, so the installation's tokens
// stop working until the merchant re-opens or reinstalls the app.
//
// So:
//   1. At most one refresh per installation runs in this process; every
//      concurrent caller waits for it and gets its result.
//   2. Across processes, an optional RefreshLock serialises refreshes, and
//      the token set is read again inside the lock: whoever waited finds the
//      fresh token instead of refreshing a spent one.
//   3. The rotated token set is written to the store before it is used.
//   4. A refresh whose answer was lost is retried with the SAME refresh token
//      for at most 40 seconds: inside the 60-second grace that is a harmless
//      re-rotation, after it a revocation.
//   5. A refresh token this process already rotated is never presented again,
//      even if a stale store hands it back.

/**
 * A lock shared by every process that refreshes this app's tokens (a Redis
 * lock, a Postgres advisory lock, a Durable Object). Without one, refreshes
 * are serialised per process only.
 */
export interface RefreshLock {
  /**
   * Runs `task` while holding an exclusive lock named `key`, and releases it
   * when `task` settles. The lock must stay held for up to a minute (a
   * refresh retried after a lost answer). Throw if it cannot be taken.
   */
  withLock<T>(key: string, task: () => Promise<T>): Promise<T>;
}

export interface TokenManagerOptions {
  oauth: TassyirOAuthClient;
  store: TokenStore;
  lock?: RefreshLock | undefined;
  /** Refresh an access token this long before it expires. Default 120 seconds. */
  refreshMarginSeconds?: number;
  /** The clock, in ms. Default `Date.now`. */
  now?: () => number;
}

export interface GetAccessTokenOptions {
  /**
   * An access token the API just refused (401 `APP_TOKEN_INVALID`): it is
   * not handed out again, and a refresh replaces it unless another caller
   * already did.
   */
  rejectedAccessToken?: string | undefined;
}

/** Retries of a lost refresh stop well inside the 60-second grace. */
const REFRESH_RETRY_BUDGET_MS = (REFRESH_GRACE_SECONDS - 20) * 1000;
const LOCK_KEY_PREFIX = 'tassyir:refresh:';
const ROTATED_MEMORY_MS = 60 * 60 * 1000;

function isRetryableRefreshError(error: unknown): error is TassyirError {
  if (error instanceof TassyirOAuthError) {
    return (
      error.status >= 500 ||
      error.error === 'temporarily_unavailable' ||
      error.error === 'slow_down'
    );
  }
  return (
    error instanceof TassyirError &&
    (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT')
  );
}

export class TokenManager {
  readonly #oauth: TassyirOAuthClient;
  readonly #store: TokenStore;
  readonly #lock: RefreshLock | undefined;
  readonly #marginMs: number;
  readonly #now: () => number;
  /** The refresh running per installation in this process. */
  readonly #inflight = new Map<string, Promise<TokenSet>>();
  /** The newest token set this process holds per installation. */
  readonly #latest = new Map<string, TokenSet>();
  /** Refresh tokens this process rotated, with when. */
  readonly #rotated = new Map<string, number>();

  constructor(options: TokenManagerOptions) {
    this.#oauth = options.oauth;
    this.#store = options.store;
    this.#lock = options.lock;
    this.#marginMs = (options.refreshMarginSeconds ?? 120) * 1000;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Stores an installation's offline token set: the result of
   * `exchangeIdToken` (offline) or `redeemInstallCode`. Replaces the one
   * stored before.
   */
  async save(tokens: TokenSet): Promise<void> {
    if (tokens.kind !== 'offline' || !tokens.refreshToken) {
      throw new TassyirError(
        'INVALID_REQUEST',
        'Only offline token sets (with a refresh token) are stored',
        {
          fix: 'Use an online token for the request it was exchanged for, then drop it; store the offline token set.',
        },
      );
    }
    this.#latest.set(tokens.installationId, tokens);
    await this.#write(tokens.installationId, tokens);
  }

  /** The stored offline token set of an installation, if any. */
  async get(installationId: string): Promise<TokenSet | undefined> {
    return this.#read(installationId);
  }

  /** Forgets an installation's tokens (after `app/uninstalled`, say). */
  async forget(installationId: string): Promise<void> {
    this.#latest.delete(installationId);
    try {
      await this.#store.delete(installationId);
    } catch (error) {
      throw this.#storeError(installationId, 'delete', error);
    }
  }

  /**
   * A valid access token for the installation, refreshed first when it
   * expires within the margin. Throws `TassyirTokenError` (no token stored,
   * not refreshable, store failure) or `TassyirOAuthError` (the refresh was
   * refused: the merchant must re-open or reinstall the app).
   */
  async getAccessToken(
    installationId: string,
    options: GetAccessTokenOptions = {},
  ): Promise<string> {
    const tokens = await this.#read(installationId);
    if (tokens && this.#usable(tokens, options.rejectedAccessToken)) {
      return tokens.accessToken;
    }
    return (await this.#refresh(installationId, options.rejectedAccessToken))
      .accessToken;
  }

  #usable(tokens: TokenSet, rejected: string | undefined): boolean {
    return (
      tokens.accessToken !== rejected &&
      tokens.expiresAt - this.#now() > this.#marginMs
    );
  }

  async #read(installationId: string): Promise<TokenSet | undefined> {
    let stored: TokenSet | undefined;
    try {
      stored = await this.#store.get(installationId);
    } catch (error) {
      throw this.#storeError(installationId, 'read', error);
    }
    const latest = this.#latest.get(installationId);
    if (!stored) {
      // Deleted (or never stored): what this process remembers is not
      // brought back.
      this.#latest.delete(installationId);
      return undefined;
    }
    if (latest && latest.obtainedAt > stored.obtainedAt) {
      // The store is behind this process: its last write failed. Write again
      // before anyone reads the spent refresh token from it.
      await this.#write(installationId, latest);
      return latest;
    }
    this.#latest.set(installationId, stored);
    return stored;
  }

  async #write(installationId: string, tokens: TokenSet): Promise<void> {
    try {
      await this.#store.set(installationId, tokens);
    } catch (error) {
      throw this.#storeError(installationId, 'write', error);
    }
  }

  #storeError(
    installationId: string,
    operation: string,
    cause: unknown,
  ): TassyirTokenError {
    return new TassyirTokenError(
      'TOKEN_STORE_FAILED',
      installationId,
      `The token store failed to ${operation} the tokens of installation ${installationId}`,
      {
        fix:
          operation === 'write'
            ? "Fix the TokenStore: this process keeps the rotated tokens in memory and writes them again on the next call, but another process that reads the spent refresh token from the store more than 60 seconds from now revokes the installation's tokens."
            : 'Fix the TokenStore (connection, permissions), then retry.',
        cause,
      },
    );
  }

  #refresh(
    installationId: string,
    rejected: string | undefined,
  ): Promise<TokenSet> {
    const running = this.#inflight.get(installationId);
    if (running) return running;
    const run = () => this.#refreshLocked(installationId, rejected);
    // Started on the next microtask, so the task is registered before any of
    // it runs, even when a lock throws synchronously.
    const task: Promise<TokenSet> = Promise.resolve()
      .then(() =>
        this.#lock
          ? this.#lock.withLock(`${LOCK_KEY_PREFIX}${installationId}`, run)
          : run(),
      )
      .finally(() => {
        if (this.#inflight.get(installationId) === task) {
          this.#inflight.delete(installationId);
        }
      });
    this.#inflight.set(installationId, task);
    return task;
  }

  async #refreshLocked(
    installationId: string,
    rejected: string | undefined,
  ): Promise<TokenSet> {
    // Read again: another process may have refreshed while we waited.
    const tokens = await this.#read(installationId);
    if (!tokens) {
      throw new TassyirTokenError(
        'TOKEN_NOT_FOUND',
        installationId,
        `No token is stored for installation ${installationId}`,
        {
          fix: "Store the installation's offline token first: exchange an ID token (embedded app) or redeem the install code (headless app), then call save().",
        },
      );
    }
    if (this.#usable(tokens, rejected)) return tokens;

    const refreshToken = tokens.refreshToken;
    if (tokens.kind !== 'offline' || !refreshToken) {
      throw new TassyirTokenError(
        'TOKEN_NOT_REFRESHABLE',
        installationId,
        `The token stored for installation ${installationId} has no refresh token`,
        {
          fix: 'Store offline token sets only; exchange a fresh ID token for an online token when one expires.',
        },
      );
    }
    if (
      tokens.refreshTokenExpiresAt !== undefined &&
      tokens.refreshTokenExpiresAt <= this.#now()
    ) {
      throw new TassyirTokenError(
        'REFRESH_TOKEN_EXPIRED',
        installationId,
        `The refresh token of installation ${installationId} has expired (90 days)`,
        {
          fix: 'The merchant must re-open the app (embedded) or reinstall it (headless) to issue new tokens.',
        },
      );
    }
    if (this.#rotated.has(refreshToken)) {
      throw new TassyirTokenError(
        'REFRESH_TOKEN_ALREADY_USED',
        installationId,
        `The token store handed back a refresh token of installation ${installationId} that this process already rotated; presenting it again would revoke the installation's tokens`,
        {
          fix: 'Make TokenStore.set durable and TokenStore.get read the latest write (no stale replica or cache).',
        },
      );
    }

    let next: TokenSet;
    try {
      next = await this.#refreshWithRetry(refreshToken);
    } catch (error) {
      if (
        error instanceof TassyirOAuthError &&
        error.error === 'invalid_grant'
      ) {
        await this.#dropIfStill(installationId, refreshToken);
      }
      throw error;
    }
    this.#remember(refreshToken);
    this.#latest.set(installationId, next);
    await this.#write(installationId, next);
    return next;
  }

  /**
   * A refused refresh token is dead: drop it, so the next ID-token exchange
   * or install code stores a new family instead of reusing it. Only when the
   * store still holds that token (we are inside the refresh lock), and best
   * effort: the caller gets the OAuth error either way.
   */
  async #dropIfStill(
    installationId: string,
    refreshToken: string,
  ): Promise<void> {
    try {
      const stored = await this.#store.get(installationId);
      if (stored?.refreshToken === refreshToken) {
        this.#latest.delete(installationId);
        await this.#store.delete(installationId);
      }
    } catch {
      // The OAuth error says what to do; a failed cleanup only delays it.
    }
  }

  async #refreshWithRetry(refreshToken: string): Promise<TokenSet> {
    const started = this.#now();
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.#oauth.refresh(refreshToken);
      } catch (error) {
        // The answer may have been lost after the server rotated the token:
        // retry with the same token, but only inside the grace window.
        if (!isRetryableRefreshError(error)) throw error;
        const retryAfter =
          error instanceof TassyirOAuthError
            ? error.retryAfterSeconds
            : undefined;
        const delay =
          retryAfter === undefined
            ? Math.min(1000 * 2 ** attempt, 8000)
            : retryAfter * 1000;
        if (this.#now() - started + delay > REFRESH_RETRY_BUDGET_MS)
          throw error;
        await sleep(delay);
      }
    }
  }

  #remember(refreshToken: string): void {
    const now = this.#now();
    for (const [token, at] of this.#rotated) {
      if (now - at > ROTATED_MEMORY_MS) this.#rotated.delete(token);
    }
    this.#rotated.set(refreshToken, now);
  }
}
