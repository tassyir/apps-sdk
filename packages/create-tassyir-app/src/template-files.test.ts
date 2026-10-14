import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { validateManifest } from '@tassyir/app-manifest';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import {
  TEMPLATE_DEPENDENCIES,
  TEMPLATES,
  templateDirectory,
} from './templates.js';

// The templates as they are committed and shipped: what every generated
// project starts from.

async function filesOf(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const entry of await readdir(root, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files.set(
      relative(root, path).split('\\').join('/'),
      await readFile(path, 'utf8'),
    );
  }
  return files;
}

const available = TEMPLATES.filter((template) => template.available);

describe.each(available)('the $name template', ({ name }) => {
  const root = templateDirectory(name);

  it('holds no secret, token, key or real id', async () => {
    const patterns: [string, RegExp][] = [
      ['a client secret or token', /tsy_(?:cs|at|rt|ic)_[A-Za-z0-9]{16,}/],
      ['a webhook public key', /whpk_[A-Za-z0-9+/]{20,}/],
      ['a JWT', /eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/],
      ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
      [
        'a snowflake id (a real business, store or installation)',
        /\b\d{15,20}\b/,
      ],
      [
        'an internal Tassyir address',
        /\b(?:staging|internal|admin)\.tassyir\.io\b/,
      ],
    ];
    for (const [path, content] of await filesOf(root)) {
      for (const [what, pattern] of patterns) {
        expect(pattern.test(content), `${path} holds ${what}`).toBe(false);
      }
    }
  });

  it('ships only placeholders in .env.example, for every variable the server reads', async () => {
    const files = await filesOf(root);
    const example = files.get('env.example') ?? '';
    const assignments = example
      .split('\n')
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => line.split('=') as [string, string]);
    expect(assignments.map(([variable]) => variable)).toEqual([
      'TASSYIR_CLIENT_ID',
      'TASSYIR_CLIENT_SECRET',
      'TASSYIR_APP_ID',
      'TOKEN_STORE_KEY',
    ]);
    for (const [variable, value] of assignments)
      expect(value, variable).toContain('your-');
    const config = files.get('src/config.ts') ?? '';
    for (const [variable] of assignments) expect(config).toContain(variable);
    expect(files.has('.env')).toBe(false);
  });

  it('pins every dependency, and lets the generator name the @tassyir/* versions', async () => {
    const manifest = JSON.parse(
      (await filesOf(root)).get('package.json') ?? '{}',
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const all = { ...manifest.dependencies, ...manifest.devDependencies };
    for (const [dependency, spec] of Object.entries(all)) {
      if (dependency.startsWith('@tassyir/')) {
        expect(spec, dependency).toBe('*');
        expect(TEMPLATE_DEPENDENCIES).toHaveProperty([dependency]);
      } else {
        expect(spec, dependency).toMatch(/^\d+\.\d+\.\d+$/);
      }
    }
  });

  it('locks every dependency but @tassyir/* to the npm registry (npm run template:lock)', async () => {
    const files = await filesOf(root);
    const manifest = JSON.parse(files.get('package.json') ?? '{}') as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const lock = JSON.parse(files.get('package-lock.json') ?? '{}') as {
      lockfileVersion: number;
      packages: Record<
        string,
        {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
          resolved?: string;
          integrity?: string;
        }
      >;
    };
    const unscoped = (group: Record<string, string>) =>
      Object.fromEntries(
        Object.entries(group).filter(([name]) => !name.startsWith('@tassyir/')),
      );
    expect(lock.lockfileVersion).toBe(3);
    const { '': project, ...installed } = lock.packages;
    expect(project?.dependencies).toEqual(unscoped(manifest.dependencies));
    expect(project?.devDependencies).toEqual(
      unscoped(manifest.devDependencies),
    );
    for (const [path, entry] of Object.entries(installed)) {
      expect(path, path).not.toContain('@tassyir/');
      expect(entry.resolved, path).toMatch(/^https:\/\/registry\.npmjs\.org\//);
      expect(entry.integrity, path).toMatch(/^sha512-/);
    }
  });

  it('has a manifest the Tassyir API accepts', async () => {
    const result = validateManifest(
      parse((await filesOf(root)).get('tassyir.app.toml') ?? ''),
    );
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it('guides AI coding agents: AGENTS.md, CLAUDE.md and the tassyir-app skill', async () => {
    const files = await filesOf(root);
    expect(files.get('CLAUDE.md')).toContain('@AGENTS.md');
    expect(files.get('AGENTS.md')).toContain(
      '.claude/skills/tassyir-app/SKILL.md',
    );

    const skill = files.get('.claude/skills/tassyir-app/SKILL.md') ?? '';
    const frontMatter = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? '';
    expect(frontMatter).toMatch(/^name: tassyir-app$/m);
    expect(frontMatter).toMatch(/^description: .{80,}$/m);
    for (const topic of [
      'tassyir.app.toml',
      'scope',
      'ID token',
      'offline',
      'refresh',
      'raw body',
      'webhook-id',
      'decimal string',
      'problem+json',
      'fix',
      'Idempotency-Key',
      'App Bridge',
      'dev store',
      'app data',
    ]) {
      expect(skill.toLowerCase(), topic).toContain(topic.toLowerCase());
    }
  });
});
