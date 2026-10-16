import type { DeveloperApi } from './api.js';
import type { Context } from './command.js';
import type {
  ReviewCase,
  ReviewCheck,
  ReviewChecks,
  ReviewChecksRun,
} from './developer-types.js';
import { CliError, EXIT_CODES, isCliError } from './errors.js';
import type { CliProblem } from './errors.js';
import { FOLLOW_INTERVAL_MS } from './hosted-version.js';

// The marketplace review (AP-B2.2, docs/api/apps/review.md) as the CLI and
// dev-mcp read it: a submission is a review case that runs the automated
// checklist (`checking`, seconds to a minute), then waits for a person
// (`submitted`) or stops on a failed hard check (`checks_failed`). The dry
// run (`POST …/review-checks`) runs the same checklist without submitting.

/** How long `submit` and the dry run wait for the checklist by default. */
export const DEFAULT_CHECKS_TIMEOUT_SECONDS = 180;

/** Review case states that are still open. */
export const OPEN_STATES: readonly string[] = [
  'checking',
  'submitted',
  'in_review',
];

/** What each state means, in a few words. */
export const STATE_LABELS: Readonly<Record<string, string>> = {
  checking: 'the automated checks are running',
  checks_failed: 'a hard check failed: fix it and submit again',
  submitted: 'the checks passed; waiting for a reviewer',
  in_review: 'a reviewer is on it',
  approved: 'approved: the listing is live',
  changes_requested:
    'the reviewer asked for changes: make them and submit again',
  rejected: 'rejected',
  withdrawn: 'withdrawn by you',
  superseded: 'replaced by a newer submission or upload',
};

/** Why a person reviews a version (D10), in plain words. */
export const REASON_LABELS: Readonly<Record<string, string>> = {
  first_listing: 'a first listing',
  scopes_added: 'it asks for a new scope',
  hosts_added: 'it reaches a new host',
  storefront_code: 'its storefront blocks or app proxy changed',
  ai_hold: 'the AI review of the code asked for a person',
};

const STATUS_MARKS: Readonly<Record<string, string>> = {
  pass: '✓',
  fail: '✗',
  warning: '!',
  skipped: '-',
  error: '?',
};

/** One line per check, then its fix when it did not pass. */
export function checkLines(checks: ReviewChecks): string[] {
  return checks.results.flatMap((check) => [
    `  ${STATUS_MARKS[check.status] ?? '?'} ${check.key}${check.hard ? '' : ' (for the reviewer)'}: ${check.message}`,
    ...(check.status !== 'pass' && check.status !== 'skipped' && check.fix
      ? [`      Fix: ${check.fix}`]
      : []),
  ]);
}

/** The hard checks that failed, as problems (`error` is Tassyir's side, never yours). */
export function failedChecks(checks: ReviewChecks): CliProblem[] {
  return checks.results
    .filter((check) => check.hard && check.status === 'fail')
    .map((check: ReviewCheck) => ({
      code: check.key,
      path: check.key,
      message: check.message,
      fix:
        check.fix ??
        'Read the message, fix it, then run the checks again (`tassyir submit --checks-only`).',
    }));
}

/** Why following stopped before the thing settled. */
export type Stopped = 'timeout' | 'interrupted' | 'not_waited' | null;

/**
 * Reads `read()` every {@link FOLLOW_INTERVAL_MS} until `settled`, the
 * timeout, or Ctrl-C (which never stops the work on Tassyir's side). A
 * failure to reach the API meanwhile is retried until then.
 */
export async function follow<T>(
  context: Context,
  initial: T,
  options: {
    read: (signal: AbortSignal) => Promise<T>;
    settled: (value: T) => boolean;
    timeoutMs: number;
    label: (value: T) => string;
  },
): Promise<{ value: T; stopped: Stopped }> {
  const { io } = context;
  let value = initial;
  if (options.settled(value)) return { value, stopped: null };
  if (options.timeoutMs <= 0) return { value, stopped: 'not_waited' };
  const deadline = io.now() + options.timeoutMs;
  const stop = new AbortController();
  const off = io.onInterrupt?.(() => {
    stop.abort();
  });
  const interrupted = () => stop.signal.aborted;
  context.progress(
    `… ${options.label(value)} (Ctrl-C stops waiting; the checks go on)`,
  );
  let delay = FOLLOW_INTERVAL_MS;
  try {
    for (;;) {
      const left = deadline - io.now();
      if (interrupted()) return { value, stopped: 'interrupted' };
      if (left <= 0) return { value, stopped: 'timeout' };
      await io.sleep(Math.min(delay, left), stop.signal);
      if (interrupted()) return { value, stopped: 'interrupted' };
      try {
        value = await options.read(stop.signal);
        delay = FOLLOW_INTERVAL_MS;
      } catch (error) {
        if (interrupted()) return { value, stopped: 'interrupted' };
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
      if (options.settled(value)) return { value, stopped: null };
    }
  } finally {
    off?.();
  }
}

/** Runs the checklist's dry run and follows it to its verdict. */
export async function runChecks(
  context: Context,
  api: DeveloperApi,
  appId: string,
  timeoutMs: number,
): Promise<{ run: ReviewChecksRun; stopped: Stopped }> {
  const queued = (await api.runReviewChecks(appId)).data;
  const followed = await follow(context, queued, {
    read: async (signal) =>
      (await api.getReviewChecks(appId, queued.runId, signal)).data,
    settled: (run) => run.status === 'finished',
    timeoutMs,
    label: () => `review checks ${queued.runId}: queued`,
  });
  return { run: followed.value, stopped: followed.stopped };
}

/** Follows a case while its checklist runs (`checking`). */
export async function followCase(
  context: Context,
  api: DeveloperApi,
  review: ReviewCase,
  timeoutMs: number,
): Promise<{ review: ReviewCase; stopped: Stopped }> {
  const followed = await follow(context, review, {
    read: async (signal) =>
      (await api.getSubmission(review.appId, review.id, signal)).data,
    settled: (value) => value.state !== 'checking',
    timeoutMs,
    label: (value) =>
      `review ${value.id}: ${STATE_LABELS[value.state] ?? value.state}`,
  });
  return { review: followed.value, stopped: followed.stopped };
}

/** People's lines for a case: state, version, reasons, turnaround, notes, decision, checks. */
export function caseLines(review: ReviewCase): string[] {
  const reasons = review.reasons
    .map((reason) => REASON_LABELS[reason] ?? reason)
    .join('; ');
  return [
    `Review ${review.id} (${review.kind}${review.distribution ? `, ${review.distribution}` : ''}${review.version === null ? '' : `, version ${String(review.version)}`}): ${review.state}, ${STATE_LABELS[review.state] ?? ''}.`,
    ...(reasons ? [`  Why a person reviews it: ${reasons}.`] : []),
    ...(review.turnaround
      ? [
          `  Tassyir aims to decide within ${String(review.turnaround.workingDays)} working days (Sunday to Thursday): by ${review.turnaround.dueAt}.`,
        ]
      : []),
    ...(review.decision
      ? [
          `  The reviewer: ${review.decision.message ?? '(no message)'}`,
          ...review.decision.items.map(
            (item) => `    - ${item.key ?? 'note'}: ${item.note}`,
          ),
        ]
      : []),
    ...(review.checks
      ? [
          `  Checks (${review.checks.ranAt}): ${review.checks.passed ? 'every hard check passed' : 'a hard check failed'}.`,
          ...checkLines(review.checks),
        ]
      : []),
  ];
}

/** A case that stopped on a failed hard check, as a refusal (exit 1). */
export function checksFailed(review: ReviewCase): CliError {
  const problems = review.checks ? failedChecks(review.checks) : [];
  const first = problems[0];
  return new CliError({
    code: 'SUBMISSION_CHECKS_FAILED',
    message: `Review ${review.id} stopped: ${String(problems.length)} hard check${problems.length === 1 ? '' : 's'} failed${first ? `; the first: ${first.code}: ${first.message}` : ''}`,
    fix: `${first ? `${first.fix} ` : ''}Fix every check listed, run \`tassyir submit --checks-only\` to confirm, then \`tassyir submit\` again (a new review).`,
    exitCode: EXIT_CODES.FAILED,
    errors: problems,
    details: { reviewId: review.id, state: review.state },
  });
}

/** The checklist is still running when the CLI stopped waiting (exit 5). */
export function stillChecking(
  review: ReviewCase,
  stopped: Exclude<Stopped, null>,
  handle: string,
): CliError {
  return new CliError({
    code: 'SUBMISSION_CHECKING',
    message: `${stopped === 'interrupted' ? 'Stopped waiting' : stopped === 'not_waited' ? 'Submitted without waiting' : 'Waited the whole --timeout'}: review ${review.id} is still running its checks, and goes on`,
    fix: `Do not submit again (a new submission replaces this one): run \`tassyir submissions ${review.id} --app ${handle} --follow\` to see the verdict.`,
    exitCode: EXIT_CODES.TRY_LATER,
    details: { reviewId: review.id, state: review.state },
  });
}
