-- Customer API tokens (wave 58 follow-up): the bearer-token auth
-- seam for the public account API — the prerequisite the customer-
-- app decision recorded for any future native app
-- (apps/customer-app/README.md). One row per token: per-customer,
-- multiple per customer, individually revocable, lastUsedAt
-- bookkeeping. A REAL table by the CustomerSession / partner
-- ApiKey precedent (tokens are unbounded across customers, so the
-- Setting-doc store used for the install-global SMS device tokens
-- does not fit). Only the SHA-256 hash is stored; the plaintext
-- `ae_cust_…` exists once, in the create response. No expiry —
-- revocation is the off-switch, like the partner API keys.
-- Owned by src/customer-auth/api-tokens.ts.

-- CreateTable
CREATE TABLE "CustomerApiToken" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerApiToken_tokenHash_key" ON "CustomerApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "CustomerApiToken_customerId_idx" ON "CustomerApiToken"("customerId");

-- AddForeignKey
ALTER TABLE "CustomerApiToken" ADD CONSTRAINT "CustomerApiToken_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
