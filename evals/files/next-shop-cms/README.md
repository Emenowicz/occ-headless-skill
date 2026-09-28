# next-shop-cms

Next.js 16 (App Router) storefront for SAP Commerce Cloud 2211-jdk21. Content pages come from SAP's WCMS through OCC (site `electronics`, content catalog `electronicsContentCatalog`).

- `app/[[...slug]]/page.tsx`: renders the CMS page for the URL (`/` is the homepage, `/faq` the content page with label `/faq`).
- `lib/occ.ts`: the OCC client (server only).
- `lib/cms.ts`: page and component fetching. CMS pages are cached for 5 minutes (ISR).
- `components/cms/`: the slot renderer and the component registry.

SmartEdit is installed on the backend and runs at `https://backoffice.example-shop.com/smartedit`.
