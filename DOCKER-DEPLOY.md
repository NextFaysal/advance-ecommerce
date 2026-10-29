# Docker deploy runbook — advance-ecommerce on the VPS (Dokploy)

Everything runs in one compose stack (`docker-compose.prod.yml`):
**web** (Next.js storefront + admin + API) · **worker** (BullMQ queues,
schedulers, automation, call-center) · **postgres** · **redis** ·
**meilisearch** · **migrate** (one-shot schema migration).

**Images are built in GitHub Actions, never on the VPS** (the VPS is
too weak for `next build`). `.github/workflows/build-images.yml` builds
the `Dockerfile`'s web/worker targets and pushes them to GHCR:

- `ghcr.io/nextfaysal/advance-ecommerce-web:latest` (+ short-SHA tag)
- `ghcr.io/nextfaysal/advance-ecommerce-worker:latest` (+ short-SHA tag)

The workflow builds against a **throwaway** seeded Postgres on the
runner (the Next build prerenders pages from a database). That data is
not real: after deploy, ISR pages revalidate against the real VPS
database within minutes and product pages render on demand.

> Honest status: these files were authored against the repo and
> statically checked (YAML + variable cross-checks). The first real CI
> build may still surface a small issue — the Actions log shows it, and
> fixes are a normal code push (which rebuilds automatically).

## 0. One-time GitHub setup

1. **Repo variables** (GitHub → repo → Settings → Secrets and variables
   → Actions → **Variables**) — these are baked into the web image:
   - `NEXT_PUBLIC_APP_URL` — final public address, e.g.
     `https://shop.example.com` (can start as the Dokploy address and
     be corrected later — changing it needs a workflow re-run).
   - `NEXT_PUBLIC_APP_NAME` — the store name.
2. **First build:** any push to `main` that touches the app triggers
   the workflow (or run it manually: Actions → *Build images* → Run
   workflow). Wait for it to go green and confirm the two packages
   exist under the repo's **Packages** tab.
3. **Dokploy pull access:** the images are private. Create a GitHub
   **PAT (classic)** with only `read:packages`, then in Dokploy →
   Settings → **Registry** add GHCR (`ghcr.io`) with your GitHub
   username + that PAT. Never send the PAT in chat.

## 1. Create the service in Dokploy

1. Dokploy → **Create Service → Compose**. Source: this GitHub repo
   (`NextFaysal/advance-ecommerce`, branch `main`), compose file path
   `docker-compose.prod.yml`.
2. In the service's **Environment** tab, paste the variables from
   `.env.production.example` with real values. Generate every secret
   with `openssl rand -hex 32` — a different value per secret, and
   never paste real values into chat or git. (Fresh start: **no**
   values need to match Vercel.)

## 2. First bring-up

```bash
# Everything at once — migrate runs first, web/worker wait for it.
docker compose -f docker-compose.prod.yml up -d

docker compose -f docker-compose.prod.yml ps          # all healthy?
docker compose -f docker-compose.prod.yml logs -f web worker
```

(In Dokploy: just press **Deploy** — same thing.)

Later updates: push to `main` → Actions rebuilds the images → in
Dokploy press **Redeploy** (services use `pull_policy: always`, so the
new `:latest` is pulled). Migrations run automatically on every start
because `web`/`worker` depend on `migrate` completing successfully.

## 3. First Owner (fresh database)

`RUN_BOOTSTRAP` is **not** used at image-build time (CI builds against
a throwaway DB). Create the Owner against the **real** database by
running the same bootstrap once inside the running web container:

```bash
docker compose -f docker-compose.prod.yml exec \
  -e RUN_BOOTSTRAP=1 \
  -e FIRST_OWNER_EMAIL=you@example.com \
  -e FIRST_OWNER_PHONE=+8801XXXXXXXXX \
  -e FIRST_OWNER_PASSWORD='set-a-strong-one-here' \
  web node ../../scripts/bootstrap.mjs
```

- This seeds the base data (geo, roles, defaults) and creates the
  Owner; the owner step refuses to run twice, so an accidental re-run
  is safe.
- Then log in at `/admin` with that email + password, and register a
  passkey / enable 2FA from the security settings.
- The app also offers a first-run setup wizard while no Owner exists —
  either path works; do not use both.

## 4. Neon migration — skipped

Fresh start was chosen (2026-10-29): the Neon database is **not**
migrated. Vercel + Neon stay live as a fallback until the domain is
switched (§6). If a migration is ever wanted later, ask for the
migration runbook (dump → restore → encryption keys must match).

## 5. Search reindex (after first deploy)

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
3. Set the GitHub repo variable `NEXT_PUBLIC_APP_URL` to
   `https://<domain>` (§0) and re-run the workflow, then redeploy —
   the value is compiled into the web image.

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
- If a CI build fails downloading Prisma engines, check the Actions
  log first; the Dockerfile accepts a `PRISMA_ENGINES_MIRROR` build
  arg (GitHub runners normally reach `binaries.prisma.sh` fine).
