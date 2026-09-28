# Catalog, search and product pages

Everything marked **(live)** was checked on a vanilla 2211-jdk21.19 instance with the electronics
sample data. Paths are relative to `{host}/occ/v2/{baseSiteId}/`, and every call carries `lang` and
`curr`.

## Contents

1. [`fields` presets](#1-fields-presets)
2. [Product detail page](#2-product-detail-page)
3. [Variants](#3-variants)
4. [Prices and stock](#4-prices-and-stock)
5. [Images and media](#5-images-and-media)
6. [Search and category pages](#6-search-and-category-pages)
7. [Facets, sorting and pagination](#7-facets-sorting-and-pagination)
8. [Search box and suggestions](#8-search-box-and-suggestions)
9. [Categories and navigation data](#9-categories-and-navigation-data)
10. [URLs, SEO and caching](#10-urls-seo-and-caching)

## 1. `fields` presets

These are Spartacus' presets, and every one of them worked on vanilla 2211-jdk21.19 (live). Start
from them and trim. **Any name the backend doesn't know fails the whole call with 400
`ConversionError`** (live). Check custom fields against this backend's `/occ/v2/api-docs` before
adding them.

```ts
export const PRODUCT_FIELDS = {
  // tiles, carousels, cart lines
  list: 'code,purchasable,name,summary,price(formattedValue),images(DEFAULT,galleryIndex),baseProduct',
  // product page
  details:
    'averageRating,stock(DEFAULT),description,availableForPickup,code,url,price(DEFAULT),numberOfReviews,' +
    'manufacturer,categories(FULL),priceRange,multidimensional,tags,images(FULL)',
  // product page, variant selector
  variants: 'name,purchasable,baseOptions(DEFAULT),baseProduct,variantOptions(DEFAULT),variantType',
  // specs tab
  attributes: 'classifications',
  promotions: 'potentialPromotions(description)',
};

export const SEARCH_FIELDS =
  'products(code,name,summary,configurable,configuratorType,multidimensional,price(FULL),images(DEFAULT),' +
  'stock(FULL),averageRating,variantOptions,baseProduct,priceRange(maxPrice(formattedValue),minPrice(formattedValue))),' +
  'facets,breadcrumbs,pagination(DEFAULT),sorts(DEFAULT),freeTextSearch,currentQuery,keywordRedirectUrl';
```

## 2. Product detail page

`GET products/{code}?fields=…`

- **Unknown product:** 400 `UnknownIdentifierError`, not 404 (live). Render your 404 page with a
  real 404 status, and handle only that error type this way. A 5xx is an outage, not a missing
  product.
- **HTML in the data:**
  - `description` and `summary` contain HTML, for example `<br/>` (live).
  - Search results wrap the matched words in the name:
    `DIGITAL <em class="search-results-highlight">CAMERA</em>` (live).
  - Sanitize before rendering, and strip the tags wherever you need plain text (`alt`, `<title>`,
    meta, JSON-LD).
- **Reviews:**
  - Read with `GET products/{code}/reviews?maxCount=…`.
  - Post reviews form-urlencoded (`headline`, `comment`, `rating`, `alias`).
  - Since jdk21.7 the author is anonymized by default, so show `alias`.
- **References** (accessories, similar): `GET products/{code}/references?referenceType=SIMILAR&fields=references(referenceType,target(code,name,images(DEFAULT),price(formattedValue)))`.
  The list is often empty (live).
- **Several products in one call** (carousels, recently viewed):
  `products/search?filters=code:a,b,c&fields=products(…)` (live), up to 100 per page. Chunk longer
  lists.
- **Browser caching:** product responses carry `Cache-Control: private, max-age=120` and an `ETag`
  (live). A product fetched in the browser can be up to two minutes stale.

## 3. Variants

- **Base products and variants.** A base product usually has `purchasable: false` and only a
  `priceRange`. The variants carry the price and are the ones you add to the cart.
- **The variant selector.** Build it from `variantOptions` (all variants), `baseOptions` (the
  selected variant's siblings per variant category) and `variantType`.
- **Landing on a base product.** Redirect to its first purchasable variant, or make the customer pick
  one before "Add to cart" is enabled.
- **Multi-dimensional products.** They have `multidimensional: true`; use Spartacus'
  `product-multi-dimensional` library as the reference for their selector.

## 4. Prices and stock

- **Price:** `{"currencyIso":"USD","formattedValue":"$227.24","priceType":"BUY","value":227.24}`
  (live).
  - Display `formattedValue`: it applies the store's currency, locale and rounding.
  - Use `value` only for sorting, analytics and calculations.
- **Range and volume prices.** `priceRange` gives `minPrice` / `maxPrice` for base products.
  `volumePrices` gives quantity tiers, which B2B uses.
- **Prices depend on who is asking.** Customer groups (B2B units, price groups) can change them after
  login. Search results are built from the index and can differ from the product page or the cart.
  Treat the cart as the binding price.
- **Several products by code: one `code:` with comma-separated values.**
  - `products/search?filters=code:A,B,C` returns all of them in one call (live, up to 100 per
    page).
  - Repeating the key fails: `filters=code:A,code:B`, or two `filters=` parameters, gives 400
    `ValidationError` (live).
  - `query=:relevance:code:A:code:B` returns nothing, because the same facet twice means AND (live).
  - Search results take price and stock from the index. When they must be live (a CMS teaser, a
    cart hint), send one `GET products/{code}` per code in parallel, with small `fields`.
- **Stock:** `{"stockLevelStatus":"inStock","stockLevel":99,"isValueRounded":false}` (live).
  - `stockLevelStatus` is `inStock`, `lowStock` or `outOfStock`.
  - `stockLevel` can be missing (forced in-stock).
  - With `isValueRounded: true`, show "N+" rather than an exact number.
- **Store stock:** `GET products/{code}/stock?location=…` returns nearby stores with stock (live).

## 5. Images and media

- **The image list.** `images[]` combines `format` (`zoom`, `product`, `thumbnail`, `cartIcon` in
  the sample data), `imageType` (`PRIMARY`, `GALLERY`) and `galleryIndex` (live).
  - The main image is `PRIMARY` in the size you need.
  - For the gallery, group the `GALLERY` images by `galleryIndex` and build `srcset` from the
    formats.
- **URLs are relative.** Prefix the media host.
  - Some URLs are only `/medias/?context=bWFzdGVy…`: the query **is** the file (live). Never strip
    it.
  - Allow the media host in your image optimizer (Next.js `images.remotePatterns` without
    `search`, or `@nuxt/image` domains).
- **Media formats are per backend.** Format names and sizes are configured per site. Read them from
  the response instead of assuming them.

## 6. Search and category pages

`GET products/search?query=…&currentPage=0&pageSize=24&fields=…`

**Query grammar.** The format is `freeText:sort:facetKey:facetValue:facetKey:facetValue…`.

| Page | `query` |
| --- | --- |
| Text search | `camera` or `camera:relevance` |
| Category page | `:relevance:allCategories:{categoryCode}` (live) |
| Brand page | `:relevance:brand:{brandCode}`, or whatever facet key the site uses |

- **Remove colons from what users type.** `usb:c cable` searched for `usb` and lost the rest (live).
- **Keyword redirects.** Merchandisers map terms to pages. In the sample data, `help` returns
  `keywordRedirectUrl: "/faq"` (live). When it's set, navigate there instead of showing results.
  The target uses accelerator paths, so map `/p/{code}` and `/c/{code}` to your routes.
- **Spelling.** Show "did you mean" from `spellingSuggestion` when present.
- **Empty pages.** A `currentPage` past the last page returns 200 with no products, not an error
  (live). Clamp page links to `pagination.totalPages`.

## 7. Facets, sorting and pagination

- **Facet links come ready-made** (live):
  - select a value with `facets[].values[].query.query.value`, for example
    `:relevance:allCategories:575:availableInStores:Chiba`;
  - remove an active filter with `breadcrumbs[].removeQuery.query.value`.
  - Put that string into your URL (`?q=…`), and decode it when reading it back: `+` means space.
  - Ignore the accelerator-style `query.url` next to it.
- **Facet flags.** Each facet has `name`, `multiSelect`, `visible`, `priority`, `category` and
  `values[]` (`name`, `count`, `selected`). Hide facets with `visible: false`. When `topValues` is
  present, show those first and "more" for the rest.
- **Sorting.** Sort codes come from `sorts[]` (`relevance`, `topRated`, `name-asc`, `name-desc`,
  `price-asc`, `price-desc` in the sample data, live). Both `query=camera:price-asc` and
  `sort=price-desc` work (live). Keep one convention: the facet queries carry the sort inside them.
- **Pagination.**
  - `currentPage` starts at **0**. Show `currentPage + 1`.
  - `pageSize` is **capped at 100**: asking for 500 silently returns 100 per page (live).
  - `pagination` gives `totalResults` and `totalPages`.
- **Counts only.** `HEAD products/search?query=…` returns the result count in `x-total-count`
  (live). Expose that header in CORS if the browser reads it.

## 8. Search box and suggestions

- `GET products/suggestions?term=cam&max=5` returns phrases only:
  `{"suggestions":[{"value":"cameras"},{"value":"camera"}]}` (live).
- For product previews, also run `products/search?query={term}&pageSize=5&fields=products(code,name,images(DEFAULT),price(formattedValue))`.
  Debounce both calls, and cancel stale requests.

## 9. Categories and navigation data

- **Category name, breadcrumb and children:**
  `GET catalogs/{productCatalog}/Online/categories/{code}?fields=id,name,subcategories(id,name),url`
  returns `categoryHierarchyWsDTO` (live). There is no `categories/{code}` endpoint (404, live).
- **The catalog id is per site**, e.g. `electronicsProductCatalog`. Get it from the backend team or
  from the CMS/search responses.
- **Menus and mega menus** usually come from the CMS navigation components, not the catalog tree
  (`cms.md`).
- **Product categories** list code, name and an accelerator `url`, e.g.
  `/Open-Catalogue/…/c/576` or `/Brands/Kodak/c/brand_88` (live). Route by code.

## 10. URLs, SEO and caching

- **Don't use OCC's URLs as your routes.** `product.url` is
  `/Open-Catalogue/Cameras/…/DIGITAL-CAMERA-EASYSHARE-C875/p/489702` (live). Build your own routes
  from codes, for example `/p/{code}/{slug}` with a slug from the name. When a URL arrives without
  the slug, redirect it to the canonical form.
- **One page per language.** Put the language in the path (`/de/p/…`), and emit `hreflang` for the
  languages in `basesites` → store languages. Map your locale to SAP's isocode (`de`, not `de-DE`)
  for OCC calls.
- **Status codes matter for SEO.** Return 404 for `UnknownIdentifierError`. Return 301 when a
  keyword redirect or a code change moves a page.
- **Sitemaps.** OCC doesn't generate sitemaps for your routes. Build them from paged product search
  (100 per page) and the CMS pages.
- **Caching.**
  - Cache product and search responses per site + `lang` + `curr`. Search results change with
    indexing, so keep TTLs short (minutes).
  - B2B or customer-specific prices must never go into a shared cache.
