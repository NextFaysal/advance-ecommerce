-- Add INCOMPLETE to the OrderStatus enum.
--
-- The abandoned-checkout recovery flow (apps/web/src/checkout/abandoned.ts)
-- creates orders in this status and later completes them in place, and the
-- value was added to schema.prisma (commit 590a2da4) without a migration.
-- Without this migration, any database built from the migration history
-- alone (VPS, Neon) rejects writes of the new status at runtime with
-- "invalid input value for enum OrderStatus" — the generated client and
-- typecheck accept it, so only this file makes production agree.
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'INCOMPLETE';
