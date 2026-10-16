#!/usr/bin/env node
// The `tassyir-dev-mcp` command: the Tassyir developer MCP server over stdio,
// started by the agent's MCP client (`npx -y @tassyir/dev-mcp`). stdout is the
// MCP connection; everything for people goes to stderr.
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { nodeIo } from './node-io.js';
import { createDevMcpServer } from './server.js';
import { DEV_MCP_VERSION } from './version.js';

const MINIMUM_NODE = [22, 18, 0] as const;

const HELP = `tassyir-dev-mcp ${DEV_MCP_VERSION}: the Tassyir developer MCP server (stdio)

Started by your AI agent's MCP client, not by hand. Claude Code:
  claude mcp add tassyir -- npx -y @tassyir/dev-mcp

Tools: search_docs, fetch_doc, get_api_operation, get_event_schema,
validate_manifest, scaffold, trigger_test_webhook, seed_dev_store,
list_dev_stores, validate_block, run_review_checks (and tail_logs, not
available yet).

The account tools use the sign-in of \`tassyir login\` on this machine.
Environment: TASSYIR_API_ORIGIN, TASSYIR_TOKEN (CI), TASSYIR_CREDENTIAL_STORE,
TASSYIR_CONFIG_DIR, TASSYIR_DEBUG=1 (requests on stderr, never a token).
`;

function tooOld(version: string): boolean {
  const parts = version.split('.').map((part) => Number.parseInt(part, 10));
  for (const [index, minimum] of MINIMUM_NODE.entries()) {
    const difference = (parts[index] ?? 0) - minimum;
    if (difference !== 0) return difference < 0;
  }
  return false;
}

const args = process.argv.slice(2);
if (args.includes('--version') || args.includes('-v')) {
  process.stdout.write(`${DEV_MCP_VERSION}\n`);
} else if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(HELP);
} else if (args.length > 0) {
  process.stderr.write(
    `tassyir-dev-mcp takes no argument (got ${args.join(' ')}).\n\n${HELP}`,
  );
  process.exitCode = 2;
} else if (tooOld(process.versions.node)) {
  process.stderr.write(
    `tassyir-dev-mcp needs Node 22.18 or later; this is Node ${process.versions.node}.\n`,
  );
  process.exitCode = 1;
} else {
  const io = nodeIo(DEV_MCP_VERSION);
  serveStdio(() => createDevMcpServer({ io, version: DEV_MCP_VERSION }), {
    onerror: (error) => {
      io.stderr(`[tassyir-dev-mcp] ${error.message}\n`);
    },
  });
}
