# advance-ecommerce — Local First

**Status:** Phase 1 Foundation scaffold — local development only. Live kora hobe sudhu jokhon Nazmul bolbe.

## Stack
Next.js (App Router) + TypeScript (strict) + PostgreSQL + Prisma + Redis + BullMQ + Tailwind + shadcn/ui + Meilisearch (choice, pore change kora jabe).

## Run locally (secret chara)
1. `cp apps/web/.env.example apps/web/.env.local`
2. `.env.local` e sudhu local machine e Database URL, Redis URL, ar auth secret bosan. **Ei file kokhono git e commit korben na, chat e pathaben na.**
3. `pnpm install`
4. `pnpm db:push` / `pnpm db:migrate` (Phase 1 schema)
5. `pnpm dev` — http://localhost:3000, admin http://localhost:3000/admin

## Admin-configurable integrations
Storage (Cloudflare R2 default), Email (Resend + SMTP), SMS (BulkSMSBD / SSL Wireless / Greenweb), Payment (COD, bKash, Nagad, Rocket, Upay, SSLCommerz, AamarPay, ShurjoPay, Stripe/PayPal), Courier (Steadfast, Pathao, RedX, Paperfly, eCourier) — sob Admin > Settings theke set kora jabe.
- Env = default/fallback
- Admin Settings (DB, encrypted) = override
- Secret kokhono plain text e API response / log e asbe na

## Language / Currency
Default locale `bn` (fallback `en`), currency BDT, timezone Asia/Dhaka, money integer poisha te.

## Docs
Master plan, spec, design spec: `../ecommerce-platform/` folder e ache. Local setup decision: `../ecommerce-platform/09-local-setup-decisions.md`.
