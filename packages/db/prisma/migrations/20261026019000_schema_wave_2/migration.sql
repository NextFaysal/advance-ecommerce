-- Schema wave 2 (2026-10-26): accumulated schema debt, one migration.
--  1. ErpJournalEntry @@unique([sourceKind, sourceId]) — local audit
--     before writing this: 0 duplicate pairs (table empty locally).
--     Production duplicates, if any, are removed by the dedupe guard
--     directly above the index (earliest entry kept).
--  2. Customer.googleId + Customer.birthDate (ADV-15 / ADV-18).
--  3. Product.priceOnRequest (ADV-19 leftover).
--  4. VendorPayoutRequest (ADV-13 leftover: no payout model existed).
--  5. VendorDocument (ADV-13 leftover: KYC document metadata).
--  6. NotificationLog.providerMessageId (ADV-2 durable DLR).
--  7. AutomationTrigger += CUSTOMER_REGISTERED (ADV-7 leftover).

-- AlterEnum
ALTER TYPE "AutomationTrigger" ADD VALUE 'CUSTOMER_REGISTERED';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "birthDate" TIMESTAMP(3),
ADD COLUMN "googleId" TEXT;

-- AlterTable
ALTER TABLE "NotificationLog" ADD COLUMN "providerMessageId" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "priceOnRequest" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "VendorDocument" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorPayoutRequest" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "amountPoisha" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "accountNote" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorPayoutRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_googleId_key" ON "Customer"("googleId");

-- CreateIndex
CREATE INDEX "NotificationLog_providerMessageId_idx" ON "NotificationLog"("providerMessageId");

-- CreateIndex
CREATE INDEX "VendorDocument_vendorId_status_idx" ON "VendorDocument"("vendorId", "status");

-- CreateIndex
CREATE INDEX "VendorPayoutRequest_vendorId_status_idx" ON "VendorPayoutRequest"("vendorId", "status");

-- DropIndex
DROP INDEX "ErpJournalEntry_sourceKind_sourceId_idx";

-- CreateIndex
-- Dedupe guard (added at integration): if any duplicate
-- (sourceKind, sourceId) pairs exist, keep the earliest entry and
-- delete the later double-posts so the unique index below can build.
DELETE FROM "ErpJournalEntry" a USING "ErpJournalEntry" b
WHERE a."sourceKind" = b."sourceKind" AND a."sourceId" = b."sourceId"
  AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."id" > b."id"));

CREATE UNIQUE INDEX "ErpJournalEntry_sourceKind_sourceId_key" ON "ErpJournalEntry"("sourceKind", "sourceId");

-- AddForeignKey
ALTER TABLE "VendorDocument" ADD CONSTRAINT "VendorDocument_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPayoutRequest" ADD CONSTRAINT "VendorPayoutRequest_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
