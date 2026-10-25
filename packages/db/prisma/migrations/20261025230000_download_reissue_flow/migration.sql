-- Doc 18 batch F3 (wave 30): digital download account page + re-issue
-- flow.
--
-- DownloadGrant tokens are SHA-256 hashes only — the raw token exists
-- once, at fulfilment, and is unrecoverable BY DESIGN. Until now a
-- customer who lost the link (or let it expire / exhausted it) had no
-- path at all, and there was no account surface for downloads.
--
-- This migration adds:
--  * DownloadGrant.revokedAt — set when staff revoke a grant. Both
--    redemption paths (the public bearer-token route and the new
--    session-authorized account access endpoint) refuse revoked
--    grants.
--  * DownloadReissueRequest — the customer asks for a replacement
--    grant; staff decide in /admin/downloads. Approval mints a NEW
--    grant for the same file/order and revokes the old one; the new
--    grant's id is recorded on the request (newGrantId). The raw
--    token of the new grant is never stored — it is returned once,
--    in the approve response, for staff to relay if needed.
--
-- One PENDING request per grant is enforced by a partial unique
-- index below (Prisma schema cannot express partial indexes; the
-- service checks first for a friendly error, the index is the
-- race-proof backstop).

-- AlterTable
ALTER TABLE "DownloadGrant" ADD COLUMN "revokedAt" TIMESTAMP(3);

-- CreateEnum
CREATE TYPE "DownloadReissueStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "DownloadReissueRequest" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "reason" TEXT,
    "status" "DownloadReissueStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "newGrantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DownloadReissueRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DownloadReissueRequest_status_createdAt_idx" ON "DownloadReissueRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DownloadReissueRequest_grantId_idx" ON "DownloadReissueRequest"("grantId");

-- CreateIndex
CREATE INDEX "DownloadReissueRequest_customerId_idx" ON "DownloadReissueRequest"("customerId");

-- CreateIndex (partial: at most one PENDING request per grant)
CREATE UNIQUE INDEX "DownloadReissueRequest_one_pending_per_grant" ON "DownloadReissueRequest"("grantId") WHERE "status" = 'PENDING';

-- AddForeignKey
ALTER TABLE "DownloadReissueRequest" ADD CONSTRAINT "DownloadReissueRequest_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "DownloadGrant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DownloadReissueRequest" ADD CONSTRAINT "DownloadReissueRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
