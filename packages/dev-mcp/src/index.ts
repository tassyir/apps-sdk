// @tassyir/dev-mcp: the Tassyir developer MCP server (src/cli.ts is the
// `tassyir-dev-mcp` command, over stdio). The library entry is for hosts that
// run it on a transport of their own, and for its specs. Named exports only.

export {
  createDevMcpServer,
  INSTRUCTIONS,
  SERVER_NAME,
  TOOLS,
} from './server.js';
export type { DevMcpServerOptions } from './server.js';

export { MAX_RESULT_BYTES } from './tool.js';
export type { Tool, ToolContext } from './tool.js';

export { isToolError, ToolError } from './errors.js';
export type { ToolErrorInit, ToolProblem } from './errors.js';

export { defaultContentPaths, loadContent } from './content.js';
export type { Content, ContentPaths, Guide, GuideSection } from './content.js';

export { nodeIo } from './node-io.js';
export { DEV_MCP_VERSION } from './version.js';
