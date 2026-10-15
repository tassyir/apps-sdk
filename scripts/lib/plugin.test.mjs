import { describe, expect, it } from 'vitest';
import { mcpConfigProblems, withDevMcpVersion } from './plugin.mjs';

const CONFIG = `{
  "mcpServers": {
    "tassyir": {
      "command": "npx",
      "args": ["-y", "@tassyir/dev-mcp@0.1.0"]
    }
  }
}
`;

describe('withDevMcpVersion', () => {
  it('moves the pinned version and keeps every other byte', () => {
    expect(withDevMcpVersion(CONFIG, '0.2.0')).toBe(
      CONFIG.replace('@tassyir/dev-mcp@0.1.0', '@tassyir/dev-mcp@0.2.0'),
    );
  });

  it('pins an unpinned or prerelease spec and leaves an up-to-date file unchanged', () => {
    for (const spec of ['@tassyir/dev-mcp', '@tassyir/dev-mcp@0.2.0-next.1']) {
      const stale = CONFIG.replace('@tassyir/dev-mcp@0.1.0', spec);
      expect(withDevMcpVersion(stale, '0.1.0')).toBe(CONFIG);
    }
    expect(withDevMcpVersion(CONFIG, '0.1.0')).toBe(CONFIG);
  });
});

describe('mcpConfigProblems', () => {
  it('accepts npx -y with the package version', () => {
    expect(mcpConfigProblems(CONFIG, '0.1.0')).toEqual([]);
  });

  it('names a stale version and the command that fixes it', () => {
    expect(mcpConfigProblems(CONFIG, '0.2.0')).toEqual([
      '.mcp.json server "tassyir" runs ["npx","-y","@tassyir/dev-mcp@0.1.0"], not ["npx","-y","@tassyir/dev-mcp@0.2.0"] (packages/dev-mcp/package.json\'s version): run npm run plugin:sync',
    ]);
  });

  it('refuses an unpinned or latest package', () => {
    for (const spec of ['@tassyir/dev-mcp', '@tassyir/dev-mcp@latest']) {
      expect(
        mcpConfigProblems(
          CONFIG.replace('@tassyir/dev-mcp@0.1.0', spec),
          '0.1.0',
        ),
      ).toHaveLength(1);
    }
  });

  it('refuses no server, two servers and a file that is not JSON', () => {
    expect(mcpConfigProblems('{ "mcpServers": {} }', '0.1.0')).toEqual([
      '.mcp.json declares 0 servers in mcpServers, not 1 (the dev MCP)',
    ]);
    const two = JSON.stringify({
      mcpServers: {
        a: { command: 'npx', args: ['-y', '@tassyir/dev-mcp@0.1.0'] },
        b: { command: 'npx', args: ['-y', '@tassyir/dev-mcp@0.1.0'] },
      },
    });
    expect(mcpConfigProblems(two, '0.1.0')).toEqual([
      '.mcp.json declares 2 servers in mcpServers, not 1 (the dev MCP)',
    ]);
    expect(mcpConfigProblems('{', '0.1.0')).toEqual(['.mcp.json is not JSON']);
  });
});
