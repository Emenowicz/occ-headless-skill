# React and Next.js

The Next.js parts assume the App Router. Next.js 16 renamed `middleware.ts` to `proxy.ts`; use
whichever file the project already has.

## Contents

1. [Where the code goes](#1-where-the-code-goes)
2. [Configuration and secrets](#2-configuration-and-secrets)
3. [Caching OCC responses](#3-caching-occ-responses)
4. [Cookies and the OCC context](#4-cookies-and-the-occ-context)
5. [Login, callback, logout](#5-login-callback-logout)
6. [Refreshing tokens in the proxy](#6-refreshing-tokens-in-the-proxy)
7. [Cart actions](#7-cart-actions)
8. [Product pages, 404 and images](#8-product-pages-404-and-images)
9. [Custom login page](#9-custom-login-page)
10. [React SPA without Next.js](#10-react-spa-without-nextjs)
11. [Pitfalls](#11-pitfalls)

## 1. Where the code goes

Adapt this layout to the project's own conventions:

```text
lib/occ/client.ts        occ() from SKILL.md; starts with `import 'server-only'`
lib/occ/session.ts       reads cookies → OccContext (site, lang, curr, token, cart id)
app/auth/login/route.ts  GET: PKCE + state, redirect to /oauth/authorize
app/auth/callback/route.ts GET: check state, exchange code, set cookies, merge cart, redirect
app/auth/logout/route.ts POST: revoke, delete cookies
app/actions/cart.ts      'use server' actions: add, update, remove, place order
proxy.ts                 refresh the access token before pages render (middleware.ts before Next.js 16)
```

`import 'server-only'` makes the build fail if a client component imports the OCC client, so a
secret can't slip into a browser bundle. Next.js resolves the import itself at build time.

Add the `server-only` package anyway on TypeScript 6+. There `noUncheckedSideEffectImports` is on
by default, so `tsc` reports the bare import as unresolved unless the package is installed.

## 2. Configuration and secrets

```bash
OCC_HOST=https://api.example-shop.com
OCC_SITE=electronics
OCC_CLIENT_ID=storefront_bff
OCC_CLIENT_SECRET=...            # server only
NEXT_PUBLIC_MEDIA_HOST=https://api.example-shop.com   # public on purpose: it only builds image URLs
```

Next.js inlines a `NEXT_PUBLIC_` value into the browser bundle wherever client code references it.

If you find a client secret there, move it to a server-only variable and move the calls that use
it to the server. Then check whether it has shipped:
- If any client code referenced it in a deployed build, or you can't tell, treat it as leaked and
  have it rotated.
- If nothing ever referenced it, say so instead of claiming it shipped to every visitor.

## 3. Caching OCC responses

| Data | How |
| --- | --- |
| Public catalog and CMS (no token) | `fetch(url, { next: { revalidate: 300, tags: [`product:${code}`] } })`, or `'use cache'` with `cacheTag` / `cacheLife` if the project enables `cacheComponents`. `lang` and `curr` are in the URL, so they are part of the cache key |
| Anything with a customer token, a cart, or B2B prices | `cache: 'no-store'` |

Keep user calls on `no-store`.
- **`fetch` with `force-cache` or `revalidate`.** Next.js keys the Data Cache on URL, method, headers
  and body. A request with a user's own `Authorization` header therefore gets its own cache entry,
  and other users don't receive it. It still goes wrong in two ways: the customer sees a cart that is
  up to `revalidate` seconds stale after every change, and personal data sits in a shared server
  cache.
- **Caches whose key doesn't contain the user** are where user data does leak to other visitors:
  - `'use cache'` functions, keyed only on their arguments;
  - ISR or full-route caching of a page that renders user data;
  - a CDN in front of the storefront;
  - server calls that use one server-side token for everyone.

Reading `cookies()` makes a route dynamic. Keep the parts that depend on the user, such as the
mini-cart and the account menu, in their own dynamic component, so product and category pages stay
cacheable.

## 4. Cookies and the OCC context

- `cookies()` from `next/headers` is async.
- You can **set** cookies only in route handlers, server actions and the proxy. Server Components
  can't set them, so an anonymous cart has to be created inside a server action.

```ts
// lib/occ/session.ts
import 'server-only';
import { cookies } from 'next/headers';

export async function occContext(): Promise<OccContext> {
  const jar = await cookies();
  return {
    site: process.env.OCC_SITE!,
    lang: jar.get('lang')?.value ?? 'en',   // isocodes from /languages
    curr: jar.get('curr')?.value ?? 'USD',  // isocodes from /currencies
    token: jar.get('occ-at')?.value,
  };
}

export const cookieOpts = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production', // Safari drops Secure cookies on http://localhost
  sameSite: 'lax' as const,
  path: '/',
};
```

## 5. Login, callback, logout

`auth.md` §4 has the flow and the PKCE, token and merge helpers. Here is the Next.js wiring:

```ts
// app/auth/login/route.ts
export async function GET(req: NextRequest) {
  const { url, state, verifier } = await startLogin();
  const res = NextResponse.redirect(url);
  const returnTo = req.nextUrl.searchParams.get('returnTo') ?? '/';
  res.cookies.set('occ-pkce', JSON.stringify({ state, verifier, returnTo }), { ...cookieOpts, maxAge: 300 });
  return res;
}

// app/auth/callback/route.ts
const usedStates = new Set<string>(); // one instance; a shared store if the BFF is scaled out

export async function GET(req: NextRequest) {
  const saved = JSON.parse(req.cookies.get('occ-pkce')?.value ?? '{}');
  const p = req.nextUrl.searchParams;
  if (p.get('error') || !p.get('code') || p.get('state') !== saved.state || usedStates.has(saved.state)) {
    return NextResponse.redirect(new URL('/login?failed=1', req.url));
  }
  // A code must be exchanged once: a second exchange revokes the tokens of the first (auth.md §4)
  usedStates.add(saved.state); setTimeout(() => usedStates.delete(saved.state), 600_000);
  const t = await tokenRequest({ grant_type: 'authorization_code', code: p.get('code')!,
    redirect_uri: REDIRECT_URI, code_verifier: saved.verifier });
  const dest = new URL(saved.returnTo ?? '/', req.url);
  const res = NextResponse.redirect(dest.origin === req.nextUrl.origin ? dest : new URL('/', req.url));
  setTokenCookies(res, t);                              // access token, expiry, refresh token
  await mergeAnonymousCart(req, res, t.access_token);   // cart-checkout.md §6
  res.cookies.delete('occ-pkce');
  return res;
}
```

Make logout a `POST` route handler, so that links and prefetching can't log users out. It revokes
the refresh token, then deletes the token cookies and the cart cookie.

## 6. Refreshing tokens in the proxy

Refresh in one place, before pages render. Server Components and actions then only read the token.

```ts
// proxy.ts
export async function proxy(request: NextRequest) {
  const exp = Number(request.cookies.get('occ-exp')?.value ?? 0);
  const rt = request.cookies.get('occ-rt')?.value;
  if (!rt || exp - Date.now() > 30_000) return NextResponse.next();

  const t = await refreshOnce(rt).catch(() => null);         // auth.md §7: one refresh per token per instance
  if (!t) return NextResponse.next(); // leave it to the 401 path; don't log out on a possible race
  const expAt = String(Date.now() + t.expires_in * 1000);
  // Downstream Server Components in THIS request must see the new token...
  request.cookies.set('occ-at', t.access_token);
  request.cookies.set('occ-rt', t.refresh_token!);
  request.cookies.set('occ-exp', expAt);
  const res = NextResponse.next({ request: { headers: request.headers } });
  // ...and the browser must store it for the next requests.
  res.cookies.set('occ-at', t.access_token, cookieOpts);
  res.cookies.set('occ-rt', t.refresh_token!, cookieOpts);
  res.cookies.set('occ-exp', expAt, cookieOpts);
  return res;
}

export const config = {
  matcher: [{
    source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
    // skip next/link prefetches: they would refresh in parallel with the real navigation
    missing: [
      { type: 'header', key: 'next-router-prefetch' },
      { type: 'header', key: 'purpose', value: 'prefetch' },
    ],
  }],
};
```

Several proxy invocations can still run at the same time. Exclude prefetches in the matcher, as
shown: Next.js strips the `next-router-prefetch` header from `request.headers`, so checking for it
inside the function doesn't work.

A refresh revokes the previous access token at once. A data call that started with the old token
gets 401 `InvalidBearerTokenError`: retry it once with the new token. When a call still gets a 401,
answer with 401 and let the client retry once; by then the browser usually holds the new cookie
(`auth.md` §7).

## 7. Cart actions

```ts
// app/actions/cart.ts
'use server';
export async function addToCart(prev: AddResult | null, form: FormData): Promise<AddResult> {
  const ctx = await occContext();
  const jar = await cookies();
  const cartId = await ensureCart(ctx, jar);             // cart-checkout.md §4 (guid for anonymous)
  const uid = ctx.token ? 'current' : 'anonymous';
  try {
    const mod = await occ<CartModification>(ctx, `users/${uid}/carts/${cartId}/entries`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ product: { code: form.get('code') }, quantity: Number(form.get('qty') ?? 1) }),
    });
    return { status: mod.statusCode, added: mod.quantityAdded ?? 0 };
  } catch (e) {
    if (e instanceof OccError && e.type === 'CartError' && e.reason === 'notFound') {
      jar.delete('occ-cart');                            // stale id: forget it, the next add creates a cart
      return { status: 'retry', added: 0 };
    }
    throw e;
  }
}
```

In the client component, use `useActionState(addToCart, null)` and disable the button while
`isPending` is true. That covers double clicks too. Show a notice when `status` isn't `success`.

## 8. Product pages, 404 and images

```ts
// app/p/[code]/page.tsx
export default async function ProductPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const product = await getProduct(code).catch((e) => {
    if (e instanceof OccError && e.type === 'UnknownIdentifierError') notFound(); // OCC says 400, the page says 404
    throw e;
  });
  // ...
}
```

```ts
// next.config.ts: allow OCC media, including their ?context= query
images: { remotePatterns: [{ protocol: 'https', hostname: 'api.example-shop.com', pathname: '/medias/**' }] }
// no `search` key: `search: ''` would forbid the query and every OCC image would fail
```

## 9. Custom login page

The page is rendered in your app, but the credentials go straight to the authorization server
(`auth.md` §5):
- Fetch the CSRF token from the browser in a client component:
  `fetch(`${AS}/csrf`, { credentials: 'include' })`.
- Render a plain `<form method="post" action={`${AS}/login`}>`. No `onSubmit`, no server action,
  no `preventDefault`. The submit must be a real form post.
- Against double submits, disable only the button. **Never disable the inputs**: disabled fields
  aren't posted, and the result looks like a wrong password.
- A wrong password comes back to this page as `?error=bad_credentials`, and your own callback
  failure as `?failed=1`. Show a message for both.
- Put `ui_locales` (the shop language) on the authorize URL. Otherwise `{lang}` in `loginPageUri`
  becomes the server's locale.

## 10. React SPA without Next.js

- There is no server, so use a public client with PKCE (`auth.md` §11), keep tokens in memory, and
  share refreshes across tabs with `navigator.locks` and `BroadcastChannel`.
- Locally, avoid CORS with the Vite dev proxy, and **strip the `Origin` header** in it. The browser
  still sends `Origin: http://localhost:5173` on POSTs, the proxy forwards it, and OCC answers 403
  "Invalid CORS request" for any origin it doesn't know (live):

  ```ts
  // vite.config.ts
  const toOcc = {
    target: process.env.OCC_HOST, changeOrigin: true, secure: false,
    configure: (proxy: any) => proxy.on('proxyReq', (req: any) => req.removeHeader('origin')),
  };
  export default defineConfig({
    server: { proxy: { '/occ': toOcc, '/authorizationserver': toOcc, '/medias': toOcc } },
  });
  ```

  The proxy also puts the login page and the authorization server on one origin during
  development. In production you still need the same site, or the hosted login page.
- `next.config.ts` rewrites forward `Origin` the same way. Proxying browser calls through them runs
  into the same 403. Calls from server code send no `Origin` and are fine.
- In a browser-only React app, don't exchange the code in a bare `useEffect`. StrictMode runs
  effects twice in development, and the second exchange revokes the tokens of the first. Guard it
  with a module-level flag keyed by `state`.
- If the project uses TanStack Query:
  - put `site`, `lang` and `curr` in every query key;
  - invalidate the cart query after each cart change;
  - never persist customer data to storage.

## 11. Pitfalls

- **`NEXT_PUBLIC_*` secrets.** They ship as soon as client code references them. Move them to the
  server, and rotate any that may have shipped (§2).
- **Throwing expected OCC failures from Server Actions.** In production, Next.js replaces a thrown
  error's message with a digest, so the customer sees a generic error. Return a result object for
  outcomes you expect (out of stock, cart gone, validation), and throw only for real faults.
- **Caching user calls.** `force-cache` or `revalidate` on `fetch` gives stale carts. `'use cache'`, ISR or a CDN on pages with user data leak that data to other visitors (§3).
- **Creating the cart in a Server Component.** It can't set the cookie, so the cart id is lost and a
  new cart is created on every request.
- **Refreshing in several places.** Refreshes run concurrently, the rotated refresh token is spent
  twice, and users get random logouts.
- **Calling OCC from client components with a token.** That needs CORS, and the token becomes
  readable by page scripts. Go through a server action or a route handler instead.
- **Building links from `product.url`.** It follows the backend's own URL scheme, not your routes.
  Build routes from the product code, plus a slug from the name if you want one.
