import { AdminClient } from './admin-client.js';
import type { AdminClientOptions, ResponseInfo } from './admin-client.js';
import { TassyirError } from './errors.js';
import type { FetchLike } from './http.js';
import { verifyIdToken } from './id-token.js';
import type { VerifiedIdToken } from './id-token.js';
import { IdTokenKeys, WebhookKeys } from './keys.js';
import { TassyirOAuthClient } from './oauth.js';
import type { TokenSet } from './oauth.js';
import { TokenManager } from './token-manager.js';
import type { RefreshLock } from './token-manager.js';
import { MemoryTokenStore } from './token-store.js';
import type { TokenStore } from './token-store.js';
import { verifyWebhook, verifyWebhookRequest } from './webhooks.js';
import type {
  InstallationCheck,
  VerifiedWebhook,
  WebhookDelivery,
} from './webhooks.js';

export interface TassyirAppOptions {
  /** `app_…`, from the developer console (`process.env.TASSYIR_CLIENT_ID`). */
  clientId: string;
  /** `tsy_cs_…` (`process.env.TASSYIR_CLIENT_SECRET`). A secret: never commit or log it. */
  clientSecret: string;
  /**
   * Your app's numeric id from the developer console
   * (`process.env.TASSYIR_APP_ID`): webhook envelopes name it. Needed to
   * verify webhooks.
   */
  appId?: string;
  /**
   * Where installations' offline tokens live. Default: memory, which is for
   * tests only (lost on restart, invisible to other processes).
   */
  tokenStore?: TokenStore;
  /** A lock shared by your processes, so only one refreshes an installation at a time. */
  refreshLock?: RefreshLock;
  /** Default `https://api.tassyir.io`. */
  apiOrigin?: string;
  fetch?: FetchLike;
  /** Admin API retries, off by default (see `AdminClientOptions.retries`). */
  retries?: AdminClientOptions['retries'];
  /** Called after every Admin API answer (rate limits, status, request id). */
  onResponse?: (info: ResponseInfo) => void;
}

export interface IdTokenSession {
  /** Who opened the page: user, business, installation, locale. */
  idToken: VerifiedIdToken;
  tokens: TokenSet;
  /** False when a stored offline token was reused instead of exchanging. */
  exchanged: boolean;
}

/**
 * Everything an app's server needs, wired together: the token endpoint, the
 * token store with refresh locking, ID-token and webhook verification with
 * cached keys, and Admin API clients. Create one per process.
 */
export class TassyirApp {
  readonly clientId: string;
  readonly appId: string | undefined;
  readonly oauth: TassyirOAuthClient;
  readonly tokens: TokenManager;
  readonly idTokenKeys: IdTokenKeys;
  readonly webhookKeys: WebhookKeys;
  readonly #options: TassyirAppOptions;

  constructor(options: TassyirAppOptions) {
    this.#options = options;
    this.oauth = new TassyirOAuthClient({
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      apiOrigin: options.apiOrigin,
      fetch: options.fetch,
    });
    this.clientId = this.oauth.clientId;
    this.appId = options.appId;
    this.tokens = new TokenManager({
      oauth: this.oauth,
      store: options.tokenStore ?? new MemoryTokenStore(),
      lock: options.refreshLock,
    });
    const keyOptions = { apiOrigin: options.apiOrigin, fetch: options.fetch };
    this.idTokenKeys = IdTokenKeys.remote(keyOptions);
    this.webhookKeys = WebhookKeys.remote(keyOptions);
  }

  /** Verifies an ID token issued to this app (see `verifyIdToken`). */
  verifyIdToken(token: string): Promise<VerifiedIdToken> {
    return verifyIdToken(token, {
      clientId: this.clientId,
      keys: this.idTokenKeys,
    });
  }

  /**
   * For an embedded page: verifies the ID token App Bridge handed it, then
   * returns an access token. `offline` (default) reuses the installation's
   * stored offline token, or exchanges the ID token for one and stores it;
   * `online` exchanges it for a one-hour token acting for the dashboard user
   * (not stored).
   */
  async authenticate(
    idToken: string,
    options: { tokenType?: 'offline' | 'online' } = {},
  ): Promise<IdTokenSession> {
    const verified = await this.verifyIdToken(idToken);
    if (options.tokenType !== 'online') {
      const stored = await this.tokens.get(verified.installationId);
      if (stored)
        return { idToken: verified, tokens: stored, exchanged: false };
    }
    const tokens = await this.oauth.exchangeIdToken(idToken, options);
    if (tokens.kind === 'offline') await this.tokens.save(tokens);
    return { idToken: verified, tokens, exchanged: true };
  }

  /** For a headless app: redeems the install code from `auth.callback_url` and stores the tokens. */
  async redeemInstallCode(code: string): Promise<TokenSet> {
    const tokens = await this.oauth.redeemInstallCode(code);
    await this.tokens.save(tokens);
    return tokens;
  }

  /**
   * Verifies a webhook delivery for this app (see `verifyWebhook`).
   * `installationId` says which installations are yours.
   */
  verifyWebhook(
    delivery: WebhookDelivery | Request,
    options: {
      installationId: InstallationCheck;
      testDeliveries?: 'reject' | 'accept';
    },
  ): Promise<VerifiedWebhook> {
    const appId = this.appId;
    if (appId === undefined) {
      throw new TassyirError(
        'INVALID_OPTIONS',
        'appId is required to verify webhooks',
        {
          fix: "Pass appId (your app's numeric id from the developer console, process.env.TASSYIR_APP_ID) to createTassyirApp.",
        },
      );
    }
    const verifyOptions = { ...options, appId, keys: this.webhookKeys };
    return isFetchRequest(delivery)
      ? verifyWebhookRequest(delivery, verifyOptions)
      : verifyWebhook(delivery, verifyOptions);
  }

  /** An Admin API client for an installation, on its stored offline token, refreshed as needed. */
  admin(installationId: string): AdminClient {
    return new AdminClient({
      ...this.#clientOptions(),
      accessToken: ({ rejectedAccessToken }) =>
        this.tokens.getAccessToken(installationId, { rejectedAccessToken }),
    });
  }

  /** An Admin API client on a token you hold (an online token, say). */
  adminWithToken(tokens: TokenSet | string): AdminClient {
    return new AdminClient({
      ...this.#clientOptions(),
      accessToken: typeof tokens === 'string' ? tokens : tokens.accessToken,
    });
  }

  #clientOptions(): Omit<AdminClientOptions, 'accessToken'> {
    const { apiOrigin, fetch, retries, onResponse } = this.#options;
    return { apiOrigin, fetch, retries, onResponse };
  }
}

function isFetchRequest(value: WebhookDelivery | Request): value is Request {
  return (
    typeof (value as Request).arrayBuffer === 'function' &&
    typeof (value as Request).url === 'string'
  );
}

/** `new TassyirApp(options)`. */
export function createTassyirApp(options: TassyirAppOptions): TassyirApp {
  return new TassyirApp(options);
}
