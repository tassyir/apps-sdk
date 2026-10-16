import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupHarnesses, createHarness } from './cli.test-helpers.js';
import type { Harness } from './cli.test-helpers.js';
import { passingReviewChecks } from './fake-api.test-helpers.js';

// The marketplace in the CLI (AP-K2.3): `tassyir listing pull|push` (AP-B2.1's
// draft listing as a file), `tassyir submit` (AP-B2.2's listing review,
// followed through its checklist; --checks-only, the dry run) and `tassyir
// submissions`. On the fake developer API, every request and answer held to
// the vendored OpenAPI document.

afterEach(cleanupHarnesses);

/** Signed in, one app, `--app` not needed: the manifest names it. */
async function signedIn(): Promise<Harness> {
  const harness = await createHarness();
  await harness.signIn();
  harness.fake.seedApp();
  await writeFile(
    join(harness.cwd, 'tassyir.app.toml'),
    'name = "Review Requests"\nhandle = "review-requests"\n',
  );
  return harness;
}

function appOf(harness: Harness) {
  const app = harness.fake.apps[0];
  if (!app) throw new Error('no app');
  return app;
}

function requests(harness: Harness, method: string, path: RegExp) {
  return harness.fake.requests.filter(
    (request) => request.method === method && path.test(request.path),
  );
}

describe('tassyir listing pull', () => {
  it('writes the draft to tassyir.listing.json and says what it still needs', async () => {
    const harness = await signedIn();
    const result = await harness.run('listing', 'pull', '--json');
    expect(result.code).toBe(0);
    const answer = result.json();
    expect(answer).toMatchObject({
      ok: true,
      app: { handle: 'review-requests' },
      file: 'tassyir.listing.json',
      distribution: 'custom',
      draftUpdatedAt: null,
      live: false,
      media: [],
    });
    const issues = answer['issues'] as { code: string; path: string }[];
    expect(issues.map((issue) => issue.path)).toContain('tagline.ar');
    const file = JSON.parse(
      await readFile(join(harness.cwd, 'tassyir.listing.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(file['name']).toEqual({
      ar: 'Review Requests',
      en: 'Review Requests',
    });
    expect(Object.keys(file)).toEqual([
      'name',
      'tagline',
      'description',
      'features',
      'category',
      'searchTerms',
      'iconMediaId',
      'screenshots',
      'supportUrl',
      'privacyPolicyUrl',
      'externalService',
      'languages',
    ]);
  });

  it('never overwrites the file without --force', async () => {
    const harness = await signedIn();
    await writeFile(join(harness.cwd, 'tassyir.listing.json'), '{"mine":1}');
    const refused = await harness.run('listing', 'pull', '--json');
    expect(refused.code).toBe(1);
    expect(refused.json()['error']).toMatchObject({
      code: 'LISTING_FILE_EXISTS',
      fix: expect.stringContaining('--force') as string,
    });
    expect(
      await readFile(join(harness.cwd, 'tassyir.listing.json'), 'utf8'),
    ).toBe('{"mine":1}');
    const forced = await harness.run('listing', 'pull', '--force');
    expect(forced.code).toBe(0);
    expect(forced.stdout).toContain('✓ Wrote tassyir.listing.json');
    expect(forced.stdout).toContain('No images yet');
  });

  it("lists the app's images with their ids", async () => {
    const harness = await signedIn();
    const [icon] = harness.fake.seedListingMedia(appOf(harness), ['icon']);
    const result = await harness.run('listing', 'pull');
    expect(result.stdout).toContain(`    ${icon ?? ''}  icon  512x512  draft`);
  });
});

describe('tassyir listing push', () => {
  it('sends the file as the whole draft; pull then push changes nothing', async () => {
    const harness = await signedIn();
    harness.fake.completeDraft(appOf(harness));
    await harness.run('listing', 'pull');
    const before = harness.fake.listings.get(appOf(harness).id)?.draft;
    const result = await harness.run('listing', 'push', '--json');
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({ ok: true, issues: [] });
    expect(harness.fake.listings.get(appOf(harness).id)?.draft).toEqual(before);
    const text = await harness.run('listing', 'push');
    expect(text.stdout).toContain(
      'Complete: `tassyir submit --distribution public`',
    );
  });

  it('passes the API refusal through with every field problem', async () => {
    const harness = await signedIn();
    await writeFile(
      join(harness.cwd, 'tassyir.listing.json'),
      JSON.stringify({
        tagline: { ar: null, en: 'Reviews <b>fast</b>' },
        iconMediaId: '999',
      }),
    );
    const result = await harness.run('listing', 'push', '--json');
    expect(result.code).toBe(1);
    expect(result.json()['error']).toMatchObject({
      code: 'LISTING_INVALID',
      status: 400,
      errors: [
        expect.objectContaining({
          code: 'LISTING_TEXT_INVALID',
          path: 'tagline.en',
        }),
        expect.objectContaining({
          code: 'LISTING_MEDIA_UNKNOWN',
          path: 'iconMediaId',
        }),
      ],
    });
  });

  it('refuses what is not a listing before sending anything', async () => {
    const harness = await signedIn();
    const missing = await harness.run('listing', 'push', '--json');
    expect(missing.json()['error']).toMatchObject({
      code: 'LISTING_FILE_NOT_FOUND',
    });
    await writeFile(join(harness.cwd, 'tassyir.listing.json'), '{ nope');
    const broken = await harness.run('listing', 'push', '--json');
    expect(broken.json()['error']).toMatchObject({
      code: 'LISTING_FILE_INVALID',
    });
    await writeFile(
      join(harness.cwd, 'tassyir.listing.json'),
      JSON.stringify({ name: { ar: 'x', en: 'x' }, price: 0 }),
    );
    const unknown = await harness.run('listing', 'push', '--json');
    expect(unknown.code).toBe(1);
    expect(unknown.json()['error']).toMatchObject({
      code: 'LISTING_FILE_INVALID',
      errors: [{ code: 'LISTING_FIELD_UNKNOWN', path: 'price' }],
    });
    expect(requests(harness, 'PUT', /\/listing$/)).toEqual([]);
  });
});

describe('tassyir submit', () => {
  async function complete(): Promise<Harness> {
    const harness = await signedIn();
    harness.fake.completeDraft(appOf(harness));
    return harness;
  }

  it('needs --distribution: public or unlisted', async () => {
    const harness = await complete();
    const none = await harness.run('submit', '--json');
    expect(none.code).toBe(2);
    expect(none.json()['error']).toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: expect.stringContaining('--distribution public') as string,
    });
    const wrong = await harness.run('submit', '--distribution', 'private');
    expect(wrong.code).toBe(2);
    expect(harness.fake.requests).toEqual([]);
  });

  it('refuses while the draft listing is incomplete, and submits nothing', async () => {
    const harness = await signedIn();
    const result = await harness.run(
      'submit',
      '--distribution',
      'public',
      '--json',
    );
    expect(result.code).toBe(1);
    expect(result.json()['error']).toMatchObject({
      code: 'LISTING_INCOMPLETE',
      fix: expect.stringContaining('tassyir listing pull') as string,
      errors: expect.arrayContaining([
        expect.objectContaining({ path: 'privacyPolicyUrl' }),
      ]) as unknown[],
    });
    expect(requests(harness, 'POST', /\/submissions$/)).toEqual([]);
  });

  it('submits, follows the checks, and exits 0 once the review waits for a person', async () => {
    const harness = await complete();
    harness.fake.caseScript = ['stay', 'submitted'];
    const result = await harness.run(
      'submit',
      '--distribution',
      'public',
      '--note',
      'Demo account: demo@acme.example.com',
      '--json',
    );
    expect(result.code).toBe(0);
    const [first, last, ...rest] = result.jsonLines();
    expect(rest).toEqual([]);
    expect(first).toMatchObject({
      ok: true,
      step: 'submitted',
      review: { state: 'checking' },
      next: expect.stringMatching(
        /^tassyir submissions \d+ --app review-requests --follow$/,
      ) as string,
    });
    expect(last).toMatchObject({
      ok: true,
      submitted: true,
      review: {
        kind: 'listing',
        state: 'submitted',
        distribution: 'public',
        notes: [{ text: 'Demo account: demo@acme.example.com' }],
        checks: { passed: true },
      },
    });
    const sent = requests(harness, 'POST', /\/submissions$/)[0];
    expect(JSON.parse(sent?.body ?? '{}')).toEqual({
      distribution: 'public',
      note: 'Demo account: demo@acme.example.com',
    });
    expect(harness.clock.sleeps).toEqual([10_000, 10_000]);
  });

  it('prints each check and the turnaround for people', async () => {
    const harness = await complete();
    harness.fake.caseScript = ['submitted'];
    const result = await harness.run('submit', '--distribution', 'unlisted');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      '✓ Submitted review-requests for unlisted distribution.',
    );
    expect(result.stdout).toContain(
      'Why a person reviews it: a first listing.',
    );
    expect(result.stdout).toContain('within 5 working days');
    expect(result.stdout).toContain(
      '  ✓ listing_complete: listing_complete passed.',
    );
    expect(result.stdout).toContain(
      '  ! developer_verified (for the reviewer): The reviewer verifies you in this review.',
    );
  });

  it('exits 1 with every failed hard check when the checklist stops the review', async () => {
    const harness = await complete();
    harness.fake.checkResults = passingReviewChecks().map((check) =>
      check.key === 'webhooks_verify_signatures'
        ? {
            ...check,
            status: 'fail',
            message:
              'https://reviews.acme-apps.dz/webhooks answered 200 to a forged signature.',
            fix: 'Verify every delivery with verifyWebhook from @tassyir/app and answer 400 when it throws.',
          }
        : check,
    );
    harness.fake.caseScript = ['checks_failed'];
    const result = await harness.run(
      'submit',
      '--distribution',
      'public',
      '--json',
    );
    expect(result.code).toBe(1);
    expect(result.json()['error']).toMatchObject({
      code: 'SUBMISSION_CHECKS_FAILED',
      fix: expect.stringContaining('tassyir submit --checks-only') as string,
      errors: [
        {
          code: 'webhooks_verify_signatures',
          path: 'webhooks_verify_signatures',
          message:
            'https://reviews.acme-apps.dz/webhooks answered 200 to a forged signature.',
          fix: 'Verify every delivery with verifyWebhook from @tassyir/app and answer 400 when it throws.',
        },
      ],
      details: { state: 'checks_failed' },
    });
  });

  it('stops waiting at --timeout without submitting again (exit 5)', async () => {
    const harness = await complete();
    harness.fake.caseScript = Array.from({ length: 20 }, () => 'stay' as const);
    const result = await harness.run(
      'submit',
      '--distribution',
      'public',
      '--timeout',
      '30',
      '--json',
    );
    expect(result.code).toBe(5);
    expect(result.json()['error']).toMatchObject({
      code: 'SUBMISSION_CHECKING',
      fix: expect.stringContaining('Do not submit again') as string,
    });
    expect(requests(harness, 'POST', /\/submissions$/)).toHaveLength(1);
  });

  it('--timeout 0 answers at once with the review to follow', async () => {
    const harness = await complete();
    const result = await harness.run(
      'submit',
      '--distribution',
      'public',
      '--timeout',
      '0',
      '--json',
    );
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({
      submitted: true,
      review: { state: 'checking' },
      next: expect.stringMatching(
        /^tassyir submissions \d+ --follow$/,
      ) as string,
    });
    expect(harness.clock.sleeps).toEqual([]);
  });

  it('sends the developer to the console for the terms: the CLI never accepts them', async () => {
    const harness = await complete();
    const account = harness.fake.account;
    if (account) {
      account.terms = {
        ...account.terms,
        current: false,
        acceptedVersion: null,
      };
    }
    const result = await harness.run(
      'submit',
      '--distribution',
      'public',
      '--json',
    );
    expect(result.code).toBe(1);
    expect(result.json()['error']).toMatchObject({
      code: 'DEVELOPER_TERMS_REQUIRED',
      status: 409,
      details: { termsVersion: '2026-10' },
      fix: expect.stringContaining('in the developer console') as string,
    });
    expect(requests(harness, 'POST', /\/developer\/terms$/)).toEqual([]);
  });
});

describe('tassyir submit --checks-only', () => {
  it('runs the checklist as a dry run and exits 0 when every hard check passes', async () => {
    const harness = await signedIn();
    harness.fake.checkRunReads = 2;
    const result = await harness.run('submit', '--checks-only', '--json');
    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({
      submitted: false,
      run: {
        status: 'finished',
        checks: { passed: true },
      },
      next: 'tassyir submit',
    });
    expect(requests(harness, 'POST', /\/submissions$/)).toEqual([]);
    expect(requests(harness, 'GET', /\/review-checks\/rcr_/)).toHaveLength(3);
  });

  it('exits 1 listing the hard checks that would fail; warnings stay warnings', async () => {
    const harness = await signedIn();
    harness.fake.checkResults = passingReviewChecks().map((check) =>
      check.key === 'privacy_policy_reachable'
        ? {
            ...check,
            status: 'fail',
            message: 'https://acme-apps.dz/privacy answered 404.',
            fix: 'Publish the privacy policy at that address, or fix privacyPolicyUrl.',
          }
        : check,
    );
    const result = await harness.run('submit', '--checks-only', '--json');
    expect(result.code).toBe(1);
    expect(result.json()['error']).toMatchObject({
      code: 'REVIEW_CHECKS_FAILED',
      message: expect.stringContaining('Nothing was submitted') as string,
      errors: [{ code: 'privacy_policy_reachable' }],
    });
  });

  it('passes the hourly limit through (exit 5), and refuses submission options', async () => {
    const harness = await signedIn();
    harness.fake.checkRunsLeft.set(appOf(harness).id, 0);
    const limited = await harness.run('submit', '--checks-only', '--json');
    expect(limited.code).toBe(5);
    expect(limited.json()['error']).toMatchObject({
      code: 'REVIEW_CHECKS_RATE_LIMITED',
      retryAfterSeconds: 1200,
    });
    const mixed = await harness.run(
      'submit',
      '--checks-only',
      '--distribution',
      'public',
    );
    expect(mixed.code).toBe(2);
  });
});

describe('tassyir submissions', () => {
  it('lists the reviews newest first, and shows one with its checks', async () => {
    const harness = await signedIn();
    harness.fake.completeDraft(appOf(harness));
    harness.fake.caseScript = ['submitted'];
    await harness.run('submit', '--distribution', 'public');
    const list = await harness.run('submissions', '--json');
    expect(list.code).toBe(0);
    const reviews = list.json()['reviews'] as { id: string; state: string }[];
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.state).toBe('submitted');
    const table = await harness.run('submissions');
    expect(table.stdout).toMatch(/^ID +KIND +STATE/);
    const one = await harness.run('submissions', reviews[0]?.id ?? '');
    expect(one.stdout).toContain(
      'submitted, the checks passed; waiting for a reviewer.',
    );
    expect(one.stdout).toContain('✓ compliance_topics');
  });

  it('--follow waits while the checks run, then exits by the verdict', async () => {
    const harness = await signedIn();
    harness.fake.completeDraft(appOf(harness));
    await harness.run('submit', '--distribution', 'public', '--timeout', '0');
    const id = harness.fake.cases.get(appOf(harness).id)?.[0]?.id ?? '';
    harness.fake.caseScript = ['stay', 'stay', 'checks_failed'];
    const result = await harness.run('submissions', id, '--follow', '--json');
    expect(result.code).toBe(1);
    expect(result.json()['error']).toMatchObject({
      code: 'SUBMISSION_CHECKS_FAILED',
    });
  });

  it("shows the reviewer's decision", async () => {
    const harness = await signedIn();
    harness.fake.completeDraft(appOf(harness));
    harness.fake.caseScript = ['submitted'];
    await harness.run('submit', '--distribution', 'public');
    const id = harness.fake.cases.get(appOf(harness).id)?.[0]?.id ?? '';
    harness.fake.caseScript = ['changes_requested'];
    const result = await harness.run('submissions', id);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      'The reviewer: The screenshots show another app.',
    );
    expect(result.stdout).toContain(
      '- listing.screenshots: Show the app as installed on a dev store.',
    );
  });

  it('refuses a malformed id and --follow without one; an unknown id is 404', async () => {
    const harness = await signedIn();
    expect((await harness.run('submissions', 'abc')).code).toBe(2);
    expect((await harness.run('submissions', '--follow')).code).toBe(2);
    const unknown = await harness.run('submissions', '12345', '--json');
    expect(unknown.code).toBe(1);
    expect(unknown.json()['error']).toMatchObject({
      code: 'REVIEW_CASE_NOT_FOUND',
    });
  });
});
