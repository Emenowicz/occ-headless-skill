# B2B storefronts (b2bocc)

**(live)** marks behaviour checked on a vanilla 2211-jdk21.19 instance with the powertools sample
site. Paths are relative to `{host}/occ/v2/{baseSiteId}/`, and every call carries `lang` and `curr`.
Organization management (units, budgets, approvals) is out of scope here.

## Contents

1. [Before anything: login and channel](#1-before-anything-login-and-channel)
2. [Which calls go to `orgUsers`](#2-which-calls-go-to-orgusers)
3. [Checkout with account payment](#3-checkout-with-account-payment)
4. [Placing the order](#4-placing-the-order)
5. [Reorder, replenishment, quick order](#5-reorder-replenishment-quick-order)
6. [Prices and caching](#6-prices-and-caching)

## 1. Before anything: login and channel

- **B2B sites usually require login.** `basesites` shows `requiresAuthentication: true` for
  powertools (live).
  - Anonymous catalog calls then answer **404 `UnknownResourceError`**, not 401 (live).
  - CMS pages still answer anonymously (live).
  - Redirect to login before any catalog call, and don't mistake that 404 for a broken URL.
- **B2B customers are provisioned by the organization.** They can't self-register like B2C
  customers.
  - The powertools sample users have `loginDisabled` set; they can't log in until the backend
    enables them and sets a password (live).
  - For B2B self-service, there's a registration *request* endpoint (`POST orgUsers`) that an
    approver handles.
- **The channel blocks some B2C calls.** With a B2B customer token, `GET users/current` and
  `POST users/current/carts/{c}/entries` answer **401 `AccessDeniedError` "It's not allowed to
  execute this call from the current channel"** (live). Use the `orgUsers` equivalents (next
  section).
- **The signed-in B2B user** comes from `GET orgUsers/current?fields=uid,name,orgUnit(uid,name),roles`:
  `{"orgUnit":{"uid":"Rustic"},"roles":["b2badmingroup"]}` (live).

## 2. Which calls go to `orgUsers`

The B2B API is a mix: some calls must go to `orgUsers/…`, and others only work under `users/…`.

**Precondition: `occ.rewrite.overlapping.paths.enabled=true`.**
- `b2bocc` sets it to `true` in its `project.properties`, but `commercewebservicescommons` sets
  `false`. SAP's B2C+B2B setup puts `true` into `local.properties`, and the sandbox behind the
  table below ran with `true`.
- If `orgUsers` calls answer 404, ask the backend team to check this property.

| Action | B2B request (live unless noted) |
| --- | --- |
| Current user | `GET orgUsers/current`. `GET users/current` is blocked by the channel |
| Create cart | `POST users/current/carts` (201) |
| Read cart | `GET users/current/carts/{code}`. **`GET orgUsers/current/carts/{code}` fails with 400 `ClassCastError`** |
| Add entry | `POST orgUsers/current/carts/{code}/entries?quantity=2&code={productCode}`, with **query params and no JSON body** → `CartModification`. `POST users/…/entries` is blocked by the channel |
| Change quantity | `PATCH users/current/carts/{code}/entries/{n}` with JSON `{"quantity"}`, or `PUT orgUsers/current/carts/{code}/entries/{n}?quantity=`. `PATCH` under `orgUsers` gives 405 |
| Remove entry | `DELETE users/current/carts/{code}/entries/{n}`. `DELETE` under `orgUsers` gives 405 |
| Payment types | `GET paymenttypes` → `CARD`, `ACCOUNT` |
| Set payment type | `PUT users/current/carts/{code}/paymenttype?paymentType=ACCOUNT&purchaseOrderNumber=PO-123` |
| Cost centers | `GET costcenters?fields=DEFAULT,unit(BASIC,addresses(DEFAULT))` |
| Set cost center | `PUT users/current/carts/{code}/costcenter?costCenterId={code}` |
| Delivery address | `PUT orgUsers/current/carts/{code}/addresses/delivery?addressId={unitAddressId}` |
| Place order | `POST orgUsers/current/orders?cartId={code}&termsChecked=true&fields=FULL` |
| Reorder | `POST orgUsers/current/cartFromOrder?orderCode={code}` (Spartacus) |
| Replenishment | `POST orgUsers/current/replenishmentOrders?fields=FULL,costCenter(FULL),purchaseOrderNumber,paymentType` (Spartacus) |

## 3. Checkout with account payment

Do the steps in this order:
1. **Payment type first.** `ACCOUNT` (pay on invoice) needs a cost center. `CARD` goes through the
   payment provider, as in B2C. `purchaseOrderNumber` is optional; send it as a query parameter.
2. **Cost center.** Pick it from `costcenters`. Each one lists its unit and the unit's addresses.
3. **Delivery address: only an address of the cost center's unit.**
   - OCC accepts any new delivery address on the cart (201, live), but then **rejects the order**
     with 400 `EntityValidationError` and only the generic message "The application has
     encountered an error" (live). The real reason ("Delivery address is not a valid value")
     appears only in the server log.
   - So with `ACCOUNT` payment, offer only `unit.addresses`, and set the address with
     `?addressId=`.
4. **Delivery mode** as in B2C: `GET …/deliverymodes`, then `PUT …/deliverymode?deliveryModeId=`.

## 4. Placing the order

- `POST orgUsers/current/orders?cartId={code}&termsChecked=true`. **B2B requires `termsChecked`.**
  Without it: 400 `MissingServletRequestParameterError` "Required request parameter
  'termsChecked'" (live). B2C doesn't need it.
- **Orders may need approval.** The response status then shows the order waiting (for example
  pending approval). Say that in the confirmation, instead of "order placed".
- As in B2C: block double submits, and clear the stored cart id afterwards.

## 5. Reorder, replenishment, quick order

- **Reorder** creates a new cart from a past order (`cartFromOrder`). Check the returned
  modifications for items that are no longer available.
- **Scheduled replenishment** creates recurring orders from the cart. It has its own endpoints
  (`replenishmentOrders`) and a schedule in the request. Check them in `/occ/v2/api-docs`.
- **Quick order.** Add entries one by one with the `orgUsers` add-entry call, serialized. Parallel
  writes to one cart lose data (`cart-checkout.md` §8). Validate codes first with
  `products/search?filters=code:a,b,…`.
- **Volume prices:** `volumePrices` on the product lists the quantity tiers. Show them on the
  product page and in quick order.

## 6. Prices and caching

- Prices depend on the unit and the customer's price group. **Never put B2B prices in a shared
  cache**, and don't prerender product or search pages with prices for a B2B site.
- Search result prices come from the index and can differ from contract prices. The cart is binding.
