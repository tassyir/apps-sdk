import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.ts';

const VALID = {
  TASSYIR_CLIENT_ID: 'app_test',
  TASSYIR_CLIENT_SECRET: 'tsy_cs_test',
  TASSYIR_APP_ID: '42',
  TOKEN_STORE_KEY: Buffer.alloc(32, 3).toString('base64'),
};

describe('loadConfig', () => {
  it('reads a complete environment', () => {
    const config = loadConfig({ ...VALID, PORT: '8080' });
    expect(config).toMatchObject({
      clientId: 'app_test',
      appId: '42',
      port: 8080,
      apiOrigin: undefined,
    });
    expect(config.tokenStoreKey).toHaveLength(32);
  });

  it('reports every problem at once, each with a fix, and never prints a secret', () => {
    let caught: unknown;
    try {
      loadConfig({
        TASSYIR_CLIENT_ID: 'app_your-client-id',
        TASSYIR_CLIENT_SECRET: 'tsy_cs_not-a-secret!',
        TOKEN_STORE_KEY: 'short',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    const { problems } = caught as ConfigError;
    expect(problems.map(({ variable, code }) => `${variable} ${code}`)).toEqual(
      [
        'TASSYIR_CLIENT_ID CONFIG_PLACEHOLDER',
        'TASSYIR_CLIENT_SECRET CONFIG_INVALID',
        'TASSYIR_APP_ID CONFIG_MISSING',
        'TOKEN_STORE_KEY CONFIG_INVALID',
      ],
    );
    expect(problems.every((problem) => problem.fix.length > 0)).toBe(true);
    expect((caught as ConfigError).report()).not.toContain('not-a-secret');
  });
});
