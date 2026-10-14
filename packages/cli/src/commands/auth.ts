import type { DeveloperApi } from '../api.js';
import type { CliToken, DeveloperTokenResponse } from '../api-types.js';
import { isBrowsableUrl, openBrowser } from '../browser.js';
import { lines } from '../command.js';
import type { Command, CommandResult, Context } from '../command.js';
import { CliError, EXIT_CODES, isCliError, usageError } from '../errors.js';

// login, logout, whoami: the OAuth 2.0 Device Authorization Grant (RFC 8628)
// as the API documents it (tassyir/backend docs/api/apps/developer-cli-auth.md).
// The CLI never holds the dashboard's session: it holds a developer token
// (`tsy_dt_…`), valid on `developer/*` only, revocable, and never printed.

/** RFC 8628 §3.5: `slow_down` adds 5 seconds; the API stops at 60. */
const SLOW_DOWN_STEP = 5;
const MAX_INTERVAL = 60;

/** `device_name`'s rule on the API: letters, digits, spaces and ._-'()@, 64 at most. */
const DEVICE_NAME = /^[\p{L}\p{N} ._\-'()@]{1,64}$/u;

/** This machine's name as the approval page may show it. */
export function defaultDeviceName(hostname: string): string | undefined {
  const name = hostname
    .replace(/\.local$/i, '')
    .replace(/[^\p{L}\p{N} ._\-'()@]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64)
    .trim();
  return name === '' ? undefined : name;
}

/** `ar` or `en`, from --locale or the environment's language ($LANG). */
function localeOf(context: Context, option: string | undefined): string {
  if (option !== undefined) {
    if (option !== 'ar' && option !== 'en') {
      throw usageError(`--locale is "${option}"; use ar or en`, 'login');
    }
    return option;
  }
  const language =
    context.io.env['LC_ALL'] ??
    context.io.env['LANG'] ??
    context.io.env['LANGUAGE'];
  return language?.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

function seconds(value: number): string {
  return value % 60 === 0 && value >= 60
    ? `${String(value / 60)} minute${value === 60 ? '' : 's'}`
    : `${String(value)} seconds`;
}

export const loginCommand: Command = {
  name: 'login',
  summary:
    'Sign in to Tassyir from this machine (a code to approve in the dashboard)',
  usage: 'tassyir login [options]',
  description: [
    'Prints a one-time code and the approval page. Open the page, check that it shows the',
    'same code, and approve: the CLI receives a developer token that works on the developer',
    'API only. It is stored in your OS keychain when one answers, otherwise in a file only',
    'you can read, and never printed.',
  ].join('\n'),
  options: {
    'no-browser': {
      type: 'boolean',
      description: 'Never offer to open the browser.',
    },
    'device-name': {
      type: 'string',
      value: 'name',
      description:
        "The name the approval page shows. Default: this machine's name.",
    },
    locale: {
      type: 'string',
      value: 'ar|en',
      description: "The approval page's language. Default: from $LANG.",
    },
  },
  async run(context, { values }) {
    const deviceNameOption = values['device-name'];
    let deviceName: string | undefined;
    if (typeof deviceNameOption === 'string') {
      deviceName = deviceNameOption.replace(/\s+/g, ' ').trim();
      if (!DEVICE_NAME.test(deviceName)) {
        throw usageError(
          "--device-name takes 1-64 letters, digits, spaces and ._-'()@",
          'login',
        );
      }
    } else {
      deviceName = defaultDeviceName(context.io.hostname);
    }
    const locale = localeOf(
      context,
      typeof values['locale'] === 'string' ? values['locale'] : undefined,
    );

    // This machine's earlier sign-in (never TASSYIR_TOKEN's), revoked below.
    const previous = await context.credentials
      .resolve(context.apiOrigin, { stored: true })
      .catch(() => undefined);

    const api = context.client();
    const grant = await api.startSignIn({
      clientVersion: context.io.version,
      deviceName,
      locale,
    });
    const code = grant.user_code;
    const page = grant.verification_uri_complete;

    context.emit({
      ok: true,
      step: 'authorize',
      userCode: code,
      verificationUri: grant.verification_uri,
      verificationUriComplete: page,
      expiresIn: grant.expires_in,
      interval: grant.interval,
    });
    context.progress(
      lines(
        `! Your one-time code: ${code}`,
        `  Open ${page}`,
        '  Check that the page shows the same code, and approve only a sign-in you started here.',
      ).trimEnd(),
    );

    // The offer: Enter opens the page, while the CLI already polls.
    let offer: { cancel(): void } | undefined;
    if (
      context.io.interactive &&
      !context.json &&
      values['no-browser'] !== true &&
      isBrowsableUrl(page)
    ) {
      const enter = context.io.waitForEnter();
      offer = enter;
      context.progress('  Press Enter to open it in your browser.');
      enter.promise.then(
        () => {
          void openBrowser(context.io, page).then((opened) => {
            if (!opened)
              context.progress(
                '  Could not open a browser: open the address above yourself.',
              );
          });
        },
        () => undefined,
      );
    }
    context.progress(
      `Waiting for approval (the code expires in ${seconds(grant.expires_in)})…`,
    );

    let token: DeveloperTokenResponse;
    try {
      token = await poll(
        context,
        api,
        grant.device_code,
        grant.interval,
        grant.expires_in,
      );
    } finally {
      offer?.cancel();
    }

    const saved = await context.credentials.save(
      context.apiOrigin,
      token.access_token,
      {
        tokenId: token.token_id,
        userId: token.user_id,
        email: token.email,
      },
    );

    // The previous sign-in of this machine is replaced: revoke its token, so
    // it does not count against the 20 a developer may hold. Best effort.
    let previousRevoked = false;
    if (previous && previous.token !== token.access_token) {
      previousRevoked = await context
        .client(previous.token)
        .revokeCurrentToken()
        .then(() => true)
        .catch(() => false);
    }

    const warnings: string[] = [];
    if (context.io.env['TASSYIR_TOKEN']?.trim()) {
      warnings.push(
        'TASSYIR_TOKEN is set: commands use it, not this sign-in, until you unset it.',
      );
    }
    if (saved.fallback) {
      warnings.push(
        `No keychain took the token: it is in ${saved.where}, readable only by you. Keep that file out of backups you share.`,
      );
    }
    return {
      data: {
        step: 'signed_in',
        email: token.email,
        userId: token.user_id,
        tokenId: token.token_id,
        apiOrigin: context.apiOrigin,
        storage: saved.storage,
        storedIn: saved.where,
        idleExpirySeconds: token.expires_in,
        previousTokenRevoked: previousRevoked,
        warnings,
      },
      text: lines(
        `✓ Signed in to ${context.apiOrigin} as ${token.email || token.user_id}.`,
        `  The token is in ${saved.where}. It lapses after 90 days unused; \`tassyir logout\` revokes it.`,
        ...warnings.map((warning) => `  ! ${warning}`),
      ),
    };
  },
};

/** Polls until the developer decides, the code expires, or the API refuses. */
async function poll(
  context: Context,
  api: DeveloperApi,
  deviceCode: string,
  firstInterval: number,
  expiresIn: number,
): Promise<DeveloperTokenResponse> {
  const deadline = context.io.now() + expiresIn * 1000;
  let interval = Math.max(1, firstInterval);
  for (;;) {
    await context.io.sleep(interval * 1000);
    if (context.io.now() >= deadline) throw loginExpired();
    let result: Awaited<ReturnType<DeveloperApi['pollSignIn']>>;
    try {
      result = await api.pollSignIn(deviceCode);
    } catch (error) {
      if (!isCliError(error) || error.exitCode !== EXIT_CODES.TRY_LATER) {
        throw error;
      }
      // RFC 8628 §3.5: a connection timeout reduces the polling frequency.
      interval = Math.min(interval * 2, MAX_INTERVAL);
      context.debug?.(
        `poll failed (${error.code}); next poll in ${String(interval)}s`,
      );
      continue;
    }
    if (result.ok) return result.token;
    switch (result.error) {
      case 'authorization_pending':
        break;
      case 'slow_down':
        interval = Math.min(interval + SLOW_DOWN_STEP, MAX_INTERVAL);
        if (result.retryAfterSeconds !== undefined) {
          interval = Math.max(interval, result.retryAfterSeconds);
        }
        break;
      case 'access_denied':
        throw new CliError({
          code: 'LOGIN_DENIED',
          message:
            'The sign-in was denied in the dashboard (or the account cannot sign in: developer account suspended, or the password changed since the approval)',
          fix: 'If you started this sign-in, run `tassyir login` again and approve it; otherwise nothing is needed.',
          exitCode: EXIT_CODES.AUTH,
        });
      case 'expired_token':
        throw loginExpired();
      case 'invalid_grant':
        throw new CliError({
          code: 'LOGIN_INVALID_GRANT',
          message:
            'The API no longer knows this sign-in (already used, or approved by an account that cannot sign in)',
          fix: 'Run `tassyir login` again.',
          exitCode: EXIT_CODES.AUTH,
        });
      default:
        if (result.status >= 500) {
          interval = Math.min(interval * 2, MAX_INTERVAL);
          break;
        }
        throw new CliError({
          code: 'LOGIN_FAILED',
          message: `The API refused the sign-in: ${result.error}${result.description ? ` (${result.description})` : ''}`,
          fix: 'Update the CLI (npm install -g tassyir@latest), then run `tassyir login` again.',
          exitCode: EXIT_CODES.AUTH,
          status: result.status,
        });
    }
  }
}

function loginExpired(): CliError {
  return new CliError({
    code: 'LOGIN_EXPIRED',
    message: 'The code expired before the sign-in was approved (10 minutes)',
    fix: 'Run `tassyir login` again and approve the new code in the dashboard.',
    exitCode: EXIT_CODES.AUTH,
  });
}

export const logoutCommand: Command = {
  name: 'logout',
  summary: "Revoke this machine's token and forget it",
  usage: 'tassyir logout [options]',
  description: [
    'Revokes the stored token on Tassyir (it stops working at once), then removes it from',
    'the keychain or the file. A TASSYIR_TOKEN in the environment is never revoked here.',
  ].join('\n'),
  options: {
    local: {
      type: 'boolean',
      description:
        'Forget the token on this machine even when the API cannot be reached to revoke it.',
    },
  },
  async run(context, { values }): Promise<CommandResult> {
    if (context.io.env['TASSYIR_TOKEN']?.trim()) {
      throw new CliError({
        code: 'TOKEN_FROM_ENV',
        message:
          'TASSYIR_TOKEN is set: logout would revoke the token your CI or shell was given',
        fix: "Unset TASSYIR_TOKEN to log this machine out (`env -u TASSYIR_TOKEN tassyir logout`); revoke a CI token from the dashboard's developer settings.",
        exitCode: EXIT_CODES.USAGE,
      });
    }
    const session = await context.credentials.session(context.apiOrigin);
    if (!session) {
      // Clears a keychain entry a lost credentials file left behind.
      await context.credentials.remove(context.apiOrigin);
      return {
        data: { revoked: false, removed: false, apiOrigin: context.apiOrigin },
        text: lines(`Not signed in to ${context.apiOrigin}: nothing to do.`),
      };
    }
    // revoked: the API revoked it now; invalid: it no longer worked;
    // unreadable: the keychain did not give it back; kept: --local, offline.
    let outcome: 'revoked' | 'invalid' | 'unreadable' | 'kept' = 'revoked';
    try {
      const resolved = await context.credentials.resolve(context.apiOrigin);
      if (resolved) await context.client(resolved.token).revokeCurrentToken();
    } catch (error) {
      if (isCliError(error) && error.status === 401) {
        outcome = 'invalid';
      } else if (
        isCliError(error, 'CREDENTIALS_UNAVAILABLE') ||
        isCliError(error, 'CREDENTIALS_UNREADABLE')
      ) {
        outcome = 'unreadable';
      } else if (values['local'] === true) {
        outcome = 'kept';
      } else if (isCliError(error)) {
        throw new CliError({
          code: error.code,
          message: `${error.message}: the token was not revoked, and is still stored`,
          fix: "Run `tassyir logout` again once the API answers, or `tassyir logout --local` to forget it here anyway (then revoke it from the dashboard's developer settings).",
          exitCode: error.exitCode,
          ...(error.status === undefined ? {} : { status: error.status }),
          ...(error.requestId === undefined
            ? {}
            : { requestId: error.requestId }),
        });
      } else {
        throw error;
      }
    }
    await context.credentials.remove(context.apiOrigin);
    return {
      data: {
        revoked: outcome === 'revoked',
        outcome,
        removed: true,
        apiOrigin: context.apiOrigin,
        email: session.email,
      },
      text: lines(
        outcome === 'revoked'
          ? `✓ Logged out of ${context.apiOrigin}: the token is revoked and forgotten.`
          : outcome === 'invalid'
            ? `✓ Logged out of ${context.apiOrigin}: the token no longer worked, and is forgotten.`
            : `✓ Forgotten on this machine, but the token was NOT revoked${outcome === 'unreadable' ? ' (the keychain did not give it back)' : ''}: revoke it from the dashboard's developer settings.`,
      ),
    };
  },
};

export const whoamiCommand: Command = {
  name: 'whoami',
  summary: "Who this machine is signed in as, and the token's state",
  usage: 'tassyir whoami [options]',
  options: {},
  async run(context): Promise<CommandResult> {
    const { api, token } = await context.api();
    const tokens = (await api.listTokens()).data;
    const current: CliToken | undefined = tokens.find(
      (candidate) => candidate.current,
    );
    const account = (await api.getAccount()).data;
    const email =
      token.storage === 'env' ? null : (token.session?.email ?? null);
    const data = {
      apiOrigin: context.apiOrigin,
      email,
      userId: token.storage === 'env' ? null : (token.session?.userId ?? null),
      storage: token.storage,
      token: current
        ? {
            id: current.id,
            deviceName: current.deviceName,
            clientVersion: current.client.version,
            createdAt: current.createdAt,
            lastUsedAt: current.lastUsedAt,
            expiresAt: current.expiresAt,
          }
        : null,
      developer: account
        ? {
            id: account.id,
            displayName: account.displayName,
            status: account.status,
          }
        : null,
    };
    return {
      data,
      text: lines(
        `Signed in to ${context.apiOrigin}${email ? ` as ${email}` : ''} (token from ${
          token.storage === 'env'
            ? 'TASSYIR_TOKEN'
            : token.storage === 'keychain'
              ? 'the keychain'
              : 'the credentials file'
        }).`,
        current &&
          `  Token ${current.id}${current.deviceName ? ` (${current.deviceName})` : ''}: created ${current.createdAt}, last used ${current.lastUsedAt ?? 'never'}, expires ${current.expiresAt}.`,
        account
          ? `  Developer account: ${account.displayName} (${account.status}).`
          : '  Developer mode is off: turn it on in the dashboard (https://app.tassyir.io/en/developers) to create apps.',
      ),
    };
  },
};
