# FINAL AUDIT — Definitive Remaining-Work Survey

**Snapshot:** 2026-10-24, ~14:55 Asia/Dhaka (08:55 UTC), local only.
**Method:** read/grep/count commands only, plus one full web typecheck. Every
number below comes from a command actually run during this audit; the commands
are in the Appendix. No status was invented.

**Concurrency caveat:** two other agents (Reseller/Call-Center and Cart Page)
landed files *during* this audit window. Counts moved while measuring
(TS/TSX 393 → 397, pages 50 → 51, demo-marker files 93 → 100). Headline
numbers are the **final snapshot** re-taken at the end of the audit; small
drift of ±a few files is possible if those agents were still writing.

---

## 1. Fresh counts (final snapshot)

| Metric | Count | Source |
|---|---|---|
| TS/TSX files (`apps/web/src` + `apps/web/app` + `packages`, excl. `node_modules`) | **397** (293 `.ts`, 100 `.tsx` at first pass) | `find … -name "*.ts" / "*.tsx"` |
| `page.tsx` files | **51** | `find apps packages -name "page.tsx"` |
| API `route.ts` files | **76** (65 admin + 11 public) | `find apps/web/app/api -name "route.ts"` |
| Prisma models | **74** | `grep -c "^model " schema.prisma` |
| Prisma enums | **20** | `grep -c "^enum " schema.prisma` |
| Schema size | 1,289 lines / 36,579 bytes | `wc -lc schema.prisma` |
| Feature flags in seed `FEATURE_FLAGS` | **17**, all seeded OFF | block count in `seed.ts` |
| Permissions — RBAC catalogue | **57** | `PERMISSIONS` array, `src/lib/rbac.ts` |
| Permissions — seed catalogue | **57** | `PERMISSIONS` block, `seed.ts` |
| Permissions RBAC vs seed | **sets identical** (`diff` clean) | see Appendix |
| Admin nav items | **27** | `path: "/admin…"` entries in `src/admin-nav/config.ts` |

Feature flag keys (17): `module.reseller`, `module.call_center`, `module.pos`,
`module.multi_vendor`, `module.automation`, `module.fraud_scoring`,
`module.rider`, `module.f_commerce`, `module.ai_assist`,
`module.advanced_analytics`, `module.b2b`, `module.fashion`,
`module.electronics`, `module.grocery`, `module.pharmacy`,
`module.digital_goods`, `module.erp_lite`.

### Disagreements with earlier docs (stale, superseded by growth)

- `docs/ARCHITECTURE.md` §"Verified size" and project `README.md` state
  **331 TS/TSX files, 74 API routes (64+10), 34 pages, 86 demo files**.
  This audit measures **397 / 76 (65+11) / 51 / 100**. The earlier numbers
  were correct when Agent 22 wrote them; Agents 23–34 slices landed after.
- `~/MEMORY.md` admin-surface line states nav has **24 items**; the config
  now has **27** (Agent 27 appended staff/audit/feature-flags).
- Schema figures **74 models / 20 enums**, **17 flags**, and **57 permissions**
  in earlier docs still match this audit exactly.
- The execution plan's own overview table disagrees with its step headings
  by one step from Step 23 onward (overview: Inventory 24–26, Marketing
  27–29, Reports/CMS 30–33; headings: Step 23 Inventory, 25 Marketing core,
  28 Reports, 30 PWA). Section 5 below follows the **headings**.

---

## 2. Stub / demo inventory

Marker file counts (a file can carry several markers; counts overlap):

| Marker | Files |
|---|---|
| `TEMPORARY` (any) | 71 |
| `in-memory-demo` | 37 |
| `DB_NOT_READY` | 11 |
| `TEMPORARY_MOCK` | 10 |
| `TEMPORARY_DEMO` | 10 |
| `NOT_WIRED` | 8 |
| `PRISMA_PENDING` | 5 |
| `persisted: false` | 3 |
| **Union of demo/mock markers (final recount)** | **100 files** |

Grouped: **49 of the marked files are under `app/api/v1`** (44 admin + 5
public) — i.e. the API layer is where demo persistence concentrates. The
rest are storefront/admin pages rendering labelled demo data and a few
`src/` demo stores (`src/catalog/mock.ts`, `src/orders/mock.ts`,
`src/reports/demo.ts`, `src/bd/payment-link.ts`, `src/bd/sms-autoverify.ts`,
`src/command-palette/*`, `src/storefront-ux/*`).

Per-marker file lists:

**TEMPORARY_MOCK (10):** `app/api/v1/admin/customers/route.ts`,
`…/customers/[id]/route.ts`, `…/admin/orders/route.ts`,
`…/orders/[id]/route.ts`, `app/api/v1/public/carts/route.ts`,
`…/public/orders/route.ts`, `…/public/track/route.ts`,
`src/command-palette/{CommandPalette.tsx, index-builder.ts, types.ts}`

**TEMPORARY_DEMO (10):** `app/admin/analytics/page.tsx`,
`app/api/v1/admin/{advanced-orders, ai/search, analytics, b2b, inventory,
reports, riders, vendors, vendors/[id]/payout}/route.ts`

**in-memory-demo (37):** API routes for advanced-orders (+preorders),
automation (4 routes), b2b (3), bd (cash-closing, payment-links, sms-verify),
call-center (2), coupons (2), fraud-rules (3), inbox, inventory,
modules (+erp-journal), resellers (2), riders (4), tracking, vendors (3 +
`vendors/store.ts`), public pay `[token]`; plus `src/bd/{payment-link,
sms-autoverify}.ts`.

**NOT_WIRED (8):** `app/api/v1/admin/customers{,/[id]}/route.ts`,
`…/admin/orders{,/[id]}/route.ts`, `…/admin/settings/route.ts`,
`app/api/v1/public/carts{,/merge}/route.ts`, `…/public/orders/route.ts` —
these responses carry `db: "NOT_WIRED"`, `persisted: false`.

**persisted: false (3):** `admin/advanced-orders/route.ts`,
`admin/automation/dry-run/route.ts`, `admin/orders/[id]/route.ts`.

**DB_NOT_READY (11):** the NOT_WIRED order/customer/settings routes,
`admin/orders/feed/route.ts`, `admin/settings/test/route.ts`,
`src/catalog/{api,service}.ts`, and the two admin pages that surface it
(`admin/marketing/coupon-form.tsx`, `admin/products/new/page.tsx`).

**PRISMA_PENDING (5, fail-closed guards):** `src/reports/guard.ts`,
`src/automation/guard.ts`, `src/b2b/guard.ts`, `src/riders/guard.ts`,
`app/api/v1/admin/vendors/guard.ts` — session validation unavailable →
503, never unauthenticated access.

**Known functional gaps inside otherwise-built routes** (from code, not
markers): coupon code in public order create is accepted but applied as 0
until the coupon service is wired in; `riskScore: 0` in order create means
"not scored", not "safe"; admin bulk orders POST is a validated + audited
**202 stub**; the order SSE feed emits only `feed.connected`
(`live: false`) + heartbeats — the < 1 s live target is **not** met.

---

## 3. TODO / FIXME / HACK inventory

**4 TODOs, 0 FIXME, 0 HACK** in `apps/web/src` + `apps/web/app` + `packages`:

| # | Location | Context |
|---|---|---|
| 1 | `apps/web/app/api/v1/admin/auth/login/route.ts:47` | TODO (Step 34 hardening): sign/encrypt the `admin_pending_2fa` cookie value (currently plain userId in an httpOnly, 10-min cookie). |
| 2 | `packages/db/prisma/seed.ts:18` | Pointer to the geo TODO below ("See loadGeoData() and the TODO below"). |
| 3 | `packages/db/prisma/seed.ts:178` | TODO (before production / Step 3 completion): replace/augment sample geo with the full verified Division > District > Upazila > Union dataset at `prisma/data/bd-geo.json`. |
| 4 | `packages/db/prisma/seed.ts:212` | Runtime warning in the same spirit: `bd-geo.json not found — seeding SAMPLE geo data only. TODO: import full verified dataset`. |

Notable deferred items that are documented in code/docs rather than as
TODO comments (so they do not appear above): TOTP-secret encryption on
enrolment, Redis swap for the in-memory rate limiter / settings cache /
tracking dedup store, live (non-sandbox) provider adapters, BullMQ daemon
entrypoint. They are all in §7.

---

## 4. Route coverage — mismatches only

Admin UI top level (from `find app/admin -name page.tsx`): home, analytics,
audit, automation, b2b, call-center, content, customers, design-system, erp,
feature-flags, fraud, inventory, login, marketing, modules, orders,
products, reports, resellers, riders, settings (+ payments, shipping,
notifications, integrations, tracking subpages), staff, vendors.

Admin API top-level groups (65 routes): advanced-orders, ai, analytics,
auth, automation, b2b, bd, call-center, campaigns, coupons, customers,
fraud-rules, inbox, inventory, modules, orders, pages, payments, products,
reports, resellers, riders, settings, shipments, system, tracking, vendors.

### UI pages with no same-name API group

| UI page | Status |
|---|---|
| `/admin/audit` | **UI-only** — no audit API group exists. |
| `/admin/staff` | **UI-only** — no staff API group exists. |
| `/admin/feature-flags` | **UI-only** — toggles are page-local demo state; no flags API group. |
| `/admin/design-system` | UI-only by design (dev showcase). |
| `/admin/fraud` | Name mismatch — API group is `fraud-rules`. |
| `/admin/content` | Name mismatch — API group is `pages`. |
| `/admin/erp` | Name mismatch — API is nested `modules/erp-journal`. |
| `/admin/marketing` | Name mismatch — APIs are split into `coupons` + `campaigns`. |
| `/admin/login` | Paired with `auth/login` + `auth/verify-2fa` (group named `auth`). |

### API groups with no same-name UI page

| API group | Status |
|---|---|
| `advanced-orders` | **API-only** — no dedicated admin page. |
| `ai` (classify/describe/search) | API-only — consumed inside other pages. |
| `bd` (address-parse, cash-closing, courier-reconciliation, payment-links, sms-verify) | API-only — no `/admin/bd` page. |
| `inbox` (+ `inbox/draft`) | **API-only — no `/admin/inbox` page.** |
| `payments` (cod-settlement, manual-trx, sandbox) | No `/admin/payments` page; UI surface is `/admin/settings/payments` (settings shell only). |
| `shipments` (+ cancel, track) | API-only — surfaces inside the orders workspace. |
| `system/health` | Endpoint-only by design. |
| `tracking` | UI exists only as `/admin/settings/tracking`; also **missing from the admin nav config** (nav lists settings payments/shipping/notifications/integrations, not tracking). |
| `auth` | See login row above. |
| POS | **No `/admin/pos` page and no `pos` API group at all** — POS is service/types level only (`src/pos`). |

Public API (11): `carts`, `carts/merge`, `categories`, `orders`,
`products`, `products/[slug]`, `pay/[token]`, `track` all have storefront
pages. API-only by design: `payments/webhook`, `couriers/webhook`
(machine endpoints), `track-events` (tracking intake).

---

## 5. Execution-plan coverage (Steps 0–50)

Status key — **DONE**: code exists and is not demo-persistence dependent.
**PARTIAL**: code exists but persistence is demo/in-memory, a sub-part is
missing, or a success gate was never measured. **BLOCKED**: stopped by the
Prisma engine-download network failure. **DEFERRED**: held by Nazmul's
instruction (live/GitHub) or scope freeze.

| Step | Verdict | Evidence |
|---|---|---|
| 0 Plan confirm + local setup | DONE | Plans/docs filed; gate behaviour superseded by the continuous-work instruction. |
| 1 Monorepo + tooling | DONE | Turborepo/pnpm scaffold on disk; `pnpm install` completed (116 packages). |
| 2 Env loader + local infra | DONE | Zod typed env loader (names keys, never logs values), docker-compose (local defaults only), `.env.example` placeholders. |
| 3 DB schema + BD geo seed | **BLOCKED** (PARTIAL code) | Schema 74 models + seed code exist; geo in seed is **sample-only** (2 divisions) with TODO #3/#4 above; `prisma generate`/migrate/seed have **never run**. |
| 4 Auth, RBAC, session, audit | PARTIAL (runtime BLOCKED) | Libs, 57-permission RBAC, login + verify-2fa routes exist; session validation goes through Prisma, so login cannot run end-to-end yet. Open: TOTP-secret encryption, TODO #1. Suspicious-login alert not evidenced in code. |
| 5 Design System (D0) | DONE | 18 UI components + `/admin/design-system` showcase; tokens, light/dark, Bangla type rules. Font is system fallback (self-hosted font files not added). |
| 6 Admin shell + navigation | DONE | Config-driven nav (27 items) wired into sidebar + mobile bar by integration; middleware redirects `/dashboard`→`/admin` and shell-protects `/admin/*`. Per-user persisted theme/Simple-Pro/density not built. |
| 7 Settings + flags + integration base | PARTIAL | Settings lib (DB-encrypted → env → default), settings API + test route, 17 flags all OFF; DB override path cannot run until Prisma does. |
| 8 Catalog DB + service | PARTIAL | Service + runtime-guarded Prisma repository exist; public reads still serve labelled TEMPORARY MOCK; DB writes blocked on Prisma generate. |
| 9 Product admin UI + media pipeline | PARTIAL | List + editor wired to the products API (honest `DB_NOT_READY` states); media module derives R2 keys/variants but **no upload is performed**. |
| 10 Bulk import/export + search index | PARTIAL | CSV import is **preview-only** (no row silently dropped; confirm goes through the products API); Meilisearch indexer is env-guarded and no-ops when unconfigured; no export route evidenced for products. |
| 11 Storefront base | PARTIAL | Home/shop/search/product pages exist with SEO meta + JSON-LD outline; data source is the mock catalog until Step 8's DB swap. |
| 12 Cart + one-page checkout | PARTIAL | Guest cart, merge, cart page, Zod phone-first checkout, server-side price re-validation all coded; order create persists to an in-memory store (`NOT_WIRED`). |
| 13 Customer auth + account | PARTIAL | Account page exists (demo data); staff auth is built, but customer phone-OTP login as a runtime flow is not evidenced beyond the `OtpCode` model and auth helpers. Google/Facebook login not built. |
| 14 Order creation transaction + abandoned | PARTIAL | The 7-step `prisma.$transaction` sequence is coded (`createOrderTransactionSteps`) and idempotency returns the original order — against the in-memory store, not a real transaction. Abandoned-cart follow-up is a stub state machine. |
| 15 Storefront polish | PARTIAL | Quick view, sticky bar, compare (max 3), size guide, recently viewed, wishlist, Banglish search contract exist. Not built: mega menu, single-product landing-page builder, admin theme config. |
| 16 Order admin (list/kanban/detail) | PARTIAL | List, `[id]` workspace, One-Click panel, state machine enforced in pure logic (invalid → 422); all on mock data; kanban exists from the early slice. |
| 17 Documents + manual order + return/refund | PARTIAL | Print data/panels (A4 + thermal), manual order, Return model, refund-sum rule in service; restock/QC runtime flow is demo-level. |
| 18 CRM + realtime feed | PARTIAL | Customer list/profile APIs + pages on mock data, masking + `logPhoneAccess` in place. **Realtime not delivered:** SSE sends `feed.connected` (`live:false`) + heartbeats only; the < 1 s target is explicitly unmet (needs Redis pub/sub). |
| 19 Payment base + COD + manual | PARTIAL | Adapter interfaces, manual-TrxID flow (duplicate refused twice, review-once, audit without full TrxID), COD settlement math — persistence in-memory; sandbox only. |
| 20 Payment gateways (sandbox first) | PARTIAL | Sandbox bKash/Nagad/SSLCommerz with HMAC verify + idempotent webhooks; **live adapters not implemented** — settings test returns 503 for live mode rather than faking success. Rocket/Upay/AamarPay/ShurjoPay are interface-level. |
| 21 Courier base + booking + tracking | PARTIAL | Sandbox Steadfast/Pathao/RedX, zone/weight charges in poisha; Paperfly/eCourier interface-only; no live provider calls; real area/zone lookups not built. |
| 22 Courier admin + COD settlement | PARTIAL | Book/track/cancel routes (sandbox, `SBX-` ids), COD settlement over demo DELIVERED rows; no cron/webhook status sync against real couriers. |
| 23 Inventory admin | PARTIAL | Ledger-only service rules (available never negative, damaged returns don't restore), inventory + purchase-order routes/pages on demo data; `Supplier`/`PurchaseOrder` models exist; goods-receive end-to-end not wired. Low-stock list exists; alert sending does not. |
| 24 Multi-warehouse + advanced inventory | PARTIAL | Transfer legs, FEFO batch, serial/IMEI types, forecast — pure logic + demo stores behind flags. |
| 25 Marketing core | PARTIAL | Coupon/flash-sale/campaign services + marketing page; **coupon applies as 0 inside order create** (service not yet wired there). Buy-X-Get-Y / tiered / free-gift not separately evidenced. |
| 26 Campaigns + tracking + abandoned recovery | PARTIAL | Campaign = **cost estimate only, nothing is sent**; CAPI payload builder + eventId dedup + consent gating built, sender is sandbox/no-op; GA4/TikTok are payload shapes only; abandoned recovery stubbed. |
| 27 Affiliate, referral, loyalty, landing | PARTIAL (mostly missing) | Grep finds **no** `loyalty`, `referral`, or `affiliate` code in `src`/`app`. The reseller panel (Step 46) covers adjacent scope only; loyalty points, referral, landing-page builder are not built. |
| 28 Reports + accounting core | PARTIAL | Report aggregations, CSV export, P&L, previous-period comparison — over demo rows; numbers cannot reconcile against a real DB yet. ERP-lite accounting sits in Step 49. |
| 29 CMS + polish + i18n | PARTIAL | CMS service (in-memory) + `CmsPage`/`CmsPost`/`SeoRedirect` models + content page; legal/info pages are static content modules. Sitemap/robots/SEO tooling and full i18n completion not evidenced. |
| 30 PWA + mobile admin polish | PARTIAL | Manifest, service worker, offline page, shortcuts, **and generated 192/512/maskable icons** all exist; SW registration + manifest wired in root layout. Push notifications: no code (grep empty). Persisted Simple/Pro mode not built. |
| 31 Notification system final | PARTIAL | Queue contracts for sms/email/notification-retry + `NotificationLog` model + channel adapter interfaces exist; per-status editable templates, delivery/retry runtime, notification center not wired. |
| 32 API final + webhook + docs | PARTIAL | 76 routes with Zod + `{data, meta}`/`{error}` format; webhook pipeline (sandbox) + extensibility webhook types exist. **OpenAPI docs: none** (grep empty). Rate limiting is in-memory only. |
| 33 Performance + SEO + a11y pass | PARTIAL (unmeasured) | Meta/JSON-LD present on product pages; **no Lighthouse/INP/LCP/CLS measurement has been run**, no build exists to measure. Targets from the dashboard plan remain unverified claims, not results. |
| 34 Security review | PARTIAL | Fail-closed guards, hash-only secrets, encrypted settings, audit-with-reason patterns are in code; the formal review pass is not documented as done, and TODO #1 + TOTP-secret encryption remain open. |
| 35 Backup, health, queue monitor | PARTIAL | Health endpoint exists (booleans + status word only). **Backup/restore: no code** (mentioned only in `docs/BACKLOG.md`); queue monitor/board not built; workers are wiring/policy, no daemon. |
| 36 E2E + load + visual | PARTIAL (scaffolding) | Playwright config + 5 specs exist, **none run** (`@playwright/test` not installed, no server/DB); no load test, no visual regression. |
| 37 Docs + demo data + setup wizard | PARTIAL | Docs are extensive (ARCHITECTURE, RUNBOOK-LOCAL, MODULES, QA-CHECKLIST, this audit); demo/sample data exists throughout; **setup wizard: no code** (grep empty); first-owner script exists. |
| 38 Local QA + sign-off | **BLOCKED** | QA checklist exists and slice-level typechecks/smoke tests pass, but end-to-end local QA (login → order → payment → courier on a real DB) cannot run until the Prisma blocker clears. No production build has passed. |
| 39–42 Live prep / deploy / monitoring / sign-off | **DEFERRED** | By Nazmul's instruction — live only on an explicit "live koro". Nothing deployed. |
| GitHub push | **DEFERRED** | By Nazmul's "push later" instruction; connector OAuth not completed; nothing pushed. |
| 43 Automation + Fraud | PARTIAL | Rule engine (dry-run, traces, scheduled runs) + 0–100 fraud scoring smoke-tested as pure logic; demo flag stores; no DB persistence (`AutomationRule`/`AutomationRunLog`/`FraudListEntry` models exist); fraud score **not enforced in checkout** (order create uses `riskScore: 0`). |
| 44 BD: SMS auto-verify + address parser + payment link | PARTIAL | Parsers built + 35-assertion smoke test passed per agent report; `PaymentLink` model added; `/pay/[token]` works against the in-memory demo store (incl. a seeded temporary demo link to delete at DB swap); SMS ingestion (forwarder/paste flow into real orders) not wired. |
| 45 Masking + cash closing + reconciliation + rider | PARTIAL | Masking in validators + access logging done; cash-closing and courier-reconciliation pure logic done (disputes never auto-adjusted); rider module complete as code (proof required, OTP hash-only). Export restriction/watermark/approval flow and rider live location not built. |
| 46 Reseller + Call Center + F-commerce + POS | PARTIAL | Services + APIs for reseller, call-center, inbox, POS landed; admin pages exist for resellers + call-center only — **inbox and POS are API/service-only** (§4). No real Messenger/WhatsApp/Instagram APIs. |
| 47 AI + Smart Search + Analytics | PARTIAL | Template-fallback description/SEO/classify (labelled `engine: "template-fallback"`, not an LLM), NL command search, RFM/cohort/LTV-CAC-ROAS, courier/staff performance — pure logic over demo rows; funnel returns `null` with reason (no tracking data source); real AI provider not connected. |
| 48 Advanced Order/Inventory + B2B + Multi-vendor | PARTIAL | Split/partial/exchange/merge, wholesale tiers, quotations, credit checks, vendor commission/payout — pure logic + demo stores; `PreOrder`/`StockTransfer`/`Vendor`/`B2bCustomer`/`Quotation` models exist; no DB persistence; commission not generated from real deliveries. |
| 49 Extensibility + business packs + ERP-lite | PARTIAL | Hook/adapter registries, custom fields, hash-only API keys (`ApiKey` model), webhook subscriptions, 5 business packs (fashion/electronics/grocery/pharmacy/digital), ERP-lite double-entry (`Erp*` models) built. Plugin **runtime sandbox deferred by design**; plan-named packs beyond the five (food, course, rental, subscription, service, custom) not built. |
| 50 Future (Part L) | **DEFERRED** | Scope freeze — backlog items only, not started, by design. |

**Roll-up:** DONE 5 (Steps 0, 1, 2, 5, 6) · PARTIAL 35 (3–4, 7–37, 43–49,
with Step 3's code partial but its runtime blocked) · BLOCKED 2 (Step 3
runtime, Step 38) · DEFERRED 6 (Steps 39, 40, 41, 42, 50, GitHub push).

---

## 6. Typecheck (run during this audit)

Command: `npx tsc --noEmit -p tsconfig.json` in `apps/web`
(equivalent to the package's `typecheck` script). Exit code **2**,
**exactly 2 errors**:

```
src/lib/auth.ts(134,56): error TS7006: Parameter 'rp' implicitly has an 'any' type.
../../packages/db/src/index.ts(1,10): error TS2305: Module '"@prisma/client"' has no exported member 'PrismaClient'.
```

Both errors are downstream of the ungenerated Prisma client — there are
**zero errors in any application code**. This matches every slice report
since the second agent batch. It also means the schema has still **not**
passed `prisma validate` and no production build has been run.

**The blocker (unchanged):** `prisma generate` fails downloading the
engine binary from `binaries.prisma.sh` (`ECONNRESET`, re-verified by the
main agent on 2026-10-24). The Prisma cache directory exists but is empty;
pnpm is ignoring the Prisma packages' build scripts, so no query-engine
binary is present. Detail: `packages/db/PRISMA-BLOCKER.md`.

---

## 7. Remaining to a working local product — ordered, shortest first

**Prisma unblock sequence (do first, in this exact order, the moment
network to `binaries.prisma.sh` works or an engine binary is supplied):**

1. `pnpm --filter @advance-ecommerce/db db:generate` — generate the client.
2. `prisma validate` on `packages/db/prisma/schema.prisma` — first-ever
   validation of the merged 74-model schema; fix any schema errors it
   surfaces before proceeding.
3. `prisma migrate dev` against local Postgres (docker-compose defaults).
4. `pnpm db:seed` — permissions/roles/flags/settings + sample catalog/geo.
5. Create the first Owner: `packages/db/scripts/create-first-owner.ts`
   (credentials from local env only).
6. Re-run `pnpm --filter web typecheck` — expect **0 errors** (both §6
   errors should disappear); then `next build` for the first production
   build pass.

**Then, shortest first:**

7. Verify staff login + TOTP end-to-end at `/admin/login` against the
   seeded DB (first runtime proof of Step 4).
8. Swap order/cart/customer persistence from in-memory stores to Prisma
   at the marked points (NOT_WIRED routes in §2); delete the
   `db: "NOT_WIRED"` / `persisted: false` markers as each lands.
9. Wire the real coupon service into public order create (coupons stop
   applying as 0) and real fraud scoring into checkout (replaces
   `riskScore: 0`; enforce OTP ≥ 70, block ≥ 90 / blacklist).
10. Swap catalog repository + product writes + initial-stock ledger
    entries to Prisma; public catalog reads stop serving TEMPORARY MOCK.
11. Swap payment/courier/shipment/manual-TrxID/webhook-log persistence
    to Prisma (DB unique constraints as the idempotency backstop).
12. Swap inventory, coupons, campaigns, reports, CMS, automation/fraud,
    BD (payment links, cash closings), riders, vendors, B2B stores to
    Prisma behind their existing interfaces; retire demo stores module
    by module.
13. Replace the demo flag stores with one DB-backed `feature_flags`
    reader (same interfaces) so admin toggles actually gate modules;
    build the missing staff/audit/feature-flags APIs (§4) behind the
    existing pages.
14. TOTP-secret encryption on enrolment + decryption on verify; sign/
    encrypt the pending-2FA cookie (TODO #1).
15. Replace in-memory rate limiter, settings cache, and tracking dedup
    store with Redis (same key shapes/contracts).
16. Install `bullmq` + `ioredis` and run the worker daemon from
    `src/jobs/workers.ts` (SMS, email, courier booking/sync, webhook
    delivery, abandoned-cart, automation runs); add Redis pub/sub so the
    admin order SSE feed delivers live events.
17. Load the full verified BD geo dataset into
    `packages/db/prisma/data/bd-geo.json` (TODO #3) and re-seed; delete
    sample geo only then.
18. Run the Playwright suite (`pnpm add -Dw @playwright/test`, install
    chromium, seeded DB + dev server, env-gated credentials) — checkout,
    order, payment-sandbox, courier-sandbox specs.
19. Local QA sign-off pass against `docs/QA-CHECKLIST.md` (Step 38):
    order end-to-end, sandbox payment/courier, report reconciliation
    against raw DB rows, mobile admin, Bangla UX.
20. Build the missing UI surfaces if wanted before handover: `/admin/bd`,
    `/admin/inbox`, `/admin/pos`, payments page, advanced-orders page;
    add the tracking settings page to the admin nav.
21. Step 27 remainder (loyalty/referral/affiliate, landing-page builder),
    OpenAPI generation (Step 32), backup/restore (Step 35), push
    notifications (Step 30), self-hosted fonts — all currently absent.
22. Real (non-sandbox) provider adapters behind the existing interfaces:
    payments, couriers (incl. Paperfly/eCourier + area-zone lookups),
    SMS/email sending, Meilisearch live indexing, real CAPI sender,
    real AI provider — credentials only via encrypted Admin Settings.
23. Performance/SEO/a11y measurement pass (Step 33) once a build exists.
24. **Only on Nazmul's separate instructions:** GitHub push (OAuth flow,
    never the exposed chat token), then live deployment Steps 39–42.

---

## Appendix — commands actually run

```bash
# Counts
find apps/web/src apps/web/app packages -type f \( -name "*.ts" -o -name "*.tsx" \) -not -path "*/node_modules/*" | wc -l
find apps packages -name "page.tsx" -not -path "*/node_modules/*" | wc -l
find apps/web/app/api -name "route.ts" | wc -l   # + /v1/admin and /v1/public splits
grep -c "^model " packages/db/prisma/schema.prisma
grep -c "^enum "  packages/db/prisma/schema.prisma

# Feature flags (block-scoped count in seed.ts)
awk '/^const FEATURE_FLAGS/,/^\];/' packages/db/prisma/seed.ts | grep -oE 'module\.[a-z0-9_.]+' | sort -u

# Permissions compare (digit-aware — a [a-z_]+ pattern silently drops b2b.*)
sed -n '14,86p' apps/web/src/lib/rbac.ts | grep -oE '"[a-z][a-z0-9_]*\.[a-z_]+"' | tr -d '"' | sort -u
awk 'NR>=34 && NR<=93' packages/db/prisma/seed.ts | grep -oE 'key: "[a-z][a-z0-9_]*\.[a-z_]+"' | sed 's/key: "//;s/"//' | sort -u
diff rbac.txt seed.txt   # clean — sets identical, 57 each

# Admin nav
grep -c 'path: "/admin' apps/web/src/admin-nav/config.ts

# Markers (per marker, then union), grouped by path
grep -rl "<MARKER>" apps/web/src apps/web/app packages --include="*.ts" --include="*.tsx"
grep -rlE "TEMPORARY_MOCK|TEMPORARY_DEMO|in-memory-demo|NOT_WIRED|persisted: ?false|TEMPORARY DEMO|TEMPORARY MOCK|DB_NOT_READY" … | wc -l

# TODO/FIXME/HACK
grep -rnE "\bTODO\b|\bFIXME\b|\bHACK\b" apps/web/src apps/web/app packages tests | grep -v node_modules

# Route coverage
find apps/web/app/admin -name "page.tsx"
find apps/web/app/api/v1/{admin,public} -name "route.ts"

# Absence checks (all returned nothing in src/app)
grep -ril "loyalty|referral|affiliate" apps/web/src apps/web/app
grep -ril "openapi" apps/web/src apps/web/app docs
grep -ril "SetupWizard|setup-wizard" apps/web/src apps/web/app docs
grep -ril "backup" apps/web/src apps/web/app        # docs/BACKLOG.md only
grep -ril "web-push|pushSubscription" apps/web/src apps/web/app

# Typecheck
cd apps/web && npx tsc --noEmit -p tsconfig.json    # exit 2, exactly 2 errors (§6)
```
