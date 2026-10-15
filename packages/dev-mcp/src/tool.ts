import type {
  CallToolResult,
  McpServer,
  ToolAnnotations,
} from '@modelcontextprotocol/server';
import { isCliError, redact } from 'tassyir';
import type { CliIo } from 'tassyir';
import type * as z from 'zod';
import type { Content } from './content.js';
import type { SearchIndex } from './docs.js';
import { isToolError, ToolError } from './errors.js';

// How a tool is declared and answered. Every tool has a JSON Schema input
// (from its zod schema: unknown keys refused) and, when it can succeed, a
// JSON Schema output the SDK checks each answer against. Every answer is
// data: strings pass through the CLI's redaction (no developer token or
// device code, no control character), and the whole answer stays under
// MAX_RESULT_BYTES. A refusal is an error result whose structured content is
// `{ error: { code, message, fix, … } }`.

/** The most a tool answers, as JSON text: an agent's context is precious. */
export const MAX_RESULT_BYTES = 8 * 1024;

/** Secrets the developer API could carry; never in an answer from it. */
const API_SECRETS = /tsy_(cs|at|rt|ic|dt|dc)_[0-9A-Za-z]+/g;

export interface ToolContext {
  /** The working folder: relative paths and the default tassyir.app.toml. */
  cwd: string;
  /** The process as the CLI's credential store and API client need it. */
  io: CliIo;
  /** The guides and the API reference, read once. */
  content(): Promise<Content>;
  search(): Promise<SearchIndex>;
  /** The API origin, or why TASSYIR_API_ORIGIN cannot be used. */
  apiOrigin: string | ToolError;
  /** `tassyir-dev-mcp/<version> (…)`. */
  userAgent: string;
  /** Request lines (method, path, status) on stderr with TASSYIR_DEBUG=1. */
  debug: ((line: string) => void) | undefined;
}

export interface Tool {
  name: string;
  title: string;
  description: string;
  annotations: ToolAnnotations;
  input: z.ZodObject;
  output: z.ZodObject | undefined;
  /** Answers from the developer API: redacted for every Tassyir secret shape. */
  remote: boolean;
  call(args: unknown, context: ToolContext): Promise<Record<string, unknown>>;
}

export interface ToolSpec<I extends z.ZodObject, O extends z.ZodObject> {
  name: string;
  title: string;
  description: string;
  annotations: ToolAnnotations;
  input: I;
  output: O;
  remote?: boolean;
  run(args: z.output<I>, context: ToolContext): Promise<z.input<O>>;
}

export function defineTool<I extends z.ZodObject, O extends z.ZodObject>(
  spec: ToolSpec<I, O>,
): Tool {
  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    annotations: spec.annotations,
    input: spec.input,
    output: spec.output,
    remote: spec.remote ?? false,
    // The SDK has parsed `args` with `spec.input` before the call.
    call: (args, context) => spec.run(args as z.output<I>, context),
  };
}

/** A tool kept as a seam: listed, and answered TOOL_NOT_AVAILABLE with a fix. */
export function laterTool(spec: {
  name: string;
  title: string;
  description: string;
  input: z.ZodObject;
  reason: string;
  fix: string;
}): Tool {
  return {
    name: spec.name,
    title: spec.title,
    description: `Not available yet: ${spec.reason}. ${spec.description}`,
    annotations: { readOnlyHint: true, openWorldHint: false },
    input: spec.input,
    output: undefined,
    remote: false,
    call: () =>
      Promise.reject(
        new ToolError({
          code: 'TOOL_NOT_AVAILABLE',
          message: `${spec.name} is not available yet: ${spec.reason}`,
          fix: spec.fix,
        }),
      ),
  };
}

/** Every string in `value`, redacted; the rest as it is. */
export function sanitize(value: unknown, remote: boolean): unknown {
  if (typeof value === 'string') {
    const text = redact(value);
    return remote ? text.replace(API_SECRETS, 'tsy_$1_[redacted]') : text;
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item, remote));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitize(item, remote)]),
    );
  }
  return value;
}

export function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/** A refusal of the CLI's code (the developer API client, the credential store) as a tool's. */
export function fromCliError(error: unknown): ToolError | undefined {
  if (!isCliError(error)) return undefined;
  return new ToolError({
    code: error.code,
    message: error.message,
    fix: error.fix,
    status: error.status,
    requestId: error.requestId,
    retryAfterSeconds: error.retryAfterSeconds,
    problems: error.errors,
    details: error.details,
  });
}

function asToolError(error: unknown): ToolError {
  if (isToolError(error)) return error;
  const fromCli = fromCliError(error);
  if (fromCli) return fromCli;
  return new ToolError({
    code: 'INTERNAL_ERROR',
    message: 'The Tassyir dev MCP server failed while answering',
    fix: 'Call the tool again; if it fails the same way, report it at https://github.com/tassyir/apps-sdk/issues with the tool name and arguments (never a token).',
  });
}

export function errorResult(error: unknown, remote: boolean): CallToolResult {
  const failure = asToolError(error);
  let structured = sanitize({ error: failure.toJSON() }, remote) as Record<
    string,
    unknown
  >;
  let text = JSON.stringify(structured);
  if (byteLength(text) > MAX_RESULT_BYTES) {
    // Long problem lists or details: keep the code, message and fix.
    structured = sanitize(
      {
        error: {
          code: failure.code,
          message: failure.message.slice(0, 1_000),
          fix: failure.fix.slice(0, 1_000),
          ...(failure.problems
            ? {
                problems: failure.problems.slice(0, 10),
                problemCount: failure.problems.length,
              }
            : {}),
        },
      },
      remote,
    ) as Record<string, unknown>;
    text = JSON.stringify(structured);
  }
  return {
    content: [{ type: 'text', text }],
    structuredContent: structured,
    isError: true,
  };
}

export function successResult(
  value: Record<string, unknown>,
  remote: boolean,
): CallToolResult {
  const structured = sanitize(value, remote) as Record<string, unknown>;
  const text = JSON.stringify(structured);
  if (byteLength(text) > MAX_RESULT_BYTES) {
    return errorResult(
      new ToolError({
        code: 'RESULT_TOO_LARGE',
        message: `The answer is ${String(byteLength(text))} bytes, over the ${String(MAX_RESULT_BYTES)} this server sends`,
        fix: 'Ask for less: a section or a page of a guide, one operation or schema, or fewer results.',
      }),
      remote,
    );
  }
  return { content: [{ type: 'text', text }], structuredContent: structured };
}

/** Registers `tool` on `server`: its schemas, and the answer's shape. */
export function registerTool(
  server: McpServer,
  tool: Tool,
  context: ToolContext,
): void {
  const handler = async (args: unknown): Promise<CallToolResult> => {
    try {
      return successResult(await tool.call(args, context), tool.remote);
    } catch (error) {
      return errorResult(error, tool.remote);
    }
  };
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.input,
      ...(tool.output ? { outputSchema: tool.output } : {}),
      annotations: { title: tool.title, ...tool.annotations },
    },
    handler,
  );
}
