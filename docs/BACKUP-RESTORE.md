# Production Backup & Restore — Advance Ecommerce

Status: **prepared runbook** (2026-10-25). Production database = Neon
(PostgreSQL), connected to Vercel as an integration. App credentials live
only in Vercel/server env — never in this repo, never in chat.

## Layer 1 — Neon built-in (always on, primary line)

- Neon keeps continuous WAL backups with point-in-time restore (PITR).
  The free/Hobby window is short (plan-dependent, currently ~24h–7d) —
  check the current window in the Neon console under the project's
  **History / Restore** tab; do not assume it.
- Branch-based restore: Neon restores by creating a **new branch** from a
  past timestamp. The app keeps working on the old branch until you point
  `DATABASE_URL` at the restored one (see "Restore" below).
- Neon does **not** protect against: deleting the whole Neon project,
  account compromise, or needing a copy outside Neon. That is what
  Layer 2 is for.

## Layer 2 — Scheduled logical dumps (off-Neon copy)

Script: `scripts/backup-prod.sh` (repo root). It reads `DATABASE_URL`
from the environment — whoever runs it must hold the production
credential (Vercel dashboard → project → Settings → Environment
Variables, or the Neon console's connection string). The script never
prints the URL.

```bash
DATABASE_URL='<production connection string>' ./scripts/backup-prod.sh
# -> backups/prod-YYYYMMDD-HHMMSS.dump  (pg_dump custom format)
# -> backups/prod-YYYYMMDD-HHMMSS.dump.sha256
```

Where it should run (pick one; **none is active yet** — all need the
credential holder or the future worker host):

1. **Worker host / VPS (recommended, once it exists):** a weekly cron
   running the script, with `backups/` synced to Cloudflare R2 or
   another off-site store, keeping the last 8 dumps.
2. **Owner's own machine:** run manually before any risky operation
   (big import, manual SQL, migration with data changes) and monthly.
3. **GitHub Actions with a repo secret:** possible, but it puts the
   production connection string into a third system — decide
   deliberately, not by default.

Retention: keep **8 weekly** dumps off-Neon + Neon's own PITR window.
A dump that has never been test-restored is a hope, not a backup —
see the drill below.

## Restore

### From a Neon point in time (preferred for recent accidents)

1. Neon console → project → **Branches → New branch** → "from point in
   time" → pick the timestamp just before the incident.
2. Copy the restored branch's connection string.
3. In Vercel, update `DATABASE_URL` (and `DATABASE_URL_UNPOOLED` to the
   same branch's direct string) → redeploy. The build runs
   `prisma migrate deploy`, which is a no-op on a same-schema restore.
4. Verify: homepage loads, `/api/v1/public/products` returns data, one
   admin page loads after login. Then decide whether to keep the old
   branch for forensics before deleting it.

### From a Layer-2 dump file

```bash
# Into a NEW empty database — never over the live one first.
pg_restore --clean --if-exists --no-owner \
  -d '<new database connection string>' \
  backups/prod-YYYYMMDD-HHMMSS.dump
```

Then follow steps 2–4 above pointing Vercel at the new database.
Locally, the same command against a scratch database
(`advance_ecommerce_restore_test`) is the drill target.

## Restore drill (do once per quarter, ~15 minutes)

1. Take a fresh Layer-2 dump (or use the latest scheduled one).
2. Restore it into a local scratch database.
3. Run `prisma migrate status` against it (must report up-to-date) and
   count three tables (`Product`, `Order`, `Customer`) — compare with
   the dump-time expectations in the backup log.
4. Record the drill date + result here: _last drill: local-only drill
   passed during initial build (2026-10-24); production drill pending
   first scheduled dump._

## What is NOT covered

- **Redis** (queues/cache): ephemeral by design; no backup needed.
- **Uploaded files** (R2/S3): enable bucket versioning/lifecycle in the
  storage provider; the DB only stores URLs.
- **Vercel env vars**: keep an offline note of which keys exist (names
  only). Values cannot be read back from Vercel after saving.
