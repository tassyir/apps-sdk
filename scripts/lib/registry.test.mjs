import { describe, expect, it } from 'vitest';
import {
  NPM_WAIT_MS,
  formatProblem,
  mirrorDistTag,
  notOnNpmProblem,
  packNotServed,
  pollUntil,
  readViewResult,
  retryDelay,
} from './registry.mjs';

const E404 = JSON.stringify({
  error: { code: 'E404', summary: 'Not Found', detail: 'not in this registry' },
});

describe('readViewResult', () => {
  it('reads a version that exists', () => {
    expect(
      readViewResult({ status: 0, stdout: '"sha512-abc"\n', stderr: '' }),
    ).toEqual({ found: true, value: 'sha512-abc' });
  });

  it('reads a missing version of an existing package (npm prints nothing)', () => {
    expect(readViewResult({ status: 0, stdout: '\n', stderr: '' })).toEqual({
      found: false,
    });
  });

  it('reads E404 from the JSON on stdout or the log on stderr', () => {
    expect(readViewResult({ status: 1, stdout: E404, stderr: '' })).toEqual({
      found: false,
    });
    expect(
      readViewResult({
        status: 1,
        stdout: '',
        stderr: 'npm error code E404\n',
      }),
    ).toEqual({ found: false });
  });

  it('never reads an auth or network failure as "missing"', () => {
    expect(
      readViewResult({
        status: 1,
        stdout: JSON.stringify({ error: { code: 'E401' } }),
        stderr: '',
      }),
    ).toEqual({ error: 'E401' });
    expect(
      readViewResult({
        status: 1,
        stdout: '',
        stderr: 'npm error code ETIMEDOUT',
      }),
    ).toEqual({ error: 'ETIMEDOUT' });
    expect(readViewResult({ status: 1, stdout: '', stderr: 'boom' })).toEqual({
      error: 'boom',
    });
  });
});

describe('mirrorDistTag', () => {
  it("follows npm's tag, latest first", () => {
    expect(mirrorDistTag('1.2.0', { latest: '1.2.0', next: '1.2.0' })).toBe(
      'latest',
    );
    expect(
      mirrorDistTag('2.0.0-beta.1', { latest: '1.2.0', beta: '2.0.0-beta.1' }),
    ).toBe('beta');
  });

  it('falls back to latest for a release and the prerelease id otherwise', () => {
    expect(mirrorDistTag('1.2.0', undefined)).toBe('latest');
    expect(mirrorDistTag('1.2.0', {})).toBe('latest');
    expect(mirrorDistTag('2.0.0-rc.0', {})).toBe('rc');
    expect(mirrorDistTag('2.0.0-0', {})).toBe('next');
  });

  it("never moves latest behind npm's", () => {
    expect(mirrorDistTag('1.2.0', { latest: '1.3.0' })).toBe('untagged');
  });
});

describe('packNotServed', () => {
  it('reads ETARGET and E404 as a version npm does not serve yet', () => {
    expect(
      packNotServed({
        status: 1,
        stdout: JSON.stringify({ error: { code: 'ETARGET' } }),
        stderr: 'npm error code ETARGET\n',
      }),
    ).toBe(true);
    expect(packNotServed({ status: 1, stdout: E404, stderr: '' })).toBe(true);
  });

  it('never reads a success, or an auth or network failure, as "not served"', () => {
    expect(packNotServed({ status: 0, stdout: '[]', stderr: '' })).toBe(false);
    expect(
      packNotServed({
        status: 1,
        stdout: '',
        stderr: 'npm error code E401\n',
      }),
    ).toBe(false);
    expect(
      packNotServed({
        status: 1,
        stdout: '',
        stderr: 'npm error code ECONNRESET\n',
      }),
    ).toBe(false);
  });
});

describe('retryDelay', () => {
  it('starts at 5 s, doubles, and stops at 30 s', () => {
    expect([1, 2, 3, 4, 5, 20].map(retryDelay)).toEqual([
      5000, 10_000, 20_000, 30_000, 30_000, 30_000,
    ]);
  });
});

/**
 * A clock that only moves when the code under test sleeps.
 * @param {(number | undefined)[]} answers what each check returns, in order
 * @param {number} deadline
 */
async function pollWithFakeClock(answers, deadline) {
  let clock = 0;
  /** @type {number[]} */
  const sleeps = [];
  /** @type {number[]} */
  const checkedAt = [];
  const result = await pollUntil(
    () => {
      checkedAt.push(clock);
      return answers.shift();
    },
    {
      deadline,
      now: () => clock,
      sleep: (ms) => {
        sleeps.push(ms);
        clock += ms;
        return Promise.resolve();
      },
    },
  );
  return { result, sleeps, checkedAt };
}

describe('pollUntil', () => {
  it('returns at once when the first check finds the value', async () => {
    expect(await pollWithFakeClock([7], 60_000)).toEqual({
      result: { value: 7, attempts: 1 },
      sleeps: [],
      checkedAt: [0],
    });
  });

  it('checks again with backoff until the value appears', async () => {
    expect(
      await pollWithFakeClock([undefined, undefined, undefined, 7], 60_000),
    ).toEqual({
      result: { value: 7, attempts: 4 },
      sleeps: [5000, 10_000, 20_000],
      checkedAt: [0, 5000, 15_000, 35_000],
    });
  });

  it('never sleeps past the deadline, and checks once more on it', async () => {
    const { result, sleeps, checkedAt } = await pollWithFakeClock([], 40_000);
    expect(result).toEqual({ value: undefined, attempts: 5 });
    expect(sleeps).toEqual([5000, 10_000, 20_000, 5000]);
    expect(checkedAt).toEqual([0, 5000, 15_000, 35_000, 40_000]);
  });

  it('checks exactly once when the deadline has already passed (a dry run)', async () => {
    expect(await pollWithFakeClock([], 0)).toEqual({
      result: { value: undefined, attempts: 1 },
      sleeps: [],
      checkedAt: [0],
    });
  });

  it('reports each wait before it sleeps', async () => {
    /** @type {[number, number][]} */
    const waits = [];
    let clock = 0;
    await pollUntil(() => (clock >= 15_000 ? 'ok' : undefined), {
      deadline: 60_000,
      now: () => clock,
      sleep: (ms) => {
        clock += ms;
        return Promise.resolve();
      },
      onWait: (attempt, ms) => {
        waits.push([attempt, ms]);
      },
    });
    expect(waits).toEqual([
      [1, 5000],
      [2, 10_000],
    ]);
  });

  it('lets an error from the check through', async () => {
    await expect(
      pollUntil(
        () => {
          throw new Error('E401');
        },
        {
          deadline: 60_000,
          now: () => 0,
          sleep: () => Promise.resolve(),
        },
      ),
    ).rejects.toThrow('E401');
  });
});

describe('notOnNpmProblem', () => {
  const where = {
    spec: '@tassyir/app@0.1.1',
    path: 'packages/app/package.json',
  };

  it('fails a release run after the wait, and says how to repair it', () => {
    const problem = notOnNpmProblem({
      ...where,
      attempts: 24,
      waitedMs: NPM_WAIT_MS,
      dryRun: false,
    });
    expect(problem).toEqual({
      code: 'NOT_ON_NPM',
      path: 'packages/app/package.json',
      message:
        'npm still does not serve @tassyir/app@0.1.1, the version packages/app/package.json names, after 10 min and 24 checks, so GitHub Packages did not get it.',
      fix: 'Run release.yml again (Actions → Release → Run workflow, or gh workflow run release.yml --repo tassyir/apps-sdk --ref main): it publishes to npm what npm lacks, then mirrors only what GitHub Packages lacks.',
    });
    expect(formatProblem(problem)).toBe(
      `NOT_ON_NPM (packages/app/package.json): ${problem.message}\n  fix: ${problem.fix}`,
    );
  });

  it('rounds the wait to a tenth of a minute', () => {
    expect(
      notOnNpmProblem({
        ...where,
        attempts: 3,
        waitedMs: 45_000,
        dryRun: false,
      }).message,
    ).toContain('after 0.8 min and 3 checks');
  });

  it('points a dry run at --from-workspace', () => {
    expect(
      notOnNpmProblem({ ...where, attempts: 1, waitedMs: 2000, dryRun: true }),
    ).toEqual({
      code: 'NOT_ON_NPM',
      path: 'packages/app/package.json',
      message:
        'npm does not serve @tassyir/app@0.1.1, the version packages/app/package.json names (a dry run checks once, without waiting).',
      fix: "Release @tassyir/app@0.1.1 first, or add --from-workspace to rehearse the mirror with the workspace's own tarballs.",
    });
  });
});
