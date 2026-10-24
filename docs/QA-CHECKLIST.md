# Local QA Checklist — advance-ecommerce (updated during continuous build)

## Code health
- [x] Typecheck: 25 errors -> 2 errors after fixing API route import paths to `@/` alias (29 files)
- [ ] Typecheck fully green — BLOCKED: last 2 errors are both from ungenerated Prisma client (`PrismaClient` export + `auth.ts` rp inference). Unblocks when `prisma generate` succeeds (network to binaries.prisma.sh, see `packages/db/PRISMA-BLOCKER.md`)
- [x] No secrets in repo files (agents grepped, no real credentials; only placeholders / local defaults in docker-compose)
- [x] Money is integer poisha in schema, services, pricing, reports (only Float in schema is Product.ratingAverage, a rating)
- [x] API routes: Zod validation, `{data, meta}` / `{error:{code,message}}`, RBAC + audit on admin routes, masked phone by default

## Auth / security base
- [x] Staff login + TOTP lib, lock after 5 failed, login history, session hash only
- [x] Auth route handlers: login + verify-2fa (httpOnly cookies, generic errors, rate limit)
- [x] Settings test route (sandbox pass simulated, live never faked)
- [x] Middleware: /dashboard -> /admin, /admin/* requires admin_session cookie (page shell only, server-side validation remains the boundary)
- [x] First Owner script (env password only, refuses if Owner exists, never prints password/hash)
- [ ] TOTP secret encryption on enrolment, Redis swap for rate-limit + settings cache (Step 34)

## Functional (local, mock/in-memory until Prisma generate)
- [x] Design system + admin shell, storefront, catalog, checkout, orders, CRM shells
- [x] Order state machine, One-Click outline, cart merge, idempotency
- [x] Payment/Courier sandbox adapters + webhook pipeline + manual TrxID + COD settlement
- [x] Inventory ledger, coupon, campaign estimate, reports, CMS service + schema (74 models, 20 enums — verified by grep 2026-10-24; schema has NOT passed `prisma validate` yet, blocked with generate)
- [x] Job queue contracts (SMS/email/courier/webhook/report/automation)
- [ ] DB persistence swap: routes currently in-memory/mock, marked NOT_WIRED/persisted:false — swap to Prisma after generate + migrate + seed
- [ ] Full BD geo dataset (sample only), Meilisearch live indexing, BullMQ workers, SSE live feed (Redis pub/sub)
- [ ] E2E (Playwright) + load test + visual regression — after DB persistence works locally
- [ ] Next.js production build pass — run after Prisma generate, record result here

## Deferred by instruction
- GitHub push: later, on Nazmul's instruction (no push done)
- Live deploy: only when Nazmul says "live koro" (no deploy done)

## v2 add-on modules (Agents 11–21, verified 2026-10-24)
All modules below: pure logic + API/UI built, flags OFF by default (17 `module.*` flags in seed), persistence is in-memory-demo unless stated. Each agent's scoped strict `tsc` was clean and its smoke tests passed; the project-wide typecheck remains at the 2 known Prisma errors.

- [x] Automation engine: trigger/condition/action rules, dry-run (never persists, never applies), run logs with masked phones only; routes fail closed (flag → 403, session → 401/503, permission)
- [x] Fraud scoring: 0–100 score with explained signals; blacklist floors at 90 → block; ≥70 → OTP required; smoke tests (clean 0, risky 85, blacklist 90) passed
- [x] BD differentiators: address parser (typo table, confidence, never invents a district), SMS auto-verify parser (OTP messages rejected, duplicate TrxID verified once), payment links (hash-only token, expired can never be paid), cash closing (mismatch flagged, never auto-corrected), courier reconciliation (disputed rows keep expected values; matched/disputed totals separate) — 35-assertion smoke test passed
- [ ] BD persistence: `PaymentLink` + `DailyCashClosing` models are in the schema; DB-backed TrxRegistry / stores not wired (needs Prisma)
- [x] Own riders (E3): zone+load assignment, DELIVERED requires proof, delivery OTP hash-only, COD shortage flagged never adjusted, over-handover rejected; `Rider`/`RiderDelivery` models + `riders.view/manage` permissions added
- [ ] Rider real-time location / live board — type + stub only, needs rider app + Redis/websocket fan-out
- [x] Vendors: API (list/create/status/product-approval/payout), commission in basis points floored to poisha, payout never negative, approved-product edit returns to PENDING_REVIEW; `Vendor` model in schema
- [x] Reseller / call center / F-commerce inbox / POS: services + API routes built (folders + routes verified on disk), admin pages for resellers + call-center (inbox/POS are service + API only so far), feature-flag gated, demo persistence
- [x] B2B / advanced orders: split allocation (unallocated lines never dropped), partial payment/delivery (over-payment/over-delivery rejected, not clamped), exchange difference in poisha, merge validation, pre-orders, wholesale tiers, credit check blocks on over-limit/overdue, quotations; `PreOrder`/`StockTransfer`/`B2bCustomer`/`Quotation` models in schema
- [x] AI assist: template fallback honestly labelled (`engine: template-fallback`, review required) — NOT a real LLM; keyword classifier shows matched keywords, never auto-deletes
- [x] Smart search / analytics: rule-based query parser (e.g. "ajker pending order Dhaka" → filters), RFM, cohort (bps), LTV/CAC/ROAS (`null` when ad spend untracked — never Infinity), courier score; demo rows labelled
- [ ] Real AI provider integration — interface ready; key must be stored encrypted in Admin Settings when wired
- [x] Business packs + ERP-lite + extensibility: fashion/electronics (EMI sums exactly)/grocery/pharmacy (Rx gate, no bypass)/digital packs; journal entries balanced-only (unbalanced throws), period lock enforced, VAT report; API keys + payment-link style hash-only secrets; hook registry (a failing hook never blocks the core operation); 5 pack flags + `module.erp_lite` are in the seed (verified — the note in MODULES.md §2 saying otherwise is stale)
- [ ] ERP/extensibility DB tables (`ErpAccount`, `ErpJournalEntry/Line`, `ErpPeriod`, `ApiKey`, `WebhookSubscription` models added to schema; stores still demo) and plugin runtime sandboxing — deferred by design, see MODULES.md §4
- [x] Admin UI for automation / fraud / modules / ERP: lock panels while flags are OFF, demo data labelled TEMPORARY DEMO, no key/hash ever shown
- [x] Public pay page `/pay/[token]`: resolves by token hash only (an id never resolves), sandbox initiation is idempotent and does NOT mark the link paid (paid arrives only via verified webhook)
- [x] Order tracking `/track`: orderNo + phone match required, identical generic error for not-found vs wrong phone (no enumeration), masked phone only, rate-limited
- [x] Storefront UX (Part B): recently viewed (cap 20), quick view, sticky buy bar, compare (max 3), size guide, back-in-stock signup, wishlist page — logic smoke-tested (~45 assertions in the pay/track/UX slice); `BackInStockSignup` model in schema
- [ ] Product-page mounting of quick-view/sticky-bar/compare/size-guide/recently-viewed — Agent 21 wiring slice (in progress when this checklist was updated)

## Workers / PWA / E2E (Agent 12)
- [x] Queue contracts (10 queues) + handlers (idempotent, ids/masked refs only in logs) + worker wiring/policy layer
- [ ] BullMQ worker daemon actually running — `bullmq`/`ioredis` are NOT installed; workers.ts is a wiring layer against a structural interface, not a daemon
- [x] PWA: manifest (shortcuts New Order / Orders / Scan), service worker (offline shell, `/api/*` network-only), offline page, registration wired into root layout by integration
- [ ] PWA icon PNGs (192 / 512 / maskable) — placeholder paths only, files do not exist yet; install prompt cannot fire until added
- [x] Playwright scaffolding: config (mobile-360 + desktop projects) + 5 spec files, env-gated, no hardcoded credentials
- [ ] E2E specs executed and passing — NOT run (no `@playwright/test`, no dev server + seeded DB, Prisma blocked). Do not report as passing

## Docs (Agent 22, 2026-10-24)
- [x] `docs/ARCHITECTURE.md` — module map, API surface, data model (74 models / 20 enums), flags (17), real-vs-demo status
- [x] `docs/RUNBOOK-LOCAL.md` — local run steps, sandbox explanation, Prisma blocker + troubleshooting
- [x] Counts in this checklist re-verified on disk (models, enums, flags, routes, pages, typecheck = 2 Prisma errors)

## Backup / restore (Agent 67, 2026-10-24) — procedure in RUNBOOK §11
- [x] Scripts exist: `apps/web/scripts/backup-db.ts` (pg_dump custom format + SHA-256 sidecar + retention prune, default 7) and `apps/web/scripts/restore-db.ts` (explicit file + `--confirm` required, `--dry-run` preview, checksum verification, `prod`-name guard with `--allow-production` override)
- [x] Smoke-tested 2026-10-24: backup `--dry-run` (pg_dump-missing path → clear bilingual message, exit 1, nothing created, DATABASE_URL password absent from output), restore without `--confirm` refused (exit 1) with the would-run command shown redacted, restore `--dry-run` on a missing file errors clearly, checksum-mismatch dump refused, checksum-OK dump verified, unset DATABASE_URL errors clearly
- [ ] `postgresql-client` installed on this machine and the first REAL backup taken — NOT done: no live DB yet (Prisma blocker), pg_dump/pg_restore absent from PATH
- [ ] Restore drill performed into a scratch database and verified (row counts + app health endpoint) — NOT done yet; steps in RUNBOOK §11
- [ ] Off-site copy verified: a backup + sidecar copied to Cloudflare R2, downloaded back, and `sha256sum -c` passed — NOT done (manual step, no automation exists)
- [ ] Backup schedule enabled (cron) and one scheduled run observed producing a checksummed dump — NOT done
