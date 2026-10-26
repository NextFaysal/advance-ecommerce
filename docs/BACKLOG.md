# BACKLOG.md — Deferred / future ideas (v1 scope er baire)

- Notun idea ekhane likhte hobe, scope freeze onujayi v1 e add kora jabe na.
- v2 advanced module (Step 43-50, execution plan e) ekhane na, execution plan er v2 section e ache.

## Remaining real wiring (collected from Agents 6–21 reports, 2026-10-24 & updated 2026-10-26)

### Blocker first
- [x] Prisma generate engine patched locally via `scripts/patch-prisma-engine.mjs` → typecheck green (0 errors) → production build (188 pages generated).

### DB persistence swaps (routes/services currently in-memory/demo, swap points marked in code)
- [x] Orders / carts / customers routes → Prisma (incl. wiring the real coupon service into order create and real fraud scoring).
- [x] Catalog repository + product writes + initial-stock ledger writes.
- [x] Payments / couriers / shipments / manual-TrxID / webhook logs → Prisma, DB unique constraints as the backstop.
- [x] Inventory / coupons / campaigns / reports / CMS stores → Prisma.
- [x] BD stores → Prisma: `PaymentLink`, `DailyCashClosing`, DB `TrxRegistry` on `UNIQUE(method, trxId)`, courier-reconciliation runs.
- [x] Automation / fraud stores → Prisma; DB-backed feature-flag reader auto-installed and hydrated across app layout and admin pages.
- [x] Reseller / call-center / inbox / POS, vendors, B2B / quotations / pre-orders / stock transfers, riders, ERP period lock.

### Workers / realtime / Redis
- [x] `bullmq` + `ioredis` installed in `apps/web/package.json`, worker daemon entrypoint ready in `apps/web/scripts/worker.ts`.
- [x] Redis pub/sub for the admin order SSE feed (connect-event, heartbeat, cluster bridge) and for the live rider assignment board.
- [x] Replace in-memory rate limiter (auth + public tracking) and settings cache with Redis (distributed cache with memory fallback).
- [x] Domain-event publishers calling automation `processEvent` + hook `dispatch()` on `order.created` / `payment.succeeded` / `stock.low` / abandoned-checkout sweeps.
- [x] Fraud enforcement at checkout (assemble `FraudScoreInput` in the order service, enforce suggested action + OTP challenge on high risk with SMS dispatch & interactive verification).

### Security hardening
- [x] TOTP secret encryption on enrolment + decryption on verify (AES-256-GCM envelope, `AUTH_ENCRYPTION_KEY`).
- [x] Sign/encrypt the `admin_pending_2fa` cookie value (HMAC signed).
- [x] Export audit-with-reason + watermark on all report exports.

### Real provider adapters (behind existing interfaces + live-guard)
- [x] Payments: bKash (Tokenized Checkout) and SSLCommerz (Hosted Payment & Refund) live adapters.
- [x] Couriers: Steadfast and Pathao live parcel booking, tracking, and label generation adapters.
- [x] SMS Gateways: BulkSMSBD, Greenweb, SSL Wireless with Bengali Unicode segmentation algorithm.
- [x] Real AI provider behind the `AiProvider` interface — OpenAI/LLM live adapter with graceful template fallback; `engine` becomes `"provider"`.
- [x] Meilisearch live indexing (index settings + Banglish synonyms upload from `src/catalog/indexer.ts`) via admin reindex API `POST /api/v1/admin/catalog/reindex`.
- [x] F-commerce channels: Meta Webhook (`/api/v1/public/inbox/webhook`) + outbound dispatch adapters for Messenger, Instagram Direct, and WhatsApp Cloud API.

### Data
- [x] BD geo dataset: verified national dataset `bd-geo.json` (8 divisions, 64 districts, 504 upazilas, 4,964 unions) wired in `seed.ts` and `apps/web/src/bd/geo-dictionary.ts`.

### QA / assets
- [ ] Run the Playwright E2E suite (`pnpm add -Dw @playwright/test`, install chromium, seeded DB, `E2E_*` env vars) — specs are scaffolding, ready to run.
- [ ] Load test, visual regression (light/dark, 360/768/1440), device-lab checks, final local QA sign-off against `docs/QA-CHECKLIST.md`.
- [x] PWA icon PNGs: created `/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` via icon generator script.
- [x] Self-hosted font files — DONE 2026-10-24 (Agent 65): Plus Jakarta Sans, Hind Siliguri, Noto Sans Bengali, JetBrains Mono.
- [x] Staff-performance route/UI for analytics: API `/api/v1/admin/analytics/staff-performance` + leaderboard UI in `/admin/analytics`.
- [x] Period-lock management UI for ERP: API `/api/v1/admin/modules/erp-period` + interactive management UI in `/admin/erp`.
- [x] Multi-theme system: WordPress-style theme engine, smart palette generator, starter presets, live preview, and user preferences.

### Deferred by Nazmul's instruction (do not do early)
- [ ] GitHub push — only after the local build is complete, via the GitHub OAuth connector flow + repository selection for `NextFaysal/advance-ecommerce`. Never the token that was once pasted in chat (treat as exposed; it was never saved or used).
- [ ] Live deployment (execution plan Steps 39–42) — only when Nazmul says "live koro": production domain/SSL, production DB/Redis/Meilisearch, server-only production env (via Secure Vault / server env, never chat), R2 production bucket + CDN, monitoring/backup, staging smoke test, rollback plan, 7-day monitoring, live sign-off.
