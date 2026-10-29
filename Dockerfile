# =============================================================================
# advance-ecommerce — production image (multi-stage, pnpm monorepo)
#
# Targets:
#   deps      Workspace deps installed from the frozen lockfile + the
#             generated Prisma client. Shared base for the other targets.
#   web-build deps + full source + `pnpm --filter web build`. The Next
#             build PRERENDERS pages against the database, so DATABASE_URL
#             must be reachable at build time (the prod compose file
#             builds with host networking against the already-running
#             Postgres — see docker-compose.prod.yml). REDIS_URL is
#             deliberately NOT set here: the app falls back to an
#             in-memory cache without it, which is the proven-safe
#             build configuration.
#   web       Runtime image for the storefront + admin + API
#             (`pnpm --filter web start`, port 3000).
#   worker    Runtime image for the background worker daemon
#             (`pnpm --filter web worker` → apps/web/scripts/worker.ts,
#             run via tsx). Built from `deps`, NOT from web-build: the
#             worker needs full source + node_modules but no `.next`.
#             The compose `migrate` one-shot also uses this target.
#
# Build (normally via docker-compose.prod.yml):
#   docker build --target web    -t advance-ecommerce-web    .
#   docker build --target worker -t advance-ecommerce-worker .
#
# Optional build args:
#   PRISMA_ENGINES_MIRROR  If binaries.prisma.sh is unreachable from the
#                          build host, pass a mirror, e.g.
#                          https://cdn.npmmirror.com/binaries/prisma
#   RUN_BOOTSTRAP=1 + FIRST_OWNER_EMAIL / FIRST_OWNER_PHONE /
#   FIRST_OWNER_PASSWORD   One-time first-Owner creation, executed by
#                          scripts/bootstrap.mjs at the end of the web
#                          build (see DOCKER-DEPLOY.md). Leave unset
#                          for normal builds.
# =============================================================================

# ---------------------------------------------------------------- deps ----
FROM node:22-bookworm-slim AS deps

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

# Prisma's platform detection needs OpenSSL present: without it the
# generate step silently targets debian-openssl-1.1.x and the engine
# then fails at runtime with "libssl.so.1.1: cannot open shared object
# file" on Bookworm (which ships OpenSSL 3). Installing openssl makes
# generate produce the correct debian-openssl-3.0.x engine.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /repo

# Workspace manifests first, so the dependency layer stays cached until
# a manifest or the lockfile actually changes.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/validators/package.json packages/validators/package.json
COPY packages/partner-sdk/package.json packages/partner-sdk/package.json

RUN pnpm install --frozen-lockfile

# Prisma client is generated into the db package; the schema must be
# present for that. The engines-mirror ARG is only exported to the
# generate step when a mirror was actually supplied.
COPY packages/db/prisma packages/db/prisma
ARG PRISMA_ENGINES_MIRROR=""
RUN if [ -n "$PRISMA_ENGINES_MIRROR" ]; then \
      PRISMA_ENGINES_MIRROR="$PRISMA_ENGINES_MIRROR" pnpm --filter @advance-ecommerce/db db:generate; \
    else \
      pnpm --filter @advance-ecommerce/db db:generate; \
    fi

# ------------------------------------------------------------ web-build ----
FROM deps AS web-build

# Build-time configuration. NEXT_PUBLIC_* values are inlined into the
# client bundle by Next — changing them later requires a rebuild.
ARG DATABASE_URL
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_APP_NAME
ARG RUN_BOOTSTRAP="0"
ARG FIRST_OWNER_EMAIL=""
ARG FIRST_OWNER_PHONE=""
ARG FIRST_OWNER_PASSWORD=""
ENV DATABASE_URL=$DATABASE_URL \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME \
    RUN_BOOTSTRAP=$RUN_BOOTSTRAP \
    FIRST_OWNER_EMAIL=$FIRST_OWNER_EMAIL \
    FIRST_OWNER_PHONE=$FIRST_OWNER_PHONE \
    FIRST_OWNER_PASSWORD=$FIRST_OWNER_PASSWORD \
    NEXT_TELEMETRY_DISABLED=1

COPY . .

RUN pnpm --filter web build

# ----------------------------------------------------------------- web ----
FROM node:22-bookworm-slim AS web

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

# The copied Prisma engine links the system OpenSSL 3 at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /repo

# The built repo wholesale: node_modules (pnpm store layout + generated
# Prisma client), apps/web/.next, packages, and the root scripts the
# web package's start path may reference.
COPY --from=web-build /repo /repo

WORKDIR /repo/apps/web
EXPOSE 3000
CMD ["pnpm", "--filter", "web", "start"]

# -------------------------------------------------------------- worker ----
FROM deps AS worker

ENV NODE_ENV=production

WORKDIR /repo

# Full source on top of the deps layer (the build context excludes
# node_modules / .next via .dockerignore, so the installed deps from
# the deps stage survive this copy).
COPY . .

WORKDIR /repo/apps/web
CMD ["pnpm", "--filter", "web", "worker"]
