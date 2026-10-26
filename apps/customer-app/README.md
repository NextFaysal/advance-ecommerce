# Customer app — decision: the storefront PWA *is* the customer app

**Decision (doc 23, wave 58 — ADV-30, last app in the order): there is
no separate React Native / native customer app. The installable
storefront PWA is the customer app for every install of this platform.**

This file is the record of that decision and its evidence, so a future
reader does not have to re-litigate it — and so the one real blocker
for a native app (customer token auth) is written down where the
next attempt will find it. That blocker has since been built out —
see "The customer token-auth contract" below; the PWA decision
itself stands.

## Why the PWA covers the customer job (evidence, not assertion)

Everything a customer app would do already exists as storefront routes
under `apps/web/app/(store)/`, served by the same install:

| Customer-app screen | Already shipped as |
| --- | --- |
| Home / browse | `/`, `/shop`, `/search` (incl. Banglish query expansion) |
| Product | `/product/[slug]` |
| Cart / checkout | `/cart`, `/checkout` (phone-first, BD address cascade, COD + gateways) |
| Account | `/account` — orders, addresses, returns, subscriptions, tickets, downloads, wishlist |

And the PWA machinery around them is complete, not a stub:

- **Installable**: `apps/web/public/manifest.webmanifest` —
  `display: standalone`, scope `/`, 192/512 + maskable icons,
  `theme_color`, home-screen shortcuts. An install prompt is mounted
  in the storefront shell (`app/storefront-shell.tsx` →
  `src/pwa/install-prompt.tsx`), so customers are actually offered
  the install.
- **Offline shell**: `apps/web/public/sw.js` — static assets
  cache-first, page navigations network-first with a fallback to the
  precached `/offline` page (`app/offline/`). No API responses are
  cached, so the app never presents stale prices/orders as current —
  the same honesty rule the rest of the platform follows.
- **iOS parity** (the one genuine gap found, fixed with this
  decision): Safari ignores web-manifest icons and needs Apple meta
  for standalone launch. `apps/web/app/layout.tsx` now also emits
  `apple-touch-icon` (`/icons/icon-192.png`) and
  `appleWebApp: { capable: true, title, statusBarStyle }` alongside
  the existing manifest link and light/dark `themeColor` viewport.
- **Push**: web-push subscription plumbing exists
  (`src/pwa/push-subscribe.tsx`, `app/api/v1/public/push/`) — order
  updates do not need a native shell.

## Why not a React Native app

1. **Architecture fit.** This platform is single-tenant: one codebase,
   a separate install per client (own server, database, domain).
   A native app multiplies that by per-client store accounts, signing
   keys, review cycles and binary releases for zero additional
   customer capability over the PWA — and every storefront fix would
   have to ship twice. The PWA updates when the install updates.
2. **The token-auth blocker is now CLOSED — the seam exists.**
   When this decision was first recorded, customer identity on the
   public API was the `customer_session` **HttpOnly cookie** only,
   and a React Native app cannot use an HttpOnly web cookie as its
   session — scaffolding screens then would have meant wiring them
   to an auth model that did not exist. The follow-up wave built
   the seam first, as this document prescribed (contract below).
   What remains unbuilt is the RN app itself — see point 3.
3. **App-store presence is a business decision, not a code gap.** If
   a client ever needs store listing for discovery/marketing, step
   (1) — the token-auth seam — is DONE. The remaining step is
   per-client: scaffold the RN/Expo app against the real
   `/api/v1/public/*` contracts (products, categories, search;
   orders; account) and the token contract below. That scaffold is
   deliberately **unblocked-but-not-built**: it ships when a client
   chooses store presence, with their store accounts and signing
   keys — building it speculatively for every install would repeat
   the multiplication problem in point 1.

## The customer token-auth contract (built — wave 58 follow-up)

Customer API tokens, owned by `apps/web/src/customer-auth/api-tokens.ts`,
accepted by the shared `requireCustomer()` seam in
`apps/web/src/customer-auth/http.ts` — so every
`/api/v1/public/account/*` route (orders, addresses, returns,
subscriptions, tickets, downloads, data export, delete, the B2B
portal guard, …) accepts a token anywhere the cookie works, with
zero per-route code.

- **Format**: `ae_cust_` + 256 bits of entropy, base64url (43 chars).
- **At rest**: only the SHA-256 hex (`CustomerApiToken.tokenHash`,
  a real table — the CustomerSession / partner-ApiKey precedent).
  The plaintext is shown exactly **once**, in the create response.
- **Use**: `Authorization: Bearer ae_cust_…` on any account route.
- **A presented header decides alone**: an invalid, revoked or
  malformed bearer gets 401 and NEVER falls back to the cookie
  (the SMS device-token precedent) — revocation cannot be bypassed
  by a stray browser cookie. No header → the cookie path, unchanged.
- **No scheduled expiry**: revocation is the off-switch (partner
  API-key discipline). `lastUsedAt` is stamped at most once/hour.
- **Management is cookie-session ONLY** — a bearer token can never
  mint or revoke tokens, so a leaked token cannot extend itself or
  lock the customer out of recovery:
  - `GET /api/v1/public/account/api-tokens` — own tokens, hash-free
    views, newest first.
  - `POST /api/v1/public/account/api-tokens` `{ label }` → 201
    `{ apiToken, token }` (the one-time plaintext). Cap: **10 active**
    per customer → 409 `API_TOKEN_LIMIT` beyond.
  - `POST /api/v1/public/account/api-tokens/[id]/revoke` → 200;
    unknown **or another customer's** id → 404; already revoked →
    409.
  - Customers manage tokens from the **API টোকেন** card on
    `/account` (create with show-once box, list, revoke).
- **How a native app bootstraps**: sign in once via the existing
  web/OTP flow (which sets the cookie in a webview or browser), open
  `/account`, mint a token, hand it to the app, and the app uses the
  bearer from then on. Token issuance at the login endpoints
  themselves is intentionally NOT built — minting is a deliberate,
  labelled, revocable act in the account, not a side effect of every
  sign-in.

## What "customer app" means operationally for an install

- Customers install from the browser ("Add to Home Screen" / the
  in-store install prompt); no store account, no APK, no review wait.
- The home-screen name/icon come from the manifest + layout meta of
  that client's own install, so each client's app is *their* store.
- Rider and owner have their own installable PWAs over the same
  install (`apps/web/public/manifest-rider.webmanifest`,
  `manifest-owner.webmanifest` — wave 58), and the merchant SMS
  forwarder is a separate native app for a genuinely native job
  (reading payment SMS), at `apps/android-sms-forwarder/`. Native is
  used where only native works; the customer surface is not one of
  those places.

## Status / verification

- The PWA behaviour cited above is the platform's existing, built
  code (manifest, service worker, offline page, install prompt) —
  read from this repository, not aspirational.
- The iOS meta additions in `app/layout.tsx` are part of this change;
  like all web changes here they are verified by the parent build +
  deployment pipeline, not from this document.
- The token-auth seam (contract above) is built code in this
  repository — `src/customer-auth/api-tokens.ts`, the
  `CustomerApiToken` table (migration
  `20261026028000_customer_api_tokens`), the `requireCustomer()`
  bearer branch, the management routes and the `/account` card —
  verified through the same parent build + smoke pipeline. The RN
  scaffold it unblocks remains, deliberately, unbuilt.
