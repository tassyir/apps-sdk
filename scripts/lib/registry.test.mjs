import { describe, expect, it } from 'vitest';
import { mirrorDistTag, readViewResult } from './registry.mjs';

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
