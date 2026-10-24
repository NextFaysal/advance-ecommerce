# PRISMA BLOCKER — engine binary download blocked by network (not a code problem)

Date: 2026-10-24. Schema and seed are ready; `prisma generate` cannot complete
on this machine yet because the Prisma query engine binary cannot be downloaded.

## Attempts made (all honest, in order)
1. `prisma validate --schema=prisma/schema.prisma` — failed: `ECONNRESET / Error: aborted`
   at TLSSocket while contacting the network (Prisma CLI), Node v24.22.1.
2. `prisma generate` (retry, with dummy local DATABASE_URL) — same `ECONNRESET`.
3. Cache check: `~/.cache/prisma/master/605197351a3c8bdd595af2d2a9bc3025bca48ea2/debian-openssl-3.0.x/`
   exists but is EMPTY (0 files). `node_modules/.prisma` does not exist.
   `@prisma/engines@5.22.0` in the pnpm store contains only LICENSE/README/dist/scripts — no query-engine binary.
4. `PRISMA_ENGINES_CHECKSUM_IGNORE=1 prisma generate` — same `ECONNRESET`.
5. `pnpm rebuild @prisma/engines prisma @prisma/client` — completed silently, no binary appeared
   (build scripts for these packages are ignored by pnpm unless allow-listed).

## What unblocks this
- Network access to `binaries.prisma.sh` from this VM (the connection is currently reset), OR
- a cached engine binary for commit `605197351a3c8bdd595af2d2a9bc3025bca48ea2`, target `debian-openssl-3.0.x`, OR
- allow-listing Prisma build scripts in pnpm (`pnpm.onlyBuiltDependencies`) and re-installing on a working network.

## Once unblocked, run in order
```
DATABASE_URL=<local .env.local value> pnpm --filter @advance-ecommerce/db db:generate
DATABASE_URL=<local .env.local value> pnpm --filter @advance-ecommerce/db db:migrate
DATABASE_URL=<local .env.local value> pnpm --filter @advance-ecommerce/db db:seed
pnpm --filter web typecheck
```
No fake generated client was created. Do NOT commit a hand-written `@prisma/client` stub as a substitute.
The merged schema (49 models, 13 enums) passed a local structural check (no duplicate model names,
brace balance 0) but has NOT yet passed `prisma validate` — that validation is pending the network fix above.
