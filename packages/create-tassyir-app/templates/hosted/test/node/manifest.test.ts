import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateManifest } from '@tassyir/app-manifest';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const result = validateManifest(
  parse(readFileSync(join(root, 'tassyir.app.toml'), 'utf8')),
);

describe('tassyir.app.toml', () => {
  it('passes the Tassyir API validator', () => {
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it('is a hosted app whose page and webhook path the Worker serves', () => {
    if (!result.ok) throw new Error('tassyir.app.toml is invalid');
    const { manifest } = result;
    expect(manifest.hosting.mode).toBe('tassyir');
    expect(manifest.admin?.page).toBe('/');
    // src/webhooks.ts's WEBHOOK_PATH (read as text: the Worker's code is
    // typed for workerd, not Node).
    const webhooks = readFileSync(join(root, 'src', 'webhooks.ts'), 'utf8');
    const path = /WEBHOOK_PATH = '([^']+)'/.exec(webhooks)?.[1];
    expect(manifest.webhooks.map((webhook) => webhook.uri)).toEqual([path]);
    // Nothing under /.tassyir/: Tassyir Hosting keeps that prefix.
    for (const uri of [
      manifest.admin?.page ?? '',
      ...manifest.webhooks.map((webhook) => webhook.uri),
    ]) {
      expect(uri.startsWith('/.tassyir')).toBe(false);
    }
  });
});
