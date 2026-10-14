import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateManifest } from '@tassyir/app-manifest';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { SETTINGS_KEY } from '../src/app.ts';
import { WEBHOOK_PATH } from '../src/webhooks.ts';

const result = validateManifest(
  parse(
    readFileSync(join(import.meta.dirname, '..', 'tassyir.app.toml'), 'utf8'),
  ),
);

describe('tassyir.app.toml', () => {
  it('passes the Tassyir API validator', () => {
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it('names the routes and the app data key the server uses', () => {
    if (!result.ok) throw new Error('tassyir.app.toml is invalid');
    const { manifest } = result;
    expect(manifest.hosting.mode).toBe('external');
    expect(manifest.admin?.page).toBe('/');
    expect(manifest.webhooks.map((webhook) => webhook.uri)).toEqual([
      WEBHOOK_PATH,
    ]);
    expect(manifest.data.definitions).toContainEqual(
      expect.objectContaining({
        owner: 'business',
        key: SETTINGS_KEY,
        type: 'json',
      }),
    );
  });
});
