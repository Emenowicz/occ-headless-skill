# SAP Commerce quirks for frontend developers

OCC looks like an ordinary REST API, but it behaves in SAP-specific ways that break frontend code
written on REST instincts. Each entry below names one such behaviour and says what to do about it.
The file also lists SAP features that solve common frontend problems and that many teams don't know
exist.

**Before you work on an area, read its section.** Each entry carries its source:

| Tag | Meaning |
| --- | --- |
| **[live]** | Reproduced on a vanilla 2211-jdk21.19 instance |
| **[SAP Help]** | SAP's documentation |
| **[OpenAPI]** | The official OCC spec |
| **[Spartacus]** | SAP's reference storefront: the calls it makes and its workarounds |
| **[inferred]** | Follows from how OCC works |

## Contents

1. [Infrastructure and CCv2](#1-infrastructure-and-ccv2)
2. [Request and response format](#2-request-and-response-format)
3. [Authentication](#3-authentication)
4. [Catalog and search](#4-catalog-and-search)
5. [Cart and checkout](#5-cart-and-checkout)
6. [Account](#6-account)
7. [CMS](#7-cms)
8. [B2B](#8-b2b)

## 1. Infrastructure and CCv2

- **OCC rejects unknown `Origin` headers, even on proxied calls.**
  - A POST or GET carrying an `Origin` that CORS doesn't allow gets **403 "Invalid CORS
    request"** [live].
  - A local dev proxy (Vite, webpack, Next.js rewrites) forwards the browser's `Origin` and runs
    into exactly this. Strip or rewrite `Origin` in the proxy (`react-nextjs.md`). Server-side calls
    send no `Origin` and are fine.
- **The authorization server ships `corsfilter.authorizationserver.allowedOrigins=*`.**
  - Setting `…allowCredentials=true`, which the custom login page's `/csrf` call needs, turns every
    AS CORS request into a 500, because Spring refuses `*` with credentials [live].
  - The backend must override `…allowedOrigins` itself with explicit origins.
- **CORS settings can live in the database.** `CorsConfigurationProperty` items override the
  `corsfilter.*` properties, apply cluster-wide, and can be imported at runtime. If a property change
  has no effect, look there [SAP Help].
- **Overriding a CORS header list replaces its defaults.** A custom `allowedHeaders` must keep
  what the storefront needs:
  - `authorization`, `content-type`, `accept`, `cache-control`, `if-none-match`;
  - `x-anonymous-consents`, `occ-personalization-id`, `occ-personalization-time`;
  - `sap-commerce-cloud-user-id`, `sap-commerce-cloud-captcha-token`.

  Response headers the browser must read go in `exposedHeaders`: `x-anonymous-consents`,
  personalization ids, `x-total-count` [SAP Help].
- **Login depends on the authorization server's session cookies.** `/oauth/authorize` sets
  `JSESSIONID`, plus `ROUTE` on CCv2 for node affinity, and the login page's `/csrf` and `/login`
  calls reuse that session [live][SAP Help]. A proxy or CDN in front of the authorization server has
  to pass both through.
- **A custom login page only works on the authorization server's site** (same domain or a
  subdomain). On CCv2, give the API a custom domain on the storefront's site; otherwise use the
  hosted login page [SAP Help].
- **Behind a CDN, the authorization server needs `authserver.enable.forwarded.header=true`**
  (2211-jdk21.11 and later) to build correct redirect URLs [SAP Help].
- **If `manifest.json` lists the `api` aspect's webapps explicitly, it must include
  `authorizationserver`**, or the token endpoint returns 404 [SAP Help].
- **An IP filter on a CCv2 endpoint answers with an HTML 403 from the ingress, not OCC JSON.**
  Allowlist the egress IPs of SSR servers, CI and CDNs [SAP Help].
- **Media URLs are relative, and some have no file name at all.** Some are just
  `/medias/?context=bWFzdGVy…`, where the query *is* the file [live].
  - Prefix the media host, and keep the query in `src` and `srcset`.
  - In Next.js, don't set `search: ''` in `images.remotePatterns`.
- **Endpoints can be disabled by configuration.**
  - `commercewebservices.api.restrictions.disabled.endpoints` switches endpoints off. Setting it
    replaces SAP's default list [SAP Help].
  - The new wishlist API answered 500 "Wishlist is not implemented" when no extension implemented
    it [live].
  - When an endpoint from the docs fails like this, ask the backend team before debugging your
    code.

## 2. Request and response format

- **One unknown name in `fields` fails the whole call with 400 `ConversionError` "Incorrect
  field"** [live].
  - A field you added for one backend (a custom attribute) breaks the same code on another.
  - Take field names from this backend's `/occ/v2/api-docs`.
- **`fields` decides what exists.**
  - The default level is `DEFAULT`, and fields you didn't ask for are absent.
  - Null values are left out, while empty lists are present (`"entries": []` on an empty cart)
    [live].
  - Call `FULL` once to see what's available.
- **"Not found" is often 400, and the status depends on the resource** [live]:

  | Case | Response |
  | --- | --- |
  | Missing product | 400 `UnknownIdentifierError` |
  | Wrong base site | 400 `InvalidResourceError` |
  | Missing cart | 400 `CartError` `notFound` |
  | Missing CMS page | **404** `CMSItemNotFoundError` |
  | Unknown path, or a trailing slash | 404 `UnknownResourceError` |

  Branch on `errors[0].type` and `reason`. For pages, return a real 404.
- **A trailing slash is a 404.** `/products/489702/` gives `UnknownResourceError`, because Spring 6
  matches paths strictly [live]. Strip trailing slashes in your URL builder.
- **Two error formats.**
  - OCC returns `{"errors":[{type, reason, subject, subjectType, message}]}`.
  - The authorization server returns `{"error","error_description"}`, and a 401 from the token
    endpoint can have an empty body [live].
  - Normalize both into one error type.
- **`subject` names the invalid field.** Map `subject` to form fields. `message` is developer text,
  so show your own translation [SAP Help].
- **`lang` and `curr` must be exact isocodes of the base store.** `de` works; `de-DE` (BCP 47) or
  an unknown code gives 400 `UnsupportedLanguageError` / `UnsupportedCurrencyError` [live].
  - Map between your URL locale and SAP's isocode at the boundary.
  - OCC's language fallback is off, so a missing translation comes back empty [SAP Help].
- **Every endpoint has its own body format:**

  | Format | Used by |
  | --- | --- |
  | JSON | entries, addresses, `guestuser`, `applyVoucher`, registration, password reset |
  | Query parameters | `placeOrder` (`cartId`), `deliveryModeId`, `addressId`, `paymentDetailsId`, merge (`oldCartId`, `toMergeCartGuid`) |
  | Form | reviews, consents |

  Placing an order with a JSON body gives 400 `MissingServletRequestParameterError` [live].
- **Status codes vary.** 201 for creates, 202 for some password calls, and 200 or 204 with an
  **empty body** for others. `PUT deliverymode` answers 200 with no body [live]. Treat any 2xx as
  success, and don't parse empty bodies [OpenAPI].
- **Counts without payloads.** `HEAD products/search` returns `x-total-count` [live]. Useful for
  badges; expose the header in CORS.
- **Wrapped shapes.** Collections are wrapped (`{"carts":[…]}`). Java maps arrive as
  `{"entry":[{"key","value"}]}` [SAP Help][Spartacus].
- **Booleans can be strings.** CMS components have `"container": "false"` [live]. Compare against
  `"true"`, or convert.
- **Dates look like `2026-09-28T10:23:55+0000`**, with no colon in the offset [live]. Some older JS
  engines can't parse it, so normalize the offset before `new Date()`. CMS dates can use another
  format [SAP Help].
- **`+` in a query string arrives as a space.** Encode with `encodeURIComponent`. Angular's default
  `HttpParams` encoder leaves `+` alone [Spartacus].
- **Product responses are browser-cacheable.** They come with `Cache-Control: private, max-age=120`
  and an `ETag` [live]. Expect up to two minutes of staleness in the browser.
- **The spec has no validation metadata** (no lengths, patterns or required markers for text).
  Limits appear only in 400 responses, so put them in your forms [OpenAPI].
- **Send `Accept: application/json`.** OCC negotiates JSON or XML from `Accept`. This setup
  answered JSON without it [live], but SAP documents `Accept` as the switch [SAP Help].

## 3. Authentication

- **There's no password grant, so there's no login by API call.** The password grant returns
  `unsupported_grant_type` [live]. A custom login form posts straight to the authorization server,
  and after registration the customer signs in once more.
- **An authorization code must be exchanged exactly once.** A second exchange fails and also revokes
  the tokens from the first, so the user is logged out right after signing in [live]. Guard against
  double callbacks, such as React StrictMode effects, retries and reloads.
- **A refresh revokes the previous access token immediately** [live]. Calls still in flight with the
  old token get 401 `InvalidBearerTokenError`; retry them once with the new token.
- **Refresh tokens rotate.** Reusing a rotated refresh token fails with `invalid_grant` [live].
  Share one refresh per session, and keep the result a few seconds for late callers (`auth.md` §7).
- **Public clients have a hard session cap; confidential clients slide** [live].
  - A public client's refreshes stop working at the first refresh token's lifetime, one hour by
    default [SAP Help].
  - A confidential client keeps refreshing as long as it does so within the refresh TTL. That is a
    strong reason for a BFF.
- **Expired tokens keep working for about 60 seconds** (JWT clock-skew tolerance) [live]. Refresh
  proactively from `expires_in`, and don't infer validity from the absence of a 401.
- **PKCE is required for confidential clients too.** Without `code_challenge`, the callback gets
  `error=invalid_request` [live].
- **OAuth parameters in the URL are ignored.** Put them in the form body; otherwise the result is a
  401 with an empty body [live].
- **`redirect_uri` must match exactly.** A trailing slash makes authorize show an HTML error page
  and makes the exchange fail with `invalid_grant` [live].
- **Custom login page, the form itself:**
  - It must be a real HTML form post [SAP Help].
  - **Disabled inputs aren't posted**, and the result looks like `error=bad_credentials` [live].
  - A wrong password comes back to the login page as `?error=bad_credentials` [live].
  - A stale CSRF token gets an HTML 403 page. Fetch `/csrf` right before submit; the session lasts
    ~5 minutes [live].
- **Custom login page, placeholders:**
  - `{lang}` = `ui_locales`. Without it you get the server's locale, so always send `ui_locales`
    [live].
  - `{ctx}` makes the `ctx` parameter mandatory on every authorize request. It must be base64url,
    at most 1000 characters [live].
- **No single-sign-on session after login.** A new authorize request asks for the password again
  [live], so there's no hidden auto-login on shared computers.
- **A password change doesn't revoke tokens.** After `PUT users/current/password`, the old access
  and refresh tokens kept working [live]. If that matters, revoke them yourself.
- **Client tokens are gone, except for guest orders.**
  - Registration, password reset and anonymous carts need no token [live].
  - Re-reading a guest order needs a confidential client's `client_credentials` token [live].
- **Roles aren't in the JWT.** The server loads them from user groups. Don't decide what the UI
  shows from token claims [SAP Help].
- **Isolated base sites decorate user ids.** With `isolated: true` in `basesites`, customer uids
  are `email|siteUid` [SAP Help][Spartacus].
- **Swagger UI can call OCC for you.** `/occ/v2/swagger-ui.html` redirects to the UI [live], which
  is quicker than writing code while exploring an endpoint.

## 4. Catalog and search

- **Product and category URLs from OCC are accelerator paths.** For example
  `/Open-Catalogue/Cameras/…/p/489702` [live]; facet values carry
  `url: "/search?q=…"` too [live].
  - Build your own routes from codes.
  - Parse `/p/{code}` and `/c/{code}` when you meet these paths in CMS links or
    `keywordRedirectUrl`.
- **Product names in search results contain HTML**, e.g.
  `DIGITAL <em class="search-results-highlight">CAMERA</em>` [live]. Render them sanitized, or strip
  the tags for plain text such as `alt` or meta.
- **A colon in the search text breaks the query grammar.** `usb:c cable` became the text `usb`,
  and the rest was lost [live]. Remove `:` from user input.
- **Facet links come ready-made.**
  - Select a value with `facets[].values[].query.query.value`; remove a filter with
    `breadcrumbs[].removeQuery.query.value` [live].
  - Decode the value; `+` stands for a space.
  - Don't build `text:sort:facet:value` yourself.
- **Category pages query `allCategories`:** `:relevance:allCategories:{code}` [live].
- **Sort codes are per site** (`relevance`, `topRated`, `name-asc`, `price-asc`, …). Take them from
  `sorts[]` [live].
- **`currentPage` starts at 0** [live].
- **Suggestions are phrases:** `products/suggestions` returns `{"suggestions":[{"value":"cameras"}]}`
  [live]. For product previews, also run a small search.
- **Fetch several products at once** with `products/search?filters=code:a,b` [live]. Up to 100 per
  page [OpenAPI].
- **Keyword redirects:** when search returns `keywordRedirectUrl`, navigate there [Spartacus].
- **Base products** usually have `purchasable: false` and only a `priceRange`. Make the customer
  pick a variant [Spartacus].
- **Stock:** `stockLevel` can be missing, and `isValueRounded: true` means "at least N" [Spartacus].
- **Noisy facets:** Spartacus hides facets where every value count equals the total, and shows
  `topValues` first [Spartacus].
- **Search results can lag behind the catalog** until Solr re-indexes. A removed product can still
  show up and then fail on the PDP (400), so handle that gracefully [SAP Help][inferred].
- **Images:**
  - `format` (`zoom`, `product`, `thumbnail`, `cartIcon` in sample data) × `imageType` (`PRIMARY`,
    `GALLERY`) × `galleryIndex` [live][Spartacus].
  - Group by `galleryIndex`, and build `srcset` from the formats.

## 5. Cart and checkout

- **Anonymous carts are addressed by `guid`, customer carts by `code`.** Mixing them gives 400
  `CartError` `notFound` [live].
- **The guid works like a password for that cart.** Keep it in an httpOnly cookie, never in URLs
  or logs [inferred].
- **HTTP 200 from add-to-cart doesn't mean success.** Read `statusCode` and `quantityAdded` from
  the `CartModification` (keys: `entry`, `quantity`, `quantityAdded`, `statusCode`) [live].
- **Badge = `totalUnitCount`.** `totalItems` counts lines: 3 lines holding 4 units show
  `totalItems` 3 [live].
- **`entryNumber` renumbers after a delete** [live]. Take entry numbers from the latest cart, or find
  the entry by product code.
- **Quantity 0 isn't a delete.** `PATCH` with 0 gives 400 [live]. Use `DELETE`.
- **Parallel writes lose, duplicate or hang.**
  - Six parallel adds produced two successes, one `JaloObjectNoLongerValidError` and three
    `ModelSavingError`, and the cart ended with 2 of 6 [live].
  - In another run, two of three adds failed with `ModelSavingError`, yet the cart held two lines of
    the product, both with `entryNumber` 0 [live]. Some parallel requests hung for minutes [live].
  - Serialize cart writes. After a failed write, re-read the cart before you retry
    (`cart-checkout.md` §8). The error names depend on the database.
- **Currency switches re-price the cart.** The same cart showed $261.16 with `curr=USD` and ¥22,240
  with `curr=JPY` [live]. Reload the cart after switching.
- **Guest checkout: set the email first.** On an anonymous cart, delivery modes, delivery mode and
  vouchers answer 401 `AuthorizationDeniedError` until `POST …/guestuser` is done [live].
- **A guest cart has `user.name: "guest"` and a new GUID as uid** [live]. It can't be merged at
  login (`CartError` `cannotRestore`) [Spartacus].
- **`cannotRestore` also means "that anonymous cart is gone".** A merge with a guid that no longer
  exists, or was already merged, gives the same 400 `cannotRestore` "Cart is not anonymous", not
  `notFound` [live]. Read the anonymous cart to tell the two cases apart (`cart-checkout.md` §6).
- **Delivery modes need an address.** Before it, the list is empty and `PUT deliverymode` gives
  `UnsupportedDeliveryModeError` [live].
- **OCC may accept an incomplete delivery address.** An address with an empty first name and only a
  country was stored (201) [live]. Validate in the frontend.
- **Placing an order.**
  - `cartId` goes in the query; `termsChecked` isn't required on B2C [live], but B2B requires it
    [OpenAPI].
  - The order's guid equals the cart's guid [live].
  - It isn't idempotent: block double submits, and after a timeout check the order history before
    reporting a failure [Spartacus].
- **The cart disappears after the order.** Reading it gives `CartError` `notFound` [live]. Clear the
  stored id.
- **The `current` alias is customer-only.** `users/anonymous/carts/current` answers 401 [live].
- **Validate before payment.** `POST …/validate` returns stock and quantity-limit changes [live].
- **Deprecated but still answering** [live][OpenAPI]:
  - `PUT …/email`, replaced by `guestuser` or `setEmail`;
  - `POST`/`DELETE …/vouchers`, replaced by `applyVoucher` / `removeVoucher`;
  - `PATCH …/save`, replaced by `savedCart`.

  Don't build new code on them.
- **Carts disappear on their own.** Each site's cart-removal job (`electronics-CartRemovalJob`,
  daily at 04:05 in the sample data) removes anonymous carts after 14 days and others after 28. The
  ages are per site (`BaseSite.anonymousCartRemovalAge`, `cartRemovalAge`) [live]. Recover from
  `notFound`.
- **Converting a guest into a customer** (`POST users?guid&password`) still worked, although it's
  undocumented, but it returned `active: false` [live]. It failed with `ModelSavingError` when the
  guest had no name [live]. Prefer a normal registration.
- **Regions:** send `isocode` (`US-NY`); `isocodeShort` (`NY`) is display-only [live].

## 6. Account

- **Registration needs no token** [live].
  - It may need `sap-commerce-cloud-captcha-token` when `captchaConfig.enabled` [OpenAPI].
  - With OTP registration enabled, it needs `verificationTokenId`/`Code` [OpenAPI].
- **Password reset links in emails point at the accelerator storefront** by default. They are built
  from `website.<site>.https`, with the path `/login/pw/change?token=`. The backend sets the
  property to your storefront, and your app needs that route [SAP Help][Spartacus].
- **Anonymous consents travel in `X-Anonymous-Consents`.** It must be in the CORS allowed and exposed
  headers, and the consents must be transferred after signup [Spartacus][SAP Help].
- **Reviews:** since jdk21.7 the author is anonymized by default. Show `alias` [SAP Help].
- **Little-known features:** product interests ("tell me when it's back in stock") and customer
  coupons. Check this backend's `/occ/v2/api-docs` before you build your own [Spartacus].

## 7. CMS

- **Use the user-level endpoints.** `users/{anonymous|current}/cms/pages|components` are current;
  the site-level `cms/…` endpoints are deprecated but still answer [OpenAPI][live].
- **CMS can differ per user.** Restrictions (user group, time) filter components on the server, so
  don't put a page requested with a customer token into a shared cache [SAP Help].
- **CMS endpoints accept only `fields` levels.** `BASIC`, `DEFAULT` and `FULL` work. A list of names,
  even real ones such as `uid` or `title`, gives 400 `ConversionError` [live]. Use `DEFAULT`.
- **`cms/components` returns 10 results unless you pass `pageSize`.** 14 ids came back as 10
  [live]. Always send `pageSize` equal to the number of ids, in batches of up to 50 [Spartacus].
- **A missing content page is a 404 `CMSItemNotFoundError`**, and labels don't prefix-match [live].
  Look pages up with `pageLabel`, `pageId` or `pageLabelOrId` [live].
- **Page SEO data is on the page:** `title`, `label`, `robotTag` (for example `INDEX_FOLLOW`)
  [live].
- **Navigation nodes** have `children`, `entries`, `uid` and `uuid`. Entries point at link
  components by id, so batch-fetch those components [live][Spartacus].
- **Lists inside components are space-separated strings**, e.g. `productCodes` [Spartacus]. Split
  them, then fetch in one call.
- **The component key isn't always `typeCode`:** it's `flexType` for `CMSFlexComponent` and `uid`
  for `JspIncludeComponent` [Spartacus]. Accelerator content includes `JspIncludeComponent` [live].
- **`contentSlot` can be a single object** instead of an array [Spartacus]. Normalize before
  mapping.
- **Responsive banners:** `media` is either one image or a map keyed by format, with no sizes.
  Build a `<picture>` or `srcset` [SAP Help][Spartacus].
- **SAP personalization uses headers.** Read `Occ-Personalization-Id` and `-Time`, send them back,
  and expose them in CORS [SAP Help].
- **Preview codes:** `basesites` has `defaultPreviewProductCode`, `defaultPreviewCategoryCode` and
  `defaultPreviewCatalogId` for previewing templates [live].
- **Editors write HTML.** Paragraphs and descriptions are HTML with backend-style links and relative
  media. Sanitize them, map the links, and prefix the media host [inferred].

## 8. B2B

- **A site with `requiresAuthentication=true` answers anonymous catalog calls with 404
  `UnknownResourceError`, not 401** [live]. CMS still answers [live]. Sign the user in before any
  catalog call.
- **The B2B API mixes `orgUsers/…` and `users/…`, and the wrong one fails** [live]:
  - these go to `orgUsers`: add entries (`orgUsers/{u}/carts/{c}/entries?quantity=&code=`,
    query params), the delivery address, place order (`orgUsers/{u}/orders?cartId&termsChecked=true`,
    where `termsChecked` is required), replenishment and reorder;
  - these go to `users`: read the cart (`GET orgUsers/…/carts/{c}` gives `ClassCastError`),
    `PATCH`/`DELETE` entries (405 under `orgUsers`), payment type and cost center;
  - `GET users/current` and `POST users/…/entries` answer 401 "not allowed … from the current
    channel". The current user comes from `orgUsers/current`.
- **Paying on account restricts the delivery address** to the cost center's unit addresses
  (`costcenters?fields=DEFAULT,unit(BASIC,addresses(DEFAULT))`) [Spartacus].
- **Prices are per customer** (unit, price group). Never serve them from a shared cache
  [inferred].
- **Little-known features:** reorder from an order, scheduled replenishment, future stock, volume
  prices (`volumePrices`) [Spartacus].
