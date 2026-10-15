// tassyir: the Tassyir developer CLI (src/cli.ts is the `tassyir` command).
// The library entry is for tools and agents that drive it in-process, and
// for its specs: `runCli` with a CliIo of your own, the developer API client,
// and the error model. Named exports only.

export { runCli, redact, resolveApiOrigin } from './run.js';
export type { CliIo, ExecOptions, ExecResult } from './io.js';

export { CliError, EXIT_CODES, isCliError } from './errors.js';
export type { CliErrorInit, CliProblem, ExitCode } from './errors.js';

export {
  apiError,
  CLI_CLIENT_ID,
  DEFAULT_API_ORIGIN,
  DeveloperApi,
} from './api.js';
export type {
  DeveloperApiOptions,
  FetchLike,
  PollResult,
  SignInRequest,
} from './api.js';
export type * from './developer-types.js';

export {
  configDirectory,
  CredentialStore,
  DEVELOPER_TOKEN_PATTERN,
  KEYCHAIN_SERVICE,
} from './credentials.js';
export type {
  ResolvedToken,
  SaveResult,
  StorageKind,
  StoredSession,
} from './credentials.js';

export { checkManifest, loadManifest } from './manifest.js';
export type { LoadedManifest, ManifestCheck } from './manifest.js';

export { COMMANDS } from './commands/index.js';
export type { Command, CommandResult, OptionSpec } from './command.js';
