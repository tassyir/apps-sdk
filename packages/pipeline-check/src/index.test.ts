import { describe, expect, it } from 'vitest';
import { SDK_REPOSITORY_URL, npmPackageUrl } from './index.js';

describe('npmPackageUrl', () => {
  it('links a scoped package', () => {
    expect(npmPackageUrl('@tassyir/app-manifest')).toBe(
      'https://www.npmjs.com/package/@tassyir/app-manifest',
    );
  });

  it('links an unscoped package', () => {
    expect(npmPackageUrl('create-tassyir-app')).toBe(
      'https://www.npmjs.com/package/create-tassyir-app',
    );
  });

  it.each(['', 'Upper', '@tassyir/', '@/x', 'a b', '../x', 'x'.repeat(215)])(
    'refuses %j',
    (name) => {
      expect(() => npmPackageUrl(name)).toThrow(TypeError);
    },
  );
});

describe('SDK_REPOSITORY_URL', () => {
  it('is the public repo', () => {
    expect(SDK_REPOSITORY_URL).toBe('https://github.com/tassyir/apps-sdk');
  });
});
