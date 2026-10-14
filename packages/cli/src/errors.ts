// Every refusal names a stable `code`, a `message` for people and a
// one-sentence `fix` an agent can act on: the shape of the Tassyir API's own
// refusals (and of RFC 9457 problems' `code` + `fix` in the Admin API). The
// process exit code groups the codes, so a script can branch without parsing.

/** The process exit codes. Stable: scripts and agents branch on them. */
export const EXIT_CODES = Object.freeze({
  /** Done. */
  OK: 0,
  /** The API refused, or something else failed: the error's `code` says what. */
  FAILED: 1,
  /** Unknown command or option, or a missing or malformed argument. */
  USAGE: 2,
  /** Not signed in, or the token was refused: run `tassyir login`. */
  AUTH: 3,
  /** `tassyir.app.toml` is missing, not TOML, or invalid. */
  MANIFEST: 4,
  /** Rate limited, or the API is busy or unreachable: wait, then run it again. */
  TRY_LATER: 5,
});

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

/** One manifest problem, in the validator's shape. */
export interface CliProblem {
  code: string;
  path: string;
  message: string;
  fix: string;
}

export interface CliErrorInit {
  code: string;
  message: string;
  fix: string;
  /** Default {@link EXIT_CODES.FAILED}. */
  exitCode?: ExitCode;
  /** The HTTP status, when the API answered. */
  status?: number;
  /** The API's request id, to quote when asking Tassyir for help. */
  requestId?: string;
  /** Seconds to wait before trying again, when the API said. */
  retryAfterSeconds?: number;
  /** Every manifest problem, when there are several (validate, deploy). */
  errors?: readonly CliProblem[];
  /** What the refusal is about (`limit`, `handle`, `installationId`, …). */
  details?: Readonly<Record<string, unknown>>;
  /**
   * Values the person must see although the command failed (a secret minted
   * before a later step broke): printed as `KEY=value` lines, and `reveal`
   * in `--json`.
   */
  reveal?: Readonly<Record<string, string>>;
}

export class CliError extends Error {
  readonly code: string;
  readonly fix: string;
  readonly exitCode: ExitCode;
  readonly status: number | undefined;
  readonly requestId: string | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly errors: readonly CliProblem[] | undefined;
  readonly details: Readonly<Record<string, unknown>> | undefined;
  readonly reveal: Readonly<Record<string, string>> | undefined;

  constructor(init: CliErrorInit) {
    super(init.message);
    this.name = 'CliError';
    this.code = init.code;
    this.fix = init.fix;
    this.exitCode = init.exitCode ?? EXIT_CODES.FAILED;
    this.status = init.status;
    this.requestId = init.requestId;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.errors = init.errors;
    this.details = init.details;
    this.reveal = init.reveal;
  }

  /** The `error` member of a `--json` answer. */
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
      ...(this.errors === undefined ? {} : { errors: this.errors }),
      ...(this.details === undefined ? {} : { details: this.details }),
      ...(this.reveal === undefined ? {} : { reveal: this.reveal }),
    };
  }
}

/** True when `error` is a CliError, with `code` when one is given. */
export function isCliError(error: unknown, code?: string): error is CliError {
  return (
    error instanceof CliError && (code === undefined || error.code === code)
  );
}

/** A usage refusal: exit code 2, and how to read the command's help. */
export function usageError(
  message: string,
  command?: string,
  code = 'INVALID_ARGUMENT',
): CliError {
  return new CliError({
    code,
    message,
    fix: `Run \`tassyir ${command ? `${command} ` : ''}--help\` for the options.`,
    exitCode: EXIT_CODES.USAGE,
  });
}

/** Not signed in on this machine for this API. */
export function notLoggedIn(apiOrigin: string): CliError {
  return new CliError({
    code: 'NOT_LOGGED_IN',
    message: `Not signed in to ${apiOrigin}`,
    fix: 'Run `tassyir login`, or set TASSYIR_TOKEN to a developer token (tsy_dt_…) in CI.',
    exitCode: EXIT_CODES.AUTH,
  });
}
