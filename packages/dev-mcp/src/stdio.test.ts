import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { CredentialStore } from 'tassyir';
import type { CliIo } from 'tassyir';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertFakesFollowTheDocument,
  FAKE_EMAIL,
  FAKE_USER_ID,
  FakeDeveloperApi,
} from '../../cli/src/fake-api.test-helpers.js';

// The server as an MCP client meets it: a separate Node process speaking
// JSON-RPC over its stdin and stdout, started by the MCP SDK's own
// StdioClientTransport. It runs from this checkout's sources
// (scripts/from-source.mjs), reads the guides from the repo, and reaches the
// CLI's fake developer API over local HTTP with the token a `tassyir login`
// left in the credentials file.

const PACKAGE = fileURLToPath(new URL('../', import.meta.url));

/** Body of an incoming request. */
async function bodyOf(request: IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : undefined;
}

let root: string;
let http: Server;
let origin: string;
let token: string;
let stderr = '';
const fake = new FakeDeveloperApi();
let client: Client;
let transport: StdioClientTransport;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'tassyir-dev-mcp-stdio-'));
  const cwd = join(root, 'work');
  await mkdir(cwd, { recursive: true });
  // The fake developer API, served on 127.0.0.1 (an http origin the CLI's
  // rules allow on loopback only).
  http = createServer((request, response) => {
    void (async () => {
      const body = await bodyOf(request);
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (typeof value === 'string') headers.set(key, value);
      }
      const answer = await fake.fetch(`${fake.origin}${request.url ?? '/'}`, {
        method: request.method ?? 'GET',
        headers,
        redirect: 'error',
        ...(body === undefined ? {} : { body }),
      });
      response.writeHead(answer.status, Object.fromEntries(answer.headers));
      response.end(await answer.text());
    })();
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${String((http.address() as AddressInfo).port)}`;

  const env = {
    TASSYIR_CONFIG_DIR: join(root, 'config'),
    TASSYIR_CREDENTIAL_STORE: 'file',
    TASSYIR_API_ORIGIN: origin,
  };
  token = fake.issueToken();
  await new CredentialStore({
    env,
    platform: 'linux',
    homedir: root,
    now: () => Date.now(),
  } as unknown as CliIo).save(origin, token, {
    tokenId: fake.tokens.at(-1)?.id ?? '',
    userId: FAKE_USER_ID,
    email: FAKE_EMAIL,
  });

  transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      '--import',
      join(PACKAGE, 'scripts', 'from-source.mjs'),
      join(PACKAGE, 'src', 'cli.ts'),
    ],
    cwd,
    env: { PATH: process.env['PATH'] ?? '', HOME: root, ...env },
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  client = new Client({ name: 'dev-mcp-stdio-spec', version: '1.0.0' });
  await client.connect(transport);
}, 30_000);

afterAll(async () => {
  await client.close().catch(() => undefined);
  await transport.close().catch(() => undefined);
  await new Promise<void>((resolve) => {
    http.close(() => {
      resolve();
    });
  });
  await rm(root, { recursive: true, force: true });
  // The fake answered as the developer API's OpenAPI document says.
  assertFakesFollowTheDocument();
});

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as { text?: string }[])[0]?.text ?? '';
}

describe('over stdio, with the SDK client', () => {
  it('shakes hands and lists the twelve tools', async () => {
    expect(client.getServerVersion()).toMatchObject({ name: 'tassyir-dev' });
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(12);
  });

  it('answers the offline tools', async () => {
    const search = await client.callTool({
      name: 'search_docs',
      arguments: { query: 'verify webhook signature', limit: 1 },
    });
    expect(search.isError).toBeFalsy();
    expect(search.structuredContent).toMatchObject({
      results: [
        { open: { tool: 'fetch_doc', arguments: { slug: 'webhooks' } } },
      ],
    });
    const manifest = await client.callTool({
      name: 'validate_manifest',
      arguments: { toml: 'name = "x"' },
    });
    expect(manifest.structuredContent).toMatchObject({ valid: false });
    const operation = await client.callTool({
      name: 'get_api_operation',
      arguments: { operation: 'createBulkExport' },
    });
    expect(operation.structuredContent).toMatchObject({
      operation: { sdkPath: '/bulk/exports' },
    });
  });

  it('calls the developer API with the stored sign-in, and never shows it', async () => {
    const stores = await client.callTool({
      name: 'list_dev_stores',
      arguments: {},
    });
    expect(stores.isError).toBeFalsy();
    expect(stores.structuredContent).toEqual({ stores: [] });
    const request = fake.requests.at(-1);
    expect(request?.headers.get('authorization')).toBe(`Bearer ${token}`);
    expect(request?.headers.get('user-agent')).toMatch(/^tassyir-dev-mcp\//);

    fake.echoInErrors = token;
    fake.tokens.forEach((row) => (row.revoked = true));
    const refused = await client.callTool({
      name: 'list_dev_stores',
      arguments: {},
    });
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent).toMatchObject({
      error: { code: 'DEVELOPER_TOKEN_INVALID', status: 401 },
    });
    expect(textOf(refused)).not.toContain(token);
    expect(textOf(stores)).not.toContain(token);
    expect(stderr).not.toContain(token);
  });

  it('ends when the client closes stdin', async () => {
    const pid = transport.pid;
    expect(pid).not.toBeNull();
    await client.close();
    await expect
      .poll(
        () => {
          try {
            process.kill(pid ?? 0, 0);
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 5_000 },
      )
      .toBe(false);
  });
});
