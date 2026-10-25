-- COD remittance ledger (doc 17 batch O8): until now, COD cash that
-- couriers/riders collected was recorded as Payment rows (wave 23) but
-- the settlement side had no table at all — the only "settlement"
-- surface was a sandbox report that recomputed rows from Shipment
-- data and hardcoded every row's status to "pending". These two
-- tables are the real ledger: a batch covers an exact set of Payment
-- rows (paymentId UNIQUE — one batch per collection, enforced by the
-- database), and the receive/close lifecycle records what actually
-- came back, the courier's fee, and the variance.

-- CreateEnum
CREATE TYPE "RemittanceStatus" AS ENUM ('OPEN', 'RECEIVED', 'CLOSED');

-- CreateTable
CREATE TABLE "RemittanceBatch" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "expectedPoisha" INTEGER NOT NULL,
    "receivedPoisha" INTEGER,
    "feePoisha" INTEGER,
    "variancePoisha" INTEGER,
    "status" "RemittanceStatus" NOT NULL DEFAULT 'OPEN',
    "receivedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RemittanceBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemittanceItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "expectedPoisha" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemittanceItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RemittanceBatch_provider_status_idx" ON "RemittanceBatch"("provider", "status");

-- CreateIndex
CREATE INDEX "RemittanceBatch_status_idx" ON "RemittanceBatch"("status");

-- CreateIndex
CREATE INDEX "RemittanceItem_batchId_idx" ON "RemittanceItem"("batchId");

-- CreateIndex
CREATE INDEX "RemittanceItem_orderId_idx" ON "RemittanceItem"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "RemittanceItem_paymentId_key" ON "RemittanceItem"("paymentId");

-- AddForeignKey
ALTER TABLE "RemittanceBatch" ADD CONSTRAINT "RemittanceBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemittanceItem" ADD CONSTRAINT "RemittanceItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "RemittanceBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemittanceItem" ADD CONSTRAINT "RemittanceItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemittanceItem" ADD CONSTRAINT "RemittanceItem_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
