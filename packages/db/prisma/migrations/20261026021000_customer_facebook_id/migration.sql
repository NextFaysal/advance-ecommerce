-- Facebook customer sign-in (doc 22 ADV-15 remainder, 2026-10-26):
-- Customer.facebookId — the Facebook user id for social sign-in,
-- mirroring Customer.googleId from schema wave 2. Nullable + unique:
-- stamped on the first verified-email match (one-time claim in
-- src/customer-auth/facebook.ts) and looked up FIRST on later
-- sign-ins. Postgres unique indexes treat NULLs as distinct, so
-- unbound rows never collide. Hand-written in the wave-2 style
-- (parent integrates/migrates serially).

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "facebookId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Customer_facebookId_key" ON "Customer"("facebookId");
