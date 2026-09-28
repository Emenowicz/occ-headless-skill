# CMS: SAP WCMS pages and components, SmartEdit, external CMS

**(live)** marks behaviour checked on a vanilla 2211-jdk21.19 instance with the accelerator sample
content. Paths are relative to `{host}/occ/v2/{baseSiteId}/`, and every call carries `lang` and `curr`.

## Contents

1. [Endpoints](#1-endpoints)
2. [Page and slot shape](#2-page-and-slot-shape)
3. [Rendering: a component registry](#3-rendering-a-component-registry)
4. [Component data you have to fetch](#4-component-data-you-have-to-fetch)
5. [Common component types](#5-common-component-types)
6. [SEO, 404 and caching](#6-seo-404-and-caching)
7. [SmartEdit in a custom frontend](#7-smartedit-in-a-custom-frontend)
8. [An external CMS next to OCC](#8-an-external-cms-next-to-occ)

## 1. Endpoints

**Use the user-level endpoints.** `users/{userId}/cms/…` is current, and the site-level `cms/…`
endpoints are deprecated but still answer (live).

| Page | Request |
| --- | --- |
| Homepage | `GET users/anonymous/cms/pages` (no parameters) |
| Content page | `GET users/anonymous/cms/pages?pageType=ContentPage&pageLabel=/faq` (or `pageId=faq`) |
| Product page layout | `GET users/anonymous/cms/pages?pageType=ProductPage&code={productCode}` |
| Category page layout | `GET users/anonymous/cms/pages?pageType=CategoryPage&code={categoryCode}` |
| Component data | `GET users/anonymous/cms/components?componentIds=a,b,c&pageSize=3&fields=DEFAULT` |

- Use `current` instead of `anonymous` when a customer is signed in: CMS restrictions (user group,
  time) are evaluated for that user.
- `pageLabelOrId` still works, but it's deprecated (live).
- Labels start with a slash (`/faq`) and must match exactly; there is no prefix matching (live).
- **`fields` takes only a level here: `BASIC`, `DEFAULT` or `FULL`.** A list of names fails even
  when every field exists (live).
  - `fields=uid`, `title` or `name,title,robotTag` on pages give 400 `ConversionError`, and
    `fields=contentSlots` gives 400 `MappingError`. `fields=uid,typeCode,content` on components gives
    400 as well.
  - Use `DEFAULT`, as Spartacus does.

## 2. Page and slot shape

```text
page: uid, uuid, typeCode, template, name, title, label, robotTag,
      contentSlots.contentSlot[]: { slotId, slotUuid, position, components.component[] }   (live)
component: uid, uuid, typeCode, name, modifiedtime, container: "false", …type-specific fields (live)
```

- **Layout.** `template` (e.g. `LandingPage2Template`, `ProductDetailsPageTemplate`) decides the
  layout, and slots attach to it by `position` (`Section1`, `SiteLogo`, …). Keep a map from template
  to your layout component.
- **Normalize before rendering.** `contentSlot` can be a single object instead of an array, and
  Spartacus wraps it in an array. Treat `components.component` the same way for safety.
- **Booleans arrive as strings.** `"container": "false"`, `"external": "false"` (live). Compare
  against `"true"`.
- **CMS dates** look like `2026-09-28T12:19:10.401+02:00` (live), a different format from order
  dates.

## 3. Rendering: a component registry

Map the component key to your own component. The key isn't always `typeCode`:

```ts
function componentKey(c: CmsComponent): string {
  if (c.typeCode === 'CMSFlexComponent') return c.flexType!;   // e.g. "ProductAddToCartComponent"
  if (c.typeCode === 'JspIncludeComponent') return c.uid;       // accelerator JSP includes
  return c.typeCode;
}

const registry: Record<string, Component> = {
  CMSParagraphComponent: Paragraph,
  SimpleResponsiveBannerComponent: ResponsiveBanner,
  ProductCarouselComponent: ProductCarousel,
  NavigationComponent: Navigation,
  CMSLinkComponent: CmsLink,
  // …
};

// Unknown keys render nothing in production, and a visible placeholder in development.
```

- **Accelerator content** contains `JspIncludeComponent`s pointing at JSPs, e.g.
  `page: "/WEB-INF/views/…"` for the cookie notice (live). Map the ones you need, and render nothing
  for the rest.
- **One registry for the whole app.** Framework recipes show how to render dynamic components:
  React maps to elements, Vue uses `<component :is>`, Angular uses `NgComponentOutlet`.

## 4. Component data you have to fetch

**Components that reference other data**

| Component | What to fetch |
| --- | --- |
| `NavigationComponent`, `CategoryNavigationComponent`, `FooterNavigationComponent` | Their `navigationNode` has `children`, `entries`, `uid` and `uuid`. Entries only point at components: `{"itemId":"QuickOrderLink","itemType":"CMSLinkComponent","itemSuperType":"AbstractCMSComponent"}` (live). Collect the `itemId`s of the whole tree and fetch them in one components call |
| `ProductCarouselComponent` | `productCodes` is one space-separated string. Split it, then fetch the products in one call: `products/search?filters=code:a,b,…` (`catalog-search.md`) |
| `CMSTabParagraphContainer` and other containers | `components` is a space-separated string of uids. Fetch them with the components call |

**The components call pages its results.** `cms/components?componentIds=…` returns **10 results
unless you pass `pageSize`**: 14 ids came back as 10 (live). Always send `pageSize` equal to the
number of ids, keep batches at 50 or fewer, and add `productCode` or `categoryCode` on product and
category pages.

## 5. Common component types

| Type | Render with |
| --- | --- |
| `CMSParagraphComponent` | `content` is HTML written by editors. Sanitize it, rewrite its links (backend-style `/…/c/{code}`, `/…/p/{code}`), and prefix relative media URLs |
| `SimpleBannerComponent` | `media` (one image), `urlLink`, `external` (a string) (live) |
| `SimpleResponsiveBannerComponent` | `media` is a map keyed by format, `{desktop, tablet, mobile, widescreen}`, each `{code, mime, altText, url}` (live). Build a `<picture>` with one `<source>` per format |
| `RotatingImagesComponent` | `banners` is a space-separated string of banner uids |
| `CMSLinkComponent` | `url`, or `contentPage` / `contentPageLabelOrId`, or `category` / `product`. `external` is a string (live). Resolve to your routes |
| `BreadcrumbComponent`, `SearchBoxComponent`, `MiniCartComponent` | No useful data. Render your own component |
| `CMSFlexComponent` | Key by `flexType`. It's a placeholder for a feature your code implements |

## 6. SEO, 404 and caching

- **Metadata:** `title`, `label` and `robotTag` (e.g. `INDEX_FOLLOW`, live) are on the page. Turn
  `robotTag` into `<meta name="robots">` (`INDEX_FOLLOW` becomes `index,follow`).
- **Missing pages:** a missing content page is **404 `CMSItemNotFoundError`** (live), while a
  missing product is 400. Map both to your 404 page with a 404 status.
- **Caching:**
  - Pages requested as `anonymous` can be cached per site + `lang`, with invalidation on publish
    or a short TTL.
  - A page requested as `current` can differ per user because of restrictions, so it never goes
    into a shared cache.
  - Personalization is off by default. When SAP personalization is on, round-trip
    `Occ-Personalization-Id` and `Occ-Personalization-Time`, and don't share caches at all.

## 7. SmartEdit in a custom frontend

SmartEdit loads your storefront in an iframe and needs a contract from it. This follows Spartacus'
SmartEdit library and SAP's documentation:

1. **Backend setup.**
   - The storefront URL is in SmartEdit's `whiteListedStorefronts` configuration. The key doesn't
     exist by default: `smarteditwebservices/v1/configurations` held only
     `contentSanitizeEnabled`, `defaultToolingLanguage`, `navigationEntryDisplayed` and
     `storefrontPreviewRoute` (live).
   - The site's `previewURL` points at your storefront. In the sample data it's an unresolved
     placeholder, `$config-storefrontContextRoot/?site=electronics` (live).
   - The storefront URL matches one of the CMSSite `urlPatterns`. Preview tickets
     (`POST /previewwebservices/v1/preview`) resolve the site from the `resourcePath`.
     `http://localhost:3000/` got 400 "No site for resource path found", while
     `http://localhost:3000/?site=electronics` got 201 with a `ticketId` (live).
   - `storefrontPreviewRoute` is `cx-preview` (live). For pages without a URL, SmartEdit may open
     `{previewURL}/cx-preview?cmsTicketId=…`. Implement that route, or ask for the setting to be
     changed.
2. **Framing.** Your storefront must allow being framed by the SmartEdit origin: CSP
   `frame-ancestors` and no `X-Frame-Options: DENY`.
3. **Preview mode.**
   - SmartEdit opens your storefront with a `cmsTicketId` query parameter.
   - Add `cmsTicketId` to every OCC call whose path contains `/cms/` or `/products/`, so staged
     content and products show.
   - **Keep the ticket where the code that renders can see it.**
     - Client-side rendering: keep it in memory or `sessionStorage`.
     - Server rendering (Next.js, Nuxt, Angular SSR): the server must get it on every request.
       Keep `cmsTicketId` on the internal links while in preview. The alternative is a cookie with
       `SameSite=None; Secure` (plus `Partitioned` where supported), because the storefront runs
       inside SmartEdit's iframe on another site: a `SameSite=Lax` cookie isn't sent there, and
       some browsers block third-party cookies altogether. The URL is the more robust carrier.
   - **Render preview pages uncached.**
   - **Load `webApplicationInjector.js` only in preview mode**, with
     `data-smartedit-allow-origin="<smartedit-host>:<port>"`.
     - The `/smartedit` webapp doesn't serve that file: it answered 404 `NoResourceFoundError`
       (live), so serve it from your own assets.
     - Take it from the SmartEdit extension (`smartedit/apps/web-app-injector/dist/`) or from
       `@spartacus/smartedit`.
   - **An unknown or expired ticket is silently ignored.** OCC answers 200 with the **Online**
     content and still adds `properties.smartedit` (live). If editors say their changes don't show,
     check that `catalogVersionUuid` ends in `/Staged`.
   - **A ticket for a page can find the page by itself.**
     - SmartEdit creates tickets with a `pageId`.
     - With such a ticket, `cms/pages?cmsTicketId=…` without page parameters answers **302** to the
       same URL with `pageId` and `pageType` added (live).
     - So a preview route (for example `cx-preview`) can send only the ticket and follow the redirect.
       Server-side `fetch` follows it by default.
     - Check the `Location` host behind a proxy: it must be the public API host.
4. **DOM contract.** With a ticket, pages, slots and components carry `properties.smartedit` (live).
   - It comes with `fields=DEFAULT` or `FULL`, not `BASIC`.
   - Example values:
     - The page has `classes` with `smartedit-page-uid-faq`, `smartedit-page-uuid-…` and
       `smartedit-catalog-version-uuid-electronicsContentCatalog/Staged`.
     - Slots and components have `componentId`, `componentUuid`, `componentType`,
       `catalogVersionUuid` and `classes: "smartEditComponent"`.
   - Copy each key onto the element as `data-smartedit-*`. For example `componentId` becomes
     `data-smartedit-component-id`, and `catalogVersionUuid` becomes
     `data-smartedit-catalog-version-uuid`.
   - Add the `classes` value as CSS classes. On `<body>` these include
     `smartedit-page-uid-…`, `smartedit-page-uuid-…` and `smartedit-catalog-version-uuid-…`.
5. **Re-rendering.**
   - Implement `window.smartedit.renderComponent(componentId, componentType, parentId)` to reload
     one component.
   - Without `parentId` the target is a slot, and reloading the page is fine.
6. **Production.** Never ship any of this to normal visitors. Gate it on the ticket.

## 8. An external CMS next to OCC

With Storyblok, Contentful or a similar CMS for content, and OCC for commerce:
- **The CMS stores product codes only.** Storyblok's "SAP Commerce Cloud" field plugin (config
  `apiURL`, `baseSite`) and Contentful's SAP Commerce Cloud Connector both let editors pick products
  from OCC.
- **Price, stock and availability come from OCC at render time**, per `lang` and `curr`. Never copy
  them into the CMS. For live values, fetch the block's codes with parallel `GET products/{code}`
  calls and small `fields`. `products/search?filters=code:a,b` returns them in one call, but with
  prices and stock from the index (`catalog-search.md` §4).
- **Cache the two separately.** Keep the CMS content cache, invalidated by CMS webhooks, apart from
  the OCC product data cache (a short TTL).
- **The product picker runs in the editor's browser.**
  - Storyblok's app is configured only with `apiURL`, `baseSite` and `limit`, with no credentials,
    and field plugins run client-side in an iframe. So the picker's product search calls OCC
    straight from the editor's browser.
  - OCC CORS has to allow the origin those calls come from. Read it from the `Origin` header in the
    browser's network tab instead of guessing a Storyblok domain.
- **Deleted or renamed products.** The CMS keeps codes that may no longer exist; a product lookup
  then gives 400 `UnknownIdentifierError`. Render the block without that product instead of failing
  the page.
