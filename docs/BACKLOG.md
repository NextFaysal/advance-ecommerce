# BACKLOG.md — Deferred / future ideas (v1 scope er baire)

- Notun idea ekhane likhte hobe, scope freeze onujayi v1 e add kora jabe na.
- v2 advanced module (Step 43-50, execution plan e) ekhane na, execution plan er v2 section e ache.
- (Khali — ekhon porjonto kono deferred item nai)

## Remaining real wiring (collected from Agents 6–21 reports, 2026-10-24)

### Blocker first
- [ ] Unblock Prisma generate (network to `binaries.prisma.sh`, or cached engine, or pnpm build-script allow-list + reinstall — see `packages/db/PRISMA-BLOCKER.md`), then in order: `prisma validate` → migrate → seed → create-first-owner → typecheck green (0 errors) → production build.

### DB persistence swaps (routes/services currently in-memory/demo, swap points marked in code)
- [ ] Orders / carts / customers routes → Prisma (incl. wiring the real coupon service into order create — currently applies 0 — and real fraud scoring instead of `riskScore: 0` = "not scored").
- [ ] Catalog repository + product writes + initial-stock ledger writes; retire TEMPORARY MOCK public reads only once real queries land.
- [ ] Payments / couriers / shipments / manual-TrxID / webhook logs → Prisma, DB unique constraints as the backstop.
- [ ] Inventory / coupons / campaigns / reports / CMS stores → Prisma (`CmsPage`/`CmsPost`/`SeoRedirect`, `Supplier`/`PurchaseOrder` models exist).
- [ ] BD stores → Prisma: `PaymentLink`, `DailyCashClosing`, DB `TrxRegistry` on `UNIQUE(method, trxId)`, courier-reconciliation runs, CSV/API invoice importer per provider.
- [ ] Automation / fraud stores → Prisma (`AutomationRule`, `AutomationRunLog`, `FraudListEntry` models exist); DB-backed feature-flag reader replacing all demo flag stores (same interface).
- [ ] Reseller / call-center / inbox / POS, vendors (+ commission lines from delivered orders, refunds from `Refund`), B2B / quotations / pre-orders / stock transfers, riders (`Rider`/`RiderDelivery` models exist), ERP tables (`Erp*` models exist), extensibility tables (`ApiKey`, `WebhookSubscription` models exist; plugins/hook/custom-field/pack-config tables still need schema work), back-in-stock signups (`BackInStockSignup` model exists).

### Workers / realtime / Redis
- [ ] Install `bullmq` + `ioredis`, build the worker entrypoint (separate deployment) calling `createWorkers(...)` with a Redis connection from server env; handlers and retry policies are ready in `src/jobs/`.
- [ ] Redis pub/sub for the admin order SSE feed (currently connect-event + heartbeat only, `live: false`; < 1 s target not met) and for the rider assignment board.
- [ ] Replace in-memory rate limiter (auth + public tracking) and settings cache with Redis (same key shapes).
- [ ] Domain-event publishers calling automation `processEvent` + hook `dispatch()` on `order.created` / `payment.succeeded` / `stock.low` / abandoned-checkout sweeps; webhook worker performing the real HTTP send behind the classification helpers.
- [ ] Fraud enforcement at checkout (assemble `FraudScoreInput` in the order service, enforce suggested action + OTP challenge on high risk) — scoring exists, enforcement does not.

### Security hardening still open
- [ ] TOTP secret encryption on enrolment + decryption on verify (do not ship plain stored TOTP secrets).
- [ ] Sign/encrypt the `admin_pending_2fa` cookie value (TODO noted in the login route).
- [ ] Export audit-with-reason + watermark before real report exports are streamed; backup/restore test; security review (execution plan Step 34).

### Real provider adapters (behind existing interfaces + live-guard)
- [ ] Payments: real bKash/Nagad/SSLCommerz (and others) auth/session/signature flows; reconcile COD settlement against couriers' actual invoices.
- [ ] Couriers: real Steadfast/Pathao/RedX adapters incl. area/zone lookups and label fetch; rider zone-distance table replaced by road distance/geocoding behind the `zoneDistanceKm()` seam.
- [ ] SMS ingestion path (Android forwarder / staff paste) feeding `sms-verify` against real orders; OTP delivery to customers via the SMS adapter/queue at rider PICKED_UP.
- [ ] Real AI provider behind the `AiProvider` interface — key stored encrypted in Admin Settings, template fallback stays as the offline failure mode; `engine` becomes `"provider"`.
- [ ] Meilisearch live indexing (index settings + Banglish synonyms upload from `src/catalog/indexer.ts`) once host/key are configured locally.
- [ ] F-commerce channels: real Messenger/Instagram/WhatsApp APIs for the inbox (types + draft conversion only today).

### Data
- [ ] Review and wire the full BD geo dataset (`bd-geo-full-DRAFT.json`: handle 9 duplicate-name union groups + the zero-union Shayestaganj upazila, seed matching by nameEn drops codes) → replace sample `bd-geo.json`; union-level address parsing.

### QA / assets
- [ ] Run the Playwright E2E suite (`pnpm add -Dw @playwright/test`, install chromium, seeded DB, `E2E_*` env vars) — specs are scaffolding, never run yet.
- [ ] Load test, visual regression (light/dark, 360/768/1440), device-lab checks, final local QA sign-off against `docs/QA-CHECKLIST.md`.
- [ ] PWA icon PNGs: create real `/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (paths referenced by the manifest; files do not exist).
- [x] Self-hosted font files — DONE 2026-10-24 (Agent 65): Plus Jakarta Sans (variable 200–800, latin), Hind Siliguri (static 400/500/600/700, bengali + latin), Noto Sans Bengali (variable 100–900, bengali), JetBrains Mono (variable 400–800, latin) downloaded from Google Fonts, wOF2-verified, in `apps/web/public/fonts/` with OFL.txt per family; `@font-face` in `apps/web/src/styles/fonts.css`, imported by `app/globals.css`; two critical faces preloaded in the root layout.
- [ ] Staff-performance route/UI for analytics (types + computation only today); period-lock management UI for ERP; drag-to-reassign + live map for the rider board (needs realtime above).

### Deferred by Nazmul's instruction (do not do early)
- [ ] GitHub push — only after the local build is complete, via the GitHub OAuth connector flow + repository selection for `NextFaysal/advance-ecommerce`. Never the token that was once pasted in chat (treat as exposed; it was never saved or used).
- [ ] Live deployment (execution plan Steps 39–42) — only when Nazmul says "live koro": production domain/SSL, production DB/Redis/Meilisearch, server-only production env (via Secure Vault / server env, never chat), R2 production bucket + CDN, monitoring/backup, staging smoke test, rollback plan, 7-day monitoring, live sign-off.
