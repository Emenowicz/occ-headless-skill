# Authentication against the 2211-jdk21 authorization server

Everything marked **(live)** was checked on a vanilla SAP Commerce 2211-jdk21.19 instance.

## Contents

1. [What changed in 2211-jdk21](#1-what-changed-in-2211-jdk21)
2. [Endpoints](#2-endpoints)
3. [Pick a client type and a login page](#3-pick-a-client-type-and-a-login-page)
4. [BFF login flow (default)](#4-bff-login-flow-default)
5. [Custom login page](#5-custom-login-page)
6. [Hosted login page](#6-hosted-login-page)
7. [Refreshing tokens](#7-refreshing-tokens)
8. [Session length](#8-session-length)
9. [Logout](#9-logout)
10. [Registration and passwords](#10-registration-and-passwords)
11. [Browser-only app (no BFF)](#11-browser-only-app-no-bff)
12. [Backend handoff](#12-backend-handoff)
13. [Old patterns (before 2211-jdk21)](#13-old-patterns-before-2211-jdk21)

## 1. What changed in 2211-jdk21

The September 2025 framework update replaced the old `oauth2` extension with `authorizationserver`,
`resourceserver` and `oauth2commons`, which are based on Spring Security 6. The URL prefix is still
`/authorizationserver`.

| Topic | 2211-jdk21 |
| --- | --- |
| Grant types | Authorization code with PKCE (S256), refresh token, and client credentials for confidential clients. **The password grant returns 400 `unsupported_grant_type` (live).** There is no implicit grant |
| PKCE | Required, **for confidential clients too**. An authorize request without `code_challenge` comes back as `error=invalid_request` (live). The verifier is 43 to 128 characters |
| Tokens | JWT access token, `expires_in` ≈ 299 s, plus a refresh token (3600 s by default) that rotates (live) |
| Request format | OAuth parameters go in the form body. When they are in the URL query, they are ignored and the call fails with 401 (live) |
| Client tokens for OCC | Not needed for anonymous calls, registration or password reset (live). **Exception:** re-reading a guest order needs a `client_credentials` token (section 10 and `cart-checkout.md`) |
| Roles | Not in the JWT; the server loads them from the user's groups. Don't read permissions from the token |

## 2. Endpoints

All paths are relative to `{host}/authorizationserver`.

| Path | Method | Used for |
| --- | --- | --- |
| `/oauth/authorize` | GET, as a browser redirect | Starting a login. Its parameters go in the query string, because it's a redirect |
| `/oauth/token` | POST, `application/x-www-form-urlencoded` | Exchanging a code for tokens, refreshing, client credentials |
| `/oauth/revoke` | POST, form | Logout (answers 200 with an empty body) |
| `/csrf` | GET, with credentials | Custom login page: gets the CSRF token |
| `/login` | POST, as a plain HTML form | Custom and hosted login page: sends the credentials |
| `/oauth/jwks`, `/oauth/userinfo`, `/oauth/introspect` | | Standard endpoints that a storefront rarely needs |

Token response (live):

```json
{ "access_token": "eyJ…", "refresh_token": "…", "token_type": "Bearer", "expires_in": 299, "scope": "basic" }
```

A `client_credentials` response has no `refresh_token`.

## 3. Pick a client type and a login page

| Your app | OAuth client | Why |
| --- | --- | --- |
| SSR framework: Next.js, Nuxt, Angular SSR | **Confidential**, used by the BFF | The secret stays on the server. **A confidential client's session slides: every refresh extends it. A public client's session ends at the first refresh token's lifetime, one hour by default (live)** |
| Browser-only SPA | **Public** (no secret) + PKCE | The only option without a server. The user signs in again after about an hour |

| Where the API runs | Login page |
| --- | --- |
| On the storefront's site, e.g. `api.example-shop.com` next to `www.example-shop.com` | **Custom login page** in your app (`loginPageUri`), in your own design |
| On the default CCv2 domain (`api.….model-t.cc.commerce.ondemand.com`) | **Hosted login page** of the authorization server, until the API gets a custom domain on the storefront's site |

The same-site rule comes from SAP: the custom login page must be on the authorization server's
domain or on a subdomain of it. The page relies on the authorization server's session cookies, which
the browser only shares within the same site.

## 4. BFF login flow (default)

```text
browser → GET /auth/login?returnTo=/checkout             (your BFF)
BFF     → 302 {AS}/oauth/authorize?response_type=code&client_id=…&redirect_uri=…
                  &scope=basic&state=…&code_challenge=…&code_challenge_method=S256&ui_locales=de-CH
AS      → shows the custom or hosted login page; the user signs in
AS      → 302 {redirect_uri}?code=…&state=…        (or ?error=…&error_description=…)
BFF     → POST {AS}/oauth/token (form: code, code_verifier, redirect_uri, client auth)
BFF     → sets session cookies, merges the anonymous cart, 302 to returnTo
```

**Step 1: start.** Generate `state` and the PKCE pair, and keep them in a short-lived httpOnly
cookie together with `returnTo`.

```ts
// Web Crypto: works in Node 18+, edge runtimes and browsers.
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function startLogin(uiLocale: string) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));     // 43 characters
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = b64url(new Uint8Array(digest));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const url = new URL(`${AS}/oauth/authorize`);
  url.search = new URLSearchParams({
    response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, scope: 'basic',
    state, code_challenge: challenge, code_challenge_method: 'S256', ui_locales: uiLocale,
  }).toString();
  return { url, state, verifier }; // store state + verifier (+ returnTo) in an httpOnly cookie, ~5 min
}
```

**Step 2: callback.**
1. Check that `state` equals the value in the cookie, then delete the cookie **before** exchanging
   the code.
2. **Exchange each code exactly once.** A second exchange of the same code fails with
   `invalid_grant`, and it also revokes the tokens from the first exchange, so the user is logged
   out right after signing in (live). Double callbacks happen easily: a retry, a reload, React
   StrictMode running an effect twice, two tabs. With the PKCE cookie already deleted, a repeated
   callback finds no verifier and must stop.
3. If the callback carries `error` instead of `code`, show a message and offer to start again. Never
   render `error_description` unescaped.
4. Check that `returnTo` is same-origin, or the callback becomes an open redirect.

**Step 3: exchange the code.** The parameters go in the body. A confidential client authenticates
with HTTP Basic (`client_secret_basic`) or with `client_secret` in the body (`client_secret_post`);
both work (live).

```ts
export async function tokenRequest(params: Record<string, string>) {
  const res = await fetch(`${AS}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Authorization: `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`, // confidential client only
    },
    body: new URLSearchParams(params), // never in the URL
  });
  const body = await res.json();
  if (!res.ok) throw new OAuthError(res.status, body.error, body.error_description);
  return body as { access_token: string; refresh_token?: string; expires_in: number };
}

// tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: verifier })
```

`redirect_uri` must match the registered value exactly. A trailing slash makes authorize show an
HTML error page, and it makes the exchange fail with `invalid_grant` (live).

**Step 4: store the tokens.**
- Store the access token, its expiry (`now + expires_in`) and the refresh token in httpOnly, Secure,
  SameSite=Lax cookies, or in a server-side session store keyed by one session cookie.
- Then merge the anonymous cart (`cart-checkout.md` → Merge at login) before redirecting.

## 5. Custom login page

**Backend prerequisites** (section 12):
- the client's `loginPageUri` points at your page, e.g. `https://www.example-shop.com/login`;
- the page's host is listed in `authserver.oauthclientdetails.loginpageuri.allowed.hosts`;
- the authorization server's CORS allows the page's origin with credentials;
- the page is on the same site as the authorization server (section 3).

**The flow (live):**
1. Your BFF redirects to `/oauth/authorize` as in section 4. The authorization server sets
   `JSESSIONID` (and on CCv2 the `ROUTE` cookie for node affinity), then redirects the browser to
   `loginPageUri` exactly as configured, with no parameters appended.
2. The page loads the CSRF token:
   ```ts
   const csrf = await fetch(`${AS}/csrf`, { credentials: 'include' }).then((r) => r.json());
   // { "parameterName": "_csrf", "token": "…", "headerName": "…" }
   ```
   Without the authorization server's session (the user opened the page directly), `/csrf`
   answers 403. In that case, start the login from your BFF.
3. The page submits a **plain HTML form** to `{AS}/login` with `username`, `password` and a field
   named after `parameterName`. SAP requires a real form submission, not an XHR or `fetch`.
4. The authorization server continues the authorization and redirects to your `redirect_uri` with a
   `code`.

```html
<form method="post" action="https://api.example-shop.com/authorizationserver/login">
  <input name="username" autocomplete="username" required>
  <input name="password" type="password" autocomplete="current-password" required>
  <input type="hidden" name="_csrf" value="…token from /csrf…">
  <button type="submit">Sign in</button>
</form>
```

**Framework traps.** The submit has to stay a native form post:

| Framework | Do this |
| --- | --- |
| React / Next.js | A plain `<form action="https://…/login" method="post">`. No `onSubmit` with `preventDefault`, no server action |
| Vue / Nuxt | No `@submit.prevent` |
| Angular | Add `ngNoForm` (or skip `FormsModule` on this form). No `(ngSubmit)` with `HttpClient` |

**What goes wrong on a working-looking page (live):**
- **A wrong password comes back to your login page as `?error=bad_credentials`.** It lands on the
  `loginPageUri`, not the `redirect_uri`. SAP also documents `error=account_disabled`. Show a
  message and keep the form.
- **Don't disable the inputs while submitting.** Browsers leave `disabled` fields out of a form
  post, and the result looks exactly like a wrong password (`bad_credentials`). To stop double
  submits, disable only the button, or make the inputs `readonly`.
- **A stale CSRF token gets an HTML 403 page** from the authorization server, not JSON. The token
  rotates, and the login session lasts about 5 minutes. Fetch `/csrf` right before the submit, and
  when the user waited too long, start the login again from your BFF.
- **Placeholders in `loginPageUri`:**
  - `{lang}` becomes the `ui_locales` value of the authorize request (`de-CH`). Without
    `ui_locales`, it falls back to the server's default locale, which is probably not your shop's.
    Always send `ui_locales`.
  - `{ctx}` passes the authorize parameter `ctx` through. It must already be **base64url**, at most
    1000 characters. Once `{ctx}` appears in `loginPageUri`, **every** authorize request must send
    `ctx`, or it fails with `error=invalid_request` ("placeholder resolution failed : ctx"). Use it
    for a return path or a pre-filled email.
  - `{redirectUriHost}` becomes the host of your redirect URI.
  - Example: `https://www.example-shop.com/{lang}/login?ctx={ctx}`.

## 6. Hosted login page

When the storefront and the API are on different sites, send the user to the authorization server's
own login page. The flow in section 4 stays the same; just don't set `loginPageUri`.
- A wrong password stays on that page (`/authorizationserver/login?error`), and the user can retry
  there (live).
- Changing how that page looks is backend work. Moving the API to a custom domain on your site
  (section 12) is the better long-term fix, because it enables the custom page.

## 7. Refreshing tokens

```ts
tokenRequest({ grant_type: 'refresh_token', refresh_token: current.refreshToken })
// → store BOTH new tokens: the old refresh token is spent and the old access token is revoked
```

**A refresh revokes the previous access token immediately (live).** Any call still in flight with the
old token gets 401 `InvalidBearerTokenError`. Retry such a call once with the new token.

**When to refresh.**
- Proactively, when less than about 30 s of the access token remain.
- Reactively, on HTTP 401 with `errors[0].type` `InvalidBearerTokenError` or `InvalidTokenError`.
  Handle both, refresh once, retry once. If that fails too, the session is over.
- Don't time anything off the 401. An expired JWT is still accepted for about 60 s after `expires_in`
  (clock-skew tolerance, live), so "no 401 yet" doesn't mean "still valid".

**One refresh at a time.**
- Reusing a refresh token after it was rotated fails with `invalid_grant`, which looks like a logout
  (live).
- The dangerous case isn't two exactly simultaneous refreshes; those both succeeded in the live
  test. It's a *later* request that still holds the old refresh token, for example because it read
  the cookie before another response replaced it.

Guard on every level:
- **Inside one server process:** share one refresh per refresh token, and keep the result a few
  seconds longer. Requests that arrive late with the *old* token then get the new tokens instead of
  spending the old one again.

  ```ts
  type Tokens = { access_token: string; refresh_token: string; expires_in: number };
  const inflight = new Map<string, Promise<Tokens>>();

  export function refreshOnce(refreshToken: string): Promise<Tokens> {
    let p = inflight.get(refreshToken);
    if (!p) {
      p = tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken }) as Promise<Tokens>;
      inflight.set(refreshToken, p);
      // keep the settled promise for late callers, then forget it
      p.finally(() => setTimeout(() => inflight.delete(refreshToken), 10_000)).catch(() => {});
    }
    return p;
  }
  ```

  The map lives in one server instance. It doesn't coordinate several instances, such as
  serverless functions or a Node cluster; the next two points cover those.
- **Across concurrent requests from one browser:**
  - Refresh in a single entry point that runs before the page renders: the Next.js proxy (formerly
    middleware), a Nuxt server middleware, or the Angular SSR request handler. Data calls then only
    read the token.
  - If a refresh still fails with `invalid_grant`, answer the call with 401 and let the client retry
    once. By then the browser may already hold the cookie that another response set.
  - With heavy concurrency, keep tokens in a server-side session store and lock per session.
- **Across browser tabs (SPA):** wrap the refresh in `navigator.locks.request('occ-refresh', …)` and
  share the new tokens over a `BroadcastChannel`.

## 8. Session length

| | Default | Behaviour (live) |
| --- | --- | --- |
| Access token | 300 s | Accepted up to ~60 s past expiry |
| Refresh token | 3600 s | Rotates on every refresh |
| Public client | | **Absolute cap.** Refreshing every 25 s with a 90 s refresh TTL failed at 100 s. Users sign in again once per refresh TTL, one hour by default |
| Confidential client | | **Sliding.** The same test kept refreshing past 120 s. A session lives as long as it's refreshed within the refresh TTL |

- To get longer sessions, ask the backend team to raise the refresh token lifetime, per client
  (`refreshTokenValiditySeconds` on `OAuthClientDetails`) or globally.
- When a refresh finally fails, keep the user's work. The customer cart stays on the server and
  comes back as their current cart after the next sign-in. Send the user to the login with
  `returnTo` set to where they were.

## 9. Logout

```ts
// Confidential client: Basic auth header as in tokenRequest(). Public client: client_id in the body, no secret.
await fetch(`${AS}/oauth/revoke`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuth },
  body: new URLSearchParams({ token: refreshToken, token_type_hint: 'refresh_token' }),
});
```

- Then delete the token cookies **and the cart cookie**, so the next anonymous visitor on this
  browser doesn't keep using the customer's cart.
- The authorization server keeps no single-sign-on session after a login: a new authorize request
  asks for the password again (live). There is nothing more to end on the server side.

## 10. Registration and passwords

- **Registration** (`POST /occ/v2/{site}/users` with JSON `{uid, password, firstName, lastName,
  titleCode?}`) needs no token (live). `titleCode` is optional.
  - If the site enables captcha (`captchaConfig.enabled` in `basesites`), send the token in the
    `sap-commerce-cloud-captcha-token` header.
  - If OTP registration is enabled, also send `verificationTokenId` and `verificationTokenCode`.
- **No automatic login after registration.** Without a password grant there's no way to log the new
  customer in programmatically. Send them through the login flow, where they type the password once
  more, and plan the UX for it.
- **Forgotten password:** `POST /occ/v2/{site}/passwordRestoreToken` with JSON `{"loginId"}` answers
  201 (live). The older `forgottenpasswordtokens` is deprecated.
- **Reset password:** `POST /occ/v2/{site}/resetpassword` with JSON `{"token","newPassword"}`.
- **A password change doesn't revoke the existing tokens (live).** After `PUT users/current/password`
  the old access and refresh tokens kept working. If your security policy requires it:
  1. revoke the refresh token yourself (section 9);
  2. start a new login.
- **Re-reading a guest order** (`GET users/anonymous/orders/{guid}`) returns 401 without a token, and
  200 with a `client_credentials` token of a **confidential** client (live). Do that from the BFF, or
  keep the place-order response for the confirmation page.

## 11. Browser-only app (no BFF)

- Use a **public** client with PKCE and no secret. The browser calls `/oauth/token` itself, so the
  authorization server's CORS must allow the app's origin (section 12).
- Keep tokens in memory. A refresh token in `localStorage` survives reloads but can be stolen by any
  XSS; if you accept that trade-off, say so in the code.
- Sessions end at the public-client cap (section 8), and after a reload without a stored refresh
  token.
- These limits are the usual reason to add even a very small BFF.

## 12. Backend handoff

**OAuth clients** (these rows were imported and used live):

```impex
INSERT_UPDATE OAuthClientDetails; clientId[unique=true]; clientSecret; public; authorities; scope; authorizedGrantTypes; registeredRedirectUri; loginPageUri
; storefront_bff    ; <from a vault> ; false ; ROLE_CLIENT ; basic ; authorization_code,refresh_token ; https://www.example-shop.com/auth/callback ; https://www.example-shop.com/login
; storefront_public ;                ; true  ; ROLE_CLIENT ; basic ; authorization_code,refresh_token ; https://www.example-shop.com/auth/callback ; https://www.example-shop.com/login
```

- Leave `loginPageUri` empty to use the hosted login page.
- Put the scope your code requests (`basic` above) in the handoff. A scope that isn't on the client
  sends authorize back to your callback with `error=invalid_scope` (live).
- If the BFF has to re-read guest orders, it needs a `client_credentials` grant on a confidential
  client. Use a separate client with scope `extended`.

**Rules for any client:**
- A public client has no secret, uses PKCE, and has no `client_credentials` grant.
- Every client has at least one authority and one grant type.
- Redirect URIs are absolute and must match exactly.
- `resourceIds` is deprecated.
- Never give a storefront client `ROLE_TRUSTED_CLIENT`.

**Properties:**

```properties
# every host that serves a custom login page (comma-separated, read at startup)
authserver.oauthclientdetails.loginpageuri.allowed.hosts=www.example-shop.com
# CORS for /csrf (and /oauth/token from a browser app). The AS ships allowedOrigins=* ;
# with allowCredentials=true that default MUST be overridden, or every AS CORS request fails with 500 (live)
corsfilter.authorizationserver.allowedOrigins=https://www.example-shop.com
corsfilter.authorizationserver.allowCredentials=true
# only behind a CDN or proxy that sets X-Forwarded-* headers (2211-jdk21.11 and later)
authserver.enable.forwarded.header=true
```

**Custom domains on CCv2.** Give the API endpoint a domain on the storefront's site in Cloud Portal,
for example `api.example-shop.com` next to `www.example-shop.com`. Without it, only the hosted login
page works.

## 13. Old patterns (before 2211-jdk21)

Older releases used the `oauth2` extension:
- the password grant: `POST /authorizationserver/oauth/token` with `grant_type=password`,
  `username`, `password`, `client_id` and `client_secret`;
- client-credentials tokens for registration, guest checkout, password reset and address
  verification;
- opaque access tokens valid for 12 hours;
- the sample client `mobile_android` / `secret`, which SAP documents as placeholder values to
  replace.

Migrating an old storefront:
1. Move the login to the authorization code flow above.
2. Drop client tokens, except for re-reading guest orders.
3. Handle 5-minute access tokens, refresh token rotation and single-use codes (sections 4 and 7).
4. Switch `forgottenpasswordtokens` to `passwordRestoreToken`.
