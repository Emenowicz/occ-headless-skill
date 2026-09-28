# Rustic B2B storefront (Angular)

Angular 22 SSR storefront for the B2B site `powertools` on SAP Commerce Cloud 2211-jdk21. Customers are
company buyers who pay on account (cost centers). All OCC calls from the browser go through the
`/api/occ` proxy in `src/server.ts`, which adds the customer's token from an httpOnly cookie. CMS content
comes from SAP Commerce (WCMS).
