# Cart and checkout

## Contents

1. [Cart identity and lifecycle](#1-cart-identity-and-lifecycle)
2. [Endpoints and request formats](#2-endpoints-and-request-formats)
3. [`fields` presets and the header badge](#3-fields-presets-and-the-header-badge)
4. [Create the cart lazily](#4-create-the-cart-lazily)
5. [Add, update and remove entries](#5-add-update-and-remove-entries)
6. [Merge at login](#6-merge-at-login)
7. [Cart errors and recovery](#7-cart-errors-and-recovery)
8. [Concurrent cart changes](#8-concurrent-cart-changes)
9. [Checkout for a signed-in customer](#9-checkout-for-a-signed-in-customer)
10. [Guest checkout](#10-guest-checkout)
11. [Vouchers, promotions and saved carts](#11-vouchers-promotions-and-saved-carts)

All paths are relative to `{host}/occ/v2/{baseSiteId}/`, and every call carries `lang` and `curr`.
Endpoint names follow the 2211-jdk21 OCC spec. Behaviour marked **(live)** was checked on a vanilla
2211-jdk21.19 instance. Where your backend's `/occ/v2/api-docs` differs, trust that.

## 1. Cart identity and lifecycle

| Who | `userId` in the path | `cartId` in the path | Where your app keeps it |
| --- | --- | --- | --- |
| Anonymous visitor | `anonymous` | the cart's **`guid`** | httpOnly cookie; the guid alone grants access to the cart |
| Guest (anonymous visitor who entered an email) | `anonymous` | the same `guid` | the same cookie |
| Signed-in customer | `current` | the cart's **`code`** | httpOnly cookie, or look it up again after login |

An anonymous cart's `code`, or a `guid` under `current`, returns 400 `CartError` `notFound` (live).
The alias `carts/current` works only for signed-in customers. Under `anonymous` it answers 401
(live). For a customer without a cart it answers 400 `CartError` `notFound` "No cart created yet."

```text
no cart ──first add──▶ anonymous cart (guid)
anonymous ──login──▶ merged into customer cart (code)          section 6
customer ──logout──▶ no cart (forget the code)
any ──place order──▶ no cart (the cart became an order)
any ──CartError notFound──▶ no cart (drop the id; create one on the next add)
```

The cart is priced in the `curr` of each request. After a currency switch, load the cart again with
the new `curr`: OCC re-prices it.

## 2. Endpoints and request formats

OCC mixes body formats. The wrong one gives a 400, or a call that seems to do nothing.

| Action | Request | Body / parameters |
| --- | --- | --- |
| Create cart | `POST users/{u}/carts?fields=…` | No body needed. For a merge, the query params `oldCartId` and `toMergeCartGuid` |
| Get cart | `GET users/{u}/carts/{cartId}?fields=…` | |
| List customer carts | `GET users/current/carts?fields=carts(…)` | Saved carts are included and have a `saveTime`; `savedCartsOnly=true` returns only those |
| Add entry | `POST users/{u}/carts/{c}/entries` | JSON `{"product":{"code":"…"},"quantity":1}`. Returns a `CartModification` |
| Change quantity | `PATCH users/{u}/carts/{c}/entries/{entryNumber}` | JSON `{"quantity":2}`. `0` is rejected with 400 (live); use DELETE |
| Remove entry | `DELETE users/{u}/carts/{c}/entries/{entryNumber}` | |
| Delete cart | `DELETE users/{u}/carts/{c}` | |
| Guest email | `POST users/anonymous/carts/{guid}/guestuser` | JSON `{"email":"…"}` → 201 (live). Change it later with `PATCH …/guestuser` or `PUT …/setEmail` (same JSON). **Set it before any checkout call:** on an anonymous cart without it, delivery modes, delivery mode and vouchers answer 401 `AuthorizationDeniedError` (live) |
| Apply voucher | `POST users/{u}/carts/{c}/applyVoucher` | JSON `{"voucherId":"…"}` → 204 |
| Remove voucher | `POST users/{u}/carts/{c}/removeVoucher` | JSON `{"voucherId":"…"}` → 204 |
| Validate cart | `POST users/{u}/carts/{c}/validate?fields=DEFAULT` | no body |
| Set saved delivery address | `PUT users/{u}/carts/{c}/addresses/delivery?addressId=…` | query param |
| Create delivery address | `POST users/{u}/carts/{c}/addresses/delivery` | JSON address |
| Delivery modes | `GET users/{u}/carts/{c}/deliverymodes` | |
| Set delivery mode | `PUT users/{u}/carts/{c}/deliverymode?deliveryModeId=…` | query param |
| Set saved payment details | `PUT users/{u}/carts/{c}/paymentdetails?paymentDetailsId=…` | query param |
| Place order | `POST users/{u}/orders?cartId=…&fields=FULL` | query params. A JSON body gives 400 `MissingServletRequestParameterError` (live). Section 9 |
| Order detail (customer) | `GET users/current/orders/{code}?fields=FULL` | |
| Order detail (guest) | `GET users/anonymous/orders/{guid}?fields=FULL` | by guid. It returns 401 without a token and 200 with a confidential client's `client_credentials` token (live) |

**Deprecated. Don't use these in new code:**

| Old call | Deprecated since | Use instead |
| --- | --- | --- |
| `PUT …/email` (form `email=`) | 2211.28 | `POST …/guestuser` or `PUT …/setEmail` |
| `POST …/vouchers?voucherId=`, `DELETE …/vouchers/{id}` | 2211.28 | `applyVoucher` / `removeVoucher` |
| `PATCH …/save` | 2211.28 | `PATCH …/savedCart` |
| `POST …/clonesavedcart` | 2211.28 | `POST …/copySavedCart` |

B2B carts and orders live under `orgUsers/{u}/…` (`sap-quirks.md` → B2B).

## 3. `fields` presets and the header badge

`DEFAULT` lacks what a cart page needs, such as product images and stock, and `FULL` is heavy.
These presets follow Spartacus:

```ts
export const CART_FIELDS =
  'DEFAULT,potentialProductPromotions,appliedProductPromotions,potentialOrderPromotions,' +
  'appliedOrderPromotions,entries(totalPrice(formattedValue),product(images(FULL),stock(FULL)),' +
  'basePrice(formattedValue,value),updateable),totalPrice(formattedValue),totalItems,' +
  'totalPriceWithTax(formattedValue),totalDiscounts(value,formattedValue),subTotal(formattedValue),' +
  'totalUnitCount,deliveryItemsQuantity,deliveryCost(formattedValue),totalTax(formattedValue,value),' +
  'pickupItemsQuantity,net,appliedVouchers,productDiscounts(formattedValue),user,saveTime,name,description';

export const CHECKOUT_FIELDS = 'deliveryAddress(FULL),deliveryMode(FULL),paymentInfo(FULL)';
export const BADGE_FIELDS = 'code,guid,totalUnitCount';
```

For the header badge, use **`totalUnitCount`**, the number of units. `totalItems` counts cart
lines. A cart with 2 × A, 1 × B and 1 × C has `totalItems` 3 and `totalUnitCount` 4 (live). Load only `BADGE_FIELDS` on every page, not the whole
cart.

## 4. Create the cart lazily

- Create a cart on the **first add to cart**, not on page load. Otherwise every visitor and crawler
  creates a cart on the backend.
- Do it on the server (route handler, server action, server route), because it sets a cookie.
  Next.js Server Components can't set cookies.
- Keep the anonymous `guid` in an httpOnly, Secure, SameSite=Lax cookie.
- Old carts are removed per site. Each sample site has its own cart-removal job
  (`electronics-CartRemovalJob`, daily at 04:05). It uses the site's `anonymousCartRemovalAge`
  (14 days without changes) and `cartRemovalAge` (28 days) (live).
  - Keep the cookie at or below the anonymous age.
  - A site created without such a job never removes carts. Ask the backend team which job and
    which ages apply, rather than assuming.
  - The recovery in section 7 covers carts that disappear anyway.

```ts
async function ensureCart(ctx: OccContext, jar: CookieJar) {
  const known = jar.get('occ-cart');
  if (known) return known;
  const cart = await occ<Cart>(ctx, `users/${ctx.token ? 'current' : 'anonymous'}/carts?fields=code,guid`, {
    method: 'POST',
  });
  const id = ctx.token ? cart.code : cart.guid;   // guid for anonymous, code for customers
  jar.set('occ-cart', id);
  return id;
}
```

## 5. Add, update and remove entries

```ts
const mod = await occ<CartModification>(ctx, `users/${uid}/carts/${cartId}/entries`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ product: { code }, quantity }),
});
if (mod.statusCode !== 'success' || (mod.quantityAdded ?? 0) < quantity) {
  // e.g. lowStock (fewer added), noStock (none added), maxOrderQuantityExceeded
  showNotice(mod.statusCode, mod.quantityAdded ?? 0, quantity);
}
```

- **The result.** A `CartModification` has `statusCode`, `quantityAdded`, `quantity` (always the
  requested amount), `entry` and `statusMessage`. A 200 with `statusCode: "noStock"` means nothing
  was added. Treat every value other than `success` as a partial or failed add, and show how many
  items were actually added.
- **Errors.** The same call can answer 400 `InsufficientStockError` (reason `noStock` or
  `lowStock`), 400 `UnknownIdentifierError` for an unknown product, or 409.
- **Variants.** For a product with variants, send the code of the variant the customer picked, and
  check `purchasable` on it.
- **`entryNumber` changes.** Removing an entry renumbers the others: entries 0, 1 and 2 become 0
  and 1 after entry 0 is deleted (live). Take entry numbers from the latest cart response, and to
  find an entry again, look it up by product code.

## 6. Merge at login

Do this in the login callback, after the tokens are stored and before the redirect. Keep the
anonymous guid in a cookie across the login redirect: anything held in memory is lost when the
browser leaves for the authorization server.

1. **Load the customer's carts** with
   `GET users/current/carts?fields=carts(code,guid,saveTime,user(uid,name))`. The active cart is
   the one **without** `saveTime`. The others are saved carts, or named carts such as `wishlist…`
   and `selectivecart…`.
2. **Merge an anonymous cart that isn't a guest cart:**
   `POST users/current/carts?oldCartId={anonymousGuid}&toMergeCartGuid={activeCart.guid}`. Leave
   out `toMergeCartGuid` when the customer has no active cart. The response is the merged customer
   cart: store its `code` and drop the anonymous cookie.
3. **A guest cart can't be merged.** Recognise a guest cart by `user.name` being `guest`. After
   `guestuser`, the uid is a new GUID (live); the deprecated email call produced `{guid}|{email}`.
   Merging a guest cart fails with 400 `CartError` reason `cannotRestore` ("Cart is not
   anonymous"). Copy the entries into the customer cart instead, then delete the guest
   cart with `DELETE users/anonymous/carts/{guid}`.
4. **`cannotRestore` doesn't only mean "guest cart".**
   - A guid that no longer exists (expired, removed, or merged in another tab) gets the same 400
     `cannotRestore` "Cart is not anonymous" from the merge, not `notFound` (live).
   - On `cannotRestore`, read `users/anonymous/carts/{guid}`:
     - `CartError notFound` means the cart is gone: drop the cookie and keep the customer's cart;
     - a cart whose `user.name` is `guest` means copy its entries (step 3).
   - Never discard the customer's own active cart because a merge failed.
5. **No anonymous cart:** use the active customer cart, or no cart at all.
6. **Load the merged cart again for the page.** Customer groups can have other prices and
   promotions.

## 7. Cart errors and recovery

| Error | Meaning | Do |
| --- | --- | --- |
| `CartError`, reason `notFound`, `subjectType` `cart` (400, also for a guid that never existed, live) | The cart no longer exists: it became an order, expired, was deleted, or guid and code were mixed up | Drop the stored id and **don't retry**. Create a cart on the next add |
| `CartError`, reason `invalid` | The cart changed underneath you, for example an applied voucher expired. The first GET fails | Load the cart again once |
| `CartError`, reason `cannotRestore` | Merge of a guest cart, or of an anonymous guid that no longer exists or was already merged (live) | Section 6, step 4 |
| `CartEntryError`, reason `notFound` | Stale `entryNumber` | Load the cart, then retry the change once |
| `InsufficientStockError` | Not enough stock | Show `quantityAdded`, or "unavailable" |

Only a `CartError` `notFound` means the cart is gone. A 404 `UnknownResourceError` is a wrong path in
your code, and a 5xx or a timeout is an outage. Neither means the cart is gone: keep the id, or you
throw away a live cart. Never loop on create-and-retry: make one recovery attempt, then show an
error.

## 8. Concurrent cart changes

Two changes to one cart at the same moment, such as a double click or two tabs, collide.

What happened with parallel adds of one product (live, three runs):
- 6 adds: two succeeded, one failed with `JaloObjectNoLongerValidError`, three with
  `ModelSavingError`. The cart ended with 2 items instead of 6.
- 3 adds: one succeeded and two failed with `ModelSavingError`, yet the cart held **two lines of the
  same product, both with `entryNumber` 0**. A "failed" write had still added a line.
- 6 adds: four requests hung for over four minutes, and the cart could not be read afterwards.

The error names come from the database. The sandbox's HSQLDB reports serialization failures, and
the databases on CCv2 fail differently, so don't match on the names.

`toggle.enhanceConcurrencyCartForMerge.enabled` defaults to `true` in 2211-jdk21 (platformservices).
If a build or an override sets it to `false`, a double add can also price an entry at 0.

- **Prevent collisions.** Run cart changes one at a time per cart. On the server, keep a promise
  queue per cart id; in the UI, disable the control while a request is pending.
- **Never re-send a failed or timed-out cart write blindly.**
  1. Re-read the cart.
  2. Compare it with what you meant to change.
  3. Act on the difference: repeat the change, remove a duplicate line, or tell the customer.
- **Take `entryNumber` from the cart you just read.** After a collision the cart can hold duplicate
  lines.

## 9. Checkout for a signed-in customer

1. **Delivery address.**
   - Pick a saved one (`PUT …/addresses/delivery?addressId=`), or create one
     (`POST …/addresses/delivery` with a JSON body).
   - Countries come from `GET countries?type=SHIPPING`, regions from
     `GET countries/{iso}/regions?fields=regions(name,isocode,isocodeShort)`.
   - Send the region `isocode` (`US-NY`); `isocodeShort` (`NY`) is for display. The create response
     returns only the region `isocode` (live).
   - **Validate the address in your own form.** OCC accepted a guest delivery address with an empty
     first name and nothing but a country (201, live). Validation errors, when they do come, are
     `ValidationError` items whose `subject` is the field name.
   - The spec has no length or pattern rules either (names 1–255 characters).
2. **Delivery mode.** Set the address first. Without one, `GET …/deliverymodes` returns an empty
   list, and `PUT …/deliverymode` fails with 400 `UnsupportedDeliveryModeError` (live). Then call
   `GET …/deliverymodes`, followed by `PUT …/deliverymode?deliveryModeId=`, which answers 200 with
   an empty body.
3. **Payment.**
   - OCC's `paymentdetails` and "silent order post" flow is the accelerator's mock, for local
     development only.
   - Real payments go through the project's payment provider: its JavaScript SDK or hosted fields,
     plus its OCC endpoints. Ask which provider is installed, and find its endpoints in
     `/occ/v2/api-docs`. Never collect raw card data in your own form and pass it through.
   - **Many PSP plugins place the order themselves.** Adyen's SAP plugin, for example, has
     `…/carts/{c}/adyen/checkout-configuration`, `…/adyen/place-order` and
     `…/adyen/additional-details`. Its place-order call authorizes the payment and creates the
     order in one step, so step 5 doesn't apply. Read the plugin's OCC API before you design the
     flow.
   - **Check which roles the plugin endpoints allow.** Once a guest email is set, OCC treats the
     cart as `ROLE_GUEST`. Plugin endpoints may not allow that role, so guest checkout fails at
     the payment step until the backend adds it.
   - **Redirect and 3DS payments can turn the cart into a pending order before the shopper
     authenticates.** Plan what the shopper sees when that payment then fails: the cart may be
     gone.
   - **After a redirect the place-order response is lost.** Read the order on the server by its
     `guid` (a guest order needs a client token, section 10).
   - **The plugin may finish redirect payments itself.** Adyen's plugin, for example, has an OCC
     endpoint `{baseSiteId}/adyen/redirect` (GET and POST) that authorizes the returning payment.
     - It then sends the shopper to `{adyen.spartacus.baseurl}{site}/{lang}/{curr}/adyen/redirect/{orderCode}`,
       or to `…/adyen/redirect/error/{base64 message}`.
     - The storefront only needs those two routes.
     - `additional-details` is for in-page actions such as native 3DS2.
     - (Plugin source: `adyenocc` `RedirectController`.)
4. **Validate.** Call `POST …/validate` and show the modifications before the customer pays:
   entries removed or reduced for stock, and quantity limits such as `below_min_quantity`. Use
   `statusCode`, because the English `statusMessage` ("Min=5") isn't meant for customers.
5. **Place the order.** `POST users/current/orders?cartId={code}&fields=FULL`.
   - The parameters go in the query string. A JSON body gives 400
     `MissingServletRequestParameterError` (live).
   - B2C needs only `cartId`: an order without `termsChecked` and without a body was placed (201,
     live). B2B requires `termsChecked=true` (`orgUsers`).
   - Keep a real terms checkbox in the UI either way: it's the shop's legal duty, and OCC doesn't
     check it for you.
   - Disable the button until the call returns.
6. **After the order.**
   - Show the confirmation from the response (`code`, totals, addresses) and clear the cart cookie.
   - If the call timed out, or a retry reports the cart as gone, check
     `GET users/current/orders?pageSize=1` before telling the customer it failed. The first attempt
     may have gone through.

## 10. Guest checkout

1. **Set the email first:** `POST users/anonymous/carts/{guid}/guestuser` with the JSON body
   `{"email":"…"}`.
   - Until the email is set, the checkout calls on an anonymous cart answer 401
     `AuthorizationDeniedError`: delivery modes, delivery mode, vouchers (live).
   - The cart becomes a guest cart, with `user.name` `guest` and a new GUID as `user.uid`. Don't
     display that uid.
   - From now on the cart can't be merged at login (section 6).
2. **Address, delivery mode, payment:** as in section 9, with `userId` = `anonymous` and `cartId` =
   the guid.
3. **Place the order:** `POST users/anonymous/orders?cartId={guid}&fields=FULL`. An anonymous cart
   without a guest email can't be ordered.
4. **Confirmation.**
   - A guest order is identified by its **`guid`**, which equals the cart's guid (live), not by its
     `code`.
   - Show the confirmation from the place-order response.
   - Re-reading it later (`GET users/anonymous/orders/{guid}`) answers 401 without a token and needs a
     confidential client's `client_credentials` token (live). Do that from the BFF.
5. **Turning the guest into a customer.**
   - `POST users?guid={order.guid}&password=…` still works on 2211-jdk21.19, although the spec no
     longer documents it. It answered 201 with `"active": false` (live).
   - It failed with 400 `ModelSavingError` ("Name cannot be blank") when the guest had no name.
   - Prefer offering a normal registration, and don't build on this call without testing it on
     your backend.

## 11. Vouchers, promotions and saved carts

- **Vouchers.**
  - `POST …/applyVoucher` and `POST …/removeVoucher` take `{"voucherId"}` and answer 204. Load the
    cart again afterwards, because totals and promotions change.
  - An unknown code is 400 `VoucherOperationError` ("Voucher not found: …", live). Other voucher
    errors can carry i18n keys such as `coupon.invalid.code.provided`. Map the error `type` to your
    own text.
- **Promotions.** `appliedOrderPromotions` and the other promotion lists can contain duplicates;
  deduplicate before showing them. Their descriptions can contain HTML, so sanitize them.
- **Saved carts** (customers only).
  - Save: `PATCH …/savedCart` with JSON `{"name","description"}`.
  - Restore: `PATCH …/restoresavedcart`.
  - Copy: `POST …/copySavedCart`.
  - A saved cart has a `saveTime`, which is why the active cart is "the one without `saveTime`".
