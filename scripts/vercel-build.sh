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

# Prisma query-engine placement: Next's file tracing does not reliably
# copy libquery_engine-*.so.node into every serverless function in this
# pnpm monorepo, and the client searches apps/web/.next/server at
# runtime. Copy it there explicitly.
ENGINE="$(find node_modules/.pnpm -path '*node_modules/.prisma/client/libquery_engine-*.so.node' -print -quit || true)"
if [ -n "${ENGINE:-}" ]; then
  cp "$ENGINE" apps/web/.next/server/
  echo "[build] prisma engine copied: $ENGINE"
else
  echo "[build] WARNING: prisma query engine not found to copy"
fi
