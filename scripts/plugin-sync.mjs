// Brings the Claude Code plugin (plugins/tassyir) in step with the packages:
// its .mcp.json runs the @tassyir/dev-mcp version of
// packages/dev-mcp/package.json, and its tassyir-app skill is the starter
// template's, byte for byte. scripts/plugin.test.mjs fails while either is
// stale. The release's `version` job runs this after `changeset version`
// (`npm run release:version`), so the Version Packages PR moves the plugin
// with dev-mcp.
// Usage: npm run plugin:sync

import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PLUGIN_MCP_JSON,
  PLUGIN_SKILL,
  TEMPLATE_SKILL,
  withDevMcpVersion,
} from './lib/plugin.mjs';
import { ROOT, readJson } from './lib/workspace.mjs';

const { version } = /** @type {{ version: string }} */ (
  readJson(join(ROOT, 'packages', 'dev-mcp', 'package.json'))
);

const config = readFileSync(PLUGIN_MCP_JSON, 'utf8');
const synced = withDevMcpVersion(config, version);
if (synced === config) {
  console.log(`✓ plugins/tassyir/.mcp.json runs @tassyir/dev-mcp@${version}`);
} else {
  writeFileSync(PLUGIN_MCP_JSON, synced);
  console.log(
    `✓ plugins/tassyir/.mcp.json now runs @tassyir/dev-mcp@${version}`,
  );
}

if (readFileSync(PLUGIN_SKILL).equals(readFileSync(TEMPLATE_SKILL))) {
  console.log(
    '✓ plugins/tassyir/skills/tassyir-app/SKILL.md is the template’s',
  );
} else {
  copyFileSync(TEMPLATE_SKILL, PLUGIN_SKILL);
  console.log('✓ copied the template’s tassyir-app skill into plugins/tassyir');
}
