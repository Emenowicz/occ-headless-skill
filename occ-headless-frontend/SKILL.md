---
name: occ-headless-frontend
description: >
  Builds, reviews and debugs headless storefronts on SAP Commerce Cloud (Hybris) OCC REST APIs
  without Spartacus, in Angular, React / Next.js or Vue / Nuxt. Use it whenever frontend code calls
  or should call OCC (/occ/v2/{baseSiteId}/...): login against the 2211-jdk21 authorization server
  (authorization code + PKCE, custom login page), tokens and sessions in a BFF, anonymous and customer
  carts, cart merge, add to cart, checkout and guest checkout, product and search pages, CMS pages and
  components, SmartEdit, Storyblok or Contentful next to OCC, B2B carts and account payment, CORS and
  401 errors, and the SAP-specific OCC behaviour frontend developers do not expect. Not for Java OCC
  extensions or Spartacus customization.
---

# Headless storefront on SAP Commerce OCC (no Spartacus)

OCC is the REST API of SAP Commerce Cloud, served under `/occ/v2`. This skill covers the frontend
side:
- calling OCC correctly from Angular, React / Next.js or Vue / Nuxt;
- where tokens and cart ids live;
- the SAP-specific behaviour that breaks ordinary REST assumptions.

Backend work (Java controllers, WsDTOs, ImpEx, extensions) belongs to a backend skill. Customizing
Spartacus / Composable Storefront belongs to SAP's own Spartacus skill.

It targets **SAP Commerce Cloud 2211-jdk21**, the September 2025 framework update and later. JDK17
releases can no longer be built. Their OAuth differs, see `references/auth.md` → Old patterns.

The facts in these references were checked against SAP Help, the official OCC OpenAPI spec,
Spartacus' source and a running 2211-jdk21 instance. Use them directly instead of researching them
again. Spend research time on what they don't cover, and on this project's own backend: its
`/occ/v2/api-docs` and its configuration.

## 1. Orient before writing code

1. **Find the site context.** Call `GET {host}/occ/v2/basesites?fields=FULL`. It needs no token and
   no site segment. Note the base site uid, `defaultLanguage`, the store currencies,
   `requiresAuthentication` (typical for B2B) and `urlPatterns`.
2. **Get this backend's API contract.** Call `GET {host}/occ/v2/api-docs` (OpenAPI 3,
   unauthenticated) and generate types from it, for example with
   `npx openapi-typescript <spec-url> -o src/occ/occ.d.ts`. Projects add fields and endpoints, so this
   spec is the contract, not your memory of OCC. Don't invent fields. If the spec is unreachable, ask
   for it, or call the endpoint once with `fields=FULL` and read what comes back.
3. **Read the project.** Look at the framework and its version, rendering mode (SSR, SSG or SPA),
   HTTP client, state management, i18n and routing. Build on what is there, and don't add libraries
   the project doesn't use.
4. **Read the quirks for the area.** Before you touch an area (auth, cart, search, CMS), read its
   section in `references/sap-quirks.md`. Most OCC bugs come from behaviour that looks like plain
   REST but isn't.
5. **Check for a legacy backend.** If the token endpoint accepts `grant_type=password`, the backend
   is an older release. See Old patterns in `references/auth.md`.

## 2. Default architecture

| Concern | Default | Why |
| --- | --- | --- |
| Where OCC is called | From the framework's server, as a BFF: Next.js route handlers and server actions, Nuxt server routes, the Angular SSR server | Client secrets and tokens stay out of the browser, server-to-server calls need no CORS, and token refresh happens in one place |
| Tokens | httpOnly, Secure, SameSite=Lax cookies set by the BFF | Page scripts can't read them, and the browser sends them without app code |
| Login | Authorization code + PKCE with a **confidential** client in the BFF. Use a custom login page (`loginPageUri`) if the storefront shares the authorization server's domain; otherwise use SAP's hosted login page | 2211-jdk21 has no password grant. SAP only allows a custom login page on the same domain or a subdomain. A confidential client's session slides with each refresh, while a public client's ends after the first refresh token's lifetime (one hour by default) |
| Public reads (catalog, content without a user) | Cacheable. The cache key includes site, `lang` and `curr`, plus user group where prices or CMS differ per group | These are the expensive calls, and they rarely change per user |
| User data (cart, account, B2B prices, CMS requested with a user token) | Never in a shared cache | A cache whose key doesn't include the user (page cache, CDN, ISR, `'use cache'`) serves one customer's data to the next visitor, and any cache makes carts stale |
| SSR request state | Per request: site, lang, curr, token and cart id | One server instance serves many users at once |
| SPA without a server | Public client + PKCE, tokens in memory. The session ends on reload or after about an hour | See `references/auth.md`. When login matters, add a small BFF |

Read the framework recipe before writing framework code: `references/react-nextjs.md`,
`references/angular.md` or `references/vue-nuxt.md`.

## 3. The OCC client

Write one small client module, or extend the project's. It must:
- build URLs as `{host}/occ/v2/{baseSiteId}/{path}`;
- always send `lang` and `curr`, using the isocodes from `/languages` and `/currencies`; without
  them OCC falls back to the base store defaults, not the user's choice;
- send `fields` for the use case: small for lists, larger for detail pages. Request only names that
  exist in this backend's spec. **One unknown name fails the whole call with 400 `ConversionError`**,
  so a field you add for one backend can break another. The CMS endpoints (`cms/pages`,
  `cms/components`) accept only the levels `BASIC`, `DEFAULT` and `FULL`. A list of names fails
  there even when every field exists;
- send `Accept: application/json`. OCC negotiates JSON or XML from `Accept`, so don't rely on the
  default;
- send the body in the format the endpoint expects. OCC mixes JSON, form-urlencoded and query
  parameters; see the endpoint tables in the references;
- turn both error formats into one error type. OCC returns
  `{"errors":[{"type","reason","subject","subjectType","message"}]}` and OAuth returns
  `{"error","error_description"}`. Most OCC errors are HTTP 400, so branch on `type` and `reason`,
  not only on status;
- refresh an expired access token **once per session at a time**, then retry. Access tokens live
  about 5 minutes and refresh tokens rotate, so two concurrent refreshes spend the same refresh token
  and log the user out (`references/auth.md`);
- run cart changes one at a time per cart. Concurrent writes to one cart fail, hang or duplicate
  lines. A write that returned an error can still have changed the cart, so **never re-send it
  blindly**: re-read the cart, then decide (`references/cart-checkout.md` §8);
- give server-side OCC calls a timeout (for example `signal: AbortSignal.timeout(8000)`).
  Render the parts that aren't essential without OCC data when a call fails or times out, for
  example a header without the cart count. A slow or failing OCC must not take down every page
  that has a mini cart;
- use the framework's own HTTP primitive: Angular `HttpClient` with interceptors, Nuxt `$fetch`,
  Next.js `fetch`.

```ts
// Server-side core, framework-neutral. Adapt the fetch call to the framework recipe.
export class OccError extends Error {
  constructor(readonly status: number, readonly type?: string,
              readonly reason?: string, readonly subject?: string) {
    super(`OCC ${status} ${type ?? ''} ${reason ?? ''}`.trim());
  }
}

export type OccContext = { site: string; lang: string; curr: string; token?: string };

export async function occ<T>(ctx: OccContext, path: string, init: RequestInit = {}): Promise<T> {
  const url = new URL(`${process.env.OCC_HOST}/occ/v2/${ctx.site}/${path}`); // path may carry ?fields=
  url.searchParams.set('lang', ctx.lang);
  url.searchParams.set('curr', ctx.curr);
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {}),
      ...init.headers,
    },
  });
  const text = await res.text(); // some OCC calls answer 200/201 with an empty body
  const body = text ? JSON.parse(text) : undefined;
  if (res.ok) return body as T;
  const e = body?.errors?.[0];
  throw new OccError(res.status, e?.type ?? body?.error, e?.reason ?? body?.error_description, e?.subject);
}
```

## 4. Task map

| Task | Read |
| --- | --- |
| Login, logout, tokens, sessions, OAuth clients, custom login page | `references/auth.md` |
| Cart, add to cart, cart merge, checkout, guest checkout, place order | `references/cart-checkout.md` |
| Product pages, variants, prices, stock, images, search, facets, category pages, SEO | `references/catalog-search.md` |
| CMS pages and components, navigation, banners, SmartEdit, Storyblok or Contentful next to OCC | `references/cms.md` |
| Registration, profile, addresses, order history, passwords, consents | `references/account.md` |
| B2B: `orgUsers`, account payment, cost centers, replenishment | `references/b2b.md` |
| Something fails: CORS, 401, 400, missing images, empty results | `references/troubleshooting.md` |
| SAP behaviour that surprises frontend developers, and little-known SAP features | `references/sap-quirks.md` |
| Framework specifics | `references/react-nextjs.md`, `references/angular.md`, `references/vue-nuxt.md` |

## 5. Hard rules

Each rule prevents a bug that shows up in real OCC storefronts.

- **Anonymous carts are addressed by `guid`, customer carts by `code`.** Store the anonymous guid in
  an httpOnly cookie. Anyone who has it can read and change that cart, so keep it out of URLs and
  logs.
- **User ids in paths are `anonymous` or `current`.** Use `current` for the signed-in customer, not
  their email: an id that isn't the token's own user needs customer-emulation rights, and without them
  the call returns 403.
- **HTTP 200 from add-to-cart does not mean the product was added.** Read `statusCode` and
  `quantityAdded` from the `CartModification`: a low stock level can add fewer items, or none.
- **Show `formattedValue` for prices.** It carries the store's currency and locale rules. Use
  `value` only for calculations and analytics.
- **Media URLs are relative** (`/medias/...?context=...`). Prefix them with the media host and keep
  the `context` query, which identifies the file.
- **Facet and breadcrumb links come from the response**: `values[].query.query.value` and
  `breadcrumbs[].removeQuery.query.value`. Don't assemble the colon query grammar yourself, except
  the initial category query `:relevance:allCategories:{code}`. Sort codes also come from the
  response (`sorts[]`), because they differ per site.
- **`currentPage` starts at 0.**
- **An unknown product is HTTP 400 `UnknownIdentifierError`, not 404.** Map it to your 404 page, or
  search engines index an error page.
- **Placing an order deletes the cart.** Clear the stored cart id, create the next cart only when
  something is added, and block a second submit while the first is in flight.
- **Guest checkout starts with the email.** Until `POST …/guestuser` sets it, delivery modes,
  delivery mode and vouchers answer 401 on an anonymous cart.
- **Exchange each authorization code exactly once.** A second exchange revokes the tokens from the
  first, so the customer is logged out right after signing in. A refresh, likewise, revokes the
  previous access token: retry in-flight calls once with the new one.
- **A guest cart (email already set) can't be merged at login.** See
  `references/cart-checkout.md`.
- **Nothing secret in browser-visible config.** That means `NEXT_PUBLIC_*`, `VITE_*`, Nuxt
  `runtimeConfig.public` and Angular `environment.ts`, all of which ship to the browser. A client
  secret there is public.
- **Card data never passes through your code to OCC.** Use the payment provider's SDK or hosted
  fields and the endpoints of the project's payment extension. Ask which provider the project uses.
  PSP plugins often place the order through their own endpoint, so read the plugin's OCC API first
  (`references/cart-checkout.md` §9).
- **HTML from CMS and product descriptions comes from editors.** Sanitize it before rendering. Its
  links follow the backend's URL scheme, not your routes, so map them.

## 6. When the backend has to change

Frontend teams often can't change the backend. When a fix needs backend configuration, hand the
backend team a ready snippet from the references, and say what it's for:
- CORS for OCC and the authorization server;
- OAuth clients (confidential for a BFF, public + PKCE for a browser app), including `loginPageUri`
  and its allowed hosts;
- token lifetimes;
- custom domains on CCv2, so the storefront and the API share a site;
- endpoints that are disabled by default.

Don't ask them to loosen security: no `*` origin with credentials, and no `ROLE_TRUSTED_CLIENT` on a
storefront client.

## 7. Verify

- Smoke-test the OCC calls you rely on with curl against the target backend. The commands are in
  `references/troubleshooting.md`.
- Unit-test the error mapping and the cart-id handling with recorded OCC responses, using the
  project's own test runner.
- If the project has end-to-end tests (Playwright, Cypress), cover this path: add to cart as a guest
  → log in (merge) → check out → order confirmation.
