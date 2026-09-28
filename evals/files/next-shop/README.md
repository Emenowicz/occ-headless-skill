# Example Shop storefront

Next.js (App Router) storefront for Example Shop. The backend is SAP Commerce Cloud 2211-jdk21 on
CCv2, reached through the OCC REST API. The base site is `electronics`, the site language is
`en` and the currency is `USD`.

- `app/p/[code]/page.tsx`: product detail page
- `lib/occ.ts`: small helper for OCC calls
