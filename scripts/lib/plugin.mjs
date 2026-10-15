// The Claude Code plugin `tassyir` (plugins/tassyir), listed by the
// marketplace at the repo root (.claude-plugin/marketplace.json). Its
// .mcp.json runs the released @tassyir/dev-mcp, pinned to the version in
// packages/dev-mcp/package.json, and it bundles the starter's tassyir-app
// skill byte for byte. scripts/plugin.test.mjs holds both rules;
// `npm run plugin:sync` restores them.

import { join } from 'node:path';
import { ROOT } from './workspace.mjs';

export const DEV_MCP_PACKAGE = '@tassyir/dev-mcp';
export const MARKETPLACE_JSON = join(
  ROOT,
  '.claude-plugin',
  'marketplace.json',
);
export const PLUGIN_DIR = join(ROOT, 'plugins', 'tassyir');
export const PLUGIN_MCP_JSON = join(PLUGIN_DIR, '.mcp.json');
export const PLUGIN_SKILL = join(
  PLUGIN_DIR,
  'skills',
  'tassyir-app',
  'SKILL.md',
);
export const TEMPLATE_SKILL = join(
  ROOT,
  'packages',
  'create-tassyir-app',
  'templates',
  'external',
  '.claude',
  'skills',
  'tassyir-app',
  'SKILL.md',
);

// The package as npx names it, with or without a version.
const PINNED = /@tassyir\/dev-mcp(?:@[^"\s]*)?(?=["\s])/g;

/**
 * The plugin's .mcp.json with every `@tassyir/dev-mcp[@<version>]` set to
 * `@tassyir/dev-mcp@<version>`, every other byte kept.
 * @param {string} text
 * @param {string} version
 * @returns {string}
 */
export function withDevMcpVersion(text, version) {
  return text.replace(PINNED, `${DEV_MCP_PACKAGE}@${version}`);
}

/**
 * What keeps the plugin's .mcp.json from starting the released dev MCP:
 * exactly one server, run as `npx -y @tassyir/dev-mcp@<version>`, where
 * `<version>` is packages/dev-mcp/package.json's.
 * @param {string} text the .mcp.json file
 * @param {string} version
 * @returns {string[]}
 */
export function mcpConfigProblems(text, version) {
  /** @type {unknown} */
  let config;
  try {
    config = JSON.parse(text);
  } catch {
    return ['.mcp.json is not JSON'];
  }
  const servers = /** @type {{ mcpServers?: Record<string, unknown> }} */ (
    config
  ).mcpServers;
  const entries = Object.entries(servers ?? {});
  if (entries.length !== 1) {
    return [
      `.mcp.json declares ${String(entries.length)} servers in mcpServers, not 1 (the dev MCP)`,
    ];
  }
  const [[name, server]] = /** @type {[[string, unknown]]} */ (entries);
  const { command, args } =
    /** @type {{ command?: unknown, args?: unknown }} */ (server);
  const expected = ['-y', `${DEV_MCP_PACKAGE}@${version}`];
  if (command === 'npx' && JSON.stringify(args) === JSON.stringify(expected)) {
    return [];
  }
  const actual = [
    command,
    ...(Array.isArray(args) ? /** @type {unknown[]} */ (args) : []),
  ];
  return [
    `.mcp.json server "${name}" runs ${JSON.stringify(actual)}, not ${JSON.stringify(['npx', ...expected])} (packages/dev-mcp/package.json's version): run npm run plugin:sync`,
  ];
}
