# DECISIONS.md — Step 0

- Model: Single-tenant, NOT SaaS. One codebase, separate install per client.
- Stack: Next.js (App Router) + TypeScript strict + PostgreSQL + Prisma + Redis + BullMQ + Tailwind + shadcn/ui + Meilisearch.
- Package manager: pnpm + Turborepo (monorepo: apps/web, packages/db, packages/validators, packages/ui).
- Language: Bangla default (bn, fallback en), currency BDT, timezone Asia/Dhaka, money integer poisha.
- Admin path: /admin (dashboard redirects to /admin).
- Brand: Indigo default, client-wise CSS variable diye change.
- Local first: App local e cholbe, live sudhu Nazmul bolle.
- Integrations admin-configurable: Storage (R2 default), Email (Resend + SMTP), SMS (all providers), Payment (all methods), Courier (all providers). Env = default/fallback, Admin Settings (DB, encrypted) = override.
- GitHub: Work local e hobe, GitHub e push pore — jokhon Nazmul bolbe, tokhon connection confirm kore push hobe. Age kono push hobe na, ar kono token/file e save kora hoy nai.
- Deferred items: Notun idea / scope change BACKLOG.md e jabe, v1 e na.

## Build decisions (Agents 1–21, recorded 2026-10-24 by Agent 22)

- Demo stores are labelled, never disguised: until Prisma persistence lands, routes/services run on in-memory or mock stores and say so in code and in API `meta` (`TEMPORARY_MOCK`, `TEMPORARY_DEMO`, `persistence: "in-memory-demo"`, `db: "NOT_WIRED"`, `persisted: false`). A demo result is never presented as a real one.
- Hash-only secrets, everywhere: session tokens, OTP/reset tokens, TOTP codes at verify time, payment-link tokens (SHA-256, plain token returned once), API keys (`ak_live_…`, only the hash is stored, public views never include it), rider delivery OTPs, webhook signing secrets (kept encrypted in Admin Settings; subscription records carry only `hasSecret`).
- Percentages are basis points, money is integer poisha: commissions, fraud/analytics ratios, EMI surcharges, retention and LTV:CAC/ROAS are computed in bps or integer poisha — no float money anywhere (ERP journal builder rejects non-integer and unbalanced entries instead of rounding/plugging).
- AI assist is a template fallback until a real provider is wired: description/SEO/alt generation and the spam/sentiment classifier are rule/template based, every result is labelled `engine: "template-fallback"` + `requiresReview: true`, and no module claims ML where it is scoring/templates. Recommendations are point scoring with per-item reasons.
- Fraud/automation never silently act: automation actions are effects validated against the order state machine; dry-run evaluates without persisting or applying; fraud scoring suggests (auto-confirm / manual review / require advance / block) — enforcement at checkout is a separate wiring step.
- Disputed money is never silently adjusted: courier reconciliation keeps expected values and separates matched vs disputed totals; cash-closing mismatches and rider COD shortages are flagged, not corrected.
- Fail closed: missing feature flag, missing credential, missing encryption key, or unavailable session validation all refuse (403/422/503) rather than running open or faking success. Sandbox results are always labelled simulated, simulated ids carry the `SBX-` prefix, and there is no hardcoded test secret for webhooks.
- Plugin sandboxing is deferred by design: extensibility ships declarations only (manifests, hook subscriptions, adapter registrations). No third-party plugin code runs inside the Next.js request process; execution waits for an isolated worker/VM runtime with scoped API keys, resource limits, and a kill switch (see `docs/MODULES.md` §4).
- Full BD geo is a reviewed import, not a rename: the full dataset stays as `bd-geo-full-DRAFT.json` until its duplicate-name union groups and the zero-union upazila are handled; the seed keeps using the clearly labelled sample file meanwhile.
- No fake Prisma client: the generate blocker is documented in `packages/db/PRISMA-BLOCKER.md` and worked around with honest 503s, never with a hand-written `@prisma/client` stub.
