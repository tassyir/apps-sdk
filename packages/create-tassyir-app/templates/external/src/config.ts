import { resolve } from 'node:path';

// The server's settings, read from the environment. In development they come
// from .env (`npm run setup` writes it from .env.example; Node loads it with
// --env-file-if-exists). Every problem is reported at once, each with what to
// do about it, and a secret's value is never printed.

export interface Config {
  /** `app_…`: the app's client ID. */
  clientId: string;
  /** `tsy_cs_…`: a client secret. Never log it. */
  clientSecret: string;
  /** The app's numeric id: webhook envelopes name it (`appId`). */
  appId: string;
  /** 32 bytes that encrypt the stored tokens (AES-256-GCM). */
  tokenStoreKey: Buffer;
  port: number;
  /** Where the store file lives: a persistent disk in production. */
  dataDir: string;
  /** Another Tassyir API (staging); unset means https://api.tassyir.io. */
  apiOrigin: string | undefined;
}

export type ConfigProblemCode =
  'CONFIG_MISSING' | 'CONFIG_PLACEHOLDER' | 'CONFIG_INVALID';

export interface ConfigProblem {
  variable: string;
  code: ConfigProblemCode;
  message: string;
  fix: string;
}

export class ConfigError extends Error {
  readonly code = 'CONFIG_INVALID';
  readonly problems: ConfigProblem[];

  constructor(problems: ConfigProblem[]) {
    super(
      `The server cannot start: ${problems.map((problem) => problem.variable).join(', ')}`,
    );
    this.name = 'ConfigError';
    this.problems = problems;
  }

  /** One block per problem, for the terminal. */
  report(): string {
    return [
      this.message,
      ...this.problems.map(
        (problem) =>
          `  ✗ ${problem.code} ${problem.variable}: ${problem.message}\n    Fix: ${problem.fix}`,
      ),
    ].join('\n');
  }
}

const CONSOLE = 'https://app.tassyir.io/en/developers';

interface Rule {
  pattern: RegExp;
  what: string;
  fix: string;
}

const REQUIRED: Record<string, Rule> = {
  TASSYIR_CLIENT_ID: {
    pattern: /^app_[A-Za-z0-9]{1,64}$/,
    what: 'a client ID (app_…)',
    fix: `Copy the client ID from the developer console (${CONSOLE}, your app, Credentials) into .env.`,
  },
  TASSYIR_CLIENT_SECRET: {
    pattern: /^tsy_cs_[A-Za-z0-9]{1,128}$/,
    what: 'a client secret (tsy_cs_…)',
    fix: `In the developer console (${CONSOLE}, your app, Credentials), create a secret (it is shown once) and put it in .env.`,
  },
  TASSYIR_APP_ID: {
    pattern: /^\d{1,20}$/,
    what: "the app's numeric id",
    fix: "Put your app's numeric id in .env: the number at the end of the app's address in the developer console (/developers/apps/<id>). It is not the client ID.",
  },
  TOKEN_STORE_KEY: {
    pattern: /^[A-Za-z0-9+/]{43}=$/,
    what: '32 random bytes in base64',
    fix: "Run npm run setup, or set it to the output of: node -p \"require('node:crypto').randomBytes(32).toString('base64')\"",
  },
};

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const problems: ConfigProblem[] = [];
  const values: Record<string, string> = {};

  for (const [variable, rule] of Object.entries(REQUIRED)) {
    const value = env[variable]?.trim() ?? '';
    if (value === '') {
      problems.push({
        variable,
        code: 'CONFIG_MISSING',
        message: `${variable} is not set`,
        fix: rule.fix,
      });
    } else if (value.includes('your-')) {
      // The .env.example placeholders; no real value holds a hyphen.
      problems.push({
        variable,
        code: 'CONFIG_PLACEHOLDER',
        message: `${variable} is still the placeholder from .env.example`,
        fix: rule.fix,
      });
    } else if (!rule.pattern.test(value)) {
      problems.push({
        variable,
        code: 'CONFIG_INVALID',
        message: `${variable} is not ${rule.what}`,
        fix: rule.fix,
      });
    } else {
      values[variable] = value;
    }
  }

  const port = Number(env['PORT'] ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    problems.push({
      variable: 'PORT',
      code: 'CONFIG_INVALID',
      message: 'PORT is not a port number',
      fix: 'Set PORT to a whole number from 1 to 65535, or remove it to use 3000.',
    });
  }

  const apiOrigin = env['TASSYIR_API_ORIGIN']?.trim() || undefined;
  if (apiOrigin !== undefined && !/^https:\/\/[a-z0-9.-]+$/.test(apiOrigin)) {
    problems.push({
      variable: 'TASSYIR_API_ORIGIN',
      code: 'CONFIG_INVALID',
      message: 'TASSYIR_API_ORIGIN is not an https origin',
      fix: 'Remove it to use https://api.tassyir.io, or set an origin such as https://api.example.com (no path).',
    });
  }

  if (problems.length > 0) throw new ConfigError(problems);
  return {
    clientId: values['TASSYIR_CLIENT_ID'] ?? '',
    clientSecret: values['TASSYIR_CLIENT_SECRET'] ?? '',
    appId: values['TASSYIR_APP_ID'] ?? '',
    tokenStoreKey: Buffer.from(values['TOKEN_STORE_KEY'] ?? '', 'base64'),
    port,
    dataDir: resolve(env['DATA_DIR']?.trim() || 'data'),
    apiOrigin,
  };
}
