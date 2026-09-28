# Vue and Nuxt

This covers Nuxt 3/4 (Nitro server routes as the BFF) and plain Vue with Vite. The OCC logic (auth
flow, cart ids, errors) lives in `auth.md` and `cart-checkout.md`; this file is about where that
logic goes in Nuxt. Follow the project's own conventions for state (Pinia or composables) and
folders.

## Contents

1. [Where the code goes](#1-where-the-code-goes)
2. [Runtime config and secrets](#2-runtime-config-and-secrets)
3. [Server routes as the BFF](#3-server-routes-as-the-bff)
4. [Refreshing tokens in server middleware](#4-refreshing-tokens-in-server-middleware)
5. [Fetching during SSR](#5-fetching-during-ssr)
6. [Caching with routeRules](#6-caching-with-routerules)
7. [Cart state](#7-cart-state)
8. [CMS components and HTML](#8-cms-components-and-html)
9. [Custom login page](#9-custom-login-page)
10. [Vue with Vite, no Nuxt](#10-vue-with-vite-no-nuxt)
11. [Pitfalls](#11-pitfalls)

## 1. Where the code goes

```text
server/utils/occ.ts               occ() from SKILL.md + refreshOnce() (auth.md §7)
server/middleware/occ-auth.ts     refresh before the page renders; token into event.context
server/routes/auth/login.get.ts   PKCE + state cookie → 302 authorize
server/routes/auth/callback.get.ts  single-use exchange, cookies, cart merge, 302
server/routes/auth/logout.post.ts revoke, delete cookies
server/api/cart/*.ts              cart creation and mutations (sets the guid cookie)
server/api/occ/[...path].ts       thin proxy for everything else (token from cookie, no Origin)
composables/useCart.ts            or a Pinia store, if the project has Pinia
components/cms/…                  page renderer + component registry
```

## 2. Runtime config and secrets

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  runtimeConfig: {
    occClientSecret: '',        // NUXT_OCC_CLIENT_SECRET: server only
    occClientId: '',
    occHost: '',
    occSite: '',
    public: { mediaHost: '' },  // anything under public ships to the browser
  },
});
```

- Read the config on the server with `useRuntimeConfig(event)`.
- Nothing secret under `runtimeConfig.public`, because it's serialized into the page. A secret found
  there has already shipped: move it and rotate it.

## 3. Server routes as the BFF

```ts
// server/api/occ/[...path].ts: forwards /api/occ/<path> to OCC with the customer's token
export default defineEventHandler(async (event) => {
  const { occHost, occSite } = useRuntimeConfig(event);
  const path = getRouterParam(event, 'path');
  const token = event.context.occToken as string | undefined;          // set by the middleware (§4)
  const method = event.method;
  const upstream = await $fetch.raw(`${occHost}/occ/v2/${occSite}/${path}`, {
    method,
    query: getQuery(event),
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: ['GET', 'HEAD'].includes(method) ? undefined : await readBody(event),
    ignoreResponseError: true,        // pass OCC errors (and their JSON) through unchanged
  });
  setResponseStatus(event, upstream.status);
  return upstream._data;
});
```

- **Cookies** are handled with h3's helpers: `getCookie`, `setCookie`, `deleteCookie`. Use httpOnly,
  Secure (in production) and SameSite=Lax cookies (`auth.md` §4).
- **The proxy sends no `Origin`** and none of the browser's cookies to OCC. OCC answers 403 to
  origins it doesn't know.
- **Keep auth and anonymous-cart creation in their own routes**, because they set cookies. The
  callback must be single-use: remember consumed `state` values, because a second code exchange
  revokes the first one's tokens.

## 4. Refreshing tokens in server middleware

```ts
// server/middleware/occ-auth.ts
export default defineEventHandler(async (event) => {
  const exp = Number(getCookie(event, 'occ-exp') ?? 0);
  const rt = getCookie(event, 'occ-rt');
  let at = getCookie(event, 'occ-at');
  if (rt && exp - Date.now() < 30_000) {
    const t = await refreshOnce(rt).catch(() => null);   // auth.md §7
    if (t) {
      at = t.access_token;
      setCookie(event, 'occ-at', t.access_token, cookieOpts);
      setCookie(event, 'occ-rt', t.refresh_token, cookieOpts);
      setCookie(event, 'occ-exp', String(Date.now() + t.expires_in * 1000), cookieOpts);
    }
  }
  event.context.occToken = at;   // everything in THIS request uses the fresh token
});
```

- Server middleware runs for every request, pages and API routes alike, before they render. Cookies
  it sets go out with the page response, so the browser keeps the rotated refresh token.
- Don't refresh inside an API route that SSR calls internally. The `Set-Cookie` of that internal
  call doesn't reach the browser unless you copy it with `appendResponseHeader`, and a refresh token
  lost that way means a logout.

## 5. Fetching during SSR

- **`useFetch('/api/…')`** with a relative URL forwards the browser's cookies during SSR (Nuxt uses
  `useRequestFetch`).
- **Plain `$fetch`** during SSR does **not** forward them. Use `useRequestFetch()`, or pass
  `useRequestHeaders(['cookie'])`.
- **Keys.** Give `useFetch`/`useAsyncData` keys that include everything the data depends on: route
  params, `lang`, `curr`. Nuxt dedupes and caches by key.
- **Status codes.** Set 404 for `UnknownIdentifierError` with
  `throw createError({ statusCode: 404, fatal: true })` in the page (`catalog-search.md` §2).

## 6. Caching with routeRules

```ts
routeRules: {
  '/p/**': { swr: 300 },        // public product pages; lang/curr in the path, or vary on them
  '/c/**': { swr: 300 },
  '/cart': { ssr: true },       // never cached
  '/account/**': { ssr: true },
  // never add `cache` or `swr` to /api/occ/** or /api/cart/**: they carry user data
}
```

- `swr` and `isr` cache the rendered HTML and its payload per URL. Use them only for pages whose
  content is the same for every visitor. Keep the mini-cart and account menu client-side, or render
  them through an uncached API call.
- For B2B shops, product pages show customer prices: no page caching at all.

## 7. Cart state

- **One source.** Use a `useState('cart')` composable, or a Pinia store if the project already uses
  Pinia. Fill it from `/api/cart` and update it from every mutation response.
- **One mutation at a time.** Serialize mutations with a promise chain in the store. Parallel adds to
  one cart fail, hang or duplicate lines. Re-read the cart before retrying a failed write
  (`cart-checkout.md` §8).
- **Header badge.** Show `totalUnitCount`, not `totalItems`.

## 8. CMS components and HTML

```vue
<script setup lang="ts">
const registry: Record<string, Component> = {
  CMSParagraphComponent: defineAsyncComponent(() => import('./Paragraph.vue')),
  SimpleResponsiveBannerComponent: defineAsyncComponent(() => import('./ResponsiveBanner.vue')),
  // …
};
defineProps<{ components: CmsComponent[] }>();
</script>
<template>
  <component v-for="c in components" :key="c.uid" :is="registry[componentKey(c)]" v-if="registry[componentKey(c)]" :data="c" />
</template>
```

- **`v-html` doesn't sanitize.** Run CMS HTML and product descriptions through a sanitizer first: the
  project's own, or DOMPurify (isomorphic for SSR). This is one of the few places a new dependency
  is justified.
- **Images.** With `@nuxt/image`, allow the media host, and keep the `?context=` query of OCC media
  URLs.

## 9. Custom login page

```vue
<template>
  <!-- native form post to the authorization server: no @submit.prevent (auth.md §5) -->
  <form method="post" :action="asLoginUrl" @submit="submitting = true">
    <input name="username" autocomplete="username" required :readonly="submitting">
    <input name="password" type="password" autocomplete="current-password" required :readonly="submitting">
    <input type="hidden" :name="csrf.parameterName" :value="csrf.token">
    <button type="submit" :disabled="submitting">Sign in</button>
  </form>
</template>
```

- Use `readonly`, not `disabled`, on the inputs: disabled fields aren't posted, and the result looks
  like `error=bad_credentials`.
- Load the CSRF token in the browser (`onMounted`, `fetch(…, { credentials: 'include' })`). The
  server can't fetch it, because it's tied to the browser's authorization-server session.

## 10. Vue with Vite, no Nuxt

- **Auth.** Use a public client with PKCE (`auth.md` §11) and keep tokens in memory. Coordinate
  refreshes across tabs with `navigator.locks` and `BroadcastChannel`.
- **Dev proxy.** Use the Vite dev proxy with the `Origin` header stripped (`react-nextjs.md` §10 has
  the config). Without that, POSTs get 403 "Invalid CORS request".
- **Code exchange.** Exchange the authorization code once per `state`: a second exchange revokes the
  first one's tokens.

## 11. Pitfalls

- A secret under `runtimeConfig.public`.
- `$fetch` during SSR without forwarding cookies: the customer looks anonymous on the server.
- Refreshing tokens in an internal API call: the rotated refresh token never reaches the browser.
- `swr`, `isr` or `cache` on routes with customer data.
- `v-html` on unsanitized CMS HTML.
- `@submit.prevent` or disabled inputs on the custom login form.
