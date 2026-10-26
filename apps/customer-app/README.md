# Customer app — decision: the storefront PWA *is* the customer app

**Decision (doc 23, wave 58 — ADV-30, last app in the order): there is
no separate React Native / native customer app. The installable
storefront PWA is the customer app for every install of this platform.**

This file is the record of that decision and its evidence, so a future
reader does not have to re-litigate it — and so the one real blocker
for a native app is written down where the next attempt will find it.

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
2. **An honest blocker, not a preference: there is no token auth for
   customers.** Customer identity on the public API is the
   `customer_session` **HttpOnly cookie** only
   (`apps/web/src/customer-auth/auth.ts` — DB-backed session, 7-day
   TTL; login/register/Google/Facebook all set that cookie). No
   `/api/v1/public/*` route accepts a bearer token for customer
   identity. A React Native app cannot use an HttpOnly web cookie as
   its session, so a real RN app first needs a server project:
   bearer-token (or OAuth-style) customer auth on the public API —
   token issuance at login, refresh/revocation, and a per-route
   acceptance alongside the cookie. Until that exists, an RN scaffold
   here would be screens wired to an auth model that does not exist:
   an empty shell that looks like progress. This project does not
   ship those.
3. **App-store presence is a business decision, not a code gap.** If a
   client ever needs store listing for discovery/marketing, the right
   order is: (1) build the token-auth seam above as its own wave,
   (2) then scaffold the RN/Expo app against the real
   `/api/v1/public/*` contracts (products, categories, products
   search; orders; account) — in that order, never scaffold-first.

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
