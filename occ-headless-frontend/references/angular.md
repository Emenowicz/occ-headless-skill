# Angular

This covers standalone Angular with `@angular/ssr`. The OCC logic (auth flow, cart ids, errors)
lives in `auth.md` and `cart-checkout.md`; this file is about where that logic goes in Angular.
Follow the project's own conventions for state (signals, NgRx) and module layout.

## Contents

1. [Where the code goes](#1-where-the-code-goes)
2. [Configuration and secrets](#2-configuration-and-secrets)
3. [The BFF in `server.ts`](#3-the-bff-in-serverts)
4. [HttpClient, interceptors and SSR](#4-httpclient-interceptors-and-ssr)
5. [Transfer cache and caching](#5-transfer-cache-and-caching)
6. [Cart state](#6-cart-state)
7. [CMS components](#7-cms-components)
8. [Custom login page](#8-custom-login-page)
9. [Angular without SSR](#9-angular-without-ssr)
10. [Pitfalls](#10-pitfalls)

## 1. Where the code goes

```text
src/server.ts                     Express + AngularNodeAppEngine; BFF routes go BEFORE the Angular handler
src/server/occ-proxy.ts           /api/occ/*: adds the customer's token from the httpOnly cookie, strips Origin
src/server/auth.ts                /auth/login, /auth/callback, /auth/logout (auth.md §4, §9)
src/server/cart.ts                cart creation / guid cookie (cart-checkout.md §4)
src/app/occ/occ.interceptor.ts    lang/curr/Accept, error mapping, cookie forwarding during SSR
src/app/occ/occ.service.ts        typed calls (types generated from /occ/v2/api-docs)
src/app/cms/…                     page renderer + component registry
```

## 2. Configuration and secrets

- `environment.ts` is compiled into the browser bundle, so a client secret there is public. Keep
  secrets in the SSR server's environment (`process.env.OCC_CLIENT_SECRET`), read only in
  `server.ts` and `src/server/*`.
- The browser only needs your own origin (`/api/occ`) and, if you render images directly, the media
  host.

## 3. The BFF in `server.ts`

Register API routes before the Angular request handler. A thin proxy covers most customer calls:

```ts
// src/server.ts (excerpt)
const app = express();
app.use(express.json());
app.use('/auth', authRouter);              // login/callback/logout: auth.md §4 and §9
app.use('/api/cart', cartRouter);          // creates the anonymous cart, keeps the guid cookie
app.use('/api/occ', occProxy);             // everything else
app.use((req, res, next) => angularApp.handle(req).then((r) => (r ? writeResponseToNodeResponse(r, res) : next())).catch(next));
// (no path argument: works with Express 4 and 5 — keep whatever pattern the generated server.ts uses)
```

```ts
// src/server/occ-proxy.ts: forwards /api/occ/<path> to OCC with the customer's token
export const occProxy: express.RequestHandler = async (req, res) => {
  const token = await validAccessToken(req, res);   // reads the cookie, refreshOnce() when close to expiry (auth.md §7)
  const url = new URL(`${OCC_HOST}/occ/v2/${OCC_SITE}${req.path}`);
  for (const [k, v] of Object.entries(req.query)) url.searchParams.set(k, String(v));
  const upstream = await fetch(url, {
    method: req.method,
    headers: {
      Accept: 'application/json',
      ...(req.is('application/json') ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      // no Origin, no browser cookies: OCC answers 403 to origins it doesn't know
    },
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
  });
  res.status(upstream.status).type(upstream.headers.get('content-type') ?? 'application/json');
  if (token) res.set('Cache-Control', 'private, no-store');   // keeps it out of the transfer cache and shared caches
  res.send(Buffer.from(await upstream.arrayBuffer()));
};
```

- **What stays in dedicated routes.** Keep auth and anonymous-cart creation out of the generic
  proxy, because they set cookies.
- **Form bodies.** Endpoints that expect form data or query parameters (`placeOrder`, delivery
  mode) pass through unchanged. Send their parameters in the query from the Angular side.
- **Proxy settings.** Set `allowedHosts` on `AngularNodeAppEngine` in production. Enable
  `trustProxyHeaders` only behind a trusted proxy.

## 4. HttpClient, interceptors and SSR

```ts
// app.config.ts
provideHttpClient(withFetch(), withInterceptors([occInterceptor])),
provideClientHydration(withHttpTransferCacheOptions({ includeRequestsWithAuthHeaders: false, filter: publicOnly })),
```

```ts
// occ.interceptor.ts
export const occInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api/occ')) return next(req);
  const request = inject(REQUEST, { optional: true });   // Web Request during SSR, null in the browser
  const locale = inject(LocaleService);                   // your own: current lang/curr isocodes
  let r = req.clone({
    setParams: { lang: locale.lang(), curr: locale.curr() },
    setHeaders: { Accept: 'application/json' },
  });
  if (request) {
    // During SSR the server calls itself: make the URL absolute and forward the browser's cookies
    const cookie = request.headers.get('cookie');
    r = r.clone({
      url: new URL(r.url, request.url).toString(),
      ...(cookie ? { setHeaders: { cookie } } : {}),   // no empty header: it would disable the transfer cache for public calls too
    });
  }
  return next(r).pipe(catchError((e) => throwError(() => toOccError(e))));  // both error formats → one type
};
```

- **`REQUEST` from `@angular/core`** is the incoming Web `Request` during SSR, and `null` in the
  browser and at build time. `RESPONSE_INIT` sets the status code, for example 404 for
  `UnknownIdentifierError` (`catalog-search.md` §2).
- **Refreshing during SSR.** If the proxy refreshed the token while serving an SSR sub-request, its
  `Set-Cookie` belongs to that sub-request, not to the page, so the browser never sees it. Refresh
  in an Express middleware that runs before the Angular handler, and set the cookies on the page
  response.

## 5. Transfer cache and caching

- **The HTTP transfer cache** serializes GET responses fetched during SSR into the HTML. If it
  caches customer data, that data lands in the page HTML, and any CDN or page cache serves it to
  other visitors.
- **What it skips depends on the Angular patch line.** Check the installed version.
  - Current patch lines (19.2.x, 20.3.x, 21.2.x and 22) skip requests that carry a `Cookie`,
    `Authorization` or `Proxy-Authorization` header by default. They also skip responses marked
    `Cache-Control: private`/`no-store`/`no-cache`, or with `Set-Cookie`. The 19.2.x line has only
    the header check. (Angular source, `transfer_cache.ts`.)
  - Older patch levels (for example 21.0.x) cache cookie-forwarded requests.
- **Do both, whatever the version:**
  1. Send `Cache-Control: private, no-store` from your BFF on every user-specific response (cart,
     account, anything made with a token).
  2. Add a `filter` that excludes `users/current` and cart paths.

  Never set `includeRequestsWithAuthHeaders: true`.
- **Page caching.** Cache SSR output only for public pages (catalog, CMS as `anonymous`), keyed by
  path + `lang` + `curr`. Pages with customer data are `Cache-Control: private, no-store`.

## 6. Cart state

- **Signals.** Use a service with `signal<Cart | null>()`, filled from `/api/occ/users/{uid}/carts/{id}`.
  Update it from every mutation response.
- **One mutation at a time.** Serialize mutations with a simple queue (a promise chain, or
  `concatMap` over a `Subject`). Parallel adds to one cart fail, hang or duplicate lines. A failed
  write can still have changed the cart, so re-read the cart before any retry
  (`cart-checkout.md` §8).
- **Existing stores.** If the project uses NgRx, add a feature slice instead. Don't introduce a
  second pattern.

## 7. CMS components

```ts
@Component({
  selector: 'cms-slot',
  imports: [NgComponentOutlet],
  template: `@for (c of components(); track c.uid) {
    <ng-container *ngComponentOutlet="registry[key(c)] ?? null; inputs: { data: c }" />
  }`,
})
export class CmsSlotComponent {
  components = input.required<CmsComponent[]>();
  registry = CMS_REGISTRY;      // { CMSParagraphComponent: ParagraphComponent, … }
  key = componentKey;           // cms.md §3: flexType / uid / typeCode
}
```

- **HTML from the CMS.** Bind `content` with `[innerHTML]`. Angular's sanitizer strips scripts and
  unsafe attributes. Don't call `bypassSecurityTrustHtml` on CMS content.
- **Lazy loading.** Load heavy components with `@defer`, or with `loadComponent` in the registry.

## 8. Custom login page

The form must be a native post to the authorization server (`auth.md` §5):

```html
<form ngNoForm method="post" [action]="asLoginUrl">
  <input name="username" autocomplete="username" required [readonly]="submitting()">
  <input name="password" type="password" autocomplete="current-password" required [readonly]="submitting()">
  <input type="hidden" [name]="csrf().parameterName" [value]="csrf().token">
  <button type="submit" [disabled]="submitting()" (click)="submitting.set(true)">Sign in</button>
</form>
```

- `ngNoForm` stops Angular's form handling. Without it, `FormsModule` takes over the submit.
- Use `readonly`, not `disabled`, on the inputs: disabled fields aren't posted, and the result looks
  like `error=bad_credentials`.
- Fetch the CSRF token in the browser with `fetch(…, { credentials: 'include' })`, right before it's
  needed.

## 9. Angular without SSR

- **Auth.** Use a public client with PKCE (`auth.md` §11), keep tokens in a service in memory, and
  share refreshes across tabs with `navigator.locks` and `BroadcastChannel`.
- **Dev proxy.** For `ng serve`, use a JS proxy config (`proxy.conf.js`) and strip the `Origin`
  header in it. OCC answers 403 "Invalid CORS request" to the dev server's origin otherwise.

  ```js
  // proxy.conf.js
  module.exports = {
    '/occ': {
      target: process.env.OCC_HOST, secure: false, changeOrigin: true,
      configure: (proxy) => proxy.on('proxyReq', (req) => req.removeHeader('origin')),
    },
  };
  ```

  If your CLI version ignores `configure`, add the dev origin to the backend's CORS instead.
- **Code exchange.** Guard it so it runs once per `state`, even when a component is created twice.

## 10. Pitfalls

- A secret in `environment.ts` ships to the browser. Move it to the server and rotate it.
- The transfer cache puts user data into cached HTML on older patch levels, and on every version
  with `includeRequestsWithAuthHeaders: true`. Use `filter`, and send `private, no-store` on user
  responses.
- `bypassSecurityTrustHtml` on CMS content.
- `(ngSubmit)` on the custom login form, or disabled inputs during submit.
- Parallel cart mutations from several components. Route them through one queue.
- Calling OCC directly from the browser with a token. Go through `/api/occ` instead.
