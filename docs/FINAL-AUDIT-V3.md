# Final Audit v3 — advance-ecommerce (local build)

**Auditor:** Agent 61, 2026-10-24 (~15:34 +06), read-only survey.
**Supersedes:** `docs/FINAL-AUDIT-V2.md` (Agent 48) as the current snapshot.
**Snapshot discipline:** every count below was taken at least twice; the
stable set is reported. One file count moved 487 → 488 between passes
while Agent 60 (POS permissions + unified flag reader) was landing its
last consumer migrations; a third pass confirmed 488 stable, and the
final typecheck was re-run after the tree settled.

**Headline:** since v2, Agents 49–60 landed SMS ingestion, the courier
invoice importer + dispute workflow, auto courier assignment, the
Agent 14 review fix pass (D1–D4 + G5), the landing-page builder, the
queue monitor, auth hardening, reseller hardening (G1/G2), call-center
hardening (G3), checkout wiring (real coupon + real fraud scoring in
order create), POS dedicated permissions, and the unified feature-flag
reader. **Both v2 "known in-code gaps" that were wiring defects —
coupon applied as 0 and `riskScore: 0` in order create — are FIXED and
verified by reading the route.** The only remaining in-code stubs are
the bulk-action 202 and the SSE `live: false`, both unchanged and both
honestly labelled. The Prisma engine-download blocker is unchanged —
re-tried live during this audit, same TLS abort — so DB runtime,
migration, seed execution, and production build remain blocked, and
**no GitHub push or live deployment has been done** (both deferred per
Nazmul's instructions).

---

## 1. Fresh counts (v2 → v3)

| Metric | v2 | v3 | Source |
|---|---|---|---|
| TS/TSX files (`apps` + `packages`, excl. `node_modules`) | 467 | **488** (358 `.ts`, 130 `.tsx`) | `find … -name "*.ts" / "*.tsx"` |
| `page.tsx` files | 60 | **63** (42 admin + 21 storefront/public) | `find apps/web/app -name "page.tsx"` |
| API `route.ts` files | 93 | **98** (85 admin + 12 public + 1 `openapi.json`) | `find apps/web/app/api -name "route.ts"` |
| Prisma models | 85 | **94** | `grep -c "^model " schema.prisma` |
| Prisma enums | 20 | **20** (unchanged) | `grep -c "^enum " schema.prisma` |
| Schema size | 1,438 lines / 40,975 bytes | **1,550 lines / 44,285 bytes** | `wc -lc schema.prisma` |
| Feature flags in seed `FEATURE_FLAGS` | 19 | **19**, all seeded OFF (`enabled: false`) | block count + upsert in `seed.ts` |
| Permissions — RBAC catalogue | 57 | **61** | `PERMISSIONS`, `src/lib/rbac.ts` |
| Permissions — seed catalogue | 57 | **61** | `PERMISSIONS` block, `seed.ts` |
| Permissions RBAC vs seed | identical | **identical** (`comm` clean both ways, digit-aware) | Appendix |
| Admin nav items | 36 | **38** | item objects in `src/admin-nav/config.ts` |
| Demo-marker files (v1 Appendix union set) | 140 (66 under `app/api`) | **151** (70 under `app/api`) | Appendix grep |
| TODO / FIXME / HACK | 4 / 0 / 0 | **3 / 0 / 0** | §3 |

New pages since v2 (+3): `/admin/landing`, `/admin/queues`,
`/lp/[slug]`. New API route files since the v2 snapshot (+5, by file
mtime vs the v2 document's write time): `admin/bd/courier-assignment`
(landed seconds after the v2 snapshot), `admin/landing` +
`admin/landing/[id]`, `admin/queues`, `admin/call-center/claim`. The
sms-ingest and courier-invoice route files predate the snapshot and
were inside v2's 93; POS route files also predate v2 on disk (v2
found them missing only from the OpenAPI registry — §4).

### Schema arithmetic, reconciled

94 = 85 (v2) + 9 net new models. The parent brief listed 13 appended
model names since v2, but 4 of them (`SmsIngestion`,
`CourierInvoiceRun`, `CourierDispute`, `DisputeAdjustment`) had
already landed *during* the v2 audit window and were inside v2's 85
(v2's own Step 44 note says so). The 9 genuinely post-v2 appends:
`Reseller`, `ResellerPriceEntry`, `ResellerWalletEntry`,
`ResellerWithdrawal`, `CallTask`, `CallLogEntry`,
`InboxConversation`, `InboxMessage`, `LandingPage` — all verified
present by name, as are `PosRegister` / `PosShift` / `PosSale`
(pre-v2). No discrepancy remains.

### Permissions +4, exactly as briefed

61 = 57 + `resellers.view`, `resellers.manage`, `pos.view`,
`pos.manage`. RBAC catalogue and seed catalogue are set-identical
(verified with digit-aware extraction — a naive `[a-z_]+` pattern
drops `b2b.*` and falsely reports 59).

### Flags: three-way diff-identical

Seed `FEATURE_FLAGS` (19) = `FEATURE_FLAG_DEFINITIONS` in the new
`src/lib/feature-flags.ts` (19) = all `module.*` keys referenced
anywhere in `apps/web/src` + `apps/web/app` (19). Diff clean in every
direction.

---

## 2. Agent 60 — landed, not in flight

At audit start, `src/lib/feature-flags.ts` did not yet exist; by the
second pass Agent 60 had finished. Verified on disk:

- `src/lib/feature-flags.ts` — unified reader
  (`createFeatureFlagReader(source)`; in-memory demo source, all OFF)
  with the DB swap point documented in its header. Migrated consumers:
  the feature-flags API store (PATCH writes go through the unified
  store), `app/admin/advanced-orders/flags.ts`,
  `app/admin/ai-assist/demo-flag.ts` (+ both pages). Not-yet-migrated
  module stores (automation, fraud, loyalty, POS, AI `requireFeature`)
  are listed in the header as next migrations — the drift risk is
  reduced, not yet eliminated.
- POS guards switched to the dedicated pair: reads (`pos` state,
  `pos/scan`) require `pos.view`; writes (`pos/shift`, `pos/sale`)
  require `pos.manage`; nav item permission is `pos.view`. POS no
  longer borrows `orders.*`.

---

## 3. TODO / FIXME / HACK inventory

Exactly **3 TODOs, 0 FIXME, 0 HACK** in `apps` + `packages`:

| # | Location | Context |
|---|---|---|
| 1 | `packages/db/prisma/seed.ts:18` | Pointer to the geo TODO below ("See loadGeoData() and the TODO below"). |
| 2 | `packages/db/prisma/seed.ts:184` | TODO (before production / Step 3 completion): replace/augment sample geo with the full verified Division > District > Upazila > Union dataset. |
| 3 | `packages/db/prisma/seed.ts:218` | Runtime warning in the same spirit: `bd-geo.json not found — seeding SAMPLE geo data only. TODO: import full verified dataset`. |

The v2 TODO #1 — sign/encrypt the `admin_pending_2fa` cookie at
`auth/login/route.ts:47` — is **gone** (Agent 56): the login route now
sets the cookie via `signPending2fa()` and verify-2fa trusts only
`verifyPending2fa()`; `src/lib/auth.ts` also gained
`encryptTotpSecret()` / envelope-aware verify (legacy plaintext
accepted until re-enrolment), and `src/lib/SECURITY-NOTES.md`
documents the scheme. Line numbers for the geo TODOs shifted
(180 → 184, 214 → 218) because of the seed permission additions.

---

## 4. Page ↔ API coverage + OpenAPI registry

### Page ↔ API

Coverage remains **complete**, as in v2: no admin page lacks an API
group and no admin API group lacks a page, name differences only
(`fraud` ↔ `fraud-rules`, `content` ↔ `pages`, `audit` ↔ `audit-log`,
`bd-tools` ↔ `bd`, `ai-assist` ↔ `ai`, `erp` ↔ `modules/erp-journal`,
`marketing` ↔ `coupons` + `campaigns`, `login` ↔ `auth`). Both new
surfaces are paired both ways: `/admin/landing` ↔ `admin/landing`
(+`[id]`), `/admin/queues` ↔ `admin/queues`. By-design API-only
surfaces unchanged: `system/health`, the two signature-verified
webhooks, `track-events`, `openapi.json`.

### OpenAPI registry vs filesystem — exact, both ways

- Filesystem operations (exported handlers across 98 route files):
  **141**.
- Registry operations in `src/platform/openapi.ts`: **138**.
- Difference = exactly the **3 intentional exclusions** already
  recorded in the registry: `GET /api/v1/admin/system/health`,
  `POST /api/v1/public/payments/webhook`,
  `POST /api/v1/public/couriers/webhook`. After normalising
  `[id]` ↔ `{id}` path-parameter syntax, the diff is empty in both
  directions.
- **The v2 drift is closed:** the 4 POS operations missing from the
  registry at v2 are present, and every route added since v2
  (`bd/sms-ingest`, `bd/courier-invoice` ×4 files,
  `bd/courier-assignment`, `landing` ×2, `queues`,
  `call-center/claim`, `pos` ×4) is registered. Registry grew
  118 → 138 operations with zero drift.

---

## 5. v2 "known in-code gaps" — status

| Gap (v2) | v3 status | Evidence |
|---|---|---|
| Coupon accepted but applied as 0 in order create | **FIXED** (Agent 59) | `app/api/v1/public/orders/route.ts` evaluates the real `applyCoupon()` via `src/checkout/order-enrichment.ts` and feeds the discount into the pricing pipeline at the coupon stage; ineligible codes create the order with `couponStatus: "rejected"` + bn/en reason; coupon use recorded only after a successful create. |
| `riskScore: 0` (unscored) in order create | **FIXED** (Agent 59) | The same route calls the real `scoreFraud()` and stores `riskScore: assessment.score`; `block` → 422 with a generic message (no signal details in the payload), `require_advance` → `advanceRequired` / `requiresOtp` flags. Remaining literal `riskScore: 0` occurrences are not this gap: `src/pos/register.ts:198` (a POS sale record — POS sales are not fraud-scored) and `app/admin/advanced-orders/sample-data.ts:48` (labelled sample data). |
| Bulk actions = validated + audited **202 stub** | **UNCHANGED** | `POST /api/v1/admin/orders` bulk branch still returns `202 QUEUED_FOR_BULK_JOB` and changes nothing; labelled as a stub in the route header, the orders page, and `BulkActionBar` (which displays the API's answer verbatim). Unblocks only with the BullMQ daemon. |
| Order SSE feed `live: false` | **UNCHANGED** | `app/api/v1/admin/orders/feed/route.ts` still sends one `feed.connected` event with `live: false` + heartbeats; header states plainly it is not a live stream. Unblocks only with Redis pub/sub. |

---

## 6. v2 "still absent" list — status

| Item (v2: absent) | v3 status |
|---|---|
| Backup/restore code | **Still absent** — `grep -ri backup apps/web/src apps/web/app` finds no code; remains an ops/runbook item in `docs/RUNBOOK-LOCAL.md`, deliberately not faked. |
| Real push sending | **Still absent** — `src/platform/push.ts` is still the sandbox/no-op sender; no VAPID keys anywhere in the tree (grep-verified). |
| Landing-page builder | **NOW EXISTS** (Agent 53) — `src/landing/` (types/validate/render/store/components), `/admin/landing` (page + builder), `app/lp/[slug]` public page resolving only published slugs, `LandingPage` schema model. |
| Queue monitor | **NOW EXISTS** (Agent 55) — `/admin/queues` + `app/api/v1/admin/queues` (catalogue + route), honestly reporting `liveCounts: null` / daemon not running; nav item present (38 items). |
| Self-hosted fonts | **Still absent** — no `.woff/.woff2/.ttf/.otf` files, no `@font-face` / `next/font/local` anywhere; storefront and admin still use the font fallback stack. Downloads presumably hit the same network failure as Prisma. |

---

## 7. Post-v2 hardening slices — verified in code

- **Agent 14 fix pass (Agent 54), D1–D4 + G5:** D1 — grep for
  `customerPhone` / `phoneRaw` across the inbox page + client returns
  nothing; the page passes masked views only and drafts are built via
  the server draft route. D2 — the inbox API gates `detectedPhone`
  on `customers.view_full_phone` (route line 39), mirroring
  call-center. D3 — `src/pos/register.ts` maps every
  `PosPaymentMethod` via `POS_PAYMENT_METHOD` and adds a discount line
  (`discountText`) when `discountPoisha > 0`. D4 —
  `CallTaskView.phoneMasked` is always masked; the full number
  travels only in the optional `phoneFull`, present solely with
  `customers.view_full_phone`. G5 — stale `src/pos/flags.ts` comment
  corrected.
- **Reseller hardening (Agent 57), G1/G2:** status guard in
  `src/reseller/wallet.ts` blocks SUSPENDED / PENDING_APPROVAL
  resellers from commission credit, withdrawal creation, and
  review-to-PAID, with status-specific reasons; routes guard on
  `resellers.view` (list) / `resellers.manage` (withdrawal create +
  review) instead of the borrowed `payments.view`.
- **Call-center hardening (Agent 58), G3:** the `?agentId=` preview
  is gone — the queue route derives `agentId` from the session and
  returns only own + unassigned tasks; outcomes on another agent's
  task return 403 `TASK_ASSIGNED_TO_OTHER`; the `staff.manage`
  supervisor override is recorded on the log entry
  (`supervisorOverride: true`); new `POST
  /api/v1/admin/call-center/claim` route exists and is registered in
  OpenAPI.
- **SMS ingestion (Agent 49), courier invoices + disputes
  (Agent 50), auto courier assignment (Agent 51):** all present as
  routes + `src/bd` modules + schema models; honesty properties from
  their briefs re-verified by grep (ingestion records carry
  `marksPaid: false`; disputed invoice rows keep original expected
  values; assignment panel/API label demo stats).

### Honesty-marker sweep

Marker density is stable: 151 of 488 files (31%) carry a v1-set
marker vs 140 of 467 (30%) at v2; 70 of 98 API route files carry one.
A grep sweep over the post-v2 slices (`src/landing`, `src/bd`,
queues/landing/call-center routes, `src/lib/auth.ts`,
`src/lib/feature-flags.ts`) for unlabelled fake-success claims
(`sent: true`, `delivered: true`, `paid: true`, "successfully sent",
"has been sent") returned **zero hits**. No new unlabelled
fake-success surface was found.

---

## 8. Typecheck + the Prisma blocker

`npx tsc --noEmit` in `apps/web`, run twice (plus once after the
final stable snapshot): **exactly the 2 known errors**, both
downstream of the ungenerated Prisma client —

```
src/lib/auth.ts(134,56): error TS7006: Parameter 'rp' implicitly has an 'any' type.
../../packages/db/src/index.ts(1,10): error TS2305: Module '"@prisma/client"' has no exported member 'PrismaClient'.
```

Zero errors in application code, including every file that landed
during this audit. The merged schema has still **not** passed
`prisma validate`, and no production build has been run.

**Blocker re-tried live during this audit** (2026-10-24 ~09:38 UTC):
`prisma generate` in `packages/db` fails the same way as every
attempt since 2026-10-24 13:5x +06 — `Error: aborted at
TLSSocket.socketCloseListener` while downloading the engine binary
from `binaries.prisma.sh`. Unblock sequence remains: generate →
validate → migrate → `pnpm db:seed` → create first Owner → verify
login + TOTP → typecheck (expect 0) → production build.

---

## 9. Execution-plan step mapping (Steps 0–50), refreshed

Verdict changes since v2 are substantive but **no step changes
category**: every post-v2 slice is code-layer work over demo/in-memory
persistence, and the conservative rule (demo persistence = PARTIAL)
is unchanged.

- **Step 6 (admin shell + navigation): DONE** — nav 36 → 38 items
  (landing, queues added); still config-driven.
- **Step 7 (settings + flags base): PARTIAL** — the unified flag
  reader (Agent 60) is now the single flag source for migrated
  consumers; DB override path still cannot run until Prisma does.
- **Step 12 (cart + checkout): PARTIAL** — order create now applies
  real coupons inside the pipeline and real fraud scoring with
  enforcement (Agent 59); persistence is still the in-memory store
  (`NOT_WIRED`).
- **Step 27 (affiliate/referral/loyalty/landing): PARTIAL** — the
  landing-page builder, v2's last missing piece of this step, now
  exists (§6); all persistence demo.
- **Step 30 (PWA + push): PARTIAL** — unchanged; real push sending
  still absent (§6).
- **Step 32 (API final + docs): PARTIAL** — the v2 OpenAPI drift
  (POS operations) is closed; registry is exact both ways (§4).
  Rate limiting still in-memory only.
- **Step 34 (security hardening): PARTIAL** — TOTP-secret encryption
  + signed pending-2FA cookie landed (Agent 56), closing the
  codebase's oldest TODO; remaining: Redis rate limiter, legacy
  TOTP backfill script.
- **Step 44 (BD differentiators): PARTIAL** — auto courier
  assignment (Agent 51) joins SMS ingestion and the courier invoice
  importer + disputes already counted at v2; all demo persistence,
  SMS ingestion not yet wired to DB orders.
- **Step 46 (reseller/call-center/F-commerce/POS): PARTIAL** — G1/G2
  reseller hardening, G3 call-center enforcement, and the dedicated
  `pos.*` permission pair landed; still no real channel APIs, POS
  persistence demo.
- All other verdicts unchanged from v2 (re-verified by counts and
  spot-checks, not re-audited line by line): Steps 0, 1, 2, 5
  **DONE**; Steps 4, 8–11, 13–26, 28, 29, 31, 33, 35–37, 43, 45,
  47–49 **PARTIAL** (Step 35's backup/restore still has **no code**;
  Step 36's Playwright specs still unrun); Steps 39–42 and 50
  **DEFERRED**.

**Roll-up (unchanged arithmetic, re-verified):** of Steps 0–50
(51 steps): **DONE 5** (0, 1, 2, 5, 6) · **PARTIAL 39** · **BLOCKED
2** (Step 3 runtime, Step 38 local QA) · **DEFERRED 5** (39, 40, 41,
42, 50) — plus **GitHub push DEFERRED** as a separate non-step line.
5 + 39 + 2 + 5 = 51. ✓

### What remains before "local build complete"

1. **Prisma unblock** (network to `binaries.prisma.sh`), then the
   §8 sequence. This single blocker gates everything below it.
2. **DB persistence swaps** at every marked swap point: orders/cart/
   customers, catalog, payments/couriers/shipments/manual-TrxID/
   webhooks, inventory/coupons/campaigns/reports/CMS, the BD stores
   (payment links, cash closings, TrxRegistry, reconciliation,
   `sms_ingestions`, invoice runs/disputes/adjustments), automation/
   fraud, riders/vendors, B2B/advanced orders, ERP, extensibility,
   attribution, back-in-stock, POS (reconciling the TS↔schema drift
   Agent 52 documented), reseller/call-center/inbox, landing pages,
   contact submissions, staff/audit/flags demo stores, and ONE
   DB-backed `FeatureFlagSource` behind `src/lib/feature-flags.ts`
   (plus migrating the not-yet-migrated module flag stores). Remove
   `NOT_WIRED` / `persisted: false` / `TEMPORARY_DEMO` markers only
   as each real query lands.
3. **Workers/queues:** install `bullmq`/`ioredis`, worker
   entrypoint, real handlers behind the existing contracts — this
   also unblocks the bulk-action stub and the live SSE feed (Redis
   pub/sub) — plus the Redis swap for the in-memory rate limiters
   and settings cache.
4. **Real provider adapters** behind the existing interfaces
   (payment, courier, SMS, email, Meilisearch live indexing, real AI
   provider, F-commerce channel webhooks), credentials only in
   encrypted Admin Settings.
5. **Full verified BD geo dataset** into
   `packages/db/prisma/data/bd-geo.json` (closes the last 3 TODOs).
6. **Self-hosted fonts; backup/restore implementation + drill;
   real push sending** (VAPID from encrypted Settings).
7. **QA (Steps 34–38):** Playwright E2E actually run against a
   seeded DB, load test, visual regression, local sign-off against
   `docs/QA-CHECKLIST.md`.
8. **Deferred, per Nazmul's instructions:** GitHub push (after the
   local build completes, via the OAuth connector flow — never the
   exposed chat token) and live deployment Steps 39–42 (only on his
   explicit "live koro").

---

## 10. Stale docs — precise list (unchanged from v2, still unfixed)

- `README.md:13` claims "74 Prisma models / 20 enums, 74 API routes
  (64 admin + 10 public), 34 pages, 17 feature flags". Actual: **94
  models / 20 enums, 98 API routes (85 admin + 12 public + 1
  openapi), 63 pages, 19 feature flags**.
- `docs/ARCHITECTURE.md:34` claims "331 TS/TSX files". Actual:
  **488**.
- `docs/ARCHITECTURE.md:99` claims "74 models, 20 enums". Actual:
  **94 / 20**.
- `docs/ARCHITECTURE.md:228` claims "86 files carry demo markers".
  Actual: **151** (v1 Appendix union set).
- `docs/ARCHITECTURE.md` (~line 246) claims "the icon PNGs they
  reference do not [exist]". **Stale since Agent 32:**
  `apps/web/public/icons/icon-192.png`, `icon-512.png`, and
  `icon-maskable-512.png` all exist on disk (verified in this
  audit).
- Neither `README.md` nor `docs/ARCHITECTURE.md` references
  `FINAL-AUDIT-V2.md` (or this v3); both still present the v1-era
  numbers above as current.

---

## Appendix — commands actually run

```bash
find apps packages \( -name "*.ts" -o -name "*.tsx" \) | grep -v node_modules | wc -l   # 487 → 488 → 488 (stable)
find apps/web/app -name "page.tsx" | wc -l                                             # 63 (42 admin)
find apps/web/app/api -name "route.ts" | wc -l                                         # 98 (85 admin + 12 public + 1)
grep -c "^model " packages/db/prisma/schema.prisma                                     # 94
grep -c "^enum "  packages/db/prisma/schema.prisma                                     # 20
# permissions, digit-aware, both ways:
grep -oE '"[a-z0-9_]+\.[a-z0-9_]+"' apps/web/src/lib/rbac.ts | sort -u                 # 61
sed -n '/const PERMISSIONS/,/^];/p' packages/db/prisma/seed.ts | grep -oE 'key: "…"'    # 61; comm diff empty both ways
# flags, three ways (seed / lib reader / code references): 19 = 19 = 19, diffs clean
grep -rn "TODO|FIXME|HACK" apps packages --include="*.ts" --include="*.tsx"             # 3 / 0 / 0
npx tsc --noEmit (apps/web)                                                            # exactly the 2 known Prisma errors, ×3 runs
# OpenAPI: registry ops extracted from src/platform/openapi.ts (138) vs exported
# handlers across route files (141); diff after [id]→{id} normalisation = the 3
# documented exclusions only
grep -rlE "TEMPORARY_MOCK|TEMPORARY_DEMO|in-memory-demo|NOT_WIRED|persisted: ?false|TEMPORARY DEMO|TEMPORARY MOCK|DB_NOT_READY" apps/web/{src,app}  # 151 (70 under app/api)
timeout 60 npx prisma generate (packages/db)                                           # fails: TLS abort (binaries.prisma.sh)
```
