# Account: registration, profile, addresses, orders, consents

**(live)** marks behaviour checked on a vanilla 2211-jdk21.19 instance. Paths are relative to
`{host}/occ/v2/{baseSiteId}/`, and every call carries `lang` and `curr`. Customer calls use
`users/current` with the customer's token (`auth.md`).

## Contents

1. [Registration](#1-registration)
2. [Profile](#2-profile)
3. [Addresses](#3-addresses)
4. [Order history and details](#4-order-history-and-details)
5. [Passwords](#5-passwords)
6. [Consents](#6-consents)
7. [Optional features](#7-optional-features)

## 1. Registration

```http
POST users
Content-Type: application/json

{ "uid": "jane@example.com", "password": "…", "firstName": "Jane", "lastName": "Doe", "titleCode": "ms" }
```

- **No token is needed** on 2211-jdk21 (live). `titleCode` is optional (live). Titles come from
  `GET titles` → `mr`, `mrs`, `miss`, `ms`, `dr`, `rev` in the sample data (live).
- **Captcha.** When `basesites` shows `captchaConfig.enabled: true`, send the captcha token in the
  `sap-commerce-cloud-captcha-token` header.
- **OTP registration.** When it's enabled, registration needs `verificationTokenId` and
  `verificationTokenCode`, so it takes two steps.
- **After registration the customer is not logged in.** There's no password grant, so send them
  through the login flow (`auth.md` §10).
- **Isolated sites.** When `basesites` shows `isolated: true`, accounts are per site, and their uids
  look like `email|siteUid` (seen in the data, live). Show the email, not the uid.

## 2. Profile

- **Read:** `GET users/current?fields=uid,name,firstName,lastName,titleCode,currency,language`.
- **Update:** `PATCH users/current` with JSON of the changed fields answers 200 with an **empty
  body** (live). Read the profile again afterwards.
- **Email (login) change** is a separate call. It changes the uid, so plan for a new login
  afterwards.

## 3. Addresses

| Action | Request |
| --- | --- |
| List | `GET users/current/addresses` |
| Create | `POST users/current/addresses` with JSON → 201 with `id` (live) |
| Update | `PATCH users/current/addresses/{id}` with JSON → 200, empty body (live) |
| Delete | `DELETE users/current/addresses/{id}` |
| Verify | `POST users/current/addresses/verification` with JSON → `{"decision":"ACCEPT"}` (live) |
| Countries | `GET countries?type=SHIPPING` or `?type=BILLING` |
| Regions | `GET countries/{iso}/regions?fields=regions(name,isocode,isocodeShort)` → `US-NY` / `NY` |

- **Validate the form yourself.** OCC stored an address with an empty first name and only a country
  (201, live), in the account address book as well as on the cart. You'll get no error, just an
  address that fails later.
- **Required fields.** At minimum ask for first name, last name, line 1, town, postal code and
  country, plus the region wherever the country has regions.
- **Region codes.** Send the region `isocode`; `isocodeShort` is for display.
- **Verification** returns a decision (`ACCEPT`, `REVIEW` or `REJECT`) and possibly suggested
  addresses. Show the suggestions before saving.

## 4. Order history and details

- **History:**
  `GET users/current/orders?currentPage=0&pageSize=10&sort=byDate&fields=orders(code,status,statusDisplay,placed,total(formattedValue)),pagination,sorts`
  (live).
  - `currentPage` starts at 0, and the sort codes come from `sorts`.
  - Show `statusDisplay`, the localized status, rather than the enum.
- **Details:** `GET users/current/orders/{code}?fields=FULL`.
  - Cancellation (`cancellable`) and returns (`returnable`) are flags on the order. Their endpoints
    are `…/orders/{code}/cancellation` and `users/current/orderReturns`.
- **Guest orders.** A guest has no history. The confirmation uses the order `guid` (`cart-checkout.md`
  §10).
- **Dates** look like `2026-09-28T10:23:55+0000` (live). Normalize before parsing, and format with
  the shop locale.

## 5. Passwords

| Action | Request |
| --- | --- |
| Forgotten password | `POST passwordRestoreToken` with JSON `{"loginId": "jane@example.com"}` → 201, no token needed (live) |
| Reset from the email link | `POST resetpassword` with JSON `{"token": "…", "newPassword": "…"}` |
| Change while logged in | `PUT users/current/password` with the form fields `old` and `new` → 202 (live). The spec also lists a newer body-based variant, so check this backend's `api-docs` |

- **The reset link in the email points at the accelerator storefront by default.** It is built from
  `website.<site>.https` plus `/login/pw/change?token=…`.
  - Ask the backend team to set that property to your storefront.
  - Implement that route, or redirect it to yours.
- **A password change doesn't revoke existing tokens (live).** Revoke them yourself and sign the
  user in again if your policy requires it (`auth.md` §10).
- **Don't reveal whether an email exists.** `passwordRestoreToken` answers 201 for known and unknown
  emails alike (live), so show the same message either way.

## 6. Consents

- **Signed-in customers.**
  - `GET users/current/consenttemplates` lists the templates and the customer's current consents
    (live).
  - Give consent with a form-encoded POST of `consentTemplateId` and `consentTemplateVersion`.
  - Withdraw with `DELETE` on the consent.
- **Anonymous visitors.**
  - `HEAD users/anonymous/consenttemplates` returns the consents in the `X-Anonymous-Consents`
    response header, URL-encoded JSON such as `%5B%5D` (live).
  - Keep that header, send it back on later calls, and list it in the CORS allowed and exposed
    headers.
  - After registration or login, transfer the anonymous consents to the customer.

## 7. Optional features

- **Some account features depend on extensions.** Customer coupons (`users/current/customercoupons`)
  and product interests ("notify me when back in stock", `users/current/productinterests`) answered
  404 `UnknownResourceError` because their extensions weren't installed (live). Check
  `/occ/v2/api-docs` before you build a UI for them.
- **Wishlists.**
  - The new wishlist API answered 500 "Wishlist is not implemented" without an implementing
    extension (live), and it can also be disabled by configuration.
  - Spartacus keeps a wishlist as a saved cart named `wishlist<customerId>`, which works everywhere.
