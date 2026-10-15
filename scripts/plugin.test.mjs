// The Claude Code marketplace (.claude-plugin/marketplace.json) and its one
// plugin, `tassyir` (plugins/tassyir): the plugin runs the released
// @tassyir/dev-mcp and bundles the starter's tassyir-app skill, both kept in
// step with the packages. `npm run plugin:sync` repairs either; the release's
// `version` job runs it, so a Version Packages PR moves the plugin with
// dev-mcp. `claude plugin validate` checks the manifests themselves.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MARKETPLACE_JSON,
  PLUGIN_DIR,
  PLUGIN_MCP_JSON,
  PLUGIN_SKILL,
  TEMPLATE_SKILL,
  mcpConfigProblems,
} from './lib/plugin.mjs';
import { ROOT, readJson } from './lib/workspace.mjs';

/** @typedef {{ name: string, source: string }} PluginEntry */

const marketplace = /** @type {{ name: string, plugins: PluginEntry[] }} */ (
  readJson(MARKETPLACE_JSON)
);
const plugin = /** @type {{ name: string }} */ (
  readJson(join(PLUGIN_DIR, '.claude-plugin', 'plugin.json'))
);
const devMcp = /** @type {{ version: string }} */ (
  readJson(join(ROOT, 'packages', 'dev-mcp', 'package.json'))
);

describe('the Claude Code marketplace', () => {
  it('lists one plugin, tassyir, installed as tassyir@tassyir', () => {
    expect(marketplace.name).toBe('tassyir');
    expect(
      marketplace.plugins.map(({ name, source }) => ({ name, source })),
    ).toEqual([{ name: 'tassyir', source: './plugins/tassyir' }]);
    expect(plugin.name).toBe('tassyir');
  });

  it('leaves the plugin unversioned, so each commit reaches its users', () => {
    // A `version` in plugin.json freezes `claude plugin update` until someone
    // bumps it; without one, Claude Code versions the plugin by commit.
    expect(plugin).not.toHaveProperty('version');
  });
});

describe('the tassyir plugin', () => {
  it('runs the @tassyir/dev-mcp of packages/dev-mcp/package.json', () => {
    expect(
      mcpConfigProblems(readFileSync(PLUGIN_MCP_JSON, 'utf8'), devMcp.version),
    ).toEqual([]);
  });

  it("bundles the starter's tassyir-app skill, byte for byte", () => {
    const same = readFileSync(PLUGIN_SKILL).equals(
      readFileSync(TEMPLATE_SKILL),
    );
    expect(
      same,
      'plugins/tassyir/skills/tassyir-app/SKILL.md differs from packages/create-tassyir-app/templates/external/.claude/skills/tassyir-app/SKILL.md: run npm run plugin:sync',
    ).toBe(true);
  });
});
