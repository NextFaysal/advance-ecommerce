# ARCHITECTURE.md — advance-ecommerce

Agent 22 · Documentation survey · 2026-10-24 · Local only

Every number in this document was verified on disk on 2026-10-24 with
`grep` / `find` / a full `tsc --noEmit` run. Where the code labels itself
demo, mock, or stub, this document says so — nothing here upgrades a
demo store into "done".

---

## 1. System overview

- **Model:** single-tenant, NOT SaaS. One codebase, one install per
  client (separate server/container, database, domain, `.env`).
- **One install** = storefront at `/`, admin at `/admin`
  (`/dashboard` redirects to `/admin`), versioned API at
  `/api/v1/public/*` and `/api/v1/admin/*`, in one Next.js project.
- **Stack:** Next.js 14 (App Router) + TypeScript strict + PostgreSQL +
  Prisma 5 + Redis + BullMQ + Tailwind + shadcn-style UI; Meilisearch
  (chosen search, Postgres fallback until wired); Cloudflare R2 + CDN
  for storage.
- **Bangladesh-first constants:** default locale `bn` (fallback `en`),
  currency BDT, timezone `Asia/Dhaka`, **money is integer poisha
  everywhere** (the only `Float` in the schema is
  `Product.ratingAverage`, a rating), BD phone
  `01[3-9]XXXXXXXX` stored normalised as `+8801XXXXXXXXX`, address
  hierarchy Division > District > Upazila > Union, phone-first
  checkout.
- **Repo shape (pnpm + Turborepo monorepo):** `apps/web` (the app),
  `packages/db` (Prisma schema, seed, owner script), `packages/validators`
  (BD phone + poisha helpers), `tests/e2e` (Playwright scaffolding),
  `docs/`.
- **Verified size (2026-10-24, Final Audit v3):** 488 TS/TSX files under
  `apps/web/src` + `apps/web/app` + `packages`; 63 `page.tsx` pages
  (42 admin, 21 storefront/public); 98 API `route.ts` files
  (85 admin, 12 public, + openapi.json).

## 2. Module map — `apps/web/src/`

| Folder | Files | Purpose |
|---|---|---|
| `lib/` | 5 | Core server libs: `auth.ts` (scrypt password hash, session-token hash only, 5-fail → 30-min lock, TOTP RFC 6238, login history), `rbac.ts` (57-permission catalogue, field-level rules), `settings.ts` (DB-encrypted → env → default resolution, AES-256-GCM), `audit.ts`, `env.ts` (Zod typed env loader, names keys only in errors) |
| `components/ui/` | 18 | Design-system components (button, input, select, badge + status-badge, card, stat-card, modal, drawer, toast, tabs, skeleton, empty-state, table, page-header, filter-bar, money, phone) |
| `catalog/` | 14 | Product/category service + repository interface, pricing pipeline, variant builder + deterministic SKU, Meilisearch contract + Banglish synonyms, CSV import, media (R2 key layout), indexer |
| `cart/` | 3 | Cart state, guest → login merge, localStorage persistence |
| `checkout/` | 5 | One-page checkout (Zod, phone required + normalised, idempotency UUID, pricing in poisha, stock check) |
| `orders/` | 10 | Order state machine, customer risk/success stats, manual order, One-Click Flow, print data (A4 + thermal), SSE feed contract |
| `integrations/` | 23 | Adapter interfaces (payment, courier, SMS, email, storage) + `sandbox/` simulated providers, webhook pipeline, manual-TrxID, COD settlement, live-guard |
| `inventory/` | 4 | Stock ledger service (reserve/commit/release/restore via movements only, available never negative) |
| `marketing/` | 6 | Coupons, flash sales, campaigns + SMS cost estimate, Pixel + CAPI dedup types |
| `reports/` | 6 | Sales/product/customer/courier/district aggregation, P&L, CSV export, CMS service, fail-closed admin guard, demo data |
| `jobs/` | 3 | BullMQ queue contracts (`queues.ts`), handlers, worker wiring/policy layer |
| `pwa/` | 3 | PWA config, service-worker registration helper, standalone check |
| `bd/` | 6 | BD differentiators: Bangla address parser, bKash/Nagad SMS auto-verify parser, payment links, daily cash closing, courier reconciliation |
| `automation/` | 7 | Rule engine (trigger/condition/action), dry-run, run logs, demo flag store |
| `fraud/` | 4 | Fraud scoring 0–100, blacklist/whitelist, suggested actions |
| `reseller/` | 6 | Reseller pricing/margin, wallet/commission ledger types, withdrawals, tiers |
| `callcenter/` | 5 | Call queue, outcomes, callback scheduling, agent performance types |
| `inbox/` | 5 | Unified Messenger/Instagram/WhatsApp conversation types, message → order-draft conversion |
| `pos/` | 5 | POS register types, barcode payload, receipt data, shift open/close + cash count |
| `riders/` | 8 | Own-rider management: assignment, delivery state flow, OTP-hash proof, COD handover, performance |
| `vendors/` | 5 | Multi-vendor types, commission (basis points), payout summary, product approval |
| `b2b/` | 6 | Wholesale tiers, quotations, credit limit/due, approval flow, fail-closed guard |
| `advanced-orders/` | 7 | Split shipments, partial delivery/payment, exchange, merge validation, pre-orders, advanced inventory (transfer, FEFO, serial, forecast) |
| `ai/` | 7 | AI-assist interface + template fallback (description, SEO, alt, classify), smart-search parser, recommendations |
| `analytics/` | 6 | RFM, cohort/retention, unit economics (LTV/CAC/ROAS in bps), funnel, courier/staff performance |
| `business-modules/` | 8 | Business-type packs: fashion, electronics, grocery, pharmacy, digital goods (config + validation) |
| `extensibility/` | 6 | Plugin/hook registry, adapter registry, custom fields, outbound webhooks, hash-only API keys |
| `erp/` | 5 | ERP-lite: chart of accounts, double-entry journal, VAT report, period lock |
| `storefront-ux/` | 18 | Part B UX logic + components: quick view, sticky buy bar, compare, size guide, recently viewed, back-in-stock, pay-link view, order tracking |

## 3. API surface

74 route files under `apps/web/app/api/v1/`:

- **Public (10):** products list/detail, categories, carts + cart
  merge, order create, payment webhook, courier webhook, pay-link
  (`/public/pay/[token]`), order tracking (`/public/track`).
- **Admin (64):** auth (login, verify-2fa), orders (+ `[id]`, SSE
  feed), customers, products (+ `[id]`, import), settings (+ test),
  payments (manual-trx, sandbox, COD settlement), shipments
  (book/track/cancel), inventory (+ purchase-orders), coupons
  (+ apply), campaigns, reports (+ export), CMS pages, system health,
  BD (address-parse, sms-verify, payment-links, cash-closing,
  courier-reconciliation), automation (+ `[id]`, dry-run, runs),
  fraud-rules (+ score, `[id]`), resellers (+ withdrawals),
  call-center (+ outcome), inbox (+ draft), riders (+ `[id]`, assign,
  deliveries), vendors (+ `[id]`, payout), b2b (+ customers,
  quotations), advanced-orders (+ preorders), ai (describe, classify,
  search), analytics, modules (+ erp-journal).
- **Conventions (enforced in code):** success `{ data, meta }`, error
  `{ error: { code, message, details } }`; every input Zod-validated;
  admin routes validate the `admin_session` cookie server-side →
  permission check → audit on sensitive actions; phones masked by
  default (full phone only with `customers.view_full_phone`).

## 4. Data model — `packages/db/prisma/schema.prisma`

**94 models, 20 enums** (verified by `grep -c "^model "` /
`grep -c "^enum "` on 2026-10-24, Final Audit v3). Groups:

- **Foundation/auth:** User, Role, Permission, RolePermission,
  Session, OtpCode, PasswordResetToken, LoginHistory, AuditLog,
  Setting, FeatureFlag
- **BD geo:** Division, District, Upazila, Union
- **Catalog:** Category, Brand, Product, ProductVariant, ProductImage,
  ProductAttribute
- **Customer/cart:** Customer, Address, Cart, CartItem
- **Orders:** Order, OrderItem, OrderStatusHistory, OrderNote,
  OrderTag, Return, PreOrder
- **Payments:** Payment, PaymentAttempt, ManualTrxSubmission, Refund,
  PaymentLink
- **Shipping/courier:** Shipment, ShipmentEvent, CourierAccount,
  ShippingZone, ShippingRate
- **Inventory:** Warehouse, InventoryItem, StockMovement (append-only
  ledger), StockTransfer, BackInStockSignup
- **Marketing:** Coupon, CouponUsage, FlashSale, FlashSaleItem,
  Campaign, NotificationLog
- **CMS:** CmsPage, CmsPost, SeoRedirect
- **Suppliers/purchasing:** Supplier, PurchaseOrder, PurchaseOrderItem
- **BD operations:** DailyCashClosing, Rider, RiderDelivery
- **Automation/fraud:** AutomationRule, AutomationRunLog,
  FraudListEntry
- **B2B/vendors:** Vendor, B2bCustomer, Quotation
- **ERP-lite:** ErpAccount, ErpJournalEntry, ErpJournalLine, ErpPeriod
- **Extensibility:** ApiKey (hash column only), WebhookSubscription

Rules visible in the schema: money columns are `Int` poisha; unique
constraints back the idempotency story (`Order.idempotencyKey`,
`Payment` method + gateway transaction id, `ManualTrxSubmission`
method + trxId, `ShipmentEvent.idempotencyKey`); soft delete
(`deletedAt`) on business entities; history/ledger/event models are
append-only with no soft delete by design.

**Status:** the schema has **not** passed `prisma validate`, and no
migration has run — Prisma's engine binary cannot be downloaded on
this machine (see §8 and `packages/db/PRISMA-BLOCKER.md`).

**Seed** (`packages/db/prisma/seed.ts`, idempotent, not yet executed):
57 permissions (the full `rbac.ts` catalogue), 7 roles (Owner =
all), 17 feature flags (all OFF), non-secret default settings
(bn / BDT / Asia/Dhaka, R2, Resend), sample-only catalog/geo data,
**no staff user** (first Owner is created separately, §RUNBOOK).

## 5. Integration adapter pattern

- Core code depends on interfaces in `src/integrations/` —
  `PaymentGateway`, `CourierProvider`, `SmsProvider`,
  `NotificationChannel`, storage — never on a provider directly.
  Providers: payment COD, bKash, Nagad, Rocket, Upay, SSLCommerz,
  AamarPay, ShurjoPay, Stripe/PayPal (optional); courier Steadfast,
  Pathao, RedX, Paperfly, eCourier; SMS BulkSMSBD, SSL Wireless,
  Greenweb; email Resend + SMTP; storage Cloudflare R2 (default).
- **Settings resolution:** Admin Settings in DB (secret values
  AES-256-GCM encrypted) = override; env = default/fallback only.
  Per-provider enable/disable, credential fields, test-connection,
  Connected/Not connected status (booleans only in API responses).
- **Sandbox first:** `src/integrations/sandbox/` implements simulated
  payment (bKash/Nagad/SSLCommerz) and courier (Steadfast/Pathao/RedX)
  providers. Simulated ids are prefixed `SBX-` so they can never be
  confused with real ones. A live-guard makes sandbox adapters throw
  outside sandbox mode; live mode requires a configured credential
  row + a real test connection. Settings test route: sandbox returns
  a simulated pass; live with no credential returns 422; live with a
  credential returns 503 (live test not implemented) — never a faked
  success.
- **Webhooks:** one pipeline for payment + courier callbacks —
  verify HMAC-SHA256 signature first (timing-safe) → idempotency
  check → log every attempt (reason only, never signature/body) →
  apply once; a replay returns the first result with
  `duplicate: true`. With no secret configured, webhooks are rejected
  by design (no hardcoded test secret).

## 6. Feature flags (17, all OFF in seed)

Verified in `packages/db/prisma/seed.ts` on 2026-10-24:

`module.reseller`, `module.call_center`, `module.pos`,
`module.multi_vendor`, `module.automation`, `module.fraud_scoring`,
`module.rider`, `module.f_commerce`, `module.ai_assist`,
`module.advanced_analytics`, `module.b2b`, `module.fashion`,
`module.electronics`, `module.grocery`, `module.pharmacy`,
`module.digital_goods`, `module.erp_lite`

Paid add-on modules check their flag and fail closed (403
`FEATURE_LOCKED`) when it is off or unreadable. Until the DB flag
reader lands, module routes read in-memory demo flag stores that
mirror the same OFF defaults and the same interface.
(Note: `docs/MODULES.md` §2 still says the five business-pack flags
"need to be added to the seed" — that is stale; they are in the seed
as verified above.)

## 7. Security rules (as implemented in code)

- Passwords: scrypt hash; session tokens and OTP/reset tokens stored
  as hashes only; TOTP 2FA (RFC 6238) for staff.
- Login: 5 failed attempts → 30-min lock; in-memory rate limit
  (5/15 min per IP+identifier); generic 401 that never reveals
  whether an identifier exists; httpOnly session cookies.
- Secrets: never hardcoded, never logged, never returned by an API.
  Settings secrets are AES-256-GCM encrypted; a missing/invalid
  `SETTINGS_ENCRYPTION_KEY` throws rather than storing plaintext.
  Audit logs mask secret values; sensitive actions require a reason.
- Payment links store only the SHA-256 token hash; the plain token is
  returned once. API keys likewise hash-only (`ApiKey.keyHash`).
  Rider delivery OTPs are hash-only.
- Phones are masked by default everywhere (lists, logs, job
  payloads, run logs); full phone requires
  `customers.view_full_phone` and is audit-logged. Cost price
  requires `products.edit_cost_price`, otherwise `null`.
- Middleware protects the admin page shell only — it is **not** the
  security boundary; every admin API route validates the session
  server-side and fails closed (401 unauthenticated, 403 missing
  permission, 503 when session validation is unavailable).
- Pharmacy pack: a prescription-required item cannot be checked out
  without a prescription ref — there is no bypass flag.
- ERP-lite: journal entries can only be built balanced
  (debits = credits, integer poisha); unbalanced entries throw.

## 8. Honest status — real vs stubbed/demo

**Real (pure logic, scoped typechecks + smoke tests passed):**
state machines (order/shipment), pricing pipeline, RBAC, settings
encryption, address parser, SMS parser, fraud scoring, automation
engine, ERP ledger rules, reconciliation math, sandbox
payment/courier simulation + webhook pipeline, design system.

**Demo / in-memory (labelled in code — 151 files carry
`TEMPORARY_MOCK` / `TEMPORARY_DEMO` / `in-memory-demo` / `NOT_WIRED`
markers):** almost all API-route persistence. Routes return markers
such as `db: "NOT_WIRED"`, `persisted: false`,
`source: "TEMPORARY_MOCK_STORE"`, `persistence: "in-memory-demo"`.
Public catalog/order reads still serve labelled mock data. Coupon
application in order create currently applies 0; order `riskScore`
is 0 = "not scored". The order SSE feed sends only a connect event +
heartbeats (`live: false`).

**Contracts only / not a running system:** BullMQ queues are defined
in `src/jobs/queues.ts` (sms-send, email-send, courier-booking,
courier-status-sync, webhook-delivery, import-export,
report-generation, notification-retry, abandoned-cart-followup,
automation-run; retry 3×/30 s, courier 5×/60 s) with handlers and a
wiring layer — but `bullmq`/`ioredis` are **not installed**, so no
worker daemon runs. Meilisearch indexing is env-guarded and skips
when unconfigured. PWA manifest + service worker exist, and the icon
PNGs they reference (192/512/maskable) were generated locally and are
on disk (Agent 32). Playwright specs (5 files in
`tests/e2e/`) are scaffolding and have **not been run**.

**Blocked:** Prisma generate (engine binary download fails with
`ECONNRESET` — network to `binaries.prisma.sh`, see
`packages/db/PRISMA-BLOCKER.md`). This blocks `prisma validate`,
migrations, seed execution, DB-backed runtime, and a fully green
typecheck: the current `tsc --noEmit` for `apps/web` shows exactly
**2 errors**, both caused by the ungenerated Prisma client
(`packages/db/src/index.ts` `PrismaClient` export, and an implicit
`any` in `src/lib/auth.ts` inferred from it).

**Data:** `packages/db/prisma/data/bd-geo.json` is sample-only
(2 divisions, `_sampleOnly: true`). A full draft dataset exists at
`bd-geo-full-DRAFT.json` (its own header claims 8 divisions /
64 districts / 504 upazilas / 4,964 unions from an open npm dataset)
but it is **not wired into the seed** and needs review first
(duplicate-name union groups; one upazila with 0 unions).

**Deferred by instruction:** no GitHub push has been made; no live
deployment exists. Both wait for Nazmul's separate instruction.
