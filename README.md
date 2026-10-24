# Advance Ecommerce — Local First

Single-tenant, Bangladesh-first ecommerce platform. Local e banano hocche, live sudhu Nazmul bolle.

## Step status
- Step 0: Plan confirm — done
- Step 1: Monorepo + tooling — done
- Step 2: Env loader + local infra — done (docker-compose: Postgres/Redis/Meilisearch, local defaults only)
- v1 + v1.5 + v2 slices: code built by Agents 1–21 — design system, foundation/auth/RBAC/settings, catalog, storefront + checkout, orders/CRM, payment/courier sandbox, inventory/marketing/reports/CMS, BD differentiators, automation/fraud, reseller/call-center/inbox/POS, riders, vendors, B2B/advanced orders, AI/analytics, business packs, ERP-lite, extensibility, public pay/track pages, workers/PWA/E2E scaffolding, admin UI
- GitHub push: pore, Nazmul bolle — ekhon local only, kono push kora hoy nai

## Project status (verified 2026-10-24, Final Audit v3)
- 94 Prisma models / 20 enums, 98 API routes (85 admin + 12 public + openapi.json), 63 pages (42 admin + 21 storefront/public), 488 TS/TSX files, 19 feature flags (all OFF by default), 61 permissions (RBAC = seed) — counts verified on disk, details in `docs/FINAL-AUDIT-V3.md`
- Typecheck: exactly 2 errors, both from the ungenerated Prisma client
- **Blocked:** `prisma generate` cannot download its engine binary (network reset to `binaries.prisma.sh`) — see `packages/db/PRISMA-BLOCKER.md`. Because of this, no migration/seed has run and almost all route persistence is still in-memory/demo, labelled in code (`TEMPORARY_MOCK`, `in-memory-demo`, `NOT_WIRED`). Pure logic, sandbox providers, and the design system are real and smoke-tested; DB-backed runtime is not yet.
- Full status, honest real-vs-demo breakdown: `docs/ARCHITECTURE.md` §8 and `docs/QA-CHECKLIST.md`

## Run locally
1. `cp apps/web/.env.example apps/web/.env.local` — ashol Database/Redis value sudhu `.env.local` e, kokhono git/chat e na
2. `pnpm install`
3. Full step-by-step (infra, generate → migrate → seed → first Owner, feature flags, sandbox mode, troubleshooting): `docs/RUNBOOK-LOCAL.md`
4. `pnpm dev` — http://localhost:3000, admin http://localhost:3000/admin

## Docs
- `docs/ARCHITECTURE.md` — system overview, module map, API surface, data model, security rules, real-vs-demo status
- `docs/RUNBOOK-LOCAL.md` — how to run everything locally, sandbox mode, known blocker, troubleshooting
- `docs/QA-CHECKLIST.md` — what is checked, stubbed, and blocked
- `docs/DECISIONS.md` — decisions, incl. hash-only secrets, basis-points percentages, template AI fallback, plugin sandbox deferred
- `docs/BACKLOG.md` — remaining real wiring (DB swaps, real adapters, workers/Redis, E2E run, icons) + deferred GitHub push / live deploy
- `docs/MODULES.md` — extensibility, business packs, ERP-lite deep-dive
- Master plan + spec: `../ecommerce-platform/` — `10-step-by-step-execution-plan.md` dekhun.
