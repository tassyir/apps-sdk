// Every refusal names a stable `code`, the input at fault (`path`: an option
// such as `--handle`, `directory`, or a file of the template), a message for
// people and a one-sentence `fix` an agent can act on, in the shape the
// Tassyir API and @tassyir/app-manifest use.

/** One problem, in the manifest validator's shape. */
export interface CreateProblem {
  code: string;
  path: string;
  message: string;
  fix: string;
}

export type CreateErrorCode =
  | 'NODE_VERSION_UNSUPPORTED'
  | 'INVALID_ARGUMENT'
  | 'TEMPLATE_UNKNOWN'
  | 'TEMPLATE_NOT_AVAILABLE'
  | 'TARGET_NOT_EMPTY'
  | 'TARGET_NOT_A_DIRECTORY'
  | 'WRITE_FAILED'
  | 'INSTALL_FAILED'
  // A manifest code (MANIFEST_HANDLE_INVALID, MANIFEST_URL_INVALID, …) when
  // the app's name, handle or URL breaks the manifest's rules.
  | `MANIFEST_${string}`;

export class CreateError extends Error {
  readonly code: CreateErrorCode;
  readonly path: string;
  readonly fix: string;
  /** Every problem found; the first one is this error's. */
  readonly problems: readonly CreateProblem[];

  constructor(
    problem: CreateProblem & { code: CreateErrorCode },
    others: readonly CreateProblem[] = [],
  ) {
    super(problem.message);
    this.name = 'CreateError';
    this.code = problem.code;
    this.path = problem.path;
    this.fix = problem.fix;
    this.problems = [problem, ...others];
  }

  toJSON(): {
    code: string;
    path: string;
    message: string;
    fix: string;
    problems: readonly CreateProblem[];
  } {
    return {
      code: this.code,
      path: this.path,
      message: this.message,
      fix: this.fix,
      problems: this.problems,
    };
  }
}

/** True when `error` is a CreateError, with `code` when one is given. */
export function isCreateError(
  error: unknown,
  code?: CreateErrorCode,
): error is CreateError {
  return (
    error instanceof CreateError && (code === undefined || error.code === code)
  );
}
