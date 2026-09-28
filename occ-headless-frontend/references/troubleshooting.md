# Troubleshooting OCC calls

Use this file when something fails. For behaviour that works, but differently from what you
expect, see `sap-quirks.md`. Rows marked **(live)** were reproduced on a vanilla 2211-jdk21.19
instance.

## Contents

1. [curl kit](#1-curl-kit)
2. [CORS](#2-cors)
3. [Authentication](#3-authentication)
4. [Cart and checkout](#4-cart-and-checkout)
5. [Catalog, CMS and missing data](#5-catalog-cms-and-missing-data)

## 1. curl kit

Reproduce the call outside the app first. If curl fails too, the problem is the backend or its
configuration, not your code.

```bash
HOST=https://api.example-shop.com      # no trailing slash
SITE=electronics
ORIGIN=https://www.example-shop.com

# Site context: no token, no site segment
curl -s "$HOST/occ/v2/basesites?fields=FULL" -H 'Accept: application/json' \
  | jq '.baseSites[] | {uid, requiresAuthentication, lang: .defaultLanguage.isocode}'

# This backend's API contract (custom fields and endpoints included)
curl -s "$HOST/occ/v2/api-docs" -o occ-api.json

# Anonymous cart + one entry
GUID=$(curl -s -X POST "$HOST/occ/v2/$SITE/users/anonymous/carts?fields=guid" \
  -H 'Accept: application/json' | jq -r .guid)
curl -s -X POST "$HOST/occ/v2/$SITE/users/anonymous/carts/$GUID/entries" \
  -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d '{"product":{"code":"PRODUCT_CODE"},"quantity":1}' | jq '{statusCode, quantityAdded}'

# CORS preflight exactly as the browser sends it (OCC and authorization server)
curl -s -i -X OPTIONS "$HOST/occ/v2/$SITE/users/anonymous/carts" \
  -H "Origin: $ORIGIN" -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type,authorization' | grep -i -E '^HTTP|^access-control'
curl -s -i -X OPTIONS "$HOST/authorizationserver/oauth/token" \
  -H "Origin: $ORIGIN" -H 'Access-Control-Request-Method: POST' | grep -i -E '^HTTP|^access-control'
```

## 2. CORS

CORS errors only happen for calls made **from the browser**. Calls from your BFF have no CORS. Often
the simplest fix is to move the call to the server.

| Symptom | Cause | Fix (backend properties unless stated) |
| --- | --- | --- |
| No `Access-Control-Allow-Origin` on OCC responses | The origin isn't allowed. The default allows only `localhost:4200` | `corsfilter.commercewebservices.allowedOriginPatterns=https://www.example-shop.com http://localhost:3000` |
| **403 "Invalid CORS request" through a local dev proxy**, although the proxy makes the call same-origin (live) | The proxy forwards the browser's `Origin` header. OCC rejects any request whose `Origin` isn't allowed, even POSTs and GETs that aren't cross-origin for the browser | Remove or rewrite `Origin` in the proxy (`react-nextjs.md` → React SPA). Alternatively, allow the dev origin on the backend |
| Preflight fails for `PATCH` or `DELETE` | The method isn't allowed | `corsfilter.commercewebservices.allowedMethods=GET HEAD OPTIONS PATCH PUT POST DELETE` |
| Preflight fails once you send `Authorization` | The header isn't allowed | Add `authorization content-type accept` to `…allowedHeaders` |
| Works without credentials, fails with `credentials: 'include'` | Credentials can't be combined with a `*` origin | List the origins, and set `…allowCredentials=true` |
| **Every request to the authorization server that carries an `Origin` returns 500** (live) | `corsfilter.authorizationserver.allowCredentials=true` is set, but the AS still ships `corsfilter.authorizationserver.allowedOrigins=*`, and Spring refuses that combination | Also override `corsfilter.authorizationserver.allowedOrigins` with explicit origins |
| `/authorizationserver/csrf` returns 403 "Invalid CORS request" (live) | The page was opened without the authorization server's session, or the origin isn't allowed | Always reach the login page through `/oauth/authorize`. Check the AS CORS settings |
| JS can't read a response header, such as a personalization id or `x-total-count` | The header isn't exposed | Add it to `…exposedHeaders` |
| Properties changed but nothing happens | CORS entries stored in the database (`CorsConfigurationProperty`) override properties | Update the database entries (ImpEx or Backoffice) |

On CCv2, set these properties for the aspect that serves the API, in Cloud Portal or `manifest.json`.

## 3. Authentication

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| 400 `unsupported_grant_type` (live) | The password grant (removed in 2211-jdk21), or a grant the client doesn't have | Authorization code + PKCE (`auth.md`) |
| 401 with an empty body from `/oauth/token` (live) | The OAuth parameters were in the URL query and were ignored | Send them in a form body |
| 401 `invalid_client` "Client authentication failed: client_secret" (live) | Wrong secret, a public client used for `client_credentials`, or the wrong client auth method | Check the `OAuthClientDetails` entry |
| Redirect to your callback with `error=invalid_request … code_challenge` (live) | PKCE missing. It's required for confidential clients too | Send `code_challenge` + `code_challenge_method=S256` |
| Authorize shows an HTML error page instead of redirecting (live) | `redirect_uri` doesn't match the registered one exactly (trailing slash, port, scheme) | Register the exact URI, and send it byte for byte |
| Authorize redirects to your callback with `error=invalid_scope` (live) | The requested `scope` isn't on the client (`OAuthClientDetails.scope`), e.g. `openid` or `extended` on a `basic` client | Request only scopes the client lists (usually `basic`), or ask for the scope to be added |
| **Logged out right after login**: the first call gives 401 `InvalidBearerTokenError`, and the refresh gives `invalid_grant` (live) | The authorization code was exchanged twice. The second exchange revokes the first one's tokens | Make the callback single-use (`auth.md` §4) |
| **401 on calls running while a refresh happens** (live) | A refresh revokes the previous access token immediately | Retry once with the new token. Refresh in one place (`auth.md` §7) |
| 400 `invalid_grant` on refresh | The refresh token was already rotated by another request, the session reached its cap, or it was revoked | Single-flight refresh, then sign in again |
| Customers of a browser-only app are logged out about every hour | Public clients have an absolute session cap (live) | Use a confidential client in a BFF, whose sessions slide, or raise the refresh token lifetime |
| 401 `InvalidBearerTokenError` or `InvalidTokenError` from OCC | The access token expired (5 minutes, plus about 60 s of tolerance) or was revoked | Refresh once, retry once |
| 403 `ForbiddenError` or `AccessDeniedError` | The path has another user's id | Use `current` |
| Custom login page: **always `error=bad_credentials`, even with the right password** | The inputs were `disabled` during submit (disabled fields aren't posted), or they are named other than `username` and `password` | Keep the inputs enabled, and use exactly those names plus the CSRF `parameterName` |
| Custom login page: an HTML 403 after submitting (live) | The CSRF token is stale: it rotates, and the session lasts ~5 minutes | Fetch `/csrf` right before submit. Restart the login when it's too old |
| Callback gets `error=invalid_request … placeholder resolution failed : ctx` (live) | `loginPageUri` contains `{ctx}`, but the authorize request sent no `ctx`, or one that isn't base64url, or one longer than 1000 characters | Always send a base64url `ctx`, or drop `{ctx}` from the URI |
| The custom login page opens in the wrong language (live) | `{lang}` falls back to the server's locale when `ui_locales` is missing | Send `ui_locales` on every authorize request |
| An error before the login page appears | The `loginPageUri` host isn't in `authserver.oauthclientdetails.loginpageuri.allowed.hosts` (read at startup) | Set the backend property, then restart |

## 4. Cart and checkout

| Symptom | Cause | Fix |
| --- | --- | --- |
| 400 `CartError` `notFound` right after login | The anonymous `guid` is still used under `users/current`, or a `code` under `anonymous` | Switch to the merged customer cart `code` (`cart-checkout.md` §6) |
| 400 `CartError` `notFound` after checkout or after a long break | The cart became an order, or it expired | Drop the id, and create a cart lazily on the next add. Never loop |
| 401 `InsufficientAuthenticationError` on `users/anonymous/carts/current` (live) | The `current` alias exists only for customers | Keep the anonymous guid |
| **401 `AuthorizationDeniedError` on delivery modes, delivery mode or vouchers for a guest checkout** (live) | The cart is still anonymous: no guest email is set yet | Call `POST …/guestuser` first |
| 400 `CartError` `cannotRestore` "Cart is not anonymous" on merge (live) | The anonymous cart is a guest cart (email set), or the guid no longer exists or was already merged | Read the anonymous cart: `notFound` means drop the cookie; a guest cart means copy its entries (`cart-checkout.md` §6) |
| 400 `JaloObjectNoLongerValidError` or `ModelSavingError` on cart writes, hanging cart calls, or two lines with the same `entryNumber` (live) | Two changes to one cart at the same time. A "failed" write may still have changed the cart | Serialize cart changes. Re-read the cart before any retry (`cart-checkout.md` §8) |
| Add to cart returns 200 but the cart doesn't change | `statusCode` is `noStock`, or `quantityAdded` is 0 | Read the `CartModification` |
| 400 on `PATCH …/entries/{n}` with quantity 0 (live) | 0 isn't accepted as "remove" | Use DELETE |
| 400 `UnsupportedDeliveryModeError` (live) | The delivery mode was set before the address | Set the address first |
| 400 `MissingServletRequestParameterError` on place order (live) | The body was JSON, and `cartId` must be in the query | `POST …/orders?cartId=…` |
| 401 re-reading a guest order (live) | Guest orders need a client token | Use a confidential client's `client_credentials` token in the BFF, or keep the place-order response |
| 400 `VoucherOperationError` (live) | Unknown or unusable voucher code | Show a message next to the voucher input |

## 5. Catalog, CMS and missing data

| Symptom | Cause | Fix |
| --- | --- | --- |
| **400 `ConversionError` "Incorrect field:'…'"** (live) | A name in `fields` doesn't exist on this backend. One wrong name fails the whole call | Remove it, or check `/occ/v2/api-docs` for the right name |
| 400 `UnsupportedLanguageError` or `UnsupportedCurrencyError` (live) | `lang` or `curr` isn't an isocode of the base store, e.g. `de-DE` instead of `de` | Use the values from `/languages` and `/currencies` |
| 404 `UnknownResourceError` on a path that exists (live) | Trailing slash (Spring 6 matches paths strictly) | Remove the trailing slash |
| Product page is 400, not 404 (live) | `UnknownIdentifierError`: the product doesn't exist, or it isn't in the online catalog | Map it to your 404 page |
| 400 `InvalidResourceError` on every call (live) | Wrong base site id | Use a `uid` from `/basesites` |
| **B2B: anonymous catalog calls return 404 `UnknownResourceError`** (live) | The site has `requiresAuthentication=true` | Sign the user in before any catalog call |
| B2B: every `orgUsers/…` call returns 404, even when signed in | `occ.rewrite.overlapping.paths.enabled` is `false` (commercewebservicescommons' default wins over b2bocc's `true`) | Backend: set it to `true` (`b2b.md` §2) |
| Content page 404 `CMSItemNotFoundError` (live) | No page with that label or id; labels don't prefix-match | Render your 404 page |
| **Only 10 CMS components come back** for a longer id list (live) | `cms/components` pages its results, and `pageSize` defaults to 10 | Pass `pageSize` equal to the number of ids, or batch |
| Images broken | The media host is missing, or the `?context=` query was stripped. Some media URLs are just `/medias/?context=…`, with no file name (live) | Prefix the host and keep the query string |
| Next.js: optimized images return 400 | `images.remotePatterns` sets `search: ''`, which forbids the `?context=` query | Leave `search` out for the media host |
| A field is missing in the response | `fields` didn't ask for it (the default is `DEFAULT`) | Request it explicitly |
| Wishlist endpoints: 500 "Wishlist is not implemented" (live), or 404 | The new wishlist API is disabled, or no extension implements it | Ask the backend team, or keep wishlists as saved carts |
| An HTML 403 page instead of OCC JSON, only on some networks | The CCv2 endpoint has an IP filter, and it blocks you at the ingress | Allowlist the egress IPs of your SSR, CI and CDN |
