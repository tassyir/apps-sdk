// Every refusal names a stable `code`, a `message` and a one-sentence `fix`
// an agent can act on: the shape of the Tassyir API's refusals, the CLI's
// (`tassyir --json`) and @tassyir/app-manifest's problems. A tool answers a
// refusal as an MCP error result (`isError: true`) whose structured content
// is `{ error }`, so the agent reads it and tries again.

/** One problem, in the manifest validator's shape. */
export interface ToolProblem {
  code: string;
  path: string;
  message: string;
  fix: string;
}

export interface ToolErrorInit {
  code: string;
  message: string;
  fix: string;
  /** The HTTP status, when the Tassyir API answered. */
  status?: number | undefined;
  /** The API's request id, to quote when asking Tassyir for help. */
  requestId?: string | undefined;
  /** Seconds to wait before trying again, when the API said. */
  retryAfterSeconds?: number | undefined;
  /** Every problem found, when there are several (scaffold). */
  problems?: readonly ToolProblem[] | undefined;
  /** What the refusal is about (`delivery`, `installations`, …). */
  details?: Readonly<Record<string, unknown>> | undefined;
}

export class ToolError extends Error {
  readonly code: string;
  readonly fix: string;
  readonly status: number | undefined;
  readonly requestId: string | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly problems: readonly ToolProblem[] | undefined;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(init: ToolErrorInit) {
    super(init.message);
    this.name = 'ToolError';
    this.code = init.code;
    this.fix = init.fix;
    this.status = init.status;
    this.requestId = init.requestId;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.problems = init.problems;
    this.details = init.details;
  }

  /** The `error` member of the tool's structured result. */
  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      fix: this.fix,
      ...(this.status === undefined ? {} : { status: this.status }),
      ...(this.requestId === undefined ? {} : { requestId: this.requestId }),
      ...(this.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: this.retryAfterSeconds }),
      ...(this.problems === undefined ? {} : { problems: this.problems }),
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

/** True when `error` is a ToolError, with `code` when one is given. */
export function isToolError(error: unknown, code?: string): error is ToolError {
  return (
    error instanceof ToolError && (code === undefined || error.code === code)
  );
}
