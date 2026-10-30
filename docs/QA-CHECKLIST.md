# Local QA Checklist — advance-ecommerce (updated 2026-10-26)

## Code health
- [x] Typecheck: fully green — 0 ERRORS across apps/web (`npx tsc --noEmit -p apps/web/tsconfig.json`) ✅
- [x] Production build: 188/188 pages generated with Exit Code 0 (`pnpm --filter web build`) ✅
- [x] No secrets in repo files (clean environment variable boundaries)
- [x] Money is integer poisha in schema, services, pricing, reports (only Float in schema is Product.ratingAverage, a rating)
- [x] API routes: Zod validation, `{data, meta}` / `{error:{code,message}}`, RBAC + audit on admin routes, masked phone by default

## Auth / security base
- [x] Staff login + TOTP lib, lock after 5 failed, login history, session hash only
- [x] Auth route handlers: login + verify-2fa (httpOnly cookies, generic errors, rate limit)
- [x] Settings test route (sandbox pass simulated, live never faked)
- [x] Middleware: /dashboard -> /admin, /admin/* requires admin_session cookie
- [x] First Owner script (env password only, refuses if Owner exists, never prints password/hash)
- [x] TOTP secret encryption on enrolment (AES-256-GCM), HMAC-signed `admin_pending_2fa` cookie
- [x] Report export watermark + mandatory audit reason

## Functional (local & database-backed)
- [x] Design system + admin shell, storefront, catalog, checkout, orders, CRM shells
- [x] Order state machine, One-Click outline, cart merge, idempotency
- [x] Payment/Courier sandbox & live adapters + webhook pipeline + manual TrxID + COD settlement
- [x] Inventory ledger, coupon, campaign estimate, reports, CMS service + schema (74 models, 20 enums)
- [x] Job queue contracts (SMS/email/courier/webhook/report/automation)
- [x] DB persistence swap: orders/coupons/fraud/settings/features/cash-closing/payment-links
- [x] Full BD geo dataset: 8 divisions, 64 districts, 504 upazilas, 4,964 unions (`bd-geo.json`)
- [x] Next.js production build pass — 188 static/dynamic routes generated cleanly (EXIT 0)

## Deferred by instruction
- GitHub push: later, on Nazmul's instruction (no push done)
- Live deploy: only when Nazmul says "live koro" (no deploy done)

## v2 add-on modules (verified 2026-10-26)
- [x] Automation engine: trigger/condition/action rules, dry-run, run logs with masked phones only
- [x] Fraud scoring: 0–100 score with explained signals; blacklist floors at 90 → block; ≥70 → OTP required
- [x] BD differentiators: address parser, SMS auto-verify parser, payment links (PrismaPaymentLinkStore), cash closing (DailyCashClosing DB upsert), courier reconciliation
- [x] Own riders (E3): zone+load assignment, live assignment and delivery reassignment board & API (`/api/v1/admin/riders/assign`)
- [x] Vendors: API (list/create/status/product-approval/payout), commission in basis points floored to poisha
- [x] Reseller / call center / F-commerce inbox / POS: services + API routes built, admin pages for resellers + call-center + inbox
- [x] B2B / advanced orders: split allocation, partial payment/delivery, exchange difference in poisha, merge validation, pre-orders, wholesale tiers
- [x] Real AI provider integration: `LiveAiProvider` client wired with OpenAI/LLM endpoint and deterministic template fallback
- [x] Business packs + ERP-lite + extensibility: period lock management UI & API (`/api/v1/admin/modules/erp-period`)
- [x] Multi-theme system: WordPress-style theme engine, smart palette generator, starter presets, live preview, and user preferences (`/account/preferences`, `/admin/appearance/themes`)
- [x] Staff performance analytics: API `/api/v1/admin/analytics/staff-performance` + leaderboard UI in `/admin/analytics`
- [x] F-Commerce channel adapters: Meta Webhook (`/api/v1/public/inbox/webhook`) and outbound dispatch for Messenger, Instagram Direct, and WhatsApp Cloud API
- [x] Public pay page `/pay/[token]`: resolves by token hash only
- [x] Order tracking `/track`: orderNo + phone match required
- [x] Storefront UX: recently viewed, quick view, sticky buy bar, compare, size guide, back-in-stock signup, wishlist page

## Workers / PWA / E2E
- [x] Queue contracts (10 queues) + handlers (idempotent, ids/masked refs only in logs) + worker wiring/policy layer
- [x] `bullmq` & `ioredis` installed, worker daemon entrypoint ready in `apps/web/scripts/worker.ts`
- [x] PWA: manifest, service worker, offline page, registration wired into root layout
- [x] PWA icon PNGs (192 / 512 / maskable) generated and verified in `apps/web/public/icons/`
- [x] Subscription Boxes (ADV-23 Vertical 4, Wave-56d): BullMQ repeatable worker sweep (`scripts/worker.ts`), admin manual sweep trigger (`/api/v1/admin/boxes/sweep`), cycle notification alerts (`/api/v1/admin/boxes/notify`), 11/11 passing unit tests (`scripts/test-subscription-boxes.ts`), Playwright E2E spec
- [x] BD Logistics & Smart Routing: Multi-courier intelligent selection engine (Pathao, Steadfast, RedX, eCourier, Paperfly) based on destination zone, weight, and COD success rates (`/api/v1/admin/shipping/smart-route`)
- [x] Abandoned Checkout Recovery: 1-click WhatsApp recovery link generation (`/api/v1/admin/abandoned/[id]/whatsapp`) and INCOMPLETE order tracking in Prisma
- [x] Complete BD Tools Suite: Courier Reconciliation, Return Tracker, Shipping Label Printer, Order SMS, Phone Fraud Checker, WhatsApp Recovery, Profit Calculator, bKash/Nagad QR Generator, Courier Coverage Hub, Lost Parcel Claims
- [x] Order Limit & Anti-Spam Rules: Max pending orders block, rolling 24-hr daily order limit, junk customer text filter, checkout rapid IP rate-limiting
- [x] Playwright scaffolding: config (mobile-360 + desktop projects) + 6 spec files (including subscription-boxes.spec.ts)
- [ ] E2E specs execution against running local server + seeded DB

## Docs
- [x] `docs/ARCHITECTURE.md`
- [x] `docs/RUNBOOK-LOCAL.md`
- [x] `docs/BACKLOG.md`
- [x] `docs/QA-CHECKLIST.md`

## Backup / restore
- [x] Scripts exist: `apps/web/scripts/backup-db.ts` and `apps/web/scripts/restore-db.ts`
- [x] Smoke-tested: dry-run, confirm gate, checksum verification, prod-name guard
