import { afterEach, describe, expect, it, vi } from 'vitest';
import { TassyirOAuthError } from './errors.js';
import { TassyirOAuthClient } from './oauth.js';
import type { TokenSet } from './oauth.js';
import { TokenManager } from './token-manager.js';
import type { RefreshLock } from './token-manager.js';
import { MemoryTokenStore } from './token-store.js';
import type { TokenStore } from './token-store.js';
import {
  jsonResponse,
  recordingFetch,
  containing,
} from './vectors.test-helpers.js';

const IID = '9330000000000000001';
const START = 1_800_000_000_000;

function tokenSet(
  n: number,
  at: number,
  overrides: Partial<TokenSet> = {},
): TokenSet {
  return {
    kind: 'offline',
    accessToken: `tsy_at_${String(n)}`,
    expiresAt: at + 3_600_000,
    refreshToken: `tsy_rt_${String(n)}`,
    refreshTokenExpiresAt: at + 7_776_000_000,
    scopes: ['read_orders'],
    installationId: IID,
    businessId: '741939488313319175',
    obtainedAt: at,
    ...overrides,
  };
}

/** A token endpoint that rotates rt_n into rt_n+1, and the refresh tokens it saw. */
function setup(
  options: {
    store?: TokenStore;
    lock?: RefreshLock;
    respond?: (presented: string, index: number) => Response | undefined;
  } = {},
) {
  const clock = { now: START };
  const presented: string[] = [];
  const { fetch } = recordingFetch((_url, init, index) => {
    const body = typeof init.body === 'string' ? init.body : '';
    const token = new URLSearchParams(body).get('refresh_token') ?? '';
    presented.push(token);
    const custom = options.respond?.(token, index);
    if (custom) return custom;
    const n = Number(token.replace('tsy_rt_', '')) + 1;
    return jsonResponse(200, {
      access_token: `tsy_at_${String(n)}`,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: `tsy_rt_${String(n)}`,
      refresh_token_expires_in: 7_776_000,
      scope: 'read_orders',
      installation_id: IID,
      business_id: '741939488313319175',
    });
  });
  const oauth = new TassyirOAuthClient({
    clientId: 'app_7Hq2Kx9Vb4Nm1Lp8Zr3Ty6Wd5Q',
    clientSecret: 'tsy_cs_testsecretnotreal000000000000000000000000',
    fetch,
    now: () => clock.now,
  });
  const store = options.store ?? new MemoryTokenStore();
  const manager = new TokenManager({
    oauth,
    store,
    lock: options.lock,
    now: () => clock.now,
  });
  return { clock, presented, store, manager };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('TokenManager', () => {
  it('hands out the stored access token while it is fresh', async () => {
    const { manager, presented } = setup();
    await manager.save(tokenSet(1, START));
    expect(await manager.getAccessToken(IID)).toBe('tsy_at_1');
    expect(presented).toEqual([]);
  });

  it('refreshes inside the margin and stores the rotated set before handing it out', async () => {
    const writes: TokenSet[] = [];
    const memory = new MemoryTokenStore();
    const store: TokenStore = {
      get: (id) => memory.get(id),
      set: (id, tokens) => {
        writes.push(tokens);
        memory.set(id, tokens);
      },
      delete: (id) => {
        memory.delete(id);
      },
    };
    const { manager, clock, presented } = setup({ store });
    await manager.save(tokenSet(1, START));
    clock.now = START + 3_600_000 - 119_000;
    expect(await manager.getAccessToken(IID)).toBe('tsy_at_2');
    expect(presented).toEqual(['tsy_rt_1']);
    expect(writes.map((tokens) => tokens.refreshToken)).toEqual([
      'tsy_rt_1',
      'tsy_rt_2',
    ]);
  });

  it('runs one refresh for many concurrent callers', async () => {
    const { manager, clock, presented } = setup();
    await manager.save(tokenSet(1, START));
    clock.now = START + 3_600_000;
    const tokens = await Promise.all(
      Array.from({ length: 20 }, () => manager.getAccessToken(IID)),
    );
    expect(new Set(tokens)).toEqual(new Set(['tsy_at_2']));
    expect(presented).toEqual(['tsy_rt_1']);
  });

  it('refreshes under the cross-process lock and re-reads inside it', async () => {
    const keys: string[] = [];
    const memory = new MemoryTokenStore();
    // Another process refreshed while we waited for the lock.
    const lock: RefreshLock = {
      async withLock(key, task) {
        keys.push(key);
        memory.set(IID, tokenSet(7, START + 3_600_000));
        return task();
      },
    };
    const { manager, clock, presented } = setup({ store: memory, lock });
    await manager.save(tokenSet(1, START));
    clock.now = START + 3_600_000;
    expect(await manager.getAccessToken(IID)).toBe('tsy_at_7');
    expect(keys).toEqual([`tassyir:refresh:${IID}`]);
    expect(presented).toEqual([]);
  });

  it('recovers when the lock throws synchronously once', async () => {
    let fail = true;
    const lock: RefreshLock = {
      withLock(_key, task) {
        if (fail) {
          fail = false;
          throw new Error('lock service down');
        }
        return task();
      },
    };
    const { manager, clock } = setup({ lock });
    await manager.save(tokenSet(1, START));
    clock.now = START + 3_600_000;
    await expect(manager.getAccessToken(IID)).rejects.toThrow(
      'lock service down',
    );
    expect(await manager.getAccessToken(IID)).toBe('tsy_at_2');
  });

  it('retries a lost refresh with the same token, inside the grace window only', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { manager, clock, presented } = setup({
      respond: (_token, index) => {
        clock.now += 15_000;
        if (index < 10) throw new TypeError('socket hang up');
        return undefined;
      },
    });
    await manager.save(tokenSet(1, START));
    clock.now = START + 3_600_000;
    const result = manager.getAccessToken(IID).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ code: 'NETWORK_ERROR' });
    // Each failure takes 15 s: presented at 0, 15 and 30 s; a fourth try
    // would start after 45 s, past the 40 s budget (the grace is 60 s).
    expect(presented).toEqual(['tsy_rt_1', 'tsy_rt_1', 'tsy_rt_1']);
  });

  it('succeeds when a retry gets through', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { manager, clock, presented } = setup({
      respond: (_token, index) =>
        index === 0
          ? jsonResponse(
              503,
              { error: 'temporarily_unavailable', error_description: 'x' },
              { 'retry-after': '2' },
            )
          : undefined,
    });
    await manager.save(tokenSet(1, START));
    clock.now = START + 3_600_000;
    const result = manager.getAccessToken(IID);
    await vi.runAllTimersAsync();
    expect(await result).toBe('tsy_at_2');
    expect(presented).toEqual(['tsy_rt_1', 'tsy_rt_1']);
  });

  it('drops a refused refresh token and surfaces the OAuth error', async () => {
    const { manager, clock, store } = setup({
      respond: () =>
        jsonResponse(400, {
          error: 'invalid_grant',
          error_description: 'revoked',
        }),
    });
    await manager.save(tokenSet(1, START));
    clock.now = START + 3_600_000;
    const error = await manager
      .getAccessToken(IID)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TassyirOAuthError);
    expect(error).toMatchObject({
      code: 'OAUTH_INVALID_GRANT',
      fix: containing('reinstall'),
    });
    expect(await store.get(IID)).toBeUndefined();
  });

  it('keeps the rotated set in memory when the store write fails, and writes it again', async () => {
    const memory = new MemoryTokenStore();
    let failWrites = false;
    const store: TokenStore = {
      get: (id) => memory.get(id),
      set: (id, tokens) => {
        if (failWrites) throw new Error('db down');
        memory.set(id, tokens);
      },
      delete: (id) => {
        memory.delete(id);
      },
    };
    const { manager, clock, presented } = setup({ store });
    await manager.save(tokenSet(1, START));
    clock.now = START + 3_600_000;
    failWrites = true;
    await expect(manager.getAccessToken(IID)).rejects.toMatchObject({
      code: 'TOKEN_STORE_FAILED',
      installationId: IID,
    });
    failWrites = false;
    // No second refresh: the spent rt_1 in the store is never presented again.
    expect(await manager.getAccessToken(IID)).toBe('tsy_at_2');
    expect(presented).toEqual(['tsy_rt_1']);
    expect(memory.get(IID)?.refreshToken).toBe('tsy_rt_2');
  });

  it('never presents a refresh token it already rotated, even if a stale store hands it back', async () => {
    const stale = tokenSet(1, START, { obtainedAt: START + 10 * 3_600_000 });
    const store: TokenStore = {
      get: () => structuredClone(stale),
      set: () => undefined,
      delete: () => undefined,
    };
    const { manager, clock, presented } = setup({ store });
    clock.now = START + 3_600_000;
    expect(await manager.getAccessToken(IID)).toBe('tsy_at_2');
    clock.now = START + 2 * 3_600_000;
    await expect(manager.getAccessToken(IID)).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_ALREADY_USED',
    });
    expect(presented).toEqual(['tsy_rt_1']);
  });

  it('replaces a token the API refused, unless another caller already did', async () => {
    const { manager, presented } = setup();
    await manager.save(tokenSet(1, START));
    expect(
      await manager.getAccessToken(IID, { rejectedAccessToken: 'tsy_at_1' }),
    ).toBe('tsy_at_2');
    expect(
      await manager.getAccessToken(IID, { rejectedAccessToken: 'tsy_at_1' }),
    ).toBe('tsy_at_2');
    expect(presented).toEqual(['tsy_rt_1']);
  });

  it('explains what is missing', async () => {
    const { manager, clock, store } = setup();
    await expect(manager.getAccessToken(IID)).rejects.toMatchObject({
      code: 'TOKEN_NOT_FOUND',
      fix: containing('save()'),
    });
    await store.set(
      IID,
      tokenSet(1, START, { kind: 'online', refreshToken: undefined }),
    );
    clock.now = START + 3_600_000;
    await expect(manager.getAccessToken(IID)).rejects.toMatchObject({
      code: 'TOKEN_NOT_REFRESHABLE',
    });
    await store.set(
      IID,
      tokenSet(1, START, { refreshTokenExpiresAt: START + 1000 }),
    );
    await expect(manager.getAccessToken(IID)).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_EXPIRED',
    });
  });

  it('stores offline token sets only, and forgets on request', async () => {
    const { manager, store } = setup();
    await expect(
      manager.save(
        tokenSet(1, START, { kind: 'online', refreshToken: undefined }),
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    await manager.save(tokenSet(1, START));
    await manager.forget(IID);
    expect(await store.get(IID)).toBeUndefined();
  });
});
