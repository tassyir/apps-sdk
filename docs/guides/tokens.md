---
title: Tokens
description: Learn who is looking from the ID token, get and keep access tokens, and refresh them without locking a merchant out.
order: 50
---

# Tokens

Your server needs two answers before it calls the Admin API: **who is
looking** (which person, business and installation) and **a token to call
with**. The ID token answers the first; offline and online access tokens the
second. `@tassyir/app` handles both, and this guide explains what it does so
you can rely on it.

| Token                | Looks like      | Lives                         | What it is for                                               |
| -------------------- | --------------- | ----------------------------- | ------------------------------------------------------------ |
| Client id            | `app_…`         | forever                       | Names your app. Not a secret.                                |
| Client secret        | `tsy_cs_…`      | until rotated                 | Authenticates your server at the token endpoint. Shown once. |
| ID token             | a JWT (`EdDSA`) | 60 seconds, exchanged once    | Says who is looking at your page. The only proof of it.      |
| Offline access token | `tsy_at_…`      | 1 hour                        | Calls the Admin API as your app. Comes with a refresh token. |
| Refresh token        | `tsy_rt_…`      | 90 days, rotated on every use | Gets a new offline access token.                             |
| Online access token  | `tsy_at_…`      | 1 hour                        | Calls the Admin API for one person. No refresh token.        |
| Install code         | `tsy_ic_…`      | 5 minutes, one use            | A headless app's first tokens.                               |

Every one of them but the client id is a secret: keep it on your server, and
never log it or put it in a page, a URL or a repository.

## Set up the SDK

Create one `TassyirApp` per process. It needs your client id and secret, your
app's numeric id (to verify webhooks), and a **token store**: where each
installation's offline tokens live. A store must be durable (a `set` that
resolved survives a crash) and must return the latest `set`.

```ts
import { createTassyirApp, type TokenSet, type TokenStore } from '@tassyir/app';

/** Your durable storage: a database table, a key-value store. */
export interface KeyValue {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export function createTassyir(kv: KeyValue) {
  // Encrypt the tokens at rest in a real deployment: they are secrets.
  const tokenStore: TokenStore = {
    async get(installationId) {
      const value = await kv.get(`tassyir:tokens:${installationId}`);
      return value === undefined ? undefined : (JSON.parse(value) as TokenSet);
    },
    async set(installationId, tokens) {
      await kv.set(`tassyir:tokens:${installationId}`, JSON.stringify(tokens));
    },
    async delete(installationId) {
      await kv.delete(`tassyir:tokens:${installationId}`);
    },
  };

  return createTassyirApp({
    clientId: setting('TASSYIR_CLIENT_ID'), // app_…
    clientSecret: setting('TASSYIR_CLIENT_SECRET'), // tsy_cs_…
    appId: setting('TASSYIR_APP_ID'), // the numeric id in the console
    tokenStore,
    retries: 3,
  });
}

function setting(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`Set ${name}: see your app in the developer console`);
  return value;
}
```

`MemoryTokenStore` exists for tests only: it forgets everything on restart.
The [`@tassyir/app` README](https://github.com/tassyir/apps-sdk/tree/main/packages/app#example)
has a complete server with a store and a refresh lock.

## Who is looking: the ID token

Your page in the dashboard asks App Bridge for an ID token
([Embedded pages](embedded-pages.md)) and sends it to your server, which
verifies it. **The ID token is the only proof of who is looking.** The address
your page is loaded at, its query string and App Bridge's context are not:
anyone can open your page's URL with any query string. Read the user, the
business and the installation from a verified ID token, nowhere else.

An ID token is a JWT signed with Ed25519 (`alg: "EdDSA"`):

| Claim               | Meaning                                             |
| ------------------- | --------------------------------------------------- |
| `iss`               | `https://api.tassyir.io/apps`                       |
| `aud`               | your client id                                      |
| `sub`               | the dashboard user looking at your page             |
| `bid`               | the business                                        |
| `iid`               | the installation                                    |
| `sid`               | the dashboard tab's session, random                 |
| `locale`            | `ar` or `en`, the dashboard's language              |
| `iat`, `nbf`, `exp` | issued, valid from, expires: 60 seconds after issue |
| `jti`               | the token's id                                      |

`tassyir.verifyIdToken(token)` checks it the way Tassyir does: `alg: EdDSA`
only, the key chosen by `kid` from
`GET https://api.tassyir.io/apps/.well-known/jwks.json` (cached an hour,
fetched again for an unknown `kid`), the signature before any claim, `iss`,
`aud` equal to your client id, and `exp`, `nbf` and `iat` with 30 seconds of
clock leeway. It returns `userId`, `businessId`, `installationId`,
`sessionId` and `locale`.

- **Ask for a new ID token for every request to your server.** It lives 60
  seconds, and the token endpoint accepts each one once.
- Accept ID tokens over https only: one is a bearer credential for a minute.
- A page may ask for 30 ID tokens a minute. A page that calls your server more
  often should batch its requests, or your server can open its own short
  session once it has verified a token.

## Embedded apps: one offline token per installation

`tassyir.authenticate(idToken)` verifies the ID token, then **reuses the
installation's stored offline token**, or exchanges the ID token for one and
stores it. Your server can then call the Admin API as your app for that
installation, from a page request, a webhook or a background job.

```ts
import { TassyirVerificationError } from '@tassyir/app';

// GET /api/business, called by your page with a new ID token as a bearer.
export async function handle(request: Request): Promise<Response> {
  const header = request.headers.get('authorization') ?? '';
  const idToken = /^Bearer (\S+)$/.exec(header)?.[1];
  if (idToken === undefined) return new Response(null, { status: 401 });
  try {
    const { idToken: who } = await tassyir.authenticate(idToken);
    const { data: business } = await tassyir
      .admin(who.installationId)
      .get('/business');
    return Response.json({ business: business.name, user: who.userId });
  } catch (error) {
    if (error instanceof TassyirVerificationError) {
      return new Response(null, { status: 401 }); // not genuine, not yours, or expired
    }
    throw error;
  }
}
```

**Keep the offline token you have.** Each exchange for an offline token
starts a new refresh family, and an installation keeps at most 25: past that,
the oldest families are revoked. An app that exchanged on every page view
would revoke its own tokens.

## Online tokens: acting for a person

An online token acts for the dashboard user who opened your page. What it can
do is your app's scopes **and** that person's own permissions, in your
installation's stores **and** that person's stores. An online token whose
person may only see the orders assigned to them reads only those orders. Use
one when your app must respect what the person looking may see.

```ts
export async function ordersForThisPerson(idToken: string) {
  const session = await tassyir.authenticate(idToken, { tokenType: 'online' });
  // An online token is not stored and cannot be refreshed: it lives an hour.
  const admin = tassyir.adminWithToken(session.tokens);
  const { data } = await admin.get('/orders', { query: { limit: 20 } });
  return data;
}
```

Changes made with an online token are still recorded under your app's name.
Each online exchange spends an ID token: get a new one from the page when the
online token expires.

## Headless apps: the install code

An app with no page (no `admin.page`) and an `auth.callback_url` gets its
first tokens from an **install code**. Right after the install, the dashboard
sends the merchant's browser to your callback with `?code=tsy_ic_…`. The code
is valid 5 minutes, once, and only your client secret can redeem it.

```ts
// GET <auth.callback_url>?code=tsy_ic_…
export async function callback(request: Request): Promise<Response> {
  const code = new URL(request.url).searchParams.get('code');
  if (code === null) return new Response('Missing code', { status: 400 });
  const tokens = await tassyir.redeemInstallCode(code); // stored for you
  return new Response(`Installed on business ${tokens.businessId}`);
}
```

Tassyir never calls your callback itself: the merchant's browser does. Never
log the URL with its code. When the merchant later accepts a version that
changes your scopes, your callback receives a new code the same way.

## Refresh safely

An access token lives one hour. `tassyir.admin(installationId)` refreshes it
when needed, and every refresh **rotates** the refresh token: the old one is
spent.

- A spent refresh token presented again **within 60 seconds** of its rotation
  is accepted (an answer lost on the way).
- Presented **later**, it revokes the whole family: every refresh and access
  token issued from it. The merchant then has to reopen your page (an
  embedded app) or reinstall your app (a headless app).

`@tassyir/app`'s token manager is built so this does not happen:

- At most one refresh runs per installation in a process; concurrent callers
  share its result.
- The rotated token set is written to your store **before** the new access
  token is used. If the write fails, the call fails with
  `TOKEN_STORE_FAILED`, and the set is written again on the next call.
- A refresh whose answer was lost is retried with the same token for at most
  40 seconds, inside the 60-second grace.
- A refresh token the process already rotated is never presented again
  (`REFRESH_TOKEN_ALREADY_USED`), even if a stale store hands it back.

**More than one process?** Then two processes can refresh the same
installation at once. Pass a `refreshLock` (an object with
`withLock(key, task)`, built on a lock your processes share) to
`createTassyirApp`, and keep the tokens in a store every process reads. The
token set is read again inside the lock, so a process that waited uses the
fresh token instead of the spent one.

## When a token stops working

The Admin API answers **401 `APP_TOKEN_INVALID`** for every token it will not
take: expired, revoked, or of an installation that is no longer active. The
answer never says which.

| What happened                                 | What follows                                                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| The access token expired                      | The SDK refreshes it and repeats the call once.                                                                 |
| The merchant accepted a change of scopes      | Every token is revoked; `app/scopes_updated`. The next page view (or a new install code) gets new ones.         |
| The merchant uninstalled the app              | Every token is revoked; `app/uninstalled`. Forget the installation's tokens.                                    |
| Tassyir suspended the installation or the app | Its tokens are revoked, and every call is refused.                                                              |
| A refresh family was revoked                  | The refresh is refused (`invalid_grant`); the SDK drops the stored set, and the next page view exchanges again. |

Forget an installation's tokens with `tassyir.tokens.forget(installationId)`
when you receive `app/uninstalled` or `app/scopes_updated`.

## Client secrets

Create secrets in the console's **Credentials** tab. A secret is shown once;
Tassyir keeps only a hash and its first characters (`tsy_cs_Ab3xY9Qz`), so a
lost secret means a new one.

- **Rotate** by creating a new secret: every active secret keeps working for
  24 more hours, so you can deploy the new one first (a secret already in its
  24 hours keeps its end).
- An app has at most 3 live secrets, and a developer may create 10 an hour.
- **Revoke** a leaked secret in the console: the token endpoint refuses it at
  once. Access tokens already issued live out their hour; refreshing needs a
  live secret.

## The token endpoint, without the SDK

`POST https://api.tassyir.io/apps/oauth/token`, with your client id and
secret as HTTP Basic authentication (never a `client_secret` parameter) and
form-encoded parameters (a flat JSON object works too):

| Grant         | Parameters                                                                                                                                                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ID token      | `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`, `subject_token=<ID token>`, `subject_token_type=urn:ietf:params:oauth:token-type:id_token`, and optionally `requested_token_type=urn:tassyir:params:oauth:token-type:online-access-token` (the default is `…:offline-access-token`) |
| Install code  | `grant_type=authorization_code`, `code=tsy_ic_…`                                                                                                                                                                                                                                                  |
| Refresh token | `grant_type=refresh_token`, `refresh_token=tsy_rt_…`                                                                                                                                                                                                                                              |

```bash
curl https://api.tassyir.io/apps/oauth/token \
  -u "$TASSYIR_CLIENT_ID:$TASSYIR_CLIENT_SECRET" \
  -d grant_type=refresh_token \
  -d refresh_token="$REFRESH_TOKEN"
```

```json
{
  "access_token": "tsy_at_…",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "tsy_rt_…",
  "refresh_token_expires_in": 7776000,
  "scope": "read_orders read_products write_orders",
  "installation_id": "755000000000000001",
  "business_id": "632000000000000001"
}
```

- `refresh_token` and `refresh_token_expires_in` (90 days) come with offline
  tokens only; `user_id` with online tokens only; `issued_token_type` with an
  ID-token exchange only.
- `scope` is the installation's granted scopes, implied ones included. The
  `scope` parameter of the request is ignored.
- Errors are OAuth's `{ "error", "error_description" }`, not problem+json:
  `invalid_client` (401: the client id or secret, or a `client_secret` in the
  body), `invalid_grant` (an ID token, code or refresh token that is invalid,
  expired, used, revoked or another app's), `invalid_request`,
  `unauthorized_client` (the app is suspended), `unsupported_grant_type`,
  `slow_down` (429, with `Retry-After`) and `temporarily_unavailable` (503,
  with `Retry-After`).
- Each app may make 300 token requests a minute.

The full list is in [Errors](errors.md#token-endpoint-errors).
