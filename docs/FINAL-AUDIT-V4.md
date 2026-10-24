# Final Audit v4 — advance-ecommerce (local build)

**Auditor:** Agent 69, 2026-10-24 (~16:0x +06), read-only survey.
**Supersedes:** `docs/FINAL-AUDIT-V3.md` (Agent 61) as the current snapshot.
**Snapshot discipline:** every count below was taken at least twice; the
stable set is reported. The tree was settled throughout this audit —
both count passes returned identical numbers.

**Headline:** since v3, Agents 62–68 landed the flag-migration part 2,
the bulk-actions job pipeline, the SSE in-process live order feed,
self-hosted fonts, the worker entrypoint, backup/restore ops scripts,
and the full validated BD geo dataset. **Every post-v3 claim was
verified in code or on disk (§5), the TODO count is now 0, and the
OpenAPI registry is still exact both ways.** The Prisma
engine-download blocker is unchanged — re-tried live during this
audit, same TLS abort — so DB runtime, migration, seed execution, and
production build remain blocked, and **no GitHub push or live
deployment has been done** (the workspace is not even a git
repository; both remain deferred per Nazmul's instructions).

---

## 1. Fresh counts (v3 → v4)

| Metric | v3 | v4 | Source |
|---|---|---|---|
| TS/TSX files (`apps` + `packages`, excl. `node_modules`) | 488 | **496** (366 `.ts`, 130 `.tsx`) | `find … -name "*.ts" / "*.tsx"`, ×2 |
| `page.tsx` files | 63 | **63** (42 admin + 21 storefront/public) | `find apps/web/app -name "page.tsx"`, ×2 |
| API `route.ts` files | 98 | **99** (86 admin + 12 public + 1 `openapi.json`) | `find apps/web/app/api -name "route.ts"`, ×2 |
| Prisma models | 94 | **94** | `grep -c "^model " schema.prisma` |
| Prisma enums | 20 | **20** | `grep -c "^enum " schema.prisma` |
| Schema size | 1,550 lines / 44,285 bytes | **1,550 lines / 44,285 bytes** (unchanged) | `wc -lc schema.prisma` |
| Feature flags in seed `FEATURE_FLAGS` | 19, all OFF | **19, all OFF** | §1.1 |
| Permissions — RBAC catalogue | 61 | **61** | `PERMISSIONS`, `src/lib/rbac.ts` |
| Permissions — seed catalogue | 61 | **61** | `PERMISSIONS` block, `seed.ts` |
| Permissions RBAC vs seed | identical | **identical** (diff clean both ways, digit-aware) | Appendix |
| Admin nav items | 38 | **38** | item objects in `src/admin-nav/config.ts` |
| Queues in `QUEUE_NAMES` | 10 | **11** (incl. `bulk-actions`) | `src/jobs/queues.ts` |
| Demo-marker files (v1 Appendix union set) | 151 (70 under `app/api`) | **152** (71 under `app/api`) | Appendix grep — density 31%, stable |
| TODO / FIXME / HACK | 3 / 0 / 0 | **0 / 0 / 0** | §3 |

New files since v3 (+8 TS/TSX, +1 route, reconciles exactly):
`src/jobs/bulk-actions.ts`, `src/jobs/worker-deps.ts`,
`src/orders/event-bus.ts`, `src/bd/geo-dictionary.ts`,
`scripts/worker.ts`, `scripts/backup-db.ts`, `scripts/restore-db.ts`,
and the one new route `app/api/v1/admin/jobs/[id]/route.ts`
(bulk-job status). No new pages, no schema change.

### 1.1 Flags: three-way diff-identical, still all OFF

Seed `FEATURE_FLAGS` (19 keys, lines 130–148 of `seed.ts`; the seed
upsert creates every flag with `enabled: false`) =
`FEATURE_FLAG_DEFINITIONS` in `src/lib/feature-flags.ts` (19) — diff
clean. All 19 remain OFF by default.

---

## 2. Typecheck + the Prisma blocker

`npx tsc --noEmit` in `apps/web`: **exactly the 2 known errors**, both
downstream of the ungenerated Prisma client —

```
src/lib/auth.ts(134,56): error TS7006: Parameter 'rp' implicitly has an 'any' type.
../../packages/db/src/index.ts(1,10): error TS2305: Module '"@prisma/client"' has no exported member 'PrismaClient'.
```

Zero errors in application code, including every file that landed
since v3. The merged schema has still **not** passed
`prisma validate`, and no production build has been run.

**Blocker re-tried live during this audit** (2026-10-24):
`prisma generate` in `packages/db` exits 1 with the same failure as
every attempt since 2026-10-24 — `Error: aborted at
TLSSocket.socketCloseListener` while downloading the engine binary
from `binaries.prisma.sh`. Unblock sequence in §7.3.

---

## 3. TODO / FIXME / HACK inventory — zero

`grep -rn "TODO|FIXME|HACK"` over `apps/web/src`, `apps/web/app`,
`packages/db/prisma`, `packages/validators/src`, `tests`:
**0 TODO, 0 FIXME, 0 HACK.**

The last 3 TODOs (all BD geo, in `seed.ts`) are **gone**: Agent 68
replaced the sample geo with the validated full dataset (§5.6) and
`seed.ts` now loads it via `loadGeoData()` with a fallback comment
that no longer carries a TODO. The codebase is, for the first time,
completely TODO-free — every known deferral now lives in
`docs/BACKLOG.md` / audit documents instead of code comments.

---

## 4. Page ↔ API coverage + OpenAPI registry

### Page ↔ API

Coverage remains **complete**, as in v2/v3: no admin page lacks an
API group and no admin API group lacks a page, name differences only
(`fraud` ↔ `fraud-rules`, `content` ↔ `pages`, `audit` ↔ `audit-log`,
`bd-tools` ↔ `bd`, `ai-assist` ↔ `ai`, `erp` ↔ `modules/erp-journal`,
`marketing` ↔ `coupons` + `campaigns`, `login` ↔ `auth`). The
`tracking` API pairs with `/admin/settings/tracking`; the new `jobs`
API group is the bulk-job status endpoint consumed by the orders
surface (no page of its own, by design — it is a sub-surface of
Orders, like `system/health`). By-design API-only surfaces unchanged:
`system/health`, the two signature-verified webhooks, `track-events`,
`openapi.json`. The `design-system` page is a showcase with no API,
by design.

### OpenAPI registry vs filesystem — exact, both ways

- Filesystem operations (exported handlers across 99 route files):
  **142**.
- Registry operations in `src/platform/openapi.ts`: **139**.
- Difference = exactly the **3 intentional exclusions** already
  recorded in the registry: `GET /api/v1/admin/system/health`,
  `POST /api/v1/public/payments/webhook`,
  `POST /api/v1/public/couriers/webhook`. Registry-only set is empty;
  after normalising `[id]` ↔ `{id}` path-parameter syntax the diff is
  empty in both directions.
- Registry grew 138 → 139 (+1: the bulk-job status route), filesystem
  141 → 142 (+1: same route). **Zero drift.**

---

## 5. Post-v3 claims — verified in code / on disk

### 5.1 Flag migration part 2 (Agent 62) — unified reader is the ONLY flag state

`src/lib/feature-flags.ts` holds the single enabled-state (its
in-memory demo source, all OFF, DB swap point documented in its
header). Every former module store now exists only as a **stateless
adapter** delegating to it — verified file by file:
`src/automation/flags.ts`, `src/pos/flags.ts`,
`src/reseller/flags.ts`, `src/callcenter/flags.ts`,
`src/inbox/flags.ts`, `src/b2b/flags.ts`, `src/vendors/flags.ts`,
`src/riders/flags.ts`, `src/business-modules/types.ts`
(`InMemoryPackFlagStore`), `src/ai/feature-flag.ts`,
`app/admin/ai-assist/demo-flag.ts`,
`app/admin/advanced-orders/flags.ts`, and the feature-flags API store
(`app/api/v1/admin/feature-flags/store.ts`). Each imports
`lib/feature-flags` (2–4 references); **none** contains its own
`new Map` / `new Set` / enabled-state field (grep-verified).
`src/loyalty/store.ts`'s `demoLoyaltyFlag` live-reads the unified
store via `isFeatureEnabled`. A flip in the feature-flags API is now
visible to every module in the same process. The v3 caveat ("not yet
migrated module stores — drift risk reduced, not eliminated") is
**closed**.

### 5.2 Bulk-actions job pipeline (Agent 63) — the 202 stub now has a processor

- `src/jobs/bulk-actions.ts`: typed job model + in-memory registry
  (labelled demo) + `processBulkJob()` executor (state-machine
  transitions per order, per-order failure reporting, sandbox courier
  booking, print = payload ref only).
- The bulk branch of `POST /api/v1/admin/orders`
  (`app/api/v1/admin/orders/route.ts`) imports `enqueueBulkJob` +
  `processBulkJob`, enqueues, triggers processing, and still returns
  **202** with the job id — BulkActionBar-compatible.
- Status route exists: `GET /api/v1/admin/jobs/[id]`
  (`orders.view` guard), and it is the +1 in the OpenAPI registry
  (§4).
- `bulk-actions` is registered as the **11th queue** in
  `src/jobs/queues.ts` (`QUEUE_NAMES.bulkActions`), with references
  in `src/jobs/workers.ts` (retry/concurrency maps), a handler in
  `src/jobs/handlers.ts`, and an entry in the queue-monitor catalogue
  (`app/api/v1/admin/queues/catalogue.ts`) — so `/admin/queues` now
  lists 11 queues. The in-process processor is the exact function the
  future BullMQ handler will call; only the trigger changes.
- Honest limit (unchanged): no BullMQ daemon runs — processing is
  in-process within the web server, and persistence is the demo order
  store.

### 5.3 SSE live order feed (Agent 64) — live, single-node, labelled

- `src/orders/event-bus.ts` exists: typed `DomainEvent` union,
  `publishOrderCreated` / `publishOrderStatusChanged` helpers,
  listener-drop safety, payload safety (ids/amounts/district/status
  only — no phone/name/address line), Redis swap documented in the
  header (only this module changes transport).
- Publish points are real funnels, verified: the public create route
  calls `publishOrderCreated(order)` after the order is stored
  (replay and `FRAUD_BLOCKED` return earlier — no publish), and
  `transitionOrder()` in `src/orders/state-machine.ts` calls
  `publishOrderStatusChanged(...)` on its success branch only.
- The feed route (`app/api/v1/admin/orders/feed/route.ts`) subscribes
  to the bus and its `feed.connected` payload reports
  `live: true, transport: "in-process", scope: "single-node"` with an
  explanatory note — replacing v3's `live: false`. **Accurate:**
  events cross neither processes nor machines until Redis pub/sub
  replaces the transport after DB wiring.
- `payment.succeeded` remains **deliberately not wired** (documented
  in the bus header): no server mutation marks an *order* paid today,
  so there is no honest single publish funnel until the DB lands.
  Not a fake — a recorded deferral.

### 5.4 Self-hosted fonts (Agent 65) — real files, wired

11 `.woff2` files on disk under `apps/web/public/fonts/`, **every one
verified to start with the `wOF2` magic bytes** in this audit:
Plus Jakarta Sans variable latin (27,348 B), Hind Siliguri
400/500/600/700 × (bengali + latin) (14,472–74,784 B), Noto Sans
Bengali variable bengali (107,720 B), JetBrains Mono variable latin
(31,432 B) — plus a real `OFL.txt` (SIL Open Font License 1.1) in
each family folder. `src/styles/fonts.css` declares the faces
(variable families declared once with weight ranges — the identical
per-weight bytes were not duplicated) and is imported as line 1 of
`app/globals.css`; the root layout preloads the two critical faces.
The v2/v3 "still absent" item is **closed**. Not browser-verified
(no dev server run — Prisma blocker), but files, CSS, and wiring are
verified on disk.

### 5.5 Worker entrypoint + backup/restore scripts (Agents 66–67)

- `apps/web/scripts/worker.ts` + `src/jobs/worker-deps.ts` exist.
  The entrypoint dynamically loads `bullmq`/`ioredis` and — verified
  by reading it — exits with a friendly bn/en message naming the
  missing package and the install command when they are absent (the
  agent additionally verified this by actually running it). Deps
  wiring: sandbox SMS/email resolvers (honest — no real adapter
  exists yet), sandbox courier factory, and the **real**
  `bulkActionsRunner` (`getBulkJob` → `processBulkJob`). Five runners
  are **deliberately omitted** in `worker-deps.ts` with per-dep
  reasons in its header (`webhookFanout`, `reportRunner`,
  `automationRunner`, `importExportRunner`,
  `notificationRetryRunner`) — the corresponding handlers honestly
  report `skipped — not configured` rather than faking execution.
- `apps/web/scripts/backup-db.ts` (12,327 B) + `restore-db.ts`
  (9,124 B) exist: pg_dump custom-format with checksum sidecar +
  retention pruning; restore requires an explicit file + `--confirm`,
  checksum verification, and refuses a production-looking database
  name without `--allow-production`; the DB password reaches pg tools
  via `PGPASSWORD`, never the command line, and dry-run output is
  redacted. Guard/refusal paths were smoke-run by Agent 67. **No
  real backup or restore drill has been performed** — this VM has no
  `pg_dump` on PATH and no live DB; `docs/RUNBOOK-LOCAL.md` §11 and
  `docs/QA-CHECKLIST.md` state this honestly (drill items unchecked).
- `apps/web/package.json` carries all three scripts, verified:
  `"worker": "tsx scripts/worker.ts"`,
  `"db:backup": "tsx scripts/backup-db.ts"`,
  `"db:restore": "tsx scripts/restore-db.ts"`.

### 5.6 Full BD geo dataset (Agent 68) — validated, wired, TODOs closed

- `packages/db/prisma/data/bd-geo.json` counted **from the nested
  data itself** in this audit (not from its header):
  **8 divisions / 64 districts / 504 upazilas / 4,964 unions** —
  matching the header's `_counts` exactly.
- Header metadata present and substantive: `_source`
  (`bd-divisions-to-unions@1.0.4`, npm, fetched via jsDelivr,
  upstream GitHub repo named), `_license` (**ISC**, full text in
  `data/README.md`), `_normalizations`, `_knownIssues` (documented,
  not hidden: Bhuapur Municipality appears twice upstream;
  Shayestaganj has 0 unions upstream). Validation report lives in
  `packages/db/prisma/data/README.md`: counts, referential integrity
  (0 problems), bn/en completeness, spot-checks, and the DRAFT
  cross-check (the old DRAFT file is kept, marked superseded).
  Bangla names are Unicode-NFC normalized; bn/en rows were merged
  strictly by BBS code, never by index.
- `seed.ts` loads the dataset via `loadGeoData()`
  (`packages/db/prisma/seed.ts:230`), keeping a minimal GEO_SAMPLE
  fallback only for a missing file; the 3 geo TODOs are removed (§3).
- Parser: `src/bd/geo-dictionary.ts` builds `FULL_GEO_DICTIONARY`
  from the same file (curated dictionary remains the fallback;
  the bd-tools panel opts into FULL). Seed *execution* still awaits
  Prisma (§2) — the dataset is data-complete and code-wired, not yet
  loaded into any database.

---

## 6. Fake-success sweep (post-v3 slices)

Grep over the post-v3 slices (`src/jobs`, `src/orders/event-bus.ts`,
`apps/web/scripts`, `src/lib/feature-flags.ts`,
`app/api/v1/admin/jobs`, `app/api/v1/admin/orders`,
`src/bd/geo-dictionary.ts`) for unlabelled fake-success claims
(`sent: true`, `delivered: true`, `paid: true`, "successfully sent",
"has been sent", "sent successfully", "delivered successfully"):
**zero hits**. The same slices instead carry the honesty labels —
`delivered: false` (push sandbox), `status: "skipped"` (unconfigured
worker runners), `in-process-demo` (bulk processor),
`single-node` (SSE), `SANDBOX` (courier in bulk jobs).

Honesty-marker density is stable: **152 of 496 files (31%)** carry a
v1-set demo/in-memory marker (v3: 151 of 488, 31%); 71 of 99 API
route files carry one (v3: 70 of 98).

---

## 7. COMPLETION ASSESSMENT

Scope reference: `~/workspace/ecommerce-platform/10-step-by-step-execution-plan.md`
(Steps 0–50) + the Master Prompt. Conservative rule unchanged:
demo/in-memory persistence = PARTIAL, never DONE.

### 7.1 Step roll-up (refreshed)

**No step changes category since v3** — all post-v3 work is
code-layer over demo persistence, or ops scripts not yet run against
a database. Substantive sub-step movement inside PARTIAL steps:

- **Step 3 (DB schema + BD geo seed): still BLOCKED (runtime)** —
  but its geo half is now *complete as data*: the full validated
  dataset is in place and seed-wired (§5.6); only generate/migrate/
  seed execution is blocked.
- **Step 7 (settings + flags): PARTIAL** — the unified flag reader
  is now the *only* flag state in the codebase (§5.1); a DB
  `FeatureFlagSource` behind it is the remaining swap.
- **Step 18 (CRM + realtime feed): PARTIAL** — the feed is live
  in-process single-node (§5.3); Redis transport + `paymen
t.succeeded` publishing await DB persistence.
- **Step 30 (PWA + push): PARTIAL** — self-hosted fonts landed
  (§5.4); real push sending still absent (§7.2).
- **Step 35 (backup, health, queue monitor): PARTIAL** — backup/
  restore **code now exists** (§5.5, superseding v3's "no code")
  and the queue monitor lists 11 queues; the step stays PARTIAL
  because no real backup or restore drill has run (no pg_dump on
  this VM, no DB).
- **Steps 43–49 (v2 advanced): PARTIAL** — flag unification
  complete (§5.1); persistence and channel adapters unchanged.
- All other verdicts unchanged from v3: Steps 0, 1, 2, 5, 6
  **DONE**; Steps 4, 8–17, 19–29, 31–34, 36, 37, 43–49
  **PARTIAL**; Steps 39–42, 50 **DEFERRED**.

**Roll-up (unchanged arithmetic, re-verified):** of Steps 0–50
(51 steps): **DONE 5 · PARTIAL 39 · BLOCKED 2 · DEFERRED 5** —
plus **GitHub push DEFERRED** as a separate non-step line.
5 + 39 + 2 + 5 = 51. ✓

### 7.2 What remains UNBUILT, by blocker class

**PRISMA-NETWORK** — gated on the `binaries.prisma.sh` download
(§2); nothing here can be built or verified until it recovers:

1. The unblock sequence itself (§7.3): generate → validate →
   migrate → seed → first Owner → staff login + TOTP verification
   → typecheck to 0 → **production build**.
2. **DB persistence swaps** at every marked swap point (152 files
   carry demo markers): orders/cart/customers (incl. reconciling
   the POS TS↔schema drift documented by the Agent 52 review);
   catalog + product writes + initial-stock ledger; payments/
   couriers/shipments/manual-TrxID/webhook logs; inventory/
   coupons/campaigns/reports/CMS; the BD stores (payment links by
   hash, cash closings, a DB `TrxRegistry`, reconciliation runs,
   `sms_ingestions`, courier invoice runs/disputes/adjustments);
   automation/fraud stores; **one DB `FeatureFlagSource`** behind
   `src/lib/feature-flags.ts`; riders/vendors + commission lines
   from delivered orders; B2B/advanced-order remaining tables
   (split-shipment lines, StockBatch, SerialUnit,
   WholesalePriceTier, quotation lines, credit ledger); ERP
   tables; extensibility tables; attribution persistence;
   back-in-stock signups; tracking dedup store; landing-pages
   table; contact submissions; staff/audit/flags demo stores →
   real User/Role + audit tables. Remove `NOT_WIRED` /
   `persisted: false` / `TEMPORARY_DEMO` markers only as each real
   query lands.
3. Legacy plaintext-TOTP backfill script (operates on DB rows —
   writable in principle, but unrunnable and unverifiable until
   the DB exists).
4. SSE `payment.succeeded` wiring (needs the single DB order-paid
   funnel first — §5.3).
5. Meilisearch live indexing from real product data (indexer is
   env-guarded today; there is no DB product data to index).
6. First real backup + restore drill (scripts exist, §5.5; also
   needs pg_dump/pg_restore installed on the machine).
7. Playwright E2E execution against a seeded DB (also
   PACKAGE-INSTALL, below).

**PACKAGE-INSTALL** — code is written; packages were never
installed (pipeline rule), so nothing here runs yet:

8. **BullMQ daemon**: `pnpm add bullmq ioredis` + Redis up
   (docker-compose defines it) turns the existing entrypoint (§5.5)
   into a running daemon. Riding with it: the Redis swap for the
   in-memory rate limiters and the settings cache, and Redis
   pub/sub transport for the SSE feed.
9. **Real Web Push sending**: install `web-push`, generate VAPID
   keys into encrypted Admin Settings, persist
   `PushSubscriptionRecord`s (also PRISMA-NETWORK), and swap the
   sandbox sender (`src/platform/push.ts`, `delivered: false`)
   behind the existing `PushSender` interface.
10. **Playwright**: install `@playwright/test` + browser binaries
    so the 5 existing specs in `tests/e2e/` can run (also
    PRISMA-NETWORK for the seeded DB they run against).

**PROVIDER-ACCOUNT** — needs merchant/provider accounts and
credentials (Secure Vault / server env only, never chat):

11. Real payment adapters behind the existing interfaces:
    bKash/Nagad tokenized checkout, SSLCommerz, AamarPay,
    ShurjoPay (live auth + signature schemes; sandbox versions
    exist and are verified).
12. Real courier adapters: Pathao/RedX area-zone lookups + label
    fetch, Steadfast/Paperfly/eCourier live APIs (sandbox versions
    exist); courier invoice **API pull** (CSV is the only intake
    today) and dispute evidence-file upload (an `evidenceRef`
    label is stored today).
13. Real SMS providers (BulkSMSBD, SSL Wireless, Greenweb) and
    email (Resend API / SMTP credentials) behind the existing
    provider interfaces.
14. Real AI provider behind the `AiProvider` seam (today:
    template fallback only).
15. F-commerce channel adapters: Messenger/WhatsApp/Instagram
    webhook ingestion + outbound sending (Meta app + page tokens;
    tokens only in encrypted Admin Settings).
16. Production R2 bucket + CDN for media/storage.

**NAZMUL-INSTRUCTION** — deferred by his explicit instruction,
not by any technical blocker:

17. **GitHub push** to `NextFaysal/advance-ecommerce` — his
    instruction was "push later", after the local build; to be
    done via the OAuth connector flow, never the exposed chat
    token. Nothing has been pushed (the workspace is not a git
    repository — §8).
18. **Live deployment**, Steps 39–42 (+ Step 50) — only on his
    explicit "live koro".
19. **Owner review of the DRAFT legal content**
    (`src/legal/content.ts` — template, not legal advice) and
    replacement of every placeholder before live.
20. The Android SMS-forwarder app + its own endpoint auth — a
    separate deliverable outside this codebase, awaiting his
    go-ahead (the ingestion route exists behind the admin guard).

**NONE — buildable right now (flagged loudly):**

21. ⚠️ **OpenAPI drift check as a saved script.** The registry ↔
    filesystem check in §4 exists only as an auditor's ad-hoc
    command (run by hand in v2, v3, and this audit — exact every
    time). Saving it as `scripts/check-openapi.ts` + a
    `package.json` script (and later a CI step) is pure tooling:
    no Prisma, no packages, no accounts, no instruction needed.
    It is the **only** remaining item in the local code layer
    with no blocker at all — small, but it is the difference
    between "the registry cannot drift" being a promise and
    being a check.
22. ⚠️ *(Secondary, deliberately deferred by earlier agents —
    listed for completeness.)* Executor bodies for the five
    omitted worker runners in `worker-deps.ts` (§5.5) could be
    written against today's demo stores, but they become
    meaningful only with the daemon (PACKAGE-INSTALL) and DB
    persistence (PRISMA-NETWORK); the handlers' honest `skipped`
    reporting is the correct state until then. Not counted as
    remaining *buildable product work* — recorded so the
    omission is a decision on file, not an oversight.

**Verdict:** the local **code layer is complete** except item 21
(a tooling nicety) — every other remaining item is blocked by
exactly one of: the Prisma network failure, a package install, a
provider account, or Nazmul's explicit deferral. No unbuilt
feature work is hiding behind the Prisma blocker: the blocker
gates *running and persisting*, not *writing*, and the writing —
including fonts, geo data, backup scripts, the worker entrypoint,
and the bulk/SSE pipelines — is done and verified.

### 7.3 Exact unblock sequence (when the Prisma network recovers)

```
cd packages/db && npx prisma generate     # engine binary downloads
npx prisma validate                        # merged schema, first pass
npx prisma migrate dev                     # creates the database schema
pnpm db:seed                               # roles/permissions/flags/geo (full dataset)
pnpm --filter db exec tsx scripts/create-first-owner.ts   # env-only credentials
# verify: staff login + TOTP at /admin/login
pnpm --filter web typecheck                # expect 0 errors (the 2 Prisma errors clear)
pnpm --filter web build                    # first production build
```

Then, in order: DB persistence swaps (§7.2 item 2, module by
module, markers removed as each lands) → `pnpm add bullmq
ioredis` + worker daemon + Redis swaps (item 8) → backup run +
restore drill (item 6) → Playwright E2E (item 10) → local QA
sign-off (Step 38). GitHub push and live steps stay deferred
until Nazmul instructs them (§8).

---

## 8. Deferred work + secrets sweep

**GitHub push — DEFERRED, confirmed not done.** The workspace
`~/workspace/advance-ecommerce` is **not a git repository** (`git
status` → "not a git repository", no remotes, no history): no push
can have occurred from this tree. Per Nazmul's instruction the push
happens after the local build, via the GitHub OAuth connector flow
to `NextFaysal/advance-ecommerce` — never the token once exposed in
chat. **Live deployment (Steps 39–42, 50) — DEFERRED**, only on
Nazmul's explicit "live koro"; nothing has been deployed.

**Secrets sweep — clean.** Method: (1) pattern grep over the whole
tree (excluding `node_modules`) for known credential shapes —
`sk_live`/`sk_test`/`pk_live`, AWS `AKIA…` access keys, `ghp_…` /
`github_pat_…` GitHub tokens, Slack `xox[baprs]-…` tokens,
`-----BEGIN … PRIVATE KEY-----` blocks, Google `AIza…` API keys:
**zero hits**. (2) grep for literal credential assignments
(`password|passwd|secret|api_key|access_token = "…"`, 8+ chars)
across `apps`/`packages` TS/TSX, with placeholder/schema/label
lines filtered: **zero hits**. (3) env files: the only env file in
the tree is `apps/web/.env.example`, containing placeholders only
(`DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE…`,
`REDIS_URL=redis://localhost:6379`, empty key fields) — no
`.env.local` or any real credential value exists in the workspace.
No VAPID keys exist anywhere (§5, `src/platform/push.ts` is
deliberately keyless).

---

## 9. Stale docs — precise list

v3's §10 list was **fixed by the main agent after v3** (README +
ARCHITECTURE now carry the v3 figures and reference
`FINAL-AUDIT-V3.md`; the PWA-icon claim was corrected) — verified
in this audit. What is stale *now* is only the one-audit lag those
fixes introduced:

- `README.md` "Project status (verified 2026-10-24, Final Audit
  v3)": **98 API routes, 488 TS/TSX files**. Actual (v4): **99
  routes, 496 files**. (Models 94, pages 63, flags 19, permissions
  61 in that block are still exact.)
- `docs/ARCHITECTURE.md:34`: "**488** TS/TSX files". Actual:
  **496**. `:100` "94 models, 20 enums" still exact; `:229` "**151
  files** carry demo markers". Actual: **152**.
- Neither document references `FINAL-AUDIT-V4.md` (this file) yet.

---

## Appendix — commands actually run

```bash
find apps packages \( -name "*.ts" -o -name "*.tsx" \) -not -path "*/node_modules/*" | wc -l   # 496 → 496 (stable; 366 .ts + 130 .tsx)
find apps/web/app -name "page.tsx" | wc -l                                                     # 63 (42 admin + 21 public), ×2
find apps/web/app/api -name "route.ts" | wc -l                                                 # 99 (86 admin + 12 public + 1 openapi.json), ×2
grep -c "^model " packages/db/prisma/schema.prisma                                             # 94
grep -c "^enum "  packages/db/prisma/schema.prisma                                             # 20
# permissions, digit-aware, both ways:
grep -oE '"[a-z0-9_]+\.[a-z0-9_]+"' apps/web/src/lib/rbac.ts | sort -u                         # 61
sed -n '/const PERMISSIONS/,/^];/p' packages/db/prisma/seed.ts | grep -oE 'key: "…"'           # 61; diff empty both ways
# flags: seed FEATURE_FLAGS block (19 keys, upsert enabled:false) vs lib reader definitions      # 19 = 19, diff clean
grep -c 'id: "' apps/web/src/admin-nav/config.ts (item objects)                                # 38 nav items
sed -n '/QUEUE_NAMES = {/,/} as const/p' apps/web/src/jobs/queues.ts                           # 11 queues incl. bulk-actions
grep -rn "TODO|FIXME|HACK" apps/web/src apps/web/app packages/db/prisma packages/validators/src tests   # 0 / 0 / 0
npx tsc --noEmit (apps/web)                                                                    # exactly the 2 known Prisma errors
# OpenAPI: registry ops from src/platform/openapi.ts (139) vs exported handlers (142);
#   diff = the 3 documented exclusions only, both ways (node script)
grep -rlE "TEMPORARY_MOCK|TEMPORARY_DEMO|in-memory-demo|NOT_WIRED|persisted: ?false|TEMPORARY DEMO|TEMPORARY MOCK|DB_NOT_READY" apps/web/{src,app}   # 152 (71 under app/api)
head -c4 public/fonts/**/*.woff2                                                               # "wOF2" × 11 files
node -e '…count nested bd-geo.json…'                                                          # 8 / 64 / 504 / 4964 (data, not header)
timeout 60 npx prisma generate (packages/db)                                                   # exit 1: Error: aborted at TLSSocket.socketCloseListener
git status (workspace root)                                                                    # not a git repository — no push possible
# secrets: credential-shape grep (tree, excl. node_modules) + literal-assignment grep            # 0 hits; only .env.example, placeholders
```
