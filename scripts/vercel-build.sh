#!/usr/bin/env bash
# Vercel production build pipeline (invoked from vercel.json buildCommand,
# which is limited to 256 characters — hence this script).
set -euo pipefail
cd "$(dirname "$0")/.."

# Migrations must run against the DIRECT (unpooled) Neon connection.
export DATABASE_URL="${DATABASE_URL_UNPOOLED:-$DATABASE_URL}"

pnpm --filter @advance-ecommerce/db exec prisma migrate deploy
pnpm --filter @advance-ecommerce/db db:generate

# One-time bootstrap (seed + first Owner), gated by RUN_BOOTSTRAP=1 in the
# Vercel project env. Remove that env var after the bootstrap build; the
# owner script refuses to run twice and the seed is only run under this
# gate. `|| true` on the owner step: its "already exists" refusal must not
# fail later builds if the env var lingers.
if [ "${RUN_BOOTSTRAP:-}" = "1" ]; then
  echo "[bootstrap] seeding database"
  pnpm --filter @advance-ecommerce/db db:seed
  echo "[bootstrap] creating first owner (no-op if one exists)"
  pnpm --filter @advance-ecommerce/db exec tsx scripts/create-first-owner.ts || true
fi

pnpm --filter web build

# NOTE: the Prisma query-engine packaging fix lives in the web build
# itself (apps/web package.json "build" runs scripts/patch-prisma-engine.mjs
# after next build). Do NOT patch .nft.json files from here with
# repo-relative paths — the packager resolves manifest entries relative
# to each manifest file and fails with ENOENT.
