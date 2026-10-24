# FINAL AUDIT v2 — Updated Integration Audit

**Snapshot:** 2026-10-24, 09:20 UTC (15:20 Asia/Dhaka), local only.
**Method:** read/grep/count commands only, plus full web typechecks. Every
number below comes from a command actually run during this audit; the
commands are in the Appendix. No status was invented. This audit supersedes
`docs/FINAL-AUDIT.md` (v1, snapshot 2026-10-24 ~08:55 UTC) on every figure
where the two disagree.

**Concurrency caveat (larger than v1's):** the agent pipeline was actively
writing *throughout* this audit. Counts moved while measuring — TS/TSX
454 → 467, API routes 87 → 93, schema models 81 → 85 — as Agents 38–47's
remaining files and a courier-invoice slice landed (files timestamped
09:14–09:19 UTC: public contact endpoint, BD SMS-ingest route, BD
courier-invoice routes + schema models). Headline numbers are the **final
snapshot**, confirmed by three consecutive stable 30-second snapshots
(09:20:06–09:21 UTC) and a post-typecheck recount. Small drift is still
possible if the pipeline writes again after this snapshot.

---

## 1. Fresh counts (final snapshot) and v1 → v2 delta

| Metric | v1 (Agent 34) | v2 (this audit) | Source |
|---|---|---|---|
| TS/TSX files (`apps` + `packages`, excl. `node_modules`) | 397 | **467** (344 `.ts`, 123 `.tsx`) | `find … -name "*.ts" / "*.tsx"` |
| `page.tsx` files | 51 | **60** (40 under `app/admin`) | `find apps packages -name "page.tsx"` |
| API `route.ts` files | 76 (65 admin + 11 public) | **93** (80 admin + 12 public + 1 `openapi.json`) | `find apps/web/app/api -name "route.ts"` |
| Prisma models | 74 | **85** | `grep -c "^model " schema.prisma` |
| Prisma enums | 20 | **20** (unchanged) | `grep -c "^enum " schema.prisma` |
| Schema size | 1,289 lines / 36,579 bytes | **1,438 lines / 40,975 bytes** | `wc -lc schema.prisma` |
| Feature flags in seed `FEATURE_FLAGS` | 17 | **19**, all seeded OFF | block count in `seed.ts` |
| Permissions — RBAC catalogue | 57 | **57** | `PERMISSIONS`, `src/lib/rbac.ts` |
| Permissions — seed catalogue | 57 | **57** | `PERMISSIONS` block, `seed.ts` |
| Permissions RBAC vs seed | sets identical | **sets identical** (`diff` clean, re-run) | see Appendix |
| Admin nav items | 27 | **36** | `path: "/admin…"` entries in `src/admin-nav/config.ts` |

**New schema models since v1 (+11):** `AffiliateCommission`,
`AffiliatePartner`, `PointsLedgerEntry`, `Referral` (loyalty slice);
`PosRegister`, `PosShift`, `PosSale` (POS); `SmsIngestion`,
`CourierInvoiceRun`, `CourierDispute`, `DisputeAdjustment` (BD slices —
the last four landed *during this audit* with the courier-invoice API
group). All other models named in the v2 brief (`PaymentLink`,
`DailyCashClosing`, `AutomationRule`, `AutomationRunLog`,
`FraudListEntry`, `PreOrder`, `StockTransfer`, `Vendor`, `B2bCustomer`,
`Quotation`, `ErpAccount`, `ErpJournalEntry`, `ErpJournalLine`,
`ErpPeriod`, `ApiKey`, `WebhookSubscription`, `Rider`, `RiderDelivery`,
`BackInStockSignup`) were already inside v1's 74 and are still present —
verified against the full model list in this audit.

**Feature flag keys (19):** `module.reseller`, `module.call_center`,
`module.pos`, `module.multi_vendor`, `module.automation`,
`module.fraud_scoring`, `module.rider`, `module.f_commerce`,
`module.ai_assist`, `module.advanced_analytics`, `module.b2b`,
`module.fashion`, `module.electronics`, `module.grocery`,
`module.pharmacy`, `module.digital_goods`, `module.erp_lite`,
`module.loyalty` (new since v1), `module.advanced_orders` (new since v1).

**Flag consistency (new check):** every `module.*` key referenced in
`apps/web/src` + `apps/web/app` was extracted and diffed against the seed
list — **identical sets (19 = 19)**; the only extra grep hit is the
literal string `module.action` in a doc comment in `rbac.ts`, which is
the permission-format description, not a flag. Two **stale comments**
remain, however: `src/loyalty/store.ts` (header) and the loyalty item in
`src/admin-nav/config.ts` still say `module.loyalty` is *not* in the seed
— it now is (seed.ts line 140). The flag itself is consistent; only the
comments lag.

### Disagreements with earlier docs

- v1's counts (397 / 76 / 51 / 74 models / 17 flags) were correct at
  08:55 UTC and are superseded by the growth above — Agents 33–47 landed
  after v1's snapshot.
- `docs/ARCHITECTURE.md` / project `README.md` figures (331 files /
  74 routes / 34 pages) remain stale, unchanged since Agent 22.
- The execution plan's own overview table still disagrees with its step
  headings by one step from Step 23 onward (see v1 §1); §5 below follows
  the **headings**, as v1 did.

---

## 2. Stub / demo inventory

Marker file counts (a file can carry several markers; counts overlap):

| Marker | v1 files | v2 files |
|---|---|---|
| `in-memory-demo` | 37 | **58** |
| `TEMPORARY_DEMO` | 10 | **16** |
| `NOT_WIRED` | 8 | **13** |
| `TEMPORARY_MOCK` | 10 | **12** |
| `DB_NOT_READY` | 11 | **11** |
| `persisted: false` | 3 | **8** |
| `PRISMA_PENDING` | 5 | **6** |
| **Union (v1 Appendix marker set)** | **100** | **140** |
| Union restricted to `app/api` | 49 | **66** |

The union grew mainly because new slices (POS, loyalty, system APIs,
setup, courier-invoice) arrived with the same honest demo labelling — the
marker *density* did not worsen: 140 of 467 files (30%) vs 100 of 397
(25%) on the broad v1 pattern, which also matches spaced UI text
("TEMPORARY DEMO" / "TEMPORARY MOCK" panel labels). On code tokens only
(`TEMPORARY_MOCK|TEMPORARY_DEMO|in-memory-demo|NOT_WIRED|DB_NOT_READY|
PRISMA_PENDING|persisted: false`) the union measured during this audit
was **83 files** before the last route burst.

**`PRISMA_PENDING` guards (6, fail-closed):** the v1 five
(`src/reports/guard.ts`, `src/automation/guard.ts`, `src/b2b/guard.ts`,
`src/riders/guard.ts`, `app/api/v1/admin/vendors/guard.ts`) plus
`app/api/v1/admin/pos/guard.ts` — session validation unavailable → 503,
never unauthenticated access.

**Known functional gaps inside otherwise-built routes (re-verified in
code this audit, unchanged from v1):** coupon code in public order create
is accepted but applied as 0 (`couponDiscountPoisha = 0`, comment at
`app/api/v1/public/orders/route.ts:153-155`); `riskScore: 0` in order
create means "not scored", not "safe" (line 176); admin bulk orders POST
remains a validated + audited 202 stub; the order SSE feed emits only
`feed.connected` (`live: false`) + heartbeats — the < 1 s live target is
**not** met (needs Redis pub/sub).

---

## 3. TODO / FIXME / HACK inventory

**4 TODOs, 0 FIXME, 0 HACK** — the same four as v1, two line numbers
shifted by seed growth:

| # | Location | Context |
|---|---|---|
| 1 | `apps/web/app/api/v1/admin/auth/login/route.ts:47` | TODO (Step 34 hardening): sign/encrypt the `admin_pending_2fa` cookie value. |
| 2 | `packages/db/prisma/seed.ts:18` | Pointer to the geo TODO below ("See loadGeoData() and the TODO below"). |
| 3 | `packages/db/prisma/seed.ts:180` | TODO (before production / Step 3 completion): replace/augment sample geo with the full verified Division > District > Upazila > Union dataset at `prisma/data/bd-geo.json`. |
| 4 | `packages/db/prisma/seed.ts:214` | Runtime warning in the same spirit: `bd-geo.json not found — seeding SAMPLE geo data only. TODO: import full verified dataset`. |

Notable deferred items documented in code/docs rather than as TODO
comments (unchanged from v1): TOTP-secret encryption on enrolment, Redis
swap for the in-memory rate limiter / settings cache / tracking dedup
store, live (non-sandbox) provider adapters, BullMQ daemon entrypoint.
All are in §7.

---

## 4. Route coverage — mismatches only (much shorter than v1)

Admin UI top level (40 pages under `app/admin`): home, advanced-orders,
ai-assist, analytics, audit, automation, b2b, bd-tools, call-center,
content, customers, design-system, erp, feature-flags, fraud, inbox,
inventory, login, loyalty, marketing, modules, orders (+ `[id]`),
payments, pos, products (+ `new`), reports, resellers, riders, settings
(+ payments, shipping, notifications, integrations, tracking subpages),
setup, shipments, staff, vendors.

Admin API top-level groups (80 routes): advanced-orders, ai, analytics,
audit-log, auth, automation, b2b, bd, call-center, campaigns, coupons,
customers, feature-flags, fraud-rules, inbox, inventory, loyalty,
modules, orders, pages, payments, pos, products, reports, resellers,
riders, settings, setup, shipments, staff, system, tracking, vendors.

### Closed since v1 (were mismatches, are now paired)

| Surface | v1 status | v2 status |
|---|---|---|
| `/admin/staff` | UI-only, no API | **Paired** — `staff` API (GET/POST, demo store) |
| `/admin/audit` | UI-only, no API | **Paired** — `audit-log` API + `audit-log/export` |
| `/admin/feature-flags` | UI-only, page-local toggles | **Paired** — `feature-flags` API (GET/PATCH, demo store) |
| `/admin/pos` | **neither page nor API** | **Paired both sides** — page + `pos` API (`pos`, `pos/sale`, `pos/scan`, `pos/shift`) |
| `/admin/inbox` | API-only, no page | **Paired** — inbox page (page + client component) |
| BD tools | API-only, no page | **Paired** — `/admin/bd-tools` page over the `bd` group |
| `/admin/payments` | no page | **Paired** — payments page over the `payments` group |
| `/admin/shipments` | API-only | **Paired** — shipments page |
| `/admin/advanced-orders` | API-only | **Paired** — advanced-orders page |
| AI | API-only | **Paired** — `/admin/ai-assist` page over the `ai` group |
| Tracking settings | page existed, missing from nav | **In nav** (36 items include `settings/tracking`) |

### Remaining mismatches — name differences only, no missing side

| UI page | API group | Note |
|---|---|---|
| `/admin/fraud` | `fraud-rules` | Same module, different name. |
| `/admin/content` | `pages` | CMS pages/posts API. |
| `/admin/erp` | `modules/erp-journal` | Nested under modules. |
| `/admin/marketing` | `coupons` + `campaigns` | Split APIs, one page. |
| `/admin/audit` | `audit-log` | Paired; name differs. |
| `/admin/bd-tools` | `bd` | Paired; name differs. |
| `/admin/ai-assist` | `ai` | Paired; name differs. |
| `/admin/login` | `auth/login` + `auth/verify-2fa` | Group named `auth`. |

### API-only by design (unchanged from v1)

`system/health` (internal probe), `openapi.json` (the spec itself),
public `payments/webhook` + `couriers/webhook` (signature-verified
machine endpoints), public `track-events` (tracking intake). Public
`categories` has no dedicated storefront page — it is consumed by the
shop/home pages. Every other public group (`products`, `carts`,
`orders`, `pay/[token]`, `track`, `contact`) has a matching storefront
page; the **public contact endpoint** (`POST /api/v1/public/contact`,
`src/contact/*`) landed during this audit and is paired with `/contact`.

**Bottom line:** unlike v1, there is now **no admin page without an API
group and no admin API group without a page** — the residual list is
naming differences and by-design endpoints only.

---

## 5. OpenAPI registry vs filesystem re-check

Method: extracted every `(method, path)` pair from
`API_ROUTE_REGISTRY` in `src/platform/openapi.ts` (the derivation the
file itself documents) and every exported HTTP method from every
`app/api/**/route.ts`, then diffed the sets.

- Registry entries: **131** (including 3 `includeInSpec: false`
  exclusions: `GET system/health`, `POST public/payments/webhook`,
  `POST public/couriers/webhook` — kept for filesystem accounting).
- Route files on disk: **93**; exported operations on disk: **139**.
- **Registry → filesystem: exact.** Zero registry entries point at a
  non-existent operation.
- **Filesystem → registry: 8 operations not in the registry**, of which:
  - **4 are deliberate 405 stubs**, correctly excluded: `GET` on
    `admin/auth/login`, `public/orders`, `public/track-events`,
    `public/contact` — each returns `METHOD_NOT_ALLOWED` ("Use POST").
  - **4 are a genuine gap — the POS group is missing from the
    registry:** `GET /api/v1/admin/pos`, `POST /api/v1/admin/pos/sale`,
    `POST /api/v1/admin/pos/scan`, `POST /api/v1/admin/pos/shift`.
- The registry **does** now include the newer operations the v2 brief
  named: `staff` (GET/POST), `audit-log` (GET + export POST),
  `feature-flags` (GET/PATCH), and `public/contact` (POST) — the contact
  entry was added *during this audit* (registry grew 124 → 131 entries
  while measuring, alongside the sms-ingest and courier-invoice groups).

**Fix needed (one item):** add the 4 POS operations to
`API_ROUTE_REGISTRY`. Everything else reconciles.

---

## 6. Execution-plan coverage (Steps 0–50), refreshed

Status key (same conservative rule as v1) — **DONE**: code exists and is
not demo-persistence dependent. **PARTIAL**: code exists but persistence
is demo/in-memory, a sub-part is missing, or a success gate was never
measured. **BLOCKED**: stopped by the Prisma engine-download network
failure. **DEFERRED**: held by Nazmul's instruction (live/GitHub) or
scope freeze. Demo persistence is never DONE.

Only steps whose verdict or evidence **changed since v1** are listed
individually; unchanged steps are grouped after.

| Step | v1 | v2 | Evidence for the change |
|---|---|---|---|
| 3 DB schema + BD geo seed | BLOCKED (partial code) | **BLOCKED** (partial code) | Schema grew 74 → 85 models; runtime still never executed (`prisma generate` still blocked); geo in seed still **sample-only**. |
| 6 Admin shell + navigation | DONE | DONE | Nav grew 27 → 36 items (payments, shipments, call-center, pos, inbox, bd-tools, advanced-orders, resellers, loyalty, ai-assist, settings/tracking added); still config-driven. |
| 7 Settings + flags base | PARTIAL | PARTIAL | Seed flags 17 → 19 and code/seed flag sets now diff-identical (§1); `feature-flags` API exists (demo store). DB override path still cannot run until Prisma does. |
| 12 Cart + checkout | PARTIAL | PARTIAL | Cart page (`/(store)/cart`) and add-to-cart wiring (ProductCard + product buy box → real guest cart) landed after v1; order create still persists to an in-memory store (`NOT_WIRED`). |
| 27 Affiliate, referral, loyalty, landing | PARTIAL (mostly missing) | **PARTIAL** | **Gap closed at code layer:** `src/loyalty/*` (points ledger, referral, affiliate), `/admin/loyalty` page, `loyalty` API, schema models `PointsLedgerEntry`/`Referral`/`AffiliatePartner`/`AffiliateCommission` — all demo persistence. Landing-page builder still not built. |
| 30 PWA + mobile admin polish | PARTIAL | PARTIAL | **Push base now exists:** `src/platform/push.ts` — subscription types, payload builder, trigger map, sandbox/no-op sender (no VAPID keys, no network). Real push sending still not built. Icons already existed in v1. |
| 32 API final + webhook + docs | PARTIAL | PARTIAL | **OpenAPI now exists:** `src/platform/openapi.ts` registry + `GET /api/openapi.json`, reconciled in §5 (one gap: POS operations). Rate limiting still in-memory only. |
| 37 Docs + demo data + setup wizard | PARTIAL | PARTIAL | **Setup wizard now exists:** `/admin/setup` (multi-step, localStorage progress) + `POST /api/v1/admin/setup` (demo store, `persisted: false`, never claims DB save). Docs grew (this audit). |
| 46 Reseller + Call Center + F-commerce + POS | PARTIAL | PARTIAL | **Inbox and POS pages + POS API now exist** (v1: API/service-only). Still no real Messenger/WhatsApp/Instagram APIs; POS persistence is demo. |
| 44 BD differentiators | PARTIAL | PARTIAL | Courier-invoice reconciliation group (`bd/courier-invoice/*` + `CourierInvoiceRun`/`CourierDispute`/`DisputeAdjustment` models) and `bd/sms-ingest` (+ `SmsIngestion` model) landed during this audit; still demo persistence, SMS ingestion not yet wired to real orders. |

**Unchanged verdicts from v1** (evidence re-verified by counts/code
spot-checks, not re-audited line by line): Steps 0, 1, 2, 5 **DONE**;
Steps 4, 8–11, 13–26, 28, 29, 31, 33–36, 43, 45, 47–49 **PARTIAL**
(Step 4's runtime remains blocked by the same Prisma failure; Step 35's
backup/restore still has **no code** — grep finds `backup` only in docs;
Step 36's Playwright specs still unrun); Steps 39–42 and 50
**DEFERRED**.

**Roll-up (arithmetic corrected — v1's "PARTIAL 35" undercounted its own
ranges):** of Steps 0–50 (51 steps): **DONE 5** (0, 1, 2, 5, 6) ·
**PARTIAL 39** (4, 7–37, 43–49) · **BLOCKED 2** (Step 3 runtime,
Step 38) · **DEFERRED 5** (39, 40, 41, 42, 50) — plus **GitHub push
DEFERRED** as a separate non-step line, as in v1. 5 + 39 + 2 + 5 = 51. ✓

### Earlier gaps now CLOSED at the code layer (explicit list)

Loyalty/referral/affiliate (Step 27) · OpenAPI docs (Step 32) · setup
wizard (Step 37) · push-notification base (Step 30) · POS page **and**
API (Step 46) · staff / audit-log / feature-flags APIs (§4) · inbox,
BD-tools, payments, shipments, advanced-orders, AI-assist admin pages
(§4) · cart page + add-to-cart wiring (Step 12) · public contact
endpoint · tracking settings page in nav. **Still absent (verified by
grep):** backup/restore code, real push sending, landing-page builder,
queue monitor/board, self-hosted fonts.

---

## 7. Agent 14 anomaly — stated plainly

Agent 14 (Reseller + Call Center + F-commerce Inbox + POS base) was
spawned on 2026-10-24 and **its final report never arrived** in the main
conversation — no completion handoff for it exists. Its work is
nevertheless **on disk and typechecks**. Verified in this audit by
listing its files:

- `src/` — **21 files**: `src/reseller/{flags,index,pricing,service,
  types,wallet}.ts` (6), `src/callcenter/{flags,index,queue,service,
  types}.ts` (5), `src/inbox/{conversion,flags,index,service,types}.ts`
  (5), `src/pos/{flags,index,register,service,types}.ts` (5).
- Admin pages: `app/admin/resellers/page.tsx`,
  `app/admin/call-center/page.tsx`, `app/admin/inbox/{page.tsx,
  inbox-client.tsx}`, `app/admin/pos/{page.tsx, register-client.tsx}`.
- API routes: `call-center/route.ts`, `call-center/outcome/route.ts`,
  `inbox/route.ts`, `inbox/draft/route.ts`, `resellers/route.ts`,
  `resellers/withdrawals/route.ts` (6 route files; the `pos` API group
  was completed by a later slice over Agent 14's `src/pos` service).

The full typecheck in §8 was run over a tree containing all of the
above and reports **zero errors in any Agent 14 file** (the only errors
are the two known Prisma-client ones). So: report missing, work present
and compiling — the anomaly is in reporting, not in the code. A later
agent should still do a dedicated review pass over these slices, since
no completion report means no agent ever stated their stubs/limits for
them (their demo markers are, however, present per §2).

---

## 8. Typecheck (run during this audit)

Command: `npx tsc --noEmit -p tsconfig.json` in `apps/web` (equivalent
to the package's `typecheck` script). Run twice; error output identical
both times (exit code reported as 2 on the first run, 1 on the re-run —
the *output* is what matters and it did not change):

```
src/lib/auth.ts(134,56): error TS7006: Parameter 'rp' implicitly has an 'any' type.
../../packages/db/src/index.ts(1,10): error TS2305: Module '"@prisma/client"' has no exported member 'PrismaClient'.
```

**Exactly 2 errors, both downstream of the ungenerated Prisma client —
zero errors in application code**, including every file that landed
during this audit (the re-run was taken after the final stable snapshot
and a post-run recount showed files/routes/models unchanged). The merged
schema has still **not** passed `prisma validate` and no production
build has been run.

**The blocker (unchanged):** `prisma generate` fails downloading the
engine binary from `binaries.prisma.sh` (`ECONNRESET`). Detail:
`packages/db/PRISMA-BLOCKER.md`.

---

## 9. Remaining to a working local product — ordered

The code-layer surface is now essentially complete; what remains is
dominated by the Prisma unblock, the persistence swaps behind existing
interfaces, workers/Redis, and real adapters.

**Prisma unblock sequence (do first, in this exact order, the moment
network to `binaries.prisma.sh` works or an engine binary is supplied):**

1. `pnpm --filter @advance-ecommerce/db db:generate` — generate the client.
2. `prisma validate` on `packages/db/prisma/schema.prisma` — first-ever
   validation of the merged **85-model** schema; fix any errors it
   surfaces before proceeding.
3. `prisma migrate dev` against local Postgres (docker-compose defaults).
4. `pnpm db:seed` — permissions/roles/19 flags/settings + sample catalog/geo.
5. Create the first Owner: `packages/db/scripts/create-first-owner.ts`
   (credentials from local env only).
6. Re-run `pnpm --filter web typecheck` — expect **0 errors**; then
   `next build` for the first production build pass.

**Then, in order:**

7. Verify staff login + TOTP end-to-end at `/admin/login` against the
   seeded DB (first runtime proof of Step 4).
8. Swap order/cart/customer persistence from in-memory stores to Prisma
   at the marked points (`NOT_WIRED` routes in §2); delete the
   `db: "NOT_WIRED"` / `persisted: false` markers as each lands.
9. Wire the real coupon service into public order create (coupons stop
   applying as 0) and real fraud scoring into checkout (replaces
   `riskScore: 0`; enforce OTP ≥ 70, block ≥ 90 / blacklist).
10. Swap catalog repository + product writes + initial-stock ledger
    entries to Prisma; public catalog reads stop serving TEMPORARY MOCK.
11. Swap payment/courier/shipment/manual-TrxID/webhook-log persistence
    to Prisma (DB unique constraints as the idempotency backstop).
12. Swap the remaining demo stores to Prisma module by module:
    inventory, coupons, campaigns, reports, CMS, automation/fraud, BD
    (payment links, cash closings, SMS ingestion, courier invoices),
    loyalty points/referrals/affiliates, resellers/call-center/inbox,
    POS, riders, vendors, B2B, ERP journal, staff/audit/feature-flags,
    setup, contact.
13. Replace the demo flag stores with one DB-backed `feature_flags`
    reader behind the existing interfaces so the (now existing) flags
    API and toggles actually gate modules; remove the stale
    `module.loyalty` seed-gap comments noted in §1.
14. Add the 4 POS operations to the OpenAPI registry (§5) — one small
    edit, do any time.
15. TOTP-secret encryption on enrolment + decryption on verify; sign/
    encrypt the pending-2FA cookie (TODO #1).
16. Replace the in-memory rate limiter, settings cache, and tracking
    dedup store with Redis (same key shapes/contracts).
17. Install `bullmq` + `ioredis` and run the worker daemon from
    `src/jobs/workers.ts` (SMS, email, courier booking/sync, webhook
    delivery, abandoned-cart, automation runs, real push sending behind
    the `PushSender` interface); add Redis pub/sub so the admin order
    SSE feed delivers live events.
18. Load the full verified BD geo dataset into
    `packages/db/prisma/data/bd-geo.json` (TODO #3) and re-seed; delete
    sample geo only then.
19. Run the Playwright suite (`pnpm add -Dw @playwright/test`, install
    chromium, seeded DB + dev server, env-gated credentials) —
    checkout, order, payment-sandbox, courier-sandbox specs.
20. Local QA sign-off pass against `docs/QA-CHECKLIST.md` (Step 38):
    order end-to-end, sandbox payment/courier, report reconciliation
    against raw DB rows, mobile admin, Bangla UX.
21. Real (non-sandbox) provider adapters behind the existing
    interfaces: payments, couriers (incl. Paperfly/eCourier +
    area-zone lookups), SMS/email sending, Meilisearch live indexing,
    real CAPI sender, real AI provider, F-commerce channel APIs —
    credentials only via encrypted Admin Settings.
22. Leftovers with no code yet, if wanted before handover:
    backup/restore (Step 35), landing-page builder (Step 27 remainder),
    queue monitor/board, self-hosted fonts, performance/SEO/a11y
    measurement pass (Step 33, needs a build).
23. **Only on Nazmul's separate instructions:** GitHub push (OAuth
    flow, never the exposed chat token), then live deployment
    Steps 39–42.

---

## Appendix — commands actually run

```bash
# Counts (run repeatedly; headline = final stable snapshot 09:20 UTC,
# confirmed by 3 consecutive 30s snapshots + post-typecheck recount)
find apps packages -type f \( -name "*.ts" -o -name "*.tsx" \) -not -path "*/node_modules/*" | wc -l
find apps packages -type f -name "*.ts"  -not -path "*/node_modules/*" | wc -l   # 344
find apps packages -type f -name "*.tsx" -not -path "*/node_modules/*" | wc -l   # 123
find apps packages -name "page.tsx" -not -path "*/node_modules/*" | wc -l        # 60
find apps/web/app/admin -name "page.tsx" | wc -l                                 # 40
find apps/web/app/api -name "route.ts" | wc -l                                   # 93
find apps/web/app/api/v1/admin  -name "route.ts" | wc -l                         # 80
find apps/web/app/api/v1/public -name "route.ts" | wc -l                         # 12 (+ openapi.json = 93)
grep -c "^model " packages/db/prisma/schema.prisma                               # 85
grep -c "^enum "  packages/db/prisma/schema.prisma                               # 20
grep "^model " packages/db/prisma/schema.prisma | awk '{print $2}' | sort        # full list in §1 working

# Feature flags (block-scoped count in seed.ts)
sed -n '122,145p' packages/db/prisma/seed.ts | grep -c 'key: "module\.'          # 19
grep -rhoE 'module\.[a-z0-9_]+' apps/web/src apps/web/app | sort -u              # code-side flags
diff code_flags.txt seed_flags.txt   # identical except literal "module.action" doc string

# Permissions compare (digit-aware — a [a-z_]+ pattern silently drops b2b.*)
grep -oE '"[a-z0-9_]+\.[a-z0-9_]+"' apps/web/src/lib/rbac.ts | sort -u            # 57
sed -n '34,93p' packages/db/prisma/seed.ts | grep -oE 'key: "[^"]+"' | sed 's/key: //' | sort -u   # 57
diff rbac.txt seed.txt   # clean — sets identical

# Admin nav
grep -c 'path: "/admin' apps/web/src/admin-nav/config.ts                         # 36

# Markers (per marker, then union on the v1 Appendix set)
grep -rl "<MARKER>" apps/web/src apps/web/app packages --include="*.ts" --include="*.tsx"
grep -rlE "TEMPORARY_MOCK|TEMPORARY_DEMO|in-memory-demo|NOT_WIRED|persisted: ?false|TEMPORARY DEMO|TEMPORARY MOCK|DB_NOT_READY" … | wc -l   # 140 (66 under app/api)

# TODO/FIXME/HACK
grep -rn "TODO\|FIXME\|HACK" apps/web/src apps/web/app packages --include="*.ts" --include="*.tsx" | grep -v node_modules   # 4 TODO, 0/0

# Route coverage
find apps/web/app/admin -name "page.tsx"
find apps/web/app/api -name "route.ts" | sort

# OpenAPI registry vs filesystem (python, derivation per src/platform/openapi.ts)
#  - registry: regex [rx]\("(GET|POST|PATCH|PUT|DELETE)", "<path>"\) over openapi.ts  -> 131
#  - filesystem: exported methods per route.ts                                          -> 139 ops / 93 files
#  - diff: registry-not-in-FS = none; FS-not-in-registry = 4x 405 GET stubs + 4 POS ops

# Agent 14 verification
find apps/web/src/reseller apps/web/src/callcenter apps/web/src/inbox apps/web/src/pos -type f   # 21
ls apps/web/app/admin/{resellers,call-center,inbox,pos}
find apps/web/app/api -path "*reseller*" -o -path "*call-center*" -o -path "*inbox*" -o -path "*pos*"

# Known-gap spot checks
grep -n "riskScore\|couponDiscountPoisha" apps/web/app/api/v1/public/orders/route.ts
grep -n "live" apps/web/app/api/v1/admin/orders/feed/route.ts
grep -rln "backup" apps/web/src apps/web/app   # nothing — docs only

# Typecheck (twice; identical 2-error output)
cd apps/web && npx tsc --noEmit -p tsconfig.json
```
