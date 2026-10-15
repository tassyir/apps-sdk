import packageJson from '../package.json' with { type: 'json' };

/** This package's version: the MCP handshake's and the API user agent's. */
export const DEV_MCP_VERSION: string = packageJson.version;
