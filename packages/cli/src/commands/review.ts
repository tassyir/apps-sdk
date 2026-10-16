import { cell, lines, resolveApp, stringValue, table } from '../command.js';
import type { Command, CommandResult, OptionSpec } from '../command.js';
import type { DeveloperApp, ReviewCase } from '../developer-types.js';
import { CliError, EXIT_CODES, isCliError, usageError } from '../errors.js';
import {
  caseLines,
  checkLines,
  checksFailed,
  DEFAULT_CHECKS_TIMEOUT_SECONDS,
  failedChecks,
  followCase,
  runChecks,
  STATE_LABELS,
  stillChecking,
} from '../review.js';

// `tassyir submit` (a listing review: the draft listing and the latest
// version, the checklist followed to its verdict; --checks-only runs the
// same checklist as a dry run, without submitting) and `tassyir
// submissions` (the app's review cases, or one followed). AP-B2.2's routes.

const CONSOLE = 'https://app.tassyir.io/en/developers';

const APP_OPTION: OptionSpec = {
  type: 'string',
  value: 'handle|id',
  description: 'Default: the handle in ./tassyir.app.toml.',
};

function timeoutOption(what: string): OptionSpec {
  return {
    type: 'string',
    value: 'seconds',
    description: `How long to wait for ${what}. Default ${String(DEFAULT_CHECKS_TIMEOUT_SECONDS)}; 0 answers at once.`,
  };
}

function timeoutMs(value: string | boolean | undefined, command: string) {
  if (value === undefined) return DEFAULT_CHECKS_TIMEOUT_SECONDS * 1000;
  if (typeof value === 'string' && /^\d{1,6}$/.test(value)) {
    return Number(value) * 1000;
  }
  throw usageError(
    `--timeout takes whole seconds (0 answers at once), got ${String(value)}`,
    command,
  );
}

/** A refusal of the review routes, with what to do from the CLI. */
function reviewError(error: unknown): unknown {
  if (!isCliError(error)) return error;
  if (error.code === 'DEVELOPER_TERMS_REQUIRED') {
    const version = error.details?.['termsVersion'];
    return new CliError({
      code: error.code,
      message: error.message,
      fix: `Read and accept the developer terms${typeof version === 'string' ? ` (version ${version})` : ''} in the developer console (${CONSOLE}): accepting them is yours to do, not the CLI's. Then run \`tassyir submit\` again.`,
      exitCode: error.exitCode,
      ...(error.status === undefined ? {} : { status: error.status }),
      ...(error.requestId === undefined ? {} : { requestId: error.requestId }),
      ...(error.details === undefined ? {} : { details: error.details }),
    });
  }
  return error;
}

/** `--checks-only`: the dry run, answered by its verdict. */
async function checksOnly(
  context: Parameters<Command['run']>[0],
  app: DeveloperApp,
  timeout: number,
): Promise<CommandResult> {
  const { api } = await context.api();
  const appRef = { id: app.id, handle: app.handle };
  const { run, stopped } = await runChecks(context, api, app.id, timeout);
  if (run.status !== 'finished' || !run.checks) {
    if (stopped === 'not_waited') {
      return {
        data: { app: appRef, submitted: false, run, next: null },
        text: lines(
          `✓ Review checks ${run.runId} queued for ${app.handle} (not waited for; kept 24 hours).`,
        ),
      };
    }
    throw new CliError({
      code: 'REVIEW_CHECKS_RUNNING',
      message: `${stopped === 'interrupted' ? 'Stopped waiting' : 'Waited the whole --timeout'}: review checks ${run.runId} are still queued`,
      fix: 'Run `tassyir submit --checks-only` again in a few minutes (5 runs per app per hour).',
      exitCode: EXIT_CODES.TRY_LATER,
      details: { runId: run.runId },
    });
  }
  const checks = run.checks;
  const problems = failedChecks(checks);
  if (problems.length > 0) {
    const first = problems[0];
    throw new CliError({
      code: 'REVIEW_CHECKS_FAILED',
      message: `${String(problems.length)} hard check${problems.length === 1 ? '' : 's'} of the review would fail${first ? `; the first: ${first.code}: ${first.message}` : ''}. Nothing was submitted`,
      fix: `${first ? `${first.fix} ` : ''}Fix every check listed, then run \`tassyir submit --checks-only\` again.`,
      exitCode: EXIT_CODES.FAILED,
      errors: problems,
      details: { runId: run.runId, checks: checks.results },
    });
  }
  return {
    data: { app: appRef, submitted: false, run, next: 'tassyir submit' },
    text: lines(
      `✓ Every hard check of the review passes for ${app.handle} (a dry run: nothing was submitted).`,
      ...checkLines(checks),
      '  Submit with `tassyir submit --distribution public` (or unlisted).',
    ),
  };
}

export const submitCommand: Command = {
  name: 'submit',
  summary: 'Submit the app to the marketplace review (public or unlisted)',
  usage: 'tassyir submit --distribution <public|unlisted> [options]',
  description: [
    "Sends the draft listing and the latest version to Tassyir's review. The automated",
    'checklist runs first (listing complete, privacy policy reachable, support and emergency',
    'contacts, terms accepted, the version releasable, the compliance topics, webhooks that',
    'refuse a forged signature, the admin page framing, blocks, API version); submit waits',
    'for it (--timeout) and prints each check with its fix. Exit 0 once the review waits for',
    'a person, 1 when a hard check failed. A new submission replaces an open one.',
    '',
    'Before sending, submit reads the draft listing and refuses while anything is missing',
    '(`tassyir listing pull` lists it). The developer terms are accepted in the developer',
    'console, never by the CLI.',
    '',
    '--checks-only runs the same checklist as a dry run without submitting. It fetches your',
    'privacy policy and admin page and sends test webhooks (one signed, one forged) to your',
    'endpoints, so it is limited to 5 runs per app per hour.',
    '',
    'Custom apps (one business) need no review: this is for the marketplace.',
  ].join('\n'),
  options: {
    app: APP_OPTION,
    distribution: {
      type: 'string',
      value: 'public|unlisted',
      description:
        'public: browsed and searched in the marketplace. unlisted: installed from its link only.',
    },
    note: {
      type: 'string',
      value: 'text',
      description:
        'For the reviewer (1 to 2,000 characters): test steps, a demo account on your service.',
    },
    'checks-only': {
      type: 'boolean',
      description: 'Run the review checklist without submitting.',
    },
    timeout: timeoutOption('the checklist'),
  },
  async run(context, { values }) {
    const timeout = timeoutMs(values['timeout'], 'submit');
    const distribution = stringValue(values['distribution']);
    const note = stringValue(values['note']);
    if (values['checks-only'] === true) {
      for (const option of ['distribution', 'note']) {
        if (values[option] !== undefined) {
          throw usageError(
            `--${option} is for a submission; --checks-only submits nothing`,
            'submit',
          );
        }
      }
      const { api } = await context.api();
      const app = await resolveApp(context, api, stringValue(values['app']));
      try {
        return await checksOnly(context, app, timeout);
      } catch (error) {
        throw reviewError(error);
      }
    }
    if (distribution !== 'public' && distribution !== 'unlisted') {
      throw usageError(
        distribution === undefined
          ? 'submit needs --distribution public (browsed and searched) or unlisted (installed from its link)'
          : `--distribution takes public or unlisted, got ${distribution}`,
        'submit',
      );
    }
    if (note !== undefined && (note.trim() === '' || note.length > 2000)) {
      throw usageError(
        '--note takes 1 to 2,000 characters of plain text',
        'submit',
      );
    }
    const { api } = await context.api();
    const app = await resolveApp(context, api, stringValue(values['app']));
    const appRef = { id: app.id, handle: app.handle };

    const listing = (await api.getListing(app.id)).data;
    if (listing.issues.length > 0) {
      const first = listing.issues[0];
      throw new CliError({
        code: 'LISTING_INCOMPLETE',
        message: `The draft listing of ${app.handle} still needs ${String(listing.issues.length)} thing${listing.issues.length === 1 ? '' : 's'}${first ? `; the first: ${first.path}: ${first.message}` : ''}. Nothing was submitted`,
        fix: `${first ? `${first.fix} ` : ''}Edit the draft (\`tassyir listing pull\`, then \`tassyir listing push\`; images in the developer console), then submit again.`,
        exitCode: EXIT_CODES.FAILED,
        errors: listing.issues,
      });
    }

    let review: ReviewCase;
    try {
      review = (
        await api.submit(app.id, {
          distribution,
          ...(note === undefined ? {} : { note }),
        })
      ).data;
    } catch (error) {
      throw reviewError(error);
    }
    context.emit({
      ok: true,
      step: 'submitted',
      app: appRef,
      review: { id: review.id, state: review.state },
      next: `tassyir submissions ${review.id} --app ${app.handle} --follow`,
    });
    const followed = await followCase(context, api, review, timeout);
    review = followed.review;
    if (review.state === 'checking') {
      if (followed.stopped === 'not_waited') {
        return {
          data: {
            app: appRef,
            submitted: true,
            review,
            next: `tassyir submissions ${review.id} --follow`,
          },
          text: lines(
            `✓ Submitted ${app.handle} (review ${review.id}); its checks are running.`,
            `  \`tassyir submissions ${review.id} --follow\` shows the verdict.`,
          ),
        };
      }
      throw stillChecking(review, followed.stopped ?? 'timeout', app.handle);
    }
    if (review.state === 'checks_failed') throw checksFailed(review);
    return {
      data: { app: appRef, submitted: true, review },
      text: lines(
        `✓ Submitted ${app.handle} for ${distribution} distribution.`,
        ...caseLines(review),
        '  You get an email when it is decided; `tassyir submissions` shows where it stands.',
      ),
    };
  },
};

export const submissionsCommand: Command = {
  name: 'submissions',
  summary: "The app's marketplace reviews, or one with its checks and decision",
  usage: 'tassyir submissions [review id] [options]',
  description: [
    'Without an id: the review cases, newest first (your submissions, and the reviews a new',
    'version of a listed app opened by itself). With an id: its state, why a person reviews',
    "it, the turnaround Tassyir aims at, each check with its fix, and the reviewer's",
    'decision. --follow waits while its checks run, then exits as `tassyir submit` does.',
  ].join('\n'),
  positionals: { min: 0, max: 1, names: '[review id]' },
  options: {
    app: APP_OPTION,
    follow: {
      type: 'boolean',
      description: 'Wait while the checks run (needs an id).',
    },
    timeout: timeoutOption('the checks'),
  },
  async run(context, { values, positionals }) {
    const id = positionals[0];
    if (id !== undefined && !/^\d{1,20}$/.test(id)) {
      throw usageError(
        `submissions takes a review id (digits), got ${id}`,
        'submissions',
      );
    }
    if (values['follow'] === true && id === undefined) {
      throw usageError('--follow needs a review id', 'submissions');
    }
    const timeout = timeoutMs(values['timeout'], 'submissions');
    const { api } = await context.api();
    const app = await resolveApp(context, api, stringValue(values['app']));
    const appRef = { id: app.id, handle: app.handle };
    if (id === undefined) {
      const page = await api.listSubmissions(app.id, { limit: 20 });
      return {
        data: { app: appRef, reviews: page.data, nextCursor: page.nextCursor },
        text:
          page.data.length === 0
            ? lines(
                `${app.handle} has no review yet: \`tassyir submit --distribution public\` starts one.`,
              )
            : lines(
                table(
                  ['ID', 'KIND', 'STATE', 'VERSION', 'SUBMITTED', 'DUE'],
                  page.data.map((review) => [
                    review.id,
                    review.kind,
                    review.state,
                    cell(review.version),
                    review.submittedAt,
                    cell(review.turnaround?.dueAt),
                  ]),
                ),
              ),
      };
    }
    let review = (await api.getSubmission(app.id, id)).data;
    if (values['follow'] === true) {
      const followed = await followCase(context, api, review, timeout);
      review = followed.review;
      if (review.state === 'checking' && followed.stopped !== null) {
        throw stillChecking(review, followed.stopped, app.handle);
      }
      if (review.state === 'checks_failed') throw checksFailed(review);
    }
    return {
      data: {
        app: appRef,
        review,
        open: ['checking', 'submitted', 'in_review'].includes(review.state),
      },
      text: lines(
        ...caseLines(review),
        ...(review.notes.length > 0
          ? [
              '  Your notes:',
              ...review.notes.map((note) => `    ${note.at}: ${note.text}`),
            ]
          : []),
        review.state === 'checking'
          ? `  ${STATE_LABELS['checking'] ?? ''}: \`tassyir submissions ${review.id} --follow\`.`
          : null,
      ),
    };
  },
};
