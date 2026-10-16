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

export {
  HOSTED_BUNDLE_LIMITS,
  LOCKFILE_NAMES,
  validateHostedBundle,
} from './bundle-rules.js';
export type {
  BundleFile,
  BundleValidation,
  HostedBundle,
  HostedModuleKind,
  LockfileName,
  NormalisedBundle,
} from './bundle-rules.js';
export { checkBundleCode } from './bundle-code.js';
export type { CodeCheckResult, CodeFinding, Locate } from './bundle-code.js';
export { buildHostedBundle, DEFAULT_ENTRIES } from './bundle-build.js';
export type { BuiltBundle } from './bundle-build.js';

export {
  BLOCK_VERSION_LIMITS,
  blockDeclaration,
  blockProblem,
  checkBlocks,
  readBlock,
} from './blocks.js';
export type {
  BlockCheck,
  CheckedBlock,
  ManifestBlock,
  VersionAssets,
} from './blocks.js';
export { failedChecks, REASON_LABELS, STATE_LABELS } from './review.js';

export { COMMANDS } from './commands/index.js';
export type { Command, CommandResult, OptionSpec } from './command.js';
