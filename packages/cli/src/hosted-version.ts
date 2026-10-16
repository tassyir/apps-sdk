import type { DeveloperApi } from './api.js';
import { lines } from './command.js';
import type { CommandResult, Context } from './command.js';
import type { AppVersion, AppVersionDetail } from './developer-types.js';
import { CliError, EXIT_CODES, isCliError } from './errors.js';
import type { CliProblem } from './errors.js';

// A hosted version after its upload (AP-B1.14, developer.md "Hosted
// versions"): the API scans it outside Tassyir, then uploads it to Workers
// for Platforms, staging then production (the release). `tassyir deploy` and
// `tassyir app version --follow` ask `GET developer/apps/:appId/versions/:n`
// until the version settles, then answer by its state.
//
//   reviewState  scanning ─► scan_failed | ready | in_review
//                ready ─► (staging, production) ─► approved

/** Where a version stands, as the CLI answers it. */
export type VersionStage =
  /** The scan has not ended (`pending`, `dispatched`). */
  | 'scanning'
  /** The scan passed; the uploads to Cloudflare are under way. */
  | 'deploying'
  /** Approved: released (a hosted one is on Workers for Platforms). */
  | 'released'
  /** The checks passed and the AI review asked for a person at Tassyir. */
  | 'in_review'
  | 'rejected'
  /** The scan found problems in the code. */
  | 'scan_failed'
  /** The scan ended without a verdict: the same bundle may go again. */
  | 'scan_error'
  /** The scan passed, an upload to Cloudflare failed. */
  | 'deploy_failed'
  /** Any other state (`draft`, `retired`). */
  | 'other';

type Hosting = NonNullable<AppVersion['hosting']>;
type DetailHosting = NonNullable<AppVersionDetail['hosting']>;
type ScanCheck = DetailHosting['checks'][number];

export function stageOf(version: AppVersion): VersionStage {
  const hosting = version.hosting;
  switch (version.reviewState) {
    case 'approved':
      return 'released';
    case 'rejected':
      return 'rejected';
    case 'in_review':
      return 'in_review';
    case 'scanning':
      return 'scanning';
    case 'scan_failed':
      return hosting?.scan.status === 'error' ||
        hosting?.scan.status === 'timed_out'
        ? 'scan_error'
        : 'scan_failed';
    case 'ready':
      return hosting?.deploy.staging.status === 'failed' ||
        hosting?.deploy.production.status === 'failed'
        ? 'deploy_failed'
        : 'deploying';
    default:
      return 'other';
  }
}

/** False while the scan or the uploads are still running. */
export function isSettled(stage: VersionStage): boolean {
  return stage !== 'scanning' && stage !== 'deploying';
}

/** One line on where the pipeline is: what `--follow` prints when it changes. */
export function progressLabel(version: AppVersion): string {
  const hosting = version.hosting;
  const stage = stageOf(version);
  if (!hosting) return version.reviewState;
  if (stage === 'scanning') return `scan ${hosting.scan.status}`;
  if (stage === 'deploying') {
    const { staging, production } = hosting.deploy;
    if (staging.status !== 'deployed')
      return 'scan passed, uploading to staging';
    return production.status === 'deployed'
      ? 'uploaded, releasing'
      : 'scan passed, uploading to production';
  }
  return `${version.reviewState} (scan ${hosting.scan.status})`;
}

function kilobytes(bytes: number): string {
  return bytes < 1024
    ? `${String(bytes)} B`
    : `${(bytes / 1024).toFixed(1)} KB`;
}

function findingLine(finding: ScanCheck['findings'][number]): string {
  const place = finding.file
    ? ` ${finding.file}${finding.line === null ? '' : `:${String(finding.line)}`}`
    : '';
  return `${finding.severity} ${finding.rule}${place}: ${finding.message}`;
}

function checksOf(hosting: Hosting): ScanCheck[] {
  return 'checks' in hosting ? (hosting as DetailHosting).checks : [];
}

function reviewOf(hosting: Hosting): DetailHosting['review'] {
  return 'review' in hosting ? (hosting as DetailHosting).review : null;
}

function rejectionOf(hosting: Hosting | null): string | null {
  return hosting && 'rejectionReason' in hosting
    ? (hosting as DetailHosting).rejectionReason
    : null;
}

/** The hosting record, readably: the bundle, the scan, each check, the review, the uploads. */
export function hostingLines(version: AppVersion): string[] {
  const hosting = version.hosting;
  if (!hosting) return [];
  const out: string[] = [];
  out.push(
    `  Bundle: ${String(hosting.files)} module${hosting.files === 1 ? '' : 's'} (${hosting.main}), ${kilobytes(hosting.bundleBytes)}, ${hosting.lockfile ? `lockfile ${hosting.lockfile}` : 'no lockfile'}${hosting.bundleSha256 ? `, sha256 ${hosting.bundleSha256.slice(0, 12)}` : ''}`,
  );
  const scan = hosting.scan;
  out.push(
    `  Scan: ${scan.status}${scan.failureCode ? ` (${scan.failureCode})` : ''}${scan.reasons.length > 0 ? `: ${scan.reasons.join(', ')}` : ''}`,
  );
  const checks = checksOf(hosting);
  const quiet = checks.filter(
    (check) => check.status === 'pass' && check.findings.length === 0,
  );
  if (quiet.length > 0) {
    out.push(`  Passed: ${quiet.map((check) => check.id).join(', ')}`);
  }
  for (const check of checks) {
    if (quiet.includes(check)) continue;
    const mark =
      check.status === 'fail' || check.status === 'error'
        ? '✗'
        : check.status === 'pass'
          ? '✓'
          : '!';
    out.push(
      `  ${mark} ${check.id} (${check.status})${check.summary ? `: ${check.summary}` : ''}`,
    );
    for (const finding of check.findings) {
      out.push(`      ${findingLine(finding)}`);
    }
    if (check.truncated)
      out.push('      … more findings than the scan reports');
  }
  const review = reviewOf(hosting);
  if (review) {
    out.push(
      `  Review: ${review.status}${review.model ? ` (${review.model})` : ''}${review.summary ? `: ${review.summary}` : ''}`,
    );
    for (const concern of review.concerns) {
      out.push(
        `      ${concern.severity}${concern.file ? ` ${concern.file}` : ''}: ${concern.message}`,
      );
    }
  }
  const { staging, production } = hosting.deploy;
  if (staging.status !== 'none' || production.status !== 'none') {
    const upload = (name: string, state: typeof staging) =>
      `${name} ${state.status}${state.errorCode ? ` (${state.errorCode})` : ''}`;
    out.push(
      `  Uploads: ${upload('staging', staging)}, ${upload('production', production)}`,
    );
    for (const [name, state] of [
      ['staging', staging],
      ['production', production],
    ] as const) {
      const refusal = refusalText(state.refusal);
      if (refusal) out.push(`      Cloudflare (${name}): ${refusal}`);
    }
  }
  const rejection = rejectionOf(hosting);
  if (rejection) out.push(`  Rejected: ${rejection}`);
  return out;
}

// ── Following ──────────────────────────────────────────────────────────────

/** How often the CLI asks while it follows. */
export const FOLLOW_INTERVAL_MS = 10_000;
/** The default `--timeout`: the API gives a scan 30 minutes. */
export const DEFAULT_FOLLOW_TIMEOUT_SECONDS = 1800;

export interface FollowResult {
  version: AppVersionDetail;
  stage: VersionStage;
  /** Why it stopped before the version settled. */
  stopped: 'timeout' | 'interrupted' | null;
}

/**
 * Asks for the version every {@link FOLLOW_INTERVAL_MS} until it settles,
 * `timeoutMs` passes or the person presses Ctrl-C (which never stops the
 * scan). A failure to reach the API while following is retried until then.
 */
export async function followVersion(
  context: Context,
  api: DeveloperApi,
  appId: string,
  initial: AppVersionDetail,
  timeoutMs: number,
): Promise<FollowResult> {
  const { io } = context;
  let version = initial;
  let stage = stageOf(version);
  if (isSettled(stage)) return { version, stage, stopped: null };
  const deadline = io.now() + timeoutMs;
  const stop = new AbortController();
  const interrupted = () => stop.signal.aborted;
  const off = io.onInterrupt?.(() => {
    stop.abort();
  });
  let label = progressLabel(version);
  context.progress(
    `… version ${String(version.version)}: ${label} (Ctrl-C stops waiting; the scan goes on)`,
  );
  let delay = FOLLOW_INTERVAL_MS;
  try {
    for (;;) {
      const left = deadline - io.now();
      if (interrupted()) return { version, stage, stopped: 'interrupted' };
      if (left <= 0) return { version, stage, stopped: 'timeout' };
      await io.sleep(Math.min(delay, left), stop.signal);
      // Ctrl-C may have come during the wait.
      if (interrupted()) return { version, stage, stopped: 'interrupted' };
      try {
        // Ctrl-C also stops a read that is still waiting on the API.
        version = (await api.getVersion(appId, version.version, stop.signal))
          .data;
        delay = FOLLOW_INTERVAL_MS;
      } catch (error) {
        if (interrupted()) return { version, stage, stopped: 'interrupted' };
        if (!isCliError(error) || error.exitCode !== EXIT_CODES.TRY_LATER) {
          throw error;
        }
        delay = Math.max(
          FOLLOW_INTERVAL_MS,
          (error.retryAfterSeconds ?? 0) * 1000,
        );
        context.progress(
          `  ${error.code}: asking again in ${String(Math.round(delay / 1000))} s`,
        );
        continue;
      }
      stage = stageOf(version);
      const next = progressLabel(version);
      if (next !== label) {
        label = next;
        context.progress(`… version ${String(version.version)}: ${label}`);
      }
      if (isSettled(stage)) return { version, stage, stopped: null };
    }
  } finally {
    off?.();
  }
}

// ── Answering by the state ─────────────────────────────────────────────────

/** What each check's failure asks of the developer. */
const CHECK_FIXES: Readonly<Record<string, string>> = {
  bundle:
    'The scan could not read the bundle: run `tassyir deploy` again to upload a new copy.',
  size: 'Make the bundle smaller: at most 100 modules and 3 MB.',
  unicode:
    'Remove the invisible or bidirectional characters the finding names (pasted text is the usual source).',
  banned_apis:
    'Remove what the finding names: code built from strings, an import() of a run-time name or a URL, cloudflare:sockets, an import outside the bundle.',
  manifest_scopes:
    'Request the scope the call needs in access.scopes (or optional_scopes) of tassyir.app.toml, or remove the call.',
  manifest_hosts:
    'Add the host to hosting.allowed_hosts, call Tassyir through ctx.props.TASSYIR, and use https.',
  semgrep: 'Change the code the rule names.',
  gitleaks:
    'Remove the secret from the code, and revoke it where it was issued.',
  osv: 'Update or remove the package the finding names (npm update, npm audit), then deploy again.',
};

const REVIEW_FIX =
  "Read the review's summary and concerns, change the code so it does what the manifest says and nothing else, then run `tassyir deploy` again.";

/** A failed scan's findings as problems: each error of a failed check, then the review's concerns. */
export function scanProblems(version: AppVersion): CliProblem[] {
  const hosting = version.hosting;
  if (!hosting) return [];
  const problems: CliProblem[] = [];
  for (const check of checksOf(hosting)) {
    if (check.status !== 'fail' && check.status !== 'error') continue;
    const fix =
      CHECK_FIXES[check.id] ?? 'Fix what the finding names, then deploy again.';
    const errors = check.findings.filter((f) => f.severity === 'error');
    if (errors.length === 0) {
      problems.push({
        code: check.id,
        path: '',
        message: `${check.id} ${check.status}${check.summary ? `: ${check.summary}` : ''}`,
        fix,
      });
    }
    for (const finding of errors) {
      problems.push({
        code: finding.rule,
        path: finding.file
          ? `${finding.file}${finding.line === null ? '' : `:${String(finding.line)}`}`
          : '',
        message: `${check.id}: ${finding.message}`,
        fix,
      });
    }
  }
  const review = reviewOf(hosting);
  if (review?.status === 'fail') {
    if (review.concerns.length === 0) {
      problems.push({
        code: 'review',
        path: '',
        message: review.summary || 'The AI review failed the version',
        fix: REVIEW_FIX,
      });
    }
    for (const concern of review.concerns) {
      problems.push({
        code: 'review',
        path: concern.file ?? '',
        message: `${concern.severity}: ${concern.message}`,
        fix: REVIEW_FIX,
      });
    }
  }
  return problems;
}

/** What to run to see a version again. */
export function checkLaterCommand(handle: string, version: number): string {
  return `tassyir app version ${String(version)} --follow --app ${handle}`;
}

type DeployRefusal = Hosting['deploy']['staging']['refusal'];

/**
 * What Cloudflare answered when it refused an upload (AP-B1.23): its code and
 * its message, which the API cleaned of anything that is not the app's.
 * `undefined` from an API older than the field.
 */
export function refusalText(refusal: DeployRefusal | undefined): string | null {
  if (!refusal) return null;
  const code = refusal.code === null ? null : String(refusal.code);
  const message = refusal.message?.trim() ? refusal.message.trim() : null;
  if (code && message) return `${code}: ${message}`;
  return code ?? message;
}

/** Why an upload to Cloudflare failed, and what the developer can do. */
const DEPLOY_FIXES: Readonly<Record<string, string>> = {
  CLOUDFLARE_REJECTED:
    'Cloudflare refused the Worker after the scan passed: fix what its answer in the message names (10021: the Worker failed to start; check that the entry exports fetch and imports only what the bundle holds), then deploy a new version; if it still fails, tell Tassyir the app and the version.',
};

export interface AnswerOptions {
  app: { id: string; handle: string };
  unchanged: boolean;
  warnings: readonly string[];
  stopped: FollowResult['stopped'] | 'not_waited';
}

/**
 * The command's answer for a hosted version: a result when it is released,
 * held for a person, or not waited for; a refusal otherwise, each with what
 * to do next.
 */
export function answerHostedVersion(
  version: AppVersionDetail,
  options: AnswerOptions,
): CommandResult {
  const { app, unchanged, warnings } = options;
  const stage = stageOf(version);
  const n = String(version.version);
  const later = checkLaterCommand(app.handle, version.version);
  const details = { app, unchanged, version };
  const report = hostingLines(version);
  const warningLines = warnings.map((warning) => `  ! ${warning}`);

  if (!isSettled(stage)) {
    if (options.stopped === 'not_waited') {
      return {
        data: {
          app,
          unchanged,
          released: false,
          state: stage,
          version,
          next: later,
          warnings,
        },
        text: lines(
          `✓ Uploaded ${app.handle} version ${n} to Tassyir Hosting: ${progressLabel(version)}.`,
          ...report,
          `  Its scan goes on: \`${later}\` waits for the verdict.`,
          ...warningLines,
        ),
      };
    }
    throw new CliError({
      code: 'VERSION_IN_PROGRESS',
      message: `${options.stopped === 'interrupted' ? 'Stopped waiting' : 'Waited the whole --timeout'}: ${app.handle} version ${n} is still at "${progressLabel(version)}", and its scan goes on`,
      fix: `Check it later: \`${later}\`.`,
      exitCode: EXIT_CODES.TRY_LATER,
      details,
    });
  }

  switch (stage) {
    case 'released':
      return {
        data: {
          app,
          unchanged,
          released: true,
          state: stage,
          version,
          warnings,
        },
        text: lines(
          unchanged
            ? `✓ Nothing to deploy: ${app.handle}'s latest version (${n}) has this manifest and bundle, and it is released.`
            : `✓ ${app.handle} version ${n} passed its scan and is released on Tassyir Hosting${version.current ? ' (current: new installations get it)' : ''}.`,
          ...report,
          ...(unchanged
            ? []
            : [
                '  Installed businesses keep their version until a member accepts the update',
                '  (Apps → Installed apps → Update), with a consent screen when scopes or hosts were added.',
              ]),
          ...warningLines,
        ),
      };
    case 'in_review':
      return {
        data: {
          app,
          unchanged,
          released: false,
          state: stage,
          version,
          next: later,
          warnings,
        },
        text: lines(
          `⏸ ${app.handle} version ${n} passed its checks, and the AI review asked a person at Tassyir to look at it: it is released once they approve it.`,
          ...report,
          `  \`${later}\` waits for that decision.`,
          ...warningLines,
        ),
      };
    case 'scan_failed': {
      const problems = scanProblems(version);
      const first = problems[0];
      const reasons = version.hosting?.scan.reasons ?? [];
      throw new CliError({
        code: 'VERSION_SCAN_FAILED',
        message: `${app.handle} version ${n} failed its scan${reasons.length > 0 ? ` (${reasons.join(', ')})` : ''}${unchanged ? '; this manifest and bundle are that version, unchanged' : ''}`,
        fix: `${first ? `${first.fix} ` : ''}Fix ${problems.length > 1 ? 'every finding listed' : 'it'}, then run \`tassyir deploy\` again: a new bundle is a new version.`,
        errors: problems,
        details,
      });
    }
    case 'scan_error': {
      const code = version.hosting?.scan.failureCode ?? 'SCAN_INCOMPLETE';
      throw new CliError({
        code,
        message: `The scan of ${app.handle} version ${n} ended without a verdict (${code}): nothing was decided about the code`,
        fix: 'Upload the same bundle again: run `tassyir deploy` (an unchanged bundle whose scan broke is scanned again).',
        exitCode: EXIT_CODES.TRY_LATER,
        details,
      });
    }
    case 'deploy_failed': {
      const deploy = version.hosting?.deploy;
      const failed =
        deploy?.staging.status === 'failed' ? 'staging' : 'production';
      const code = deploy?.[failed].errorCode ?? 'CLOUDFLARE_UNAVAILABLE';
      const refusal = refusalText(deploy?.[failed].refusal);
      throw new CliError({
        code,
        message: `${app.handle} version ${n} passed its scan, but its upload to Cloudflare (${failed}) failed: ${code}${refusal ? `. Cloudflare answered ${refusal}` : ''}`,
        fix:
          DEPLOY_FIXES[code] ??
          `Tassyir could not upload the version: tell Tassyir the app (${app.handle}) and the version (${n}); a Tassyir admin can release it again.`,
        details,
      });
    }
    case 'rejected': {
      const reason = rejectionOf(version.hosting);
      throw new CliError({
        code: 'VERSION_REJECTED',
        message: `A person at Tassyir rejected ${app.handle} version ${n}${reason ? `: ${reason}` : ''}`,
        fix: 'Change the app as the reason says, then run `tassyir deploy` again for a new version.',
        details,
      });
    }
    default:
      return {
        data: {
          app,
          unchanged,
          released: false,
          state: version.reviewState,
          version,
          warnings,
        },
        text: lines(
          `${app.handle} version ${n} is ${version.reviewState}.`,
          ...report,
          ...warningLines,
        ),
      };
  }
}
