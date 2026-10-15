import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { CredentialStore } from 'tassyir';
import type { CliIo, ExecResult } from 'tassyir';
import { expect } from 'vitest';
import {
  assertFakesFollowTheDocument,
  FAKE_EMAIL,
  FAKE_USER_ID,
  FakeDeveloperApi,
  fakeClock,
} from '../../cli/src/fake-api.test-helpers.js';
import type { ContentPaths } from './content.js';
import { createDevMcpServer, MAX_RESULT_BYTES } from './index.js';

// The specs' world: the real server, connected to the MCP SDK's own client
// through its in-memory transport; the tassyir CLI's fake developer API
// (AP-K1.6) behind `fetch`; the credential store in a scratch folder (as
// `tassyir login` leaves it, the file backend); the repo's guides and OpenAPI
// documents as the content.

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));

export const CONTENT: ContentPaths = {
  guides: join(REPO, 'docs', 'guides'),
  openapi: join(REPO, 'packages', 'app', 'openapi', 'openapi.2026-10.json'),
  developerOpenapi: join(
    REPO,
    'packages',
    'cli',
    'openapi',
    'openapi.developer.json',
  ),
};

export interface Answer {
  isError: boolean;
  text: string;
  structured: Record<string, unknown>;
}

const scratch: string[] = [];

/**
 * Removes every scratch folder, then fails if the fake API received or
 * answered anything the OpenAPI document does not allow (call from afterEach).
 */
export async function cleanupHarnesses(): Promise<void> {
  await Promise.all(
    scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
  assertFakesFollowTheDocument();
}

export async function createHarness(
  options: {
    env?: Record<string, string | undefined>;
    content?: ContentPaths;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'tassyir-dev-mcp-'));
  scratch.push(root);
  const cwd = join(root, 'work');
  await mkdir(cwd, { recursive: true });
  const clock = fakeClock();
  const fake = new FakeDeveloperApi(clock);
  const stderr: string[] = [];
  const execCalls: string[] = [];
  const env: Record<string, string | undefined> = {
    TASSYIR_CONFIG_DIR: join(root, 'config'),
    TASSYIR_API_ORIGIN: fake.origin,
    TASSYIR_CREDENTIAL_STORE: 'file',
    ...options.env,
  };
  const io: CliIo = {
    stdout: (text) => stderr.push(text),
    stderr: (text) => stderr.push(text),
    env,
    cwd,
    platform: 'linux',
    homedir: root,
    hostname: 'amina-laptop',
    nodeVersion: '22.18.0',
    version: '0.0.0-test',
    interactive: false,
    fetch: fake.fetch,
    now: clock.now,
    sleep: clock.sleep,
    exec: (command): Promise<ExecResult> => {
      execCalls.push(command);
      return Promise.resolve({
        code: null,
        stdout: '',
        stderr: '',
        failure: 'ENOENT',
      });
    },
    waitForEnter: () => ({
      promise: new Promise<void>(() => undefined),
      cancel: () => undefined,
    }),
  };
  const server = createDevMcpServer({
    io,
    content: options.content ?? CONTENT,
    version: '0.0.0-test',
  });
  const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
  await server.connect(serverEnd);
  const client = new Client({ name: 'dev-mcp-spec', version: '1.0.0' });
  await client.connect(clientEnd);
  /** Every answer of this harness, for the secrecy spec. */
  const answers: Answer[] = [];

  return {
    client,
    server,
    fake,
    io,
    env,
    cwd,
    root,
    stderr,
    execCalls,
    answers,
    /**
     * Calls a tool through the SDK's client (which checks a success against
     * the tool's output schema) and checks the answer's shape and size.
     */
    async call(
      name: string,
      args: Record<string, unknown> = {},
    ): Promise<Answer> {
      const result = await client.callTool({ name, arguments: args });
      const content = result.content as { type: string; text?: string }[];
      expect(content).toHaveLength(1);
      const text = content[0]?.text ?? '';
      expect(content[0]?.type).toBe('text');
      expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(
        MAX_RESULT_BYTES,
      );
      const structured = result.structuredContent as Record<string, unknown>;
      expect(JSON.parse(text)).toEqual(structured);
      const answer = { isError: result.isError === true, text, structured };
      answers.push(answer);
      return answer;
    },
    /** A tool call that must succeed: its structured content. */
    async ok(name: string, args: Record<string, unknown> = {}) {
      const answer = await this.call(name, args);
      if (answer.isError) {
        throw new Error(`${name} failed: ${answer.text}`);
      }
      return answer.structured;
    },
    /** A tool call that must fail: its `error`. */
    async refused(name: string, args: Record<string, unknown> = {}) {
      const answer = await this.call(name, args);
      if (!answer.isError) {
        throw new Error(`${name} succeeded: ${answer.text}`);
      }
      return answer.structured['error'] as {
        code: string;
        message: string;
        fix: string;
        [key: string]: unknown;
      };
    },
    /** A token as `tassyir login` leaves it, in the CLI's credentials file. */
    async signIn(): Promise<string> {
      const token = fake.issueToken();
      await new CredentialStore(io).save(fake.origin, token, {
        tokenId: fake.tokens.at(-1)?.id ?? '',
        userId: FAKE_USER_ID,
        email: FAKE_EMAIL,
      });
      return token;
    },
    async close(): Promise<void> {
      await client.close();
      await server.close();
    },
  };
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;
