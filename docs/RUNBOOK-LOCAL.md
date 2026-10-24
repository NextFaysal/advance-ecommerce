# RUNBOOK-LOCAL.md — advance-ecommerce local runbook

Agent 22 · 2026-10-24 · Local only. **No real credentials in this
file — placeholders only.** Real values live only in your local
`.env.local` (gitignored) or a server env / Secure Vault — never in
git, never in chat.

---

## 0. Prerequisites

- Node 20+ (this machine: Node v24.22.1, npm 10.9.4 verified)
- pnpm 10 (`packageManager: pnpm@10.0.0` in the root `package.json`;
  if missing: `npm install -g pnpm`)
- Docker + Docker Compose (for local Postgres / Redis / Meilisearch)

## 1. Install dependencies

```bash
cd ~/workspace/advance-ecommerce
pnpm install
```

Already done once on this machine (116 packages). Re-run after any
dependency change.

## 2. Local infrastructure (Docker)

```bash
docker compose up -d
docker compose ps
```

`docker-compose.yml` starts, with **local defaults only** (values are
in that file; they are for local Docker only, not production):

| Service | Image | Local port |
|---|---|---|
| Postgres 16 | `postgres:16` | 5432 |
| Redis 7 | `redis:7` | 6379 |
| Meilisearch | `getmeili/meilisearch:latest` | 7700 |

## 3. Environment file

```bash
cp apps/web/.env.example apps/web/.env.local
```

Fill in `.env.local` **on your own machine only**. Keys (from
`apps/web/.env.example`): `DATABASE_URL`, `REDIS_URL`,
`NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `NEXT_PUBLIC_APP_URL`,
`NEXT_PUBLIC_APP_NAME`, `ADMIN_PATH`, `TZ`, `DEFAULT_LOCALE`,
`DEFAULT_CURRENCY`, `OTP_EXPIRY_MINUTES`, `OTP_MAX_ATTEMPTS`,
`MEILISEARCH_HOST`, `MEILISEARCH_API_KEY`, storage (`S3_*`-style keys
in the example file), `NEXT_PUBLIC_CDN_URL`, `EMAIL_PROVIDER`,
`EMAIL_FROM`, `SMS_PROVIDER` — plus `SETTINGS_ENCRYPTION_KEY`
(64 hex chars = 32 bytes; required before any admin Settings secret
can be stored — without it the settings layer refuses to store
secrets rather than saving them in plaintext).

Placeholder shape (not real values):

```bash
DATABASE_URL="postgresql://<user>:<password>@localhost:5432/<db>?schema=public"
REDIS_URL="redis://localhost:6379"
SETTINGS_ENCRYPTION_KEY="<64 hex chars, generated locally>"
```

Generate a local encryption key (never share the output):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 4. Database: generate → migrate → seed → first Owner

> ⚠️ **Currently blocked on this machine** — step 4a fails because
> the Prisma engine binary cannot be downloaded (network reset to
> `binaries.prisma.sh`). See §8 before fighting it.

```bash
# 4a. Generate the Prisma client
pnpm db:generate            # = pnpm --filter @advance-ecommerce/db db:generate

# 4b. Create/apply migrations
pnpm db:migrate             # prisma migrate dev
# (quick local alternative without migration history: pnpm db:push)

# 4c. Seed — idempotent; permissions, roles, flags (all OFF),
#     default settings, SAMPLE catalog/geo data. No staff user.
pnpm db:seed                # tsx packages/db/prisma/seed.ts

# 4d. Create the first Owner (run once; refuses if an Owner exists)
#     Credentials come from local env only; the password is never
#     printed or logged. Set these in your shell, not in a file you commit:
FIRST_OWNER_EMAIL="<owner email>" \
FIRST_OWNER_PHONE="<01XXXXXXXXX>" \
FIRST_OWNER_NAME="<name>" \
FIRST_OWNER_PASSWORD="<12+ chars, local only>" \
pnpm --filter @advance-ecommerce/db exec tsx scripts/create-first-owner.ts
```

Then sign in at `/admin/login` with that Owner and enrol TOTP 2FA.

> Seed data honesty: the catalog seed is 1 DRAFT "SAMPLE ONLY"
> product (stock 0), 1 warehouse, 2 shipping zones, 1 sample coupon
> (`WELCOME10`). The geo seed loads
> `packages/db/prisma/data/bd-geo.json`, which is **sample-only**
> (2 divisions). A full draft dataset sits beside it as
> `bd-geo-full-DRAFT.json` — do not rename it into place until it has
> been reviewed (see its header note: duplicate-name union groups
> and one upazila with 0 unions need handling, and the seed matches
> by `nameEn`).

## 5. Run the dev server

```bash
pnpm dev                    # turbo dev → apps/web on Next dev
# or just the web app:
pnpm --filter web dev
```

- Storefront: http://localhost:3000
- Admin: http://localhost:3000/admin (login: `/admin/login`;
  `/dashboard` redirects to `/admin`)
- Design system showcase: http://localhost:3000/admin/design-system
- Health (cookie required): `GET /api/v1/admin/system/health` —
  returns booleans + a status word only, never URLs/keys.

Until step 4 completes, pages render but DB-backed flows return
honest markers: admin APIs answer 503 `DB_NOT_READY` /
`PRISMA_PENDING` where session validation needs Prisma, and demo
routes label their data `TEMPORARY_MOCK` / `in-memory-demo`.

## 6. Enable a feature flag

All 17 `module.*` flags are seeded **OFF** (paid add-ons are unlocked
per client, never globally).

- **With DB (after step 4):** Admin > Settings / feature-flag
  management (`feature_flags.manage` permission) — set the flag row
  (`module.automation`, `module.fraud_scoring`, `module.reseller`,
  `module.call_center`, `module.pos`, `module.multi_vendor`,
  `module.rider`, `module.f_commerce`, `module.ai_assist`,
  `module.advanced_analytics`, `module.b2b`, `module.fashion`,
  `module.electronics`, `module.grocery`, `module.pharmacy`,
  `module.digital_goods`, `module.erp_lite`) to enabled.
- **Without DB (current state):** module routes read in-memory demo
  flag stores with the same OFF defaults and the same interface —
  a locked module returns 403 `FEATURE_LOCKED`. Demo stores are for
  local UI work only; they reset on restart and are not a substitute
  for the DB flags.

## 7. Sandbox mode (payments & couriers)

- Sandbox adapters live in `apps/web/src/integrations/sandbox/`.
  Simulated ids are prefixed `SBX-` (e.g. `SBX-BKASH-…`) so a
  simulated payment/shipment can never be confused with a real one.
- Sandbox payment gateways (bKash, Nagad, SSLCommerz) and couriers
  (Steadfast, Pathao, RedX) run deterministic simulations: zone
  charges in poisha (inside Dhaka 6000, outside Dhaka 12000,
  district 10000, +2000 per extra 500 g over 1 kg), idempotent
  initiation, HMAC-SHA256 webhook verification.
- Test a provider from Admin > Settings: `POST
  /api/v1/admin/settings/test` (permission `settings.integrations`).
  Sandbox → simulated pass, clearly messaged as simulated. Live with
  no credential → 422. Live with a credential → 503 (live test not
  implemented yet). A pass is never faked.
- Webhooks (`/api/v1/public/payments/webhook`,
  `/api/v1/public/couriers/webhook`) need a configured secret
  (encrypted admin Settings, or a sandbox-only local env test
  secret). With neither configured they are **rejected by design** —
  there is no hardcoded test secret.
- Going live later = add the real adapter behind the existing
  interface + store the credential encrypted in Admin > Settings +
  pass a real test connection. The live-guard refuses to run live
  without that.

## 8. Known blocker — Prisma engine download

`pnpm db:generate` currently fails on this machine with
`ECONNRESET` while downloading the query-engine binary from
`binaries.prisma.sh`. Full evidence and attempts are in
**`packages/db/PRISMA-BLOCKER.md`**. Summary:

- Cache dir for the engine commit exists but is empty; no
  `node_modules/.prisma`; pnpm ignores the Prisma packages' build
  scripts, so `pnpm rebuild` produces no binary.
- Unblocks when: the network reaches `binaries.prisma.sh`, OR a
  cached engine for that commit/target is supplied, OR Prisma build
  scripts are allow-listed in pnpm + reinstall on a working network.
- Until then: `prisma validate`, migrate, seed, DB runtime tests,
  and a fully green typecheck are all blocked. Current typecheck
  state: exactly **2 errors**, both from the ungenerated client
  (`packages/db/src/index.ts`, `src/lib/auth.ts`).
- Do **not** hand-write a fake `@prisma/client` stub to "fix" this.

**The moment it unblocks, run in order:** §4a → §4b → §4c → §4d →
`pnpm --filter web typecheck` (expect 0 errors) → `pnpm --filter web
build` → then start the DB persistence swaps listed in
`docs/BACKLOG.md`.

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `prisma generate` → `ECONNRESET` / "Error: aborted" | Engine binary download blocked (network) | §8 — not a code problem; do not retry in a loop, do not fake a client |
| Typecheck shows exactly 2 errors (`PrismaClient` export, `auth.ts` `rp` implicit any) | Prisma client not generated | Same root cause as above; both disappear after a successful generate |
| Admin API returns 503 `DB_NOT_READY` / `PRISMA_PENDING` | Session validation needs Prisma; DB not wired yet | Expected until §4 completes; routes fail closed on purpose, they do not run unauthenticated |
| Module route returns 403 `FEATURE_LOCKED` | The module's `module.*` flag is OFF | Enable it per §6 |
| Settings save of a secret throws | `SETTINGS_ENCRYPTION_KEY` missing/invalid in `.env.local` | Set a 64-hex-char key per §3; the app refuses plaintext storage by design |
| Settings test: sandbox OK, live 422 / 503 | 422 = no credential configured; 503 = live test not implemented | Configure the credential in Admin > Settings; treat 503 as "not implemented", never as success |
| Webhook POST returns 401 | Signature check failed, or no webhook secret configured | Configure the secret (encrypted Settings / sandbox env); unverified webhooks are logged and never applied |
| Duplicate order/payment on retry | Should not happen — idempotency keys are unique in the schema | Check the client sent the same idempotency key; a duplicate key returns the original record by design |
| Order SSE feed connects but no live events | Redis pub/sub not wired; feed sends connect event + heartbeats only (`live: false`) | Known gap — see `docs/BACKLOG.md` (workers/Redis) |
| PWA does not offer install | Icon PNGs (`/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`) don't exist yet | Add real PNGs at those paths (see BACKLOG) |
| Playwright specs fail/skip | `@playwright/test` not installed; no dev server + seeded DB | Expected for now: specs are env-gated scaffolding — install + seed + set `E2E_*` env vars first (see BACKLOG) |
| Seed geo looks tiny (2 divisions) | `bd-geo.json` is sample-only by design | Full dataset is the DRAFT file beside it; review before wiring (§4 note) |
| Login page works but login fails | No Owner exists / DB down | §4 must complete first; the seed deliberately creates no staff user |

## 10. Worker daemon (BullMQ)

The background-job daemon (SMS/email sends, courier booking + sync,
webhook delivery, reports, automation, bulk actions, …). The Next.js
server never runs these itself — the worker is a **separate process**
with its own entrypoint: `apps/web/scripts/worker.ts`. The wiring and
policies live in `apps/web/src/jobs/workers.ts` + `handlers.ts`; the
production handler dependencies are assembled in
`apps/web/src/jobs/worker-deps.ts`.

### One-time unblock — DONE (verified 2026-10-24)

```bash
# 1. Packages installed: bullmq 6.4.1 + ioredis 6.0.0 are
#    dependencies of apps/web (package.json + pnpm-lock.yaml).
#    The "worker" script ("tsx scripts/worker.ts") exists.
#    On THIS dev VM pnpm is not on PATH — the working invocation is:
#      npx --yes pnpm@10.0.0 <args>     (matches the repo's
#      "packageManager": "pnpm@10.0.0" pin)
#    VM quirk behind the install: the workspace overlay refuses
#    chown TO gid 65534 (nogroup), which pnpm's atomic lockfile
#    write performs to preserve file ownership. Workaround used:
#    chown root:root on pnpm-lock.yaml, the package.json files and
#    node_modules/.modules.yaml + node_modules/.pnpm/lock.yaml
#    (gid 65534 -> 0 makes pnpm's preserve-chown target gid 0,
#    which is permitted). Content was never touched.

# 2. Redis locally on this VM (no docker here):
sudo apt-get install -y redis-server        # 7.0.15, one-time
sudo redis-server /etc/redis/redis.conf --daemonize yes
redis-cli ping                              # -> PONG
#    Stop it again with:  redis-cli shutdown nosave
#    (Elsewhere, docker-compose in §2 provides Redis on port 6379.)

# 3. REDIS_URL must be in the server env (apps/web/.env.local
#    locally — never commit it). Shape: redis://<host>:6379

# 4. Prisma client is generated (§4a) — the web app needs it
#    anyway; the worker itself starts without it (the settings
#    service is lazy-loaded and degrades to env/default provider
#    names), but DB-backed stores below need it.

# Verified startup (2026-10-24, local Redis + local Postgres):
# the worker printed the Redis target, registered all 11 queues
# (sms-send, email-send, courier-booking, courier-status-sync,
# webhook-delivery, import-export, report-generation,
# notification-retry, abandoned-cart-followup, automation-run,
# bulk-actions), BullMQ created its bull:* keys in Redis, and a
# SIGTERM produced the graceful "Worker closed cleanly" exit 0.
```

### Run

```bash
pnpm --filter web worker
# Expected startup output: the Redis target as protocol//host:port
# only (credentials are never logged), then one line per queue with
# its attempts / backoff / concurrency, e.g. "sms-send (attempts 3,
# backoff 30s, concurrency 5)". Stop with Ctrl+C or SIGTERM — workers
# close gracefully.
```

If a package or `REDIS_URL` is missing, the entrypoint exits 1 with a
short bilingual (Bangla + English) explanation naming exactly what is
missing and the fix — no stack trace. That friendly exit is the
expected behaviour on an unprepared machine, not a bug.

### What is wired vs. honestly skipped

Handlers whose dep is not configured return `skipped` and name the
reason — that is the truth, not an error to hide:

| Queue dep | Status | Why |
|---|---|---|
| SMS / email provider resolvers | **Wired — sandbox adapters** | No real SMS/email adapter exists yet (interfaces only). The resolver reads the admin-configured provider name (`sms.provider` / `email.provider`, env fallback `SMS_PROVIDER` / `EMAIL_PROVIDER`) and returns the sandbox adapter carrying that name; sends are simulated `queued`. Real adapters slot into `worker-deps.ts` behind the same resolvers. |
| Courier provider | **Wired — sandbox factory** | Steadfast / Pathao / RedX via the sandbox factory. Paperfly / eCourier have no adapter at all and fail the job with `NO_ADAPTER:<name>` (retry + dead-letter, never a fake booking). |
| Bulk actions runner | **Wired — real** | `getBulkJob(id)` → `processBulkJob(job)` (`src/jobs/bulk-actions.ts`), the same executor the admin route triggers in-process. Note: the registry is in-process, so a bulk job id this worker process has never seen fails `BULK_JOB_NOT_FOUND` — bulk jobs move to a DB table with the Prisma wiring. |
| Webhook fanout | **Wired — real** | `src/jobs/runners.ts`: delivers to the DB-registered subscriptions (`webhookSubscriptionStore`), signing + classification from `src/extensibility/webhooks.ts`; retrying deliveries throw so BullMQ applies the queue backoff, exhausted deliveries are marked `dead`. Attempts live in an in-memory delivery-log store in runners.ts — there is still no WebhookDeliveryLog table (schema follow-up). Subscriptions with `hasSecret` sign with the Admin Settings secret `webhook.secret.<subscriptionId>`; when it cannot be resolved the delivery is failed `signing_secret_unavailable`, never sent unsigned. |
| Report runner | **Wired — real** | `src/jobs/runners.ts`: `fetchSalesRows` (DB) → `aggregateSales`; returns a computed-summary ref (type, Dhaka range, orders, poisha totals). The reports module has no result/file store, so no file is faked — the admin export route renders the CSV from the same bundle on demand. |
| Automation runner | **Wired — real** | `src/jobs/runners.ts`: `workflowId` = AutomationRule id (DB store), the event is built from the entity (order / variant / cart), the engine evaluates, and the run log persists through the store (masked phones). `dryRun: true` jobs are evaluated but never persisted. Effects stay described in the run log, as with the admin runs route. |
| Import/export runner | **Wired — real (products)** | `src/jobs/runners.ts`: catalog CSV via `src/catalog/import.ts` + the Prisma CatalogRepository. `fileRef` is a file name inside the local job-files dir (env `AE_JOB_FILES_DIR`, default `./job-files`); exports are written in import format so they round-trip. Imports are all-or-nothing: any invalid row → nothing created, error-report CSV written next to the source as `<fileRef>.errors.csv`. Orders/customers jobs fail `UNSUPPORTED_ENTITY` — no such service exists yet. |
| Notification retry runner | **Wired — real** | `src/jobs/runners.ts`: FAILED `NotificationLog` rows are re-driven through the configured (sandbox) SMS/email resolvers; success returns the row to `QUEUED` with the provider stamped — never `SENT`, because sandbox sends are simulated. Failed re-drives throw so the queue's DEFAULT_RETRY policy (3 attempts) applies, then dead-letter with the row still FAILED + `errorRef` stamped. |

### Production notes (before running more than one worker process)

- The idempotency store and dead-letter sink default to **in-memory**
  implementations (`workers.ts`). They cannot dedupe or audit across
  processes — replace them with a Redis SETNX store and a DB
  dead-letter table (the interfaces are `IdempotencyStore` /
  `DeadLetterSink` in `handlers.ts`) before scaling out.
- Failed jobs are never auto-removed (`removeOnFail: false`): the
  failed-job list plus the dead-letter entries are the audit trail.
  Inspect them from the admin queue monitor (`/admin/queues`).
- The worker logs ids, template keys, provider names and masked refs
  only — never phone numbers, emails, message bodies, or credentials.

## 11. Backup & restore (Postgres)

Scripts (Step 35): `apps/web/scripts/backup-db.ts` and
`apps/web/scripts/restore-db.ts`. These are the real mechanism —
there is deliberately **no backup button in the admin UI**, because a
button without this machinery behind it would be a fake feature.

> **Status (2026-10-24):** the scripts' dry-run / refusal / guard
> paths were smoke-tested first; the **first real backup and restore
> drill were performed on 2026-10-24** against the local scratch
> database. Backup `backup-20261024-193902.dump` (368,258 bytes,
> pg_dump custom format, SHA-256 sidecar verified) was restored via
> `restore-db.ts --confirm` into scratch DB
> `advance_ecommerce_drill`: all 95 tables restored and spot-checked
> row counts matched the source exactly (Division 8, District 64,
> Upazila 504, Union 4,963, Permission 61, Role 7, FeatureFlag 19,
> Order 16, Customer 15, Product 1); `prisma validate` passed against
> the restored DB. The drill DB was dropped afterwards; the backup
> file is kept in `backups/db/`.

### Prerequisites

- `postgresql-client` installed (`pg_dump` / `pg_restore` on PATH),
  or run the scripts inside the Docker `postgres:16` image from §2.
- `DATABASE_URL` in the environment (`.env.local` locally, server env
  in production — never committed, never pasted into chat). The
  scripts read it from env only, never print it (output shows only
  `postgresql://***@host:port/dbname`), and pass the password to the
  pg tools via `PGPASSWORD`, not the command line.
- A database that actually exists — locally that means §4 has
  completed (currently blocked, §8).

### Take a backup

```bash
# Preview first — prints the exact (redacted) command, creates nothing:
pnpm --filter web exec tsx scripts/backup-db.ts --dry-run

# Real backup:
pnpm --filter web exec tsx scripts/backup-db.ts
```

- Output lands in `backups/db/` at the repo root (override with the
  `BACKUP_DIR` env var) as `backup-<YYYYMMDD-HHmmss>.dump`
  (Asia/Dhaka time, pg_dump custom format, `--no-owner`), plus a
  matching `.sha256` sidecar in `sha256sum` format.
- On failure the partial file is deleted — a half-written dump is
  never left behind to be mistaken for a backup.
- **Retention:** after each successful backup, older files are pruned
  to the newest `BACKUP_RETENTION` (default **7**). Pruning only ever
  deletes files matching this script's own `backup-*.dump` pattern
  (and their sidecars) inside its own backup directory.

### Schedule (suggestion — not installed anywhere)

Daily at 03:30 Asia/Dhaka is a sane default for one shop; add the
cron entry on the server by hand when the install goes live, e.g.:

```cron
30 3 * * *  cd /path/to/advance-ecommerce/apps/web && DATABASE_URL=<server env> ./node_modules/.bin/tsx scripts/backup-db.ts >> /var/log/ecommerce-backup.log 2>&1
```

(In production prefer loading `DATABASE_URL` from the server's env
file inside a small wrapper rather than inlining it in the crontab.)

### Off-site copy (manual step — not automated)

Local backups protect against mistakes, not against losing the
machine. After a backup, copy the `.dump` **and** its `.sha256` to
the Cloudflare R2 bucket (Admin > Settings storage config) — this is
a **manual step today**; no script uploads automatically. Example
with any S3-compatible CLI, credentials from server env / Secure
Vault only:

```bash
aws s3 cp backups/db/backup-<timestamp>.dump s3://<bucket>/db-backups/ --endpoint-url <R2 endpoint>
aws s3 cp backups/db/backup-<timestamp>.dump.sha256 s3://<bucket>/db-backups/ --endpoint-url <R2 endpoint>
```

Verify the copy by downloading it back once and running
`sha256sum -c` against the sidecar.

### Restore

⚠️ **Restore is destructive**: it runs `pg_restore --clean
--if-exists`, which drops existing objects in the target database
first. The script enforces this discipline:

1. **Preview** (validates the file, its checksum sidecar, and the
   target; changes nothing):

   ```bash
   pnpm --filter web exec tsx scripts/restore-db.ts backups/db/backup-<timestamp>.dump --dry-run
   ```

2. **Real restore** — requires the explicit flag; without it the
   script prints what it would run and exits 1:

   ```bash
   pnpm --filter web exec tsx scripts/restore-db.ts backups/db/backup-<timestamp>.dump --confirm
   ```

3. **Production guard:** if the target database name contains
   `prod`, every mode (including `--dry-run`) refuses unless
   `--allow-production` is also passed. Treat that flag as a
   last-resort, typed-on-purpose override: restoring over production
   erases current data. Prefer restoring into a scratch database
   first (below) whenever there is any doubt.
4. If the dump's `.sha256` sidecar is present, the checksum is
   verified before anything runs; a mismatch refuses the restore. A
   missing sidecar warns loudly but does not block.

Note: the dump path is resolved relative to the process cwd, and
`pnpm --filter web exec` runs from `apps/web` — pass an absolute
path (or one relative to `apps/web`), not a repo-root-relative one.

### Restore drill (do this before you ever need it)

A backup that has never been restored is a hope, not a backup.
Drill, once the local DB exists and then monthly in production:

1. Create a scratch database (e.g. `advance_restore_drill`) and point
   `DATABASE_URL` at **it** — never at production.
2. Run the restore preview (`--dry-run`), then the real restore
   (`--confirm`) against the scratch database.
3. Verify: row counts on a few core tables (users, products, orders)
   look sane, the app boots against the scratch DB, and
   `GET /api/v1/admin/system/health` answers.
4. Drop the scratch database and record the date + result in
   `docs/QA-CHECKLIST.md` (Backup / restore section).

**Drill status: performed 2026-10-24** against the local scratch DB
(see the status note at the top of this section) — restored into a
scratch database, row counts matched the source, scratch DB dropped.
Repeat monthly in production.

## 12. OpenAPI drift check

The published OpenAPI document (`GET /api/openapi.json`) is built from
`API_ROUTE_REGISTRY` in `apps/web/src/platform/openapi.ts`. A saved
check keeps that registry honest against the real route files:

```bash
pnpm --filter web check:openapi
# = ./node_modules/.bin/tsx scripts/check-openapi.ts   (from apps/web)
```

It walks every `app/api/**/route.ts`, extracts the exported method
handlers (the inverse of the registry's `routeFileForPath` mapping),
and diffs the operation set against the registry **both ways**. Exit 0
means they agree exactly; exit 1 prints each drifted operation
(on disk but not in the registry, or in the registry but not on disk).

Run it after adding, removing, or renaming any API route — and update
the registry in the same change when it fails.

Counting rules the check applies, so its numbers are not a surprise:

- Registry entries marked `includeInSpec: false` (today: the two
  signature-verified webhooks + the internal health probe) are
  **exclusions from the published spec only** — they still count in the
  registry ↔ filesystem comparison and must exist on disk.
- A handler whose whole body returns `405 METHOD_NOT_ALLOWED` is a
  method guard on a POST-only endpoint (4 today: GET on admin login,
  public contact, public orders, public track-events), not an
  operation. The check lists them separately as method stubs.

Current verified state (2026-10-24): 99 route files, 142 operations on
disk = 142 registry entries (139 published + 3 documented exclusions),
zero drift. Fixture self-test: set `CHECK_OPENAPI_API_ROOT` to a copied
api tree to watch the check fail (exit 1) without touching the real
routes.

## 13. Vercel + Neon deployment

Prepared 2026-10-24. **Nothing is deployed yet** — no Vercel or Neon
account exists for this project today. Every account step below is the
owner's; everything repo-side is already in place.

### Shape of the deployment

- **Vercel** runs only the Next.js app (storefront + admin + API).
- **Neon** is the production Postgres.
- **Redis** in production: Upstash (serverless, BullMQ-compatible) or
  a Redis on the worker host; `REDIS_URL` points there.
- **The BullMQ worker cannot run on Vercel.** It is a long-running
  daemon (§10) and Vercel functions are serverless. It needs its own
  always-on host (a small VPS, Fly.io, Render, Railway — anywhere
  `pnpm --filter web worker` can stay running) with the same
  `DATABASE_URL` + `REDIS_URL`. Until it runs somewhere, queued jobs
  (SMS/email sends, courier booking, bulk actions) do not process;
  the web app itself works.

### vercel.json — what it does, and the rootDirectory truth

`rootDirectory` **cannot** be set in `vercel.json` — it is not part
of Vercel's config schema; it is a per-project dashboard setting.
The committed `vercel.json` (repo root) therefore assumes the project
Root Directory stays at the **repository root** (the import default):
its `installCommand` is `pnpm install --frozen-lockfile`, its
`buildCommand` is
`pnpm --filter @advance-ecommerce/db db:generate && pnpm --filter web build`,
and it sets `outputDirectory: apps/web/.next`, `framework: nextjs`,
and `regions: ["sin1"]` (Singapore — the closest Vercel region to
Bangladesh users; change it in the file if ever needed).

If the owner instead prefers Root Directory = `apps/web`: Project →
Settings → General → **Root Directory** → set `apps/web`, then MOVE
`vercel.json` into `apps/web`, change its `buildCommand` to
`pnpm --filter @advance-ecommerce/db db:generate && pnpm build`, and
remove `outputDirectory`. Pick ONE layout — the repo ships the
repo-root layout; do not mix the two.

Build notes:

- `prisma generate` runs on Vercel's builders, whose network reaches
  `binaries.prisma.sh` normally. Do **NOT** set
  `PRISMA_ENGINES_MIRROR` in production — that mirror is only a
  workaround for this dev VM's blocked route to the Prisma CDN.
- `prisma migrate deploy` is deliberately **NOT** in the build
  command yet. The DB persistence swaps are still landing module by
  module; auto-migrating on every deploy right now would apply
  schema ahead of the code that uses it. Run migrations manually
  (Step 4) until the swaps are complete, then revisit.

### Step 1 — Fresh Neon project (owner)

Create a **new** Neon project and database. The database credentials
that were pasted into chat earlier in this project are compromised:
never use them anywhere, for anything; if that old project is still
around, delete it or rotate its password. No credential value is
recorded in this repo, by design.

In the Neon dashboard, take BOTH connection strings of the new
database: the **pooled** one (host contains `-pooler`) for the app's
runtime `DATABASE_URL`, and the **direct** one (no `-pooler`) for
migrations and the seed. The Prisma schema declares a single
`url = env("DATABASE_URL")` (there is no `directUrl`), so migrations
are run with the direct string substituted just for that command.

### Step 2 — Import the repo into Vercel (owner)

1. vercel.com → sign in → **Add New → Project** → import
   **NextFaysal/advance-ecommerce** (grant the GitHub App access to
   the repo during import if prompted).
2. Leave **Root Directory** at the repository root (see above).
3. Framework preset Next.js; install/build commands come from the
   committed `vercel.json` — don't override them in the dashboard
   unless the file is updated in the same change.
4. Add every env var from Step 3 **before** the first deploy, then
   Deploy.

### Step 3 — Production env checklist (owner, Vercel dashboard)

**Golden rule: production values are typed into the Vercel
dashboard (Project → Settings → Environment Variables → Production)
by the owner — never pasted into chat, never committed to the repo,
never written into `vercel.json`.** If a value is ever exposed,
rotate it at the provider first, then update Vercel.

| Variable | Required | Value comes from | Notes |
|---|---|---|---|
| `DATABASE_URL` | Yes | Neon dashboard — **pooled** string | Runtime database connection. |
| `REDIS_URL` | Yes (queues/worker) | Upstash console (`rediss://` TLS URL) | Same value on Vercel and on the worker host. |
| `NEXTAUTH_SECRET` | Yes | Owner generates: `openssl rand -base64 32` | Keep only in Vercel + owner's password manager. |
| `NEXTAUTH_URL` | Yes | The production URL | `https://<domain>` — must match the final domain exactly. |
| `NEXT_PUBLIC_APP_URL` | Yes | Same production URL | Public value. |
| `NEXT_PUBLIC_APP_NAME` | Recommended | Owner's store name | Public value. |
| `AUTH_ENCRYPTION_KEY` | Yes | Owner generates: `openssl rand -hex 32` (64 hex chars) | Encrypts TOTP secrets, signs the pending-2FA cookie. Rotating it forces every staff member to re-enrol 2FA — plan rotations. |
| `SETTINGS_ENCRYPTION_KEY` | Yes | Owner generates: `openssl rand -hex 32` — a **different** value from `AUTH_ENCRYPTION_KEY` | Encrypts Admin > Settings secrets at rest. |
| `ADMIN_PATH` | Optional | Default `/admin` | Only change together with the admin docs. |
| `TZ` / `DEFAULT_LOCALE` / `DEFAULT_CURRENCY` | Fixed | `Asia/Dhaka` / `bn` / `BDT` | Set explicitly so a platform default can never drift them. |
| `OTP_EXPIRY_MINUTES` / `OTP_MAX_ATTEMPTS` | Optional | Defaults `5` / `5` | |
| `MEILISEARCH_HOST` / `MEILISEARCH_API_KEY` | Optional at launch | Meilisearch Cloud or self-hosted | Without them, search uses the Postgres fallback. |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` / `NEXT_PUBLIC_CDN_URL` | When uploads go live | Cloudflare R2 dashboard (endpoint + bucket name); region `auto` | The R2 access keys themselves are provider credentials: they belong in **Admin > Settings** (encrypted in DB), not in env. |
| `EMAIL_PROVIDER` / `EMAIL_FROM` | At launch | `resend` + a verified sender address | The Resend API key goes in **Admin > Settings**, not env. |
| `SMS_PROVIDER` | At launch | Provider name, e.g. `bulksmsbd` | Its API credentials go in **Admin > Settings**, not env. |
| `NODE_ENV` | — | Set by Vercel automatically | Nothing to add. |

Not Vercel env: `BACKUP_DIR` / `BACKUP_RETENTION` belong to the
machine running the §11 backup scripts; `PRISMA_ENGINES_MIRROR`
must never be set in production (see above).

### Step 4 — Apply migrations to Neon (manual, per schema release)

From a trusted shell with the repo checked out, using the **direct**
Neon string (owner types it in their own shell; never saved into the
repo):

```bash
cd packages/db
DATABASE_URL="<direct Neon connection string>" npx prisma migrate deploy
```

Only after this succeeds should the app's pooled `DATABASE_URL`
matter — the tables must exist before the first login.

### Step 5 — Domain + SSL (owner)

Vercel project → **Settings → Domains** → add the store's domain →
set the DNS records Vercel displays at the registrar → SSL is issued
automatically (Let's Encrypt). Then set `NEXTAUTH_URL` and
`NEXT_PUBLIC_APP_URL` to the final `https://` domain and redeploy.

### Step 6 — Seed + first Owner on production

Once, against production, from the owner's shell with the direct
Neon string as `DATABASE_URL` (same pattern as Step 4):

```bash
pnpm db:seed   # roles, 61 permissions, 19 feature flags, BD geo — no staff user, by design
```

Then create the first Owner with
`packages/db/scripts/create-first-owner.ts`: it reads its
credentials from env in the owner's shell only, and refuses to run
if an Owner already exists. Staff accounts are created afterwards
from **Admin > Staff** — there is no public admin registration.

### Step 7 — Post-deploy smoke checklist

- [ ] `https://<domain>/` loads the storefront (Bangla UI, BDT prices).
- [ ] `/admin/login` loads; the first Owner logs in (password, then
      TOTP enrolment) and reaches the dashboard.
- [ ] After login, `GET /api/v1/admin/system/health` returns ok
      booleans (database reachable — values only, no internals).
- [ ] Place a test order on the storefront (COD checkout): it
      appears in **Admin > Orders**. (This needs the orders
      persistence swap deployed — if the order only exists as demo
      data, the swap is not in the deployed build yet; do not
      announce the launch.)
- [ ] On the worker host, `pnpm --filter web worker` starts and
      lists all 11 queues, and the test order's SMS/email jobs are
      consumed. Until real provider credentials are saved in
      Admin > Settings, sends are the sandbox adapters (simulated
      `queued`) — by design, not a fault.
- [ ] `/api/openapi.json` loads; `/track` and a landing page open.
- [ ] First production backup taken the same day (§11 scripts,
      direct Neon string).

### Not done by this section

No accounts exist yet, no deploy has run, and no production secret
exists anywhere in this repo. Real payment/courier/SMS adapters are
provider-account work: their credentials are entered in
Admin > Settings after launch, never in env or files.
