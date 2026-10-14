import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TokenSet } from '@tassyir/app';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileStore } from '../src/store.ts';

const KEY = Buffer.alloc(32, 1);
const TOKENS: TokenSet = {
  kind: 'offline',
  accessToken: 'tsy_at_test',
  expiresAt: 1_900_000_000_000,
  refreshToken: 'tsy_rt_test',
  refreshTokenExpiresAt: 1_900_000_000_000,
  scopes: ['read_orders'],
  installationId: 'test-installation',
  businessId: 'test-business',
  obtainedAt: 1_800_000_000_000,
};

let dir: string;
let path: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tassyir-store-test-'));
  path = join(dir, 'data', 'store.json');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('FileStore', () => {
  it('keeps tokens across restarts, encrypted at rest', async () => {
    const store = await FileStore.open(path, KEY);
    await store.tokens.set('test-installation', TOKENS);

    const text = await readFile(path, 'utf8');
    expect(text).not.toContain('tsy_at_test');
    expect(text).not.toContain('tsy_rt_test');

    const reopened = await FileStore.open(path, KEY);
    expect(await reopened.tokens.get('test-installation')).toEqual(TOKENS);
  });

  it('reads tokens sealed with another key, or under another installation, as missing', async () => {
    const store = await FileStore.open(path, KEY);
    await store.tokens.set('test-installation', TOKENS);

    const otherKey = await FileStore.open(path, Buffer.alloc(32, 2));
    expect(await otherKey.tokens.get('test-installation')).toBeUndefined();

    const doc = JSON.parse(await readFile(path, 'utf8')) as {
      tokens: Record<string, unknown>;
    };
    doc.tokens['other-installation'] = doc.tokens['test-installation'];
    await writeFile(path, JSON.stringify(doc));
    const swapped = await FileStore.open(path, KEY);
    expect(await swapped.tokens.get('other-installation')).toBeUndefined();
  });

  it('remembers handled webhook-ids for 7 days', async () => {
    const store = await FileStore.open(path, KEY);
    const day = 24 * 60 * 60 * 1000;
    await store.markHandled('dlv_old', 0);
    await store.markHandled('dlv_new', 7 * day);
    expect(store.hasHandled('dlv_old')).toBe(true);
    await store.markHandled('dlv_newer', 7 * day + 1);
    expect(store.hasHandled('dlv_old')).toBe(false);
    expect((await FileStore.open(path, KEY)).hasHandled('dlv_new')).toBe(true);
  });

  it('refuses a file that is not its own', async () => {
    await writeFile(join(dir, 'other.json'), '{"hello":"world"}');
    await expect(FileStore.open(join(dir, 'other.json'), KEY)).rejects.toThrow(
      /not this app's store file/,
    );
  });
});
