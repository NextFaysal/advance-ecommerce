-- CreateTable
CREATE TABLE "AbandonedCheckout" (
    "id" TEXT NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerName" TEXT,
    "itemsJson" JSONB NOT NULL,
    "addressJson" JSONB,
    "subtotalPoisha" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "recoveredOrderId" TEXT,
    "callTaskId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AbandonedCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AbandonedCheckout_status_expiresAt_idx" ON "AbandonedCheckout"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "AbandonedCheckout_customerPhone_idx" ON "AbandonedCheckout"("customerPhone");

-- CreateIndex
CREATE UNIQUE INDEX "AbandonedCheckout_sessionKey_key" ON "AbandonedCheckout"("sessionKey");
