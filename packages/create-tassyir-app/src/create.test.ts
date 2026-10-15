import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateManifest } from '@tassyir/app-manifest';
import { parse } from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import appPackage from '../../app/package.json' with { type: 'json' };
import appBridgePackage from '../../app-bridge/package.json' with { type: 'json' };
import appManifestPackage from '../../app-manifest/package.json' with { type: 'json' };
import cliPackage from '../../cli/package.json' with { type: 'json' };
import uiPackage from '../../ui/package.json' with { type: 'json' };
import { createProject, handleFromFolder, nameFromHandle } from './create.js';
import { CreateError } from './errors.js';
import { TEMPLATE_DEPENDENCIES } from './templates.js';

let scratch: string;
beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'create-tassyir-app-'));
});
afterEach(() => rm(scratch, { recursive: true, force: true }));

async function text(directory: string, path: string): Promise<string> {
  return readFile(join(directory, path), 'utf8');
}

async function refusal(promise: Promise<unknown>): Promise<CreateError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(CreateError);
  return error as CreateError;
}

describe('createProject', () => {
  it('writes the external template with the app values and npm-safe dotfiles', async () => {
    const result = await createProject({
      directory: join(scratch, 'review-requests'),
    });

    expect(result).toMatchObject({
      template: 'external',
      app: {
        name: 'Review Requests',
        handle: 'review-requests',
        url: 'https://review-requests.example.com',
      },
    });
    expect(result.files).toEqual(
      expect.arrayContaining(['.gitignore', '.npmrc', '.env.example']),
    );
    expect(result.files).not.toEqual(expect.arrayContaining(['gitignore']));
    expect(result.files).toEqual(
      expect.arrayContaining([
        'AGENTS.md',
        'CLAUDE.md',
        '.claude/skills/tassyir-app/SKILL.md',
        'tassyir.app.toml',
      ]),
    );
    expect(result.files).toEqual([...result.files].sort());

    const written: string[] = [];
    for (const entry of await readdir(result.directory, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (entry.isFile())
        written.push(
          join(entry.parentPath, entry.name).slice(result.directory.length + 1),
        );
    }
    expect(written.sort()).toEqual(result.files);
  });

  it('names the versions this repo releases, and pins everything else', async () => {
    const result = await createProject({
      directory: join(scratch, 'app'),
      handle: 'my-app',
    });
    const manifest = JSON.parse(
      await text(result.directory, 'package.json'),
    ) as {
      name: string;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(TEMPLATE_DEPENDENCIES).toEqual({
      '@tassyir/app': `^${appPackage.version}`,
      '@tassyir/app-bridge': `^${appBridgePackage.version}`,
      '@tassyir/app-manifest': `^${appManifestPackage.version}`,
      '@tassyir/ui': `^${uiPackage.version}`,
      tassyir: `^${cliPackage.version}`,
    });
    // The result names what this template's package.json names.
    expect(result.dependencies).toEqual({
      '@tassyir/app': `^${appPackage.version}`,
      '@tassyir/app-bridge': `^${appBridgePackage.version}`,
      '@tassyir/app-manifest': `^${appManifestPackage.version}`,
      '@tassyir/ui': `^${uiPackage.version}`,
    });
    expect(manifest.name).toBe('my-app');
    expect(manifest.dependencies['@tassyir/app']).toBe(
      TEMPLATE_DEPENDENCIES['@tassyir/app'],
    );
    expect(manifest.devDependencies['@tassyir/app-bridge']).toBe(
      TEMPLATE_DEPENDENCIES['@tassyir/app-bridge'],
    );
    expect(manifest.devDependencies['@tassyir/app-manifest']).toBe(
      TEMPLATE_DEPENDENCIES['@tassyir/app-manifest'],
    );
    // The page is bundled: @tassyir/ui and App Bridge are build-time only.
    expect(manifest.devDependencies['@tassyir/ui']).toBe(
      TEMPLATE_DEPENDENCIES['@tassyir/ui'],
    );
    for (const [name, spec] of Object.entries({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    })) {
      if (!name.startsWith('@tassyir/'))
        expect(spec, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('writes a manifest the Tassyir API accepts, with the handle, name and URL given', async () => {
    const result = await createProject({
      directory: join(scratch, 'folder'),
      handle: 'sheets-sync',
      name: 'Sheets Sync',
      url: 'https://sync.example.org/tassyir',
    });
    const validated = validateManifest(
      parse(await text(result.directory, 'tassyir.app.toml')),
    );
    expect(validated.ok ? [] : validated.errors).toEqual([]);
    if (!validated.ok) return;
    expect(validated.manifest).toMatchObject({
      name: 'Sheets Sync',
      handle: 'sheets-sync',
      hosting: { mode: 'external', url: 'https://sync.example.org/tassyir' },
    });

    // No template literal is left anywhere.
    for (const file of result.files) {
      const content = await text(result.directory, file);
      expect(content, file).not.toMatch(/my-tassyir-app|My Tassyir App/);
    }
  });

  it('escapes the display name for TOML, JSON and HTML', async () => {
    const name = 'Ali\'s "Shop" <1> & \\ co';
    const result = await createProject({
      directory: join(scratch, 'shop'),
      handle: 'ali-shop',
      name,
    });
    const validated = validateManifest(
      parse(await text(result.directory, 'tassyir.app.toml')),
    );
    expect(validated.ok && validated.manifest.name).toBe(name);
    expect(await text(result.directory, 'src/page/index.html')).toContain(
      '<title>Ali&#39;s &quot;Shop&quot; &lt;1&gt; &amp; \\ co</title>',
    );
  });

  it('makes the handle and name from the folder', () => {
    expect(handleFromFolder('My Shop!')).toBe('my-shop');
    expect(handleFromFolder('--Review__Requests 2--')).toBe(
      'review-requests-2',
    );
    expect(nameFromHandle('review-requests-2')).toBe('Review Requests 2');
  });

  it("refuses a handle the manifest refuses, with the manifest's code and fix", async () => {
    const invalid = await refusal(
      createProject({ directory: join(scratch, 'a'), handle: 'My_App' }),
    );
    expect(invalid).toMatchObject({
      code: 'MANIFEST_HANDLE_INVALID',
      path: '--handle',
    });
    expect(invalid.fix).not.toBe('');

    const reserved = await refusal(
      createProject({ directory: join(scratch, 'b'), handle: 'tassyir' }),
    );
    expect(reserved).toMatchObject({
      code: 'MANIFEST_HANDLE_RESERVED',
      path: '--handle',
    });

    const folder = await refusal(
      createProject({ directory: join(scratch, 'ab') }),
    );
    expect(folder).toMatchObject({
      code: 'MANIFEST_HANDLE_INVALID',
      path: 'directory',
    });
    expect(folder.fix).toContain('--handle');

    expect(await readdir(scratch)).toEqual([]);
  });

  it("refuses a URL Tassyir cannot call, with the validator's code", async () => {
    const http = await refusal(
      createProject({
        directory: join(scratch, 'a'),
        handle: 'my-app',
        url: 'http://example.org',
      }),
    );
    expect(http).toMatchObject({ code: 'MANIFEST_URL_INVALID', path: '--url' });

    // A quote cannot end the TOML string: the validator judges the whole input.
    const quoted = await refusal(
      createProject({
        directory: join(scratch, 'q'),
        handle: 'my-app',
        url: 'https://example.org/"\n[auth]\ncallback_url = "https://example.net',
      }),
    );
    expect(quoted).toMatchObject({
      code: 'MANIFEST_URL_INVALID',
      path: '--url',
    });

    const local = await refusal(
      createProject({
        directory: join(scratch, 'b'),
        handle: 'my-app',
        url: 'https://localhost',
      }),
    );
    expect(local).toMatchObject({
      code: 'MANIFEST_URL_HOST_NOT_ALLOWED',
      path: '--url',
    });

    const name = await refusal(
      createProject({
        directory: join(scratch, 'c'),
        handle: 'my-app',
        name: ' padded ',
      }),
    );
    expect(name).toMatchObject({
      code: 'MANIFEST_NAME_INVALID',
      path: '--name',
    });
    expect(await readdir(scratch)).toEqual([]);
  });

  it('refuses an unknown template', async () => {
    expect(
      await refusal(
        createProject({ directory: join(scratch, 'a'), template: 'react' }),
      ),
    ).toMatchObject({
      code: 'TEMPLATE_UNKNOWN',
      path: '--template',
      fix: 'Use one of: external, hosted.',
    });
  });

  it('writes the hosted template: a Worker for Tassyir Hosting, no URL, no settings', async () => {
    const result = await createProject({
      directory: join(scratch, 'review-requests'),
      template: 'hosted',
      name: 'Review <Requests>',
    });
    expect(result).toMatchObject({
      template: 'hosted',
      app: {
        name: 'Review <Requests>',
        handle: 'review-requests',
        url: 'https://review-requests.tassyir-apps.com',
      },
      dependencies: {
        '@tassyir/app': `^${appPackage.version}`,
        '@tassyir/app-bridge': `^${appBridgePackage.version}`,
        '@tassyir/app-manifest': `^${appManifestPackage.version}`,
        '@tassyir/ui': `^${uiPackage.version}`,
        tassyir: `^${cliPackage.version}`,
      },
    });
    expect(result.files).toEqual(
      expect.arrayContaining([
        '.gitignore',
        '.npmrc',
        'AGENTS.md',
        'CLAUDE.md',
        '.claude/skills/tassyir-app/SKILL.md',
        'src/worker.ts',
        'src/page/main.tsx',
        'tassyir.app.toml',
      ]),
    );
    // No credential to keep: a hosted app holds none.
    expect(result.files).not.toEqual(expect.arrayContaining(['.env.example']));

    const validated = validateManifest(
      parse(await text(result.directory, 'tassyir.app.toml')),
    );
    expect(validated.ok ? [] : validated.errors).toEqual([]);
    if (!validated.ok) return;
    expect(validated.manifest).toMatchObject({
      name: 'Review <Requests>',
      handle: 'review-requests',
      hosting: { mode: 'tassyir', allowed_hosts: [] },
    });
    const manifest = JSON.parse(
      await text(result.directory, 'package.json'),
    ) as {
      name: string;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(manifest.name).toBe('review-requests');
    expect(manifest.devDependencies['tassyir']).toBe(`^${cliPackage.version}`);
    expect(await text(result.directory, 'src/page/index.html')).toContain(
      '<title>Review &lt;Requests&gt;</title>',
    );
    for (const file of result.files) {
      const content = await text(result.directory, file);
      expect(content, file).not.toMatch(/my-tassyir-app|My Tassyir App/);
    }
  });

  it('refuses --url for the hosted template', async () => {
    const refused = await refusal(
      createProject({
        directory: join(scratch, 'a'),
        template: 'hosted',
        handle: 'my-app',
        url: 'https://example.org',
      }),
    );
    expect(refused).toMatchObject({
      code: 'OPTION_NOT_FOR_TEMPLATE',
      path: '--url',
    });
    expect(refused.message).toContain('https://my-app.tassyir-apps.com');
    expect(refused.fix).toContain('--template external');
    expect(await readdir(scratch)).toEqual([]);
  });

  it('never writes into a folder that holds anything but .git', async () => {
    const taken = join(scratch, 'taken');
    await mkdir(taken);
    await writeFile(join(taken, 'notes.txt'), 'mine');
    expect(
      await refusal(createProject({ directory: taken, handle: 'my-app' })),
    ).toMatchObject({
      code: 'TARGET_NOT_EMPTY',
      path: 'directory',
    });
    expect(await readdir(taken)).toEqual(['notes.txt']);

    const file = join(scratch, 'file');
    await writeFile(file, '');
    expect(
      await refusal(createProject({ directory: file, handle: 'my-app' })),
    ).toMatchObject({
      code: 'TARGET_NOT_A_DIRECTORY',
    });

    const repository = join(scratch, 'repo');
    await mkdir(join(repository, '.git'), { recursive: true });
    await expect(
      createProject({ directory: repository, handle: 'my-app' }),
    ).resolves.toMatchObject({
      app: { handle: 'my-app' },
    });
  });
});
