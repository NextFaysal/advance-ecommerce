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

### One-time unblock (do these by hand — nothing installs itself)

```bash
# 1. Install the two packages (only missing piece of the daemon):
cd apps/web && pnpm add bullmq ioredis

# 2. Add this script to apps/web/package.json "scripts":
#      "worker": "tsx scripts/worker.ts"

# 3. Make sure REDIS_URL is in the server env (apps/web/.env.local
#    locally — never commit it). Shape: redis://<host>:6379
#    (docker-compose in §2 provides Redis on port 6379.)

# 4. Generate the Prisma client (§4a) — the web app needs it anyway;
#    the worker itself starts without it (the settings service is
#    lazy-loaded and degrades to env/default provider names), but
#    DB-backed stores below need it.
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
| Webhook fanout | Omitted → `skipped` | `src/extensibility/webhooks.ts` has signing + delivery classification only; nothing performs outbound delivery yet. |
| Report runner | Omitted → `skipped` | `src/reports/service.ts` aggregates rows it is handed; no job-shaped runner loads data or writes a report file. |
| Automation runner | Omitted → `skipped` | `src/automation/engine.ts` evaluates rules and describes effects but deliberately applies nothing; no dispatch executes a queued automation job yet. |
| Import/export runner | Omitted → `skipped` | Catalog CSV import is synchronous route logic; no fileRef-based job executor exists. |
| Notification retry runner | Omitted → `skipped` | No notification-log store / retry executor exists yet. |

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

> **Honest status (2026-10-24):** the scripts exist and their
> dry-run / refusal / guard paths are smoke-tested, but **no real
> backup and no restore drill has been performed yet** — there is no
> live database (Prisma blocker, §8) and `pg_dump` / `pg_restore` are
> not installed on this machine. Do not claim a backup exists until a
> real run below has produced a `.dump` file and its checksum has been
> verified.

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

**Drill status: NOT yet performed** (blocked on §8 like everything
DB-backed). First real backup + first drill are checklist items in
`docs/QA-CHECKLIST.md`.

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
