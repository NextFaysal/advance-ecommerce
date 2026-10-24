# Production worker host — setup guide

The BullMQ worker (SMS/email dispatch, bulk actions, report exports,
webhook retries, automation runs) and Meilisearch CANNOT run on Vercel.
They need one small always-on host. Everything below is prepared; the
only missing piece is the host itself (a VPS is recommended: one box
runs worker + Redis + Meilisearch).

## What runs where

| Piece | Where | Notes |
|---|---|---|
| Web app | Vercel | already live |
| Postgres | Neon | already live |
| Redis 7 | worker host | BullMQ queues + rate-limit/cache |
| Worker | worker host | `pnpm --filter web worker` (apps/web/scripts/worker.ts), all 11 queues |
| Meilisearch | worker host | 127.0.0.1:7700 locally; expose to Vercel via HTTPS + API key if search should use it |

## VPS checklist (Ubuntu 24.04, 2 vCPU / 2 GB is enough to start)

1. Install Node 24 (NodeSource), pnpm 10 (`corepack` or `npm i -g pnpm@10.0.0`), Redis (`apt install redis-server`, bind 127.0.0.1), git.
2. Clone the repo (private — use a read-only deploy key).
3. Env for the worker process (systemd unit or pm2 ecosystem file):
   - `DATABASE_URL` = Neon POOLED url (same as Vercel's POSTGRES_PRISMA_URL)
   - `DATABASE_URL_UNPOOLED` not needed by the worker
   - `REDIS_URL=redis://127.0.0.1:6379`
   - `SETTINGS_ENCRYPTION_KEY`, `AUTH_ENCRYPTION_KEY` = SAME values as Vercel (worker decrypts admin settings from the DB)
   - `MEILISEARCH_HOST=http://127.0.0.1:7700`, `MEILISEARCH_API_KEY` = the host's master key
   - `NEXTAUTH_SECRET` not needed by the worker
4. `pnpm install --frozen-lockfile` then generate the Prisma client with
   `PRISMA_ENGINES_MIRROR` ONLY if the engines host is blocked on that
   network (it is blocked from some BD networks; harmless to set).
5. Run the worker under systemd (Restart=always) or pm2; verify in the
   log that it boots on all 11 queues and stays up.
6. Meilisearch: run the official binary with `--master-key` matching
   `MEILISEARCH_API_KEY`; reindex once: `pnpm --filter web search:reindex`.
7. Point Vercel at them (project env, production):
   - `REDIS_URL` = a URL reachable from Vercel — Redis on a VPS is NOT
     publicly reachable by default; prefer **Upstash Redis** (free tier)
     for the Vercel↔Redis link and give the worker the same Upstash URL
     (worker does not need a local Redis then). If Redis stays local to
     the VPS, the web app keeps its in-process fallbacks and only the
     worker uses Redis — acceptable for v1.
   - `MEILISEARCH_HOST` / `MEILISEARCH_API_KEY` (public HTTPS endpoint of
     the VPS Meilisearch, key-protected) — optional; without it search
     keeps using the Postgres fallback.

## Honest limits until this host exists

- Queued jobs accumulate unprocessed: order-confirmation SMS/email,
  bulk actions, exports, webhook redeliveries do not fire.
- Search works via Postgres fallback (no Banglish synonym ranking).
- Rate limiting / settings cache are per-instance in-process on Vercel.
