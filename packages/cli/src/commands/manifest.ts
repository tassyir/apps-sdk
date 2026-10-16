import { dirname } from 'node:path';
import type { AppManifest } from '@tassyir/app-manifest';
import type { DeveloperApi } from '../api.js';
import {
  BUNDLE_MAIN,
  buildHostedBundle,
  DEFAULT_ENTRIES,
} from '../bundle-build.js';
import type { BuiltBundle } from '../bundle-build.js';
import { checkBundleCode } from '../bundle-code.js';
import { blocksInvalid, checkBlocks } from '../blocks.js';
import type { CheckedBlock, VersionAssets } from '../blocks.js';
import { validateHostedBundle } from '../bundle-rules.js';
import { lines, resolveApp, stringValue } from '../command.js';
import type {
  Command,
  CommandResult,
  Context,
  OptionSpec,
} from '../command.js';
import type { AppVersionDetail } from '../developer-types.js';
import { CliError, EXIT_CODES, isCliError, usageError } from '../errors.js';
import type { CliProblem } from '../errors.js';
import {
  answerHostedVersion,
  checkLaterCommand,
  DEFAULT_FOLLOW_TIMEOUT_SECONDS,
  followVersion,
  hostingLines,
  isSettled,
  progressLabel,
  stageOf,
} from '../hosted-version.js';
import { checkManifest, loadManifest, manifestInvalid } from '../manifest.js';
import type { LoadedManifest } from '../manifest.js';

// validate (offline, @tassyir/app-manifest, and each storefront block's files
// through @tassyir/storefront-blocks); deploy (an external app's manifest as
// a new version, current at once, its block files as `assets`; a hosted
// app's manifest with the bundle built here, its block files among the
// modules, checked by the API's rules before the upload, then its scan
// followed to the verdict; --dry-run stops before signing in); app version
// (one version, followed on demand: what deploy says to run when it stops
// waiting).

/** Things that pass the validator but are almost certainly not meant. */
function warningsOf(manifest: AppManifest): string[] {
  const warnings: string[] = [];
  const url =
    manifest.hosting.mode === 'external' ? manifest.hosting.url : undefined;
  if (url !== undefined) {
    const host = new URL(url).hostname;
    if (host === 'example.com' || host.endsWith('.example.com')) {
      warnings.push(
        `hosting.url is ${url}, a placeholder: put your server's public https address there (a tunnel's while you develop: \`tassyir dev\`).`,
      );
    }
  }
  return warnings;
}

/** The manifest's blocks, read and checked: BLOCKS_INVALID (exit 4) lists every problem. */
async function checkedBlocks(
  loaded: LoadedManifest,
  manifest: AppManifest,
  rerun: string,
): Promise<{ blocks: CheckedBlock[]; files: VersionAssets['files'] }> {
  const check = await checkBlocks(dirname(loaded.path), manifest);
  if (!check.ok) throw blocksInvalid(check.errors, rerun);
  return { blocks: check.blocks, files: check.files };
}

/** One line for people: the blocks that pass, or nothing without blocks. */
function blocksLine(blocks: readonly CheckedBlock[]): string | null {
  if (blocks.length === 0) return null;
  return `  ${String(blocks.length)} storefront block${blocks.length === 1 ? '' : 's'} (${blocks.map((block) => block.handle).join(', ')}) pass the upload's check: template, stylesheet, sample renders in ar, fr and en.`;
}

function summary(manifest: AppManifest): string {
  const where =
    manifest.hosting.mode === 'external'
      ? `your server at ${manifest.hosting.url}`
      : 'Tassyir Hosting';
  const scopes = [
    ...manifest.access.scopes,
    ...manifest.access.optional_scopes,
  ];
  const topics = manifest.webhooks.flatMap((webhook) => webhook.topics);
  return `${manifest.handle}, on ${where}; scopes: ${scopes.join(', ') || 'none'}; webhooks: ${topics.join(', ') || 'none'}`;
}

export const validateCommand: Command = {
  name: 'validate',
  summary:
    "Check tassyir.app.toml with the Tassyir API's own validator (offline)",
  usage: 'tassyir validate [path] [options]',
  description: [
    'Parses the TOML and validates it exactly as the API will: every problem at once, each',
    'with its code, the field and a fix. Then each [[storefront.blocks]] file: the template',
    'and stylesheet checked and rendered with sample data by @tassyir/storefront-blocks, the',
    "upload's own check, each problem with its file, line and column. Exit code 4 when",
    'anything does not pass.',
  ].join('\n'),
  positionals: { min: 0, max: 1, names: '[path]' },
  options: {},
  async run(context, { positionals }) {
    const loaded = await loadManifest(context.io.cwd, positionals[0]);
    const check = checkManifest(loaded.parsed);
    if (!check.ok) throw manifestInvalid(loaded.display, check.errors);
    const { blocks } = await checkedBlocks(
      loaded,
      check.manifest,
      'tassyir validate',
    );
    const warnings = warningsOf(check.manifest);
    return {
      data: {
        file: loaded.display,
        valid: true,
        manifest: check.manifest,
        blocks,
        warnings,
      },
      text: lines(
        `✓ ${loaded.display} is valid: ${summary(check.manifest)}.`,
        blocksLine(blocks),
        ...warnings.map((warning) => `  ! ${warning}`),
      ),
    };
  },
};

const TIMEOUT_OPTION: OptionSpec = {
  type: 'string',
  value: 'seconds',
  description: `How long to wait for the scan's verdict. Default ${String(DEFAULT_FOLLOW_TIMEOUT_SECONDS)}; 0 answers at once.`,
};

/** `--timeout`: whole seconds, the default when absent. */
function timeoutSeconds(
  value: string | boolean | undefined,
  command: string,
): number {
  if (value === undefined) return DEFAULT_FOLLOW_TIMEOUT_SECONDS;
  if (typeof value === 'string' && /^\d{1,6}$/.test(value)) {
    return Number(value);
  }
  throw usageError(
    `--timeout takes whole seconds (0 answers at once), got ${String(value)}`,
    command,
  );
}

/** The same refusal with the CLI's own fix (it knows the commands). */
function withFix(error: CliError, fix: string): CliError {
  return new CliError({
    code: error.code,
    message: error.message,
    fix,
    exitCode: error.exitCode,
    ...(error.status === undefined ? {} : { status: error.status }),
    ...(error.requestId === undefined ? {} : { requestId: error.requestId }),
    ...(error.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: error.retryAfterSeconds }),
    ...(error.errors === undefined ? {} : { errors: error.errors }),
    ...(error.details === undefined ? {} : { details: error.details }),
  });
}

/** A hosted upload's refusals, with what to do from the CLI. */
function hostedUploadError(error: unknown, apiOrigin: string): unknown {
  if (!isCliError(error)) return error;
  switch (error.code) {
    case 'APP_VERSION_CONFLICT':
      return withFix(
        error,
        'Run `tassyir deploy` again: another upload of this app took that version number first, and each upload takes the next one.',
      );
    case 'APP_HOSTING_NOT_AVAILABLE':
      return withFix(
        error,
        `Tassyir Hosting is switched off on ${apiOrigin} (production keeps it off until hosted apps can be reached): run the app on your own server (hosting.mode = "external" and hosting.url in tassyir.app.toml), or deploy to an API where it is on (--api-origin).`,
      );
    case 'APP_HOSTING_NOT_CONFIGURED':
      return withFix(
        error,
        `Tassyir Hosting is on at ${apiOrigin} but cannot take uploads yet, so nothing was stored: run \`tassyir deploy\` again later, and tell Tassyir (with the requestId) if it lasts.`,
      );
    case 'APP_BUNDLE_INVALID': {
      const first = error.errors?.[0];
      return withFix(
        error,
        `${first ? `${first.fix} ` : ''}The CLI's own check of the bundle missed this: update the CLI (npm install -g tassyir@latest), and tell Tassyir if it is the latest.`,
      );
    }
    case 'PAYLOAD_TOO_LARGE': {
      // Since AP-B1.23 the API's 413 says why (`fix`, `limitBytes`,
      // `hostingAvailable`); an older API answers a bare 413.
      const available = error.details?.['hostingAvailable'];
      if (available === true) return error;
      if (available === false) {
        return withFix(
          error,
          `${error.fix} Or deploy to an API where Tassyir Hosting is on (--api-origin).`,
        );
      }
      return withFix(
        error,
        `${apiOrigin} took less than this bundle: an upload is at most 128 KB while Tassyir Hosting is off there (8 MB + 128 KB when it is on). Deploy to an API where it is on (--api-origin), or run the app on your own server (hosting.mode = "external").`,
      );
    }
    default:
      return error;
  }
}

/** The bundle does not pass: one CliError (exit 4) listing every problem. Nothing was uploaded. */
function bundleInvalid(
  entry: string,
  errors: readonly CliProblem[],
  rerun: string,
): CliError {
  const first = errors[0];
  return new CliError({
    code: 'BUNDLE_INVALID',
    message: `The bundle built from ${entry} has ${String(errors.length)} problem${errors.length === 1 ? '' : 's'}${first ? `; the first: ${first.path ? `${first.path}: ` : ''}${first.message}` : ''}. Nothing was uploaded`,
    fix: first
      ? `${first.fix} Then fix the others listed and run \`${rerun}\` again.`
      : `Run \`${rerun}\` again for the list.`,
    exitCode: EXIT_CODES.MANIFEST,
    errors,
  });
}

function kilobytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

type OptionValues = Readonly<Record<string, string | boolean | undefined>>;

/** A hosted bundle that was built and passed every local check. */
interface CheckedBundle {
  built: BuiltBundle;
  blocks: CheckedBlock[];
  bytes: number;
  /** The manifest's, esbuild's and the code checks' warnings. */
  warnings: string[];
  /** One line for people: what was built, and that it passes. */
  summary: string;
}

/**
 * Builds the Worker and holds it to the API's upload rules and the scan's
 * code checks: what deploy does before it signs in, and all --dry-run does.
 * BUNDLE_INVALID (exit 4) lists every problem.
 */
async function buildAndCheck(
  context: Context,
  values: OptionValues,
  loaded: LoadedManifest,
  manifest: AppManifest,
  manifestWarnings: readonly string[],
  rerun: string,
): Promise<CheckedBundle> {
  const allowedHosts =
    manifest.hosting.mode === 'tassyir' ? manifest.hosting.allowed_hosts : [];
  const blocks = await checkedBlocks(loaded, manifest, rerun);
  const built = await buildHostedBundle({
    cwd: context.io.cwd,
    root: dirname(loaded.path),
    entry: stringValue(values['entry']),
  });
  // A hosted app's block files are text modules of its bundle, at the
  // manifest's paths (Phase 2 §6.1); the bundle's rules count them too.
  built.bundle.files.push(...blocks.files);
  const rules = validateHostedBundle(built.bundle);
  const code = checkBundleCode(
    built.bundle.files,
    built.bundle.main,
    allowedHosts,
    (file, line, column) => built.locate(file, line, column),
  );
  const problems = [...(rules.ok ? [] : rules.errors), ...code.errors];
  if (problems.length > 0) throw bundleInvalid(built.entry, problems, rerun);
  const bytes = rules.ok ? rules.bytes : 0;
  const withBlocks =
    blocks.blocks.length > 0
      ? ` and ${String(blocks.files.length)} block file${blocks.files.length === 1 ? '' : 's'}`
      : '';
  return {
    built,
    blocks: blocks.blocks,
    bytes,
    warnings: [...manifestWarnings, ...built.warnings, ...code.warnings],
    summary: `Built ${built.entry} into ${BUNDLE_MAIN}${withBlocks} (${kilobytes(bytes)}${built.bundle.lockfile ? `, with ${built.bundle.lockfile.name}` : ', no lockfile'}); it passes the API's bundle rules and the scan's code checks`,
  };
}

/** Options that only matter once something is sent; ignored by --dry-run. */
function dryRunIgnored(values: OptionValues, warnings: string[]): void {
  for (const option of ['app', 'timeout']) {
    if (values[option] !== undefined) {
      warnings.push(
        `--${option} is not used by --dry-run (nothing is sent to Tassyir); ignored.`,
      );
    }
  }
}

/** deploy --dry-run, hosted: build and check, no sign-in, nothing sent. */
async function dryRunHosted(
  context: Context,
  values: OptionValues,
  loaded: LoadedManifest,
  manifest: AppManifest,
  manifestWarnings: readonly string[],
): Promise<CommandResult> {
  const checked = await buildAndCheck(
    context,
    values,
    loaded,
    manifest,
    manifestWarnings,
    'tassyir deploy --dry-run',
  );
  const { built, bytes, warnings } = checked;
  dryRunIgnored(values, warnings);
  return {
    data: {
      dryRun: true,
      uploaded: false,
      app: { handle: manifest.handle },
      hosting: 'tassyir',
      entry: built.entry,
      main: built.bundle.main,
      bytes,
      lockfile: built.bundle.lockfile?.name ?? null,
      blocks: checked.blocks,
      warnings,
      next: 'tassyir deploy',
    },
    text: lines(
      `✓ ${checked.summary}.`,
      blocksLine(checked.blocks),
      "  Nothing was uploaded (--dry-run). The scan's other checks run on Tassyir's side once `tassyir deploy` uploads it.",
      ...warnings.map((warning) => `  ! ${warning}`),
    ),
  };
}

/** deploy, for `hosting.mode = "tassyir"`: build, check, upload, follow. */
async function deployHosted(
  context: Context,
  values: OptionValues,
  loaded: LoadedManifest,
  manifest: AppManifest,
  manifestWarnings: readonly string[],
): Promise<CommandResult> {
  const timeout = timeoutSeconds(values['timeout'], 'deploy');
  const checked = await buildAndCheck(
    context,
    values,
    loaded,
    manifest,
    manifestWarnings,
    'tassyir deploy',
  );
  const { built, warnings } = checked;
  context.progress(`✓ ${checked.summary}.`);

  const { api } = await context.api();
  const app = await resolveApp(
    context,
    api,
    stringValue(values['app']) ?? manifest.handle,
    stringValue(values['manifest']),
  );
  const appRef = { id: app.id, handle: app.handle };
  let version: AppVersionDetail;
  let unchanged = false;
  try {
    version = (await api.uploadVersion(app.id, loaded.parsed, built.bundle))
      .data;
  } catch (error) {
    const latest = isCliError(error, 'APP_VERSION_UNCHANGED')
      ? error.details?.['version']
      : undefined;
    if (typeof latest !== 'number') {
      throw hostedUploadError(error, context.apiOrigin);
    }
    // Not a refusal: this manifest and bundle are the latest version, so
    // deploy answers by that version's state (a scan still running is
    // followed, a failed one stays failed).
    version = (await api.getVersion(app.id, latest)).data;
    unchanged = true;
  }
  return followAndAnswer(context, api, appRef, version, {
    unchanged,
    warnings,
    timeout,
  });
}

/** Follows a hosted version (unless `timeout` is 0), then answers by its state. */
async function followAndAnswer(
  context: Context,
  api: DeveloperApi,
  app: { id: string; handle: string },
  version: AppVersionDetail,
  options: { unchanged: boolean; warnings: readonly string[]; timeout: number },
): Promise<CommandResult> {
  const { unchanged, warnings, timeout } = options;
  if (timeout === 0) {
    return answerHostedVersion(version, {
      app,
      unchanged,
      warnings,
      stopped: 'not_waited',
    });
  }
  if (!isSettled(stageOf(version))) {
    // An agent whose own call times out still learns which version to check.
    context.emit({
      ok: true,
      step: 'uploaded',
      app,
      unchanged,
      version: {
        version: version.version,
        reviewState: version.reviewState,
        scan: version.hosting?.scan.status ?? null,
      },
      next: checkLaterCommand(app.handle, version.version),
    });
  }
  const followed = await followVersion(
    context,
    api,
    app.id,
    version,
    timeout * 1000,
  );
  return answerHostedVersion(followed.version, {
    app,
    unchanged,
    warnings,
    stopped: followed.stopped,
  });
}

/** An API before AP-B2.4 refuses `assets` as an unknown field (400, no code). */
function isAssetsRefusal(error: unknown): error is CliError {
  return (
    isCliError(error, 'BAD_REQUEST') &&
    error.status === 400 &&
    /\bassets\b/.test(error.message)
  );
}

export const deployCommand: Command = {
  name: 'deploy',
  summary: "Validate tassyir.app.toml and upload it as the app's new version",
  usage: 'tassyir deploy [options]',
  description: [
    'An app on your own server (hosting.mode = "external"): validates the manifest, then',
    'uploads it as a new version, current at once. The files of its [[storefront.blocks]]',
    '(templates and stylesheets) are checked as `tassyir validate` checks them and go up with',
    "it as the version's assets.",
    '',
    'An app on Tassyir Hosting (hosting.mode = "tassyir"): builds the bundle with esbuild',
    `(one ES module from --entry, default ${DEFAULT_ENTRIES.join(', ')}; HTML and CSS`,
    "imported as text), checks it by the API's bundle rules and the scan's code checks, and",
    "uploads it with the manifest, the block files (text modules at the manifest's paths) and",
    "the project's lockfile. Tassyir then scans it; deploy",
    'waits for the verdict (--timeout) and prints the findings. Ctrl-C stops waiting, never',
    'the scan: `tassyir app version <n> --follow` picks it up again. Exit 0 once released.',
    '',
    'Installations stay on their version until a member of the business accepts the update',
    '(with a consent screen when it adds scopes or hosts). The same manifest (and bundle) twice',
    "is not a new version: deploy answers `unchanged` and that version's state.",
    '',
    '--dry-run stops before signing in: the manifest checked and, for a hosted app, the bundle',
    'built and checked as above. Nothing is sent to Tassyir. Exit 0 when deploy would upload it,',
    '4 when it would refuse.',
  ].join('\n'),
  options: {
    manifest: {
      type: 'string',
      value: 'path',
      description: 'Default ./tassyir.app.toml.',
    },
    app: {
      type: 'string',
      value: 'handle|id',
      description: "Default: the manifest's handle.",
    },
    entry: {
      type: 'string',
      value: 'file',
      description: `Hosted: the module exporting the Worker's fetch handler. Default the first of ${DEFAULT_ENTRIES.join(', ')}.`,
    },
    timeout: TIMEOUT_OPTION,
    'dry-run': {
      type: 'boolean',
      description:
        'Check what would be uploaded (the manifest, and a hosted bundle built and checked), with no sign-in and nothing sent.',
    },
  },
  async run(context, { values }) {
    const dryRun = values['dry-run'] === true;
    const manifestFile = stringValue(values['manifest']);
    const loaded = await loadManifest(context.io.cwd, manifestFile);
    const check = checkManifest(loaded.parsed);
    if (!check.ok) throw manifestInvalid(loaded.display, check.errors);
    const warnings = warningsOf(check.manifest);
    if (check.manifest.hosting.mode === 'tassyir') {
      return dryRun
        ? dryRunHosted(context, values, loaded, check.manifest, warnings)
        : deployHosted(context, values, loaded, check.manifest, warnings);
    }
    for (const option of ['entry', 'timeout']) {
      if (values[option] !== undefined) {
        warnings.push(
          `--${option} is for an app on Tassyir Hosting (hosting.mode = "tassyir"); ignored.`,
        );
      }
    }
    const { blocks, files } = await checkedBlocks(
      loaded,
      check.manifest,
      dryRun ? 'tassyir deploy --dry-run' : 'tassyir deploy',
    );
    const assets: VersionAssets | undefined =
      files.length > 0 ? { files } : undefined;
    if (dryRun) {
      if (values['app'] !== undefined) {
        warnings.push(
          '--app is not used by --dry-run (nothing is sent to Tassyir); ignored.',
        );
      }
      return {
        data: {
          dryRun: true,
          uploaded: false,
          app: { handle: check.manifest.handle },
          hosting: 'external',
          manifest: check.manifest,
          blocks,
          assets: assets?.files.map((file) => file.path) ?? [],
          warnings,
          next: 'tassyir deploy',
        },
        text: lines(
          `✓ ${loaded.display} is valid: ${summary(check.manifest)}.`,
          blocksLine(blocks),
          '  Nothing was uploaded (--dry-run): `tassyir deploy` uploads it as the new version.',
          ...warnings.map((warning) => `  ! ${warning}`),
        ),
      };
    }

    const { api } = await context.api();
    const app = await resolveApp(
      context,
      api,
      stringValue(values['app']) ?? check.manifest.handle,
      manifestFile,
    );
    try {
      const version = (
        await api.uploadVersion(app.id, loaded.parsed, undefined, assets)
      ).data;
      return {
        data: {
          app: { id: app.id, handle: app.handle },
          unchanged: false,
          version,
          blocks,
          warnings,
        },
        text: lines(
          `✓ Deployed ${app.handle} version ${String(version.version)}${blocks.length > 0 ? ` with ${String(blocks.length)} storefront block${blocks.length === 1 ? '' : 's'}` : ''} (current: new installations get it).`,
          '  Installed businesses keep their version until a member accepts the update',
          '  (Apps → Installed apps → Update), with a consent screen when scopes or hosts were added.',
          ...warnings.map((warning) => `  ! ${warning}`),
        ),
      };
    } catch (error) {
      if (assets && isAssetsRefusal(error)) {
        throw new CliError({
          code: 'BLOCK_ASSETS_NOT_ACCEPTED',
          message: `${context.apiOrigin} does not take block files with a version yet (the "assets" field): storefront blocks are not open there`,
          fix: 'Deploy without [[storefront.blocks]] for now (the blocks pass `tassyir validate` and render with `tassyir block preview`), or deploy to an API where storefront blocks are open (--api-origin).',
          exitCode: EXIT_CODES.FAILED,
          ...(error.status === undefined ? {} : { status: error.status }),
          ...(error.requestId === undefined
            ? {}
            : { requestId: error.requestId }),
        });
      }
      if (!isCliError(error, 'APP_VERSION_UNCHANGED')) throw error;
      const current = error.details?.['version'];
      return {
        data: {
          app: { id: app.id, handle: app.handle },
          unchanged: true,
          version: { version: typeof current === 'number' ? current : null },
          warnings,
        },
        text: lines(
          `✓ Nothing to deploy: ${loaded.display} equals ${app.handle}'s latest version${typeof current === 'number' ? ` (${String(current)})` : ''}.`,
          ...warnings.map((warning) => `  ! ${warning}`),
        ),
      };
    }
  },
};

export const appVersionCommand: Command = {
  name: 'app version',
  summary:
    "One version of the app: its state, and a hosted one's scan and findings",
  usage: 'tassyir app version [number] [options]',
  description: [
    'Shows one version (default: the latest). For a version on Tassyir Hosting, the scan, every',
    'check with its findings, the AI review and the uploads, as the API reports them.',
    "--follow waits for a hosted version's verdict, as `tassyir deploy` does, and exits by it.",
  ].join('\n'),
  positionals: { min: 0, max: 1, names: '[number]' },
  options: {
    app: {
      type: 'string',
      value: 'handle|id',
      description: 'Default: the handle in ./tassyir.app.toml.',
    },
    follow: {
      type: 'boolean',
      description: 'Wait for a hosted version to be released or refused.',
    },
    timeout: TIMEOUT_OPTION,
  },
  async run(context, { values, positionals }) {
    const raw = positionals[0];
    if (raw !== undefined && !/^[1-9]\d{0,8}$/.test(raw)) {
      throw usageError(
        `app version takes a version number (1, 2, …), got ${raw}`,
        'app version',
      );
    }
    const timeout = timeoutSeconds(values['timeout'], 'app version');
    const { api } = await context.api();
    const app = await resolveApp(context, api, stringValue(values['app']));
    const appRef = { id: app.id, handle: app.handle };
    let number = raw === undefined ? undefined : Number(raw);
    if (number === undefined) {
      number = (await api.listVersions(app.id, { limit: 1 })).data[0]?.version;
      if (number === undefined) {
        throw new CliError({
          code: 'APP_VERSION_NOT_FOUND',
          message: `${app.handle} has no version yet`,
          fix: "Run `tassyir deploy` in the app's folder to upload its first version.",
          details: { appId: app.id },
        });
      }
    }
    const version = (await api.getVersion(app.id, number)).data;
    if (values['follow'] === true && version.hosting) {
      return followAndAnswer(context, api, appRef, version, {
        unchanged: false,
        warnings: [],
        timeout,
      });
    }
    const state = stageOf(version);
    return {
      data: { app: appRef, released: state === 'released', state, version },
      text: lines(
        `${app.handle} version ${String(version.version)}: ${progressLabel(version)}${version.current ? ', current (new installations get it)' : ''}.`,
        version.hosting
          ? null
          : `  On your own server; scopes: ${[...version.scopes, ...version.optionalScopes].join(', ') || 'none'}; webhooks: ${version.webhookTopics.join(', ') || 'none'}.`,
        ...hostingLines(version),
      ),
    };
  },
};
