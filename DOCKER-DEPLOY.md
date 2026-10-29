# Docker deploy runbook — advance-ecommerce on the VPS (Dokploy)

Everything runs in one compose stack (`docker-compose.prod.yml`):
**web** (Next.js storefront + admin + API) · **worker** (BullMQ queues,
schedulers, automation, call-center) · **postgres** · **redis** ·
**meilisearch** · **migrate** (one-shot schema migration).

> Honest status: these files were authored against the repo and
> statically checked (YAML + variable cross-checks). The **first real
> image build happens on the VPS** — expect to fix small issues on the
> first run; the order below is written so each step can be verified
> before moving on.

## 1. Create the service in Dokploy

1. Dokploy → **Create Service → Compose**. Source: this GitHub repo
   (`NextFaysal/advance-ecommerce`, branch `main`), compose file path
   `docker-compose.prod.yml`.
2. In the service's **Environment** tab, paste the variables from
   `.env.production.example` with real values (Dokploy stores them as
   the stack's `.env`). Generate every secret on the VPS with
   `openssl rand -hex 32` — a different value per secret, and never
   paste real values into chat or git.
   - `NEXT_PUBLIC_APP_URL` must be the final public address
     (e.g. `https://shop.example.com`) **before the first build** —
     `NEXT_PUBLIC_*` values are baked into the web image at build time.
3. Deploy in the order in §2. In Dokploy this means: deploy once and
   watch it fail at the web build if Postgres wasn't up yet — or use
   the terminal (§2) for the first bring-up, then use Dokploy's
   Deploy button for later updates.

## 2. First bring-up (order matters)

The Next.js build **prerenders storefront pages from the database**,
so Postgres must be running *before* the web image is built. The web
build uses host networking and reaches Postgres at `127.0.0.1:5432`
(that is why Postgres is published on the host loopback only).

```bash
# 1) Data services first
docker compose -f docker-compose.prod.yml up -d postgres redis meilisearch

# 2) Build the app images (web build reads the DB — Postgres must be up)
docker compose -f docker-compose.prod.yml build web worker migrate

# 3) Apply the schema to the fresh database
docker compose -f docker-compose.prod.yml run --rm migrate

# 4) Everything up (web/worker also wait for migrate to succeed)
docker compose -f docker-compose.prod.yml up -d

docker compose -f docker-compose.prod.yml ps        # all healthy?
docker compose -f docker-compose.prod.yml logs -f web worker
```

Later updates: `git pull` (Dokploy does this) → **rebuild + redeploy**
(`docker compose -f docker-compose.prod.yml up -d --build`). Migrations
run automatically because `web`/`worker` depend on `migrate`
completing successfully.

## 3. First Owner (fresh database only)

The web build ends with `scripts/bootstrap.mjs`, whose steps are gated
by env. With `RUN_BOOTSTRAP=1` it seeds the base data and creates the
first Owner from `FIRST_OWNER_EMAIL` / `FIRST_OWNER_PHONE` /
`FIRST_OWNER_PASSWORD` (the owner step refuses to run twice, so it is
safe to leave the gate on for exactly one build — and you must turn it
off after).

1. Set in the stack env: `RUN_BOOTSTRAP=1`, `FIRST_OWNER_EMAIL`,
   `FIRST_OWNER_PHONE`, and `FIRST_OWNER_PASSWORD` (set the password
   directly in Dokploy's env UI on the VPS — never via chat/git).
2. Rebuild + redeploy the **web** service (the bootstrap runs inside
   its build).
3. Log in at `/admin` with that email + password.
4. Set `RUN_BOOTSTRAP=0` and delete `FIRST_OWNER_PASSWORD` from the
   env, then redeploy once more.

Skip this section entirely if you migrate the Neon database (§4) —
the existing Owner account comes with the data.

## 4. Migrating the existing data from Neon

Do this **instead of** §3 if the Vercel/Neon store already has data
worth keeping (owner account, products, orders, settings).

```bash
# On the VPS. NEON_URL = the current production DATABASE_URL
# (copy it from the Vercel project's env settings).
pg_dump "$NEON_URL" --no-owner --no-privileges -f neon-dump.sql

# Start just Postgres (§2 step 1), then load the dump into it:
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U postgres -d advance_ecommerce < neon-dump.sql

# Then continue §2 from step 2 (build → migrate → up).
# `prisma migrate deploy` in the migrate step reconciles the schema.
```

Notes: the dump includes the encrypted Settings rows — they stay
readable **only if `SETTINGS_ENCRYPTION_KEY` / `AUTH_ENCRYPTION_KEY`
in the stack env are the same values the Vercel deployment used**.
If those keys were never set on Vercel, leave them unset here too
until you set fresh ones and re-enter the provider credentials in
Admin → Settings.

## 5. Search reindex (after first deploy, and after the Neon import)

```bash
docker compose -f docker-compose.prod.yml exec web pnpm --filter web search:reindex
```

Idempotent — indexes ACTIVE products only. Without it, storefront
search falls back to Postgres until Meilisearch is populated.

## 6. Domain wiring

1. Point the domain's DNS **A record** at the VPS IP.
2. In Dokploy, open the **web** service → **Domains** → add the domain,
   container port **3000**, enable HTTPS (Let's Encrypt). Dokploy's
   Traefik terminates TLS and routes to the web container; the
   `${WEB_PORT:-3000}` host port stays as a direct fallback.
3. If the domain was not final at build time, set
   `NEXT_PUBLIC_APP_URL` (and `NEXTAUTH_URL`) to `https://<domain>`
   and **rebuild the web image** — these values are compiled in.

## 7. Going live checklist / caveats

- Keep Vercel + Neon live until the VPS stack has served real traffic
  on the domain and an end-to-end test order has passed; the switch is
  DNS-only, so rollback is pointing DNS back.
- The worker is what makes queues, schedulers and call-center
  automation run in production — check `logs -f worker` shows it
  connected to Redis after bring-up.
- Backups: `pgdata` is a named Docker volume. Schedule a regular
  `pg_dump` (the app also ships `pnpm --filter web db:backup`) and
  copy dumps off the VPS.
- If the image build fails downloading Prisma engines
  (`binaries.prisma.sh` unreachable), set
  `PRISMA_ENGINES_MIRROR=https://cdn.npmmirror.com/binaries/prisma`
  in the stack env and rebuild.
